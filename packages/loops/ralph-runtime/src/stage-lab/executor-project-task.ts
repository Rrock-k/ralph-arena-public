import { dirname, resolve } from 'node:path';
import fs from 'fs-extra';
import { z } from 'zod';
import type { Agent } from '../agents/base.js';
import {
  buildProviderSessionTaskFingerprint,
  isProviderSessionResumable,
} from '../agents/provider-session-checkpoint.js';
import {
  TaskSchema,
  type Task,
  type VisualEvidenceMode,
} from '../config/types.js';
import { buildExecutorContextSections } from '../memory/context.js';
import {
  type PromptLabFixture,
} from '../prompts/prompt-lab.js';
import {
  renderExecutorAutonomousInstructions,
} from '../prompts/repository.js';
import { buildExecutorAgentPromptEnvelope } from '../loop/executor-prompt.js';
import {
  commitExecutorLiveWorkspaceSourceChanges,
  type ExecutorLiveWorkspaceSourceCommitResult,
} from '../loop/executor-source-commit.js';
import {
  shouldRunVisualWorkbenchEvidenceAutomationForTask,
} from '../loop/executor-observer.js';
import {
  EXECUTOR_TASK_WORKSPACE_REPORT_FILE,
  type ExecutorTaskWorkspaceAgent,
  type ExecutorTaskWorkspaceResult,
  runExecutorTaskWorkspace,
} from './executor-task-workspace.js';
import { assertOutputDirOutsideWorkDir, assertStageFixturePathAllowed, sha256 } from './stage-io.js';

export const EXECUTOR_PROJECT_TASK_RESULT_SCHEMA_VERSION = 'ra-356.executor-project-task-result.v0' as const;
export const EXECUTOR_PROJECT_TASK_REPORT_FILE = 'executor-project-task-run.json' as const;
export const EXECUTOR_PROJECT_TASK_GENERATED_TASK_FIXTURE_FILE = 'executor-project-task-task.json' as const;
export const EXECUTOR_PROJECT_TASK_GENERATED_PROMPT_FIXTURE_FILE = 'executor-project-task-prompt-fixture.json' as const;

const PROJECT_STAGE_SNAPSHOT_SCHEMA_VERSION = 'ra-356.project-stage-snapshot.v1' as const;

const ProviderSessionSummarySchema = z.object({
  agent: z.string().min(1),
  model: z.string().nullable(),
  taskId: z.string().min(1),
  taskFingerprint: z.string().min(1),
  specHash: z.string().nullable().optional(),
  sessionId: z.string().min(1),
  reason: z.string().nullable().optional(),
  outcome: z.string().nullable().optional(),
  errorCategory: z.string().nullable().optional(),
  resumedFrom: z.string().nullable().optional(),
  resumeFallbackReason: z.string().nullable().optional(),
  updatedAt: z.string(),
}).passthrough();

const ProjectStageSnapshotSchema = z.object({
  schemaVersion: z.literal(PROJECT_STAGE_SNAPSHOT_SCHEMA_VERSION),
  projectId: z.string().min(1),
  selectedTaskId: z.string().min(1).nullable(),
  stageBoundary: z.object({
    ownerBoundary: z.literal('arena-ctl.project-stage-snapshot'),
    mode: z.literal('read_only'),
  }).passthrough(),
  source: z.object({
    workspace: z.object({
      available: z.boolean(),
      path: z.string().nullable().optional(),
      isGitRepo: z.boolean().nullable().optional(),
      commitSha: z.string().nullable().optional(),
    }).passthrough(),
  }).passthrough(),
  visualWorkbenchManifestReadiness: z.object({
    available: z.boolean(),
    status: z.enum(['ready', 'blocked', 'unknown']).nullable(),
    canRunWorkbenchCapture: z.boolean(),
    schemaVersion: z.string().nullable(),
    projectClass: z.string().nullable(),
    blockers: z.array(z.string()).default([]),
    unknowns: z.array(z.string()).default([]),
  }).passthrough(),
  visualEvidencePolicy: z.object({
    owner: z.literal('governance.runner-init-readiness.ralphConfig'),
    status: z.enum(['ready', 'unavailable', 'invalid']),
    visualEvidenceMode: z.enum(['off', 'required', 'new_tasks_only']).nullable(),
    blockers: z.array(z.string()).default([]),
    notes: z.array(z.string()).default([]),
  }).passthrough(),
  plan: z.object({
    status: z.enum(['ready', 'missing', 'invalid', 'unavailable']),
    reasonCode: z.string().nullable().optional(),
    specFile: z.string().nullable().optional(),
    selectedTask: z.object({
      id: z.string().min(1),
      displayTitle: z.string().nullable().optional(),
      description: z.string().nullable().optional(),
      acceptanceCriteria: z.array(z.string()),
      status: z.enum(['pending', 'in_progress', 'completed', 'failed', 'skipped', 'unknown']),
      statusSource: z.enum(['explicit', 'plan_schema_default', 'unsupported']),
      attempts: z.number().nullable().optional(),
      lastError: z.string().nullable().optional(),
      requiredRolePasses: z.array(z.string()).default([]),
      visualEvidenceRequired: z.boolean().nullable().optional(),
      feedbackItemRefs: z.array(z.object({
        itemId: z.string().nullable().optional(),
        diffItemId: z.string().nullable().optional(),
        workSurface: z.string().nullable().optional(),
        workImpact: z.string().nullable().optional(),
        summary: z.string().nullable().optional(),
      }).passthrough()).default([]),
    }).passthrough().nullable(),
  }).passthrough(),
  providerSessions: z.object({
    status: z.enum(['ready', 'missing', 'invalid', 'unavailable']),
    selectedTaskSessionCount: z.number().nullable().optional(),
    selectedTaskSessions: z.array(ProviderSessionSummarySchema).default([]),
  }).passthrough().optional(),
}).passthrough();

