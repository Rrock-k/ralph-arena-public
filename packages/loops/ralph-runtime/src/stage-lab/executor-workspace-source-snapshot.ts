import { dirname, resolve } from 'node:path';
import type { Stats } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'fs-extra';
import { z } from 'zod';
import {
  classifyExecutorChangedFiles,
  normalizeExecutorChangedFiles,
  parseExecutorGitStatusChangedFiles,
  type ExecutorChangedFileClassification,
} from '../loop/executor-observer.js';
import {
  readExecutorGitStatusLines as gitStatus,
  readExecutorGitValue as gitValue,
  resolveExecutorSourceRefAtHead,
  sameExecutorChangedFileSet,
} from '../loop/executor-source-evidence.js';
import {
  EXECUTOR_TASK_WORKSPACE_RESULT_SCHEMA_VERSION,
  type ExecutorTaskWorkspaceResult,
} from './executor-task-workspace.js';
import { assertOutputDirOutsideWorkDir, assertStageFixturePathAllowed, sha256 } from './stage-io.js';

const execFileAsync = promisify(execFile);

export const EXECUTOR_WORKSPACE_SOURCE_SNAPSHOT_SCHEMA_VERSION = 'ra-356.executor-workspace-source-snapshot.v0' as const;
export const EXECUTOR_WORKSPACE_SOURCE_SNAPSHOT_REPORT_FILE = 'executor-workspace-source-snapshot.json' as const;

export type ExecutorWorkspaceSourceSnapshotNextCommandKey =
  | 'visualWorkbenchInspect'
  | 'visualWorkbenchSelectorReadiness'
  | 'visualWorkbenchEvidenceChainReadiness';

export type ExecutorWorkspaceSourceSnapshotResult = {
  schemaVersion: typeof EXECUTOR_WORKSPACE_SOURCE_SNAPSHOT_SCHEMA_VERSION;
  stage: {
    stageId: 'executor_workspace_source_snapshot';
    mode: 'workspace_mutation';
    ownerBoundary: 'ralph.stage-lab.executor-source-handoff';
    allowedMutations: string[];
    forbiddenMutations: string[];
    handoff: string[];
  };
  status: 'snapshotted' | 'blocked' | 'forbidden_mutation';
  source: {
    workDir: string;
    requestedSourceRef: string;
    reportSourceRef: string | null;
    headBefore: string | null;
    headAfter: string | null;
    beforeGitStatus: string[] | null;
    afterGitStatus: string[] | null;
    changedFilesFromGitStatus: string[];
    headChanged: boolean;
  };
  executorReport: {
    path: string;
    sha256: string;
    status: ExecutorTaskWorkspaceResult['status'];
    taskId: string;
    taskVisualEvidenceRequired: boolean | null;
    taskHasStructuredVisualExpectation: boolean;
    taskVisualExpectationSources: string[];
    agentName: string;
    model: string | null;
    sourceRef: string | null;
    changedFilesFromGitStatus: string[];
  };
  arenaReadback: {
    projectId: string | null;
    projectIdSource: 'operator_input' | null;
  };
  snapshot: {
    commitMessage: string;
    afterExperimentSourceRef: string | null;
    changedFiles: string[];
    changedProductFiles: string[];
    changedVisualWorkbenchFiles: string[];
    forbiddenChangedFiles: string[];
  };
  nextCommands: {
    visualWorkbenchInspect: string | null;
    visualWorkbenchSelectorReadiness: string | null;
    visualWorkbenchEvidenceChainReadiness: string | null;
    visualWorkbenchCaptureSelectedStoryViewports: string | null;
    visualWorkbenchCapture: string | null;
  };
  visualWorkbenchHandoff: {
    status: 'ready_for_readiness_checks' | 'not_applicable' | 'blocked';
    reason:
      | 'structured_visual_expectation'
      | 'no_structured_visual_expectation'
      | 'experiment_source_ref_missing';
    taskId: string;
    projectId: string | null;
    visualEvidenceRequired: boolean | null;
    visualExpectationSources: string[];
    changedVisualWorkbenchFiles: string[];
    changedProductFiles: string[];
    blockers: string[];
    warnings: string[];
    nextCommandOrder: ExecutorWorkspaceSourceSnapshotNextCommandKey[];
    notes: string[];
  };
  output: {
    outDir: string;
    reportPath: string;
  };
  error: null | {
    code:
      | 'executor_report_not_completed'
      | 'executor_report_source_mismatch'
      | 'executor_report_workspace_mismatch'
      | 'source_ref_unavailable'
      | 'source_ref_mismatch'
      | 'workspace_status_mismatch'
      | 'workspace_no_changes'
      | 'forbidden_mutation'
      | 'git_add_failed'
      | 'commit_failed'
      | 'post_commit_status_unavailable'
      | 'post_commit_dirty';
    message: string;
  };
  notes: string[];
};

