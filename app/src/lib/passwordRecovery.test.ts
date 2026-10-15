import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  reset: vi.fn(), update: vi.fn(), session: vi.fn(), redirect: vi.fn(),
}));
vi.mock("./desktop", () => ({ getDesktopAuthRedirectUrl: mocks.redirect }));
vi.mock("./supabase", () => ({ supabaseClient: () => ({ auth: {
  resetPasswordForEmail: mocks.reset, updateUser: mocks.update, getSession: mocks.session,
} }) }));
import { isPasswordRecoveryUrl, requestPasswordRecovery, updateRecoveredPassword } from "./passwordRecovery";

describe("password recovery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("window", { location: { href: "https://example.com/FamilyTree/?github=connected" } });
    mocks.redirect.mockResolvedValue(null);
    mocks.reset.mockResolvedValue({ error: null });
    mocks.update.mockResolvedValue({ error: null });
    mocks.session.mockResolvedValue({ data: { session: {} }, error: null });
  });
  it("returns web recovery to the hosted subdirectory without unrelated query parameters", async () => {
    await requestPasswordRecovery(" user@example.com ");
    expect(mocks.reset).toHaveBeenCalledWith("user@example.com", { redirectTo: "https://example.com/FamilyTree/?recovery=1" });
  });
  it("uses the desktop callback when resetting from the Mac app", async () => {
    mocks.redirect.mockResolvedValue("familytree://auth/callback");
    await requestPasswordRecovery("user@example.com");
    expect(mocks.reset).toHaveBeenCalledWith("user@example.com", { redirectTo: "familytree://auth/callback?recovery=1" });
  });
  it("recognizes recovery callbacks independently of Google login", () => {
    expect(isPasswordRecoveryUrl("https://example.com/?recovery=1&code=abc")).toBe(true);
    expect(isPasswordRecoveryUrl("https://example.com/#type=recovery&access_token=abc")).toBe(true);
    expect(isPasswordRecoveryUrl("https://example.com/?code=abc")).toBe(false);
  });
  it("rejects expired links before changing a password", async () => {
    mocks.session.mockResolvedValue({ data: { session: null }, error: null });
    await expect(updateRecoveredPassword("new-password")).rejects.toThrow("expired");
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it("validates minimum password length and propagates server failures", async () => {
    await expect(updateRecoveredPassword("short")).rejects.toThrow("at least 8");
    expect(mocks.update).not.toHaveBeenCalled();
    mocks.update.mockResolvedValue({ error: { message: "Password has been compromised" } });
    await expect(updateRecoveredPassword("new-password")).rejects.toThrow("compromised");
  });
  it("updates a password only with an authenticated recovery session", async () => {
    await updateRecoveredPassword("new-password");
    expect(mocks.update).toHaveBeenCalledWith({ password: "new-password" });
  });
  it("shows reset-email failures instead of reporting success", async () => {
    mocks.reset.mockResolvedValue({ error: { message: "Email rate limit exceeded" } });
    await expect(requestPasswordRecovery("user@example.com")).rejects.toThrow("rate limit");
  });
});
