import { dirname, resolve } from 'node:path';
import type { Stats } from 'node:fs';
import fs from 'fs-extra';
import { z } from 'zod';
import { TaskSchema } from '../config/types.js';
import type { Agent } from '../agents/base.js';
import type { AgentResult, ExecutorActionReportVisualExpectation, VisualEvidenceMode } from '../config/types.js';
import {
  parsePromptLabFixture,
  renderPromptLabFixture,
  type PromptLabPromptId,
} from '../prompts/prompt-lab.js';
import {
  EXECUTOR_OBSERVER_OWNER_BOUNDARY,
  classifyExecutorChangedFiles,
  getTaskVisualExpectation,
  normalizeExecutorChangedFiles,
  parseExecutorGitStatusChangedFiles,
  type ExecutorStageStatus,
  type ExecutorStageVisualWorkbenchCoverage,
  type ExecutorStageWarning,
} from '../loop/executor-observer.js';
import {
  EXECUTOR_ACTION_CORE_OWNER_BOUNDARY,
  runExecutorActionCore,
} from '../loop/executor-action-core.js';
import type { ExecutorAgentPromptFixture } from '../loop/executor-prompt.js';
import {
  readExecutorGitStatusLines as gitStatus,
  resolveExecutorSourceRefAtHead,
  sameExecutorChangedFileSet,
} from '../loop/executor-source-evidence.js';
import {
  EXECUTOR_TASK_WORKSPACE_RESULT_SCHEMA_VERSION,
} from './executor-task-workspace.js';
import { buildAgentOutputPreview } from './agent-output-preview.js';
import { assertOutputDirOutsideWorkDir, assertStageFixturePathAllowed, sha256 } from './stage-io.js';

export const EXECUTOR_TASK_WORKSPACE_CONTINUE_RESULT_SCHEMA_VERSION = 'ra-356.executor-task-workspace-continue-result.v0' as const;
export const EXECUTOR_TASK_WORKSPACE_CONTINUE_REPORT_FILE = 'executor-task-workspace-continue-run.json' as const;

export type ExecutorTaskWorkspaceContinueAgent = Pick<Agent, 'name' | 'execute'>;

const PreviousExecutorWorkspaceReportSchema = z.object({
  schemaVersion: z.union([
    z.literal(EXECUTOR_TASK_WORKSPACE_RESULT_SCHEMA_VERSION),
    z.literal(EXECUTOR_TASK_WORKSPACE_CONTINUE_RESULT_SCHEMA_VERSION),
  ]),
  stage: z.object({
    stageId: z.union([
      z.literal('executor_task_workspace'),
      z.literal('executor_task_workspace_continue'),
    ]),
  }).passthrough(),
  status: z.enum(['completed', 'blocked', 'agent_failed', 'forbidden_mutation']),
  source: z.object({
    workDir: z.string(),
    requestedSourceRef: z.string(),
    resolvedSourceRef: z.string().nullable(),
    headBefore: z.string().nullable(),
    headAfter: z.string().nullable(),
    headChanged: z.boolean().optional(),
    changedFilesFromGitStatus: z.array(z.string()),
  }).passthrough(),
  task: z.object({
    id: z.string(),
    displayTitle: z.string().nullable().optional(),
    visualEvidenceRequired: z.boolean().nullable(),
    hasStructuredVisualExpectation: z.boolean(),
    visualExpectationSources: z.array(z.string()),
  }).passthrough(),
  agent: z.object({
    name: z.string(),
    model: z.string().nullable(),
  }).passthrough(),
  executorOutput: z.object({
    summary: z.object({
      forbiddenChangedFiles: z.array(z.string()),
    }).passthrough().nullable(),
  }).passthrough(),
}).passthrough();

type PreviousExecutorWorkspaceReport = z.infer<typeof PreviousExecutorWorkspaceReportSchema>;

