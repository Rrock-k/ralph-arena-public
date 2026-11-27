import * as z from "zod/v4";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { jsonResult, errorResult, toErrorMessage } from "../result.js";
import type { ArenaCtlContext } from "../tool-context.js";

type ProjectSnapshot = {
  id?: string;
  name?: string;
  archivedAt?: string | null;
  repoUrl?: string | null;
  repoBranch?: string | null;
  agent?: string | null;
  agentImpl?: string | null;
  model?: string | null;
  toolId?: string | null;
  agentLoopVersionId?: string | null;
  claudeAuthMode?: string | null;
  codexAuthMode?: string | null;
  providerBillingMode?: string | null;
  budget?: {
    isEnabled?: boolean;
  } | null;
  app?: {
    powerIntent?: string | null;
    agentIntent?: string | null;
    runtimeState?: string | null;
    agentState?: string | null;
    blockers?: string[] | null;
    lastOutcome?: string | null;
    previewHealth?: string | null;
    previewUrl?: string | null;
    retryAt?: string | null;
    retryCount?: number | null;
    provisionedAt?: string | null;
    containerName?: string | null;
    workerHost?: string | null;
    lastHeartbeat?: string | null;
  } | null;
  loopRuntime?: string | null;
  loopSupportStatus?: "supported" | "upgrade-required" | "unsupported" | null;
  loopSupportLabel?: string | null;
  loopSupportHint?: string | null;
  appStartAllowed?: boolean;
  agentStartAllowed?: boolean;
  relaunchAllowed?: boolean;
  tgSpecLaunchConfiguration?: TgSpecLaunchConfiguration | null;
};

type TgSpecLaunchConfiguration =
  | "tg_spec_launch_configuration_required"
  | "tg_spec_launch_configuration_configured";

type WorkerInspect = {
  status?: string | null;
  exitCode?: number | null;
  oomKilled?: boolean | null;
  error?: string | null;
  pidsCurrent?: number | null;
};

type WorkerResourcePressureSnapshot = {
  constrained?: boolean | null;
  reasons?: unknown;
  memory?: {
    usageBytes?: number | null;
    limitBytes?: number | null;
    usageRatio?: number | null;
    thresholdRatio?: number | null;
  } | null;
  pids?: {
    current?: number | null;
    limit?: number | null;
    threshold?: number | null;
  } | null;
  containers?: {
    sampled?: number | null;
    running?: number | null;
  } | null;
};

type WorkerSnapshot = {
  error?: string | null;
  workerUrl?: string | null;
  capacity?: {
    maxConcurrentRuns?: number | null;
    activePreviewContainerCount?: number | null;
    availableStartCapacity?: number | null;
    trackedActivePreviewContainerCount?: number | null;
    staleTrackedPreviewContainers?: unknown;
    untrackedActivePreviewContainers?: unknown;
    resourcePressure?: WorkerResourcePressureSnapshot | null;
  } | null;
  logs?: unknown;
  inspect?: WorkerInspect | null;
  parity?: {
    status?: string | null;
    reasons?: unknown;
  } | null;
  runtimeGeneration?: {
    status?: string | null;
    reasons?: unknown;
  } | null;
};

function isActionableRuntimeGenerationReason(reason: string): boolean {
  return reason.startsWith("runtime_runner_version_mismatch:");
}

function isActionableWorkerServiceGenerationReason(reason: string): boolean {
  return reason.startsWith("worker_sha_mismatch:")
    || reason.startsWith("runner_sha_mismatch:")
    || reason.startsWith("worker_image_mismatch:");
}

function isRetryableBlocker(blocker: string): boolean {
  return blocker === "RATE_LIMIT" || blocker === "INFRA" || blocker === "API" || blocker === "MANUAL";
}

