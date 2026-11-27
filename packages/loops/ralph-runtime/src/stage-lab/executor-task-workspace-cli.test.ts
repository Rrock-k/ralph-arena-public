import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { execa } from 'execa';
import {
  assertFixtureStageRejectsWorkspaceProviderOptions,
  normalizeControllerProjectDryRunStageRunOptions,
  normalizeExecutorTaskWorkspaceContinueStageRunOptions,
  normalizeExecutorProjectTaskStageRunOptions,
  normalizePlannerSpecMigrationApplyStageRunOptions,
  normalizePlannerProjectDryRunStageRunOptions,
  normalizeExecutorWorkspaceSourceSnapshotStageRunOptions,
  normalizeExecutorTaskWorkspaceStageRunOptions,
} from './executor-task-workspace-cli.js';

const packageRoot = fileURLToPath(new URL('../../', import.meta.url));
const repoRoot = path.resolve(packageRoot, '../../..');

test('executor_task_workspace CLI options require explicit agent and model before provider creation', () => {
  const base = {
    taskFixture: '/tmp/task.json',
    promptFixture: '/tmp/prompt.json',
    completionPromise: 'TASK_COMPLETE',
    workDir: '/tmp/source',
    sourceRef: 'HEAD',
    outDir: '/tmp/out',
    timeoutMinutes: '3',
  };

  assert.throws(() => normalizeExecutorTaskWorkspaceStageRunOptions({
    ...base,
    model: 'test-model',
  }), /requires explicit --agent/);

  assert.throws(() => normalizeExecutorTaskWorkspaceStageRunOptions({
    ...base,
    agent: 'codex',
  }), /requires explicit --model/);

  assert.throws(() => normalizeExecutorTaskWorkspaceStageRunOptions({
    ...base,
    agent: 'codex',
    model: 'test-model',
    timeoutMinutes: undefined,
  }), /requires explicit --timeout-minutes/);

  assert.throws(() => normalizeExecutorTaskWorkspaceStageRunOptions({
    ...base,
    agent: 'codex',
    model: 'test-model',
  }), /requires explicit --visual-evidence-mode/);
});

test('executor_task_workspace CLI options reject fixture-mode, snapshot flags and antigravity', () => {
  const base = {
    taskFixture: '/tmp/task.json',
    promptFixture: '/tmp/prompt.json',
    completionPromise: 'TASK_COMPLETE',
    workDir: '/tmp/source',
    sourceRef: 'HEAD',
    outDir: '/tmp/out',
    agent: 'codex',
    model: 'test-model',
    timeoutMinutes: '3',
    visualEvidenceMode: 'required',
  };

  assert.throws(() => normalizeExecutorTaskWorkspaceStageRunOptions({
    ...base,
    fixture: '/tmp/fixture.json',
  }), /do not pass fixture-mode --fixture or --out/);

  assert.throws(() => normalizeExecutorTaskWorkspaceStageRunOptions({
    ...base,
    out: '/tmp/result.json',
  }), /do not pass fixture-mode --fixture or --out/);

  assert.throws(() => normalizeExecutorTaskWorkspaceStageRunOptions({
    ...base,
    executorWorkspaceReport: '/tmp/executor-task-workspace-run.json',
  }), /does not use snapshot handoff options/);

  assert.throws(() => normalizeExecutorTaskWorkspaceStageRunOptions({
    ...base,
    agent: 'antigravity',
  }), /antigravity is not enabled/);

  assert.throws(() => normalizeExecutorTaskWorkspaceStageRunOptions({
    ...base,
    visualWorkbenchCapture: ['/tmp/visual-workbench-capture-run.json'],
  }), /does not use controller visual review options/);
});

