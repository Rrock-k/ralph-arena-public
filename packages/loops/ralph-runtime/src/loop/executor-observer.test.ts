import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertNoHardForbiddenExecutorChangedFiles,
  classifyExecutorMutationOutcome,
  classifyExecutorChangedFiles,
  normalizeExecutorChangedFiles,
  observeExecutorOutput,
  parseExecutorGitStatusChangedFiles,
  shouldRunVisualWorkbenchEvidenceAutomationForTask,
} from './executor-observer.js';

test('executor stage classifier preserves fixture task-workspace allowance by default', () => {
  const classification = classifyExecutorChangedFiles([
    '.ralph/tasks/task-001/plan.md',
    'src/components/SynthPad.tsx',
    'visual-workbench/stories/synth-pad.playing.tsx',
  ], 'task-001');

  assert.deepEqual(classification.changedTaskWorkspaceFiles, [
    '.ralph/tasks/task-001/plan.md',
  ]);
  assert.deepEqual(classification.forbiddenChangedFiles, []);
  assert.deepEqual(classification.changedVisualWorkbenchFiles, [
    'visual-workbench/stories/synth-pad.playing.tsx',
  ]);
});

test('executor observer classifies mutation outcome without lifecycle side effects', () => {
  const cleanObservation = observeExecutorOutput({
    task: baseTask(),
    agentResult: {
      success: true,
      output: '<promise>TASK_COMPLETE</promise>',
      filesChanged: ['src/SynthPad.tsx'],
    },
    completionPromise: 'TASK_COMPLETE',
    visualEvidenceMode: 'required',
    changedFilesSourceLabel: 'Unit test',
  });

  assert.deepEqual(classifyExecutorMutationOutcome({
    observation: cleanObservation,
    agentResult: {
      success: true,
      output: '<promise>TASK_COMPLETE</promise>',
    },
    stageId: 'executor_task_workspace',
  }), {
    ownerBoundary: 'ralph.executor-observer',
    status: 'completed',
    error: null,
  });

  const forbiddenObservation = observeExecutorOutput({
    task: baseTask(),
    agentResult: {
      success: true,
      output: '<promise>TASK_COMPLETE</promise>',
      filesChanged: ['.ralph/plan.json'],
    },
    completionPromise: 'TASK_COMPLETE',
    visualEvidenceMode: 'required',
    changedFilesSourceLabel: 'Unit test',
    classificationOptions: {
      allowTaskWorkspaceFiles: false,
    },
  });

  assert.equal(classifyExecutorMutationOutcome({
    observation: forbiddenObservation,
    agentResult: {
      success: true,
      output: '<promise>TASK_COMPLETE</promise>',
    },
    stageId: 'executor_task_workspace',
  }).error?.code, 'forbidden_mutation');

  assert.equal(classifyExecutorMutationOutcome({
    observation: cleanObservation,
    agentResult: {
      success: false,
      output: '',
      error: {
        category: 'infra',
        message: 'agent crashed',
      },
    },
    stageId: 'executor_task_workspace',
  }).error?.message, 'agent crashed');

  const headOutcome = classifyExecutorMutationOutcome({
    observation: cleanObservation,
    agentResult: {
      success: true,
      output: '<promise>TASK_COMPLETE</promise>',
    },
    stageId: 'executor_task_workspace',
    headChanged: true,
    headBefore: 'before-sha',
    headAfter: 'after-sha',
  });
  assert.equal(headOutcome.status, 'forbidden_mutation');
  assert.equal(headOutcome.error?.code, 'head_changed');
  assert.match(headOutcome.error?.message ?? '', /before=before-sha, after=after-sha/);
});

function baseTask() {
  return {
    id: 'task-001',
    displayTitle: 'Add synth pad story',
    description: 'Add visual workbench story',
    acceptanceCriteria: [],
    status: 'pending' as const,
    attempts: 0,
    dependencies: [],
  };
}

test('executor stage classifier can make task-workspace writes forbidden for workspace mode', () => {
  const classification = classifyExecutorChangedFiles([
    '.ralph/tasks/task-001/plan.md',
    'src/components/SynthPad.tsx',
  ], 'task-001', {
    allowTaskWorkspaceFiles: false,
  });

  assert.deepEqual(classification.changedTaskWorkspaceFiles, []);
  assert.deepEqual(classification.forbiddenChangedFiles, [
    '.ralph/tasks/task-001/plan.md',
  ]);
  assert.throws(() => assertNoHardForbiddenExecutorChangedFiles({
    filesChanged: classification.forbiddenChangedFiles,
    taskId: 'task-001',
    stageId: 'executor_task_workspace',
    modeLabel: 'workspace mutation',
    classificationOptions: {
      allowTaskWorkspaceFiles: false,
    },
  }), /executor_task_workspace workspace mutation changed files include runner\/loop\/proof\/lifecycle truth paths/);
});

