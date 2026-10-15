import { useEffect, useRef, useState } from "react";
import { AmbientStage } from "../components/AmbientStage";
import { completeSocialProviderRedirect, getAuthSession, signOut } from "../lib/backend";
import { updateRecoveredPassword } from "../lib/passwordRecovery";

export function PasswordRecovery({ callbackUrl, onDone }: { callbackUrl?: string; onDone: () => void }) {
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const sessionRequest = useRef<ReturnType<typeof getAuthSession> | null>(null);
  useEffect(() => {
    let cancelled = false;
    // The web client automatically exchanges the PKCE code during initialization.
    const session = sessionRequest.current ??= callbackUrl ? completeSocialProviderRedirect(callbackUrl) : getAuthSession();
    void session.then((value) => {
      if (cancelled) return;
      if (!value) throw new Error("This reset link has expired. Request a new one from Sign In.");
      setReady(true);
    }).catch((reason) => {
      if (!cancelled) setError(reason instanceof Error ? reason.message : "Could not open this reset link.");
    });
    return () => { cancelled = true; };
  }, [callbackUrl]);

  return <div className="app-shell auth-shell"><AmbientStage /><div className="auth-center"><div className="auth-panel">
    <div className="auth-brand"><h1>{saved ? "PASSWORD UPDATED" : "RESET PASSWORD"}</h1><div className="sub">Family Tree</div></div>
    {saved ? <p role="status">Your password has been updated. Sign in with your new password.</p> : <form className="auth-form" onSubmit={(event) => {
      event.preventDefault();
      if (password !== confirmation) { setError("Passwords do not match."); return; }
      setBusy(true); setError("");
      void updateRecoveredPassword(password).then(() => setSaved(true))
        .catch((reason) => setError(reason instanceof Error ? reason.message : "Could not update your password."))
        .finally(() => setBusy(false));
    }}>
      <label className="field"><span>New password</span><input type="password" autoComplete="new-password" minLength={8} required value={password} onChange={(event) => setPassword(event.target.value)} /></label>
      <label className="field"><span>Confirm password</span><input type="password" autoComplete="new-password" minLength={8} required value={confirmation} onChange={(event) => setConfirmation(event.target.value)} /></label>
      {error && <div className="auth-error" role="alert">{error}</div>}
      <button className="btn primary auth-submit" disabled={!ready || busy}>{busy ? "Updating…" : "Update password"}</button>
    </form>}
    <button type="button" className="btn auth-submit" disabled={busy} onClick={() => {
      setBusy(true);
      void signOut().then(onDone).catch((reason) => {
        setError(reason instanceof Error ? reason.message : "Could not sign out.");
        setBusy(false);
      });
    }}>Back to Sign In</button>
    {saved && error && <div className="auth-error" role="alert">{error}</div>}
  </div></div></div>;
}
