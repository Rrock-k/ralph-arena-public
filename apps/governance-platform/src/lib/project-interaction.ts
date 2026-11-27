import "server-only";

import { createHash } from "node:crypto";
import {
  ProjectInteractionSnapshotSchema,
  type AcceptedSpecArtifact,
  type AcceptedDiffItem,
  type AssumptionItem,
  type FeedbackItem,
  type ProjectInteractionAcceptedUpdate,
  type ProjectInteractionAllowedActions,
  type ProjectInteractionAssumption,
  type ProjectInteractionAssumptionReview,
  type ProjectInteractionChangeBatch,
  type ProjectInteractionExecution,
  type ProjectInteractionExecutionEvent,
  type ProjectInteractionFeedback,
  type ProjectInteractionMacBuild,
  type ProjectInteractionProofArtifact,
  type ProjectInteractionProofReview,
  type ProjectInteractionProgress,
  type ProjectInteractionProgressRaw,
  type ProjectInteractionSectionAccess,
  type ProjectInteractionSnapshot,
  type ProjectInteractionStatusSummary,
  type ProjectInteractionSurface,
  type ProjectInteractionTask,
  type ProjectInteractionVisualEvidenceArtifact,
  type ProjectInteractionVisualEvidenceReview,
  type ProjectInteractionVisualEvidenceReviewStatus,
  parseAcceptedSpecArtifact,
} from "@arena/contracts";
import type { AccessCapability } from "@/lib/access-control/types";
import { resolveLoopSupport, runtimeConfigUsesRepoHead } from "@/lib/loop-support";
import { getPrimaryLifecycleComponent, getPublicDisplayStatus } from "@/lib/project-lifecycle";
import { getPreferredPreviewUrl } from "@/lib/preview-url";
import { prisma } from "@/lib/prisma";
import {
  isUserVisibleProjectAsset,
  readProjectAssetBytes,
  resolveVisualEvidenceArtifactAsset,
} from "@/lib/project-assets";
import {
  listProjectReleaseArtifacts,
  type ProjectReleaseArtifactRecord,
} from "@/lib/project-release-artifacts";
import { parseRequiredSecrets } from "@/lib/required-secrets";
import { resolveProjectAccess } from "@/lib/project-access";
import { buildProjectVisualEvidenceFocusHref } from "@/lib/project-interaction-deeplink";
import { getTgSpecLaunchConfigurationState, isTgSpecTargetSourceConfig } from "@/lib/tg-spec-target";
import type { Session } from "next-auth";

const RECENT_RUN_EVENT_LIMIT = 12;
const RECENT_PROJECT_EVENT_LIMIT = 12;
const PROJECT_INTERACTION_COLLECTION_LIMIT = 100;
const SAFE_RUN_EVENT_RE = /^[A-Z][A-Z0-9_:-]{0,63}$/;
const SAFE_PROJECT_EVENT_TYPE_RE = /^[a-z][a-z0-9_:-]{0,63}$/;
const SAFE_PROOF_REVIEW_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;
const SAFE_PROOF_ASSET_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;
const SAFE_PROOF_DIGEST_RE = /^[A-Za-z0-9:_-]{1,160}$/;
const SAFE_PROOF_IMAGE_CONTENT_TYPE_RE = /^image\/[a-z0-9.+-]+$/i;
const SAFE_VISUAL_EVIDENCE_REF_RE = /^[A-Za-z0-9._:-]{1,420}$/;
const SAFE_VISUAL_FEEDBACK_ID_RE = /^[A-Za-z0-9_:\-./]{1,160}$/;
const SAFE_VISUAL_ARTIFACT_DIGEST_RE = /^sha256:[a-f0-9]{64}$/;

type DateLike = Date | string | null | undefined;

type InteractionAccess = Awaited<ReturnType<typeof resolveProjectAccess>>;
type ProgressRecord = Record<string, unknown>;
type ProjectInteractionAudience = ProjectInteractionSnapshot["viewer"]["audience"];

type BuildProjectInteractionSnapshotOptions = {
  surface?: ProjectInteractionSurface;
};

type ProjectInteractionCollections = ProjectInteractionSnapshot["collections"];
type LimitedCollection<T> = {
  items: T[];
  meta: ProjectInteractionCollections[keyof ProjectInteractionCollections];
};

type InteractionProject = {
  id: string;
  name: string;
  slug: string | null;
  mode: string;
  visibility: string;
  ownerScopeType: string | null;
  ownerScopeId: string | null;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  tgSpecSourceProjectId: string | null;
  tgSpecMirrorSpecId: string | null;
  tgSpecLastImportedVersion: number | null;
  agentImpl: string | null;
  progressJson: string | null;
  requiredSecrets: string | null;
  components: Array<{
    id: string;
    kind: string | null;
    powerIntent: string | null;
    agentIntent: string | null;
    runtimeState: string | null;
    agentState: string | null;
    blockers: string[] | null;
    lastOutcome: string | null;
    lastOutcomeAt: Date | null;
    previewHealth: string | null;
    previewCheckedAt: Date | null;
    retryAt: Date | null;
    retryCount: number | null;
    containerName: string | null;
    previewUrl: string | null;
    workerHost: string | null;
    lastHeartbeat: Date | null;
    sourceConfig: unknown;
    runtimeConfig: unknown;
  }>;
  vpsHost: {
    previewDomain: string | null;
  } | null;
  agentLoopVersion: {
    version: string | null;
    supportTier: string | null;
    agentLoop: {
      name: string | null;
    } | null;
  } | null;
  specs: Array<{
    id: string;
    title: string | null;
    content: string;
    orderIndex: number;
    createdAt: Date;
    updatedAt: Date;
    versions: Array<{
      id: string;
      version: number;
      content: string;
      message: string | null;
      createdAt: Date;
      updatedAt?: Date | null;
      acceptedArtifact?: unknown;
    }>;
  }>;
  assets: Array<{
    id: string;
    path: string;
    originalName: string;
    contentType: string | null;
    sizeBytes: number;
    sha256: string;
    uploadedById: string | null;
    createdAt: Date;
    updatedAt: Date;
  }>;
  releaseArtifacts?: ProjectReleaseArtifactRecord[];
  secrets: Array<{
    id: string;
    key: string;
    description: string | null;
    createdAt: Date;
    updatedAt: Date;
  }>;
  budget: {
    isEnabled: boolean;
    totalCreditsUsd: number;
    usedCreditsUsd: number;
  } | null;
  runLogs: Array<{
    id: string;
    event: string;
    createdAt: Date;
  }>;
  events: Array<{
    id: string;
    direction: string;
    type: string;
    userId: string | null;
    createdAt: Date;
  }>;
};

export type ProjectInteractionResult =
  | { status: "ok"; snapshot: ProjectInteractionSnapshot }
  | { status: "unauthorized" }
  | { status: "forbidden" }
  | { status: "not_found" };

function toIso(value: DateLike): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  return value;
}

const emptyProgress = (): ProjectInteractionProgress => ({
  summary: {
    state: null,
    message: null,
    iteration: null,
    featuresCompleted: null,
    featuresTotal: null,
    currentFeature: null,
  },
  raw: null,
});

function isProgressRecord(value: unknown): value is ProgressRecord {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function stringField(record: ProgressRecord, key: string): string | null {
  const value = record[key];
  return typeof value === "string" ? value : null;
}

function integerField(record: ProgressRecord, key: string): number | null {
  const value = record[key];
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

function optionalStringField(record: ProgressRecord, key: string): string | undefined {
  return stringField(record, key) ?? undefined;
}

function optionalIntegerField(record: ProgressRecord, key: string): number | undefined {
  return integerField(record, key) ?? undefined;
}

function sanitizeArtifactLikeId(value: string | null | undefined): string | null {
  const trimmed = value?.trim().toUpperCase();
  return trimmed && /^[A-Z][A-Z0-9_:-]{1,119}$/.test(trimmed) ? trimmed : null;
}

function currentFeatureSummary(record: ProgressRecord): string | null {
  const currentFeature = record.currentFeature;
  if (typeof currentFeature === "string") return currentFeature;
  if (!isProgressRecord(currentFeature)) return null;
  return stringField(currentFeature, "description") ?? stringField(currentFeature, "title");
}

function sanitizeProgressFeature(value: unknown): ProjectInteractionProgressRaw["currentFeature"] | null {
  if (typeof value === "string") {
    return value.trim() ? { description: value } : null;
  }
  if (!isProgressRecord(value)) return null;

  const description =
    stringField(value, "description")
    ?? stringField(value, "label")
    ?? stringField(value, "title");
  if (!description) return null;

  const id = stringField(value, "id");
  return {
    ...(id ? { id } : {}),
    description,
  };
}

function sanitizeRecentFeatures(value: unknown): ProjectInteractionProgressRaw["recentFeatures"] | undefined {
  if (!Array.isArray(value)) return undefined;
  const features = value
    .map((entry) => sanitizeProgressFeature(entry))
    .filter((entry): entry is NonNullable<ProjectInteractionProgressRaw["currentFeature"]> => !!entry)
    .slice(0, 20);
  return features.length ? features : undefined;
}

function normalizeTaskStatus(value: unknown): ProjectInteractionTask["status"] | null {
  switch (value) {
    case "pending":
    case "in_progress":
    case "completed":
    case "failed":
    case "skipped":
      return value;
    default:
      return null;
  }
}

function limitCollection<T>(items: T[]): LimitedCollection<T> {
  const visibleItems = items.slice(0, PROJECT_INTERACTION_COLLECTION_LIMIT);
  return {
    items: visibleItems,
    meta: {
      total: items.length,
      visible: visibleItems.length,
      limit: PROJECT_INTERACTION_COLLECTION_LIMIT,
      hasMore: items.length > visibleItems.length,
    },
  };
}

function taskDisplayRank(status: ProjectInteractionTask["status"]): number {
  switch (status) {
    case "in_progress":
      return 0;
    case "failed":
      return 1;
    case "pending":
      return 2;
    case "completed":
      return 3;
    case "skipped":
      return 4;
  }
}

function compareTasksForDisplay(
  left: ProjectInteractionTask,
  right: ProjectInteractionTask,
): number {
  return taskDisplayRank(left.status) - taskDisplayRank(right.status)
    || left.orderIndex - right.orderIndex
    || left.id.localeCompare(right.id);
}

function sanitizeProgressSteps(
  value: unknown,
  options: { includeDescriptions?: boolean } = {},
): ProjectInteractionTask[] | undefined {
  if (!Array.isArray(value)) return undefined;

  const tasks: ProjectInteractionTask[] = [];
  for (const [index, step] of value.entries()) {
    if (!isProgressRecord(step)) continue;
    const id = stringField(step, "id");
    const status = normalizeTaskStatus(step.status);
    if (!id || !status) continue;
    const label = stringField(step, "displayTitle")
      ?? stringField(step, "label")
      ?? stringField(step, "title")
      ?? stringField(step, "description")
      ?? id;
    const description = options.includeDescriptions
      ? compactMultilineText(optionalStringField(step, "description"), 4000)
      : null;
    tasks.push({
      id,
      label,
      ...(description && description !== label ? { description } : {}),
      status,
      orderIndex: index,
      source: null,
    });
  }

  return tasks.length ? tasks : undefined;
}

function sanitizeProgressAssumptionReview(value: unknown): ProjectInteractionAssumptionReview | null {
  if (!isProgressRecord(value)) return null;

  const id = sanitizeArtifactLikeId(stringField(value, "id"));
  if (!id || id.startsWith("JUDGMENT-")) return null;

  const title = optionalStringField(value, "title")?.replace(/\s+/g, " ").trim().slice(0, 200);
  const statement = optionalStringField(value, "statement")?.replace(/\s+/g, " ").trim().slice(0, 8000);
  if (!title || !statement) return null;
  if (isLoopEvidenceAssumptionReview(title, statement)) return null;

  const sourceRefs = Array.isArray(value.sourceRefs)
    ? Array.from(new Set(value.sourceRefs
        .map((ref) => sanitizeArtifactLikeId(typeof ref === "string" ? ref : null))
        .filter((ref): ref is string => typeof ref === "string" && !ref.startsWith("JUDGMENT-"))))
    : [];

  return {
    id,
    title,
    statement,
    sourceRefs,
  };
}

function isLoopEvidenceAssumptionReview(title: string, statement: string): boolean {
  const normalizedTitle = title.toLowerCase();
  const normalizedStatement = statement.toLowerCase();
  return normalizedTitle.startsWith("needs confirmation for ")
    || (normalizedStatement.includes("appears implemented")
      && normalizedStatement.includes("product evidence has not confirmed"));
}

function sanitizeProgressAssumptionReviews(value: unknown): ProjectInteractionAssumptionReview[] | undefined {
  if (!Array.isArray(value)) return undefined;

  const reviews = value
    .map((entry) => sanitizeProgressAssumptionReview(entry))
    .filter((entry): entry is ProjectInteractionAssumptionReview => !!entry)
    .slice(0, PROJECT_INTERACTION_COLLECTION_LIMIT);

  return reviews.length ? reviews : undefined;
}

function sanitizeProgressRaw(
  record: ProgressRecord,
  options: { includeStepDescriptions?: boolean } = {},
): ProjectInteractionProgressRaw | null {
  const raw: ProjectInteractionProgressRaw = {};
  const state = optionalStringField(record, "state");
  const message = optionalStringField(record, "message");
  const iteration = optionalIntegerField(record, "iteration");
  const featuresCompleted = optionalIntegerField(record, "featuresCompleted");
  const featuresTotal = optionalIntegerField(record, "featuresTotal");
  const currentFeature = sanitizeProgressFeature(record.currentFeature);
  const recentFeatures = sanitizeRecentFeatures(record.recentFeatures);
  const steps = sanitizeProgressSteps(record.steps, {
    includeDescriptions: options.includeStepDescriptions === true,
  });
  const assumptionReviews = sanitizeProgressAssumptionReviews(record.assumptionReviews);

  if (state !== undefined) raw.state = state;
  if (message !== undefined) raw.message = message;
  if (iteration !== undefined) raw.iteration = iteration;
  if (featuresCompleted !== undefined) raw.featuresCompleted = featuresCompleted;
  if (featuresTotal !== undefined) raw.featuresTotal = featuresTotal;
  if (currentFeature) raw.currentFeature = currentFeature;
  if (recentFeatures) raw.recentFeatures = recentFeatures;
  if (steps) raw.steps = steps;
  if (assumptionReviews) raw.assumptionReviews = assumptionReviews;

  return Object.keys(raw).length ? raw : null;
}

function parseProgress(
  raw: string | null,
  options: { includeStepDescriptions?: boolean } = {},
): ProjectInteractionProgress {
  if (!raw) return emptyProgress();
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isProgressRecord(parsed)) return emptyProgress();
    return {
      summary: {
        state: stringField(parsed, "state"),
        message: stringField(parsed, "message"),
        iteration: integerField(parsed, "iteration"),
        featuresCompleted: integerField(parsed, "featuresCompleted"),
        featuresTotal: integerField(parsed, "featuresTotal"),
        currentFeature: currentFeatureSummary(parsed),
      },
      raw: sanitizeProgressRaw(parsed, options),
    };
  } catch {
    return emptyProgress();
  }
}