type ProjectStageSnapshot = z.infer<typeof ProjectStageSnapshotSchema>;
type ProviderSessionSummary = z.infer<typeof ProviderSessionSummarySchema>;

type ExecutorVisualWorkbenchHandoffGate = {
  status: 'ready_for_selector_readiness' | 'blocked' | 'not_applicable';
  reason:
    | 'ordinary_web_visual_task'
    | 'visual_evidence_mode_off'
    | 'non_ordinary_web_project'
    | 'non_frontend_task'
    | 'missing_project_class'
    | 'manifest_not_ready'
    | 'accepted_diff_identity_missing'
    | 'executor_result_not_completed'
    | 'selected_source_output_missing';
  projectClass: string | null;
  visualEvidenceMode: VisualEvidenceMode | null;
  taskId: string | null;
  acceptedDiffRefs: Array<{
    itemId: string;
    diffItemId: string;
    workSurface: string | null;
  }>;
  sourceRef: string | null;
  nextStageId: 'visual_workbench_selector_readiness' | null;
  commandInputValues: Record<string, string>;
  blockers: string[];
  warnings: string[];
  notes: string[];
};

export type ExecutorProjectTaskMode = 'new_task' | 'failed_task' | 'resume_interrupted';
export type ExecutorProjectTaskWorkspaceMode = 'fork' | 'live_workspace_action';

export type ExecutorProjectTaskAgent = ExecutorTaskWorkspaceAgent;

export type ExecutorProjectTaskResult = {
  schemaVersion: typeof EXECUTOR_PROJECT_TASK_RESULT_SCHEMA_VERSION;
  stage: {
    stageId: 'executor_project_task';
    mode: 'workspace_mutation';
    ownerBoundary: 'ralph.executor-project-task-adapter';
    adapterFor: 'executor_task_workspace';
    projectStageSnapshot: {
      schemaVersion: typeof PROJECT_STAGE_SNAPSHOT_SCHEMA_VERSION;
      ownerBoundary: 'arena-ctl.project-stage-snapshot';
    };
    allowedMutations: string[];
    forbiddenMutations: string[];
    handoff: string[];
  };
  status: ExecutorTaskWorkspaceResult['status'];
  input: {
    snapshotPath: string | null;
    projectId: string;
    selectedTaskId: string | null;
    selectedTaskStatus: string | null;
    selectedTaskStatusSource: string | null;
    mode: ExecutorProjectTaskMode;
    workspaceMode: ExecutorProjectTaskWorkspaceMode;
    providerSessionStatus: string | null;
    liveWorkspacePath: string | null;
    workDir: string;
    sourceRef: string;
    snapshotSourceRef: string | null;
    outDir: string;
  };
  prepared: null | {
    taskId: string;
    taskSha256: string;
    promptFixtureSha256: string;
    promptContextSha256: string;
    visualEvidenceMode: VisualEvidenceMode;
    providerSessionResume: null | {
      sessionId: string;
      agent: string;
      model: string | null;
      taskFingerprint: string;
      specHash: string | null;
      outcome: string | null;
      updatedAt: string;
    };
  };
  projectCommit: null | ExecutorLiveWorkspaceSourceCommitResult;
  workspaceResult: ExecutorTaskWorkspaceResult | null;
  visualWorkbenchHandoffGate: ExecutorVisualWorkbenchHandoffGate;
  output: {
    outDir: string;
    reportPath: string;
    delegatedWorkspaceReportPath: string;
    generatedTaskFixturePath: string | null;
    generatedPromptFixturePath: string | null;
  };
  error: null | {
    code:
      | 'plan_not_ready'
      | 'task_not_selected'
      | 'selected_task_missing'
      | 'selected_task_not_new_task'
      | 'selected_task_not_failed_task'
      | 'selected_task_not_resume_interrupted'
      | 'selected_task_invalid'
      | 'spec_file_unavailable'
      | 'provider_session_not_ready'
      | 'provider_session_not_found'
      | 'source_workspace_unavailable'
      | 'source_workspace_path_unavailable'
      | 'source_ref_unavailable'
      | 'source_ref_not_snapshot_commit'
      | 'live_workspace_forbidden'
      | 'live_workspace_mismatch'
      | 'visual_evidence_policy_not_ready'
      | NonNullable<ExecutorTaskWorkspaceResult['error']>['code'];
    message: string;
  };
  notes: string[];
};

