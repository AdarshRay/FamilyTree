import { type FamilyNode, type Gender } from "../data/family";
import { buildLayout, CARD_H, CARD_W } from "./layout";
import { makeSnapshot, normalizeSnapshot, type FamilyEditsSnapshot } from "./permanent";
import { buildEffectiveFamily, emptyStructure, type EffectiveNode } from "./structure";
import { supabaseClient } from "./supabase";
import { desktopApi, getDesktopAuthRedirectUrl, openDesktopAuthUrl } from "./desktop";

export type AuthProvider = "password" | "google" | "facebook" | "apple";
export type TreeRole = "owner" | "editor" | "viewer";

export interface AppUser {
  id: string;
  displayName: string;
  email: string;
  avatarUrl?: string;
  provider: AuthProvider;
}

export type TLinkScope = "identity" | "branch" | "collaboration";
export type TLinkRequestStatus = "pending" | "accepted" | "declined" | "cancelled";

export interface TreePersonIdentity {
  id: string;
  name: string;
}

export interface TLinkRequest {
  id: string;
  direction: "incoming" | "outgoing";
  sourceTreeId: string;
  sourceTreeName: string;
  sourceLocalPersonId: string;
  sourcePersonName: string;
  scope: TLinkScope;
  status: TLinkRequestStatus;
  createdAt: string;
}

export interface TLinkConnection {
  id: string;
  treeAName: string;
  treeBName?: string;
  personName: string;
  scope: TLinkScope;
  active: boolean;
  createdAt: string;
}

export interface AuthSession {
  user: AppUser;
  accessToken?: string;
}

export interface TreePreviewNode {
  name: string;
  x: number;
  y: number;
  gender?: Gender;
  highlight?: boolean;
}

export interface TreePreview {
  viewBox: string;
  edges: string[];
  nodes: TreePreviewNode[];
}

export interface FamilyTreeSummary {
  id: string;
  name: string;
  ownerId: string;
  role: TreeRole;
  memberCount: number;
  generationCount: number;
  coverNames: string[];
  preview: TreePreview;
  createdAt: string;
  updatedAt: string;
}

export interface FamilyTreeRecord extends FamilyTreeSummary {
  root: FamilyNode;
  snapshot: FamilyEditsSnapshot;
}

export interface TreeInviteInput {
  email: string;
  role: Exclude<TreeRole, "owner">;
}

export interface CreateFamilyTreeInput {
  name: string;
  founderName?: string;
  founderGender?: "m" | "f";
  invites?: TreeInviteInput[];
}

export interface TreeShareMember {
  userId: string;
  email: string;
  displayName: string;
  avatarUrl?: string;
  role: TreeRole;
  createdAt: string;
}

export interface TreeShareInvitation {
  id: string;
  email: string;
  role: Exclude<TreeRole, "owner">;
  createdAt: string;
}

export interface TreeSharing {
  members: TreeShareMember[];
  invitations: TreeShareInvitation[];
}

export interface AuthResult {
  session: AuthSession | null;
  pendingRedirect?: boolean;
}

const SESSION_KEY = "family-tree-auth-session-v1";
const TREES_KEY = "family-tree-records-v1";
const LOCAL_USERS_KEY = "family-tree-local-users-v1";
const LOCAL_INVITES_KEY = "family-tree-local-invites-v1";
interface LocalUserRecord {
  user: AppUser;
  password: string;
}

interface LocalInviteRecord {
  id: string;
  treeId: string;
  email: string;
  role: Exclude<TreeRole, "owner">;
  invitedBy: string;
  acceptedBy?: string;
  acceptedAt?: string;
  createdAt: string;
}

function nowIso(): string {
  return new Date().toISOString();
}

async function oauthRedirectUrl(): Promise<string | undefined> {
  if (typeof window === "undefined") return undefined;
  const desktopRedirectUrl = await getDesktopAuthRedirectUrl();
  if (desktopRedirectUrl) return desktopRedirectUrl;
  return new URL(".", window.location.href).toString();
}

function callbackParams(callbackUrl: string): URLSearchParams {
  const url = new URL(callbackUrl);
  const params = new URLSearchParams(url.search);
  if (url.hash.startsWith("#")) {
    new URLSearchParams(url.hash.slice(1)).forEach((value, key) => params.set(key, value));
  }
  return params;
}

function isStorageAvailable(): boolean {
  return typeof window !== "undefined" && Boolean(window.localStorage);
}

