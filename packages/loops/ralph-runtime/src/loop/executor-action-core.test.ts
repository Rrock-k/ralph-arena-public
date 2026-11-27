import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { execa } from 'execa';
import type { AgentOptions } from '../agents/base.js';
import type { AgentResult, Task } from '../config/types.js';
import { PROMPT_LAB_FIXTURE_SCHEMA_VERSION } from '../prompts/prompt-lab.js';
import {
  EXECUTOR_ACTION_CORE_OWNER_BOUNDARY,
  runExecutorActionCore,
} from './executor-action-core.js';
import type { ExecutorAgentPromptFixture } from './executor-prompt.js';

test('executor action core runs provider and observes git workspace diff', async () => {
  const workDir = await createGitWorkspace();
  const headBefore = await git(workDir, 'rev-parse', 'HEAD');

  const result = await runExecutorActionCore({
    ...baseCoreInput({ workDir, headBefore }),
    agentCall: {
      model: 'gpt-test',
      timeoutMinutes: 7,
      verbose: false,
      providerSessionResumeId: 'session-old',
    },
    agent: testAgent(async (options) => {
      assert.equal(options.workDir, workDir);
      assert.equal(options.model, 'gpt-test');
      assert.equal(options.timeout, 7);
      assert.equal(options.verbose, false);
      assert.equal(options.providerSessionResumeId, 'session-old');
      assert.match(options.prompt, /Task task-001/);
      await writeFile(path.join(workDir, 'src', 'components', 'SynthPad.tsx'), 'export const SynthPad = () => "playing";\n', 'utf8');
      return agentResult({
        filesChanged: ['declared-but-not-used.ts'],
        providerSession: {
          id: 'session-new',
          resumedFrom: 'session-old',
        },
      });
    }),
  });

  assert.equal(result.ownerBoundary, EXECUTOR_ACTION_CORE_OWNER_BOUNDARY);
  assert.equal(result.status, 'observed');
  assert.equal(result.promptEnvelope.ownerBoundary, 'ralph.executor-prompt');
  assert.equal(result.agentCall.ownerBoundary, 'ralph.executor-agent-call');
  assert.equal(result.agentCall.providerSessionResumeId, 'session-old');
  assert.deepEqual(result.sourceEvidence.changedFilesForObserver, ['src/components/SynthPad.tsx']);
  assert.deepEqual(result.executorOutput.summary.changedProductFiles, ['src/components/SynthPad.tsx']);
  assert.deepEqual(result.executorOutput.summary.changedVisualWorkbenchFiles, []);
  assert.equal(result.executorOutput.ownerBoundary, 'ralph.executor-observer');
  assert.equal(result.mutationOutcome.status, 'completed');
});

test('executor action core blocks dirty workspace before provider call', async () => {
  const workDir = await createGitWorkspace();
  const headBefore = await git(workDir, 'rev-parse', 'HEAD');
  await writeFile(path.join(workDir, 'dirty.txt'), 'dirty\n', 'utf8');
  let called = false;

  const result = await runExecutorActionCore({
    ...baseCoreInput({ workDir, headBefore }),
    agent: testAgent(async () => {
      called = true;
      return agentResult();
    }),
  });

  assert.equal(called, false);
  assert.equal(result.status, 'blocked_before_agent');
  assert.equal(result.error.code, 'workspace_dirty');
  assert.deepEqual(result.sourceEvidence.changedFilesForObserver, ['dirty.txt']);
});

test('executor action core can observe full post-call status after caller-validated dirty fork', async () => {
  const workDir = await createGitWorkspace();
  const headBefore = await git(workDir, 'rev-parse', 'HEAD');
  await writeFile(path.join(workDir, 'src', 'components', 'SynthPad.tsx'), 'export const SynthPad = () => "partial";\n', 'utf8');

  const result = await runExecutorActionCore({
    ...baseCoreInput({ workDir, headBefore }),
    changedFilesSourceLabel: 'Continuation workspace diff',
    sourceMode: {
      kind: 'post_call_status',
      preAgentPolicy: 'caller_validated',
    },
    agent: testAgent(async () => {
      await writeFile(path.join(workDir, 'src', 'components', 'PatternGrid.tsx'), 'export const PatternGrid = () => "finished";\n', 'utf8');
      return agentResult();
    }),
  });

  assert.equal(result.status, 'observed');
  assert.deepEqual(result.sourceEvidence.preExistingChangedFiles, ['src/components/SynthPad.tsx']);
  assert.deepEqual(result.sourceEvidence.changedFilesForObserver.sort(), [
    'src/components/PatternGrid.tsx',
    'src/components/SynthPad.tsx',
  ].sort());
  assert.deepEqual(result.executorOutput.summary.changedProductFiles.sort(), [
    'src/components/PatternGrid.tsx',
    'src/components/SynthPad.tsx',
  ].sort());
});