test('executor_task_workspace CLI options normalize explicit workspace run inputs', () => {
  const normalized = normalizeExecutorTaskWorkspaceStageRunOptions({
    taskFixture: ' task.json ',
    promptFixture: ' prompt.json ',
    completionPromise: ' TASK_COMPLETE ',
    workDir: ' source ',
    sourceRef: ' HEAD ',
    outDir: ' out ',
    agent: 'codex',
    model: ' gpt-test ',
    timeoutMinutes: ' 3 ',
    promptVariant: ' visual-first ',
    visualEvidenceMode: ' new_tasks_only ',
    expectedStory: [' story-a ', '', 'story-b'],
  });

  assert.deepEqual(normalized, {
    taskFixturePath: 'task.json',
    promptFixturePath: 'prompt.json',
    completionPromise: 'TASK_COMPLETE',
    workDir: 'source',
    sourceRef: 'HEAD',
    outDir: 'out',
    agentType: 'codex',
    model: 'gpt-test',
    timeoutMinutes: 3,
    promptVariantRef: 'visual-first',
    visualEvidenceMode: 'new_tasks_only',
    expectedVisualWorkbenchStoryIds: ['story-a', 'story-b'],
  });

  assert.throws(() => normalizeExecutorTaskWorkspaceStageRunOptions({
    taskFixture: 'task.json',
    promptFixture: 'prompt.json',
    completionPromise: 'TASK_COMPLETE',
    workDir: 'source',
    sourceRef: 'HEAD',
    outDir: 'out',
    agent: 'codex',
    model: 'gpt-test',
    timeoutMinutes: '3',
    visualEvidenceMode: 'sometimes',
  }), /executor_task_workspace --visual-evidence-mode must be one of/);
});

test('planner_spec_migration_apply CLI derives workspace, spec and visual mode from snapshot only', () => {
  const normalized = normalizePlannerSpecMigrationApplyStageRunOptions({
    snapshot: ' project-stage-snapshot.json ',
    sourceRef: ' abc123 ',
    outDir: ' out ',
    agent: 'codex',
    model: ' gpt-test ',
    timeoutMinutes: ' 5 ',
  });

  assert.deepEqual(normalized, {
    snapshotPath: 'project-stage-snapshot.json',
    sourceRef: 'abc123',
    outDir: 'out',
    agentType: 'codex',
    model: 'gpt-test',
    timeoutMinutes: 5,
  });

  assert.throws(() => normalizePlannerSpecMigrationApplyStageRunOptions({
    snapshot: 'project-stage-snapshot.json',
    sourceRef: 'abc123',
    outDir: 'out',
    agent: 'codex',
    model: 'gpt-test',
    timeoutMinutes: '5',
    workDir: '/tmp/source',
  }), /Forbidden option\(s\): --work-dir/);

  assert.throws(() => normalizePlannerSpecMigrationApplyStageRunOptions({
    snapshot: 'project-stage-snapshot.json',
    sourceRef: 'abc123',
    outDir: 'out',
    agent: 'codex',
    model: 'gpt-test',
    timeoutMinutes: '5',
    spec: 'spec.md',
  }), /Forbidden option\(s\): --spec/);

  assert.throws(() => normalizePlannerSpecMigrationApplyStageRunOptions({
    snapshot: 'project-stage-snapshot.json',
    sourceRef: 'abc123',
    outDir: 'out',
    agent: 'codex',
    model: 'gpt-test',
    timeoutMinutes: '5',
    visualEvidenceMode: 'required',
  }), /Forbidden option\(s\): --visual-evidence-mode/);
});

