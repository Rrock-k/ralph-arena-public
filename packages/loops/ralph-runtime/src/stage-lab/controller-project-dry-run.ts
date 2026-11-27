import { dirname, isAbsolute, resolve } from 'node:path';
import type { Stats } from 'node:fs';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import fs from 'fs-extra';
import { z } from 'zod';
import type { Agent } from '../agents/base.js';
import type { AgentResult, ControllerReport, VisualEvidenceMode } from '../config/types.js';
import { RalphConfigSchema, VisualEvidenceModeSchema } from '../config/types.js';
import { Controller, CONTROLLER_DRY_RUN_AUDIT_OWNER_BOUNDARY, type ControllerTrigger } from '../control/controller.js';
import { PlanManager } from '../planning/plan-manager.js';
import { assertOutputDirOutsideWorkDir, assertStageFixturePathAllowed, sha256 } from './stage-io.js';

const execFileAsync = promisify(execFile);

export const CONTROLLER_PROJECT_DRY_RUN_RESULT_SCHEMA_VERSION = 'ra-356.controller-project-dry-run-result.v0' as const;
export const CONTROLLER_PROJECT_DRY_RUN_REPORT_FILE = 'controller-project-dry-run.json' as const;

const PROJECT_STAGE_SNAPSHOT_SCHEMA_VERSION = 'ra-356.project-stage-snapshot.v1' as const;

const ControllerProjectDryRunTriggerSchema = z.enum([
  'phase_complete',
  'periodic',
  'failure_threshold',
  'replan',
  'manual',
  'final',
  'spec_migration',
]);

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
export type ControllerProjectDryRunTrigger = z.infer<typeof ControllerProjectDryRunTriggerSchema>;
export type ControllerProjectDryRunAgent = Pick<Agent, 'name' | 'execute'>;

