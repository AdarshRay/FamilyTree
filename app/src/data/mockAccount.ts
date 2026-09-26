import type { TreePreview, TreeRole } from "../lib/backend";

export interface AccountUser {
  name: string;
  email: string;
  avatarUrl?: string;
}

export interface TreeSummary {
  id: string;
  name: string;
  subtitle: string;
  role: TreeRole;
  memberCount: number;
  generationCount: number;
  updatedLabel: string;
  preview: TreePreview;
}

export const ROLE_LABEL: Record<TreeRole, string> = {
  owner: "Owner",
  editor: "Editor",
  viewer: "Viewer",
};
