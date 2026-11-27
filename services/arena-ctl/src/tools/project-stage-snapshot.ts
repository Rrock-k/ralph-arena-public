import { readFile } from "node:fs/promises";
import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";
import { jsonResult, errorResult, toErrorMessage } from "../result.js";
import type { ArenaCtlContext } from "../tool-context.js";
import {
  readProjectExperimentPreflight,
  type ProjectExperimentPreflight,
} from "./project-experiment-preflight.js";

export const PROJECT_STAGE_SNAPSHOT_SCHEMA_VERSION = "ra-356.project-stage-snapshot.v1";

const PLAN_RELATIVE_PATH = ".ralph/plan.json";
const PROVIDER_SESSION_CHECKPOINT_RELATIVE_PATH = ".ralph/provider-session-checkpoint.json";
const ITERATION_LOG_RELATIVE_PATH = ".ralph/iteration-log.json";
const KNOWN_TASK_STATUSES = ["pending", "in_progress", "completed", "failed", "skipped"] as const;
const TASK_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/;

type KnownTaskStatus = typeof KNOWN_TASK_STATUSES[number];
type ExecutorCandidateTaskStatus = Extract<KnownTaskStatus, "pending" | "in_progress" | "failed">;
type ReadStatus = "ready" | "blocked" | "unavailable" | "missing" | "invalid";
type JsonRecord = Record<string, unknown>;
type ProjectVisualEvidenceMode = "off" | "required" | "new_tasks_only";
type SnapshotProjectActionId = "resume_agent" | "check_story_selection";
type ProviderSessionStatus = "ready" | "missing" | "invalid" | "unavailable";

type WorkspaceTextFile =
  | { status: "unavailable"; path: string | null; reason: string }
  | { status: "missing"; path: string; reason: string }
  | { status: "invalid"; path: string; reason: string }
  | { status: "ready"; path: string; content: string };

type OwnerRead = {
  owner: string;
  status: ReadStatus;
  notes: string[];
};

export type ProjectStageSnapshot = {
  schemaVersion: typeof PROJECT_STAGE_SNAPSHOT_SCHEMA_VERSION;
  generatedAt: string;
  projectId: string;
  selectedTaskId: string | null;
  stageBoundary: {
    ownerBoundary: "arena-ctl.project-stage-snapshot";
    mode: "read_only";
    allowed: ["none"];
    forbidden: string[];
  };
  ownerReads: OwnerRead[];
  project: ProjectExperimentPreflight["project"];
  lifecycleContext: ProjectExperimentPreflight["lifecycleContext"];
  source: {
    runnerExpectation: ProjectExperimentPreflight["runnerExpectation"];
    workspace: Pick<
      ProjectExperimentPreflight["workspace"],
      "available" | "unavailableReason" | "path" | "exists" | "isGitRepo" | "originUrl" | "branch" | "commitSha"
    >;
    workspaceDecision: ProjectExperimentPreflight["workspaceDecision"];
    gitSyncRisk: ProjectExperimentPreflight["gitSyncRisk"];
    remoteFreshnessChecked: false;
  };
  acceptedArtifactAudit: SanitizedAcceptedArtifactAudit;
  visualEvidencePolicy: SanitizedVisualEvidencePolicy;
  visualWorkbenchManifestReadiness: SanitizedVisualWorkbenchManifestReadiness;
  selectedTaskVisualReadback: SelectedTaskVisualReadback;
  selectedTaskWorkbenchAutomationReadback: SelectedTaskWorkbenchAutomationReadback;
  plan: PlanSnapshot;
  providerSessions: ProviderSessionSnapshot;
  nextHandoff: string[];
  evidenceNotes: string[];
};

type SanitizedAcceptedArtifactAudit = {
  available: boolean;
  projectId: string | null;
  projectName: string | null;
  classification: string | null;
  runnerReady: boolean | null;
  storageMode: string | null;
  latestSpec: {
    specId: string | null;
    specVersionId: string | null;
    version: number | null;
    sourceProjectId: string | null;
    sourceVersion: number | null;
    metadataHash: string | null;
  };
  recommendedNextAction: string | null;
  allowedActions: string[];
  why: string[];
  operatorNotes: string[];
  error: string | null;
};

type SanitizedVisualWorkbenchManifestReadiness = {
  available: boolean;
  status: "ready" | "blocked" | "unknown" | null;
  canRunWorkbenchCapture: boolean;
  schemaVersion: string | null;
  projectClass: string | null;
  blockers: string[];
  unknowns: string[];
};

type SanitizedVisualEvidencePolicy = {
  owner: "governance.runner-init-readiness.ralphConfig";
  status: "ready" | "unavailable" | "invalid";
  visualEvidenceMode: ProjectVisualEvidenceMode | null;
  blockers: string[];
  notes: string[];
};

type SelectedTaskVisualReadback = {
  selectedTaskId: string | null;
  selectedTaskStatus: SelectedTaskSnapshot["status"] | null;
  visualEvidenceRequired: boolean | null;
  visualEvidenceMode: ProjectVisualEvidenceMode | null;
  visualEvidencePolicyStatus: SanitizedVisualEvidencePolicy["status"];
  visualWorkbenchManifestStatus: SanitizedVisualWorkbenchManifestReadiness["status"];
  canRunWorkbenchCapture: boolean;
  visualExpectationSources: string[];
  nextProjectActionId: Extract<SnapshotProjectActionId, "check_story_selection"> | null;
  status: "not_selected" | "not_applicable" | "check_story_selection_ready" | "check_story_selection_blocked";
  tone: "good" | "warn" | "neutral";
  reasonCode:
    | "task_id_not_selected"
    | "selected_task_not_found"
    | "visual_policy_unavailable"
    | "visual_policy_invalid"
    | "visual_evidence_mode_off"
    | "visual_evidence_not_required_for_task"
    | "visual_manifest_unavailable"
    | "visual_manifest_not_ready"
    | "check_story_selection_ready";
  title: string;
  message: string;
  canCheckStorySelection: boolean;
};

type PlanSnapshot = {
  owner: "@arena/ralph-runtime:PlanSchema";
  path: string | null;
  status: "ready" | "missing" | "invalid" | "unavailable";
  reasonCode:
    | null
    | "workspace_unavailable"
    | "plan_missing"
    | "plan_unreadable"
    | "plan_invalid"
    | "task_id_not_selected"
    | "selected_task_not_found";
  schemaOwner: "@arena/ralph-runtime";
  version: number | null;
  specFile: string | null;
  specHash: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  phaseCount: number | null;
  judgmentCount: number | null;
  specMigrationCount: number | null;
  taskCounts: Record<KnownTaskStatus | "unknown" | "total", number>;
  taskCandidates: TaskCandidateSnapshot[];
  selectedTask: SelectedTaskSnapshot | null;
  blockers: string[];
  warnings: string[];
};

type TaskCandidateSnapshot = {
  id: string;
  displayTitle: string | null;
  status: ExecutorCandidateTaskStatus;
  statusSource: "explicit" | "plan_schema_default";
  attempts: number | null;
  lastError: string | null;
  requiredRolePasses: string[];
  visualEvidenceRequired: boolean | null;
  feedbackItemRefCount: number;
  recommendedExecutorMode: "new_task" | "failed_task" | "resume_interrupted";
};

type SelectedTaskSnapshot = {
  id: string;
  displayTitle: string | null;
  description: string | null;
  acceptanceCriteria: string[];
  status: KnownTaskStatus | "unknown";
  statusSource: "explicit" | "plan_schema_default" | "unsupported";
  attempts: number | null;
  lastError: string | null;
  requiredRolePasses: string[];
  visualEvidenceRequired: boolean | null;
  feedbackItemRefs: Array<{
    itemId: string | null;
    diffItemId: string | null;
    workSurface: string | null;
    workImpact: string | null;
    summary: string | null;
  }>;
  verificationEvidence: {
    total: number;
    screenshot: number;
    pass: number;
    fail: number;
    inconclusive: number;
  };
};

