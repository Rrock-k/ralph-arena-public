import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { execa } from 'execa';
import { GitManager } from '../git/manager.js';
import {
  buildExecutorProjectTaskLiveWorkspaceCommitMessage,
  buildExecutorTaskIterationCommitMessage,
  buildExecutorVisualWorkbenchEvidenceCommitMessage,
  commitExecutorTaskIterationSourceChanges,
  commitExecutorLiveWorkspaceSourceChanges,
} from './executor-source-commit.js';

test('buildExecutorTaskIterationCommitMessage identifies production executor task work', () => {
  const message = buildExecutorTaskIterationCommitMessage({
    task: {
      id: 'task-123',
      description: 'Add empty state to synth pad. Extra details follow.',
    },
    iteration: 7,
    verificationPassed: true,
  });

  assert.equal(message.ownerBoundary, 'ralph.executor-source-commit');
  assert.equal(message.subject, 'executor task-123: Add empty state to synth pad. Extra details follow.');
  assert.match(message.body, /stage: LoopExecutor\.executeIteration/);
  assert.match(message.body, /taskId: task-123/);
  assert.match(message.body, /iteration: 7/);
  assert.match(message.body, /verification: passed/);
  assert.match(message.message, /^executor task-123: Add empty state to synth pad/m);
});

test('buildExecutorProjectTaskLiveWorkspaceCommitMessage shares Lab executor commit identity', () => {
  const message = buildExecutorProjectTaskLiveWorkspaceCommitMessage({
    task: {
      id: 'task-456',
      description: 'Fallback description',
      displayTitle: 'Add shared jam transport controls',
    },
    mode: 'new_task',
    beforeCommit: 'abc123',
    reportPath: '/private/tmp/report.json',
    delegatedWorkspaceReportPath: '/private/tmp/workspace.json',
  });

  assert.equal(message.ownerBoundary, 'ralph.executor-source-commit');
  assert.equal(message.subject, 'executor task-456: Add shared jam transport controls');
  assert.match(message.body, /stage: executor_project_task/);
  assert.match(message.body, /workspaceMode: live_workspace_action/);
  assert.match(message.body, /beforeCommit: abc123/);
  assert.doesNotMatch(message.subject, /RA-356/);
  assert.doesNotMatch(message.body, /RA-356/);
});

test('buildExecutorVisualWorkbenchEvidenceCommitMessage identifies task-linked screenshot evidence', () => {
  const message = buildExecutorVisualWorkbenchEvidenceCommitMessage({
    task: {
      id: 'task-047',
      description: 'Build mixer strip',
    },
    taskId: 'task-047',
    sourceRef: 'abc123',
    status: 'published',
    reportPath: '/private/tmp/visual-workbench-automation-run.json',
    diagnosticReportPath: '/workspace/.ralph/visual-workbench/automation-runs/task-047/latest.json',
    evidenceRefs: 2,
    publishedRows: 2,
  });

  assert.equal(message.ownerBoundary, 'ralph.executor-source-commit');
  assert.equal(message.subject, 'executor task-047: Build mixer strip');
  assert.match(message.body, /stage: LoopExecutor\.runPostTaskVisualWorkbenchEvidenceAutomation/);
  assert.match(message.body, /action: visual_workbench_evidence/);
  assert.match(message.body, /taskId: task-047/);
  assert.match(message.body, /sourceRef: abc123/);
  assert.match(message.body, /evidenceRefs: 2/);
  assert.match(message.body, /publishedRows: 2/);
  assert.doesNotMatch(message.subject, /RA-356/);
  assert.doesNotMatch(message.body, /RA-356/);
});

test('commitExecutorTaskIterationSourceChanges commits through production source owner', async () => {
  const messages: string[] = [];
  const result = await commitExecutorTaskIterationSourceChanges({
    git: {
      async commit(message: string) {
        messages.push(message);
        return { success: true, hash: 'abc123' };
      },
    },
    task: {
      id: 'task-123',
      description: 'Add empty state to synth pad',
    },
    iteration: 3,
    verificationPassed: true,
  });

  assert.deepEqual(result, { success: true, hash: 'abc123' });
  assert.equal(messages.length, 1);
  assert.match(messages[0] ?? '', /^executor task-123: Add empty state to synth pad/m);
  assert.match(messages[0] ?? '', /stage: LoopExecutor\.executeIteration/);
  assert.match(messages[0] ?? '', /iteration: 3/);
  assert.match(messages[0] ?? '', /verification: passed/);
});

