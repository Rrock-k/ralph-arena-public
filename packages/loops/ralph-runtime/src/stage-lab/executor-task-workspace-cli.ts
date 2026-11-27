import { AgentType, VisualEvidenceModeSchema, type VisualEvidenceMode } from '../config/types.js';

export type ExecutorTaskWorkspaceStageRunCliOptions = {
  snapshot?: unknown;
  mode?: unknown;
  workspaceMode?: unknown;
  taskFixture?: unknown;
  promptFixture?: unknown;
  completionPromise?: unknown;
  workDir?: unknown;
  sourceRef?: unknown;
  outDir?: unknown;
  agent?: unknown;
  model?: unknown;
  timeoutMinutes?: unknown;
  promptVariant?: unknown;
  expectedStory?: unknown;
  visualWorkbenchCapture?: unknown;
  executorWorkspaceReport?: unknown;
  commitMessage?: unknown;
  projectId?: unknown;
  spec?: unknown;
  trigger?: unknown;
  visualEvidenceMode?: unknown;
  fixture?: unknown;
  out?: unknown;
};

export type NormalizedExecutorTaskWorkspaceStageRun = {
  taskFixturePath: string;
  promptFixturePath: string;
  completionPromise: string;
  workDir: string;
  sourceRef: string;
  outDir: string;
  agentType: AgentType;
  model: string;
  timeoutMinutes: number;
  promptVariantRef: string | null;
  visualEvidenceMode: VisualEvidenceMode;
  expectedVisualWorkbenchStoryIds: string[];
};

export type NormalizedExecutorTaskWorkspaceContinueStageRun = {
  executorWorkspaceReportPath: string;
  taskFixturePath: string;
  promptFixturePath: string;
  completionPromise: string;
  workDir: string;
  sourceRef: string;
  outDir: string;
  agentType: AgentType;
  model: string;
  timeoutMinutes: number;
  promptVariantRef: string | null;
  visualEvidenceMode: VisualEvidenceMode;
  expectedVisualWorkbenchStoryIds: string[];
};

export type NormalizedExecutorProjectTaskStageRun = {
  snapshotPath: string;
  mode: 'new_task' | 'failed_task' | 'resume_interrupted';
  workspaceMode: 'fork' | 'live_workspace_action';
  completionPromise: string;
  workDir: string | null;
  sourceRef: string | null;
  outDir: string;
  agentType: AgentType;
  model: string;
  timeoutMinutes: number;
  promptVariantRef: string | null;
  expectedVisualWorkbenchStoryIds: string[];
};

export type NormalizedExecutorWorkspaceSourceSnapshotStageRun = {
  executorWorkspaceReportPath: string;
  workDir: string;
  sourceRef: string;
  outDir: string;
  commitMessage: string;
  projectId: string | null;
};

export type NormalizedPlannerProjectDryRunStageRun = {
  snapshotPath: string;
  workDir: string;
  sourceRef: string;
  spec: string;
  visualEvidenceMode: VisualEvidenceMode;
  outDir: string;
  agentType: AgentType;
  model: string;
  timeoutMinutes: number;
};

export type NormalizedPlannerSpecMigrationApplyStageRun = {
  snapshotPath: string;
  sourceRef: string;
  outDir: string;
  agentType: AgentType;
  model: string;
  timeoutMinutes: number;
};

export type NormalizedControllerProjectDryRunStageRun = {
  snapshotPath: string;
  workDir: string;
  sourceRef: string;
  spec: string;
  trigger: 'phase_complete' | 'periodic' | 'failure_threshold' | 'replan' | 'manual' | 'final' | 'spec_migration';
  visualEvidenceMode: VisualEvidenceMode;
  outDir: string;
  agentType: AgentType;
  model: string;
  timeoutMinutes: number;
};

const workspaceProviderOptionLabels: Array<[keyof ExecutorTaskWorkspaceStageRunCliOptions, string]> = [
  ['snapshot', '--snapshot'],
  ['mode', '--mode'],
  ['workspaceMode', '--workspace-mode'],
  ['taskFixture', '--task-fixture'],
  ['promptFixture', '--prompt-fixture'],
  ['completionPromise', '--completion-promise'],
  ['workDir', '--work-dir'],
  ['sourceRef', '--source-ref'],
  ['outDir', '--out-dir'],
  ['agent', '--agent'],
  ['model', '--model'],
  ['timeoutMinutes', '--timeout-minutes'],
  ['promptVariant', '--prompt-variant'],
  ['expectedStory', '--expected-story'],
  ['visualWorkbenchCapture', '--visual-workbench-capture'],
  ['executorWorkspaceReport', '--executor-workspace-report'],
  ['commitMessage', '--commit-message'],
  ['projectId', '--project-id'],
  ['spec', '--spec'],
  ['trigger', '--trigger'],
  ['visualEvidenceMode', '--visual-evidence-mode'],
];

