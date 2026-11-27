function slugify(title: string): string {
  return title
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

export function buildWorkspaceLabel(proposalTitle: string, projectId: string): string {
  const titleSlug = slugify(proposalTitle) || "project";
  const idSuffix = projectId.slice(-6).toLowerCase().replace(/[^a-z0-9]+/g, "");
  return `${titleSlug}-${idSuffix || "local"}`;
}
