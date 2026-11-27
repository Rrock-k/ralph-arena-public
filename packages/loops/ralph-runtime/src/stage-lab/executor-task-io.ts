import { dirname, resolve } from 'node:path';
import { z } from 'zod';
import fs from 'fs-extra';
import { TaskSchema, VisualEvidenceModeSchema } from '../config/types.js';
import type { ExecutorActionReportVisualExpectation, VisualEvidenceMode } from '../config/types.js';
import {
  PROMPT_LAB_FIXTURE_SCHEMA_VERSION,
  parsePromptLabFixture,
  renderPromptLabFixture,
  type PromptLabPromptId,
} from '../prompts/prompt-lab.js';
import {
  assertDisposableStageOutPathAllowed,
  assertPathOutsideLoopTruthDirs,
  assertStageFixturePathAllowed,
  sha256,
} from './stage-io.js';
import {
  assertNoHardForbiddenExecutorChangedFiles,
  buildExecutorOutputSummary,
  EXECUTOR_OBSERVER_OWNER_BOUNDARY,
  getTaskVisualExpectation,
  normalizeExecutorChangedFiles,
  observeExecutorOutput,
  type ExecutorStageStatus,
  type ExecutorStageVisualWorkbenchCoverage,
  type ExecutorStageWarning,
} from '../loop/executor-observer.js';
import type { StageCatalogEntry } from './catalog.js';

export const EXECUTOR_TASK_IO_FIXTURE_SCHEMA_VERSION = 'ra-356.executor-task-io-fixture.v1' as const;
export const EXECUTOR_TASK_IO_RESULT_SCHEMA_VERSION = 'ra-356.executor-task-io-result.v1' as const;

export const EXECUTOR_TASK_IO_STAGE_CATALOG_ENTRY: StageCatalogEntry = {
  stageId: 'executor_task_io',
  status: 'supported_now',
  modes: ['fixture'],
  runSurface: 'stage_run_fixture',
  ownerBoundary: 'ralph.executor.prompt-code-path',
  purpose: 'Render one executor task prompt fixture and classify explicit AgentResult-shaped output without mutating a workspace.',
  currentCommand: 'ralph stage run executor_task_io --fixture <fixture.json> --out <temp-output.json>',
  fixtureSchemaVersion: EXECUTOR_TASK_IO_FIXTURE_SCHEMA_VERSION,
  resultSchemaVersion: EXECUTOR_TASK_IO_RESULT_SCHEMA_VERSION,
  promptIds: ['executor.agentPrompt'],
  fixtureExamples: [
    'work/plans/ra-356-manual-experiment-tooling/fixtures/executor-task-io-visual-task.json',
  ],
  allowedMutationSummary: [
    'new explicit temp --out file only',
  ],
  forbiddenMutationSummary: [
    'no model provider call',
    'no workspace mutation',
    'no .ralph plan/progress write',
    'no prompt trace or agent log write',
    'no verification/deploy',
    'no task evidence, proof review, ProjectAsset, runtime intent or lifecycle write',
    'no planner or controller auto-start',
  ],
  handoff: [
    'inspect_executor_output',
    'run_visual_workbench_capture_later_if_selected',
    'run_controller_visual_review_later_if_selected',
    'discard_experiment_output',
  ],
  notes: [
    'filesChanged is a declared observation, not proof.',
    'Visual Workbench coverage gaps are reported as operator observations only when the explicit visual evidence mode requires them.',
  ],
};

const ExecutorAgentResultFixtureSchema = z.object({
  success: z.boolean(),
  output: z.string(),
  filesChanged: z.array(z.string()).default([]),
  error: z.object({
    category: z.string().min(1).optional(),
    message: z.string().min(1).optional(),
  }).passthrough().optional(),
}).strict();

const ExecutorTaskIoFixtureSchema = z.object({
  schemaVersion: z.literal(EXECUTOR_TASK_IO_FIXTURE_SCHEMA_VERSION),
  name: z.string().min(1).optional(),
  promptVariantRef: z.string().min(1).optional(),
  sourceRef: z.string().min(1).optional(),
  completionPromise: z.string().min(1),
  visualEvidenceMode: VisualEvidenceModeSchema,
  expectedVisualWorkbenchStoryIds: z.array(z.string().min(1)).default([]),
  task: z.unknown(),
  promptFixture: z.unknown(),
  agentResult: ExecutorAgentResultFixtureSchema,
}).strict();

