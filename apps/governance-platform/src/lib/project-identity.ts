import { buildWorkspaceLabel } from "@/lib/workspace-label";

type ProjectIdentityInput = {
  id: string;
  name?: string | null;
  slug?: string | null;
  proposalId?: string | null;
  proposal?: {
    title?: string | null;
    description?: string | null;
  } | null;
};

export function getProjectName(project: ProjectIdentityInput, fallback = "Project"): string {
  const name = project.name?.trim();
  if (name) return name;

  const proposalTitle = project.proposal?.title?.trim();
  if (proposalTitle) return proposalTitle;

  const suffix = project.id.slice(-6);
  return `${fallback} ${suffix}`;
}

export function getProjectDescription(project: ProjectIdentityInput): string | null {
  const description = project.proposal?.description?.trim();
  return description || null;
}

export function getProjectProposalPath(project: Pick<ProjectIdentityInput, "proposalId">): string | null {
  return project.proposalId ? `/proposals/${project.proposalId}` : null;
}

/**
 * RA-216: Use immutable slug for workspace/container identity.
 * Falls back to computing from name if slug not yet set (legacy projects).
 */
export function buildProjectWorkspaceLabel(project: ProjectIdentityInput): string {
  if (project.slug) return project.slug;
  // Fallback for projects created before RA-216
  return buildWorkspaceLabel(getProjectName(project, "project"), project.id);
}