export function normalizeExecutorTaskWorkspaceStageRunOptions(
  options: ExecutorTaskWorkspaceStageRunCliOptions,
): NormalizedExecutorTaskWorkspaceStageRun {
  if (isOptionProvided(options.snapshot) || isOptionProvided(options.mode) || isOptionProvided(options.workspaceMode)) {
    throw new Error('executor_task_workspace does not use project snapshot options --snapshot, --mode or --workspace-mode.');
  }
  if (isOptionProvided(options.fixture) || isOptionProvided(options.out)) {
    throw new Error('executor_task_workspace uses --task-fixture, --prompt-fixture and --out-dir; do not pass fixture-mode --fixture or --out.');
  }
  if (isOptionProvided(options.executorWorkspaceReport) || isOptionProvided(options.commitMessage)) {
    throw new Error('executor_task_workspace does not use snapshot handoff options --executor-workspace-report or --commit-message.');
  }
  if (isOptionProvided(options.projectId)) {
    throw new Error('executor_task_workspace does not use Arena readback option --project-id.');
  }
  if (isOptionProvided(options.visualWorkbenchCapture)) {
    throw new Error('executor_task_workspace does not use controller visual review options --visual-workbench-capture.');
  }
  if (isOptionProvided(options.spec)) {
    throw new Error('executor_task_workspace does not use planner dry-run option --spec.');
  }
  if (isOptionProvided(options.trigger)) {
    throw new Error('executor_task_workspace does not use controller dry-run option --trigger.');
  }

  const taskFixturePath = requiredString(options.taskFixture, 'executor_task_workspace', '--task-fixture');
  const promptFixturePath = requiredString(options.promptFixture, 'executor_task_workspace', '--prompt-fixture');
  const completionPromise = requiredString(options.completionPromise, 'executor_task_workspace', '--completion-promise');
  const workDir = requiredString(options.workDir, 'executor_task_workspace', '--work-dir');
  const sourceRef = requiredString(options.sourceRef, 'executor_task_workspace', '--source-ref');
  const outDir = requiredString(options.outDir, 'executor_task_workspace', '--out-dir');
  const model = requiredString(options.model, 'executor_task_workspace', '--model');
  const timeoutMinutes = requiredPositiveInteger(options.timeoutMinutes, 'executor_task_workspace', '--timeout-minutes');
  const agentValue = requiredString(options.agent, 'executor_task_workspace', '--agent');
  const agentType = parseSupportedWorkspaceAgent(agentValue, 'executor_task_workspace');
  const visualEvidenceMode = parseVisualEvidenceMode(
    requiredString(options.visualEvidenceMode, 'executor_task_workspace', '--visual-evidence-mode'),
    'executor_task_workspace',
  );

  return {
    taskFixturePath,
    promptFixturePath,
    completionPromise,
    workDir,
    sourceRef,
    outDir,
    agentType,
    model,
    timeoutMinutes,
    promptVariantRef: optionalString(options.promptVariant),
    visualEvidenceMode,
    expectedVisualWorkbenchStoryIds: normalizeRepeatedStrings(options.expectedStory),
  };
}

