import { access, readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as z from "zod/v4";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  evaluatePreviewWorkspace,
  getVisualWorkbenchManifestIssueCodes,
  getVisualWorkbenchManifestIssueDetails,
  isRunnerManagedReplayableDirtyEntry,
  isRunnerManagedReplayablePath,
  normalizeGitPorcelainStatusCode,
  normalizeRepoUrl,
  parseGitPorcelainStatusEntries,
  parseVisualWorkbenchManifest,
  readVisualWorkbenchManifestSchemaVersion,
  type PreviewWorkspaceExpectation,
  type PreviewWorkspaceSnapshot,
  type GitPorcelainStatusEntry,
  type VisualWorkbenchManifestIssueDetail,
  type VisualWorkbenchManifestSummary,
  summarizeVisualWorkbenchManifest,
  VISUAL_WORKBENCH_MANIFEST_PATH,
} from "@arena/contracts";
import { jsonResult, errorResult, toErrorMessage } from "../result.js";
import type { ArenaCtlContext } from "../tool-context.js";
import { buildProjectExplain } from "./project-explain.js";
import {
  isPathInside,
  readProjectFromHealth,
  resolveProjectWorkspacePath,
} from "./workspace.js";

const execFileAsync = promisify(execFile);

export type RequestedExperimentMode = "preview_only" | "agent_run";

type ProjectHealthProject = Record<string, unknown> & {
  id?: string;
  name?: string;
  slug?: string | null;
  runnerBackend?: string | null;
  repoUrl?: string | null;
  repoBranch?: string | null;
  commitSha?: string | null;
};

type BuildProjectExplainInput = Parameters<typeof buildProjectExplain>[0];

type RuntimeClaimDryRun = Record<string, unknown> & {
  schemaVersion?: string;
  backend?: "local" | "vps";
  policyDecision?: {
    action?: string;
    runnerMode?: string;
    attempt?: number;
  } | null;
  policyRejectionReasons?: string[];
  wouldCreateLease?: boolean;
  wouldClaim?: {
    action?: string;
    runnerMode?: string;
    attempt?: number;
    workspaceLabel?: string;
    workerImage?: string | null;
    resources?: { memoryMb?: number; cpuCount?: number };
  } | null;
  launch?: {
    required?: boolean;
    status?: string;
    sanitized?: boolean;
    payload?: unknown;
    message?: string | null;
  };
  blockingReasons?: string[];
};

type RunnerInitReadiness = Record<string, unknown> & {
  schemaVersion?: string;
  available?: boolean;
  project?: {
    hasPendingLoopWork?: boolean;
    agent?: string;
    agentImpl?: string;
    model?: string | null;
    claudeAuthMode?: string | null;
    codexAuthMode?: string | null;
    providerBillingMode?: string;
    commitSha?: string | null;
    agentIntent?: string;
  };
  command?: {
    present?: boolean;
    source?: string;
    resolvable?: boolean;
    unresolvedPlaceholders?: string[];
  };
  blockers?: string[];
};

type AuthdHealthSnapshot = Record<string, unknown> & {
  configured?: boolean;
  available?: boolean;
  ok?: boolean;
  error?: string | null;
  providers?: Record<string, AuthdProviderReadiness | undefined>;
};

type AuthdProviderReadiness = {
  provider?: string;
  source?: string | null;
  status?: string;
  version?: string | null;
  checkedAt?: string | null;
  detail?: string | null;
};

type TokenManagerStatusSnapshot = Record<string, unknown> & {
  available?: boolean;
  error?: string | null;
  providers?: Record<string, TokenProviderReadiness | undefined>;
};

type TokenProviderReadiness = {
  updatedAt?: number;
  hasToken?: boolean;
  hash?: string;
  ageMs?: number | null;
  freshness?: string;
};

type RuntimeAuthRequirement = {
  source: "authd" | "token_manager";
  provider: string;
  tokenProvider?: string;
  missingBlocker: string;
};

type RuntimeAuthReadiness = {
  available: boolean;
  source: "authd" | "token_manager" | "mixed" | "not_required" | "unavailable";
  status: "ready" | "blocked" | "unknown" | "not_required";
  requiredProviders: string[];
  providers: Record<string, {
    status: string;
    source: string | null;
    version: string | null;
    checkedAt: string | null;
    detail: string | null;
  }>;
  blockers: string[];
  unknowns: string[];
  evidenceNotes: string[];
};

type ExperimentExecutionReadiness = {
  requestedMode: RequestedExperimentMode;
  status: "ready" | "blocked" | "unknown";
  proposedOperatorAction:
    | "none_wait_for_worker_claim"
    | "none_wait_for_provisioner_queue"
    | "none_observe_running_agent"
    | "none_wait_for_lifecycle_blocker"
    | "project_agent_on"
    | "project_retry_now"
    | "project_power_on"
    | "project_recreate_runtime"
    | "project_relaunch"
    | "tg_spec_launch_start"
    | "blocked";
  expectedConvergence:
    | "worker_claims_agent_run"
    | "provisioner_queues_agent_run"
    | "agent_run_in_progress"
    | "worker_claims_preview_only"
    | "supervisor_resume"
    | "not_claimable"
    | "unknown";
  blockers: string[];
  lifecycleBlockers: string[];
  claimPolicyRejectionReasons: string[];
  unknowns: string[];
  requiredHumanEvidence: string[];
  reason: string;
  forbiddenImplicitActions: [
    "no_scheduler",
    "no_hidden_relaunch",
    "no_hidden_retry_unblock",
    "no_hidden_lifecycle_mutation",
    "no_raw_env_exposure",
  ];
};

type SourceBootstrapReadiness = {
  available: boolean;
  unavailableReason: string | null;
  evidenceSource: "local_workspace_head_when_workspace_matches_repo" | "unavailable";
  status: "preview_runnable" | "source_not_preview_runnable" | "unknown";
  reasonCode:
    | "root_arena_start_present"
    | "readme_only_source"
    | "no_preview_bootstrap_in_source"
    | "workspace_not_source_snapshot"
    | "source_unavailable";
  trackedCommitSha: string | null;
  trackedFilesCount: number | null;
  trackedFilesPreview: string[];
  requiredFiles: {
    arenaStartTracked: boolean | null;
    packageJsonTracked: boolean | null;
  };
  issues: string[];
  unknowns: string[];
  evidenceNotes: string[];
};

type VisualScenarioReadiness = {
  status: "ready" | "blocked" | "unknown";
  canRunVisualScenario: boolean;
  previewUrl: string | null;
  recommendedBaseUrl: string | null;
  blockers: string[];
  unknowns: string[];
  reason: string;
  evidenceNotes: string[];
};

type VisualWorkbenchManifestReadiness = {
  available: boolean;
  unavailableReason: string | null;
  evidenceSource: "local_workspace_head_when_workspace_matches_repo" | "unavailable";
  status: "ready" | "blocked" | "unknown";
  canRunWorkbenchCapture: boolean;
  manifestPath: string | null;
  schemaVersion: string | null;
  projectClass: string | null;
  serveCommand: string | null;
  baseUrlEnv: string | null;
  storyRoutePattern: string | null;
  coveragePolicy: {
    mode: string | null;
    selectionDefault: string | null;
    simplificationRequiresEvidence: boolean | null;
  };
  storyCount: number | null;
  features: string[];
  widgets: string[];
  states: string[];
  viewportNames: string[];
  stories: VisualWorkbenchManifestSummary["stories"];
  blockers: string[];
  unknowns: string[];
  issues: string[];
  issueDetails: VisualWorkbenchManifestIssueDetail[];
  recommendedCapture: {
    stageId: "visual_workbench_capture";
    selection: "full_manifest";
    sourceRef: string | null;
    baseUrlHint: "http://127.0.0.1:<operator-selected-free-port>";
    baseUrlPurpose: "local_workbench_server";
    previewUrlIsNotWorkbenchBaseUrl: true;
    outputDirHint: string;
  } | null;
  evidenceNotes: string[];
};

type WorkerCapacityInput = {
  source: "capacity_diagnostics" | "worker_health" | "unavailable";
  capacityForDryRun: number;
  failClosed: boolean;
  activePreviewContainersSupplied: boolean;
  activePreviewContainersPreview: string[];
  maxConcurrentRuns: number | null;
  activePreviewContainerCount: number | null;
  availableStartCapacity: number | null;
  resourcePressureConstrained: boolean | null;
  resourcePressureReasons: string[];
  healthError: string | null;
  notes: string[];
};

