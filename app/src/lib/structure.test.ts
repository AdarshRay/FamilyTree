import { describe, expect, it } from "vitest";
import type { FamilyNode } from "../data/family";
import { buildLayout, indexPeople } from "./layout";
import { buildEffectiveFamily, collectNames, emptyStructure } from "./structure";

const root: FamilyNode = {
  person: { name: "Founder", gender: "m", photo: null },
  spouses: [{ name: "Partner", gender: "f", photo: null }],
  children: [
    { person: { name: "Older", gender: "f", photo: null } },
    { person: { name: "Younger", gender: "m", photo: null } },
  ],
};

describe("effective family structure", () => {
  it("applies additions, removals, renames and birth order together", () => {
    const structure = emptyStructure();
    structure.renames.Founder = "Founder Renamed";
    structure.removed.push("Younger");
    structure.spouseOf.Older = [{ name: "Older Partner", gender: "m" }];
    structure.childrenOf.Founder = [{ person: { name: "Newest", gender: "f" } }];

    const effective = buildEffectiveFamily(root, structure, {
      Newest: { birthOrder: 1 },
      Older: { birthOrder: 2 },
    });

    expect(effective.person.name).toBe("Founder Renamed");
    expect(effective.children.map((child) => child.person.name)).toEqual(["Newest", "Older"]);
    expect(effective.children[1].spouseSlots[0].person.name).toBe("Older Partner");
    expect(collectNames(effective)).not.toContain("Younger");
  });

  it("grows ancestors above the original root without looping", () => {
    const structure = emptyStructure();
    structure.parentsOf.Founder = { name: "Ancestor", gender: "f" };
    structure.parentsOf.Ancestor = { name: "Founder", gender: "m" };
    const effective = buildEffectiveFamily(root, structure);
    expect(effective.person.name).toBe("Ancestor");
    expect(effective.children[0].person.name).toBe("Founder");
  });
});

describe("family layout and relationship index", () => {
  it("lays out every union and preserves precise parent/spouse relationships", () => {
    const effective = buildEffectiveFamily(root, emptyStructure());
    const layout = buildLayout(effective);
    const people = indexPeople(layout.nodes);
    const older = people.find((entry) => entry.person.name === "Older");
    const founder = people.find((entry) => entry.person.name === "Founder");

    expect(layout.nodes).toHaveLength(3);
    expect(layout.maxDepth).toBe(1);
    expect(layout.width).toBeGreaterThan(0);
    expect(older?.parents.map((person) => person.name)).toEqual(["Founder", "Partner"]);
    expect(founder?.spouses.map((person) => person.name)).toEqual(["Partner"]);
    expect(founder?.children.map((person) => person.name)).toEqual(["Older", "Younger"]);
  });
});
