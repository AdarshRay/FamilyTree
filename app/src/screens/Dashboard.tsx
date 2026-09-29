import { useState } from "react";
import { AmbientStage } from "../components/AmbientStage";
import { AccountMenu } from "../components/AccountMenu";
import { TreeCard, NewTreeCard } from "../components/TreeCard";
import { CreateTreeModal, type NewTreeDetails } from "../components/CreateTreeModal";
import type { AccountUser, TreeSummary } from "../data/mockAccount";

interface Props {
  user: AccountUser;
  trees: TreeSummary[];
  busy?: boolean;
  error?: string;
  onOpenTree: (id: string) => void;
  onCreateTree: (details: NewTreeDetails) => void;
  onRenameTree?: (id: string, name: string) => void;
  onOpenSharing?: (id: string) => void;
  onOpenTreeSettings?: (id: string) => void;
  onOpenAccountSettings?: () => void;
  onOpenPublish?: () => void;
  onSignOut: () => void;
  pendingTLinkCount?: number;
}

export function Dashboard({
  user,
  trees,
  busy = false,
  error = "",
  onOpenTree,
  onCreateTree,
  onRenameTree,
  onOpenSharing,
  onOpenTreeSettings,
  onOpenAccountSettings,
  onOpenPublish,
  onSignOut,
  pendingTLinkCount = 0,
}: Props) {
  const [createOpen, setCreateOpen] = useState(false);
  const firstName = (user.name || user.email).split(/\s+/)[0] || "there";
  const ownedCount = trees.filter((tree) => tree.role === "owner").length;
  const sharedCount = trees.length - ownedCount;
  const totalMembers = trees.reduce((sum, tree) => sum + tree.memberCount, 0);
  const latestTree = trees[0];

  return (
    <div className="app-shell dash-shell">
      <AmbientStage />

      <div className="topbar">
        <div className="brand">
          <h1>FAMILY TREE</h1>
          <div className="sub">Your Family Trees</div>
        </div>
        <div className="topbar-right">
          <AccountMenu user={user} onOpenAccountSettings={onOpenAccountSettings} onSignOut={onSignOut} pendingTLinkCount={pendingTLinkCount} />
        </div>
      </div>

      <div className="dash-body">
        <section className="dash-hero">
          <div className="dash-intro">
            <div className="dash-eyebrow">Family workspace</div>
            <h2>Good to see you, {firstName}</h2>
            <p>
              {latestTree
                ? `${latestTree.name} was ${latestTree.updatedLabel.toLowerCase()}.`
                : "Create your first family tree and start building the lineage."}
            </p>
          </div>

          <div className="dash-stats" aria-label="Family tree summary">
            <div className="dash-stat">
              <span>{trees.length}</span>
              <em>Tree{trees.length === 1 ? "" : "s"}</em>
            </div>
            <div className="dash-stat">
              <span>{totalMembers}</span>
              <em>Member{totalMembers === 1 ? "" : "s"}</em>
            </div>
            <div className="dash-stat">
              <span>{sharedCount}</span>
              <em>Shared</em>
            </div>
          </div>

          <div className="dash-hero-actions">
            <button className="dash-primary-action" onClick={() => !busy && setCreateOpen(true)} disabled={busy}>
              <span>+</span>
              New Tree
            </button>
            {onOpenPublish && trees.some((tree) => tree.role === "owner") && (
              <button className="dash-secondary-action" onClick={onOpenPublish} disabled={busy}>
                Publish Website
              </button>
            )}
          </div>
        </section>

        {error && <div className="dash-error">{error}</div>}

        <section className="dash-section">
          <div className="dash-section-head">
            <div>
              <div className="dash-eyebrow">Library</div>
              <h2>Family Trees</h2>
            </div>
            <div className="dash-role-summary">
              <span>{ownedCount} owned</span>
              <span>{sharedCount} shared</span>
            </div>
          </div>

          <div className="dash-grid">
            {trees.map((tree) => (
              <TreeCard
                key={tree.id}
                tree={tree}
                onOpen={onOpenTree}
                onRename={onRenameTree}
                onShare={onOpenSharing}
                onSettings={onOpenTreeSettings}
              />
            ))}
            <NewTreeCard onClick={() => !busy && setCreateOpen(true)} />
          </div>
        </section>
      </div>

      <CreateTreeModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreate={onCreateTree}
      />
    </div>
  );
}