type ProviderSessionSnapshot = {
  owner: "@arena/ralph-runtime:ProviderSessionCheckpointStore";
  path: string | null;
  status: ProviderSessionStatus;
  reasonCode:
    | null
    | "workspace_unavailable"
    | "checkpoint_missing"
    | "checkpoint_unreadable"
    | "checkpoint_invalid"
    | "task_id_not_selected";
  sessionCount: number | null;
  selectedTaskSessionCount: number | null;
  selectedTaskResumableSessionCount: number | null;
  selectedTaskSessions: ProviderSessionSummary[];
  selectedTaskCheckpointReadback: ProviderSessionSelectedTaskCheckpointReadback;
  blockers: string[];
  warnings: string[];
};

type ProviderSessionSelectedTaskCheckpointReadback = {
  selectedTaskId: string | null;
  selectedTaskStatus: SelectedTaskSnapshot["status"] | null;
  recommendedExecutorMode: TaskCandidateSnapshot["recommendedExecutorMode"] | null;
  providerSessionStatus: ProviderSessionStatus | null;
  selectedTaskSessionCount: number | null;
  selectedTaskResumableSessionCount: number | null;
  nextProjectActionId: SnapshotProjectActionId | null;
  status: "not_selected" | "not_executor_candidate" | "not_checkpoint_gated" | "checkpoint_ready" | "checkpoint_blocked";
  tone: "good" | "warn" | "neutral";
  reasonCode:
    | null
    | "task_id_not_selected"
    | "not_executor_candidate"
    | "not_checkpoint_gated"
    | "checkpoint_unavailable"
    | "no_selected_task_session"
    | "success_checkpoint_not_resumable"
    | "failed_error_checkpoint_ready";
  title: string;
  message: string;
  canPrepareExecutor: boolean;
};

