/**
 * Types extracted from "use server" files.
 * Turbopack (Next.js 15) forbids non-async exports from "use server" modules.
 */

export interface ContainerInfo {
  status: "running" | "stopped" | "not_found" | "error";
  startedAt?: string | null;
  memoryUsageBytes?: number | null;
  memoryLimitBytes?: number | null;
  error?: string;
}

export type ProjectVisibility = "featured" | "public" | "private";

export interface ToggleVoteResult {
  success: boolean;
  error?: string;
  hasVoted?: boolean;
  voteCount?: number;
}

export type SecretListItem = {
  id: string;
  key: string;
  description: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type VpsFleetEntry = {
  /** Hetzner server ID */
  hetznerServerId: string;
  name: string;
  hetznerStatus?: string;
  ip?: string;
  serverType?: string;
  location?: string;
  created?: string;
  /** Linked VpsHost record from DB */
  dbRecord?: {
    id: string;
    status: string;
    region: string;
    serverType: string;
    projectId: string | null;
    projectName: string | null;
    projectStatus: string | null;
    previewDomain: string | null;
  } | null;
  /** true if server exists in Hetzner but not in DB */
  orphan: boolean;
};
