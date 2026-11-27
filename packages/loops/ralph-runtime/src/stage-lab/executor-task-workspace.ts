import { dirname, resolve } from 'node:path';
import type { Stats } from 'node:fs';
import fs from 'fs-extra';
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
  getTaskVisualExpectation,
  normalizeExecutorChangedFiles,
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
  resolveExecutorSourceRefAtHead,
} from '../loop/executor-source-evidence.js';
import { buildAgentOutputPreview } from './agent-output-preview.js';
import { assertOutputDirOutsideWorkDir, assertStageFixturePathAllowed, sha256 } from './stage-io.js';

export const EXECUTOR_TASK_WORKSPACE_RESULT_SCHEMA_VERSION = 'ra-356.executor-task-workspace-result.v0' as const;
export const EXECUTOR_TASK_WORKSPACE_REPORT_FILE = 'executor-task-workspace-run.json' as const;

export type ExecutorTaskWorkspaceAgent = Pick<Agent, 'name' | 'execute'>;

export type ExecutorTaskWorkspaceResult = {
  schemaVersion: typeof EXECUTOR_TASK_WORKSPACE_RESULT_SCHEMA_VERSION;
  stage: {
    stageId: 'executor_task_workspace';
    mode: 'workspace_mutation';
    ownerBoundary: typeof EXECUTOR_ACTION_CORE_OWNER_BOUNDARY;
    promptVariantRef: string | null;
    sourceRef: string;
    allowedMutations: string[];
    forbiddenMutations: string[];
    handoff: string[];
  };
  status: 'completed' | 'blocked' | 'agent_failed' | 'forbidden_mutation';
  source: {
    workDir: string;
    requestedSourceRef: string;
    resolvedSourceRef: string | null;
    headBefore: string | null;
    headAfter: string | null;
    headChanged: boolean;
    beforeGitStatus: string[] | null;
    afterGitStatus: string[] | null;
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
    providerSessionResumeId: string | null;
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
      | 'source_ref_unavailable'
      | 'source_ref_mismatch'
      | 'workspace_dirty'
      | 'agent_failed'
      | 'source_evidence_unavailable'
      | 'head_changed'
      | 'post_git_status_unavailable'
      | 'forbidden_mutation';
    message: string;
  };
  notes: string[];
};