const ExecutorWorkspaceReportSchema = z.object({
  schemaVersion: z.literal(EXECUTOR_TASK_WORKSPACE_RESULT_SCHEMA_VERSION),
  stage: z.object({
    stageId: z.literal('executor_task_workspace'),
  }),
  status: z.enum(['completed', 'blocked', 'agent_failed', 'forbidden_mutation']),
  source: z.object({
    workDir: z.string(),
    requestedSourceRef: z.string(),
    resolvedSourceRef: z.string().nullable(),
    headBefore: z.string().nullable(),
    headAfter: z.string().nullable(),
    changedFilesFromGitStatus: z.array(z.string()),
  }),
  task: z.object({
    id: z.string(),
    visualEvidenceRequired: z.boolean().nullable(),
    hasStructuredVisualExpectation: z.boolean(),
    visualExpectationSources: z.array(z.string()),
  }),
  agent: z.object({
    name: z.string(),
    model: z.string().nullable(),
  }),
});

export async function runExecutorWorkspaceSourceSnapshot(input: {
  executorWorkspaceReportPath: string;
  workDir: string;
  sourceRef: string;
  outDir: string;
  commitMessage: string;
  projectId?: string | null;
}): Promise<ExecutorWorkspaceSourceSnapshotResult> {
  const workDir = resolve(input.workDir);
  const outDir = resolve(input.outDir);
  const executorWorkspaceReportPath = resolve(input.executorWorkspaceReportPath);
  const commitMessage = input.commitMessage.trim();
  const projectId = input.projectId?.trim() || null;
  if (!commitMessage) {
    throw new Error('executor_workspace_source_snapshot requires an explicit commitMessage.');
  }
  assertStageFixturePathAllowed(executorWorkspaceReportPath, 'executor_workspace_source_snapshot --executor-workspace-report');
  await assertExistingDirectory(workDir, 'executor_workspace_source_snapshot --work-dir');
  assertOutputDirOutsideWorkDir({
    stageId: 'executor_workspace_source_snapshot',
    workDir,
    outDir,
  });
  const reportPath = resolve(outDir, EXECUTOR_WORKSPACE_SOURCE_SNAPSHOT_REPORT_FILE);
  if (await fs.pathExists(reportPath)) {
    throw new Error(`executor_workspace_source_snapshot --out-dir already contains ${EXECUTOR_WORKSPACE_SOURCE_SNAPSHOT_REPORT_FILE}; refusing to overwrite experiment output.`);
  }
  await fs.ensureDir(outDir);

  const rawReport = await fs.readFile(executorWorkspaceReportPath, 'utf8');
  const parsedReport = ExecutorWorkspaceReportSchema.parse(JSON.parse(rawReport));
  const executorReport = parsedReport as Pick<
    ExecutorTaskWorkspaceResult,
    'schemaVersion' | 'stage' | 'status' | 'source' | 'task' | 'agent'
  >;
  const reportSha256 = `sha256:${sha256(rawReport)}`;
  const reportSourceRef = executorReport.source.resolvedSourceRef ?? executorReport.source.headBefore;
  const sourceRef = input.sourceRef.trim();
  if (!sourceRef) throw new Error('executor_workspace_source_snapshot requires an explicit sourceRef.');

  const baseInput = {
    executorWorkspaceReportPath,
    executorReportSha256: reportSha256,
    executorReport,
    workDir,
    sourceRef,
    outDir,
    reportPath,
    commitMessage,
    projectId,
  };

  if (executorReport.status !== 'completed') {
    return writeSnapshotResult(baseSnapshotResult({
      ...baseInput,
      headBefore: executorReport.source.headAfter,
      headAfter: executorReport.source.headAfter,
      beforeGitStatus: null,
      afterGitStatus: null,
      changedFilesFromGitStatus: executorReport.source.changedFilesFromGitStatus,
      classification: emptyClassification(),
      afterExperimentSourceRef: null,
      status: 'blocked',
      error: {
        code: 'executor_report_not_completed',
        message: `executor_workspace_source_snapshot requires a completed executor workspace report, got ${executorReport.status}.`,
      },
    }));
  }

  const realReportWorkDir = await fs.realpath(resolve(executorReport.source.workDir));
  const realWorkDir = await fs.realpath(workDir);
  if (realReportWorkDir !== realWorkDir) {
    return writeSnapshotResult(baseSnapshotResult({
      ...baseInput,
      headBefore: executorReport.source.headAfter,
      headAfter: executorReport.source.headAfter,
      beforeGitStatus: null,
      afterGitStatus: null,
      changedFilesFromGitStatus: executorReport.source.changedFilesFromGitStatus,
      classification: emptyClassification(),
      afterExperimentSourceRef: null,
      status: 'blocked',
      error: {
        code: 'executor_report_workspace_mismatch',
        message: `executor_workspace_source_snapshot workDir does not match executor report workDir ${executorReport.source.workDir}.`,
      },
    }));
  }

  if (sourceRef !== reportSourceRef) {
    return writeSnapshotResult(baseSnapshotResult({
      ...baseInput,
      headBefore: executorReport.source.headAfter,
      headAfter: executorReport.source.headAfter,
      beforeGitStatus: null,
      afterGitStatus: null,
      changedFilesFromGitStatus: executorReport.source.changedFilesFromGitStatus,
      classification: emptyClassification(),
      afterExperimentSourceRef: null,
      status: 'blocked',
      error: {
        code: 'executor_report_source_mismatch',
        message: `executor_workspace_source_snapshot sourceRef ${sourceRef} does not match executor report sourceRef ${reportSourceRef ?? 'unavailable'}.`,
      },
    }));
  }

  const sourceResolution = await resolveExecutorSourceRefAtHead({
    workDir,
    sourceRef,
    stageId: 'executor_workspace_source_snapshot',
  });
  if (sourceResolution.error) {
    return writeSnapshotResult(baseSnapshotResult({
      ...baseInput,
      headBefore: sourceResolution.headRef,
      headAfter: sourceResolution.headRef,
      beforeGitStatus: null,
      afterGitStatus: null,
      changedFilesFromGitStatus: executorReport.source.changedFilesFromGitStatus,
      classification: emptyClassification(),
      afterExperimentSourceRef: null,
      status: 'blocked',
      error: sourceResolution.error,
    }));
  }

  const beforeGitStatus = await gitStatus(workDir);
  if (beforeGitStatus == null) {
    return writeSnapshotResult(baseSnapshotResult({
      ...baseInput,
      headBefore: sourceResolution.headRef,
      headAfter: sourceResolution.headRef,
      beforeGitStatus,
      afterGitStatus: null,
      changedFilesFromGitStatus: executorReport.source.changedFilesFromGitStatus,
      classification: emptyClassification(),
      afterExperimentSourceRef: null,
      status: 'blocked',
      error: {
        code: 'source_ref_unavailable',
        message: 'executor_workspace_source_snapshot requires git status evidence before creating an experiment source ref.',
      },
    }));
  }

  const changedFilesFromGitStatus = normalizeExecutorChangedFiles(
    parseExecutorGitStatusChangedFiles(beforeGitStatus),
    'executor_workspace_source_snapshot git status changed files',
  );
  const reportChangedFiles = normalizeExecutorChangedFiles(
    executorReport.source.changedFilesFromGitStatus,
    'executor_workspace_source_snapshot executor report changed files',
  );
  const classification = classifyExecutorChangedFiles(changedFilesFromGitStatus, executorReport.task.id, {
    allowTaskWorkspaceFiles: false,
  });

  if (!sameExecutorChangedFileSet(changedFilesFromGitStatus, reportChangedFiles)) {
    return writeSnapshotResult(baseSnapshotResult({
      ...baseInput,
      headBefore: sourceResolution.headRef,
      headAfter: sourceResolution.headRef,
      beforeGitStatus,
      afterGitStatus: beforeGitStatus,
      changedFilesFromGitStatus,
      classification,
      afterExperimentSourceRef: null,
      status: 'blocked',
      error: {
        code: 'workspace_status_mismatch',
        message: 'executor_workspace_source_snapshot current workspace changed files differ from executor report changed files.',
      },
    }));
  }

  if (changedFilesFromGitStatus.length === 0) {
    return writeSnapshotResult(baseSnapshotResult({
      ...baseInput,
      headBefore: sourceResolution.headRef,
      headAfter: sourceResolution.headRef,
      beforeGitStatus,
      afterGitStatus: beforeGitStatus,
      changedFilesFromGitStatus,
      classification,
      afterExperimentSourceRef: null,
      status: 'blocked',
      error: {
        code: 'workspace_no_changes',
        message: 'executor_workspace_source_snapshot requires executor workspace changes to snapshot.',
      },
    }));
  }

  if (classification.forbiddenChangedFiles.length > 0) {
    return writeSnapshotResult(baseSnapshotResult({
      ...baseInput,
      headBefore: sourceResolution.headRef,
      headAfter: sourceResolution.headRef,
      beforeGitStatus,
      afterGitStatus: beforeGitStatus,
      changedFilesFromGitStatus,
      classification,
      afterExperimentSourceRef: null,
      status: 'forbidden_mutation',
      error: {
        code: 'forbidden_mutation',
        message: `executor_workspace_source_snapshot changed forbidden runner/loop/proof/lifecycle paths: ${classification.forbiddenChangedFiles.join(', ')}`,
      },
    }));
  }

  const addOk = await gitRawValue(workDir, ['add', '--all']);
  if (addOk == null) {
    return writeSnapshotResult(baseSnapshotResult({
      ...baseInput,
      headBefore: sourceResolution.headRef,
      headAfter: sourceResolution.headRef,
      beforeGitStatus,
      afterGitStatus: beforeGitStatus,
      changedFilesFromGitStatus,
      classification,
      afterExperimentSourceRef: null,
      status: 'blocked',
      error: {
        code: 'git_add_failed',
        message: 'executor_workspace_source_snapshot failed to stage workspace changes for the experiment source commit.',
      },
    }));
  }
  const commitOk = await gitRawValue(workDir, ['commit', '-m', commitMessage]);
  if (commitOk == null) {
    return writeSnapshotResult(baseSnapshotResult({
      ...baseInput,
      headBefore: sourceResolution.headRef,
      headAfter: sourceResolution.headRef,
      beforeGitStatus,
      afterGitStatus: beforeGitStatus,
      changedFilesFromGitStatus,
      classification,
      afterExperimentSourceRef: null,
      status: 'blocked',
      error: {
        code: 'commit_failed',
        message: 'executor_workspace_source_snapshot failed to create the experiment source commit.',
      },
    }));
  }

  const afterHead = await gitValue(workDir, ['rev-parse', 'HEAD']);
  const afterGitStatus = await gitStatus(workDir);
  if (afterGitStatus == null) {
    return writeSnapshotResult(baseSnapshotResult({
      ...baseInput,
      headBefore: sourceResolution.headRef,
      headAfter: afterHead,
      beforeGitStatus,
      afterGitStatus,
      changedFilesFromGitStatus,
      classification,
      afterExperimentSourceRef: afterHead,
      status: 'blocked',
      error: {
        code: 'post_commit_status_unavailable',
        message: 'executor_workspace_source_snapshot requires clean git status evidence after creating the experiment source ref.',
      },
    }));
  }
  if (afterGitStatus.length > 0) {
    return writeSnapshotResult(baseSnapshotResult({
      ...baseInput,
      headBefore: sourceResolution.headRef,
      headAfter: afterHead,
      beforeGitStatus,
      afterGitStatus,
      changedFilesFromGitStatus,
      classification,
      afterExperimentSourceRef: afterHead,
      status: 'blocked',
      error: {
        code: 'post_commit_dirty',
        message: `executor_workspace_source_snapshot expected a clean workspace after commit, got: ${afterGitStatus.join('; ')}`,
      },
    }));
  }

  return writeSnapshotResult(baseSnapshotResult({
    ...baseInput,
    headBefore: sourceResolution.headRef,
    headAfter: afterHead,
    beforeGitStatus,
    afterGitStatus,
    changedFilesFromGitStatus,
    classification,
    afterExperimentSourceRef: afterHead,
    status: 'snapshotted',
    error: null,
  }));
}

