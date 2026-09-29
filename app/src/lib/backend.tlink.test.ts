import { describe, expect, it } from "vitest";
import type { FamilyNode } from "../data/family";
import { emptyStructure } from "./structure";
import { buildTLinkBranches } from "./backend";

describe("TLink shared branches", () => {
  it("creates the same descendant branch for both people in a union", () => {
    const root: FamilyNode = {
      person: { id: "11111111-1111-4111-8111-111111111111", name: "A", gender: "m", photo: null },
      spouses: [{ id: "22222222-2222-4222-8222-222222222222", name: "B", gender: "f", photo: null }],
      children: [{ person: { id: "33333333-3333-4333-8333-333333333333", name: "C", gender: "f", photo: null } }],
    };
    const branches = buildTLinkBranches(root, {
      structure: emptyStructure(),
      overrides: { A: { occupation: "Teacher" } },
    });

    expect(branches[root.person.id!].person.occupation).toBe("Teacher");
    expect(branches[root.person.id!].children[0].person.name).toBe("C");
    expect(branches[root.spouses![0].id!].person.name).toBe("B");
    expect(branches[root.spouses![0].id!].children[0].person.name).toBe("C");
  });
});
