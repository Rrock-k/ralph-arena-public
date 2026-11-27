import type { AgentResult, Task, VisualEvidenceMode } from '../config/types.js';
import {
  detectExecutorCompletionPromise,
  detectExecutorNeedsReplanSignal,
  detectMalformedExecutorCompletion,
} from './executor-signals.js';

export type ExecutorStageStatus =
  | 'completion_signal'
  | 'work_without_completion_signal'
  | 'no_op'
  | 'needs_replan_signal'
  | 'agent_failed';

export type ExecutorStageVisualWorkbenchCoverage =
  | 'changed'
  | 'missing_expected'
  | 'not_expected';

export type ExecutorStageWarningCode =
  | 'visual_workbench_coverage_gap'
  | 'expected_visual_story_gap'
  | 'ad_hoc_proof_like_file'
  | 'forbidden_changed_file'
  | 'malformed_completion';

export type ExecutorStageWarning = {
  code: ExecutorStageWarningCode;
  message: string;
};

export type ExecutorChangedFileClassification = {
  changedProductFiles: string[];
  changedTaskWorkspaceFiles: string[];
  changedVisualWorkbenchFiles: string[];
  forbiddenChangedFiles: string[];
  adHocProofLikeFiles: string[];
};

export type ExecutorExpectedVisualWorkbenchStoryCoverage = {
  expectedVisualWorkbenchStoryIds: string[];
  coveredExpectedVisualWorkbenchStoryIds: string[];
  missingExpectedVisualWorkbenchStoryIds: string[];
};

export type ExecutorChangedFileClassificationOptions = {
  allowTaskWorkspaceFiles?: boolean;
};

export type ExecutorOutputSummary = ExecutorChangedFileClassification
  & ExecutorExpectedVisualWorkbenchStoryCoverage
  & {
    filesChangedCount: number;
    visualWorkbenchCoverage: ExecutorStageVisualWorkbenchCoverage;
  };

export type ExecutorOutputObservation = {
  ownerBoundary: typeof EXECUTOR_OBSERVER_OWNER_BOUNDARY;
  status: ExecutorStageStatus;
  filesChanged: string[];
  visualEvidenceMode: VisualEvidenceMode;
  completionPromiseFound: boolean;
  needsReplanSignalDetected: boolean;
  malformedCompletion: string | null;
  visualExpectation: ReturnType<typeof getTaskVisualExpectation>;
  classifiedFiles: ExecutorChangedFileClassification;
  visualWorkbenchCoverage: ExecutorStageVisualWorkbenchCoverage;
  expectedStoryCoverage: ExecutorExpectedVisualWorkbenchStoryCoverage;
  warnings: ExecutorStageWarning[];
};

export const EXECUTOR_OBSERVER_OWNER_BOUNDARY = 'ralph.executor-observer' as const;

export type ExecutorMutationOutcomeStatus = 'completed' | 'agent_failed' | 'forbidden_mutation';

export type ExecutorMutationOutcome = {
  ownerBoundary: typeof EXECUTOR_OBSERVER_OWNER_BOUNDARY;
  status: ExecutorMutationOutcomeStatus;
  error: null | {
    code: 'source_evidence_unavailable' | 'head_changed' | 'forbidden_mutation' | 'agent_failed';
    message: string;
  };
};

