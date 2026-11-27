import type { Agent } from '../agents/base.js';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { AgentResult, ExecutorActionReportOutput, Task, VisualEvidenceMode } from '../config/types.js';
import { renderPromptLabFixture } from '../prompts/prompt-lab.js';
import {
  buildExecutorActionReportOutput,
  observeExecutorAction,
  type ExecutorActionObservationResult,
} from './executor-action.js';
import {
  runExecutorAgentCall,
  type ExecutorAgentCallResult,
} from './executor-agent-call.js';
import {
  buildExecutorAgentPromptEnvelope,
  type ExecutorAgentPromptEnvelope,
  type ExecutorAgentPromptFixture,
} from './executor-prompt.js';
import {
  buildExecutorSourceChangeEvidence,
  checkExecutorPreAgentSourceEvidence,
  EXECUTOR_SOURCE_EVIDENCE_OWNER_BOUNDARY,
  readExecutorGitStatusLines,
  readExecutorGitValue,
} from './executor-source-evidence.js';
import {
  normalizeExecutorChangedFiles,
  parseExecutorGitStatusChangedFiles,
  type ExecutorChangedFileClassificationOptions,
  type ExecutorMutationOutcome,
} from './executor-observer.js';

export const EXECUTOR_ACTION_CORE_OWNER_BOUNDARY = 'ralph.executor-action-core' as const;

export type ExecutorActionCorePromptInput =
  | {
      kind: 'context_sections';
      name?: string;
      contextSections: string;
    }
  | {
      kind: 'fixture';
      fixture: ExecutorAgentPromptFixture;
    };

export type ExecutorActionCoreSourceMode =
  | {
      kind: 'post_call_delta';
      preAgentPolicy: 'require_clean_workspace' | 'allow_current_task_workspace_only';
    }
  | {
      kind: 'post_call_status';
      preAgentPolicy: 'caller_validated';
    };

export type ExecutorActionCoreSourceEvidence = {
  ownerBoundary: typeof EXECUTOR_SOURCE_EVIDENCE_OWNER_BOUNDARY;
  headBefore: string | null;
  headAfter: string | null;
  beforeGitStatus: string[] | null;
  afterGitStatus: string[] | null;
  preExistingChangedFiles: string[];
  changedFilesForObserver: string[];
  runnerMaterializedSpecInputFiles: string[];
  changedFilesSourceLabel: string;
};

export type ExecutorActionCoreInput = {
  stageId: string;
  task: Task;
  workDir: string;
  prompt: ExecutorActionCorePromptInput;
  agent: Pick<Agent, 'name' | 'execute'>;
  agentCall: {
    model?: string | null;
    timeoutMinutes?: number | null;
    verbose: boolean;
    providerSessionResumeId?: string | null;
  };
  completionPromise: string;
  visualEvidenceMode: VisualEvidenceMode;
  expectedVisualWorkbenchStoryIds?: string[];
  changedFilesSourceLabel: string;
  classificationOptions?: ExecutorChangedFileClassificationOptions;
  allowedLoopOwnedPreExistingChangedFiles?: string[];
  sourceMode: ExecutorActionCoreSourceMode;
  agentFailureMessage: string;
  headBefore?: string | null;
  readGitStatusLines?: () => Promise<string[] | null>;
  readHeadRef?: () => Promise<string | null>;
};

export type ExecutorActionCoreBlockedBeforeAgentResult = {
  ownerBoundary: typeof EXECUTOR_ACTION_CORE_OWNER_BOUNDARY;
  status: 'blocked_before_agent';
  promptEnvelope: ExecutorAgentPromptEnvelope;
  sourceEvidence: ExecutorActionCoreSourceEvidence;
  error: {
    code: 'pre_git_status_unavailable' | 'workspace_dirty';
    message: string;
  };
};

export type ExecutorActionCoreSourceEvidenceUnavailableAfterAgentResult = {
  ownerBoundary: typeof EXECUTOR_ACTION_CORE_OWNER_BOUNDARY;
  status: 'source_evidence_unavailable_after_agent';
  promptEnvelope: ExecutorAgentPromptEnvelope;
  agentCall: ExecutorAgentCallResult;
  agentResult: AgentResult;
  sourceEvidence: ExecutorActionCoreSourceEvidence;
  actionObservation: ExecutorActionObservationResult;
  mutationOutcome: ExecutorMutationOutcome;
  executorOutput: ExecutorActionReportOutput;
  error: {
    code: 'post_git_status_unavailable';
    message: string;
  };
};