export type ProjectExperimentPreflight = {
  project: {
    id: string;
    name: string;
    runnerBackend: string | null;
  };
  mode: {
    requested: RequestedExperimentMode;
    claimDryRunAvailable: true;
    exactClaimPrediction: "would_create_lease" | "would_not_create_lease";
  };
  lifecycleContext: {
    classification: ReturnType<typeof buildProjectExplain>["classification"];
    tgSpecLaunchConfiguration: ReturnType<typeof buildProjectExplain>["truth"]["tgSpecLaunchConfiguration"];
    tuple: {
      powerIntent: string | null;
      agentIntent: string | null;
      runtimeState: string | null;
      agentState: string | null;
      blockers: string[];
      lastOutcome: string | null;
      provisionedAt: string | null;
      previewHealth: string | null;
      previewUrl: string | null;
    };
    allowedActions: string[];
    recommendedNextAction: string;
  };
  runnerExpectation: {
    repoUrl: string | null;
    baseBranch: string | null;
    projectBranch: string | null;
    commitSha: string | null;
    runnerModeSource: "governance_runtime_claim_dry_run";
    claimDryRunAvailable: true;
  };
  workerCapacityInput: WorkerCapacityInput;
  claimDryRun: RuntimeClaimDryRun;
  initReadiness: RunnerInitReadiness;
  runtimeAuthReadiness: RuntimeAuthReadiness;
  executionReadiness: ExperimentExecutionReadiness;
  workspace: {
    available: boolean;
    unavailableReason: string | null;
    path: string | null;
    exists: boolean | null;
    nonEmpty: boolean | null;
    isGitRepo: boolean | null;
    originUrl: string | null;
    branch: string | null;
    commitSha: string | null;
  };
  workspaceDecision: ReturnType<typeof evaluatePreviewWorkspace> | null;
  sourceBootstrapReadiness: SourceBootstrapReadiness;
  visualScenarioReadiness: VisualScenarioReadiness;
  visualWorkbenchManifestReadiness: VisualWorkbenchManifestReadiness;
  gitSyncRisk: {
    available: boolean;
    dirty: boolean | null;
    statusPreview: string[];
    replayableOnly: boolean | null;
    wouldBlockSync: boolean | null;
    blockingPaths: string[];
    policySource: "@arena/contracts:isRunnerManagedReplayableDirtyEntry";
  };
  bootstrap: {
    arenaStartExists: boolean | null;
    expectedPreviewFailureCode: "preview_start_missing" | null;
    expectedPreviewFailure: string | null;
  };
  helperGaps: string[];
  evidenceNotes: string[];
};

export function registerProjectExperimentPreflightTool(server: McpServer, ctx: ArenaCtlContext) {
  server.registerTool("project_experiment_preflight", {
    description:
      "Read-only local experiment preflight for a project: imported project_explain context, workspace/git/bootstrap evidence, and explicit helper gaps. Does not claim runtime intents, start containers, mutate repos, or call providers.",
    inputSchema: {
      projectId: z.string().min(1),
      mode: z.enum(["preview_only", "agent_run"]).optional(),
      tail: z.number().int().min(1).max(5000).optional(),
    },
  }, async ({ projectId, mode, tail }) => {
    try {
      const preflight = await readProjectExperimentPreflight({
        ctx,
        projectId,
        requestedMode: mode ?? "preview_only",
        tail,
      });

      return jsonResult(preflight);
    } catch (error) {
      return errorResult(`Failed to preflight project experiment ${projectId}`, toErrorMessage(error));
    }
  });
}

export async function readProjectExperimentPreflight(input: {
  ctx: ArenaCtlContext;
  projectId: string;
  requestedMode: RequestedExperimentMode;
  tail?: number;
}): Promise<ProjectExperimentPreflight> {
  const [snapshot, worker, health] = await Promise.all([
    input.ctx.governance.getProjectSnapshot(input.projectId),
    input.ctx.governance.getProjectWorkerSnapshot(input.projectId, input.tail ?? 120),
    input.ctx.governance.getProjectHealth(input.projectId, input.tail ?? 80),
  ]);
  const healthProject = readProjectFromHealth(health) as ProjectHealthProject | null;
  const workerClaimContext = buildRuntimeClaimDryRunWorkerContext(worker);
  const claimDryRun = await input.ctx.governance.getProjectRuntimeClaimDryRun(input.projectId, {
    host: healthProject?.runnerBackend === "vps" ? "vps" : "local",
    capacity: workerClaimContext.capacity,
    ...(workerClaimContext.activePreviewContainers
      ? { activePreviewContainers: workerClaimContext.activePreviewContainers }
      : {}),
  }) as RuntimeClaimDryRun;
  const initReadiness = await input.ctx.governance.getProjectRunnerInitReadiness(input.projectId) as RunnerInitReadiness;
  const [authdHealth, tokenStatus] = await Promise.all([
    readAuthdHealthForPreflight(input.ctx),
    readTokenStatusForPreflight(input.ctx),
  ]);

  return buildProjectExperimentPreflight({
    requestedMode: input.requestedMode,
    snapshot,
    worker,
    health,
    claimDryRun,
    initReadiness,
    authdHealth,
    tokenStatus,
    ctx: input.ctx,
  });
}

async function readAuthdHealthForPreflight(ctx: ArenaCtlContext): Promise<AuthdHealthSnapshot> {
  try {
    return await ctx.governance.getAuthdHealth() as AuthdHealthSnapshot;
  } catch (error) {
    return {
      configured: false,
      available: false,
      ok: false,
      error: toErrorMessage(error),
      providers: {},
    };
  }
}

async function readTokenStatusForPreflight(ctx: ArenaCtlContext): Promise<TokenManagerStatusSnapshot> {
  try {
    return {
      available: true,
      ...await ctx.governance.getTokenStatus() as TokenManagerStatusSnapshot,
    };
  } catch (error) {
    return {
      available: false,
      error: toErrorMessage(error),
      providers: {},
    };
  }
}

function buildRuntimeClaimDryRunWorkerContext(worker: unknown): {
  capacity: number;
  activePreviewContainers?: string[];
  evidence: WorkerCapacityInput;
} {
  const workerRecord = readRecord(worker);
  const capacityRecord = readRecord(workerRecord?.capacity);
  const healthRecord = readRecord(workerRecord?.health);
  const capacityDiagnosticsValue = readFiniteNumber(capacityRecord?.availableStartCapacity);
  const healthValue = readFiniteNumber(healthRecord?.availableStartCapacity);
  const capacity = capacityDiagnosticsValue ?? healthValue;
  const activePreviewContainers = readStringArray(healthRecord?.activePreviewContainers);
  const source = capacityDiagnosticsValue != null
    ? "capacity_diagnostics"
    : healthValue != null
      ? "worker_health"
      : "unavailable";
  const failClosed = source === "unavailable" && hasWorkerSnapshotEvidence(worker);
  const resourcePressureReasons = readResourcePressureReasons(capacityRecord, healthRecord);

  return {
    capacity: Math.max(capacity ?? 0, 0),
    ...(activePreviewContainers && activePreviewContainers.length > 0 ? { activePreviewContainers } : {}),
    evidence: {
      source,
      capacityForDryRun: Math.max(capacity ?? 0, 0),
      failClosed,
      activePreviewContainersSupplied: Boolean(activePreviewContainers?.length),
      activePreviewContainersPreview: activePreviewContainers?.slice(0, 20) ?? [],
      maxConcurrentRuns: readFiniteNumber(capacityRecord?.maxConcurrentRuns)
        ?? readFiniteNumber(healthRecord?.maxConcurrentRuns),
      activePreviewContainerCount: readFiniteNumber(capacityRecord?.activePreviewContainerCount)
        ?? readFiniteNumber(healthRecord?.activePreviewContainerCount),
      availableStartCapacity: capacity,
      resourcePressureConstrained: readResourcePressureConstrained(capacityRecord, healthRecord),
      resourcePressureReasons,
      healthError: readWorkerHealthError(workerRecord),
      notes: [
        "Worker capacity input explains the evidence forwarded into governance runtime-claim dry-run.",
        ...(resourcePressureReasons.includes("resource_pressure_unavailable")
          ? ["Worker resource-pressure telemetry was unavailable; capacityForDryRun still comes from worker capacity diagnostics, and this note does not create lifecycle, retry or proof truth."]
          : []),
        ...(failClosed
          ? ["Worker capacity was unavailable, so preflight sent capacity=0 to fail closed instead of inventing start capacity."]
          : []),
      ],
    },
  };
}