test('executor_task_workspace_continue CLI options normalize explicit dirty fork continuation inputs', () => {
  const normalized = normalizeExecutorTaskWorkspaceContinueStageRunOptions({
    executorWorkspaceReport: ' previous.json ',
    taskFixture: ' task.json ',
    promptFixture: ' prompt.json ',
    completionPromise: ' TASK_COMPLETE ',
    workDir: ' dirty-source ',
    sourceRef: ' abc123 ',
    outDir: ' out ',
    agent: 'codex',
    model: ' gpt-test ',
    timeoutMinutes: ' 5 ',
    promptVariant: ' visual-first ',
    visualEvidenceMode: ' required ',
    expectedStory: [' story-a ', '', 'story-b'],
  });

  assert.deepEqual(normalized, {
    executorWorkspaceReportPath: 'previous.json',
    taskFixturePath: 'task.json',
    promptFixturePath: 'prompt.json',
    completionPromise: 'TASK_COMPLETE',
    workDir: 'dirty-source',
    sourceRef: 'abc123',
    outDir: 'out',
    agentType: 'codex',
    model: 'gpt-test',
    timeoutMinutes: 5,
    promptVariantRef: 'visual-first',
    visualEvidenceMode: 'required',
    expectedVisualWorkbenchStoryIds: ['story-a', 'story-b'],
  });

  assert.throws(() => normalizeExecutorTaskWorkspaceContinueStageRunOptions({
    executorWorkspaceReport: 'previous.json',
    taskFixture: 'task.json',
    promptFixture: 'prompt.json',
    completionPromise: 'TASK_COMPLETE',
    workDir: 'dirty-source',
    sourceRef: 'abc123',
    outDir: 'out',
    agent: 'codex',
    model: 'gpt-test',
    timeoutMinutes: '5',
    visualEvidenceMode: 'sometimes',
  }), /executor_task_workspace_continue --visual-evidence-mode must be one of/);

  assert.throws(() => normalizeExecutorTaskWorkspaceContinueStageRunOptions({
    executorWorkspaceReport: 'previous.json',
    taskFixture: 'task.json',
    promptFixture: 'prompt.json',
    completionPromise: 'TASK_COMPLETE',
    workDir: 'dirty-source',
    sourceRef: 'abc123',
    outDir: 'out',
    agent: 'codex',
    model: 'gpt-test',
    timeoutMinutes: '5',
    snapshot: 'project-stage-snapshot.json',
  }), /Forbidden option\(s\): --snapshot/);

  assert.throws(() => normalizeExecutorTaskWorkspaceContinueStageRunOptions({
    taskFixture: 'task.json',
    promptFixture: 'prompt.json',
    completionPromise: 'TASK_COMPLETE',
    workDir: 'dirty-source',
    sourceRef: 'abc123',
    outDir: 'out',
    agent: 'codex',
    model: 'gpt-test',
    timeoutMinutes: '5',
  }), /requires explicit --executor-workspace-report/);
});

test('executor_project_task CLI options normalize explicit snapshot workspace run inputs', () => {
  const normalized = normalizeExecutorProjectTaskStageRunOptions({
    snapshot: ' snapshot.json ',
    mode: ' new_task ',
    workspaceMode: ' fork ',
    completionPromise: ' TASK_COMPLETE ',
    workDir: ' forked-source ',
    sourceRef: ' abc123 ',
    outDir: ' out ',
    agent: 'codex',
    model: ' gpt-test ',
    timeoutMinutes: ' 3 ',
    promptVariant: ' visual-first ',
    expectedStory: [' story-a ', '', 'story-b'],
  });

  assert.deepEqual(normalized, {
    snapshotPath: 'snapshot.json',
    mode: 'new_task',
    workspaceMode: 'fork',
    completionPromise: 'TASK_COMPLETE',
    workDir: 'forked-source',
    sourceRef: 'abc123',
    outDir: 'out',
    agentType: 'codex',
    model: 'gpt-test',
    timeoutMinutes: 3,
    promptVariantRef: 'visual-first',
    expectedVisualWorkbenchStoryIds: ['story-a', 'story-b'],
  });

  const failedMode = normalizeExecutorProjectTaskStageRunOptions({
    snapshot: 'snapshot.json',
    mode: 'failed_task',
    workspaceMode: 'fork',
    completionPromise: 'TASK_COMPLETE',
    workDir: 'forked-source',
    sourceRef: 'abc123',
    outDir: 'out',
    agent: 'codex',
    model: 'gpt-test',
    timeoutMinutes: '3',
  });
  assert.equal(failedMode.mode, 'failed_task');

  const resumeMode = normalizeExecutorProjectTaskStageRunOptions({
    snapshot: 'snapshot.json',
    mode: 'resume_interrupted',
    workspaceMode: 'fork',
    completionPromise: 'TASK_COMPLETE',
    workDir: 'forked-source',
    sourceRef: 'abc123',
    outDir: 'out',
    agent: 'codex',
    model: 'gpt-test',
    timeoutMinutes: '3',
  });
  assert.equal(resumeMode.mode, 'resume_interrupted');

  const liveMode = normalizeExecutorProjectTaskStageRunOptions({
    snapshot: 'snapshot.json',
    mode: 'new_task',
    workspaceMode: 'live_workspace_action',
    completionPromise: 'TASK_COMPLETE',
    outDir: 'out',
    agent: 'codex',
    model: 'gpt-test',
    timeoutMinutes: '3',
  });
  assert.deepEqual(liveMode, {
    snapshotPath: 'snapshot.json',
    mode: 'new_task',
    workspaceMode: 'live_workspace_action',
    completionPromise: 'TASK_COMPLETE',
    workDir: null,
    sourceRef: null,
    outDir: 'out',
    agentType: 'codex',
    model: 'gpt-test',
    timeoutMinutes: 3,
    promptVariantRef: null,
    expectedVisualWorkbenchStoryIds: [],
  });

  assert.throws(() => normalizeExecutorProjectTaskStageRunOptions({
    snapshot: 'snapshot.json',
    mode: 'unknown_mode',
    workspaceMode: 'fork',
    completionPromise: 'TASK_COMPLETE',
    workDir: 'forked-source',
    sourceRef: 'abc123',
    outDir: 'out',
    agent: 'codex',
    model: 'gpt-test',
    timeoutMinutes: '3',
  }), /currently supports --mode new_task, --mode failed_task and --mode resume_interrupted only/);

  assert.throws(() => normalizeExecutorProjectTaskStageRunOptions({
    snapshot: 'snapshot.json',
    mode: 'new_task',
    workspaceMode: 'live',
    completionPromise: 'TASK_COMPLETE',
    workDir: 'forked-source',
    sourceRef: 'abc123',
    outDir: 'out',
    agent: 'codex',
    model: 'gpt-test',
    timeoutMinutes: '3',
  }), /currently supports --workspace-mode fork and --workspace-mode live_workspace_action only/);

  assert.throws(() => normalizeExecutorProjectTaskStageRunOptions({
    snapshot: 'snapshot.json',
    mode: 'new_task',
    workspaceMode: 'fork',
    completionPromise: 'TASK_COMPLETE',
    workDir: 'forked-source',
    sourceRef: 'abc123',
    outDir: 'out',
    agent: 'codex',
    model: 'gpt-test',
    timeoutMinutes: '3',
    taskFixture: 'task.json',
  }), /Forbidden option\(s\): --task-fixture/);
});