export async function runExecutorTaskWorkspace(input: {
  task: unknown;
  promptFixture: unknown;
  completionPromise: string;
  visualEvidenceMode: VisualEvidenceMode;
  expectedVisualWorkbenchStoryIds?: string[];
  promptVariantRef?: string | null;
  workDir: string;
  sourceRef: string;
  outDir: string;
  agent: ExecutorTaskWorkspaceAgent;
  model?: string | null;
  timeoutMinutes?: number | null;
  providerSessionResumeId?: string | null;
  now?: () => Date;
}): Promise<ExecutorTaskWorkspaceResult> {
  const workDir = resolve(input.workDir);
  const outDir = resolve(input.outDir);
  await assertExistingDirectory(workDir, 'executor_task_workspace --work-dir');
  assertOutputDirOutsideWorkDir({
    stageId: 'executor_task_workspace',
    workDir,
    outDir,
  });
  const reportPath = resolve(outDir, EXECUTOR_TASK_WORKSPACE_REPORT_FILE);
  if (await fs.pathExists(reportPath)) {
    throw new Error(`executor_task_workspace --out-dir already contains ${EXECUTOR_TASK_WORKSPACE_REPORT_FILE}; refusing to overwrite experiment output.`);
  }
  await fs.ensureDir(outDir);

  const task = TaskSchema.parse(input.task);
  const promptFixture = parsePromptLabFixture(input.promptFixture);
  if (promptFixture.promptId !== 'executor.agentPrompt') {
    throw new Error(`executor_task_workspace requires executor.agentPrompt fixture, got ${promptFixture.promptId}.`);
  }
  const executorPromptFixture = promptFixture as ExecutorAgentPromptFixture;
  if (!input.completionPromise.trim()) {
    throw new Error('executor_task_workspace requires an explicit completionPromise.');
  }

  const sourceRef = input.sourceRef.trim();
  if (!sourceRef) throw new Error('executor_task_workspace requires an explicit sourceRef.');

  const baseInput = {
    task,
    promptFixture: executorPromptFixture,
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
    providerSessionResumeId: input.providerSessionResumeId?.trim() || null,
  };

  const sourceResolution = await resolveExecutorSourceRefAtHead({
    workDir,
    sourceRef,
    stageId: 'executor_task_workspace',
  });
  if (sourceResolution.error) {
    return writeWorkspaceResult(baseWorkspaceResult({
      ...baseInput,
      resolvedSourceRef: sourceResolution.resolvedSourceRef,
      headBefore: sourceResolution.headRef,
      headAfter: sourceResolution.headRef,
      beforeGitStatus: null,
      afterGitStatus: null,
      changedFilesFromGitStatus: [],
      status: 'blocked',
      error: sourceResolution.error,
    }));
  }

  const coreResult = await runExecutorActionCore({
    stageId: 'executor_task_workspace',
    task,
    workDir,
    prompt: {
      kind: 'fixture',
      fixture: executorPromptFixture,
    },
    agent: input.agent,
    agentCall: {
      model: input.model ?? null,
      timeoutMinutes: input.timeoutMinutes ?? null,
      verbose: false,
      providerSessionResumeId: input.providerSessionResumeId ?? null,
    },
    completionPromise: input.completionPromise,
    visualEvidenceMode: input.visualEvidenceMode,
    expectedVisualWorkbenchStoryIds: input.expectedVisualWorkbenchStoryIds ?? [],
    changedFilesSourceLabel: 'Workspace diff',
    classificationOptions: {
      allowTaskWorkspaceFiles: false,
    },
    sourceMode: {
      kind: 'post_call_delta',
      preAgentPolicy: 'require_clean_workspace',
    },
    agentFailureMessage: 'Executor stage agent failed.',
    headBefore: sourceResolution.headRef,
  });

  if (coreResult.status === 'blocked_before_agent') {
    return writeWorkspaceResult(baseWorkspaceResult({
      ...baseInput,
      resolvedSourceRef: sourceResolution.resolvedSourceRef,
      headBefore: coreResult.sourceEvidence.headBefore,
      headAfter: coreResult.sourceEvidence.headAfter,
      beforeGitStatus: coreResult.sourceEvidence.beforeGitStatus,
      afterGitStatus: coreResult.sourceEvidence.afterGitStatus,
      changedFilesFromGitStatus: coreResult.sourceEvidence.changedFilesForObserver,
      status: 'blocked',
      error: {
        code: coreResult.error.code === 'pre_git_status_unavailable'
          ? 'source_ref_unavailable'
          : 'workspace_dirty',
        message: coreResult.error.message,
      },
    }));
  }

  if (coreResult.status === 'source_evidence_unavailable_after_agent') {
    return writeWorkspaceResult({
      ...baseWorkspaceResult({
        ...baseInput,
        resolvedSourceRef: sourceResolution.resolvedSourceRef,
        headBefore: coreResult.sourceEvidence.headBefore,
        headAfter: coreResult.sourceEvidence.headAfter,
        beforeGitStatus: coreResult.sourceEvidence.beforeGitStatus,
        afterGitStatus: coreResult.sourceEvidence.afterGitStatus,
        changedFilesFromGitStatus: [],
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
        providerSessionResumeId: input.providerSessionResumeId ?? null,
        agentResult: coreResult.agentResult,
        includeOutputPreview: false,
      }),
    });
  }

  return writeWorkspaceResult({
    ...baseWorkspaceResult({
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
      providerSessionResumeId: input.providerSessionResumeId ?? null,
      agentResult: coreResult.agentResult,
      includeOutputPreview: coreResult.mutationOutcome.status === 'agent_failed',
    }),
    executorOutput: coreResult.executorOutput,
  });
}