export async function runExecutorWorkspaceSourceSnapshotFiles(input: {
  executorWorkspaceReportPath: string;
  workDir: string;
  sourceRef: string;
  outDir: string;
  commitMessage: string;
  projectId?: string | null;
}): Promise<ExecutorWorkspaceSourceSnapshotResult> {
  return runExecutorWorkspaceSourceSnapshot(input);
}

export function formatExecutorWorkspaceSourceSnapshotResult(
  result: ExecutorWorkspaceSourceSnapshotResult,
  compact = false,
): string {
  return `${JSON.stringify(result, null, compact ? 0 : 2)}\n`;
}

function baseSnapshotResult(input: {
  executorWorkspaceReportPath: string;
  executorReportSha256: string;
  executorReport: Pick<ExecutorTaskWorkspaceResult, 'status' | 'source' | 'task' | 'agent'>;
  workDir: string;
  sourceRef: string;
  outDir: string;
  reportPath: string;
  commitMessage: string;
  projectId: string | null;
  headBefore: string | null;
  headAfter: string | null;
  beforeGitStatus: string[] | null;
  afterGitStatus: string[] | null;
  changedFilesFromGitStatus: string[];
  classification: ExecutorChangedFileClassification;
  afterExperimentSourceRef: string | null;
  status: ExecutorWorkspaceSourceSnapshotResult['status'];
  error: ExecutorWorkspaceSourceSnapshotResult['error'];
}): ExecutorWorkspaceSourceSnapshotResult {
  const visualWorkbenchHandoff = buildVisualWorkbenchHandoff(input);
  return {
    schemaVersion: EXECUTOR_WORKSPACE_SOURCE_SNAPSHOT_SCHEMA_VERSION,
    stage: {
      stageId: 'executor_workspace_source_snapshot',
      mode: 'workspace_mutation',
      ownerBoundary: 'ralph.stage-lab.executor-source-handoff',
      allowedMutations: [
        `${input.workDir} git index and HEAD`,
        input.outDir,
      ],
      forbiddenMutations: [
        'remote push',
        'lifecycle state',
        'runtime intents',
        'task verificationEvidence',
        'proofReviews[]',
        'ProjectAsset',
        'Visual Workbench capture auto-run',
      ],
      handoff: [
        'run_visual_workbench_inspect_after_visual_task_snapshot',
        'run_visual_workbench_selector_readiness_after_visual_task_snapshot',
        'run_visual_workbench_evidence_chain_readiness_after_selector_inputs_exist',
        'inspect_experiment_source_diff',
        'discard_or_reset_forked_workspace',
      ],
    },
    status: input.status,
    source: {
      workDir: input.workDir,
      requestedSourceRef: input.sourceRef,
      reportSourceRef: input.executorReport.source.resolvedSourceRef ?? input.executorReport.source.headBefore,
      headBefore: input.headBefore,
      headAfter: input.headAfter,
      beforeGitStatus: input.beforeGitStatus,
      afterGitStatus: input.afterGitStatus,
      changedFilesFromGitStatus: input.changedFilesFromGitStatus,
      headChanged: input.headBefore !== input.headAfter,
    },
    executorReport: {
      path: input.executorWorkspaceReportPath,
      sha256: input.executorReportSha256,
      status: input.executorReport.status,
      taskId: input.executorReport.task.id,
      taskVisualEvidenceRequired: input.executorReport.task.visualEvidenceRequired,
      taskHasStructuredVisualExpectation: input.executorReport.task.hasStructuredVisualExpectation,
      taskVisualExpectationSources: input.executorReport.task.visualExpectationSources,
      agentName: input.executorReport.agent.name,
      model: input.executorReport.agent.model,
      sourceRef: input.executorReport.source.resolvedSourceRef ?? input.executorReport.source.headBefore,
      changedFilesFromGitStatus: input.executorReport.source.changedFilesFromGitStatus,
    },
    arenaReadback: {
      projectId: input.projectId,
      projectIdSource: input.projectId ? 'operator_input' : null,
    },
    snapshot: {
      commitMessage: input.commitMessage,
      afterExperimentSourceRef: input.afterExperimentSourceRef,
      changedFiles: input.changedFilesFromGitStatus,
      changedProductFiles: input.classification.changedProductFiles,
      changedVisualWorkbenchFiles: input.classification.changedVisualWorkbenchFiles,
      forbiddenChangedFiles: input.classification.forbiddenChangedFiles,
    },
    nextCommands: {
      visualWorkbenchInspect: visualWorkbenchHandoff.nextCommandOrder.includes('visualWorkbenchInspect')
        ? visualWorkbenchHandoffCommand(input, 'inspect')
        : null,
      visualWorkbenchSelectorReadiness: visualWorkbenchHandoff.nextCommandOrder.includes('visualWorkbenchSelectorReadiness')
        ? visualWorkbenchHandoffCommand(input, 'selector-readiness')
        : null,
      visualWorkbenchEvidenceChainReadiness: visualWorkbenchHandoff.nextCommandOrder.includes('visualWorkbenchEvidenceChainReadiness')
        ? visualWorkbenchHandoffCommand(input, 'evidence-chain-readiness')
        : null,
      visualWorkbenchCaptureSelectedStoryViewports: null,
      visualWorkbenchCapture: null,
    },
    visualWorkbenchHandoff,
    output: {
      outDir: input.outDir,
      reportPath: input.reportPath,
    },
    error: input.error,
    notes: [
      'executor_workspace_source_snapshot creates an experiment-only local source ref from executor workspace changes.',
      'It is not product source truth, lifecycle truth, task evidence, proof truth or a deployment.',
      'Visual Workbench readiness must still be run explicitly by the operator.',
      'This stage does not emit a capture command; capture belongs after selector-readiness has produced explicit story and viewport values.',
    ],
  };
}