function hasWorkerSnapshotEvidence(worker: unknown): boolean {
  const workerRecord = readRecord(worker);
  if (!workerRecord) return false;
  return (
    workerRecord.workerUrl != null
    || workerRecord.health != null
    || workerRecord.capacity != null
    || workerRecord.errors != null
  );
}

function readResourcePressureConstrained(
  capacityRecord: Record<string, unknown> | null,
  healthRecord: Record<string, unknown> | null,
): boolean | null {
  const resourcePressure = readRecord(capacityRecord?.resourcePressure)
    ?? readRecord(healthRecord?.resourcePressure);
  return typeof resourcePressure?.constrained === "boolean"
    ? resourcePressure.constrained
    : null;
}

function readResourcePressureReasons(
  capacityRecord: Record<string, unknown> | null,
  healthRecord: Record<string, unknown> | null,
): string[] {
  const resourcePressure = readRecord(capacityRecord?.resourcePressure)
    ?? readRecord(healthRecord?.resourcePressure);
  return readStringArray(resourcePressure?.reasons) ?? [];
}

function readWorkerHealthError(workerRecord: Record<string, unknown> | null): string | null {
  const errorsRecord = readRecord(workerRecord?.errors);
  const healthErrorRecord = readRecord(errorsRecord?.health);
  if (!healthErrorRecord) return null;

  const error = readOptionalString(healthErrorRecord.error)
    ?? readOptionalString(healthErrorRecord.message)
    ?? readOptionalString(healthErrorRecord.statusText);
  const status = readFiniteNumber(healthErrorRecord.status);
  if (error && status != null) return `${status}: ${error}`;
  return error ?? (status != null ? String(status) : null);
}

export async function buildProjectExperimentPreflight(input: {
  requestedMode: RequestedExperimentMode;
  snapshot: unknown;
  worker: unknown;
  health: unknown;
  claimDryRun: RuntimeClaimDryRun;
  initReadiness: RunnerInitReadiness;
  authdHealth?: AuthdHealthSnapshot;
  tokenStatus?: TokenManagerStatusSnapshot;
  ctx: { config: Pick<ArenaCtlContext["config"], "workspaceRoot"> };
}): Promise<ProjectExperimentPreflight> {
  const explain = buildProjectExplain({
    snapshot: input.snapshot as BuildProjectExplainInput["snapshot"],
    worker: input.worker as BuildProjectExplainInput["worker"],
  });
  const healthProject = readProjectFromHealth(input.health) as ProjectHealthProject | null;
  if (!healthProject?.id || !healthProject.name) {
    throw new Error("Project health response is missing project identity");
  }

  const repoUrl = explain.truth.repoUrl ?? readOptionalString(healthProject.repoUrl);
  const repoBranch = explain.truth.repoBranch ?? readOptionalString(healthProject.repoBranch);
  const initReadinessCommitSha = readOptionalString(input.initReadiness.project?.commitSha);
  const commitSha = readOptionalString(healthProject.commitSha) ?? initReadinessCommitSha;
  const runnerBackend = readOptionalString(healthProject.runnerBackend);
  const helperGaps = [
    "remoteFreshnessNotChecked",
  ];
  const workerCapacityInput = buildRuntimeClaimDryRunWorkerContext(input.worker).evidence;
  if (workerCapacityInput.failClosed) {
    helperGaps.push("workerCapacityUnavailable");
  }

  const workspace = await readWorkspaceEvidence({
    ctx: input.ctx,
    project: healthProject,
    runnerBackend,
  });
  if (!workspace.available && runnerBackend === "vps") {
    helperGaps.push("vpsWorkspaceUnavailable");
  }

  const workspaceSnapshot: PreviewWorkspaceSnapshot | null = workspace.available
    ? {
      exists: workspace.exists === true && workspace.nonEmpty === true,
      isGitRepo: workspace.isGitRepo === true,
      originUrl: workspace.originUrl,
      branch: workspace.branch,
      commitSha: workspace.commitSha,
    }
    : null;
  const workspaceExpectation: PreviewWorkspaceExpectation = {
    repoUrl,
    repoBranch,
    projectBranch: null,
    commitSha,
  };
  const workspaceDecision = workspaceSnapshot
    ? evaluatePreviewWorkspace(workspaceSnapshot, workspaceExpectation)
    : null;
  const sourceBootstrapReadiness = await buildSourceBootstrapReadiness({
    workspace,
    workspaceDecision,
  });
  const gitSyncRisk = workspace.available && workspace.path && workspace.isGitRepo
    ? await readGitSyncRisk(workspace.path)
    : unavailableGitSyncRisk();
  const arenaStartExists = workspace.available && workspace.path
    ? await fileExists(path.join(workspace.path, "arena-start.sh"))
    : null;
  const expectedPreviewFailureCode = workspace.available && arenaStartExists === false
    ? "preview_start_missing"
    : null;
  const runtimeAuthReadiness = buildRuntimeAuthReadiness({
    requestedMode: input.requestedMode,
    initReadiness: input.initReadiness,
    authdHealth: input.authdHealth,
    tokenStatus: input.tokenStatus,
  });
  const executionReadiness = buildExecutionReadiness({
    requestedMode: input.requestedMode,
    claimDryRun: input.claimDryRun,
    initReadiness: input.initReadiness,
    runtimeAuthReadiness,
    lifecycleAllowedActions: explain.allowedActions,
    lifecycleRecommendedNextAction: explain.recommendedNextAction,
    lifecycleTuple: {
      powerIntent: explain.truth.powerIntent,
      agentIntent: explain.truth.agentIntent,
      runtimeState: explain.truth.runtimeState,
      agentState: explain.truth.agentState,
      blockers: explain.truth.blockers,
      lastOutcome: explain.truth.lastOutcome,
      provisionedAt: explain.truth.provisionedAt,
    },
    lifecycleBlockers: explain.truth.blockers,
    gitSyncRisk,
    arenaStartExists,
  });
  const visualScenarioReadiness = buildVisualScenarioReadiness({
    previewUrl: explain.truth.previewUrl,
    runtimeState: explain.truth.runtimeState,
    previewHealth: explain.truth.previewHealth,
    sourceBootstrapReadiness,
    executionReadiness,
  });
  const visualWorkbenchManifestReadiness = await buildVisualWorkbenchManifestReadiness({
    projectId: healthProject.id,
    workspace,
    sourceBootstrapReadiness,
  });

  return {
    project: {
      id: healthProject.id,
      name: healthProject.name,
      runnerBackend,
    },
    mode: {
      requested: input.requestedMode,
      claimDryRunAvailable: true,
      exactClaimPrediction: input.claimDryRun.wouldCreateLease === true
        ? "would_create_lease"
        : "would_not_create_lease",
    },
    lifecycleContext: {
      classification: explain.classification,
      tgSpecLaunchConfiguration: explain.truth.tgSpecLaunchConfiguration,
      tuple: {
        powerIntent: explain.truth.powerIntent,
        agentIntent: explain.truth.agentIntent,
        runtimeState: explain.truth.runtimeState,
        agentState: explain.truth.agentState,
        blockers: explain.truth.blockers,
        lastOutcome: explain.truth.lastOutcome,
        provisionedAt: explain.truth.provisionedAt,
        previewHealth: explain.truth.previewHealth,
        previewUrl: explain.truth.previewUrl,
      },
      allowedActions: explain.allowedActions,
      recommendedNextAction: explain.recommendedNextAction,
    },
    runnerExpectation: {
      repoUrl,
      baseBranch: repoBranch,
      projectBranch: null,
      commitSha,
      runnerModeSource: "governance_runtime_claim_dry_run",
      claimDryRunAvailable: true,
    },
    workerCapacityInput,
    claimDryRun: input.claimDryRun,
    initReadiness: input.initReadiness,
    runtimeAuthReadiness,
    executionReadiness,
    workspace,
    workspaceDecision,
    sourceBootstrapReadiness,
    visualScenarioReadiness,
    visualWorkbenchManifestReadiness,
    gitSyncRisk,
    bootstrap: {
      arenaStartExists,
      expectedPreviewFailureCode,
      expectedPreviewFailure: expectedPreviewFailureCode
        ? "Runner preview start has no fallback when root arena-start.sh is missing."
        : null,
    },
    helperGaps,
    evidenceNotes: [
      "Lifecycle context is imported from project_explain and is not recomputed here.",
      "Runtime claim prediction is imported from governance runtime-claim-dry-run and is not recomputed here.",
      "Workspace, git status, and bootstrap checks are local evidence only.",
      "Remote freshness is not checked by this local preflight.",
    ],
  };
}

