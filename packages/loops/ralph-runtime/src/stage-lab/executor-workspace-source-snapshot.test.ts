import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { execa } from 'execa';
import type { AgentOptions } from '../agents/base.js';
import type { AgentResult } from '../config/types.js';
import { PROMPT_LAB_FIXTURE_SCHEMA_VERSION } from '../prompts/prompt-lab.js';
import {
  EXECUTOR_TASK_WORKSPACE_RESULT_SCHEMA_VERSION,
  type ExecutorTaskWorkspaceAgent,
  runExecutorTaskWorkspace,
} from './executor-task-workspace.js';
import {
  EXECUTOR_WORKSPACE_SOURCE_SNAPSHOT_REPORT_FILE,
  EXECUTOR_WORKSPACE_SOURCE_SNAPSHOT_SCHEMA_VERSION,
  runExecutorWorkspaceSourceSnapshot,
} from './executor-workspace-source-snapshot.js';

test('executor_workspace_source_snapshot creates an experiment source ref from executor workspace changes', async () => {
  const workDir = await createGitWorkspace();
  const sourceRef = await git(workDir, 'rev-parse', 'HEAD');
  const executorOutDir = await mkdtemp(path.join(os.tmpdir(), 'executor-task-workspace-out-'));
  const snapshotOutDir = await mkdtemp(path.join(os.tmpdir(), 'executor-workspace-snapshot-out-'));

  const executorResult = await runExecutorTaskWorkspace({
    ...baseWorkspaceInput({ workDir, sourceRef, outDir: executorOutDir }),
    agent: testAgent(async () => {
      await mkdir(path.join(workDir, 'visual-workbench', 'stories'), { recursive: true });
      await writeFile(path.join(workDir, 'visual-workbench', 'stories', 'synth-pad.playing.tsx'), 'export const story = "playing";\n', 'utf8');
      return agentResult({
        filesChanged: ['visual-workbench/stories/synth-pad.playing.tsx'],
      });
    }),
  });

  const result = await runExecutorWorkspaceSourceSnapshot({
    executorWorkspaceReportPath: executorResult.output.reportPath,
    workDir,
    sourceRef,
    outDir: snapshotOutDir,
    commitMessage: 'snapshot executor workspace source',
    projectId: 'project-stook',
  });

  const report = JSON.parse(await readFile(path.join(snapshotOutDir, EXECUTOR_WORKSPACE_SOURCE_SNAPSHOT_REPORT_FILE), 'utf8'));
  const gitStatus = await git(workDir, 'status', '--porcelain', '-uall');

  assert.equal(result.schemaVersion, EXECUTOR_WORKSPACE_SOURCE_SNAPSHOT_SCHEMA_VERSION);
  assert.equal(result.status, 'snapshotted');
  assert.equal(result.error, null);
  assert.notEqual(result.snapshot.afterExperimentSourceRef, sourceRef);
  assert.equal(await git(workDir, 'rev-parse', 'HEAD'), result.snapshot.afterExperimentSourceRef);
  assert.equal(gitStatus, '');
  assert.deepEqual(result.snapshot.changedVisualWorkbenchFiles, ['visual-workbench/stories/synth-pad.playing.tsx']);
  assert.equal(result.executorReport.taskVisualEvidenceRequired, true);
  assert.equal(result.arenaReadback.projectId, 'project-stook');
  assert.equal(result.arenaReadback.projectIdSource, 'operator_input');
  assert.equal(result.executorReport.taskHasStructuredVisualExpectation, true);
  assert.deepEqual(result.executorReport.taskVisualExpectationSources, [
    'task.visualEvidenceRequired',
    'task.requiredRolePasses.ux',
    'task.feedbackItemRefs.workSurface.frontend',
  ]);
  assert.equal(result.visualWorkbenchHandoff.status, 'ready_for_readiness_checks');
  assert.deepEqual(result.visualWorkbenchHandoff.nextCommandOrder, [
    'visualWorkbenchInspect',
    'visualWorkbenchSelectorReadiness',
    'visualWorkbenchEvidenceChainReadiness',
  ]);
  assert.match(result.nextCommands.visualWorkbenchInspect ?? '', /visual-workbench inspect/);
  assert.match(result.nextCommands.visualWorkbenchSelectorReadiness ?? '', /visual-workbench selector-readiness/);
  assert.match(result.nextCommands.visualWorkbenchEvidenceChainReadiness ?? '', /visual-workbench evidence-chain-readiness/);
  assert.match(result.nextCommands.visualWorkbenchEvidenceChainReadiness ?? '', /--project-id project-stook/);
  assert.equal(result.nextCommands.visualWorkbenchCaptureSelectedStoryViewports, null);
  assert.equal(result.nextCommands.visualWorkbenchCapture, null);
  assert.equal(report.status, 'snapshotted');
});

