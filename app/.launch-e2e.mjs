import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const env = Object.fromEntries(readFileSync(".env.local", "utf8").split(/\r?\n/).filter(Boolean).filter((line) => !line.startsWith("#")).map((line) => { const i = line.indexOf("="); return [line.slice(0, i), line.slice(i + 1)]; }));
const url = env.VITE_SUPABASE_URL;
const anonKey = env.VITE_SUPABASE_ANON_KEY;
if (!url || !anonKey || !serviceKey) throw new Error("Set SUPABASE_SERVICE_ROLE_KEY in the test environment; this test does not access the Mac keychain.");

const stamp = Date.now();
const ownerEmail = `launch-e2e-${stamp}-owner@example.invalid`;
const guestEmail = `launch-e2e-${stamp}-guest@example.invalid`;
const password = `Launch!Ready9-${stamp}`;
const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
const owner = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
const guest = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
const createdIds = [];
let treeId;
const pass = (name) => console.log(`PASS ${name}`);
const must = (condition, name, detail = "") => { if (!condition) throw new Error(`${name}${detail ? `: ${detail}` : ""}`); pass(name); };
const noError = (result, name) => { if (result.error) throw new Error(`${name}: ${result.error.message}`); pass(name); return result.data; };

try {
  for (const [email, displayName] of [[ownerEmail, "Launch Owner"], [guestEmail, "Launch Guest"]]) {
    const result = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: displayName } });
    if (result.error || !result.data.user) throw new Error(`create temporary user: ${result.error?.message ?? "missing user"}`);
    createdIds.push(result.data.user.id);
  }
  pass("temporary verified users created");

  const ownerSession = noError(await owner.auth.signInWithPassword({ email: ownerEmail, password }), "owner password login");
  const guestSession = noError(await guest.auth.signInWithPassword({ email: guestEmail, password }), "guest password login");
  must(Boolean(ownerSession.user && guestSession.user), "authenticated sessions returned");

  const recoveryLink = noError(await admin.auth.admin.generateLink({ type: "recovery", email: guestEmail }), "generate temporary recovery link");
  const recovery = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  noError(await recovery.auth.verifyOtp({ token_hash: recoveryLink.properties.hashed_token, type: "recovery" }), "exchange recovery token");
  const replacementPassword = `Recovered!Ready9-${stamp}`;
  noError(await recovery.auth.updateUser({ password: replacementPassword }), "change recovered password");
  await recovery.auth.signOut();
  const oldLogin = await recovery.auth.signInWithPassword({ email: guestEmail, password });
  must(Boolean(oldLogin.error), "old password rejected after reset");
  noError(await guest.auth.signInWithPassword({ email: guestEmail, password: replacementPassword }), "new password login");

  const oauth = await createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } }).auth.signInWithOAuth({ provider: "google", options: { skipBrowserRedirect: true, redirectTo: "https://adarshray.github.io/FamilyTree/" } });
  must(!oauth.error && Boolean(oauth.data.url?.includes("provider=google")), "Google OAuth initiation");

  const guestProfile = noError(await guest.from("profiles").select("id,tlink_id").eq("id", guestSession.user.id).single(), "guest profile trigger");
  must(Boolean(guestProfile.tlink_id), "guest TLink identity assigned");

  treeId = crypto.randomUUID();
  const personId = crypto.randomUUID();
  const root = { person: { id: personId, name: "Launch Test Founder", gender: "m", photo: null } };
  const snapshot = { overrides: {}, structure: { childrenOf: {}, spouseOf: {}, parentsOf: {}, removed: [], renames: {} } };
  noError(await owner.from("family_trees").insert({ id: treeId, owner_id: ownerSession.user.id, name: "Launch E2E Tree", member_count: 1, cover_names: ["Launch Test Founder"], root, snapshot }), "owner creates tree");
  const createdTree = noError(await owner.from("family_trees").select("id").eq("id", treeId).single(), "owner reads created tree");
  must(createdTree.id === treeId, "created tree persisted");
  const ownerMembership = noError(await owner.from("family_tree_members").select("role").eq("tree_id", treeId).eq("user_id", ownerSession.user.id).single(), "owner membership trigger");
  must(ownerMembership.role === "owner", "owner role assigned");

  const invite = noError(await owner.rpc("invite_family_tree_member", { target_tree_id: treeId, invite_email: guestEmail, invite_role: "viewer" }), "invite existing user");
  must(invite === "member", "existing invite becomes membership");
  const guestTrees = noError(await guest.from("family_trees").select("id,name").eq("id", treeId), "viewer reads shared tree");
  must(guestTrees.length === 1, "viewer tree visibility");
  const deniedUpdate = await guest.from("family_trees").update({ name: "Unauthorized Rename" }).eq("id", treeId).select("id");
  must(!deniedUpdate.error && deniedUpdate.data.length === 0, "viewer update blocked by RLS");
  const ownerUpdate = noError(await owner.from("family_trees").update({ name: "Launch E2E Tree Updated" }).eq("id", treeId).select("id").single(), "owner updates tree");
  must(ownerUpdate.id === treeId, "owner update persisted");

  noError(await owner.rpc("register_tree_people", { target_tree_id: treeId, members: [{ id: personId, name: "Launch Test Founder" }] }), "register tree identity");
  const requestId = noError(await owner.rpc("send_tlink_request", { target_tree_id: treeId, target_local_person_id: personId, recipient_tlink_id: guestProfile.tlink_id, connection_scope: "identity" }), "send TLink request");
  noError(await guest.rpc("respond_tlink_request", { target_request_id: requestId, accept_request: true, target_tree_id: null, target_local_person_id: null }), "accept TLink request");
  const connection = noError(await owner.from("tree_connections").select("id,active").eq("tree_a_id", treeId).single(), "read accepted TLink connection");
  must(connection.active === true, "TLink connection active");
  noError(await owner.rpc("disconnect_tree_connection", { target_connection_id: connection.id, keep_shared_copy: true }), "disconnect TLink connection");

  const pending = noError(await owner.rpc("invite_family_tree_member", { target_tree_id: treeId, invite_email: `pending-${stamp}@example.invalid`, invite_role: "editor" }), "create pending invitation");
  must(pending === "invitation", "pending invitation stored");

  const jpeg = Uint8Array.from([255,216,255,224,0,16,74,70,73,70,0,1,1,0,0,1,0,1,0,0,255,219,0,67,0,8,6,6,7,6,5,8,7,7,7,9,9,8,10,12,20,13,12,11,11,12,25,18,19,15,20,29,26,31,30,29,26,28,28,32,36,46,39,32,34,44,35,28,28,40,55,41,44,48,49,52,52,52,31,39,57,61,56,50,60,46,51,52,50,255,217]);
  const objectPath = `${treeId}/launch-e2e.jpg`;
  noError(await owner.storage.from("family-tree-photos").upload(objectPath, jpeg, { contentType: "image/jpeg", upsert: false }), "photo upload");
  noError(await owner.storage.from("family-tree-photos").upload(objectPath, jpeg, { contentType: "image/jpeg", upsert: true }), "photo upsert");
  const listed = noError(await owner.storage.from("family-tree-photos").list(treeId), "photo listing");
  must(listed.some((file) => file.name === "launch-e2e.jpg"), "uploaded photo visible");
  noError(await owner.storage.from("family-tree-photos").remove([objectPath]), "photo deletion");

  const guestDelete = await guest.functions.invoke("delete-account", { method: "DELETE" });
  if (guestDelete.error) {
    const response = guestDelete.error.context;
    const detail = response instanceof Response ? await response.text() : "";
    throw new Error(`guest account deletion: ${guestDelete.error.message}${detail ? ` — ${detail}` : ""}`);
  }
  await guest.auth.signOut({ scope: "local" });
  const guestLookup = await admin.auth.admin.getUserById(guestSession.user.id);
  must(Boolean(guestLookup.error) || !guestLookup.data.user, "guest account deletion verified");
  createdIds.splice(createdIds.indexOf(guestSession.user.id), 1);

  const ownerDelete = await owner.functions.invoke("delete-account", { method: "DELETE" });
  if (ownerDelete.error) throw new Error(`owner account deletion: ${ownerDelete.error.message}`);
  await owner.auth.signOut({ scope: "local" });
  const ownerLookup = await admin.auth.admin.getUserById(ownerSession.user.id);
  must(Boolean(ownerLookup.error) || !ownerLookup.data.user, "owner account deletion verified");
  createdIds.splice(createdIds.indexOf(ownerSession.user.id), 1);
  const residual = await admin.from("family_trees").select("id").eq("id", treeId);
  must(!residual.error && residual.data.length === 0, "owned tree cascade cleanup");
  console.log("E2E COMPLETE");
} finally {
  if (treeId) await admin.storage.from("family-tree-photos").remove([`${treeId}/launch-e2e.jpg`]);
  for (const id of createdIds) await admin.auth.admin.deleteUser(id);
}
