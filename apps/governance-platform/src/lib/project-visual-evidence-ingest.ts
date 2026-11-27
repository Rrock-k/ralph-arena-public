import "server-only";

import { createHash } from "node:crypto";
import {
  getProjectVisualEvidenceReadbackForProgressJson,
  visualEvidenceReviewIdForSourceEvidenceRef,
} from "@/lib/project-interaction";
import {
  listProjectAssets,
  upsertProjectAsset,
  visualEvidenceAssetPathPrefixForReviewId,
  type ProjectAssetRecord,
} from "@/lib/project-assets";
import { prisma } from "@/lib/prisma";
import { notifyProjectChanged } from "@/lib/progress-bus";

const VISUAL_WORKBENCH_CAPTURE_PREFIX = "visual-workbench-capture:";
const VISUAL_EVIDENCE_DIGEST_RE = /^sha256:[a-f0-9]{64}$/;
const IMAGE_CONTENT_TYPE_RE = /^image\/[a-z0-9.+-]+$/i;
const FORBIDDEN_PROGRESS_KEYS = new Set([
  "artifactPath",
  "assetPath",
  "filePath",
  "localPath",
  "storageKey",
  "proofReviews",
  "proofExpectations",
  "screenshotProof",
  "ProjectAsset",
  "projectAsset",
  "runtimeIntent",
  "RuntimeIntent",
  "blockers",
  "powerIntent",
  "agentIntent",
  "runtimeState",
  "agentState",
  "ProjectComponent",
  "projectComponent",
  "outbox",
  "telegram",
]);

type ProgressRecord = Record<string, unknown>;
type CanonicalVisualEvidenceTarget = {
  route: string;
  viewport: { width: number; height: number };
  claim: string | null;
  state: string | null;
  interaction: string | null;
};
type CanonicalVisualEvidence = {
  sourceEvidenceRef: string;
  sourceKind: "visual_workbench";
  feedbackItemIds: [string];
  diffItemIds: [string];
  artifactSha256: string;
  target: CanonicalVisualEvidenceTarget;
  observedAt?: string;
  summary: string;
};
type SelectedVisualEvidence = {
  taskId: string;
  sourceEvidenceRef: string;
  feedbackItemId: string;
  diffItemId: string;
  artifactSha256: string;
  canonical: CanonicalVisualEvidence;
};

export class ProjectVisualEvidenceIngestError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

export type ProjectVisualEvidenceIngestInput = {
  projectId: string;
  taskId: string;
  sourceEvidenceRef: string;
  progressJson: string;
  artifactFilename: string;
  artifactContentType: string;
  artifactContentBase64: string;
  uploadedById?: string | null;
};

export type ProjectVisualEvidenceIngestResult = {
  schemaVersion: "ra-356.project-visual-evidence-ingest.v1";
  status: "ingested";
  projectId: string;
  taskId: string;
  sourceEvidenceRef: string;
  reviewId: string;
  progress: {
    imported: true;
    visualEvidenceReviewCount: number;
  };
  asset: {
    assetId: string;
    path: string;
    sha256: string;
    contentType: string;
    sizeBytes: number;
  };
  notes: string[];
};