type SelectedTaskWorkbenchAutomationReadback = {
  owner: "@arena/ralph-runtime:IterationLog.visualWorkbenchAutomation";
  selectedTaskId: string | null;
  iterationLogStatus: ReadStatus;
  path: string | null;
  status: "not_selected" | "missing" | "invalid" | "not_found" | "ready";
  tone: "good" | "warn" | "neutral";
  reasonCode:
    | "task_id_not_selected"
    | "iteration_log_missing"
    | "iteration_log_unavailable"
    | "iteration_log_invalid"
    | "selected_task_automation_not_found"
    | "selected_task_automation_ready";
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

type ProviderSessionSummary = {
  agent: string;
  model: string | null;
  taskId: string;
  taskFingerprint: string;
  specHash: string | null;
  sessionId: string;
  reason: "task_attempt" | "rate_limit";
  outcome: "success" | "error";
  errorCategory: string | null;
  resumedFrom: string | null;
  resumeFallbackReason: string | null;
  updatedAt: string;
};

export function registerProjectStageSnapshotTool(server: McpServer, ctx: ArenaCtlContext) {
  server.registerTool("project_stage_snapshot", {
    description:
      "Read-only RA-356 project stage snapshot for one live project. " +
      "It gathers existing preflight, accepted artifact, plan and provider-session owner readbacks " +
      "without mutating lifecycle, runtime, source, tasks, evidence or provider state.",
    inputSchema: {
      projectId: z.string().min(1),
      taskId: z.string().min(1).optional(),
      tail: z.number().int().min(1).max(5000).optional(),
    },
  }, async ({ projectId, taskId, tail }) => {
    try {
      return jsonResult(await readProjectStageSnapshot({
        ctx,
        projectId,
        taskId,
        tail,
      }));
    } catch (error) {
      return errorResult(`Failed to build project stage snapshot for ${projectId}`, toErrorMessage(error));
    }
  });
}

export async function readProjectStageSnapshot(input: {
  ctx: ArenaCtlContext;
  projectId: string;
  taskId?: string;
  tail?: number;
}): Promise<ProjectStageSnapshot> {
  const [preflight, acceptedArtifactAuditResult] = await Promise.all([
    readProjectExperimentPreflight({
      ctx: input.ctx,
      projectId: input.projectId,
      requestedMode: "agent_run",
      tail: input.tail,
    }),
    readAcceptedArtifactAudit(input.ctx, input.projectId),
  ]);

  const workspacePath = preflight.workspace.available && preflight.workspace.path
    ? preflight.workspace.path
    : null;
  const [planFile, providerSessionFile, iterationLogFile] = workspacePath
    ? await Promise.all([
      readWorkspaceTextFile(workspacePath, PLAN_RELATIVE_PATH),
      readWorkspaceTextFile(workspacePath, PROVIDER_SESSION_CHECKPOINT_RELATIVE_PATH),
      readWorkspaceTextFile(workspacePath, ITERATION_LOG_RELATIVE_PATH),
    ])
    : [
      {
        status: "unavailable" as const,
        path: null,
        reason: preflight.workspace.unavailableReason ?? "Workspace is unavailable.",
      },
      {
        status: "unavailable" as const,
        path: null,
        reason: preflight.workspace.unavailableReason ?? "Workspace is unavailable.",
      },
      {
        status: "unavailable" as const,
        path: null,
        reason: preflight.workspace.unavailableReason ?? "Workspace is unavailable.",
      },
    ];

  return buildProjectStageSnapshot({
    preflight,
    acceptedArtifactAudit: acceptedArtifactAuditResult,
    selectedTaskId: input.taskId,
    planFile,
    providerSessionFile,
    iterationLogFile,
  });
}

export function buildProjectStageSnapshot(input: {
  preflight: ProjectExperimentPreflight;
  acceptedArtifactAudit: { ok: true; value: unknown } | { ok: false; error: string };
  selectedTaskId?: string;
  planFile: WorkspaceTextFile;
  providerSessionFile: WorkspaceTextFile;
  iterationLogFile?: WorkspaceTextFile;
  generatedAt?: string;
}): ProjectStageSnapshot {
  const selectedTaskId = input.selectedTaskId?.trim() || null;
  const plan = buildPlanSnapshot(input.planFile, selectedTaskId);
  const providerSessions = buildProviderSessionSnapshot(
    input.providerSessionFile,
    selectedTaskId,
    plan.selectedTask?.status ?? null,
  );
  const acceptedArtifactAudit = sanitizeAcceptedArtifactAudit(input.acceptedArtifactAudit);
  const visualEvidencePolicy = sanitizeVisualEvidencePolicy(input.preflight.initReadiness);
  const visualWorkbenchManifestReadiness = sanitizeVisualWorkbenchManifestReadiness(input.preflight.visualWorkbenchManifestReadiness);
  const selectedTaskVisualReadback = buildSelectedTaskVisualReadback({
    selectedTaskId,
    selectedTask: plan.selectedTask,
    visualEvidencePolicy,
    visualWorkbenchManifestReadiness,
  });
  const selectedTaskWorkbenchAutomationReadback = buildSelectedTaskWorkbenchAutomationReadback({
    file: input.iterationLogFile ?? {
      status: "unavailable",
      path: null,
      reason: "Iteration log read was not provided.",
    },
    selectedTaskId,
  });

  return {
    schemaVersion: PROJECT_STAGE_SNAPSHOT_SCHEMA_VERSION,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    projectId: input.preflight.project.id,
    selectedTaskId,
    stageBoundary: {
      ownerBoundary: "arena-ctl.project-stage-snapshot",
      mode: "read_only",
      allowed: ["none"],
      forbidden: [
        "no_lifecycle_write",
        "no_runtime_intent_write",
        "no_source_write",
        "no_plan_or_task_write",
        "no_evidence_or_progress_write",
        "no_provider_call",
        "no_hidden_retry_relaunch_recreate_or_unblock",
      ],
    },
    ownerReads: buildOwnerReads({
      preflight: input.preflight,
      acceptedArtifactAudit,
      visualEvidencePolicy,
      visualWorkbenchManifestReadiness,
      plan,
      providerSessions,
      selectedTaskWorkbenchAutomationReadback,
    }),
    project: input.preflight.project,
    lifecycleContext: input.preflight.lifecycleContext,
    source: {
      runnerExpectation: input.preflight.runnerExpectation,
      workspace: {
        available: input.preflight.workspace.available,
        unavailableReason: input.preflight.workspace.unavailableReason,
        path: input.preflight.workspace.path,
        exists: input.preflight.workspace.exists,
        isGitRepo: input.preflight.workspace.isGitRepo,
        originUrl: input.preflight.workspace.originUrl,
        branch: input.preflight.workspace.branch,
        commitSha: input.preflight.workspace.commitSha,
      },
      workspaceDecision: input.preflight.workspaceDecision,
      gitSyncRisk: input.preflight.gitSyncRisk,
      remoteFreshnessChecked: false,
    },
    acceptedArtifactAudit,
    visualEvidencePolicy,
    visualWorkbenchManifestReadiness,
    selectedTaskVisualReadback,
    selectedTaskWorkbenchAutomationReadback,
    plan,
    providerSessions,
    nextHandoff: buildNextHandoff({
      selectedTaskId,
      plan,
      providerSessions,
      selectedTaskVisualReadback,
      selectedTaskWorkbenchAutomationReadback,
      gitSyncRisk: input.preflight.gitSyncRisk,
    }),
    evidenceNotes: [
      "Project Stage Snapshot is a disposable read-only experiment input, not persisted product truth.",
      "Lifecycle context is imported from project_experiment_preflight/project_explain and is not recomputed here.",
      "Plan summary reads .ralph/plan.json for operator handoff only; @arena/ralph-runtime PlanSchema remains the owner.",
      "Provider session summary reads .ralph/provider-session-checkpoint.json for selected-task handoff only; it is not scheduler or lifecycle truth.",
      "Accepted artifact audit is sanitized to identity/readiness fields and does not include raw spec content.",
      "Visual evidence policy is sanitized from runner init readiness and does not expose raw runtime config.",
      "Visual Workbench manifest readiness is sanitized to project class/readiness fields and does not include raw stories or raw manifest content.",
      "Visual Workbench selected-task readiness is a readback for manual story-selection handoff only; it is not screenshot proof or screenshot availability.",
      "Visual Workbench automation readback is compact production iteration telemetry only; Arena screenshot availability still comes from Arena visual evidence readback.",
      "Remote source freshness remains unchecked by this local snapshot.",
    ],
  };
}

async function readAcceptedArtifactAudit(
  ctx: ArenaCtlContext,
  projectId: string,
): Promise<{ ok: true; value: unknown } | { ok: false; error: string }> {
  try {
    return { ok: true, value: await ctx.governance.getProjectSpecArtifactAudit(projectId) };
  } catch (error) {
    return { ok: false, error: toErrorMessage(error) };
  }
}

async function readWorkspaceTextFile(
  workspacePath: string,
  relativePath: string,
): Promise<WorkspaceTextFile> {
  const absolutePath = path.resolve(workspacePath, relativePath);
  const workspaceRoot = path.resolve(workspacePath);
  if (!isPathInside(absolutePath, workspaceRoot)) {
    return {
      status: "invalid",
      path: absolutePath,
      reason: "Resolved path escaped the workspace root.",
    };
  }

  try {
    return {
      status: "ready",
      path: absolutePath,
      content: await readFile(absolutePath, "utf8"),
    };
  } catch (error) {
    const code = readErrorCode(error);
    if (code === "ENOENT") {
      return {
        status: "missing",
        path: absolutePath,
        reason: `${relativePath} is not present in the current workspace.`,
      };
    }
    return {
      status: "invalid",
      path: absolutePath,
      reason: toErrorMessage(error),
    };
  }
}

function buildPlanSnapshot(file: WorkspaceTextFile, selectedTaskId: string | null): PlanSnapshot {
  if (file.status === "unavailable") {
    return unavailablePlanSnapshot(file.path, "workspace_unavailable", [file.reason]);
  }
  if (file.status === "missing") {
    return unavailablePlanSnapshot(file.path, "plan_missing", [file.reason], "missing");
  }
  if (file.status === "invalid") {
    return unavailablePlanSnapshot(file.path, "plan_unreadable", [file.reason], "invalid");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(file.content);
  } catch (error) {
    return unavailablePlanSnapshot(file.path, "plan_invalid", [toErrorMessage(error)], "invalid");
  }

  const plan = readRecord(parsed);
  if (!plan) {
    return unavailablePlanSnapshot(file.path, "plan_invalid", ["Plan JSON root is not an object."], "invalid");
  }

  const ownerShapeErrors = validatePlanOwnerShape(plan);
  if (ownerShapeErrors.length > 0) {
    return unavailablePlanSnapshot(file.path, "plan_invalid", ownerShapeErrors, "invalid");
  }

  const phases = Array.isArray(plan.phases) ? plan.phases.map(readRecord).filter(isRecord) : [];
  const allTasks = phases.flatMap((phase) => {
    const tasks = Array.isArray(phase.tasks) ? phase.tasks : [];
    return tasks.map(readRecord).filter(isRecord);
  });
  const warnings: string[] = [];
  const taskCounts: PlanSnapshot["taskCounts"] = {
    pending: 0,
    in_progress: 0,
    completed: 0,
    failed: 0,
    skipped: 0,
    unknown: 0,
    total: allTasks.length,
  };

  for (const task of allTasks) {
    const status = readTaskStatus(task, warnings, readString(task.id));
    if (status.known) taskCounts[status.value] += 1;
    else taskCounts.unknown += 1;
  }

  const selectedTask = selectedTaskId
    ? allTasks.find((task) => readString(task.id) === selectedTaskId) ?? null
    : null;
  const blockers = [
    ...(!selectedTaskId ? ["task_id_not_selected"] : []),
    ...(selectedTaskId && !selectedTask ? ["selected_task_not_found"] : []),
  ];
  const taskCandidates = summarizeTaskCandidates(allTasks, warnings);

  return {
    owner: "@arena/ralph-runtime:PlanSchema",
    path: file.path,
    status: "ready",
    reasonCode: selectedTaskId && !selectedTask
      ? "selected_task_not_found"
      : !selectedTaskId
        ? "task_id_not_selected"
        : null,
    schemaOwner: "@arena/ralph-runtime",
    version: readNumber(plan.version),
    specFile: readString(plan.specFile),
    specHash: readString(plan.specHash),
    createdAt: readString(plan.createdAt),
    updatedAt: readString(plan.updatedAt),
    phaseCount: phases.length,
    judgmentCount: Array.isArray(plan.judgments) ? plan.judgments.length : 0,
    specMigrationCount: Array.isArray(plan.specMigrations) ? plan.specMigrations.length : 0,
    taskCounts,
    taskCandidates,
    selectedTask: selectedTask ? summarizeSelectedTask(selectedTask, warnings) : null,
    blockers,
    warnings: [...new Set(warnings)],
  };
}

function unavailablePlanSnapshot(
  filePath: string | null,
  reasonCode: Exclude<PlanSnapshot["reasonCode"], null | "task_id_not_selected" | "selected_task_not_found">,
  blockers: string[],
  status: "missing" | "invalid" | "unavailable" = "unavailable",
): PlanSnapshot {
  return {
    owner: "@arena/ralph-runtime:PlanSchema",
    path: filePath,
    status,
    reasonCode,
    schemaOwner: "@arena/ralph-runtime",
    version: null,
    specFile: null,
    specHash: null,
    createdAt: null,
    updatedAt: null,
    phaseCount: null,
    judgmentCount: null,
    specMigrationCount: null,
    taskCounts: {
      pending: 0,
      in_progress: 0,
      completed: 0,
      failed: 0,
      skipped: 0,
      unknown: 0,
      total: 0,
    },
    taskCandidates: [],
    selectedTask: null,
    blockers,
    warnings: [],
  };
}

function summarizeTaskCandidates(tasks: JsonRecord[], warnings: string[]): TaskCandidateSnapshot[] {
  return tasks.flatMap((task): TaskCandidateSnapshot[] => {
    const taskId = readString(task.id);
    if (!taskId) return [];
    const status = readTaskStatus(task, warnings, taskId);
    if (!status.known) return [];
    if (!isExecutorCandidateTaskStatus(status.value)) return [];
    const recommendedExecutorMode = executorModeForCandidateStatus(status.value);

    return [{
      id: taskId,
      displayTitle: readString(task.displayTitle),
      status: status.value,
      statusSource: status.source,
      attempts: readNumber(task.attempts),
      lastError: readString(task.lastError),
      requiredRolePasses: readStringArray(task.requiredRolePasses),
      visualEvidenceRequired: readBoolean(task.visualEvidenceRequired),
      feedbackItemRefCount: Array.isArray(task.feedbackItemRefs) ? task.feedbackItemRefs.length : 0,
      recommendedExecutorMode,
    }];
  });
}

function isExecutorCandidateTaskStatus(status: KnownTaskStatus): status is ExecutorCandidateTaskStatus {
  return status === "pending" || status === "failed" || status === "in_progress";
}

function executorModeForCandidateStatus(status: ExecutorCandidateTaskStatus): TaskCandidateSnapshot["recommendedExecutorMode"] {
  if (status === "pending") return "new_task";
  if (status === "failed") return "failed_task";
  return "resume_interrupted";
}

function isDoneTaskStatus(status: KnownTaskStatus | "unknown"): boolean {
  return status === "completed" || status === "skipped";
}

function summarizeSelectedTask(task: JsonRecord, warnings: string[]): SelectedTaskSnapshot {
  const taskId = readString(task.id) ?? "unknown-task";
  const status = readTaskStatus(task, warnings, taskId);
  const selectedStatus = status.known ? status.value : "unknown";
  const evidence = Array.isArray(task.verificationEvidence)
    ? task.verificationEvidence.map(readRecord).filter(isRecord)
    : [];

  return {
    id: taskId,
    displayTitle: readString(task.displayTitle),
    description: readString(task.description),
    acceptanceCriteria: readStringArray(task.acceptanceCriteria),
    status: selectedStatus,
    statusSource: status.source,
    attempts: readNumber(task.attempts),
    lastError: isDoneTaskStatus(selectedStatus) ? null : readString(task.lastError),
    requiredRolePasses: readStringArray(task.requiredRolePasses),
    visualEvidenceRequired: readBoolean(task.visualEvidenceRequired),
    feedbackItemRefs: summarizeFeedbackItemRefs(task.feedbackItemRefs),
    verificationEvidence: {
      total: evidence.length,
      screenshot: evidence.filter((entry) => readString(entry.kind) === "screenshot").length,
      pass: evidence.filter((entry) => readString(entry.result) === "pass").length,
      fail: evidence.filter((entry) => readString(entry.result) === "fail").length,
      inconclusive: evidence.filter((entry) => readString(entry.result) === "inconclusive").length,
    },
  };
}

function readTaskStatus(task: JsonRecord, warnings: string[], taskId: string | null): (
  | { known: true; value: KnownTaskStatus; source: "explicit" | "plan_schema_default" }
  | { known: false; source: "unsupported" }
) {
  const rawStatus = readString(task.status);
  if (!rawStatus) {
    if (taskId) {
      warnings.push(`task ${taskId} has no explicit status; counted as PlanSchema default pending for summary only`);
    }
    return { known: true, value: "pending", source: "plan_schema_default" };
  }
  if (isKnownTaskStatus(rawStatus)) {
    return { known: true, value: rawStatus, source: "explicit" };
  }
  if (taskId) warnings.push(`task ${taskId} has unsupported status ${rawStatus}`);
  return { known: false, source: "unsupported" };
}

function validatePlanOwnerShape(plan: JsonRecord): string[] {
  const errors: string[] = [];
  if (typeof plan.specFile !== "string" || !plan.specFile.trim()) {
    errors.push("PlanSchema requires non-empty specFile.");
  }
  if (typeof plan.createdAt !== "string" || !plan.createdAt.trim()) {
    errors.push("PlanSchema requires non-empty createdAt.");
  }
  if (typeof plan.updatedAt !== "string" || !plan.updatedAt.trim()) {
    errors.push("PlanSchema requires non-empty updatedAt.");
  }
  if (!Array.isArray(plan.phases)) {
    errors.push("PlanSchema requires phases array.");
    return errors;
  }

  plan.phases.forEach((phaseValue, phaseIndex) => {
    const phase = readRecord(phaseValue);
    if (!phase) {
      errors.push(`PlanSchema phase ${phaseIndex} must be an object.`);
      return;
    }
    if (typeof phase.id !== "string" || !phase.id.trim()) {
      errors.push(`PlanSchema phase ${phaseIndex} requires non-empty id.`);
    }
    if (typeof phase.name !== "string" || !phase.name.trim()) {
      errors.push(`PlanSchema phase ${phaseIndex} requires non-empty name.`);
    }
    if (typeof phase.description !== "string") {
      errors.push(`PlanSchema phase ${phaseIndex} requires description string.`);
    }
    if (!isCoercibleNumber(phase.order)) {
      errors.push(`PlanSchema phase ${phaseIndex} requires numeric order.`);
    }
    if (!Array.isArray(phase.tasks)) {
      errors.push(`PlanSchema phase ${phaseIndex} requires tasks array.`);
      return;
    }

    phase.tasks.forEach((taskValue, taskIndex) => {
      const task = readRecord(taskValue);
      const taskLabel = `phase ${phaseIndex} task ${taskIndex}`;
      if (!task) {
        errors.push(`PlanSchema ${taskLabel} must be an object.`);
        return;
      }
      const id = readString(task.id);
      if (!id || !TASK_ID_PATTERN.test(id)) {
        errors.push(`PlanSchema ${taskLabel} requires a path-safe id.`);
      }
      if (typeof task.description !== "string") {
        errors.push(`PlanSchema ${taskLabel} requires description string.`);
      }
      if (!Array.isArray(task.acceptanceCriteria) || task.acceptanceCriteria.some((entry) => typeof entry !== "string")) {
        errors.push(`PlanSchema ${taskLabel} requires acceptanceCriteria string array.`);
      }
      const status = readString(task.status);
      if (status && !isKnownTaskStatus(status)) {
        errors.push(`PlanSchema ${taskLabel} has unsupported status ${status}.`);
      }
      if (task.attempts !== undefined && !isCoercibleNumber(task.attempts)) {
        errors.push(`PlanSchema ${taskLabel} attempts must be numeric when present.`);
      }
    });
  });

  return [...new Set(errors)];
}

function isCoercibleNumber(value: unknown): boolean {
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value === "string" && value.trim()) return Number.isFinite(Number(value));
  return false;
}

