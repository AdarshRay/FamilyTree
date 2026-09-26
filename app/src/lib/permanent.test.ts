import { describe, expect, it } from "vitest";
import { normalizeSnapshot, snapshotEditKey } from "./permanent";

describe("snapshotEditKey", () => {
  it("ignores a cloud revision acknowledgement when edits are unchanged", () => {
    const first = normalizeSnapshot({ overrides: { Adarsh: { notes: "one" } }, updatedAt: "2026-01-01" });
    const acknowledged = { ...first, updatedAt: "2026-01-02" };

    expect(snapshotEditKey(acknowledged)).toBe(snapshotEditKey(first));
  });

  it("detects the next real edit after a cloud acknowledgement", () => {
    const first = normalizeSnapshot({ overrides: { Adarsh: { notes: "one" } } });
    const next = normalizeSnapshot({ overrides: { Adarsh: { notes: "two" } } });

    expect(snapshotEditKey(next)).not.toBe(snapshotEditKey(first));
  });
});