test('executor action core caller-validated continuation ignores unchanged pre-existing loop-owned bookkeeping', async () => {
  const workDir = await createGitWorkspace();
  const headBefore = await git(workDir, 'rev-parse', 'HEAD');
  await writeFile(path.join(workDir, '.ralph', 'plan.json'), '{"status":"in_progress"}\n', 'utf8');
  await writeFile(path.join(workDir, 'src', 'components', 'SynthPad.tsx'), 'export const SynthPad = () => "partial";\n', 'utf8');

  const result = await runExecutorActionCore({
    ...baseCoreInput({ workDir, headBefore }),
    changedFilesSourceLabel: 'Continuation workspace diff',
    sourceMode: {
      kind: 'post_call_status',
      preAgentPolicy: 'caller_validated',
    },
    allowedLoopOwnedPreExistingChangedFiles: ['.ralph/plan.json'],
    agent: testAgent(async () => {
      await writeFile(path.join(workDir, 'src', 'components', 'PatternGrid.tsx'), 'export const PatternGrid = () => "finished";\n', 'utf8');
      return agentResult();
    }),
  });

  assert.equal(result.status, 'observed');
  assert.deepEqual(result.sourceEvidence.preExistingChangedFiles.sort(), [
    '.ralph/plan.json',
    'src/components/SynthPad.tsx',
  ].sort());
  assert.deepEqual(result.sourceEvidence.changedFilesForObserver.sort(), [
    'src/components/PatternGrid.tsx',
    'src/components/SynthPad.tsx',
  ].sort());
  assert.equal(result.sourceEvidence.changedFilesSourceLabel, 'Continuation workspace diff');
  assert.equal(result.mutationOutcome.status, 'completed');
});

test('executor action core caller-validated continuation catches agent edits to pre-existing loop-owned bookkeeping', async () => {
  const workDir = await createGitWorkspace();
  const headBefore = await git(workDir, 'rev-parse', 'HEAD');
  await writeFile(path.join(workDir, '.ralph', 'plan.json'), '{"status":"in_progress"}\n', 'utf8');

  const result = await runExecutorActionCore({
    ...baseCoreInput({ workDir, headBefore }),
    changedFilesSourceLabel: 'Continuation workspace diff',
    sourceMode: {
      kind: 'post_call_status',
      preAgentPolicy: 'caller_validated',
    },
    allowedLoopOwnedPreExistingChangedFiles: ['.ralph/plan.json'],
    agent: testAgent(async () => {
      await writeFile(path.join(workDir, '.ralph', 'plan.json'), '{"status":"agent-edited"}\n', 'utf8');
      return agentResult();
    }),
  });

  assert.equal(result.status, 'observed');
  assert.deepEqual(result.sourceEvidence.changedFilesForObserver, ['.ralph/plan.json']);
  assert.equal(result.mutationOutcome.status, 'forbidden_mutation');
  assert.equal(result.mutationOutcome.error?.code, 'forbidden_mutation');
});

