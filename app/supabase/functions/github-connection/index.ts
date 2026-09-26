import { handleOptions, jsonResponse } from "../_shared/cors.ts";
import { adminClient, requireUser } from "../_shared/supabase.ts";

Deno.serve(async (request) => {
  const options = handleOptions(request);
  if (options) return options;

  try {
    const user = await requireUser(request);
    const client = adminClient();

    if (request.method === "DELETE") {
      const { error } = await client.from("github_connections").delete().eq("user_id", user.id);
      if (error) throw new Error(error.message);
      return jsonResponse({ ok: true });
    }

    if (request.method !== "GET") return jsonResponse({ error: "Method not allowed" }, 405);

    const { data, error } = await client
      .from("github_connections")
      .select("github_login,profile_url,avatar_url,connected_at")
      .eq("user_id", user.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return jsonResponse({ connection: null });

    return jsonResponse({
      connection: {
        username: data.github_login,
        profileUrl: data.profile_url,
        avatarUrl: data.avatar_url,
        connectedAt: data.connected_at,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load GitHub connection.";
    return jsonResponse({ error: message }, 400);
  }
});