async function buildVisualWorkbenchManifestReadiness(input: {
  projectId: string;
  workspace: ProjectExperimentPreflight["workspace"];
  sourceBootstrapReadiness: SourceBootstrapReadiness;
}): Promise<VisualWorkbenchManifestReadiness> {
  if (!input.workspace.available || !input.workspace.path) {
    return unavailableVisualWorkbenchManifestReadiness(
      input.workspace.unavailableReason ?? "Workspace evidence is unavailable.",
      "unknown",
      ["source_snapshot_unavailable"],
    );
  }
  if (input.sourceBootstrapReadiness.available !== true) {
    return unavailableVisualWorkbenchManifestReadiness(
      input.sourceBootstrapReadiness.unavailableReason ?? "Source bootstrap readiness is unavailable.",
      "unknown",
      input.sourceBootstrapReadiness.issues,
      input.sourceBootstrapReadiness.unknowns,
      path.join(input.workspace.path, VISUAL_WORKBENCH_MANIFEST_PATH),
    );
  }

  const rawManifest = await gitRawValue(input.workspace.path, [
    "show",
    `HEAD:${VISUAL_WORKBENCH_MANIFEST_PATH}`,
  ]);
  const manifestPath = path.join(input.workspace.path, VISUAL_WORKBENCH_MANIFEST_PATH);
  if (rawManifest == null) {
    return unavailableVisualWorkbenchManifestReadiness(
      "Visual Workbench manifest is not tracked in the trusted source snapshot.",
      "blocked",
      ["manifest_missing"],
      input.sourceBootstrapReadiness.unknowns,
      manifestPath,
    );
  }

  const unknowns: string[] = [];
  let manifest: unknown;
  try {
    manifest = JSON.parse(rawManifest);
  } catch {
    return unavailableVisualWorkbenchManifestReadiness(
      "Visual Workbench manifest is not valid JSON.",
      "blocked",
      ["manifest_invalid_json"],
      unknowns,
      manifestPath,
    );
  }

  const issues = getVisualWorkbenchManifestIssueCodes(manifest);
  const issueDetails = getVisualWorkbenchManifestIssueDetails(manifest);
  const parsedManifest = issues.length === 0 ? parseVisualWorkbenchManifest(manifest) : null;
  const summary = parsedManifest ? summarizeVisualWorkbenchManifest(parsedManifest) : null;
  const declaredSchemaVersion = readVisualWorkbenchManifestSchemaVersion(manifest);

  const uniqueBlockers = [...new Set(issues)];
  const uniqueUnknowns = [...new Set(unknowns)];
  const status: VisualWorkbenchManifestReadiness["status"] = uniqueBlockers.length > 0
    ? "blocked"
    : uniqueUnknowns.length > 0
      ? "unknown"
      : "ready";
  const canRunWorkbenchCapture = uniqueBlockers.length === 0
    && parsedManifest != null;

  return {
    available: true,
    unavailableReason: null,
    evidenceSource: "local_workspace_head_when_workspace_matches_repo",
    status,
    canRunWorkbenchCapture,
    manifestPath,
    schemaVersion: parsedManifest?.schemaVersion ?? declaredSchemaVersion,
    projectClass: parsedManifest?.projectClass ?? null,
    serveCommand: parsedManifest?.workbench.serveCommand ?? null,
    baseUrlEnv: parsedManifest?.workbench.baseUrlEnv ?? null,
    storyRoutePattern: parsedManifest?.workbench.storyRoutePattern ?? null,
    coveragePolicy: {
      mode: parsedManifest?.coveragePolicy.mode ?? null,
      selectionDefault: parsedManifest?.coveragePolicy.selectionDefault ?? null,
      simplificationRequiresEvidence: parsedManifest?.coveragePolicy.simplificationRequiresEvidence ?? null,
    },
    storyCount: summary?.storyCount ?? null,
    features: summary?.features ?? [],
    widgets: summary?.widgets ?? [],
    states: summary?.states ?? [],
    viewportNames: summary?.viewportNames ?? [],
    stories: summary?.stories ?? [],
    blockers: uniqueBlockers,
    unknowns: uniqueUnknowns,
    issues: uniqueBlockers,
    issueDetails,
    recommendedCapture: canRunWorkbenchCapture
      ? {
        stageId: "visual_workbench_capture",
        selection: "full_manifest",
        sourceRef: input.workspace.commitSha,
        baseUrlHint: "http://127.0.0.1:<operator-selected-free-port>",
        baseUrlPurpose: "local_workbench_server",
        previewUrlIsNotWorkbenchBaseUrl: true,
        outputDirHint: `work/experiments/visual-workbench/${input.projectId}/${input.workspace.commitSha ?? "source-ref"}`,
      }
      : null,
    evidenceNotes: [
      "Visual Workbench manifest readiness reads visual-workbench/manifest.json from trusted workspace git HEAD only.",
      "It does not start the workbench, run Playwright, write screenshots, export task evidence or mutate lifecycle state.",
      "Workbench capture starts the source-owned serveCommand against an operator-selected local base URL; the current preview URL is not a substitute.",
      "Missing or invalid workbench stories are reported as capture blockers; no page-screenshot fallback is implied.",
      "The manifest story matrix is the v0 source-owned coverage catalog; preflight does not compare it to an external expected-state catalog or proof baseline.",
      "Remote freshness remains a top-level preflight/source-bootstrap caveat and does not block local manifest readiness for the reported sourceRef.",
    ],
  };
}

function unavailableVisualWorkbenchManifestReadiness(
  reason: string,
  status: VisualWorkbenchManifestReadiness["status"],
  issues: string[],
  unknowns = ["remoteFreshnessNotChecked"],
  manifestPath: string | null = null,
): VisualWorkbenchManifestReadiness {
  return {
    available: false,
    unavailableReason: reason,
    evidenceSource: "unavailable",
    status,
    canRunWorkbenchCapture: false,
    manifestPath,
    schemaVersion: null,
    projectClass: null,
    serveCommand: null,
    baseUrlEnv: null,
    storyRoutePattern: null,
    coveragePolicy: {
      mode: null,
      selectionDefault: null,
      simplificationRequiresEvidence: null,
    },
    storyCount: null,
    features: [],
    widgets: [],
    states: [],
    viewportNames: [],
    stories: [],
    blockers: status === "blocked" ? [...new Set(issues)] : [],
    unknowns: [...new Set(unknowns)],
    issues: [...new Set(issues)],
    issueDetails: [],
    recommendedCapture: null,
    evidenceNotes: [
      "Visual Workbench manifest readiness is unavailable without trusted source-owned manifest evidence.",
      "No page-screenshot fallback is implied when the Visual Workbench manifest cannot be read.",
    ],
  };
}

