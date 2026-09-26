import { handleOptions, jsonResponse } from "../_shared/cors.ts";
import { adminClient, requireTreeOwner, requireUser } from "../_shared/supabase.ts";

Deno.serve(async (request) => {
  const options = handleOptions(request);
  if (options) return options;

  try {
    if (request.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);
    const { treeId } = (await request.json()) as { treeId?: string };
    if (!treeId) throw new Error("Missing tree id.");

    const user = await requireUser(request);
    const client = adminClient();
    await requireTreeOwner(client, treeId, user.id);

    const { data, error } = await client
      .from("tree_publish_targets")
      .select("repo_owner,repo_name,visibility,pages_url,last_published_at")
      .eq("tree_id", treeId)
      .eq("owner_id", user.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return jsonResponse({ status: { state: "unpublished" } });

    return jsonResponse({
      status: {
        state: "published",
        url: data.pages_url,
        repoFullName: `${data.repo_owner}/${data.repo_name}`,
        visibility: data.visibility,
        publishedAt: data.last_published_at,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load publish status.";
    return jsonResponse({ error: message }, 400);
  }
});
