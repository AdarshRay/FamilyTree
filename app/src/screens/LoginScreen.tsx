import { useState } from "react";
import { AmbientStage } from "../components/AmbientStage";
import type { AuthProvider } from "../lib/backend";
import { isSupabaseConfigured } from "../lib/supabase";

interface Props {
  busy?: boolean;
  error?: string;
  onAuthenticated: (identifier: string, password: string) => Promise<void> | void;
  onCreateAccount: (email: string, password: string, displayName: string) => Promise<void> | void;
  onSocialAuthenticated: (provider: AuthProvider) => Promise<void> | void;
}

type Mode = "signin" | "signup";

function GoogleGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M21.6 12.23c0-.68-.06-1.33-.17-1.96H12v3.7h5.4a4.62 4.62 0 0 1-2 3.03v2.5h3.23c1.9-1.75 2.97-4.32 2.97-7.27Z" />
      <path d="M12 22c2.7 0 4.97-.9 6.63-2.43l-3.23-2.5c-.9.6-2.05.96-3.4.96-2.6 0-4.8-1.76-5.6-4.12H3.07v2.58A10 10 0 0 0 12 22Z" />
      <path d="M6.4 13.9a6 6 0 0 1 0-3.85V7.47H3.07a10 10 0 0 0 0 9.04L6.4 13.9Z" />
      <path d="M12 5.98c1.47 0 2.8.5 3.83 1.5l2.87-2.87A9.7 9.7 0 0 0 12 2a10 10 0 0 0-8.93 5.47l3.33 2.58c.8-2.36 3-4.07 5.6-4.07Z" />
    </svg>
  );
}

export function LoginScreen({
  busy = false,
  error = "",
  onAuthenticated,
  onCreateAccount,
  onSocialAuthenticated,
}: Props) {
  const [mode, setMode] = useState<Mode>("signin");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [localError, setLocalError] = useState("");
  const socialLoginReady = isSupabaseConfigured();

  const submit = async () => {
    const trimmedEmail = email.trim();
    if (!trimmedEmail || !password) {
      setLocalError("Enter your email and password.");
      return;
    }
    if (mode === "signup" && !name.trim()) {
      setLocalError("Enter your name to create an account.");
      return;
    }
    setLocalError("");
    if (mode === "signup") {
      await onCreateAccount(trimmedEmail, password, name.trim());
      return;
    }
    await onAuthenticated(trimmedEmail, password);
  };

  return (
    <div className="app-shell auth-shell">
      <AmbientStage />

      <div className="auth-center">
        <div className="auth-panel">
          <span className="modal-corner tl" />
          <span className="modal-corner tr" />
          <span className="modal-corner bl" />
          <span className="modal-corner br" />

          <div className="auth-brand">
            <h1>FAMILY TREE</h1>
            <div className="sub">Lineage Interface</div>
          </div>

          <div className="auth-tabs" role="tablist">
            <button
              type="button"
              role="tab"
              className={"auth-tab" + (mode === "signin" ? " active" : "")}
              aria-selected={mode === "signin"}
              onClick={() => setMode("signin")}
            >
              Sign In
            </button>
            <button
              type="button"
              role="tab"
              className={"auth-tab" + (mode === "signup" ? " active" : "")}
              aria-selected={mode === "signup"}
              onClick={() => setMode("signup")}
            >
              Create Account
            </button>
          </div>

          <form
            className="auth-form"
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            {mode === "signup" && (
              <label className="field">
                <span>Name</span>
                <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" autoFocus />
              </label>
            )}
            <label className="field">
              <span>Email</span>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                autoFocus={mode === "signin"}
              />
            </label>
            <label className="field">
              <span>Password</span>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
              />
            </label>
            {(localError || error) && <div className="auth-error">{localError || error}</div>}
            <button type="submit" className="btn primary auth-submit" disabled={busy}>
              {mode === "signin" ? "Sign In" : "Create Account"}
            </button>
          </form>

          <div className="auth-divider">
            <span />
            <em>or continue with</em>
            <span />
          </div>

          <div className="auth-social">
            <button
              type="button"
              className={`auth-social-btn${socialLoginReady ? "" : " unavailable"}`}
              disabled={busy || !socialLoginReady}
              title={socialLoginReady ? undefined : "Google sign-in needs an active Supabase project"}
              onClick={() => void onSocialAuthenticated("google")}
            >
              <GoogleGlyph />
              Google {!socialLoginReady && <span className="auth-social-soon">Offline</span>}
            </button>
          </div>
          <p className="auth-legal">
            By continuing, you agree to the <a href="./terms.html" target="_blank">Terms</a> and acknowledge the <a href="./privacy.html" target="_blank">Privacy Policy</a>.
          </p>
        </div>
      </div>
    </div>
  );
}