test('executor stage classifier forbids runner-owned spec materialization paths', () => {
  const classification = classifyExecutorChangedFiles([
    'spec.md',
    'specs/001-evolution-spec-abcd.md',
    'specs/economy-design-reference.md',
    'src/components/SynthPad.tsx',
  ], 'task-001', {
    allowTaskWorkspaceFiles: false,
  });

  assert.deepEqual(classification.changedProductFiles, [
    'src/components/SynthPad.tsx',
  ]);
  assert.deepEqual(classification.forbiddenChangedFiles, [
    'spec.md',
    'specs/001-evolution-spec-abcd.md',
    'specs/economy-design-reference.md',
  ]);

  const observation = observeExecutorOutput({
    task: baseTask(),
    agentResult: {
      success: true,
      output: '<promise>TASK_COMPLETE</promise>',
      filesChanged: ['specs/economy-design-reference.md'],
    },
    completionPromise: 'TASK_COMPLETE',
    visualEvidenceMode: 'off',
    changedFilesSourceLabel: 'Workspace diff',
    classificationOptions: {
      allowTaskWorkspaceFiles: false,
    },
  });

  assert.equal(classifyExecutorMutationOutcome({
    observation,
    agentResult: {
      success: true,
      output: '<promise>TASK_COMPLETE</promise>',
    },
    stageId: 'executor_task_workspace',
  }).error?.code, 'forbidden_mutation');
});

test('executor stage classifier normalizes safe declared changed files', () => {
  assert.deepEqual(normalizeExecutorChangedFiles([
    ' src\\components\\SynthPad.tsx ',
  ], 'fixture filesChanged'), [
    'src/components/SynthPad.tsx',
  ]);

  assert.throws(() => normalizeExecutorChangedFiles([
    '../outside.ts',
  ], 'fixture filesChanged'), /repo-relative safe paths/);
});

test('executor observer parses git status changed files including renames', () => {
  assert.deepEqual(parseExecutorGitStatusChangedFiles([
    ' M src/App.tsx',
    'R  src/Old.tsx -> src/New.tsx',
    '?? visual-workbench/stories/synth.tsx',
    '',
  ]), [
    'src/App.tsx',
    'src/Old.tsx',
    'src/New.tsx',
    'visual-workbench/stories/synth.tsx',
  ]);
});

test('executor observer reports visual coverage, signals and warnings without lifecycle side effects', () => {
  const observation = observeExecutorOutput({
    task: {
      id: 'task-001',
      displayTitle: 'Add synth pad story',
      description: 'Add visual workbench story',
      acceptanceCriteria: [],
      status: 'pending',
      attempts: 0,
      dependencies: [],
      visualEvidenceRequired: true,
    },
    agentResult: {
      success: true,
      output: `${'implemented '.repeat(20)}\n<promise>TASK_COMPLETE</promise>`,
      filesChanged: ['src/SynthPad.tsx'],
    },
    filesChanged: ['src/SynthPad.tsx', 'screenshots/after.png'],
    completionPromise: 'TASK_COMPLETE',
    visualEvidenceMode: 'required',
    expectedVisualWorkbenchStoryIds: ['synth-pad.playing'],
    changedFilesSourceLabel: 'Workspace diff',
  });

  assert.equal(observation.ownerBoundary, 'ralph.executor-observer');
  assert.equal(observation.status, 'completion_signal');
  assert.equal(observation.completionPromiseFound, true);
  assert.equal(observation.visualWorkbenchCoverage, 'missing_expected');
  assert.deepEqual(observation.expectedStoryCoverage.missingExpectedVisualWorkbenchStoryIds, ['synth-pad.playing']);
  assert.deepEqual(observation.classifiedFiles.adHocProofLikeFiles, ['screenshots/after.png']);
  assert.deepEqual(observation.warnings.map((warning) => warning.code), [
    'visual_workbench_coverage_gap',
    'expected_visual_story_gap',
    'ad_hoc_proof_like_file',
  ]);
});

