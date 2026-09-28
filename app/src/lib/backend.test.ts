import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./supabase", () => ({ supabaseClient: () => null }));

import {
  createAccountWithPassword,
  createFamilyTree,
  deleteAccount,
  deleteFamilyTree,
  getAuthSession,
  listFamilyTrees,
} from "./backend";

class MemoryStorage implements Storage {
  private values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

describe("local backend destructive actions", () => {
  beforeEach(() => {
    vi.stubGlobal("window", { localStorage: new MemoryStorage() });
  });

  it("deletes an owned tree and its local invitations", async () => {
    const result = await createAccountWithPassword("owner@example.com", "password123", "Owner");
    const user = result.session!.user;
    const tree = await createFamilyTree(user.id, { name: "Test Tree" });
    expect(await listFamilyTrees(user.id)).toHaveLength(1);

    await deleteFamilyTree(tree.id);

    expect(await listFamilyTrees(user.id)).toHaveLength(0);
  });

  it("deletes the local account, session, and owned trees", async () => {
    const result = await createAccountWithPassword("owner@example.com", "password123", "Owner");
    await createFamilyTree(result.session!.user.id, { name: "Test Tree" });

    await deleteAccount();

    expect(await getAuthSession()).toBeNull();
  });
});
