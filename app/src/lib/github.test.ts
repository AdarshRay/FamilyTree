import { describe, expect, it } from "vitest";
import { gitHubOAuthReturnMessage, gitHubOAuthReturnWasError, isGitHubOAuthReturn } from "./github";

describe("GitHub OAuth callback parsing", () => {
  it("recognizes successful callbacks", () => {
    expect(isGitHubOAuthReturn("https://app.example/?github=connected")).toBe(true);
    expect(gitHubOAuthReturnWasError("https://app.example/?github=connected")).toBe(false);
  });

  it("preserves an encoded provider error message", () => {
    const url = "https://app.example/?github=error&message=Authorization%20expired";
    expect(gitHubOAuthReturnWasError(url)).toBe(true);
    expect(gitHubOAuthReturnMessage(url)).toBe("Authorization expired");
  });
});