function summarizeFeedbackItemRefs(value: unknown): SelectedTaskSnapshot["feedbackItemRefs"] {
  if (!Array.isArray(value)) return [];
  return value.map(readRecord).filter(isRecord).map((entry) => ({
    itemId: readString(entry.itemId),
    diffItemId: readString(entry.diffItemId),
    workSurface: readString(entry.workSurface),
    workImpact: readString(entry.workImpact),
    summary: readString(entry.summary),
  }));
}

function buildProviderSessionSnapshot(
  file: WorkspaceTextFile,
  selectedTaskId: string | null,
  selectedTaskStatus: SelectedTaskSnapshot["status"] | null,
): ProviderSessionSnapshot {
  if (file.status === "unavailable") {
    return unavailableProviderSessionSnapshot(file.path, "workspace_unavailable", [file.reason], {
      selectedTaskId,
      selectedTaskStatus,
    });
  }
  if (file.status === "missing") {
    return unavailableProviderSessionSnapshot(file.path, "checkpoint_missing", [file.reason], {
      selectedTaskId,
      selectedTaskStatus,
      status: "missing",
    });
  }
  if (file.status === "invalid") {
    return unavailableProviderSessionSnapshot(file.path, "checkpoint_unreadable", [file.reason], {
      selectedTaskId,
      selectedTaskStatus,
      status: "invalid",
    });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(file.content);
  } catch (error) {
    return unavailableProviderSessionSnapshot(file.path, "checkpoint_invalid", [toErrorMessage(error)], {
      selectedTaskId,
      selectedTaskStatus,
      status: "invalid",
    });
  }

  const parseResult = parseProviderSessions(parsed);
  if (!parseResult.ok) {
    return unavailableProviderSessionSnapshot(file.path, "checkpoint_invalid", parseResult.errors, {
      selectedTaskId,
      selectedTaskStatus,
      status: "invalid",
    });
  }

  const selectedSessions = selectedTaskId
    ? parseResult.sessions
      .filter((session) => session.taskId === selectedTaskId)
      .sort(compareProviderSessionsDesc)
      .slice(0, 5)
    : [];
  const selectedTaskSessionCount = selectedTaskId
    ? parseResult.sessions.filter((session) => session.taskId === selectedTaskId).length
    : null;
  const selectedTaskResumableSessionCount = selectedTaskId
    ? selectedSessions.filter(isProviderSessionSummaryResumable).length
    : null;
  const selectedTaskCheckpointReadback = buildProviderSessionSelectedTaskCheckpointReadback({
    selectedTaskId,
    selectedTaskStatus,
    providerSessionStatus: "ready",
    selectedTaskSessionCount,
    selectedTaskResumableSessionCount,
  });

  return {
    owner: "@arena/ralph-runtime:ProviderSessionCheckpointStore",
    path: file.path,
    status: "ready",
    reasonCode: selectedTaskId ? null : "task_id_not_selected",
    sessionCount: parseResult.sessions.length,
    selectedTaskSessionCount,
    selectedTaskResumableSessionCount,
    selectedTaskSessions: selectedSessions,
    selectedTaskCheckpointReadback,
    blockers: selectedTaskId ? [] : ["task_id_not_selected"],
    warnings: parseResult.warnings,
  };
}

