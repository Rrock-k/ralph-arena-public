import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { execa } from 'execa';
import type { AgentOptions } from '../agents/base.js';
import type { AgentResult } from '../config/types.js';
import { PROMPT_LAB_FIXTURE_SCHEMA_VERSION } from '../prompts/prompt-lab.js';
import {
  EXECUTOR_TASK_WORKSPACE_REPORT_FILE,
  EXECUTOR_TASK_WORKSPACE_RESULT_SCHEMA_VERSION,
  type ExecutorTaskWorkspaceAgent,
  runExecutorTaskWorkspace,
  runExecutorTaskWorkspaceFiles,
} from './executor-task-workspace.js';
import { AGENT_OUTPUT_PREVIEW_MAX_CHARS } from './agent-output-preview.js';

test('executor_task_workspace runs injected agent in a clean forked workspace and reports git diff', async () => {
  const workDir = await createGitWorkspace();
  const sourceRef = await git(workDir, 'rev-parse', 'HEAD');
  const outDir = await mkdtemp(path.join(os.tmpdir(), 'executor-task-workspace-out-'));

  const result = await runExecutorTaskWorkspace({
    ...baseWorkspaceInput({ workDir, sourceRef, outDir }),
    agent: testAgent(async (options) => {
      assert.equal(options.workDir, workDir);
      assert.equal(options.timeout, 3);
      assert.equal(options.verbose, false);
      assert.match(options.prompt, /Task task-001/);
      await writeFile(path.join(workDir, 'src', 'components', 'SynthPad.tsx'), 'export const SynthPad = () => "playing";\n', 'utf8');
      await mkdir(path.join(workDir, 'visual-workbench', 'stories'), { recursive: true });
      await writeFile(path.join(workDir, 'visual-workbench', 'stories', 'synth-pad.playing.tsx'), 'export const story = "playing";\n', 'utf8');
      return agentResult({
        output: completionOutput(),
        completionPromiseFound: false,
        filesChanged: [
          'src/components/SynthPad.tsx',
          'visual-workbench/stories/synth-pad.playing.tsx',
        ],
      });
    }),
  });

  const report = JSON.parse(await readFile(path.join(outDir, EXECUTOR_TASK_WORKSPACE_REPORT_FILE), 'utf8'));

  assert.equal(result.schemaVersion, EXECUTOR_TASK_WORKSPACE_RESULT_SCHEMA_VERSION);
  assert.equal(result.status, 'completed');
  assert.equal(result.stage.stageId, 'executor_task_workspace');
  assert.equal(result.stage.mode, 'workspace_mutation');
  assert.equal(result.stage.ownerBoundary, 'ralph.executor-action-core');
  assert.equal(result.task.visualEvidenceMode, 'required');
  assert.equal(result.agent.timeoutMinutes, 3);
  assert.equal(result.agent.outputPreview, null);
  assert.equal(result.agent.outputPreviewTruncated, false);
  assert.equal(result.source.headChanged, false);
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
  assert.deepEqual(result.executorOutput.summary?.changedProductFiles.sort(), [
    'src/components/SynthPad.tsx',
    'visual-workbench/stories/synth-pad.playing.tsx',
  ].sort());
  assert.deepEqual(result.executorOutput.summary?.changedVisualWorkbenchFiles, [
    'visual-workbench/stories/synth-pad.playing.tsx',
  ]);
  assert.deepEqual(result.executorOutput.summary?.forbiddenChangedFiles, []);
  assert.equal(result.executorOutput.summary?.visualWorkbenchCoverage, 'changed');
  assert.equal(result.executorOutput.detectedCompletionPromiseFound, true);
  assert.deepEqual(result.executorOutput.warnings, []);
  assert.equal(report.status, 'completed');
});

test('executor_task_workspace blocks dirty workspace before calling agent', async () => {
  const workDir = await createGitWorkspace();
  const sourceRef = await git(workDir, 'rev-parse', 'HEAD');
  const outDir = await mkdtemp(path.join(os.tmpdir(), 'executor-task-workspace-out-'));
  await writeFile(path.join(workDir, 'dirty.txt'), 'dirty\n', 'utf8');
  let called = false;

  const result = await runExecutorTaskWorkspace({
    ...baseWorkspaceInput({ workDir, sourceRef, outDir }),
    agent: testAgent(async () => {
      called = true;
      return agentResult();
    }),
  });

  assert.equal(called, false);
  assert.equal(result.status, 'blocked');
  assert.equal(result.error?.code, 'workspace_dirty');
  assert.equal(result.executorOutput.ownerBoundary, null);
  assert.equal(result.executorOutput.visualEvidenceMode, null);
  assert.equal(result.executorOutput.visualExpectation, null);
  assert.deepEqual(result.source.changedFilesFromGitStatus, ['dirty.txt']);
});