export function normalizeExecutorTaskWorkspaceContinueStageRunOptions(
  options: ExecutorTaskWorkspaceStageRunCliOptions,
): NormalizedExecutorTaskWorkspaceContinueStageRun {
  const forbidden: Array<[keyof ExecutorTaskWorkspaceStageRunCliOptions, string]> = [
    ['fixture', '--fixture'],
    ['out', '--out'],
    ['snapshot', '--snapshot'],
    ['mode', '--mode'],
    ['workspaceMode', '--workspace-mode'],
    ['commitMessage', '--commit-message'],
    ['projectId', '--project-id'],
    ['visualWorkbenchCapture', '--visual-workbench-capture'],
    ['spec', '--spec'],
    ['trigger', '--trigger'],
  ];
  const labels = forbidden
    .filter(([key]) => isOptionProvided(options[key]))
    .map(([, label]) => label);
  if (labels.length > 0) {
    throw new Error(`executor_task_workspace_continue uses --executor-workspace-report, --task-fixture, --prompt-fixture, --completion-promise, --work-dir, --source-ref, --out-dir, --agent, --model and --timeout-minutes only. Forbidden option(s): ${labels.join(', ')}.`);
  }

  return {
    executorWorkspaceReportPath: requiredString(options.executorWorkspaceReport, 'executor_task_workspace_continue', '--executor-workspace-report'),
    taskFixturePath: requiredString(options.taskFixture, 'executor_task_workspace_continue', '--task-fixture'),
    promptFixturePath: requiredString(options.promptFixture, 'executor_task_workspace_continue', '--prompt-fixture'),
    completionPromise: requiredString(options.completionPromise, 'executor_task_workspace_continue', '--completion-promise'),
    workDir: requiredString(options.workDir, 'executor_task_workspace_continue', '--work-dir'),
    sourceRef: requiredString(options.sourceRef, 'executor_task_workspace_continue', '--source-ref'),
    outDir: requiredString(options.outDir, 'executor_task_workspace_continue', '--out-dir'),
    agentType: parseSupportedWorkspaceAgent(
      requiredString(options.agent, 'executor_task_workspace_continue', '--agent'),
      'executor_task_workspace_continue',
    ),
    model: requiredString(options.model, 'executor_task_workspace_continue', '--model'),
    timeoutMinutes: requiredPositiveInteger(options.timeoutMinutes, 'executor_task_workspace_continue', '--timeout-minutes'),
    promptVariantRef: optionalString(options.promptVariant),
    visualEvidenceMode: parseVisualEvidenceMode(
      requiredString(options.visualEvidenceMode, 'executor_task_workspace_continue', '--visual-evidence-mode'),
      'executor_task_workspace_continue',
    ),
    expectedVisualWorkbenchStoryIds: normalizeRepeatedStrings(options.expectedStory),
  };
}

export function normalizeExecutorProjectTaskStageRunOptions(
  options: ExecutorTaskWorkspaceStageRunCliOptions,
): NormalizedExecutorProjectTaskStageRun {
  const forbidden: Array<[keyof ExecutorTaskWorkspaceStageRunCliOptions, string]> = [
    ['fixture', '--fixture'],
    ['out', '--out'],
    ['taskFixture', '--task-fixture'],
    ['promptFixture', '--prompt-fixture'],
    ['executorWorkspaceReport', '--executor-workspace-report'],
    ['commitMessage', '--commit-message'],
    ['projectId', '--project-id'],
    ['visualWorkbenchCapture', '--visual-workbench-capture'],
    ['spec', '--spec'],
    ['trigger', '--trigger'],
    ['visualEvidenceMode', '--visual-evidence-mode'],
  ];
  const labels = forbidden
    .filter(([key]) => isOptionProvided(options[key]))
    .map(([, label]) => label);
  if (labels.length > 0) {
    throw new Error(`executor_project_task uses --snapshot, --mode, --workspace-mode, --completion-promise, --work-dir, --source-ref, --out-dir, --agent, --model and --timeout-minutes only. Forbidden option(s): ${labels.join(', ')}.`);
  }

  const mode = requiredString(options.mode, 'executor_project_task', '--mode');
  if (mode !== 'new_task' && mode !== 'failed_task' && mode !== 'resume_interrupted') {
    throw new Error('executor_project_task currently supports --mode new_task, --mode failed_task and --mode resume_interrupted only.');
  }
  const workspaceMode = requiredString(options.workspaceMode, 'executor_project_task', '--workspace-mode');
  if (workspaceMode !== 'fork' && workspaceMode !== 'live_workspace_action') {
    throw new Error('executor_project_task currently supports --workspace-mode fork and --workspace-mode live_workspace_action only.');
  }

  return {
    snapshotPath: requiredString(options.snapshot, 'executor_project_task', '--snapshot'),
    mode,
    workspaceMode,
    completionPromise: requiredString(options.completionPromise, 'executor_project_task', '--completion-promise'),
    workDir: workspaceMode === 'fork' ? requiredString(options.workDir, 'executor_project_task', '--work-dir') : optionalString(options.workDir),
    sourceRef: workspaceMode === 'fork' ? requiredString(options.sourceRef, 'executor_project_task', '--source-ref') : optionalString(options.sourceRef),
    outDir: requiredString(options.outDir, 'executor_project_task', '--out-dir'),
    agentType: parseSupportedWorkspaceAgent(
      requiredString(options.agent, 'executor_project_task', '--agent'),
      'executor_project_task',
    ),
    model: requiredString(options.model, 'executor_project_task', '--model'),
    timeoutMinutes: requiredPositiveInteger(options.timeoutMinutes, 'executor_project_task', '--timeout-minutes'),
    promptVariantRef: optionalString(options.promptVariant),
    expectedVisualWorkbenchStoryIds: normalizeRepeatedStrings(options.expectedStory),
  };
}

