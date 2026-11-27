import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { realpathSync, writeFileSync } from 'node:fs';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  buildExecutorSourceChangeEvidence,
  checkExecutorPreAgentSourceEvidence,
  readExecutorGitStatusLines,
  readExecutorGitValue,
  resolveExecutorSourceRefAtHead,
  sameExecutorChangedFileSet,
} from './executor-source-evidence.js';

test('executor source evidence reads git status and values through one helper boundary', async () => {
  const workDir = await mkdtemp(path.join(tmpdir(), 'ralph-executor-source-evidence-git-'));
  execFileSync('git', ['init'], { cwd: workDir });
  writeFileSync(path.join(workDir, 'src.ts'), 'export const value = 1;\n');

  assert.equal(await readExecutorGitValue(workDir, ['rev-parse', '--show-toplevel']), realpathSync(workDir));
  assert.deepEqual(await readExecutorGitStatusLines(workDir), [
    '?? src.ts',
  ]);
});

test('executor source evidence returns null when git evidence is unavailable', async () => {
  const workDir = await mkdtemp(path.join(tmpdir(), 'ralph-executor-source-evidence-non-git-'));

  assert.equal(await readExecutorGitValue(workDir, ['rev-parse', 'HEAD']), null);
  assert.equal(await readExecutorGitStatusLines(workDir), null);
});

test('executor source evidence validates explicit source ref at workspace head', async () => {
  const workDir = await mkdtemp(path.join(tmpdir(), 'ralph-executor-source-evidence-source-ref-'));
  execFileSync('git', ['init'], { cwd: workDir });
  writeFileSync(path.join(workDir, 'src.ts'), 'export const value = 1;\n');
  execFileSync('git', ['add', 'src.ts'], { cwd: workDir });
  execFileSync('git', ['-c', 'user.email=test@example.com', '-c', 'user.name=Test', 'commit', '-m', 'initial'], {
    cwd: workDir,
  });
  const initialHead = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: workDir, encoding: 'utf8' }).trim();

  assert.deepEqual(await resolveExecutorSourceRefAtHead({
    workDir,
    sourceRef: initialHead,
    stageId: 'executor_task_workspace',
  }), {
    resolvedSourceRef: initialHead,
    headRef: initialHead,
    error: null,
  });

  writeFileSync(path.join(workDir, 'src.ts'), 'export const value = 2;\n');
  execFileSync('git', ['add', 'src.ts'], { cwd: workDir });
  execFileSync('git', ['-c', 'user.email=test@example.com', '-c', 'user.name=Test', 'commit', '-m', 'second'], {
    cwd: workDir,
  });
  const secondHead = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: workDir, encoding: 'utf8' }).trim();

  const mismatch = await resolveExecutorSourceRefAtHead({
    workDir,
    sourceRef: initialHead,
    stageId: 'executor_task_workspace',
  });
  assert.equal(mismatch.resolvedSourceRef, initialHead);
  assert.equal(mismatch.headRef, secondHead);
  assert.equal(mismatch.error?.code, 'source_ref_mismatch');
});

test('executor source evidence requires the explicit work dir to be the git root', async () => {
  const workDir = await mkdtemp(path.join(tmpdir(), 'ralph-executor-source-evidence-git-root-'));
  execFileSync('git', ['init'], { cwd: workDir });
  writeFileSync(path.join(workDir, 'src.ts'), 'export const value = 1;\n');
  execFileSync('git', ['add', 'src.ts'], { cwd: workDir });
  execFileSync('git', ['-c', 'user.email=test@example.com', '-c', 'user.name=Test', 'commit', '-m', 'initial'], {
    cwd: workDir,
  });
  const nestedDir = path.join(workDir, 'src');
  await mkdir(nestedDir);

  const result = await resolveExecutorSourceRefAtHead({
    workDir: nestedDir,
    sourceRef: 'HEAD',
    stageId: 'executor_task_workspace',
  });

  assert.equal(result.error?.code, 'source_ref_unavailable');
  assert.match(result.error?.message ?? '', /workDir must be the git workspace root/);
});