export async function ingestProjectVisualEvidence(
  input: ProjectVisualEvidenceIngestInput,
): Promise<ProjectVisualEvidenceIngestResult> {
  const progress = parseProgressJson(input.progressJson);
  const forbiddenField = findForbiddenProgressField(progress);
  if (forbiddenField) {
    throw new ProjectVisualEvidenceIngestError(
      "forbidden_progress_field",
      `progressJson must not contain ${forbiddenField}`,
    );
  }

  const evidence = findVisualEvidenceRow({
    progress,
    taskId: input.taskId,
    sourceEvidenceRef: input.sourceEvidenceRef,
  });
  const selected = validateVisualEvidenceRow({
    evidence,
    taskId: input.taskId,
    sourceEvidenceRef: input.sourceEvidenceRef,
  });

  const artifactContentType = normalizeImageContentType(input.artifactContentType);
  const artifactBuffer = decodeBase64(input.artifactContentBase64);
  const actualSha256 = createHash("sha256").update(artifactBuffer).digest("hex");
  const expectedSha256 = selected.artifactSha256;
  if (`sha256:${actualSha256}` !== expectedSha256) {
    throw new ProjectVisualEvidenceIngestError(
      "artifact_digest_mismatch",
      "artifactContentBase64 sha256 does not match progressJson visualEvidence artifactSha256",
    );
  }

  const initialReadback = await getProjectVisualEvidenceReadbackForProgressJson({
    projectId: input.projectId,
    progressJson: buildNextProgressJson(null, selected),
  });
  if (!initialReadback) {
    throw new ProjectVisualEvidenceIngestError("project_not_found", "Project not found", 404);
  }

  const nextProgressJson = buildNextProgressJson(initialReadback.currentProgressJson, selected);
  const readback = nextProgressJson === buildNextProgressJson(null, selected)
    ? initialReadback
    : await getProjectVisualEvidenceReadbackForProgressJson({
        projectId: input.projectId,
        progressJson: nextProgressJson,
      });
  if (!readback) {
    throw new ProjectVisualEvidenceIngestError("project_not_found", "Project not found", 404);
  }

  const reviewId = visualEvidenceReviewIdForSourceEvidenceRef(input.sourceEvidenceRef);
  const matchingReviews = readback.reviews.filter((candidate) => (
    candidate.id === reviewId
    && candidate.sourceEvidenceRef === input.sourceEvidenceRef
  ));
  if (matchingReviews.length !== 1) {
    throw new ProjectVisualEvidenceIngestError(
      "visual_evidence_review_missing",
      "progressJson visualEvidence does not resolve to exactly one accepted visual evidence review",
    );
  }
  const [review] = matchingReviews;
  validateReadbackOwnership({
    selected,
    review,
    tasks: readback.tasks,
  });

  const assetPath = `${visualEvidenceAssetPathPrefixForReviewId(reviewId)}capture.png`;
  const asset = await upsertVisualEvidenceAssetIfNeeded({
    projectId: input.projectId,
    originalName: input.artifactFilename,
    contentType: artifactContentType,
    buffer: artifactBuffer,
    assetPath,
    sha256: actualSha256,
    uploadedById: input.uploadedById ?? "arena-visual-evidence-ingest",
  });

  await prisma.project.update({
    where: { id: input.projectId },
    data: { progressJson: nextProgressJson },
  });
  notifyProjectChanged(input.projectId);

  return {
    schemaVersion: "ra-356.project-visual-evidence-ingest.v1",
    status: "ingested",
    projectId: input.projectId,
    taskId: input.taskId,
    sourceEvidenceRef: input.sourceEvidenceRef,
    reviewId,
    progress: {
      imported: true,
      visualEvidenceReviewCount: readback.reviews.length,
    },
    asset: {
      assetId: asset.id,
      path: asset.path,
      sha256: asset.sha256,
      contentType: artifactContentType,
      sizeBytes: asset.sizeBytes,
    },
    notes: [
      "Imported explicit Workbench progressJson and one matching visual evidence system asset.",
      "No lifecycle, runtime intent, outbox or Telegram state was changed.",
    ],
  };
}

function parseProgressJson(raw: string): ProgressRecord {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ProjectVisualEvidenceIngestError("invalid_progress_json", "progressJson must be valid JSON");
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.steps)) {
    throw new ProjectVisualEvidenceIngestError(
      "invalid_progress_shape",
      "progressJson must be an object with a steps array",
    );
  }
  return parsed;
}