export function normalizeExecutorWorkspaceSourceSnapshotStageRunOptions(
  options: ExecutorTaskWorkspaceStageRunCliOptions,
): NormalizedExecutorWorkspaceSourceSnapshotStageRun {
  const forbidden: Array<[keyof ExecutorTaskWorkspaceStageRunCliOptions, string]> = [
    ['fixture', '--fixture'],
    ['out', '--out'],
    ['snapshot', '--snapshot'],
    ['mode', '--mode'],
    ['workspaceMode', '--workspace-mode'],
    ['taskFixture', '--task-fixture'],
    ['promptFixture', '--prompt-fixture'],
    ['completionPromise', '--completion-promise'],
    ['agent', '--agent'],
    ['model', '--model'],
    ['timeoutMinutes', '--timeout-minutes'],
    ['promptVariant', '--prompt-variant'],
    ['expectedStory', '--expected-story'],
    ['visualWorkbenchCapture', '--visual-workbench-capture'],
    ['spec', '--spec'],
    ['trigger', '--trigger'],
    ['visualEvidenceMode', '--visual-evidence-mode'],
  ];
  const labels = forbidden
    .filter(([key]) => isOptionProvided(options[key]))
    .map(([, label]) => label);
  if (labels.length > 0) {
    throw new Error(`executor_workspace_source_snapshot uses --executor-workspace-report, --work-dir, --source-ref, --out-dir, --commit-message and optional --project-id only. Forbidden option(s): ${labels.join(', ')}.`);
  }

  return {
    executorWorkspaceReportPath: requiredString(options.executorWorkspaceReport, 'executor_workspace_source_snapshot', '--executor-workspace-report'),
    workDir: requiredString(options.workDir, 'executor_workspace_source_snapshot', '--work-dir'),
    sourceRef: requiredString(options.sourceRef, 'executor_workspace_source_snapshot', '--source-ref'),
    outDir: requiredString(options.outDir, 'executor_workspace_source_snapshot', '--out-dir'),
    commitMessage: requiredString(options.commitMessage, 'executor_workspace_source_snapshot', '--commit-message'),
    projectId: optionalString(options.projectId),
  };
}

export function normalizePlannerProjectDryRunStageRunOptions(
  options: ExecutorTaskWorkspaceStageRunCliOptions,
): NormalizedPlannerProjectDryRunStageRun {
  const forbidden: Array<[keyof ExecutorTaskWorkspaceStageRunCliOptions, string]> = [
    ['fixture', '--fixture'],
    ['out', '--out'],
    ['mode', '--mode'],
    ['workspaceMode', '--workspace-mode'],
    ['taskFixture', '--task-fixture'],
    ['promptFixture', '--prompt-fixture'],
    ['completionPromise', '--completion-promise'],
    ['promptVariant', '--prompt-variant'],
    ['expectedStory', '--expected-story'],
    ['visualWorkbenchCapture', '--visual-workbench-capture'],
    ['executorWorkspaceReport', '--executor-workspace-report'],
    ['commitMessage', '--commit-message'],
    ['projectId', '--project-id'],
    ['trigger', '--trigger'],
  ];
  const labels = forbidden
    .filter(([key]) => isOptionProvided(options[key]))
    .map(([, label]) => label);
  if (labels.length > 0) {
    throw new Error(`planner_project_dry_run uses --snapshot, --work-dir, --source-ref, --spec, --visual-evidence-mode, --out-dir, --agent, --model and --timeout-minutes only. Forbidden option(s): ${labels.join(', ')}.`);
  }

  return {
    snapshotPath: requiredString(options.snapshot, 'planner_project_dry_run', '--snapshot'),
    workDir: requiredString(options.workDir, 'planner_project_dry_run', '--work-dir'),
    sourceRef: requiredString(options.sourceRef, 'planner_project_dry_run', '--source-ref'),
    spec: requiredString(options.spec, 'planner_project_dry_run', '--spec'),
    visualEvidenceMode: parseVisualEvidenceMode(
      requiredString(options.visualEvidenceMode, 'planner_project_dry_run', '--visual-evidence-mode'),
      'planner_project_dry_run',
    ),
    outDir: requiredString(options.outDir, 'planner_project_dry_run', '--out-dir'),
    agentType: parseSupportedWorkspaceAgent(
      requiredString(options.agent, 'planner_project_dry_run', '--agent'),
      'planner_project_dry_run',
    ),
    model: requiredString(options.model, 'planner_project_dry_run', '--model'),
    timeoutMinutes: requiredPositiveInteger(options.timeoutMinutes, 'planner_project_dry_run', '--timeout-minutes'),
  };
}

