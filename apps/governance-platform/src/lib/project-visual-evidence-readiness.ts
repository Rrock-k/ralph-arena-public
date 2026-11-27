import type { ProjectInteractionSnapshot } from "@arena/contracts";

export type ProjectVisualEvidenceReadinessReasonCode =
  | "visual_evidence_reviews_available"
  | "visual_evidence_artifacts_missing"
  | "no_current_accepted_update"
  | "work_waiting_for_blocker"
  | "work_in_progress"
  | "work_pending"
  | "completed_without_visual_evidence"
  | "no_task_linked_visual_evidence";

export type ProjectVisualEvidenceReadinessStatus = "available" | "not_available";

export interface ProjectVisualEvidenceReadinessCounts {
  proofReviewCount: number;
  visualEvidenceReviewCount: number;
  reviewableVisualEvidenceReviewCount: number;
  unavailableVisualEvidenceArtifactCount: number;
  taskCount: number;
  activeBatchCount: number;
  activeWorkItemCount: number;
  completedActiveWorkItemCount: number;
  taskStatusCounts: {
    pending: number;
    inProgress: number;
    completed: number;
    failed: number;
    skipped: number;
  };
}

export interface ProjectVisualEvidenceReadiness {
  status: ProjectVisualEvidenceReadinessStatus;
  reasonCode: ProjectVisualEvidenceReadinessReasonCode;
  message: string;
  counts: ProjectVisualEvidenceReadinessCounts;
  statusSummaryStage: ProjectInteractionSnapshot["execution"]["statusSummary"]["stage"];
  blockers: ProjectInteractionSnapshot["app"]["blockers"];
  evidenceNotes: string[];
}

export function buildVisualEvidenceReadiness(
  snapshot: ProjectInteractionSnapshot,
): ProjectVisualEvidenceReadiness {
  const taskStatusCounts = {
    pending: 0,
    inProgress: 0,
    completed: 0,
    failed: 0,
    skipped: 0,
  };
  const reviewableVisualEvidenceReviews = selectReviewableVisualEvidenceReviews(snapshot);
  const unavailableVisualEvidenceArtifactCount =
    snapshot.visualEvidenceReviews.length - reviewableVisualEvidenceReviews.length;

  for (const task of snapshot.tasks) {
    if (task.status === "pending") taskStatusCounts.pending += 1;
    if (task.status === "in_progress") taskStatusCounts.inProgress += 1;
    if (task.status === "completed") taskStatusCounts.completed += 1;
    if (task.status === "failed") taskStatusCounts.failed += 1;
    if (task.status === "skipped") taskStatusCounts.skipped += 1;
  }

  const counts = {
    proofReviewCount: snapshot.proofReviews.length,
    visualEvidenceReviewCount: snapshot.visualEvidenceReviews.length,
    reviewableVisualEvidenceReviewCount: reviewableVisualEvidenceReviews.length,
    unavailableVisualEvidenceArtifactCount,
    taskCount: snapshot.tasks.length,
    activeBatchCount: snapshot.execution.activeChangeBatches.length,
    activeWorkItemCount: snapshot.execution.activeChangeBatches
      .reduce((sum, batch) => sum + batch.workItemCount, 0),
    completedActiveWorkItemCount: snapshot.execution.activeChangeBatches
      .reduce((sum, batch) => sum + batch.completedItemCount, 0),
    taskStatusCounts,
  };

  if (reviewableVisualEvidenceReviews.length > 0) {
    return visualEvidenceReadiness({
      status: "available",
      reasonCode: "visual_evidence_reviews_available",
      message: "Arena has current visual evidence reviews with available screenshot artifacts for this project.",
      snapshot,
      counts,
    });
  }

  if (snapshot.visualEvidenceReviews.length > 0) {
    return visualEvidenceReadiness({
      status: "not_available",
      reasonCode: "visual_evidence_artifacts_missing",
      message: "Arena has visual evidence metadata, but no available screenshot artifact is linked yet.",
      snapshot,
      counts,
    });
  }

  if (!snapshot.execution.latestAcceptedUpdate) {
    return visualEvidenceReadiness({
      status: "not_available",
      reasonCode: "no_current_accepted_update",
      message: "No current accepted update is available for visual evidence review.",
      snapshot,
      counts,
    });
  }

  if (snapshot.execution.statusSummary.stage === "waiting" && snapshot.app.blockers.length > 0) {
    return visualEvidenceReadiness({
      status: "not_available",
      reasonCode: "work_waiting_for_blocker",
      message: "The current accepted work is waiting on a lifecycle blocker before visual evidence can be produced.",
      snapshot,
      counts,
    });
  }

  if (taskStatusCounts.inProgress > 0 || snapshot.execution.statusSummary.stage === "working") {
    return visualEvidenceReadiness({
      status: "not_available",
      reasonCode: "work_in_progress",
      message: "Work is still in progress, so no reviewable visual evidence has been published yet.",
      snapshot,
      counts,
    });
  }

  if (taskStatusCounts.pending > 0 || snapshot.execution.statusSummary.stage === "planning") {
    return visualEvidenceReadiness({
      status: "not_available",
      reasonCode: "work_pending",
      message: "Accepted work exists, but no task-linked visual evidence has been published yet.",
      snapshot,
      counts,
    });
  }

  if (snapshot.execution.statusSummary.stage === "completed" || taskStatusCounts.completed > 0) {
    return visualEvidenceReadiness({
      status: "not_available",
      reasonCode: "completed_without_visual_evidence",
      message: "The current read model has completed work but no reviewable visual evidence rows.",
      snapshot,
      counts,
    });
  }

  return visualEvidenceReadiness({
    status: "not_available",
    reasonCode: "no_task_linked_visual_evidence",
    message: "No task-linked visual evidence reviews are available in the current Arena read model.",
    snapshot,
    counts,
  });
}

function visualEvidenceReadiness(input: {
  status: ProjectVisualEvidenceReadinessStatus;
  reasonCode: ProjectVisualEvidenceReadinessReasonCode;
  message: string;
  snapshot: ProjectInteractionSnapshot;
  counts: ProjectVisualEvidenceReadinessCounts;
}): ProjectVisualEvidenceReadiness {
  return {
    status: input.status,
    reasonCode: input.reasonCode,
    message: input.message,
    counts: input.counts,
    statusSummaryStage: input.snapshot.execution.statusSummary.stage,
    blockers: input.snapshot.app.blockers,
    evidenceNotes: [
      "This is read-side diagnostics over ProjectInteractionSnapshot; it does not scan raw Workbench folders, outbox rows or legacy proof assets.",
      "Telegram screenshot review availability comes only from artifact-backed visualEvidenceReviews.",
    ],
  };
}

export function selectReviewableVisualEvidenceReviews(
  snapshot: ProjectInteractionSnapshot,
): ProjectInteractionSnapshot["visualEvidenceReviews"] {
  return snapshot.visualEvidenceReviews.filter((review) =>
    review.artifact.availability === "available"
  );
}