export type ProjectExplain = {
  truth: {
    projectId: string;
    projectName: string;
    archived: boolean;
    powerIntent: string | null;
    agentIntent: string | null;
    runtimeState: string | null;
    agentState: string | null;
    blockers: string[];
    lastOutcome: string | null;
    previewHealth: string | null;
    previewUrl: string | null;
    repoUrl: string | null;
    repoBranch: string | null;
    agent: string | null;
    agentImpl: string | null;
    model: string | null;
    toolId: string | null;
    agentLoopVersionId: string | null;
    claudeAuthMode: string | null;
    codexAuthMode: string | null;
    providerBillingMode: string | null;
    tgSpecLaunchConfiguration: TgSpecLaunchConfiguration | null;
    loopRuntime: string | null;
    loopSupportStatus: string | null;
    budgetEnabled: boolean | null;
    retryAt: string | null;
    retryCount: number;
    provisionedAt: string | null;
    runtimeGenerationStatus: string | null;
    runtimeGenerationReasons: string[];
    workerCapacity: {
      maxConcurrentRuns: number | null;
      activePreviewContainerCount: number | null;
      availableStartCapacity: number | null;
      trackedActivePreviewContainerCount: number | null;
      staleTrackedPreviewContainerCount: number;
      untrackedActivePreviewContainerCount: number;
      resourcePressure: {
        constrained: boolean | null;
        reasons: string[];
        memoryUsageBytes: number | null;
        memoryLimitBytes: number | null;
        memoryUsageRatio: number | null;
        memoryThresholdRatio: number | null;
        pidsCurrent: number | null;
        pidsLimit: number | null;
        pidThreshold: number | null;
        sampledContainerCount: number | null;
        runningContainerCount: number | null;
      } | null;
    } | null;
  };
  classification:
    | "healthy_preview_only"
    | "paused_preview"
    | "healthy_agent_run"
    | "parked"
    | "waiting_by_blocker"
    | "active_broken"
    | "unsupported_runtime"
    | "empty_bootstrap"
    | "tg_spec_launch_gated"
    | "provisioning_wait"
    | "manual_row";
  why: string[];
  allowedActions: string[];
  recommendedNextAction: string;
  operatorNotes: string[];
};

export function registerProjectExplainTool(server: McpServer, ctx: ArenaCtlContext) {
  server.registerTool("project_explain", {
    description:
      "Explain one project in strict operator language: live tuple truth, classification, why, allowed actions, and the best next move.",
    inputSchema: {
      projectId: z.string().min(1),
    },
  }, async ({ projectId }) => {
    try {
      const [snapshot, worker] = await Promise.all([
        ctx.governance.getProjectSnapshot(projectId) as Promise<ProjectSnapshot>,
        ctx.governance.getProjectWorkerSnapshot(projectId, 120) as Promise<WorkerSnapshot>,
      ]);

      return jsonResult(buildProjectExplain({ snapshot, worker }));
    } catch (error) {
      return errorResult(`Failed to explain project ${projectId}`, toErrorMessage(error));
    }
  });
}