test('planner_project_dry_run CLI options require explicit snapshot source spec visual mode and provider settings', () => {
  const normalized = normalizePlannerProjectDryRunStageRunOptions({
    snapshot: ' snapshot.json ',
    workDir: ' forked-source ',
    sourceRef: ' abc123 ',
    spec: ' spec.md ',
    visualEvidenceMode: ' new_tasks_only ',
    outDir: ' out ',
    agent: 'codex',
    model: ' gpt-test ',
    timeoutMinutes: ' 3 ',
  });

  assert.deepEqual(normalized, {
    snapshotPath: 'snapshot.json',
    workDir: 'forked-source',
    sourceRef: 'abc123',
    spec: 'spec.md',
    visualEvidenceMode: 'new_tasks_only',
    outDir: 'out',
    agentType: 'codex',
    model: 'gpt-test',
    timeoutMinutes: 3,
  });

  assert.throws(() => normalizePlannerProjectDryRunStageRunOptions({
    snapshot: 'snapshot.json',
    workDir: 'source',
    sourceRef: 'HEAD',
    spec: 'spec.md',
    outDir: 'out',
    agent: 'codex',
    model: 'gpt-test',
    timeoutMinutes: '3',
  }), /requires explicit --visual-evidence-mode/);

  assert.throws(() => normalizePlannerProjectDryRunStageRunOptions({
    snapshot: 'snapshot.json',
    workDir: 'source',
    sourceRef: 'HEAD',
    spec: 'spec.md',
    visualEvidenceMode: 'sometimes',
    outDir: 'out',
    agent: 'codex',
    model: 'gpt-test',
    timeoutMinutes: '3',
  }), /--visual-evidence-mode must be one of/);

  assert.throws(() => normalizePlannerProjectDryRunStageRunOptions({
    snapshot: 'snapshot.json',
    workDir: 'source',
    sourceRef: 'HEAD',
    spec: 'spec.md',
    visualEvidenceMode: 'off',
    outDir: 'out',
    agent: 'codex',
    model: 'gpt-test',
    timeoutMinutes: '3',
    completionPromise: 'TASK_COMPLETE',
  }), /Forbidden option\(s\): --completion-promise/);
});

