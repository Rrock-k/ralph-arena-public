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
  EXECUTOR_TASK_WORKSPACE_REPORT_FILE,
  type ExecutorTaskWorkspaceAgent,
  type ExecutorTaskWorkspaceResult,
  runExecutorTaskWorkspace,
} from './executor-task-workspace.js';
import {
  EXECUTOR_TASK_WORKSPACE_CONTINUE_REPORT_FILE,
  EXECUTOR_TASK_WORKSPACE_CONTINUE_RESULT_SCHEMA_VERSION,
  type ExecutorTaskWorkspaceContinueAgent,
  runExecutorTaskWorkspaceContinue,
} from './executor-task-workspace-continue.js';
import { AGENT_OUTPUT_PREVIEW_MAX_CHARS } from './agent-output-preview.js';

test('executor_task_workspace_continue resumes the same dirty fork after an agent_failed report', async () => {
  const workDir = await createGitWorkspace();
  const sourceRef = await git(workDir, 'rev-parse', 'HEAD');
  const firstOutDir = await mkdtemp(path.join(os.tmpdir(), 'executor-task-workspace-first-out-'));
  const continueOutDir = await mkdtemp(path.join(os.tmpdir(), 'executor-task-workspace-continue-out-'));
  let capturedPrompt = '';

  const previousResult = await runExecutorTaskWorkspace({
    ...baseWorkspaceInput({ workDir, sourceRef, outDir: firstOutDir }),
    agent: testWorkspaceAgent(async () => {
      await writeFile(path.join(workDir, 'src', 'components', 'SynthPad.tsx'), 'export const SynthPad = () => "partial";\n', 'utf8');
      return agentResult({
        success: false,
        output: 'Timed out after partial source edit.',
        filesChanged: ['src/components/SynthPad.tsx'],
        error: {
          category: 'infra',
          message: 'timeout',
        },
      });
    }),
  });
  assert.equal(previousResult.status, 'agent_failed');

  const result = await runExecutorTaskWorkspaceContinue({
    ...baseWorkspaceInput({ workDir, sourceRef, outDir: continueOutDir }),
    previousExecutorWorkspaceReport: previousResult,
    previousExecutorWorkspaceReportPath: path.join(firstOutDir, EXECUTOR_TASK_WORKSPACE_REPORT_FILE),
    previousExecutorWorkspaceReportRaw: JSON.stringify(previousResult),
    agent: testContinueAgent(async (options) => {
      capturedPrompt = options.prompt;
      assert.equal(options.workDir, workDir);
      assert.equal(options.timeout, 3);
      assert.equal(options.verbose, false);
      assert.equal(options.providerSessionResumeId, undefined);
      await writeFile(path.join(workDir, 'src', 'components', 'PatternGrid.tsx'), 'export const PatternGrid = () => "finished";\n', 'utf8');
      return agentResult({
        completionPromiseFound: false,
        filesChanged: [
          'src/components/SynthPad.tsx',
          'src/components/PatternGrid.tsx',
        ],
      });
    }),
  });

  const report = JSON.parse(await readFile(path.join(continueOutDir, EXECUTOR_TASK_WORKSPACE_CONTINUE_REPORT_FILE), 'utf8'));

  assert.equal(result.schemaVersion, EXECUTOR_TASK_WORKSPACE_CONTINUE_RESULT_SCHEMA_VERSION);
  assert.equal(result.status, 'completed');
  assert.equal(result.stage.stageId, 'executor_task_workspace_continue');
  assert.equal(result.stage.ownerBoundary, 'ralph.executor-action-core');
  assert.equal(result.task.visualEvidenceMode, 'required');
  assert.equal(result.previousReport.status, 'agent_failed');
  assert.equal(result.agent.outputPreview, null);
  assert.equal(result.agent.outputPreviewTruncated, false);
  assert.deepEqual(result.source.expectedDirtyChangedFiles, ['src/components/SynthPad.tsx']);
  assert.deepEqual(result.executorOutput.summary?.changedProductFiles.sort(), [
    'src/components/PatternGrid.tsx',
    'src/components/SynthPad.tsx',
  ].sort());
  assert.equal(result.executorOutput.ownerBoundary, 'ralph.executor-observer');
  assert.equal(result.executorOutput.visualEvidenceMode, 'required');
  assert.deepEqual(result.executorOutput.visualExpectation, {
    hasStructuredVisualExpectation: true,
    sources: [
      'task.requiredRolePasses.ux',
      'task.feedbackItemRefs.workSurface.frontend',
    ],
  });
  assert.equal(result.executorOutput.detectedCompletionPromiseFound, true);
  assert.equal(result.source.headChanged, false);
  assert.match(capturedPrompt, /RA-356 Dirty Fork Continuation Boundary/);
  assert.match(capturedPrompt, /Previous report status: agent_failed/);
  assert.equal(report.status, 'completed');
});

