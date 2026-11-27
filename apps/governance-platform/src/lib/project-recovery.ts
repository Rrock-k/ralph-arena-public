import { getProjectState, getWorkerSnapshot } from "@/lib/control-plane";
import { isLocalPreviewUrl } from "@/lib/preview-url";
import { hasLivePreviewFact, isRetainedPreviewRow } from "@/lib/preview-state";
import { getPrimaryLifecycleComponent } from "@/lib/project-lifecycle";
import {
  getActionableRuntimeGenerationReasons,
  getRuntimeGenerationReasons,
  hasActionableRuntimeGenerationDrift as hasActionableProjectRuntimeGenerationDrift,
} from "@/lib/runtime-generation";
import {
  getActionableWorkerParityReasons,
  getWorkerParityReasons,
} from "@/lib/worker-parity";
import type {
  RecoveryAttemptInput,
  RecoveryAttemptRecord,
  RecoveryAttemptResult,
  RecoveryCohort,
  RecoveryDiagnosis,
  RecoveryPreviewReachabilityClassification,
  RecoverySnapshot,
  RecoverySuggestedAction,
} from "@/lib/project-recovery-types";

type WorkerState = Awaited<ReturnType<typeof getWorkerSnapshot>>;
type RecoveryExpectedCohort =
  | "healthy"
  | "parked"
  | "garbage";

function asIso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function normalizeInspectStatus(worker: WorkerState | null | undefined): RecoverySnapshot["worker"]["inspectStatus"] {
  if (!worker?.workerUrl) return "missing_worker";
  const status = worker.inspect?.status;
  if (status === "running" || status === "stopped" || status === "not_found") return status;
  return "error";
}

function classifyPreviewReachabilityStatus(status: number | null): RecoveryPreviewReachabilityClassification {
  if (status === null) return "unreachable";
  if (status === 301 || status === 302 || (status >= 200 && status < 300)) return "reachable";
  if (status === 401 || status === 403) return "auth_gated";
  return "down";
}

async function checkPreviewReachability(url: string | null): Promise<RecoverySnapshot["previewReachability"]> {
  if (!url) {
    return {
      classification: "unreachable",
      status: null,
    };
  }

  try {
    const response = await fetch(url, {
      method: "GET",
      redirect: "manual",
      signal: AbortSignal.timeout(5_000),
    });
    return {
      classification: classifyPreviewReachabilityStatus(response.status),
      status: response.status,
    };
  } catch {
    return {
      classification: "unreachable",
      status: null,
    };
  }
}

function isHealthy(snapshot: RecoverySnapshot): boolean {
  return hasLivePreviewFact(snapshot.component)
    && snapshot.component.blockers.length === 0
    && snapshot.worker.inspectStatus === "running";
}

function previewProbeUrl(snapshot: RecoverySnapshot): string | null {
  return snapshot.component.previewUrl ?? null;
}

function isLocalPreviewProbeNonAuthoritative(snapshot: RecoverySnapshot): boolean {
  const url = previewProbeUrl(snapshot);
  return url != null && isLocalPreviewUrl(url);
}

function hasLivePreviewEvidence(snapshot: RecoverySnapshot): boolean {
  if (
    snapshot.previewReachability.classification === "auth_gated"
    || snapshot.previewReachability.classification === "reachable"
  ) {
    return true;
  }

  return isLocalPreviewProbeNonAuthoritative(snapshot);
}

function isResidentIdleLoopMissingRuntime(component: RecoverySnapshot["component"]): boolean {
  return component.powerIntent === "ON"
    && component.agentIntent === "ON"
    && component.agentState === "IDLE"
    && component.blockers.length === 0
    && component.runtimeState !== "RUNNING";
}

function isMaintenanceSafeResidentRuntime(component: RecoverySnapshot["component"]): boolean {
  if (
    component.powerIntent !== "ON"
    || component.runtimeState !== "RUNNING"
    || component.agentState !== "IDLE"
  ) {
    return false;
  }

  return component.blockers.length > 0
    || component.agentIntent === "OFF"
    || component.lastOutcome === "COMPLETED"
    || component.lastOutcome === "FAILED";
}

function isPreviewRestoreHistory(component: RecoverySnapshot["component"]): boolean {
  return isRetainedPreviewRow(component)
    || (
      component.agentIntent === "ON"
      && component.agentState === "IDLE"
      && component.lastOutcome === "FAILED"
    );
}