test('controller_project_dry_run CLI options require explicit snapshot source spec trigger visual mode and provider settings', () => {
  const normalized = normalizeControllerProjectDryRunStageRunOptions({
    snapshot: ' snapshot.json ',
    workDir: ' forked-source ',
    sourceRef: ' abc123 ',
    spec: ' spec.md ',
    trigger: ' manual ',
    visualEvidenceMode: ' new_tasks_only ',
    outDir: ' out ',
    agent: 'codex',
    model: ' gpt-test ',
    timeoutMinutes: ' 3 ',
  });

  assert.deepEqual(normalized, {
    snapshotPath: 'snapshot.json',
    workDir: 'forked-source',
    sourceRef: 'abc123',
    spec: 'spec.md',
    trigger: 'manual',
    visualEvidenceMode: 'new_tasks_only',
    outDir: 'out',
    agentType: 'codex',
    model: 'gpt-test',
    timeoutMinutes: 3,
  });

  assert.throws(() => normalizeControllerProjectDryRunStageRunOptions({
    snapshot: 'snapshot.json',
    workDir: 'source',
    sourceRef: 'HEAD',
    spec: 'spec.md',
    visualEvidenceMode: 'off',
    outDir: 'out',
    agent: 'codex',
    model: 'gpt-test',
    timeoutMinutes: '3',
  }), /requires explicit --trigger/);

  assert.throws(() => normalizeControllerProjectDryRunStageRunOptions({
    snapshot: 'snapshot.json',
    workDir: 'source',
    sourceRef: 'HEAD',
    spec: 'spec.md',
    trigger: 'startup',
    visualEvidenceMode: 'off',
    outDir: 'out',
    agent: 'codex',
    model: 'gpt-test',
    timeoutMinutes: '3',
  }), /startup is intentionally forbidden/);

  assert.throws(() => normalizeControllerProjectDryRunStageRunOptions({
    snapshot: 'snapshot.json',
    workDir: 'source',
    sourceRef: 'HEAD',
    spec: 'spec.md',
    trigger: 'manual',
    visualEvidenceMode: 'off',
    outDir: 'out',
    agent: 'codex',
    model: 'gpt-test',
    timeoutMinutes: '3',
    completionPromise: 'TASK_COMPLETE',
  }), /Forbidden option\(s\): --completion-promise/);
});

test('executor workspace source snapshot CLI options normalize explicit handoff inputs', () => {
  const normalized = normalizeExecutorWorkspaceSourceSnapshotStageRunOptions({
    executorWorkspaceReport: ' report.json ',
    workDir: ' source ',
    sourceRef: ' HEAD ',
    outDir: ' out ',
    commitMessage: ' snapshot visual workbench source ',
    projectId: ' project-stook ',
  });

  assert.deepEqual(normalized, {
    executorWorkspaceReportPath: 'report.json',
    workDir: 'source',
    sourceRef: 'HEAD',
    outDir: 'out',
    commitMessage: 'snapshot visual workbench source',
    projectId: 'project-stook',
  });

  assert.throws(() => normalizeExecutorWorkspaceSourceSnapshotStageRunOptions({
    executorWorkspaceReport: 'report.json',
    workDir: 'source',
    sourceRef: 'HEAD',
    outDir: 'out',
    commitMessage: 'snapshot',
    agent: 'codex',
  }), /Forbidden option\(s\): --agent/);

  assert.throws(() => normalizeExecutorWorkspaceSourceSnapshotStageRunOptions({
    executorWorkspaceReport: 'report.json',
    workDir: 'source',
    sourceRef: 'HEAD',
    outDir: 'out',
    commitMessage: 'snapshot',
    visualWorkbenchCapture: ['/tmp/visual-workbench-capture-run.json'],
  }), /Forbidden option\(s\): --visual-workbench-capture/);

  assert.throws(() => normalizeExecutorProjectTaskStageRunOptions({
    snapshot: 'snapshot.json',
    mode: 'new_task',
    workspaceMode: 'fork',
    completionPromise: 'TASK_COMPLETE',
    workDir: 'source',
    sourceRef: 'HEAD',
    outDir: 'out',
    agent: 'codex',
    model: 'gpt-test',
    timeoutMinutes: '3',
    projectId: 'project-stook',
  }), /Forbidden option\(s\): --project-id/);
});