function findVisualEvidenceRow(input: {
  progress: ProgressRecord;
  taskId: string;
  sourceEvidenceRef: string;
}): ProgressRecord {
  const steps = input.progress.steps;
  if (!Array.isArray(steps)) {
    throw new ProjectVisualEvidenceIngestError("invalid_progress_shape", "progressJson steps must be an array");
  }
  const matchingSteps = steps.filter((candidate): candidate is ProgressRecord => (
    isRecord(candidate) && stringField(candidate, "id") === input.taskId
  ));
  if (matchingSteps.length === 0) {
    throw new ProjectVisualEvidenceIngestError("task_progress_missing", "progressJson does not contain the requested taskId");
  }
  if (matchingSteps.length > 1) {
    throw new ProjectVisualEvidenceIngestError("task_progress_duplicate", "progressJson contains duplicate requested taskId steps");
  }
  const [step] = matchingSteps;
  if (!Array.isArray(step.visualEvidence)) {
    throw new ProjectVisualEvidenceIngestError(
      "task_visual_evidence_missing",
      "progressJson task does not contain visualEvidence rows",
    );
  }
  const matchingEvidenceRows = step.visualEvidence.filter((candidate): candidate is ProgressRecord => (
    isRecord(candidate) && stringField(candidate, "sourceEvidenceRef") === input.sourceEvidenceRef
  ));
  if (matchingEvidenceRows.length === 0) {
    throw new ProjectVisualEvidenceIngestError(
      "visual_evidence_row_missing",
      "progressJson task does not contain the requested sourceEvidenceRef",
    );
  }
  if (matchingEvidenceRows.length > 1) {
    throw new ProjectVisualEvidenceIngestError(
      "visual_evidence_row_duplicate",
      "progressJson task contains duplicate requested sourceEvidenceRef rows",
    );
  }
  return matchingEvidenceRows[0];
}

function validateVisualEvidenceRow(input: {
  evidence: ProgressRecord;
  taskId: string;
  sourceEvidenceRef: string;
}): SelectedVisualEvidence {
  const { evidence, sourceEvidenceRef } = input;
  if (!sourceEvidenceRef.startsWith(VISUAL_WORKBENCH_CAPTURE_PREFIX)) {
    throw new ProjectVisualEvidenceIngestError(
      "unsupported_source_evidence_ref",
      "sourceEvidenceRef must be a visual-workbench-capture ref",
    );
  }
  if (stringField(evidence, "sourceEvidenceRef") !== sourceEvidenceRef) {
    throw new ProjectVisualEvidenceIngestError(
      "source_evidence_ref_mismatch",
      "sourceEvidenceRef does not match progressJson visualEvidence row",
    );
  }
  if (stringField(evidence, "sourceKind") !== "visual_workbench") {
    throw new ProjectVisualEvidenceIngestError(
      "source_kind_invalid",
      "visualEvidence row sourceKind must be visual_workbench",
    );
  }
  const feedbackItemIds = readStringArray(evidence.feedbackItemIds);
  if (feedbackItemIds.length !== 1) {
    throw new ProjectVisualEvidenceIngestError(
      "feedback_items_not_single",
      "visualEvidence row must contain exactly one feedbackItemId",
    );
  }
  const diffItemIds = readStringArray(evidence.diffItemIds);
  if (diffItemIds.length !== 1) {
    throw new ProjectVisualEvidenceIngestError(
      "diff_items_not_single",
      "visualEvidence row must contain exactly one diffItemId",
    );
  }
  const artifactSha256 = readRequiredDigest(evidence.artifactSha256);
  const target = validateVisualEvidenceTarget(evidence.target);
  const summary = compactString(stringField(evidence, "summary"), 1000);
  if (!summary) {
    throw new ProjectVisualEvidenceIngestError(
      "summary_missing",
      "visualEvidence row must contain a summary",
    );
  }
  const observedAt = cleanIsoTimestamp(stringField(evidence, "observedAt"));

  return {
    taskId: input.taskId,
    sourceEvidenceRef,
    feedbackItemId: feedbackItemIds[0],
    diffItemId: diffItemIds[0],
    artifactSha256,
    canonical: {
      sourceEvidenceRef,
      sourceKind: "visual_workbench",
      feedbackItemIds: [feedbackItemIds[0]],
      diffItemIds: [diffItemIds[0]],
      artifactSha256,
      target,
      ...(observedAt ? { observedAt } : {}),
      summary,
    },
  };
}

