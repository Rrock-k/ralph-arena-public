import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, readFile, stat, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { PROMPT_LAB_FIXTURE_SCHEMA_VERSION } from '../prompts/prompt-lab.js';
import {
  EXECUTOR_TASK_IO_FIXTURE_SCHEMA_VERSION,
  EXECUTOR_TASK_IO_RESULT_SCHEMA_VERSION,
  formatExecutorTaskIoResult,
  runExecutorTaskIoFixture,
  runExecutorTaskIoFixtureFile,
  type ExecutorTaskIoFixture,
} from './executor-task-io.js';

test('executor_task_io classifies executor fixture output without runtime writes', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'executor-task-io-'));
  const fixturePath = path.join(tempDir, 'fixture.json');
  const outPath = path.join(tempDir, 'out', 'executor-stage.json');
  await writeFile(fixturePath, JSON.stringify(buildFixture(), null, 2), 'utf8');

  const beforeRootEntries = await readdir(tempDir);
  const result = await runExecutorTaskIoFixtureFile({
    fixturePath,
    outPath,
  });
  const afterRootEntries = await readdir(tempDir);
  const outFile = JSON.parse(await readFile(outPath, 'utf8'));

  assert.equal(result.schemaVersion, EXECUTOR_TASK_IO_RESULT_SCHEMA_VERSION);
  assert.equal(result.stage.stageId, 'executor_task_io');
  assert.equal(result.stage.mode, 'fixture');
  assert.equal(result.stage.ownerBoundary, 'ralph.executor.prompt-code-path');
  assert.deepEqual(result.stage.allowedMutations, [outPath]);
  assert(result.stage.forbiddenMutations.includes('.ralph/plan.json'));
  assert(result.stage.forbiddenMutations.includes('task verificationEvidence'));
  assert.equal(result.task.id, 'task-001');
  assert.equal(result.task.visualEvidenceMode, 'required');
  assert.equal(result.task.hasStructuredVisualExpectation, true);
  assert.deepEqual(result.task.visualExpectationSources, [
    'task.requiredRolePasses.ux',
    'task.feedbackItemRefs.workSurface.frontend',
  ]);
  assert.equal(result.prompt.promptId, 'executor.agentPrompt');
  assert.match(result.prompt.renderedSha256, /^sha256:[a-f0-9]{64}$/);
  assert.equal(result.agentResult.detectedCompletionPromiseFound, true);
  assert.equal(result.agentResult.needsReplanSignalDetected, false);
  assert.equal(result.executorOutput.ownerBoundary, 'ralph.executor-observer');
  assert.equal(result.executorOutput.status, 'completion_signal');
  assert.equal(result.executorOutput.visualEvidenceMode, 'required');
  assert.deepEqual(result.executorOutput.visualExpectation, {
    hasStructuredVisualExpectation: true,
    sources: [
      'task.requiredRolePasses.ux',
      'task.feedbackItemRefs.workSurface.frontend',
    ],
  });
  assert.equal(result.executorOutput.summary.filesChangedCount, 3);
  assert.deepEqual(result.executorOutput.summary.changedVisualWorkbenchFiles, [
    'visual-workbench/stories/synth-pad.playing.tsx',
  ]);
  assert.deepEqual(result.executorOutput.summary.changedTaskWorkspaceFiles, [
    '.ralph/tasks/task-001/plan.md',
  ]);
  assert.deepEqual(result.executorOutput.summary.changedProductFiles, [
    'src/components/SynthPad.tsx',
    'visual-workbench/stories/synth-pad.playing.tsx',
  ]);
  assert.equal(result.executorOutput.summary.visualWorkbenchCoverage, 'changed');
  assert.deepEqual(result.executorOutput.summary.coveredExpectedVisualWorkbenchStoryIds, ['synth-pad.playing']);
  assert.deepEqual(result.executorOutput.summary.missingExpectedVisualWorkbenchStoryIds, []);
  assert.deepEqual(result.executorOutput.warnings, []);
  assert.deepEqual(beforeRootEntries.sort(), ['fixture.json']);
  assert.deepEqual(afterRootEntries.sort(), ['fixture.json', 'out']);
  assert.equal(outFile.executorOutput.status, 'completion_signal');
  assert.equal(outFile.executorOutput.ownerBoundary, 'ralph.executor-observer');
  assert.equal(outFile.executorOutput.visualEvidenceMode, 'required');
  await assert.rejects(stat(path.join(tempDir, '.ralph')));
});

