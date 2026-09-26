/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
  readonly VITE_PUBLIC_VIEW?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

interface Window {
  familyTreeDesktop?: import("./lib/desktop").FamilyTreeDesktopApi;
}
