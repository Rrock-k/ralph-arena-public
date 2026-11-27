import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { createHash } from "node:crypto";
import { notifyProjectEvent } from "@/lib/progress-bus";
import { isRunnerAuthorized } from "@/lib/internal-auth";
import { prisma } from "@/lib/prisma";
import { applyStateChange, requirePrimaryComponentRow, updateComponentMetadata } from "@/lib/project-state-effects";
import { enqueueProjectUpdate, type ProjectUpdateEventType } from "@/lib/project-update-outbox";
import { resolveProjectTelegramMiniAppEntryUrl } from "@/lib/project-telegram-mini-app-url";
import {
  ProgressRequestSchema,
  parseAcceptedSpecArtifact,
  type AcceptedSpecArtifact,
  type AcceptedDiffItem,
} from "@arena/contracts";

type TransactionClient = Prisma.TransactionClient;
type ProgressDiffItemStatus = "pending" | "in_progress" | "completed" | "failed" | "skipped";
type ProgressWorkStage = "planner" | "controller";
type ProgressStepSnapshot = {
  id?: string;
  title?: string;
  status?: ProgressDiffItemStatus;
  diffItemId?: string;
  feedbackItemId?: string;
  coveredSummary?: string;
};
type AcceptedArtifactVersionRow = {
  version: number;
  acceptedArtifact: Prisma.JsonValue | null;
};

function getReportedProgressState(progressJson: string | null | undefined): string | null {
  if (!progressJson) return null;
  try {
    const parsed = JSON.parse(progressJson);
    return typeof parsed?.state === "string" ? parsed.state : null;
  } catch {
    return null;
  }
}

function getReportedPreviewHealth(previewActual: string | undefined): "HEALTHY" | "UNHEALTHY" | null {
  if (previewActual === "SERVING") return "HEALTHY";
  if (previewActual === "ERROR") return "UNHEALTHY";
  return null;
}

function isActiveProgressState(state: string | null | undefined, paused: boolean): boolean {
  return state != null && state !== "idle" && !paused;
}

function compactProgressText(value: unknown, maxLength = 140): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.replace(/\s+/g, " ").trim();
  if (!text) return undefined;
  return text.length > maxLength ? `${text.slice(0, maxLength - 3).trim()}...` : text;
}

function progressText(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.replace(/\s+/g, " ").trim();
  return text || undefined;
}

function nonNegativeInt(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) return undefined;
  return value;
}

function positiveInt(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) return undefined;
  return value;
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function progressWorkStageFromRecord(record: Record<string, unknown>): ProgressWorkStage | undefined {
  const explicitStage = typeof record.workStage === "string"
    ? record.workStage.trim().toLowerCase()
    : "";
  if (explicitStage === "planner" || explicitStage === "controller") {
    return explicitStage;
  }

  const state = typeof record.state === "string"
    ? record.state.trim().toLowerCase()
    : "";
  if (state === "planning" || state === "planner" || state === "context_building") {
    return "planner";
  }
  if (state === "controlling" || state === "controller" || state === "control" || state === "audit") {
    return "controller";
  }
  return undefined;
}

function safeArtifactId(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const id = value.trim().toUpperCase();
  return /^[A-Z][A-Z0-9_:-]{1,119}$/.test(id) ? id : undefined;
}

function safeVersionLabel(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const label = value.replace(/\s+/g, " ").trim();
  if (!/^v?[0-9][0-9A-Za-z._-]{0,39}$/.test(label)) return undefined;
  return label.startsWith("v") || label.startsWith("V") ? `v${label.slice(1)}` : `v${label}`;
}