export type ExecutorTaskWorkspaceContinueResult = {
  schemaVersion: typeof EXECUTOR_TASK_WORKSPACE_CONTINUE_RESULT_SCHEMA_VERSION;
  stage: {
    stageId: 'executor_task_workspace_continue';
    mode: 'workspace_mutation_continuation';
    ownerBoundary: typeof EXECUTOR_ACTION_CORE_OWNER_BOUNDARY;
    promptVariantRef: string | null;
    sourceRef: string;
    allowedMutations: string[];
    forbiddenMutations: string[];
    handoff: string[];
  };
  status: 'completed' | 'blocked' | 'agent_failed' | 'forbidden_mutation';
  previousReport: {
    path: string;
    sha256: string;
    schemaVersion: string;
    stageId: string;
    status: PreviousExecutorWorkspaceReport['status'];
    taskId: string;
    sourceRef: string | null;
    headAfter: string | null;
    changedFilesFromGitStatus: string[];
    forbiddenChangedFiles: string[];
  };
  source: {
    workDir: string;
    requestedSourceRef: string;
    resolvedSourceRef: string | null;
    headBefore: string | null;
    headAfter: string | null;
    headChanged: boolean;
    beforeGitStatus: string[] | null;
    afterGitStatus: string[] | null;
    expectedDirtyChangedFiles: string[];
    changedFilesFromGitStatus: string[];
  };
  task: {
    id: string;
    displayTitle: string | null;
    visualEvidenceMode: VisualEvidenceMode;
    visualEvidenceRequired: boolean | null;
    hasStructuredVisualExpectation: boolean;
    visualExpectationSources: string[];
  };
  prompt: {
    promptId: PromptLabPromptId;
    renderedSha256: string;
    renderedCharCount: number;
  };
  agent: {
    name: string;
    model: string | null;
    timeoutMinutes: number | null;
    outputSha256: string | null;
    outputCharCount: number | null;
    outputPreview: string | null;
    outputPreviewTruncated: boolean;
    declaredFilesChanged: string[];
    providerSessionId: string | null;
    providerSessionResumedFrom: string | null;
    providerSessionResumeFallbackReason: string | null;
    success: boolean | null;
    errorCategory: string | null;
    errorMessage: string | null;
  };
  executorOutput: {
    ownerBoundary: typeof EXECUTOR_OBSERVER_OWNER_BOUNDARY | null;
    status: ExecutorStageStatus | null;
    visualEvidenceMode: VisualEvidenceMode | null;
    visualExpectation: ExecutorActionReportVisualExpectation | null;
    summary: {
      filesChangedCount: number;
      changedProductFiles: string[];
      changedTaskWorkspaceFiles: string[];
      changedVisualWorkbenchFiles: string[];
      forbiddenChangedFiles: string[];
      adHocProofLikeFiles: string[];
      visualWorkbenchCoverage: ExecutorStageVisualWorkbenchCoverage;
      expectedVisualWorkbenchStoryIds: string[];
      coveredExpectedVisualWorkbenchStoryIds: string[];
      missingExpectedVisualWorkbenchStoryIds: string[];
    } | null;
    detectedCompletionPromiseFound: boolean | null;
    needsReplanSignalDetected: boolean | null;
    malformedCompletion: string | null;
    warnings: ExecutorStageWarning[];
  };
  output: {
    outDir: string;
    reportPath: string;
  };
  error: null | {
    code:
      | 'previous_report_not_agent_failed'
      | 'previous_report_workspace_mismatch'
      | 'previous_report_source_mismatch'
      | 'previous_report_head_changed'
      | 'previous_report_forbidden_mutation'
      | 'previous_report_task_mismatch'
      | 'source_ref_unavailable'
      | 'source_ref_mismatch'
      | 'workspace_status_mismatch'
      | 'workspace_not_dirty'
      | 'agent_failed'
      | 'source_evidence_unavailable'
      | 'head_changed'
      | 'post_git_status_unavailable'
      | 'forbidden_mutation';
    message: string;
  };
  notes: string[];
};