function progressTaskSource(
  progress: ProjectInteractionProgress,
  tasks: ProjectInteractionTask[],
  options: { allowRawStepsFallback?: boolean } = {},
): ProjectInteractionTask[] {
  if (tasks.length > 0) return tasks;
  if (options.allowRawStepsFallback === false) return [];
  return progress.raw?.steps ?? [];
}

function executionProgress(
  progress: ProjectInteractionProgress,
  tasks: ProjectInteractionTask[],
  options: { allowRawStepsFallback?: boolean } = {},
): ProjectInteractionExecutionEvent["progress"] {
  const source = progressTaskSource(progress, tasks, options);
  if (options.allowRawStepsFallback === false && source.length === 0) return null;
  const completedFromTasks = source.filter((task) => task.status === "completed" || task.status === "skipped").length;
  const completed = source.length > 0
    ? completedFromTasks
    : progress.summary.featuresCompleted ?? (source.length > 0 ? completedFromTasks : null);
  const total = source.length > 0
    ? source.length
    : progress.summary.featuresTotal ?? (source.length > 0 ? source.length : null);
  const percent = total && total > 0 && completed !== null
    ? Math.max(0, Math.min(100, Math.round((completed / total) * 100)))
    : null;

  if (completed === null && total === null && percent === null) return null;
  return { completed, total, percent };
}

function currentExecutionTask(
  progress: ProjectInteractionProgress,
  tasks: ProjectInteractionTask[],
  options: { allowRawStepsFallback?: boolean } = {},
): ProjectInteractionTask | null {
  const source = progressTaskSource(progress, tasks, options);
  const explicit = source.find((task) => task.status === "in_progress") ?? null;
  if (explicit) return explicit;

  const currentFeature = progress.raw?.currentFeature;
  const label = currentFeature?.description ?? progress.summary.currentFeature;
  if (!label) return null;
  return {
    id: currentFeature?.id ?? "progress-current",
    label,
    status: "in_progress",
    orderIndex: source.length,
    source: null,
  };
}

function rawProgressStepDiffItemIds(step: ProgressRecord): string[] {
  const refs = Array.isArray(step.feedbackItemRefs) ? step.feedbackItemRefs : [];
  return Array.from(new Set(refs
    .map((rawRef) => {
      if (!isProgressRecord(rawRef)) return null;
      return sanitizeArtifactLikeId(stringField(rawRef, "diffItemId"));
    })
    .filter((id): id is string => typeof id === "string")));
}

function screenshotProofExpectationRecord(step: ProgressRecord): ProgressRecord | null {
  const expectations = Array.isArray(step.proofExpectations) ? step.proofExpectations : [];
  return expectations.find((expectation): expectation is ProgressRecord => (
    isProgressRecord(expectation)
      && stringField(expectation, "kind") === "before_after_screenshot"
  )) ?? null;
}

function progressStepHasScreenshotProofExpectation(step: ProgressRecord): boolean {
  return screenshotProofExpectationRecord(step) !== null;
}

function proofEvidenceRecord(step: ProgressRecord, role: "before" | "after"): ProgressRecord | null {
  const expectation = screenshotProofExpectationRecord(step);
  const evidence = Array.isArray(expectation?.evidence) ? expectation.evidence : [];
  const roles = role === "before"
    ? new Set(["before", "before_after"])
    : new Set(["after", "before_after"]);

  return evidence.find((row): row is ProgressRecord => (
    isProgressRecord(row)
      && stringField(row, "kind") === "screenshot"
      && roles.has(stringField(row, "role") ?? "")
  )) ?? null;
}

function cleanProofReviewId(value: string): string {
  const normalized = value.replace(/[^A-Za-z0-9._:-]/g, "-").slice(0, 150);
  const id = `proof:${normalized || "task"}`;
  return SAFE_PROOF_REVIEW_ID_RE.test(id) ? id : "proof:task";
}

function cleanProofAssetId(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed && SAFE_PROOF_ASSET_ID_RE.test(trimmed) ? trimmed : null;
}

function cleanProofContentType(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed && SAFE_PROOF_IMAGE_CONTENT_TYPE_RE.test(trimmed) ? trimmed : null;
}

function cleanProofDigest(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed && SAFE_PROOF_DIGEST_RE.test(trimmed) ? trimmed : null;
}

function cleanProofCapturedAt(value: string | null | undefined): string | null {
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function isSafeProjectAssetPath(value: string | null | undefined): value is string {
  if (!value) return false;
  if (!value.startsWith("assets/")) return false;
  if (value.includes("\\") || value.includes("..")) return false;
  return value.length <= 240;
}

function proofAssetDownloadUrl(projectId: string, assetId: string): string {
  return `/api/internal/projects/${encodeURIComponent(projectId)}/assets/${encodeURIComponent(assetId)}/download`;
}

function proofEvidenceHasReviewTarget(evidence: ProgressRecord): boolean {
  const target = evidence.target;
  if (!isProgressRecord(target)) return false;

  const route = stringField(target, "route");
  if (!route || !route.startsWith("/") || route.includes("\\")) return false;

  const viewport = target.viewport;
  if (!isProgressRecord(viewport)) return false;
  const width = integerField(viewport, "width");
  const height = integerField(viewport, "height");
  if (!width || !height || width < 1 || height < 1 || width > 10000 || height > 10000) {
    return false;
  }

  const claim = stringField(target, "claim")
    ?? stringField(target, "state")
    ?? stringField(target, "interaction");
  return typeof claim === "string" && claim.trim().length > 0 && claim.trim().length <= 500;
}

function unavailableProofArtifact(
  role: "before" | "after",
  reason: NonNullable<ProjectInteractionProofArtifact["unavailableReason"]>,
  evidence?: ProgressRecord | null,
): ProjectInteractionProofArtifact {
  return {
    role,
    kind: "screenshot",
    availability: "unavailable",
    url: null,
    assetId: null,
    contentType: cleanProofContentType(stringField(evidence ?? {}, "contentType")),
    sha256: cleanProofDigest(stringField(evidence ?? {}, "sha256") ?? stringField(evidence ?? {}, "artifactSha256")),
    capturedAt: cleanProofCapturedAt(stringField(evidence ?? {}, "capturedAt") ?? stringField(evidence ?? {}, "observedAt")),
    unavailableReason: reason,
  };
}

function sanitizeProofArtifact(input: {
  projectId: string;
  role: "before" | "after";
  evidence: ProgressRecord | null;
  assetsById: Map<string, InteractionProject["assets"][number]>;
  assetsByPath: Map<string, InteractionProject["assets"][number]>;
}): ProjectInteractionProofArtifact {
  if (!input.evidence) return unavailableProofArtifact(input.role, "missing");
  if (stringField(input.evidence, "kind") !== "screenshot") {
    return unavailableProofArtifact(input.role, "unsupported_source", input.evidence);
  }

  const explicitAssetId = cleanProofAssetId(stringField(input.evidence, "assetId"));
  const rawAssetPath = stringField(input.evidence, "assetPath") ?? stringField(input.evidence, "artifactPath");
  const asset = explicitAssetId
    ? input.assetsById.get(explicitAssetId) ?? null
    : isSafeProjectAssetPath(rawAssetPath)
      ? input.assetsByPath.get(rawAssetPath) ?? null
      : null;

  if (!asset) {
    if (rawAssetPath && !isSafeProjectAssetPath(rawAssetPath)) {
      return unavailableProofArtifact(input.role, "unsafe_path", input.evidence);
    }
    if (explicitAssetId || rawAssetPath) {
      return unavailableProofArtifact(input.role, "not_project_asset", input.evidence);
    }
    return unavailableProofArtifact(input.role, "unsupported_source", input.evidence);
  }

  const contentType = cleanProofContentType(asset.contentType ?? stringField(input.evidence, "contentType"));
  if (!contentType) {
    return unavailableProofArtifact(input.role, "unsupported_source", input.evidence);
  }

  return {
    role: input.role,
    kind: "screenshot",
    availability: "available",
    url: proofAssetDownloadUrl(input.projectId, asset.id),
    assetId: asset.id,
    contentType,
    sha256: cleanProofDigest(asset.sha256) ?? cleanProofDigest(stringField(input.evidence, "sha256")),
    capturedAt: cleanProofCapturedAt(stringField(input.evidence, "capturedAt") ?? stringField(input.evidence, "observedAt")),
    unavailableReason: null,
  };
}

function proofReviewStatus(
  before: ProjectInteractionProofArtifact,
  after: ProjectInteractionProofArtifact,
  hasReviewTargets: boolean,
): ProjectInteractionProofReview["status"] {
  if (before.availability === "available" && after.availability === "available") {
    if (!hasReviewTargets) return "unavailable";
    const beforeDigest = proofArtifactDigestForComparison(before.sha256);
    const afterDigest = proofArtifactDigestForComparison(after.sha256);
    return beforeDigest && afterDigest && beforeDigest !== afterDigest ? "ready" : "unavailable";
  }
  if (before.unavailableReason !== "missing" || after.unavailableReason !== "missing") return "unavailable";
  return "expected";
}

function proofArtifactDigestForComparison(value: string | null | undefined): string | null {
  if (!value) return null;
  const text = value.trim().toLowerCase();
  const digest = text.startsWith("sha256:") ? text.slice("sha256:".length) : text;
  return /^[a-f0-9]{64}$/.test(digest) ? digest : null;
}

function taskDiffItemIdSet(task: ProjectInteractionTask): Set<string> {
  return new Set((task.source?.diffItemIds ?? [])
    .map((id) => sanitizeArtifactLikeId(id))
    .filter((id): id is string => typeof id === "string"));
}

function progressStepMatchesTask(step: ProgressRecord, task: ProjectInteractionTask): boolean {
  if (stringField(step, "id") === task.id) return true;
  const taskDiffItemIds = taskDiffItemIdSet(task);
  if (taskDiffItemIds.size === 0) return false;
  return rawProgressStepDiffItemIds(step).some((id) => taskDiffItemIds.has(id));
}

function buildProofReviews(input: {
  projectId: string;
  rawProgressJson: string | null;
  tasks: ProjectInteractionTask[];
  assets: InteractionProject["assets"];
  canSeePrivateStatus: boolean;
}): ProjectInteractionProofReview[] {
  if (!input.canSeePrivateStatus || input.tasks.length === 0 || !input.rawProgressJson) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(input.rawProgressJson);
  } catch {
    return [];
  }
  if (!isProgressRecord(parsed) || !Array.isArray(parsed.steps)) return [];

  const proofSteps = parsed.steps
    .filter((step): step is ProgressRecord => isProgressRecord(step) && progressStepHasScreenshotProofExpectation(step));
  if (proofSteps.length === 0) return [];

  const assetsById = new Map(input.assets.map((asset) => [asset.id, asset]));
  const assetsByPath = new Map(input.assets.map((asset) => [asset.path, asset]));
  const reviews: ProjectInteractionProofReview[] = [];

  for (const task of input.tasks) {
    if (!task.source) continue;
    const step = proofSteps.find((candidate) => progressStepMatchesTask(candidate, task));
    if (!step) continue;
    const beforeEvidence = proofEvidenceRecord(step, "before");
    const afterEvidence = proofEvidenceRecord(step, "after");

    const before = sanitizeProofArtifact({
      projectId: input.projectId,
      role: "before",
      evidence: beforeEvidence,
      assetsById,
      assetsByPath,
    });
    const after = sanitizeProofArtifact({
      projectId: input.projectId,
      role: "after",
      evidence: afterEvidence,
      assetsById,
      assetsByPath,
    });
    const hasReviewTargets = Boolean(
      beforeEvidence
      && afterEvidence
      && proofEvidenceHasReviewTarget(beforeEvidence)
      && proofEvidenceHasReviewTarget(afterEvidence),
    );

    reviews.push({
      id: cleanProofReviewId(task.id),
      taskId: task.id.slice(0, 160),
      taskLabel: compactStatusText(task.label, 400) ?? task.id,
      status: proofReviewStatus(before, after, hasReviewTargets),
      action: {
        kind: "review_screenshots",
        label: "Проверить скриншоты",
      },
      source: task.source,
      before,
      after,
    });

    if (reviews.length >= PROJECT_INTERACTION_COLLECTION_LIMIT) break;
  }

  return reviews;
}