export type ExecutorTaskIoFixture = z.infer<typeof ExecutorTaskIoFixtureSchema>;

export type ExecutorTaskIoResult = {
  schemaVersion: typeof EXECUTOR_TASK_IO_RESULT_SCHEMA_VERSION;
  stage: {
    stageId: 'executor_task_io';
    mode: 'fixture';
    inputRef: string | null;
    ownerBoundary: 'ralph.executor.prompt-code-path';
    promptVariantRef: string | null;
    sourceRef: string | null;
    allowedMutations: string[];
    forbiddenMutations: string[];
    handoff: string[];
  };
  fixture: {
    schemaVersion: typeof EXECUTOR_TASK_IO_FIXTURE_SCHEMA_VERSION;
    name: string | null;
    path: string | null;
  };
  task: {
    id: string;
    displayTitle: string | null;
    visualEvidenceMode: VisualEvidenceMode;
    hasStructuredVisualExpectation: boolean;
    visualExpectationSources: string[];
  };
  prompt: {
    promptId: PromptLabPromptId;
    renderedSha256: string;
    renderedCharCount: number;
  };
  agentResult: {
    success: boolean;
    outputSha256: string;
    outputCharCount: number;
    filesChanged: string[];
    detectedCompletionPromiseFound: boolean;
    needsReplanSignalDetected: boolean;
    malformedCompletion: string | null;
    errorCategory: string | null;
    errorMessage: string | null;
  };
  executorOutput: {
    ownerBoundary: typeof EXECUTOR_OBSERVER_OWNER_BOUNDARY;
    status: ExecutorStageStatus;
    visualEvidenceMode: VisualEvidenceMode;
    visualExpectation: ExecutorActionReportVisualExpectation;
    summary: {
      filesChangedCount: number;
      changedProductFiles: string[];
      changedTaskWorkspaceFiles: string[];
      changedVisualWorkbenchFiles: string[];
      forbiddenChangedFiles: string[];
      adHocProofLikeFiles: string[];
      visualWorkbenchCoverage: ExecutorStageVisualWorkbenchCoverage;
      expectedVisualWorkbenchStoryIds: string[];
      coveredExpectedVisualWorkbenchStoryIds: string[];
      missingExpectedVisualWorkbenchStoryIds: string[];
    };
    warnings: ExecutorStageWarning[];
  };
  output: {
    resultPath: string | null;
  };
  notes: string[];
};

export async function runExecutorTaskIoFixtureFile(input: {
  fixturePath: string;
  outPath?: string;
  compact?: boolean;
}): Promise<ExecutorTaskIoResult> {
  const fixturePath = resolve(input.fixturePath);
  assertStageFixturePathAllowed(fixturePath, 'executor_task_io --fixture');
  const rawFixture = await fs.readJson(fixturePath);
  const fixture = parseExecutorTaskIoFixture(rawFixture);
  const outPath = input.outPath ? resolve(input.outPath) : undefined;
  if (outPath) assertDisposableStageOutPathAllowed({
    stageId: 'executor_task_io',
    outPath,
    fixturePath,
  });

  const result = runExecutorTaskIoFixture({
    fixture,
    fixturePath,
    outPath: outPath ?? null,
  });

  if (outPath) {
    await fs.ensureDir(dirname(outPath));
    await fs.writeFile(outPath, formatExecutorTaskIoResult(result, input.compact));
  }

  return result;
}

export function parseExecutorTaskIoFixture(raw: unknown): ExecutorTaskIoFixture {
  return ExecutorTaskIoFixtureSchema.parse(raw);
}

