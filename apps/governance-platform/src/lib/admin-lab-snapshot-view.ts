export type SnapshotTaskCandidateView = {
  id: string;
  title: string;
  status: "pending" | "failed" | "in_progress";
  recommendedExecutorMode: "new_task" | "failed_task" | "resume_interrupted";
  attempts: number | null;
  lastError: string | null;
  visualEvidenceRequired: boolean | null;
  feedbackItemRefCount: number;
};

export type SnapshotExecutorCheckpointReadback = {
  selectedTaskId: string | null;
  selectedTaskStatus: string | null;
  recommendedExecutorMode: SnapshotTaskCandidateView["recommendedExecutorMode"] | null;
  providerSessionStatus: string | null;
  selectedTaskSessionCount: number | null;
  selectedTaskResumableSessionCount: number | null;
  nextProjectActionId: "resume_agent" | null;
  status: "not_selected" | "not_executor_candidate" | "not_checkpoint_gated" | "checkpoint_ready" | "checkpoint_blocked";
  tone: "good" | "warn" | "neutral";
  title: string;
  message: string;
  canPrepareExecutor: boolean;
};

export type SnapshotSelectedTaskVisualReadback = {
  selectedTaskId: string | null;
  selectedTaskStatus: string | null;
  visualEvidenceRequired: boolean | null;
  visualEvidenceMode: "off" | "required" | "new_tasks_only" | null;
  visualEvidencePolicyStatus: string | null;
  visualWorkbenchManifestStatus: string | null;
  canRunWorkbenchCapture: boolean;
  visualExpectationSources: string[];
  nextProjectActionId: "check_story_selection" | null;
  status: "not_selected" | "not_applicable" | "check_story_selection_ready" | "check_story_selection_blocked";
  tone: "good" | "warn" | "neutral";
  title: string;
  message: string;
  canCheckStorySelection: boolean;
};

export type SnapshotSelectedTaskWorkbenchAutomationReadback = {
  selectedTaskId: string | null;
  iterationLogStatus: string | null;
  path: string | null;
  status: "not_selected" | "missing" | "invalid" | "not_found" | "ready";
  tone: "good" | "warn" | "neutral";
  title: string;
  message: string;
  automation: null | {
    ownerBoundary: "ralph.visual-workbench-evidence-automation";
    iteration: number | null;
    timestamp: string | null;
    outcome: string | null;
    status: string;
    sourceRef: string | null;
    reportPath: string | null;
    diagnosticReportPath: string | null;
    selectorStatus: string | null;
    shellPolicyStatus: string | null;
    browserReadinessStatus: string | null;
    captureStatus: string | null;
    exportedEvidenceRefs: number | null;
    publishedRows: number | null;
    blockers: string[];
  };
};

export function getSnapshotTaskCandidates(snapshot: unknown): SnapshotTaskCandidateView[] {
  const plan = readRecord(readRecord(snapshot)?.plan);
  const candidates = Array.isArray(plan?.taskCandidates) ? plan.taskCandidates : [];

  return candidates.flatMap((candidate): SnapshotTaskCandidateView[] => {
    const record = readRecord(candidate);
    const id = readString(record?.id);
    const status = readCandidateStatus(record?.status);
    const recommendedExecutorMode = readRecommendedExecutorMode(record?.recommendedExecutorMode);
    if (!id || !status || !recommendedExecutorMode) return [];

    return [{
      id,
      title: readString(record?.displayTitle) ?? id,
      status,
      recommendedExecutorMode,
      attempts: readFiniteNumber(record?.attempts),
      lastError: readString(record?.lastError),
      visualEvidenceRequired: typeof record?.visualEvidenceRequired === "boolean"
        ? record.visualEvidenceRequired
        : null,
      feedbackItemRefCount: readFiniteNumber(record?.feedbackItemRefCount) ?? 0,
    }];
  });
}

export function getSnapshotExecutorCheckpointReadback(snapshot: unknown): SnapshotExecutorCheckpointReadback | null {
  const root = readRecord(snapshot);
  if (!root) return null;

  const providerSessions = readRecord(root.providerSessions);
  return readSnapshotCheckpointReadback(providerSessions?.selectedTaskCheckpointReadback);
}