export function buildProjectExplain(input: {
  snapshot: ProjectSnapshot;
  worker: WorkerSnapshot;
}): ProjectExplain {
  const snapshot = input.snapshot;
  if (!snapshot?.id || !snapshot.name) {
    throw new Error("Project snapshot payload is missing project identity");
  }

  const app = snapshot.app ?? null;
  const archived = snapshot.archivedAt != null;
  const powerIntent = app?.powerIntent ?? null;
  const agentIntent = app?.agentIntent ?? null;
  const runtimeState = app?.runtimeState ?? null;
  const agentState = app?.agentState ?? null;
  const blockers = Array.isArray(app?.blockers) ? app.blockers.filter(isNonEmptyString) : [];
  const lastOutcome = app?.lastOutcome ?? null;
  const previewHealth = app?.previewHealth ?? null;
  const previewUrl = app?.previewUrl ?? null;
  const tgSpecLaunchConfiguration = normalizeTgSpecLaunchConfiguration(snapshot.tgSpecLaunchConfiguration);
  const loopRuntime = snapshot.loopRuntime ?? null;
  const loopSupportStatus = snapshot.loopSupportStatus ?? null;
  const workerInspect = input.worker?.inspect ?? null;
  const workerLogText = toWorkerLogText(input.worker?.logs);
  const runtimeGenerationStatus = typeof input.worker?.runtimeGeneration?.status === "string"
    ? input.worker.runtimeGeneration.status
    : null;
  const runtimeGenerationReasons = Array.isArray(input.worker?.runtimeGeneration?.reasons)
    ? input.worker.runtimeGeneration.reasons.filter(isNonEmptyString)
    : [];
  const actionableRuntimeGenerationReasons = runtimeGenerationReasons.filter(isActionableRuntimeGenerationReason);
  const workerParityStatus = typeof input.worker?.parity?.status === "string"
    ? input.worker.parity.status
    : null;
  const workerParityReasons = Array.isArray(input.worker?.parity?.reasons)
    ? input.worker.parity.reasons.filter(isNonEmptyString)
    : [];
  const actionableWorkerParityReasons = workerParityReasons.filter(isActionableWorkerServiceGenerationReason);
  const workerCapacity = normalizeWorkerCapacity(input.worker?.capacity);
  const workerCapacityExhausted =
    powerIntent === "ON"
    && ["ABSENT", "STOPPED"].includes(runtimeState ?? "")
    && workerCapacity?.availableStartCapacity === 0;
  const hasBlockers = blockers.length > 0;
  const hasRetryableBlocker = blockers.some(isRetryableBlocker);
  const isMaintenanceSafeResidentRuntime =
    powerIntent === "ON"
    && runtimeState === "RUNNING"
    && agentState === "IDLE"
    && (
      hasBlockers
      || agentIntent === "OFF"
      || lastOutcome === "COMPLETED"
      || lastOutcome === "FAILED"
    );
  const actionableRuntimeGenerationDrift =
    runtimeGenerationStatus === "mismatch"
    && actionableRuntimeGenerationReasons.length > 0
    && isMaintenanceSafeResidentRuntime;
  const workerServiceGenerationDrift =
    workerParityStatus === "mismatch"
    && actionableWorkerParityReasons.length > 0
    && powerIntent === "ON"
    && runtimeState === "RUNNING"
    && agentState === "IDLE";

  const isHealthyLive = runtimeState === "RUNNING" && previewHealth === "HEALTHY";
  const isFailedIdleAgentRun =
    !hasBlockers
    && isHealthyLive
    && agentIntent === "ON"
    && agentState === "IDLE"
    && lastOutcome === "FAILED";
  const isUnfinishedIdleAgentRun =
    !hasBlockers
    && isHealthyLive
    && powerIntent === "ON"
    && agentIntent === "ON"
    && agentState === "IDLE"
    && lastOutcome == null;
  const isPausedPreview =
    !hasBlockers &&
    isHealthyLive &&
    agentIntent === "OFF" &&
    agentState === "IDLE" &&
    lastOutcome == null;
  const isWaitingByBlocker =
    hasBlockers
    && isHealthyLive
    && powerIntent === "ON"
    && agentIntent === "ON"
    && agentState === "IDLE"
    && lastOutcome == null;
  const isParked =
    powerIntent === "OFF"
    && agentIntent === "OFF"
    && runtimeState === "ABSENT"
    && agentState === "IDLE";
  const isProvisioningWait =
    !hasBlockers
    && powerIntent === "ON"
    && !isHealthyLive
    && ["ABSENT", "STOPPED"].includes(runtimeState ?? "")
    && !snapshot.repoUrl;
  const needsStoppedRuntimeReclaim =
    !hasBlockers
    && powerIntent === "ON"
    && !isHealthyLive
    && ["ABSENT", "STOPPED"].includes(runtimeState ?? "")
    && Boolean(snapshot.repoUrl);
  const hasEmptyBootstrapSignal = workerLogText.includes("No arena-start.sh found");
  const hasManualSignal = !snapshot.repoUrl;
  const hasTgSpecLaunchGate = !isHealthyLive && tgSpecLaunchConfiguration !== null;

  let classification: ProjectExplain["classification"];
  if (hasTgSpecLaunchGate) {
    classification = "tg_spec_launch_gated";
  } else if (isProvisioningWait) {
    classification = "provisioning_wait";
  } else if (!isHealthyLive && hasManualSignal) {
    classification = "manual_row";
  } else if (!isHealthyLive && hasEmptyBootstrapSignal) {
    classification = "empty_bootstrap";
  } else if (isWaitingByBlocker) {
    classification = "waiting_by_blocker";
  } else if (agentIntent === "ON" && snapshot.agentStartAllowed === false) {
    classification = "unsupported_runtime";
  } else if (isFailedIdleAgentRun) {
    classification = "active_broken";
  } else if (isUnfinishedIdleAgentRun) {
    classification = "active_broken";
  } else if (isPausedPreview) {
    classification = "paused_preview";
  } else if (!hasBlockers && isHealthyLive && agentIntent === "OFF" && agentState === "IDLE") {
    classification = "healthy_preview_only";
  } else if (!hasBlockers && isHealthyLive && agentIntent === "ON" && (agentState === "RUNNING" || agentState === "IDLE")) {
    classification = "healthy_agent_run";
  } else if (isParked || archived) {
    classification = "parked";
  } else {
    classification = "active_broken";
  }

  const allowedActions = buildAllowedActions({
    classification,
    archived,
    hasBlockers,
    hasRetryableBlocker,
    appStartAllowed: snapshot.appStartAllowed ?? true,
    agentStartAllowed: snapshot.agentStartAllowed ?? false,
    relaunchAllowed: snapshot.relaunchAllowed ?? false,
    actionableRuntimeGenerationDrift,
    needsRuntimeReclaim: isUnfinishedIdleAgentRun || needsStoppedRuntimeReclaim,
    workerCapacityExhausted,
    tgSpecLaunchConfiguration,
  });

  return {
    truth: {
      projectId: snapshot.id,
      projectName: snapshot.name,
      archived,
      powerIntent,
      agentIntent,
      runtimeState,
      agentState,
      blockers,
      lastOutcome,
      previewHealth,
      previewUrl,
      repoUrl: snapshot.repoUrl ?? null,
      repoBranch: snapshot.repoBranch ?? null,
      agent: snapshot.agent ?? null,
      agentImpl: snapshot.agentImpl ?? null,
      model: snapshot.model ?? null,
      toolId: snapshot.toolId ?? null,
      agentLoopVersionId: snapshot.agentLoopVersionId ?? null,
      claudeAuthMode: snapshot.claudeAuthMode ?? null,
      codexAuthMode: snapshot.codexAuthMode ?? null,
      providerBillingMode: snapshot.providerBillingMode ?? null,
      tgSpecLaunchConfiguration,
      loopRuntime,
      loopSupportStatus,
      budgetEnabled: snapshot.budget?.isEnabled ?? null,
      retryAt: app?.retryAt ?? null,
      retryCount: app?.retryCount ?? 0,
      provisionedAt: app?.provisionedAt ?? null,
      runtimeGenerationStatus,
      runtimeGenerationReasons,
      workerCapacity,
    },
    classification,
    why: buildWhy({
      classification,
      archived,
      powerIntent,
      agentIntent,
      runtimeState,
      agentState,
      blockers,
      retryAt: app?.retryAt ?? null,
      lastOutcome,
      previewHealth,
      loopRuntime,
      loopSupportStatus,
      supportHint: snapshot.loopSupportHint ?? null,
      workerError: input.worker?.error ?? null,
      inspectStatus: workerInspect?.status ?? null,
      workerLogText,
      workerCapacity,
      workerCapacityExhausted,
      needsRuntimeReclaim: isUnfinishedIdleAgentRun || needsStoppedRuntimeReclaim,
      tgSpecLaunchConfiguration,
    }),
    allowedActions,
    recommendedNextAction: buildRecommendedNextAction(
      classification,
      allowedActions,
      actionableRuntimeGenerationDrift,
      isUnfinishedIdleAgentRun || needsStoppedRuntimeReclaim,
      workerCapacityExhausted,
      hasBlockers,
    ),
    operatorNotes: buildOperatorNotes({
      archived,
      loopSupportLabel: snapshot.loopSupportLabel ?? null,
      supportHint: snapshot.loopSupportHint ?? null,
      repoUrl: snapshot.repoUrl ?? null,
      repoBranch: snapshot.repoBranch ?? null,
      agent: snapshot.agent ?? null,
      agentImpl: snapshot.agentImpl ?? null,
      model: snapshot.model ?? null,
      toolId: snapshot.toolId ?? null,
      agentLoopVersionId: snapshot.agentLoopVersionId ?? null,
      claudeAuthMode: snapshot.claudeAuthMode ?? null,
      codexAuthMode: snapshot.codexAuthMode ?? null,
      providerBillingMode: snapshot.providerBillingMode ?? null,
      agentStartAllowed: snapshot.agentStartAllowed ?? false,
      workerUrl: input.worker?.workerUrl ?? null,
      containerName: app?.containerName ?? null,
      workerHost: app?.workerHost ?? null,
      lastHeartbeat: app?.lastHeartbeat ?? null,
      workerInspect,
      workerLogText,
      workerCapacity,
      workerParityStatus,
      workerParityReasons,
      runtimeGenerationStatus,
      runtimeGenerationReasons,
      actionableRuntimeGenerationReasons,
      actionableWorkerParityReasons,
      workerServiceGenerationDrift,
      tgSpecLaunchConfiguration,
    }),
  };
}