function readJson<T>(key: string, fallback: T): T {
  if (!isStorageAvailable()) return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson<T>(key: string, value: T): void {
  if (!isStorageAvailable()) return;
  window.localStorage.setItem(key, JSON.stringify(value));
}

/** Members/generations on the EFFECTIVE tree (raw root + structure edits + overrides) —
 *  this is what the canvas actually renders, so dashboard stats must match it rather
 *  than counting the static `family.ts` data alone. */
function countEffectiveMembers(node: EffectiveNode): number {
  const spouseCount = node.spouseSlots.reduce((total, slot) => total + 1 + slot.subSpouses.length, 0);
  const childCount = node.children.reduce((total, child) => total + countEffectiveMembers(child), 0);
  return 1 + spouseCount + childCount;
}

function countEffectiveGenerations(node: EffectiveNode): number {
  const childDepth = node.children.map(countEffectiveGenerations);
  return 1 + (childDepth.length ? Math.max(...childDepth) : 0);
}

function computeTreeStats(root: FamilyNode, snapshot: FamilyEditsSnapshot): { memberCount: number; generationCount: number } {
  const effective = buildEffectiveFamily(root, snapshot.structure, snapshot.overrides);
  return {
    memberCount: countEffectiveMembers(effective),
    generationCount: countEffectiveGenerations(effective),
  };
}

function computeTreePreview(root: FamilyNode, snapshot: FamilyEditsSnapshot): TreePreview {
  const effective = buildEffectiveFamily(root, snapshot.structure, snapshot.overrides);
  const layout = buildLayout(effective);
  const highlighted = new Set(coverNames(root));
  return {
    viewBox: `0 0 ${Math.max(1, layout.width)} ${Math.max(1, layout.height)}`,
    edges: layout.edges.map((edge) => edge.d),
    nodes: layout.nodes.flatMap((union) =>
      union.cards.map((card) => ({
        name: card.person.name,
        x: card.x + CARD_W / 2,
        y: card.y + CARD_H / 2,
        gender: card.person.gender,
        highlight: highlighted.has(card.person.name),
      })),
    ),
  };
}

function coverNames(root: FamilyNode): string[] {
  const firstChildren = root.children?.slice(0, 2).map((child) => child.person.name) ?? [];
  return [root.person.name, ...(root.spouses?.map((spouse) => spouse.name) ?? []), ...firstChildren].slice(0, 5);
}

function founderTree(name: string | undefined, gender: Gender | undefined): FamilyNode {
  return {
    person: {
      id: crypto.randomUUID(),
      name: name?.trim() || "New Founder",
      gender: gender ?? "m",
      photo: null,
    },
  };
}

function ensureTreePersonIds(
  rootValue: FamilyNode,
  snapshotValue: FamilyEditsSnapshot,
): { root: FamilyNode; snapshot: FamilyEditsSnapshot; changed: boolean } {
  const root = structuredClone(rootValue);
  const snapshot = structuredClone(normalizeSnapshot(snapshotValue));
  let changed = false;
  const identify = (person: { id?: string }) => {
    if (!person.id) {
      person.id = crypto.randomUUID();
      changed = true;
    }
  };
  const walk = (node: FamilyNode) => {
    identify(node.person);
    node.spouses?.forEach(identify);
    node.children?.forEach(walk);
  };
  walk(root);
  Object.values(snapshot.structure.childrenOf).flat().forEach((child) => {
    identify(child.person);
    if (child.spouse) identify(child.spouse);
  });
  Object.values(snapshot.structure.spouseOf).flat().forEach(identify);
  Object.values(snapshot.structure.parentsOf).forEach(identify);
  return { root, snapshot, changed };
}

export function listTreePeople(root: FamilyNode, snapshot: FamilyEditsSnapshot): TreePersonIdentity[] {
  const identified = ensureTreePersonIds(root, snapshot);
  const effective = buildEffectiveFamily(identified.root, identified.snapshot.structure, identified.snapshot.overrides);
  const people = new Map<string, string>();
  const add = (person: { id?: string; name: string }) => {
    if (person.id) people.set(person.id, person.name);
  };
  const walk = (node: EffectiveNode) => {
    add(node.person);
    node.spouseSlots.forEach((slot) => {
      add(slot.person);
      slot.subSpouses.forEach(add);
    });
    node.children.forEach(walk);
  };
  walk(effective);
  return [...people].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
}

function normalizeTreeRecord(tree: Partial<FamilyTreeRecord>): FamilyTreeRecord {
  const initialRoot = tree.root ?? founderTree(tree.name, "m");
  const createdAt = tree.createdAt ?? nowIso();
  const identified = ensureTreePersonIds(initialRoot, normalizeSnapshot(tree.snapshot));
  const root = identified.root;
  const snapshot = identified.snapshot;
  // Always recompute from root + snapshot rather than trusting a stored count —
  // that count silently goes stale the moment structural edits are saved.
  const stats = computeTreeStats(root, snapshot);
  return {
    id: tree.id ?? `tree_${crypto.randomUUID()}`,
    name: tree.name ?? "Untitled Family Tree",
    ownerId: tree.ownerId ?? "",
    role: tree.role ?? "owner",
    memberCount: stats.memberCount,
    generationCount: stats.generationCount,
    coverNames: tree.coverNames ?? coverNames(root),
    preview: tree.preview ?? computeTreePreview(root, snapshot),
    createdAt,
    updatedAt: tree.updatedAt ?? createdAt,
    root,
    snapshot,
  };
}

function localTrees(): FamilyTreeRecord[] {
  return readJson<Partial<FamilyTreeRecord>[]>(TREES_KEY, []).map(normalizeTreeRecord);
}

function persistLocalTrees(trees: FamilyTreeRecord[]): void {
  writeJson(TREES_KEY, trees);
}

function localUsers(): LocalUserRecord[] {
  return readJson<LocalUserRecord[]>(LOCAL_USERS_KEY, []);
}

function persistLocalUsers(users: LocalUserRecord[]): void {
  writeJson(LOCAL_USERS_KEY, users);
}

function localInvites(): LocalInviteRecord[] {
  return readJson<LocalInviteRecord[]>(LOCAL_INVITES_KEY, []);
}

function persistLocalInvites(invites: LocalInviteRecord[]): void {
  writeJson(LOCAL_INVITES_KEY, invites);
}

function localUserByEmail(email: string): AppUser | null {
  const normalized = email.trim().toLowerCase();
  return localUsers().find((record) => record.user.email.toLowerCase() === normalized)?.user ?? null;
}

async function acceptPendingFamilyTreeInvites(): Promise<void> {
  const client = supabaseClient();
  if (!client) {
    const session = readJson<AuthSession | null>(SESSION_KEY, null);
    if (!session) return;
    const email = session.user.email.trim().toLowerCase();
    const now = nowIso();
    const invites = localInvites().map((invite) =>
      !invite.acceptedAt && invite.email.toLowerCase() === email
        ? { ...invite, acceptedBy: session.user.id, acceptedAt: now }
        : invite,
    );
    persistLocalInvites(invites);
    return;
  }

  const { error } = await client.rpc("accept_pending_family_tree_invites");
  if (error) throw new Error(error.message);
}

function mapSupabaseUser(session: NonNullable<Awaited<ReturnType<NonNullable<ReturnType<typeof supabaseClient>>["auth"]["getSession"]>>["data"]["session"]>): AuthSession {
  const metadata = session.user.user_metadata;
  return {
    accessToken: session.access_token,
    user: {
      id: session.user.id,
      displayName: metadata.full_name ?? metadata.name ?? session.user.email ?? "Family Tree User",
      email: session.user.email ?? "",
      avatarUrl: metadata.avatar_url,
      provider: (session.user.app_metadata.provider as AuthProvider | undefined) ?? "password",
    },
  };
}

export async function getAuthSession(): Promise<AuthSession | null> {
  const client = supabaseClient();
  if (client) {
    const { data, error } = await client.auth.getSession();
    if (error) throw new Error(error.message);
    return data.session ? mapSupabaseUser(data.session) : null;
  }

  return readJson<AuthSession | null>(SESSION_KEY, null);
}

export async function getMyTLinkId(): Promise<string> {
  const client = supabaseClient();
  if (!client) {
    const session = readJson<AuthSession | null>(SESSION_KEY, null);
    if (!session) throw new Error("Sign in to view your TLink ID.");
    return `TLINK-LOCAL-${session.user.id.replace(/[^a-z0-9]/gi, "").slice(-12).toUpperCase()}`;
  }
  const { data: auth } = await client.auth.getUser();
  if (!auth.user) throw new Error("Sign in to view your TLink ID.");
  const { data, error } = await client.from("profiles").select("tlink_id").eq("id", auth.user.id).single();
  if (error) throw new Error(error.message);
  return data.tlink_id as string;
}

export async function listTLinkRequests(): Promise<TLinkRequest[]> {
  const client = supabaseClient();
  if (!client) return [];
  const { data: auth, error: authError } = await client.auth.getUser();
  if (authError) throw new Error(authError.message);
  if (!auth.user) throw new Error("Sign in to view connection requests.");
  const { data, error } = await client
    .from("tlink_requests")
    .select("id,sender_user_id,recipient_user_id,source_tree_id,source_local_person_id,source_tree_name,source_person_name,requested_scope,status,created_at")
    .or(`sender_user_id.eq.${auth.user.id},recipient_user_id.eq.${auth.user.id}`)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map((request) => ({
    id: request.id,
    direction: request.recipient_user_id === auth.user!.id ? "incoming" : "outgoing",
    sourceTreeId: request.source_tree_id,
    sourceTreeName: request.source_tree_name,
    sourceLocalPersonId: request.source_local_person_id,
    sourcePersonName: request.source_person_name,
    scope: request.requested_scope as TLinkScope,
    status: request.status as TLinkRequestStatus,
    createdAt: request.created_at,
  }));
}

export async function listTLinkConnections(): Promise<TLinkConnection[]> {
  const client = supabaseClient();
  if (!client) return [];
  const { data, error } = await client
    .from("tree_connections")
    .select("id,tree_a_name,tree_b_name,person_name,scope,active,created_at")
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map((connection) => ({
    id: connection.id,
    treeAName: connection.tree_a_name ?? "Family tree",
    treeBName: connection.tree_b_name ?? undefined,
    personName: connection.person_name ?? "Connected person",
    scope: connection.scope as TLinkScope,
    active: Boolean(connection.active),
    createdAt: connection.created_at,
  }));
}

export async function sendTLinkRequest(
  treeId: string,
  localPersonId: string,
  tlinkId: string,
  scope: TLinkScope,
): Promise<void> {
  const client = supabaseClient();
  if (!client) throw new Error("Tree connections require the online FamilyTree service.");
  const { error } = await client.rpc("send_tlink_request", {
    target_tree_id: treeId,
    target_local_person_id: localPersonId,
    recipient_tlink_id: tlinkId.trim(),
    connection_scope: scope,
  });
  if (error) throw new Error(error.message);
}

export async function respondTLinkRequest(
  requestId: string,
  accept: boolean,
  target?: { treeId: string; localPersonId: string },
): Promise<void> {
  const client = supabaseClient();
  if (!client) throw new Error("Tree connections require the online FamilyTree service.");
  const { error } = await client.rpc("respond_tlink_request", {
    target_request_id: requestId,
    accept_request: accept,
    target_tree_id: target?.treeId ?? null,
    target_local_person_id: target?.localPersonId ?? null,
  });
  if (error) throw new Error(error.message);
}

export async function cancelTLinkRequest(requestId: string): Promise<void> {
  const client = supabaseClient();
  if (!client) throw new Error("Tree connections require the online FamilyTree service.");
  const { error } = await client.rpc("cancel_tlink_request", { target_request_id: requestId });
  if (error) throw new Error(error.message);
}

export async function setTLinkConnectionActive(connectionId: string, active: boolean): Promise<void> {
  const client = supabaseClient();
  if (!client) throw new Error("Tree connections require the online FamilyTree service.");
  const { error } = await client.rpc("set_tree_connection_active", {
    target_connection_id: connectionId,
    next_active: active,
  });
  if (error) throw new Error(error.message);
}

export async function claimTreePerson(treeId: string, localPersonId: string): Promise<void> {
  const client = supabaseClient();
  if (!client) return;
  const { error } = await client.rpc("claim_tree_person", {
    target_tree_id: treeId,
    target_local_person_id: localPersonId,
  });
  if (error) throw new Error(error.message);
}

export async function signInWithPassword(identifier: string, password: string): Promise<AuthResult> {
  const client = supabaseClient();
  if (client) {
    const { data, error } = await client.auth.signInWithPassword({
      email: identifier,
      password,
    });
    if (error) throw new Error(error.message);
    return { session: data.session ? mapSupabaseUser(data.session) : null };
  }

  const normalized = identifier.trim().toLowerCase();
  const record = localUsers().find(
    ({ user }) =>
      normalized === user.email.toLowerCase() ||
      normalized === user.displayName.toLowerCase() ||
      normalized === user.id.toLowerCase(),
  );

  if (!record || record.password !== password) {
    throw new Error("Invalid user ID or password.");
  }

  const session = { user: record.user };
  writeJson(SESSION_KEY, session);
  return { session };
}

export async function createAccountWithPassword(
  email: string,
  password: string,
  displayName: string,
): Promise<AuthResult> {
  const client = supabaseClient();
  if (client) {
    const { data, error } = await client.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name: displayName,
        },
      },
    });
    if (error) throw new Error(error.message);
    return { session: data.session ? mapSupabaseUser(data.session) : null };
  }

  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail || password.length < 8) {
    throw new Error("Use a valid email and a password with at least 8 characters.");
  }

  const users = localUsers();
  if (users.some((record) => record.user.email.toLowerCase() === normalizedEmail)) {
    throw new Error("An account with this email already exists.");
  }

  const user: AppUser = {
    id: `user_${crypto.randomUUID()}`,
    displayName: displayName.trim() || normalizedEmail.split("@")[0],
    email: normalizedEmail,
    provider: "password",
  };
  persistLocalUsers([...users, { user, password }]);
  const session = { user };
  writeJson(SESSION_KEY, session);
  return { session };
}