export async function runExecutorProjectTask(input: {
  snapshot: unknown;
  snapshotPath?: string | null;
  mode: ExecutorProjectTaskMode;
  workspaceMode: ExecutorProjectTaskWorkspaceMode;
  completionPromise: string;
  expectedVisualWorkbenchStoryIds?: string[];
  promptVariantRef?: string | null;
  workDir?: string | null;
  sourceRef?: string | null;
  outDir: string;
  agent: Pick<Agent, 'name' | 'execute'>;
  model?: string | null;
  timeoutMinutes?: number | null;
}): Promise<ExecutorProjectTaskResult> {
  if (input.mode !== 'new_task' && input.mode !== 'failed_task' && input.mode !== 'resume_interrupted') {
    throw new Error('executor_project_task currently supports --mode new_task, --mode failed_task and --mode resume_interrupted only.');
  }
  if (input.workspaceMode !== 'fork' && input.workspaceMode !== 'live_workspace_action') {
    throw new Error('executor_project_task currently supports --workspace-mode fork and --workspace-mode live_workspace_action only.');
  }
  if (!input.completionPromise.trim()) {
    throw new Error('executor_project_task requires an explicit completionPromise.');
  }

  const snapshot = ProjectStageSnapshotSchema.parse(input.snapshot);
  const liveWorkspacePath = snapshot.source.workspace.path?.trim() || null;
  const snapshotSourceRef = snapshot.source.workspace.commitSha?.trim() || null;
  const explicitWorkDir = input.workDir?.trim() || null;
  const explicitSourceRef = input.sourceRef?.trim() || null;
  const workDir = input.workspaceMode === 'live_workspace_action'
    ? liveWorkspacePath ? resolve(liveWorkspacePath) : explicitWorkDir ? resolve(explicitWorkDir) : ''
    : resolve(requiredExecutorProjectTaskString(input.workDir, 'executor_project_task', '--work-dir'));
  const sourceRef = input.workspaceMode === 'live_workspace_action'
    ? snapshotSourceRef ?? explicitSourceRef ?? ''
    : requiredExecutorProjectTaskString(input.sourceRef, 'executor_project_task', '--source-ref');
  const outDir = resolve(input.outDir);
  if (workDir) {
    assertOutputDirOutsideWorkDir({
      stageId: 'executor_project_task',
      workDir,
      outDir,
    });
  }

  const reportPath = resolve(outDir, EXECUTOR_PROJECT_TASK_REPORT_FILE);
  if (await fs.pathExists(reportPath)) {
    throw new Error(`executor_project_task --out-dir already contains ${EXECUTOR_PROJECT_TASK_REPORT_FILE}; refusing to overwrite experiment output.`);
  }
  await fs.ensureDir(outDir);

  const baseInput = {
    snapshot,
    snapshotPath: input.snapshotPath ?? null,
    mode: input.mode,
    workspaceMode: input.workspaceMode,
    workDir,
    sourceRef,
    explicitWorkDir,
    explicitSourceRef,
    outDir,
    reportPath,
  };
  const providerSessionResume = input.mode === 'resume_interrupted'
    ? selectProviderSessionResume({
      snapshot,
      agentName: input.agent.name,
      model: input.model ?? null,
    })
    : null;

  const validationBlocker = await validateExecutorProjectTaskInput({
    ...baseInput,
    providerSessionResume,
  });
  if (validationBlocker) {
    return writeExecutorProjectTaskResult(baseExecutorProjectTaskResult({
      ...baseInput,
      prepared: null,
      workspaceResult: null,
      status: 'blocked',
      error: validationBlocker,
    }));
  }

  const task = buildTaskFromSnapshot(snapshot);
  const specPath = resolve(workDir, requiredSnapshotPlanSpecFile(snapshot));
  const visualEvidenceMode = resolveSnapshotVisualEvidenceMode(snapshot, task);
  const promptFixture = buildExecutorPromptFixture({
    task,
    mode: input.mode,
    completionPromise: input.completionPromise,
    visualEvidenceMode,
    workspaceMode: input.workspaceMode,
    specPath,
  });
  await writeGeneratedExecutorProjectTaskArtifacts({
    outDir,
    task,
    promptFixture,
  });
  const workspaceResult = await runExecutorTaskWorkspace({
    task,
    promptFixture,
    completionPromise: input.completionPromise,
    visualEvidenceMode,
    expectedVisualWorkbenchStoryIds: input.expectedVisualWorkbenchStoryIds ?? [],
    promptVariantRef: input.promptVariantRef ?? null,
    workDir,
    sourceRef,
    outDir,
    agent: input.agent,
    model: input.model,
    timeoutMinutes: input.timeoutMinutes,
    providerSessionResumeId: providerSessionResume?.sessionId ?? null,
  });
  const projectCommit = input.workspaceMode === 'live_workspace_action'
    ? await commitExecutorLiveWorkspaceSourceChanges({
      workDir,
      task,
      mode: input.mode,
      beforeCommit: sourceRef,
      workspaceStatus: workspaceResult.status,
      changedFiles: workspaceResult.source.changedFilesFromGitStatus,
      reportPath,
      delegatedWorkspaceReportPath: resolve(outDir, EXECUTOR_TASK_WORKSPACE_REPORT_FILE),
    })
    : null;

  return writeExecutorProjectTaskResult(baseExecutorProjectTaskResult({
    ...baseInput,
    prepared: {
      taskId: task.id,
      taskSha256: `sha256:${sha256(JSON.stringify(task))}`,
      promptFixtureSha256: `sha256:${sha256(JSON.stringify(promptFixture))}`,
      promptContextSha256: `sha256:${sha256(promptFixture.input.contextSections)}`,
      visualEvidenceMode,
      providerSessionResume: providerSessionResume
        ? {
          sessionId: providerSessionResume.sessionId,
          agent: providerSessionResume.agent,
          model: providerSessionResume.model,
          taskFingerprint: providerSessionResume.taskFingerprint,
          specHash: providerSessionResume.specHash ?? null,
          outcome: providerSessionResume.outcome ?? null,
          updatedAt: providerSessionResume.updatedAt,
        }
        : null,
    },
    projectCommit,
    workspaceResult,
    status: workspaceResult.status,
    error: workspaceResult.error,
  }));
}