function cleanVisualEvidenceReviewId(sourceEvidenceRef: string): string {
  const digest = createHash("sha256").update(sourceEvidenceRef).digest("hex").slice(0, 16);
  const id = `visual:${digest}`;
  return SAFE_PROOF_REVIEW_ID_RE.test(id) ? id : "visual:review";
}

export function visualEvidenceReviewIdForSourceEvidenceRef(sourceEvidenceRef: string): string {
  return cleanVisualEvidenceReviewId(sourceEvidenceRef);
}

function cleanVisualEvidenceRef(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed && SAFE_VISUAL_EVIDENCE_REF_RE.test(trimmed) ? trimmed : null;
}

function visualEvidenceSourceKind(value: string | null | undefined): ProjectInteractionVisualEvidenceReview["sourceKind"] | null {
  if (!value) return null;
  if (value.startsWith("visual-workbench-capture:")) return "visual_workbench";
  if (value.startsWith("visual-scenario-run:")) return "visual_scenario";
  return null;
}

function cleanVisualArtifactSha256(value: string | null | undefined): string | null {
  const trimmed = value?.trim().toLowerCase();
  return trimmed && SAFE_VISUAL_ARTIFACT_DIGEST_RE.test(trimmed) ? trimmed : null;
}

function buildVisualEvidenceArtifact(input: {
  projectId: string;
  reviewId: string;
  expectedSha256: string | null;
  assets: InteractionProject["assets"];
}): ProjectInteractionVisualEvidenceArtifact {
  const resolution = resolveVisualEvidenceArtifactAsset({
    reviewId: input.reviewId,
    expectedSha256: input.expectedSha256,
    assets: input.assets,
  });

  if (resolution.availability === "unavailable") {
    return {
      availability: "unavailable",
      url: null,
      contentType: null,
      sha256: input.expectedSha256,
      unavailableReason: resolution.unavailableReason,
    };
  }

  return {
    availability: "available",
    url: `/api/projects/${encodeURIComponent(input.projectId)}/visual-evidence/${encodeURIComponent(input.reviewId)}/artifact`,
    contentType: resolution.asset.contentType,
    sha256: input.expectedSha256,
    unavailableReason: null,
  };
}

function cleanVisualFeedbackItemIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value
    .map((entry) => typeof entry === "string" ? entry.trim() : "")
    .filter((entry) => SAFE_VISUAL_FEEDBACK_ID_RE.test(entry))))
    .slice(0, 20);
}

function cleanVisualDiffItemIds(value: unknown, allowedDiffItemIds: string[]): string[] {
  if (!Array.isArray(value)) return [];
  const allowed = new Set(allowedDiffItemIds);
  return Array.from(new Set(value
    .map((entry) => typeof entry === "string" ? sanitizeArtifactLikeId(entry) : null)
    .filter((entry): entry is string => typeof entry === "string" && allowed.has(entry))))
    .slice(0, 20);
}

function visualEvidenceAcceptedTaskLink(
  step: ProgressRecord,
  tasks: ProjectInteractionTask[],
): { task: ProjectInteractionTask; diffItemIds: string[] } | null {
  const stepDiffItemIds = rawProgressStepDiffItemIds(step);
  if (stepDiffItemIds.length === 0) return null;

  for (const task of tasks) {
    const taskDiffItemIds = taskDiffItemIdSet(task);
    if (taskDiffItemIds.size === 0) continue;
    const diffItemIds = stepDiffItemIds.filter((id) => taskDiffItemIds.has(id));
    if (diffItemIds.length > 0) {
      return {
        task,
        diffItemIds: Array.from(new Set(diffItemIds)).slice(0, 20),
      };
    }
  }

  return null;
}

function cleanVisualEvidenceTarget(value: unknown): ProjectInteractionVisualEvidenceReview["target"] | null {
  if (!isProgressRecord(value)) return null;

  const route = stringField(value, "route");
  if (!route || !route.startsWith("/") || route.includes("\\") || route.length > 240) return null;

  const viewport = value.viewport;
  if (!isProgressRecord(viewport)) return null;
  const width = integerField(viewport, "width");
  const height = integerField(viewport, "height");
  if (!width || !height || width < 1 || height < 1 || width > 10000 || height > 10000) return null;

  const claim = compactStatusText(stringField(value, "claim"), 500);
  const state = compactStatusText(stringField(value, "state"), 500);
  const interaction = compactStatusText(stringField(value, "interaction"), 500);
  if (!claim && !state && !interaction) return null;

  return {
    route,
    viewport: { width, height },
    claim,
    state,
    interaction,
  };
}

function cleanVisualEvidenceAssessment(value: unknown): ProjectInteractionVisualEvidenceReview["assessments"][number] | null {
  if (!isProgressRecord(value)) return null;
  const ref = cleanVisualEvidenceRef(stringField(value, "ref"));
  const result = stringField(value, "result");
  const summary = compactStatusText(stringField(value, "summary"), 1000);
  if (!ref || !summary || (result !== "pass" && result !== "fail" && result !== "inconclusive")) return null;

  return {
    ref,
    result,
    observedAt: cleanProofCapturedAt(stringField(value, "observedAt")),
    summary,
    recordedBy: compactStatusText(stringField(value, "recordedBy"), 40),
  };
}

function visualEvidenceReviewStatus(
  assessments: ProjectInteractionVisualEvidenceReview["assessments"],
): ProjectInteractionVisualEvidenceReviewStatus {
  if (assessments.length === 0) return "unassessed";
  const results = new Set(assessments.map((assessment) => assessment.result));
  if (results.size > 1) return "conflict";
  const [result] = [...results];
  switch (result) {
    case "pass":
      return "passed";
    case "fail":
      return "failed";
    case "inconclusive":
      return "inconclusive";
  }
  return "conflict";
}

function buildVisualEvidenceReviews(input: {
  projectId: string;
  rawProgressJson: string | null;
  tasks: ProjectInteractionTask[];
  assets: InteractionProject["assets"];
  canSeePrivateStatus: boolean;
}): ProjectInteractionVisualEvidenceReview[] {
  if (!input.canSeePrivateStatus || input.tasks.length === 0 || !input.rawProgressJson) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(input.rawProgressJson);
  } catch {
    return [];
  }
  if (!isProgressRecord(parsed) || !Array.isArray(parsed.steps)) return [];

  const reviews: ProjectInteractionVisualEvidenceReview[] = [];
  for (const rawStep of parsed.steps) {
    if (!isProgressRecord(rawStep) || !Array.isArray(rawStep.visualEvidence)) continue;
    const acceptedTaskLink = visualEvidenceAcceptedTaskLink(rawStep, input.tasks);
    if (!acceptedTaskLink) continue;
    const taskId = acceptedTaskLink.task.id;
    const taskLabel = compactStatusText(acceptedTaskLink.task.label, 400);
    if (!taskLabel) continue;

    for (const rawEvidence of rawStep.visualEvidence) {
      if (!isProgressRecord(rawEvidence)) continue;
      const sourceEvidenceRef = cleanVisualEvidenceRef(stringField(rawEvidence, "sourceEvidenceRef"));
      const sourceKind = visualEvidenceSourceKind(sourceEvidenceRef);
      const feedbackItemIds = cleanVisualFeedbackItemIds(rawEvidence.feedbackItemIds);
      const diffItemIds = cleanVisualDiffItemIds(rawEvidence.diffItemIds, acceptedTaskLink.diffItemIds);
      const target = cleanVisualEvidenceTarget(rawEvidence.target);
      const summary = compactStatusText(stringField(rawEvidence, "summary"), 1000);
      if (!sourceEvidenceRef || !sourceKind || feedbackItemIds.length === 0 || diffItemIds.length === 0 || !target || !summary) continue;

      const assessments = (Array.isArray(rawEvidence.assessments) ? rawEvidence.assessments : [])
        .map((assessment) => cleanVisualEvidenceAssessment(assessment))
        .filter((assessment): assessment is ProjectInteractionVisualEvidenceReview["assessments"][number] => !!assessment)
        .slice(0, 20);
      const id = cleanVisualEvidenceReviewId(sourceEvidenceRef);
      const artifactSha256 = cleanVisualArtifactSha256(stringField(rawEvidence, "artifactSha256"));
      reviews.push({
        id,
        taskId: taskId.slice(0, 160),
        taskLabel,
        status: visualEvidenceReviewStatus(assessments),
        action: {
          kind: "review_visual_evidence",
          label: "Проверить скриншоты",
          href: buildProjectVisualEvidenceFocusHref(input.projectId, id),
        },
        sourceEvidenceRef,
        feedbackItemIds,
        diffItemIds,
        sourceKind,
        target,
        observedAt: cleanProofCapturedAt(stringField(rawEvidence, "observedAt")),
        summary,
        artifactSha256,
        artifact: buildVisualEvidenceArtifact({
          projectId: input.projectId,
          reviewId: id,
          expectedSha256: artifactSha256,
          assets: input.assets,
        }),
        assessments,
      });

      if (reviews.length >= PROJECT_INTERACTION_COLLECTION_LIMIT) return reviews;
    }
  }

  return reviews;
}