export async function updateUserProfile(displayName: string): Promise<AppUser> {
  const trimmed = displayName.trim();
  if (!trimmed) throw new Error("Enter a display name.");
  if (trimmed.length > 80) throw new Error("Display name must be 80 characters or fewer.");

  const client = supabaseClient();
  if (client) {
    const { data: sessionData, error: sessionError } = await client.auth.getSession();
    if (sessionError) throw new Error(sessionError.message);
    if (!sessionData.session) throw new Error("Sign in before updating your profile.");

    const previousName = sessionData.session.user.user_metadata.full_name;
    const { data: authData, error: authError } = await client.auth.updateUser({
      data: { full_name: trimmed },
    });
    if (authError) throw new Error(authError.message);

    const { error: profileError } = await client
      .from("profiles")
      .update({ display_name: trimmed, updated_at: nowIso() })
      .eq("id", authData.user.id);
    if (profileError) {
      await client.auth.updateUser({ data: { full_name: previousName } }).catch(() => undefined);
      throw new Error(profileError.message);
    }

    const refreshed = await client.auth.getSession();
    if (refreshed.error) throw new Error(refreshed.error.message);
    if (!refreshed.data.session) throw new Error("Your profile was saved, but the session could not be refreshed.");
    return mapSupabaseUser(refreshed.data.session).user;
  }

  const session = readJson<AuthSession | null>(SESSION_KEY, null);
  if (!session) throw new Error("Sign in before updating your profile.");
  const updatedUser = { ...session.user, displayName: trimmed };
  writeJson(SESSION_KEY, { ...session, user: updatedUser });
  persistLocalUsers(localUsers().map((record) =>
    record.user.id === updatedUser.id ? { ...record, user: updatedUser } : record,
  ));
  return updatedUser;
}