function buildProviderSessionSelectedTaskCheckpointReadback(input: {
  selectedTaskId: string | null;
  selectedTaskStatus: SelectedTaskSnapshot["status"] | null;
  providerSessionStatus: ProviderSessionStatus | null;
  selectedTaskSessionCount: number | null;
  selectedTaskResumableSessionCount: number | null;
}): ProviderSessionSelectedTaskCheckpointReadback {
  const recommendedExecutorMode = input.selectedTaskStatus
    && input.selectedTaskStatus !== "unknown"
    && isExecutorCandidateTaskStatus(input.selectedTaskStatus)
    ? executorModeForCandidateStatus(input.selectedTaskStatus)
    : null;
  const base = {
    selectedTaskId: input.selectedTaskId,
    selectedTaskStatus: input.selectedTaskStatus,
    recommendedExecutorMode,
    providerSessionStatus: input.providerSessionStatus,
    selectedTaskSessionCount: input.selectedTaskSessionCount,
    selectedTaskResumableSessionCount: input.selectedTaskResumableSessionCount,
  };

  if (!input.selectedTaskId) {
    return {
      ...base,
      nextProjectActionId: null,
      status: "not_selected",
      tone: "neutral",
      reasonCode: "task_id_not_selected",
      title: "No task selected",
      message: "Snapshot must be rerun with one task id before executor input can be prepared.",
      canPrepareExecutor: false,
    };
  }

  if (!recommendedExecutorMode) {
    return {
      ...base,
      nextProjectActionId: null,
      status: "not_executor_candidate",
      tone: "warn",
      reasonCode: "not_executor_candidate",
      title: "Task is not executor-ready",
      message: `Selected task status ${input.selectedTaskStatus ?? "unknown"} is not a pending, failed or interrupted executor candidate.`,
      canPrepareExecutor: false,
    };
  }

  if (recommendedExecutorMode !== "resume_interrupted") {
    return {
      ...base,
      nextProjectActionId: null,
      status: "not_checkpoint_gated",
      tone: "good",
      reasonCode: "not_checkpoint_gated",
      title: "Executor input can be prepared",
      message: "Pending and failed tasks are not checkpoint-gated. Executor will still create a fresh snapshot before running.",
      canPrepareExecutor: true,
    };
  }

  if (input.providerSessionStatus !== "ready") {
    return {
      ...base,
      nextProjectActionId: null,
      status: "checkpoint_blocked",
      tone: "warn",
      reasonCode: "checkpoint_unavailable",
      title: "Checkpoint required before resume",
      message: `Provider-session checkpoint is ${input.providerSessionStatus ?? "unavailable"}. Resume will block before provider creation.`,
      canPrepareExecutor: false,
    };
  }

  if (input.selectedTaskSessionCount === null || input.selectedTaskSessionCount <= 0) {
    return {
      ...base,
      nextProjectActionId: null,
      status: "checkpoint_blocked",
      tone: "warn",
      reasonCode: "no_selected_task_session",
      title: "Checkpoint required before resume",
      message: "Snapshot found no provider-session history for this interrupted task. Resume will block before provider creation.",
      canPrepareExecutor: false,
    };
  }

  if (input.selectedTaskResumableSessionCount !== null && input.selectedTaskResumableSessionCount > 0) {
    return {
      ...base,
      nextProjectActionId: null,
      status: "checkpoint_ready",
      tone: "good",
      reasonCode: "failed_error_checkpoint_ready",
      title: "Checkpoint readback is ready",
      message: "Snapshot found a failed/error provider-session checkpoint for this interrupted task. Executor will still validate agent, model and task fingerprint before resume.",
      canPrepareExecutor: true,
    };
  }

  return {
    ...base,
    nextProjectActionId: "resume_agent",
    status: "checkpoint_blocked",
    tone: "warn",
    reasonCode: "success_checkpoint_not_resumable",
    title: "Use Resume agent, not checkpoint resume",
    message:
      "Snapshot found provider-session history, but no failed/error checkpoint for this interrupted task. A successful checkpoint is evidence, not resumable work. Select Resume agent to continue through the normal Ralph claim path.",
    canPrepareExecutor: false,
  };
}

function unavailableProviderSessionSnapshot(
  filePath: string | null,
  reasonCode: Exclude<ProviderSessionSnapshot["reasonCode"], null | "task_id_not_selected">,
  blockers: string[],
  options?: {
    selectedTaskId?: string | null;
    selectedTaskStatus?: SelectedTaskSnapshot["status"] | null;
    status?: "missing" | "invalid" | "unavailable";
  },
): ProviderSessionSnapshot {
  const status = options?.status ?? "unavailable";
  return {
    owner: "@arena/ralph-runtime:ProviderSessionCheckpointStore",
    path: filePath,
    status,
    reasonCode,
    sessionCount: null,
    selectedTaskSessionCount: null,
    selectedTaskResumableSessionCount: null,
    selectedTaskSessions: [],
    selectedTaskCheckpointReadback: buildProviderSessionSelectedTaskCheckpointReadback({
      selectedTaskId: options?.selectedTaskId ?? null,
      selectedTaskStatus: options?.selectedTaskStatus ?? null,
      providerSessionStatus: status,
      selectedTaskSessionCount: null,
      selectedTaskResumableSessionCount: null,
    }),
    blockers,
    warnings: [],
  };
}