function validateVisualEvidenceTarget(value: unknown): CanonicalVisualEvidenceTarget {
  if (!isRecord(value)) {
    throw new ProjectVisualEvidenceIngestError("target_missing", "visualEvidence row must contain a target object");
  }
  const route = stringField(value, "route");
  if (!route || !route.startsWith("/") || route.includes("\\") || route.length > 240) {
    throw new ProjectVisualEvidenceIngestError("target_route_invalid", "visualEvidence target.route is invalid");
  }
  const viewport = value.viewport;
  if (!isRecord(viewport)) {
    throw new ProjectVisualEvidenceIngestError("target_viewport_missing", "visualEvidence target.viewport is required");
  }
  const width = integerField(viewport, "width");
  const height = integerField(viewport, "height");
  if (!width || !height || width < 1 || height < 1 || width > 10000 || height > 10000) {
    throw new ProjectVisualEvidenceIngestError("target_viewport_invalid", "visualEvidence target.viewport is invalid");
  }
  const claim = stringField(value, "claim")
    ?? stringField(value, "state")
    ?? stringField(value, "interaction");
  if (!claim?.trim()) {
    throw new ProjectVisualEvidenceIngestError(
      "target_claim_missing",
      "visualEvidence target must include claim, state or interaction",
    );
  }
  return {
    route,
    viewport: { width, height },
    claim: compactString(stringField(value, "claim"), 500),
    state: compactString(stringField(value, "state"), 500),
    interaction: compactString(stringField(value, "interaction"), 500),
  };
}

function readRequiredDigest(value: unknown): string {
  if (typeof value !== "string") {
    throw new ProjectVisualEvidenceIngestError(
      "artifact_digest_missing",
      "visualEvidence row must contain artifactSha256",
    );
  }
  const digest = value.trim().toLowerCase();
  if (!VISUAL_EVIDENCE_DIGEST_RE.test(digest)) {
    throw new ProjectVisualEvidenceIngestError(
      "artifact_digest_invalid",
      "visualEvidence artifactSha256 must be sha256:<64 lowercase hex>",
    );
  }
  return digest;
}

function normalizeImageContentType(value: string): string {
  const contentType = value.trim().toLowerCase();
  if (!IMAGE_CONTENT_TYPE_RE.test(contentType)) {
    throw new ProjectVisualEvidenceIngestError(
      "artifact_content_type_invalid",
      "artifactContentType must be an image content type",
    );
  }
  return contentType;
}

function decodeBase64(value: string): Buffer {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(trimmed)) {
    throw new ProjectVisualEvidenceIngestError(
      "artifact_base64_invalid",
      "artifactContentBase64 must be valid base64",
    );
  }
  const buffer = Buffer.from(trimmed, "base64");
  if (buffer.byteLength === 0 || buffer.toString("base64") !== trimmed) {
    throw new ProjectVisualEvidenceIngestError(
      "artifact_base64_invalid",
      "artifactContentBase64 must be valid base64",
    );
  }
  return buffer;
}

function findForbiddenProgressField(value: unknown, path: string[] = []): string | null {
  if (typeof value === "string" && value.includes("assets/proof/")) {
    return `${path.join(".") || "progressJson"} containing assets/proof/`;
  }
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      const nested = findForbiddenProgressField(item, [...path, String(index)]);
      if (nested) return nested;
    }
    return null;
  }
  if (!isRecord(value)) return null;
  for (const [key, nested] of Object.entries(value)) {
    if (FORBIDDEN_PROGRESS_KEYS.has(key) || key === "path" || /Path$/.test(key)) {
      return [...path, key].join(".");
    }
    const nestedForbidden = findForbiddenProgressField(nested, [...path, key]);
    if (nestedForbidden) return nestedForbidden;
  }
  return null;
}

