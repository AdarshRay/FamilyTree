import { handleOptions, jsonResponse } from "../_shared/cors.ts";
import { decryptToken } from "../_shared/crypto.ts";
import { listRepos } from "../_shared/github.ts";
import { adminClient, requireUser } from "../_shared/supabase.ts";

Deno.serve(async (request) => {
  const options = handleOptions(request);
  if (options) return options;

  try {
    if (request.method !== "GET" && request.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

    const user = await requireUser(request);
    const { data, error } = await adminClient()
      .from("github_connections")
      .select("access_token_ciphertext,access_token_nonce")
      .eq("user_id", user.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw new Error("Connect GitHub before loading repositories.");

    const token = await decryptToken(data.access_token_ciphertext, data.access_token_nonce);
    const repos = await listRepos(token);
    return jsonResponse({
      repos: repos.map((repo) => ({
        id: String(repo.id),
        name: repo.name,
        fullName: repo.full_name,
        private: repo.private,
      })),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load GitHub repositories.";
    return jsonResponse({ error: message }, 400);
  }
});
