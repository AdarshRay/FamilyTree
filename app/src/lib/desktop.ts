import type { FamilyEditsSnapshot } from "./permanent";

export interface DesktopResult {
  ok: boolean;
  cancelled?: boolean;
  message?: string;
  path?: string;
}

export interface DesktopLoadResult extends DesktopResult {
  snapshot?: Partial<FamilyEditsSnapshot> | null;
}

export interface FamilyTreeDesktopApi {
  isDesktop: true;
  platform: string;
  loadSnapshot: () => Promise<DesktopLoadResult>;
  saveSnapshot: (snapshot: FamilyEditsSnapshot) => Promise<DesktopResult>;
  backupSnapshot: (snapshot: FamilyEditsSnapshot) => Promise<DesktopResult>;
  restoreSnapshot: () => Promise<DesktopLoadResult>;
  publishToGitHub: (snapshot: FamilyEditsSnapshot) => Promise<DesktopResult>;
  getAuthRedirectUrl: () => Promise<string>;
  openExternalAuthUrl: (url: string) => Promise<void>;
  onAuthCallbackUrl: (callback: (url: string) => void) => () => void;
  closeWindow: () => Promise<void>;
  minimizeWindow: () => Promise<void>;
  toggleMaximizeWindow: () => Promise<void>;
  onUndoRequested: (callback: () => void) => () => void;
  onSaveRequested: (callback: () => void) => () => void;
}

export function desktopApi(): FamilyTreeDesktopApi | undefined {
  return window.familyTreeDesktop;
}

export async function loadDesktopSnapshot(): Promise<Partial<FamilyEditsSnapshot> | null | undefined> {
  const api = desktopApi();
  if (!api) return undefined;
  const result = await api.loadSnapshot();
  if (!result.ok) throw new Error(result.message ?? "Could not load Mac app data.");
  return result.snapshot ?? null;
}

export async function persistDesktopSnapshot(snapshot: FamilyEditsSnapshot): Promise<boolean> {
  const api = desktopApi();
  if (!api) return false;
  const result = await api.saveSnapshot(snapshot);
  if (!result.ok) throw new Error(result.message ?? "Could not save Mac app data.");
  return true;
}

export async function backupDesktopSnapshot(snapshot: FamilyEditsSnapshot): Promise<DesktopResult> {
  const api = desktopApi();
  if (!api) return { ok: false, message: "Mac app backup is unavailable." };
  return api.backupSnapshot(snapshot);
}

export async function restoreDesktopSnapshot(): Promise<DesktopLoadResult> {
  const api = desktopApi();
  if (!api) return { ok: false, message: "Mac app restore is unavailable." };
  return api.restoreSnapshot();
}

export async function publishDesktopSnapshot(snapshot: FamilyEditsSnapshot): Promise<DesktopResult> {
  const api = desktopApi();
  if (!api) return { ok: false, message: "GitHub publishing is unavailable." };
  return api.publishToGitHub(snapshot);
}

export async function getDesktopAuthRedirectUrl(): Promise<string | undefined> {
  return desktopApi()?.getAuthRedirectUrl();
}

export async function openDesktopAuthUrl(url: string): Promise<boolean> {
  const api = desktopApi();
  if (!api) return false;
  await api.openExternalAuthUrl(url);
  return true;
}

export function onDesktopAuthCallbackUrl(callback: (url: string) => void): () => void {
  return desktopApi()?.onAuthCallbackUrl(callback) ?? (() => {});
}

export function closeDesktopWindow(): void {
  void desktopApi()?.closeWindow();
}

export function minimizeDesktopWindow(): void {
  void desktopApi()?.minimizeWindow();
}

export function toggleMaximizeDesktopWindow(): void {
  void desktopApi()?.toggleMaximizeWindow();
}

/** Fires when the Mac app's Edit > Undo menu item (Cmd+Z) is used. Returns an unsubscribe function. */
export function onDesktopUndoRequested(callback: () => void): () => void {
  return desktopApi()?.onUndoRequested(callback) ?? (() => {});
}

/** Fires when the Mac app's File > Save menu item (Cmd+S) is used. Returns an unsubscribe function. */
export function onDesktopSaveRequested(callback: () => void): () => void {
  return desktopApi()?.onSaveRequested(callback) ?? (() => {});
}
