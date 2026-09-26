/**
 * STRUCTURE EDITS
 * ------------------------------------------------------------------
 * Runtime, developer-editable changes to the *shape* of the tree,
 * persisted to localStorage and applied on top of the base FAMILY at load.
 *
 * Supports: additional children, additional spouses for ANY person
 * (not just primaries — this is what makes "step" relationships work:
 * giving someone's MOTHER a second husband is just another entry in
 * `spouseOf[motherName]`), parents inserted above the current top
 * ancestor (grows the tree upward), and removals.
 *
 * `buildEffectiveFamily` turns the static FAMILY + these edits into an
 * `EffectiveNode` tree that the layout engine renders. Each union's
 * spouses are `SpouseSlot`s: a direct spouse plus THEIR OWN additional
 * spouses nested one level (a step-parent's own remarriage), which is
 * enough to represent "step" relationships while keeping the rendering
 * simple (everyone in a union still lays out as one row of cards).
 *
 * Field edits (photo/dob/…) still live in the separate overrides store
 * and apply by name — including to people added here.
 */
import type { FamilyNode, Gender, Person, PersonRelation } from "../data/family";
import { permanentEdits } from "./permanent";
import type { Overrides } from "./store";

export interface AddedPerson {
  name: string;
  gender: Gender;
  relation?: PersonRelation;
}
export interface AddedChild {
  person: AddedPerson;
  spouse?: AddedPerson;
  /** Explicit parent pairing for this child. Defaults to
   *  [union primary, union's first direct spouse] when both are omitted. */
  parentA?: string;
  parentB?: string;
}

export interface StructureEdits {
  /** children appended to a union, keyed by the union's PRIMARY person name */
  childrenOf: Record<string, AddedChild[]>;
  /** additional spouses for ANY person (primary, a spouse, or a step-spouse), keyed by their name */
  spouseOf: Record<string, AddedPerson[]>;
  /** a parent inserted ABOVE a person, keyed by that (child) person's name */
  parentsOf: Record<string, AddedPerson>;
  /** names of people removed (a union primary removes their whole branch) */
  removed: string[];
  /** true internal rename map: original/current key -> new name */
  renames: Record<string, string>;
}

const KEY = "rays-structure-v1";

export const emptyStructure = (): StructureEdits => ({
  childrenOf: {},
  spouseOf: {},
  parentsOf: {},
  removed: [],
  renames: {},
});

export function loadStructure(): StructureEdits {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return permanentEdits.structure;
    const s = JSON.parse(raw) as Partial<StructureEdits>;
    return {
      childrenOf: { ...permanentEdits.structure.childrenOf, ...(s.childrenOf ?? {}) },
      spouseOf: { ...permanentEdits.structure.spouseOf, ...(s.spouseOf ?? {}) },
      parentsOf: { ...permanentEdits.structure.parentsOf, ...(s.parentsOf ?? {}) },
      renames: { ...permanentEdits.structure.renames, ...(s.renames ?? {}) },
      // Permanent project data is authoritative for removals so an old browser cache
      // cannot keep hiding a restored branch after it has been undone in source.
      removed: permanentEdits.structure.removed,
    };
  } catch {
    return permanentEdits.structure;
  }
}

export function persistStructure(s: StructureEdits): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    console.warn("Could not persist structure edits (storage full?).");
  }
}

export const hasStructureEdits = (s: StructureEdits): boolean =>
  Object.keys(s.childrenOf).length > 0 ||
  Object.keys(s.spouseOf).length > 0 ||
  Object.keys(s.parentsOf).length > 0 ||
  Object.keys(s.renames).length > 0 ||
  s.removed.length > 0;

const resolveName = (s: StructureEdits, name: string | undefined): string | undefined =>
  name ? (s.renames[name] ?? name) : undefined;

const toPerson = (a: AddedPerson, s: StructureEdits): Person => ({
  name: resolveName(s, a.name) ?? a.name,
  gender: a.gender,
  relation: a.relation,
  photo: null,
});

const renamedPerson = (p: Person, s: StructureEdits): Person => ({
  ...p,
  name: resolveName(s, p.name) ?? p.name,
});

/** A direct spouse, plus THEIR OWN additional spouses (one level of step-nesting). */
export interface SpouseSlot {
  person: Person;
  subSpouses: Person[];
}

export interface EffectiveNode {
  person: Person;
  spouseSlots: SpouseSlot[];
  children: EffectiveNode[];
  parentA?: string;
  parentB?: string;
}

/** Find a person's native spouse list by searching the ORIGINAL tree (empty if they never appear as a primary there). */
function nativeSpousesOf(root: FamilyNode, name: string): Person[] {
  let found: Person[] | undefined;
  const walk = (n: FamilyNode) => {
    if (found) return;
    if (n.person.name === name) {
      found = n.spouses ?? [];
      return;
    }
    (n.children ?? []).forEach(walk);
  };
  walk(root);
  return found ?? [];
}

