import { redirectResponse } from "../_shared/cors.ts";
import { adminClient } from "../_shared/supabase.ts";
import { encryptToken } from "../_shared/crypto.ts";
import { exchangeCodeForToken, fetchGitHubUser } from "../_shared/github.ts";
import { optionalEnv } from "../_shared/env.ts";

function withParams(returnTo: string, params: Record<string, string>): string {
  const url = new URL(returnTo);
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
  return url.toString();
}

Deno.serve(async (request) => {
  const requestUrl = new URL(request.url);
  const state = requestUrl.searchParams.get("state") ?? "";
  const code = requestUrl.searchParams.get("code") ?? "";
  const oauthError = requestUrl.searchParams.get("error_description") ?? requestUrl.searchParams.get("error");
  const fallbackReturnTo = optionalEnv("APP_FALLBACK_RETURN_URL") ?? "http://127.0.0.1:5173/";
  const client = adminClient();

  try {
    const { data: stateRow, error: stateError } = await client
      .from("github_oauth_states")
      .select("state,user_id,return_to,expires_at")
      .eq("state", state)
      .maybeSingle();
    if (stateError) throw new Error(stateError.message);
    if (!stateRow) throw new Error("GitHub authorization expired. Please try again.");

    await client.from("github_oauth_states").delete().eq("state", state);
    const returnTo = stateRow.return_to || fallbackReturnTo;
    if (new Date(stateRow.expires_at).getTime() < Date.now()) {
      return redirectResponse(withParams(returnTo, { github: "error", message: "GitHub authorization expired." }));
    }
    if (oauthError) return redirectResponse(withParams(returnTo, { github: "error", message: oauthError }));
    if (!code) return redirectResponse(withParams(returnTo, { github: "error", message: "GitHub did not return a code." }));

    const redirectUri =
      optionalEnv("GITHUB_OAUTH_CALLBACK_URL") ??
      new URL(requestUrl.pathname, requestUrl.origin).toString();
    const { token, scopes } = await exchangeCodeForToken(code, redirectUri);
    const githubUser = await fetchGitHubUser(token);
    const encrypted = await encryptToken(token);

    const { error } = await client.from("github_connections").upsert(
      {
        user_id: stateRow.user_id,
        github_user_id: githubUser.id,
        github_login: githubUser.login,
        avatar_url: githubUser.avatar_url ?? null,
        profile_url: githubUser.html_url,
        access_token_ciphertext: encrypted.ciphertext,
        access_token_nonce: encrypted.nonce,
        scopes,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" },
    );
    if (error) throw new Error(error.message);

    return redirectResponse(withParams(returnTo, { github: "connected" }));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not finish GitHub authorization.";
    return redirectResponse(withParams(fallbackReturnTo, { github: "error", message }));
  }
});