test('executor_task_workspace passes provider session resume id to injected agent', async () => {
  const workDir = await createGitWorkspace();
  const sourceRef = await git(workDir, 'rev-parse', 'HEAD');
  const outDir = await mkdtemp(path.join(os.tmpdir(), 'executor-task-workspace-out-'));

  const result = await runExecutorTaskWorkspace({
    ...baseWorkspaceInput({ workDir, sourceRef, outDir }),
    providerSessionResumeId: 'session-old',
    agent: testAgent(async (options) => {
      assert.equal(options.providerSessionResumeId, 'session-old');
      return agentResult({
        providerSession: {
          id: 'session-new',
          resumedFrom: 'session-old',
          resumeFallbackReason: 'provider_fallback',
        },
      });
    }),
  });

  assert.equal(result.status, 'completed');
  assert.equal(result.agent.providerSessionResumeId, 'session-old');
  assert.equal(result.agent.providerSessionId, 'session-new');
  assert.equal(result.agent.providerSessionResumedFrom, 'session-old');
  assert.equal(result.agent.providerSessionResumeFallbackReason, 'provider_fallback');
});

test('executor_task_workspace reports a bounded agent output preview on agent failure', async () => {
  const workDir = await createGitWorkspace();
  const sourceRef = await git(workDir, 'rev-parse', 'HEAD');
  const outDir = await mkdtemp(path.join(os.tmpdir(), 'executor-task-workspace-out-'));
  const longOutput = `Provider stderr: resume failed for session-old\n${'x'.repeat(2_400)}`;

  const result = await runExecutorTaskWorkspace({
    ...baseWorkspaceInput({ workDir, sourceRef, outDir }),
    providerSessionResumeId: 'session-old',
    agent: testAgent(async () => agentResult({
      success: false,
      output: longOutput,
      completionPromiseFound: false,
      error: {
        category: 'infra',
        message: 'Codex exited with code 1',
      },
    })),
  });

  const report = JSON.parse(await readFile(path.join(outDir, EXECUTOR_TASK_WORKSPACE_REPORT_FILE), 'utf8'));

  assert.equal(result.status, 'agent_failed');
  assert.equal(result.error?.code, 'agent_failed');
  assert.equal(result.agent.outputCharCount, longOutput.length);
  assert.match(result.agent.outputPreview ?? '', /^Provider stderr: resume failed/);
  assert.equal(result.agent.outputPreviewTruncated, true);
  assert.ok((result.agent.outputPreview?.length ?? 0) <= AGENT_OUTPUT_PREVIEW_MAX_CHARS);
  assert.ok((result.agent.outputPreview?.length ?? 0) < longOutput.length);
  assert.equal(report.agent.outputPreview, result.agent.outputPreview);
  assert.equal(report.agent.outputPreviewTruncated, true);
});

test('executor_task_workspace fails post-call forbidden loop truth mutations', async () => {
  const workDir = await createGitWorkspace();
  const sourceRef = await git(workDir, 'rev-parse', 'HEAD');
  const outDir = await mkdtemp(path.join(os.tmpdir(), 'executor-task-workspace-out-'));

  const result = await runExecutorTaskWorkspace({
    ...baseWorkspaceInput({ workDir, sourceRef, outDir }),
    agent: testAgent(async () => {
      await mkdir(path.join(workDir, '.ralph', 'tasks', 'task-001'), { recursive: true });
      await writeFile(path.join(workDir, '.ralph', 'tasks', 'task-001', 'plan.md'), '# hidden task truth\n', 'utf8');
      return agentResult({
        output: completionOutput(),
        filesChanged: ['.ralph/tasks/task-001/plan.md'],
      });
    }),
  });

  assert.equal(result.status, 'forbidden_mutation');
  assert.equal(result.error?.code, 'forbidden_mutation');
  assert.deepEqual(result.executorOutput.summary?.forbiddenChangedFiles, [
    '.ralph/tasks/task-001/plan.md',
  ]);
});

test('executor_task_workspace fails if the agent changes HEAD', async () => {
  const workDir = await createGitWorkspace();
  const sourceRef = await git(workDir, 'rev-parse', 'HEAD');
  const outDir = await mkdtemp(path.join(os.tmpdir(), 'executor-task-workspace-out-'));

  const result = await runExecutorTaskWorkspace({
    ...baseWorkspaceInput({ workDir, sourceRef, outDir }),
    agent: testAgent(async () => {
      await writeFile(path.join(workDir, 'src', 'components', 'SynthPad.tsx'), 'export const SynthPad = () => "committed";\n', 'utf8');
      await git(workDir, 'add', '.');
      await git(workDir, 'commit', '-m', 'agent commit');
      return agentResult({
        output: completionOutput(),
        filesChanged: ['src/components/SynthPad.tsx'],
      });
    }),
  });

  assert.equal(result.status, 'forbidden_mutation');
  assert.equal(result.error?.code, 'head_changed');
  assert.equal(result.source.headChanged, true);
});