test('executor_task_workspace_continue blocks non-failed previous reports before calling agent', async () => {
  const workDir = await createGitWorkspace();
  const sourceRef = await git(workDir, 'rev-parse', 'HEAD');
  const firstOutDir = await mkdtemp(path.join(os.tmpdir(), 'executor-task-workspace-first-out-'));
  const continueOutDir = await mkdtemp(path.join(os.tmpdir(), 'executor-task-workspace-continue-out-'));
  let called = false;

  const previousResult = await runExecutorTaskWorkspace({
    ...baseWorkspaceInput({ workDir, sourceRef, outDir: firstOutDir }),
    agent: testWorkspaceAgent(async () => {
      await writeFile(path.join(workDir, 'src', 'components', 'SynthPad.tsx'), 'export const SynthPad = () => "done";\n', 'utf8');
      return agentResult({
        filesChanged: ['src/components/SynthPad.tsx'],
      });
    }),
  });
  assert.equal(previousResult.status, 'completed');

  const result = await runExecutorTaskWorkspaceContinue({
    ...baseWorkspaceInput({ workDir, sourceRef, outDir: continueOutDir }),
    previousExecutorWorkspaceReport: previousResult,
    agent: testContinueAgent(async () => {
      called = true;
      return agentResult();
    }),
  });

  assert.equal(called, false);
  assert.equal(result.status, 'blocked');
  assert.equal(result.error?.code, 'previous_report_not_agent_failed');
  assert.equal(result.executorOutput.ownerBoundary, null);
});

test('executor_task_workspace_continue reports a bounded agent output preview on continuation failure', async () => {
  const workDir = await createGitWorkspace();
  const sourceRef = await git(workDir, 'rev-parse', 'HEAD');
  const firstOutDir = await mkdtemp(path.join(os.tmpdir(), 'executor-task-workspace-first-out-'));
  const continueOutDir = await mkdtemp(path.join(os.tmpdir(), 'executor-task-workspace-continue-out-'));
  const previousResult = await failedPreviousResult({ workDir, sourceRef, outDir: firstOutDir });
  const longOutput = `Continuation failed after reading dirty fork\n${'y'.repeat(2_400)}`;

  const result = await runExecutorTaskWorkspaceContinue({
    ...baseWorkspaceInput({ workDir, sourceRef, outDir: continueOutDir }),
    previousExecutorWorkspaceReport: previousResult,
    agent: testContinueAgent(async () => agentResult({
      success: false,
      output: longOutput,
      completionPromiseFound: false,
      filesChanged: ['src/components/SynthPad.tsx'],
      error: {
        category: 'infra',
        message: 'Codex exited with code 1',
      },
    })),
  });

  const report = JSON.parse(await readFile(path.join(continueOutDir, EXECUTOR_TASK_WORKSPACE_CONTINUE_REPORT_FILE), 'utf8'));

  assert.equal(result.status, 'agent_failed');
  assert.equal(result.error?.code, 'agent_failed');
  assert.equal(result.agent.outputCharCount, longOutput.length);
  assert.match(result.agent.outputPreview ?? '', /^Continuation failed/);
  assert.equal(result.agent.outputPreviewTruncated, true);
  assert.ok((result.agent.outputPreview?.length ?? 0) <= AGENT_OUTPUT_PREVIEW_MAX_CHARS);
  assert.ok((result.agent.outputPreview?.length ?? 0) < longOutput.length);
  assert.equal(report.agent.outputPreview, result.agent.outputPreview);
  assert.equal(report.agent.outputPreviewTruncated, true);
});

test('executor_task_workspace_continue blocks dirty workspace drift before calling agent', async () => {
  const workDir = await createGitWorkspace();
  const sourceRef = await git(workDir, 'rev-parse', 'HEAD');
  const firstOutDir = await mkdtemp(path.join(os.tmpdir(), 'executor-task-workspace-first-out-'));
  const continueOutDir = await mkdtemp(path.join(os.tmpdir(), 'executor-task-workspace-continue-out-'));
  let called = false;

  const previousResult = await failedPreviousResult({ workDir, sourceRef, outDir: firstOutDir });
  await writeFile(path.join(workDir, 'src', 'components', 'Extra.tsx'), 'export const Extra = () => "drift";\n', 'utf8');

  const result = await runExecutorTaskWorkspaceContinue({
    ...baseWorkspaceInput({ workDir, sourceRef, outDir: continueOutDir }),
    previousExecutorWorkspaceReport: previousResult,
    agent: testContinueAgent(async () => {
      called = true;
      return agentResult();
    }),
  });

  assert.equal(called, false);
  assert.equal(result.status, 'blocked');
  assert.equal(result.error?.code, 'workspace_status_mismatch');
});

