import { useEffect, useRef, useState } from "react";
import { Avatar } from "./Avatar";
import { GEN_LABEL, type Gender, type Person, type PersonRelation } from "../data/family";
import type { PersonEntry } from "../lib/layout";
import type { Overrides, PersonOverride } from "../lib/store";
import type { AddedChild, AddedPerson } from "../lib/structure";
import { fileToScaledDataURL, savePhotoFile } from "../lib/image";
import type { TLinkScope } from "../lib/backend";

interface Props {
  entry: PersonEntry | null;
  overrides: Overrides;
  editMode: boolean;
  existingNames: Set<string>;
  byName: Record<string, PersonEntry>;
  onClose: () => void;
  onSelect: (name: string) => void;
  onSave: (name: string, patch: PersonOverride) => void;
  onReset: (name: string) => void;
  onAddChild: (unionPrimaryName: string, child: AddedChild) => void;
  onAddSpouse: (personName: string, sp: AddedPerson) => void;
  onRemovePerson: (name: string) => void;
  onAddParentAbove: (childName: string, parent: AddedPerson) => void;
  onShowBranch?: (name: string) => void;
  treeId?: string;
  onConnectTLink?: (localPersonId: string, tlinkId: string, scope: TLinkScope) => Promise<void> | void;
}

/** Merge base person fields with any runtime override. */
function effective(person: Person, ov: PersonOverride | undefined) {
  return {
    name: ov?.name ?? person.name,
    gender: (ov?.gender ?? person.gender) as Gender,
    birthOrder: ov?.birthOrder,
    photoFile: ov?.photoFile,
    photoData: ov?.photoData,
    photoStoragePath: ov?.photoStoragePath,
    photoX: ov?.photoX ?? 50,
    photoY: ov?.photoY ?? 50,
    photoZoom: ov?.photoZoom ?? 1,
    dob: ov?.dob ?? person.dob ?? "",
    birthplace: ov?.birthplace ?? person.birthplace ?? "",
    occupation: ov?.occupation ?? person.occupation ?? "",
    notes: ov?.notes ?? person.notes ?? "",
  };
}

function RelRow({
  people,
  overrides,
  onSelect,
  empty,
}: {
  people: Person[];
  overrides: Overrides;
  onSelect: (n: string) => void;
  empty: string;
}) {
  if (!people.length) return <div className="empty">{empty}</div>;
  return (
    <div className="relrow">
      {people.map((p) => {
        const eff = effective(p, overrides[p.name]);
        return (
          <button
            key={p.name}
            className={"reltag" + (eff.gender === "f" ? " f" : "")}
            onClick={() => onSelect(p.name)}
          >
            {eff.name}
          </button>
        );
      })}
    </div>
  );
}