function buildNextProgressJson(
  currentProgressJson: string | null,
  selected: SelectedVisualEvidence,
): string {
  const progress = currentProgressJson
    ? parseExistingProgressJson(currentProgressJson)
    : {
        schemaVersion: "ra-356.visual-evidence-ingest-progress.v1",
        state: "idle",
        message: "Visual evidence readback refreshed",
        steps: [],
      };
  const steps = progress.steps;
  if (!Array.isArray(steps)) {
    throw new ProjectVisualEvidenceIngestError(
      "existing_progress_invalid",
      "existing Project.progressJson must contain a steps array",
    );
  }

  const matchingStepIndexes = steps
    .map((step, index) => isRecord(step) && stringField(step, "id") === selected.taskId ? index : -1)
    .filter((index) => index >= 0);
  const nextStep = buildCanonicalProgressStep(selected);
  if (matchingStepIndexes.length === 0) {
    steps.push(nextStep);
    return JSON.stringify(progress);
  }
  if (matchingStepIndexes.length > 1) {
    throw new ProjectVisualEvidenceIngestError(
      "existing_progress_duplicate_task",
      "existing Project.progressJson contains duplicate selected task steps",
    );
  }

  const stepIndex = matchingStepIndexes[0];
  const existingStep = steps[stepIndex];
  if (!isRecord(existingStep)) {
    steps[stepIndex] = nextStep;
    return JSON.stringify(progress);
  }
  const visualEvidence = Array.isArray(existingStep.visualEvidence)
    ? [...existingStep.visualEvidence]
    : [];
  const matchingRows = visualEvidence.filter((row): row is ProgressRecord => (
    isRecord(row) && stringField(row, "sourceEvidenceRef") === selected.sourceEvidenceRef
  ));
  if (matchingRows.length > 1) {
    throw new ProjectVisualEvidenceIngestError(
      "existing_progress_duplicate_visual_evidence",
      "existing Project.progressJson contains duplicate selected sourceEvidenceRef rows",
    );
  }
  if (matchingRows.length === 1) {
    const existingSha = normalizeSha256(stringField(matchingRows[0], "artifactSha256"));
    if (existingSha !== selected.artifactSha256) {
      throw new ProjectVisualEvidenceIngestError(
        "existing_progress_evidence_conflict",
        "existing Project.progressJson already contains this sourceEvidenceRef with a different artifactSha256",
        409,
      );
    }
  }

  steps[stepIndex] = {
    ...existingStep,
    id: selected.taskId,
    feedbackItemRefs: mergeFeedbackItemRefs(existingStep.feedbackItemRefs, selected.diffItemId),
    visualEvidence: [
      ...visualEvidence.filter((row) => !(
        isRecord(row) && stringField(row, "sourceEvidenceRef") === selected.sourceEvidenceRef
      )),
      selected.canonical,
    ],
  };
  return JSON.stringify(progress);
}

function parseExistingProgressJson(raw: string): ProgressRecord {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ProjectVisualEvidenceIngestError(
      "existing_progress_invalid",
      "existing Project.progressJson must be valid JSON",
    );
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.steps)) {
    throw new ProjectVisualEvidenceIngestError(
      "existing_progress_invalid",
      "existing Project.progressJson must contain a steps array",
    );
  }
  return parsed;
}

function buildCanonicalProgressStep(selected: SelectedVisualEvidence): ProgressRecord {
  return {
    id: selected.taskId,
    feedbackItemRefs: [{ diffItemId: selected.diffItemId }],
    visualEvidence: [selected.canonical],
  };
}

function mergeFeedbackItemRefs(value: unknown, diffItemId: string): unknown[] {
  const refs = Array.isArray(value) ? [...value] : [];
  const hasDiffRef = refs.some((ref) => isRecord(ref) && stringField(ref, "diffItemId") === diffItemId);
  if (!hasDiffRef) refs.push({ diffItemId });
  return refs;
}

