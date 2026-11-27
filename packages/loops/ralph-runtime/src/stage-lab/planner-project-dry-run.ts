import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import type { Stats } from 'node:fs';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import fs from 'fs-extra';
import { z } from 'zod';
import type { Agent, AgentOptions } from '../agents/base.js';
import type { AgentResult, Phase, VisualEvidenceMode } from '../config/types.js';
import { ProjectConfigSchema, VisualEvidenceModeSchema } from '../config/types.js';
import { Planner, PLANNER_INITIAL_DRY_RUN_OWNER_BOUNDARY } from '../planning/planner.js';
import { assertOutputDirOutsideWorkDir, assertStageFixturePathAllowed, sha256 } from './stage-io.js';

const execFileAsync = promisify(execFile);

export const PLANNER_PROJECT_DRY_RUN_RESULT_SCHEMA_VERSION = 'ra-356.planner-project-dry-run-result.v0' as const;
export const PLANNER_PROJECT_DRY_RUN_REPORT_FILE = 'planner-project-dry-run.json' as const;

const PROJECT_STAGE_SNAPSHOT_SCHEMA_VERSION = 'ra-356.project-stage-snapshot.v1' as const;

const ProjectStageSnapshotSchema = z.object({
  schemaVersion: z.literal(PROJECT_STAGE_SNAPSHOT_SCHEMA_VERSION),
  projectId: z.string().min(1),
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
  plan: z.object({
    status: z.enum(['ready', 'missing', 'invalid', 'unavailable']),
    reasonCode: z.string().nullable().optional(),
    specFile: z.string().nullable().optional(),
  }).passthrough(),
}).passthrough();

type ProjectStageSnapshot = z.infer<typeof ProjectStageSnapshotSchema>;

export type PlannerProjectDryRunAgent = Pick<Agent, 'name' | 'execute'>;

export type PlannerProjectDryRunResult = {
  schemaVersion: typeof PLANNER_PROJECT_DRY_RUN_RESULT_SCHEMA_VERSION;
  stage: {
    stageId: 'planner_project_dry_run';
    mode: 'workspace_dry_run';
    ownerBoundary: 'ralph.planner.dry-run-adapter';
    projectStageSnapshot: {
      schemaVersion: typeof PROJECT_STAGE_SNAPSHOT_SCHEMA_VERSION;
      ownerBoundary: 'arena-ctl.project-stage-snapshot';
    };
    allowedMutations: string[];
    forbiddenMutations: string[];
    handoff: string[];
  };
  status: 'completed' | 'blocked' | 'agent_failed' | 'parse_or_validation_failed' | 'forbidden_mutation';
  input: {
    snapshotPath: string | null;
    projectId: string;
    liveWorkspacePath: string | null;
    workDir: string;
    sourceRef: string;
    snapshotSourceRef: string | null;
    spec: string;
    specPath: string;
    projectConfigPath: string;
    visualEvidenceMode: VisualEvidenceMode;
    outDir: string;
  };
  source: {
    requestedSourceRef: string;
    resolvedSourceRef: string | null;
    headBefore: string | null;
    headAfter: string | null;
    headChanged: boolean;
    beforeGitStatus: string[] | null;
    afterGitStatus: string[] | null;
    changedFilesFromGitStatus: string[];
  };
  prepared: null | {
    promptId: 'planner.initial';
    promptSha256: string;
    promptCharCount: number;
    specSha256: string;
    specCharCount: number;
    projectConfigSha256: string;
    acceptedDiffRequiredItemCount: number;
  };
  agent: {
    name: string;
    model: string | null;
    timeoutMinutes: number | null;
    outputSha256: string | null;
    outputCharCount: number | null;
    declaredFilesChanged: string[];
    providerSessionId: string | null;
    success: boolean | null;
    errorCategory: string | null;
    errorMessage: string | null;
  };
  plannerOutput: {
    ownerBoundary: typeof PLANNER_INITIAL_DRY_RUN_OWNER_BOUNDARY | null;
    status: 'parsed' | 'agent_failed' | 'parse_or_validation_failed' | null;
    projectGoal: string | null;
    phases: Phase[];
    judgments: unknown[];
    summary: {
      phaseCount: number;
      taskCount: number;
      judgmentCount: number;
      feedbackDispositionCount: number;
      tasksByStatus: Record<string, number>;
    } | null;
  };
  output: {
    outDir: string;
    reportPath: string;
  };
  error: null | {
    code:
      | 'plan_not_ready'
      | 'source_workspace_unavailable'
      | 'source_ref_unavailable'
      | 'source_ref_not_snapshot_commit'
      | 'live_workspace_forbidden'
      | 'source_ref_mismatch'
      | 'workspace_dirty'
      | 'project_config_missing'
      | 'project_config_invalid'
      | 'spec_ref_mismatch'
      | 'spec_missing'
      | 'agent_failed'
      | 'parse_or_validation_failed'
      | 'post_git_status_unavailable'
      | 'head_changed'
      | 'forbidden_mutation';
    message: string;
  };
  notes: string[];
};

