import { env } from "./env.ts";
import { utf8ToBase64 } from "./crypto.ts";

interface GitHubErrorPayload {
  message?: string;
  errors?: Array<{ message?: string }>;
}

async function githubFetch<T>(token: string, path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      ...(init.headers ?? {}),
    },
  });

  if (!response.ok) {
    let payload: GitHubErrorPayload = {};
    try {
      payload = await response.json();
    } catch {
      // Ignore JSON parse failures and use the status text below.
    }
    throw new Error(payload.message ?? response.statusText);
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export interface GitHubTokenResponse {
  access_token?: string;
  scope?: string;
  error?: string;
  error_description?: string;
}

export async function exchangeCodeForToken(code: string, redirectUri: string): Promise<{ token: string; scopes: string[] }> {
  const response = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      client_id: env("GITHUB_CLIENT_ID"),
      client_secret: env("GITHUB_CLIENT_SECRET"),
      code,
      redirect_uri: redirectUri,
    }),
  });

  const payload = (await response.json()) as GitHubTokenResponse;
  if (!response.ok || payload.error || !payload.access_token) {
    throw new Error(payload.error_description ?? payload.error ?? "GitHub did not return an access token.");
  }

  return {
    token: payload.access_token,
    scopes: (payload.scope ?? "").split(",").map((scope) => scope.trim()).filter(Boolean),
  };
}

export interface GitHubUser {
  id: number;
  login: string;
  avatar_url?: string;
  html_url: string;
}

export function fetchGitHubUser(token: string): Promise<GitHubUser> {
  return githubFetch<GitHubUser>(token, "/user");
}

export interface GitHubRepo {
  id: number;
  name: string;
  full_name: string;
  private: boolean;
  default_branch: string;
  owner: {
    login: string;
  };
}

export function listRepos(token: string): Promise<GitHubRepo[]> {
  return githubFetch<GitHubRepo[]>(token, "/user/repos?per_page=100&sort=updated&affiliation=owner,collaborator,organization_member");
}

export async function createRepo(token: string, name: string, visibility: "public" | "private"): Promise<GitHubRepo> {
  return githubFetch<GitHubRepo>(token, "/user/repos", {
    method: "POST",
    body: JSON.stringify({
      name,
      private: visibility === "private",
      auto_init: true,
      description: "Published Family Tree website",
    }),
  });
}

export function getRepo(token: string, owner: string, repo: string): Promise<GitHubRepo> {
  return githubFetch<GitHubRepo>(token, `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`);
}

interface ContentsResponse {
  sha?: string;
}

async function currentFileSha(token: string, owner: string, repo: string, path: string, branch: string): Promise<string | undefined> {
  const response = await fetch(
    `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${path}?ref=${encodeURIComponent(branch)}`,
    {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
      },
    },
  );

  if (response.status === 404) return undefined;
  if (!response.ok) throw new Error(`Could not inspect ${path}: ${response.statusText}`);
  const payload = (await response.json()) as ContentsResponse;
  return payload.sha;
}

export async function putFile(
  token: string,
  owner: string,
  repo: string,
  path: string,
  branch: string,
  content: string,
): Promise<string | undefined> {
  const sha = await currentFileSha(token, owner, repo, path, branch);
  const result = await githubFetch<{ commit?: { sha?: string } }>(
    token,
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${path}`,
    {
      method: "PUT",
      body: JSON.stringify({
        message: `Publish family tree website (${path})`,
        content: utf8ToBase64(content),
        branch,
        ...(sha ? { sha } : {}),
      }),
    },
  );
  return result.commit?.sha;
}

export async function putBinaryFile(
  token: string,
  owner: string,
  repo: string,
  path: string,
  branch: string,
  bytes: Uint8Array,
): Promise<string | undefined> {
  const sha = await currentFileSha(token, owner, repo, path, branch);
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  const result = await githubFetch<{ commit?: { sha?: string } }>(
    token,
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${path}`,
    {
      method: "PUT",
      body: JSON.stringify({
        message: `Publish family tree website (${path})`,
        content: btoa(binary),
        branch,
        ...(sha ? { sha } : {}),
      }),
    },
  );
  return result.commit?.sha;
}

export async function ensurePages(token: string, owner: string, repo: string, branch: string): Promise<string> {
  const path = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pages`;
  const body = JSON.stringify({ source: { branch, path: "/" } });

  const create = await fetch(`https://api.github.com${path}`, {
    method: "POST",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
    },
    body,
  });

  if (!create.ok && create.status !== 409) {
    const payload = await create.json().catch(() => ({}));
    throw new Error(payload.message ?? "Could not enable GitHub Pages.");
  }

  if (create.status === 409) {
    const update = await fetch(`https://api.github.com${path}`, {
      method: "PUT",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
      },
      body,
    });
    if (!update.ok) {
      const payload = await update.json().catch(() => ({}));
      throw new Error(payload.message ?? "Could not update GitHub Pages.");
    }
  }

  const pages = await githubFetch<{ html_url?: string }>(token, path);
  return pages.html_url ?? `https://${owner}.github.io/${repo}/`;
}