test('commitExecutorTaskIterationSourceChanges passes through GitManager no-changes result', async () => {
  const workDir = await createGitWorkspace();

  const result = await commitExecutorTaskIterationSourceChanges({
    git: new GitManager(workDir),
    task: {
      id: 'task-123',
      description: 'No-op task',
    },
    iteration: 1,
    verificationPassed: false,
  });

  assert.deepEqual(result, { success: true, hash: 'no-changes' });
});

test('commitExecutorLiveWorkspaceSourceChanges commits through shared git policy', async () => {
  const workDir = await createGitWorkspace();
  const beforeCommit = await git(workDir, 'rev-parse', 'HEAD');
  await writeFile(path.join(workDir, 'src', 'App.tsx'), 'export const app = "changed";\n', 'utf8');

  const result = await commitExecutorLiveWorkspaceSourceChanges({
    workDir,
    task: {
      id: 'task-789',
      description: 'Update app shell',
    },
    mode: 'new_task',
    beforeCommit,
    workspaceStatus: 'completed',
    changedFiles: ['src/App.tsx'],
    reportPath: '/private/tmp/executor-project-task-run.json',
    delegatedWorkspaceReportPath: '/private/tmp/executor-task-workspace-run.json',
  });

  const afterCommit = await git(workDir, 'rev-parse', 'HEAD');
  const subject = await git(workDir, 'log', '-1', '--format=%s');
  const status = await git(workDir, 'status', '--porcelain', '-uall');

  assert.equal(result.status, 'committed');
  assert.equal(result.beforeCommit, beforeCommit);
  assert.equal(result.afterCommit, afterCommit);
  assert.notEqual(afterCommit, beforeCommit);
  assert.equal(subject, 'executor task-789: Update app shell');
  assert.deepEqual(result.afterGitStatus, []);
  assert.equal(status, '');
});

test('commitExecutorLiveWorkspaceSourceChanges blocks status drift before staging', async () => {
  const workDir = await createGitWorkspace();
  const beforeCommit = await git(workDir, 'rev-parse', 'HEAD');
  await writeFile(path.join(workDir, 'src', 'App.tsx'), 'export const app = "changed";\n', 'utf8');

  const result = await commitExecutorLiveWorkspaceSourceChanges({
    workDir,
    task: {
      id: 'task-789',
      description: 'Update app shell',
    },
    mode: 'new_task',
    beforeCommit,
    workspaceStatus: 'completed',
    changedFiles: ['src/Other.tsx'],
    reportPath: '/private/tmp/executor-project-task-run.json',
    delegatedWorkspaceReportPath: '/private/tmp/executor-task-workspace-run.json',
  });

  const afterCommit = await git(workDir, 'rev-parse', 'HEAD');

  assert.equal(result.status, 'blocked');
  assert.equal(result.error?.code, 'git_status_mismatch');
  assert.equal(result.afterCommit, null);
  assert.equal(afterCommit, beforeCommit);
  assert.deepEqual(result.afterGitStatus, [' M src/App.tsx']);
});

async function createGitWorkspace(): Promise<string> {
  const workDir = await mkdtemp(path.join(os.tmpdir(), 'executor-source-commit-'));
  await mkdir(path.join(workDir, 'src'), { recursive: true });
  await writeFile(path.join(workDir, 'src', 'App.tsx'), 'export const app = "idle";\n', 'utf8');
  await git(workDir, 'init');
  await git(workDir, 'config', 'user.email', 'test@example.com');
  await git(workDir, 'config', 'user.name', 'Test User');
  await git(workDir, 'add', '.');
  await git(workDir, 'commit', '-m', 'initial');
  return workDir;
}

async function git(cwd: string, ...args: string[]): Promise<string> {
  const result = await execa('git', args, { cwd });
  return result.stdout.trim();
}