test('executor_task_io reports visual workbench coverage gaps as observations', () => {
  const result = runExecutorTaskIoFixture({
    fixture: buildFixture({
      expectedVisualWorkbenchStoryIds: ['synth-pad.playing'],
      agentResult: {
        success: true,
        output: completionOutput(),
        filesChanged: ['src/components/SynthPad.tsx'],
      },
    }),
  });

  assert.equal(result.executorOutput.status, 'completion_signal');
  assert.equal(result.executorOutput.summary.visualWorkbenchCoverage, 'missing_expected');
  assert.deepEqual(result.executorOutput.summary.missingExpectedVisualWorkbenchStoryIds, ['synth-pad.playing']);
  assert.deepEqual(result.executorOutput.warnings.map((warning) => warning.code), [
    'visual_workbench_coverage_gap',
    'expected_visual_story_gap',
  ]);
});

test('executor_task_io classifies no-op, replan and agent failure outputs', () => {
  assert.equal(runExecutorTaskIoFixture({
    fixture: buildFixture({
      agentResult: {
        success: true,
        output: 'I did not change anything yet.',
        filesChanged: [],
      },
    }),
  }).executorOutput.status, 'no_op');

  assert.equal(runExecutorTaskIoFixture({
    fixture: buildFixture({
      agentResult: {
        success: true,
        output: 'Blocked by ambiguity.\n<signal>NEEDS_REPLAN</signal>',
        filesChanged: [],
      },
    }),
  }).executorOutput.status, 'needs_replan_signal');

  assert.equal(runExecutorTaskIoFixture({
    fixture: buildFixture({
      agentResult: {
        success: false,
        output: 'provider rate limit',
        filesChanged: [],
        error: {
          category: 'rate_limit',
          message: 'provider rate limit',
        },
      },
    }),
  }).executorOutput.status, 'agent_failed');
});

test('executor_task_io rejects non-executor prompt fixtures', () => {
  assert.throws(() => runExecutorTaskIoFixture({
    fixture: buildFixture({
      promptFixture: {
        schemaVersion: PROMPT_LAB_FIXTURE_SCHEMA_VERSION,
        promptId: 'planner.initial',
        input: {
          seed: 'fixture-seed',
          previousErrorBlock: '',
          projectName: 'Tiny Synth Lab',
          projectDescription: 'Small synth UI',
          techStack: 'typescript / vite',
          deployBlock: '',
          repositoryBlock: '',
          spec: '# Spec',
          existingProjectFilesBlock: '',
          judgmentTimestamp: '2026-06-07T00:00:00.000Z',
        },
      },
    }),
  }), /requires executor\.agentPrompt/);
});

test('executor_task_io rejects unsafe output paths', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'executor-task-io-'));
  const fixturePath = path.join(tempDir, 'fixture.json');
  const existingOutPath = path.join(tempDir, 'existing-stage.json');
  await writeFile(fixturePath, JSON.stringify(buildFixture(), null, 2), 'utf8');
  await writeFile(existingOutPath, '{}', 'utf8');

  await assert.rejects(() => runExecutorTaskIoFixtureFile({
    fixturePath,
    outPath: path.join(tempDir, '.arena', 'result.json'),
  }), /outside \.ralph and \.arena/);

  await assert.rejects(() => runExecutorTaskIoFixtureFile({
    fixturePath,
    outPath: fixturePath,
  }), /cannot overwrite the input fixture/);

  await assert.rejects(() => runExecutorTaskIoFixtureFile({
    fixturePath,
    outPath: existingOutPath,
  }), /refusing to overwrite an existing path/);

  assert.throws(() => runExecutorTaskIoFixture({
    fixture: buildFixture(),
    outPath: path.join(process.cwd(), 'src', 'stage-lab', 'executor-stage.json'),
  }), /system temp directory/);
});