export async function runExecutorProjectTaskFiles(input: {
  snapshotPath: string;
  mode: ExecutorProjectTaskMode;
  workspaceMode: ExecutorProjectTaskWorkspaceMode;
  completionPromise: string;
  expectedVisualWorkbenchStoryIds?: string[];
  promptVariantRef?: string | null;
  workDir?: string | null;
  sourceRef?: string | null;
  outDir: string;
  agent: ExecutorProjectTaskAgent;
  model?: string | null;
  timeoutMinutes?: number | null;
}): Promise<ExecutorProjectTaskResult> {
  const snapshotPath = resolve(input.snapshotPath);
  assertStageFixturePathAllowed(snapshotPath, 'executor_project_task --snapshot');
  return runExecutorProjectTask({
    snapshot: await fs.readJson(snapshotPath),
    snapshotPath,
    mode: input.mode,
    workspaceMode: input.workspaceMode,
    completionPromise: input.completionPromise,
    expectedVisualWorkbenchStoryIds: input.expectedVisualWorkbenchStoryIds,
    promptVariantRef: input.promptVariantRef,
    workDir: input.workDir,
    sourceRef: input.sourceRef,
    outDir: input.outDir,
    agent: input.agent,
    model: input.model,
    timeoutMinutes: input.timeoutMinutes,
  });
}

export function formatExecutorProjectTaskResult(
  result: ExecutorProjectTaskResult,
  compact = false,
): string {
  return `${JSON.stringify(result, null, compact ? 0 : 2)}\n`;
}

async function validateExecutorProjectTaskInput(input: {
  snapshot: ProjectStageSnapshot;
  mode: ExecutorProjectTaskMode;
  workspaceMode: ExecutorProjectTaskWorkspaceMode;
  workDir: string;
  sourceRef: string;
  explicitWorkDir: string | null;
  explicitSourceRef: string | null;
  providerSessionResume: ProviderSessionSummary | null;
}): Promise<ExecutorProjectTaskResult['error']> {
  const { snapshot } = input;
  if (snapshot.plan.status !== 'ready') {
    return {
      code: 'plan_not_ready',
      message: `executor_project_task requires plan.status=ready; got ${snapshot.plan.status}${snapshot.plan.reasonCode ? ` (${snapshot.plan.reasonCode})` : ''}.`,
    };
  }
  if (!snapshot.selectedTaskId) {
    return {
      code: 'task_not_selected',
      message: 'executor_project_task requires a Project Stage Snapshot with selectedTaskId.',
    };
  }
  if (!snapshot.plan.selectedTask) {
    return {
      code: 'selected_task_missing',
      message: `executor_project_task snapshot selectedTaskId=${snapshot.selectedTaskId} has no selected plan task.`,
    };
  }
  if (!snapshot.plan.specFile?.trim()) {
    return {
      code: 'spec_file_unavailable',
      message: 'executor_project_task requires Project Stage Snapshot plan.specFile so shared executor context can identify the accepted spec reference.',
    };
  }
  if (snapshot.visualEvidencePolicy.status !== 'ready' || !snapshot.visualEvidencePolicy.visualEvidenceMode) {
    return {
      code: 'visual_evidence_policy_not_ready',
      message: `executor_project_task requires Project Stage Snapshot visualEvidencePolicy.status=ready; got ${snapshot.visualEvidencePolicy.status}.`,
    };
  }
  const selectedTaskStatus = snapshot.plan.selectedTask.status;
  if (input.mode === 'new_task' && selectedTaskStatus !== 'pending') {
    return {
      code: 'selected_task_not_new_task',
      message: `executor_project_task --mode new_task accepts only pending tasks; selected task ${snapshot.plan.selectedTask.id} is ${snapshot.plan.selectedTask.status}.`,
    };
  }
  if (input.mode === 'failed_task' && selectedTaskStatus !== 'failed') {
    return {
      code: 'selected_task_not_failed_task',
      message: `executor_project_task --mode failed_task accepts only failed tasks; selected task ${snapshot.plan.selectedTask.id} is ${snapshot.plan.selectedTask.status}.`,
    };
  }
  if (input.mode === 'resume_interrupted') {
    if (selectedTaskStatus !== 'in_progress') {
      return {
        code: 'selected_task_not_resume_interrupted',
        message: `executor_project_task --mode resume_interrupted accepts only in_progress tasks; selected task ${snapshot.plan.selectedTask.id} is ${snapshot.plan.selectedTask.status}.`,
      };
    }
    if (snapshot.providerSessions?.status !== 'ready') {
      return {
        code: 'provider_session_not_ready',
        message: `executor_project_task --mode resume_interrupted requires providerSessions.status=ready; got ${snapshot.providerSessions?.status ?? 'missing'}.`,
      };
    }
    if (!input.providerSessionResume) {
      return {
        code: 'provider_session_not_found',
        message: `executor_project_task --mode resume_interrupted requires a matching failed provider session for task ${snapshot.plan.selectedTask.id}, selected agent, selected model and task fingerprint.`,
      };
    }
  }
  if (snapshot.plan.selectedTask.statusSource === 'unsupported') {
    return {
      code: 'selected_task_invalid',
      message: `executor_project_task selected task ${snapshot.plan.selectedTask.id} has unsupported task status source.`,
    };
  }
  if (!snapshot.source.workspace.available || snapshot.source.workspace.isGitRepo !== true) {
    return {
      code: 'source_workspace_unavailable',
      message: 'executor_project_task requires Project Stage Snapshot source.workspace to be available and a git repo.',
    };
  }
  const liveWorkspacePath = snapshot.source.workspace.path?.trim() || null;
  if (!liveWorkspacePath) {
    return {
      code: 'source_workspace_path_unavailable',
      message: 'executor_project_task requires Project Stage Snapshot source.workspace.path so the live workspace can be rejected fail-closed.',
    };
  }

  const snapshotSourceRef = snapshot.source.workspace.commitSha?.trim() || null;
  if (!snapshotSourceRef) {
    return {
      code: 'source_ref_unavailable',
      message: 'executor_project_task requires source.workspace.commitSha from the Project Stage Snapshot.',
    };
  }
  if (!input.sourceRef.trim()) {
    return {
      code: 'source_ref_unavailable',
      message: 'executor_project_task requires explicit --source-ref matching the snapshot source commit.',
    };
  }
  if (input.sourceRef.trim() !== snapshotSourceRef) {
    return {
      code: 'source_ref_not_snapshot_commit',
      message: `executor_project_task --source-ref must equal snapshot source commit ${snapshotSourceRef}; got ${input.sourceRef.trim()}.`,
    };
  }

  if (input.workspaceMode === 'fork') {
    if (await pathsResolveToSameLocation(input.workDir, liveWorkspacePath)) {
      return {
        code: 'live_workspace_forbidden',
        message: 'executor_project_task --work-dir must be an explicit fork workspace, not the live Project Stage Snapshot workspace path.',
      };
    }
  } else {
    if (input.explicitWorkDir && !await pathsResolveToSameLocation(input.explicitWorkDir, liveWorkspacePath)) {
      return {
        code: 'live_workspace_mismatch',
        message: 'executor_project_task --workspace-mode live_workspace_action must use the live Project Stage Snapshot workspace path.',
      };
    }
    if (input.explicitSourceRef && input.explicitSourceRef !== snapshotSourceRef) {
      return {
        code: 'source_ref_not_snapshot_commit',
        message: `executor_project_task --source-ref must equal snapshot source commit ${snapshotSourceRef}; got ${input.explicitSourceRef}.`,
      };
    }
  }

  return null;
}