test('executor_task_workspace prioritizes forbidden mutations over agent failure', async () => {
  const workDir = await createGitWorkspace();
  const sourceRef = await git(workDir, 'rev-parse', 'HEAD');
  const outDir = await mkdtemp(path.join(os.tmpdir(), 'executor-task-workspace-out-'));

  const result = await runExecutorTaskWorkspace({
    ...baseWorkspaceInput({ workDir, sourceRef, outDir }),
    agent: testAgent(async () => {
      await mkdir(path.join(workDir, '.ralph', 'tasks', 'task-001'), { recursive: true });
      await writeFile(path.join(workDir, '.ralph', 'tasks', 'task-001', 'plan.md'), '# failed hidden task truth\n', 'utf8');
      return agentResult({
        success: false,
        output: 'agent failed after writing hidden task truth',
        filesChanged: ['.ralph/tasks/task-001/plan.md'],
        completionPromiseFound: false,
        error: {
          category: 'infra',
          message: 'agent failed',
        },
      });
    }),
  });

  assert.equal(result.status, 'forbidden_mutation');
  assert.equal(result.error?.code, 'forbidden_mutation');
});

test('executor_task_workspace prioritizes HEAD changes over agent failure', async () => {
  const workDir = await createGitWorkspace();
  const sourceRef = await git(workDir, 'rev-parse', 'HEAD');
  const outDir = await mkdtemp(path.join(os.tmpdir(), 'executor-task-workspace-out-'));

  const result = await runExecutorTaskWorkspace({
    ...baseWorkspaceInput({ workDir, sourceRef, outDir }),
    agent: testAgent(async () => {
      await writeFile(path.join(workDir, 'src', 'components', 'SynthPad.tsx'), 'export const SynthPad = () => "failed committed";\n', 'utf8');
      await git(workDir, 'add', '.');
      await git(workDir, 'commit', '-m', 'failed agent commit');
      return agentResult({
        success: false,
        output: 'agent failed after commit',
        filesChanged: ['src/components/SynthPad.tsx'],
        completionPromiseFound: false,
        error: {
          category: 'infra',
          message: 'agent failed',
        },
      });
    }),
  });

  assert.equal(result.status, 'forbidden_mutation');
  assert.equal(result.error?.code, 'head_changed');
});

test('executor_task_workspace fails closed when post-call git status is unavailable', async () => {
  const workDir = await createGitWorkspace();
  const sourceRef = await git(workDir, 'rev-parse', 'HEAD');
  const outDir = await mkdtemp(path.join(os.tmpdir(), 'executor-task-workspace-out-'));

  const result = await runExecutorTaskWorkspace({
    ...baseWorkspaceInput({ workDir, sourceRef, outDir }),
    agent: testAgent(async () => {
      await rm(path.join(workDir, '.git'), { recursive: true, force: true });
      return agentResult();
    }),
  });

  assert.equal(result.status, 'forbidden_mutation');
  assert.equal(result.error?.code, 'post_git_status_unavailable');
});

test('executor_task_workspace reports source ref blockers before agent call', async () => {
  const workDir = await createGitWorkspace();
  const outDir = await mkdtemp(path.join(os.tmpdir(), 'executor-task-workspace-out-'));
  let called = false;

  const unavailable = await runExecutorTaskWorkspace({
    ...baseWorkspaceInput({ workDir, sourceRef: 'missing-ref', outDir }),
    agent: testAgent(async () => {
      called = true;
      return agentResult();
    }),
  });
  assert.equal(unavailable.status, 'blocked');
  assert.equal(unavailable.error?.code, 'source_ref_unavailable');
  assert.equal(called, false);

  await writeFile(path.join(workDir, 'src', 'components', 'SynthPad.tsx'), 'export const SynthPad = () => "new head";\n', 'utf8');
  await git(workDir, 'add', '.');
  await git(workDir, 'commit', '-m', 'new head');
  const oldSourceRef = unavailable.source.headBefore ?? await git(workDir, 'rev-parse', 'HEAD~1');
  const mismatch = await runExecutorTaskWorkspace({
    ...baseWorkspaceInput({ workDir, sourceRef: oldSourceRef, outDir: await mkdtemp(path.join(os.tmpdir(), 'executor-task-workspace-out-')) }),
    agent: testAgent(async () => {
      called = true;
      return agentResult();
    }),
  });
  assert.equal(mismatch.status, 'blocked');
  assert.equal(mismatch.error?.code, 'source_ref_mismatch');
});