test('executor_task_io rejects symlinked output parents into loop-owned dirs', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'executor-task-io-'));
  const loopTruthDir = path.join(tempDir, 'source', '.ralph');
  const symlinkPath = path.join(tempDir, 'linked-output');
  await mkdir(loopTruthDir, { recursive: true });
  await symlink(loopTruthDir, symlinkPath);

  assert.throws(() => runExecutorTaskIoFixture({
    fixture: buildFixture(),
    outPath: path.join(symlinkPath, 'executor-stage.json'),
  }), /must be outside \.ralph and \.arena/);
});

test('executor_task_io rejects unsafe declared changed files', () => {
  assert.throws(() => runExecutorTaskIoFixture({
    fixture: buildFixture({
      agentResult: {
        success: true,
        output: completionOutput(),
        filesChanged: ['/tmp/outside.ts'],
      },
    }),
  }), /repo-relative safe paths/);

  assert.throws(() => runExecutorTaskIoFixture({
    fixture: buildFixture({
      agentResult: {
        success: true,
        output: completionOutput(),
        filesChanged: ['.ralph/plan.json'],
      },
    }),
  }), /loop\/proof\/lifecycle truth paths/);
});

test('executor_task_io surfaces malformed completion attempts without marking complete', () => {
  const result = runExecutorTaskIoFixture({
    fixture: buildFixture({
      agentResult: {
        success: true,
        output: 'I changed the UI and the completion keyword is TASK_COMPLETE.',
        filesChanged: ['src/components/SynthPad.tsx'],
      },
    }),
  });

  assert.equal(result.agentResult.detectedCompletionPromiseFound, false);
  assert.equal(result.executorOutput.status, 'work_without_completion_signal');
  assert.equal(result.executorOutput.warnings.some((warning) => warning.code === 'malformed_completion'), true);
  assert.equal(JSON.parse(formatExecutorTaskIoResult(result, true)).stage.stageId, 'executor_task_io');
});

function buildFixture(overrides: Partial<ExecutorTaskIoFixture> = {}): ExecutorTaskIoFixture {
  return {
    schemaVersion: EXECUTOR_TASK_IO_FIXTURE_SCHEMA_VERSION,
    name: 'tiny-visual-executor',
    promptVariantRef: 'visual-workbench-v0',
    sourceRef: 'fixture-source-ref',
    completionPromise: 'TASK_COMPLETE',
    visualEvidenceMode: 'required',
    expectedVisualWorkbenchStoryIds: ['synth-pad.playing'],
    task: {
      id: 'task-001',
      displayTitle: 'Add synth pad story',
      description: 'Add a SynthPad visual workbench story for the playing state.',
      acceptanceCriteria: [
        'SynthPad playing state renders through visual-workbench/manifest.json.',
      ],
      status: 'pending',
      attempts: 0,
      dependencies: [],
      requiredRolePasses: ['ux'],
      feedbackItemRefs: [{
        itemId: 'DIFF-001',
        diffItemId: 'DIFF-001',
        targetType: 'feature',
        targetId: 'synth-pad',
        changeType: 'add',
        workImpact: 'requires_loop_work',
        workSurface: 'frontend',
        summary: 'Add visible synth pad playing state.',
      }],
    },
    promptFixture: {
      schemaVersion: PROMPT_LAB_FIXTURE_SCHEMA_VERSION,
      promptId: 'executor.agentPrompt',
      name: 'tiny-visual-executor-prompt',
      input: {
        contextSections: [
          '# Current Task',
          'Task task-001: Add synth pad story.',
          '',
          '# Visual Workbench Expectation',
          'Update visual-workbench/stories/synth-pad.playing.tsx for the playing state.',
          '',
          '# Completion Signal',
          'When complete, output <promise>TASK_COMPLETE</promise>.',
        ].join('\n'),
      },
    },
    agentResult: {
      success: true,
      output: completionOutput(),
      filesChanged: [
        'src/components/SynthPad.tsx',
        'visual-workbench/stories/synth-pad.playing.tsx',
        '.ralph/tasks/task-001/plan.md',
      ],
    },
    ...overrides,
  };
}

function completionOutput(): string {
  return [
    'Implemented the SynthPad playing state and its Visual Workbench story.',
    '<promise>TASK_COMPLETE</promise>',
  ].join('\n');
}