export async function runPlannerProjectDryRun(input: {
  snapshot: unknown;
  snapshotPath?: string | null;
  workDir: string;
  sourceRef: string;
  spec: string;
  visualEvidenceMode: VisualEvidenceMode;
  outDir: string;
  agent: PlannerProjectDryRunAgent;
  model?: string | null;
  timeoutMinutes?: number | null;
}): Promise<PlannerProjectDryRunResult> {
  const snapshot = ProjectStageSnapshotSchema.parse(input.snapshot);
  const workDir = resolve(input.workDir);
  const outDir = resolve(input.outDir);
  await assertExistingDirectory(workDir, 'planner_project_dry_run --work-dir');
  assertOutputDirOutsideWorkDir({
    stageId: 'planner_project_dry_run',
    workDir,
    outDir,
  });
  const reportPath = resolve(outDir, PLANNER_PROJECT_DRY_RUN_REPORT_FILE);
  if (await fs.pathExists(reportPath)) {
    throw new Error(`planner_project_dry_run --out-dir already contains ${PLANNER_PROJECT_DRY_RUN_REPORT_FILE}; refusing to overwrite experiment output.`);
  }
  await fs.ensureDir(outDir);

  const sourceRef = input.sourceRef.trim();
  const spec = normalizeWorkDirRelativePath(input.spec, 'planner_project_dry_run --spec');
  const specPath = resolve(workDir, spec);
  const projectConfigPath = resolve(workDir, 'project.config.json');
  const visualEvidenceMode = VisualEvidenceModeSchema.parse(input.visualEvidenceMode);
  const baseInput = {
    snapshot,
    snapshotPath: input.snapshotPath ?? null,
    workDir,
    sourceRef,
    spec,
    specPath,
    projectConfigPath,
    visualEvidenceMode,
    outDir,
    reportPath,
    agentName: input.agent.name,
    model: input.model ?? null,
    timeoutMinutes: input.timeoutMinutes ?? null,
  };

  const validationBlocker = await validatePlannerProjectDryRunInput(baseInput);
  if (validationBlocker) {
    return writePlannerProjectDryRunResult(basePlannerProjectDryRunResult({
      ...baseInput,
      resolvedSourceRef: null,
      headBefore: null,
      headAfter: null,
      beforeGitStatus: null,
      afterGitStatus: null,
      changedFilesFromGitStatus: [],
      prepared: null,
      agent: emptyAgentSummary(input.agent.name, input.model ?? null, input.timeoutMinutes ?? null),
      plannerOutput: emptyPlannerOutput(),
      status: 'blocked',
      error: validationBlocker,
    }));
  }

  const sourceResolution = await resolveAndValidateSourceRef({ workDir, sourceRef });
  if (sourceResolution.error) {
    return writePlannerProjectDryRunResult(basePlannerProjectDryRunResult({
      ...baseInput,
      resolvedSourceRef: sourceResolution.resolvedSourceRef,
      headBefore: sourceResolution.headRef,
      headAfter: sourceResolution.headRef,
      beforeGitStatus: null,
      afterGitStatus: null,
      changedFilesFromGitStatus: [],
      prepared: null,
      agent: emptyAgentSummary(input.agent.name, input.model ?? null, input.timeoutMinutes ?? null),
      plannerOutput: emptyPlannerOutput(),
      status: 'blocked',
      error: sourceResolution.error,
    }));
  }

  const beforeGitStatus = await gitStatus(workDir);
  if (beforeGitStatus == null) {
    return writePlannerProjectDryRunResult(basePlannerProjectDryRunResult({
      ...baseInput,
      resolvedSourceRef: sourceResolution.resolvedSourceRef,
      headBefore: sourceResolution.headRef,
      headAfter: sourceResolution.headRef,
      beforeGitStatus,
      afterGitStatus: null,
      changedFilesFromGitStatus: [],
      prepared: null,
      agent: emptyAgentSummary(input.agent.name, input.model ?? null, input.timeoutMinutes ?? null),
      plannerOutput: emptyPlannerOutput(),
      status: 'blocked',
      error: {
        code: 'source_ref_unavailable',
        message: 'planner_project_dry_run requires git status evidence before running the planner stage.',
      },
    }));
  }
  if (beforeGitStatus.length > 0) {
    return writePlannerProjectDryRunResult(basePlannerProjectDryRunResult({
      ...baseInput,
      resolvedSourceRef: sourceResolution.resolvedSourceRef,
      headBefore: sourceResolution.headRef,
      headAfter: sourceResolution.headRef,
      beforeGitStatus,
      afterGitStatus: beforeGitStatus,
      changedFilesFromGitStatus: parseGitStatusChangedFiles(beforeGitStatus),
      prepared: null,
      agent: emptyAgentSummary(input.agent.name, input.model ?? null, input.timeoutMinutes ?? null),
      plannerOutput: emptyPlannerOutput(),
      status: 'blocked',
      error: {
        code: 'workspace_dirty',
        message: 'planner_project_dry_run requires a clean forked workspace before running the planner stage.',
      },
    }));
  }

  const projectConfigRaw = await fs.readJson(projectConfigPath);
  const projectConfigContent = await fs.readFile(projectConfigPath, 'utf8');
  let projectConfig;
  try {
    projectConfig = ProjectConfigSchema.parse(projectConfigRaw);
  } catch (error) {
    return writePlannerProjectDryRunResult(basePlannerProjectDryRunResult({
      ...baseInput,
      resolvedSourceRef: sourceResolution.resolvedSourceRef,
      headBefore: sourceResolution.headRef,
      headAfter: sourceResolution.headRef,
      beforeGitStatus,
      afterGitStatus: beforeGitStatus,
      changedFilesFromGitStatus: [],
      prepared: null,
      agent: emptyAgentSummary(input.agent.name, input.model ?? null, input.timeoutMinutes ?? null),
      plannerOutput: emptyPlannerOutput(),
      status: 'blocked',
      error: {
        code: 'project_config_invalid',
        message: `planner_project_dry_run project.config.json is invalid: ${error instanceof Error ? error.message : String(error)}`,
      },
    }));
  }

  const planner = new Planner();
  const dryRunResult = await planner.dryRunInitialPlan({
    workDir,
    specPath,
    projectConfig,
    agent: input.agent as Agent,
    model: input.model ?? undefined,
    timeoutMinutes: input.timeoutMinutes ?? null,
    verbose: false,
    visualEvidenceMode,
  });

  const afterHead = await gitValue(workDir, ['rev-parse', 'HEAD']);
  const afterGitStatus = await gitStatus(workDir);
  const agentSummary = buildAgentResultSummary(input.agent.name, input.model ?? null, input.timeoutMinutes ?? null, dryRunResult.agentResult);
  const prepared = {
    promptId: dryRunResult.promptId,
    promptSha256: `sha256:${sha256(dryRunResult.prompt)}`,
    promptCharCount: dryRunResult.prompt.length,
    specSha256: `sha256:${dryRunResult.spec.sha256}`,
    specCharCount: dryRunResult.spec.charCount,
    projectConfigSha256: `sha256:${sha256(projectConfigContent)}`,
    acceptedDiffRequiredItemCount: dryRunResult.acceptedDiff.requiredItemCount,
  };
  if (afterGitStatus == null) {
    return writePlannerProjectDryRunResult(basePlannerProjectDryRunResult({
      ...baseInput,
      resolvedSourceRef: sourceResolution.resolvedSourceRef,
      headBefore: sourceResolution.headRef,
      headAfter: afterHead,
      beforeGitStatus,
      afterGitStatus,
      changedFilesFromGitStatus: [],
      prepared,
      agent: agentSummary,
      plannerOutput: buildPlannerOutput(dryRunResult),
      status: 'forbidden_mutation',
      error: {
        code: 'post_git_status_unavailable',
        message: 'planner_project_dry_run requires git status evidence after the agent call; failing closed.',
      },
    }));
  }

  const changedFilesFromGitStatus = parseGitStatusChangedFiles(afterGitStatus);
  const headChanged = afterHead !== sourceResolution.headRef;
  const forbiddenMutation = headChanged || changedFilesFromGitStatus.length > 0;
  const status = forbiddenMutation
    ? 'forbidden_mutation'
    : dryRunResult.status === 'parsed'
      ? 'completed'
      : dryRunResult.status;
  const error = headChanged
    ? {
      code: 'head_changed' as const,
      message: `planner_project_dry_run must not change HEAD; before=${sourceResolution.headRef}, after=${afterHead ?? 'unavailable'}.`,
    }
    : changedFilesFromGitStatus.length > 0
      ? {
        code: 'forbidden_mutation' as const,
        message: `planner_project_dry_run must not mutate the source workspace; changed paths: ${changedFilesFromGitStatus.join(', ')}`,
      }
      : dryRunResult.error;

  return writePlannerProjectDryRunResult(basePlannerProjectDryRunResult({
    ...baseInput,
    resolvedSourceRef: sourceResolution.resolvedSourceRef,
    headBefore: sourceResolution.headRef,
    headAfter: afterHead,
    beforeGitStatus,
    afterGitStatus,
    changedFilesFromGitStatus,
    prepared,
    agent: agentSummary,
    plannerOutput: buildPlannerOutput(dryRunResult),
    status,
    error,
  }));
}

