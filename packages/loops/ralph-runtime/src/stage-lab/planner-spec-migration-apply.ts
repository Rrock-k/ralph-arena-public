import { dirname, isAbsolute, resolve } from 'node:path';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import fs from 'fs-extra';
import { z } from 'zod';
import type { Agent } from '../agents/base.js';
import type { ProjectConfig, VisualEvidenceMode } from '../config/types.js';
import { ProjectConfigSchema, VisualEvidenceModeSchema } from '../config/types.js';
import { applyPendingSpecMigrations, type PendingSpecMigrationApplyResult } from '../planning/spec-migration-apply.js';
import { JudgmentLog } from '../planning/judgments.js';
import { PlanManager } from '../planning/plan-manager.js';
import { Planner, PlannerAgentFailure } from '../planning/planner.js';
import { assertOutputDirOutsideWorkDir, assertStageFixturePathAllowed, sha256 } from './stage-io.js';

const execFileAsync = promisify(execFile);

export const PLANNER_SPEC_MIGRATION_APPLY_RESULT_SCHEMA_VERSION = 'ra-356.planner-spec-migration-apply-result.v0' as const;
export const PLANNER_SPEC_MIGRATION_APPLY_REPORT_FILE = 'planner-spec-migration-apply.json' as const;

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
  }).passthrough(),
}).passthrough();

type ProjectStageSnapshot = z.infer<typeof ProjectStageSnapshotSchema>;

export type PlannerSpecMigrationApplyAgent = Pick<Agent, 'name' | 'execute'>;

export type PlannerSpecMigrationApplyResult = {
  schemaVersion: typeof PLANNER_SPEC_MIGRATION_APPLY_RESULT_SCHEMA_VERSION;
  stage: {
    stageId: 'planner_spec_migration_apply';
    mode: 'workspace_mutation';
    ownerBoundary: 'ralph.planner-spec-migration-apply';
    projectStageSnapshot: {
      schemaVersion: typeof PROJECT_STAGE_SNAPSHOT_SCHEMA_VERSION;
      ownerBoundary: 'arena-ctl.project-stage-snapshot';
    };
    allowedMutations: string[];
    forbiddenMutations: string[];
    handoff: string[];
  };
  status: 'completed' | 'blocked' | 'agent_failed' | 'apply_failed' | 'forbidden_mutation';
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
    visualEvidenceMode: VisualEvidenceMode | null;
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
    allowedChangedFiles: string[];
    forbiddenChangedFiles: string[];
  };
  prepared: null | {
    planPath: string;
    planBeforeSha256: string;
    specSha256: string;
    specCharCount: number;
    projectConfigSha256: string;
  };
  provider: {
    name: string;
    model: string | null;
    timeoutMinutes: number | null;
  };
  applyOutput: PendingSpecMigrationApplyResult | null;
  output: {
    outDir: string;
    reportPath: string;
  };
  error: null | {
    code:
      | 'plan_not_ready'
      | 'source_workspace_unavailable'
      | 'source_workspace_path_unavailable'
      | 'source_ref_unavailable'
      | 'source_ref_not_snapshot_commit'
      | 'source_ref_mismatch'
      | 'workspace_dirty'
      | 'project_config_missing'
      | 'project_config_invalid'
      | 'spec_file_unavailable'
      | 'spec_ref_invalid'
      | 'spec_missing'
      | 'plan_file_missing'
      | 'plan_file_invalid'
      | 'visual_evidence_policy_not_ready'
      | 'post_git_status_unavailable'
      | 'head_changed'
      | 'forbidden_mutation'
      | 'agent_failed'
      | 'apply_failed';
    message: string;
  };
  notes: string[];
};