function normalizeProgressDiffStatus(value: unknown): ProgressDiffItemStatus | null {
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

function mergeProgressDiffStatus(
  current: ProgressDiffItemStatus | undefined,
  next: ProgressDiffItemStatus,
): ProgressDiffItemStatus {
  if (!current) return next;
  if (current === "in_progress" || next === "in_progress") return "in_progress";
  if (current === "failed" || next === "failed") return "failed";
  if (current === "pending" || next === "pending") return "pending";
  if (current === "completed" || next === "completed") return "completed";
  if (current === "skipped" || next === "skipped") return "skipped";
  return "completed";
}

function progressDiffItemStatusesFromJson(progressJson: string | null | undefined): Map<string, ProgressDiffItemStatus> {
  const statuses = new Map<string, ProgressDiffItemStatus>();
  if (!progressJson) return statuses;

  let parsed: unknown;
  try {
    parsed = JSON.parse(progressJson);
  } catch {
    return statuses;
  }

  const record = asObject(parsed);
  if (!record || !Array.isArray(record.steps)) return statuses;

  for (const rawStep of record.steps) {
    const step = asObject(rawStep);
    if (!step) continue;
    const status = normalizeProgressDiffStatus(step.status);
    if (!status) continue;

    const refs = Array.isArray(step.feedbackItemRefs) ? step.feedbackItemRefs : [];
    for (const rawRef of refs) {
      const ref = asObject(rawRef);
      if (!ref) continue;
      const diffItemId = safeArtifactId(ref.diffItemId);
      if (!diffItemId) continue;
      statuses.set(diffItemId, mergeProgressDiffStatus(statuses.get(diffItemId), status));
    }
  }

  return statuses;
}

function progressVersionLabelFromJson(progressJson: string | null | undefined): string | undefined {
  if (!progressJson) return undefined;

  let parsed: unknown;
  try {
    parsed = JSON.parse(progressJson);
  } catch {
    return undefined;
  }

  const record = asObject(parsed);
  if (!record) return undefined;
  return safeVersionLabel(
    record.versionLabel
    ?? record.bundleVersion
    ?? record.buildVersion
    ?? record.releaseVersion
  );
}

function progressFeatureLabel(value: unknown): string | undefined {
  if (typeof value === "string") return compactProgressText(value);
  const record = asObject(value);
  if (!record) return undefined;
  return compactProgressText(record.displayTitle)
    ?? compactProgressText(record.label)
    ?? compactProgressText(record.title)
    ?? compactProgressText(record.description);
}

function progressStepSnapshotsFromJson(progressJson: string | null | undefined): ProgressStepSnapshot[] {
  if (!progressJson) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(progressJson);
  } catch {
    return [];
  }

  const record = asObject(parsed);
  if (!record || !Array.isArray(record.steps)) return [];

  return record.steps.flatMap((rawStep) => {
    const step = asObject(rawStep);
    if (!step) return [];
    const status = normalizeProgressDiffStatus(step.status);
    const id = compactProgressText(step.id, 120);
    const title = compactProgressText(step.displayTitle, 160)
      ?? compactProgressText(step.label, 160)
      ?? compactProgressText(step.title, 160)
      ?? compactProgressText(step.description, 160)
      ?? id;
    const refs = Array.isArray(step.feedbackItemRefs) ? step.feedbackItemRefs : [];
    const firstRef = refs
      .map((rawRef) => asObject(rawRef))
      .find((ref): ref is Record<string, unknown> => Boolean(ref));
    const diffItemId = firstRef ? safeArtifactId(firstRef.diffItemId) : undefined;
    const feedbackItemId = firstRef?.targetType === "feedback"
      ? safeArtifactId(firstRef.targetId)
      : undefined;
    const coveredSummary = firstRef ? progressText(firstRef.summary) : undefined;
    return [{
      ...(id ? { id } : {}),
      ...(title ? { title } : {}),
      ...(status ? { status } : {}),
      ...(diffItemId ? { diffItemId } : {}),
      ...(feedbackItemId ? { feedbackItemId } : {}),
      ...(coveredSummary ? { coveredSummary } : {}),
    }];
  });
}

function progressStepKey(step: ProgressStepSnapshot): string | undefined {
  if (step.id) return `id:${step.id}`;
  if (step.title) return `title:${step.title}`;
  return undefined;
}

function progressStepCompleted(status: ProgressDiffItemStatus | undefined): boolean {
  return status === "completed" || status === "skipped";
}