export async function signInWithSocialProvider(provider: Exclude<AuthProvider, "password">): Promise<AuthResult> {
  const client = supabaseClient();
  if (!client) {
    throw new Error(`${provider} login needs Supabase credentials in .env.local.`);
  }

  const redirectTo = await oauthRedirectUrl();
  const isDesktop = Boolean(desktopApi());
  const { data, error } = await client.auth.signInWithOAuth({
    provider,
    options: {
      ...(redirectTo ? { redirectTo } : {}),
      ...(isDesktop ? { skipBrowserRedirect: true } : {}),
    },
  });
  if (error) throw new Error(error.message);
  if (isDesktop) {
    if (!data.url) throw new Error(`Could not start ${provider} login.`);
    await openDesktopAuthUrl(data.url);
  }
  return { session: null, pendingRedirect: true };
}

export async function completeSocialProviderRedirect(callbackUrl: string): Promise<AuthSession | null> {
  const client = supabaseClient();
  if (!client) return null;

  const params = callbackParams(callbackUrl);
  const errorDescription = params.get("error_description") ?? params.get("error");
  if (errorDescription) throw new Error(errorDescription);

  const code = params.get("code");
  if (code) {
    const { data, error } = await client.auth.exchangeCodeForSession(code);
    if (error) throw new Error(error.message);
    return data.session ? mapSupabaseUser(data.session) : null;
  }

  const accessToken = params.get("access_token");
  const refreshToken = params.get("refresh_token");
  if (accessToken && refreshToken) {
    const { data, error } = await client.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken,
    });
    if (error) throw new Error(error.message);
    return data.session ? mapSupabaseUser(data.session) : null;
  }

  const { data, error } = await client.auth.getSession();
  if (error) throw new Error(error.message);
  return data.session ? mapSupabaseUser(data.session) : null;
}