test('executor action core allows pre-existing loop-owned plan transition without attributing it to agent', async () => {
  const workDir = await createGitWorkspace();
  const headBefore = await git(workDir, 'rev-parse', 'HEAD');
  await writeFile(path.join(workDir, '.ralph', 'plan.json'), '{"status":"in_progress"}\n', 'utf8');
  let called = false;

  const result = await runExecutorActionCore({
    ...baseCoreInput({ workDir, headBefore }),
    sourceMode: {
      kind: 'post_call_delta',
      preAgentPolicy: 'allow_current_task_workspace_only',
    },
    allowedLoopOwnedPreExistingChangedFiles: ['.ralph/plan.json'],
    agent: testAgent(async () => {
      called = true;
      await writeFile(path.join(workDir, 'src', 'components', 'SynthPad.tsx'), 'export const SynthPad = () => "ported";\n', 'utf8');
      return agentResult();
    }),
  });

  assert.equal(called, true);
  assert.equal(result.status, 'observed');
  assert.deepEqual(result.sourceEvidence.preExistingChangedFiles, ['.ralph/plan.json']);
  assert.deepEqual(result.sourceEvidence.changedFilesForObserver, ['src/components/SynthPad.tsx']);
  assert.equal(result.mutationOutcome.status, 'completed');
});

test('executor action core catches agent edits to pre-existing loop-owned plan file', async () => {
  const workDir = await createGitWorkspace();
  const headBefore = await git(workDir, 'rev-parse', 'HEAD');
  await writeFile(path.join(workDir, '.ralph', 'plan.json'), '{"status":"in_progress"}\n', 'utf8');

  const result = await runExecutorActionCore({
    ...baseCoreInput({ workDir, headBefore }),
    sourceMode: {
      kind: 'post_call_delta',
      preAgentPolicy: 'allow_current_task_workspace_only',
    },
    allowedLoopOwnedPreExistingChangedFiles: ['.ralph/plan.json'],
    agent: testAgent(async () => {
      await writeFile(path.join(workDir, '.ralph', 'plan.json'), '{"status":"agent-edited"}\n', 'utf8');
      return agentResult();
    }),
  });

  assert.equal(result.status, 'observed');
  assert.deepEqual(result.sourceEvidence.changedFilesForObserver, ['.ralph/plan.json']);
  assert.equal(result.mutationOutcome.status, 'forbidden_mutation');
  assert.equal(result.mutationOutcome.error?.code, 'forbidden_mutation');
});

test('executor action core forbids agent writes to runner-owned specs directory', async () => {
  const workDir = await createGitWorkspace();
  const headBefore = await git(workDir, 'rev-parse', 'HEAD');
  await mkdir(path.join(workDir, 'specs'), { recursive: true });

  const result = await runExecutorActionCore({
    ...baseCoreInput({ workDir, headBefore }),
    sourceMode: {
      kind: 'post_call_delta',
      preAgentPolicy: 'require_clean_workspace',
    },
    classificationOptions: {
      allowTaskWorkspaceFiles: false,
    },
    agent: testAgent(async () => {
      await writeFile(path.join(workDir, 'specs', 'economy-design-reference.md'), '# Derived reference\n', 'utf8');
      return agentResult();
    }),
  });

  assert.equal(result.status, 'observed');
  assert.deepEqual(result.executorOutput.summary.changedProductFiles, []);
  assert.deepEqual(result.executorOutput.summary.forbiddenChangedFiles, [
    'specs/economy-design-reference.md',
  ]);
  assert.equal(result.mutationOutcome.status, 'forbidden_mutation');
  assert.equal(result.mutationOutcome.error?.code, 'forbidden_mutation');
});

