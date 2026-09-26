import { useEffect, useState } from "react";
import type { TreeInviteInput, TreeRole, TreeSharing } from "../lib/backend";
import { hueFor, initialsOf } from "../lib/avatar";

interface Props {
  open: boolean;
  treeName: string;
  sharing: TreeSharing | null;
  busy?: boolean;
  error?: string;
  onClose: () => void;
  onInvite: (invite: TreeInviteInput) => Promise<void> | void;
  onMemberRole: (userId: string, role: Exclude<TreeRole, "owner">) => Promise<void> | void;
  onRemoveMember: (userId: string) => Promise<void> | void;
  onInvitationRole: (invitationId: string, role: Exclude<TreeRole, "owner">) => Promise<void> | void;
  onRemoveInvitation: (invitationId: string) => Promise<void> | void;
}

type ShareableRole = Exclude<TreeRole, "owner">;

/** Segmented Editor/Viewer control — used for the invite form and every row. */
function RoleToggle({
  value,
  onChange,
  disabled,
}: {
  value: ShareableRole;
  onChange: (role: ShareableRole) => void;
  disabled?: boolean;
}) {
  return (
    <div className="share-role-toggle" role="group" aria-label="Role">
      {(["editor", "viewer"] as const).map((option) => (
        <button
          key={option}
          type="button"
          className={`share-role-btn ${option}${value === option ? " active" : ""}`}
          aria-pressed={value === option}
          disabled={disabled}
          onClick={() => onChange(option)}
        >
          {option === "editor" ? "Editor" : "Viewer"}
        </button>
      ))}
    </div>
  );
}

export function ShareTreeModal({
  open,
  treeName,
  sharing,
  busy = false,
  error = "",
  onClose,
  onInvite,
  onMemberRole,
  onRemoveMember,
  onInvitationRole,
  onRemoveInvitation,
}: Props) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<ShareableRole>("editor");

  useEffect(() => {
    if (!open) {
      setEmail("");
      setRole("editor");
    }
  }, [open]);

  if (!open) return null;

  const submit = () => {
    const trimmed = email.trim();
    if (!trimmed) return;
    void Promise.resolve(onInvite({ email: trimmed, role })).then(() => setEmail(""));
  };

  return (
    <div className="ct-overlay" role="dialog" aria-modal="true" aria-labelledby="share-title">
      <button className="ct-scrim" aria-label="Close sharing dialog" onClick={onClose} />
      <div className="ct-panel share-panel">
        <span className="modal-corner tl" />
        <span className="modal-corner tr" />
        <span className="modal-corner bl" />
        <span className="modal-corner br" />

        <div className="ct-head">
          <div>
            <div className="backup-kicker">Tree Sharing</div>
            <h2 id="share-title">{treeName}</h2>
            <p className="share-subtitle">Invite people to view or edit this tree.</p>
          </div>
          <button className="backup-close" onClick={onClose} aria-label="Close">
            x
          </button>
        </div>

        {error && <div className="dash-error share-error">{error}</div>}

        <section className="share-section">
          <div className="share-section-head">
            <span className="share-section-label">Invite by email</span>
          </div>
          <div className="share-invite">
            <input
              className="share-invite-input"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="name@example.com"
              disabled={busy}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  submit();
                }
              }}
            />
            <div className="share-invite-controls">
              <RoleToggle value={role} onChange={setRole} disabled={busy} />
              <button className="share-invite-submit" onClick={submit} disabled={busy || !email.trim()}>
                Invite
              </button>
            </div>
          </div>
        </section>

        <section className="share-section">
          <div className="share-section-head">
            <span className="share-section-label">People with access</span>
            <span className="share-count">{sharing?.members.length ?? 0}</span>
          </div>
          <div className="share-rows">
            {!sharing ? (
              <div className="share-empty">Loading…</div>
            ) : sharing.members.length === 0 ? (
              <div className="share-empty">No collaborators yet</div>
            ) : (
              sharing.members.map((member) => {
                const hue = hueFor(member.email);
                return (
                  <div className="share-row" key={member.userId}>
                    <div className="share-identity">
                      <span
                        className="share-avatar"
                        style={{
                          background: `hsla(${hue}, 90%, 58%, 0.22)`,
                          borderColor: `hsla(${hue}, 90%, 65%, 0.5)`,
                        }}
                        aria-hidden="true"
                      >
                        {initialsOf(member.displayName || member.email)}
                      </span>
                      <span className="share-who">
                        <span className="share-name">{member.displayName}</span>
                        <span className="share-email">{member.email}</span>
                      </span>
                    </div>
                    {member.role === "owner" ? (
                      <span className="share-owner-badge">Owner</span>
                    ) : (
                      <div className="share-row-actions">
                        <RoleToggle
                          value={member.role as ShareableRole}
                          disabled={busy}
                          onChange={(nextRole) => void onMemberRole(member.userId, nextRole)}
                        />
                        <button
                          className="share-remove-btn"
                          disabled={busy}
                          onClick={() => void onRemoveMember(member.userId)}
                          aria-label={`Remove ${member.displayName || member.email}`}
                          title="Remove"
                        >
                          ×
                        </button>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </section>

        <section className="share-section">
          <div className="share-section-head">
            <span className="share-section-label">Pending invites</span>
            <span className="share-count">{sharing?.invitations.length ?? 0}</span>
          </div>
          <div className="share-rows">
            {!sharing ? (
              <div className="share-empty">Loading…</div>
            ) : sharing.invitations.length === 0 ? (
              <div className="share-empty">No pending invites</div>
            ) : (
              sharing.invitations.map((invite) => (
                <div className="share-row pending" key={invite.id}>
                  <div className="share-identity">
                    <span className="share-avatar pending" aria-hidden="true">
                      {initialsOf(invite.email)}
                    </span>
                    <span className="share-who">
                      <span className="share-name">{invite.email}</span>
                      <span className="share-email pending-tag">Invited · awaiting sign-in</span>
                    </span>
                  </div>
                  <div className="share-row-actions">
                    <RoleToggle
                      value={invite.role}
                      disabled={busy}
                      onChange={(nextRole) => void onInvitationRole(invite.id, nextRole)}
                    />
                    <button
                      className="share-remove-btn"
                      disabled={busy}
                      onClick={() => void onRemoveInvitation(invite.id)}
                      aria-label={`Cancel invite to ${invite.email}`}
                      title="Cancel invite"
                    >
                      ×
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