export async function signOut(): Promise<void> {
  const client = supabaseClient();
  if (client) {
    const { error } = await client.auth.signOut();
    if (error) throw new Error(error.message);
  }

  if (isStorageAvailable()) window.localStorage.removeItem(SESSION_KEY);
}

export async function listFamilyTrees(userId: string): Promise<FamilyTreeSummary[]> {
  const client = supabaseClient();
  if (client) {
    await acceptPendingFamilyTreeInvites();
    const { data, error } = await client
      .from("family_trees")
      .select("id,name,owner_id,member_count,cover_names,root,snapshot,created_at,updated_at,family_tree_members!inner(role,user_id)")
      .eq("family_tree_members.user_id", userId)
      .order("updated_at", { ascending: false });

    if (error) throw new Error(error.message);
    return (data ?? []).map((tree) => {
      const membership = Array.isArray(tree.family_tree_members)
        ? tree.family_tree_members[0]
        : tree.family_tree_members;
      const root = tree.root as FamilyNode;
      const snapshot = normalizeSnapshot(tree.snapshot);
      const stats = computeTreeStats(root, snapshot);
      return {
        id: tree.id,
        name: tree.name,
        ownerId: tree.owner_id,
        role: (membership?.role as TreeRole | undefined) ?? "viewer",
        memberCount: stats.memberCount,
        generationCount: stats.generationCount,
        coverNames: tree.cover_names ?? [],
        preview: computeTreePreview(root, snapshot),
        createdAt: tree.created_at,
        updatedAt: tree.updated_at,
      };
    });
  }

  await acceptPendingFamilyTreeInvites();
  return localTrees()
    .filter((tree) => {
      if (tree.ownerId === userId) return true;
      return localInvites().some((invite) => invite.treeId === tree.id && invite.acceptedBy === userId);
    })
    .map((tree) => {
      if (tree.ownerId === userId) return tree;
      const invite = localInvites().find((entry) => entry.treeId === tree.id && entry.acceptedBy === userId);
      return invite ? { ...tree, role: invite.role } : tree;
    })
    .map(({ root: _root, snapshot: _snapshot, ...summary }) => summary)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function loadFamilyTree(treeId: string): Promise<FamilyTreeRecord | null> {
  const client = supabaseClient();
  if (client) {
    const {
      data: { user },
      error: userError,
    } = await client.auth.getUser();
    if (userError) throw new Error(userError.message);

    const { data, error } = await client.from("family_trees").select("*").eq("id", treeId).maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return null;

    const { data: membership, error: membershipError } = await client
      .from("family_tree_members")
      .select("role")
      .eq("tree_id", treeId)
      .eq("user_id", user?.id ?? "")
      .maybeSingle();
    if (membershipError) throw new Error(membershipError.message);

    const identified = ensureTreePersonIds(data.root as FamilyNode, normalizeSnapshot(data.snapshot));
    const root = identified.root;
    const snapshot = identified.snapshot;
    const role = (membership?.role as TreeRole | undefined) ?? (data.owner_id === user?.id ? "owner" : "viewer");
    if (role !== "viewer") {
      if (identified.changed) {
        const { error: identitySaveError } = await client
          .from("family_trees")
          .update({ root, snapshot })
          .eq("id", treeId);
        if (identitySaveError) throw new Error(identitySaveError.message);
      }
      const { error: identityError } = await client.rpc("register_tree_people", {
        target_tree_id: treeId,
        members: listTreePeople(root, snapshot),
      });
      if (identityError) throw new Error(identityError.message);
    }
    const stats = computeTreeStats(root, snapshot);
    return {
      id: data.id,
      name: data.name,
      ownerId: data.owner_id,
      role,
      memberCount: stats.memberCount,
      generationCount: stats.generationCount,
      coverNames: data.cover_names ?? [],
      preview: computeTreePreview(root, snapshot),
      createdAt: data.created_at,
      updatedAt: data.updated_at,
      root,
      snapshot,
    };
  }

  const session = readJson<AuthSession | null>(SESSION_KEY, null);
  const tree = localTrees().find((entry) => entry.id === treeId);
  if (!tree || !session) return tree ?? null;
  if (tree.ownerId === session.user.id) return tree;
  const invite = localInvites().find((entry) => entry.treeId === treeId && entry.acceptedBy === session.user.id);
  return invite ? { ...tree, role: invite.role } : null;
}

export class TreeSyncConflictError extends Error {
  constructor() {
    super("This tree changed on another device. The latest cloud version has been loaded; please apply your last edit again.");
    this.name = "TreeSyncConflictError";
  }
}

export async function saveFamilyTreeSnapshot(
  treeId: string,
  snapshot: FamilyEditsSnapshot,
  expectedUpdatedAt?: string,
): Promise<string> {
  const nextSnapshot = normalizeSnapshot(snapshot);
  const updatedAt = nextSnapshot.updatedAt ?? nowIso();
  const client = supabaseClient();

  if (client) {
    const { data: existing, error: loadError } = await client
      .from("family_trees")
      .select("root,updated_at")
      .eq("id", treeId)
      .maybeSingle();
    if (loadError) throw new Error(loadError.message);
    if (!existing) throw new Error("That family tree could not be found.");

    const stats = computeTreeStats(existing.root as FamilyNode, nextSnapshot);
    if (expectedUpdatedAt && existing.updated_at !== expectedUpdatedAt) throw new TreeSyncConflictError();

    let update = client
      .from("family_trees")
      .update({
        snapshot: nextSnapshot,
        member_count: stats.memberCount,
        updated_at: updatedAt,
      })
      .eq("id", treeId);
    if (expectedUpdatedAt) update = update.eq("updated_at", expectedUpdatedAt);
    const { data: saved, error } = await update.select("updated_at").maybeSingle();
    if (error) throw new Error(error.message);
    if (!saved) throw new TreeSyncConflictError();
    return saved.updated_at as string;
  }

  const trees = localTrees().map((tree) => {
    if (tree.id !== treeId) return tree;
    const stats = computeTreeStats(tree.root, nextSnapshot);
    return { ...tree, snapshot: nextSnapshot, updatedAt, ...stats };
  });
  persistLocalTrees(trees);
  return updatedAt;
}

export async function renameFamilyTree(treeId: string, name: string): Promise<void> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Enter a name for this family tree.");
  const updatedAt = nowIso();
  const client = supabaseClient();

  if (client) {
    const { error } = await client
      .from("family_trees")
      .update({ name: trimmed, updated_at: updatedAt })
      .eq("id", treeId);
    if (error) throw new Error(error.message);
    return;
  }

  const trees = localTrees().map((tree) =>
    tree.id === treeId ? { ...tree, name: trimmed, updatedAt } : tree,
  );
  persistLocalTrees(trees);
}

