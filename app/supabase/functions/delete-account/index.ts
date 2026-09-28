import { handleOptions, jsonResponse } from "../_shared/cors.ts";
import { adminClient, requireUser } from "../_shared/supabase.ts";

async function removeTreePhotos(client: ReturnType<typeof adminClient>, treeId: string): Promise<void> {
  const bucket = client.storage.from("family-tree-photos");
  while (true) {
    const { data, error } = await bucket.list(treeId, { limit: 1000, offset: 0 });
    if (error) throw new Error(error.message);
    if (!data?.length) return;
    const { error: removeError } = await bucket.remove(data.map((file) => `${treeId}/${file.name}`));
    if (removeError) throw new Error(removeError.message);
    if (data.length < 1000) return;
  }
}

Deno.serve(async (request) => {
  const options = handleOptions(request);
  if (options) return options;
  if (request.method !== "DELETE") return jsonResponse({ error: "Method not allowed" }, 405);

  try {
    const user = await requireUser(request);
    const client = adminClient();
    const { data: trees, error: treesError } = await client
      .from("family_trees")
      .select("id")
      .eq("owner_id", user.id);
    if (treesError) throw new Error(treesError.message);
    for (const tree of trees ?? []) await removeTreePhotos(client, tree.id);

    const { error } = await client.auth.admin.deleteUser(user.id);
    if (error) throw new Error(error.message);
    return jsonResponse({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not delete this account.";
    return jsonResponse({ error: message }, 400);
  }
});
