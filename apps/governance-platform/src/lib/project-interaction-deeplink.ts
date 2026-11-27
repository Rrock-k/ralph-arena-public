import {
  isValidRequiredSecretKey,
  normalizeRequiredSecretKey,
} from "@/lib/required-secrets";

export const PROJECT_INTERACTION_SECRETS_ANCHOR_ID = "project-secrets";
export const PROJECT_INTERACTION_VISUAL_EVIDENCE_ANCHOR_ID = "project-visual-evidence";
const SAFE_VISUAL_EVIDENCE_REVIEW_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;

export type ProjectInteractionFocus =
  | {
      section: "secrets";
      requiredSecretKey: string | null;
      provideSecretKey: string | null;
    }
  | {
      section: "visualEvidence";
      reviewId: string | null;
    }
  | null;

type SearchParamValue = string | string[] | undefined;

function readSingleParam(value: SearchParamValue): string | null {
  const raw = Array.isArray(value) ? value[0] : value;
  return typeof raw === "string" && raw.trim() ? raw.trim() : null;
}

export function normalizeProjectInteractionRequiredSecretKey(
  value: string | null | undefined,
): string | null {
  const key = normalizeRequiredSecretKey(value);
  return key && isValidRequiredSecretKey(key) ? key : null;
}

export function getProjectRequiredSecretAnchorId(key: string): string {
  const normalized = normalizeProjectInteractionRequiredSecretKey(key);
  return normalized
    ? `required-secret-${normalized.toLowerCase().replaceAll("_", "-")}`
    : "required-secret";
}

export function normalizeProjectInteractionVisualEvidenceReviewId(
  value: string | null | undefined,
): string | null {
  const reviewId = value?.trim();
  return reviewId && SAFE_VISUAL_EVIDENCE_REVIEW_ID_RE.test(reviewId) ? reviewId : null;
}

export function parseProjectInteractionFocus(
  searchParams: Record<string, SearchParamValue>,
): ProjectInteractionFocus {
  const focus = readSingleParam(searchParams.focus);
  if (focus === "visualEvidence") {
    return {
      section: "visualEvidence",
      reviewId: normalizeProjectInteractionVisualEvidenceReviewId(
        readSingleParam(searchParams.review),
      ),
    };
  }
  if (focus !== "secrets") return null;

  return {
    section: "secrets",
    requiredSecretKey: normalizeProjectInteractionRequiredSecretKey(
      readSingleParam(searchParams.requiredSecret),
    ),
    provideSecretKey: normalizeProjectInteractionRequiredSecretKey(
      readSingleParam(searchParams.provideSecret),
    ),
  };
}

export function buildProjectVisualEvidenceFocusHref(
  projectId: string,
  reviewId?: string | null,
): string {
  const params = new URLSearchParams({ focus: "visualEvidence" });
  const normalizedReviewId = normalizeProjectInteractionVisualEvidenceReviewId(reviewId);
  if (normalizedReviewId) {
    params.set("review", normalizedReviewId);
  }

  return `/my/projects/${encodeURIComponent(projectId)}?${params.toString()}#${PROJECT_INTERACTION_VISUAL_EVIDENCE_ANCHOR_ID}`;
}

export function buildProjectSecretsFocusHref(
  projectId: string,
  requiredSecretKey?: string | null,
  options: { action?: "provide" } = {},
): string {
  const params = new URLSearchParams({ focus: "secrets" });
  const normalizedKey = normalizeProjectInteractionRequiredSecretKey(requiredSecretKey);
  if (normalizedKey) {
    params.set("requiredSecret", normalizedKey);
    if (options.action === "provide") {
      params.set("provideSecret", normalizedKey);
    }
  }

  return `/my/projects/${encodeURIComponent(projectId)}?${params.toString()}#${PROJECT_INTERACTION_SECRETS_ANCHOR_ID}`;
}