function buildTaskFromSnapshot(snapshot: ProjectStageSnapshot): Task {
  const selectedTask = snapshot.plan.selectedTask;
  if (!selectedTask) {
    throw new Error('executor_project_task internal error: selected task was not validated.');
  }

  return TaskSchema.parse({
    id: selectedTask.id,
    displayTitle: selectedTask.displayTitle ?? undefined,
    description: selectedTask.description ?? '',
    acceptanceCriteria: selectedTask.acceptanceCriteria,
    status: selectedTask.status,
    attempts: selectedTask.attempts ?? 0,
    lastError: selectedTask.lastError ?? undefined,
    requiredRolePasses: normalizeRolePasses(selectedTask.requiredRolePasses),
    visualEvidenceRequired: selectedTask.visualEvidenceRequired ?? undefined,
    feedbackItemRefs: selectedTask.feedbackItemRefs
      .filter((ref) => ref.itemId)
      .map((ref) => ({
        itemId: ref.itemId,
        diffItemId: ref.diffItemId ?? undefined,
        workSurface: ref.workSurface ?? undefined,
        workImpact: ref.workImpact ?? undefined,
        summary: ref.summary ?? undefined,
      })),
  });
}

function resolveSnapshotVisualEvidenceMode(snapshot: ProjectStageSnapshot, task: Task): VisualEvidenceMode {
  const projectMode = snapshot.visualEvidencePolicy.visualEvidenceMode;
  if (!projectMode) {
    throw new Error('executor_project_task internal error: visualEvidencePolicy was not validated.');
  }
  return shouldRunVisualWorkbenchEvidenceAutomationForTask({
    task,
    visualEvidenceMode: projectMode,
  })
    ? projectMode
    : 'off';
}