export async function runPlannerProjectDryRunFiles(input: {
  snapshotPath: string;
  workDir: string;
  sourceRef: string;
  spec: string;
  visualEvidenceMode: VisualEvidenceMode;
  outDir: string;
  agent: PlannerProjectDryRunAgent;
  model?: string | null;
  timeoutMinutes?: number | null;
}): Promise<PlannerProjectDryRunResult> {
  const snapshotPath = resolve(input.snapshotPath);
  assertStageFixturePathAllowed(snapshotPath, 'planner_project_dry_run --snapshot');
  return runPlannerProjectDryRun({
    snapshot: await fs.readJson(snapshotPath),
    snapshotPath,
    workDir: input.workDir,
    sourceRef: input.sourceRef,
    spec: input.spec,
    visualEvidenceMode: input.visualEvidenceMode,
    outDir: input.outDir,
    agent: input.agent,
    model: input.model,
    timeoutMinutes: input.timeoutMinutes,
  });
}

export function formatPlannerProjectDryRunResult(
  result: PlannerProjectDryRunResult,
  compact = false,
): string {
  return `${JSON.stringify(result, null, compact ? 0 : 2)}\n`;
}

async function validatePlannerProjectDryRunInput(input: {
  snapshot: ProjectStageSnapshot;
  workDir: string;
  sourceRef: string;
  spec: string;
  specPath: string;
  projectConfigPath: string;
}): Promise<PlannerProjectDryRunResult['error']> {
  const { snapshot } = input;
  if (!snapshot.source.workspace.available || snapshot.source.workspace.isGitRepo !== true) {
    return {
      code: 'source_workspace_unavailable',
      message: 'planner_project_dry_run requires Project Stage Snapshot source.workspace to be available and a git repo.',
    };
  }
  const snapshotSourceRef = snapshot.source.workspace.commitSha?.trim() || null;
  if (!snapshotSourceRef || !input.sourceRef.trim()) {
    return {
      code: 'source_ref_unavailable',
      message: 'planner_project_dry_run requires explicit --source-ref matching the snapshot source commit.',
    };
  }
  if (input.sourceRef.trim() !== snapshotSourceRef) {
    return {
      code: 'source_ref_not_snapshot_commit',
      message: `planner_project_dry_run --source-ref must equal snapshot source commit ${snapshotSourceRef}; got ${input.sourceRef.trim()}.`,
    };
  }

  const liveWorkspacePath = snapshot.source.workspace.path?.trim() || null;
  if (liveWorkspacePath && await pathsResolveToSameLocation(input.workDir, liveWorkspacePath)) {
    return {
      code: 'live_workspace_forbidden',
      message: 'planner_project_dry_run --work-dir must be an explicit fork workspace, not the live Project Stage Snapshot workspace path.',
    };
  }

  const snapshotSpecFile = snapshot.plan.specFile?.trim() || null;
  if (snapshot.plan.status === 'ready' && snapshotSpecFile && snapshotSpecFile !== input.spec) {
    return {
      code: 'spec_ref_mismatch',
      message: `planner_project_dry_run --spec must match snapshot plan.specFile ${snapshotSpecFile}; got ${input.spec}.`,
    };
  }

  if (!await fs.pathExists(input.specPath)) {
    return {
      code: 'spec_missing',
      message: `planner_project_dry_run --spec file does not exist in workDir: ${input.spec}`,
    };
  }
  if (!await fs.pathExists(input.projectConfigPath)) {
    return {
      code: 'project_config_missing',
      message: 'planner_project_dry_run requires project.config.json in the explicit forked workDir; it does not use a generated fallback config.',
    };
  }

  return null;
}