test('executor observer applies visual evidence mode before reporting Workbench gaps', () => {
  const uxTask = {
    ...baseTask(),
    requiredRolePasses: ['ux' as const],
  };
  const agentResult = {
    success: true,
    output: '<promise>TASK_COMPLETE</promise>',
    filesChanged: ['src/components/SynthPad.tsx'],
  };

  const offObservation = observeExecutorOutput({
    task: uxTask,
    agentResult,
    completionPromise: 'TASK_COMPLETE',
    visualEvidenceMode: 'off',
    expectedVisualWorkbenchStoryIds: ['synth-pad.playing'],
    changedFilesSourceLabel: 'Unit test',
  });
  assert.equal(offObservation.visualWorkbenchCoverage, 'not_expected');
  assert.deepEqual(offObservation.expectedStoryCoverage.missingExpectedVisualWorkbenchStoryIds, []);
  assert.equal(offObservation.warnings.some((warning) => warning.code === 'visual_workbench_coverage_gap'), false);

  const newTasksOnlyObservation = observeExecutorOutput({
    task: uxTask,
    agentResult,
    completionPromise: 'TASK_COMPLETE',
    visualEvidenceMode: 'new_tasks_only',
    expectedVisualWorkbenchStoryIds: ['synth-pad.playing'],
    changedFilesSourceLabel: 'Unit test',
  });
  assert.equal(newTasksOnlyObservation.visualWorkbenchCoverage, 'not_expected');
  assert.deepEqual(newTasksOnlyObservation.expectedStoryCoverage.missingExpectedVisualWorkbenchStoryIds, []);
  assert.equal(newTasksOnlyObservation.warnings.some((warning) => warning.code === 'expected_visual_story_gap'), false);

  const explicitNewVisualObservation = observeExecutorOutput({
    task: {
      ...uxTask,
      visualEvidenceRequired: true,
    },
    agentResult,
    completionPromise: 'TASK_COMPLETE',
    visualEvidenceMode: 'new_tasks_only',
    expectedVisualWorkbenchStoryIds: ['synth-pad.playing'],
    changedFilesSourceLabel: 'Unit test',
  });
  assert.equal(explicitNewVisualObservation.visualWorkbenchCoverage, 'missing_expected');
  assert.deepEqual(explicitNewVisualObservation.warnings.map((warning) => warning.code), [
    'visual_workbench_coverage_gap',
    'expected_visual_story_gap',
  ]);
});

test('executor observer owns Visual Workbench automation gating for visual evidence modes', () => {
  const uxTask = {
    ...baseTask(),
    requiredRolePasses: ['ux' as const],
  };
  const frontendFeedbackTask = {
    ...baseTask(),
    id: 'task-frontend-feedback',
    feedbackItemRefs: [{
      itemId: 'BUG-001',
      diffItemId: 'DIFF-001-BUG-001',
      workSurface: 'frontend',
    }],
  };
  const backendTask = {
    ...baseTask(),
    id: 'task-backend',
    feedbackItemRefs: [{
      itemId: 'BUG-002',
      diffItemId: 'DIFF-001-BUG-002',
      workSurface: 'backend',
    }],
  };
  const explicitNewVisualTask = {
    ...backendTask,
    id: 'task-explicit-visual',
    visualEvidenceRequired: true,
  };

  assert.equal(shouldRunVisualWorkbenchEvidenceAutomationForTask({
    task: explicitNewVisualTask,
    visualEvidenceMode: 'off',
  }), false);
  assert.equal(shouldRunVisualWorkbenchEvidenceAutomationForTask({
    task: uxTask,
    visualEvidenceMode: 'required',
  }), true);
  assert.equal(shouldRunVisualWorkbenchEvidenceAutomationForTask({
    task: frontendFeedbackTask,
    visualEvidenceMode: 'required',
  }), true);
  assert.equal(shouldRunVisualWorkbenchEvidenceAutomationForTask({
    task: uxTask,
    visualEvidenceMode: 'new_tasks_only',
  }), false);
  assert.equal(shouldRunVisualWorkbenchEvidenceAutomationForTask({
    task: frontendFeedbackTask,
    visualEvidenceMode: 'new_tasks_only',
  }), false);
  assert.equal(shouldRunVisualWorkbenchEvidenceAutomationForTask({
    task: explicitNewVisualTask,
    visualEvidenceMode: 'new_tasks_only',
  }), true);
  assert.equal(shouldRunVisualWorkbenchEvidenceAutomationForTask({
    task: backendTask,
    visualEvidenceMode: 'required',
  }), false);
});