test('executor_task_workspace rejects missing workDir before calling agent', async () => {
  const outDir = await mkdtemp(path.join(os.tmpdir(), 'executor-task-workspace-out-'));
  const missingParent = await mkdtemp(path.join(os.tmpdir(), 'executor-task-workspace-missing-parent-'));
  const missingWorkDir = path.join(missingParent, 'missing-src');
  let called = false;

  await assert.rejects(() => runExecutorTaskWorkspace({
    ...baseWorkspaceInput({
      workDir: missingWorkDir,
      sourceRef: 'HEAD',
      outDir,
    }),
    agent: testAgent(async () => {
      called = true;
      return agentResult();
    }),
  }), /--work-dir must exist and be a directory/);

  assert.equal(called, false);
});

test('executor_task_workspace refuses to overwrite an existing report', async () => {
  const workDir = await createGitWorkspace();
  const sourceRef = await git(workDir, 'rev-parse', 'HEAD');
  const outDir = await mkdtemp(path.join(os.tmpdir(), 'executor-task-workspace-out-'));
  await writeFile(path.join(outDir, EXECUTOR_TASK_WORKSPACE_REPORT_FILE), '{}\n', 'utf8');
  let called = false;

  await assert.rejects(() => runExecutorTaskWorkspace({
    ...baseWorkspaceInput({ workDir, sourceRef, outDir }),
    agent: testAgent(async () => {
      called = true;
      return agentResult();
    }),
  }), /refusing to overwrite experiment output/);

  assert.equal(called, false);
});

test('executor_task_workspace file runner rejects fixtures in loop truth dirs', async () => {
  const base = {
    taskFixturePath: '/tmp/task.json',
    promptFixturePath: '/tmp/prompt.json',
    completionPromise: 'TASK_COMPLETE',
    visualEvidenceMode: 'required' as const,
    workDir: '/tmp/source',
    sourceRef: 'HEAD',
    outDir: '/tmp/out',
    agent: testAgent(async () => agentResult()),
  };

  await assert.rejects(() => runExecutorTaskWorkspaceFiles({
    ...base,
    taskFixturePath: path.join(os.tmpdir(), 'source', '.ralph', 'task.json'),
  }), /--task-fixture must be outside \.ralph and \.arena/);

  await assert.rejects(() => runExecutorTaskWorkspaceFiles({
    ...base,
    promptFixturePath: path.join(os.tmpdir(), 'source', '.arena', 'prompt.json'),
  }), /--prompt-fixture must be outside \.ralph and \.arena/);
});

test('executor_task_workspace rejects output dir inside source, including symlinked parents', async () => {
  const workDir = await createGitWorkspace();
  const sourceRef = await git(workDir, 'rev-parse', 'HEAD');
  await assert.rejects(() => runExecutorTaskWorkspace({
    ...baseWorkspaceInput({
      workDir,
      sourceRef,
      outDir: path.join(workDir, 'experiment-output'),
    }),
    agent: testAgent(async () => agentResult()),
  }), /out-dir must be outside workDir/);

  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'executor-task-workspace-link-'));
  const linkedParent = path.join(tempDir, 'linked-output');
  await symlink(workDir, linkedParent);
  await assert.rejects(() => runExecutorTaskWorkspace({
    ...baseWorkspaceInput({
      workDir,
      sourceRef,
      outDir: path.join(linkedParent, 'out'),
    }),
    agent: testAgent(async () => agentResult()),
  }), /out-dir must resolve outside workDir/);

  const existingSymlinkTarget = path.join(workDir, 'existing-output-target');
  await mkdir(existingSymlinkTarget);
  const existingSymlinkOutDir = path.join(tempDir, 'existing-symlink-output');
  await symlink(existingSymlinkTarget, existingSymlinkOutDir);
  await assert.rejects(() => runExecutorTaskWorkspace({
    ...baseWorkspaceInput({
      workDir,
      sourceRef,
      outDir: existingSymlinkOutDir,
    }),
    agent: testAgent(async () => agentResult()),
  }), /out-dir must resolve outside workDir/);

  await assert.rejects(() => runExecutorTaskWorkspace({
    ...baseWorkspaceInput({
      workDir,
      sourceRef,
      outDir: path.join(tempDir, '.ralph', 'out'),
    }),
    agent: testAgent(async () => agentResult()),
  }), /outside \.ralph and \.arena/);
});

async function createGitWorkspace(): Promise<string> {
  const workDir = await mkdtemp(path.join(os.tmpdir(), 'executor-task-workspace-src-'));
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

function testAgent(execute: (options: AgentOptions) => Promise<AgentResult>): ExecutorTaskWorkspaceAgent {
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
