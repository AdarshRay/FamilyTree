import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { fetchWithTimeout } from "./network";

let cachedClient: SupabaseClient | null | undefined;

export function isSupabaseConfigured(): boolean {
  return Boolean(import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY);
}

export function supabaseClient(): SupabaseClient | null {
  if (cachedClient !== undefined) return cachedClient;

  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    if (import.meta.env.PROD && import.meta.env.VITE_PUBLIC_VIEW !== "1") {
      throw new Error(
        "This deployment is missing its Supabase configuration. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY before building.",
      );
    }
    cachedClient = null;
    return cachedClient;
  }

  cachedClient = createClient(supabaseUrl, supabaseAnonKey, {
    global: {
      fetch: fetchWithTimeout,
    },
    auth: {
      flowType: "pkce",
    },
  });
  return cachedClient;
}
