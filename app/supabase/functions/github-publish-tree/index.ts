import { handleOptions, jsonResponse } from "../_shared/cors.ts";
import { decryptToken } from "../_shared/crypto.ts";
import { createRepo, ensurePages, getRepo, putBinaryFile, putFile } from "../_shared/github.ts";
import { adminClient, requireTreeOwner, requireUser } from "../_shared/supabase.ts";
import { collectPhotoAssets, generateIndexHtml, generateTreeJson } from "../_shared/site.ts";

interface PublishInput {
  treeId: string;
  repoMode: "new" | "existing";
  repoName?: string;
  existingRepoId?: string;
  visibility: "public" | "private";
}

function slugifyRepoName(value: string): string {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "") || "family-tree"
  );
}

function splitFullName(fullName: string): { owner: string; repo: string } {
  const [owner, repo] = fullName.split("/");
  if (!owner || !repo) throw new Error("Choose a valid GitHub repository.");
  return { owner, repo };
}

Deno.serve(async (request) => {
  const options = handleOptions(request);
  if (options) return options;

  try {
    if (request.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);
    const input = (await request.json()) as PublishInput;
    if (!input.treeId) throw new Error("Choose a tree to publish.");

    const user = await requireUser(request);
    const client = adminClient();
    await requireTreeOwner(client, input.treeId, user.id);

    const { data: connection, error: connectionError } = await client
      .from("github_connections")
      .select("id,github_login,access_token_ciphertext,access_token_nonce")
      .eq("user_id", user.id)
      .maybeSingle();
    if (connectionError) throw new Error(connectionError.message);
    if (!connection) throw new Error("Connect GitHub before publishing.");

    const { data: tree, error: treeError } = await client
      .from("family_trees")
      .select("id,name,root,snapshot")
      .eq("id", input.treeId)
      .maybeSingle();
    if (treeError) throw new Error(treeError.message);
    if (!tree) throw new Error("That family tree could not be found.");

    const token = await decryptToken(connection.access_token_ciphertext, connection.access_token_nonce);
    let repo;
    if (input.repoMode === "new") {
      repo = await createRepo(token, slugifyRepoName(input.repoName ?? tree.name), input.visibility);
    } else {
      const existingRepo = splitFullName(input.existingRepoId ?? "");
      repo = await getRepo(token, existingRepo.owner, existingRepo.repo);
    }

    const owner = repo.owner.login;
    const repoName = repo.name;
    const branch = repo.default_branch || "main";
    const publishedAt = new Date().toISOString();
    const sitePayload = {
      id: tree.id,
      name: tree.name,
      root: tree.root,
      snapshot: tree.snapshot,
      publishedAt,
    };

    let commitSha = await putFile(token, owner, repoName, "data/tree.json", branch, generateTreeJson(sitePayload));
    const photoUploads = await Promise.all(collectPhotoAssets(sitePayload).map(async (asset) => {
      const { data, error } = await client.storage.from("family-tree-photos").download(asset.storagePath);
      if (error || !data) throw new Error(`Could not prepare photo ${asset.storagePath.split("/").pop() ?? ""}.`);
      return putBinaryFile(token, owner, repoName, asset.publishedPath, branch, new Uint8Array(await data.arrayBuffer()));
    }));
    commitSha = photoUploads.filter(Boolean).at(-1) ?? commitSha;
    commitSha = (await putFile(token, owner, repoName, "index.html", branch, generateIndexHtml(sitePayload))) ?? commitSha;
    const pagesUrl = await ensurePages(token, owner, repoName, branch);

    const { data: target, error: targetError } = await client
      .from("tree_publish_targets")
      .upsert(
        {
          tree_id: tree.id,
          owner_id: user.id,
          github_connection_id: connection.id,
          repo_owner: owner,
          repo_name: repoName,
          branch,
          output_path: "/",
          visibility: input.visibility,
          pages_url: pagesUrl,
          last_published_at: publishedAt,
          last_commit_sha: commitSha ?? null,
          updated_at: publishedAt,
        },
        { onConflict: "tree_id,owner_id" },
      )
      .select("id")
      .single();
    if (targetError) throw new Error(targetError.message);

    await client.from("publish_jobs").insert({
      tree_id: tree.id,
      requested_by: user.id,
      target_id: target.id,
      status: "succeeded",
      message: "Published to GitHub Pages.",
      commit_sha: commitSha ?? null,
      pages_url: pagesUrl,
      finished_at: publishedAt,
    });

    return jsonResponse({
      url: pagesUrl,
      repoFullName: `${owner}/${repoName}`,
      commitSha,
      publishedAt,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Publishing failed.";
    return jsonResponse({ error: message }, 400);
  }
});
