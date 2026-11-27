import type { Task } from '../config/types.js';
import { GitManager, type CommitResult } from '../git/manager.js';
import { parseExecutorGitStatusChangedFiles } from './executor-observer.js';
import {
  readExecutorGitStatusLines as gitStatus,
  readExecutorGitValue as gitValue,
  sameExecutorChangedFileSet,
} from './executor-source-evidence.js';

type CommitTask = Pick<Task, 'id' | 'description' | 'displayTitle'>;

export type ExecutorSourceCommitMessage = {
  ownerBoundary: 'ralph.executor-source-commit';
  subject: string;
  body: string;
  message: string;
};

export type ExecutorLiveWorkspaceSourceCommitResult = {
  status: 'not_attempted' | 'skipped_no_changes' | 'committed' | 'blocked';
  subject: string | null;
  body: string | null;
  beforeCommit: string | null;
  afterCommit: string | null;
  changedFiles: string[];
  afterGitStatus: string[] | null;
  error: null | {
    code: 'workspace_not_completed' | 'no_changes' | 'head_mismatch' | 'git_status_unavailable' | 'git_status_mismatch' | 'git_policy_no_changes' | 'git_commit_failed';
    message: string;
  };
};

export function buildExecutorTaskIterationCommitMessage(input: {
  task: CommitTask | null | undefined;
  iteration: number;
  verificationPassed: boolean;
}): ExecutorSourceCommitMessage {
  return buildExecutorSourceCommitMessage({
    task: input.task,
    fallbackTitle: 'Progress update',
    bodyLines: [
      'stage: LoopExecutor.executeIteration',
      'action: executor',
      input.task ? `taskId: ${input.task.id}` : null,
      `iteration: ${input.iteration}`,
      `verification: ${input.verificationPassed ? 'passed' : 'failed'}`,
      '[ralph-runtime]',
    ],
  });
}

export async function commitExecutorTaskIterationSourceChanges(input: {
  git: Pick<GitManager, 'commit'>;
  task: CommitTask | null | undefined;
  iteration: number;
  verificationPassed: boolean;
}): Promise<CommitResult> {
  const commitMessage = buildExecutorTaskIterationCommitMessage({
    task: input.task,
    iteration: input.iteration,
    verificationPassed: input.verificationPassed,
  });

  return input.git.commit(commitMessage.message);
}

export function buildExecutorProjectTaskLiveWorkspaceCommitMessage(input: {
  task: CommitTask;
  mode: string;
  beforeCommit: string;
  reportPath: string;
  delegatedWorkspaceReportPath: string;
}): ExecutorSourceCommitMessage {
  return buildExecutorSourceCommitMessage({
    task: input.task,
    fallbackTitle: 'Execute task',
    bodyLines: [
      'stage: executor_project_task',
      'action: executor',
      `taskId: ${input.task.id}`,
      `mode: ${input.mode}`,
      'workspaceMode: live_workspace_action',
      `beforeCommit: ${input.beforeCommit}`,
      `reportPath: ${input.reportPath}`,
      `delegatedWorkspaceReportPath: ${input.delegatedWorkspaceReportPath}`,
      '',
      'This local project commit is source evidence for a manual Lab action.',
      'It is not task completion, lifecycle truth, proof truth, controller approval or remote publication.',
    ],
  });
}

export function buildExecutorVisualWorkbenchEvidenceCommitMessage(input: {
  task: CommitTask | null | undefined;
  taskId: string;
  sourceRef: string;
  status: string;
  reportPath: string;
  diagnosticReportPath: string | null | undefined;
  evidenceRefs: number;
  publishedRows: number | null | undefined;
}): ExecutorSourceCommitMessage {
  const task = input.task ?? {
    id: input.taskId,
    description: 'Visual Workbench evidence',
  };
  return buildExecutorSourceCommitMessage({
    task,
    fallbackTitle: 'Visual Workbench evidence',
    bodyLines: [
      'stage: LoopExecutor.runPostTaskVisualWorkbenchEvidenceAutomation',
      'action: visual_workbench_evidence',
      `taskId: ${input.taskId}`,
      `sourceRef: ${input.sourceRef}`,
      `status: ${input.status}`,
      `reportPath: ${input.reportPath}`,
      input.diagnosticReportPath ? `diagnosticReportPath: ${input.diagnosticReportPath}` : null,
      `evidenceRefs: ${input.evidenceRefs}`,
      `publishedRows: ${input.publishedRows ?? 0}`,
      '[ralph-runtime]',
    ],
  });
}

