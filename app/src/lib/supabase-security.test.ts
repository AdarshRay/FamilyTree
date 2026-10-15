import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const migrationsDirectory = fileURLToPath(new URL("../../supabase/migrations/", import.meta.url));

function migration(name: string): string {
  return readFileSync(`${migrationsDirectory}${name}`, "utf8");
}

describe("Supabase privileged RPC security", () => {
  it("keeps admin RPCs behind server-side administrator checks", () => {
    const sql = migration("20260929084547_secure_admin_console.sql");

    expect(sql).toContain("if not private.current_user_is_admin() then");
    expect(sql).toContain("if not private.current_user_is_super_admin() then");
    expect(sql).toContain("revoke all on function public.admin_list_users() from public, anon;");
    expect(sql).toContain("revoke all on function public.admin_grant_by_email(text) from public, anon;");
  });

  it("requires an authenticated, authorized caller for tree and TLink mutations", () => {
    const sharing = migration("20260926075745_harden_rls_and_function_exposure.sql");
    const identity = migration("20260928221604_tlink_identity_connections.sql");
    const lifecycle = migration("20260929081414_tlink_live_branches_disconnect_history.sql");

    expect(sharing).toContain("if auth.uid() is null then");
    expect(sharing).toContain("Only the tree owner can manage sharing.");
    expect(identity).toContain("if sender_id is null then raise exception 'Sign in required.'; end if;");
    expect(identity).toContain("Only tree owners and editors can connect people.");
    expect(lifecycle).toContain("if (select auth.uid()) is null then raise exception 'Sign in required.'; end if;");
    expect(lifecycle).toContain("Only tree owners and editors can synchronize branches.");
  });

  it("does not grant privileged RPC execution to anonymous callers", () => {
    const sql = [
      migration("20260926075745_harden_rls_and_function_exposure.sql"),
      migration("20260928221604_tlink_identity_connections.sql"),
      migration("20260929074751_tlink_connection_lifecycle.sql"),
      migration("20260929081414_tlink_live_branches_disconnect_history.sql"),
      migration("20260929084547_secure_admin_console.sql"),
    ].join("\n");

    expect(sql).not.toMatch(/grant execute on function public\.[^(]+\([^;]*\) to anon;/i);
  });
});