function parseProviderSessions(value: unknown): (
  | { ok: true; sessions: ProviderSessionSummary[]; warnings: string[] }
  | { ok: false; errors: string[] }
) {
  const root = readRecord(value);
  if (!root) return { ok: false, errors: ["Checkpoint JSON root is not an object."] };

  const warnings: string[] = [];
  if (root.version === 2) {
    if (!Array.isArray(root.sessions)) {
      return { ok: false, errors: ["Checkpoint version 2 has no sessions array."] };
    }
    const sessions = root.sessions
      .map((entry, index) => parseProviderSession(entry, warnings, index))
      .filter((entry): entry is ProviderSessionSummary => entry !== null);
    return { ok: true, sessions, warnings: [...new Set(warnings)] };
  }

  if (root.version === 1) {
    const legacy = parseProviderSession({
      ...root,
      reason: root.reason === "rate_limit" ? "rate_limit" : "task_attempt",
      outcome: "error",
      errorCategory: root.reason === "rate_limit" ? "rate_limit" : root.errorCategory,
    }, warnings, 0);
    return { ok: true, sessions: legacy ? [legacy] : [], warnings: [...new Set(warnings)] };
  }

  return { ok: false, errors: ["Unsupported provider session checkpoint version."] };
}

function parseProviderSession(
  value: unknown,
  warnings: string[],
  index: number,
): ProviderSessionSummary | null {
  const entry = readRecord(value);
  if (!entry) {
    warnings.push(`session ${index} ignored because it is not an object`);
    return null;
  }

  const agent = readString(entry.agent);
  const taskId = readString(entry.taskId);
  const taskFingerprint = readString(entry.taskFingerprint);
  const sessionId = readString(entry.sessionId);
  const updatedAt = readString(entry.updatedAt);
  const outcome = readString(entry.outcome);
  if (!agent || !taskId || !taskFingerprint || !sessionId || !updatedAt) {
    warnings.push(`session ${index} ignored because required identity fields are missing`);
    return null;
  }
  if (outcome !== "success" && outcome !== "error") {
    warnings.push(`session ${index} ignored because outcome is unsupported`);
    return null;
  }

  const reason = readString(entry.reason);
  return {
    agent,
    model: readString(entry.model),
    taskId,
    taskFingerprint,
    specHash: readString(entry.specHash),
    sessionId,
    reason: reason === "rate_limit" ? "rate_limit" : "task_attempt",
    outcome,
    errorCategory: readString(entry.errorCategory),
    resumedFrom: readString(entry.resumedFrom),
    resumeFallbackReason: readString(entry.resumeFallbackReason),
    updatedAt,
  };
}

function compareProviderSessionsDesc(left: ProviderSessionSummary, right: ProviderSessionSummary): number {
  const rightTime = Date.parse(right.updatedAt);
  const leftTime = Date.parse(left.updatedAt);
  if (Number.isFinite(rightTime) && Number.isFinite(leftTime)) {
    return rightTime - leftTime;
  }
  return right.updatedAt.localeCompare(left.updatedAt);
}

function sanitizeAcceptedArtifactAudit(
  result: { ok: true; value: unknown } | { ok: false; error: string },
): SanitizedAcceptedArtifactAudit {
  if (!result.ok) {
    return emptyAcceptedArtifactAudit(false, result.error);
  }
  const audit = readRecord(result.value);
  if (!audit) return emptyAcceptedArtifactAudit(false, "Accepted artifact audit was empty.");
  const latestSpec = readRecord(audit.latestSpec);

  return {
    available: true,
    projectId: readString(audit.projectId),
    projectName: readString(audit.projectName),
    classification: readString(audit.classification),
    runnerReady: readBoolean(audit.runnerReady),
    storageMode: readString(audit.storageMode),
    latestSpec: {
      specId: readString(latestSpec?.specId),
      specVersionId: readString(latestSpec?.specVersionId),
      version: readNumber(latestSpec?.version),
      sourceProjectId: readString(latestSpec?.sourceProjectId),
      sourceVersion: readNumber(latestSpec?.sourceVersion),
      metadataHash: readString(latestSpec?.metadataHash),
    },
    recommendedNextAction: readString(audit.recommendedNextAction),
    allowedActions: readStringArray(audit.allowedActions),
    why: readStringArray(audit.why),
    operatorNotes: readStringArray(audit.operatorNotes),
    error: null,
  };
}

function emptyAcceptedArtifactAudit(available: boolean, error: string | null): SanitizedAcceptedArtifactAudit {
  return {
    available,
    projectId: null,
    projectName: null,
    classification: null,
    runnerReady: null,
    storageMode: null,
    latestSpec: {
      specId: null,
      specVersionId: null,
      version: null,
      sourceProjectId: null,
      sourceVersion: null,
      metadataHash: null,
    },
    recommendedNextAction: null,
    allowedActions: [],
    why: [],
    operatorNotes: [],
    error,
  };
}

function sanitizeVisualWorkbenchManifestReadiness(
  readiness: ProjectExperimentPreflight["visualWorkbenchManifestReadiness"],
): SanitizedVisualWorkbenchManifestReadiness {
  return {
    available: readiness.available === true,
    status: readiness.status ?? null,
    canRunWorkbenchCapture: readiness.canRunWorkbenchCapture === true,
    schemaVersion: readString(readiness.schemaVersion),
    projectClass: readString(readiness.projectClass),
    blockers: readStringArray(readiness.blockers),
    unknowns: readStringArray(readiness.unknowns),
  };
}

function sanitizeVisualEvidencePolicy(
  initReadiness: ProjectExperimentPreflight["initReadiness"],
): SanitizedVisualEvidencePolicy {
  const ralphConfig = readRecord(initReadiness.ralphConfig);
  const visualEvidenceMode = readString(ralphConfig?.visualEvidenceMode);
  const visualEvidenceModeError = readString(ralphConfig?.visualEvidenceModeError);
  if (!ralphConfig) {
    return {
      owner: "governance.runner-init-readiness.ralphConfig",
      status: "unavailable",
      visualEvidenceMode: null,
      blockers: ["runner_init_ralph_config_unavailable"],
      notes: ["Runner init readiness did not expose sanitized Ralph config."],
    };
  }
  if (!isProjectVisualEvidenceMode(visualEvidenceMode)) {
    return {
      owner: "governance.runner-init-readiness.ralphConfig",
      status: "invalid",
      visualEvidenceMode: null,
      blockers: ["runner_init_visual_evidence_mode_invalid"],
      notes: [
        `visualEvidenceMode=${visualEvidenceMode ?? "missing"}`,
        ...(visualEvidenceModeError ? [`visualEvidenceModeError=${visualEvidenceModeError}`] : []),
      ],
    };
  }
  return {
    owner: "governance.runner-init-readiness.ralphConfig",
    status: "ready",
    visualEvidenceMode,
    blockers: [],
    notes: [`visualEvidenceMode=${visualEvidenceMode}`],
  };
}

