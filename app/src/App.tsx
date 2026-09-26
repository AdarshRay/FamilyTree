import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { FAMILY, GEN_LABEL, type FamilyNode } from "./data/family";
import {
  buildLayout,
  indexPeople,
  CARD_W,
  CARD_H,
  V_GAP,
  PAD,
  type PersonEntry,
  type PositionedUnion,
} from "./lib/layout";
import { PersonCard } from "./components/PersonCard";
import { Edges } from "./components/Edges";
import { DetailPanel } from "./components/DetailPanel";
import { HoloCard } from "./components/HoloCard";
import { AmbientStage } from "./components/AmbientStage";
import { DataBackupScreen } from "./components/DataBackupScreen";
import { RelationshipFinder } from "./components/RelationshipFinder";
import { BranchFilter } from "./components/BranchFilter";
import { playHoverSound, playClickSound } from "./lib/sound";
import { isCoarsePointer } from "./lib/platform";
import {
  loadOverrides,
  persistOverrides,
  cleanOverride,
  isEmptyOverride,
  effectiveFields,
  type Overrides,
  type PersonOverride,
} from "./lib/store";
import {
  loadStructure,
  persistStructure,
  buildEffectiveFamily,
  collectNames,
  type StructureEdits,
  type AddedChild,
  type AddedPerson,
} from "./lib/structure";
import {
  makeSnapshot,
  normalizeSnapshot,
  persistProjectEdits,
  snapshotEditKey,
  type FamilyEditsSnapshot,
} from "./lib/permanent";
import { describeRelationship } from "./lib/relationships";
import { familyExcelBlob } from "./lib/excel";
import {
  backupDesktopSnapshot,
  loadDesktopSnapshot,
  onDesktopSaveRequested,
  onDesktopUndoRequested,
  persistDesktopSnapshot,
  publishDesktopSnapshot,
  restoreDesktopSnapshot,
} from "./lib/desktop";

const PANEL_W = 360; // detail panel width — keep focused nodes clear of it
const ROMAN = ["I", "II", "III", "IV", "V", "VI"];

/** Orthogonal path tracing a lineage from the hovered node up to the founders. */
function lineagePathD(unions: PositionedUnion[]): string {
  let d = "";
  for (let i = 0; i < unions.length - 1; i++) {
    const child = unions[i];
    const parent = unions[i + 1];
    const busY = parent.y + CARD_H + (V_GAP - CARD_H) * 0.42;
    d += `M ${parent.cx} ${parent.y + CARD_H} V ${busY} H ${child.cx} V ${child.y} `;
  }
  return d;
}

/** Centered header crest — an arc-reactor framing a mini family-tree glyph. */
function HeaderCrest({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      className="hud-center"
      onClick={onClick}
      aria-label="Show the full family tree"
      data-tip="Show the full family tree"
    >
      <svg className="crest-svg" viewBox="0 0 120 120" aria-hidden="true">
        <g className="ring-rot">
          <circle cx="60" cy="60" r="54" className="crest-ring-dash" />
        </g>
        <circle cx="60" cy="60" r="44" className="crest-ring" />
        {/* mini family tree: root → two branches → four leaves */}
        <g className="crest-tree">
          <path d="M60 40 V52 M60 52 L46 62 M60 52 L74 62 M46 62 L40 76 M46 62 L52 76 M74 62 L68 76 M74 62 L80 76" />
          <circle cx="60" cy="40" r="3.4" className="crest-node core" />
          <circle cx="46" cy="62" r="2.6" className="crest-node" />
          <circle cx="74" cy="62" r="2.6" className="crest-node" />
          <circle cx="40" cy="77" r="2.2" className="crest-node" />
          <circle cx="52" cy="77" r="2.2" className="crest-node" />
          <circle cx="68" cy="77" r="2.2" className="crest-node" />
          <circle cx="80" cy="77" r="2.2" className="crest-node" />
        </g>
      </svg>
      <div className="crest-title-row">
        <span className="tline" />
        <span className="crest-title">Private Family Tree</span>
        <span className="tline r" />
      </div>
    </button>
  );
}

function BranchToolIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 4v5" />
      <path d="M12 9 7 14" />
      <path d="M12 9 17 14" />
      <path d="M7 14v4" />
      <path d="M17 14v4" />
      <circle cx="12" cy="4" r="2.2" />
      <circle cx="7" cy="19" r="2.2" />
      <circle cx="17" cy="19" r="2.2" />
    </svg>
  );
}

function RelationshipToolIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="7" cy="8" r="2.6" />
      <circle cx="17" cy="8" r="2.6" />
      <path d="M4.5 18c.5-3 1.7-4.6 2.5-4.6s2 1.6 2.5 4.6" />
      <path d="M14.5 18c.5-3 1.7-4.6 2.5-4.6s2 1.6 2.5 4.6" />
      <path d="M9.8 10.2h4.4" />
      <path d="M12 10.2v3" />
    </svg>
  );
}

function BackupToolIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <ellipse cx="12" cy="6" rx="6" ry="2.8" />
      <path d="M6 6v6c0 1.5 2.7 2.8 6 2.8s6-1.3 6-2.8V6" />
      <path d="M6 9.2c0 1.5 2.7 2.8 6 2.8s6-1.3 6-2.8" />
      <path d="M12 16v4" />
      <path d="m9.8 18 2.2 2 2.2-2" />
    </svg>
  );
}

function ToolsMenuIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="5" cy="12" r="1.8" />
      <circle cx="12" cy="12" r="1.8" />
      <circle cx="19" cy="12" r="1.8" />
    </svg>
  );
}

/** Collapses the less-frequently-used tree tools (branch/relationship/backup)
 *  behind one overflow button, instead of three separate icons crowding the toolrow. */
function ToolsMenu({
  branchActive,
  onBranchFilter,
  onRelationshipFinder,
  onDataBackup,
}: {
  branchActive: boolean;
  onBranchFilter: () => void;
  onRelationshipFinder: () => void;
  onDataBackup?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  return (
    <div className="acct-menu" ref={rootRef}>
      <button
        type="button"
        className={"toolicon tip-right" + (branchActive ? " on" : "")}
        onClick={() => setOpen((v) => !v)}
        data-tip="More tools"
        aria-label="More tools"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <ToolsMenuIcon />
      </button>
      {open && (
        <div className="acct-popover" role="menu">
          <button
            type="button"
            className="acct-item with-icon"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onBranchFilter();
            }}
          >
            <BranchToolIcon /> Branch Filter
          </button>
          <button
            type="button"
            className="acct-item with-icon"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onRelationshipFinder();
            }}
          >
            <RelationshipToolIcon /> Relationship Finder
          </button>
          {onDataBackup && (
            <button
              type="button"
              className="acct-item with-icon"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                onDataBackup();
              }}
            >
              <BackupToolIcon /> Data Backup
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function NavigationToolIcon({ mode }: { mode: InputMode }) {
  if (mode === "trackpad") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <rect x="4" y="6" width="16" height="12" rx="3" />
        <path d="M8 14h8" />
      </svg>
    );
  }

  if (mode === "mouse") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 3c3.2 0 5.5 2.6 5.5 6.2v5.6c0 3.6-2.3 6.2-5.5 6.2s-5.5-2.6-5.5-6.2V9.2C6.5 5.6 8.8 3 12 3Z" />
        <path d="M12 3v6" />
        <path d="M12 6.5v2.2" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 12a7 7 0 0 1 12-4.9" />
      <path d="M17 4.5v3h-3" />
      <path d="M19 12a7 7 0 0 1-12 4.9" />
      <path d="M7 19.5v-3h3" />
    </svg>
  );
}