export async function deleteFamilyTree(treeId: string): Promise<void> {
  const client = supabaseClient();

  if (client) {
    const { data: userData, error: userError } = await client.auth.getUser();
    if (userError) throw new Error(userError.message);
    if (!userData.user) throw new Error("Sign in before deleting a tree.");
    const { data: membership, error: membershipError } = await client
      .from("family_tree_members")
      .select("role")
      .eq("tree_id", treeId)
      .eq("user_id", userData.user.id)
      .maybeSingle();
    if (membershipError) throw new Error(membershipError.message);
    if (membership?.role !== "owner") throw new Error("Only the tree owner can delete this tree.");

    const bucket = client.storage.from("family-tree-photos");
    for (let offset = 0; ; offset += 1000) {
      const { data: files, error: listError } = await bucket.list(treeId, { limit: 1000, offset });
      if (listError) throw new Error(listError.message);
      if (!files?.length) break;
      const { error: removeError } = await bucket.remove(files.map((file) => `${treeId}/${file.name}`));
      if (removeError) throw new Error(removeError.message);
      if (files.length < 1000) break;
      // Removal shifts the next page to offset zero.
      offset = -1000;
    }

    const { error } = await client.from("family_trees").delete().eq("id", treeId);
    if (error) throw new Error(error.message);
    return;
  }

  const session = readJson<AuthSession | null>(SESSION_KEY, null);
  const tree = localTrees().find((entry) => entry.id === treeId);
  if (!session || !tree) throw new Error("That family tree could not be found.");
  if (tree.ownerId !== session.user.id) throw new Error("Only the tree owner can delete this tree.");
  persistLocalTrees(localTrees().filter((entry) => entry.id !== treeId));
  persistLocalInvites(localInvites().filter((entry) => entry.treeId !== treeId));
}