function sanitizeProgressStepRecord(
  step: ProgressRecord,
  orderIndex: number,
): ProjectInteractionTask | null {
  const id = stringField(step, "id");
  const status = normalizeTaskStatus(step.status);
  if (!id || !status) return null;

  const label = stringField(step, "displayTitle")
    ?? stringField(step, "label")
    ?? stringField(step, "title")
    ?? stringField(step, "description")
    ?? id;

  return {
    id,
    label,
    status,
    orderIndex,
    source: null,
  };
}

function buildScopedProgressTasks(
  rawProgressJson: string | null,
  activeTasks: ProjectInteractionTask[],
): ProjectInteractionTask[] {
  if (!rawProgressJson || activeTasks.length === 0) return [];

  const activeDiffItemIds = new Set(activeTasks
    .flatMap((task) => task.source?.diffItemIds ?? [])
    .map((id) => sanitizeArtifactLikeId(id))
    .filter((id): id is string => typeof id === "string"));
  if (activeDiffItemIds.size === 0) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawProgressJson);
  } catch {
    return [];
  }

  if (!isProgressRecord(parsed) || !Array.isArray(parsed.steps)) return [];

  const scopedTasks: ProjectInteractionTask[] = [];
  for (const [index, rawStep] of parsed.steps.entries()) {
    if (!isProgressRecord(rawStep)) continue;
    const diffItemIds = rawProgressStepDiffItemIds(rawStep);
    if (!diffItemIds.some((id) => activeDiffItemIds.has(id))) continue;
    const task = sanitizeProgressStepRecord(rawStep, index);
    if (task) scopedTasks.push(task);
  }

  return scopedTasks;
}

function buildExecutionEvent(input: {
  projectId: string;
  type: ProjectInteractionExecutionEvent["type"];
  title: string;
  summary?: string | null;
  tone: ProjectInteractionExecutionEvent["tone"];
  createdAt: string | null;
  task?: ProjectInteractionTask | null;
  progress?: ProjectInteractionExecutionEvent["progress"];
  acceptedUpdate?: ProjectInteractionAcceptedUpdate | null;
  previewUrl?: string | null;
  action?: ProjectInteractionExecutionEvent["action"];
}): ProjectInteractionExecutionEvent {
  return {
    id: `${input.projectId}:${input.type}:${input.task?.id ?? "current"}`,
    type: input.type,
    title: input.title,
    summary: input.summary ?? null,
    tone: input.tone,
    createdAt: input.createdAt,
    task: input.task ?? null,
    progress: input.progress ?? null,
    acceptedUpdate: input.acceptedUpdate ?? null,
    previewUrl: input.previewUrl ?? null,
    action: input.action ?? null,
  };
}

function requiresLoopWork(item: AcceptedDiffItem): boolean {
  return item.workImpact === "requires_loop_work";
}

function buildAcceptedUpdate(artifact: AcceptedSpecArtifact): ProjectInteractionAcceptedUpdate {
  const diff = artifact.acceptedDiff;
  return {
    sourceVersion: artifact.source.sourceVersion ?? null,
    targetSpecVersion: diff.targetSpecVersion,
    artifactId: artifact.artifactId,
    diffId: diff.id,
    summary: diff.summary,
    diffItemCount: diff.items.length,
    workItemCount: diff.items.filter(requiresLoopWork).length,
    acceptedAt: artifact.acceptedAt,
  };
}

function latestAcceptedUpdate(artifacts: AcceptedSpecArtifact[]): ProjectInteractionAcceptedUpdate | null {
  const updates = artifacts.map(buildAcceptedUpdate);
  return updates
    .sort((left, right) => (
      right.targetSpecVersion - left.targetSpecVersion
      || new Date(right.acceptedAt).getTime() - new Date(left.acceptedAt).getTime()
    ))[0] ?? null;
}

type ProgressDiffItemStatus = "pending" | "in_progress" | "completed" | "failed" | "skipped";

function mergeProgressDiffItemStatus(
  current: ProgressDiffItemStatus | undefined,
  next: ProgressDiffItemStatus,
): ProgressDiffItemStatus {
  if (!current) return next;
  if (current === "in_progress" || next === "in_progress") return "in_progress";
  if (current === "failed" || next === "failed") return "failed";
  if (current === "pending" || next === "pending") return "pending";
  return "completed";
}

function progressDiffItemStatuses(rawProgressJson: string | null): Map<string, ProgressDiffItemStatus> {
  const statuses = new Map<string, ProgressDiffItemStatus>();
  if (!rawProgressJson) return statuses;

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawProgressJson);
  } catch {
    return statuses;
  }

  if (!isProgressRecord(parsed) || !Array.isArray(parsed.steps)) return statuses;

  for (const rawStep of parsed.steps) {
    if (!isProgressRecord(rawStep)) continue;
    const status = normalizeTaskStatus(rawStep.status);
    if (!status) continue;

    const refs = Array.isArray(rawStep.feedbackItemRefs) ? rawStep.feedbackItemRefs : [];
    for (const rawRef of refs) {
      if (!isProgressRecord(rawRef)) continue;
      const diffItemId = sanitizeArtifactLikeId(stringField(rawRef, "diffItemId"));
      if (diffItemId) {
        statuses.set(diffItemId, mergeProgressDiffItemStatus(statuses.get(diffItemId), status));
      }
    }
  }

  return statuses;
}

function emptyChangeCounts(): ProjectInteractionChangeBatch["changeCounts"] {
  return {
    added: 0,
    updated: 0,
    reopened: 0,
    corrected: 0,
    removed: 0,
    superseded: 0,
    other: 0,
  };
}

function incrementChangeCount(
  counts: ProjectInteractionChangeBatch["changeCounts"],
  item: AcceptedDiffItem,
): void {
  switch (item.changeType) {
    case "created":
      counts.added += 1;
      return;
    case "updated":
      counts.updated += 1;
      return;
    case "reopened":
      counts.reopened += 1;
      return;
    case "corrected":
      counts.corrected += 1;
      return;
    case "removed":
      counts.removed += 1;
      return;
    case "superseded":
      counts.superseded += 1;
      return;
    default:
      counts.other += 1;
  }
}

function progressItemCompleted(status: ProgressDiffItemStatus | undefined): boolean {
  return status === "completed" || status === "skipped";
}

function progressItemActive(status: ProgressDiffItemStatus | undefined): boolean {
  return status === "in_progress";
}

function completedOutcomeCutoffMs(
  component: InteractionProject["components"][number] | null | undefined,
): number | null {
  return component?.agentState === "IDLE"
    && component?.lastOutcome === "COMPLETED"
    && component.lastOutcomeAt
    && (component?.blockers?.length ?? 0) === 0
      ? component.lastOutcomeAt.getTime()
      : null;
}

type ChangeBatchCandidate = {
  batch: ProjectInteractionChangeBatch;
  hasKnownProgress: boolean;
};

function buildChangeBatch(input: {
  artifact: AcceptedSpecArtifact;
  diffItemStatuses: Map<string, ProgressDiffItemStatus>;
  forceCompleted: boolean;
  assumeActive: boolean;
}): ChangeBatchCandidate | null {
  const workItems = input.artifact.acceptedDiff.items.filter(requiresLoopWork);
  if (workItems.length === 0) return null;

  const counts = emptyChangeCounts();
  let completedItemCount = 0;
  let hasKnownProgress = false;
  let hasActiveProgress = false;

  for (const item of workItems) {
    incrementChangeCount(counts, item);
    const status = input.diffItemStatuses.get(item.id);
    if (status) hasKnownProgress = true;
    if (progressItemActive(status)) hasActiveProgress = true;
    if (input.forceCompleted || progressItemCompleted(status)) completedItemCount += 1;
  }

  const pendingItemCount = Math.max(0, workItems.length - completedItemCount);
  const status: ProjectInteractionChangeBatch["status"] =
    pendingItemCount === 0
      ? "completed"
      : hasActiveProgress || (input.assumeActive && !hasKnownProgress)
        ? "in_progress"
        : "pending";

  return {
    batch: {
      id: input.artifact.acceptedDiff.id,
      sourceVersion: input.artifact.source.sourceVersion ?? null,
      targetSpecVersion: input.artifact.acceptedDiff.targetSpecVersion,
      artifactId: input.artifact.artifactId,
      diffId: input.artifact.acceptedDiff.id,
      summary: input.artifact.acceptedDiff.summary,
      acceptedAt: input.artifact.acceptedAt,
      status,
      workItemCount: workItems.length,
      completedItemCount,
      pendingItemCount,
      changeCounts: counts,
    },
    hasKnownProgress,
  };
}

function buildActiveChangeBatches(input: {
  artifacts: AcceptedSpecArtifact[];
  diffItemStatuses: Map<string, ProgressDiffItemStatus>;
  component: InteractionProject["components"][number] | null | undefined;
  canSeePrivateStatus: boolean;
  artifactFreshnessMs?: Map<string, number>;
}): ProjectInteractionChangeBatch[] {
  if (!input.canSeePrivateStatus) return [];

  const sortedArtifacts = [...input.artifacts].sort((left, right) => (
    left.acceptedDiff.targetSpecVersion - right.acceptedDiff.targetSpecVersion
    || new Date(left.acceptedAt).getTime() - new Date(right.acceptedAt).getTime()
  ));
  const hasLinkedProgress = input.diffItemStatuses.size > 0;
  const lastCompletedAtMs = completedOutcomeCutoffMs(input.component);

  const latestWorkArtifact = [...sortedArtifacts].reverse()
    .find((artifact) => artifact.acceptedDiff.items.some(requiresLoopWork));

  return sortedArtifacts
    .map((artifact) => buildChangeBatch({
      artifact,
      diffItemStatuses: input.diffItemStatuses,
      forceCompleted: lastCompletedAtMs !== null
        && acceptedArtifactFreshnessMs(artifact, input.artifactFreshnessMs) <= lastCompletedAtMs,
      // If progress has no diff refs, the only auditable chat claim is the
      // newest accepted batch. Older unlinked work stays out of chat counts.
      assumeActive: !hasLinkedProgress
        && input.component?.agentState === "RUNNING"
        && latestWorkArtifact?.artifactId === artifact.artifactId,
    }))
    .filter((candidate): candidate is ChangeBatchCandidate => Boolean(candidate))
    .filter(({ batch }) => batch.status !== "completed")
    .filter(({ batch, hasKnownProgress }) => {
      const isLatestWorkArtifact = latestWorkArtifact?.artifactId === batch.artifactId;
      return hasKnownProgress || isLatestWorkArtifact;
    })
    .map(({ batch }) => batch);
}

function activeChangesBatchScopeSuffix(batches: ProjectInteractionChangeBatch[]): string {
  return batches.length > 1 ? " по нескольким обновлениям" : "";
}

function activeChangesStatusLine(batches: ProjectInteractionChangeBatch[]): string | null {
  if (batches.length === 0) return null;
  const completed = batches.reduce((sum, batch) => sum + batch.completedItemCount, 0);
  const total = batches.reduce((sum, batch) => sum + batch.workItemCount, 0);
  if (total <= 0) return null;
  const scope = activeChangesBatchScopeSuffix(batches);
  if (completed === 0) {
    const hasInProgressBatch = batches.some((batch) => batch.status === "in_progress");
    return hasInProgressBatch
      ? `Активные изменения выполняются${scope}.`
      : `Активные изменения ждут начала работы${scope}.`;
  }
  return `Часть активных изменений готова; Ralph продолжает работу${scope}.`;
}