interface View {
  x: number;
  y: number;
  k: number;
}

interface EditSnapshot {
  overrides: Overrides;
  structure: StructureEdits;
}

type Gesture =
  | { mode: "pan"; sx: number; sy: number; ox: number; oy: number; moved: boolean; name: string | null }
  | {
      mode: "pinch";
      startDist: number;
      startK: number;
      startVX: number;
      startVY: number;
      startMidX: number;
      startMidY: number;
    };

const MIN_K = 0.14;
const MAX_K = 2.4;
const clampK = (k: number) => Math.min(MAX_K, Math.max(MIN_K, k));
const WHEEL_LINE_PX = 16;
const TRACKPAD_ZOOM_SENSITIVITY = 0.01;
const isMobileW = (w: number) => w < 760;
type SaveState = "idle" | "saving" | "desktop" | "project" | "browser" | "error";
type InputMode = "auto" | "mouse" | "trackpad";
type DetectedInput = "mouse" | "trackpad";
const PRINT_MAX_W = 1480;
const PRINT_MAX_H = 980;
const PUBLIC_VIEW = import.meta.env.VITE_PUBLIC_VIEW === "1";
const INPUT_MODE_KEY = "family-tree-input-mode-v1";
const editDataKey = (overrides: Overrides, structure: StructureEdits) =>
  snapshotEditKey({ overrides, structure });

function wheelDeltaPixels(ev: WheelEvent, pageHeight: number): { dx: number; dy: number } {
  const scale = ev.deltaMode === 1 ? WHEEL_LINE_PX : ev.deltaMode === 2 ? pageHeight : 1;
  return { dx: ev.deltaX * scale, dy: ev.deltaY * scale };
}

function loadInputMode(): InputMode {
  try {
    const value = localStorage.getItem(INPUT_MODE_KEY);
    return value === "mouse" || value === "trackpad" ? value : "auto";
  } catch {
    return "auto";
  }
}

function persistInputMode(mode: InputMode): void {
  try {
    localStorage.setItem(INPUT_MODE_KEY, mode);
  } catch {
    // Preference only; no need to interrupt navigation if storage is unavailable.
  }
}