export async function deleteAccount(): Promise<void> {
  const client = supabaseClient();
  if (client) {
    const { error } = await client.functions.invoke("delete-account", { method: "DELETE" });
    if (error) throw new Error(error.message);
    await client.auth.signOut({ scope: "local" });
    return;
  }

  const session = readJson<AuthSession | null>(SESSION_KEY, null);
  if (!session) throw new Error("Sign in before deleting your account.");
  const ownedTreeIds = new Set(localTrees().filter((tree) => tree.ownerId === session.user.id).map((tree) => tree.id));
  persistLocalTrees(localTrees().filter((tree) => tree.ownerId !== session.user.id));
  persistLocalInvites(localInvites().filter((invite) => !ownedTreeIds.has(invite.treeId) && invite.acceptedBy !== session.user.id));
  persistLocalUsers(localUsers().filter((record) => record.user.id !== session.user.id));
  window.localStorage.removeItem(SESSION_KEY);
}

export async function createFamilyTree(
  ownerId: string,
  input: CreateFamilyTreeInput,
): Promise<FamilyTreeRecord> {
  const client = supabaseClient();
  const id = client ? crypto.randomUUID() : `tree_${crypto.randomUUID()}`;
  const createdAt = nowIso();
  const root = founderTree(input.founderName, input.founderGender);
  const emptySnapshot = makeSnapshot({}, emptyStructure());
  const stats = computeTreeStats(root, emptySnapshot);
  const record: FamilyTreeRecord = {
    id,
    name: input.name.trim() || "Untitled Family Tree",
    ownerId,
    role: "owner",
    memberCount: stats.memberCount,
    generationCount: stats.generationCount,
    coverNames: coverNames(root),
    preview: computeTreePreview(root, emptySnapshot),
    createdAt,
    updatedAt: createdAt,
    root,
    snapshot: emptySnapshot,
  };

  if (client) {
    const { error } = await client.from("family_trees").insert({
      id: record.id,
      name: record.name,
      owner_id: record.ownerId,
      member_count: record.memberCount,
      cover_names: record.coverNames,
      root: record.root,
      snapshot: record.snapshot,
      created_at: record.createdAt,
      updated_at: record.updatedAt,
    });
    if (error) throw new Error(error.message);
    await Promise.all((input.invites ?? []).map((invite) => inviteFamilyTreeMember(record.id, invite)));
    return record;
  }

  persistLocalTrees([record, ...localTrees()]);
  for (const invite of input.invites ?? []) {
    await inviteFamilyTreeMember(record.id, invite);
  }
  return record;
}

export async function inviteFamilyTreeMember(treeId: string, invite: TreeInviteInput): Promise<"member" | "invitation"> {
  const normalizedEmail = invite.email.trim().toLowerCase();
  if (!normalizedEmail || !normalizedEmail.includes("@")) throw new Error("Enter a valid email address.");

  const client = supabaseClient();
  if (client) {
    const { data, error } = await client.rpc("invite_family_tree_member", {
      target_tree_id: treeId,
      invite_email: normalizedEmail,
      invite_role: invite.role,
    });
    if (error) throw new Error(error.message);
    return data === "member" ? "member" : "invitation";
  }

  const session = readJson<AuthSession | null>(SESSION_KEY, null);
  if (!session) throw new Error("Sign in before sharing a tree.");
  const tree = localTrees().find((entry) => entry.id === treeId);
  if (!tree) throw new Error("That family tree could not be found.");
  if (tree.ownerId !== session.user.id) throw new Error("Only the tree owner can manage sharing.");

  const matchedUser = localUserByEmail(normalizedEmail);
  const existingInvites = localInvites();
  const existing = existingInvites.find(
    (entry) => entry.treeId === treeId && entry.email.toLowerCase() === normalizedEmail,
  );
  const now = nowIso();
  const nextInvite: LocalInviteRecord = {
    id: existing?.id ?? `invite_${crypto.randomUUID()}`,
    treeId,
    email: normalizedEmail,
    role: invite.role,
    invitedBy: session.user.id,
    acceptedBy: matchedUser?.id,
    acceptedAt: matchedUser ? (existing?.acceptedAt ?? now) : undefined,
    createdAt: existing?.createdAt ?? now,
  };
  persistLocalInvites([...existingInvites.filter((entry) => entry.id !== nextInvite.id), nextInvite]);
  return matchedUser ? "member" : "invitation";
}