function activeRalphTaskProgressLine(
  progress: ProjectInteractionExecutionEvent["progress"],
  batches: ProjectInteractionChangeBatch[],
): string | null {
  if (batches.length === 0 || !progress?.total || progress.total <= 0) return null;
  const completed = progress.completed ?? 0;
  return `Рабочие задачи: ${completed} из ${progress.total}.`;
}

function compactStatusText(value: string | null | undefined, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const text = value.replace(/\s+/g, " ").trim();
  if (!text) return null;
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 3).trim()}...`;
}

function compactMultilineText(value: string | null | undefined, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const text = value
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (!text) return null;
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 3).trim()}...`;
}

function addStatusLine(lines: string[], value: string | null | undefined): void {
  const line = compactStatusText(value, 220);
  if (line) lines.push(line);
}

function buildStatusSummary(input: {
  current: ProjectInteractionExecutionEvent | null;
  progress: ProjectInteractionProgress;
  activeChangeBatches: ProjectInteractionChangeBatch[];
  previewUrl: string | null;
}): ProjectInteractionStatusSummary {
  const current = input.current;
  const progress = current?.progress ?? executionProgress(input.progress, [], {
    allowRawStepsFallback: input.activeChangeBatches.length === 0,
  });
  let stage: ProjectInteractionStatusSummary["stage"] = "idle";
  if (current?.type === "action.required") stage = "waiting";
  else if (current?.type === "work.failed") stage = "failed";
  else if (current?.type === "work.completed") stage = "completed";
  else if (current?.type === "progress.updated" || current?.type === "work.started") stage = "working";
  else if (current?.type === "planning.started" || current?.type === "plan.ready") stage = "planning";
  else if (current?.type === "preview.ready") stage = "preview";

  const canShowCurrentTask = stage === "working" || stage === "planning";
  const currentTaskLabel = compactStatusText(
    canShowCurrentTask ? current?.task?.label ?? input.progress.summary.currentFeature : null,
    160,
  );
  const activeWorkItemCount = input.activeChangeBatches
    .reduce((sum, batch) => sum + batch.pendingItemCount, 0);
  const completedWorkItemCount = input.activeChangeBatches.length > 0
    ? input.activeChangeBatches.reduce((sum, batch) => sum + batch.completedItemCount, 0)
    : null;
  const lines: string[] = [];

  if (currentTaskLabel) {
    addStatusLine(lines, `Сейчас: ${currentTaskLabel}`);
  }

  addStatusLine(lines, activeRalphTaskProgressLine(progress, input.activeChangeBatches));

  if (input.activeChangeBatches.length > 0) {
    addStatusLine(lines, activeChangesStatusLine(input.activeChangeBatches));
  } else if (current?.type === "work.completed") {
    addStatusLine(lines, "Активные изменения завершены.");
  }

  if (current?.summary && current.summary !== currentTaskLabel) {
    addStatusLine(lines, current.summary);
  }

  const title = compactStatusText(
    current?.title ?? (input.previewUrl ? "Превью доступно" : "Ralph ждёт новых изменений"),
    120,
  ) ?? "Статус проекта";
  const summary = compactStatusText(lines[0] ?? current?.summary, 280);

  return {
    stage,
    title,
    summary,
    lines: lines.slice(0, 5),
    currentTaskLabel,
    activeBatchCount: input.activeChangeBatches.length,
    activeWorkItemCount,
    completedWorkItemCount,
    action: current?.action ?? null,
  };
}

function acceptedUpdateLabel(update: ProjectInteractionAcceptedUpdate | null): string {
  if (!update) return "обновлению";
  return update.sourceVersion ? `обновлению v${update.sourceVersion}` : "последнему обновлению";
}

function blockerActionCopy(blockers: string[]): { title: string; summary: string } {
  const primary = blockers[0];
  switch (primary) {
    case "BUDGET":
      return {
        title: "Нужен бюджет",
        summary: "Работа продолжится после пополнения или изменения бюджета.",
      };
    case "MANUAL":
      return {
        title: "Нужна проверка менеджера",
        summary: "Ralph ждёт решения или новой evidence по проекту.",
      };
    case "INFRA":
      return {
        title: "Ждём инфраструктуру",
        summary: "Arena продолжит работу после восстановления инфраструктуры.",
      };
    case "API":
      return {
        title: "Ждём внешний API",
        summary: "Работа продолжится после восстановления внешнего API.",
      };
    default:
      return {
        title: "Ralph ждёт действие",
        summary: "Откройте проект, чтобы посмотреть, что нужно сделать.",
      };
  }
}

function buildExecutionProjection(input: {
  project: InteractionProject;
  component: InteractionProject["components"][number] | null | undefined;
  progress: ProjectInteractionProgress;
  tasks: ProjectInteractionTask[];
  executionTasks: ProjectInteractionTask[];
  acceptedArtifacts: AcceptedSpecArtifact[];
  activeChangeBatches: ProjectInteractionChangeBatch[];
  previewUrl: string | null;
  canSeePrivateStatus: boolean;
}): ProjectInteractionExecution {
  const createdAt = toIso(input.project.updatedAt);
  const scopedToActiveChanges = input.activeChangeBatches.length > 0;
  const executionTaskOptions = { allowRawStepsFallback: !scopedToActiveChanges };
  const progress = executionProgress(input.progress, input.executionTasks, executionTaskOptions);
  const currentTask = currentExecutionTask(input.progress, input.executionTasks, executionTaskOptions);
  const acceptedUpdate = latestAcceptedUpdate(input.acceptedArtifacts);
  const blockers = input.canSeePrivateStatus ? input.component?.blockers ?? [] : [];
  const previewUrl = input.previewUrl;
  const assumptionReview = input.canSeePrivateStatus ? input.progress.raw?.assumptionReviews?.[0] ?? null : null;

  let current: ProjectInteractionExecutionEvent | null = null;

  if (!input.canSeePrivateStatus) {
    current = previewUrl
      ? buildExecutionEvent({
          projectId: input.project.id,
          type: "preview.ready",
          title: "Превью доступно",
          summary: "Можно посмотреть текущий результат.",
          tone: "success",
          createdAt,
          previewUrl,
          action: { kind: "open_preview", label: "Открыть превью" },
        })
      : null;
    return {
      current,
      feed: current ? [current] : [],
      latestAcceptedUpdate: null,
      activeChangeBatches: [],
      statusSummary: buildStatusSummary({
        current,
        progress: input.progress,
        activeChangeBatches: [],
        previewUrl,
      }),
    };
  }

  if (blockers.includes("SECRETS")) {
    current = buildExecutionEvent({
      projectId: input.project.id,
      type: "action.required",
      title: "Нужны настройки проекта",
      summary: "Менеджер может заполнить их в Arena.",
      tone: "warning",
      createdAt,
      progress,
      acceptedUpdate,
      action: { kind: "manage_secrets", label: "Открыть настройки" },
    });
  } else if (blockers.includes("RATE_LIMIT")) {
    current = buildExecutionEvent({
      projectId: input.project.id,
      type: "action.required",
      title: "Ждём окно модели",
      summary: input.component?.retryAt
        ? "Ralph продолжит автоматически позже."
        : "Ralph продолжит автоматически, когда лимит сбросится.",
      tone: "warning",
      createdAt,
      progress,
      acceptedUpdate,
      action: { kind: "wait", label: "Ждать" },
    });
  } else if (blockers.length > 0) {
    const copy = blockerActionCopy(blockers);
    current = buildExecutionEvent({
      projectId: input.project.id,
      type: "action.required",
      title: copy.title,
      summary: copy.summary,
      tone: "warning",
      createdAt,
      progress,
      acceptedUpdate,
      action: { kind: "review", label: "Открыть проект" },
    });
  } else if (assumptionReview) {
    current = buildExecutionEvent({
      projectId: input.project.id,
      type: "action.required",
      title: "Ralph сделал вывод",
      summary: assumptionReview.statement,
      tone: "warning",
      createdAt,
      progress,
      acceptedUpdate,
      action: { kind: "review", label: "Открыть вопросы" },
    });
  } else if (input.component?.lastOutcome === "FAILED") {
    current = buildExecutionEvent({
      projectId: input.project.id,
      type: "work.failed",
      title: "Ralph остановился",
      summary: "Откройте проект, чтобы посмотреть, что нужно сделать дальше.",
      tone: "danger",
      createdAt,
      progress,
      acceptedUpdate,
      previewUrl,
      action: { kind: "review", label: "Открыть проект" },
    });
  } else if (input.activeChangeBatches.length > 0 && input.component?.agentState !== "RUNNING") {
    current = buildExecutionEvent({
      projectId: input.project.id,
      type: "plan.ready",
      title: "Есть новые изменения",
      summary: "Ralph возьмёт их в работу по очереди.",
      tone: "neutral",
      createdAt,
      progress,
      acceptedUpdate,
      action: { kind: "open_work", label: "Ход работы" },
    });
  } else if (input.component?.lastOutcome === "COMPLETED") {
    current = buildExecutionEvent({
      projectId: input.project.id,
      type: "work.completed",
      title: "Готово к просмотру",
      summary: previewUrl ? "Можно открыть превью и проверить результат." : "Проход завершён.",
      tone: "success",
      createdAt,
      progress,
      acceptedUpdate,
      previewUrl,
      action: previewUrl ? { kind: "open_preview", label: "Открыть превью" } : null,
    });
  } else if (input.component?.agentState === "RUNNING") {
    current = buildExecutionEvent({
      projectId: input.project.id,
      type: currentTask ? "progress.updated" : "work.started",
      title: currentTask ? "Ralph работает" : "Ralph начал работу",
      summary: currentTask?.label ?? input.progress.summary.message,
      tone: "active",
      createdAt,
      task: currentTask,
      progress,
      acceptedUpdate,
      action: { kind: "open_work", label: "Ход работы" },
    });
  } else if (input.tasks.length > 0) {
    const sourceLabel = acceptedUpdateLabel(acceptedUpdate);
    current = buildExecutionEvent({
      projectId: input.project.id,
      type: "plan.ready",
      title: acceptedUpdate ? `По ${sourceLabel}: есть работа` : "План обновлён",
      summary: acceptedUpdate
        ? "Ralph обновит работу по принятому изменению."
        : "Ralph обновит план по принятому изменению.",
      tone: "neutral",
      createdAt,
      progress,
      acceptedUpdate,
      action: { kind: "open_work", label: "Ход работы" },
    });
  } else if (input.component?.powerIntent === "ON" || input.component?.agentIntent === "ON") {
    current = buildExecutionEvent({
      projectId: input.project.id,
      type: "planning.started",
      title: "Ralph планирует работу",
      summary: "Скоро появится план.",
      tone: "active",
      createdAt,
      acceptedUpdate,
      action: { kind: "open_work", label: "Ход работы" },
    });
  } else if (previewUrl) {
    current = buildExecutionEvent({
      projectId: input.project.id,
      type: "preview.ready",
      title: "Превью доступно",
      summary: "Можно посмотреть текущий результат.",
      tone: "success",
      createdAt,
      acceptedUpdate,
      previewUrl,
      action: { kind: "open_preview", label: "Открыть превью" },
    });
  }

  return {
    current,
    feed: current ? [current] : [],
    latestAcceptedUpdate: acceptedUpdate,
    activeChangeBatches: input.activeChangeBatches,
    statusSummary: buildStatusSummary({
      current,
      progress: input.progress,
      activeChangeBatches: input.activeChangeBatches,
      previewUrl,
    }),
  };
}

function hasCapability(access: InteractionAccess, capability: AccessCapability): boolean {
  return access.hasCapability(capability);
}

