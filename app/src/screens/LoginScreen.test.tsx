import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
vi.mock("../components/AmbientStage", () => ({ AmbientStage: () => null }));
vi.mock("../lib/supabase", () => ({ isSupabaseConfigured: () => true }));
import { LoginScreen } from "./LoginScreen";

const handlers = { onAuthenticated: vi.fn(), onCreateAccount: vi.fn(), onSocialAuthenticated: vi.fn() };
afterEach(() => vi.unstubAllEnvs());

describe("launch authentication", () => {
  it("offers Google without password or signup fields by default", () => {
    vi.stubEnv("VITE_EMAIL_AUTH_ENABLED", "false");
    const html = renderToStaticMarkup(<LoginScreen {...handlers} />);
    expect(html).toContain("Continue with Google");
    expect(html).not.toContain('type="password"');
    expect(html).not.toContain("Create Account");
    expect(html).not.toContain("Forgot password?");
  });
  it("keeps Google errors visible when email authentication is hidden", () => {
    vi.stubEnv("VITE_EMAIL_AUTH_ENABLED", "false");
    const html = renderToStaticMarkup(<LoginScreen {...handlers} error="Google login failed" />);
    expect(html).toContain('role="alert"');
    expect(html).toContain("Google login failed");
  });
  it("enables email sign-in and recovery only when explicitly configured", () => {
    vi.stubEnv("VITE_EMAIL_AUTH_ENABLED", "true");
    const html = renderToStaticMarkup(<LoginScreen {...handlers} />);
    expect(html).toContain('type="password"');
    expect(html).toContain("Create Account");
    expect(html).toContain("Forgot password?");
  });
});