export async function runExecutorTaskWorkspaceFiles(input: {
  taskFixturePath: string;
  promptFixturePath: string;
  completionPromise: string;
  visualEvidenceMode: VisualEvidenceMode;
  expectedVisualWorkbenchStoryIds?: string[];
  promptVariantRef?: string | null;
  workDir: string;
  sourceRef: string;
  outDir: string;
  agent: ExecutorTaskWorkspaceAgent;
  model?: string | null;
  timeoutMinutes?: number | null;
}): Promise<ExecutorTaskWorkspaceResult> {
  const taskFixturePath = resolve(input.taskFixturePath);
  const promptFixturePath = resolve(input.promptFixturePath);
  assertStageFixturePathAllowed(taskFixturePath, 'executor_task_workspace --task-fixture');
  assertStageFixturePathAllowed(promptFixturePath, 'executor_task_workspace --prompt-fixture');
  const task = await fs.readJson(taskFixturePath);
  const promptFixture = await fs.readJson(promptFixturePath);
  return runExecutorTaskWorkspace({
    task,
    promptFixture,
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

export function formatExecutorTaskWorkspaceResult(
  result: ExecutorTaskWorkspaceResult,
  compact = false,
): string {
  return `${JSON.stringify(result, null, compact ? 0 : 2)}\n`;
}

function buildAgentResultSummary(
  input: {
    agentName: string;
    model: string | null;
    timeoutMinutes: number | null;
    providerSessionResumeId: string | null;
    agentResult: AgentResult;
    includeOutputPreview: boolean;
  },
): ExecutorTaskWorkspaceResult['agent'] {
  let declaredFilesChanged: string[] = [];
  let errorMessage = input.agentResult.error?.message ?? null;
  try {
    declaredFilesChanged = normalizeExecutorChangedFiles(
      input.agentResult.filesChanged,
      'executor_task_workspace agentResult.filesChanged',
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
    providerSessionResumeId: input.providerSessionResumeId?.trim() || null,
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

function baseWorkspaceResult(input: {
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
  providerSessionResumeId: string | null;
  resolvedSourceRef: string | null;
  headBefore: string | null;
  headAfter: string | null;
  beforeGitStatus: string[] | null;
  afterGitStatus: string[] | null;
  changedFilesFromGitStatus: string[];
  status: ExecutorTaskWorkspaceResult['status'];
  error: ExecutorTaskWorkspaceResult['error'];
}): ExecutorTaskWorkspaceResult {
  const visualExpectation = getTaskVisualExpectation(input.task);
  const promptReplay = renderPromptLabFixture({
    fixture: input.promptFixture,
    fixturePath: null,
  });
  return {
    schemaVersion: EXECUTOR_TASK_WORKSPACE_RESULT_SCHEMA_VERSION,
    stage: {
      stageId: 'executor_task_workspace',
      mode: 'workspace_mutation',
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
        'inspect_workspace_diff',
        'run_visual_workbench_manifest_readiness_if_visual_files_changed',
        'run_visual_workbench_capture_if_selected',
        'run_controller_visual_review_later_if_selected',
        'discard_or_reset_forked_workspace',
      ],
    },
    status: input.status,
    source: {
      workDir: input.workDir,
      requestedSourceRef: input.sourceRef,
      resolvedSourceRef: input.resolvedSourceRef,
      headBefore: input.headBefore,
      headAfter: input.headAfter,
      headChanged: input.headBefore !== input.headAfter,
      beforeGitStatus: input.beforeGitStatus,
      afterGitStatus: input.afterGitStatus,
      changedFilesFromGitStatus: input.changedFilesFromGitStatus,
    },
    task: {
      id: input.task.id,
      displayTitle: input.task.displayTitle ?? null,
      visualEvidenceMode: input.visualEvidenceMode,
      visualEvidenceRequired: input.task.visualEvidenceRequired ?? null,
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
      providerSessionResumeId: input.providerSessionResumeId,
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
      'executor_task_workspace is experiment output, not lifecycle or task truth.',
      'It mutates only the explicit selected workDir and writes only the explicit outDir report.',
      'It rejects dirty or mismatched source workspaces before the agent call.',
      'It classifies actual post-call git status with workspace-strict executor stage rules.',
    ],
  };
}

async function writeWorkspaceResult(result: ExecutorTaskWorkspaceResult): Promise<ExecutorTaskWorkspaceResult> {
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