function completedTaskUpdatesFromProgressJson(
  previousProgressJson: string | null | undefined,
  nextProgressJson: string | null | undefined,
): Array<{
  dedupeKey: string;
  payload: Record<string, unknown>;
}> {
  const previousSteps = progressStepSnapshotsFromJson(previousProgressJson);
  const nextSteps = progressStepSnapshotsFromJson(nextProgressJson);
  if (previousSteps.length === 0 || nextSteps.length === 0) return [];

  const previousByKey = new Map<string, ProgressStepSnapshot>();
  for (const step of previousSteps) {
    const key = progressStepKey(step);
    if (key) previousByKey.set(key, step);
  }

  return nextSteps.flatMap((step) => {
    const key = progressStepKey(step);
    if (!key || !step.title || !progressStepCompleted(step.status)) return [];
    const previous = previousByKey.get(key);
    if (!previous || progressStepCompleted(previous.status)) return [];

    const payload = {
      ...(step.id ? { taskId: step.id } : {}),
      title: step.title,
      status: step.status,
      ...(step.diffItemId ? { diffItemId: step.diffItemId } : {}),
      ...(step.feedbackItemId ? { feedbackItemId: step.feedbackItemId } : {}),
      ...(step.coveredSummary ? { coveredSummary: step.coveredSummary } : {}),
    };
    const dedupeHash = createHash("sha256")
      .update(JSON.stringify(payload))
      .digest("hex")
      .slice(0, 16);
    return [{
      dedupeKey: `task-completed:${dedupeHash}`,
      payload,
    }];
  });
}

function progressUpdateFromJson(progressJson: string | null | undefined): {
  eventType: ProjectUpdateEventType;
  dedupeKey: string;
  payload: Record<string, unknown>;
} | null {
  if (!progressJson) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(progressJson);
  } catch {
    return null;
  }
  const record = asObject(parsed);
  if (!record) return null;

  const state = typeof record.state === "string" ? record.state : null;
  if (state === "idle" || state?.startsWith("paused_")) return null;

  const rawSteps = Array.isArray(record.steps) ? record.steps : [];
  const steps = rawSteps
    .map((entry) => asObject(entry))
    .filter((entry): entry is Record<string, unknown> => Boolean(entry))
    .map((entry) => ({
      label: compactProgressText(entry.displayTitle)
        ?? compactProgressText(entry.label)
        ?? compactProgressText(entry.title)
        ?? compactProgressText(entry.description)
        ?? compactProgressText(entry.id),
      status: typeof entry.status === "string" ? entry.status : null,
    }))
    .filter((entry) => entry.label || entry.status);

  const activeStep = steps.find((step) => step.status === "in_progress");
  const currentTask = activeStep?.label ?? progressFeatureLabel(record.currentFeature);
  const sourceVersion = positiveInt(record.sourceVersion);
  const targetSpecVersion = positiveInt(record.targetSpecVersion);
  const workItemCount = nonNegativeInt(record.workItemCount);
  const workStage = progressWorkStageFromRecord(record);
  const hasAcceptedUpdateScope = targetSpecVersion !== undefined;
  const sourcePayload = {
    ...(sourceVersion !== undefined ? { sourceVersion } : {}),
    ...(targetSpecVersion !== undefined ? { targetSpecVersion } : {}),
    ...(workItemCount !== undefined ? { workItemCount } : {}),
    ...(workStage ? { workStage } : {}),
  };

  const progressPayload = {
    ...(currentTask ? { currentTask } : {}),
    ...sourcePayload,
  };

  const eventType: ProjectUpdateEventType = !currentTask && hasAcceptedUpdateScope ? "plan.ready" : "progress.updated";
  const eventPayload = eventType === "plan.ready" ? sourcePayload : progressPayload;
  if (eventType === "plan.ready" && !hasAcceptedUpdateScope) return null;
  if (eventType !== "plan.ready" && Object.keys(eventPayload).length === 0) return null;

  const dedupeHash = createHash("sha256")
    .update(JSON.stringify({ eventType, payload: eventPayload }))
    .digest("hex")
    .slice(0, 16);
  return {
    eventType,
    dedupeKey: `progress:${dedupeHash}`,
    payload: eventPayload,
  };
}

