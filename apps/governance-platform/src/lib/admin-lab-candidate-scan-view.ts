import type { SnapshotTaskCandidateView } from "./admin-lab-snapshot-view";

export type CandidateScanProjectView = {
  projectId: string;
  projectName: string;
  classification: string;
  previewHealth: string;
  visualEvidencePolicyStatus: string | null;
  visualEvidenceMode: "off" | "required" | "new_tasks_only" | null;
  visualEvidencePolicyBlockers: string[];
  visualWorkbenchManifestStatus: string | null;
  visualWorkbenchCanRunCapture: boolean | null;
  visualWorkbenchProjectClass: string | null;
  visualWorkbenchManifestBlockers: string[];
  visualWorkbenchManifestUnknowns: string[];
  directExecutorCandidateCount: number | null;
  resumeCheckpointRequiredCount: number | null;
  visualEvidenceRequiredCount: number | null;
  visualEvidenceNotRequiredCount: number | null;
  visualEvidenceUnknownCount: number | null;
  candidates: SnapshotTaskCandidateView[];
};

export type CandidateScanOperatorNotice = {
  tone: "info" | "warning";
  title: string;
  body: string;
};

export function getCandidateScanProjects(scan: unknown): CandidateScanProjectView[] {
  const result = readRecord(scan);
  return readArrayField(result, "candidateProjects").flatMap((item): CandidateScanProjectView[] => {
    const record = readRecord(item);
    const project = readRecord(record?.project);
    const lifecycle = readRecord(record?.lifecycle);
    const visualEvidencePolicy = readRecord(record?.visualEvidencePolicy);
    const visualWorkbenchManifestReadiness = readRecord(record?.visualWorkbenchManifestReadiness);
    const candidateSummary = readRecord(record?.candidateSummary);
    const projectId = readString(project?.id);
    if (!projectId) return [];

    return [{
      projectId,
      projectName: readString(project?.name) ?? projectId,
      classification: readString(lifecycle?.classification) ?? "unknown",
      previewHealth: readString(lifecycle?.previewHealth) ?? "preview unknown",
      visualEvidencePolicyStatus: readString(visualEvidencePolicy?.status),
      visualEvidenceMode: readVisualEvidenceMode(visualEvidencePolicy?.visualEvidenceMode),
      visualEvidencePolicyBlockers: readStringArrayField(visualEvidencePolicy, "blockers"),
      visualWorkbenchManifestStatus: readString(visualWorkbenchManifestReadiness?.status),
      visualWorkbenchCanRunCapture: readBoolean(visualWorkbenchManifestReadiness?.canRunWorkbenchCapture),
      visualWorkbenchProjectClass: readString(visualWorkbenchManifestReadiness?.projectClass),
      visualWorkbenchManifestBlockers: readStringArrayField(visualWorkbenchManifestReadiness, "blockers"),
      visualWorkbenchManifestUnknowns: readStringArrayField(visualWorkbenchManifestReadiness, "unknowns"),
      directExecutorCandidateCount: readFiniteNumber(candidateSummary?.directExecutorCandidateCount),
      resumeCheckpointRequiredCount: readFiniteNumber(candidateSummary?.resumeCheckpointRequiredCount),
      visualEvidenceRequiredCount: readFiniteNumber(candidateSummary?.visualEvidenceRequiredCount),
      visualEvidenceNotRequiredCount: readFiniteNumber(candidateSummary?.visualEvidenceNotRequiredCount),
      visualEvidenceUnknownCount: readFiniteNumber(candidateSummary?.visualEvidenceUnknownCount),
      candidates: readArrayField(record, "taskCandidates").flatMap(readCandidateTask),
    }];
  });
}

