import { createClient } from "https://esm.sh/@supabase/supabase-js@2.110.3";
import { env } from "./env.ts";

export function adminClient() {
  return createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: {
      persistSession: false,
    },
  });
}

export function userClient(request: Request) {
  return createClient(env("SUPABASE_URL"), env("SUPABASE_ANON_KEY"), {
    global: {
      headers: {
        Authorization: request.headers.get("Authorization") ?? "",
      },
    },
    auth: {
      persistSession: false,
    },
  });
}

export async function requireUser(request: Request) {
  const { data, error } = await userClient(request).auth.getUser();
  if (error || !data.user) throw new Error("Sign in before continuing.");
  return data.user;
}

export async function requireTreeOwner(client: ReturnType<typeof adminClient>, treeId: string, userId: string) {
  const { data, error } = await client
    .from("family_tree_members")
    .select("role")
    .eq("tree_id", treeId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (data?.role !== "owner") throw new Error("Only the tree owner can publish this tree.");
}