function acceptedDiffItemRequiresLoopWork(item: AcceptedDiffItem): boolean {
  return item.workImpact === "requires_loop_work";
}

function progressDiffItemCompleted(status: ProgressDiffItemStatus | undefined): boolean {
  return status === "completed";
}

function completedChangeItemPayload(item: AcceptedDiffItem, versionLabel: string | undefined): Record<string, unknown> {
  const diffItemId = safeArtifactId(item.id);
  const feedbackItemId = item.targetType === "feedback" ? safeArtifactId(item.targetId) : undefined;
  const title = compactProgressText(item.summary, 120) ?? safeArtifactId(item.targetId) ?? diffItemId;
  return {
    diffItemId,
    feedbackItemId,
    title,
    verification: compactProgressText(item.summary, 500),
    coveredSummary: progressText(item.summary),
    ...(versionLabel ? { versionLabel } : {}),
  };
}

function isStoredAcceptedArtifact(value: unknown): boolean {
  const record = asObject(value);
  return record?.artifactSchemaVersion === "ra-287.accepted-spec-artifact.v1";
}

function parseAcceptedArtifactsForMilestones(
  versions: AcceptedArtifactVersionRow[],
): AcceptedSpecArtifact[] {
  return versions.flatMap((version) => {
    if (!version.acceptedArtifact) return [];
    if (!isStoredAcceptedArtifact(version.acceptedArtifact)) return [];
    return [parseAcceptedSpecArtifact(version.acceptedArtifact)];
  }).sort((left, right) => (
    left.acceptedDiff.targetSpecVersion - right.acceptedDiff.targetSpecVersion
    || new Date(left.acceptedAt).getTime() - new Date(right.acceptedAt).getTime()
  ));
}

function completedChangeBatchMilestones(input: {
  versions: AcceptedArtifactVersionRow[];
  progressJson: string | null | undefined;
  previewUrl: string | null | undefined;
  telegramMiniAppUrl?: string | null | undefined;
}): Array<{
  dedupeKey: string;
  payload: Record<string, unknown>;
}> {
  const diffItemStatuses = progressDiffItemStatusesFromJson(input.progressJson);
  const versionLabel = progressVersionLabelFromJson(input.progressJson);
  if (diffItemStatuses.size === 0) return [];

  const batches = parseAcceptedArtifactsForMilestones(input.versions)
    .map((artifact) => {
      const workItems = artifact.acceptedDiff.items.filter(acceptedDiffItemRequiresLoopWork);
      const hasKnownProgress = workItems.some((item) => diffItemStatuses.has(item.id));
      const completedItemCount = workItems.filter((item) => progressDiffItemCompleted(diffItemStatuses.get(item.id))).length;
      return {
        artifact,
        workItems,
        hasKnownProgress,
        completed: workItems.length > 0 && completedItemCount === workItems.length,
        completedItemCount,
      };
    })
    .filter((batch) => batch.workItems.length > 0);

  const latestWorkArtifactId = batches.at(-1)?.artifact.artifactId ?? null;
  const trackedBatches = batches.filter((batch) => (
    batch.hasKnownProgress || batch.artifact.artifactId === latestWorkArtifactId
  ));
  const incompleteBatches = trackedBatches.filter((batch) => !batch.completed);
  const incompleteBatchCount = incompleteBatches.length;
  const completedBatches = trackedBatches.filter((batch) => batch.completed);
  const completedMilestoneBatches = incompleteBatchCount === 0
    ? completedBatches.slice(-1)
    : completedBatches;

  return completedMilestoneBatches
    .map((batch) => {
      const nextBatch = incompleteBatches.find((candidate) => (
        candidate.artifact.acceptedDiff.targetSpecVersion > batch.artifact.acceptedDiff.targetSpecVersion
      )) ?? incompleteBatches[0];
      return {
        dedupeKey: `change-batch-completed:${batch.artifact.acceptedDiff.id}:${batch.workItems.length}`,
        payload: {
          sourceVersion: batch.artifact.source.sourceVersion,
          targetSpecVersion: batch.artifact.acceptedDiff.targetSpecVersion,
          diffId: batch.artifact.acceptedDiff.id,
          summary: batch.artifact.acceptedDiff.summary,
          workItemCount: batch.workItems.length,
          remainingBatchCount: incompleteBatchCount,
          ...(versionLabel ? { versionLabel } : {}),
          completedItems: batch.workItems.map((item) => completedChangeItemPayload(item, versionLabel)),
          ...(nextBatch
            ? {
                nextSourceVersion: nextBatch.artifact.source.sourceVersion,
                nextTargetSpecVersion: nextBatch.artifact.acceptedDiff.targetSpecVersion,
              }
            : {}),
          ...(input.previewUrl ? { previewUrl: input.previewUrl } : {}),
          ...(input.telegramMiniAppUrl ? { telegramMiniAppUrl: input.telegramMiniAppUrl } : {}),
        },
      };
    });
}