function buildExecutorPromptFixture(input: {
  task: Task;
  mode: ExecutorProjectTaskMode;
  completionPromise: string;
  visualEvidenceMode: VisualEvidenceMode;
  workspaceMode: ExecutorProjectTaskWorkspaceMode;
  specPath: string;
}): PromptLabFixture & { promptId: 'executor.agentPrompt'; input: { contextSections: string } } {
  const workspaceLabel = input.workspaceMode === 'live_workspace_action'
    ? 'explicit live project workspace'
    : 'explicit fork workspace';
  const contextSections = buildExecutorContextSections({
    task: input.task,
    iteration: (input.task.attempts ?? 0) + 1,
    autonomousInstructions: renderExecutorAutonomousInstructions({
      completionPromise: input.completionPromise,
      seed: `Manual executor_project_task stage. Run only the selected task in the ${workspaceLabel}.`,
    }),
    platformPromptSection: [
      '# Manual Stage Boundary',
      '- This is an isolated executor experiment, not a full Ralph lifecycle run.',
      `- Work only in the current ${workspaceLabel}.`,
      '- Do not edit `.ralph/`, `.arena/`, proof, lifecycle, runtime, provider-session or progress files.',
      '- Do not commit, push, deploy, relaunch, retry, unblock or continue to other tasks. The adapter owns any local project commit after a successful run.',
    ].join('\n'),
    activeWipReconciliation: input.mode === 'resume_interrupted',
    visualEvidenceMode: input.visualEvidenceMode,
    specPath: input.specPath,
  });

  return buildExecutorAgentPromptEnvelope({
    name: `executor-project-task-${input.task.id}`,
    contextSections,
  }).fixture;
}

function requiredSnapshotPlanSpecFile(snapshot: ProjectStageSnapshot): string {
  const specFile = snapshot.plan.specFile?.trim();
  if (!specFile) {
    throw new Error('executor_project_task internal error: plan.specFile was not validated.');
  }
  return specFile;
}

function baseExecutorProjectTaskResult(input: {
  snapshot: ProjectStageSnapshot;
  snapshotPath: string | null;
  mode: ExecutorProjectTaskMode;
  workspaceMode: ExecutorProjectTaskWorkspaceMode;
  workDir: string;
  sourceRef: string;
  outDir: string;
  reportPath: string;
  prepared: ExecutorProjectTaskResult['prepared'];
  projectCommit?: ExecutorProjectTaskResult['projectCommit'];
  workspaceResult: ExecutorTaskWorkspaceResult | null;
  status: ExecutorProjectTaskResult['status'];
  error: ExecutorProjectTaskResult['error'];
}): ExecutorProjectTaskResult {
  const visualWorkbenchHandoffGate = buildExecutorVisualWorkbenchHandoffGate(input);

  return {
    schemaVersion: EXECUTOR_PROJECT_TASK_RESULT_SCHEMA_VERSION,
    stage: {
      stageId: 'executor_project_task',
      mode: 'workspace_mutation',
      ownerBoundary: 'ralph.executor-project-task-adapter',
      adapterFor: 'executor_task_workspace',
      projectStageSnapshot: {
        schemaVersion: PROJECT_STAGE_SNAPSHOT_SCHEMA_VERSION,
        ownerBoundary: 'arena-ctl.project-stage-snapshot',
      },
      allowedMutations: [
        input.workDir,
        input.outDir,
      ],
      forbiddenMutations: [
        'live lifecycle/runtime/source/task/proof/evidence/progress writes',
        '.ralph/plan.json',
        '.ralph/provider-session-checkpoint.json',
        '.ralph/controller-reports/',
        '.ralph/agent-logs/',
        '.ralph/evidence/',
        '.ralph/tasks/',
        '.arena/',
        'remote git push',
        'deploy/relaunch/retry/recreate/unblock',
        ...(input.workspaceMode === 'fork'
          ? ['live Project Stage Snapshot workspace path']
          : ['task completion from local project commit', 'screenshot proof from local project commit']),
      ],
      handoff: [
        'inspect_executor_project_task_report',
        'inspect_executor_task_workspace_report_if_delegated',
        ...(input.workspaceMode === 'fork'
          ? ['run_executor_workspace_source_snapshot_if_source_changed_and_selected', 'discard_or_reset_forked_workspace']
          : ['inspect_local_project_commit_if_created', 'run_controller_or_visual_workbench_stage_later_if_selected', 'rollback_live_workspace_manually_if_needed']),
        'run_visual_workbench_manifest_or_capture_stage_later_if_selected',
      ],
    },
    status: input.status,
    input: {
      snapshotPath: input.snapshotPath,
      projectId: input.snapshot.projectId,
      selectedTaskId: input.snapshot.selectedTaskId,
      selectedTaskStatus: input.snapshot.plan.selectedTask?.status ?? null,
      selectedTaskStatusSource: input.snapshot.plan.selectedTask?.statusSource ?? null,
      mode: input.mode,
      workspaceMode: input.workspaceMode,
      providerSessionStatus: input.snapshot.providerSessions?.status ?? null,
      liveWorkspacePath: input.snapshot.source.workspace.path?.trim() || null,
      workDir: input.workDir,
      sourceRef: input.sourceRef,
      snapshotSourceRef: input.snapshot.source.workspace.commitSha?.trim() || null,
      outDir: input.outDir,
    },
    prepared: input.prepared,
    projectCommit: input.projectCommit ?? null,
    workspaceResult: input.workspaceResult,
    visualWorkbenchHandoffGate,
    output: {
      outDir: input.outDir,
      reportPath: input.reportPath,
      delegatedWorkspaceReportPath: resolve(input.outDir, EXECUTOR_TASK_WORKSPACE_REPORT_FILE),
      generatedTaskFixturePath: input.prepared
        ? resolve(input.outDir, EXECUTOR_PROJECT_TASK_GENERATED_TASK_FIXTURE_FILE)
        : null,
      generatedPromptFixturePath: input.prepared
        ? resolve(input.outDir, EXECUTOR_PROJECT_TASK_GENERATED_PROMPT_FIXTURE_FILE)
        : null,
    },
    error: input.error,
    notes: [
      'executor_project_task consumes one Project Stage Snapshot and does not read live project truth again.',
      'It is an adapter over executor_task_workspace, not a second executor.',
      'Mode new_task accepts only a selected pending task; mode failed_task accepts only a selected failed task; mode resume_interrupted accepts only a selected in_progress task with a matching provider session.',
      'Workspace mode fork forbids using the live snapshot workspace as --work-dir; workspace mode live_workspace_action uses that workspace explicitly.',
      'Live workspace action may create a local project commit after a successful clean executor result; that commit is not lifecycle, task, proof or remote source truth.',
      'This result is experiment output, not task/proof/lifecycle truth.',
    ],
  };
}