function buildVisualWorkbenchHandoff(input: {
  executorReport: Pick<ExecutorTaskWorkspaceResult, 'status' | 'source' | 'task' | 'agent'>;
  classification: ExecutorChangedFileClassification;
  afterExperimentSourceRef: string | null;
  projectId: string | null;
}): ExecutorWorkspaceSourceSnapshotResult['visualWorkbenchHandoff'] {
  if (!input.afterExperimentSourceRef) {
    return {
      status: 'blocked',
      reason: 'experiment_source_ref_missing',
      taskId: input.executorReport.task.id,
      projectId: input.projectId,
      visualEvidenceRequired: input.executorReport.task.visualEvidenceRequired,
      visualExpectationSources: input.executorReport.task.visualExpectationSources,
      changedVisualWorkbenchFiles: input.classification.changedVisualWorkbenchFiles,
      changedProductFiles: input.classification.changedProductFiles,
      blockers: ['experiment_source_ref_missing'],
      warnings: [],
      nextCommandOrder: [],
      notes: [
        'Create a successful executor_workspace_source_snapshot result before running Visual Workbench readiness stages.',
      ],
    };
  }

  if (!input.executorReport.task.hasStructuredVisualExpectation) {
    return {
      status: 'not_applicable',
      reason: 'no_structured_visual_expectation',
      taskId: input.executorReport.task.id,
      projectId: input.projectId,
      visualEvidenceRequired: input.executorReport.task.visualEvidenceRequired,
      visualExpectationSources: input.executorReport.task.visualExpectationSources,
      changedVisualWorkbenchFiles: input.classification.changedVisualWorkbenchFiles,
      changedProductFiles: input.classification.changedProductFiles,
      blockers: [],
      warnings: input.classification.changedVisualWorkbenchFiles.length > 0
        ? ['visual_workbench_files_changed_without_structured_task_expectation']
        : [],
      nextCommandOrder: input.classification.changedVisualWorkbenchFiles.length > 0
        ? ['visualWorkbenchInspect']
        : [],
      notes: [
        'The selected task has no structured visual expectation, so this stage does not route it into screenshot evidence readiness.',
        'Changed Workbench files can still be inspected manually, but they do not create task proof or screenshot-review availability.',
      ],
    };
  }

  return {
    status: 'ready_for_readiness_checks',
    reason: 'structured_visual_expectation',
    taskId: input.executorReport.task.id,
    projectId: input.projectId,
    visualEvidenceRequired: input.executorReport.task.visualEvidenceRequired,
    visualExpectationSources: input.executorReport.task.visualExpectationSources,
    changedVisualWorkbenchFiles: input.classification.changedVisualWorkbenchFiles,
    changedProductFiles: input.classification.changedProductFiles,
    blockers: [],
    warnings: input.classification.changedVisualWorkbenchFiles.length === 0
      ? ['structured_visual_expectation_without_workbench_file_changes']
      : [],
    nextCommandOrder: [
      'visualWorkbenchInspect',
      'visualWorkbenchSelectorReadiness',
      'visualWorkbenchEvidenceChainReadiness',
    ],
    notes: [
      'Run manifest and selector readiness first; selector readiness owns story/task matching.',
      'Do not infer story or viewport selection from changed filenames, routes, titles or screenshots.',
      'Capture must be requested by a downstream selector-ready stage with explicit story_viewports values; this handoff never falls back to full-manifest capture.',
    ],
  };
}