test('fixture stages reject executor workspace/provider options', () => {
  assert.throws(() => assertFixtureStageRejectsWorkspaceProviderOptions('executor_task_io', {
    fixture: '/tmp/fixture.json',
    agent: 'codex',
  }), /executor_task_io is a fixture-mode stage/);

  assert.throws(() => assertFixtureStageRejectsWorkspaceProviderOptions('planner_prompt_io', {
    fixture: '/tmp/fixture.json',
    expectedStory: ['story-a'],
    visualWorkbenchCapture: ['/tmp/visual-workbench-capture-run.json'],
  }), /Forbidden option\(s\): --expected-story, --visual-workbench-capture/);

  assert.throws(() => assertFixtureStageRejectsWorkspaceProviderOptions('controller_visual_review', {
    fixture: '/tmp/fixture.json',
    executorWorkspaceReport: '/tmp/report.json',
    commitMessage: 'snapshot',
  }), /Forbidden option\(s\): --executor-workspace-report, --commit-message/);

  assert.doesNotThrow(() => assertFixtureStageRejectsWorkspaceProviderOptions('executor_task_io', {
    fixture: '/tmp/fixture.json',
    out: '/tmp/out.json',
  }));
});

test('stage run CLI rejects workspace-mode conflicts without creating a provider', async () => {
  const result = await runRalphCli([
    'stage',
    'run',
    'executor_task_workspace',
    '--task-fixture',
    '/tmp/task.json',
    '--prompt-fixture',
    '/tmp/prompt.json',
    '--completion-promise',
    'TASK_COMPLETE',
    '--work-dir',
    '/tmp/source',
    '--source-ref',
    'HEAD',
    '--out-dir',
    '/tmp/out',
    '--agent',
    'codex',
    '--model',
    'test-model',
    '--timeout-minutes',
    '3',
    '--fixture',
    '/tmp/fixture.json',
  ]);

  assert.equal(result.exitCode, 1);
  assert.match(combinedOutput(result), /do not pass fixture-mode --fixture or --out/);
});

test('stage run CLI rejects continuation snapshot conflicts before creating a provider', async () => {
  const result = await runRalphCli([
    'stage',
    'run',
    'executor_task_workspace_continue',
    '--executor-workspace-report',
    '/tmp/executor-task-workspace-run.json',
    '--task-fixture',
    '/tmp/task.json',
    '--prompt-fixture',
    '/tmp/prompt.json',
    '--completion-promise',
    'TASK_COMPLETE',
    '--work-dir',
    '/tmp/source',
    '--source-ref',
    'HEAD',
    '--out-dir',
    '/tmp/out',
    '--agent',
    'codex',
    '--model',
    'test-model',
    '--timeout-minutes',
    '3',
    '--snapshot',
    '/tmp/project-stage-snapshot.json',
  ]);

  assert.equal(result.exitCode, 1);
  assert.match(combinedOutput(result), /executor_task_workspace_continue uses .*Forbidden option\(s\): --snapshot/);
});

test('stage run CLI rejects snapshot-mode conflicts without running git', async () => {
  const result = await runRalphCli([
    'stage',
    'run',
    'executor_workspace_source_snapshot',
    '--executor-workspace-report',
    '/tmp/executor-task-workspace-run.json',
    '--work-dir',
    '/tmp/source',
    '--source-ref',
    'HEAD',
    '--out-dir',
    '/tmp/out',
    '--commit-message',
    'snapshot',
    '--agent',
    'codex',
  ]);

  assert.equal(result.exitCode, 1);
  assert.match(combinedOutput(result), /Forbidden option\(s\): --agent/);
});

test('stage run CLI rejects project-task mode conflicts before reading snapshot', async () => {
  const result = await runRalphCli([
    'stage',
    'run',
    'executor_project_task',
    '--snapshot',
    '/tmp/project-stage-snapshot.json',
    '--mode',
    'new_task',
    '--workspace-mode',
    'fork',
    '--completion-promise',
    'TASK_COMPLETE',
    '--work-dir',
    '/tmp/source',
    '--source-ref',
    'abc123',
    '--out-dir',
    '/tmp/out',
    '--agent',
    'codex',
    '--model',
    'test-model',
    '--timeout-minutes',
    '3',
    '--task-fixture',
    '/tmp/task.json',
  ]);

  assert.equal(result.exitCode, 1);
  assert.match(combinedOutput(result), /Forbidden option\(s\): --task-fixture/);
});