test('executor_workspace_source_snapshot does not route non-visual tasks into Workbench evidence readiness', async () => {
  const workDir = await createGitWorkspace();
  const sourceRef = await git(workDir, 'rev-parse', 'HEAD');
  const executorOutDir = await mkdtemp(path.join(os.tmpdir(), 'executor-task-workspace-out-'));
  const snapshotOutDir = await mkdtemp(path.join(os.tmpdir(), 'executor-workspace-snapshot-out-'));
  const workspaceInput = baseWorkspaceInput({ workDir, sourceRef, outDir: executorOutDir });
  workspaceInput.task.visualEvidenceRequired = false;
  workspaceInput.task.requiredRolePasses = [];
  workspaceInput.task.feedbackItemRefs = [];

  const executorResult = await runExecutorTaskWorkspace({
    ...workspaceInput,
    agent: testAgent(async () => {
      await writeFile(path.join(workDir, 'src', 'components', 'SynthPad.tsx'), 'export const SynthPad = () => "configured";\n', 'utf8');
      return agentResult({
        filesChanged: ['src/components/SynthPad.tsx'],
      });
    }),
  });

  const result = await runExecutorWorkspaceSourceSnapshot({
    executorWorkspaceReportPath: executorResult.output.reportPath,
    workDir,
    sourceRef,
    outDir: snapshotOutDir,
    commitMessage: 'snapshot non visual executor workspace source',
  });

  assert.equal(result.status, 'snapshotted');
  assert.equal(result.executorReport.taskVisualEvidenceRequired, false);
  assert.equal(result.executorReport.taskHasStructuredVisualExpectation, false);
  assert.deepEqual(result.executorReport.taskVisualExpectationSources, []);
  assert.equal(result.visualWorkbenchHandoff.status, 'not_applicable');
  assert.deepEqual(result.visualWorkbenchHandoff.nextCommandOrder, []);
  assert.equal(result.nextCommands.visualWorkbenchInspect, null);
  assert.equal(result.nextCommands.visualWorkbenchSelectorReadiness, null);
  assert.equal(result.nextCommands.visualWorkbenchEvidenceChainReadiness, null);
  assert.equal(result.nextCommands.visualWorkbenchCaptureSelectedStoryViewports, null);
  assert.equal(result.nextCommands.visualWorkbenchCapture, null);
});

