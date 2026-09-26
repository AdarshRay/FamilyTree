/**
 * OVERRIDES STORE
 * ------------------------------------------------------------------
 * Runtime, developer-editable overrides for any person, keyed by name.
 * Persisted to localStorage so edits survive reloads. Uploaded photos
 * are stored as (downscaled) data URLs and take precedence over the
 * static file in public/photos.
 *
 * In the local dev app, saves are also written to src/data/permanent-edits.json
 * so future builds include them.
 */
import type { Gender, Person } from "../data/family";
import { permanentEdits } from "./permanent";

export interface PersonOverride {
  name?: string;
  /** File saved inside public/photos, usually "Person Name.jpg". */
  photoFile?: string;
  /** Uploaded, downscaled image as a data URL (overrides the file photo). */
  photoData?: string;
  /** Object path in the private Supabase `family-tree-photos` bucket. */
  photoStoragePath?: string;
  photoX?: number;
  photoY?: number;
  photoZoom?: number;
  gender?: Gender;
  birthOrder?: number;
  dob?: string;
  birthplace?: string;
  occupation?: string;
  notes?: string;
}

export type Overrides = Record<string, PersonOverride>;

const KEY = "rays-overrides-v1";

export function loadOverrides(): Overrides {
  try {
    const raw = localStorage.getItem(KEY);
    const saved = raw ? (JSON.parse(raw) as Overrides) : {};
    return { ...permanentEdits.overrides, ...saved };
  } catch {
    return permanentEdits.overrides;
  }
}

export function persistOverrides(o: Overrides): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(o));
  } catch {
    // localStorage full or unavailable — edits stay in memory for the session.
    console.warn("Could not persist overrides (storage full?). Consider Export JSON.");
  }
}

/** Remove empty-string / undefined fields so we don't store noise. */
export function cleanOverride(o: PersonOverride): PersonOverride {
  const out: PersonOverride = {};
  if (o.name) out.name = o.name;
  if (o.photoFile) out.photoFile = o.photoFile;
  if (o.photoData) out.photoData = o.photoData;
  if (o.photoStoragePath) out.photoStoragePath = o.photoStoragePath;
  if (o.photoX !== undefined && o.photoX !== 50) out.photoX = o.photoX;
  if (o.photoY !== undefined && o.photoY !== 50) out.photoY = o.photoY;
  if (o.photoZoom !== undefined && o.photoZoom !== 1) out.photoZoom = o.photoZoom;
  if (o.gender) out.gender = o.gender;
  if (o.birthOrder !== undefined && Number.isFinite(o.birthOrder) && o.birthOrder > 0) {
    out.birthOrder = Math.trunc(o.birthOrder);
  }
  if (o.dob) out.dob = o.dob;
  if (o.birthplace) out.birthplace = o.birthplace;
  if (o.occupation) out.occupation = o.occupation;
  if (o.notes) out.notes = o.notes;
  return out;
}

export const isEmptyOverride = (o: PersonOverride): boolean =>
  Object.keys(cleanOverride(o)).length === 0;

export interface EffectiveFields {
  name: string;
  gender: Gender;
  birthOrder?: number;
  photoFile?: string;
  photoData?: string;
  photoStoragePath?: string;
  photoX: number;
  photoY: number;
  photoZoom: number;
  dob: string;
  birthplace: string;
  occupation: string;
  notes: string;
}

/** Merge a person's base fields with any runtime override. */
export function effectiveFields(person: Person, ov: PersonOverride | undefined): EffectiveFields {
  return {
    name: ov?.name ?? person.name,
    gender: ov?.gender ?? person.gender,
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