export type ControllerProjectDryRunResult = {
  schemaVersion: typeof CONTROLLER_PROJECT_DRY_RUN_RESULT_SCHEMA_VERSION;
  stage: {
    stageId: 'controller_project_dry_run';
    mode: 'workspace_dry_run';
    ownerBoundary: 'ralph.controller.dry-run-adapter';
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
    trigger: ControllerProjectDryRunTrigger;
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
    promptId: 'controller.audit';
    promptSha256: string;
    promptCharCount: number;
    specFile: string;
    specSha256: string;
    specCharCount: number;
    planTaskCount: number;
    feedbackMatrixRows: number;
    visualWorkbenchSourceContractStatus: string | null;
    e2eEnabled: boolean;
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
  controllerOutput: {
    ownerBoundary: typeof CONTROLLER_DRY_RUN_AUDIT_OWNER_BOUNDARY | null;
    status: 'parsed' | 'agent_failed' | 'parse_or_validation_failed' | null;
    verdict: ControllerReport['verdict'] | null;
    summary: string | null;
    planChangeCount: number | null;
    newJudgmentCount: number | null;
    revisedJudgmentCount: number | null;
    planChangeActions: string[];
    newJudgmentIds: string[];
    revisedJudgmentIds: string[];
    feedbackMatrixRows: number | null;
    overclaimWarningCount: number | null;
    overclaimWarnings: string[];
  };
  output: {
    outDir: string;
    reportPath: string;
  };
  error: null | {
    code:
      | 'startup_trigger_forbidden'
      | 'plan_not_ready'
      | 'source_workspace_unavailable'
      | 'source_workspace_path_unavailable'
      | 'source_ref_unavailable'
      | 'source_ref_not_snapshot_commit'
      | 'live_workspace_forbidden'
      | 'source_ref_mismatch'
      | 'workspace_dirty'
      | 'plan_missing'
      | 'plan_invalid'
      | 'spec_ref_mismatch'
      | 'plan_ref_mismatch'
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

export async function runControllerProjectDryRun(input: {
  snapshot: unknown;
  snapshotPath?: string | null;
  workDir: string;
  sourceRef: string;
  spec: string;
  trigger: ControllerProjectDryRunTrigger;
  visualEvidenceMode: VisualEvidenceMode;
  outDir: string;
  agent: ControllerProjectDryRunAgent;
  model?: string | null;
  timeoutMinutes?: number | null;
}): Promise<ControllerProjectDryRunResult> {
  const snapshot = ProjectStageSnapshotSchema.parse(input.snapshot);
  const trigger = ControllerProjectDryRunTriggerSchema.parse(input.trigger);
  const visualEvidenceMode = VisualEvidenceModeSchema.parse(input.visualEvidenceMode);
  const workDir = resolve(input.workDir);
  const outDir = resolve(input.outDir);
  const spec = normalizeWorkDirRelativePath(input.spec, 'controller_project_dry_run --spec');
  await assertExistingDirectory(workDir, 'controller_project_dry_run --work-dir');
  assertOutputDirOutsideWorkDir({
    stageId: 'controller_project_dry_run',
    workDir,
    outDir,
  });
  const reportPath = resolve(outDir, CONTROLLER_PROJECT_DRY_RUN_REPORT_FILE);
  if (await fs.pathExists(reportPath)) {
    throw new Error(`controller_project_dry_run --out-dir already contains ${CONTROLLER_PROJECT_DRY_RUN_REPORT_FILE}; refusing to overwrite experiment output.`);
  }
  await fs.ensureDir(outDir);

  const baseInput = {
    snapshot,
    snapshotPath: input.snapshotPath ?? null,
    workDir,
    sourceRef: input.sourceRef.trim(),
    spec,
    trigger,
    visualEvidenceMode,
    outDir,
    reportPath,
    agentName: input.agent.name,
    model: input.model ?? null,
    timeoutMinutes: input.timeoutMinutes ?? null,
  };

  const validationBlocker = await validateControllerProjectDryRunInput(baseInput);
  if (validationBlocker) {
    return writeControllerProjectDryRunResult(baseControllerProjectDryRunResult({
      ...baseInput,
      resolvedSourceRef: null,
      headBefore: null,
      headAfter: null,
      beforeGitStatus: null,
      afterGitStatus: null,
      changedFilesFromGitStatus: [],
      prepared: null,
      agent: emptyAgentSummary(input.agent.name, input.model ?? null, input.timeoutMinutes ?? null),
      controllerOutput: emptyControllerOutput(),
      status: 'blocked',
      error: validationBlocker,
    }));
  }

  const sourceResolution = await resolveAndValidateSourceRef({ workDir, sourceRef: baseInput.sourceRef });
  if (sourceResolution.error) {
    return writeControllerProjectDryRunResult(baseControllerProjectDryRunResult({
      ...baseInput,
      resolvedSourceRef: sourceResolution.resolvedSourceRef,
      headBefore: sourceResolution.headRef,
      headAfter: sourceResolution.headRef,
      beforeGitStatus: null,
      afterGitStatus: null,
      changedFilesFromGitStatus: [],
      prepared: null,
      agent: emptyAgentSummary(input.agent.name, input.model ?? null, input.timeoutMinutes ?? null),
      controllerOutput: emptyControllerOutput(),
      status: 'blocked',
      error: sourceResolution.error,
    }));
  }

  const beforeGitStatus = await gitStatus(workDir);
  if (beforeGitStatus == null) {
    return writeControllerProjectDryRunResult(baseControllerProjectDryRunResult({
      ...baseInput,
      resolvedSourceRef: sourceResolution.resolvedSourceRef,
      headBefore: sourceResolution.headRef,
      headAfter: sourceResolution.headRef,
      beforeGitStatus,
      afterGitStatus: null,
      changedFilesFromGitStatus: [],
      prepared: null,
      agent: emptyAgentSummary(input.agent.name, input.model ?? null, input.timeoutMinutes ?? null),
      controllerOutput: emptyControllerOutput(),
      status: 'blocked',
      error: {
        code: 'source_ref_unavailable',
        message: 'controller_project_dry_run requires git status evidence before running the controller stage.',
      },
    }));
  }
  if (beforeGitStatus.length > 0) {
    return writeControllerProjectDryRunResult(baseControllerProjectDryRunResult({
      ...baseInput,
      resolvedSourceRef: sourceResolution.resolvedSourceRef,
      headBefore: sourceResolution.headRef,
      headAfter: sourceResolution.headRef,
      beforeGitStatus,
      afterGitStatus: beforeGitStatus,
      changedFilesFromGitStatus: parseGitStatusChangedFiles(beforeGitStatus),
      prepared: null,
      agent: emptyAgentSummary(input.agent.name, input.model ?? null, input.timeoutMinutes ?? null),
      controllerOutput: emptyControllerOutput(),
      status: 'blocked',
      error: {
        code: 'workspace_dirty',
        message: 'controller_project_dry_run requires a clean forked workspace before running the controller stage.',
      },
    }));
  }

  const planManager = new PlanManager(workDir);
  try {
    await planManager.load();
  } catch (error) {
    return writeControllerProjectDryRunResult(baseControllerProjectDryRunResult({
      ...baseInput,
      resolvedSourceRef: sourceResolution.resolvedSourceRef,
      headBefore: sourceResolution.headRef,
      headAfter: sourceResolution.headRef,
      beforeGitStatus,
      afterGitStatus: beforeGitStatus,
      changedFilesFromGitStatus: [],
      prepared: null,
      agent: emptyAgentSummary(input.agent.name, input.model ?? null, input.timeoutMinutes ?? null),
      controllerOutput: emptyControllerOutput(),
      status: 'blocked',
      error: {
        code: await fs.pathExists(resolve(workDir, '.ralph', 'plan.json')) ? 'plan_invalid' : 'plan_missing',
        message: `controller_project_dry_run requires a valid .ralph/plan.json in the explicit forked workDir: ${error instanceof Error ? error.message : String(error)}`,
      },
    }));
  }

  const plan = planManager.currentPlan;
  let specFile: string;
  try {
    specFile = normalizeWorkDirRelativePath(plan.specFile, 'controller_project_dry_run plan.specFile');
  } catch (error) {
    return writeControllerProjectDryRunResult(baseControllerProjectDryRunResult({
      ...baseInput,
      resolvedSourceRef: sourceResolution.resolvedSourceRef,
      headBefore: sourceResolution.headRef,
      headAfter: sourceResolution.headRef,
      beforeGitStatus,
      afterGitStatus: beforeGitStatus,
      changedFilesFromGitStatus: [],
      prepared: null,
      agent: emptyAgentSummary(input.agent.name, input.model ?? null, input.timeoutMinutes ?? null),
      controllerOutput: emptyControllerOutput(),
      status: 'blocked',
      error: {
        code: 'plan_invalid',
        message: `controller_project_dry_run requires plan.specFile to be a valid workDir-relative path: ${error instanceof Error ? error.message : String(error)}`,
      },
    }));
  }
  if (spec !== specFile) {
    return writeControllerProjectDryRunResult(baseControllerProjectDryRunResult({
      ...baseInput,
      resolvedSourceRef: sourceResolution.resolvedSourceRef,
      headBefore: sourceResolution.headRef,
      headAfter: sourceResolution.headRef,
      beforeGitStatus,
      afterGitStatus: beforeGitStatus,
      changedFilesFromGitStatus: [],
      prepared: null,
      agent: emptyAgentSummary(input.agent.name, input.model ?? null, input.timeoutMinutes ?? null),
      controllerOutput: emptyControllerOutput(),
      status: 'blocked',
      error: {
        code: 'plan_ref_mismatch',
        message: `controller_project_dry_run --spec ${spec} must match .ralph/plan.json specFile ${specFile}.`,
      },
    }));
  }
  const snapshotSpecFile = snapshot.plan.specFile?.trim() || null;
  if (snapshotSpecFile && snapshotSpecFile !== specFile) {
    return writeControllerProjectDryRunResult(baseControllerProjectDryRunResult({
      ...baseInput,
      resolvedSourceRef: sourceResolution.resolvedSourceRef,
      headBefore: sourceResolution.headRef,
      headAfter: sourceResolution.headRef,
      beforeGitStatus,
      afterGitStatus: beforeGitStatus,
      changedFilesFromGitStatus: [],
      prepared: null,
      agent: emptyAgentSummary(input.agent.name, input.model ?? null, input.timeoutMinutes ?? null),
      controllerOutput: emptyControllerOutput(),
      status: 'blocked',
      error: {
        code: 'plan_ref_mismatch',
        message: `controller_project_dry_run plan.specFile ${specFile} must match snapshot plan.specFile ${snapshotSpecFile}.`,
      },
    }));
  }

  const specPath = resolve(workDir, specFile);
  if (!await fs.pathExists(specPath)) {
    return writeControllerProjectDryRunResult(baseControllerProjectDryRunResult({
      ...baseInput,
      resolvedSourceRef: sourceResolution.resolvedSourceRef,
      headBefore: sourceResolution.headRef,
      headAfter: sourceResolution.headRef,
      beforeGitStatus,
      afterGitStatus: beforeGitStatus,
      changedFilesFromGitStatus: [],
      prepared: null,
      agent: emptyAgentSummary(input.agent.name, input.model ?? null, input.timeoutMinutes ?? null),
      controllerOutput: emptyControllerOutput(),
      status: 'blocked',
      error: {
        code: 'spec_missing',
        message: `controller_project_dry_run plan.specFile does not exist in workDir: ${specFile}`,
      },
    }));
  }

  const specContent = await fs.readFile(specPath, 'utf8');
  const ralphConfig = RalphConfigSchema.parse({
    e2eEnforcer: {
      enabled: false,
    },
    visualWorkbench: {
      visualEvidenceMode,
    },
  });
  const controller = new Controller(workDir);
  const dryRunResult = await controller.dryRunAudit({
    workDir,
    specPath,
    ralphConfig,
    agent: input.agent as Agent,
    model: input.model ?? undefined,
    timeoutMinutes: input.timeoutMinutes ?? null,
    planManager,
    iterationHistory: [],
    trigger,
    verbose: false,
  });

  const afterHead = await gitValue(workDir, ['rev-parse', 'HEAD']);
  const afterGitStatus = await gitStatus(workDir);
  const agentSummary = buildAgentResultSummary(input.agent.name, input.model ?? null, input.timeoutMinutes ?? null, dryRunResult.agentResult);
  const prepared = {
    promptId: dryRunResult.promptId,
    promptSha256: `sha256:${sha256(dryRunResult.prompt)}`,
    promptCharCount: dryRunResult.prompt.length,
    specFile,
    specSha256: `sha256:${sha256(specContent)}`,
    specCharCount: specContent.length,
    planTaskCount: plan.phases.flatMap((phase) => phase.tasks).length,
    feedbackMatrixRows: dryRunResult.context.feedbackMatrixRows,
    visualWorkbenchSourceContractStatus: dryRunResult.context.visualWorkbenchSourceContractStatus,
    e2eEnabled: dryRunResult.context.e2eEnabled,
  };
  if (afterGitStatus == null) {
    return writeControllerProjectDryRunResult(baseControllerProjectDryRunResult({
      ...baseInput,
      resolvedSourceRef: sourceResolution.resolvedSourceRef,
      headBefore: sourceResolution.headRef,
      headAfter: afterHead,
      beforeGitStatus,
      afterGitStatus,
      changedFilesFromGitStatus: [],
      prepared,
      agent: agentSummary,
      controllerOutput: buildControllerOutput(dryRunResult),
      status: 'forbidden_mutation',
      error: {
        code: 'post_git_status_unavailable',
        message: 'controller_project_dry_run requires git status evidence after the agent call; failing closed.',
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
      message: `controller_project_dry_run must not change HEAD; before=${sourceResolution.headRef}, after=${afterHead ?? 'unavailable'}.`,
    }
    : changedFilesFromGitStatus.length > 0
      ? {
        code: 'forbidden_mutation' as const,
        message: `controller_project_dry_run must not mutate the source workspace; changed paths: ${changedFilesFromGitStatus.join(', ')}`,
      }
      : dryRunResult.error;

  return writeControllerProjectDryRunResult(baseControllerProjectDryRunResult({
    ...baseInput,
    resolvedSourceRef: sourceResolution.resolvedSourceRef,
    headBefore: sourceResolution.headRef,
    headAfter: afterHead,
    beforeGitStatus,
    afterGitStatus,
    changedFilesFromGitStatus,
    prepared,
    agent: agentSummary,
    controllerOutput: buildControllerOutput(dryRunResult),
    status,
    error,
  }));
}

export async function runControllerProjectDryRunFiles(input: {
  snapshotPath: string;
  workDir: string;
  sourceRef: string;
  spec: string;
  trigger: ControllerProjectDryRunTrigger;
  visualEvidenceMode: VisualEvidenceMode;
  outDir: string;
  agent: ControllerProjectDryRunAgent;
  model?: string | null;
  timeoutMinutes?: number | null;
}): Promise<ControllerProjectDryRunResult> {
  const snapshotPath = resolve(input.snapshotPath);
  assertStageFixturePathAllowed(snapshotPath, 'controller_project_dry_run --snapshot');
  return runControllerProjectDryRun({
    snapshot: await fs.readJson(snapshotPath),
    snapshotPath,
    workDir: input.workDir,
    sourceRef: input.sourceRef,
    spec: input.spec,
    trigger: input.trigger,
    visualEvidenceMode: input.visualEvidenceMode,
    outDir: input.outDir,
    agent: input.agent,
    model: input.model,
    timeoutMinutes: input.timeoutMinutes,
  });
}

export function formatControllerProjectDryRunResult(
  result: ControllerProjectDryRunResult,
  compact = false,
): string {
  return `${JSON.stringify(result, null, compact ? 0 : 2)}\n`;
}

async function validateControllerProjectDryRunInput(input: {
  snapshot: ProjectStageSnapshot;
  workDir: string;
  sourceRef: string;
  spec: string;
  trigger: ControllerProjectDryRunTrigger;
}): Promise<ControllerProjectDryRunResult['error']> {
  const { snapshot } = input;
  if (!ControllerProjectDryRunTriggerSchema.safeParse(input.trigger).success) {
    return {
      code: 'startup_trigger_forbidden',
      message: 'controller_project_dry_run supports explicit non-startup controller triggers only.',
    };
  }
  if (snapshot.plan.status !== 'ready') {
    return {
      code: 'plan_not_ready',
      message: `controller_project_dry_run requires Project Stage Snapshot plan.status=ready; got ${snapshot.plan.status}.`,
    };
  }
  if (!snapshot.source.workspace.available || snapshot.source.workspace.isGitRepo !== true) {
    return {
      code: 'source_workspace_unavailable',
      message: 'controller_project_dry_run requires Project Stage Snapshot source.workspace to be available and a git repo.',
    };
  }
  const liveWorkspacePath = snapshot.source.workspace.path?.trim() || null;
  if (!liveWorkspacePath) {
    return {
      code: 'source_workspace_path_unavailable',
      message: 'controller_project_dry_run requires Project Stage Snapshot source.workspace.path so the live workspace can be rejected fail-closed.',
    };
  }
  const snapshotSourceRef = snapshot.source.workspace.commitSha?.trim() || null;
  if (!snapshotSourceRef || !input.sourceRef.trim()) {
    return {
      code: 'source_ref_unavailable',
      message: 'controller_project_dry_run requires explicit --source-ref matching the snapshot source commit.',
    };
  }
  if (input.sourceRef.trim() !== snapshotSourceRef) {
    return {
      code: 'source_ref_not_snapshot_commit',
      message: `controller_project_dry_run --source-ref must equal snapshot source commit ${snapshotSourceRef}; got ${input.sourceRef.trim()}.`,
    };
  }

  const snapshotSpecFile = snapshot.plan.specFile?.trim() || null;
  if (snapshotSpecFile && input.spec !== snapshotSpecFile) {
    return {
      code: 'spec_ref_mismatch',
      message: `controller_project_dry_run --spec must match snapshot plan.specFile ${snapshotSpecFile}; got ${input.spec}.`,
    };
  }

  if (await pathsResolveToSameLocation(input.workDir, liveWorkspacePath)) {
    return {
      code: 'live_workspace_forbidden',
      message: 'controller_project_dry_run --work-dir must be an explicit fork workspace, not the live Project Stage Snapshot workspace path.',
    };
  }

  return null;
}

function baseControllerProjectDryRunResult(input: {
  snapshot: ProjectStageSnapshot;
  snapshotPath: string | null;
  workDir: string;
  sourceRef: string;
  spec: string;
  trigger: ControllerProjectDryRunTrigger;
  visualEvidenceMode: VisualEvidenceMode;
  outDir: string;
  reportPath: string;
  resolvedSourceRef: string | null;
  headBefore: string | null;
  headAfter: string | null;
  beforeGitStatus: string[] | null;
  afterGitStatus: string[] | null;
  changedFilesFromGitStatus: string[];
  prepared: ControllerProjectDryRunResult['prepared'];
  agent: ControllerProjectDryRunResult['agent'];
  controllerOutput: ControllerProjectDryRunResult['controllerOutput'];
  status: ControllerProjectDryRunResult['status'];
  error: ControllerProjectDryRunResult['error'];
}): ControllerProjectDryRunResult {
  return {
    schemaVersion: CONTROLLER_PROJECT_DRY_RUN_RESULT_SCHEMA_VERSION,
    stage: {
      stageId: 'controller_project_dry_run',
      mode: 'workspace_dry_run',
      ownerBoundary: 'ralph.controller.dry-run-adapter',
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
        'planner or executor auto-start',
      ],
      handoff: [
        'inspect_controller_project_dry_run_report',
        'decide_whether_to_apply_or_replan_in_a_future_explicit_stage',
        'run_visual_workbench_handoff_later_if_selected',
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
      trigger: input.trigger,
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
    controllerOutput: input.controllerOutput,
    output: {
      outDir: input.outDir,
      reportPath: input.reportPath,
    },
    error: input.error,
    notes: [
      'controller_project_dry_run consumes one Project Stage Snapshot and one explicit fork workspace; it does not read live project truth again.',
      'It calls the existing Controller dry-run owner and does not write .ralph/plan.json, controller reports, prompt traces, judgments, task evidence, progress, runtime intent or lifecycle truth.',
      'It performs one provider call and no hidden repair retry so operator token spend and behavior remain observable.',
      'Startup trigger is intentionally excluded because the production startup path can persist E2E applicability and add E2E tasks.',
      'E2E enforcer is explicitly disabled for this non-startup dry-run; E2E applicability is not inferred from schema defaults.',
      'This result is disposable experiment output, not project/task/proof truth.',
    ],
  };
}

function buildControllerOutput(
  dryRunResult: Awaited<ReturnType<Controller['dryRunAudit']>>,
): ControllerProjectDryRunResult['controllerOutput'] {
  const report = dryRunResult.report;
  if (!report) {
    return {
      ownerBoundary: dryRunResult.ownerBoundary,
      status: dryRunResult.status,
      verdict: null,
      summary: null,
      planChangeCount: null,
      newJudgmentCount: null,
      revisedJudgmentCount: null,
      planChangeActions: [],
      newJudgmentIds: [],
      revisedJudgmentIds: [],
      feedbackMatrixRows: null,
      overclaimWarningCount: null,
      overclaimWarnings: [],
    };
  }
  return {
    ownerBoundary: dryRunResult.ownerBoundary,
    status: dryRunResult.status,
    verdict: report.verdict,
    summary: report.summary,
    planChangeCount: report.planChanges.length,
    newJudgmentCount: report.newJudgments.length,
    revisedJudgmentCount: report.revisedJudgments.length,
    planChangeActions: report.planChanges.map((change) => change.action),
    newJudgmentIds: report.newJudgments.map((judgment) => judgment.id),
    revisedJudgmentIds: report.revisedJudgments.map((judgment) => judgment.id),
    feedbackMatrixRows: report.feedbackMatrix?.length ?? 0,
    overclaimWarningCount: report.overclaimWarnings?.length ?? 0,
    overclaimWarnings: report.overclaimWarnings ?? [],
  };
}

function buildAgentResultSummary(
  agentName: string,
  model: string | null,
  timeoutMinutes: number | null,
  agentResult: AgentResult,
): ControllerProjectDryRunResult['agent'] {
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
): ControllerProjectDryRunResult['agent'] {
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

function emptyControllerOutput(): ControllerProjectDryRunResult['controllerOutput'] {
  return {
    ownerBoundary: null,
    status: null,
    verdict: null,
    summary: null,
    planChangeCount: null,
    newJudgmentCount: null,
    revisedJudgmentCount: null,
    planChangeActions: [],
    newJudgmentIds: [],
    revisedJudgmentIds: [],
    feedbackMatrixRows: null,
    overclaimWarningCount: null,
    overclaimWarnings: [],
  };
}

async function writeControllerProjectDryRunResult(result: ControllerProjectDryRunResult): Promise<ControllerProjectDryRunResult> {
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
        message: 'controller_project_dry_run requires a git workspace and a resolvable explicit sourceRef.',
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
        message: 'controller_project_dry_run workDir must be the git workspace root.',
      },
    };
  }
  if (resolvedSourceRef !== headRef) {
    return {
      resolvedSourceRef,
      headRef,
      error: {
        code: 'source_ref_mismatch',
        message: `controller_project_dry_run sourceRef ${resolvedSourceRef} does not match current workspace HEAD ${headRef}.`,
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