test('executor_workspace_source_snapshot rejects stale executor reports when workspace changes drift', async () => {
  const workDir = await createGitWorkspace();
  const sourceRef = await git(workDir, 'rev-parse', 'HEAD');
  const executorOutDir = await mkdtemp(path.join(os.tmpdir(), 'executor-task-workspace-out-'));
  const snapshotOutDir = await mkdtemp(path.join(os.tmpdir(), 'executor-workspace-snapshot-out-'));

  const executorResult = await runExecutorTaskWorkspace({
    ...baseWorkspaceInput({ workDir, sourceRef, outDir: executorOutDir }),
    agent: testAgent(async () => {
      await writeFile(path.join(workDir, 'src', 'components', 'SynthPad.tsx'), 'export const SynthPad = () => "playing";\n', 'utf8');
      return agentResult({
        filesChanged: ['src/components/SynthPad.tsx'],
      });
    }),
  });
  await writeFile(path.join(workDir, 'extra.txt'), 'drift\n', 'utf8');

  const result = await runExecutorWorkspaceSourceSnapshot({
    executorWorkspaceReportPath: executorResult.output.reportPath,
    workDir,
    sourceRef,
    outDir: snapshotOutDir,
    commitMessage: 'snapshot stale report',
  });

  assert.equal(result.status, 'blocked');
  assert.equal(result.error?.code, 'workspace_status_mismatch');
  assert.deepEqual(result.visualWorkbenchHandoff.nextCommandOrder, []);
  assert.equal(result.nextCommands.visualWorkbenchInspect, null);
  assert.equal(result.nextCommands.visualWorkbenchSelectorReadiness, null);
  assert.equal(result.nextCommands.visualWorkbenchEvidenceChainReadiness, null);
  assert.equal(result.nextCommands.visualWorkbenchCaptureSelectedStoryViewports, null);
  assert.equal(result.nextCommands.visualWorkbenchCapture, null);
  assert.equal(await git(workDir, 'rev-parse', 'HEAD'), sourceRef);
});

test('executor_workspace_source_snapshot rejects forged reports with forbidden changed paths', async () => {
  const workDir = await createGitWorkspace();
  const sourceRef = await git(workDir, 'rev-parse', 'HEAD');
  const reportDir = await mkdtemp(path.join(os.tmpdir(), 'executor-task-workspace-report-'));
  const snapshotOutDir = await mkdtemp(path.join(os.tmpdir(), 'executor-workspace-snapshot-out-'));
  const reportPath = path.join(reportDir, 'executor-task-workspace-run.json');
  await mkdir(path.join(workDir, '.ralph', 'tasks', 'task-001'), { recursive: true });
  await writeFile(path.join(workDir, '.ralph', 'tasks', 'task-001', 'plan.md'), '# hidden truth\n', 'utf8');
  await writeFile(reportPath, JSON.stringify({
    schemaVersion: EXECUTOR_TASK_WORKSPACE_RESULT_SCHEMA_VERSION,
    stage: { stageId: 'executor_task_workspace' },
    status: 'completed',
    source: {
      workDir,
      requestedSourceRef: sourceRef,
      resolvedSourceRef: sourceRef,
      headBefore: sourceRef,
      headAfter: sourceRef,
      changedFilesFromGitStatus: ['.ralph/tasks/task-001/plan.md'],
    },
    task: {
      id: 'task-001',
      visualEvidenceRequired: true,
      hasStructuredVisualExpectation: true,
      visualExpectationSources: ['task.visualEvidenceRequired'],
    },
    agent: { name: 'forged-agent', model: 'forged-model' },
  }), 'utf8');

  const result = await runExecutorWorkspaceSourceSnapshot({
    executorWorkspaceReportPath: reportPath,
    workDir,
    sourceRef,
    outDir: snapshotOutDir,
    commitMessage: 'snapshot forbidden path',
  });

  assert.equal(result.status, 'forbidden_mutation');
  assert.equal(result.error?.code, 'forbidden_mutation');
  assert.deepEqual(result.snapshot.forbiddenChangedFiles, ['.ralph/tasks/task-001/plan.md']);
  assert.equal(await git(workDir, 'rev-parse', 'HEAD'), sourceRef);
});

