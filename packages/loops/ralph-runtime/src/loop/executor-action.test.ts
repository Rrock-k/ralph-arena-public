import assert from 'node:assert/strict';
import test from 'node:test';
import type { AgentResult, Task } from '../config/types.js';
import { buildExecutorActionReportOutput, observeExecutorAction } from './executor-action.js';

const baseTask: Task = {
  id: 'task-123',
  description: 'Add synth pad empty state',
  acceptanceCriteria: ['empty state works'],
  status: 'in_progress',
  attempts: 0,
  dependencies: [],
  feedbackItemRefs: [{ itemId: 'BUG-001', diffItemId: 'DIFF-001-BUG-001', workSurface: 'frontend' }],
};

test('observeExecutorAction composes shared observation, summary and mutation outcome', () => {
  const agentResult: AgentResult = {
    success: true,
    output: '<promise>TASK_COMPLETE</promise>',
    filesChanged: ['src/App.tsx', 'visual-workbench/stories/synth-pad.tsx'],
    completionPromiseFound: true,
  };

  const result = observeExecutorAction({
    task: baseTask,
    agentResult,
    completionPromise: 'TASK_COMPLETE',
    visualEvidenceMode: 'required',
    completionPromiseFound: agentResult.completionPromiseFound,
    expectedVisualWorkbenchStoryIds: ['synth-pad'],
    changedFilesSourceLabel: 'Agent result',
    stageId: 'LoopExecutor.executeIteration',
  });

  assert.equal(result.observation.ownerBoundary, 'ralph.executor-observer');
  assert.equal(result.observation.status, 'completion_signal');
  assert.equal(result.mutationOutcome.ownerBoundary, 'ralph.executor-observer');
  assert.equal(result.mutationOutcome.status, 'completed');
  assert.equal(result.summary.filesChangedCount, 2);
  assert.deepEqual(result.summary.changedVisualWorkbenchFiles, ['visual-workbench/stories/synth-pad.tsx']);
  assert.deepEqual(result.summary.coveredExpectedVisualWorkbenchStoryIds, ['synth-pad']);
});

test('observeExecutorAction keeps forbidden mutation outcome outside lifecycle logic', () => {
  const result = observeExecutorAction({
    task: baseTask,
    agentResult: {
      success: true,
      output: 'done',
      filesChanged: ['src/App.tsx'],
    },
    completionPromise: 'TASK_COMPLETE',
    visualEvidenceMode: 'required',
    changedFilesSourceLabel: 'Workspace diff',
    stageId: 'executor_task_workspace',
    headChanged: true,
    headBefore: 'before123',
    headAfter: 'after456',
  });

  assert.equal(result.observation.status, 'work_without_completion_signal');
  assert.equal(result.mutationOutcome.status, 'forbidden_mutation');
  assert.equal(result.mutationOutcome.error?.code, 'head_changed');
  assert.match(result.mutationOutcome.error?.message ?? '', /executor_task_workspace must not change HEAD/);
  assert.equal(result.summary.filesChangedCount, 1);
});

test('observeExecutorAction fails closed when source evidence is unavailable', () => {
  const result = observeExecutorAction({
    task: baseTask,
    agentResult: {
      success: true,
      output: '<promise>TASK_COMPLETE</promise>',
      filesChanged: ['src/App.tsx'],
    },
    filesChanged: [],
    completionPromise: 'TASK_COMPLETE',
    visualEvidenceMode: 'required',
    completionPromiseFound: true,
    changedFilesSourceLabel: 'Workspace diff',
    stageId: 'LoopExecutor.executeIteration',
    sourceEvidenceUnavailableMessage: 'LoopExecutor.executeIteration requires git status evidence after executor agent call; failing closed.',
  });

  assert.equal(result.observation.status, 'completion_signal');
  assert.equal(result.mutationOutcome.status, 'forbidden_mutation');
  assert.equal(result.mutationOutcome.error?.code, 'source_evidence_unavailable');
  assert.match(result.mutationOutcome.error?.message ?? '', /git status evidence after executor agent call/);
});

test('buildExecutorActionReportOutput projects the shared observer report shape', () => {
  const result = observeExecutorAction({
    task: baseTask,
    agentResult: {
      success: true,
      output: '<promise>TASK_COMPLETE</promise>',
      filesChanged: ['src/App.tsx'],
    },
    completionPromise: 'TASK_COMPLETE',
    visualEvidenceMode: 'required',
    completionPromiseFound: true,
    changedFilesSourceLabel: 'Workspace diff',
    stageId: 'executor_task_workspace',
  });

  assert.deepEqual(buildExecutorActionReportOutput(result), {
    ownerBoundary: 'ralph.executor-observer',
    status: 'completion_signal',
    visualEvidenceMode: 'required',
    visualExpectation: {
      hasStructuredVisualExpectation: true,
      sources: [
        'task.feedbackItemRefs.workSurface.frontend',
      ],
    },
    summary: result.summary,
    detectedCompletionPromiseFound: true,
    needsReplanSignalDetected: false,
    malformedCompletion: null,
    warnings: result.observation.warnings,
  });
});