test('executor action core ignores runner-materialized spec refresh during provider call', async () => {
  const workDir = await createGitWorkspace();
  await writeFile(path.join(workDir, '.gitignore'), '.arena/\n', 'utf8');
  await writeMaterializedSpecInput(workDir, {
    projectTitle: 'Sushi Kitties',
    id: 'cmo96pzw305035hmwhzpyj5g9',
    slug: 'Evolution Spec',
    content: '# Old accepted spec\n',
  });
  await git(workDir, 'add', '.gitignore', 'spec.md', 'specs');
  await git(workDir, 'commit', '-m', 'record materialized specs');
  const headBefore = await git(workDir, 'rev-parse', 'HEAD');

  const result = await runExecutorActionCore({
    ...baseCoreInput({ workDir, headBefore }),
    agent: testAgent(async () => {
      await writeFile(path.join(workDir, 'src', 'components', 'SynthPad.tsx'), 'export const SynthPad = () => "ported";\n', 'utf8');
      await writeMaterializedSpecInput(workDir, {
        projectTitle: 'Sushi Kitties',
        id: 'cmo96pzw305035hmwhzpyj5g9',
        slug: 'Evolution Spec',
        content: '# Fresh accepted spec\n\nNew FTUE requirements.\n',
      });
      return agentResult({
        filesChanged: [
          'src/components/SynthPad.tsx',
          'spec.md',
          'specs/001-evolution-spec-j5g9.md',
        ],
      });
    }),
  });

  assert.equal(result.status, 'observed');
  assert.deepEqual(result.sourceEvidence.runnerMaterializedSpecInputFiles, [
    'spec.md',
    'specs/001-evolution-spec-j5g9.md',
  ]);
  assert.deepEqual(result.sourceEvidence.changedFilesForObserver, ['src/components/SynthPad.tsx']);
  assert.deepEqual(result.executorOutput.summary.changedProductFiles, ['src/components/SynthPad.tsx']);
  assert.deepEqual(result.executorOutput.summary.forbiddenChangedFiles, []);
  assert.equal(result.mutationOutcome.status, 'completed');
});

test('executor action core ignores runner-materialized spec refresh during resumed WIP task', async () => {
  const workDir = await createGitWorkspace();
  await writeFile(path.join(workDir, '.gitignore'), '.arena/\n', 'utf8');
  await writeMaterializedSpecInput(workDir, {
    projectTitle: 'Sushi Kitties',
    id: 'cmo96pzw305035hmwhzpyj5g9',
    slug: 'Evolution Spec',
    content: '# Old accepted spec\n',
  });
  await git(workDir, 'add', '.gitignore', 'spec.md', 'specs');
  await git(workDir, 'commit', '-m', 'record materialized specs');
  const headBefore = await git(workDir, 'rev-parse', 'HEAD');
  await writeFile(path.join(workDir, 'src', 'components', 'SynthPad.tsx'), 'export const SynthPad = () => "partial";\n', 'utf8');

  const result = await runExecutorActionCore({
    ...baseCoreInput({ workDir, headBefore }),
    changedFilesSourceLabel: 'Continuation workspace diff',
    sourceMode: {
      kind: 'post_call_status',
      preAgentPolicy: 'caller_validated',
    },
    agent: testAgent(async () => {
      await writeFile(path.join(workDir, 'src', 'components', 'PatternGrid.tsx'), 'export const PatternGrid = () => "finished";\n', 'utf8');
      await writeMaterializedSpecInput(workDir, {
        projectTitle: 'Sushi Kitties',
        id: 'cmo96pzw305035hmwhzpyj5g9',
        slug: 'Evolution Spec',
        content: '# Fresh accepted spec\n\nNew FTUE requirements.\n',
      });
      return agentResult({
        filesChanged: [
          'src/components/PatternGrid.tsx',
          'spec.md',
          'specs/001-evolution-spec-j5g9.md',
        ],
      });
    }),
  });

  assert.equal(result.status, 'observed');
  assert.deepEqual(result.sourceEvidence.runnerMaterializedSpecInputFiles, [
    'spec.md',
    'specs/001-evolution-spec-j5g9.md',
  ]);
  assert.deepEqual(result.sourceEvidence.changedFilesForObserver.sort(), [
    'src/components/PatternGrid.tsx',
    'src/components/SynthPad.tsx',
  ].sort());
  assert.deepEqual(result.executorOutput.summary.changedProductFiles.sort(), [
    'src/components/PatternGrid.tsx',
    'src/components/SynthPad.tsx',
  ].sort());
  assert.deepEqual(result.executorOutput.summary.forbiddenChangedFiles, []);
  assert.equal(result.mutationOutcome.status, 'completed');
});

