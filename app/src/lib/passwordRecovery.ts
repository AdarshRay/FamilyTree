import { getDesktopAuthRedirectUrl } from "./desktop";
import { supabaseClient } from "./supabase";

export function isPasswordRecoveryUrl(value: string): boolean {
  const url = new URL(value);
  return url.searchParams.get("recovery") === "1" || new URLSearchParams(url.hash.slice(1)).get("type") === "recovery";
}

export async function requestPasswordRecovery(email: string): Promise<void> {
  const client = supabaseClient();
  if (!client) throw new Error("Password recovery requires an online account.");
  const redirect = new URL(await getDesktopAuthRedirectUrl() || new URL(".", window.location.href).toString());
  redirect.searchParams.set("recovery", "1");
  const { error } = await client.auth.resetPasswordForEmail(email.trim(), { redirectTo: redirect.toString() });
  if (error) throw new Error(error.message);
}

export async function updateRecoveredPassword(password: string): Promise<void> {
  if (password.length < 8) throw new Error("Use a password with at least 8 characters.");
  const client = supabaseClient();
  if (!client) throw new Error("Password recovery requires an online account.");
  const { data, error: sessionError } = await client.auth.getSession();
  if (sessionError) throw new Error(sessionError.message);
  if (!data.session) throw new Error("This reset link has expired. Request a new one from Sign In.");
  const { error } = await client.auth.updateUser({ password });
  if (error) throw new Error(error.message);
}