export function runExecutorTaskIoFixture(input: {
  fixture: ExecutorTaskIoFixture;
  fixturePath?: string | null;
  outPath?: string | null;
}): ExecutorTaskIoResult {
  const fixture = input.fixture;
  const task = TaskSchema.parse(fixture.task);
  const promptFixture = parsePromptLabFixture(fixture.promptFixture);
  if (promptFixture.promptId !== 'executor.agentPrompt') {
    throw new Error(`executor_task_io requires executor.agentPrompt fixture, got ${promptFixture.promptId}.`);
  }

  const normalizedFilesChanged = normalizeExecutorChangedFiles(
    fixture.agentResult.filesChanged,
    'executor_task_io agentResult.filesChanged',
  );
  assertNoHardForbiddenExecutorChangedFiles({
    filesChanged: normalizedFilesChanged,
    taskId: task.id,
    stageId: 'executor_task_io',
    modeLabel: 'fixture',
  });

  const promptReplay = renderPromptLabFixture({
    fixture: promptFixture,
    fixturePath: input.fixturePath ?? null,
  });
  if (input.fixturePath) assertPathOutsideLoopTruthDirs(input.fixturePath, 'executor_task_io fixturePath');
  if (input.outPath) assertDisposableStageOutPathAllowed({
    stageId: 'executor_task_io',
    outPath: input.outPath,
    fixturePath: input.fixturePath,
  });

  const observation = observeExecutorOutput({
    task,
    agentResult: fixture.agentResult,
    filesChanged: normalizedFilesChanged,
    completionPromise: fixture.completionPromise,
    visualEvidenceMode: fixture.visualEvidenceMode,
    expectedVisualWorkbenchStoryIds: fixture.expectedVisualWorkbenchStoryIds,
    changedFilesSourceLabel: 'Fixture',
  });

  return {
    schemaVersion: EXECUTOR_TASK_IO_RESULT_SCHEMA_VERSION,
    stage: {
      stageId: 'executor_task_io',
      mode: 'fixture',
      inputRef: input.fixturePath ? resolve(input.fixturePath) : null,
      ownerBoundary: 'ralph.executor.prompt-code-path',
      promptVariantRef: fixture.promptVariantRef ?? null,
      sourceRef: fixture.sourceRef ?? null,
      allowedMutations: input.outPath ? [resolve(input.outPath)] : [],
      forbiddenMutations: [
        '.ralph/plan.json',
        '.ralph/decisions-log.json',
        '.ralph/ralph-progress.json',
        '.ralph/iteration-log.json',
        '.ralph/controller-reports/',
        '.ralph/agent-logs/',
        '.ralph/evidence/',
        '.arena/',
        'task verificationEvidence',
        'proofReviews[]',
        'ProjectAsset',
        'runtime intents',
        'lifecycle state',
      ],
      handoff: [
        'inspect_executor_prompt_and_output',
        'adjust_prompt_variant_or_fixture_and_rerun',
        'run_visual_workbench_manifest_readiness_if_visual_files_changed',
        'run_executor_task_workspace_mode_later_if_selected',
        'discard_experiment_output',
      ],
    },
    fixture: {
      schemaVersion: fixture.schemaVersion,
      name: fixture.name ?? null,
      path: input.fixturePath ? resolve(input.fixturePath) : null,
    },
    task: {
      id: task.id,
      displayTitle: task.displayTitle ?? null,
      visualEvidenceMode: fixture.visualEvidenceMode,
      hasStructuredVisualExpectation: observation.visualExpectation.hasStructuredVisualExpectation,
      visualExpectationSources: observation.visualExpectation.sources,
    },
    prompt: {
      promptId: promptFixture.promptId,
      renderedSha256: `sha256:${sha256(promptReplay.rendered.text)}`,
      renderedCharCount: promptReplay.rendered.charCount,
    },
    agentResult: {
      success: fixture.agentResult.success,
      outputSha256: `sha256:${sha256(fixture.agentResult.output)}`,
      outputCharCount: fixture.agentResult.output.length,
      filesChanged: normalizedFilesChanged,
      detectedCompletionPromiseFound: observation.completionPromiseFound,
      needsReplanSignalDetected: observation.needsReplanSignalDetected,
      malformedCompletion: observation.malformedCompletion,
      errorCategory: fixture.agentResult.error?.category ?? null,
      errorMessage: fixture.agentResult.error?.message ?? null,
    },
    executorOutput: {
      ownerBoundary: observation.ownerBoundary,
      status: observation.status,
      visualEvidenceMode: observation.visualEvidenceMode,
      visualExpectation: observation.visualExpectation,
      summary: buildExecutorOutputSummary(observation),
      warnings: observation.warnings,
    },
    output: {
      resultPath: input.outPath ? resolve(input.outPath) : null,
    },
    notes: [
      'executor_task_io is a fixture-mode stage run, not lifecycle truth.',
      'It renders a repository-owned executor prompt and classifies explicit AgentResult-shaped output without calling model providers.',
      'It does not mutate project source, .ralph plan/progress state, task evidence, proof reviews, runtime intents or lifecycle state.',
      'Declared changed files are fixture observations only until a future explicit workspace mode is selected.',
    ],
  };
}

export function formatExecutorTaskIoResult(result: ExecutorTaskIoResult, compact = false): string {
  return `${JSON.stringify(result, null, compact ? 0 : 2)}\n`;
}