function visualWorkbenchHandoffCommand(
  input: {
    workDir: string;
    afterExperimentSourceRef: string | null;
    executorReport: Pick<ExecutorTaskWorkspaceResult, 'status' | 'source' | 'task' | 'agent'>;
    projectId: string | null;
  },
  command:
    | 'inspect'
    | 'selector-readiness'
    | 'evidence-chain-readiness',
): string | null {
  if (!input.afterExperimentSourceRef) return null;
  switch (command) {
    case 'inspect':
      return `ralph visual-workbench inspect --work-dir ${input.workDir} --source-ref ${input.afterExperimentSourceRef} --compact`;
    case 'selector-readiness':
      return `ralph visual-workbench selector-readiness --work-dir ${input.workDir} --task ${input.executorReport.task.id} --compact`;
    case 'evidence-chain-readiness':
      return [
        `ralph visual-workbench evidence-chain-readiness --work-dir ${input.workDir}`,
        `--task ${input.executorReport.task.id}`,
        ...(input.projectId ? [`--project-id ${input.projectId}`] : []),
        '--compact',
      ].join(' ');
  }
}

async function writeSnapshotResult(result: ExecutorWorkspaceSourceSnapshotResult): Promise<ExecutorWorkspaceSourceSnapshotResult> {
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

function emptyClassification(): ExecutorChangedFileClassification {
  return {
    changedProductFiles: [],
    changedTaskWorkspaceFiles: [],
    changedVisualWorkbenchFiles: [],
    forbiddenChangedFiles: [],
    adHocProofLikeFiles: [],
  };
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