function safeAssumptionId(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const id = value.trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9_:-]{1,119}$/.test(id)) return undefined;
  if (id.startsWith("JUDGMENT-")) return undefined;
  return id;
}

function progressAssumptionReviewUpdatesFromJson(progressJson: string | null | undefined): Array<{
  dedupeKey: string;
  payload: Record<string, unknown>;
}> {
  if (!progressJson) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(progressJson);
  } catch {
    return [];
  }

  const record = asObject(parsed);
  if (!record || !Array.isArray(record.assumptionReviews)) return [];

  return record.assumptionReviews.flatMap((entry) => {
    const review = asObject(entry);
    if (!review) return [];

    const assumptionId = safeAssumptionId(review.id);
    const assumptionTitle = compactProgressText(review.title, 120);
    const statement = compactProgressText(review.statement, 180);
    if (!assumptionId || !assumptionTitle || !statement) return [];
    if (isLoopEvidenceAssumptionReview(assumptionTitle, statement)) return [];

    const payload = {
      reasonCode: "ASSUMPTION",
      assumptionId,
      assumptionTitle,
      summary: statement,
    };
    const dedupeHash = createHash("sha256")
      .update(JSON.stringify(payload))
      .digest("hex")
      .slice(0, 16);

    return [{
      dedupeKey: `assumption-review:${assumptionId}:${dedupeHash}`,
      payload,
    }];
  });
}

function isLoopEvidenceAssumptionReview(title: string, statement: string): boolean {
  const normalizedTitle = title.toLowerCase();
  const normalizedStatement = statement.toLowerCase();
  return normalizedTitle.startsWith("needs confirmation for ")
    || (normalizedStatement.includes("appears implemented")
      && normalizedStatement.includes("product evidence has not confirmed"));
}