function buildSelectedTaskVisualReadback(input: {
  selectedTaskId: string | null;
  selectedTask: SelectedTaskSnapshot | null;
  visualEvidencePolicy: SanitizedVisualEvidencePolicy;
  visualWorkbenchManifestReadiness: SanitizedVisualWorkbenchManifestReadiness;
}): SelectedTaskVisualReadback {
  const visualExpectationSources = input.selectedTask
    ? getSelectedTaskVisualExpectationSources(input.selectedTask)
    : [];
  const base = {
    selectedTaskId: input.selectedTaskId,
    selectedTaskStatus: input.selectedTask?.status ?? null,
    visualEvidenceRequired: input.selectedTask?.visualEvidenceRequired ?? null,
    visualEvidenceMode: input.visualEvidencePolicy.visualEvidenceMode,
    visualEvidencePolicyStatus: input.visualEvidencePolicy.status,
    visualWorkbenchManifestStatus: input.visualWorkbenchManifestReadiness.status,
    canRunWorkbenchCapture: input.visualWorkbenchManifestReadiness.canRunWorkbenchCapture,
    visualExpectationSources,
  };

  if (!input.selectedTaskId) {
    return {
      ...base,
      nextProjectActionId: null,
      status: "not_selected",
      tone: "neutral",
      reasonCode: "task_id_not_selected",
      title: "No task selected",
      message: "Run Get task context with one task id before checking story selection.",
      canCheckStorySelection: false,
    };
  }

  if (!input.selectedTask) {
    return {
      ...base,
      nextProjectActionId: null,
      status: "check_story_selection_blocked",
      tone: "warn",
      reasonCode: "selected_task_not_found",
      title: "Selected task was not found",
      message: "Story selection needs a selected task from the Project Stage Snapshot plan readback.",
      canCheckStorySelection: false,
    };
  }

  if (input.visualEvidencePolicy.status === "unavailable") {
    return {
      ...base,
      nextProjectActionId: null,
      status: "check_story_selection_blocked",
      tone: "warn",
      reasonCode: "visual_policy_unavailable",
      title: "Visual policy unavailable",
      message: "Runner init readiness did not expose the selected project's visualEvidenceMode.",
      canCheckStorySelection: false,
    };
  }

  if (input.visualEvidencePolicy.status === "invalid") {
    return {
      ...base,
      nextProjectActionId: null,
      status: "check_story_selection_blocked",
      tone: "warn",
      reasonCode: "visual_policy_invalid",
      title: "Visual policy invalid",
      message: "Selected project visualEvidenceMode is malformed; story selection must not use a UI-local fallback.",
      canCheckStorySelection: false,
    };
  }

  if (input.visualEvidencePolicy.visualEvidenceMode === "off") {
    return {
      ...base,
      nextProjectActionId: null,
      status: "not_applicable",
      tone: "neutral",
      reasonCode: "visual_evidence_mode_off",
      title: "Visual evidence is off",
      message: "The selected project policy is off, so Lab should not route this task into story-selection checks.",
      canCheckStorySelection: false,
    };
  }

  if (!selectedTaskNeedsVisualWorkbench(input.selectedTask, input.visualEvidencePolicy.visualEvidenceMode)) {
    return {
      ...base,
      nextProjectActionId: null,
      status: "not_applicable",
      tone: "neutral",
      reasonCode: "visual_evidence_not_required_for_task",
      title: "Story selection not expected",
      message: "The selected task is not marked as visual work under the current project visual evidence policy.",
      canCheckStorySelection: false,
    };
  }

  if (!input.visualWorkbenchManifestReadiness.available) {
    return {
      ...base,
      nextProjectActionId: null,
      status: "check_story_selection_blocked",
      tone: "warn",
      reasonCode: "visual_manifest_unavailable",
      title: "Visual Workbench manifest unavailable",
      message: "Story selection needs the source-owned Visual Workbench manifest readback before it can run.",
      canCheckStorySelection: false,
    };
  }

  if (
    input.visualWorkbenchManifestReadiness.status !== "ready"
    || input.visualWorkbenchManifestReadiness.canRunWorkbenchCapture !== true
  ) {
    return {
      ...base,
      nextProjectActionId: null,
      status: "check_story_selection_blocked",
      tone: "warn",
      reasonCode: "visual_manifest_not_ready",
      title: "Visual Workbench stories are not ready",
      message: "Manifest readiness is not ready, so selector readiness should stay blocked.",
      canCheckStorySelection: false,
    };
  }

  return {
    ...base,
    nextProjectActionId: "check_story_selection",
    status: "check_story_selection_ready",
    tone: "good",
    reasonCode: "check_story_selection_ready",
    title: "Story selection can be checked",
    message: "This only selects Check story selection for the same task. It does not capture screenshots or create evidence.",
    canCheckStorySelection: true,
  };
}

function selectedTaskNeedsVisualWorkbench(
  task: SelectedTaskSnapshot,
  visualEvidenceMode: ProjectVisualEvidenceMode | null,
): boolean {
  if (visualEvidenceMode === "off" || !visualEvidenceMode) return false;
  if (task.visualEvidenceRequired === true) return true;
  if (visualEvidenceMode === "new_tasks_only") return false;
  return getSelectedTaskVisualExpectationSources(task).length > 0;
}

function getSelectedTaskVisualExpectationSources(task: SelectedTaskSnapshot): string[] {
  const sources: string[] = [];
  if (task.visualEvidenceRequired === true) {
    sources.push("task.visualEvidenceRequired");
  }
  if (task.requiredRolePasses.includes("ux")) {
    sources.push("task.requiredRolePasses.ux");
  }
  if (task.feedbackItemRefs.some((ref) => ref.workSurface === "frontend")) {
    sources.push("task.feedbackItemRefs.workSurface.frontend");
  }
  return sources;
}