function buildWhy(input: {
  classification: ProjectExplain["classification"];
  archived: boolean;
  powerIntent: string | null;
  agentIntent: string | null;
  runtimeState: string | null;
  agentState: string | null;
  blockers: string[];
  retryAt: string | null;
  lastOutcome: string | null;
  previewHealth: string | null;
  loopRuntime: string | null;
  loopSupportStatus: string | null;
  supportHint: string | null;
  workerError: string | null;
  inspectStatus: string | null;
  workerLogText: string;
  workerCapacity: ProjectExplain["truth"]["workerCapacity"];
  workerCapacityExhausted: boolean;
  needsRuntimeReclaim: boolean;
  tgSpecLaunchConfiguration: TgSpecLaunchConfiguration | null;
}): string[] {
  const lines: string[] = [];

  switch (input.classification) {
    case "paused_preview":
      lines.push("Preview is live, but unfinished work is manually paused and can be resumed.");
      break;
    case "healthy_preview_only":
      if (input.lastOutcome === "COMPLETED") {
        lines.push("Preview is live after completed work while the agent loop is intentionally off.");
      } else if (input.lastOutcome === "FAILED") {
        lines.push("Preview is live after a failed agent run while the agent loop is intentionally off.");
      } else {
        lines.push("Preview is live and healthy while the agent loop is intentionally off.");
      }
      break;
    case "healthy_agent_run":
      lines.push("Runtime is live and the agent loop is allowed to work or idle on the live runtime.");
      break;
    case "waiting_by_blocker":
      if (input.blockers.includes("MANUAL")) {
        lines.push("Agent work is waiting for an explicit user, operator or platform action while the preview remains live; relaunch is not expected to clear this state.");
      } else {
        lines.push("Agent work is waiting on blockers while the preview remains live; relaunch is not expected to clear this state.");
      }
      break;
    case "parked":
      lines.push(input.archived ? "Project is archived and effectively parked." : "Project is intentionally parked and fully off.");
      break;
    case "unsupported_runtime":
      lines.push(`${input.loopRuntime ?? "Current loop runtime"} is outside the supported agent-run contract.`);
      break;
    case "empty_bootstrap":
      lines.push("Worker logs show that preview bootstrap is missing the required root arena-start.sh.");
      break;
    case "tg_spec_launch_gated":
      if (input.tgSpecLaunchConfiguration === "tg_spec_launch_configuration_configured") {
        lines.push("TG-Spec target has configured launch state and is waiting for explicit launch start.");
      } else {
        lines.push("TG-Spec target is waiting for explicit launch configuration before runtime start.");
      }
      break;
    case "provisioning_wait":
      lines.push("Power is on and the project is waiting for the provisioner or worker path to create source/runtime state.");
      break;
    case "manual_row":
      lines.push("This row does not look like a normal repo-backed preview project.");
      break;
    case "active_broken":
      if (input.workerCapacityExhausted && input.workerCapacity) {
        lines.push(`Power is on, but the worker has no start capacity (${input.workerCapacity.activePreviewContainerCount ?? "unknown"}/${input.workerCapacity.maxConcurrentRuns ?? "unknown"} active preview containers).`);
      } else if (input.blockers.includes("MANUAL")) {
        lines.push("Agent work is waiting for an explicit user, operator or platform action; relaunch is not expected to clear this state.");
      } else if (input.blockers.length > 0) {
        lines.push("Agent work is waiting on blockers; relaunch is not expected to clear this state.");
      } else if (
        input.powerIntent === "ON"
        && input.agentIntent === "ON"
        && input.runtimeState === "RUNNING"
        && input.agentState === "IDLE"
        && input.lastOutcome === "FAILED"
        && input.previewHealth === "HEALTHY"
      ) {
        lines.push("The last agent run failed while the preview remains live; no active agent run is currently running.");
      } else if (input.needsRuntimeReclaim) {
        lines.push("Agent work is still unfinished, but the current runtime is stopped, absent or idle without blockers and cannot be claimed for the next loop run until it is reclaimed.");
      } else {
        lines.push("Power is on, but the row is not converging to a healthy live preview.");
      }
      break;
  }

  lines.push(`Current tuple: power=${input.powerIntent ?? "null"}, agent=${input.agentIntent ?? "null"}, runtime=${input.runtimeState ?? "null"}, agentState=${input.agentState ?? "null"}, lastOutcome=${input.lastOutcome ?? "null"}, preview=${input.previewHealth ?? "null"}.`);

  if (input.blockers.length > 0) {
    lines.push(`Current blockers: ${input.blockers.join(", ")}.`);
    if (input.retryAt) {
      lines.push(`Retry is scheduled for ${input.retryAt}.`);
    }
  }
  if (input.loopSupportStatus && input.classification !== "unsupported_runtime") {
    lines.push(`Loop support status: ${input.loopSupportStatus}.`);
  }
  if (input.supportHint && (input.loopSupportStatus === "upgrade-required" || input.classification === "unsupported_runtime")) {
    lines.push(input.supportHint);
  }
  if (input.workerError) {
    lines.push(`Worker snapshot error: ${input.workerError}.`);
  } else if (input.inspectStatus && input.classification === "active_broken") {
    lines.push(`Worker inspect status: ${input.inspectStatus}.`);
  }
  if (input.classification === "empty_bootstrap" && input.workerLogText.includes("No arena-start.sh found")) {
    lines.push("The current failure is bootstrap-contract specific, not a generic lifecycle drift.");
  }
  if (input.workerCapacityExhausted) {
    lines.push("This is a worker capacity wait, not a project relaunch problem.");
  }

  return lines;
}

