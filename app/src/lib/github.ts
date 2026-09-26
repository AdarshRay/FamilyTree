import { getDesktopAuthRedirectUrl, openDesktopAuthUrl } from "./desktop";
import { isSupabaseConfigured, supabaseClient } from "./supabase";

export interface GitHubConnection {
  username: string;
  profileUrl: string;
  avatarUrl?: string;
  connectedAt: string;
}

export interface GitHubRepoOption {
  id: string;
  name: string;
  fullName: string;
  private: boolean;
}

export type PublishVisibility = "public" | "private";

export interface TreePublishStatus {
  state: "unpublished" | "published";
  url?: string;
  repoFullName?: string;
  visibility?: PublishVisibility;
  publishedAt?: string;
}

export interface PublishRequestInput {
  treeId: string;
  repoMode: "new" | "existing";
  repoName?: string;
  existingRepoId?: string;
  visibility: PublishVisibility;
}

export interface PublishResult {
  url: string;
  repoFullName: string;
  commitSha?: string;
  publishedAt?: string;
}

interface FunctionErrorPayload {
  error?: string;
}

function githubReturnUrl(): Promise<string> {
  return getDesktopAuthRedirectUrl().then((desktopRedirectUrl) => {
    const base = desktopRedirectUrl || window.location.href;
    const url = new URL(base);
    url.searchParams.set("github", "connected");
    return url.toString();
  });
}

function functionError(error: unknown, fallback: string): Error {
  if (error instanceof Error) return error;
  return new Error(fallback);
}

async function invokeFunction<T>(name: string, options?: { method?: "GET" | "POST" | "DELETE"; body?: unknown }): Promise<T> {
  const client = supabaseClient();
  if (!client) throw new Error("Supabase is not configured.");
  const { data, error } = await client.functions.invoke<T & FunctionErrorPayload>(name, {
    method: options?.method,
    body: options?.body as Record<string, unknown> | undefined,
  });
  if (error) throw functionError(error, `Could not call ${name}.`);
  if (data?.error) throw new Error(data.error);
  return data as T;
}

export function isGitHubBackendAvailable(): boolean {
  return isSupabaseConfigured();
}

export function isGitHubOAuthReturn(callbackUrl: string): boolean {
  const url = new URL(callbackUrl);
  return url.searchParams.has("github");
}

export function gitHubOAuthReturnMessage(callbackUrl: string): string | null {
  const url = new URL(callbackUrl);
  return url.searchParams.get("message");
}

export function gitHubOAuthReturnWasError(callbackUrl: string): boolean {
  const url = new URL(callbackUrl);
  return url.searchParams.get("github") === "error";
}

export function clearGitHubOAuthReturnFromLocation(): void {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  if (!url.searchParams.has("github")) return;
  url.searchParams.delete("github");
  url.searchParams.delete("message");
  window.history.replaceState({}, "", url.toString());
}

export async function getGitHubConnection(): Promise<GitHubConnection | null> {
  const payload = await invokeFunction<{ connection: GitHubConnection | null }>("github-connection", { method: "GET" });
  return payload.connection;
}

export async function startGitHubConnect(): Promise<void> {
  const payload = await invokeFunction<{ authorizationUrl: string }>("github-oauth-start", {
    method: "POST",
    body: {
      returnTo: await githubReturnUrl(),
    },
  });

  const openedExternally = await openDesktopAuthUrl(payload.authorizationUrl);
  if (!openedExternally) window.location.assign(payload.authorizationUrl);
}

export async function disconnectGitHub(): Promise<void> {
  await invokeFunction("github-connection", { method: "DELETE" });
}

export async function listGitHubRepositories(): Promise<GitHubRepoOption[]> {
  const payload = await invokeFunction<{ repos: GitHubRepoOption[] }>("github-repositories", { method: "POST" });
  return payload.repos;
}

export async function publishTreeWebsite(input: PublishRequestInput): Promise<PublishResult> {
  return invokeFunction<PublishResult>("github-publish-tree", { method: "POST", body: input });
}

export async function getTreePublishStatus(treeId: string): Promise<TreePublishStatus> {
  const payload = await invokeFunction<{ status: TreePublishStatus }>("github-publish-status", {
    method: "POST",
    body: { treeId },
  });
  return payload.status;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function slugify(label: string): string {
  return (
    label
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-+|-+$)/g, "") || "family-tree-user"
  );
}

/** Offline/demo fallback used only when Supabase is not configured. */
export async function mockConnectGitHub(displayNameOrEmail: string): Promise<GitHubConnection> {
  await delay(1100);
  const username = slugify(displayNameOrEmail.split("@")[0]);
  return {
    username,
    profileUrl: `https://github.com/${username}`,
    connectedAt: new Date().toISOString(),
  };
}

/** Offline/demo fallback used only when Supabase is not configured. */
export async function mockDisconnectGitHub(): Promise<void> {
  await delay(500);
}

/** Offline/demo fallback used only when Supabase is not configured. */
export async function mockListGitHubRepos(username: string): Promise<GitHubRepoOption[]> {
  await delay(700);
  return [
    { id: "r1", name: "family-tree", fullName: `${username}/family-tree`, private: false },
    { id: "r2", name: "our-lineage", fullName: `${username}/our-lineage`, private: true },
  ];
}

/** Offline/demo fallback used only when Supabase is not configured. */
export async function mockPublishTree(input: PublishRequestInput, username: string): Promise<PublishResult> {
  await delay(1400);
  const repoName = input.repoMode === "new" ? slugify(input.repoName || "family-tree") : input.existingRepoId ?? "family-tree";
  const fullName = input.repoMode === "existing" ? repoName : `${username}/${repoName}`;
  const shortName = fullName.split("/").pop() ?? repoName;
  return {
    url: `https://${username}.github.io/${shortName}/`,
    repoFullName: fullName,
  };
}