async function buildSourceBootstrapReadiness(input: {
  workspace: ProjectExperimentPreflight["workspace"];
  workspaceDecision: ProjectExperimentPreflight["workspaceDecision"];
}): Promise<SourceBootstrapReadiness> {
  if (!input.workspace.available || !input.workspace.path) {
    return unavailableSourceBootstrapReadiness(
      input.workspace.unavailableReason ?? "Workspace evidence is unavailable.",
      "source_unavailable",
    );
  }
  if (!input.workspace.isGitRepo) {
    return unavailableSourceBootstrapReadiness("Workspace is not a git repo.", "source_unavailable");
  }
  if (input.workspaceDecision?.reasonCode !== "workspace_matches_repo") {
    return unavailableSourceBootstrapReadiness(
      "Workspace git HEAD is not a trusted source snapshot because it does not match the configured repo snapshot.",
      "workspace_not_source_snapshot",
      ["source_snapshot_not_matching_configured_source"],
    );
  }

  const rawTrackedFiles = await gitValue(input.workspace.path, ["ls-tree", "-r", "--name-only", "HEAD"]);
  if (rawTrackedFiles == null) {
    return unavailableSourceBootstrapReadiness("Could not read tracked source files from workspace git HEAD.", "source_unavailable");
  }

  const trackedFiles = rawTrackedFiles.split("\n").map((line) => line.trim()).filter(Boolean);
  const trackedFileSet = new Set(trackedFiles);
  const hasRootArenaStart = trackedFileSet.has("arena-start.sh");
  const hasReadmeOnlySource = isReadmeOnlySourceSnapshot(trackedFiles);
  const reasonCode = hasRootArenaStart
    ? "root_arena_start_present"
    : hasReadmeOnlySource
      ? "readme_only_source"
      : "no_preview_bootstrap_in_source";
  const issues = [
    ...(!hasRootArenaStart ? ["source_bootstrap_missing"] : []),
    ...(hasReadmeOnlySource ? ["source_seed_only"] : []),
  ];

  return {
    available: true,
    unavailableReason: null,
    evidenceSource: "local_workspace_head_when_workspace_matches_repo",
    status: hasRootArenaStart ? "preview_runnable" : "source_not_preview_runnable",
    reasonCode,
    trackedCommitSha: input.workspace.commitSha,
    trackedFilesCount: trackedFiles.length,
    trackedFilesPreview: trackedFiles.slice(0, 20),
    requiredFiles: {
      arenaStartTracked: trackedFileSet.has("arena-start.sh"),
      packageJsonTracked: trackedFileSet.has("package.json"),
    },
    issues: [...new Set(issues)],
    unknowns: ["remoteFreshnessNotChecked"],
    evidenceNotes: [
      "Source bootstrap readiness is local workspace git HEAD evidence only after workspace matching; it does not fetch remote branches or mutate source.",
      "Untracked runner-managed files are intentionally ignored for source readiness.",
    ],
  };
}

function buildExecutionReadiness(input: {
  requestedMode: RequestedExperimentMode;
  claimDryRun: RuntimeClaimDryRun;
  initReadiness: RunnerInitReadiness;
  runtimeAuthReadiness: RuntimeAuthReadiness;
  lifecycleAllowedActions: string[];
  lifecycleRecommendedNextAction: string;
  lifecycleTuple: {
    powerIntent: string | null;
    agentIntent: string | null;
    runtimeState: string | null;
    agentState: string | null;
    blockers: string[];
    lastOutcome: string | null;
    provisionedAt: string | null;
  };
  lifecycleBlockers: string[];
  gitSyncRisk: ProjectExperimentPreflight["gitSyncRisk"];
  arenaStartExists: boolean | null;
}): ExperimentExecutionReadiness {
  const blockers: string[] = [];
  const unknowns: string[] = [];
  const retryRequiredHumanEvidence: string[] = [];
  const blockingRequiredHumanEvidence: string[] = [];
  const wouldClaim = input.claimDryRun.wouldClaim;
  const claimPolicyRejectionReasons = Array.isArray(input.claimDryRun.policyRejectionReasons)
    ? input.claimDryRun.policyRejectionReasons.filter(isNonEmptyString)
    : [];
  const blockingReasons = Array.isArray(input.claimDryRun.blockingReasons)
    ? input.claimDryRun.blockingReasons.filter(isNonEmptyString)
    : [];
  const launchStatus = input.claimDryRun.launch?.status;
  const authStatus = readAuthStatus(input.claimDryRun);
  const agentRunAlreadyActive = isAgentRunAlreadyActive({
    requestedMode: input.requestedMode,
    lifecycleTuple: input.lifecycleTuple,
  });
  const awaitingProvisionerQueue = isAwaitingProvisionerQueue({
    requestedMode: input.requestedMode,
    blockingReasons,
    lifecycleTuple: input.lifecycleTuple,
    hasPendingLoopWork: input.initReadiness.project?.hasPendingLoopWork === true,
  });

  if (input.requestedMode === "agent_run" && wouldClaim?.runnerMode !== "agent_run") {
    if (awaitingProvisionerQueue) {
      unknowns.push("awaiting_provisioner_queue");
    } else if (agentRunAlreadyActive) {
      unknowns.push("agent_run_already_active");
    } else {
      blockers.push("claim_not_agent_run");
    }
  }
  if (input.requestedMode === "preview_only" && wouldClaim?.runnerMode === "agent_run") {
    blockers.push("claim_would_start_agent_run");
  }
  if (launchStatus === "budget_blocked") {
    blockers.push("launch_budget_blocked");
  }
  for (const reason of claimPolicyRejectionReasons) {
    blockers.push(`claim_policy_${reason}`);
  }
  if (input.initReadiness.available !== true) {
    blockers.push("init_readiness_unavailable");
  }
  for (const blocker of input.initReadiness.blockers ?? []) {
    blockers.push(`init_${blocker}`);
  }
  for (const blocker of input.runtimeAuthReadiness.blockers) {
    blockers.push(`runtime_auth_${blocker}`);
  }
  for (const unknown of input.runtimeAuthReadiness.unknowns) {
    unknowns.push(`runtime_auth_${unknown}`);
  }
  if (input.gitSyncRisk.wouldBlockSync === true && !agentRunAlreadyActive) {
    blockers.push("workspace_sync_blocked");
  }
  if (input.requestedMode === "preview_only" && input.arenaStartExists === false) {
    blockers.push("bootstrap_missing");
  } else if (input.requestedMode === "agent_run" && input.arenaStartExists === false) {
    unknowns.push("preview_bootstrap_missing_until_agent_writes_it");
  }
  if (authStatus === "not_checked" && input.requestedMode === "agent_run") {
    unknowns.push("auth_not_checked");
  }
  if (input.gitSyncRisk.available === false) {
    unknowns.push("workspace_git_sync_not_available");
  }
  unknowns.push("remoteFreshnessNotChecked");

  if (input.lifecycleBlockers.includes("MANUAL")) {
    retryRequiredHumanEvidence.push("MANUAL blocker requires explicit evidence before project_retry_now.");
  }
  if (input.lifecycleBlockers.some((blocker) => ["INFRA", "API", "RATE_LIMIT", "BUDGET", "SECRETS"].includes(blocker))) {
    retryRequiredHumanEvidence.push("Retryable blockers require evidence that the wait condition is resolved before project_retry_now.");
  }
  if (claimPolicyRejectionReasons.includes("start_retry_capacity_exhausted")) {
    blockingRequiredHumanEvidence.push("Runtime-intent start retry capacity is exhausted; do not use project_retry_now as an implicit recovery path.");
  }

  const hardBlocked = blockers.length > 0;
  const hasNonRetryableBlockers = blockers.some((blocker) => blocker !== "claim_not_agent_run");
  const isWaitingForExplicitTgSpecLaunchStart = input.requestedMode === "agent_run"
    && input.lifecycleAllowedActions.includes("tg_spec_launch_start")
    && blockers.includes("claim_not_agent_run")
    && !hasNonRetryableBlockers
    && claimPolicyRejectionReasons.length === 0;
  const status: ExperimentExecutionReadiness["status"] = hardBlocked
    ? "blocked"
    : unknowns.length > 0
      ? "unknown"
      : "ready";
  const expectedConvergence: ExperimentExecutionReadiness["expectedConvergence"] =
    agentRunAlreadyActive
      ? "agent_run_in_progress"
      : awaitingProvisionerQueue
      ? "provisioner_queues_agent_run"
      : wouldClaim?.runnerMode === "agent_run"
      ? "worker_claims_agent_run"
      : wouldClaim?.runnerMode === "preview_only"
        ? "worker_claims_preview_only"
        : claimPolicyRejectionReasons.length > 0
          ? "not_claimable"
          : isWaitingForExplicitTgSpecLaunchStart
            ? "provisioner_queues_agent_run"
            : input.lifecycleAllowedActions.includes("retry_now") && !hasNonRetryableBlockers
              ? "supervisor_resume"
              : hardBlocked
                ? "not_claimable"
                : "unknown";
  const proposedOperatorAction = selectProposedOperatorAction({
    status,
    allowedActions: input.lifecycleAllowedActions,
    lifecycleRecommendedNextAction: input.lifecycleRecommendedNextAction,
    hasLifecycleBlockers: input.lifecycleBlockers.length > 0,
    hasNonRetryableBlockers,
    hasClaimPolicyRejection: claimPolicyRejectionReasons.length > 0,
    isWaitingForExplicitTgSpecLaunchStart,
    awaitingProvisionerQueue,
    agentRunAlreadyActive,
    wouldClaimAgentRun: wouldClaim?.runnerMode === "agent_run",
  });
  const apiKeyRuntimeAuthHumanEvidence = usesTokenManagerRuntimeAuth(input.runtimeAuthReadiness)
    && isMutatingOperatorAction(proposedOperatorAction)
    ? ["Runtime auth readiness uses TokenManager API-key credentials; confirm the operator intentionally accepts API-key cost/auth path before mutating launch or retry."]
    : [];
  const requiredHumanEvidence = [
    ...(proposedOperatorAction === "project_retry_now"
      ? [...retryRequiredHumanEvidence, ...blockingRequiredHumanEvidence]
      : proposedOperatorAction === "blocked"
        ? blockingRequiredHumanEvidence
        : []),
    ...apiKeyRuntimeAuthHumanEvidence,
  ];

  return {
    requestedMode: input.requestedMode,
    status,
    proposedOperatorAction,
    expectedConvergence,
    blockers: [...new Set(blockers)],
    lifecycleBlockers: [...new Set(input.lifecycleBlockers)],
    claimPolicyRejectionReasons: [...new Set(claimPolicyRejectionReasons)],
    unknowns: [...new Set(unknowns)],
    requiredHumanEvidence,
    reason: buildExecutionReadinessReason(status, proposedOperatorAction, blockers, unknowns, input.lifecycleBlockers),
    forbiddenImplicitActions: [
      "no_scheduler",
      "no_hidden_relaunch",
      "no_hidden_retry_unblock",
      "no_hidden_lifecycle_mutation",
      "no_raw_env_exposure",
    ],
  };
}

