import { useEffect, useState } from "react";
import type { TreeRole } from "../lib/backend";
import type { TreePublishStatus } from "../lib/github";

export interface TreeSettingsTarget {
  id: string;
  name: string;
  role: TreeRole;
  memberCount: number;
}

interface Props {
  open: boolean;
  tree: TreeSettingsTarget | null;
  publishStatus: TreePublishStatus | null;
  busy?: boolean;
  error?: string;
  onClose: () => void;
  onRename: (id: string, name: string) => Promise<void> | void;
  onOpenSharing: (id: string) => void;
  onOpenPublish: (id: string) => void;
  onDelete: (id: string) => Promise<void> | void;
}

export function TreeSettingsModal({ open, tree, publishStatus, busy = false, error = "", onClose, onRename, onOpenSharing, onOpenPublish, onDelete }: Props) {
  const [name, setName] = useState("");
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");

  useEffect(() => {
    if (open && tree) {
      setName(tree.name);
      setConfirmingDelete(false);
      setDeleteConfirmation("");
    }
  }, [open, tree]);

  if (!open || !tree) return null;

  const isOwner = tree.role === "owner";
  const dirty = name.trim().length > 0 && name.trim() !== tree.name;

  const saveRename = () => {
    const trimmed = name.trim();
    if (!trimmed || trimmed === tree.name) return;
    void onRename(tree.id, trimmed);
  };

  const published = publishStatus?.state === "published";

  return (
    <div className="ct-overlay" role="dialog" aria-modal="true" aria-labelledby="tree-settings-title">
      <button className="ct-scrim" aria-label="Close tree settings dialog" onClick={onClose} />
      <div className="ct-panel share-panel">
        <span className="modal-corner tl" />
        <span className="modal-corner tr" />
        <span className="modal-corner bl" />
        <span className="modal-corner br" />

        <div className="ct-head">
          <div>
            <div className="backup-kicker">Tree Settings</div>
            <h2 id="tree-settings-title">{tree.name}</h2>
          </div>
          <button className="backup-close" onClick={onClose} aria-label="Close">
            x
          </button>
        </div>

        {error && <div className="dash-error share-error">{error}</div>}

        <section className="share-section">
          <div className="share-section-head">
            <span className="share-section-label">Rename tree</span>
          </div>
          {isOwner ? (
            <div className="settings-rename-row">
              <input
                className="share-invite-input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={busy}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    saveRename();
                  }
                }}
              />
              <button className="share-invite-submit" onClick={saveRename} disabled={busy || !dirty}>
                Save
              </button>
            </div>
          ) : (
            <p className="settings-readonly">Only the tree owner can rename this tree.</p>
          )}
        </section>

        <section className="share-section">
          <div className="share-section-head">
            <span className="share-section-label">Sharing</span>
          </div>
          <div className="settings-row">
            <div className="settings-row-text">
              <span className="settings-row-title">Manage access</span>
              <span className="settings-row-sub">Invite collaborators, change roles, or remove access.</span>
            </div>
            <button className="settings-row-action" onClick={() => onOpenSharing(tree.id)} disabled={!isOwner}>
              Manage
            </button>
          </div>
          {!isOwner && <p className="settings-readonly">Only the tree owner can manage sharing.</p>}
        </section>

        <section className="share-section">
          <div className="share-section-head">
            <span className="share-section-label">Publish website</span>
          </div>
          <div className="settings-row">
            <div className="settings-row-text">
              <span className="settings-row-title">
                <span className={`publish-status-tag ${published ? "published" : "unpublished"}`}>
                  {published ? "Published" : "Not published"}
                </span>
              </span>
              <span className="settings-row-sub">
                {published ? publishStatus?.url : "Publish a read-only website for this tree to your own GitHub."}
              </span>
            </div>
            <button className="settings-row-action" onClick={() => onOpenPublish(tree.id)} disabled={!isOwner}>
              {published ? "Manage" : "Publish"}
            </button>
          </div>
          {published && publishStatus?.url && (
            <a className="settings-view-live" href={publishStatus.url} target="_blank" rel="noreferrer">
              View live site ↗
            </a>
          )}
          {!isOwner && <p className="settings-readonly">Only the tree owner can publish this tree.</p>}
        </section>

        <section className="share-section danger-zone">
          <div className="share-section-head">
            <span className="share-section-label">Danger zone</span>
          </div>
          <div className="settings-row">
            <div className="settings-row-text">
              <span className="settings-row-title">Delete this tree</span>
              <span className="settings-row-sub">Permanently remove this tree and all its data.</span>
            </div>
            <button
              className="settings-row-action danger"
              disabled={!isOwner || busy}
              onClick={() => setConfirmingDelete(true)}
            >
              Delete
            </button>
          </div>
          {confirmingDelete && (
            <div className="settings-delete-confirm">
              <p>Type <strong>{tree.name}</strong> to confirm. This cannot be undone.</p>
              <div className="settings-rename-row">
                <input
                  className="share-invite-input"
                  value={deleteConfirmation}
                  onChange={(event) => setDeleteConfirmation(event.target.value)}
                  disabled={busy}
                  autoFocus
                />
                <button
                  className="settings-row-action danger"
                  disabled={busy || deleteConfirmation !== tree.name}
                  onClick={() => void Promise.resolve(onDelete(tree.id)).catch(() => undefined)}
                >
                  Delete permanently
                </button>
                <button className="settings-row-action" disabled={busy} onClick={() => setConfirmingDelete(false)}>
                  Cancel
                </button>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