test('executor_task_workspace_continue rejects forbidden dirty files before calling agent', async () => {
  const workDir = await createGitWorkspace();
  const sourceRef = await git(workDir, 'rev-parse', 'HEAD');
  const firstOutDir = await mkdtemp(path.join(os.tmpdir(), 'executor-task-workspace-first-out-'));
  const continueOutDir = await mkdtemp(path.join(os.tmpdir(), 'executor-task-workspace-continue-out-'));
  let called = false;

  const previousResult = await failedPreviousResult({ workDir, sourceRef, outDir: firstOutDir });
  await mkdir(path.join(workDir, '.ralph', 'tasks', 'task-001'), { recursive: true });
  await writeFile(path.join(workDir, '.ralph', 'tasks', 'task-001', 'plan.md'), '# hidden\n', 'utf8');
  const forgedPrevious: ExecutorTaskWorkspaceResult = {
    ...previousResult,
    source: {
      ...previousResult.source,
      changedFilesFromGitStatus: [
        ...previousResult.source.changedFilesFromGitStatus,
        '.ralph/tasks/task-001/plan.md',
      ],
    },
  };

  const result = await runExecutorTaskWorkspaceContinue({
    ...baseWorkspaceInput({ workDir, sourceRef, outDir: continueOutDir }),
    previousExecutorWorkspaceReport: forgedPrevious,
    agent: testContinueAgent(async () => {
      called = true;
      return agentResult();
    }),
  });

  assert.equal(called, false);
  assert.equal(result.status, 'forbidden_mutation');
  assert.equal(result.error?.code, 'forbidden_mutation');
});

test('executor_task_workspace_continue blocks task fixture mismatch before calling agent', async () => {
  const workDir = await createGitWorkspace();
  const sourceRef = await git(workDir, 'rev-parse', 'HEAD');
  const firstOutDir = await mkdtemp(path.join(os.tmpdir(), 'executor-task-workspace-first-out-'));
  const continueOutDir = await mkdtemp(path.join(os.tmpdir(), 'executor-task-workspace-continue-out-'));
  let called = false;

  const previousResult = await failedPreviousResult({ workDir, sourceRef, outDir: firstOutDir });
  const input = baseWorkspaceInput({ workDir, sourceRef, outDir: continueOutDir });

  const result = await runExecutorTaskWorkspaceContinue({
    ...input,
    task: {
      ...input.task,
      id: 'task-999',
    },
    previousExecutorWorkspaceReport: previousResult,
    agent: testContinueAgent(async () => {
      called = true;
      return agentResult();
    }),
  });

  assert.equal(called, false);
  assert.equal(result.status, 'blocked');
  assert.equal(result.error?.code, 'previous_report_task_mismatch');
});

async function failedPreviousResult(input: {
  workDir: string;
  sourceRef: string;
  outDir: string;
}): Promise<ExecutorTaskWorkspaceResult> {
  return runExecutorTaskWorkspace({
    ...baseWorkspaceInput(input),
    agent: testWorkspaceAgent(async () => {
      await writeFile(path.join(input.workDir, 'src', 'components', 'SynthPad.tsx'), 'export const SynthPad = () => "partial";\n', 'utf8');
      return agentResult({
        success: false,
        output: 'Timed out after partial source edit.',
        filesChanged: ['src/components/SynthPad.tsx'],
        error: {
          category: 'infra',
          message: 'timeout',
        },
      });
    }),
  });
}

async function createGitWorkspace(): Promise<string> {
  const workDir = await mkdtemp(path.join(os.tmpdir(), 'executor-task-workspace-continue-src-'));
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

function testWorkspaceAgent(execute: (options: AgentOptions) => Promise<AgentResult>): ExecutorTaskWorkspaceAgent {
  return {
    name: 'test-injected-agent',
    execute,
  };
}

function testContinueAgent(execute: (options: AgentOptions) => Promise<AgentResult>): ExecutorTaskWorkspaceContinueAgent {
  return {
    name: 'test-injected-agent',
    execute,
  };
}

function agentResult(overrides: Partial<AgentResult> = {}): AgentResult {
  return {
    success: true,
    output: completionOutput(),
    filesChanged: [],
    completionPromiseFound: true,
    ...overrides,
  };
}

function completionOutput(): string {
  return 'Implemented the requested visual workbench story and updated the relevant source files.\n<promise>TASK_COMPLETE</promise>';
}

async function git(cwd: string, ...args: string[]): Promise<string> {
  const result = await execa('git', args, { cwd });
  return result.stdout.trim();
}