function usesTokenManagerRuntimeAuth(readiness: RuntimeAuthReadiness): boolean {
  return readiness.source === "token_manager" || readiness.source === "mixed";
}

function isMutatingOperatorAction(action: ExperimentExecutionReadiness["proposedOperatorAction"]): boolean {
  return !action.startsWith("none_") && action !== "blocked";
}

function buildRuntimeAuthReadiness(input: {
  requestedMode: RequestedExperimentMode;
  initReadiness: RunnerInitReadiness;
  authdHealth?: AuthdHealthSnapshot;
  tokenStatus?: TokenManagerStatusSnapshot;
}): RuntimeAuthReadiness {
  const requirements = input.requestedMode === "agent_run"
    ? runtimeAuthRequirementsForProject(input.initReadiness)
    : [];
  const requiredProviders = requirements.map((requirement) => requirement.provider);
  if (requirements.length === 0) {
    return {
      available: true,
      source: "not_required",
      status: "not_required",
      requiredProviders: [],
      providers: {},
      blockers: [],
      unknowns: [],
      evidenceNotes: [
        "This requested mode/project auth configuration does not require preflight runtime auth materialization.",
      ],
    };
  }

  const authdRequirements = requirements.filter((requirement) => requirement.source === "authd");
  const tokenRequirements = requirements.filter((requirement) => requirement.source === "token_manager");
  const providerEntries: RuntimeAuthReadiness["providers"] = {};
  const blockers: string[] = [];
  const unknowns: string[] = [];

  if (authdRequirements.length > 0) {
    const health = input.authdHealth;
    if (!health?.configured) {
      return unavailableRuntimeAuthReadiness(
        requiredProviders,
        "authd_not_configured",
        health?.error ?? "AUTHD_URL is not configured or authd health could not be read.",
      );
    }
    if (!health.available) {
      return unavailableRuntimeAuthReadiness(
        requiredProviders,
        "authd_unavailable",
        health.error ?? "authd health is unavailable.",
      );
    }

    const providers = sanitizeAuthdHealthProviders(health.providers);
    for (const requirement of authdRequirements) {
      const providerHealth = providers[requirement.provider];
      const status = providerHealth?.status ?? "missing";
      providerEntries[requirement.provider] = providerHealth ?? {
        status: "missing",
        source: null,
        version: null,
        checkedAt: null,
        detail: "Provider health was not returned by authd.",
      };
      if (status === "ready") continue;
      if (status === "unknown") {
        unknowns.push(`${requirement.provider}_unknown`);
        continue;
      }
      blockers.push(`${requirement.provider}_${status}`);
    }
  }

  if (tokenRequirements.length > 0) {
    const tokenStatus = input.tokenStatus;
    if (!tokenStatus?.available) {
      return unavailableRuntimeAuthReadiness(
        requiredProviders,
        "token_status_unavailable",
        tokenStatus?.error ?? "TokenManager status is unavailable.",
      );
    }

    for (const requirement of tokenRequirements) {
      const tokenProvider = requirement.tokenProvider ?? requirement.provider;
      const providerHealth = sanitizeTokenProviderStatus(tokenStatus.providers?.[tokenProvider], tokenProvider);
      providerEntries[requirement.provider] = providerHealth;
      if (providerHealth.status === "missing") {
        blockers.push(requirement.missingBlocker);
      } else if (providerHealth.status === "unknown") {
        unknowns.push(`${providerKeyToBlockerPrefix(requirement.provider)}_unknown`);
      }
    }
  }

  const source: RuntimeAuthReadiness["source"] = authdRequirements.length > 0 && tokenRequirements.length > 0
    ? "mixed"
    : authdRequirements.length > 0
      ? "authd"
      : "token_manager";

  return {
    available: true,
    source,
    status: blockers.length > 0 ? "blocked" : unknowns.length > 0 ? "unknown" : "ready",
    requiredProviders,
    providers: providerEntries,
    blockers: [...new Set(blockers)],
    unknowns: [...new Set(unknowns)],
    evidenceNotes: [
      "Runtime auth readiness is a sanitized authd/TokenManager readback; it never returns provider auth values.",
      ...(tokenRequirements.length > 0
        ? ["TokenManager-backed providers mean this run uses API-key credentials, not authd subscription/OAuth runtime auth."]
        : []),
      "It does not refresh providers, mint run auth, write auth files, retry projects or mutate lifecycle state.",
    ],
  };
}

function runtimeAuthRequirementsForProject(initReadiness: RunnerInitReadiness): RuntimeAuthRequirement[] {
  const project = initReadiness.project;
  if (!project) return [];

  const billingMode = project.providerBillingMode ?? "byok";

  const requirements: RuntimeAuthRequirement[] = [];
  if (project.agent === "codex") {
    if (project.codexAuthMode === "subscription") {
      requirements.push({
        source: "authd",
        provider: "codex",
        missingBlocker: "codex_missing",
      });
    } else if (billingMode === "platform_credits") {
      return [];
    } else if (billingMode === "platform_credentials") {
      requirements.push({
        source: "token_manager",
        provider: "openai-api",
        tokenProvider: "openai-api",
        missingBlocker: "openai_api_missing",
      });
    }
  }
  if (project.agent === "claude-code") {
    if (project.claudeAuthMode === "oauth" || (project.claudeAuthMode == null && billingMode !== "platform_credits")) {
      requirements.push({
        source: "authd",
        provider: "claude",
        missingBlocker: "claude_missing",
      });
    } else if (billingMode === "platform_credits") {
      return [];
    } else if (billingMode === "platform_credentials") {
      requirements.push({
        source: "token_manager",
        provider: "claude-api",
        tokenProvider: "claude-api",
        missingBlocker: "claude_api_missing",
      });
    }
  }
  return requirements;
}

function unavailableRuntimeAuthReadiness(
  requiredProviders: string[],
  blocker: string,
  detail: string,
): RuntimeAuthReadiness {
  return {
    available: false,
    source: "unavailable",
    status: "blocked",
    requiredProviders,
    providers: {},
    blockers: [blocker],
    unknowns: [],
    evidenceNotes: [
      detail,
      "Runtime auth readiness is a sanitized authd/TokenManager readback; it never returns provider auth values.",
    ],
  };
}

function sanitizeAuthdHealthProviders(
  providers: AuthdHealthSnapshot["providers"],
): RuntimeAuthReadiness["providers"] {
  if (!providers || typeof providers !== "object") return {};
  return Object.fromEntries(
    Object.entries(providers).flatMap(([provider, value]) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) return [];
      return [[provider, {
        status: readOptionalString(value.status) ?? "unknown",
        source: readOptionalString(value.source),
        version: readOptionalString(value.version),
        checkedAt: readOptionalString(value.checkedAt),
        detail: readOptionalString(value.detail),
      }]];
    }),
  );
}

