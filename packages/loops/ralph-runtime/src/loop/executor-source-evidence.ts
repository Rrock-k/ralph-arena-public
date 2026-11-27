import { execFile } from 'node:child_process';
import { realpath } from 'node:fs/promises';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import {
  classifyExecutorChangedFiles,
  normalizeExecutorChangedFiles,
  parseExecutorGitStatusChangedFiles,
} from './executor-observer.js';

const execFileAsync = promisify(execFile);

export const EXECUTOR_SOURCE_EVIDENCE_OWNER_BOUNDARY = 'ralph.executor-source-evidence' as const;

export type ExecutorSourceChangeEvidence = {
  ownerBoundary: typeof EXECUTOR_SOURCE_EVIDENCE_OWNER_BOUNDARY;
  beforeGitStatus: string[];
  afterGitStatus: string[];
  preExistingChangedFiles: string[];
  changedFiles: string[];
  changedFilesSourceLabel: 'Workspace diff';
};

export type ExecutorPreAgentSourceEvidenceCheck = {
  ownerBoundary: typeof EXECUTOR_SOURCE_EVIDENCE_OWNER_BOUNDARY;
  beforeGitStatus: string[];
  allowedPreExistingChangedFiles: string[];
  ambiguousPreExistingChangedFiles: string[];
  errorMessage: string | null;
};

export type ExecutorSourceRefResolution = {
  resolvedSourceRef: string | null;
  headRef: string | null;
  error: null | {
    code: 'source_ref_unavailable' | 'source_ref_mismatch';
    message: string;
  };
};

export async function readExecutorGitStatusLines(workDir: string): Promise<string[] | null> {
  const raw = await readExecutorGitRawValue(workDir, ['status', '--porcelain', '-uall']);
  if (raw == null) return null;
  return raw.split('\n').filter(Boolean);
}

export async function readExecutorGitValue(workDir: string, args: string[]): Promise<string | null> {
  const raw = await readExecutorGitRawValue(workDir, args);
  return raw?.trim() || null;
}

export async function resolveExecutorSourceRefAtHead(input: {
  workDir: string;
  sourceRef: string;
  stageId: string;
}): Promise<ExecutorSourceRefResolution> {
  const gitRoot = await readExecutorGitValue(input.workDir, ['rev-parse', '--show-toplevel']);
  const resolvedSourceRef = await readExecutorGitValue(input.workDir, ['rev-parse', input.sourceRef]);
  const headRef = await readExecutorGitValue(input.workDir, ['rev-parse', 'HEAD']);
  if (!gitRoot || !resolvedSourceRef || !headRef) {
    return {
      resolvedSourceRef,
      headRef,
      error: {
        code: 'source_ref_unavailable',
        message: `${input.stageId} requires a git workspace and a resolvable explicit sourceRef.`,
      },
    };
  }
  const realGitRoot = await realpath(resolve(gitRoot));
  const realWorkDir = await realpath(resolve(input.workDir));
  if (realGitRoot !== realWorkDir) {
    return {
      resolvedSourceRef,
      headRef,
      error: {
        code: 'source_ref_unavailable',
        message: `${input.stageId} workDir must be the git workspace root.`,
      },
    };
  }
  if (resolvedSourceRef !== headRef) {
    return {
      resolvedSourceRef,
      headRef,
      error: {
        code: 'source_ref_mismatch',
        message: `${input.stageId} sourceRef ${resolvedSourceRef} does not match current workspace HEAD ${headRef}.`,
      },
    };
  }
  return { resolvedSourceRef, headRef, error: null };
}

export function sameExecutorChangedFileSet(first: string[], second: string[]): boolean {
  const normalizedFirst = [...new Set(first)].sort();
  const normalizedSecond = [...new Set(second)].sort();
  return normalizedFirst.length === normalizedSecond.length
    && normalizedFirst.every((value, index) => value === normalizedSecond[index]);
}

async function readExecutorGitRawValue(workDir: string, args: string[]): Promise<string | null> {
  try {
    const result = await execFileAsync('git', args, {
      cwd: workDir,
      timeout: 10_000,
      maxBuffer: 1024 * 1024,
    });
    return result.stdout;
  } catch {
    return null;
  }
}

export function buildExecutorSourceChangeEvidence(input: {
  beforeGitStatus: string[];
  afterGitStatus: string[];
  label: string;
}): ExecutorSourceChangeEvidence {
  const beforeStatusLineKeys = new Set(input.beforeGitStatus.map(normalizeGitStatusLineKey));
  const changedStatusLines = input.afterGitStatus.filter((line) => (
    !beforeStatusLineKeys.has(normalizeGitStatusLineKey(line))
  ));
  const preExistingChangedFiles = normalizeExecutorChangedFiles(
    parseExecutorGitStatusChangedFiles(input.beforeGitStatus),
    `${input.label} pre-existing git status changed files`,
  );
  const changedFiles = normalizeExecutorChangedFiles(
    parseExecutorGitStatusChangedFiles(changedStatusLines),
    `${input.label} git status changed files`,
  );

  return {
    ownerBoundary: EXECUTOR_SOURCE_EVIDENCE_OWNER_BOUNDARY,
    beforeGitStatus: input.beforeGitStatus,
    afterGitStatus: input.afterGitStatus,
    preExistingChangedFiles,
    changedFiles,
    changedFilesSourceLabel: 'Workspace diff',
  };
}

export function checkExecutorPreAgentSourceEvidence(input: {
  beforeGitStatus: string[];
  taskId: string;
  stageId: string;
  label: string;
  allowedLoopOwnedPreExistingChangedFiles?: string[];
}): ExecutorPreAgentSourceEvidenceCheck {
  const beforeChangedFiles = normalizeExecutorChangedFiles(
    parseExecutorGitStatusChangedFiles(input.beforeGitStatus),
    `${input.label} pre-agent git status changed files`,
  );
  const allowedLoopOwned = new Set(normalizeExecutorChangedFiles(
    input.allowedLoopOwnedPreExistingChangedFiles ?? [],
    `${input.label} allowed loop-owned pre-agent changed files`,
  ));
  const beforeChanged = new Set(beforeChangedFiles);
  const classified = classifyExecutorChangedFiles(beforeChangedFiles, input.taskId);
  const allowedLoopOwnedPreExistingChangedFiles = [...allowedLoopOwned]
    .filter((file) => beforeChanged.has(file))
    .sort();
  const ambiguousPreExistingChangedFiles = Array.from(new Set([
    ...classified.changedProductFiles,
    ...classified.forbiddenChangedFiles.filter((file) => !allowedLoopOwned.has(file)),
    ...classified.adHocProofLikeFiles,
  ])).sort();
  const allowedPreExistingChangedFiles = [
    ...classified.changedTaskWorkspaceFiles,
    ...allowedLoopOwnedPreExistingChangedFiles,
  ].sort();
  const errorMessage = ambiguousPreExistingChangedFiles.length > 0
    ? `${input.stageId} requires clean source evidence before executor agent call; pre-existing changed files are ambiguous: ${ambiguousPreExistingChangedFiles.join(', ')}.`
    : null;

  return {
    ownerBoundary: EXECUTOR_SOURCE_EVIDENCE_OWNER_BOUNDARY,
    beforeGitStatus: input.beforeGitStatus,
    allowedPreExistingChangedFiles,
    ambiguousPreExistingChangedFiles,
    errorMessage,
  };
}

function normalizeGitStatusLineKey(line: string): string {
  return line.trimEnd();
}