function classifyWheelInput(ev: WheelEvent, dx: number, dy: number): DetectedInput {
  const absX = Math.abs(dx);
  const absY = Math.abs(dy);
  if (ev.deltaMode !== 0) return "mouse";
  if (ev.ctrlKey || ev.metaKey) return "trackpad";
  if (absX >= 1) return "trackpad";
  if (absY >= 48 && Number.isInteger(ev.deltaY)) return "mouse";
  return "trackpad";
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

interface AppProps {
  treeId?: string;
  /** Overrides the "House of Samarsingh" subtitle when hosting multiple trees. */
  treeLabel?: string;
  /** Root tree data for the selected family tree. Defaults to the original Ray tree. */
  family?: FamilyNode;
  /** Initial edit snapshot for the selected tree. */
  initialSnapshot?: FamilyEditsSnapshot;
  /** Changes when a newer authoritative cloud snapshot is received. */
  snapshotRevision?: string;
  /** Persists edits to the selected multi-user tree record. */
  onSaveTreeSnapshot?: (snapshot: FamilyEditsSnapshot) => Promise<void> | void;
  /** Allows owner/editor tree editing. Viewers keep navigation/search/detail access only. */
  canEdit?: boolean;
  /** When set, shows a topbar button to return to the tree dashboard. */
  onOpenDashboard?: () => void;
  /** Rendered at the end of the topbar toolrow (e.g. the account menu). */
  accountMenu?: ReactNode;
}

export default function App({
  treeId,
  treeLabel,
  family = FAMILY,
  initialSnapshot,
  snapshotRevision,
  onSaveTreeSnapshot,
  canEdit: canEditProp = true,
  onOpenDashboard,
  accountMenu,
}: AppProps = {}) {
  const canEdit = !PUBLIC_VIEW && canEditProp;
  const initialEdits = initialSnapshot ? normalizeSnapshot(initialSnapshot) : null;
  const managedTree = Boolean(onSaveTreeSnapshot);
  const [structure, setStructure] = useState<StructureEdits>(() => initialEdits?.structure ?? loadStructure());
  const [overrides, setOverrides] = useState<Overrides>(() => initialEdits?.overrides ?? loadOverrides());
  const [branchRoot, setBranchRoot] = useState<string | null>(null);
  const effectiveFamily = useMemo(() => buildEffectiveFamily(family, structure, overrides), [family, overrides, structure]);
  const existingNames = useMemo(() => collectNames(effectiveFamily), [effectiveFamily]);
  const fullLayout = useMemo(() => buildLayout(effectiveFamily), [effectiveFamily]);
  const fullPeople = useMemo(() => indexPeople(fullLayout.nodes), [fullLayout]);
  const fullByName = useMemo(() => {
    const m: Record<string, PersonEntry> = {};
    fullPeople.forEach((e) => (m[e.person.name] = e));
    return m;
  }, [fullPeople]);
  const layout = useMemo(() => {
    const root = branchRoot ? fullByName[branchRoot] : null;
    return root ? buildLayout(root.union.ref) : fullLayout;
  }, [branchRoot, fullByName, fullLayout]);
  const people = useMemo(() => indexPeople(layout.nodes), [layout]);
  const byName = useMemo(() => {
    const m: Record<string, PersonEntry> = {};
    people.forEach((e) => (m[e.person.name] = e));
    return m;
  }, [people]);
  const founderNames = useMemo(() => {
    const root = layout.nodes.find((n) => n.depth === 0);
    return new Set(root ? root.cards.map((c) => c.person.name) : []);
  }, [layout]);
  const [hoveredName, setHoveredName] = useState<string | null>(null);

  // The one-time "boot" fade-in animation uses `fill-mode: both`, which
  // pins opacity at its end value for as long as the class stays applied —
  // silently overriding any later opacity transition (e.g. branch-filter
  // fades) even though the animation itself finished playing long ago. Drop
  // the class once it's done so normal opacity control takes back over.
  const [hasBooted, setHasBooted] = useState(false);
  useEffect(() => {
    const t = window.setTimeout(() => setHasBooted(true), 1050);
    return () => window.clearTimeout(t);
  }, []);

  // Subtle HUD blip whenever the hovered person actually changes (not on
  // every mousemove — hoveredName only updates when the person changes).
  useEffect(() => {
    if (hoveredName) playHoverSound();
  }, [hoveredName]);

  // A single delegated listener covers every button and card in the app,
  // instead of wiring a click sound into each one individually.
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if ((e.target as HTMLElement).closest?.("button, .card")) playClickSound();
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);

  // Walk from a person up through their ancestor unions to the founders.
  const lineageUnions = useCallback(
    (name: string): PositionedUnion[] => {
      const res: PositionedUnion[] = [];
      const start = byName[name];
      if (!start) return res;
      res.push(start.union);
      const seen = new Set<number>([start.union.id]);
      let parents = start.parents;
      while (parents.length) {
        const pe = byName[parents[0].name];
        if (!pe || seen.has(pe.union.id)) break;
        seen.add(pe.union.id);
        res.push(pe.union);
        parents = pe.parents;
      }
      return res;
    },
    [byName],
  );
  // Ancestors: hovered union upward to the founders.
  const ancestry = useMemo(
    () => (hoveredName ? lineageUnions(hoveredName) : []),
    [hoveredName, lineageUnions],
  );
  // Descendants: hovered union + its whole subtree downward.
  const descendants = useMemo(() => {
    if (!hoveredName) return [] as PositionedUnion[];
    const start = byName[hoveredName];
    if (!start) return [] as PositionedUnion[];
    const res: PositionedUnion[] = [];
    const seen = new Set<number>([start.union.id]);
    const queue: PositionedUnion[] = [start.union];
    while (queue.length) {
      const u = queue.shift()!;
      res.push(u);
      (u.ref.children ?? []).forEach((childNode) => {
        const ce = byName[childNode.person.name];
        if (ce && !seen.has(ce.union.id)) {
          seen.add(ce.union.id);
          queue.push(ce.union);
        }
      });
    }
    return res;
  }, [hoveredName, byName]);

  const hoveredLineage = useMemo(() => {
    if (!hoveredName) return null;
    const s = new Set<string>();
    ancestry.forEach((u) => u.cards.forEach((c) => s.add(c.person.name)));
    descendants.forEach((u) => u.cards.forEach((c) => s.add(c.person.name)));
    return s;
  }, [hoveredName, ancestry, descendants]);

  // Combined trace: the spine up to the founders + all branches downward.
  const hoveredPathD = useMemo(() => {
    if (!hoveredName) return "";
    let d = lineagePathD(ancestry);
    const idsDown = new Set(descendants.map((u) => u.id));
    descendants.forEach((parent) => {
      (parent.ref.children ?? []).forEach((childNode) => {
        const ce = byName[childNode.person.name];
        if (ce && idsDown.has(ce.union.id)) {
          const child = ce.union;
          const busY = parent.y + CARD_H + (V_GAP - CARD_H) * 0.42;
          d += `M ${parent.cx} ${parent.y + CARD_H} V ${busY} H ${child.cx} V ${child.y} `;
        }
      });
    });
    return d;
  }, [hoveredName, ancestry, descendants, byName]);

  const [view, setView] = useState<View>({ x: 0, y: 0, k: 1 });
  const [selected, setSelected] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [editMode, setEditMode] = useState(false);
  const [animating, setAnimating] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [backupOpen, setBackupOpen] = useState(false);
  const [relationshipOpen, setRelationshipOpen] = useState(false);
  const [branchOpen, setBranchOpen] = useState(false);
  const [inputMode, setInputMode] = useState<InputMode>(() => loadInputMode());
  const [detectedInput, setDetectedInput] = useState<DetectedInput>("trackpad");
  const [relFirst, setRelFirst] = useState("");
  const [relSecond, setRelSecond] = useState("");

  const displayName = useCallback(
    (name: string) => {
      const entry = byName[name] ?? fullByName[name];
      return entry ? effectiveFields(entry.person, overrides[name]).name : overrides[name]?.name ?? name;
    },
    [byName, fullByName, overrides],
  );
  const vpRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const pointers = useRef<Map<number, { x: number; y: number }>>(new Map());
  const gesture = useRef<Gesture | null>(null);
  const viewRef = useRef(view);
  const pendingView = useRef<View | null>(null);
  const viewSyncRaf = useRef<number>(0);
  const overridesRef = useRef(overrides);
  const structureRef = useRef(structure);
  const animTimer = useRef<number>(0);
  const hoverClearTimer = useRef<number>(0);
  const hoverMoveRaf = useRef<number>(0);
  const hoverTarget = useRef<HTMLElement | null>(null);
  const navigationTimer = useRef<number>(0);
  const branchChangeTimer = useRef<number>(0);
  const [treeTransitioning, setTreeTransitioning] = useState(false);
  const [navigating, setNavigating] = useState(false);
  const autosaveReady = useRef(false);
  const applyingCloudSnapshot = useRef(false);
  const appliedSnapshotRevision = useRef(snapshotRevision);
  const autosaveTimer = useRef<number>(0);
  const autosaveSeq = useRef(0);
  const lastSavedEditKey = useRef("");
  const historyRef = useRef<EditSnapshot[]>([]);
  const [undoCount, setUndoCount] = useState(0);

  const applyCanvasTransform = useCallback((next: View) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.style.transform = `translate3d(${next.x}px,${next.y}px,0) scale(${next.k})`;
  }, []);

  const moveView = useCallback(
    (nextView: View | ((current: View) => View), syncNow = false) => {
      const next = typeof nextView === "function" ? nextView(viewRef.current) : nextView;
      viewRef.current = next;
      applyCanvasTransform(next);
      pendingView.current = next;

      if (syncNow) {
        if (viewSyncRaf.current) {
          cancelAnimationFrame(viewSyncRaf.current);
          viewSyncRaf.current = 0;
        }
        pendingView.current = null;
        setView(next);
        return;
      }

      if (viewSyncRaf.current) return;
      viewSyncRaf.current = requestAnimationFrame(() => {
        viewSyncRaf.current = 0;
        const pending = pendingView.current;
        if (!pending) return;
        pendingView.current = null;
        setView(pending);
      });
    },
    [applyCanvasTransform],
  );

  // Keep a synchronous mirror of the view for gesture math.
  useLayoutEffect(() => {
    viewRef.current = view;
    applyCanvasTransform(view);
  }, [applyCanvasTransform, view]);

  const writeProjectEdits = useCallback((nextOverrides: Overrides, nextStructure: StructureEdits) => {
    const key = editDataKey(nextOverrides, nextStructure);
    if (key === lastSavedEditKey.current) {
      setSaveState("project");
      return;
    }
    const seq = ++autosaveSeq.current;
    setSaveState("saving");
    const snapshot = makeSnapshot(nextOverrides, nextStructure);

    if (onSaveTreeSnapshot) {
      void Promise.resolve(onSaveTreeSnapshot(snapshot))
        .then(() => {
          if (seq === autosaveSeq.current) {
            lastSavedEditKey.current = key;
            setSaveState("project");
          }
        })
        .catch((err) => {
          console.warn(err);
          if (seq === autosaveSeq.current) setSaveState("error");
        });
      return;
    }

    void persistDesktopSnapshot(snapshot)
      .then((savedToDesktop) => (savedToDesktop ? true : persistProjectEdits(snapshot)))
      .then((savedPermanently) => {
        if (seq === autosaveSeq.current) {
          lastSavedEditKey.current = key;
          setSaveState(savedPermanently ? (window.familyTreeDesktop ? "desktop" : "project") : "browser");
        }
      })
      .catch((err) => {
        console.warn(err);
        if (seq === autosaveSeq.current) setSaveState("error");
      });
  }, [onSaveTreeSnapshot]);

  const scheduleAutosave = useCallback(() => {
    if (!autosaveReady.current) return;
    setSaveState("saving");
    window.clearTimeout(autosaveTimer.current);
    autosaveTimer.current = window.setTimeout(() => {
      writeProjectEdits(overridesRef.current, structureRef.current);
    }, 550);
  }, [writeProjectEdits]);

  useEffect(() => {
    overridesRef.current = overrides;
    if (managedTree) return;
    persistOverrides(overrides);
  }, [managedTree, overrides]);

  useEffect(() => {
    structureRef.current = structure;
    if (managedTree) return;
    persistStructure(structure);
  }, [managedTree, structure]);

  useEffect(() => {
    if (!managedTree || !initialSnapshot || snapshotRevision === appliedSnapshotRevision.current) return;
    const next = normalizeSnapshot(initialSnapshot);
    appliedSnapshotRevision.current = snapshotRevision;
    if (editDataKey(next.overrides, next.structure) === editDataKey(overridesRef.current, structureRef.current)) {
      lastSavedEditKey.current = editDataKey(next.overrides, next.structure);
      setSaveState("project");
      return;
    }
    applyingCloudSnapshot.current = true;
    overridesRef.current = next.overrides;
    structureRef.current = next.structure;
    lastSavedEditKey.current = editDataKey(next.overrides, next.structure);
    setOverrides(next.overrides);
    setStructure(next.structure);
    setSaveState("project");
  }, [initialSnapshot, managedTree, snapshotRevision]);

  useEffect(() => {
    persistInputMode(inputMode);
  }, [inputMode]);

  useEffect(() => {
    let cancelled = false;
    if (managedTree) return () => {
      cancelled = true;
    };

    void loadDesktopSnapshot()
      .then((snapshot) => {
        if (cancelled || snapshot === undefined) return;
        if (!snapshot) {
          void persistDesktopSnapshot(makeSnapshot(overridesRef.current, structureRef.current)).catch(console.warn);
          return;
        }

        const next = normalizeSnapshot(snapshot);
        overridesRef.current = next.overrides;
        structureRef.current = next.structure;
        setOverrides(next.overrides);
        setStructure(next.structure);
        persistOverrides(next.overrides);
        persistStructure(next.structure);
        lastSavedEditKey.current = editDataKey(next.overrides, next.structure);
        setSaveState("desktop");
      })
      .catch((err) => {
        console.warn(err);
        if (!cancelled) setSaveState("error");
      });

    return () => {
      cancelled = true;
    };
  }, [managedTree]);

  const setNavigationActive = useCallback((active: boolean) => {
    canvasRef.current?.classList.toggle("navigating", active);
    vpRef.current?.classList.toggle("navigating", active);
    setNavigating(active);
  }, []);

  const beginNavigation = useCallback(() => {
    window.clearTimeout(hoverClearTimer.current);
    window.clearTimeout(navigationTimer.current);
    setHoveredName(null);
    setNavigationActive(true);
    navigationTimer.current = window.setTimeout(() => setNavigationActive(false), 180);
  }, [setNavigationActive]);

  useEffect(() => {
    if (applyingCloudSnapshot.current) {
      applyingCloudSnapshot.current = false;
      return;
    }
    if (!autosaveReady.current) {
      lastSavedEditKey.current = editDataKey(overridesRef.current, structureRef.current);
      autosaveReady.current = true;
      return;
    }
    scheduleAutosave();
  }, [overrides, structure, scheduleAutosave]);

  useEffect(
    () => () => {
      window.clearTimeout(autosaveTimer.current);
      window.clearTimeout(navigationTimer.current);
      window.clearTimeout(hoverClearTimer.current);
      if (hoverMoveRaf.current) cancelAnimationFrame(hoverMoveRaf.current);
      if (viewSyncRaf.current) cancelAnimationFrame(viewSyncRaf.current);
    },
    [],
  );

  const rememberCurrentEdits = useCallback(() => {
    const current = {
      overrides: overridesRef.current,
      structure: structureRef.current,
    };
    historyRef.current = [...historyRef.current.slice(-24), current];
    setUndoCount(historyRef.current.length);
  }, []);

  const undoLastChange = useCallback(() => {
    const previous = historyRef.current.pop();
    if (!previous) return;
    overridesRef.current = previous.overrides;
    structureRef.current = previous.structure;
    setOverrides(previous.overrides);
    setStructure(previous.structure);
    setSelected(null);
    setUndoCount(historyRef.current.length);
  }, []);

  const restoreRemovedPerson = useCallback(
    (name: string) => {
      rememberCurrentEdits();
      setStructure((prev) => {
        const next: StructureEdits = {
          ...prev,
          removed: prev.removed.filter((item) => item !== name),
        };
        structureRef.current = next;
        return next;
      });
    },
    [rememberCurrentEdits],
  );

  const renameIdentity = useCallback(
    (oldName: string, newNameRaw: string) => {
      const newName = newNameRaw.trim();
      if (!oldName || !newName || oldName === newName) return;
      if (fullPeople.some((entry) => entry.person.name === newName && entry.person.name !== oldName)) {
        alert(`"${newName}" already exists in the tree.`);
        return;
      }
      rememberCurrentEdits();
      setStructure((prev) => {
        const next: StructureEdits = {
          ...prev,
          renames: { ...prev.renames, [oldName]: newName },
        };
        structureRef.current = next;
        return next;
      });
      setOverrides((prev) => {
        if (!prev[oldName]) return prev;
        const next = { ...prev };
        const moved = { ...next[oldName] };
        delete moved.name;
        next[newName] = { ...(next[newName] ?? {}), ...moved };
        delete next[oldName];
        overridesRef.current = next;
        return next;
      });
      setSelected(null);
      setBranchRoot((current) => (current === oldName ? newName : current));
    },
    [fullPeople, rememberCurrentEdits],
  );

  /* ---- Developer overrides (persisted to localStorage) ---- */
  const saveOverride = useCallback((name: string, patch: PersonOverride) => {
    rememberCurrentEdits();
    setOverrides((prev) => {
      const cleaned = cleanOverride(patch);
      const next = { ...prev };
      if (isEmptyOverride(cleaned)) delete next[name];
      else next[name] = cleaned;
      overridesRef.current = next;
      return next;
    });
  }, [rememberCurrentEdits]);

  const resetOverride = useCallback((name: string) => {
    rememberCurrentEdits();
    setOverrides((prev) => {
      const next = { ...prev };
      delete next[name];
      overridesRef.current = next;
      return next;
    });
  }, [rememberCurrentEdits]);

  const exportOverrides = useCallback(() => {
    const json = JSON.stringify(makeSnapshot(overrides, structure), null, 2);
    navigator.clipboard?.writeText(json).catch(() => {});
    const blob = new Blob([json], { type: "application/json" });
    downloadBlob(blob, "rays-family-edits.json");
  }, [overrides, structure]);

  const exportExcel = useCallback(() => {
    const blob = familyExcelBlob(fullPeople, overrides);
    downloadBlob(blob, "rays-family-tree.xlsx");
  }, [fullPeople, overrides]);

  const importEdits = useCallback(
    (snapshot: Partial<FamilyEditsSnapshot>) => {
      rememberCurrentEdits();
      const next = normalizeSnapshot(snapshot);
      overridesRef.current = next.overrides;
      structureRef.current = next.structure;
      setOverrides(next.overrides);
      setStructure(next.structure);
      persistOverrides(next.overrides);
      persistStructure(next.structure);
      writeProjectEdits(next.overrides, next.structure);
    },
    [rememberCurrentEdits, writeProjectEdits],
  );

  const backupToMac = useCallback(() => {
    void backupDesktopSnapshot(makeSnapshot(overridesRef.current, structureRef.current))
      .then((result) => {
        if (result.cancelled) return;
        if (!result.ok) throw new Error(result.message ?? "Could not create backup.");
        alert("Backup saved.");
      })
      .catch((err) => {
        console.warn(err);
        alert("Could not create that backup.");
      });
  }, []);

  const restoreFromMac = useCallback(() => {
    void restoreDesktopSnapshot()
      .then((result) => {
        if (result.cancelled) return;
        if (!result.ok || !result.snapshot) throw new Error(result.message ?? "Could not restore backup.");
        const ok = window.confirm("Restore this family edit backup? This will replace current saved edits.");
        if (ok) importEdits(result.snapshot);
      })
      .catch((err) => {
        console.warn(err);
        alert("Could not restore that backup.");
      });
  }, [importEdits]);

  const publishToGitHub = useCallback(() => {
    const ok = window.confirm("Publish the latest read-only family tree build to GitHub?");
    if (!ok) return;

    setSaveState("saving");
    void publishDesktopSnapshot(makeSnapshot(overridesRef.current, structureRef.current))
      .then((result) => {
        if (result.cancelled) {
          setSaveState("desktop");
          return;
        }
        if (!result.ok) throw new Error(result.message ?? "Could not publish to GitHub.");
        setSaveState("desktop");
        alert(result.message ?? "Published to GitHub.");
      })
      .catch((err) => {
        console.warn(err);
        setSaveState("error");
        const detail = err instanceof Error ? err.message : String(err);
        alert(`Could not publish to GitHub.\n\n${detail}`);
      });
  }, []);

  const saveAllEdits = useCallback(() => {
    persistOverrides(overridesRef.current);
    persistStructure(structureRef.current);
    writeProjectEdits(overridesRef.current, structureRef.current);
  }, [writeProjectEdits]);

  // Mac app menu: Cmd+S always saves; Cmd+Z defers to native text-field undo
  // when a text input is focused, otherwise triggers the app's own undo.
  useEffect(() => {
    const offSave = onDesktopSaveRequested(() => saveAllEdits());
    const offUndo = onDesktopUndoRequested(() => {
      const active = document.activeElement;
      const isEditable =
        active instanceof HTMLElement &&
        (active.tagName === "INPUT" || active.tagName === "TEXTAREA" || active.isContentEditable);
      if (isEditable) document.execCommand("undo");
      else undoLastChange();
    });
    return () => {
      offSave();
      offUndo();
    };
  }, [saveAllEdits, undoLastChange]);

  const printTree = useCallback(() => {
    window.print();
  }, []);

  /* ---- Structural edits (add / remove people; persisted) ---- */
  const addChild = useCallback((unionPrimaryName: string, child: AddedChild) => {
    rememberCurrentEdits();
    setStructure((prev) => {
      const next: StructureEdits = {
        ...prev,
        childrenOf: {
          ...prev.childrenOf,
          [unionPrimaryName]: [...(prev.childrenOf[unionPrimaryName] ?? []), child],
        },
      };
      structureRef.current = next;
      return next;
    });
  }, [rememberCurrentEdits]);

  // Appends — a person can have multiple spouses (remarriage / step-parents).
  const addSpouse = useCallback((personName: string, sp: AddedPerson) => {
    rememberCurrentEdits();
    setStructure((prev) => {
      const next: StructureEdits = {
        ...prev,
        spouseOf: { ...prev.spouseOf, [personName]: [...(prev.spouseOf[personName] ?? []), sp] },
      };
      structureRef.current = next;
      return next;
    });
  }, [rememberCurrentEdits]);

  const removePerson = useCallback((name: string) => {
    rememberCurrentEdits();
    setStructure((prev) => {
      if (prev.removed.includes(name)) return prev;
      const next: StructureEdits = { ...prev, removed: [...prev.removed, name] };
      structureRef.current = next;
      return next;
    });
    setSelected(null);
  }, [rememberCurrentEdits]);

  // Insert a parent ABOVE a person (grows the tree upward; new top = founders).
  const addParentAbove = useCallback((childName: string, parent: AddedPerson) => {
    rememberCurrentEdits();
    setStructure((prev) => {
      const next: StructureEdits = {
        ...prev,
        parentsOf: { ...prev.parentsOf, [childName]: parent },
      };
      structureRef.current = next;
      return next;
    });
  }, [rememberCurrentEdits]);

  /* ---- Fit the whole tree to the viewport ---- */
  const fit = useCallback(() => {
    const vp = vpRef.current;
    if (!vp) return;
    const w = vp.clientWidth;
    const h = vp.clientHeight;
    if (w <= 0 || h <= 0) return;
    // On phones, fit by HEIGHT so every generation is readable and you pan
    // sideways; on wider screens, fit the whole tree as an overview.
    const k = isMobileW(w)
      ? Math.min(0.8, Math.max(MIN_K, (h / layout.height) * 0.9))
      : Math.min(w / layout.width, h / layout.height) * 0.92;
    if (!isFinite(k) || k <= 0) return;
    const x = (w - layout.width * k) / 2;
    const y = (h - layout.height * k) / 2 + (isMobileW(w) ? 8 : 24);
    moveView({ x, y, k }, true);
  }, [layout, moveView]);

  // Robustly fit once the viewport has real dimensions, then re-fit on resize.
  useEffect(() => {
    let raf = 0;
    const tryFit = (attempt = 0) => {
      const vp = vpRef.current;
      if (vp && vp.clientWidth > 0 && vp.clientHeight > 0) fit();
      else if (attempt < 30) raf = requestAnimationFrame(() => tryFit(attempt + 1));
    };
    raf = requestAnimationFrame(() => tryFit());
    const onResize = () => fit();
    window.addEventListener("resize", onResize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
    };
  }, [fit]);

  // Esc closes the open dossier.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (branchOpen) setBranchOpen(false);
        else if (relationshipOpen) setRelationshipOpen(false);
        else if (backupOpen) setBackupOpen(false);
        else setSelected(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [backupOpen, branchOpen, relationshipOpen]);

  useEffect(() => {
    setSelected(null);
    setHoveredName(null);
    const raf = requestAnimationFrame(() => fit());
    return () => cancelAnimationFrame(raf);
  }, [branchRoot, fit]);

  // Switching branchRoot swaps the WHOLE layout (different card count and
  // positions), so cards would otherwise just snap into place. Fade the
  // canvas out, swap the data while it's invisible, then fade back in.
  const changeBranch = useCallback((next: string | null) => {
    window.clearTimeout(branchChangeTimer.current);
    setTreeTransitioning(true);
    branchChangeTimer.current = window.setTimeout(() => {
      setBranchRoot(next); // the effect below clears selection/hover + fits
      requestAnimationFrame(() => {
        requestAnimationFrame(() => setTreeTransitioning(false));
      });
    }, 200);
  }, []);

  // Crest logo: clear any active branch filter and recenter on the whole tree.
  const resetToFullTree = useCallback(() => {
    if (branchRoot !== null) {
      changeBranch(null);
    } else {
      setSelected(null);
      setHoveredName(null);
      fit();
    }
  }, [branchRoot, changeBranch, fit]);

  const cycleInputMode = useCallback(() => {
    setInputMode((current) => (current === "auto" ? "mouse" : current === "mouse" ? "trackpad" : "auto"));
  }, []);

  /* ---- Smoothly center + select a person (card click, search, relations) ---- */
  const focusOn = useCallback(
    (name: string) => {
      const e = byName[name];
      if (!e) return;
      setSelected(name);
      const vp = vpRef.current;
      if (!vp) return;
      const w = vp.clientWidth;
      const h = vp.clientHeight;

      // Turn on the eased transition for this programmatic move only.
      setAnimating(true);
      window.clearTimeout(animTimer.current);
      animTimer.current = window.setTimeout(() => setAnimating(false), 560);

      // Edit mode opens the side panel, so keep focused nodes clear of it.
      const sideOffset = editMode ? PANEL_W : 0;
      moveView((v) => {
        const k = Math.min(MAX_K, Math.max(v.k, 0.7));
        const cx = e.cardX + CARD_W / 2;
        const cy = e.cardY + CARD_H / 2;
        return { x: (w - sideOffset) / 2 - cx * k, y: h / 2 - cy * k, k };
      }, true);
    },
    [byName, editMode, moveView],
  );

  /* ---- Touchpad/mouse wheel navigation: pan normally, zoom on pinch/wheel ---- */
  const onWheel = useCallback((ev: WheelEvent) => {
    const vp = vpRef.current;
    if (!vp) return;
    const target = ev.target as Element | null;
    const isTrackpadPinch = ev.ctrlKey || ev.metaKey;
    const isTreeGesture = target ? vp.contains(target) : false;
    if (!isTreeGesture && !isTrackpadPinch) return;

    ev.preventDefault();
    setAnimating(false);
    beginNavigation();
    const rect = vp.getBoundingClientRect();
    const mx = ev.clientX - rect.left;
    const my = ev.clientY - rect.top;
    const { dx, dy } = wheelDeltaPixels(ev, vp.clientHeight);
    const autoInput = classifyWheelInput(ev, dx, dy);
    setDetectedInput(autoInput);
    const effectiveInput = inputMode === "auto" ? autoInput : inputMode;

    if (isTrackpadPinch || effectiveInput === "mouse") {
      if (!isTrackpadPinch && ev.shiftKey) {
        moveView((v) => ({ ...v, x: v.x - dy }));
        return;
      }
      const factor = isTrackpadPinch
        ? Math.min(1.32, Math.max(0.68, Math.exp(-dy * TRACKPAD_ZOOM_SENSITIVITY)))
        : dy < 0
          ? 1.12
          : 1 / 1.12;
      moveView((v) => {
        const k = clampK(v.k * factor);
        const x = mx - (mx - v.x) * (k / v.k);
        const y = my - (my - v.y) * (k / v.k);
        return { x, y, k };
      });
      return;
    }

    // Two-finger touchpad scrolls pan the tree in both axes.
    moveView((v) => ({ ...v, x: v.x - dx, y: v.y - dy }));
  }, [beginNavigation, inputMode, moveView]);

  useEffect(() => {
    window.addEventListener("wheel", onWheel, { capture: true, passive: false });
    const preventNativeGestureZoom = (ev: Event) => ev.preventDefault();
    window.addEventListener("gesturestart", preventNativeGestureZoom, { passive: false });
    window.addEventListener("gesturechange", preventNativeGestureZoom, { passive: false });
    return () => {
      window.removeEventListener("wheel", onWheel, { capture: true });
      window.removeEventListener("gesturestart", preventNativeGestureZoom);
      window.removeEventListener("gesturechange", preventNativeGestureZoom);
    };
  }, [onWheel]);

  /* ---- Pointer pan (1 finger/mouse) + pinch-zoom (2 fingers) + tap ---- */
  const onPointerDown = (ev: React.PointerEvent) => {
    // Let the tooltip's own controls (e.g. "Show Branch") handle their own
    // click fully undisturbed — otherwise this handler clears the hover
    // (unmounting the button) before the click event can even fire.
    if ((ev.target as HTMLElement).closest?.(".nametip")) return;
    setAnimating(false);
    setHoveredName(null);
    const vp = vpRef.current;
    if (!vp) return;
    pointers.current.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    try {
      vp.setPointerCapture(ev.pointerId);
    } catch {
      /* capture can fail on some pointers; gestures still work without it */
    }

    if (pointers.current.size === 1) {
      const cardEl = (ev.target as HTMLElement).closest?.(".card") as HTMLElement | null;
      gesture.current = {
        mode: "pan",
        sx: ev.clientX,
        sy: ev.clientY,
        ox: viewRef.current.x,
        oy: viewRef.current.y,
        moved: false,
        name: cardEl ? cardEl.getAttribute("data-name") : null,
      };
    } else if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      const rect = vp.getBoundingClientRect();
      gesture.current = {
        mode: "pinch",
        startDist: Math.hypot(a.x - b.x, a.y - b.y) || 1,
        startK: viewRef.current.k,
        startVX: viewRef.current.x,
        startVY: viewRef.current.y,
        startMidX: (a.x + b.x) / 2 - rect.left,
        startMidY: (a.y + b.y) / 2 - rect.top,
      };
    }
  };

  const onPointerMove = (ev: React.PointerEvent) => {
    if (!pointers.current.has(ev.pointerId)) return;
    pointers.current.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    const g = gesture.current;
    if (!g) return;

    if (g.mode === "pan") {
      const dx = ev.clientX - g.sx;
      const dy = ev.clientY - g.sy;
      if (Math.abs(dx) + Math.abs(dy) > 5) {
        g.moved = true;
        beginNavigation();
      }
      moveView((v) => ({ ...v, x: g.ox + dx, y: g.oy + dy }));
    } else if (g.mode === "pinch" && pointers.current.size >= 2) {
      beginNavigation();
      const vp = vpRef.current;
      if (!vp) return;
      const rect = vp.getBoundingClientRect();
      const [a, b] = [...pointers.current.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      const midX = (a.x + b.x) / 2 - rect.left;
      const midY = (a.y + b.y) / 2 - rect.top;
      const k = clampK(g.startK * (dist / g.startDist));
      const ratio = k / g.startK;
      // Keep the pinch's start midpoint anchored to the same canvas point.
      const x = midX - (g.startMidX - g.startVX) * ratio;
      const y = midY - (g.startMidY - g.startVY) * ratio;
      moveView({ x, y, k });
    }
  };

  const endPointer = (ev: React.PointerEvent) => {
    // Symmetric with onPointerDown's early-return: a pointerdown that started
    // on the tooltip never registered a gesture, so mirror that here too.
    if ((ev.target as HTMLElement).closest?.(".nametip")) return;
    const g = gesture.current;
    pointers.current.delete(ev.pointerId);

    if (pointers.current.size === 1) {
      // Pinch → one finger left: resume panning from it (no tap-select).
      const [p] = [...pointers.current.values()];
      gesture.current = {
        mode: "pan",
        sx: p.x,
        sy: p.y,
        ox: viewRef.current.x,
        oy: viewRef.current.y,
        moved: true,
        name: null,
      };
      return;
    }
    if (pointers.current.size === 0) {
      gesture.current = null;
      setNavigationActive(false);
      if (g && g.mode === "pan" && !g.moved) {
        if (g.name) focusOn(g.name); // tapped a node → fly to center + open
        else setSelected(null); // tapped empty space → clear
      }
    }
  };

  // Hover (desktop): highlight a card's lineage + show its name tooltip.
  const onHoverMove = (ev: React.MouseEvent) => {
    // iOS Safari fires a synthetic mousemove on tap, which would otherwise
    // race the pointer-based tap-to-select and flash a tooltip behind the
    // card it opens. Touch already reaches the same info via the tap target.
    if (isCoarsePointer()) return;
    if (navigating) return;
    if (pointers.current.size > 0) return; // ignore while panning/pinching
    hoverTarget.current = ev.target as HTMLElement;
    if (hoverMoveRaf.current) return;
    hoverMoveRaf.current = requestAnimationFrame(() => {
      hoverMoveRaf.current = 0;
      const target = hoverTarget.current;
      if (!target || navigating || pointers.current.size > 0) return;
    // Moving into the tooltip itself (e.g. to click "Show Branch") shouldn't
    // clear the hover — it's not a `.card`, so without this check the
    // tooltip would vanish the instant the cursor reached it.
      if (target.closest?.(".nametip")) {
        window.clearTimeout(hoverClearTimer.current);
        return;
      }
      const el = target.closest?.(".card") as HTMLElement | null;
      const name = el ? el.getAttribute("data-name") : null;
      if (name) {
        window.clearTimeout(hoverClearTimer.current);
        setHoveredName((prev) => (prev === name ? prev : name));
      } else {
        // Brief grace period: the tooltip floats above the card with a small
        // gap, so the cursor crosses "neither card nor tooltip" territory on
        // its way up — without this, the tooltip could vanish mid-transit.
        window.clearTimeout(hoverClearTimer.current);
        hoverClearTimer.current = window.setTimeout(() => setHoveredName(null), 250);
      }
    });
  };

  const zoomBtn = (dir: 1 | -1) =>
    moveView((v) => {
      const vp = vpRef.current;
      if (!vp) return v;
      const w = vp.clientWidth / 2;
      const h = vp.clientHeight / 2;
      const k = clampK(v.k * (dir > 0 ? 1.2 : 1 / 1.2));
      return { x: w - (w - v.x) * (k / v.k), y: h - (h - v.y) * (k / v.k), k };
    }, true);

  /* ---- Search ---- */
  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return people
      .filter((e) => effectiveFields(e.person, overrides[e.person.name]).name.toLowerCase().includes(q))
      .slice(0, 8);
  }, [query, people, overrides]);

  const matchNames = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return null;
    const s = new Set<string>();
    people.forEach((e) => {
      if (effectiveFields(e.person, overrides[e.person.name]).name.toLowerCase().includes(q)) {
        s.add(e.person.name);
      }
    });
    return s;
  }, [query, people, overrides]);

  const selectedEntry = selected ? byName[selected] : null;
  const printScale = useMemo(
    () => Math.min(1, PRINT_MAX_W / layout.width, PRINT_MAX_H / layout.height),
    [layout.height, layout.width],
  );
  const profileEditCount = useMemo(() => Object.keys(overrides).length, [overrides]);
  const structureEditCount = useMemo(
    () =>
      Object.values(structure.childrenOf).reduce((sum, items) => sum + items.length, 0) +
      Object.values(structure.spouseOf).reduce((sum, items) => sum + items.length, 0) +
      Object.keys(structure.parentsOf).length +
      Object.keys(structure.renames).length +
      structure.removed.length,
    [structure],
  );
  const recentlyRemoved = useMemo(
    () => structure.removed.map((name) => ({ name, label: displayName(name) })),
    [displayName, structure.removed],
  );
  const personOptions = useMemo(
    () =>
      fullPeople
        .map((entry) => ({ name: entry.person.name, label: displayName(entry.person.name) }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [displayName, fullPeople],
  );
  const relationshipResult = useMemo(
    () => describeRelationship(relFirst, relSecond, fullPeople, displayName),
    [displayName, fullPeople, relFirst, relSecond],
  );
  const saveStatus =
    saveState === "saving"
      ? "Auto-saving family data..."
      : saveState === "desktop"
        ? "Auto-saved on this Mac"
        : saveState === "project"
          ? "Auto-saved permanently to project"
          : saveState === "browser"
            ? "Auto-saved in this browser"
            : saveState === "error"
              ? "Auto-save failed; download a backup"
              : "Auto-save ready";

  const renderTreeContents = useCallback(
    (forPrint = false) => (
      <>
        <Edges edges={layout.edges} width={layout.width} height={layout.height} />

        {!forPrint && hoveredPathD && (
          <svg
            className="lineage-svg"
            width={layout.width}
            height={layout.height}
            viewBox={`0 0 ${layout.width} ${layout.height}`}
          >
            <path className="lineage-path" d={hoveredPathD} />
          </svg>
        )}

        {Array.from({ length: layout.maxDepth + 1 }).map((_, i) => (
          <div key={`g-${i}`}>
            <div className="genband" style={{ top: PAD + i * V_GAP - 22, left: 12 }}>
              {`G${i + 1} · ${GEN_LABEL[i] ?? `Generation ${i + 1}`}`}
            </div>
            <div className="genline" style={{ top: PAD + i * V_GAP - 6, width: layout.width }} />
          </div>
        ))}

        {layout.nodes.flatMap((u) =>
          u.cards.map((card, ci) => (
            <PersonCard
              key={`${forPrint ? "print" : "screen"}-${u.id}-${ci}`}
              card={card}
              selectedName={forPrint ? null : selected}
              matchNames={forPrint ? null : matchNames}
              override={overrides[card.person.name]}
              isFounder={founderNames.has(card.person.name)}
              lineage={forPrint ? null : hoveredLineage}
            />
          )),
        )}
      </>
    ),
    [
      founderNames,
      hoveredLineage,
      hoveredPathD,
      layout.edges,
      layout.height,
      layout.maxDepth,
      layout.nodes,
      layout.width,
      matchNames,
      overrides,
      selected,
    ],
  );
  const treeContents = useMemo(() => renderTreeContents(), [renderTreeContents]);
  const printTreeContents = useMemo(() => renderTreeContents(true), [renderTreeContents]);
  return (
    <div className="app-shell">
      {/* Volumetric holo-environment */}
      <AmbientStage />

      {/* HUD chrome frame — full-viewport bezel with ticks + side rails */}
      <div className="hud-frame" aria-hidden="true">
        <span className="hud-corner hud-tl" />
        <span className="hud-corner hud-tr" />
        <span className="hud-corner hud-bl" />
        <span className="hud-corner hud-br" />
        <span className="hud-edge top" />
        <span className="hud-edge bottom" />
        <div className="hud-rail left">
          <span className="hud-rail-label">◂ LINEAGE ARRAY</span>
        </div>
        <div className="hud-rail right">
          <span className="hud-rail-label">SYS · NOMINAL ▸</span>
        </div>
      </div>

      <div className="topbar">
        <div className="brand">
          <h1>{treeLabel ?? "FAMILY TREE"}</h1>
          <div className="sub">Lineage Interface</div>
        </div>
        <div className="topbar-right">
          <div className="statchip">
            <span className="live-dot" />
            <span>
              Members <b>{people.length}</b>
            </span>
            <span>
              Generations <b>{layout.maxDepth + 1}</b>
            </span>
            <span>
              Zoom <b>{Math.round(view.k * 100)}%</b>
            </span>
          </div>
          <div className="topbar-controls">
            <div className="toolrow">
              {onOpenDashboard && (
                <>
                  <button
                    className="toolicon tip-right"
                    onClick={onOpenDashboard}
                    data-tip="Back to your family trees"
                    aria-label="Back to Dashboard"
                  >
                    ◂
                  </button>
                  <span className="tooldivider" aria-hidden="true" />
                </>
              )}
              <button
                className={"toolicon input-mode " + inputMode}
                onClick={cycleInputMode}
                data-tip={
                  inputMode === "auto"
                    ? `Navigation: Auto (${detectedInput === "mouse" ? "mouse wheel" : "trackpad"})`
                    : inputMode === "mouse"
                      ? "Navigation: Mouse — wheel zooms, Shift+wheel pans"
                      : "Navigation: Trackpad — two-finger scroll pans, pinch zooms"
                }
                aria-label="Navigation input mode"
              >
                <NavigationToolIcon mode={inputMode} />
              </button>
              {canEdit && (
                <>
                  <button
                    className={"devtoggle" + (editMode ? " on" : "")}
                    onClick={() => setEditMode((v) => !v)}
                    data-tip="Developer: add photos & details per card"
                  >
                    {editMode ? "◈ Edit Mode: ON" : "◇ Edit Mode"}
                  </button>
                  <span className="tooldivider" aria-hidden="true" />
                </>
              )}
              <ToolsMenu
                branchActive={!!branchRoot}
                onBranchFilter={() => setBranchOpen(true)}
                onRelationshipFinder={() => setRelationshipOpen(true)}
                onDataBackup={canEdit ? () => setBackupOpen(true) : undefined}
              />
            </div>
            {accountMenu}
          </div>
        </div>
      </div>

      <HeaderCrest onClick={resetToFullTree} />

      <div className="print-sheet" aria-hidden="true">
        <div className="print-header">
          <h1>The Ray&apos;s Family Tree</h1>
          <p>
            Private family workspace · {people.length} members · {layout.maxDepth + 1} generations
          </p>
        </div>
        <div
          className="print-tree"
          style={{ width: layout.width * printScale, height: layout.height * printScale }}
        >
          <div
            className="canvas print-canvas"
            style={{
              width: layout.width,
              height: layout.height,
              transform: `scale(${printScale})`,
            }}
          >
            {printTreeContents}
          </div>
        </div>
      </div>

      {/* Interactive canvas */}
      <div
        ref={vpRef}
        className={"viewport" + (navigating ? " navigating" : "")}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endPointer}
        onPointerCancel={endPointer}
        onMouseMove={onHoverMove}
        onMouseLeave={() => {
          window.clearTimeout(hoverClearTimer.current);
          setHoveredName(null);
        }}
      >
        <div
          ref={canvasRef}
          className={
            "canvas" +
            (hasBooted ? "" : " boot") +
            (navigating ? " navigating" : "") +
            (hoveredName ? " hovering" : "") +
            (treeTransitioning ? " tree-fade" : "")
          }
          style={{
            width: layout.width,
            height: layout.height,
            transform: `translate3d(${view.x}px,${view.y}px,0) scale(${view.k})`,
            // Inline styles override the .canvas CSS rule for the same
            // property, so opacity's transition has to be listed here too —
            // otherwise a branch-filter fade would be silently cancelled
            // whenever this was "none" (i.e. whenever not mid pan/zoom).
            transition: [
              animating ? "transform 0.55s cubic-bezier(0.2,0.8,0.2,1)" : "",
              "opacity 0.2s ease",
            ]
              .filter(Boolean)
              .join(", "),
          }}
        >
          {treeContents}
        </div>

        {/* Hovered name tooltip (anchored above the card) */}
        {hoveredName && byName[hoveredName] && (
          <div
            className="nametip"
            style={{
              left: view.x + (byName[hoveredName].cardX + CARD_W / 2) * view.k,
              top: view.y + byName[hoveredName].cardY * view.k,
            }}
          >
            <div className="nt-name">{displayName(hoveredName)}</div>
            <div className="nt-gen">
              Generation {ROMAN[byName[hoveredName].gen] ?? byName[hoveredName].gen + 1}
            </div>
            <button
              className="nt-branch"
              onClick={() => changeBranch(hoveredName)}
              title={`Show only ${displayName(hoveredName)}'s branch`}
            >
              ⌁ Show Branch
            </button>
          </div>
        )}
      </div>

      {/* Edge fade hints — there's more tree to pan toward */}
      <div className="edge-fade left" />
      <div className="edge-fade right" />

      {/* Search */}
      <div className="searchwrap">
        {results.length > 0 && (
          <div className="results">
            {results.map((e) => (
              <button
                key={e.person.name}
                onClick={() => {
                  focusOn(e.person.name);
                  setQuery("");
                }}
              >
                <span>{displayName(e.person.name)}</span>
                <span className="rk" style={{ marginLeft: "auto" }}>{`G${e.gen + 1}`}</span>
              </button>
            ))}
          </div>
        )}
        <div className="searchbox">
          <span className="ico">⌕</span>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search a family member…"
          />
        </div>
      </div>

      {/* Navigation dock */}
      <div className="navdock">
        <div className="controls">
          <div className="ctl" onClick={() => zoomBtn(1)}>
            +
          </div>
          <div className="ctl" onClick={() => zoomBtn(-1)}>
            −
          </div>
          <div className="ctl tip-up tip-right" onClick={fit} data-tip="Fit to screen">
            <small>FIT</small>
          </div>
          <button
            className="ctl print-ctl tip-up tip-right"
            onClick={printTree}
            data-tip="Print or save as PDF"
            aria-label="Print or save as PDF"
          >
            <small>PDF</small>
          </button>
        </div>
      </div>

      <div className="hint">
        Drag to <b>pan</b> · Scroll to <b>zoom</b> · Click a node for <b>details</b>
      </div>

      <DetailPanel
        treeId={treeId}
        entry={canEdit && editMode ? selectedEntry : null}
        overrides={overrides}
        editMode={canEdit && editMode}
        existingNames={existingNames}
        byName={byName}
        onClose={() => setSelected(null)}
        onSelect={focusOn}
        onSave={saveOverride}
        onReset={resetOverride}
        onAddChild={addChild}
        onAddSpouse={addSpouse}
        onRemovePerson={removePerson}
        onAddParentAbove={addParentAbove}
        onShowBranch={changeBranch}
      />
      {!editMode && selectedEntry && (
        <HoloCard
          entry={selectedEntry}
          overrides={overrides}
          onClose={() => setSelected(null)}
          onSelect={focusOn}
          onShowBranch={changeBranch}
        />
      )}

      {canEdit && (
        <DataBackupScreen
          open={backupOpen}
          saveStatus={saveStatus}
          memberCount={people.length}
          generationCount={layout.maxDepth + 1}
          profileEditCount={profileEditCount}
          structureEditCount={structureEditCount}
          canUndo={undoCount > 0}
          recentlyRemoved={recentlyRemoved}
          people={personOptions}
          onClose={() => setBackupOpen(false)}
          onExport={exportOverrides}
          onExportExcel={exportExcel}
          onBackupToMac={window.familyTreeDesktop ? backupToMac : undefined}
          onRestoreFromMac={window.familyTreeDesktop ? restoreFromMac : undefined}
          onPublishToGitHub={window.familyTreeDesktop && !managedTree ? publishToGitHub : undefined}
          onImport={importEdits}
          onSaveAll={saveAllEdits}
          onUndo={undoLastChange}
          onRestoreRemoved={restoreRemovedPerson}
          onRename={renameIdentity}
        />
      )}

      <RelationshipFinder
        open={relationshipOpen}
        people={personOptions}
        first={relFirst}
        second={relSecond}
        result={relationshipResult}
        onFirst={setRelFirst}
        onSecond={setRelSecond}
        onClose={() => setRelationshipOpen(false)}
        onFocus={(name) => {
          setRelationshipOpen(false);
          focusOn(name);
        }}
      />

      <BranchFilter
        open={branchOpen}
        people={personOptions}
        value={branchRoot}
        onChange={changeBranch}
        onClose={() => setBranchOpen(false)}
      />
    </div>
  );
}