export function observeExecutorOutput(input: {
  task: Task;
  agentResult: Pick<AgentResult, 'success' | 'output' | 'filesChanged'>;
  completionPromise: string;
  visualEvidenceMode: VisualEvidenceMode;
  completionPromiseFound?: boolean;
  expectedVisualWorkbenchStoryIds?: string[];
  changedFilesSourceLabel: string;
  filesChanged?: string[];
  classificationOptions?: ExecutorChangedFileClassificationOptions;
}): ExecutorOutputObservation {
  const filesChanged = input.filesChanged ?? input.agentResult.filesChanged;
  const visualExpectation = getTaskVisualExpectation(input.task);
  const classifiedFiles = classifyExecutorChangedFiles(
    filesChanged,
    input.task.id,
    input.classificationOptions,
  );
  const completionPromiseFound = input.completionPromiseFound
    ?? detectExecutorCompletionPromise(input.agentResult.output, input.completionPromise);
  const needsReplanSignalDetected = detectExecutorNeedsReplanSignal(input.agentResult.output);
  const malformedCompletion = detectMalformedExecutorCompletion(
    input.agentResult.output,
    input.completionPromise,
  );
  const status = classifyExecutorStageStatus({
    success: input.agentResult.success,
    filesChanged,
    completionPromiseFound,
    needsReplanSignalDetected,
  });
  const visualEvidenceExpected = shouldRunVisualWorkbenchEvidenceAutomationForTask({
    task: input.task,
    visualEvidenceMode: input.visualEvidenceMode,
  });
  const visualWorkbenchCoverage = visualEvidenceExpected
    ? classifiedFiles.changedVisualWorkbenchFiles.length > 0 ? 'changed' : 'missing_expected'
    : 'not_expected';
  const expectedStoryCoverage = classifyExpectedVisualWorkbenchStoryCoverage(
    visualEvidenceExpected ? input.expectedVisualWorkbenchStoryIds ?? [] : [],
    classifiedFiles.changedVisualWorkbenchFiles,
  );
  const warnings = buildExecutorStageWarnings({
    visualWorkbenchCoverage,
    missingExpectedVisualWorkbenchStoryIds: expectedStoryCoverage.missingExpectedVisualWorkbenchStoryIds,
    forbiddenChangedFiles: classifiedFiles.forbiddenChangedFiles,
    adHocProofLikeFiles: classifiedFiles.adHocProofLikeFiles,
    malformedCompletion,
    changedFilesSourceLabel: input.changedFilesSourceLabel,
  });

  return {
    ownerBoundary: EXECUTOR_OBSERVER_OWNER_BOUNDARY,
    status,
    filesChanged,
    visualEvidenceMode: input.visualEvidenceMode,
    completionPromiseFound,
    needsReplanSignalDetected,
    malformedCompletion,
    visualExpectation,
    classifiedFiles,
    visualWorkbenchCoverage,
    expectedStoryCoverage,
    warnings,
  };
}

export function classifyExecutorMutationOutcome(input: {
  observation: Pick<ExecutorOutputObservation, 'classifiedFiles'>;
  agentResult: Pick<AgentResult, 'success' | 'output' | 'error'>;
  stageId: string;
  headChanged?: boolean;
  headBefore?: string | null;
  headAfter?: string | null;
  agentFailureMessage?: string;
  sourceEvidenceUnavailableMessage?: string;
}): ExecutorMutationOutcome {
  if (input.sourceEvidenceUnavailableMessage) {
    return {
      ownerBoundary: EXECUTOR_OBSERVER_OWNER_BOUNDARY,
      status: 'forbidden_mutation',
      error: {
        code: 'source_evidence_unavailable',
        message: input.sourceEvidenceUnavailableMessage,
      },
    };
  }

  if (input.headChanged) {
    return {
      ownerBoundary: EXECUTOR_OBSERVER_OWNER_BOUNDARY,
      status: 'forbidden_mutation',
      error: {
        code: 'head_changed',
        message: `${input.stageId} must not change HEAD; before=${input.headBefore ?? 'unavailable'}, after=${input.headAfter ?? 'unavailable'}.`,
      },
    };
  }

  const forbiddenChangedFiles = input.observation.classifiedFiles.forbiddenChangedFiles;
  if (forbiddenChangedFiles.length > 0) {
    return {
      ownerBoundary: EXECUTOR_OBSERVER_OWNER_BOUNDARY,
      status: 'forbidden_mutation',
      error: {
        code: 'forbidden_mutation',
        message: `${input.stageId} changed forbidden runner/loop/proof/lifecycle paths: ${forbiddenChangedFiles.join(', ')}`,
      },
    };
  }

  if (!input.agentResult.success) {
    return {
      ownerBoundary: EXECUTOR_OBSERVER_OWNER_BOUNDARY,
      status: 'agent_failed',
      error: {
        code: 'agent_failed',
        message: input.agentResult.error?.message
          ?? (input.agentResult.output.slice(0, 500) || input.agentFailureMessage || 'Executor stage agent failed.'),
      },
    };
  }

  return {
    ownerBoundary: EXECUTOR_OBSERVER_OWNER_BOUNDARY,
    status: 'completed',
    error: null,
  };
}

export function buildExecutorOutputSummary(
  observation: ExecutorOutputObservation,
): ExecutorOutputSummary {
  return {
    filesChangedCount: observation.filesChanged.length,
    changedProductFiles: observation.classifiedFiles.changedProductFiles,
    changedTaskWorkspaceFiles: observation.classifiedFiles.changedTaskWorkspaceFiles,
    changedVisualWorkbenchFiles: observation.classifiedFiles.changedVisualWorkbenchFiles,
    forbiddenChangedFiles: observation.classifiedFiles.forbiddenChangedFiles,
    adHocProofLikeFiles: observation.classifiedFiles.adHocProofLikeFiles,
    visualWorkbenchCoverage: observation.visualWorkbenchCoverage,
    ...observation.expectedStoryCoverage,
  };
}