function sanitizeTokenProviderStatus(
  provider: TokenProviderReadiness | undefined,
  providerId: string,
): RuntimeAuthReadiness["providers"][string] {
  if (!provider || provider.hasToken !== true) {
    return {
      status: "missing",
      source: "token_manager",
      version: null,
      checkedAt: null,
      detail: `TokenManager has no ${providerId} token.`,
    };
  }
  return {
    status: isNonEmptyString(provider.freshness) ? provider.freshness : "ready",
    source: "token_manager",
    version: isNonEmptyString(provider.hash) ? provider.hash : null,
    checkedAt: typeof provider.updatedAt === "number" && provider.updatedAt > 0
      ? new Date(provider.updatedAt).toISOString()
      : null,
    detail: `TokenManager has sanitized ${providerId} token metadata.`,
  };
}

function providerKeyToBlockerPrefix(provider: string): string {
  return provider.replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_+|_+$/g, "").toLowerCase();
}

function isAgentRunAlreadyActive(input: {
  requestedMode: RequestedExperimentMode;
  lifecycleTuple: {
    powerIntent: string | null;
    agentIntent: string | null;
    runtimeState: string | null;
    agentState: string | null;
  };
}): boolean {
  return input.requestedMode === "agent_run"
    && input.lifecycleTuple.powerIntent === "ON"
    && input.lifecycleTuple.agentIntent === "ON"
    && input.lifecycleTuple.runtimeState === "RUNNING"
    && input.lifecycleTuple.agentState === "RUNNING";
}

function readAuthStatus(claimDryRun: RuntimeClaimDryRun): string | null {
  const payload = claimDryRun.launch?.payload;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const envSummary = (payload as { envSummary?: unknown }).envSummary;
  if (!envSummary || typeof envSummary !== "object" || Array.isArray(envSummary)) return null;
  const auth = (envSummary as { auth?: unknown }).auth;
  return typeof auth === "string" ? auth : null;
}

function isAwaitingProvisionerQueue(input: {
  requestedMode: RequestedExperimentMode;
  blockingReasons: string[];
  lifecycleTuple: {
    powerIntent: string | null;
    agentIntent: string | null;
    runtimeState: string | null;
    agentState: string | null;
    blockers: string[];
    lastOutcome: string | null;
    provisionedAt: string | null;
  };
  hasPendingLoopWork: boolean;
}): boolean {
  return input.requestedMode === "agent_run"
    && input.blockingReasons.includes("not_in_runtime_intent_claim_candidate_set")
    && input.hasPendingLoopWork
    && input.lifecycleTuple.powerIntent === "ON"
    && input.lifecycleTuple.agentIntent === "ON"
    && input.lifecycleTuple.runtimeState === "ABSENT"
    && (input.lifecycleTuple.agentState == null || input.lifecycleTuple.agentState === "IDLE")
    && input.lifecycleTuple.blockers.length === 0
    && input.lifecycleTuple.lastOutcome == null
    && input.lifecycleTuple.provisionedAt == null;
}

function selectProposedOperatorAction(input: {
  status: ExperimentExecutionReadiness["status"];
  allowedActions: string[];
  lifecycleRecommendedNextAction: string;
  hasLifecycleBlockers: boolean;
  hasNonRetryableBlockers: boolean;
  hasClaimPolicyRejection: boolean;
  isWaitingForExplicitTgSpecLaunchStart: boolean;
  awaitingProvisionerQueue: boolean;
  agentRunAlreadyActive: boolean;
  wouldClaimAgentRun: boolean;
}): ExperimentExecutionReadiness["proposedOperatorAction"] {
  if (input.agentRunAlreadyActive) {
    return "none_observe_running_agent";
  }
  if (input.awaitingProvisionerQueue) {
    return "none_wait_for_provisioner_queue";
  }
  if (input.status === "ready" || (input.status === "unknown" && input.wouldClaimAgentRun)) {
    return "none_wait_for_worker_claim";
  }
  if (input.hasClaimPolicyRejection) {
    return "blocked";
  }
  if (input.isWaitingForExplicitTgSpecLaunchStart) {
    return "tg_spec_launch_start";
  }
  if (input.status === "blocked" && input.hasNonRetryableBlockers) {
    return "blocked";
  }
  if (input.status === "blocked" && !input.hasLifecycleBlockers) {
    if (input.allowedActions.includes("recreate_runtime")) {
      return "project_recreate_runtime";
    }
    if (input.allowedActions.includes("agent_on")) {
      return "project_agent_on";
    }
    if (input.allowedActions.includes("app_on")) {
      return "project_power_on";
    }
    if (input.allowedActions.includes("relaunch")) {
      return "project_relaunch";
    }
  }
  if (input.status === "blocked" && !input.hasLifecycleBlockers) {
    return "blocked";
  }
  if (
    input.hasLifecycleBlockers
    && input.lifecycleRecommendedNextAction === "no_action"
    && input.allowedActions.includes("no_action")
  ) {
    return "none_wait_for_lifecycle_blocker";
  }
  if (input.hasLifecycleBlockers && input.allowedActions.includes("retry_now")) {
    return "project_retry_now";
  }
  if (input.allowedActions.includes("recreate_runtime")) {
    return "project_recreate_runtime";
  }
  if (input.allowedActions.includes("agent_on")) {
    return "project_agent_on";
  }
  if (input.allowedActions.includes("app_on")) {
    return "project_power_on";
  }
  if (input.allowedActions.includes("relaunch")) {
    return "project_relaunch";
  }
  return "blocked";
}

function buildExecutionReadinessReason(
  status: ExperimentExecutionReadiness["status"],
  action: ExperimentExecutionReadiness["proposedOperatorAction"],
  blockers: string[],
  unknowns: string[],
  lifecycleBlockers: string[],
): string {
  if (status === "ready") {
    return "Preflight has no hard blockers; let the existing worker runtime-intent claim path run.";
  }
  if (status === "unknown") {
    return `Preflight has unresolved unknowns (${unknowns.join(", ")}); proposed action is ${action}.`;
  }
  if (action === "tg_spec_launch_start") {
    return "Preflight is waiting for explicit tg_spec_launch_start; claim_not_agent_run is expected before the launch-start mutation.";
  }
  if (action === "none_wait_for_lifecycle_blocker") {
    return `Preflight is waiting because the lifecycle owner recommends no_action; lifecycle blockers are ${lifecycleBlockers.join(", ") || "none"}; execution blockers are ${blockers.join(", ")}.`;
  }
  return `Preflight is blocked by ${blockers.join(", ")}; proposed action is ${action}.`;
}

function buildVisualScenarioReadiness(input: {
  previewUrl: string | null;
  runtimeState: string | null;
  previewHealth: string | null;
  sourceBootstrapReadiness: SourceBootstrapReadiness;
  executionReadiness: ExperimentExecutionReadiness;
}): VisualScenarioReadiness {
  const blockers: string[] = [];
  const unknowns: string[] = [];

  if (!input.previewUrl) {
    blockers.push("preview_url_unavailable");
  }
  if (input.runtimeState !== "RUNNING") {
    blockers.push("runtime_not_running");
  }
  if (input.previewHealth !== "HEALTHY") {
    blockers.push("preview_unhealthy");
  }

  const uniqueBlockers = [...new Set(blockers)];
  const canRunVisualScenario = uniqueBlockers.length === 0 && Boolean(input.previewUrl);
  if (!canRunVisualScenario) {
    if (input.sourceBootstrapReadiness.available !== true) {
      unknowns.push("source_bootstrap_readiness_unavailable");
    } else if (input.sourceBootstrapReadiness.status !== "preview_runnable") {
      unknowns.push("source_not_preview_runnable");
    }
    for (const unknown of input.sourceBootstrapReadiness.unknowns) {
      unknowns.push(unknown);
    }
    if (input.executionReadiness.status === "blocked") {
      unknowns.push("execution_not_ready_for_agent_run");
    } else if (
      input.executionReadiness.status === "unknown"
      && input.executionReadiness.expectedConvergence !== "agent_run_in_progress"
    ) {
      unknowns.push("execution_readiness_unknown_for_agent_run");
    }
  }
  const uniqueUnknowns = [...new Set(unknowns)];
  const status: VisualScenarioReadiness["status"] = uniqueBlockers.length > 0
    ? "blocked"
    : uniqueUnknowns.length > 0
      ? "unknown"
      : "ready";

  return {
    status,
    canRunVisualScenario,
    previewUrl: input.previewUrl,
    recommendedBaseUrl: canRunVisualScenario ? input.previewUrl : null,
    blockers: uniqueBlockers,
    unknowns: uniqueUnknowns,
    reason: buildVisualScenarioReadinessReason(status, uniqueBlockers, uniqueUnknowns),
    evidenceNotes: [
      "Visual scenario readiness is a read-only projection from project_explain, source bootstrap readiness and execution readiness.",
      "It does not start previews, retry runtime intents, clear blockers, run Playwright or write scenario evidence.",
      "recommendedBaseUrl is only populated when the current preview is healthy enough for a disposable visual scenario run.",
      "Source/bootstrap and agent-run readiness gaps are reported as caveats; they do not block capture of an already healthy current preview.",
      "When the current preview is healthy, source/bootstrap and agent-run caveats remain in their owner fields instead of making current-preview visual scenario readiness unknown.",
    ],
  };
}