function buildSelectedTaskWorkbenchAutomationReadback(input: {
  file: WorkspaceTextFile;
  selectedTaskId: string | null;
}): SelectedTaskWorkbenchAutomationReadback {
  const base = {
    owner: "@arena/ralph-runtime:IterationLog.visualWorkbenchAutomation" as const,
    selectedTaskId: input.selectedTaskId,
    path: input.file.path,
    automation: null,
  };

  if (!input.selectedTaskId) {
    return {
      ...base,
      iterationLogStatus: ownerReadStatus(input.file.status),
      status: "not_selected",
      tone: "neutral",
      reasonCode: "task_id_not_selected",
      title: "No task selected",
      message: "Select a task before reading production Workbench automation telemetry.",
    };
  }
  if (input.file.status === "unavailable") {
    return {
      ...base,
      iterationLogStatus: "unavailable",
      status: "missing",
      tone: "neutral",
      reasonCode: "iteration_log_unavailable",
      title: "Iteration log is unavailable",
      message: input.file.reason,
    };
  }
  if (input.file.status === "missing") {
    return {
      ...base,
      iterationLogStatus: "missing",
      status: "missing",
      tone: "neutral",
      reasonCode: "iteration_log_missing",
      title: "No Workbench automation telemetry yet",
      message: "The project has no .ralph/iteration-log.json readback for this selected task.",
    };
  }
  if (input.file.status === "invalid") {
    return {
      ...base,
      iterationLogStatus: "invalid",
      status: "invalid",
      tone: "warn",
      reasonCode: "iteration_log_invalid",
      title: "Iteration log could not be read",
      message: input.file.reason,
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(input.file.content);
  } catch (error) {
    return {
      ...base,
      iterationLogStatus: "invalid",
      status: "invalid",
      tone: "warn",
      reasonCode: "iteration_log_invalid",
      title: "Iteration log JSON is invalid",
      message: toErrorMessage(error),
    };
  }
  if (!Array.isArray(parsed)) {
    return {
      ...base,
      iterationLogStatus: "invalid",
      status: "invalid",
      tone: "warn",
      reasonCode: "iteration_log_invalid",
      title: "Iteration log shape is invalid",
      message: "Iteration log root must be an array.",
    };
  }

  for (let index = parsed.length - 1; index >= 0; index -= 1) {
    const entry = readRecord(parsed[index]);
    if (!entry || readString(entry.taskId) !== input.selectedTaskId) continue;
    const automation = readRecord(entry.visualWorkbenchAutomation);
    if (!automation || readString(automation.ownerBoundary) !== "ralph.visual-workbench-evidence-automation") continue;
    if (readString(automation.taskId) !== input.selectedTaskId) continue;

    const status = readString(automation.status);
    if (!status) continue;

    return {
      ...base,
      iterationLogStatus: "ready",
      status: "ready",
      tone: "good",
      reasonCode: "selected_task_automation_ready",
      title: "Workbench automation telemetry found",
      message: "Latest production Workbench automation telemetry was found for the selected task. This is not screenshot availability; use Arena screenshot readback for proof review.",
      automation: {
        ownerBoundary: "ralph.visual-workbench-evidence-automation",
        iteration: readNumber(entry.iteration),
        timestamp: readString(entry.timestamp),
        outcome: readString(entry.outcome),
        status,
        sourceRef: readString(automation.sourceRef),
        reportPath: readString(automation.reportPath),
        diagnosticReportPath: readString(automation.diagnosticReportPath),
        selectorStatus: readString(automation.selectorStatus),
        shellPolicyStatus: readString(automation.shellPolicyStatus),
        browserReadinessStatus: readString(automation.browserReadinessStatus),
        captureStatus: readString(automation.captureStatus),
        exportedEvidenceRefs: readNumber(automation.exportedEvidenceRefs),
        publishedRows: readNumber(automation.publishedRows),
        blockers: readStringArray(automation.blockers),
      },
    };
  }

  return {
    ...base,
    iterationLogStatus: "ready",
    status: "not_found",
    tone: "neutral",
    reasonCode: "selected_task_automation_not_found",
    title: "No Workbench automation telemetry for selected task",
    message: "No completed production Workbench automation telemetry was found for this selected task.",
  };
}

function buildOwnerReads(input: {
  preflight: ProjectExperimentPreflight;
  acceptedArtifactAudit: SanitizedAcceptedArtifactAudit;
  visualEvidencePolicy: SanitizedVisualEvidencePolicy;
  visualWorkbenchManifestReadiness: SanitizedVisualWorkbenchManifestReadiness;
  plan: PlanSnapshot;
  providerSessions: ProviderSessionSnapshot;
  selectedTaskWorkbenchAutomationReadback: SelectedTaskWorkbenchAutomationReadback;
}): OwnerRead[] {
  return [
    {
      owner: "arena-ctl.project_experiment_preflight",
      status: "ready",
      notes: [
        `classification=${input.preflight.lifecycleContext.classification}`,
        `recommendedNextAction=${input.preflight.lifecycleContext.recommendedNextAction}`,
      ],
    },
    {
      owner: "governance.accepted-spec-artifact-audit",
      status: input.acceptedArtifactAudit.available ? "ready" : "unavailable",
      notes: input.acceptedArtifactAudit.available
        ? [
          `classification=${input.acceptedArtifactAudit.classification ?? "unknown"}`,
          `runnerReady=${String(input.acceptedArtifactAudit.runnerReady)}`,
        ]
        : [input.acceptedArtifactAudit.error ?? "Accepted artifact audit unavailable."],
    },
    {
      owner: input.visualEvidencePolicy.owner,
      status: ownerReadStatus(input.visualEvidencePolicy.status),
      notes: input.visualEvidencePolicy.notes,
    },
    {
      owner: "arena-ctl.project_experiment_preflight.visualWorkbenchManifestReadiness",
      status: input.visualWorkbenchManifestReadiness.available
        ? ownerReadStatus(input.visualWorkbenchManifestReadiness.status ?? "unavailable")
        : "unavailable",
      notes: [
        `projectClass=${input.visualWorkbenchManifestReadiness.projectClass ?? "unknown"}`,
        `canRunWorkbenchCapture=${String(input.visualWorkbenchManifestReadiness.canRunWorkbenchCapture)}`,
      ],
    },
    {
      owner: input.plan.owner,
      status: ownerReadStatus(input.plan.status),
      notes: [
        `path=${input.plan.path ?? "unavailable"}`,
        `reasonCode=${input.plan.reasonCode ?? "none"}`,
      ],
    },
    {
      owner: input.providerSessions.owner,
      status: ownerReadStatus(input.providerSessions.status),
      notes: [
        `path=${input.providerSessions.path ?? "unavailable"}`,
        `reasonCode=${input.providerSessions.reasonCode ?? "none"}`,
      ],
    },
    {
      owner: input.selectedTaskWorkbenchAutomationReadback.owner,
      status: ownerReadStatus(input.selectedTaskWorkbenchAutomationReadback.iterationLogStatus),
      notes: [
        `path=${input.selectedTaskWorkbenchAutomationReadback.path ?? "unavailable"}`,
        `reasonCode=${input.selectedTaskWorkbenchAutomationReadback.reasonCode}`,
      ],
    },
  ];
}

function ownerReadStatus(status: "ready" | "missing" | "invalid" | "unavailable" | "blocked" | "unknown"): OwnerRead["status"] {
  if (status === "ready") return "ready";
  if (status === "invalid") return "invalid";
  if (status === "missing") return "missing";
  if (status === "blocked") return "blocked";
  return "unavailable";
}

function buildNextHandoff(input: {
  selectedTaskId: string | null;
  plan: PlanSnapshot;
  providerSessions: ProviderSessionSnapshot;
  selectedTaskVisualReadback: SelectedTaskVisualReadback;
  selectedTaskWorkbenchAutomationReadback: SelectedTaskWorkbenchAutomationReadback;
  gitSyncRisk: ProjectExperimentPreflight["gitSyncRisk"];
}): string[] {
  const handoff: string[] = [];
  if (!input.selectedTaskId) {
    handoff.push(input.plan.taskCandidates.length > 0
      ? "Select one plan.taskCandidates[].id as --task-id before executor/controller task experiments."
      : "Select --task-id before executor/controller task experiments.");
  } else if (input.plan.selectedTask) {
    handoff.push("Use this snapshot as read-only input for one future planner/executor/controller stage.");
  }
  if (input.plan.status !== "ready") {
    handoff.push(`Plan owner is not ready: ${input.plan.reasonCode ?? input.plan.status}.`);
  }
  if (input.gitSyncRisk.wouldBlockSync === true) {
    handoff.push("Resolve blocking workspace dirty paths before a forked executor stage.");
  }
  if (input.selectedTaskId && input.plan.selectedTask?.status === "in_progress") {
    if (input.providerSessions.status !== "ready") {
      handoff.push(`Provider session checkpoint is ${input.providerSessions.status}; resume_interrupted will block before provider creation.`);
    } else if (input.providerSessions.selectedTaskSessionCount === 0) {
      handoff.push("No provider session was found for the selected in-progress task; resume_interrupted will block before provider creation.");
    } else if (input.providerSessions.selectedTaskCheckpointReadback.reasonCode === "success_checkpoint_not_resumable") {
      handoff.push(input.providerSessions.selectedTaskCheckpointReadback.message);
    } else if (input.providerSessions.selectedTaskResumableSessionCount === 0) {
      handoff.push("Provider session history for the selected in-progress task has no failed/error checkpoint; resume_interrupted will block before provider creation.");
    }
  } else if (input.providerSessions.status === "ready" && input.providerSessions.selectedTaskSessionCount === 0 && input.selectedTaskId) {
    handoff.push("No provider session was found for the selected task; failed/resume experiments may need a new-task mode.");
  }
  if (input.selectedTaskVisualReadback.canCheckStorySelection) {
    handoff.push(input.selectedTaskVisualReadback.message);
  } else if (
    input.selectedTaskId
    && input.selectedTaskVisualReadback.reasonCode !== "visual_evidence_not_required_for_task"
    && input.selectedTaskVisualReadback.reasonCode !== "visual_evidence_mode_off"
  ) {
    handoff.push(`Visual story selection is not ready: ${input.selectedTaskVisualReadback.reasonCode}.`);
  }
  if (input.selectedTaskWorkbenchAutomationReadback.status === "ready") {
    handoff.push(input.selectedTaskWorkbenchAutomationReadback.message);
  }
  if (handoff.length === 0) {
    handoff.push("Snapshot is ready for the next explicit manual stage.");
  }
  return handoff;
}

function readRecord(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : null;
}

function isProviderSessionSummaryResumable(session: ProviderSessionSummary): boolean {
  return session.outcome === "error" && session.sessionId.trim().length > 0;
}

function isRecord(value: JsonRecord | null): value is JsonRecord {
  return value !== null;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0);
}

function isKnownTaskStatus(value: string): value is KnownTaskStatus {
  return (KNOWN_TASK_STATUSES as readonly string[]).includes(value);
}

function isProjectVisualEvidenceMode(value: string | null): value is ProjectVisualEvidenceMode {
  return value === "off" || value === "required" || value === "new_tasks_only";
}

function isPathInside(candidate: string, base: string) {
  return candidate === base || candidate.startsWith(`${base}${path.sep}`);
}

function readErrorCode(error: unknown): string | null {
  return readString(readRecord(error)?.code);
}
