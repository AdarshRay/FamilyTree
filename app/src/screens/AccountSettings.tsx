import { useEffect, useState } from "react";
import { AmbientStage } from "../components/AmbientStage";
import { GithubIcon } from "../components/icons";
import type { AccountUser } from "../data/mockAccount";
import type { AuthProvider } from "../lib/backend";
import { hueFor, initialsOf } from "../lib/avatar";
import type { GitHubConnection } from "../lib/github";

interface Props {
  user: AccountUser;
  provider: AuthProvider;
  githubConnection: GitHubConnection | null;
  githubBusy?: boolean;
  githubError?: string;
  busy?: boolean;
  error?: string;
  onBack: () => void;
  onUpdateProfile: (name: string) => Promise<void> | void;
  onConnectGithub: () => Promise<void> | void;
  onDisconnectGithub: () => Promise<void> | void;
  onSignOut: () => void;
}

const PROVIDER_LABEL: Record<AuthProvider, string> = {
  password: "Email & Password",
  google: "Google",
  apple: "Apple",
  facebook: "Facebook",
};

function formatDate(value: string): string {
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return "recently";
  return new Date(value).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export function AccountSettings({
  user,
  provider,
  githubConnection,
  githubBusy = false,
  githubError = "",
  busy = false,
  error = "",
  onBack,
  onUpdateProfile,
  onConnectGithub,
  onDisconnectGithub,
  onSignOut,
}: Props) {
  const [name, setName] = useState(user.name);

  useEffect(() => setName(user.name), [user.name]);

  const hue = hueFor(user.email);
  const dirty = name.trim().length > 0 && name.trim() !== user.name;

  const saveProfile = () => {
    const trimmed = name.trim();
    if (!trimmed || trimmed === user.name) return;
    void Promise.resolve(onUpdateProfile(trimmed)).catch(() => undefined);
  };

  return (
    <div className="app-shell dash-shell">
      <AmbientStage />

      <div className="topbar">
        <div className="topbar-left">
          <button className="settings-back-btn" onClick={onBack} aria-label="Back to dashboard">
            ←
          </button>
          <div className="brand">
            <h1>ACCOUNT</h1>
            <div className="sub">Settings &amp; Connections</div>
          </div>
        </div>
        <div className="topbar-right" />
      </div>

      <div className="dash-body settings-body">
        {error && <div className="dash-error">{error}</div>}

        <section className="dash-section">
          <div className="dash-section-head">
            <div>
              <div className="dash-eyebrow">Profile</div>
              <h2>Your Info</h2>
            </div>
          </div>
          <div className="settings-card">
            <div className="settings-profile-row">
              <span
                className="settings-avatar"
                style={{ background: `hsla(${hue}, 90%, 58%, 0.22)`, borderColor: `hsla(${hue}, 90%, 65%, 0.5)` }}
                aria-hidden="true"
              >
                {initialsOf(user.name || user.email)}
              </span>
              <div className="settings-profile-fields">
                <label className="field">
                  <span>Display name</span>
                  <input value={name} onChange={(e) => setName(e.target.value)} disabled={busy} />
                </label>
                <label className="field">
                  <span>Email</span>
                  <input value={user.email} disabled />
                </label>
              </div>
            </div>
            <div className="btnrow settings-card-actions">
              <button className="btn primary" onClick={saveProfile} disabled={busy || !dirty}>
                Save Changes
              </button>
            </div>
          </div>
        </section>

        <section className="dash-section">
          <div className="dash-section-head">
            <div>
              <div className="dash-eyebrow">Sign-in</div>
              <h2>Connected Accounts</h2>
            </div>
          </div>
          <div className="settings-card">
            <div className="settings-row">
              <div className="settings-row-text">
                <span className="settings-row-title">{PROVIDER_LABEL[provider]}</span>
                <span className="settings-row-sub">Primary sign-in method for this account.</span>
              </div>
              <span className="settings-connected-tag">Connected</span>
            </div>
          </div>
        </section>

        <section className="dash-section">
          <div className="dash-section-head">
            <div>
              <div className="dash-eyebrow">Publishing</div>
              <h2>GitHub Connection</h2>
            </div>
          </div>
          <div className="settings-card gh-card">
            {githubConnection ? (
              <div className="settings-row">
                <div className="settings-row-text">
                  <span className="settings-row-title gh-title">
                    <GithubIcon />
                    Connected as {githubConnection.username}
                  </span>
                  <span className="settings-row-sub">Connected {formatDate(githubConnection.connectedAt)}</span>
                </div>
                <button className="settings-row-action danger" onClick={() => void onDisconnectGithub()} disabled={githubBusy}>
                  {githubBusy ? "…" : "Disconnect"}
                </button>
              </div>
            ) : (
              <div className="gh-connect-card inline">
                <span className="gh-connect-icon">
                  <GithubIcon />
                </span>
                <h3>Not connected</h3>
                <p>Connect your GitHub account so you can publish your family tree as a website to your own repo.</p>
                {githubError && <div className="dash-error publish-error">{githubError}</div>}
                <button className="gh-connect-btn" onClick={() => void onConnectGithub()} disabled={githubBusy}>
                  {githubBusy ? "Connecting…" : "Connect GitHub"}
                </button>
              </div>
            )}
          </div>
        </section>

        <section className="dash-section">
          <div className="dash-section-head">
            <div>
              <div className="dash-eyebrow">Account</div>
              <h2>Actions</h2>
            </div>
          </div>
          <div className="settings-card">
            <div className="settings-row">
              <div className="settings-row-text">
                <span className="settings-row-title">Sign out</span>
                <span className="settings-row-sub">You'll need to sign in again on this device.</span>
              </div>
              <button className="settings-row-action" onClick={onSignOut}>
                Sign Out
              </button>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