export async function POST(request: Request) {
  try {
    const body = ProgressRequestSchema.parse(await request.json());

    if (!isRunnerAuthorized(request, { projectId: body.projectId })) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    let stateChanged = false;

    if (body.projectId) {
      const now = new Date();
      const telegramMiniAppUrl = body.telegramMiniAppUrl
        ?? (body.previewActual === "SERVING"
          ? await resolveProjectTelegramMiniAppEntryUrl(prisma, body.projectId)
          : null);

      const txResult = await prisma.$transaction(async (tx: TransactionClient) => {
        const row = await requirePrimaryComponentRow(tx, body.projectId!);
        const previousProjectProgress = Object.prototype.hasOwnProperty.call(body, "progressJson")
          ? await tx.project.findUnique({
              where: { id: body.projectId! },
              select: { progressJson: true },
            })
          : null;
        const reportedProgressState = getReportedProgressState(body.progressJson);
        const reportedPauseState = reportedProgressState?.startsWith("paused_") === true;
        const reportedActiveProgress = isActiveProgressState(reportedProgressState, reportedPauseState);
        const reportedPreviewHealth = getReportedPreviewHealth(body.previewActual);
        const hasLiveBlocker = (row.blockers?.length ?? 0) > 0;
        // Missing preview-only artifacts are not evidence that paused work progress should be cleared.
        const shouldPreserveBlockedProgressProjection =
          Object.prototype.hasOwnProperty.call(body, "progressJson")
          && body.progressJson === null
          && hasLiveBlocker;

        // A runner reporting progress for a RUNNING component must still own
        // the current runtime identity. Otherwise this is a stale retained
        // preview and must not mutate the active run.
        if (row.runtimeState === "RUNNING" && !row.containerName) {
          return { agentStateChanged: false, workStarted: false, previewReady: false };
        }

        const shouldIgnoreCompletedSuccessProgress =
          row.runtimeState === "RUNNING" &&
          row.agentState === "IDLE" &&
          row.lastOutcome === "COMPLETED";

        const shouldTransitionToRunning =
          row.runtimeState === "RUNNING" &&
          row.agentState === "IDLE" &&
          row.agentIntent !== "OFF" &&
          !hasLiveBlocker &&
          row.lastOutcome == null &&
          reportedActiveProgress;
        const shouldTransitionToIdle =
          row.runtimeState === "RUNNING" &&
          row.agentState === "RUNNING" &&
          (reportedProgressState === "idle" || reportedPauseState || hasLiveBlocker);

        if (shouldIgnoreCompletedSuccessProgress) {
          return { agentStateChanged: false, previewStateChanged: false, workStarted: false, previewReady: false, ignoredLateProgress: true };
        }

        if (shouldTransitionToRunning) {
          await applyStateChange(tx, body.projectId!, { type: "agentTransition", state: "RUNNING" }, {
            source: "runner",
            trigger: "progress_report",
          });
        }

        if (shouldTransitionToIdle) {
          await applyStateChange(tx, body.projectId!, { type: "agentTransition", state: "IDLE" }, {
            source: "runner",
            trigger: "progress_idle",
          });
        }

        const previewStateChanged = reportedPreviewHealth != null
          && (row.previewHealth !== reportedPreviewHealth || row.previewCheckedAt == null);

        await updateComponentMetadata(tx, body.projectId!, {
          lastHeartbeat: now,
          ...(previewStateChanged
            ? {
                previewHealth: reportedPreviewHealth,
                previewCheckedAt: now,
              }
            : {}),
        }, {
          source: "runner",
          trigger: "progress_heartbeat",
        });

        // Keep lock order aligned with resident status/heartbeat writes:
        // component state/metadata first, then project-level progress payloads.
        // This avoids Project -> ProjectComponent deadlocks against routes that
        // only own the component side and then write RunLog/Project FK edges.
        if (
          Object.prototype.hasOwnProperty.call(body, "progressJson")
          && !shouldPreserveBlockedProgressProjection
        ) {
          await tx.project.update({
            where: { id: body.projectId },
            data: { progressJson: body.progressJson ?? null },
          });
        }

        // RA-099: Subscription mode budget debit — increment usedCreditsUsd mid-run
        if (body.budgetDebitedUsd && body.budgetDebitedUsd > 0) {
          await tx.projectBudget.updateMany({
            where: { projectId: body.projectId, isEnabled: true },
            data: { usedCreditsUsd: { increment: body.budgetDebitedUsd } },
          });
          await tx.project.update({
            where: { id: body.projectId },
            data: { budgetDebitedUsd: { increment: body.budgetDebitedUsd } },
          });
        }

        if (shouldTransitionToRunning) {
          await enqueueProjectUpdate(tx, {
            projectId: body.projectId!,
            eventType: "work.started",
            dedupeKey: `progress-started:${now.toISOString()}`,
          });
        }

        const progressUpdate = progressUpdateFromJson(body.progressJson);
        for (const completedTaskUpdate of completedTaskUpdatesFromProgressJson(
          previousProjectProgress?.progressJson,
          body.progressJson,
        )) {
          await enqueueProjectUpdate(tx, {
            projectId: body.projectId!,
            eventType: "task.completed",
            dedupeKey: completedTaskUpdate.dedupeKey,
            payload: completedTaskUpdate.payload,
          });
        }

        if (progressUpdate) {
          await enqueueProjectUpdate(tx, {
            projectId: body.projectId!,
            eventType: progressUpdate.eventType,
            dedupeKey: progressUpdate.dedupeKey,
            payload: progressUpdate.payload,
          });
        }

        if (previewStateChanged && reportedPreviewHealth === "HEALTHY" && reportedActiveProgress && progressUpdate) {
          await enqueueProjectUpdate(tx, {
            projectId: body.projectId!,
            eventType: progressUpdate.eventType,
            dedupeKey: `progress-preview-active:${now.toISOString()}`,
            payload: progressUpdate.payload,
          });
        }

        if (progressDiffItemStatusesFromJson(body.progressJson).size > 0) {
          const projectForMilestones = await tx.project.findUnique({
            where: { id: body.projectId! },
            select: {
              specs: {
                select: {
                  versions: {
                    orderBy: { version: "desc" },
                    select: {
                      version: true,
                      acceptedArtifact: true,
                    },
                  },
                },
              },
            },
          });
          const versions = projectForMilestones?.specs.flatMap((spec) => spec.versions) ?? [];
          for (const milestone of completedChangeBatchMilestones({
            versions,
            progressJson: body.progressJson,
            previewUrl: row.previewUrl,
            telegramMiniAppUrl,
          })) {
            await enqueueProjectUpdate(tx, {
              projectId: body.projectId!,
              eventType: "change_batch.completed",
              dedupeKey: milestone.dedupeKey,
              payload: milestone.payload,
            });
          }
        }

        for (const assumptionReview of progressAssumptionReviewUpdatesFromJson(body.progressJson)) {
          await enqueueProjectUpdate(tx, {
            projectId: body.projectId!,
            eventType: "action.required",
            dedupeKey: assumptionReview.dedupeKey,
            payload: assumptionReview.payload,
          });
        }

        if (previewStateChanged && reportedPreviewHealth === "HEALTHY" && !reportedActiveProgress) {
          await enqueueProjectUpdate(tx, {
            projectId: body.projectId!,
            eventType: "preview.ready",
            dedupeKey: `preview-ready:${now.toISOString()}`,
            payload: {
              previewUrl: row.previewUrl,
              telegramMiniAppUrl,
            },
          });
        }

        return {
          agentStateChanged: shouldTransitionToRunning || shouldTransitionToIdle,
          previewStateChanged,
          workStarted: shouldTransitionToRunning,
          previewReady: previewStateChanged && reportedPreviewHealth === "HEALTHY" && !reportedActiveProgress,
          ignoredLateProgress: false,
        };
      }).catch((e) => {
        console.error("[project-progress] State sync failed:", e);
        return null;
      });

      if (!txResult) {
        return NextResponse.json({ error: "Project progress state sync failed" }, { status: 503 });
      }

      stateChanged = txResult?.agentStateChanged ?? false;
      const previewStateChanged = txResult?.previewStateChanged ?? false;
      if (txResult?.ignoredLateProgress) {
        return NextResponse.json({ ok: true, ignored: true });
      }

      stateChanged = stateChanged || previewStateChanged;
    }

    // Emit "changed" for real state transitions so LiveRefresh triggers RSC refresh;
    // keep "project_progress" for heartbeats to avoid excessive refreshes.
    const resolvedType = stateChanged ? "changed" : (body.eventType ?? "project_progress");
    if (body.projectId) {
      notifyProjectEvent(body.projectId, {
        type: resolvedType,
        status: body.status,
        budgetDebitedUsd: body.budgetDebitedUsd,
        estimatedCostUsd: body.estimatedCostUsd,
      });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[project-progress] Webhook handler error:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