export async function listFamilyTreeSharing(treeId: string): Promise<TreeSharing> {
  const client = supabaseClient();
  if (client) {
    const { data: members, error: membersError } = await client
      .from("family_tree_members")
      .select("tree_id,user_id,role,invited_email,created_at")
      .eq("tree_id", treeId)
      .order("created_at", { ascending: true });
    if (membersError) throw new Error(membersError.message);

    const userIds = [...new Set((members ?? []).map((member) => member.user_id).filter(Boolean))];
    const { data: profiles, error: profilesError } = userIds.length
      ? await client.from("profiles").select("id,display_name,email,avatar_url").in("id", userIds)
      : { data: [], error: null };
    if (profilesError) throw new Error(profilesError.message);
    const profileById = new Map((profiles ?? []).map((profile) => [profile.id, profile]));

    const { data: invitations, error: invitationsError } = await client
      .from("family_tree_invitations")
      .select("id,invited_email,role,created_at,accepted_at")
      .eq("tree_id", treeId)
      .is("accepted_at", null)
      .order("created_at", { ascending: false });
    if (invitationsError) throw new Error(invitationsError.message);

    return {
      members: (members ?? []).map((member) => {
        const profile = profileById.get(member.user_id);
        return {
          userId: member.user_id,
          email: profile?.email ?? member.invited_email ?? "",
          displayName: profile?.display_name ?? profile?.email ?? member.invited_email ?? "Shared user",
          avatarUrl: profile?.avatar_url ?? undefined,
          role: member.role as TreeRole,
          createdAt: member.created_at,
        };
      }),
      invitations: (invitations ?? []).map((invite) => ({
        id: invite.id,
        email: invite.invited_email,
        role: invite.role as Exclude<TreeRole, "owner">,
        createdAt: invite.created_at,
      })),
    };
  }

  const tree = localTrees().find((entry) => entry.id === treeId);
  if (!tree) throw new Error("That family tree could not be found.");
  const users = localUsers().map((entry) => entry.user);
  const memberInvites = localInvites().filter((invite) => invite.treeId === treeId && invite.acceptedBy);
  const pendingInvites = localInvites().filter((invite) => invite.treeId === treeId && !invite.acceptedBy);
  return {
    members: [
      {
        userId: tree.ownerId,
        email: users.find((user) => user.id === tree.ownerId)?.email ?? "",
        displayName: users.find((user) => user.id === tree.ownerId)?.displayName ?? "Owner",
        role: "owner",
        createdAt: tree.createdAt,
      },
      ...memberInvites.map((invite) => {
        const sharedUser = users.find((user) => user.id === invite.acceptedBy);
        return {
          userId: invite.acceptedBy ?? "",
          email: sharedUser?.email ?? invite.email,
          displayName: sharedUser?.displayName ?? invite.email,
          avatarUrl: sharedUser?.avatarUrl,
          role: invite.role,
          createdAt: invite.createdAt,
        };
      }),
    ],
    invitations: pendingInvites.map((invite) => ({
      id: invite.id,
      email: invite.email,
      role: invite.role,
      createdAt: invite.createdAt,
    })),
  };
}

export async function updateFamilyTreeMemberRole(
  treeId: string,
  userId: string,
  role: Exclude<TreeRole, "owner">,
): Promise<void> {
  const client = supabaseClient();
  if (client) {
    const { error } = await client
      .from("family_tree_members")
      .update({ role })
      .eq("tree_id", treeId)
      .eq("user_id", userId)
      .neq("role", "owner");
    if (error) throw new Error(error.message);
    return;
  }

  persistLocalInvites(
    localInvites().map((invite) =>
      invite.treeId === treeId && invite.acceptedBy === userId ? { ...invite, role } : invite,
    ),
  );
}

export async function removeFamilyTreeMember(treeId: string, userId: string): Promise<void> {
  const client = supabaseClient();
  if (client) {
    const { error } = await client
      .from("family_tree_members")
      .delete()
      .eq("tree_id", treeId)
      .eq("user_id", userId)
      .neq("role", "owner");
    if (error) throw new Error(error.message);
    return;
  }

  persistLocalInvites(localInvites().filter((invite) => !(invite.treeId === treeId && invite.acceptedBy === userId)));
}

export async function updateFamilyTreeInvitationRole(
  invitationId: string,
  role: Exclude<TreeRole, "owner">,
): Promise<void> {
  const client = supabaseClient();
  if (client) {
    const { error } = await client.from("family_tree_invitations").update({ role, updated_at: nowIso() }).eq("id", invitationId);
    if (error) throw new Error(error.message);
    return;
  }

  persistLocalInvites(localInvites().map((invite) => (invite.id === invitationId ? { ...invite, role } : invite)));
}

export async function removeFamilyTreeInvitation(invitationId: string): Promise<void> {
  const client = supabaseClient();
  if (client) {
    const { error } = await client.from("family_tree_invitations").delete().eq("id", invitationId);
    if (error) throw new Error(error.message);
    return;
  }

  persistLocalInvites(localInvites().filter((invite) => invite.id !== invitationId));
}