export async function runExecutorTaskWorkspaceContinue(input: {
  previousExecutorWorkspaceReport: unknown;
  previousExecutorWorkspaceReportPath?: string | null;
  previousExecutorWorkspaceReportRaw?: string | null;
  task: unknown;
  promptFixture: unknown;
  completionPromise: string;
  visualEvidenceMode: VisualEvidenceMode;
  expectedVisualWorkbenchStoryIds?: string[];
  promptVariantRef?: string | null;
  workDir: string;
  sourceRef: string;
  outDir: string;
  agent: ExecutorTaskWorkspaceContinueAgent;
  model?: string | null;
  timeoutMinutes?: number | null;
}): Promise<ExecutorTaskWorkspaceContinueResult> {
  const workDir = resolve(input.workDir);
  const outDir = resolve(input.outDir);
  await assertExistingDirectory(workDir, 'executor_task_workspace_continue --work-dir');
  assertOutputDirOutsideWorkDir({
    stageId: 'executor_task_workspace_continue',
    workDir,
    outDir,
  });
  const reportPath = resolve(outDir, EXECUTOR_TASK_WORKSPACE_CONTINUE_REPORT_FILE);
  if (await fs.pathExists(reportPath)) {
    throw new Error(`executor_task_workspace_continue --out-dir already contains ${EXECUTOR_TASK_WORKSPACE_CONTINUE_REPORT_FILE}; refusing to overwrite experiment output.`);
  }
  await fs.ensureDir(outDir);

  const previousReport = PreviousExecutorWorkspaceReportSchema.parse(input.previousExecutorWorkspaceReport);
  const task = TaskSchema.parse(input.task);
  const promptFixture = parsePromptLabFixture(input.promptFixture);
  if (promptFixture.promptId !== 'executor.agentPrompt') {
    throw new Error(`executor_task_workspace_continue requires executor.agentPrompt fixture, got ${promptFixture.promptId}.`);
  }
  const executorPromptFixture = promptFixture as ExecutorAgentPromptFixture;
  if (!input.completionPromise.trim()) {
    throw new Error('executor_task_workspace_continue requires an explicit completionPromise.');
  }
  const sourceRef = input.sourceRef.trim();
  if (!sourceRef) throw new Error('executor_task_workspace_continue requires an explicit sourceRef.');

  const continuationPromptFixture = buildContinuationPromptFixture({
    promptFixture: executorPromptFixture,
    previousReport,
  });
  const previousReportSourceRef = previousReport.source.resolvedSourceRef ?? previousReport.source.headBefore;
  const previousChangedFiles = normalizeExecutorChangedFiles(
    previousReport.source.changedFilesFromGitStatus,
    'executor_task_workspace_continue previous report changed files',
  );
  const previousForbiddenFiles = normalizeExecutorChangedFiles(
    previousReport.executorOutput.summary?.forbiddenChangedFiles ?? [],
    'executor_task_workspace_continue previous report forbidden changed files',
  );
  const baseInput = {
    previousReport,
    previousReportPath: input.previousExecutorWorkspaceReportPath ?? null,
    previousReportSha256: input.previousExecutorWorkspaceReportRaw
      ? `sha256:${sha256(input.previousExecutorWorkspaceReportRaw)}`
      : null,
    task,
    promptFixture: continuationPromptFixture,
    completionPromise: input.completionPromise,
    visualEvidenceMode: input.visualEvidenceMode,
    expectedVisualWorkbenchStoryIds: input.expectedVisualWorkbenchStoryIds ?? [],
    promptVariantRef: input.promptVariantRef ?? null,
    workDir,
    sourceRef,
    outDir,
    reportPath,
    agentName: input.agent.name,
    model: input.model ?? null,
    timeoutMinutes: input.timeoutMinutes ?? null,
    previousReportSourceRef,
    previousChangedFiles,
    previousForbiddenFiles,
  };

  if (previousReport.status !== 'agent_failed') {
    return writeContinuationResult(baseContinuationResult({
      ...baseInput,
      resolvedSourceRef: previousReportSourceRef,
      headBefore: previousReport.source.headAfter,
      headAfter: previousReport.source.headAfter,
      beforeGitStatus: null,
      afterGitStatus: null,
      changedFilesFromGitStatus: previousChangedFiles,
      status: 'blocked',
      error: {
        code: 'previous_report_not_agent_failed',
        message: `executor_task_workspace_continue requires a previous agent_failed report, got ${previousReport.status}.`,
      },
    }));
  }

  if (previousReport.source.headChanged === true || previousReport.source.headBefore !== previousReport.source.headAfter) {
    return writeContinuationResult(baseContinuationResult({
      ...baseInput,
      resolvedSourceRef: previousReportSourceRef,
      headBefore: previousReport.source.headAfter,
      headAfter: previousReport.source.headAfter,
      beforeGitStatus: null,
      afterGitStatus: null,
      changedFilesFromGitStatus: previousChangedFiles,
      status: 'forbidden_mutation',
      error: {
        code: 'previous_report_head_changed',
        message: 'executor_task_workspace_continue refuses to continue a previous report that changed HEAD.',
      },
    }));
  }

  if (previousForbiddenFiles.length > 0) {
    return writeContinuationResult(baseContinuationResult({
      ...baseInput,
      resolvedSourceRef: previousReportSourceRef,
      headBefore: previousReport.source.headAfter,
      headAfter: previousReport.source.headAfter,
      beforeGitStatus: null,
      afterGitStatus: null,
      changedFilesFromGitStatus: previousChangedFiles,
      status: 'forbidden_mutation',
      error: {
        code: 'previous_report_forbidden_mutation',
        message: `executor_task_workspace_continue refuses to continue a previous report with forbidden changed files: ${previousForbiddenFiles.join(', ')}`,
      },
    }));
  }

  if (task.id !== previousReport.task.id) {
    return writeContinuationResult(baseContinuationResult({
      ...baseInput,
      resolvedSourceRef: previousReportSourceRef,
      headBefore: previousReport.source.headAfter,
      headAfter: previousReport.source.headAfter,
      beforeGitStatus: null,
      afterGitStatus: null,
      changedFilesFromGitStatus: previousChangedFiles,
      status: 'blocked',
      error: {
        code: 'previous_report_task_mismatch',
        message: `executor_task_workspace_continue task fixture id ${task.id} does not match previous report task ${previousReport.task.id}.`,
      },
    }));
  }

  if (!await pathsResolveToSameLocation(workDir, previousReport.source.workDir)) {
    return writeContinuationResult(baseContinuationResult({
      ...baseInput,
      resolvedSourceRef: previousReportSourceRef,
      headBefore: previousReport.source.headAfter,
      headAfter: previousReport.source.headAfter,
      beforeGitStatus: null,
      afterGitStatus: null,
      changedFilesFromGitStatus: previousChangedFiles,
      status: 'blocked',
      error: {
        code: 'previous_report_workspace_mismatch',
        message: `executor_task_workspace_continue workDir does not match previous report workDir ${previousReport.source.workDir}.`,
      },
    }));
  }

  if (sourceRef !== previousReportSourceRef) {
    return writeContinuationResult(baseContinuationResult({
      ...baseInput,
      resolvedSourceRef: previousReportSourceRef,
      headBefore: previousReport.source.headAfter,
      headAfter: previousReport.source.headAfter,
      beforeGitStatus: null,
      afterGitStatus: null,
      changedFilesFromGitStatus: previousChangedFiles,
      status: 'blocked',
      error: {
        code: 'previous_report_source_mismatch',
        message: `executor_task_workspace_continue sourceRef ${sourceRef} does not match previous report sourceRef ${previousReportSourceRef ?? 'unavailable'}.`,
      },
    }));
  }

  const sourceResolution = await resolveExecutorSourceRefAtHead({
    workDir,
    sourceRef,
    stageId: 'executor_task_workspace_continue',
  });
  if (sourceResolution.error) {
    return writeContinuationResult(baseContinuationResult({
      ...baseInput,
      resolvedSourceRef: sourceResolution.resolvedSourceRef,
      headBefore: sourceResolution.headRef,
      headAfter: sourceResolution.headRef,
      beforeGitStatus: null,
      afterGitStatus: null,
      changedFilesFromGitStatus: previousChangedFiles,
      status: 'blocked',
      error: sourceResolution.error,
    }));
  }

  const beforeGitStatus = await gitStatus(workDir);
  if (beforeGitStatus == null) {
    return writeContinuationResult(baseContinuationResult({
      ...baseInput,
      resolvedSourceRef: sourceResolution.resolvedSourceRef,
      headBefore: sourceResolution.headRef,
      headAfter: sourceResolution.headRef,
      beforeGitStatus,
      afterGitStatus: null,
      changedFilesFromGitStatus: previousChangedFiles,
      status: 'blocked',
      error: {
        code: 'source_ref_unavailable',
        message: 'executor_task_workspace_continue requires git status evidence before continuing the executor stage.',
      },
    }));
  }
  const beforeChangedFiles = normalizeExecutorChangedFiles(
    parseExecutorGitStatusChangedFiles(beforeGitStatus),
    'executor_task_workspace_continue git status changed files',
  );
  const beforeClassification = classifyExecutorChangedFiles(beforeChangedFiles, task.id, {
    allowTaskWorkspaceFiles: false,
  });
  if (!sameExecutorChangedFileSet(beforeChangedFiles, previousChangedFiles)) {
    return writeContinuationResult(baseContinuationResult({
      ...baseInput,
      resolvedSourceRef: sourceResolution.resolvedSourceRef,
      headBefore: sourceResolution.headRef,
      headAfter: sourceResolution.headRef,
      beforeGitStatus,
      afterGitStatus: beforeGitStatus,
      changedFilesFromGitStatus: beforeChangedFiles,
      status: 'blocked',
      error: {
        code: 'workspace_status_mismatch',
        message: 'executor_task_workspace_continue current dirty workspace changed files differ from the previous executor report.',
      },
    }));
  }
  if (beforeChangedFiles.length === 0) {
    return writeContinuationResult(baseContinuationResult({
      ...baseInput,
      resolvedSourceRef: sourceResolution.resolvedSourceRef,
      headBefore: sourceResolution.headRef,
      headAfter: sourceResolution.headRef,
      beforeGitStatus,
      afterGitStatus: beforeGitStatus,
      changedFilesFromGitStatus: beforeChangedFiles,
      status: 'blocked',
      error: {
        code: 'workspace_not_dirty',
        message: 'executor_task_workspace_continue requires the same dirty fork left by a previous failed executor report.',
      },
    }));
  }
  if (beforeClassification.forbiddenChangedFiles.length > 0) {
    return writeContinuationResult(baseContinuationResult({
      ...baseInput,
      resolvedSourceRef: sourceResolution.resolvedSourceRef,
      headBefore: sourceResolution.headRef,
      headAfter: sourceResolution.headRef,
      beforeGitStatus,
      afterGitStatus: beforeGitStatus,
      changedFilesFromGitStatus: beforeChangedFiles,
      status: 'forbidden_mutation',
      error: {
        code: 'forbidden_mutation',
        message: `executor_task_workspace_continue changed forbidden runner/loop/proof/lifecycle paths before continuation: ${beforeClassification.forbiddenChangedFiles.join(', ')}`,
      },
    }));
  }

  const coreResult = await runExecutorActionCore({
    stageId: 'executor_task_workspace_continue',
    task,
    workDir,
    prompt: {
      kind: 'fixture',
      fixture: continuationPromptFixture,
    },
    agent: input.agent,
    agentCall: {
      model: input.model ?? null,
      timeoutMinutes: input.timeoutMinutes ?? null,
      verbose: false,
      providerSessionResumeId: null,
    },
    completionPromise: input.completionPromise,
    visualEvidenceMode: input.visualEvidenceMode,
    expectedVisualWorkbenchStoryIds: input.expectedVisualWorkbenchStoryIds ?? [],
    changedFilesSourceLabel: 'Continuation workspace diff',
    classificationOptions: {
      allowTaskWorkspaceFiles: false,
    },
    sourceMode: {
      kind: 'post_call_status',
      preAgentPolicy: 'caller_validated',
    },
    agentFailureMessage: 'Executor continuation stage agent failed.',
    headBefore: sourceResolution.headRef,
  });

  if (coreResult.status === 'blocked_before_agent') {
    return writeContinuationResult(baseContinuationResult({
      ...baseInput,
      resolvedSourceRef: sourceResolution.resolvedSourceRef,
      headBefore: coreResult.sourceEvidence.headBefore,
      headAfter: coreResult.sourceEvidence.headAfter,
      beforeGitStatus: coreResult.sourceEvidence.beforeGitStatus,
      afterGitStatus: coreResult.sourceEvidence.afterGitStatus,
      changedFilesFromGitStatus: beforeChangedFiles,
      status: 'blocked',
      error: {
        code: coreResult.error.code === 'pre_git_status_unavailable'
          ? 'source_ref_unavailable'
          : 'workspace_status_mismatch',
        message: coreResult.error.message,
      },
    }));
  }

  if (coreResult.status === 'source_evidence_unavailable_after_agent') {
    return writeContinuationResult({
      ...baseContinuationResult({
        ...baseInput,
        resolvedSourceRef: sourceResolution.resolvedSourceRef,
        headBefore: coreResult.sourceEvidence.headBefore,
        headAfter: coreResult.sourceEvidence.headAfter,
        beforeGitStatus: coreResult.sourceEvidence.beforeGitStatus,
        afterGitStatus: coreResult.sourceEvidence.afterGitStatus,
        changedFilesFromGitStatus: beforeChangedFiles,
        status: 'forbidden_mutation',
        error: {
          code: 'post_git_status_unavailable',
          message: coreResult.error.message,
        },
      }),
      agent: buildAgentResultSummary({
        agentName: input.agent.name,
        model: input.model ?? null,
        timeoutMinutes: input.timeoutMinutes ?? null,
        agentResult: coreResult.agentResult,
        includeOutputPreview: false,
      }),
    });
  }

  return writeContinuationResult({
    ...baseContinuationResult({
      ...baseInput,
      resolvedSourceRef: sourceResolution.resolvedSourceRef,
      headBefore: coreResult.sourceEvidence.headBefore,
      headAfter: coreResult.sourceEvidence.headAfter,
      beforeGitStatus: coreResult.sourceEvidence.beforeGitStatus,
      afterGitStatus: coreResult.sourceEvidence.afterGitStatus,
      changedFilesFromGitStatus: coreResult.sourceEvidence.changedFilesForObserver,
      status: coreResult.mutationOutcome.status,
      error: coreResult.mutationOutcome.error,
    }),
    agent: buildAgentResultSummary({
      agentName: input.agent.name,
      model: input.model ?? null,
      timeoutMinutes: input.timeoutMinutes ?? null,
      agentResult: coreResult.agentResult,
      includeOutputPreview: coreResult.mutationOutcome.status === 'agent_failed',
    }),
    executorOutput: coreResult.executorOutput,
  });
}