function basePlannerProjectDryRunResult(input: {
  snapshot: ProjectStageSnapshot;
  snapshotPath: string | null;
  workDir: string;
  sourceRef: string;
  spec: string;
  specPath: string;
  projectConfigPath: string;
  visualEvidenceMode: VisualEvidenceMode;
  outDir: string;
  reportPath: string;
  resolvedSourceRef: string | null;
  headBefore: string | null;
  headAfter: string | null;
  beforeGitStatus: string[] | null;
  afterGitStatus: string[] | null;
  changedFilesFromGitStatus: string[];
  prepared: PlannerProjectDryRunResult['prepared'];
  agent: PlannerProjectDryRunResult['agent'];
  plannerOutput: PlannerProjectDryRunResult['plannerOutput'];
  status: PlannerProjectDryRunResult['status'];
  error: PlannerProjectDryRunResult['error'];
}): PlannerProjectDryRunResult {
  return {
    schemaVersion: PLANNER_PROJECT_DRY_RUN_RESULT_SCHEMA_VERSION,
    stage: {
      stageId: 'planner_project_dry_run',
      mode: 'workspace_dry_run',
      ownerBoundary: 'ralph.planner.dry-run-adapter',
      projectStageSnapshot: {
        schemaVersion: PROJECT_STAGE_SNAPSHOT_SCHEMA_VERSION,
        ownerBoundary: 'arena-ctl.project-stage-snapshot',
      },
      allowedMutations: [
        input.outDir,
      ],
      forbiddenMutations: [
        'live Project Stage Snapshot workspace path',
        'source workspace mutations',
        'live lifecycle/runtime/source/task/proof/evidence/progress writes',
        '.ralph/plan.json',
        '.ralph/decisions-log.json',
        '.ralph/prompt-traces/',
        '.ralph/controller-reports/',
        '.ralph/agent-logs/',
        '.ralph/evidence/',
        '.arena/',
        'remote git push',
        'deploy/relaunch/retry/recreate/unblock',
        'executor or controller auto-start',
      ],
      handoff: [
        'inspect_planner_project_dry_run_report',
        'rerun_with_adjusted_prompt_or_visual_mode_if_selected',
        'run_executor_project_task_later_if_a_task_is_selected',
        'discard_experiment_output',
      ],
    },
    status: input.status,
    input: {
      snapshotPath: input.snapshotPath,
      projectId: input.snapshot.projectId,
      liveWorkspacePath: input.snapshot.source.workspace.path?.trim() || null,
      workDir: input.workDir,
      sourceRef: input.sourceRef,
      snapshotSourceRef: input.snapshot.source.workspace.commitSha?.trim() || null,
      spec: input.spec,
      specPath: input.specPath,
      projectConfigPath: input.projectConfigPath,
      visualEvidenceMode: input.visualEvidenceMode,
      outDir: input.outDir,
    },
    source: {
      requestedSourceRef: input.sourceRef,
      resolvedSourceRef: input.resolvedSourceRef,
      headBefore: input.headBefore,
      headAfter: input.headAfter,
      headChanged: input.headBefore !== input.headAfter,
      beforeGitStatus: input.beforeGitStatus,
      afterGitStatus: input.afterGitStatus,
      changedFilesFromGitStatus: input.changedFilesFromGitStatus,
    },
    prepared: input.prepared,
    agent: input.agent,
    plannerOutput: input.plannerOutput,
    output: {
      outDir: input.outDir,
      reportPath: input.reportPath,
    },
    error: input.error,
    notes: [
      'planner_project_dry_run consumes one Project Stage Snapshot and one explicit fork workspace; it does not read live project truth again.',
      'It calls the existing Planner dry-run owner and does not write .ralph/plan.json, prompt traces, judgments, task evidence, progress, runtime intent or lifecycle truth.',
      'It performs one provider call and no hidden retries so operator token spend and behavior remain observable.',
      'This result is disposable experiment output, not project/task/proof truth.',
    ],
  };
}