export type ExecutorActionCoreObservedResult = {
  ownerBoundary: typeof EXECUTOR_ACTION_CORE_OWNER_BOUNDARY;
  status: 'observed';
  promptEnvelope: ExecutorAgentPromptEnvelope;
  agentCall: ExecutorAgentCallResult;
  agentResult: AgentResult;
  sourceEvidence: ExecutorActionCoreSourceEvidence;
  actionObservation: ExecutorActionObservationResult;
  mutationOutcome: ExecutorMutationOutcome;
  executorOutput: ExecutorActionReportOutput;
};

export type ExecutorActionCoreResult =
  | ExecutorActionCoreBlockedBeforeAgentResult
  | ExecutorActionCoreSourceEvidenceUnavailableAfterAgentResult
  | ExecutorActionCoreObservedResult;

export async function runExecutorActionCore(input: ExecutorActionCoreInput): Promise<ExecutorActionCoreResult> {
  const promptEnvelope = buildExecutorActionCorePromptEnvelope(input.prompt);
  const readStatus = input.readGitStatusLines ?? (() => readExecutorGitStatusLines(input.workDir));
  const readHead = input.readHeadRef ?? (() => readExecutorGitValue(input.workDir, ['rev-parse', 'HEAD']));
  const headBefore = input.headBefore ?? await readHead();
  const beforeGitStatus = await readStatus();
  const allowedLoopOwnedPreExistingChangedFiles = normalizeExecutorChangedFiles(
    input.allowedLoopOwnedPreExistingChangedFiles ?? [],
    `${input.stageId} allowed loop-owned pre-agent changed files`,
  );

  if (beforeGitStatus == null) {
    return {
      ownerBoundary: EXECUTOR_ACTION_CORE_OWNER_BOUNDARY,
      status: 'blocked_before_agent',
      promptEnvelope,
      sourceEvidence: emptySourceEvidence({
        headBefore,
        headAfter: headBefore,
        beforeGitStatus,
        afterGitStatus: null,
      }),
      error: {
        code: 'pre_git_status_unavailable',
        message: `${input.stageId} requires git status evidence before executor agent call; failing closed before provider execution.`,
      },
    };
  }

  const preAgentErrorMessage = getPreAgentErrorMessage({
    stageId: input.stageId,
    taskId: input.task.id,
    beforeGitStatus,
    preAgentPolicy: input.sourceMode.preAgentPolicy,
    allowedLoopOwnedPreExistingChangedFiles,
  });
  if (preAgentErrorMessage) {
    const preExistingChangedFiles = normalizeExecutorChangedFiles(
      parseExecutorGitStatusChangedFiles(beforeGitStatus),
      `${input.stageId} pre-agent git status changed files`,
    );
    return {
      ownerBoundary: EXECUTOR_ACTION_CORE_OWNER_BOUNDARY,
      status: 'blocked_before_agent',
      promptEnvelope,
      sourceEvidence: {
        ownerBoundary: EXECUTOR_SOURCE_EVIDENCE_OWNER_BOUNDARY,
        headBefore,
        headAfter: headBefore,
        beforeGitStatus,
        afterGitStatus: beforeGitStatus,
        preExistingChangedFiles,
        changedFilesForObserver: preExistingChangedFiles,
        runnerMaterializedSpecInputFiles: [],
        changedFilesSourceLabel: input.changedFilesSourceLabel,
      },
      error: {
        code: 'workspace_dirty',
        message: preAgentErrorMessage,
      },
    };
  }
  const allowedPreExistingLoopOwnedContents = await readPreExistingLoopOwnedFileContents({
    workDir: input.workDir,
    beforeGitStatus,
    allowedLoopOwnedPreExistingChangedFiles,
  });
  const beforeSpecInputManifestRaw = await readWorkspaceTextFile(input.workDir, '.arena/spec-input.json');

  const agentCall = await runExecutorAgentCall({
    agent: input.agent,
    workDir: input.workDir,
    prompt: promptEnvelope.prompt,
    completionPromise: input.completionPromise,
    model: input.agentCall.model ?? null,
    timeoutMinutes: input.agentCall.timeoutMinutes ?? null,
    verbose: input.agentCall.verbose,
    providerSessionResumeId: input.agentCall.providerSessionResumeId ?? null,
  });
  const agentResult = agentCall.result;
  const headAfter = await readHead();
  const afterGitStatus = await readStatus();

  if (afterGitStatus == null) {
    const errorMessage = `${input.stageId} requires git status evidence after executor agent call; failing closed.`;
    const actionObservation = observeExecutorAction({
      task: input.task,
      agentResult,
      filesChanged: [],
      completionPromise: input.completionPromise,
      visualEvidenceMode: input.visualEvidenceMode,
      completionPromiseFound: agentCall.completionPromiseFound,
      expectedVisualWorkbenchStoryIds: input.expectedVisualWorkbenchStoryIds ?? [],
      changedFilesSourceLabel: input.changedFilesSourceLabel,
      classificationOptions: input.classificationOptions,
      stageId: input.stageId,
      headChanged: headAfter !== headBefore,
      headBefore,
      headAfter,
      agentFailureMessage: input.agentFailureMessage,
      sourceEvidenceUnavailableMessage: agentResult.success ? errorMessage : undefined,
    });
    return {
      ownerBoundary: EXECUTOR_ACTION_CORE_OWNER_BOUNDARY,
      status: 'source_evidence_unavailable_after_agent',
      promptEnvelope,
      agentCall,
      agentResult,
      sourceEvidence: emptySourceEvidence({
        headBefore,
        headAfter,
        beforeGitStatus,
        afterGitStatus,
      }),
      actionObservation,
      mutationOutcome: actionObservation.mutationOutcome,
      executorOutput: buildExecutorActionReportOutput(actionObservation),
      error: {
        code: 'post_git_status_unavailable',
        message: errorMessage,
      },
    };
  }

  const sourceChangeEvidence = buildExecutorSourceChangeEvidence({
    beforeGitStatus,
    afterGitStatus,
    label: input.stageId,
  });
  const loopOwnedFilesChangedDuringAgent = await findLoopOwnedFilesChangedDuringAgent({
    workDir: input.workDir,
    beforeContents: allowedPreExistingLoopOwnedContents,
  });
  const allowedPreExistingLoopOwned = new Set(allowedLoopOwnedPreExistingChangedFiles);
  const rawChangedFilesForObserver = input.sourceMode.kind === 'post_call_status'
    ? normalizeExecutorChangedFiles(
      [
        ...parseExecutorGitStatusChangedFiles(afterGitStatus)
          .filter((file) => !allowedPreExistingLoopOwned.has(file)),
        ...loopOwnedFilesChangedDuringAgent,
      ],
      `${input.stageId} post-call git status changed files`,
    )
    : normalizeExecutorChangedFiles(
      [
        ...sourceChangeEvidence.changedFiles,
        ...loopOwnedFilesChangedDuringAgent,
      ],
      `${input.stageId} observed changed files`,
    );
  const runnerMaterializedSpecInputFiles = await findRunnerMaterializedSpecInputFilesChangedDuringAgent({
    workDir: input.workDir,
    beforeGitStatus,
    beforeSpecInputManifestRaw,
    changedFiles: rawChangedFilesForObserver,
  });
  const runnerMaterializedSpecInputFileSet = new Set(runnerMaterializedSpecInputFiles);
  const changedFilesForObserver = rawChangedFilesForObserver
    .filter((file) => !runnerMaterializedSpecInputFileSet.has(file));
  const sourceEvidence: ExecutorActionCoreSourceEvidence = {
    ownerBoundary: EXECUTOR_SOURCE_EVIDENCE_OWNER_BOUNDARY,
    headBefore,
    headAfter,
    beforeGitStatus,
    afterGitStatus,
    preExistingChangedFiles: sourceChangeEvidence.preExistingChangedFiles,
    changedFilesForObserver,
    runnerMaterializedSpecInputFiles,
    changedFilesSourceLabel: input.changedFilesSourceLabel,
  };
  const headChanged = headAfter !== headBefore;
  const actionObservation = observeExecutorAction({
    task: input.task,
    agentResult,
    filesChanged: changedFilesForObserver,
    completionPromise: input.completionPromise,
    visualEvidenceMode: input.visualEvidenceMode,
    completionPromiseFound: agentCall.completionPromiseFound,
    expectedVisualWorkbenchStoryIds: input.expectedVisualWorkbenchStoryIds ?? [],
    changedFilesSourceLabel: input.changedFilesSourceLabel,
    classificationOptions: input.classificationOptions,
    stageId: input.stageId,
    headChanged,
    headBefore,
    headAfter,
    agentFailureMessage: input.agentFailureMessage,
  });

  return {
    ownerBoundary: EXECUTOR_ACTION_CORE_OWNER_BOUNDARY,
    status: 'observed',
    promptEnvelope,
    agentCall,
    agentResult,
    sourceEvidence,
    actionObservation,
    mutationOutcome: actionObservation.mutationOutcome,
    executorOutput: buildExecutorActionReportOutput(actionObservation),
  };
}