function buildAllowedActions(input: {
  classification: ProjectExplain["classification"];
  archived: boolean;
  hasBlockers: boolean;
  hasRetryableBlocker: boolean;
  appStartAllowed: boolean;
  agentStartAllowed: boolean;
  relaunchAllowed: boolean;
  actionableRuntimeGenerationDrift: boolean;
  needsRuntimeReclaim: boolean;
  workerCapacityExhausted: boolean;
  tgSpecLaunchConfiguration: TgSpecLaunchConfiguration | null;
}): string[] {
  switch (input.classification) {
    case "paused_preview":
      return uniqueStrings([
        ...(input.agentStartAllowed ? ["agent_on"] : ["upgrade_runtime"]),
        "app_off",
        ...(input.actionableRuntimeGenerationDrift ? ["recreate_runtime"] : []),
        ...(input.relaunchAllowed ? ["relaunch"] : []),
        "no_action",
      ]);
    case "healthy_preview_only":
      return uniqueStrings([
        "app_off",
        ...(input.agentStartAllowed ? ["agent_on"] : ["upgrade_runtime"]),
        ...(input.actionableRuntimeGenerationDrift ? ["recreate_runtime"] : []),
        ...(input.relaunchAllowed ? ["relaunch"] : []),
        "no_action",
      ]);
    case "healthy_agent_run":
      return uniqueStrings([
        "agent_off",
        "app_off",
        ...(input.actionableRuntimeGenerationDrift ? ["recreate_runtime"] : []),
        "no_action",
      ]);
    case "waiting_by_blocker":
      return uniqueStrings([
        ...(input.hasRetryableBlocker ? ["retry_now"] : []),
        "app_off",
        "no_action",
      ]);
    case "parked":
      if (input.archived) return ["unarchive", "delete_project"];
      return uniqueStrings([
        ...(input.appStartAllowed ? ["app_on"] : []),
        ...(input.agentStartAllowed ? [] : ["upgrade_runtime"]),
        "archive",
        "delete_project",
      ]);
    case "unsupported_runtime":
      return ["upgrade_runtime", "app_off"];
    case "empty_bootstrap":
      return ["archive", "delete_project"];
    case "tg_spec_launch_gated":
      return uniqueStrings([
        input.tgSpecLaunchConfiguration === "tg_spec_launch_configuration_configured"
          ? "tg_spec_launch_start"
          : "tg_spec_launch_configure",
        "archive",
        "delete_project",
      ]);
    case "provisioning_wait":
      return ["app_off", "no_action"];
    case "manual_row":
      return ["delete_project", "archive"];
    case "active_broken":
      if (input.hasBlockers) {
        return uniqueStrings([
          ...(input.hasRetryableBlocker ? ["retry_now"] : []),
          "app_off",
          "no_action",
        ]);
      }
      return uniqueStrings([
        ...(input.needsRuntimeReclaim ? ["recreate_runtime"] : []),
        "app_off",
        ...(input.appStartAllowed ? ["app_on"] : []),
        ...(input.relaunchAllowed ? ["relaunch"] : []),
        ...(input.agentStartAllowed ? [] : ["upgrade_runtime"]),
        ...(input.workerCapacityExhausted ? ["no_action"] : []),
      ]);
  }
}