function buildAllowedActions(
  project: InteractionProject,
  access: InteractionAccess,
  loopSupport: ReturnType<typeof resolveLoopSupport>,
): ProjectInteractionAllowedActions {
  const isArchived = project.archivedAt != null;
  const canRuntime = hasCapability(access, "project.runtime.manage");
  const canManageBudget = hasCapability(access, "project.budget.manage");
  const canViewBudget = canManageBudget || hasCapability(access, "project.budget.view");
  const component = getPrimaryLifecycleComponent(project);
  const tgSpecSetupState = component && isTgSpecTargetSourceConfig(component.sourceConfig)
    ? getTgSpecLaunchConfigurationState(component.sourceConfig)
    : null;
  const canLaunchSetup =
    canRuntime
    && Boolean(access.isOwner || access.isAdmin)
    && Boolean(tgSpecSetupState)
    && !isArchived
    && component?.runtimeState !== "RUNNING"
    && component?.agentState !== "RUNNING";

  return {
    view: access.canView,
    startApp: canRuntime && loopSupport.appStartAllowed && !isArchived,
    stopApp: canRuntime && !isArchived,
    startAgent: canRuntime && loopSupport.agentStartAllowed && !isArchived,
    pauseAgent: canRuntime && !isArchived,
    relaunch: canRuntime && loopSupport.relaunchAllowed && !isArchived,
    launchSetup: canLaunchSetup,
    writeSpecs: hasCapability(access, "project.specs.write"),
    manageAssets: hasCapability(access, "project.assets.manage"),
    manageSecrets: hasCapability(access, "project.secrets.manage"),
    revealSecrets: hasCapability(access, "project.secrets.reveal"),
    manageRequiredSecrets: hasCapability(access, "project.required_secrets.manage"),
    viewBudget: canViewBudget,
    manageBudget: canManageBudget,
    manageSettings: hasCapability(access, "project.settings.manage"),
    manageAccess: hasCapability(access, "project.access.manage"),
    deleteProject: hasCapability(access, "project.delete"),
  };
}

function applySurfaceActionPolicy(
  actions: ProjectInteractionAllowedActions,
  surface: ProjectInteractionSurface,
): ProjectInteractionAllowedActions {
  if (surface === "arena") return actions;

  return {
    view: actions.view,
    startApp: false,
    stopApp: false,
    startAgent: false,
    pauseAgent: false,
    relaunch: false,
    launchSetup: actions.launchSetup,
    writeSpecs: false,
    manageAssets: false,
    manageSecrets: actions.manageSecrets,
    revealSecrets: false,
    manageRequiredSecrets: actions.manageRequiredSecrets,
    viewBudget: false,
    manageBudget: false,
    manageSettings: false,
    manageAccess: false,
    deleteProject: false,
  };
}

function resolveAudience(access: InteractionAccess): ProjectInteractionAudience {
  if (!access.canAccessPrivate) return "public";
  return access.canManage || access.isOwner || access.isAdmin ? "admin" : "contributor";
}