function buildPlannerOutput(dryRunResult: Awaited<ReturnType<Planner['dryRunInitialPlan']>>): PlannerProjectDryRunResult['plannerOutput'] {
  const validated = dryRunResult.validatedOutput;
  if (!validated) {
    return {
      ownerBoundary: dryRunResult.ownerBoundary,
      status: dryRunResult.status,
      projectGoal: null,
      phases: [],
      judgments: [],
      summary: null,
    };
  }

  const tasks = validated.phases.flatMap((phase) => phase.tasks);
  const tasksByStatus: Record<string, number> = {};
  for (const task of tasks) {
    tasksByStatus[task.status] = (tasksByStatus[task.status] ?? 0) + 1;
  }

  return {
    ownerBoundary: dryRunResult.ownerBoundary,
    status: dryRunResult.status,
    projectGoal: validated.projectGoal ?? null,
    phases: validated.phases,
    judgments: validated.judgments,
    summary: {
      phaseCount: validated.phases.length,
      taskCount: tasks.length,
      judgmentCount: validated.judgments.length,
      feedbackDispositionCount: validated.feedbackDispositions?.length ?? 0,
      tasksByStatus,
    },
  };
}

function buildAgentResultSummary(
  agentName: string,
  model: string | null,
  timeoutMinutes: number | null,
  agentResult: AgentResult,
): PlannerProjectDryRunResult['agent'] {
  return {
    name: agentName,
    model,
    timeoutMinutes,
    outputSha256: `sha256:${sha256(agentResult.output)}`,
    outputCharCount: agentResult.output.length,
    declaredFilesChanged: agentResult.filesChanged ?? [],
    providerSessionId: agentResult.providerSession?.id ?? null,
    success: agentResult.success,
    errorCategory: agentResult.error?.category ?? null,
    errorMessage: agentResult.error?.message ?? null,
  };
}