export function normalizePlannerSpecMigrationApplyStageRunOptions(
  options: ExecutorTaskWorkspaceStageRunCliOptions,
): NormalizedPlannerSpecMigrationApplyStageRun {
  const forbidden: Array<[keyof ExecutorTaskWorkspaceStageRunCliOptions, string]> = [
    ['fixture', '--fixture'],
    ['out', '--out'],
    ['mode', '--mode'],
    ['workspaceMode', '--workspace-mode'],
    ['taskFixture', '--task-fixture'],
    ['promptFixture', '--prompt-fixture'],
    ['completionPromise', '--completion-promise'],
    ['workDir', '--work-dir'],
    ['promptVariant', '--prompt-variant'],
    ['expectedStory', '--expected-story'],
    ['visualWorkbenchCapture', '--visual-workbench-capture'],
    ['executorWorkspaceReport', '--executor-workspace-report'],
    ['commitMessage', '--commit-message'],
    ['projectId', '--project-id'],
    ['spec', '--spec'],
    ['trigger', '--trigger'],
    ['visualEvidenceMode', '--visual-evidence-mode'],
  ];
  const labels = forbidden
    .filter(([key]) => isOptionProvided(options[key]))
    .map(([, label]) => label);
  if (labels.length > 0) {
    throw new Error(`planner_spec_migration_apply uses --snapshot, --source-ref, --out-dir, --agent, --model and --timeout-minutes only. Forbidden option(s): ${labels.join(', ')}.`);
  }

  return {
    snapshotPath: requiredString(options.snapshot, 'planner_spec_migration_apply', '--snapshot'),
    sourceRef: requiredString(options.sourceRef, 'planner_spec_migration_apply', '--source-ref'),
    outDir: requiredString(options.outDir, 'planner_spec_migration_apply', '--out-dir'),
    agentType: parseSupportedWorkspaceAgent(
      requiredString(options.agent, 'planner_spec_migration_apply', '--agent'),
      'planner_spec_migration_apply',
    ),
    model: requiredString(options.model, 'planner_spec_migration_apply', '--model'),
    timeoutMinutes: requiredPositiveInteger(options.timeoutMinutes, 'planner_spec_migration_apply', '--timeout-minutes'),
  };
}