function hasActionableRuntimeGenerationDrift(snapshot: RecoverySnapshot): boolean {
  return isMaintenanceSafeResidentRuntime(snapshot.component)
    && hasActionableProjectRuntimeGenerationDrift({
      status: snapshot.worker.runtimeGenerationStatus,
      reasons: snapshot.worker.actionableRuntimeGenerationReasons,
    });
}

function isLivePreviewUsable(snapshot: RecoverySnapshot): boolean {
  const component = snapshot.component;
  return component.powerIntent === "ON"
    && component.runtimeState === "RUNNING"
    && component.agentState === "RUNNING"
    && (component.lastOutcome === null || component.lastOutcome === "COMPLETED")
    && component.blockers.length === 0
    && component.previewHealth !== "UNHEALTHY"
    && snapshot.worker.inspectStatus === "running"
    && hasLivePreviewEvidence(snapshot);
}

function isBlockedLivePreviewUsable(snapshot: RecoverySnapshot): boolean {
  const component = snapshot.component;
  return component.powerIntent === "ON"
    && component.agentIntent === "ON"
    && component.runtimeState === "RUNNING"
    && component.agentState === "IDLE"
    && component.blockers.length > 0
    && component.previewHealth !== "UNHEALTHY"
    && snapshot.worker.inspectStatus === "running"
    && hasLivePreviewEvidence(snapshot);
}

function isParkedButValid(component: RecoverySnapshot["component"]): boolean {
  if (component.powerIntent !== "OFF" || component.runtimeState !== "ABSENT") return false;

  if (isRetainedPreviewRow(component) || (component.agentState === "IDLE" && component.lastOutcome === null)) {
    return true;
  }
  if (component.lastOutcome === "FAILED" && component.agentState === "IDLE") {
    return true;
  }
  if (component.agentState === "IDLE" && component.blockers.length > 0) {
    return true;
  }

  return false;
}

function isGarbage(component: RecoverySnapshot["component"]): boolean {
  return component.id == null
    || component.powerIntent == null
    || component.runtimeState == null
    || (
      component.powerIntent === "OFF"
      && component.runtimeState === "ABSENT"
      && component.agentState == null
      && component.lastOutcome == null
    );
}

function classifyObservedCohort(snapshot: RecoverySnapshot): RecoveryCohort {
  const component = snapshot.component;
  if (isHealthy(snapshot)) return "healthy";
  if (isLivePreviewUsable(snapshot)) return "healthy";
  if (isBlockedLivePreviewUsable(snapshot)) return "healthy";
  if (isParkedButValid(component)) return "parked";
  if (isGarbage(component)) return "garbage";
  return "needs_recovery";
}

function classifyExpectedCohort(snapshot: RecoverySnapshot): RecoveryExpectedCohort {
  const component = snapshot.component;
  if (isGarbage(component)) return "garbage";
  if (snapshot.archivedAt != null) return "parked";
  if (component.powerIntent === "ON") return "healthy";
  return "parked";
}

function chooseSuggestedAction(snapshot: RecoverySnapshot, cohort: RecoveryCohort): RecoverySuggestedAction {
  const component = snapshot.component;

  if (hasActionableRuntimeGenerationDrift(snapshot)) {
    return "recreate_runtime";
  }
  if (cohort === "healthy" || cohort === "parked") {
    return "none";
  }
  if (cohort === "garbage") return "recreate_runtime";

  if (
    component.powerIntent === "ON"
    && (
      ["ABSENT", "STOPPED"].includes(component.runtimeState ?? "")
      || (
        component.runtimeState === "RUNNING"
        && snapshot.worker.inspectStatus !== "running"
      )
    )
    && isPreviewRestoreHistory(component)
  ) {
    return "preview_restore";
  }

  return "recreate_runtime";
}