function emptyAgentSummary(
  agentName: string,
  model: string | null,
  timeoutMinutes: number | null,
): PlannerProjectDryRunResult['agent'] {
  return {
    name: agentName,
    model,
    timeoutMinutes,
    outputSha256: null,
    outputCharCount: null,
    declaredFilesChanged: [],
    providerSessionId: null,
    success: null,
    errorCategory: null,
    errorMessage: null,
  };
}

function emptyPlannerOutput(): PlannerProjectDryRunResult['plannerOutput'] {
  return {
    ownerBoundary: null,
    status: null,
    projectGoal: null,
    phases: [],
    judgments: [],
    summary: null,
  };
}

async function writePlannerProjectDryRunResult(result: PlannerProjectDryRunResult): Promise<PlannerProjectDryRunResult> {
  await fs.ensureDir(dirname(result.output.reportPath));
  await fs.writeJson(result.output.reportPath, result, { spaces: 2 });
  return result;
}

async function assertExistingDirectory(pathToCheck: string, label: string): Promise<void> {
  let stat: Stats;
  try {
    stat = await fs.stat(pathToCheck);
  } catch {
    throw new Error(`${label} must exist and be a directory.`);
  }
  if (!stat.isDirectory()) {
    throw new Error(`${label} must exist and be a directory.`);
  }
}