function buildExecutorActionCorePromptEnvelope(input: ExecutorActionCorePromptInput): ExecutorAgentPromptEnvelope {
  if (input.kind === 'context_sections') {
    return buildExecutorAgentPromptEnvelope({
      name: input.name,
      contextSections: input.contextSections,
    });
  }

  const replay = renderPromptLabFixture({
    fixture: input.fixture,
    fixturePath: null,
  });
  return {
    ownerBoundary: 'ralph.executor-prompt',
    promptId: 'executor.agentPrompt',
    fixture: input.fixture,
    prompt: replay.rendered.text,
  };
}

function getPreAgentErrorMessage(input: {
  stageId: string;
  taskId: string;
  beforeGitStatus: string[];
  preAgentPolicy: ExecutorActionCoreSourceMode['preAgentPolicy'];
  allowedLoopOwnedPreExistingChangedFiles: string[];
}): string | null {
  if (input.preAgentPolicy === 'require_clean_workspace') {
    const changedFiles = normalizeExecutorChangedFiles(
      parseExecutorGitStatusChangedFiles(input.beforeGitStatus),
      `${input.stageId} pre-agent git status changed files`,
    );
    return changedFiles.length > 0
      ? `${input.stageId} requires clean source evidence before executor agent call; pre-existing changed files are ambiguous: ${changedFiles.join(', ')}.`
      : null;
  }
  if (input.preAgentPolicy === 'caller_validated') {
    return null;
  }

  const check = checkExecutorPreAgentSourceEvidence({
    beforeGitStatus: input.beforeGitStatus,
    taskId: input.taskId,
    stageId: input.stageId,
    label: input.stageId,
    allowedLoopOwnedPreExistingChangedFiles: input.allowedLoopOwnedPreExistingChangedFiles,
  });
  return check.errorMessage;
}