/* ---------------- Developer edit form ---------------- */
function EditForm({
  entry,
  ov,
  onSave,
  onReset,
  treeId,
}: {
  entry: PersonEntry;
  ov: PersonOverride | undefined;
  onSave: (name: string, patch: PersonOverride) => void;
  onReset: (name: string) => void;
  treeId?: string;
}) {
  const eff = effective(entry.person, ov);
  const [form, setForm] = useState<PersonOverride>({});
  const [busy, setBusy] = useState(false);
  const [savedPhotoFile, setSavedPhotoFile] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Reset the form whenever a different person is opened.
  useEffect(() => {
    setForm({
      name: ov?.name ?? entry.person.name,
      photoFile: ov?.photoFile,
      photoData: ov?.photoData,
      photoStoragePath: ov?.photoStoragePath,
      photoX: eff.photoX,
      photoY: eff.photoY,
      photoZoom: eff.photoZoom,
      gender: eff.gender,
      birthOrder: eff.birthOrder,
      dob: eff.dob,
      birthplace: eff.birthplace,
      occupation: eff.occupation,
      notes: eff.notes,
    });
    setSavedPhotoFile(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry.person.name]);

  const setText = (k: "name" | "dob" | "birthplace" | "occupation" | "notes", v: string) =>
    setForm((f) => ({ ...f, [k]: v }));
  const setNum = (k: "photoX" | "photoY" | "photoZoom", v: number) =>
    setForm((f) => ({ ...f, [k]: v }));
  const setBirthOrder = (v: string) =>
    setForm((f) => ({ ...f, birthOrder: v ? Math.max(1, Math.trunc(Number(v))) : undefined }));

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    try {
      const data = await fileToScaledDataURL(file);
      const photoName = (form.name || entry.person.name).trim();
      const saved = await savePhotoFile(photoName, data, treeId);
      setSavedPhotoFile(saved.ok && saved.fileName ? saved.fileName : null);
      setForm((f) => ({
        ...f,
        photoFile: saved.ok ? saved.fileName : f.photoFile,
        photoData: saved.ok ? undefined : data,
        photoStoragePath: saved.storagePath ?? f.photoStoragePath,
      }));
    } catch (error) {
      alert(error instanceof Error ? error.message : "Could not read that image.");
    } finally {
      setBusy(false);
    }
  };

  const submit = () => {
    const next = { ...form, name: form.name?.trim() };
    if (!next.name || next.name === entry.person.name) delete next.name;
    if (savedPhotoFile) {
      next.photoFile = savedPhotoFile;
      delete next.photoData;
    }
    if (next.photoX === 50) delete next.photoX;
    if (next.photoY === 50) delete next.photoY;
    if (next.photoZoom === 1) delete next.photoZoom;
    if (next.birthOrder !== undefined && (!Number.isFinite(next.birthOrder) || next.birthOrder <= 0)) {
      delete next.birthOrder;
    }
    onSave(entry.person.name, next);
  };

  const previewPerson = {
    ...entry.person,
    name: form.name || entry.person.name,
    gender: (form.gender ?? eff.gender) as Gender,
  };

  return (
    <details className="editform" open>
      <summary className="edit-hd">Developer · Edit Card</summary>

      <label className="field">
        <span>Name</span>
        <input
          value={form.name ?? ""}
          onChange={(e) => setText("name", e.target.value)}
          placeholder={entry.person.name}
        />
      </label>

      <label className="field">
        <span>Photo</span>
        <div className="photo-edit">
          <div className="photo-thumb">
            <Avatar
              person={previewPerson}
              photoFile={form.photoFile ?? eff.photoFile}
              photoData={form.photoData ?? eff.photoData}
              photoStoragePath={form.photoStoragePath ?? eff.photoStoragePath}
              photoX={form.photoX ?? 50}
              photoY={form.photoY ?? 50}
              photoZoom={form.photoZoom ?? 1}
            />
          </div>
          <div className="photo-actions">
            <button className="btn" disabled={busy} onClick={() => fileRef.current?.click()}>
              {busy ? "Loading…" : form.photoData || form.photoFile ? "Replace" : "Upload"}
            </button>
            {(form.photoData || form.photoFile) && (
              <button
                className="btn ghost"
                onClick={() => {
                  setSavedPhotoFile(null);
                  setForm((f) => ({ ...f, photoFile: undefined, photoData: undefined }));
                }}
              >
                Remove
              </button>
            )}
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              hidden
              onChange={(e) => onFile(e.target.files?.[0])}
            />
          </div>
        </div>
      </label>

      <div className="crop-tools">
        <label className="range-field">
          <span>Horizontal</span>
          <input
            type="range"
            min="0"
            max="100"
            value={form.photoX ?? 50}
            onChange={(e) => setNum("photoX", Number(e.target.value))}
          />
        </label>
        <label className="range-field">
          <span>Vertical</span>
          <input
            type="range"
            min="0"
            max="100"
            value={form.photoY ?? 50}
            onChange={(e) => setNum("photoY", Number(e.target.value))}
          />
        </label>
        <label className="range-field">
          <span>Zoom</span>
          <input
            type="range"
            min="1"
            max="2"
            step="0.05"
            value={form.photoZoom ?? 1}
            onChange={(e) => setNum("photoZoom", Number(e.target.value))}
          />
        </label>
      </div>

      <label className="field">
        <span>Gender (node color)</span>
        <select
          value={form.gender ?? "m"}
          onChange={(e) => setForm((f) => ({ ...f, gender: e.target.value as Gender }))}
        >
          <option value="m">Male (cyan)</option>
          <option value="f">Female (magenta)</option>
        </select>
      </label>

      <label className="field">
        <span>Child order</span>
        <input
          type="number"
          min="1"
          value={form.birthOrder ?? ""}
          onChange={(e) => setBirthOrder(e.target.value)}
          placeholder="1 = eldest, 2 = second, 3 = third"
        />
      </label>

      <label className="field">
        <span>Born</span>
        <input
          value={form.dob ?? ""}
          onChange={(e) => setText("dob", e.target.value)}
          placeholder="e.g. 12 Aug 1958"
        />
      </label>

      <label className="field">
        <span>Birthplace</span>
        <input
          value={form.birthplace ?? ""}
          onChange={(e) => setText("birthplace", e.target.value)}
          placeholder="e.g. Cuttack, Odisha"
        />
      </label>

      <label className="field">
        <span>Occupation</span>
        <input
          value={form.occupation ?? ""}
          onChange={(e) => setText("occupation", e.target.value)}
          placeholder="e.g. Engineer"
        />
      </label>

      <label className="field">
        <span>Notes</span>
        <textarea
          value={form.notes ?? ""}
          onChange={(e) => setText("notes", e.target.value)}
          rows={3}
          placeholder="Anything worth remembering…"
        />
      </label>

      <div className="btnrow">
        <button className="btn primary" onClick={submit}>
          Save
        </button>
        <button className="btn ghost" onClick={() => onReset(entry.person.name)}>
          Reset
        </button>
      </div>
    </details>
  );
}

