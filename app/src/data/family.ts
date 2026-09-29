export type Gender = "m" | "f";
export type PersonRelation = "son" | "daughter" | "son-in-law" | "daughter-in-law";

export interface Person {
  /** Stable ID for this tree record. Connections map it to one canonical person. */
  id?: string;
  name: string;
  gender: Gender;
  relation?: PersonRelation;
  photo: string | null;
  dob?: string;
  birthplace?: string;
  occupation?: string;
  notes?: string;
}

export interface FamilyNode {
  person: Person;
  spouses?: Person[];
  children?: FamilyNode[];
  parentSpouseName?: string;
}

/** Local-only fallback. Authenticated trees always load from Supabase. */
export const FAMILY: FamilyNode = { person: { name: "New Founder", gender: "m", photo: null } };
export const PHOTO_DIR = `${import.meta.env.BASE_URL}photos`;
export const photoURL = (person: Person | null | undefined): string | null =>
  person?.photo ? encodeURI(`${PHOTO_DIR}/${person.photo}`) : null;
export const initials = (name: string): string =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map((word) => word[0]).join("").toUpperCase();
export const GEN_LABEL = ["Founders", "Second Generation", "Third Generation", "Fourth Generation"];
