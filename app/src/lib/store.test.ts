import { describe, expect, it } from "vitest";
import type { Person } from "../data/family";
import { cleanOverride, effectiveFields, isEmptyOverride } from "./store";

const person: Person = {
  name: "Original Name",
  gender: "m",
  photo: "original.jpg",
  dob: "1 Jan 1980",
  occupation: "Teacher",
};

describe("person field overrides", () => {
  it("removes defaults and invalid birth order from stored overrides", () => {
    expect(cleanOverride({ photoX: 50, photoY: 50, photoZoom: 1, birthOrder: -2 })).toEqual({});
    expect(isEmptyOverride({ photoX: 50 })).toBe(true);
  });

  it("merges profile fields and private photo paths without losing base values", () => {
    const fields = effectiveFields(person, {
      name: "Updated Name",
      photoStoragePath: "tree/person.jpg",
      birthplace: "Cuttack",
    });
    expect(fields).toMatchObject({
      name: "Updated Name",
      gender: "m",
      dob: "1 Jan 1980",
      occupation: "Teacher",
      birthplace: "Cuttack",
      photoStoragePath: "tree/person.jpg",
    });
  });
});
