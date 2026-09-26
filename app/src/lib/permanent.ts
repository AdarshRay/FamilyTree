import rawPermanentEdits from "../data/permanent-edits.json";
import type { Overrides } from "./store";
import type { StructureEdits } from "./structure";

export interface FamilyEditsSnapshot {
  overrides: Overrides;
  structure: StructureEdits;
  updatedAt?: string;
}

function normalizeStructure(value: Partial<StructureEdits> | undefined): StructureEdits {
  return {
    childrenOf: value?.childrenOf ?? {},
    spouseOf: value?.spouseOf ?? {},
    parentsOf: value?.parentsOf ?? {},
    removed: value?.removed ?? [],
    renames: value?.renames ?? {},
  };
}

export function normalizeSnapshot(value: Partial<FamilyEditsSnapshot> | undefined): FamilyEditsSnapshot {
  return {
    overrides: value?.overrides ?? {},
    structure: normalizeStructure(value?.structure),
    updatedAt: value?.updatedAt,
  };
}

export const permanentEdits = normalizeSnapshot(rawPermanentEdits as Partial<FamilyEditsSnapshot>);

export function makeSnapshot(overrides: Overrides, structure: StructureEdits): FamilyEditsSnapshot {
  return {
    overrides,
    structure,
    updatedAt: new Date().toISOString(),
  };
}

/** A revision-independent key for deciding whether cloud edits actually changed. */
export function snapshotEditKey(snapshot: Pick<FamilyEditsSnapshot, "overrides" | "structure">): string {
  return JSON.stringify({ overrides: snapshot.overrides, structure: snapshot.structure });
}

export async function persistProjectEdits(snapshot: FamilyEditsSnapshot): Promise<boolean> {
  if (!import.meta.env.DEV) return false;

  const res = await fetch("/__family_tree_edits", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(snapshot),
  });

  if (res.status === 404) return false;
  if (!res.ok) throw new Error(`Could not save permanent edits (${res.status}).`);
  return true;
}