async function readPreExistingLoopOwnedFileContents(input: {
  workDir: string;
  beforeGitStatus: string[];
  allowedLoopOwnedPreExistingChangedFiles: string[];
}): Promise<Map<string, string | null>> {
  const beforeChangedFiles = new Set(normalizeExecutorChangedFiles(
    parseExecutorGitStatusChangedFiles(input.beforeGitStatus),
    'pre-agent loop-owned changed files',
  ));
  const contents = new Map<string, string | null>();
  for (const file of input.allowedLoopOwnedPreExistingChangedFiles) {
    if (!beforeChangedFiles.has(file)) continue;
    contents.set(file, await readWorkspaceTextFile(input.workDir, file));
  }
  return contents;
}

async function findLoopOwnedFilesChangedDuringAgent(input: {
  workDir: string;
  beforeContents: Map<string, string | null>;
}): Promise<string[]> {
  const changed: string[] = [];
  for (const [file, beforeContent] of input.beforeContents.entries()) {
    const afterContent = await readWorkspaceTextFile(input.workDir, file);
    if (afterContent !== beforeContent) changed.push(file);
  }
  return changed.sort();
}

async function findRunnerMaterializedSpecInputFilesChangedDuringAgent(input: {
  workDir: string;
  beforeGitStatus: string[];
  beforeSpecInputManifestRaw: string | null;
  changedFiles: string[];
}): Promise<string[]> {
  const beforeChangedFiles = new Set(normalizeExecutorChangedFiles(
    parseExecutorGitStatusChangedFiles(input.beforeGitStatus),
    'pre-agent changed files for runner materialized spec input check',
  ));
  const candidates = input.changedFiles
    .filter(isMaterializedSpecInputFile)
    .filter((file) => !beforeChangedFiles.has(file))
    .sort();
  if (candidates.length === 0) return [];

  const afterSpecInputManifestRaw = await readWorkspaceTextFile(input.workDir, '.arena/spec-input.json');
  if (!afterSpecInputManifestRaw || afterSpecInputManifestRaw === input.beforeSpecInputManifestRaw) return [];

  const expectedContents = await readExpectedMaterializedSpecInputContents(input.workDir, afterSpecInputManifestRaw);
  if (!expectedContents) return [];

  const allowed: string[] = [];
  for (const file of candidates) {
    const expected = expectedContents.get(file);
    if (expected == null) continue;
    const actual = await readWorkspaceTextFile(input.workDir, file);
    if (actual === expected) allowed.push(file);
  }
  return allowed.sort();
}