/* ---------------- Family structure editor (full relationship menu) ---------------- */

/** Word ordinals for small counts, numeric suffix beyond. `n` = position of the ONE BEING ADDED (n<=1 → ""). */
function ordinal(n: number): string {
  const words = ["", "", "Second", "Third", "Fourth", "Fifth", "Sixth", "Seventh", "Eighth", "Ninth", "Tenth"];
  if (n < words.length) return words[n];
  const suffix =
    n % 10 === 1 && n % 100 !== 11
      ? "st"
      : n % 10 === 2 && n % 100 !== 12
        ? "nd"
        : n % 10 === 3 && n % 100 !== 13
          ? "rd"
          : "th";
  return `${n}${suffix}`;
}

/** "Add Wife" (n=1) or "Add Second Wife" (n=2), etc. */
function ordinalLabel(prefix: string, n: number, suffix: string): string {
  const ord = ordinal(n);
  return ord ? `${prefix} ${ord} ${suffix}` : `${prefix} ${suffix}`;
}

type RelMode =
  | null
  | "child"
  | "inLaw"
  | "spouse"
  | "father"
  | "mother"
  | "brother"
  | "sister"
  | "stepBrother"
  | "stepSister";

interface RoleInfo {
  label: string;
  gender: Gender;
  /** "wrap" grows the tree upward; "extend" adds a spouse to `targetName`. */
  action: "wrap" | "extend";
  targetName?: string;
}

interface StepOption {
  key: string;
  label: string;
  parentA: string;
  parentB?: string;
  needsNewName?: "father-side" | "mother-side";
}