test('executor source evidence compares changed files as a normalized set', () => {
  assert.equal(sameExecutorChangedFileSet([
    'src/App.tsx',
    'src/App.tsx',
    'visual-workbench/stories/app.tsx',
  ], [
    'visual-workbench/stories/app.tsx',
    'src/App.tsx',
  ]), true);
  assert.equal(sameExecutorChangedFileSet(['src/App.tsx'], ['src/App.tsx', 'src/Page.tsx']), false);
});

test('executor source evidence reports only post-agent workspace delta', () => {
  const evidence = buildExecutorSourceChangeEvidence({
    beforeGitStatus: [
      '?? .ralph/tasks/task-001/plan.md',
    ],
    afterGitStatus: [
      '?? .ralph/tasks/task-001/plan.md',
      ' M src/App.tsx',
      '?? visual-workbench/stories/synth-pad.tsx',
    ],
    label: 'LoopExecutor.executeIteration',
  });

  assert.equal(evidence.ownerBoundary, 'ralph.executor-source-evidence');
  assert.equal(evidence.changedFilesSourceLabel, 'Workspace diff');
  assert.deepEqual(evidence.preExistingChangedFiles, [
    '.ralph/tasks/task-001/plan.md',
  ]);
  assert.deepEqual(evidence.changedFiles, [
    'src/App.tsx',
    'visual-workbench/stories/synth-pad.tsx',
  ]);
});

test('executor source evidence includes paths whose git status line changed', () => {
  const evidence = buildExecutorSourceChangeEvidence({
    beforeGitStatus: [
      ' M src/App.tsx',
    ],
    afterGitStatus: [
      'MM src/App.tsx',
    ],
    label: 'LoopExecutor.executeIteration',
  });

  assert.deepEqual(evidence.changedFiles, [
    'src/App.tsx',
  ]);
});

test('executor pre-agent source evidence allows only current task workspace dirtiness', () => {
  const check = checkExecutorPreAgentSourceEvidence({
    beforeGitStatus: [
      '?? .ralph/tasks/task-001/plan.md',
    ],
    taskId: 'task-001',
    stageId: 'LoopExecutor.executeIteration',
    label: 'LoopExecutor.executeIteration',
  });

  assert.equal(check.ownerBoundary, 'ralph.executor-source-evidence');
  assert.deepEqual(check.allowedPreExistingChangedFiles, [
    '.ralph/tasks/task-001/plan.md',
  ]);
  assert.deepEqual(check.ambiguousPreExistingChangedFiles, []);
  assert.equal(check.errorMessage, null);
});

test('executor pre-agent source evidence allows explicit loop-owned dirty files', () => {
  const check = checkExecutorPreAgentSourceEvidence({
    beforeGitStatus: [
      ' M .ralph/plan.json',
    ],
    taskId: 'task-001',
    stageId: 'LoopExecutor.executeIteration',
    label: 'LoopExecutor.executeIteration',
    allowedLoopOwnedPreExistingChangedFiles: ['.ralph/plan.json'],
  });

  assert.deepEqual(check.allowedPreExistingChangedFiles, [
    '.ralph/plan.json',
  ]);
  assert.deepEqual(check.ambiguousPreExistingChangedFiles, []);
  assert.equal(check.errorMessage, null);
});

test('executor pre-agent source evidence blocks dirty product or other-task files', () => {
  const check = checkExecutorPreAgentSourceEvidence({
    beforeGitStatus: [
      ' M src/App.tsx',
      '?? .ralph/tasks/other-task/plan.md',
    ],
    taskId: 'task-001',
    stageId: 'LoopExecutor.executeIteration',
    label: 'LoopExecutor.executeIteration',
  });

  assert.deepEqual(check.allowedPreExistingChangedFiles, []);
  assert.deepEqual(check.ambiguousPreExistingChangedFiles, [
    '.ralph/tasks/other-task/plan.md',
    'src/App.tsx',
  ]);
  assert.match(check.errorMessage ?? '', /pre-existing changed files are ambiguous/);
});