function isMaterializedSpecInputFile(file: string): boolean {
  return file === 'spec.md'
    || /^specs\/(?:000-project|\d{3}-[^/]+)\.md$/.test(file);
}

async function readExpectedMaterializedSpecInputContents(
  workDir: string,
  manifestRaw: string,
): Promise<Map<string, string> | null> {
  let manifest: unknown;
  try {
    manifest = JSON.parse(manifestRaw);
  } catch {
    return null;
  }
  if (!manifest || typeof manifest !== 'object' || !Array.isArray((manifest as { specs?: unknown }).specs)) {
    return null;
  }

  const expected = new Map<string, string>();
  const combinedParts: string[] = [];
  const specs = (manifest as { specs: unknown[] }).specs;

  for (let index = 0; index < specs.length; index++) {
    const spec = specs[index];
    if (!spec || typeof spec !== 'object') return null;
    const record = spec as Record<string, unknown>;
    const id = typeof record.id === 'string' ? record.id : '';
    const slug = typeof record.slug === 'string' ? record.slug : '';
    const hash = typeof record.hash === 'string' ? record.hash : '';
    if (!id || !slug || !/^[a-f0-9]{32}$/i.test(hash)) return null;

    const relPath = `specs/${String(index + 1).padStart(3, '0')}-${runnerSpecFilenameSlug(slug)}-${id.slice(-4)}.md`;
    const content = await readWorkspaceTextFile(workDir, relPath);
    if (content == null || md5(content) !== hash) return null;
    expected.set(relPath, content);
    combinedParts.push(`# ${slug}\n\n${content}`);
  }

  const projectTitle = await readMaterializedProjectTitle(workDir);
  const combinedSpec = `${projectTitle ? `# Project: ${projectTitle}\n\n` : ''}${combinedParts.join('\n\n---\n\n')}`;
  expected.set('spec.md', combinedSpec);
  if (projectTitle) {
    expected.set('specs/000-project.md', `# Project: ${projectTitle}\n`);
  }
  return expected;
}

async function readMaterializedProjectTitle(workDir: string): Promise<string | null> {
  const projectSpec = await readWorkspaceTextFile(workDir, 'specs/000-project.md');
  if (!projectSpec) return null;
  const match = projectSpec.match(/^# Project: ([^\n]+)\n$/);
  return match?.[1] ?? null;
}

function runnerSpecFilenameSlug(slug: string): string {
  return slug
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 50);
}

function md5(value: string): string {
  return createHash('md5').update(value).digest('hex');
}

async function readWorkspaceTextFile(workDir: string, file: string): Promise<string | null> {
  try {
    return await readFile(resolve(workDir, file), 'utf8');
  } catch {
    return null;
  }
}

function emptySourceEvidence(input: {
  headBefore: string | null;
  headAfter: string | null;
  beforeGitStatus: string[] | null;
  afterGitStatus: string[] | null;
}): ExecutorActionCoreSourceEvidence {
  return {
    ownerBoundary: EXECUTOR_SOURCE_EVIDENCE_OWNER_BOUNDARY,
    headBefore: input.headBefore,
    headAfter: input.headAfter,
    beforeGitStatus: input.beforeGitStatus,
    afterGitStatus: input.afterGitStatus,
    preExistingChangedFiles: [],
    changedFilesForObserver: [],
    runnerMaterializedSpecInputFiles: [],
    changedFilesSourceLabel: 'Workspace diff',
  };
}
