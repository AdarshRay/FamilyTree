import { useEffect, useRef, useState } from "react";
import type { AccountUser } from "../data/mockAccount";
import { hueFor, initialsOf } from "../lib/avatar";

interface Props {
  user: AccountUser;
  onSwitchTree?: () => void;
  onOpenAccountSettings?: () => void;
  onSignOut: () => void;
  pendingTLinkCount?: number;
}

/** Small avatar chip in the topbar that opens the account popover. */
export function AccountMenu({ user, onSwitchTree, onOpenAccountSettings, onSignOut, pendingTLinkCount = 0 }: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const hue = hueFor(user.email);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  return (
    <div className="acct-menu" ref={rootRef}>
      <button
        type="button"
        className="acct-chip"
        style={{ background: `hsla(${hue}, 90%, 58%, 0.22)`, borderColor: `hsla(${hue}, 90%, 65%, 0.5)` }}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Account menu"
      >
        {initialsOf(user.name || user.email)}
        {pendingTLinkCount > 0 && <span className="acct-notification" aria-label={`${pendingTLinkCount} pending TLink requests`}>{Math.min(99, pendingTLinkCount)}</span>}
      </button>

      {open && (
        <div className="acct-popover" role="menu">
          <div className="acct-who">
            <div className="acct-name">{user.name || "Family Member"}</div>
            <div className="acct-email">{user.email}</div>
          </div>
          <div className="acct-sep" />
          {onSwitchTree && (
            <button
              type="button"
              className="acct-item"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                onSwitchTree();
              }}
            >
              ⌁ Switch Tree
            </button>
          )}
          {onOpenAccountSettings && (
            <button
              type="button"
              className="acct-item"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                onOpenAccountSettings();
              }}
            >
              ⚙ Account Settings{pendingTLinkCount > 0 ? ` (${pendingTLinkCount})` : ""}
            </button>
          )}
          <button
            type="button"
            className="acct-item danger"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onSignOut();
            }}
          >
            ⏻ Sign Out
          </button>
        </div>
      )}
    </div>
  );
}