function buildMismatches(snapshot: RecoverySnapshot, expectedCohort: RecoveryExpectedCohort, cohort: RecoveryCohort): string[] {
  const component = snapshot.component;
  const mismatches: string[] = [];

  if (expectedCohort !== cohort) {
    mismatches.push(`Expected cohort ${expectedCohort}, observed ${cohort}`);
  }
  if (component.agentState === "RUNNING" && component.runtimeState !== "RUNNING") {
    mismatches.push(`agentState=${component.agentState} but runtimeState=${component.runtimeState}`);
  }
  if (component.powerIntent === "OFF" && component.runtimeState === "RUNNING") {
    mismatches.push("powerIntent=OFF but runtimeState=RUNNING");
  }
  if (isResidentIdleLoopMissingRuntime(component)) {
    mismatches.push(`agentIntent=ON + agentState=IDLE + blockers=[] but runtimeState=${component.runtimeState}`);
  }
  if (component.agentState === "RUNNING" && component.blockers.length > 0) {
    mismatches.push(`agentState=${component.agentState} but blockers=${component.blockers.join(",")}`);
  }
  if (snapshot.worker.inspectStatus === "not_found" && component.runtimeState === "RUNNING") {
    mismatches.push("worker cannot inspect container but component still says RUNNING");
  }
  if (hasActionableRuntimeGenerationDrift(snapshot)) {
    mismatches.push(`runtime generation drift: ${snapshot.worker.actionableRuntimeGenerationReasons.join(", ")}`);
  }
  if (
    !["reachable", "auth_gated"].includes(snapshot.previewReachability.classification)
    && component.runtimeState === "RUNNING"
    && !isLocalPreviewProbeNonAuthoritative(snapshot)
  ) {
    mismatches.push(
      `preview is ${snapshot.previewReachability.classification} while runtimeState=${component.runtimeState}` +
        (snapshot.previewReachability.status != null ? ` (status=${snapshot.previewReachability.status})` : ""),
    );
  }

  return mismatches;
}

export function diagnoseRecoverySnapshot(snapshot: RecoverySnapshot): RecoveryDiagnosis {
  const expectedCohort = classifyExpectedCohort(snapshot);
  const cohort = classifyObservedCohort(snapshot);
  const suggestedAction = chooseSuggestedAction(snapshot, cohort);
  const mismatches = buildMismatches(snapshot, expectedCohort, cohort);

  return {
    cohort,
    mismatches,
    suggestedAction,
  };
}

export async function loadRecoverySnapshot(
  projectId: string,
): Promise<RecoverySnapshot | null> {
  const [project, worker] = await Promise.all([
    getProjectState(projectId),
    getWorkerSnapshot(projectId, { tail: 50 }),
  ]);
  if (!project) return null;

  const component = getPrimaryLifecycleComponent(project);
  const previewUrl = component?.previewUrl ?? null;
  const parityStatus = worker?.parity?.status === "clean" || worker?.parity?.status === "mismatch"
    ? worker.parity.status
    : null;
  const parityReasons = getWorkerParityReasons(worker?.parity);
  const actionableParityReasons = getActionableWorkerParityReasons(worker?.parity);
  const runtimeGenerationStatus =
    worker?.runtimeGeneration?.status === "clean" || worker?.runtimeGeneration?.status === "mismatch"
      ? worker.runtimeGeneration.status
      : null;
  const runtimeGenerationReasons = getRuntimeGenerationReasons(worker?.runtimeGeneration);
  const actionableRuntimeGenerationReasons = getActionableRuntimeGenerationReasons(worker?.runtimeGeneration);

  return {
    archivedAt: asIso(project.archivedAt),
    component: {
      id: component?.id ?? null,
      powerIntent: component?.powerIntent ?? null,
      agentIntent: component?.agentIntent ?? null,
      runtimeState: component?.runtimeState ?? null,
      agentState: component?.agentState ?? null,
      blockers: Array.isArray(component?.blockers) ? component.blockers.map(String) : [],
      lastOutcome: component?.lastOutcome ?? null,
      retryAt: asIso(component?.retryAt),
      retryCount: typeof component?.retryCount === "number" ? component.retryCount : null,
      provisionedAt: asIso(component?.provisionedAt),
      previewHealth: component?.previewHealth ?? null,
      previewUrl: component?.previewUrl ?? null,
      containerName: component?.containerName ?? null,
      workerHost: component?.workerHost ?? null,
    },
    worker: {
      workerUrl: worker?.workerUrl ?? null,
      inspectStatus: normalizeInspectStatus(worker),
      parityStatus,
      parityReasons,
      actionableParityReasons,
      runtimeGenerationStatus,
      runtimeGenerationReasons,
      actionableRuntimeGenerationReasons,
    },
    previewReachability: await checkPreviewReachability(previewUrl),
  };
}

export async function finalizeRecoveryAttemptReport(
  input: RecoveryAttemptInput,
  snapshotBefore: RecoverySnapshot,
  attempt: RecoveryAttemptRecord,
): Promise<RecoveryAttemptResult> {
  const snapshotAfter = await loadRecoverySnapshot(input.projectId);
  if (!snapshotAfter) {
    throw new Error(`Recovery snapshot disappeared for project ${input.projectId}`);
  }
  const beforeDiagnosis = diagnoseRecoverySnapshot(snapshotBefore);

  return {
    projectId: input.projectId,
    input,
    diagnosis: beforeDiagnosis,
    snapshotBefore,
    attempt,
    snapshotAfter,
  };
}
