import { corsHeaders, handleOptions, jsonResponse } from "../_shared/cors.ts";
import { env, optionalEnv } from "../_shared/env.ts";
import { adminClient, requireUser } from "../_shared/supabase.ts";

function validatedReturnTo(value: string): string {
  const url = new URL(value);
  const local = url.protocol === "http:" && (url.hostname === "127.0.0.1" || url.hostname === "localhost");
  const production = url.protocol === "https:" && url.origin === "https://adarshray.github.io" && url.pathname.startsWith("/FamilyTree/");
  const desktop = url.protocol === "familytree:" && url.hostname === "auth";
  if (!local && !production && !desktop) throw new Error("That return URL is not allowed.");
  return url.toString();
}

Deno.serve(async (request) => {
  const options = handleOptions(request);
  if (options) return options;

  try {
    if (request.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

    const user = await requireUser(request);
    const { returnTo } = (await request.json().catch(() => ({}))) as { returnTo?: string };
    if (!returnTo) throw new Error("Missing return URL.");
    const safeReturnTo = validatedReturnTo(returnTo);

    const state = crypto.randomUUID();
    const fallbackRedirectUrl = new URL(request.url);
    fallbackRedirectUrl.pathname = fallbackRedirectUrl.pathname.replace(/\/github-oauth-start\/?$/, "/github-oauth-callback");
    const redirectUri = optionalEnv("GITHUB_OAUTH_CALLBACK_URL") ?? fallbackRedirectUrl.toString();

    const { error } = await adminClient().from("github_oauth_states").insert({
      state,
      user_id: user.id,
      return_to: safeReturnTo,
      expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    });
    if (error) throw new Error(error.message);

    const authorizationUrl = new URL("https://github.com/login/oauth/authorize");
    authorizationUrl.searchParams.set("client_id", env("GITHUB_CLIENT_ID"));
    authorizationUrl.searchParams.set("redirect_uri", redirectUri);
    authorizationUrl.searchParams.set("scope", "repo");
    authorizationUrl.searchParams.set("state", state);
    authorizationUrl.searchParams.set("allow_signup", "true");

    return jsonResponse({ authorizationUrl: authorizationUrl.toString() });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not start GitHub authorization.";
    return jsonResponse({ error: message }, 400);
  }
});
