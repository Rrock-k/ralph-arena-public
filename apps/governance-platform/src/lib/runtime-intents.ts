/**
 * RA-237: Runtime intents helper — determines what reconciliation action to take.
 * Uses the narrowed state model: intents, runtime presence, blockers, and pending loop work.
 */

import type { RuntimeIntentAction, RuntimeIntentRunnerMode } from "@arena/contracts";
import { hasTgSpecLaunchConfigurationGate, isAwaitingFirstTgSpecImport } from "@/lib/tg-spec-target";

type RuntimeIntentLeaseState = "SUCCEEDED" | "FAILED" | "CLAIMED" | "ABANDONED" | null;

export type RuntimeIntentCandidate = {
  powerIntent: "ON" | "OFF";
  agentIntent: "ON" | "OFF";
  runtimeState: "ABSENT" | "RUNNING" | "STOPPED";
  agentState: "IDLE" | "RUNNING" | null;
  provisionedAt: Date | null;
  pendingLoopWork: boolean;
  allowPreviewOnlyRestore: boolean;
  blockers: string[];
  containerName: string | null;
  workerHost: string | null;
  sourceConfig?: unknown;
  agentStartAllowed?: boolean | null;
  tgSpecLastImportedVersion?: number | null;
  lastAction?: RuntimeIntentAction | null;
  lastState: RuntimeIntentLeaseState;
  lastAttempt: number | null;
};

type CanClaimPreviewRestoreIntentOptions = {
  host: string;
  maxAttempts: number;
  capacity?: number;
  canReplaceExistingRuntime?: boolean;
  now?: Date;
};

export type RuntimeIntentPolicyRejectionReason =
  | "worker_host_mismatch"
  | "stop_retry_capacity_exhausted"
  | "power_off_runtime_not_running"
  | "awaiting_first_tg_spec_import"
  | "tg_spec_launch_configuration_gate"
  | "start_capacity_exhausted"
  | "runtime_not_startable_state"
  | "start_retry_capacity_exhausted"
  | "agent_state_not_claimable"
  | "agent_runtime_unsupported"
  | "start_mode_not_claimable";

export type RuntimeIntentClaimabilityEvaluation = {
  decision: { action: RuntimeIntentAction; runnerMode: RuntimeIntentRunnerMode } | null;
  rejectionReasons: RuntimeIntentPolicyRejectionReason[];
};

function isStopAction(action: RuntimeIntentAction | null | undefined): boolean {
  return action === "ensure_stopped" || action === "ensure_removed";
}

function getStopRetryCapacityRejection(
  candidate: RuntimeIntentCandidate,
  opts: CanClaimPreviewRestoreIntentOptions,
): RuntimeIntentPolicyRejectionReason | null {
  if (!isStopAction(candidate.lastAction ?? null)) {
    return null;
  }

  if (candidate.lastState == null || candidate.lastState === "SUCCEEDED") {
    return null;
  }

  if (candidate.lastState === "ABANDONED") return "stop_retry_capacity_exhausted";

  if (candidate.lastState !== "FAILED") return "stop_retry_capacity_exhausted";
  if ((candidate.lastAttempt ?? 0) >= opts.maxAttempts) return "stop_retry_capacity_exhausted";

  return null;
}

function getStartRetryCapacityRejection(
  candidate: RuntimeIntentCandidate,
  opts: CanClaimPreviewRestoreIntentOptions,
): RuntimeIntentPolicyRejectionReason | null {
  if (candidate.lastAction !== "ensure_running") {
    return null;
  }

  if (candidate.lastState == null || candidate.lastState === "SUCCEEDED") {
    return null;
  }

  if (candidate.lastState === "ABANDONED") return "start_retry_capacity_exhausted";

  if (candidate.lastState !== "FAILED") return "start_retry_capacity_exhausted";
  if ((candidate.lastAttempt ?? 0) >= opts.maxAttempts) return "start_retry_capacity_exhausted";

  return null;
}

function isClaimableAgentStateForStart(agentState: RuntimeIntentCandidate["agentState"]): boolean {
  return agentState == null || agentState === "IDLE";
}