export function normalizeExecutorChangedFiles(filesChanged: string[], label: string): string[] {
  return filesChanged.map((filePath) => {
    const normalized = filePath.replace(/\\/g, '/').trim();
    if (!normalized) {
      throw new Error(`${label} cannot contain empty paths.`);
    }
    if (normalized.startsWith('/') || normalized.includes('..')) {
      throw new Error(`${label} must use repo-relative safe paths: ${filePath}`);
    }
    return normalized;
  });
}

export function parseExecutorGitStatusChangedFiles(statusLines: string[]): string[] {
  return Array.from(new Set(statusLines.flatMap((line) => {
    const rawPath = line.slice(3).trim();
    if (!rawPath) return [];
    const renameParts = rawPath.split(' -> ').map((part) => part.trim()).filter(Boolean);
    return renameParts.length > 1 ? renameParts : [rawPath];
  })));
}

export function assertNoHardForbiddenExecutorChangedFiles(input: {
  filesChanged: string[];
  taskId: string;
  stageId: string;
  modeLabel: string;
  classificationOptions?: ExecutorChangedFileClassificationOptions;
}): void {
  const forbidden = classifyExecutorChangedFiles(
    input.filesChanged,
    input.taskId,
    input.classificationOptions,
  ).forbiddenChangedFiles;
  if (forbidden.length > 0) {
    throw new Error(`${input.stageId} ${input.modeLabel} changed files include runner/loop/proof/lifecycle truth paths: ${forbidden.join(', ')}`);
  }
}

export function getTaskVisualExpectation(task: Task): {
  hasStructuredVisualExpectation: boolean;
  sources: string[];
} {
  const sources: string[] = [];
  if (task.visualEvidenceRequired === true) {
    sources.push('task.visualEvidenceRequired');
  }
  if ((task.requiredRolePasses ?? []).includes('ux')) {
    sources.push('task.requiredRolePasses.ux');
  }
  if ((task.feedbackItemRefs ?? []).some((ref) => ref.workSurface === 'frontend')) {
    sources.push('task.feedbackItemRefs.workSurface.frontend');
  }
  return {
    hasStructuredVisualExpectation: sources.length > 0,
    sources,
  };
}

export function shouldRunVisualWorkbenchEvidenceAutomationForTask(input: {
  task: Task;
  visualEvidenceMode: VisualEvidenceMode;
}): boolean {
  if (input.visualEvidenceMode === 'off') return false;
  if (input.task.visualEvidenceRequired === true) return true;
  if (input.visualEvidenceMode === 'new_tasks_only') return false;
  return getTaskVisualExpectation(input.task).hasStructuredVisualExpectation;
}

export function classifyExecutorChangedFiles(
  filesChanged: string[],
  taskId: string,
  options: ExecutorChangedFileClassificationOptions = {},
): ExecutorChangedFileClassification {
  const allowTaskWorkspaceFiles = options.allowTaskWorkspaceFiles ?? true;
  const changedTaskWorkspaceFiles = allowTaskWorkspaceFiles
    ? filesChanged.filter((filePath) => isAllowedTaskWorkspaceFile(filePath, taskId))
    : [];
  const changedVisualWorkbenchFiles = filesChanged.filter((filePath) => filePath.startsWith('visual-workbench/'));
  const forbiddenChangedFiles = filesChanged.filter((filePath) => isForbiddenExecutorChangedFile(filePath, taskId, {
    allowTaskWorkspaceFiles,
  }));
  const adHocProofLikeFiles = filesChanged.filter(isAdHocProofLikeFile);
  const changedProductFiles = filesChanged.filter((filePath) => (
    !changedTaskWorkspaceFiles.includes(filePath)
    && !forbiddenChangedFiles.includes(filePath)
  ));

  return {
    changedProductFiles,
    changedTaskWorkspaceFiles,
    changedVisualWorkbenchFiles,
    forbiddenChangedFiles,
    adHocProofLikeFiles,
  };
}

export function classifyExpectedVisualWorkbenchStoryCoverage(
  expectedStoryIds: string[],
  changedVisualWorkbenchFiles: string[],
): ExecutorExpectedVisualWorkbenchStoryCoverage {
  const uniqueExpectedStoryIds = Array.from(new Set(expectedStoryIds));
  const coveredExpectedVisualWorkbenchStoryIds = uniqueExpectedStoryIds.filter((storyId) => (
    changedVisualWorkbenchFiles.some((filePath) => filePath.includes(storyId))
  ));
  return {
    expectedVisualWorkbenchStoryIds: uniqueExpectedStoryIds,
    coveredExpectedVisualWorkbenchStoryIds,
    missingExpectedVisualWorkbenchStoryIds: uniqueExpectedStoryIds.filter((storyId) => !coveredExpectedVisualWorkbenchStoryIds.includes(storyId)),
  };
}

