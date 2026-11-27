import { getProjectName } from "@/lib/project-identity";

type AdminProjectLabelInput = {
  id: string;
  name?: string | null;
  slug?: string | null;
  proposalId?: string | null;
  proposal?: {
    title?: string | null;
    description?: string | null;
  } | null;
};

function getSlugSuffix(slug?: string | null): string | null {
  const normalized = slug?.trim();
  if (!normalized) return null;

  const parts = normalized.split("-").filter(Boolean);
  return parts.at(-1) ?? normalized;
}

export function getAdminProjectIdentitySuffix(project: AdminProjectLabelInput): string {
  return getSlugSuffix(project.slug) ?? project.id.slice(-6);
}

export function getAdminProjectLabel(project: AdminProjectLabelInput): string {
  return `${getProjectName(project)} · ${getAdminProjectIdentitySuffix(project)}`;
}