function buildRecommendedNextAction(
  classification: ProjectExplain["classification"],
  allowedActions: string[],
  actionableRuntimeGenerationDrift: boolean,
  needsRuntimeReclaim = false,
  workerCapacityExhausted = false,
  hasBlockers = false,
): string {
  if (workerCapacityExhausted) return "no_action";
  if (actionableRuntimeGenerationDrift && allowedActions.includes("recreate_runtime")) {
    return "recreate_runtime";
  }
  if (needsRuntimeReclaim && allowedActions.includes("recreate_runtime")) {
    return "recreate_runtime";
  }
  switch (classification) {
    case "paused_preview":
      return allowedActions.includes("agent_on")
        ? "agent_on"
        : allowedActions.includes("upgrade_runtime")
          ? "upgrade_runtime"
          : allowedActions[0] ?? "no_action";
    case "healthy_preview_only":
      return allowedActions.includes("upgrade_runtime") ? "upgrade_runtime" : "no_action";
    case "healthy_agent_run":
    case "waiting_by_blocker":
      return "no_action";
    case "parked":
      return allowedActions.includes("app_on") ? "app_on" : allowedActions[0] ?? "no_action";
    case "unsupported_runtime":
      return "upgrade_runtime";
    case "empty_bootstrap":
      return "archive";
    case "tg_spec_launch_gated":
      return allowedActions.includes("tg_spec_launch_start")
        ? "tg_spec_launch_start"
        : allowedActions.includes("tg_spec_launch_configure")
          ? "tg_spec_launch_configure"
          : allowedActions[0] ?? "no_action";
    case "provisioning_wait":
      return "no_action";
    case "manual_row":
      return "delete_project";
    case "active_broken":
      if (hasBlockers) return "no_action";
      return allowedActions.includes("relaunch")
        ? "relaunch"
        : allowedActions.includes("app_on")
          ? "app_on"
          : allowedActions[0] ?? "no_action";
  }
}

