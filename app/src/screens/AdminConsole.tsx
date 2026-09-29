import { useEffect, useMemo, useState } from "react";
import { AmbientStage } from "../components/AmbientStage";
import {
  adminUpdateUserProfile,
  grantAdminByEmail,
  listAdminRoles,
  listAdminTrees,
  listAdminUsers,
  revokeAdmin,
  type AdminRole,
  type AdminRoleRecord,
  type AdminUserRecord,
  type FamilyTreeSummary,
} from "../lib/backend";

interface Props {
  role: AdminRole;
  onBack: () => void;
  onOpenTree: (treeId: string) => Promise<void> | void;
}

export function AdminConsole({ role, onBack, onOpenTree }: Props) {
  const [users, setUsers] = useState<AdminUserRecord[]>([]);
  const [trees, setTrees] = useState<FamilyTreeSummary[]>([]);
  const [admins, setAdmins] = useState<AdminRoleRecord[]>([]);
  const [query, setQuery] = useState("");
  const [adminEmail, setAdminEmail] = useState("");
  const [editingNames, setEditingNames] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const refresh = async () => {
    const [nextUsers, nextTrees, nextAdmins] = await Promise.all([
      listAdminUsers(), listAdminTrees(), listAdminRoles(),
    ]);
    setUsers(nextUsers);
    setTrees(nextTrees);
    setAdmins(nextAdmins);
  };

  useEffect(() => {
    void refresh().catch((err) => setError(err instanceof Error ? err.message : "Could not load the admin console."));
  }, []);

  const run = async (operation: () => Promise<void>, success: string) => {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await operation();
      await refresh();
      setMessage(success);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Administrator action failed.");
    } finally {
      setBusy(false);
    }
  };

  const filteredUsers = useMemo(() => {
    const term = query.trim().toLowerCase();
    return term ? users.filter((user) => `${user.displayName} ${user.email}`.toLowerCase().includes(term)) : users;
  }, [query, users]);
  const owner = (ownerId: string) => users.find((user) => user.userId === ownerId);

  return (
    <div className="app-shell dash-shell admin-console">
      <AmbientStage />
      <div className="topbar">
        <div className="topbar-left">
          <button className="settings-back-btn" onClick={onBack} aria-label="Back to dashboard">←</button>
          <div className="brand"><h1>ADMIN</h1><div className="sub">FamilyTree Control Console</div></div>
        </div>
        <div className="admin-role-badge">{role === "super_admin" ? "Root Super Admin" : "Administrator"}</div>
      </div>

      <div className="dash-body settings-body">
        {error && <div className="dash-error">{error}</div>}
        {message && <div className="tlink-message">{message}</div>}

        <section className="dash-section">
          <div className="dash-section-head"><div><div className="dash-eyebrow">Overview</div><h2>All FamilyTree Data</h2></div></div>
          <div className="admin-stats">
            <div><strong>{users.length}</strong><span>Users</span></div>
            <div><strong>{trees.length}</strong><span>Trees</span></div>
            <div><strong>{users.reduce((sum, user) => sum + user.photoCount, 0)}</strong><span>Photos</span></div>
            <div><strong>{admins.length}</strong><span>Admins</span></div>
          </div>
        </section>

        {role === "super_admin" && (
          <section className="dash-section">
            <div className="dash-section-head"><div><div className="dash-eyebrow">Protected access</div><h2>Administrators</h2></div></div>
            <div className="settings-card admin-access-card">
              <div className="admin-grant-row">
                <label className="field"><span>Login email address</span><input type="email" value={adminEmail} onChange={(event) => setAdminEmail(event.target.value)} placeholder="person@example.com" /></label>
                <button className="btn primary" disabled={busy || !adminEmail.trim()} onClick={() => void run(
                  () => grantAdminByEmail(adminEmail),
                  "Administrator access granted.",
                ).then(() => setAdminEmail(""))}>Add administrator</button>
              </div>
              <div className="admin-role-list">
                {admins.map((admin) => (
                  <div className="admin-role-row" key={admin.userId}>
                    <div><strong>{admin.displayName}</strong><span>{admin.email}</span></div>
                    <span className="admin-role-badge">{admin.isRoot ? "Root Super Admin" : "Admin"}</span>
                    {!admin.isRoot && <button className="danger" disabled={busy} onClick={() => void run(
                      () => revokeAdmin(admin.userId),
                      "Administrator access removed.",
                    )}>Remove access</button>}
                  </div>
                ))}
              </div>
            </div>
          </section>
        )}

        <section className="dash-section">
          <div className="dash-section-head"><div><div className="dash-eyebrow">Accounts</div><h2>Users</h2></div></div>
          <label className="field admin-search"><span>Search users</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Name or login email" /></label>
          <div className="admin-user-grid">
            {filteredUsers.map((user) => (
              <article className="settings-card admin-user-card" key={user.userId}>
                <div><strong>{user.displayName}</strong><span>{user.email}</span></div>
                <span>{user.treeCount} tree{user.treeCount === 1 ? "" : "s"} · {user.photoCount} photo{user.photoCount === 1 ? "" : "s"}</span>
                <div className="admin-inline-edit">
                  <input value={editingNames[user.userId] ?? user.displayName} onChange={(event) => setEditingNames((current) => ({ ...current, [user.userId]: event.target.value }))} aria-label={`Display name for ${user.email}`} />
                  <button disabled={busy || (editingNames[user.userId] ?? user.displayName).trim() === user.displayName} onClick={() => void run(
                    () => adminUpdateUserProfile(user.userId, editingNames[user.userId] ?? user.displayName),
                    "User profile updated.",
                  )}>Save</button>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="dash-section">
          <div className="dash-section-head"><div><div className="dash-eyebrow">Family records</div><h2>All Trees &amp; Photos</h2></div></div>
          <div className="admin-tree-list">
            {trees.map((tree) => (
              <article className="settings-card admin-tree-row" key={tree.id}>
                <div><strong>{tree.name}</strong><span>{owner(tree.ownerId)?.email ?? "Unknown owner"} · {tree.memberCount} members · {tree.generationCount} generations</span></div>
                <button className="btn primary" disabled={busy} onClick={() => void onOpenTree(tree.id)}>Open &amp; edit</button>
              </article>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