test('executor_workspace_source_snapshot rejects executor reports without explicit visual gate metadata', async () => {
  const workDir = await createGitWorkspace();
  const sourceRef = await git(workDir, 'rev-parse', 'HEAD');
  const reportDir = await mkdtemp(path.join(os.tmpdir(), 'executor-task-workspace-report-'));
  const snapshotOutDir = await mkdtemp(path.join(os.tmpdir(), 'executor-workspace-snapshot-out-'));
  const reportPath = path.join(reportDir, 'executor-task-workspace-run.json');
  await writeFile(reportPath, JSON.stringify({
    schemaVersion: EXECUTOR_TASK_WORKSPACE_RESULT_SCHEMA_VERSION,
    stage: { stageId: 'executor_task_workspace' },
    status: 'completed',
    source: {
      workDir,
      requestedSourceRef: sourceRef,
      resolvedSourceRef: sourceRef,
      headBefore: sourceRef,
      headAfter: sourceRef,
      changedFilesFromGitStatus: [],
    },
    task: {
      id: 'task-001',
    },
    agent: { name: 'old-report-agent', model: 'old-report-model' },
  }), 'utf8');

  await assert.rejects(() => runExecutorWorkspaceSourceSnapshot({
    executorWorkspaceReportPath: reportPath,
    workDir,
    sourceRef,
    outDir: snapshotOutDir,
    commitMessage: 'snapshot old report',
  }), /visualEvidenceRequired|hasStructuredVisualExpectation|visualExpectationSources/);
});

test('executor_workspace_source_snapshot refuses to overwrite an existing snapshot report', async () => {
  const workDir = await createGitWorkspace();
  const sourceRef = await git(workDir, 'rev-parse', 'HEAD');
  const snapshotOutDir = await mkdtemp(path.join(os.tmpdir(), 'executor-workspace-snapshot-out-'));
  await writeFile(path.join(snapshotOutDir, EXECUTOR_WORKSPACE_SOURCE_SNAPSHOT_REPORT_FILE), '{}\n', 'utf8');

  await assert.rejects(() => runExecutorWorkspaceSourceSnapshot({
    executorWorkspaceReportPath: '/tmp/executor-task-workspace-run.json',
    workDir,
    sourceRef,
    outDir: snapshotOutDir,
    commitMessage: 'snapshot overwrite',
  }), /refusing to overwrite experiment output/);
});

async function createGitWorkspace(): Promise<string> {
  const workDir = await mkdtemp(path.join(os.tmpdir(), 'executor-workspace-snapshot-src-'));
  await mkdir(path.join(workDir, 'src', 'components'), { recursive: true });
  await writeFile(path.join(workDir, 'src', 'components', 'SynthPad.tsx'), 'export const SynthPad = () => "idle";\n', 'utf8');
  await git(workDir, 'init');
  await git(workDir, 'config', 'user.email', 'test@example.com');
  await git(workDir, 'config', 'user.name', 'Test User');
  await git(workDir, 'add', '.');
  await git(workDir, 'commit', '-m', 'initial');
  return workDir;
}

function baseWorkspaceInput(input: {
  workDir: string;
  sourceRef: string;
  outDir: string;
}) {
  return {
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
      visualEvidenceRequired: true,
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
    completionPromise: 'TASK_COMPLETE',
    visualEvidenceMode: 'required' as const,
    expectedVisualWorkbenchStoryIds: ['synth-pad.playing'],
    promptVariantRef: 'visual-workbench-v0',
    workDir: input.workDir,
    sourceRef: input.sourceRef,
    outDir: input.outDir,
    timeoutMinutes: 3,
  };
}

function testAgent(execute: (options: AgentOptions) => Promise<AgentResult>): ExecutorTaskWorkspaceAgent {
  return {
    name: 'test-injected-agent',
    execute,
  };
}

function agentResult(overrides: Partial<AgentResult> = {}): AgentResult {
  return {
    success: true,
    output: 'Implemented the requested visual workbench story.\n<promise>TASK_COMPLETE</promise>',
    filesChanged: [],
    completionPromiseFound: true,
    ...overrides,
  };
}

async function git(cwd: string, ...args: string[]): Promise<string> {
  const result = await execa('git', args, { cwd });
  return result.stdout.trim();
}