function buildOperatorNotes(input: {
  archived: boolean;
  loopSupportLabel: string | null;
  supportHint: string | null;
  repoUrl: string | null;
  repoBranch: string | null;
  agent: string | null;
  agentImpl: string | null;
  model: string | null;
  toolId: string | null;
  agentLoopVersionId: string | null;
  claudeAuthMode: string | null;
  codexAuthMode: string | null;
  providerBillingMode: string | null;
  agentStartAllowed: boolean;
  workerUrl: string | null;
  containerName: string | null;
  workerHost: string | null;
  lastHeartbeat: string | null;
  workerInspect: WorkerInspect | null;
  workerLogText: string;
  workerCapacity: ProjectExplain["truth"]["workerCapacity"];
  workerParityStatus: string | null;
  workerParityReasons: string[];
  runtimeGenerationStatus: string | null;
  runtimeGenerationReasons: string[];
  actionableRuntimeGenerationReasons: string[];
  actionableWorkerParityReasons: string[];
  workerServiceGenerationDrift: boolean;
  tgSpecLaunchConfiguration: TgSpecLaunchConfiguration | null;
}): string[] {
  const notes: string[] = [];

  if (input.archived) notes.push("Archived rows are outside the ordinary live fleet.");
  if (input.loopSupportLabel) notes.push(`Loop support label: ${input.loopSupportLabel}.`);
  if (input.supportHint) notes.push(input.supportHint);
  if (input.repoUrl || input.repoBranch) {
    notes.push(`Source truth: repo=${input.repoUrl ?? "null"}, branch=${input.repoBranch ?? "null"}.`);
  }
  notes.push(`Runtime system: agent=${input.agent ?? "unknown"}, loop=${input.agentImpl ?? "unknown"}, toolId=${input.toolId ?? "null"}, loopVersionId=${input.agentLoopVersionId ?? "null"}, model=${input.model ?? "null"}.`);
  notes.push(`Provider billing: ${input.providerBillingMode ?? "unknown"}.`);
  notes.push(`Runtime auth modes: claude=${input.claudeAuthMode ?? "null"}, codex=${input.codexAuthMode ?? "null"}, agentStartAllowed=${input.agentStartAllowed ? "yes" : "no"}.`);
  if (input.tgSpecLaunchConfiguration) {
    notes.push(`TG-Spec launch configuration: ${input.tgSpecLaunchConfiguration}.`);
  }
  if (input.workerUrl || input.containerName) {
    notes.push(`Runtime identity: container=${input.containerName ?? "null"}, workerHost=${input.workerHost ?? "null"}, workerUrl=${input.workerUrl ?? "null"}.`);
  }
  if (input.lastHeartbeat) {
    notes.push(`Last heartbeat: ${input.lastHeartbeat}.`);
  }
  if (input.workerCapacity) {
    const max = input.workerCapacity.maxConcurrentRuns ?? "unknown";
    const active = input.workerCapacity.activePreviewContainerCount ?? "unknown";
    const available = input.workerCapacity.availableStartCapacity ?? "unknown";
    notes.push(`Worker capacity: activePreviewContainers=${active}, maxConcurrentRuns=${max}, availableStartCapacity=${available}.`);
    if (input.workerCapacity.resourcePressure) {
      const pressure = input.workerCapacity.resourcePressure;
      const reasons = pressure.reasons.length > 0 ? pressure.reasons.join(",") : "none";
      const memoryRatio = pressure.memoryUsageRatio == null
        ? "unknown"
        : pressure.memoryUsageRatio.toFixed(3);
      notes.push(`Worker resource pressure: constrained=${String(pressure.constrained ?? false)}, reasons=${reasons}, memoryUsageRatio=${memoryRatio}, pids=${pressure.pidsCurrent ?? "unknown"}, sampledContainers=${pressure.sampledContainerCount ?? "unknown"}/${pressure.runningContainerCount ?? "unknown"}.`);
    }
    if (input.workerCapacity.untrackedActivePreviewContainerCount > 0) {
      notes.push(`Worker capacity includes ${input.workerCapacity.untrackedActivePreviewContainerCount} active preview container(s) not tracked by current component containerName rows.`);
    }
    if (input.workerCapacity.staleTrackedPreviewContainerCount > 0) {
      notes.push(`Worker capacity includes ${input.workerCapacity.staleTrackedPreviewContainerCount} stale tracked preview container(s) whose component row is not ON/RUNNING.`);
    }
  }
  if (input.workerInspect?.exitCode != null || input.workerInspect?.oomKilled != null) {
    notes.push(`Worker inspect: exitCode=${input.workerInspect.exitCode ?? "null"}, oomKilled=${String(input.workerInspect.oomKilled ?? false)}.`);
  }
  if (input.runtimeGenerationStatus === "mismatch" && input.actionableRuntimeGenerationReasons.length > 0) {
    notes.push(`Project runtime generation drift: ${input.actionableRuntimeGenerationReasons.join(", ")}.`);
  } else if (input.runtimeGenerationStatus === "mismatch") {
    notes.push(`Runtime generation truth incomplete: ${input.runtimeGenerationReasons.join(", ") || "runtime generation mismatch"}.`);
  }
  if (input.workerServiceGenerationDrift) {
    notes.push(`Worker service generation drift: ${input.actionableWorkerParityReasons.join(", ")}.`);
    notes.push("This points to stale worker-service maintenance, not a project-level runtime recreate.");
  } else if (input.workerParityStatus === "mismatch") {
    notes.push(`Worker service generation truth incomplete: ${input.workerParityReasons.join(", ") || "worker service parity mismatch"}.`);
  }
  if (input.workerLogText.includes("No arena-start.sh found")) {
    notes.push("Worker logs include the canonical bootstrap failure: no root arena-start.sh.");
  }

  return notes;
}

