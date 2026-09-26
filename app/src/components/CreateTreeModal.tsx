import { useState } from "react";
import type { Gender } from "../data/family";
import type { TreeRole } from "../lib/backend";

export interface NewTreeDetails {
  name: string;
  founderName: string;
  founderGender: Gender;
  invites: Array<{ email: string; role: Exclude<TreeRole, "owner"> }>;
}

interface Props {
  open: boolean;
  onClose: () => void;
  onCreate: (details: NewTreeDetails) => void;
}

export function CreateTreeModal({ open, onClose, onCreate }: Props) {
  const [name, setName] = useState("");
  const [founderName, setFounderName] = useState("");
  const [founderGender, setFounderGender] = useState<Gender>("m");
  const [invites, setInvites] = useState<Array<{ email: string; role: Exclude<TreeRole, "owner"> }>>([]);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<Exclude<TreeRole, "owner">>("editor");

  if (!open) return null;

  const reset = () => {
    setName("");
    setFounderName("");
    setFounderGender("m");
    setInvites([]);
    setInviteEmail("");
    setInviteRole("editor");
  };

  const addInvite = () => {
    const email = inviteEmail.trim();
    if (!email) return;
    if (invites.some((i) => i.email.toLowerCase() === email.toLowerCase())) return;
    setInvites((list) => [...list, { email, role: inviteRole }]);
    setInviteEmail("");
  };

  const submit = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    onCreate({ name: trimmed, founderName: founderName.trim(), founderGender, invites });
    reset();
    onClose();
  };

  return (
    <div className="ct-overlay" role="dialog" aria-modal="true" aria-labelledby="ct-title">
      <button className="ct-scrim" aria-label="Close create tree dialog" onClick={onClose} />
      <div className="ct-panel">
        <span className="modal-corner tl" />
        <span className="modal-corner tr" />
        <span className="modal-corner bl" />
        <span className="modal-corner br" />

        <div className="ct-head">
          <div>
            <div className="backup-kicker">New Lineage</div>
            <h2 id="ct-title">Create a Family Tree</h2>
          </div>
          <button className="backup-close" onClick={onClose} aria-label="Close">
            x
          </button>
        </div>

        <label className="field">
          <span>Tree name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. The Mohapatra Family"
            autoFocus
          />
        </label>

        <label className="field">
          <span>Founder's name (optional)</span>
          <input
            value={founderName}
            onChange={(e) => setFounderName(e.target.value)}
            placeholder="Who's at the root of this tree?"
          />
        </label>

        <label className="field">
          <span>Founder's gender (node color)</span>
          <select value={founderGender} onChange={(e) => setFounderGender(e.target.value as Gender)}>
            <option value="m">Male (cyan)</option>
            <option value="f">Female (magenta)</option>
          </select>
        </label>

        <div className="ct-invite-section rename-panel">
          <div className="removed-head">
            <span>Invite Collaborators</span>
          </div>
          <div className="rename-row">
            <input
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              placeholder="email@example.com"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addInvite();
                }
              }}
            />
            <select value={inviteRole} onChange={(e) => setInviteRole(e.target.value as Exclude<TreeRole, "owner">)}>
              <option value="editor">Editor</option>
              <option value="viewer">Viewer</option>
            </select>
            <button onClick={addInvite} disabled={!inviteEmail.trim()}>
              Add
            </button>
          </div>

          {invites.length > 0 && (
            <div className="removed-list">
              {invites.map((inv) => (
                <div className="removed-item" key={inv.email}>
                  <span>
                    {inv.email} <em className="ct-invite-role">· {inv.role}</em>
                  </span>
                  <button onClick={() => setInvites((list) => list.filter((i) => i.email !== inv.email))}>
                    Remove
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="btnrow">
          <button className="btn primary" onClick={submit} disabled={!name.trim()}>
            Create Tree
          </button>
          <button
            className="btn ghost"
            onClick={() => {
              reset();
              onClose();
            }}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
