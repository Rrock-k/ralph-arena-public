import { hasLivePreviewFact } from "@/lib/preview-state";
import { getPrimaryLifecycleComponent } from "@/lib/project-lifecycle";

export const AUTHENTICATED_EXPLORE_VISIBILITIES = ["featured", "public"] as const;
export const GUEST_EXPLORE_VISIBILITIES = ["featured"] as const;

type ExploreProjectVisibilityInput = {
  visibility?: string | null;
  archivedAt?: Date | string | null;
  createdAt?: Date | string | null;
  exploreRank?: number | null;
  components?: Array<{
    previewUrl?: string | null;
    containerName?: string | null;
    previewHealth?: string | null;
    powerIntent?: string | null;
    agentIntent?: string | null;
    runtimeState?: string | null;
    agentState?: string | null;
    lastOutcome?: string | null;
  }> | null;
};

type ExploreViewerInput = {
  isAuthenticated: boolean;
};

export function getExploreVisibilityList(isAuthenticated: boolean): readonly string[] {
  return isAuthenticated ? AUTHENTICATED_EXPLORE_VISIBILITIES : GUEST_EXPLORE_VISIBILITIES;
}

export function getExplorePreviewUrl(project: ExploreProjectVisibilityInput): string | null {
  const primaryComponent = getPrimaryLifecycleComponent(project);
  return primaryComponent?.previewUrl ?? null;
}

function toTimestamp(value: Date | string | null | undefined): number {
  if (!value) return Number.NEGATIVE_INFINITY;
  const ms = new Date(value).getTime();
  return Number.isNaN(ms) ? Number.NEGATIVE_INFINITY : ms;
}

function toExploreRank(value: number | null | undefined): number {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : Number.POSITIVE_INFINITY;
}

export function sortExploreProjects<T extends ExploreProjectVisibilityInput>(projects: T[]): T[] {
  return [...projects].sort((a, b) => {
    const aRank = toExploreRank(a.exploreRank);
    const bRank = toExploreRank(b.exploreRank);
    if (aRank !== bRank) {
      return aRank - bRank;
    }

    const aCreatedAt = toTimestamp(a.createdAt);
    const bCreatedAt = toTimestamp(b.createdAt);
    if (aCreatedAt !== bCreatedAt) {
      return bCreatedAt - aCreatedAt;
    }

    return 0;
  });
}

/**
 * RA-237: Determine explore visibility using component state.
 * Featured/public projects: shown only when the canonical preview boundary
 * says a real preview is live.
 */
export function isProjectVisibleInExplore(
  project: ExploreProjectVisibilityInput,
  viewer: ExploreViewerInput = { isAuthenticated: true },
): boolean {
  const primaryComponent = getPrimaryLifecycleComponent(project);
  const previewUrl = getExplorePreviewUrl(project);
  if (!hasLivePreviewFact(primaryComponent, previewUrl)) return false;

  if (project.visibility === "featured") {
    return !project.archivedAt;
  }

  if (project.visibility === "public") {
    return viewer.isAuthenticated;
  }

  return false;
}