function buildExecutorVisualWorkbenchHandoffGate(input: {
  snapshot: ProjectStageSnapshot;
  workDir: string;
  prepared: ExecutorProjectTaskResult['prepared'];
  projectCommit?: ExecutorProjectTaskResult['projectCommit'];
  workspaceResult: ExecutorTaskWorkspaceResult | null;
  status: ExecutorProjectTaskResult['status'];
}): ExecutorVisualWorkbenchHandoffGate {
  const selectedTask = input.snapshot.plan.selectedTask;
  const taskId = selectedTask?.id ?? null;
  const visualEvidenceMode = input.prepared?.visualEvidenceMode ?? null;
  const acceptedDiffRefs = (selectedTask?.feedbackItemRefs ?? [])
    .filter((ref) => Boolean(ref.itemId?.trim()) && Boolean(ref.diffItemId?.trim()))
    .map((ref) => ({
      itemId: ref.itemId!.trim(),
      diffItemId: ref.diffItemId!.trim(),
      workSurface: ref.workSurface?.trim() || null,
    }));
  const hasFrontendSurface = (selectedTask?.feedbackItemRefs ?? []).some((ref) => ref.workSurface === 'frontend')
    || (selectedTask?.requiredRolePasses ?? []).includes('ux')
    || selectedTask?.visualEvidenceRequired === true;
  const readiness = input.snapshot.visualWorkbenchManifestReadiness;
  const projectClass = readiness.projectClass?.trim() || null;
  const sourceRef = input.projectCommit?.afterCommit ?? null;

  if (visualEvidenceMode === 'off') {
    return executorVisualWorkbenchNotApplicable({
      reason: 'visual_evidence_mode_off',
      projectClass,
      visualEvidenceMode,
      taskId,
      acceptedDiffRefs,
      sourceRef,
      warnings: [],
      notes: [
        'The selected executor result did not run with visual evidence enabled for this task.',
      ],
    });
  }

  if (projectClass && projectClass !== 'ordinary_web') {
    return executorVisualWorkbenchNotApplicable({
      reason: 'non_ordinary_web_project',
      projectClass,
      visualEvidenceMode,
      taskId,
      acceptedDiffRefs,
      sourceRef,
      warnings: [],
      notes: [
        'Visual Workbench screenshot evidence is currently routed only for ordinary web projects.',
      ],
    });
  }

  if (visualEvidenceMode && !hasFrontendSurface) {
    return executorVisualWorkbenchNotApplicable({
      reason: 'non_frontend_task',
      projectClass,
      visualEvidenceMode,
      taskId,
      acceptedDiffRefs,
      sourceRef,
      warnings: [],
      notes: [
        'The selected task has no owner-backed frontend/UX visual surface signal.',
      ],
    });
  }

  const blockerEntries: Array<{ code: string; reason: ExecutorVisualWorkbenchHandoffGate['reason'] }> = [
    !projectClass ? { code: 'missing_project_class', reason: 'missing_project_class' } : null,
    readiness.status !== 'ready' || readiness.canRunWorkbenchCapture !== true
      ? { code: `manifest_not_ready:${readiness.status ?? 'unknown'}`, reason: 'manifest_not_ready' }
      : null,
    input.status !== 'completed'
      ? { code: `executor_result_not_completed:${input.status}`, reason: 'executor_result_not_completed' }
      : null,
    acceptedDiffRefs.length === 0
      ? { code: 'accepted_diff_identity_missing', reason: 'accepted_diff_identity_missing' }
      : null,
    !sourceRef
      ? { code: `selected_source_output_missing:${input.projectCommit?.status ?? 'missing'}`, reason: 'selected_source_output_missing' }
      : null,
  ].filter((entry): entry is { code: string; reason: ExecutorVisualWorkbenchHandoffGate['reason'] } => Boolean(entry));

  if (blockerEntries.length > 0) {
    return {
      status: 'blocked',
      reason: blockerEntries[0]!.reason,
      projectClass,
      visualEvidenceMode,
      taskId,
      acceptedDiffRefs,
      sourceRef,
      nextStageId: null,
      commandInputValues: {},
      blockers: [
        ...blockerEntries.map((entry) => entry.code),
        ...readiness.blockers.map((blocker) => `manifest:${blocker}`),
      ],
      warnings: readiness.unknowns.map((unknown) => `manifest_unknown:${unknown}`),
      notes: [
        'Executor visual handoff is metadata-only and does not run screenshots.',
        'Fix the blocking owner evidence, then run Visual Workbench selector readiness explicitly.',
      ],
    };
  }

  return {
    status: 'ready_for_selector_readiness',
    reason: 'ordinary_web_visual_task',
    projectClass,
    visualEvidenceMode,
    taskId,
    acceptedDiffRefs,
    sourceRef,
    nextStageId: 'visual_workbench_selector_readiness',
    commandInputValues: {
      ...(input.workDir ? { '<project-source-workspace>': input.workDir } : {}),
      ...(taskId ? { '<taskId>': taskId } : {}),
    },
    blockers: [],
    warnings: input.workspaceResult?.executorOutput.summary?.changedVisualWorkbenchFiles.length === 0
      ? ['structured_visual_task_without_workbench_file_changes']
      : [],
    notes: [
      'Ready means only that selector-readiness can be run next.',
      'Selector readiness owns story/task matching; capture/export/publish still require explicit downstream stages.',
      'This gate is not task completion, proof truth, lifecycle truth or screenshot availability.',
    ],
  };
}