function directSpousesOf(
  root: FamilyNode,
  name: string,
  isKnownPrimary: boolean,
  s: StructureEdits,
  removed: Set<string>,
): Person[] {
  const native = isKnownPrimary ? nativeSpousesOf(root, name) : [];
  const resolved = resolveName(s, name);
  const added = [...(s.spouseOf[name] ?? []), ...(resolved && resolved !== name ? (s.spouseOf[resolved] ?? []) : [])]
    .map((p) => toPerson(p, s));
  return [...native.map((p) => renamedPerson(p, s)), ...added].filter(
    (p) => !removed.has(p.name) && !removed.has(name),
  );
}

/** How many spouses a person currently has (native + added, minus removed) — used for button labels. */
export function totalSpouseCount(root: FamilyNode, name: string, s: StructureEdits): number {
  const removed = new Set(s.removed);
  return directSpousesOf(root, name, true, s, removed).length;
}

/** Produce the effective family tree (with SpouseSlots) with all structural edits applied. */
export function buildEffectiveFamily(root: FamilyNode, s: StructureEdits, overrides: Overrides = {}): EffectiveNode {
  const removed = new Set(s.removed);
  const childOrderOf = (name: string | undefined): number | null => {
    if (!name) return null;
    const resolved = resolveName(s, name) ?? name;
    const n = overrides[name]?.birthOrder ?? overrides[resolved]?.birthOrder;
    return n !== undefined && Number.isFinite(n) && n > 0 ? Math.trunc(n) : null;
  };

  const sortChildren = <T extends { node: EffectiveNode; name: string; index: number }>(items: T[]): EffectiveNode[] =>
    [...items]
      .sort((a, b) => {
        const ao = childOrderOf(a.name);
        const bo = childOrderOf(b.name);
        if (ao !== null && bo !== null && ao !== bo) return ao - bo;
        if (ao !== null && bo === null) return -1;
        if (ao === null && bo !== null) return 1;
        return a.index - b.index;
      })
      .map((item) => item.node);

  const buildSlots = (primaryName: string, isPrimary: boolean): SpouseSlot[] =>
    directSpousesOf(root, primaryName, isPrimary, s, removed).map((sp) => ({
      person: sp,
      subSpouses: directSpousesOf(root, sp.name, false, s, removed),
    }));

  const walk = (node: FamilyNode, isPrimary: boolean, parentA?: string, parentB?: string): EffectiveNode => {
    const rawPrimary = node.person;
    const primary = renamedPerson(rawPrimary, s);
    const spouseSlots = buildSlots(rawPrimary.name, isPrimary);
    const firstSpouseName = spouseSlots[0]?.person.name;

    // Existing (native) children: default pairing is [this primary, this
    // primary's first spouse] unless the legacy `parentSpouseName` tag says
    // otherwise (kept for any hand-authored half/step data in family.ts).
    const existing = (node.children ?? [])
      .filter((c) => !removed.has(c.person.name) && !removed.has(resolveName(s, c.person.name) ?? c.person.name))
      .map((c, index) => ({
        name: c.person.name,
        index,
        node: walk(
            c,
            true,
            resolveName(s, rawPrimary.name),
            resolveName(s, c.parentSpouseName) ?? firstSpouseName,
          ),
      }));

    const rawAdded = [
      ...(s.childrenOf[rawPrimary.name] ?? []),
      ...(primary.name !== rawPrimary.name ? (s.childrenOf[primary.name] ?? []) : []),
    ];
    const added = rawAdded
      .filter((a) => !removed.has(a.person.name) && !removed.has(resolveName(s, a.person.name) ?? a.person.name))
      .map((a, index) => ({
        name: a.person.name,
        index: existing.length + index,
        node: walk(
            { person: toPerson(a.person, s), spouses: a.spouse ? [toPerson(a.spouse, s)] : undefined },
            true,
            resolveName(s, a.parentA) ?? primary.name,
            resolveName(s, a.parentB) ?? firstSpouseName,
          ),
      }));

    return { person: primary, spouseSlots, children: sortChildren([...existing, ...added]), parentA, parentB };
  };

  // Grow the tree UPWARD: wrap the root with any parent added above it
  // (a spouse for that new ancestor is then filled in normally by `walk`,
  // via the same spouseOf mechanism as everyone else).
  let raw = root;
  const seen = new Set<string>([root.person.name]);
  for (
    let p = s.parentsOf[raw.person.name] ?? s.parentsOf[resolveName(s, raw.person.name) ?? ""];
    p && !seen.has(p.name) && !removed.has(p.name) && !removed.has(resolveName(s, p.name) ?? p.name);
    p = s.parentsOf[raw.person.name] ?? s.parentsOf[resolveName(s, raw.person.name) ?? ""]
  ) {
    seen.add(p.name);
    raw = { person: { name: p.name, gender: p.gender, photo: null }, children: [raw] };
  }

  return walk(raw, true);
}

/** All person names currently present (for uniqueness checks). */
export function collectNames(root: EffectiveNode): Set<string> {
  const set = new Set<string>();
  const w = (n: EffectiveNode) => {
    set.add(n.person.name);
    n.spouseSlots.forEach((slot) => {
      set.add(slot.person.name);
      slot.subSpouses.forEach((ss) => set.add(ss.name));
    });
    n.children.forEach(w);
  };
  w(root);
  return set;
}