export function getCandidateScanOperatorNotice(scan: unknown): CandidateScanOperatorNotice | null {
  const result = readRecord(scan);
  if (!result) return null;

  const scanMeta = readRecord(result.scan);
  const projects = getCandidateScanProjects(scan);
  const candidateProjectCount = readFiniteNumber(scanMeta?.candidateProjectCount) ?? projects.length;
  const scannedProjectCount = readFiniteNumber(scanMeta?.scannedProjectCount) ?? null;
  const eligibleProjectCount = readFiniteNumber(scanMeta?.eligibleProjectCount) ?? scannedProjectCount;
  const omittedProjectCount = readFiniteNumber(scanMeta?.omittedProjectCount) ?? 0;
  const truncated = scanMeta?.truncated === true;
  const directExecutorCandidateCount = projects.reduce(
    (sum, project) => sum + (project.directExecutorCandidateCount ?? 0),
    0,
  );
  const directExecutorCandidateProjects = projects.filter((project) => (project.directExecutorCandidateCount ?? 0) > 0);
  const resumeCheckpointRequiredCount = projects.reduce(
    (sum, project) => sum + (project.resumeCheckpointRequiredCount ?? 0),
    0,
  );
  const visualEvidenceRequiredCount = projects.reduce(
    (sum, project) => sum + (project.visualEvidenceRequiredCount ?? 0),
    0,
  );
  const visualEvidenceCountsKnownForDirectCandidates = directExecutorCandidateProjects.every((project) => (
    project.visualEvidenceRequiredCount !== null
    && project.visualEvidenceNotRequiredCount !== null
    && project.visualEvidenceUnknownCount !== null
  ));

  if (candidateProjectCount <= 0) {
    if (truncated && scannedProjectCount !== null && eligibleProjectCount !== null) {
      return {
        tone: "warning",
        title: "No task candidates in this capped scan",
        body: `The scan checked ${scannedProjectCount} of ${eligibleProjectCount} eligible projects and omitted ${omittedProjectCount}. Raise the limit before treating this as fleet-wide.`,
      };
    }

    return {
      tone: "info",
      title: "No task candidates in this scan",
      body: "No pending, failed or interrupted task candidates were found in the scanned project set.",
    };
  }

  if (directExecutorCandidateCount === 0 && resumeCheckpointRequiredCount > 0) {
    return {
      tone: "warning",
      title: "No executor-ready task yet",
      body: "The scan found only interrupted resume candidates. Pick one and run Get task context for that task; executor resume is safe only after context confirms a matching provider-session checkpoint.",
    };
  }

  if (directExecutorCandidateCount > 0 && visualEvidenceCountsKnownForDirectCandidates && visualEvidenceRequiredCount === 0) {
    return {
      tone: "info",
      title: "No visual-marked executor task in this scan",
      body: resumeCheckpointRequiredCount > 0
        ? "Pending and failed tasks exist, but none are marked visual evidence required. Interrupted rows still need Get task context with a matching provider-session checkpoint."
        : "Pending and failed tasks exist, but none are marked visual evidence required. Use this scan when you do not need a visual-marked task, or choose another project/work packet for a visual walkthrough.",
    };
  }

  if (directExecutorCandidateCount > 0 && resumeCheckpointRequiredCount > 0) {
    return {
      tone: "info",
      title: "Some rows need a checkpoint",
      body: "Pending and failed tasks are executor-ready. Interrupted resume rows still need Get task context with a matching provider-session checkpoint.",
    };
  }

  return null;
}

function readCandidateTask(value: unknown): SnapshotTaskCandidateView[] {
  const record = readRecord(value);
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
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? value as Record<string, unknown> : null;
}

function readArrayField(value: Record<string, unknown> | null, field: string): unknown[] {
  const values = value?.[field];
  return Array.isArray(values) ? values : [];
}

function readStringArrayField(value: Record<string, unknown> | null, field: string): string[] {
  return readArrayField(value, field).filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function readFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function readVisualEvidenceMode(value: unknown): CandidateScanProjectView["visualEvidenceMode"] {
  if (value === "off" || value === "required" || value === "new_tasks_only") return value;
  return null;
}

function readCandidateStatus(value: unknown): SnapshotTaskCandidateView["status"] | null {
  if (value === "pending" || value === "failed" || value === "in_progress") return value;
  return null;
}

function readRecommendedExecutorMode(value: unknown): SnapshotTaskCandidateView["recommendedExecutorMode"] | null {
  if (value === "new_task" || value === "failed_task" || value === "resume_interrupted") return value;
  return null;
}