function executorVisualWorkbenchNotApplicable(input: {
  reason: ExecutorVisualWorkbenchHandoffGate['reason'];
  projectClass: string | null;
  visualEvidenceMode: VisualEvidenceMode | null;
  taskId: string | null;
  acceptedDiffRefs: ExecutorVisualWorkbenchHandoffGate['acceptedDiffRefs'];
  sourceRef: string | null;
  warnings: string[];
  notes: string[];
}): ExecutorVisualWorkbenchHandoffGate {
  return {
    status: 'not_applicable',
    reason: input.reason,
    projectClass: input.projectClass,
    visualEvidenceMode: input.visualEvidenceMode,
    taskId: input.taskId,
    acceptedDiffRefs: input.acceptedDiffRefs,
    sourceRef: input.sourceRef,
    nextStageId: null,
    commandInputValues: {},
    blockers: [],
    warnings: input.warnings,
    notes: input.notes,
  };
}

function selectProviderSessionResume(input: {
  snapshot: ProjectStageSnapshot;
  agentName: string;
  model: string | null;
}): ProviderSessionSummary | null {
  const selectedTask = input.snapshot.plan.selectedTask;
  const providerSessions = input.snapshot.providerSessions;
  if (!selectedTask || providerSessions?.status !== 'ready') return null;

  const expectedModel = input.model?.trim() || null;
  const expectedTaskFingerprint = buildProviderSessionTaskFingerprint({
    taskId: selectedTask.id,
    taskDescription: selectedTask.description ?? '',
  });

  return providerSessions.selectedTaskSessions.find((session) => {
    return session.agent === input.agentName
      && session.model === expectedModel
      && session.taskId === selectedTask.id
      && session.taskFingerprint === expectedTaskFingerprint
      && isProviderSessionResumable(session)
      && Boolean(session.sessionId.trim());
  }) ?? null;
}

async function writeExecutorProjectTaskResult(result: ExecutorProjectTaskResult): Promise<ExecutorProjectTaskResult> {
  await fs.ensureDir(dirname(result.output.reportPath));
  await fs.writeJson(result.output.reportPath, result, { spaces: 2 });
  return result;
}

async function writeGeneratedExecutorProjectTaskArtifacts(input: {
  outDir: string;
  task: Task;
  promptFixture: PromptLabFixture;
}): Promise<void> {
  const taskPath = resolve(input.outDir, EXECUTOR_PROJECT_TASK_GENERATED_TASK_FIXTURE_FILE);
  const promptPath = resolve(input.outDir, EXECUTOR_PROJECT_TASK_GENERATED_PROMPT_FIXTURE_FILE);
  if (await fs.pathExists(taskPath)) {
    throw new Error(`executor_project_task --out-dir already contains ${EXECUTOR_PROJECT_TASK_GENERATED_TASK_FIXTURE_FILE}; refusing to overwrite experiment output.`);
  }
  if (await fs.pathExists(promptPath)) {
    throw new Error(`executor_project_task --out-dir already contains ${EXECUTOR_PROJECT_TASK_GENERATED_PROMPT_FIXTURE_FILE}; refusing to overwrite experiment output.`);
  }
  await fs.writeJson(taskPath, input.task, { spaces: 2 });
  await fs.writeJson(promptPath, input.promptFixture, { spaces: 2 });
}

function normalizeRolePasses(values: string[]): Array<'product' | 'ux'> {
  return values.filter((value): value is 'product' | 'ux' => value === 'product' || value === 'ux');
}

async function pathsResolveToSameLocation(firstPath: string, secondPath: string): Promise<boolean> {
  const firstResolved = resolve(firstPath);
  const secondResolved = resolve(secondPath);
  if (firstResolved === secondResolved) return true;

  try {
    return await fs.realpath(firstResolved) === await fs.realpath(secondResolved);
  } catch {
    return false;
  }
}

function requiredExecutorProjectTaskString(value: string | null | undefined, stageId: string, flag: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${stageId} requires explicit ${flag}.`);
  }
  return value.trim();
}