test('executor action core keeps forged materialized spec edits forbidden', async () => {
  const workDir = await createGitWorkspace();
  await writeFile(path.join(workDir, '.gitignore'), '.arena/\n', 'utf8');
  await writeMaterializedSpecInput(workDir, {
    projectTitle: 'Sushi Kitties',
    id: 'cmo96pzw305035hmwhzpyj5g9',
    slug: 'Evolution Spec',
    content: '# Old accepted spec\n',
  });
  await git(workDir, 'add', '.gitignore', 'spec.md', 'specs');
  await git(workDir, 'commit', '-m', 'record materialized specs');
  const headBefore = await git(workDir, 'rev-parse', 'HEAD');

  const result = await runExecutorActionCore({
    ...baseCoreInput({ workDir, headBefore }),
    agent: testAgent(async () => {
      await writeFile(path.join(workDir, 'specs', '001-evolution-spec-j5g9.md'), '# Agent forged spec\n', 'utf8');
      await writeFile(path.join(workDir, 'spec.md'), '# Project: Sushi Kitties\n\n# Evolution Spec\n\n# Agent forged spec\n', 'utf8');
      return agentResult({
        filesChanged: [
          'spec.md',
          'specs/001-evolution-spec-j5g9.md',
        ],
      });
    }),
  });

  assert.equal(result.status, 'observed');
  assert.deepEqual(result.sourceEvidence.runnerMaterializedSpecInputFiles, []);
  assert.deepEqual(result.executorOutput.summary.forbiddenChangedFiles, [
    'spec.md',
    'specs/001-evolution-spec-j5g9.md',
  ]);
  assert.equal(result.mutationOutcome.status, 'forbidden_mutation');
  assert.equal(result.mutationOutcome.error?.code, 'forbidden_mutation');
});

test('executor action core keeps forged materialized spec edits forbidden during resumed WIP task', async () => {
  const workDir = await createGitWorkspace();
  await writeFile(path.join(workDir, '.gitignore'), '.arena/\n', 'utf8');
  await writeMaterializedSpecInput(workDir, {
    projectTitle: 'Sushi Kitties',
    id: 'cmo96pzw305035hmwhzpyj5g9',
    slug: 'Evolution Spec',
    content: '# Old accepted spec\n',
  });
  await git(workDir, 'add', '.gitignore', 'spec.md', 'specs');
  await git(workDir, 'commit', '-m', 'record materialized specs');
  const headBefore = await git(workDir, 'rev-parse', 'HEAD');
  await writeFile(path.join(workDir, 'src', 'components', 'SynthPad.tsx'), 'export const SynthPad = () => "partial";\n', 'utf8');

  const result = await runExecutorActionCore({
    ...baseCoreInput({ workDir, headBefore }),
    changedFilesSourceLabel: 'Continuation workspace diff',
    sourceMode: {
      kind: 'post_call_status',
      preAgentPolicy: 'caller_validated',
    },
    agent: testAgent(async () => {
      await writeFile(path.join(workDir, 'specs', '001-evolution-spec-j5g9.md'), '# Agent forged spec\n', 'utf8');
      await writeFile(path.join(workDir, 'spec.md'), '# Project: Sushi Kitties\n\n# Evolution Spec\n\n# Agent forged spec\n', 'utf8');
      return agentResult({
        filesChanged: [
          'spec.md',
          'specs/001-evolution-spec-j5g9.md',
        ],
      });
    }),
  });

  assert.equal(result.status, 'observed');
  assert.deepEqual(result.sourceEvidence.runnerMaterializedSpecInputFiles, []);
  assert.deepEqual(result.executorOutput.summary.forbiddenChangedFiles, [
    'spec.md',
    'specs/001-evolution-spec-j5g9.md',
  ]);
  assert.equal(result.mutationOutcome.status, 'forbidden_mutation');
  assert.equal(result.mutationOutcome.error?.code, 'forbidden_mutation');
});

test('executor action core fails closed when post-call source evidence is unavailable', async () => {
  const workDir = await createGitWorkspace();
  const headBefore = await git(workDir, 'rev-parse', 'HEAD');

  const result = await runExecutorActionCore({
    ...baseCoreInput({ workDir, headBefore }),
    agent: testAgent(async () => {
      await rm(path.join(workDir, '.git'), { recursive: true, force: true });
      return agentResult({
        filesChanged: ['declared-but-untrusted.ts'],
      });
    }),
  });

  assert.equal(result.status, 'source_evidence_unavailable_after_agent');
  assert.equal(result.error.code, 'post_git_status_unavailable');
  assert.deepEqual(result.sourceEvidence.changedFilesForObserver, []);
});