export async function runPlannerSpecMigrationApply(input: {
  snapshot: unknown;
  snapshotPath?: string | null;
  sourceRef: string;
  outDir: string;
  agent: PlannerSpecMigrationApplyAgent;
  model?: string | null;
  timeoutMinutes?: number | null;
}): Promise<PlannerSpecMigrationApplyResult> {
  const snapshot = ProjectStageSnapshotSchema.parse(input.snapshot);
  const liveWorkspacePath = snapshot.source.workspace.path?.trim() || null;
  const workDir = liveWorkspacePath ? resolve(liveWorkspacePath) : '';
  const outDir = resolve(input.outDir);
  if (workDir) {
    assertOutputDirOutsideWorkDir({
      stageId: 'planner_spec_migration_apply',
      workDir,
      outDir,
    });
  }
  const reportPath = resolve(outDir, PLANNER_SPEC_MIGRATION_APPLY_REPORT_FILE);
  if (await fs.pathExists(reportPath)) {
    throw new Error(`planner_spec_migration_apply --out-dir already contains ${PLANNER_SPEC_MIGRATION_APPLY_REPORT_FILE}; refusing to overwrite experiment output.`);
  }
  await fs.ensureDir(outDir);

  const sourceRef = input.sourceRef.trim();
  const snapshotSpecFile = snapshot.plan.specFile?.trim() || null;
  let spec = '';
  let specRefError: PlannerSpecMigrationApplyResult['error'] = null;
  if (snapshotSpecFile) {
    try {
      spec = normalizeWorkDirRelativePath(snapshotSpecFile, 'planner_spec_migration_apply snapshot plan.specFile');
    } catch (error) {
      specRefError = {
        code: 'spec_ref_invalid',
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }
  const specPath = workDir && spec ? resolve(workDir, spec) : '';
  const projectConfigPath = workDir ? resolve(workDir, 'project.config.json') : '';
  const visualEvidenceMode = snapshot.visualEvidencePolicy.visualEvidenceMode
    ? VisualEvidenceModeSchema.parse(snapshot.visualEvidencePolicy.visualEvidenceMode)
    : null;
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
    providerName: input.agent.name,
    model: input.model ?? null,
    timeoutMinutes: input.timeoutMinutes ?? null,
  };

  const validationBlocker = await validatePlannerSpecMigrationApplyInput(baseInput);
  if (specRefError || validationBlocker) {
    return writePlannerSpecMigrationApplyResult(basePlannerSpecMigrationApplyResult({
      ...baseInput,
      resolvedSourceRef: null,
      headBefore: null,
      headAfter: null,
      beforeGitStatus: null,
      afterGitStatus: null,
      changedFilesFromGitStatus: [],
      prepared: null,
      applyOutput: null,
      status: 'blocked',
      error: specRefError ?? validationBlocker,
    }));
  }
  const requiredVisualEvidenceMode = visualEvidenceMode;
  if (!requiredVisualEvidenceMode) {
    return writePlannerSpecMigrationApplyResult(basePlannerSpecMigrationApplyResult({
      ...baseInput,
      resolvedSourceRef: null,
      headBefore: null,
      headAfter: null,
      beforeGitStatus: null,
      afterGitStatus: null,
      changedFilesFromGitStatus: [],
      prepared: null,
      applyOutput: null,
      status: 'blocked',
      error: {
        code: 'visual_evidence_policy_not_ready',
        message: 'planner_spec_migration_apply requires a ready visualEvidenceMode after Project Stage Snapshot validation; failing closed.',
      },
    }));
  }

  const sourceResolution = await resolveAndValidateSourceRef({ workDir, sourceRef });
  if (sourceResolution.error) {
    return writePlannerSpecMigrationApplyResult(basePlannerSpecMigrationApplyResult({
      ...baseInput,
      resolvedSourceRef: sourceResolution.resolvedSourceRef,
      headBefore: sourceResolution.headRef,
      headAfter: sourceResolution.headRef,
      beforeGitStatus: null,
      afterGitStatus: null,
      changedFilesFromGitStatus: [],
      prepared: null,
      applyOutput: null,
      status: 'blocked',
      error: sourceResolution.error,
    }));
  }

  const beforeGitStatus = await gitStatus(workDir);
  if (beforeGitStatus == null) {
    return writePlannerSpecMigrationApplyResult(basePlannerSpecMigrationApplyResult({
      ...baseInput,
      resolvedSourceRef: sourceResolution.resolvedSourceRef,
      headBefore: sourceResolution.headRef,
      headAfter: sourceResolution.headRef,
      beforeGitStatus,
      afterGitStatus: null,
      changedFilesFromGitStatus: [],
      prepared: null,
      applyOutput: null,
      status: 'blocked',
      error: {
        code: 'source_ref_unavailable',
        message: 'planner_spec_migration_apply requires git status evidence before running the planner apply stage.',
      },
    }));
  }
  if (beforeGitStatus.length > 0) {
    return writePlannerSpecMigrationApplyResult(basePlannerSpecMigrationApplyResult({
      ...baseInput,
      resolvedSourceRef: sourceResolution.resolvedSourceRef,
      headBefore: sourceResolution.headRef,
      headAfter: sourceResolution.headRef,
      beforeGitStatus,
      afterGitStatus: beforeGitStatus,
      changedFilesFromGitStatus: parseGitStatusChangedFiles(beforeGitStatus),
      prepared: null,
      applyOutput: null,
      status: 'blocked',
      error: {
        code: 'workspace_dirty',
        message: 'planner_spec_migration_apply requires a clean live workspace before materializing task truth.',
      },
    }));
  }

  const projectConfigResult = await loadProjectConfig(projectConfigPath);
  if (projectConfigResult.error) {
    return writePlannerSpecMigrationApplyResult(basePlannerSpecMigrationApplyResult({
      ...baseInput,
      resolvedSourceRef: sourceResolution.resolvedSourceRef,
      headBefore: sourceResolution.headRef,
      headAfter: sourceResolution.headRef,
      beforeGitStatus,
      afterGitStatus: beforeGitStatus,
      changedFilesFromGitStatus: [],
      prepared: null,
      applyOutput: null,
      status: 'blocked',
      error: projectConfigResult.error,
    }));
  }
  const projectConfig = projectConfigResult.projectConfig;
  if (!projectConfig) {
    return writePlannerSpecMigrationApplyResult(basePlannerSpecMigrationApplyResult({
      ...baseInput,
      resolvedSourceRef: sourceResolution.resolvedSourceRef,
      headBefore: sourceResolution.headRef,
      headAfter: sourceResolution.headRef,
      beforeGitStatus,
      afterGitStatus: beforeGitStatus,
      changedFilesFromGitStatus: [],
      prepared: null,
      applyOutput: null,
      status: 'blocked',
      error: {
        code: 'project_config_invalid',
        message: 'planner_spec_migration_apply requires parsed project.config.json after validation; failing closed.',
      },
    }));
  }

  const planManager = new PlanManager(workDir);
  const planPath = resolve(workDir, '.ralph', 'plan.json');
  if (!await fs.pathExists(planPath)) {
    return writePlannerSpecMigrationApplyResult(basePlannerSpecMigrationApplyResult({
      ...baseInput,
      resolvedSourceRef: sourceResolution.resolvedSourceRef,
      headBefore: sourceResolution.headRef,
      headAfter: sourceResolution.headRef,
      beforeGitStatus,
      afterGitStatus: beforeGitStatus,
      changedFilesFromGitStatus: [],
      prepared: null,
      applyOutput: null,
      status: 'blocked',
      error: {
        code: 'plan_file_missing',
        message: 'planner_spec_migration_apply requires an existing .ralph/plan.json; it does not create a first plan.',
      },
    }));
  }

  let planBeforeContent: string;
  try {
    planBeforeContent = await fs.readFile(planPath, 'utf8');
    await planManager.load();
  } catch (error) {
    return writePlannerSpecMigrationApplyResult(basePlannerSpecMigrationApplyResult({
      ...baseInput,
      resolvedSourceRef: sourceResolution.resolvedSourceRef,
      headBefore: sourceResolution.headRef,
      headAfter: sourceResolution.headRef,
      beforeGitStatus,
      afterGitStatus: beforeGitStatus,
      changedFilesFromGitStatus: [],
      prepared: null,
      applyOutput: null,
      status: 'blocked',
      error: {
        code: 'plan_file_invalid',
        message: `planner_spec_migration_apply could not load .ralph/plan.json: ${error instanceof Error ? error.message : String(error)}`,
      },
    }));
  }

  const specContent = await fs.readFile(specPath, 'utf8');
  const projectConfigContent = projectConfigResult.content;
  const prepared = {
    planPath,
    planBeforeSha256: `sha256:${sha256(planBeforeContent)}`,
    specSha256: `sha256:${sha256(specContent)}`,
    specCharCount: specContent.length,
    projectConfigSha256: `sha256:${sha256(projectConfigContent)}`,
  };

  let applyOutput: PendingSpecMigrationApplyResult | null = null;
  let applyError: PlannerSpecMigrationApplyResult['error'] = null;
  let status: PlannerSpecMigrationApplyResult['status'] = 'completed';
  try {
    applyOutput = await applyPendingSpecMigrations({
      workDir,
      primarySpecPath: specPath,
      planningEnabled: true,
      projectConfig,
      agent: input.agent as Agent,
      model: input.model ?? undefined,
      timeoutMinutes: input.timeoutMinutes ?? null,
      verbose: false,
      visualEvidenceMode: requiredVisualEvidenceMode,
      planner: new Planner(),
      planManager,
      judgmentLog: new JudgmentLog(workDir),
    });
  } catch (error) {
    const isAgentFailure = error instanceof PlannerAgentFailure;
    status = isAgentFailure ? 'agent_failed' : 'apply_failed';
    applyError = {
      code: isAgentFailure ? 'agent_failed' : 'apply_failed',
      message: error instanceof Error ? error.message : String(error),
    };
  }

  const afterHead = await gitValue(workDir, ['rev-parse', 'HEAD']);
  const afterGitStatus = await gitStatus(workDir);
  if (afterGitStatus == null) {
    return writePlannerSpecMigrationApplyResult(basePlannerSpecMigrationApplyResult({
      ...baseInput,
      resolvedSourceRef: sourceResolution.resolvedSourceRef,
      headBefore: sourceResolution.headRef,
      headAfter: afterHead,
      beforeGitStatus,
      afterGitStatus,
      changedFilesFromGitStatus: [],
      prepared,
      applyOutput,
      status: 'forbidden_mutation',
      error: {
        code: 'post_git_status_unavailable',
        message: 'planner_spec_migration_apply requires git status evidence after planner apply; failing closed.',
      },
    }));
  }

  const changedFilesFromGitStatus = parseGitStatusChangedFiles(afterGitStatus);
  const forbiddenChangedFiles = changedFilesFromGitStatus.filter((file) => !isAllowedPlannerApplyChangedFile(file));
  const headChanged = afterHead !== sourceResolution.headRef;
  if (headChanged) {
    status = 'forbidden_mutation';
    applyError = {
      code: 'head_changed',
      message: `planner_spec_migration_apply must not change HEAD; before=${sourceResolution.headRef}, after=${afterHead ?? 'unavailable'}.`,
    };
  } else if (forbiddenChangedFiles.length > 0) {
    status = 'forbidden_mutation';
    applyError = {
      code: 'forbidden_mutation',
      message: `planner_spec_migration_apply may only mutate .ralph/plan.json, .ralph/decisions-log.json and planner prompt traces; forbidden paths: ${forbiddenChangedFiles.join(', ')}`,
    };
  }

  return writePlannerSpecMigrationApplyResult(basePlannerSpecMigrationApplyResult({
    ...baseInput,
    resolvedSourceRef: sourceResolution.resolvedSourceRef,
    headBefore: sourceResolution.headRef,
    headAfter: afterHead,
    beforeGitStatus,
    afterGitStatus,
    changedFilesFromGitStatus,
    prepared,
    applyOutput,
    status,
    error: applyError,
  }));
}

export async function runPlannerSpecMigrationApplyFiles(input: {
  snapshotPath: string;
  sourceRef: string;
  outDir: string;
  agent: PlannerSpecMigrationApplyAgent;
  model?: string | null;
  timeoutMinutes?: number | null;
}): Promise<PlannerSpecMigrationApplyResult> {
  const snapshotPath = resolve(input.snapshotPath);
  assertStageFixturePathAllowed(snapshotPath, 'planner_spec_migration_apply --snapshot');
  return runPlannerSpecMigrationApply({
    snapshot: await fs.readJson(snapshotPath),
    snapshotPath,
    sourceRef: input.sourceRef,
    outDir: input.outDir,
    agent: input.agent,
    model: input.model,
    timeoutMinutes: input.timeoutMinutes,
  });
}

export function formatPlannerSpecMigrationApplyResult(
  result: PlannerSpecMigrationApplyResult,
  compact = false,
): string {
  return `${JSON.stringify(result, null, compact ? 0 : 2)}\n`;
}

async function validatePlannerSpecMigrationApplyInput(input: {
  snapshot: ProjectStageSnapshot;
  workDir: string;
  sourceRef: string;
  spec: string;
  specPath: string;
  projectConfigPath: string;
  visualEvidenceMode: VisualEvidenceMode | null;
}): Promise<PlannerSpecMigrationApplyResult['error']> {
  const { snapshot } = input;
  if (snapshot.plan.status !== 'ready') {
    return {
      code: 'plan_not_ready',
      message: `planner_spec_migration_apply requires plan.status=ready; got ${snapshot.plan.status}${snapshot.plan.reasonCode ? ` (${snapshot.plan.reasonCode})` : ''}.`,
    };
  }
  if (!snapshot.source.workspace.available || snapshot.source.workspace.isGitRepo !== true) {
    return {
      code: 'source_workspace_unavailable',
      message: 'planner_spec_migration_apply requires Project Stage Snapshot source.workspace to be available and a git repo.',
    };
  }
  if (!input.workDir) {
    return {
      code: 'source_workspace_path_unavailable',
      message: 'planner_spec_migration_apply requires Project Stage Snapshot source.workspace.path; it does not accept client workDir truth.',
    };
  }
  const snapshotSourceRef = snapshot.source.workspace.commitSha?.trim() || null;
  if (!snapshotSourceRef || !input.sourceRef.trim()) {
    return {
      code: 'source_ref_unavailable',
      message: 'planner_spec_migration_apply requires explicit --source-ref matching the snapshot source commit.',
    };
  }
  if (input.sourceRef.trim() !== snapshotSourceRef) {
    return {
      code: 'source_ref_not_snapshot_commit',
      message: `planner_spec_migration_apply --source-ref must equal snapshot source commit ${snapshotSourceRef}; got ${input.sourceRef.trim()}.`,
    };
  }
  if (!snapshot.plan.specFile?.trim()) {
    return {
      code: 'spec_file_unavailable',
      message: 'planner_spec_migration_apply requires Project Stage Snapshot plan.specFile so it can apply the accepted spec through the existing plan owner.',
    };
  }
  if (!input.spec) {
    return {
      code: 'spec_ref_invalid',
      message: 'planner_spec_migration_apply requires snapshot plan.specFile to be a workDir-relative spec path.',
    };
  }
  if (!await fs.pathExists(input.specPath)) {
    return {
      code: 'spec_missing',
      message: `planner_spec_migration_apply snapshot plan.specFile does not exist in live workDir: ${input.spec}`,
    };
  }
  if (snapshot.visualEvidencePolicy.status !== 'ready' || !input.visualEvidenceMode) {
    return {
      code: 'visual_evidence_policy_not_ready',
      message: `planner_spec_migration_apply requires Project Stage Snapshot visualEvidencePolicy.status=ready; got ${snapshot.visualEvidencePolicy.status}.`,
    };
  }
  if (!await fs.pathExists(input.projectConfigPath)) {
    return {
      code: 'project_config_missing',
      message: 'planner_spec_migration_apply requires project.config.json in the live Project Stage Snapshot workDir; it does not use a generated fallback config.',
    };
  }
  return null;
}

function basePlannerSpecMigrationApplyResult(input: {
  snapshot: ProjectStageSnapshot;
  snapshotPath: string | null;
  workDir: string;
  sourceRef: string;
  spec: string;
  specPath: string;
  projectConfigPath: string;
  visualEvidenceMode: VisualEvidenceMode | null;
  outDir: string;
  reportPath: string;
  providerName: string;
  model: string | null;
  timeoutMinutes: number | null;
  resolvedSourceRef: string | null;
  headBefore: string | null;
  headAfter: string | null;
  beforeGitStatus: string[] | null;
  afterGitStatus: string[] | null;
  changedFilesFromGitStatus: string[];
  prepared: PlannerSpecMigrationApplyResult['prepared'];
  applyOutput: PendingSpecMigrationApplyResult | null;
  status: PlannerSpecMigrationApplyResult['status'];
  error: PlannerSpecMigrationApplyResult['error'];
}): PlannerSpecMigrationApplyResult {
  const forbiddenChangedFiles = input.changedFilesFromGitStatus.filter((file) => !isAllowedPlannerApplyChangedFile(file));
  return {
    schemaVersion: PLANNER_SPEC_MIGRATION_APPLY_RESULT_SCHEMA_VERSION,
    stage: {
      stageId: 'planner_spec_migration_apply',
      mode: 'workspace_mutation',
      ownerBoundary: 'ralph.planner-spec-migration-apply',
      projectStageSnapshot: {
        schemaVersion: PROJECT_STAGE_SNAPSHOT_SCHEMA_VERSION,
        ownerBoundary: 'arena-ctl.project-stage-snapshot',
      },
      allowedMutations: [
        'live Project Stage Snapshot workspace .ralph/plan.json',
        'live Project Stage Snapshot workspace .ralph/decisions-log.json',
        'live Project Stage Snapshot workspace .ralph/prompt-trace.jsonl',
        'live Project Stage Snapshot workspace .ralph/prompt-traces/',
        input.outDir,
      ],
      forbiddenMutations: [
        'source files outside .ralph planner-owned files',
        '.arena/progress.json',
        '.ralph/provider-session-checkpoint.json',
        '.ralph/controller-reports/',
        '.ralph/agent-logs/',
        '.ralph/evidence/',
        'git commit, HEAD change or remote push',
        'executor/controller/Workbench auto-start',
        'lifecycle/runtime/blocker/proof/evidence writes',
        'client workDir/spec/visualEvidenceMode truth',
      ],
      handoff: [
        'inspect_planner_spec_migration_apply_report',
        'inspect_.ralph_plan_json_task_diff',
        'run_executor_project_task_later_if_a_task_is_selected',
        'rollback_live_workspace_manually_if_needed',
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
      allowedChangedFiles: input.changedFilesFromGitStatus.filter(isAllowedPlannerApplyChangedFile),
      forbiddenChangedFiles,
    },
    prepared: input.prepared,
    provider: {
      name: input.providerName,
      model: input.model,
      timeoutMinutes: input.timeoutMinutes,
    },
    applyOutput: input.applyOutput,
    output: {
      outDir: input.outDir,
      reportPath: input.reportPath,
    },
    error: input.error,
    notes: [
      'planner_spec_migration_apply consumes one Project Stage Snapshot and derives live workDir, spec and visualEvidenceMode from that snapshot.',
      'It calls the same ralph.planner-spec-migration-apply owner used by real LoopExecutor startup migration handling.',
      'It stops after materializing .ralph plan/judgment/prompt-trace truth and never starts executor, controller or Visual Workbench.',
      'This is a live workspace action; rollback is a manual operator/project-source decision.',
    ],
  };
}

async function writePlannerSpecMigrationApplyResult(result: PlannerSpecMigrationApplyResult): Promise<PlannerSpecMigrationApplyResult> {
  await fs.ensureDir(dirname(result.output.reportPath));
  await fs.writeJson(result.output.reportPath, result, { spaces: 2 });
  return result;
}

async function loadProjectConfig(projectConfigPath: string): Promise<{
  projectConfig: ProjectConfig;
  content: string;
  error: null;
} | {
  projectConfig: null;
  content: string;
  error: PlannerSpecMigrationApplyResult['error'];
}> {
  let content = '';
  try {
    content = await fs.readFile(projectConfigPath, 'utf8');
    return {
      projectConfig: ProjectConfigSchema.parse(JSON.parse(content)),
      content,
      error: null,
    };
  } catch (error) {
    return {
      projectConfig: null,
      content,
      error: {
        code: 'project_config_invalid',
        message: `planner_spec_migration_apply project.config.json is invalid: ${error instanceof Error ? error.message : String(error)}`,
      },
    };
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
        message: 'planner_spec_migration_apply requires a git workspace and a resolvable explicit sourceRef.',
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
        message: 'planner_spec_migration_apply workDir must be the git workspace root from the Project Stage Snapshot.',
      },
    };
  }
  if (resolvedSourceRef !== headRef) {
    return {
      resolvedSourceRef,
      headRef,
      error: {
        code: 'source_ref_mismatch',
        message: `planner_spec_migration_apply sourceRef ${resolvedSourceRef} does not match current workspace HEAD ${headRef}.`,
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
  if (isAbsolute(trimmed)) throw new Error(`${label} must be relative to the snapshot workDir, not absolute.`);
  const normalized = trimmed.split(/[\\/]+/).filter(Boolean).join('/');
  const parts = normalized.split('/');
  if (!normalized || parts.includes('.') || parts.includes('..')) {
    throw new Error(`${label} must stay inside the snapshot workDir.`);
  }
  if (parts.includes('.ralph') || parts.includes('.arena')) {
    throw new Error(`${label} must point to product spec source, not .ralph or .arena.`);
  }
  return normalized;
}

function isAllowedPlannerApplyChangedFile(file: string): boolean {
  const normalized = file.replaceAll('\\', '/');
  return normalized === '.ralph/plan.json'
    || normalized === '.ralph/decisions-log.json'
    || normalized === '.ralph/prompt-trace.jsonl'
    || normalized.startsWith('.ralph/prompt-traces/');
}