export async function commitExecutorLiveWorkspaceSourceChanges(input: {
  workDir: string;
  task: CommitTask;
  mode: string;
  beforeCommit: string;
  workspaceStatus: string;
  changedFiles: string[];
  reportPath: string;
  delegatedWorkspaceReportPath: string;
}): Promise<ExecutorLiveWorkspaceSourceCommitResult> {
  const commitMessage = buildExecutorProjectTaskLiveWorkspaceCommitMessage({
    task: input.task,
    mode: input.mode,
    beforeCommit: input.beforeCommit,
    reportPath: input.reportPath,
    delegatedWorkspaceReportPath: input.delegatedWorkspaceReportPath,
  });
  const base = {
    subject: commitMessage.subject,
    body: commitMessage.body,
    beforeCommit: input.beforeCommit,
    afterCommit: null,
    changedFiles: input.changedFiles,
    afterGitStatus: null,
  };

  if (input.workspaceStatus !== 'completed') {
    return {
      ...base,
      status: 'not_attempted',
      error: {
        code: 'workspace_not_completed',
        message: `Live workspace project commit requires completed executor result; got ${input.workspaceStatus}.`,
      },
    };
  }
  if (input.changedFiles.length === 0) {
    return {
      ...base,
      status: 'skipped_no_changes',
      error: {
        code: 'no_changes',
        message: 'Live workspace project commit skipped because the executor result changed no files.',
      },
    };
  }

  const currentHead = await gitValue(input.workDir, ['rev-parse', 'HEAD']);
  if (!currentHead || currentHead !== input.beforeCommit) {
    return {
      ...base,
      status: 'blocked',
      afterCommit: currentHead,
      error: {
        code: 'head_mismatch',
        message: `Live workspace project commit requires HEAD to remain at beforeCommit ${input.beforeCommit}; got ${currentHead ?? 'unavailable'}.`,
      },
    };
  }

  const beforeStatus = await gitStatus(input.workDir);
  if (beforeStatus == null) {
    return {
      ...base,
      status: 'blocked',
      error: {
        code: 'git_status_unavailable',
        message: 'Live workspace project commit requires git status evidence before committing.',
      },
    };
  }
  const currentChangedFiles = parseExecutorGitStatusChangedFiles(beforeStatus).sort();
  if (!sameExecutorChangedFileSet(currentChangedFiles, input.changedFiles)) {
    return {
      ...base,
      status: 'blocked',
      afterGitStatus: beforeStatus,
      error: {
        code: 'git_status_mismatch',
        message: `Live workspace project commit refuses to stage changes that differ from the classified executor diff. expected=${input.changedFiles.join(', ') || 'none'} current=${currentChangedFiles.join(', ') || 'none'}.`,
      },
    };
  }

  const commitResult = await new GitManager(input.workDir).commit(commitMessage.message);
  if (!commitResult.success) {
    return {
      ...base,
      status: 'blocked',
      afterGitStatus: await gitStatus(input.workDir),
      error: {
        code: 'git_commit_failed',
        message: commitResult.error ?? 'Shared source commit policy failed to create a project commit.',
      },
    };
  }
  if (commitResult.hash === 'no-changes') {
    return {
      ...base,
      status: 'blocked',
      afterGitStatus: await gitStatus(input.workDir),
      error: {
        code: 'git_policy_no_changes',
        message: 'Shared source commit policy staged no acceptable source changes after applying excluded/protected path rules.',
      },
    };
  }

  const afterCommit = await gitValue(input.workDir, ['rev-parse', 'HEAD']);
  return {
    ...base,
    status: 'committed',
    afterCommit,
    afterGitStatus: await gitStatus(input.workDir),
    error: null,
  };
}

function buildExecutorSourceCommitMessage(input: {
  task: CommitTask | null | undefined;
  fallbackTitle: string;
  bodyLines: Array<string | null | undefined>;
}): ExecutorSourceCommitMessage {
  const title = firstCleanLine(
    input.task?.displayTitle
      ?? input.task?.description
      ?? input.fallbackTitle,
  );
  const taskScope = input.task?.id?.trim() ? ` ${input.task.id.trim()}` : '';
  const subject = truncateCommitSubject(`executor${taskScope}: ${title}`);
  const body = input.bodyLines
    .filter((line): line is string => line !== null && line !== undefined)
    .join('\n');

  return {
    ownerBoundary: 'ralph.executor-source-commit',
    subject,
    body,
    message: body ? `${subject}\n\n${body}` : subject,
  };
}

function firstCleanLine(value: string): string {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean) ?? 'Execute task';
}

function truncateCommitSubject(value: string): string {
  return value.length <= 96 ? value : `${value.slice(0, 93).trimEnd()}...`;
}