function canStartAgentRun(candidate: RuntimeIntentCandidate): boolean {
  if (!candidate.pendingLoopWork) return false;
  if (candidate.provisionedAt != null) return true;
  // Idle preview reclaim yields runtime STOPPED without keeping a fake provisioned marker.
  // That row still carries real pending loop work and must be able to converge into agent_run.
  return candidate.runtimeState === "STOPPED";
}

export function getClaimableRuntimeIntent(
  candidate: RuntimeIntentCandidate,
  opts: CanClaimPreviewRestoreIntentOptions,
): { action: RuntimeIntentAction; runnerMode: RuntimeIntentRunnerMode } | null {
  return evaluateRuntimeIntentClaimability(candidate, opts).decision;
}

export function evaluateRuntimeIntentClaimability(
  candidate: RuntimeIntentCandidate,
  opts: CanClaimPreviewRestoreIntentOptions,
): RuntimeIntentClaimabilityEvaluation {
  if (candidate.workerHost && candidate.workerHost !== opts.host) {
    return rejected("worker_host_mismatch");
  }

  // Stop: power OFF but container still running
  if (candidate.powerIntent === "OFF") {
    const retryRejection = getStopRetryCapacityRejection(candidate, opts);
    if (retryRejection) return rejected(retryRejection);
    if (candidate.runtimeState === "RUNNING" && candidate.containerName?.trim()) {
      return claimable({ action: "ensure_stopped", runnerMode: "preview_only" });
    }
    return rejected("power_off_runtime_not_running");
  }

  // Start: power ON but container not running
  if (isAwaitingFirstTgSpecImport(candidate.sourceConfig, candidate.tgSpecLastImportedVersion)) {
    return rejected("awaiting_first_tg_spec_import");
  }
  if (hasTgSpecLaunchConfigurationGate(candidate.sourceConfig)) {
    return rejected("tg_spec_launch_configuration_gate");
  }
  if (
    opts.capacity !== undefined
    && opts.capacity <= 0
    && !opts.canReplaceExistingRuntime
  ) {
    return rejected("start_capacity_exhausted");
  }
  if (!["ABSENT", "STOPPED"].includes(candidate.runtimeState)) {
    return rejected("runtime_not_startable_state");
  }
  const retryRejection = getStartRetryCapacityRejection(candidate, opts);
  if (retryRejection) return rejected(retryRejection);

  // Preview-only parked rows (`agentIntent=OFF`) may restore even without a completed loop outcome.
  if (candidate.agentIntent === "OFF") {
    return claimable({ action: "ensure_running", runnerMode: "preview_only" });
  }

  if (!isClaimableAgentStateForStart(candidate.agentState)) {
    return rejected("agent_state_not_claimable");
  }

  // Recoverable blockers pause loop work, not app/preview restore.
  if (candidate.blockers.length > 0) {
    return claimable({ action: "ensure_running", runnerMode: "preview_only" });
  }

  if (candidate.pendingLoopWork && candidate.agentStartAllowed === false) {
    return rejected("agent_runtime_unsupported");
  }

  if (canStartAgentRun(candidate)) {
    return claimable({ action: "ensure_running", runnerMode: "agent_run" });
  }

  if (candidate.allowPreviewOnlyRestore) {
    return claimable({ action: "ensure_running", runnerMode: "preview_only" });
  }

  return rejected("start_mode_not_claimable");
}

function claimable(
  decision: { action: RuntimeIntentAction; runnerMode: RuntimeIntentRunnerMode },
): RuntimeIntentClaimabilityEvaluation {
  return { decision, rejectionReasons: [] };
}

function rejected(reason: RuntimeIntentPolicyRejectionReason): RuntimeIntentClaimabilityEvaluation {
  return { decision: null, rejectionReasons: [reason] };
}

export function canClaimPreviewRestoreIntent(
  candidate: RuntimeIntentCandidate,
  opts: CanClaimPreviewRestoreIntentOptions,
): boolean {
  const intent = getClaimableRuntimeIntent(candidate, opts);
  return intent?.action === "ensure_running" && intent.runnerMode === "preview_only";
}