function normalizeTgSpecLaunchConfiguration(value: unknown): TgSpecLaunchConfiguration | null {
  return value === "tg_spec_launch_configuration_required" || value === "tg_spec_launch_configuration_configured"
    ? value
    : null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values));
}

function toWorkerLogText(logs: unknown): string {
  if (typeof logs === "string") return logs;
  if (Array.isArray(logs)) {
    return logs.map((entry) => {
      if (typeof entry === "string") return entry;
      if (entry && typeof entry === "object" && "line" in entry && typeof (entry as { line?: unknown }).line === "string") {
        return (entry as { line: string }).line;
      }
      return "";
    }).join("\n");
  }
  return "";
}

function normalizeWorkerCapacity(capacity: WorkerSnapshot["capacity"]): ProjectExplain["truth"]["workerCapacity"] {
  if (!capacity || typeof capacity !== "object") return null;
  const staleTrackedPreviewContainerCount = Array.isArray(capacity.staleTrackedPreviewContainers)
    ? capacity.staleTrackedPreviewContainers.length
    : 0;
  const untrackedActivePreviewContainerCount = Array.isArray(capacity.untrackedActivePreviewContainers)
    ? capacity.untrackedActivePreviewContainers.length
    : 0;

  return {
    maxConcurrentRuns: readFiniteNumber(capacity.maxConcurrentRuns),
    activePreviewContainerCount: readFiniteNumber(capacity.activePreviewContainerCount),
    availableStartCapacity: readFiniteNumber(capacity.availableStartCapacity),
    trackedActivePreviewContainerCount: readFiniteNumber(capacity.trackedActivePreviewContainerCount),
    staleTrackedPreviewContainerCount,
    untrackedActivePreviewContainerCount,
    resourcePressure: normalizeWorkerResourcePressure(capacity.resourcePressure),
  };
}

function readFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normalizeWorkerResourcePressure(
  pressure: WorkerResourcePressureSnapshot | null | undefined,
): NonNullable<NonNullable<ProjectExplain["truth"]["workerCapacity"]>["resourcePressure"]> | null {
  if (!pressure || typeof pressure !== "object") return null;
  const memory = pressure.memory && typeof pressure.memory === "object" ? pressure.memory : null;
  const pids = pressure.pids && typeof pressure.pids === "object" ? pressure.pids : null;
  const containers = pressure.containers && typeof pressure.containers === "object" ? pressure.containers : null;

  return {
    constrained: typeof pressure.constrained === "boolean" ? pressure.constrained : null,
    reasons: Array.isArray(pressure.reasons)
      ? pressure.reasons.filter((reason): reason is string => typeof reason === "string" && reason.length > 0)
      : [],
    memoryUsageBytes: readFiniteNumber(memory?.usageBytes),
    memoryLimitBytes: readFiniteNumber(memory?.limitBytes),
    memoryUsageRatio: readFiniteNumber(memory?.usageRatio),
    memoryThresholdRatio: readFiniteNumber(memory?.thresholdRatio),
    pidsCurrent: readFiniteNumber(pids?.current),
    pidsLimit: readFiniteNumber(pids?.limit),
    pidThreshold: readFiniteNumber(pids?.threshold),
    sampledContainerCount: readFiniteNumber(containers?.sampled),
    runningContainerCount: readFiniteNumber(containers?.running),
  };
}