function FamilyEditor({
  entry,
  overrides,
  existingNames,
  byName,
  onAddChild,
  onAddSpouse,
  onSave,
  onAddParentAbove,
  onRemovePerson,
}: {
  entry: PersonEntry;
  overrides: Overrides;
  existingNames: Set<string>;
  byName: Record<string, PersonEntry>;
  onAddChild: (unionPrimaryName: string, child: AddedChild) => void;
  onAddSpouse: (personName: string, sp: AddedPerson) => void;
  onSave: (name: string, patch: PersonOverride) => void;
  onAddParentAbove: (childName: string, parent: AddedPerson) => void;
  onRemovePerson: (name: string) => void;
}) {
  const [mode, setMode] = useState<RelMode>(null);
  const [name, setName] = useState("");
  const [cGen, setCGen] = useState<Gender>("m");
  const [childRelation, setChildRelation] = useState<PersonRelation>("son");
  const [childOrder, setChildOrder] = useState("");
  const [inLawRelation, setInLawRelation] = useState<PersonRelation>("son-in-law");
  const [inLawTarget, setInLawTarget] = useState("");
  const [withSpouse, setWithSpouse] = useState(false);
  const [sName, setSName] = useState("");
  const [sGen, setSGen] = useState<Gender>("f");
  const [otherParent, setOtherParent] = useState(""); // when this person has multiple spouses
  const [stepKey, setStepKey] = useState("");
  const [stepNewName, setStepNewName] = useState("");
  const [newParentName, setNewParentName] = useState(""); // shared parent, when adding a sibling to a parentless root
  const [newParentGen, setNewParentGen] = useState<Gender>("m");

  const person = entry.person;
  const personName = effective(person, overrides[person.name]).name;
  const showName = (p: Person | undefined) => (p ? effective(p, overrides[p.name]).name : "");
  const unionPrimaryName = entry.union.cards[0].person.name; // the storage bucket for this whole union's children
  const isPrimary = unionPrimaryName === person.name;
  const isRoot = entry.gen === 0;
  const canRemove = !(isRoot && isPrimary);

  const father = entry.parents.find((p) => p.gender === "m");
  const mother = entry.parents.find((p) => p.gender === "f");

  // Only blood-line members (the union's primary) can manage parents/siblings —
  // an in-law "married in" with no recorded parents has no lineage to extend.
  // A resolved mother/father always already has >=1 spouse recorded (themselves),
  // so once known, Father/Mother-role additions are inherently "step" ones.
  const fatherInfo: RoleInfo | null = !isPrimary
    ? null
    : mother
      ? {
          label: ordinalLabel("Add", byName[mother.name]?.spouses.length ?? 1, "Step-Father"),
          gender: "m",
          action: "extend",
          targetName: mother.name,
        }
      : entry.parents.length === 0 && isRoot
        ? { label: "Add Father", gender: "m", action: "wrap" }
        : null;

  const motherInfo: RoleInfo | null = !isPrimary
    ? null
    : father
      ? (() => {
          const wifeCount = byName[father.name]?.spouses.length ?? 0;
          return wifeCount === 0
            ? { label: "Add Mother", gender: "f" as Gender, action: "extend" as const, targetName: father.name }
            : { label: ordinalLabel("Add", wifeCount, "Step-Mother"), gender: "f" as Gender, action: "extend" as const, targetName: father.name };
        })()
      : entry.parents.length === 0 && isRoot
        ? { label: "Add Mother", gender: "f", action: "wrap" }
        : null;

  // Root (no parents yet) can still get a sibling — the form creates the
  // shared parent inline (same upward-wrap the tree already uses for Father/Mother).
  const canSibling = isPrimary && (entry.parents.length > 0 || isRoot);
  const needsNewSharedParent = entry.parents.length === 0;

  const stepOptions: StepOption[] = [];
  if (isPrimary) {
    if (father) {
      const wives = byName[father.name]?.spouses ?? [];
      wives
        .filter((w) => w.name !== mother?.name)
        .forEach((w) =>
          stepOptions.push({
            key: `f:${w.name}`,
            label: `Father's other wife — ${showName(w)}`,
            parentA: father.name,
            parentB: w.name,
          }),
        );
      stepOptions.push({
        key: "f:new",
        label: "Create a new Step-Mother…",
        parentA: father.name,
        needsNewName: "mother-side",
      });
    }
    if (mother) {
      const husbands = byName[mother.name]?.spouses ?? [];
      husbands
        .filter((h) => h.name !== father?.name)
        .forEach((h) =>
          stepOptions.push({
            key: `m:${h.name}`,
            label: `Mother's other husband — ${showName(h)}`,
            parentA: mother.name,
            parentB: h.name,
          }),
        );
      stepOptions.push({
        key: "m:new",
        label: "Create a new Step-Father…",
        parentA: mother.name,
        needsNewName: "father-side",
      });
    }
  }
  const canStepSibling = stepOptions.length > 0;

  const wifeNoun = person.gender === "m" ? "Wife" : "Husband";
  const wifeLabel = ordinalLabel("Add", entry.spouses.length + 1, wifeNoun);
  const childOptions = entry.children;

  const taken = (n: string) => existingNames.has(n.trim());
  const reset = () => {
    setMode(null);
    setName("");
    setCGen("m");
    setChildRelation("son");
    setChildOrder("");
    setInLawRelation("son-in-law");
    setInLawTarget("");
    setWithSpouse(false);
    setSName("");
    setSGen("f");
    setOtherParent(entry.spouses[0]?.name ?? "");
    setStepKey(stepOptions[0]?.key ?? "");
    setStepNewName("");
    setNewParentName("");
    setNewParentGen("m");
  };

  const submitRel = () => {
    const n = name.trim();
    if (!n) return alert("Enter a name.");
    if (taken(n)) return alert(`"${n}" already exists — names must be unique.`);

    if (mode === "spouse") {
      onAddSpouse(person.name, { name: n, gender: person.gender === "m" ? "f" : "m" });
    } else if (mode === "brother" || mode === "sister") {
      const gender = mode === "brother" ? "m" : "f";
      if (needsNewSharedParent) {
        // No parent recorded yet (this person is the current root) — create
        // the shared parent inline, then attach the sibling under them.
        const pName = newParentName.trim();
        if (!pName) return alert("Enter the shared parent's name.");
        if (pName === n || taken(pName)) return alert(`"${pName}" already exists — names must be unique.`);
        onAddParentAbove(person.name, { name: pName, gender: newParentGen });
        onAddChild(pName, { person: { name: n, gender }, parentA: pName });
      } else {
        const parentA = entry.parents[0]?.name;
        const parentB = entry.parents[1]?.name;
        if (!parentA || !entry.parentUnionPrimary)
          return alert("This person has no recorded parents to share.");
        // Bucket under the PARENT union's own primary (not this person's own
        // union) so the sibling attaches as a peer of this person, not a child.
        onAddChild(entry.parentUnionPrimary, { person: { name: n, gender }, parentA, parentB });
      }
    } else if (mode === "father" && fatherInfo) {
      if (fatherInfo.action === "wrap") onAddParentAbove(person.name, { name: n, gender: "m" });
      else if (fatherInfo.targetName) onAddSpouse(fatherInfo.targetName, { name: n, gender: "m" });
    } else if (mode === "mother" && motherInfo) {
      if (motherInfo.action === "wrap") onAddParentAbove(person.name, { name: n, gender: "f" });
      else if (motherInfo.targetName) onAddSpouse(motherInfo.targetName, { name: n, gender: "f" });
    }
    reset();
  };

  const submitStepSibling = () => {
    const n = name.trim();
    if (!n) return alert("Enter the step-sibling's name.");
    if (taken(n)) return alert(`"${n}" already exists — names must be unique.`);
    const opt = stepOptions.find((o) => o.key === stepKey) ?? stepOptions[0];
    if (!opt) return;
    let parentB = opt.parentB;
    if (opt.needsNewName) {
      const newName = stepNewName.trim();
      if (!newName) return alert("Enter the new step-parent's name.");
      if (newName === n || taken(newName))
        return alert(`"${newName}" already exists — names must be unique.`);
      onAddSpouse(opt.parentA, { name: newName, gender: opt.needsNewName === "mother-side" ? "f" : "m" });
      parentB = newName;
    }
    if (!entry.parentUnionPrimary) return;
    // Same bucket rule as full siblings: store under the parent union's own
    // primary (a "mother" card is never itself a primary in this tree).
    onAddChild(entry.parentUnionPrimary, {
      person: { name: n, gender: cGen },
      parentA: opt.parentA,
      parentB,
    });
    reset();
  };

  const submitChild = () => {
    const n = name.trim();
    if (!n) return alert("Enter a name for the child.");
    if (taken(n)) return alert(`"${n}" already exists — names must be unique.`);
    const relation = childRelation === "daughter" ? "daughter" : "son";
    const gender: Gender = relation === "daughter" ? "f" : "m";
    let spouse: AddedPerson | undefined;
    if (withSpouse) {
      const sn = sName.trim();
      if (!sn) return alert("Enter the spouse's name (or uncheck spouse).");
      if (sn === n || taken(sn)) return alert(`"${sn}" already exists — names must be unique.`);
      spouse = {
        name: sn,
        gender: sGen,
        relation: sGen === "m" ? "son-in-law" : "daughter-in-law",
      };
    }
    const parentB =
      entry.spouses.length > 1 ? otherParent || undefined : entry.spouses[0]?.name;
    onAddChild(unionPrimaryName, {
      person: { name: n, gender, relation },
      spouse,
      parentA: person.name,
      parentB,
    });
    const order = childOrder.trim() ? Math.max(1, Math.trunc(Number(childOrder))) : undefined;
    if (order && Number.isFinite(order)) onSave(n, { birthOrder: order });
    reset();
  };

  const submitInLaw = () => {
    const n = name.trim();
    if (!n) return alert("Enter a name.");
    if (taken(n)) return alert(`"${n}" already exists — names must be unique.`);
    const target = inLawTarget || childOptions[0]?.name;
    if (!target) return alert("Add a son or daughter first, then attach their in-law.");
    const relation = inLawRelation === "daughter-in-law" ? "daughter-in-law" : "son-in-law";
    onAddSpouse(target, {
      name: n,
      gender: relation === "daughter-in-law" ? "f" : "m",
      relation,
    });
    reset();
  };

  const confirmRemove = () => {
    const msg = entry.children.length
      ? `Remove "${personName}" AND their ${entry.children.length} descendant line(s)?`
      : `Remove "${personName}"?`;
    if (window.confirm(msg)) onRemovePerson(person.name);
  };

  return (
    <details className="editform famedit" open>
      <summary className="edit-hd">Family · Add Relative</summary>

      {mode === null && (
        <div className="btnrow relbtns">
          {fatherInfo && (
            <button className="btn" onClick={() => setMode("father")}>
              ＋ {fatherInfo.label.replace("Add ", "")}
            </button>
          )}
          {motherInfo && (
            <button className="btn" onClick={() => setMode("mother")}>
              ＋ {motherInfo.label.replace("Add ", "")}
            </button>
          )}
          {canSibling && (
            <button className="btn" onClick={() => setMode("brother")}>
              ＋ Brother
            </button>
          )}
          {canSibling && (
            <button className="btn" onClick={() => setMode("sister")}>
              ＋ Sister
            </button>
          )}
          {canStepSibling && (
            <button
              className="btn"
              onClick={() => {
                setStepKey(stepOptions[0]?.key ?? "");
                setMode("stepBrother");
              }}
            >
              ＋ Step-Brother
            </button>
          )}
          {canStepSibling && (
            <button
              className="btn"
              onClick={() => {
                setStepKey(stepOptions[0]?.key ?? "");
                setMode("stepSister");
              }}
            >
              ＋ Step-Sister
            </button>
          )}
          <button className="btn" onClick={() => setMode("spouse")}>
            ＋ {wifeLabel.replace("Add ", "")}
          </button>
          <button
            className="btn"
            onClick={() => {
              setOtherParent(entry.spouses[0]?.name ?? "");
              setChildRelation("son");
              setSGen("f");
              setMode("child");
            }}
          >
            ＋ Son
          </button>
          <button
            className="btn"
            onClick={() => {
              setOtherParent(entry.spouses[0]?.name ?? "");
              setChildRelation("daughter");
              setSGen("m");
              setMode("child");
            }}
          >
            ＋ Daughter
          </button>
          <button
            className="btn"
            disabled={childOptions.length === 0}
            onClick={() => {
              setInLawRelation("son-in-law");
              setInLawTarget(childOptions[0]?.name ?? "");
              setMode("inLaw");
            }}
          >
            ＋ Son-in-law
          </button>
          <button
            className="btn"
            disabled={childOptions.length === 0}
            onClick={() => {
              setInLawRelation("daughter-in-law");
              setInLawTarget(childOptions[0]?.name ?? "");
              setMode("inLaw");
            }}
          >
            ＋ Daughter-in-law
          </button>
          {canRemove && (
            <button className="btn ghost danger" onClick={confirmRemove}>
              🗑 Remove
            </button>
          )}
        </div>
      )}

      {(mode === "father" || mode === "mother" || mode === "brother" || mode === "sister" || mode === "spouse") && (
        <div className="miniform">
          {(mode === "brother" || mode === "sister") && needsNewSharedParent && (
            <>
              <label className="field">
                <span>Shared parent's name</span>
                <input value={newParentName} onChange={(e) => setNewParentName(e.target.value)} autoFocus />
              </label>
              <label className="field">
                <span>Shared parent's gender</span>
                <select value={newParentGen} onChange={(e) => setNewParentGen(e.target.value as Gender)}>
                  <option value="m">Male (cyan)</option>
                  <option value="f">Female (magenta)</option>
                </select>
              </label>
            </>
          )}
          <label className="field">
            <span>{mode === "brother" || mode === "sister" ? "Sibling's name" : "Name"}</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus={!(mode === "brother" || mode === "sister") || !needsNewSharedParent}
            />
          </label>
          <div className="btnrow">
            <button className="btn primary" onClick={submitRel}>
              Add
            </button>
            <button className="btn ghost" onClick={reset}>
              Cancel
            </button>
          </div>
          <div className="famhint">
            {mode === "father" && fatherInfo?.action === "wrap" && "Grows the tree upward as a new top ancestor."}
            {mode === "father" && fatherInfo?.action === "extend" && `Added as another husband of ${fatherInfo.targetName}.`}
            {mode === "mother" && motherInfo?.action === "wrap" && "Grows the tree upward as a new top ancestor."}
            {mode === "mother" && motherInfo?.action === "extend" && `Added as another wife of ${motherInfo.targetName}.`}
            {(mode === "brother" || mode === "sister") &&
              (needsNewSharedParent
                ? "Creates the shared parent above, then adds this sibling under them."
                : `Added as a child of ${entry.parents.map((p) => showName(p)).join(" & ")}.`)}
            {mode === "spouse" && `Added beside ${personName}.`}
          </div>
        </div>
      )}

      {(mode === "stepBrother" || mode === "stepSister") && (
        <div className="miniform">
          <label className="field">
            <span>Via</span>
            <select value={stepKey} onChange={(e) => setStepKey(e.target.value)}>
              {stepOptions.map((o) => (
                <option key={o.key} value={o.key}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          {stepOptions.find((o) => o.key === stepKey)?.needsNewName && (
            <label className="field">
              <span>New step-parent's name</span>
              <input value={stepNewName} onChange={(e) => setStepNewName(e.target.value)} />
            </label>
          )}
          <label className="field">
            <span>{mode === "stepBrother" ? "Step-brother" : "Step-sister"} name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <div className="btnrow">
            <button
              className="btn primary"
              onClick={() => {
                setCGen(mode === "stepBrother" ? "m" : "f");
                submitStepSibling();
              }}
            >
              Add
            </button>
            <button className="btn ghost" onClick={reset}>
              Cancel
            </button>
          </div>
          <div className="famhint">Shares exactly one parent with {personName} via a remarriage.</div>
        </div>
      )}

      {mode === "inLaw" && (
        <div className="miniform">
          <label className="field">
            <span>Relationship</span>
            <select
              value={inLawRelation}
              onChange={(e) => setInLawRelation(e.target.value as PersonRelation)}
            >
              <option value="son-in-law">Son-in-law</option>
              <option value="daughter-in-law">Daughter-in-law</option>
            </select>
          </label>
          <label className="field">
            <span>Married to</span>
            <select value={inLawTarget} onChange={(e) => setInLawTarget(e.target.value)}>
              {childOptions.map((child) => (
                <option key={child.name} value={child.name}>
                  {showName(child)}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </label>
          <div className="btnrow">
            <button className="btn primary" onClick={submitInLaw}>
              Add
            </button>
            <button className="btn ghost" onClick={reset}>
              Cancel
            </button>
          </div>
          <div className="famhint">Adds as an in-law card beside the selected child.</div>
        </div>
      )}

      {mode === "child" && (
        <div className="miniform">
          <label className="field">
            <span>Relationship</span>
            <select
              value={childRelation}
              onChange={(e) => {
                const relation = e.target.value as PersonRelation;
                setChildRelation(relation);
                setSGen(relation === "daughter" ? "m" : "f");
              }}
            >
              <option value="son">Son</option>
              <option value="daughter">Daughter</option>
            </select>
          </label>
          <label className="field">
            <span>{childRelation === "daughter" ? "Daughter" : "Son"} name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </label>
          <label className="field">
            <span>Child order</span>
            <input
              type="number"
              min="1"
              value={childOrder}
              onChange={(e) => setChildOrder(e.target.value)}
              placeholder="1 = eldest, 2 = second, 3 = third"
            />
          </label>
          {entry.spouses.length > 1 && (
            <label className="field">
              <span>Other parent</span>
              <select value={otherParent} onChange={(e) => setOtherParent(e.target.value)}>
                {entry.spouses.map((sp) => (
                  <option key={sp.name} value={sp.name}>
                    {showName(sp)}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="checkrow">
            <input
              type="checkbox"
              checked={withSpouse}
              onChange={(e) => setWithSpouse(e.target.checked)}
            />
            <span>Also add their {childRelation === "daughter" ? "son-in-law" : "daughter-in-law"}</span>
          </label>
          {withSpouse && (
            <>
              <label className="field">
                <span>{sGen === "m" ? "Son-in-law" : "Daughter-in-law"} name</span>
                <input value={sName} onChange={(e) => setSName(e.target.value)} />
              </label>
              <label className="field">
                <span>Spouse gender</span>
                <select value={sGen} onChange={(e) => setSGen(e.target.value as Gender)}>
                  <option value="f">Female (magenta)</option>
                  <option value="m">Male (cyan)</option>
                </select>
              </label>
            </>
          )}
          <div className="btnrow">
            <button className="btn primary" onClick={submitChild}>
              Add
            </button>
            <button className="btn ghost" onClick={reset}>
              Cancel
            </button>
          </div>
          <div className="famhint">
            Adds under {unionPrimaryName}. You can add a photo/details after.
          </div>
        </div>
      )}
    </details>
  );
}

/* ---------------- Panel ---------------- */
export function DetailPanel({
  entry,
  overrides,
  editMode,
  existingNames,
  byName,
  onClose,
  onSelect,
  onSave,
  onReset,
  onAddChild,
  onAddSpouse,
  onRemovePerson,
  onAddParentAbove,
  onShowBranch,
  treeId,
  onConnectTLink,
}: Props) {
  const open = !!entry;
  const ov = entry ? overrides[entry.person.name] : undefined;
  const eff = entry ? effective(entry.person, ov) : null;
  const [connectOpen, setConnectOpen] = useState(false);
  const [connectId, setConnectId] = useState("");
  const [connectScope, setConnectScope] = useState<TLinkScope>("identity");
  const [connectBusy, setConnectBusy] = useState(false);
  const [connectMessage, setConnectMessage] = useState("");

  useEffect(() => {
    setConnectOpen(false);
    setConnectId("");
    setConnectScope("identity");
    setConnectMessage("");
  }, [entry?.person.id]);

  const submitConnection = async () => {
    if (!entry?.person.id || !connectId.trim() || !onConnectTLink) return;
    setConnectBusy(true);
    setConnectMessage("");
    try {
      await onConnectTLink(entry.person.id, connectId.trim(), connectScope);
      setConnectId("");
      setConnectMessage("Connection request sent.");
    } catch (error) {
      setConnectMessage(error instanceof Error ? error.message : "Could not send the connection request.");
    } finally {
      setConnectBusy(false);
    }
  };

  const profile = eff
    ? [
        ["Family role", entry?.union.cards.find((card) => card.person.name === entry.person.name)?.relationLabel ?? ""],
        ["Child order", eff.birthOrder ? String(eff.birthOrder) : ""],
        ["Born", eff.dob],
        ["Birthplace", eff.birthplace],
        ["Occupation", eff.occupation],
      ].filter(([, v]) => v)
    : [];

  return (
    <div className={"panel" + (open ? " open" : "")}>
      {entry && onShowBranch && (
        <button
          className="branch-btn"
          onClick={() => onShowBranch(entry.person.name)}
          aria-label="Show Branch"
          title="Show Branch"
        >
          ⌁
        </button>
      )}
      <button className="close" onClick={onClose} aria-label="Close">
        ✕
      </button>
      {entry && eff && (
        <>
          <div className="p-photo">
            <Avatar
              person={{ ...entry.person, name: eff.name, gender: eff.gender }}
              photoFile={eff.photoFile}
              photoData={eff.photoData}
              photoStoragePath={eff.photoStoragePath}
              photoX={eff.photoX}
              photoY={eff.photoY}
              photoZoom={eff.photoZoom}
            />
          </div>
          <div className="p-name">{eff.name}</div>
          <div className="p-gen">{GEN_LABEL[entry.gen] ?? `Gen ${entry.gen + 1}`}</div>

          {editMode && onConnectTLink && entry.person.id && (
            <div className="sect tlink-profile-connect">
              <button type="button" className="btn" onClick={() => setConnectOpen((value) => !value)}>
                {connectOpen ? "Close TLink" : "Connect with TLink ID"}
              </button>
              {connectOpen && (
                <div className="tlink-profile-form">
                  <label className="field">
                    <span>Relative’s TLink ID</span>
                    <input value={connectId} onChange={(event) => setConnectId(event.target.value.toUpperCase())} placeholder="TLINK-…" />
                  </label>
                  <label className="field">
                    <span>Permission</span>
                    <select value={connectScope} onChange={(event) => setConnectScope(event.target.value as TLinkScope)}>
                      <option value="identity">Connect identity only</option>
                      <option value="branch">Share connected branch</option>
                      <option value="collaboration">Full tree collaboration</option>
                    </select>
                  </label>
                  <button type="button" className="btn primary" disabled={connectBusy || !connectId.trim()} onClick={() => void submitConnection()}>
                    {connectBusy ? "Sending…" : "Send request"}
                  </button>
                  {connectMessage && <div className="famhint">{connectMessage}</div>}
                </div>
              )}
            </div>
          )}

          {(profile.length > 0 || eff.notes) && (
            <div className="sect">
              <h4>Profile</h4>
              {profile.map(([k, v]) => (
                <div className="kv" key={k}>
                  <span className="k">{k}</span>
                  <span className="v">{v}</span>
                </div>
              ))}
              {eff.notes && <div className="note">{eff.notes}</div>}
            </div>
          )}

          <div className="sect">
            <h4>{entry.spouses.length > 1 ? "Spouses" : "Spouse"}</h4>
            <RelRow people={entry.spouses} overrides={overrides} onSelect={onSelect} empty="— none on record —" />
          </div>

          <div className="sect">
            <h4>Parents</h4>
            <RelRow people={entry.parents} overrides={overrides} onSelect={onSelect} empty="— root of lineage —" />
          </div>

          <div className="sect">
            <h4>Children</h4>
            <RelRow people={entry.children} overrides={overrides} onSelect={onSelect} empty="— none on record —" />
          </div>

          {editMode && (
            <>
              <FamilyEditor
                entry={entry}
                overrides={overrides}
                existingNames={existingNames}
                byName={byName}
                onAddChild={onAddChild}
                onAddSpouse={onAddSpouse}
                onSave={onSave}
                onAddParentAbove={onAddParentAbove}
                onRemovePerson={onRemovePerson}
              />
              <EditForm
                entry={entry}
                ov={ov}
                onSave={onSave}
                onReset={onReset}
                treeId={treeId}
              />
            </>
          )}
        </>
      )}
    </div>
  );
}