function buildSectionAccess(
  audience: ProjectInteractionAudience,
  actions: ProjectInteractionAllowedActions,
  surface: ProjectInteractionSurface,
): ProjectInteractionSectionAccess {
  if (audience === "public") {
    return {
      status: true,
      preview: true,
      tasks: false,
      feedback: false,
      assumptions: false,
      progress: false,
      specs: false,
      assets: false,
      secrets: false,
      budget: false,
      activity: false,
      settings: false,
      access: false,
    };
  }

  const canSeeSecrets = actions.manageSecrets || actions.manageRequiredSecrets || actions.revealSecrets;
  const canSeeMaintainerSpecs = audience === "admin";

  return {
    status: true,
    preview: true,
    tasks: true,
    feedback: true,
    assumptions: true,
    progress: true,
    specs: canSeeMaintainerSpecs,
    assets: true,
    secrets: canSeeSecrets,
    budget: surface === "arena" && actions.viewBudget,
    activity: surface === "arena" && audience === "admin",
    settings: surface === "arena" && actions.manageSettings,
    access: surface === "arena" && actions.manageAccess,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isStoredAcceptedArtifact(value: unknown): boolean {
  return isRecord(value) && value.artifactSchemaVersion === "ra-287.accepted-spec-artifact.v1";
}

function validTimeMs(value: Date | string | null | undefined): number | null {
  if (!value) return null;
  const ms = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}

function maxValidTimeMs(values: Array<Date | string | null | undefined>): number | null {
  let max: number | null = null;
  for (const value of values) {
    const ms = validTimeMs(value);
    if (ms === null) continue;
    if (max === null || ms > max) max = ms;
  }
  return max;
}

function acceptedArtifactFreshnessMs(
  artifact: AcceptedSpecArtifact,
  freshnessByArtifactId?: Map<string, number>,
): number {
  return freshnessByArtifactId?.get(artifact.artifactId) ?? validTimeMs(artifact.acceptedAt) ?? 0;
}

function parseAcceptedArtifactsForInteraction(
  project: Pick<InteractionProject, "id" | "specs">,
  options: {
    allVersions?: boolean;
    freshnessByArtifactId?: Map<string, number>;
  } = {},
): AcceptedSpecArtifact[] {
  const artifacts: AcceptedSpecArtifact[] = [];

  for (const spec of project.specs) {
    const versions = options.allVersions ? spec.versions : spec.versions.slice(0, 1);
    for (const [index, version] of versions.entries()) {
      const acceptedArtifact = version.acceptedArtifact;
      if (acceptedArtifact == null) continue;
      if (!isStoredAcceptedArtifact(acceptedArtifact)) {
        throw new Error(
          `Invalid accepted spec artifact in project interaction snapshot project=${project.id} spec=${spec.id} version=${version.version}: unsupported artifact shape`,
        );
      }

      try {
        const artifact = parseAcceptedSpecArtifact(acceptedArtifact);
        const freshnessMs = maxValidTimeMs([
          version.updatedAt,
          version.createdAt,
          artifact.acceptedAt,
          index === 0 ? spec.updatedAt : null,
        ]);
        if (freshnessMs !== null) {
          const previous = options.freshnessByArtifactId?.get(artifact.artifactId);
          if (previous === undefined || freshnessMs > previous) {
            options.freshnessByArtifactId?.set(artifact.artifactId, freshnessMs);
          }
        }
        artifacts.push(artifact);
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        throw new Error(
          `Invalid accepted spec artifact in project interaction snapshot project=${project.id} spec=${spec.id} version=${version.version}: ${detail}`,
        );
      }
    }
  }

  return artifacts;
}

function acceptedDiffTaskId(item: AcceptedDiffItem): string {
  return item.targetType === "feedback" ? feedbackTaskId(item.targetId) : `TASK-${item.targetId}`;
}

function projectInteractionTaskStatus(
  artifact: AcceptedSpecArtifact,
  item: AcceptedDiffItem,
  options: {
    diffItemStatuses?: Map<string, ProgressDiffItemStatus>;
    completedCutoffMs?: number | null;
    artifactFreshnessMs?: Map<string, number>;
  } = {},
): ProjectInteractionTask["status"] {
  if (
    options.completedCutoffMs !== undefined
    && options.completedCutoffMs !== null
    && acceptedArtifactFreshnessMs(artifact, options.artifactFreshnessMs) <= options.completedCutoffMs
  ) {
    return "completed";
  }

  const status = options.diffItemStatuses?.get(item.id);
  return status ?? "pending";
}

function formatAcceptedDiffTaskLabel(item: AcceptedDiffItem, label: string): string {
  if (item.changeType === "removed") return `Убрать: ${label}`;
  if (item.changeType === "superseded") return `Заменить: ${label}`;
  return label;
}

function acceptedDiffTaskLabel(artifact: AcceptedSpecArtifact, item: AcceptedDiffItem): string {
  let label: string;
  if (item.targetType === "feedback") {
    const feedback = artifact.feedback.find((entry) => entry.id === item.targetId);
    if (feedback) {
      label = feedbackTaskLabel(feedback);
      return formatAcceptedDiffTaskLabel(item, label);
    }
  }

  if (item.targetType === "assumption") {
    const assumption = artifact.assumptions.find((entry) => entry.id === item.targetId);
    if (assumption) {
      label = assumption.statement ? `${assumption.title}: ${assumption.statement}` : assumption.title;
      return formatAcceptedDiffTaskLabel(item, label);
    }
  }

  if (item.targetType === "secret_requirement") {
    const secret = artifact.secretRequirements.find((entry) => entry.id === item.targetId);
    if (secret) {
      label = secret.description ? `${secret.key}: ${secret.description}` : secret.key;
      return formatAcceptedDiffTaskLabel(item, label);
    }
  }

  if (item.targetType === "asset") {
    const asset = artifact.assets.find((entry) => entry.id === item.targetId);
    if (asset) {
      label = asset.logicalPath ? `${asset.label}: ${asset.logicalPath}` : asset.label;
      return formatAcceptedDiffTaskLabel(item, label);
    }
  }

  return formatAcceptedDiffTaskLabel(item, item.summary);
}

function acceptedDiffTaskSource(
  artifact: AcceptedSpecArtifact,
  item: AcceptedDiffItem,
): ProjectInteractionTask["source"] {
  return {
    sourceVersion: artifact.source.sourceVersion ?? null,
    targetSpecVersion: artifact.acceptedDiff.targetSpecVersion,
    artifactId: artifact.artifactId,
    diffId: artifact.acceptedDiff.id,
    diffItemIds: [item.id],
    changeType: item.changeType,
    feedbackId: item.targetType === "feedback" ? item.targetId : null,
  };
}

function buildDiffItemTask(
  artifact: AcceptedSpecArtifact,
  item: AcceptedDiffItem,
  orderIndex: number,
  options: {
    diffItemStatuses?: Map<string, ProgressDiffItemStatus>;
    completedCutoffMs?: number | null;
    artifactFreshnessMs?: Map<string, number>;
  } = {},
): ProjectInteractionTask {
  return {
    id: acceptedDiffTaskId(item),
    label: acceptedDiffTaskLabel(artifact, item),
    status: projectInteractionTaskStatus(artifact, item, options),
    orderIndex,
    source: acceptedDiffTaskSource(artifact, item),
  };
}

function mergeDiffItemTask(existing: ProjectInteractionTask, next: ProjectInteractionTask): ProjectInteractionTask {
  const existingSource = existing.source;
  const nextSource = next.source;
  if (!existingSource || !nextSource || existingSource.diffId !== nextSource.diffId) return existing;

  return {
    ...existing,
    label: existing.label || next.label,
    status: mergeProgressDiffItemStatus(existing.status, next.status),
    source: {
      ...existingSource,
      diffItemIds: Array.from(new Set([...existingSource.diffItemIds, ...nextSource.diffItemIds])),
      changeType: existingSource.changeType ?? nextSource.changeType,
      feedbackId: existingSource.feedbackId ?? nextSource.feedbackId,
    },
  };
}

function taskIdWithDiff(task: ProjectInteractionTask): string {
  return task.source?.diffId ? `${task.id}:${task.source.diffId}` : `${task.id}:${task.orderIndex}`;
}

function parseTasksFromAcceptedArtifacts(
  artifacts: AcceptedSpecArtifact[],
  options: {
    diffItemStatuses?: Map<string, ProgressDiffItemStatus>;
    component?: InteractionProject["components"][number] | null;
    artifactFreshnessMs?: Map<string, number>;
  } = {},
): LimitedCollection<ProjectInteractionTask> {
  const tasks: ProjectInteractionTask[] = [];
  const seen = new Map<string, number>();
  const completedCutoffMs = completedOutcomeCutoffMs(options.component);

  for (const artifact of artifacts) {
    for (const item of artifact.acceptedDiff.items) {
      if (!requiresLoopWork(item)) continue;

      const task = buildDiffItemTask(artifact, item, tasks.length, {
        diffItemStatuses: options.diffItemStatuses,
        completedCutoffMs,
        artifactFreshnessMs: options.artifactFreshnessMs,
      });
      const existingIndex = seen.get(task.id);
      if (existingIndex !== undefined) {
        const existing = tasks[existingIndex];
        if (existing.source?.diffId === task.source?.diffId) {
          tasks[existingIndex] = mergeDiffItemTask(existing, task);
          continue;
        }
        task.id = taskIdWithDiff(task);
      }

      seen.set(task.id, tasks.length);
      tasks.push(task);
    }
  }

  return limitCollection(
    tasks.sort(compareTasksForDisplay),
  );
}

function feedbackTaskId(feedbackId: string): string {
  return `TASK-${feedbackId}`;
}

function feedbackTaskLabel(feedback: FeedbackItem): string {
  return feedback.body ? `${feedback.title}: ${feedback.body}` : feedback.title;
}

function feedbackResolution(feedback: FeedbackItem): ProjectInteractionFeedback["resolution"] {
  if (!feedback.resolution) return null;
  return {
    kind: feedback.resolution.kind,
    summary: feedback.resolution.summary,
  };
}

function assumptionOutcome(assumption: AssumptionItem): ProjectInteractionAssumption["outcome"] {
  if (!assumption.outcome) return null;
  return {
    kind: assumption.outcome.kind,
    correctionSummary: assumption.outcome.correctionSummary ?? null,
  };
}

function parseFeedbackFromAcceptedArtifacts(artifacts: AcceptedSpecArtifact[]): LimitedCollection<ProjectInteractionFeedback> {
  const feedbackItems: ProjectInteractionFeedback[] = [];

  for (const artifact of artifacts) {
    for (const feedback of artifact.feedback) {
      feedbackItems.push({
        id: feedback.id,
        title: feedback.title,
        body: feedback.body,
        state: feedback.state,
        reopenCount: feedback.reopenCount,
        orderIndex: feedbackItems.length,
        resolution: feedbackResolution(feedback),
      });
    }
  }

  return limitCollection(
    feedbackItems.sort((left, right) => left.orderIndex - right.orderIndex || left.id.localeCompare(right.id)),
  );
}

function parseAssumptionsFromAcceptedArtifacts(artifacts: AcceptedSpecArtifact[]): LimitedCollection<ProjectInteractionAssumption> {
  const assumptions: ProjectInteractionAssumption[] = [];

  for (const artifact of artifacts) {
    for (const assumption of artifact.assumptions) {
      assumptions.push({
        id: assumption.id,
        title: assumption.title,
        statement: assumption.statement,
        state: assumption.state,
        orderIndex: assumptions.length,
        outcome: assumptionOutcome(assumption),
      });
    }
  }

  return limitCollection(
    assumptions.sort((left, right) => left.orderIndex - right.orderIndex || left.id.localeCompare(right.id)),
  );
}

function normalizeActivityCode(
  value: string | null | undefined,
  pattern: RegExp,
  fallback: string,
): string {
  const trimmed = value?.trim();
  return trimmed && pattern.test(trimmed) ? trimmed : fallback;
}

function toActivityLabel(code: string, fallback: string): string {
  if (code === "OTHER" || code === "other") return fallback;

  const label = code
    .toLowerCase()
    .split(/[_:-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");

  return label || fallback;
}

function normalizeProjectEventDirection(value: string): "in" | "out" {
  return value === "in" ? "in" : "out";
}

function emptyMacBuild(): ProjectInteractionMacBuild {
  return {
    status: "not_available",
    latestArtifact: null,
    failureSummary: null,
    builderLabel: null,
    updatedAt: null,
  };
}

function normalizeReleaseArtifactStatus(value: string | null | undefined): ProjectInteractionMacBuild["status"] {
  if (value === "building" || value === "build_failed" || value === "available") {
    return value;
  }
  return "not_available";
}

function buildMacBuildProjection(
  projectId: string,
  releaseArtifacts: ProjectReleaseArtifactRecord[] | undefined,
  canSeePrivateStatus: boolean,
): ProjectInteractionMacBuild {
  if (!canSeePrivateStatus) return emptyMacBuild();

  const artifacts = releaseArtifacts ?? [];
  const latestStatusArtifact = artifacts[0] ?? null;
  if (!latestStatusArtifact) return emptyMacBuild();

  const latestAvailable = artifacts.find((artifact) => (
    artifact.status === "available"
    && artifact.storageKey
    && artifact.filename
    && artifact.sizeBytes != null
    && artifact.sizeBytes > 0
    && artifact.sha256
  ));
  const status = normalizeReleaseArtifactStatus(latestStatusArtifact.status);

  return {
    status,
    latestArtifact: latestAvailable
      ? {
        id: latestAvailable.id,
        version: latestAvailable.version ?? null,
        tag: latestAvailable.tag ?? null,
        commitSha: latestAvailable.commitSha ?? null,
        filename: latestAvailable.filename!,
        contentType: latestAvailable.contentType ?? null,
        sizeBytes: latestAvailable.sizeBytes!,
        sha256: latestAvailable.sha256!,
        createdAt: toIso(latestAvailable.createdAt) ?? new Date(0).toISOString(),
        downloadUrl: `/api/projects/${encodeURIComponent(projectId)}/release-artifacts/${encodeURIComponent(latestAvailable.id)}/download`,
      }
      : null,
    failureSummary: status === "build_failed" ? latestStatusArtifact.failureSummary ?? "Mac build failed." : null,
    builderLabel: latestStatusArtifact.builderLabel ?? null,
    updatedAt: toIso(latestStatusArtifact.updatedAt ?? latestStatusArtifact.createdAt),
  };
}

export function buildProjectInteractionSnapshot(
  project: InteractionProject,
  access: InteractionAccess,
  viewerUserId: string | null,
  options: BuildProjectInteractionSnapshotOptions = {},
): ProjectInteractionSnapshot {
  const surface = options.surface ?? "arena";
  const component = getPrimaryLifecycleComponent(project);
  const preferredPreviewUrl = getPreferredPreviewUrl({
    previewUrl: component?.previewUrl ?? null,
    containerName: component?.containerName ?? null,
    previewDomain: project.vpsHost?.previewDomain ?? process.env.PREVIEW_DOMAIN?.trim() ?? null,
  });
  const useRepoHead = runtimeConfigUsesRepoHead(component?.runtimeConfig ?? null);
  const loopSupport = resolveLoopSupport({
    agentImpl: project.agentImpl,
    loopName: project.agentLoopVersion?.agentLoop?.name ?? null,
    loopVersion: project.agentLoopVersion?.version ?? null,
    supportTier: project.agentLoopVersion?.supportTier ?? null,
    useRepoHead,
    hasLoopVersion: Boolean(project.agentLoopVersion),
  });
  const providedSecretsByKey = new Map(project.secrets.map((secret) => [secret.key, secret]));
  const baseAllowedActions = buildAllowedActions(project, access, loopSupport);
  const allowedActions = applySurfaceActionPolicy(baseAllowedActions, surface);
  const audience = resolveAudience(access);
  const sections = buildSectionAccess(audience, allowedActions, surface);
  const canSeePrivateStatus = audience !== "public";
  const progress = sections.progress
    ? parseProgress(project.progressJson, { includeStepDescriptions: audience === "admin" })
    : emptyProgress();
  const artifactFreshnessMs = new Map<string, number>();
  const acceptedArtifacts = sections.tasks || sections.feedback || sections.assumptions
    ? parseAcceptedArtifactsForInteraction(project, { freshnessByArtifactId: artifactFreshnessMs })
    : [];
  const acceptedChangeArtifacts = sections.tasks
    ? parseAcceptedArtifactsForInteraction(project, {
        allVersions: true,
        freshnessByArtifactId: artifactFreshnessMs,
      })
    : [];
  const diffItemStatuses = progressDiffItemStatuses(project.progressJson);
  const emptyTaskCollection = limitCollection<ProjectInteractionTask>([]);
  const emptyFeedbackCollection = limitCollection<ProjectInteractionFeedback>([]);
  const emptyAssumptionCollection = limitCollection<ProjectInteractionAssumption>([]);
  const activeChangeBatches = buildActiveChangeBatches({
    artifacts: acceptedChangeArtifacts,
    diffItemStatuses,
    component,
    canSeePrivateStatus,
    artifactFreshnessMs,
  });
  const activeArtifactIds = new Set(activeChangeBatches.map((batch) => batch.artifactId));
  const taskArtifacts = activeArtifactIds.size > 0
    ? acceptedChangeArtifacts
        .filter((artifact) => activeArtifactIds.has(artifact.artifactId))
        .sort((left, right) => (
          left.acceptedDiff.targetSpecVersion - right.acceptedDiff.targetSpecVersion
          || new Date(left.acceptedAt).getTime() - new Date(right.acceptedAt).getTime()
        ))
    : acceptedArtifacts;
  const taskCollection = sections.tasks
    ? parseTasksFromAcceptedArtifacts(taskArtifacts, {
        diffItemStatuses,
        component,
        artifactFreshnessMs,
      })
    : emptyTaskCollection;
  const scopedExecutionTasks = activeChangeBatches.length > 0
    ? buildScopedProgressTasks(project.progressJson, taskCollection.items)
    : [];
  const executionTasks = activeChangeBatches.length > 0
    ? (scopedExecutionTasks.length > 0 ? scopedExecutionTasks : taskCollection.items)
    : taskCollection.items;
  const feedbackCollection = sections.feedback
    ? parseFeedbackFromAcceptedArtifacts(acceptedArtifacts)
    : emptyFeedbackCollection;
  const assumptionCollection = sections.assumptions
    ? parseAssumptionsFromAcceptedArtifacts(acceptedArtifacts)
    : emptyAssumptionCollection;
  const tasks = taskCollection.items;
  const proofReviews = buildProofReviews({
    projectId: project.id,
    rawProgressJson: project.progressJson,
    tasks,
    assets: project.assets,
    canSeePrivateStatus,
  });
  const visualEvidenceReviews = buildVisualEvidenceReviews({
    projectId: project.id,
    rawProgressJson: project.progressJson,
    tasks,
    assets: project.assets,
    canSeePrivateStatus,
  });
  const execution = buildExecutionProjection({
    project,
    component,
    progress,
    tasks,
    executionTasks,
    acceptedArtifacts,
    activeChangeBatches,
    previewUrl: preferredPreviewUrl,
    canSeePrivateStatus,
  });

  const snapshot = {
    version: "ra-287.project-interaction.v2" as const,
    project: {
      id: project.id,
      name: project.name,
      slug: project.slug ?? null,
      mode: project.mode,
      visibility: project.visibility,
      archivedAt: toIso(project.archivedAt),
      createdAt: toIso(project.createdAt) ?? new Date(0).toISOString(),
      updatedAt: toIso(project.updatedAt) ?? new Date(0).toISOString(),
      tgSpec: {
        sourceProjectId: canSeePrivateStatus ? project.tgSpecSourceProjectId ?? null : null,
        mirrorSpecId: canSeePrivateStatus ? project.tgSpecMirrorSpecId ?? null : null,
        lastImportedVersion: canSeePrivateStatus ? project.tgSpecLastImportedVersion ?? null : null,
      },
    },
    viewer: {
      userId: viewerUserId,
      surface,
      audience,
      canView: access.canView,
      canManage: access.canManage,
      sections,
      effectiveCapabilities: access.effectiveCapabilities,
      allowedActions,
    },
    app: {
      publicStatus: getPublicDisplayStatus(project),
      componentId: canSeePrivateStatus ? component?.id ?? null : null,
      powerIntent: canSeePrivateStatus ? component?.powerIntent ?? null : null,
      agentIntent: canSeePrivateStatus ? component?.agentIntent ?? null : null,
      runtimeState: canSeePrivateStatus ? component?.runtimeState ?? null : null,
      agentState: canSeePrivateStatus ? component?.agentState ?? null : null,
      blockers: canSeePrivateStatus ? component?.blockers ?? [] : [],
      lastOutcome: canSeePrivateStatus ? component?.lastOutcome ?? null : null,
      previewHealth: component?.previewHealth ?? null,
      previewCheckedAt: toIso(component?.previewCheckedAt),
      retryAt: canSeePrivateStatus ? toIso(component?.retryAt) : null,
      retryCount: canSeePrivateStatus ? component?.retryCount ?? 0 : 0,
      lastHeartbeat: canSeePrivateStatus ? toIso(component?.lastHeartbeat) : null,
      loopRuntime: canSeePrivateStatus ? loopSupport.loopIdentity : null,
      loopSupportStatus: canSeePrivateStatus ? loopSupport.supportStatus : null,
      loopSupportLabel: canSeePrivateStatus ? loopSupport.supportLabel : null,
      loopSupportHint: canSeePrivateStatus ? loopSupport.supportHint : null,
    },
    preview: {
      url: preferredPreviewUrl,
      health: component?.previewHealth ?? null,
      checkedAt: toIso(component?.previewCheckedAt),
    },
    macBuild: buildMacBuildProjection(project.id, project.releaseArtifacts, canSeePrivateStatus),
    progress,
    execution,
    collections: {
      tasks: taskCollection.meta,
      feedback: feedbackCollection.meta,
      assumptions: assumptionCollection.meta,
    },
    tasks,
    proofReviews,
    visualEvidenceReviews,
    feedback: feedbackCollection.items,
    assumptions: assumptionCollection.items,
    specs: sections.specs ? project.specs.map((spec) => ({
      id: spec.id,
      title: spec.title ?? null,
      content: spec.content,
      orderIndex: spec.orderIndex,
      createdAt: toIso(spec.createdAt) ?? new Date(0).toISOString(),
      updatedAt: toIso(spec.updatedAt) ?? new Date(0).toISOString(),
      versions: spec.versions.map((version) => ({
        id: version.id,
        version: version.version,
        content: version.content,
        message: version.message ?? null,
        createdAt: toIso(version.createdAt) ?? new Date(0).toISOString(),
      })),
      latestVersion: spec.versions[0]
        ? {
          version: spec.versions[0].version,
          message: spec.versions[0].message ?? null,
          createdAt: toIso(spec.versions[0].createdAt) ?? new Date(0).toISOString(),
        }
        : null,
    })) : [],
    assets: sections.assets ? project.assets.filter((asset) => isUserVisibleProjectAsset(asset)).map((asset) => ({
      id: asset.id,
      path: asset.path,
      originalName: asset.originalName,
      contentType: asset.contentType ?? null,
      sizeBytes: asset.sizeBytes,
      sha256: asset.sha256,
      uploadedById: asset.uploadedById ?? null,
      createdAt: toIso(asset.createdAt) ?? new Date(0).toISOString(),
      updatedAt: toIso(asset.updatedAt) ?? new Date(0).toISOString(),
    })) : [],
    secrets: {
      required: sections.secrets ? parseRequiredSecrets(project.requiredSecrets).map((secret) => {
        const provided = providedSecretsByKey.get(secret.key);
        return {
          key: secret.key,
          ...(secret.description ? { description: secret.description } : {}),
          blocking: secret.blocking !== false,
          ...(secret.requestedAt ? { requestedAt: secret.requestedAt } : {}),
          ...(secret.requestedByRunId ? { requestedByRunId: secret.requestedByRunId } : {}),
          provided: Boolean(provided),
          providedAt: toIso(provided?.updatedAt ?? provided?.createdAt ?? null),
        };
      }) : [],
      provided: sections.secrets && allowedActions.manageSecrets
        ? project.secrets.map((secret) => ({
          id: secret.id,
          key: secret.key,
          description: secret.description ?? null,
          createdAt: toIso(secret.createdAt) ?? new Date(0).toISOString(),
          updatedAt: toIso(secret.updatedAt) ?? new Date(0).toISOString(),
        }))
        : [],
    },
    budget: sections.budget && project.budget
      ? {
        isEnabled: project.budget.isEnabled,
        totalCreditsUsd: project.budget.totalCreditsUsd,
        usedCreditsUsd: project.budget.usedCreditsUsd,
      }
      : null,
    activity: {
      runEvents: sections.activity ? project.runLogs.map((log) => {
        const event = normalizeActivityCode(log.event, SAFE_RUN_EVENT_RE, "OTHER");
        return {
          id: log.id,
          event,
          label: toActivityLabel(event, "Run event"),
          createdAt: toIso(log.createdAt) ?? new Date(0).toISOString(),
        };
      }) : [],
      projectEvents: sections.activity ? project.events.map((event) => {
        const type = normalizeActivityCode(event.type, SAFE_PROJECT_EVENT_TYPE_RE, "other");
        return {
          id: event.id,
          direction: normalizeProjectEventDirection(event.direction),
          type,
          label: toActivityLabel(type, "Project event"),
          userId: event.userId ?? null,
          createdAt: toIso(event.createdAt) ?? new Date(0).toISOString(),
        };
      }) : [],
    },
  };

  return ProjectInteractionSnapshotSchema.parse(snapshot);
}

export async function getProjectVisualEvidenceArtifactForDownload(options: {
  projectId: string;
  reviewId: string;
}): Promise<{
  bytes: Buffer;
  contentType: string;
  sha256: string;
} | null> {
  const project = await prisma.project.findUnique({
    where: { id: options.projectId },
    select: {
      id: true,
      progressJson: true,
      specs: {
        orderBy: { orderIndex: "asc" },
        select: {
          id: true,
          title: true,
          content: true,
          orderIndex: true,
          createdAt: true,
          updatedAt: true,
          versions: {
            orderBy: { version: "desc" },
            select: {
              id: true,
              version: true,
              content: true,
              message: true,
              createdAt: true,
              updatedAt: true,
              acceptedArtifact: true,
            },
          },
        },
      },
      assets: {
        where: { deletedAt: null },
        orderBy: { path: "asc" },
        select: {
          id: true,
          path: true,
          originalName: true,
          contentType: true,
          sizeBytes: true,
          sha256: true,
          storageKey: true,
          uploadedById: true,
          createdAt: true,
          updatedAt: true,
        },
      },
    },
  });

  if (!project) return null;

  const snapshotAssets = project.assets.map(({ storageKey: _storageKey, ...asset }) => asset);
  const acceptedArtifacts = parseAcceptedArtifactsForInteraction(project);
  const tasks = parseTasksFromAcceptedArtifacts(acceptedArtifacts).items;
  const review = buildVisualEvidenceReviews({
    projectId: project.id,
    rawProgressJson: project.progressJson,
    tasks,
    assets: snapshotAssets,
    canSeePrivateStatus: true,
  }).find((candidate) => candidate.id === options.reviewId);
  if (!review || review.artifact.availability !== "available" || !review.artifact.sha256) {
    return null;
  }

  const resolution = resolveVisualEvidenceArtifactAsset({
    reviewId: options.reviewId,
    expectedSha256: review.artifact.sha256,
    assets: project.assets,
  });
  if (resolution.availability !== "available") return null;
  const contentType = resolution.asset.contentType;
  if (!contentType) return null;

  const bytes = await readProjectAssetBytes(resolution.asset);
  return {
    bytes,
    contentType,
    sha256: review.artifact.sha256,
  };
}

export async function getProjectVisualEvidenceReviewsForProgressJson(options: {
  projectId: string;
  progressJson: string;
}): Promise<ProjectInteractionVisualEvidenceReview[] | null> {
  const readback = await getProjectVisualEvidenceReadbackForProgressJson(options);
  return readback?.reviews ?? null;
}

export async function getProjectVisualEvidenceReadbackForProgressJson(options: {
  projectId: string;
  progressJson: string;
}): Promise<{
  currentProgressJson: string | null;
  tasks: ProjectInteractionTask[];
  reviews: ProjectInteractionVisualEvidenceReview[];
} | null> {
  const project = await prisma.project.findUnique({
    where: { id: options.projectId },
    select: {
      id: true,
      progressJson: true,
      specs: {
        orderBy: { orderIndex: "asc" },
        select: {
          id: true,
          title: true,
          content: true,
          orderIndex: true,
          createdAt: true,
          updatedAt: true,
          versions: {
            orderBy: { version: "desc" },
            select: {
              id: true,
              version: true,
              content: true,
              message: true,
              createdAt: true,
              updatedAt: true,
              acceptedArtifact: true,
            },
          },
        },
      },
      assets: {
        where: { deletedAt: null },
        orderBy: { path: "asc" },
        select: {
          id: true,
          path: true,
          originalName: true,
          contentType: true,
          sizeBytes: true,
          sha256: true,
          uploadedById: true,
          createdAt: true,
          updatedAt: true,
        },
      },
    },
  });

  if (!project) return null;

  const acceptedArtifacts = parseAcceptedArtifactsForInteraction(project);
  const tasks = parseTasksFromAcceptedArtifacts(acceptedArtifacts).items;
  return {
    currentProgressJson: project.progressJson,
    tasks,
    reviews: buildVisualEvidenceReviews({
      projectId: project.id,
      rawProgressJson: options.progressJson,
      tasks,
      assets: project.assets,
      canSeePrivateStatus: true,
    }),
  };
}

export async function getProjectInteractionSnapshotForViewer(options: {
  projectId: string;
  session: Session | null;
  hasBypass: boolean;
  surface?: ProjectInteractionSurface;
}): Promise<ProjectInteractionResult> {
  const project = await prisma.project.findUnique({
    where: { id: options.projectId },
    select: {
      id: true,
      name: true,
      slug: true,
      mode: true,
      visibility: true,
      ownerScopeType: true,
      ownerScopeId: true,
      archivedAt: true,
      createdAt: true,
      updatedAt: true,
      tgSpecSourceProjectId: true,
      tgSpecMirrorSpecId: true,
      tgSpecLastImportedVersion: true,
      agentImpl: true,
      progressJson: true,
      requiredSecrets: true,
      components: {
        where: { kind: "app" },
        orderBy: { createdAt: "asc" },
        take: 1,
        select: {
          id: true,
          kind: true,
          powerIntent: true,
          agentIntent: true,
          runtimeState: true,
          agentState: true,
          blockers: true,
          lastOutcome: true,
          lastOutcomeAt: true,
          previewHealth: true,
          previewCheckedAt: true,
          retryAt: true,
          retryCount: true,
          containerName: true,
          previewUrl: true,
          workerHost: true,
          lastHeartbeat: true,
          sourceConfig: true,
          runtimeConfig: true,
        },
      },
      vpsHost: {
        select: {
          previewDomain: true,
        },
      },
      agentLoopVersion: {
        select: {
          version: true,
          supportTier: true,
          agentLoop: {
            select: {
              name: true,
            },
          },
        },
      },
      specs: {
        orderBy: { orderIndex: "asc" },
        select: {
          id: true,
          title: true,
          content: true,
          orderIndex: true,
          createdAt: true,
          updatedAt: true,
          versions: {
            orderBy: { version: "desc" },
            select: {
              id: true,
              version: true,
              content: true,
              message: true,
              createdAt: true,
              updatedAt: true,
              acceptedArtifact: true,
            },
          },
        },
      },
      assets: {
        where: { deletedAt: null },
        orderBy: { path: "asc" },
        select: {
          id: true,
          path: true,
          originalName: true,
          contentType: true,
          sizeBytes: true,
          sha256: true,
          uploadedById: true,
          createdAt: true,
          updatedAt: true,
        },
      },
      secrets: {
        orderBy: { key: "asc" },
        select: {
          id: true,
          key: true,
          description: true,
          createdAt: true,
          updatedAt: true,
        },
      },
      budget: {
        select: {
          isEnabled: true,
          totalCreditsUsd: true,
          usedCreditsUsd: true,
        },
      },
      runLogs: {
        orderBy: { createdAt: "desc" },
        take: RECENT_RUN_EVENT_LIMIT,
        select: {
          id: true,
          event: true,
          createdAt: true,
        },
      },
      events: {
        orderBy: { createdAt: "desc" },
        take: RECENT_PROJECT_EVENT_LIMIT,
        select: {
          id: true,
          direction: true,
          type: true,
          userId: true,
          createdAt: true,
        },
      },
    },
  });

  if (!project) {
    return { status: "not_found" };
  }

  const access = await resolveProjectAccess(project, options.session, options.hasBypass);
  if (!access.canView) {
    return options.session?.user || options.hasBypass
      ? { status: "forbidden" }
      : { status: "unauthorized" };
  }

  const releaseArtifacts = await listProjectReleaseArtifacts(project.id, { limit: 10 });

  return {
    status: "ok",
    snapshot: buildProjectInteractionSnapshot(
      { ...project, releaseArtifacts },
      access,
      options.session?.user?.id ?? null,
      { surface: options.surface ?? "arena" },
    ),
  };
}