function validateReadbackOwnership(input: {
  selected: SelectedVisualEvidence;
  review: {
    sourceKind: string;
    diffItemIds: string[];
    feedbackItemIds: string[];
    taskId: string;
    artifactSha256: string | null;
  };
  tasks: Array<{
    id: string;
    source: {
      diffItemIds: string[];
      feedbackId: string | null;
    } | null;
  }>;
}): void {
  const { selected, review } = input;
  if (review.sourceKind !== "visual_workbench") {
    throw new ProjectVisualEvidenceIngestError("source_kind_invalid", "readback review sourceKind must be visual_workbench");
  }
  if (review.artifactSha256 !== selected.artifactSha256) {
    throw new ProjectVisualEvidenceIngestError(
      "readback_digest_mismatch",
      "readback review artifactSha256 does not match selected evidence",
    );
  }
  if (review.diffItemIds.length !== 1 || review.diffItemIds[0] !== selected.diffItemId) {
    throw new ProjectVisualEvidenceIngestError(
      "diff_item_not_accepted",
      "selected visualEvidence diffItemId does not resolve to the accepted readback task",
    );
  }
  if (review.feedbackItemIds.length !== 1 || review.feedbackItemIds[0] !== selected.feedbackItemId) {
    throw new ProjectVisualEvidenceIngestError(
      "feedback_item_mismatch",
      "selected visualEvidence feedbackItemId does not match readback",
    );
  }
  const task = input.tasks.find((candidate) => candidate.id === review.taskId) ?? null;
  const taskSource = task?.source ?? null;
  if (!taskSource || !taskSource.diffItemIds.includes(selected.diffItemId)) {
    throw new ProjectVisualEvidenceIngestError(
      "diff_item_not_accepted",
      "selected visualEvidence diffItemId is not owned by the accepted task source",
    );
  }
  const expectedFeedbackId = taskSource.feedbackId ?? selected.diffItemId;
  if (selected.feedbackItemId !== expectedFeedbackId) {
    throw new ProjectVisualEvidenceIngestError(
      "feedback_item_not_accepted",
      "selected visualEvidence feedbackItemId is not owned by the accepted task source",
    );
  }
}

async function upsertVisualEvidenceAssetIfNeeded(input: {
  projectId: string;
  originalName: string;
  contentType: string;
  buffer: Buffer;
  assetPath: string;
  sha256: string;
  uploadedById: string;
}): Promise<ProjectAssetRecord> {
  const existing = (await listProjectAssets(input.projectId))
    .find((asset) => asset.path === input.assetPath) ?? null;
  if (existing) {
    const existingSha = normalizeAssetSha256(existing.sha256);
    if (existingSha !== `sha256:${input.sha256}`) {
      throw new ProjectVisualEvidenceIngestError(
        "visual_evidence_asset_conflict",
        "visual evidence asset path already exists with a different sha256",
        409,
      );
    }
    if (!existing.contentType || !IMAGE_CONTENT_TYPE_RE.test(existing.contentType)) {
      throw new ProjectVisualEvidenceIngestError(
        "visual_evidence_asset_conflict",
        "visual evidence asset path already exists with a non-image content type",
        409,
      );
    }
    return existing;
  }

  return upsertProjectAsset({
    projectId: input.projectId,
    originalName: input.originalName,
    contentType: input.contentType,
    buffer: input.buffer,
    assetPath: input.assetPath,
    uploadedById: input.uploadedById,
  });
}

function normalizeSha256(value: string | null | undefined): string | null {
  const trimmed = value?.trim().toLowerCase();
  if (!trimmed) return null;
  const normalized = trimmed.startsWith("sha256:") ? trimmed : `sha256:${trimmed}`;
  return VISUAL_EVIDENCE_DIGEST_RE.test(normalized) ? normalized : null;
}

function normalizeAssetSha256(value: string | null | undefined): string | null {
  return normalizeSha256(value);
}

function compactString(value: string | null | undefined, maxLength: number): string | null {
  const text = value?.replace(/\s+/g, " ").trim();
  if (!text) return null;
  return text.length <= maxLength ? text : `${text.slice(0, maxLength - 3).trim()}...`;
}

function cleanIsoTimestamp(value: string | null | undefined): string | null {
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0);
}

function isRecord(value: unknown): value is ProgressRecord {
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