export function classifyExecutorStageStatus(input: {
  success: boolean;
  filesChanged: string[];
  completionPromiseFound: boolean;
  needsReplanSignalDetected: boolean;
}): ExecutorStageStatus {
  if (!input.success) return 'agent_failed';
  if (input.needsReplanSignalDetected) return 'needs_replan_signal';
  if (input.filesChanged.length === 0 && !input.completionPromiseFound) return 'no_op';
  if (input.completionPromiseFound) return 'completion_signal';
  return 'work_without_completion_signal';
}

export function buildExecutorStageWarnings(input: {
  visualWorkbenchCoverage: ExecutorStageVisualWorkbenchCoverage;
  missingExpectedVisualWorkbenchStoryIds: string[];
  forbiddenChangedFiles: string[];
  adHocProofLikeFiles: string[];
  malformedCompletion: string | null;
  changedFilesSourceLabel: string;
}): ExecutorStageWarning[] {
  const warnings: ExecutorStageWarning[] = [];
  if (input.visualWorkbenchCoverage === 'missing_expected') {
    warnings.push({
      code: 'visual_workbench_coverage_gap',
      message: 'Task has structured visual expectations but fixture changed no visual-workbench files.',
    });
  }
  if (input.missingExpectedVisualWorkbenchStoryIds.length > 0) {
    warnings.push({
      code: 'expected_visual_story_gap',
      message: `Expected Visual Workbench story ids were not covered by declared changed files: ${input.missingExpectedVisualWorkbenchStoryIds.join(', ')}`,
    });
  }
  if (input.forbiddenChangedFiles.length > 0) {
    warnings.push({
      code: 'forbidden_changed_file',
      message: `${input.changedFilesSourceLabel} changed runner/loop/proof/lifecycle truth paths: ${input.forbiddenChangedFiles.join(', ')}`,
    });
  }
  if (input.adHocProofLikeFiles.length > 0) {
    warnings.push({
      code: 'ad_hoc_proof_like_file',
      message: `${input.changedFilesSourceLabel} changed screenshot/proof-like files; visual evidence should flow through Visual Workbench capture/export: ${input.adHocProofLikeFiles.join(', ')}`,
    });
  }
  if (input.malformedCompletion) {
    warnings.push({
      code: 'malformed_completion',
      message: input.malformedCompletion,
    });
  }
  return warnings;
}

function isAllowedTaskWorkspaceFile(filePath: string, taskId: string): boolean {
  return filePath === `.ralph/tasks/${taskId}/plan.md`
    || filePath === `.ralph/tasks/${taskId}/product.md`
    || filePath === `.ralph/tasks/${taskId}/ux.md`;
}

function isForbiddenExecutorChangedFile(
  filePath: string,
  taskId: string,
  options: Required<ExecutorChangedFileClassificationOptions>,
): boolean {
  if (filePath === 'spec.md') return true;
  if (filePath.startsWith('specs/')) return true;
  if (filePath.startsWith('.arena/')) return true;
  if (filePath.startsWith('.ralph/evidence/')) return true;
  if (filePath.startsWith('.ralph/controller-reports/')) return true;
  if (filePath.startsWith('.ralph/agent-logs/')) return true;
  if (filePath === '.ralph/plan.json') return true;
  if (filePath === '.ralph/plan-archive.jsonl') return true;
  if (filePath === '.ralph/decisions-log.json') return true;
  if (filePath === '.ralph/ralph-progress.json') return true;
  if (filePath === '.ralph/iteration-log.json') return true;
  if (filePath.startsWith('.ralph/tasks/')) {
    return !options.allowTaskWorkspaceFiles || !isAllowedTaskWorkspaceFile(filePath, taskId);
  }
  return /(^|\/)(proofReviews|ProjectAsset|runtime-intent|lifecycle-state)(\/|\.|$)/i.test(filePath);
}

function isAdHocProofLikeFile(filePath: string): boolean {
  return /(^|\/)(screenshots?|screenshot-proof|proof)(\/|$)/i.test(filePath)
    || /(^|\/)(before|after)[._-].*\.(png|jpe?g|webp)$/i.test(filePath);
}