test('stage run CLI rejects controller dry-run conflicts before creating a provider', async () => {
  const result = await runRalphCli([
    'stage',
    'run',
    'controller_project_dry_run',
    '--snapshot',
    '/tmp/project-stage-snapshot.json',
    '--work-dir',
    '/tmp/source',
    '--source-ref',
    'abc123',
    '--spec',
    'spec.md',
    '--trigger',
    'manual',
    '--visual-evidence-mode',
    'off',
    '--out-dir',
    '/tmp/out',
    '--agent',
    'codex',
    '--model',
    'test-model',
    '--timeout-minutes',
    '3',
    '--completion-promise',
    'TASK_COMPLETE',
  ]);

  assert.equal(result.exitCode, 1);
  assert.match(combinedOutput(result), /Forbidden option\(s\): --completion-promise/);
});

test('stage run CLI keeps fixture stages fixture-only and leaves unknown stages on fixture runner path', async () => {
  const fixtureStage = await runRalphCli([
    'stage',
    'run',
    'executor_task_io',
    '--fixture',
    '/tmp/executor-task-io.json',
    '--model',
    'test-model',
  ]);

  assert.equal(fixtureStage.exitCode, 1);
  assert.match(combinedOutput(fixtureStage), /executor_task_io is a fixture-mode stage/);

  const unknownStage = await runRalphCli([
    'stage',
    'run',
    'unknown_stage',
    '--fixture',
    '/tmp/unknown.json',
  ]);

  assert.equal(unknownStage.exitCode, 1);
  assert.match(combinedOutput(unknownStage), /Unsupported isolated stage: unknown_stage/);
});

test('stage run CLI passes visual workbench capture reports to controller visual review only', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'controller-visual-review-cli-'));
  const captureReportPath = path.join(tempDir, 'visual-workbench-capture-run.json');
  await writeFile(captureReportPath, JSON.stringify({
    schemaVersion: 'ra-355.visual-workbench-capture-run.v0',
    status: 'captured',
    stage: {
      sourceRef: 'capture-source-ref',
    },
    stories: [{
      storyId: 'synth-pad.playing.desktop',
      title: 'Synth pad playing state',
      kind: 'widget',
      feature: 'instrument-surface',
      widget: 'SynthPad',
      state: 'playing',
      route: '/__visual/synth-pad.playing.desktop',
      claim: 'The synth pad shows the active note, pressure level and clear release affordance.',
      viewports: [{
        name: 'desktop',
        width: 1280,
        height: 832,
        status: 'captured',
        screenshotPath: path.join(tempDir, 'desktop.png'),
        screenshotSha256: 'sha256:abc123',
        error: null,
      }],
    }],
    error: null,
  }, null, 2), 'utf8');

  const controllerResult = await runRalphCli([
    'stage',
    'run',
    'controller_visual_review',
    '--fixture',
    path.join(repoRoot, 'work/plans/ra-356-manual-experiment-tooling/fixtures/controller-visual-review-visual-task.json'),
    '--visual-workbench-capture',
    captureReportPath,
    '--compact',
  ]);

  assert.equal(controllerResult.exitCode, 0);
  const parsed = JSON.parse(controllerResult.stdout);
  assert.equal(parsed.stage.stageId, 'controller_visual_review');
  assert.equal(parsed.inputArtifacts.visualWorkbenchCaptureReports.length, 1);
  assert.equal(parsed.visualReview.evidenceByResult.pass, 1);
  assert.equal(parsed.visualReview.evidenceByResult.captured, 1);
  assert.equal(parsed.visualReview.evidenceVerdict, 'needs_follow_up');

  const plannerResult = await runRalphCli([
    'stage',
    'run',
    'planner_prompt_io',
    '--fixture',
    '/tmp/planner.json',
    '--visual-workbench-capture',
    captureReportPath,
  ]);

  assert.equal(plannerResult.exitCode, 1);
  assert.match(combinedOutput(plannerResult), /only supported by controller_visual_review/);
});

async function runRalphCli(args: string[]) {
  return execa(process.execPath, ['--import', 'tsx', 'src/index.ts', ...args], {
    cwd: packageRoot,
    reject: false,
  });
}

function combinedOutput(result: { stdout: string; stderr: string }): string {
  return `${result.stdout}\n${result.stderr}`;
}
