import type { AgentResult, ExecutorActionReportOutput, Task, VisualEvidenceMode } from '../config/types.js';
import {
  buildExecutorOutputSummary,
  classifyExecutorMutationOutcome,
  observeExecutorOutput,
  type ExecutorChangedFileClassificationOptions,
  type ExecutorMutationOutcome,
  type ExecutorOutputObservation,
  type ExecutorOutputSummary,
} from './executor-observer.js';

export type ExecutorActionObservationResult = {
  observation: ExecutorOutputObservation;
  mutationOutcome: ExecutorMutationOutcome;
  summary: ExecutorOutputSummary;
};

export function observeExecutorAction(input: {
  task: Task;
  agentResult: Pick<AgentResult, 'success' | 'output' | 'filesChanged' | 'error'>;
  completionPromise: string;
  visualEvidenceMode: VisualEvidenceMode;
  completionPromiseFound?: boolean;
  expectedVisualWorkbenchStoryIds?: string[];
  changedFilesSourceLabel: string;
  filesChanged?: string[];
  classificationOptions?: ExecutorChangedFileClassificationOptions;
  stageId: string;
  headChanged?: boolean;
  headBefore?: string | null;
  headAfter?: string | null;
  agentFailureMessage?: string;
  sourceEvidenceUnavailableMessage?: string;
}): ExecutorActionObservationResult {
  const observation = observeExecutorOutput({
    task: input.task,
    agentResult: input.agentResult,
    completionPromise: input.completionPromise,
    visualEvidenceMode: input.visualEvidenceMode,
    completionPromiseFound: input.completionPromiseFound,
    expectedVisualWorkbenchStoryIds: input.expectedVisualWorkbenchStoryIds,
    changedFilesSourceLabel: input.changedFilesSourceLabel,
    filesChanged: input.filesChanged,
    classificationOptions: input.classificationOptions,
  });
  const mutationOutcome = classifyExecutorMutationOutcome({
    observation,
    agentResult: input.agentResult,
    stageId: input.stageId,
    headChanged: input.headChanged,
    headBefore: input.headBefore,
    headAfter: input.headAfter,
    agentFailureMessage: input.agentFailureMessage,
    sourceEvidenceUnavailableMessage: input.sourceEvidenceUnavailableMessage,
  });

  return {
    observation,
    mutationOutcome,
    summary: buildExecutorOutputSummary(observation),
  };
}

export function buildExecutorActionReportOutput(
  result: ExecutorActionObservationResult,
): ExecutorActionReportOutput {
  const { observation } = result;
  return {
    ownerBoundary: observation.ownerBoundary,
    status: observation.status,
    visualEvidenceMode: observation.visualEvidenceMode,
    visualExpectation: observation.visualExpectation,
    summary: result.summary,
    detectedCompletionPromiseFound: observation.completionPromiseFound,
    needsReplanSignalDetected: observation.needsReplanSignalDetected,
    malformedCompletion: observation.malformedCompletion,
    warnings: observation.warnings,
  };
}