async function createGitWorkspace(): Promise<string> {
  const workDir = await mkdtemp(path.join(os.tmpdir(), 'executor-action-core-src-'));
  await mkdir(path.join(workDir, 'src', 'components'), { recursive: true });
  await mkdir(path.join(workDir, '.ralph'), { recursive: true });
  await writeFile(path.join(workDir, 'src', 'components', 'SynthPad.tsx'), 'export const SynthPad = () => "idle";\n', 'utf8');
  await writeFile(path.join(workDir, '.ralph', 'plan.json'), '{"status":"pending"}\n', 'utf8');
  await git(workDir, 'init');
  await git(workDir, 'config', 'user.email', 'test@example.com');
  await git(workDir, 'config', 'user.name', 'Test User');
  await git(workDir, 'add', '.');
  await git(workDir, 'commit', '-m', 'initial');
  return workDir;
}

async function writeMaterializedSpecInput(workDir: string, input: {
  projectTitle: string;
  id: string;
  slug: string;
  content: string;
}): Promise<void> {
  const slug = input.slug
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 50);
  const specPath = `specs/001-${slug}-${input.id.slice(-4)}.md`;

  await mkdir(path.join(workDir, 'specs'), { recursive: true });
  await mkdir(path.join(workDir, '.arena'), { recursive: true });
  await writeFile(path.join(workDir, 'specs', '000-project.md'), `# Project: ${input.projectTitle}\n`, 'utf8');
  await writeFile(path.join(workDir, specPath), input.content, 'utf8');
  await writeFile(
    path.join(workDir, 'spec.md'),
    `# Project: ${input.projectTitle}\n\n# ${input.slug}\n\n${input.content}`,
    'utf8',
  );
  await writeFile(
    path.join(workDir, '.arena', 'spec-input.json'),
    `${JSON.stringify({
      schemaVersion: 1,
      aggregateHash: md5(md5(input.content)),
      specs: [{
        id: input.id,
        slug: input.slug,
        hash: md5(input.content),
      }],
    }, null, 2)}\n`,
    'utf8',
  );
}

function md5(value: string): string {
  return createHash('md5').update(value).digest('hex');
}

function baseCoreInput(input: {
  workDir: string;
  headBefore: string;
}) {
  return {
    stageId: 'executor_action_core_test',
    task: taskFixture(),
    workDir: input.workDir,
    prompt: {
      kind: 'fixture' as const,
      fixture: promptFixture(),
    },
    agent: testAgent(async () => agentResult()),
    agentCall: {
      model: null,
      timeoutMinutes: null,
      verbose: false,
      providerSessionResumeId: null,
    },
    completionPromise: 'TASK_COMPLETE',
    visualEvidenceMode: 'required' as const,
    expectedVisualWorkbenchStoryIds: ['synth-pad.playing'],
    changedFilesSourceLabel: 'Workspace diff' as const,
    classificationOptions: {
      allowTaskWorkspaceFiles: false,
    },
    sourceMode: {
      kind: 'post_call_delta' as const,
      preAgentPolicy: 'require_clean_workspace' as const,
    },
    agentFailureMessage: 'Executor stage agent failed.',
    headBefore: input.headBefore,
  };
}

function taskFixture(): Task {
  return {
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
  };
}

function promptFixture(): ExecutorAgentPromptFixture {
  return {
    schemaVersion: PROMPT_LAB_FIXTURE_SCHEMA_VERSION,
    promptId: 'executor.agentPrompt',
    name: 'core-test-executor-prompt',
    input: {
      contextSections: [
        '# Current Task',
        'Task task-001: Add synth pad story.',
        '',
        '# Completion Signal',
        'When complete, output <promise>TASK_COMPLETE</promise>.',
      ].join('\n'),
    },
  };
}

function testAgent(execute: (options: AgentOptions) => Promise<AgentResult>) {
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
  return 'Implemented the requested visual workbench story.\n<promise>TASK_COMPLETE</promise>';
}

async function git(cwd: string, ...args: string[]): Promise<string> {
  const result = await execa('git', args, { cwd });
  return result.stdout.trim();
}