async function resolveAndValidateSourceRef(input: { workDir: string; sourceRef: string }): Promise<{
  resolvedSourceRef: string | null;
  headRef: string | null;
  error: null | {
    code: 'source_ref_unavailable' | 'source_ref_mismatch';
    message: string;
  };
}> {
  const gitRoot = await gitValue(input.workDir, ['rev-parse', '--show-toplevel']);
  const resolvedSourceRef = await gitValue(input.workDir, ['rev-parse', input.sourceRef]);
  const headRef = await gitValue(input.workDir, ['rev-parse', 'HEAD']);
  if (!gitRoot || !resolvedSourceRef || !headRef) {
    return {
      resolvedSourceRef,
      headRef,
      error: {
        code: 'source_ref_unavailable',
        message: 'planner_project_dry_run requires a git workspace and a resolvable explicit sourceRef.',
      },
    };
  }
  const realGitRoot = await fs.realpath(resolve(gitRoot));
  const realWorkDir = await fs.realpath(resolve(input.workDir));
  if (realGitRoot !== realWorkDir) {
    return {
      resolvedSourceRef,
      headRef,
      error: {
        code: 'source_ref_unavailable',
        message: 'planner_project_dry_run workDir must be the git workspace root.',
      },
    };
  }
  if (resolvedSourceRef !== headRef) {
    return {
      resolvedSourceRef,
      headRef,
      error: {
        code: 'source_ref_mismatch',
        message: `planner_project_dry_run sourceRef ${resolvedSourceRef} does not match current workspace HEAD ${headRef}.`,
      },
    };
  }
  return { resolvedSourceRef, headRef, error: null };
}

async function gitStatus(cwd: string): Promise<string[] | null> {
  const raw = await gitRawValue(cwd, ['status', '--porcelain', '-uall']);
  if (raw == null) return null;
  return raw.split('\n').filter(Boolean);
}

async function gitValue(cwd: string, args: string[]): Promise<string | null> {
  const raw = await gitRawValue(cwd, args);
  return raw?.trim() || null;
}

async function gitRawValue(cwd: string, args: string[]): Promise<string | null> {
  try {
    const result = await execFileAsync('git', args, {
      cwd,
      timeout: 10_000,
      maxBuffer: 1024 * 1024,
    });
    return result.stdout;
  } catch {
    return null;
  }
}

function parseGitStatusChangedFiles(statusLines: string[]): string[] {
  return Array.from(new Set(statusLines.flatMap((line) => {
    const rawPath = line.slice(3).trim();
    if (!rawPath) return [];
    const renameParts = rawPath.split(' -> ').map((part) => part.trim()).filter(Boolean);
    return renameParts.length > 1 ? renameParts : [rawPath];
  })));
}

function normalizeWorkDirRelativePath(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${label} must be a non-empty workDir-relative path.`);
  if (isAbsolute(trimmed)) throw new Error(`${label} must be relative to --work-dir, not absolute.`);
  const normalized = trimmed.split(/[\\/]+/).filter(Boolean).join('/');
  const parts = normalized.split('/');
  if (!normalized || parts.includes('.') || parts.includes('..')) {
    throw new Error(`${label} must stay inside --work-dir.`);
  }
  if (parts.includes('.ralph') || parts.includes('.arena')) {
    throw new Error(`${label} must be outside .ralph and .arena source-truth directories.`);
  }
  return normalized;
}

async function pathsResolveToSameLocation(firstPath: string, secondPath: string): Promise<boolean> {
  try {
    const firstReal = await fs.realpath(resolve(firstPath));
    const secondReal = await fs.realpath(resolve(secondPath));
    return firstReal === secondReal;
  } catch {
    return resolve(firstPath) === resolve(secondPath);
  }
}