export function normalizeControllerProjectDryRunStageRunOptions(
  options: ExecutorTaskWorkspaceStageRunCliOptions,
): NormalizedControllerProjectDryRunStageRun {
  const forbidden: Array<[keyof ExecutorTaskWorkspaceStageRunCliOptions, string]> = [
    ['fixture', '--fixture'],
    ['out', '--out'],
    ['mode', '--mode'],
    ['workspaceMode', '--workspace-mode'],
    ['taskFixture', '--task-fixture'],
    ['promptFixture', '--prompt-fixture'],
    ['completionPromise', '--completion-promise'],
    ['promptVariant', '--prompt-variant'],
    ['expectedStory', '--expected-story'],
    ['visualWorkbenchCapture', '--visual-workbench-capture'],
    ['executorWorkspaceReport', '--executor-workspace-report'],
    ['commitMessage', '--commit-message'],
    ['projectId', '--project-id'],
  ];
  const labels = forbidden
    .filter(([key]) => isOptionProvided(options[key]))
    .map(([, label]) => label);
  if (labels.length > 0) {
    throw new Error(`controller_project_dry_run uses --snapshot, --work-dir, --source-ref, --spec, --trigger, --visual-evidence-mode, --out-dir, --agent, --model and --timeout-minutes only. Forbidden option(s): ${labels.join(', ')}.`);
  }

  const trigger = parseControllerProjectDryRunTrigger(
    requiredString(options.trigger, 'controller_project_dry_run', '--trigger'),
  );

  return {
    snapshotPath: requiredString(options.snapshot, 'controller_project_dry_run', '--snapshot'),
    workDir: requiredString(options.workDir, 'controller_project_dry_run', '--work-dir'),
    sourceRef: requiredString(options.sourceRef, 'controller_project_dry_run', '--source-ref'),
    spec: requiredString(options.spec, 'controller_project_dry_run', '--spec'),
    trigger,
    visualEvidenceMode: parseVisualEvidenceMode(
      requiredString(options.visualEvidenceMode, 'controller_project_dry_run', '--visual-evidence-mode'),
      'controller_project_dry_run',
    ),
    outDir: requiredString(options.outDir, 'controller_project_dry_run', '--out-dir'),
    agentType: parseSupportedWorkspaceAgent(
      requiredString(options.agent, 'controller_project_dry_run', '--agent'),
      'controller_project_dry_run',
    ),
    model: requiredString(options.model, 'controller_project_dry_run', '--model'),
    timeoutMinutes: requiredPositiveInteger(options.timeoutMinutes, 'controller_project_dry_run', '--timeout-minutes'),
  };
}

export function assertFixtureStageRejectsWorkspaceProviderOptions(
  stageId: string,
  options: ExecutorTaskWorkspaceStageRunCliOptions,
): void {
  const labels = workspaceProviderOptionLabels
    .filter(([key]) => isOptionProvided(options[key]))
    .map(([, label]) => label);

  if (labels.length > 0) {
    throw new Error(`${stageId} is a fixture-mode stage; workspace/provider options are only supported by workspace-mutation stages. Forbidden option(s): ${labels.join(', ')}.`);
  }
}

function parseSupportedWorkspaceAgent(
  agentValue: string,
  stageId: 'executor_task_workspace' | 'executor_task_workspace_continue' | 'executor_project_task' | 'planner_project_dry_run' | 'planner_spec_migration_apply' | 'controller_project_dry_run',
): AgentType {
  let parsed: AgentType;
  try {
    parsed = AgentType.parse(agentValue);
  } catch {
    throw new Error(`${stageId} --agent must be one of: claude-code, codex, opencode. antigravity is not enabled for this stage.`);
  }

  if (parsed === 'antigravity') {
    throw new Error(`${stageId} --agent antigravity is not enabled because its current CLI contract does not support explicit model selection.`);
  }
  return parsed;
}

function requiredString(value: unknown, stageId: string, flag: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${stageId} requires explicit ${flag}.`);
  }
  return value.trim();
}

function requiredPositiveInteger(value: unknown, stageId: string, flag: string): number {
  const raw = requiredString(value, stageId, flag);
  if (!/^\d+$/.test(raw)) {
    throw new Error(`${stageId} requires ${flag} to be a positive integer number of minutes.`);
  }
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${stageId} requires ${flag} to be a positive integer number of minutes.`);
  }
  return parsed;
}

function parseVisualEvidenceMode(value: string, stageId: string): VisualEvidenceMode {
  try {
    return VisualEvidenceModeSchema.parse(value);
  } catch {
    throw new Error(`${stageId} --visual-evidence-mode must be one of: off, required, new_tasks_only.`);
  }
}

function parseControllerProjectDryRunTrigger(value: string): NormalizedControllerProjectDryRunStageRun['trigger'] {
  if (
    value === 'phase_complete'
    || value === 'periodic'
    || value === 'failure_threshold'
    || value === 'replan'
    || value === 'manual'
    || value === 'final'
    || value === 'spec_migration'
  ) {
    return value;
  }
  throw new Error('controller_project_dry_run --trigger must be one of: phase_complete, periodic, failure_threshold, replan, manual, final, spec_migration. startup is intentionally forbidden.');
}

function optionalString(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  return value.trim();
}

function normalizeRepeatedStrings(value: unknown): string[] {
  if (!isOptionProvided(value)) return [];
  const values = Array.isArray(value) ? value : [value];
  return values
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean);
}

function isOptionProvided(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0;
  return value !== undefined && value !== null && value !== false;
}