export async function runExecutorTaskWorkspaceContinueFiles(input: {
  executorWorkspaceReportPath: string;
  taskFixturePath: string;
  promptFixturePath: string;
  completionPromise: string;
  visualEvidenceMode: VisualEvidenceMode;
  expectedVisualWorkbenchStoryIds?: string[];
  promptVariantRef?: string | null;
  workDir: string;
  sourceRef: string;
  outDir: string;
  agent: ExecutorTaskWorkspaceContinueAgent;
  model?: string | null;
  timeoutMinutes?: number | null;
}): Promise<ExecutorTaskWorkspaceContinueResult> {
  const executorWorkspaceReportPath = resolve(input.executorWorkspaceReportPath);
  const taskFixturePath = resolve(input.taskFixturePath);
  const promptFixturePath = resolve(input.promptFixturePath);
  assertStageFixturePathAllowed(executorWorkspaceReportPath, 'executor_task_workspace_continue --executor-workspace-report');
  assertStageFixturePathAllowed(taskFixturePath, 'executor_task_workspace_continue --task-fixture');
  assertStageFixturePathAllowed(promptFixturePath, 'executor_task_workspace_continue --prompt-fixture');
  const previousExecutorWorkspaceReportRaw = await fs.readFile(executorWorkspaceReportPath, 'utf8');
  return runExecutorTaskWorkspaceContinue({
    previousExecutorWorkspaceReport: JSON.parse(previousExecutorWorkspaceReportRaw),
    previousExecutorWorkspaceReportPath: executorWorkspaceReportPath,
    previousExecutorWorkspaceReportRaw,
    task: await fs.readJson(taskFixturePath),
    promptFixture: await fs.readJson(promptFixturePath),
    completionPromise: input.completionPromise,
    visualEvidenceMode: input.visualEvidenceMode,
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

export function formatExecutorTaskWorkspaceContinueResult(
  result: ExecutorTaskWorkspaceContinueResult,
  compact = false,
): string {
  return `${JSON.stringify(result, null, compact ? 0 : 2)}\n`;
}

function buildContinuationPromptFixture(input: {
  promptFixture: ExecutorAgentPromptFixture;
  previousReport: PreviousExecutorWorkspaceReport;
}): ExecutorAgentPromptFixture {
  if (!isExecutorPromptInput(input.promptFixture.input)) {
    throw new Error('executor_task_workspace_continue requires executor.agentPrompt fixture input.contextSections.');
  }
  return {
    ...input.promptFixture,
    name: `${input.promptFixture.name ?? 'executor-prompt'}-dirty-fork-continuation`,
    input: {
      ...input.promptFixture.input,
      contextSections: [
        [
          '# RA-356 Dirty Fork Continuation Boundary',
          '- This is an explicit manual continuation of a previous failed executor experiment in the same dirty fork workspace.',
          '- Continue only the same selected task from the previous report.',
          '- Preserve useful existing source changes already present in the dirty fork.',
          '- Do not restart planner, controller, lifecycle, verification, deployment, retry, relaunch or task state flows.',
          '- Do not edit `.ralph/`, `.arena/`, proof, lifecycle, runtime, provider-session or progress files.',
          `- Previous report stage: ${input.previousReport.stage.stageId}.`,
          `- Previous report status: ${input.previousReport.status}.`,
          `- Previous dirty changed files: ${input.previousReport.source.changedFilesFromGitStatus.join(', ') || '(none)'}.`,
        ].join('\n'),
        input.promptFixture.input.contextSections,
      ].join('\n\n---\n\n'),
    },
  };
}

function isExecutorPromptInput(value: unknown): value is { contextSections: string } {
  return typeof value === 'object'
    && value !== null
    && 'contextSections' in value
    && typeof (value as { contextSections?: unknown }).contextSections === 'string';
}

function buildAgentResultSummary(
  input: {
    agentName: string;
    model: string | null;
    timeoutMinutes: number | null;
    agentResult: AgentResult;
    includeOutputPreview: boolean;
  },
): ExecutorTaskWorkspaceContinueResult['agent'] {
  let declaredFilesChanged: string[] = [];
  let errorMessage = input.agentResult.error?.message ?? null;
  try {
    declaredFilesChanged = normalizeExecutorChangedFiles(
      input.agentResult.filesChanged,
      'executor_task_workspace_continue agentResult.filesChanged',
    );
  } catch (error) {
    errorMessage = [
      errorMessage,
      error instanceof Error ? error.message : String(error),
    ].filter(Boolean).join(' ');
  }
  const outputPreview = input.includeOutputPreview
    ? buildAgentOutputPreview(input.agentResult.output)
    : { outputPreview: null, outputPreviewTruncated: false };
  return {
    name: input.agentName,
    model: input.model,
    timeoutMinutes: input.timeoutMinutes,
    outputSha256: `sha256:${sha256(input.agentResult.output)}`,
    outputCharCount: input.agentResult.output.length,
    ...outputPreview,
    declaredFilesChanged,
    providerSessionId: input.agentResult.providerSession?.id ?? null,
    providerSessionResumedFrom: input.agentResult.providerSession?.resumedFrom ?? null,
    providerSessionResumeFallbackReason: input.agentResult.providerSession?.resumeFallbackReason ?? null,
    success: input.agentResult.success,
    errorCategory: input.agentResult.error?.category ?? null,
    errorMessage,
  };
}

function baseContinuationResult(input: {
  previousReport: PreviousExecutorWorkspaceReport;
  previousReportPath: string | null;
  previousReportSha256: string | null;
  previousReportSourceRef: string | null;
  previousChangedFiles: string[];
  previousForbiddenFiles: string[];
  task: ReturnType<typeof TaskSchema.parse>;
  promptFixture: ReturnType<typeof parsePromptLabFixture>;
  completionPromise: string;
  visualEvidenceMode: VisualEvidenceMode;
  expectedVisualWorkbenchStoryIds: string[];
  promptVariantRef: string | null;
  workDir: string;
  sourceRef: string;
  outDir: string;
  reportPath: string;
  agentName: string;
  model: string | null;
  timeoutMinutes: number | null;
  resolvedSourceRef: string | null;
  headBefore: string | null;
  headAfter: string | null;
  beforeGitStatus: string[] | null;
  afterGitStatus: string[] | null;
  changedFilesFromGitStatus: string[];
  status: ExecutorTaskWorkspaceContinueResult['status'];
  error: ExecutorTaskWorkspaceContinueResult['error'];
}): ExecutorTaskWorkspaceContinueResult {
  const visualExpectation = getTaskVisualExpectation(input.task);
  const promptReplay = renderPromptLabFixture({
    fixture: input.promptFixture,
    fixturePath: null,
  });
  return {
    schemaVersion: EXECUTOR_TASK_WORKSPACE_CONTINUE_RESULT_SCHEMA_VERSION,
    stage: {
      stageId: 'executor_task_workspace_continue',
      mode: 'workspace_mutation_continuation',
      ownerBoundary: EXECUTOR_ACTION_CORE_OWNER_BOUNDARY,
      promptVariantRef: input.promptVariantRef,
      sourceRef: input.resolvedSourceRef ?? input.sourceRef,
      allowedMutations: [
        input.workDir,
        input.outDir,
      ],
      forbiddenMutations: [
        '.ralph/plan.json',
        '.ralph/decisions-log.json',
        '.ralph/ralph-progress.json',
        '.ralph/iteration-log.json',
        '.ralph/controller-reports/',
        '.ralph/agent-logs/',
        '.ralph/evidence/',
        '.ralph/tasks/',
        '.arena/',
        'task verificationEvidence',
        'proofReviews[]',
        'ProjectAsset',
        'runtime intents',
        'lifecycle state',
        'git commit or HEAD change',
      ],
      handoff: [
        'inspect_continuation_workspace_diff',
        'run_executor_workspace_source_snapshot_if_completed_and_selected',
        'run_visual_workbench_manifest_readiness_if_visual_files_changed',
        'discard_or_reset_forked_workspace',
      ],
    },
    status: input.status,
    previousReport: {
      path: input.previousReportPath ?? '(inline)',
      sha256: input.previousReportSha256 ?? 'sha256:unavailable-inline',
      schemaVersion: input.previousReport.schemaVersion,
      stageId: input.previousReport.stage.stageId,
      status: input.previousReport.status,
      taskId: input.previousReport.task.id,
      sourceRef: input.previousReportSourceRef,
      headAfter: input.previousReport.source.headAfter,
      changedFilesFromGitStatus: input.previousChangedFiles,
      forbiddenChangedFiles: input.previousForbiddenFiles,
    },
    source: {
      workDir: input.workDir,
      requestedSourceRef: input.sourceRef,
      resolvedSourceRef: input.resolvedSourceRef,
      headBefore: input.headBefore,
      headAfter: input.headAfter,
      headChanged: input.headBefore !== input.headAfter,
      beforeGitStatus: input.beforeGitStatus,
      afterGitStatus: input.afterGitStatus,
      expectedDirtyChangedFiles: input.previousChangedFiles,
      changedFilesFromGitStatus: input.changedFilesFromGitStatus,
    },
    task: {
      id: input.task.id,
      displayTitle: input.task.displayTitle ?? input.previousReport.task.displayTitle ?? null,
      visualEvidenceMode: input.visualEvidenceMode,
      visualEvidenceRequired: input.task.visualEvidenceRequired ?? input.previousReport.task.visualEvidenceRequired ?? null,
      hasStructuredVisualExpectation: visualExpectation.hasStructuredVisualExpectation,
      visualExpectationSources: visualExpectation.sources,
    },
    prompt: {
      promptId: input.promptFixture.promptId,
      renderedSha256: `sha256:${sha256(promptReplay.rendered.text)}`,
      renderedCharCount: promptReplay.rendered.charCount,
    },
    agent: {
      name: input.agentName,
      model: input.model,
      timeoutMinutes: input.timeoutMinutes,
      outputSha256: null,
      outputCharCount: null,
      outputPreview: null,
      outputPreviewTruncated: false,
      declaredFilesChanged: [],
      providerSessionId: null,
      providerSessionResumedFrom: null,
      providerSessionResumeFallbackReason: null,
      success: null,
      errorCategory: null,
      errorMessage: null,
    },
    executorOutput: {
      ownerBoundary: null,
      status: null,
      visualEvidenceMode: null,
      visualExpectation: null,
      summary: null,
      detectedCompletionPromiseFound: null,
      needsReplanSignalDetected: null,
      malformedCompletion: null,
      warnings: [],
    },
    output: {
      outDir: input.outDir,
      reportPath: input.reportPath,
    },
    error: input.error,
    notes: [
      'executor_task_workspace_continue is experiment output, not lifecycle or task truth.',
      'It accepts only the same dirty fork left by a previous agent_failed executor report.',
      'It rejects changed dirty status, forbidden prior changes and any HEAD drift before the agent call.',
      'It mutates only the explicit forked workDir and writes only the explicit outDir report.',
    ],
  };
}

async function writeContinuationResult(result: ExecutorTaskWorkspaceContinueResult): Promise<ExecutorTaskWorkspaceContinueResult> {
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