export function getSnapshotSelectedTaskVisualReadback(snapshot: unknown): SnapshotSelectedTaskVisualReadback | null {
  const root = readRecord(snapshot);
  if (!root) return null;

  return readSnapshotSelectedTaskVisualReadback(root.selectedTaskVisualReadback);
}

export function getSnapshotSelectedTaskWorkbenchAutomationReadback(snapshot: unknown): SnapshotSelectedTaskWorkbenchAutomationReadback | null {
  const root = readRecord(snapshot);
  if (!root) return null;

  return readSnapshotSelectedTaskWorkbenchAutomationReadback(root.selectedTaskWorkbenchAutomationReadback);
}

export function getSnapshotNextHandoff(snapshot: unknown): string[] {
  const values = readRecord(snapshot)?.nextHandoff;
  if (!Array.isArray(values)) return [];
  return values.flatMap((value): string[] => {
    const item = readString(value);
    return item ? [item] : [];
  });
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? value as Record<string, unknown> : null;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function readSnapshotCheckpointReadback(value: unknown): SnapshotExecutorCheckpointReadback | null {
  const record = readRecord(value);
  if (!record) return null;

  const status = readSnapshotCheckpointStatus(record.status);
  const tone = readSnapshotCheckpointTone(record.tone);
  const title = readString(record.title);
  const message = readString(record.message);
  if (!status || !tone || !title || !message || typeof record.canPrepareExecutor !== "boolean") {
    return null;
  }

  return {
    selectedTaskId: readString(record.selectedTaskId),
    selectedTaskStatus: readString(record.selectedTaskStatus),
    recommendedExecutorMode: readRecommendedExecutorMode(record.recommendedExecutorMode),
    providerSessionStatus: readString(record.providerSessionStatus),
    selectedTaskSessionCount: readFiniteNumber(record.selectedTaskSessionCount),
    selectedTaskResumableSessionCount: readFiniteNumber(record.selectedTaskResumableSessionCount),
    nextProjectActionId: readSnapshotProjectActionId(record.nextProjectActionId),
    status,
    tone,
    title,
    message,
    canPrepareExecutor: record.canPrepareExecutor,
  };
}

function readSnapshotCheckpointStatus(value: unknown): SnapshotExecutorCheckpointReadback["status"] | null {
  return value === "not_selected"
    || value === "not_executor_candidate"
    || value === "not_checkpoint_gated"
    || value === "checkpoint_ready"
    || value === "checkpoint_blocked"
    ? value
    : null;
}

function readSnapshotCheckpointTone(value: unknown): SnapshotExecutorCheckpointReadback["tone"] | null {
  return value === "good" || value === "warn" || value === "neutral" ? value : null;
}

function readSnapshotProjectActionId(value: unknown): SnapshotExecutorCheckpointReadback["nextProjectActionId"] {
  return value === "resume_agent" ? value : null;
}

function readSnapshotSelectedTaskVisualReadback(value: unknown): SnapshotSelectedTaskVisualReadback | null {
  const record = readRecord(value);
  if (!record) return null;

  const status = readSnapshotVisualStatus(record.status);
  const tone = readSnapshotCheckpointTone(record.tone);
  const title = readString(record.title);
  const message = readString(record.message);
  if (
    !status
    || !tone
    || !title
    || !message
    || typeof record.canCheckStorySelection !== "boolean"
    || typeof record.canRunWorkbenchCapture !== "boolean"
  ) {
    return null;
  }

  return {
    selectedTaskId: readString(record.selectedTaskId),
    selectedTaskStatus: readString(record.selectedTaskStatus),
    visualEvidenceRequired: typeof record.visualEvidenceRequired === "boolean" ? record.visualEvidenceRequired : null,
    visualEvidenceMode: readVisualEvidenceMode(record.visualEvidenceMode),
    visualEvidencePolicyStatus: readString(record.visualEvidencePolicyStatus),
    visualWorkbenchManifestStatus: readString(record.visualWorkbenchManifestStatus),
    canRunWorkbenchCapture: record.canRunWorkbenchCapture,
    visualExpectationSources: Array.isArray(record.visualExpectationSources)
      ? record.visualExpectationSources.flatMap((entry): string[] => {
        const source = readString(entry);
        return source ? [source] : [];
      })
      : [],
    nextProjectActionId: readSnapshotVisualActionId(record.nextProjectActionId),
    status,
    tone,
    title,
    message,
    canCheckStorySelection: record.canCheckStorySelection,
  };
}

function readSnapshotSelectedTaskWorkbenchAutomationReadback(value: unknown): SnapshotSelectedTaskWorkbenchAutomationReadback | null {
  const record = readRecord(value);
  if (!record) return null;

  const status = readSnapshotWorkbenchAutomationReadbackStatus(record.status);
  const tone = readSnapshotCheckpointTone(record.tone);
  const title = readString(record.title);
  const message = readString(record.message);
  if (!status || !tone || !title || !message) return null;

  return {
    selectedTaskId: readString(record.selectedTaskId),
    iterationLogStatus: readString(record.iterationLogStatus),
    path: readString(record.path),
    status,
    tone,
    title,
    message,
    automation: readSnapshotWorkbenchAutomationTelemetry(record.automation),
  };
}

function readSnapshotWorkbenchAutomationTelemetry(value: unknown): SnapshotSelectedTaskWorkbenchAutomationReadback["automation"] {
  const record = readRecord(value);
  if (!record || record.ownerBoundary !== "ralph.visual-workbench-evidence-automation") return null;
  const status = readString(record.status);
  if (!status) return null;

  return {
    ownerBoundary: "ralph.visual-workbench-evidence-automation",
    iteration: readFiniteNumber(record.iteration),
    timestamp: readString(record.timestamp),
    outcome: readString(record.outcome),
    status,
    sourceRef: readString(record.sourceRef),
    reportPath: readString(record.reportPath),
    diagnosticReportPath: readString(record.diagnosticReportPath),
    selectorStatus: readString(record.selectorStatus),
    shellPolicyStatus: readString(record.shellPolicyStatus),
    browserReadinessStatus: readString(record.browserReadinessStatus),
    captureStatus: readString(record.captureStatus),
    exportedEvidenceRefs: readFiniteNumber(record.exportedEvidenceRefs),
    publishedRows: readFiniteNumber(record.publishedRows),
    blockers: Array.isArray(record.blockers)
      ? record.blockers.flatMap((entry): string[] => {
        const blocker = readString(entry);
        return blocker ? [blocker] : [];
      })
      : [],
  };
}

function readSnapshotVisualStatus(value: unknown): SnapshotSelectedTaskVisualReadback["status"] | null {
  return value === "not_selected"
    || value === "not_applicable"
    || value === "check_story_selection_ready"
    || value === "check_story_selection_blocked"
    ? value
    : null;
}

function readSnapshotWorkbenchAutomationReadbackStatus(value: unknown): SnapshotSelectedTaskWorkbenchAutomationReadback["status"] | null {
  return value === "not_selected"
    || value === "missing"
    || value === "invalid"
    || value === "not_found"
    || value === "ready"
    ? value
    : null;
}

function readSnapshotVisualActionId(value: unknown): SnapshotSelectedTaskVisualReadback["nextProjectActionId"] {
  return value === "check_story_selection" ? value : null;
}

function readVisualEvidenceMode(value: unknown): SnapshotSelectedTaskVisualReadback["visualEvidenceMode"] {
  if (value === "off" || value === "required" || value === "new_tasks_only") return value;
  return null;
}

function readFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readCandidateStatus(value: unknown): SnapshotTaskCandidateView["status"] | null {
  if (value === "pending" || value === "failed" || value === "in_progress") return value;
  return null;
}

function readRecommendedExecutorMode(value: unknown): SnapshotTaskCandidateView["recommendedExecutorMode"] | null {
  if (value === "new_task" || value === "failed_task" || value === "resume_interrupted") return value;
  return null;
}