function buildVisualScenarioReadinessReason(
  status: VisualScenarioReadiness["status"],
  blockers: string[],
  unknowns: string[],
): string {
  if (status === "ready") {
    return "Current preview is healthy enough to run a disposable visual scenario capture.";
  }
  if (status === "unknown") {
    return `Visual scenario readiness has unresolved unknowns (${unknowns.join(", ")}).`;
  }
  return `Visual scenario readiness is blocked by ${blockers.join(", ")}.`;
}

function unavailableSourceBootstrapReadiness(
  reason: string,
  reasonCode: SourceBootstrapReadiness["reasonCode"],
  issues = ["source_snapshot_unavailable"],
): SourceBootstrapReadiness {
  return {
    available: false,
    unavailableReason: reason,
    evidenceSource: "unavailable",
    status: "unknown",
    reasonCode,
    trackedCommitSha: null,
    trackedFilesCount: null,
    trackedFilesPreview: [],
    requiredFiles: {
      arenaStartTracked: null,
      packageJsonTracked: null,
    },
    issues,
    unknowns: ["remoteFreshnessNotChecked"],
    evidenceNotes: [
      "Source bootstrap readiness is local workspace git HEAD evidence only; no remote fetch was attempted.",
    ],
  };
}

function isReadmeOnlySourceSnapshot(trackedFiles: string[]): boolean {
  const productFiles = trackedFiles.filter((filePath) => {
    return filePath !== ".gitignore" && !isRunnerManagedReplayablePath(filePath);
  });
  return productFiles.length > 0
    && productFiles.every((filePath) => /^readme(\.[a-z0-9]+)?$/i.test(filePath));
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

async function readWorkspaceEvidence(input: {
  ctx: { config: Pick<ArenaCtlContext["config"], "workspaceRoot"> };
  project: ProjectHealthProject;
  runnerBackend: string | null;
}): Promise<ProjectExperimentPreflight["workspace"]> {
  if (input.runnerBackend === "vps") {
    return unavailableWorkspace("Workspace access is not available for VPS projects.");
  }

  const workspacePath = resolveProjectWorkspacePath(input.ctx, input.project);
  const workspaceRoot = path.resolve(input.ctx.config.workspaceRoot);
  if (!isPathInside(workspacePath, workspaceRoot)) {
    return unavailableWorkspace(`Workspace path ${workspacePath} is outside configured root ${workspaceRoot}.`);
  }

  const workspaceStat = await statOrNull(workspacePath);
  const exists = Boolean(workspaceStat?.isDirectory());
  const nonEmpty = exists ? (await readdir(workspacePath)).length > 0 : false;
  const isGitRepo = exists ? await gitSucceeds(workspacePath, ["rev-parse", "--git-dir"]) : false;

  return {
    available: true,
    unavailableReason: null,
    path: workspacePath,
    exists,
    nonEmpty,
    isGitRepo,
    originUrl: isGitRepo ? normalizeRepoUrl(await gitValue(workspacePath, ["remote", "get-url", "origin"])) : null,
    branch: isGitRepo ? await gitValue(workspacePath, ["rev-parse", "--abbrev-ref", "HEAD"]) : null,
    commitSha: isGitRepo ? await gitValue(workspacePath, ["rev-parse", "HEAD"]) : null,
  };
}

async function readGitSyncRisk(workspacePath: string): Promise<ProjectExperimentPreflight["gitSyncRisk"]> {
  const rawStatus = await gitRawValue(workspacePath, ["status", "--porcelain", "-uall"]);
  const statusLines = rawStatus ? rawStatus.split("\n").filter(Boolean).slice(0, 20) : [];
  const entries = rawStatus ? parseGitPorcelainStatusEntries(rawStatus) : [];
  const dirtyEntries = await Promise.all(
    entries.map(async (entry) => ({
      entry,
      replayable: await isReplayableDirtyEntry(workspacePath, entry),
    })),
  );
  const blockingPaths = dirtyEntries
    .filter(({ replayable }) => !replayable)
    .map(({ entry }) => entry.path);
  const dirty = statusLines.length > 0;

  return {
    available: true,
    dirty,
    statusPreview: statusLines,
    replayableOnly: dirty ? blockingPaths.length === 0 : false,
    wouldBlockSync: dirty && blockingPaths.length > 0,
    blockingPaths,
    policySource: "@arena/contracts:isRunnerManagedReplayableDirtyEntry",
  };
}

function unavailableWorkspace(reason: string): ProjectExperimentPreflight["workspace"] {
  return {
    available: false,
    unavailableReason: reason,
    path: null,
    exists: null,
    nonEmpty: null,
    isGitRepo: null,
    originUrl: null,
    branch: null,
    commitSha: null,
  };
}

function unavailableGitSyncRisk(): ProjectExperimentPreflight["gitSyncRisk"] {
  return {
    available: false,
    dirty: null,
    statusPreview: [],
    replayableOnly: null,
    wouldBlockSync: null,
    blockingPaths: [],
    policySource: "@arena/contracts:isRunnerManagedReplayableDirtyEntry",
  };
}

export function parsePorcelainPaths(status: string): string[] {
  return parseGitPorcelainStatusEntries(status).map((entry) => entry.path);
}

async function isReplayableDirtyEntry(workspacePath: string, entry: GitPorcelainStatusEntry): Promise<boolean> {
  if (isRunnerManagedReplayableDirtyEntry({ path: entry.path })) return true;
  if (entry.path !== ".gitignore" && entry.path !== "arena-start.sh") return false;

  const contents = await readDirtyEntryContents(workspacePath, entry);
  return isRunnerManagedReplayableDirtyEntry({
    path: entry.path,
    headContent: contents.headContent,
    indexContent: contents.indexContent,
    worktreeContent: contents.worktreeContent,
  });
}

async function readDirtyEntryContents(workspacePath: string, entry: GitPorcelainStatusEntry): Promise<{
  headContent: string | null;
  indexContent?: string | null;
  worktreeContent?: string | null;
}> {
  const headContent = await gitRawValue(workspacePath, ["show", `HEAD:${entry.path}`]);
  const code = normalizeGitPorcelainStatusCode(entry.code);
  const indexContent = touchesIndex(code)
    ? await gitRawValue(workspacePath, ["show", `:${entry.path}`])
    : undefined;
  const worktreeContent = touchesWorktree(code)
    ? await readWorkspaceFileRaw(workspacePath, entry.path)
    : undefined;

  return {
    headContent,
    indexContent,
    worktreeContent,
  };
}

async function readWorkspaceFileRaw(workspacePath: string, filePath: string): Promise<string | null> {
  try {
    return await readFile(path.join(workspacePath, filePath), "utf8");
  } catch {
    return null;
  }
}

function touchesIndex(code: string): boolean {
  return code !== "??" && code[0] !== " ";
}

function touchesWorktree(code: string): boolean {
  return code === "??" || code[1] !== " ";
}

async function statOrNull(filePath: string) {
  try {
    return await stat(filePath);
  } catch {
    return null;
  }
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function gitSucceeds(cwd: string, args: string[]): Promise<boolean> {
  return (await gitValue(cwd, args)) != null;
}

async function gitValue(cwd: string, args: string[]): Promise<string | null> {
  try {
    const result = await execFileAsync("git", args, {
      cwd,
      timeout: 10_000,
      maxBuffer: 1024 * 1024,
    });
    return result.stdout.trim() || null;
  } catch {
    return null;
  }
}

async function gitRawValue(cwd: string, args: string[]): Promise<string | null> {
  try {
    const result = await execFileAsync("git", args, {
      cwd,
      timeout: 10_000,
      maxBuffer: 1024 * 1024,
    });
    return result.stdout;
  } catch {
    return null;
  }
}

function readOptionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function readFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  return value.filter((item): item is string => typeof item === "string" && item.length > 0);
}
