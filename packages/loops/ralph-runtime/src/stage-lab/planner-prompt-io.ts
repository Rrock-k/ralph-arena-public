import { dirname, resolve } from 'node:path';
import { z } from 'zod';
import fs from 'fs-extra';
import type { Phase, Task } from '../config/types.js';
import {
  PROMPT_LAB_FIXTURE_SCHEMA_VERSION,
  renderPromptLabFixture,
  parsePromptLabFixture,
  type PromptLabPromptId,
} from '../prompts/prompt-lab.js';
import {
  parsePlannerAgentOutput,
  validatePlannerParsedAgentOutput,
} from '../planning/planner-output.js';
import {
  assertDisposableStageOutPathAllowed,
  assertPathOutsideLoopTruthDirs,
  assertStageFixturePathAllowed,
  sha256,
} from './stage-io.js';
import type { StageCatalogEntry } from './catalog.js';

export const PLANNER_PROMPT_IO_FIXTURE_SCHEMA_VERSION = 'ra-356.planner-prompt-io-fixture.v1' as const;
export const PLANNER_PROMPT_IO_RESULT_SCHEMA_VERSION = 'ra-356.planner-prompt-io-result.v1' as const;

export const PLANNER_PROMPT_IO_STAGE_CATALOG_ENTRY: StageCatalogEntry = {
  stageId: 'planner_prompt_io',
  status: 'supported_now',
  modes: ['fixture'],
  runSurface: 'stage_run_fixture',
  ownerBoundary: 'ralph.planner.prompt-code-path',
  purpose: 'Render a planner prompt fixture and parse explicit planner output without applying a plan.',
  currentCommand: 'ralph stage run planner_prompt_io --fixture <fixture.json> --out <temp-output.json>',
  fixtureSchemaVersion: PLANNER_PROMPT_IO_FIXTURE_SCHEMA_VERSION,
  resultSchemaVersion: PLANNER_PROMPT_IO_RESULT_SCHEMA_VERSION,
  promptIds: ['planner.initial', 'planner.replan'],
  fixtureExamples: [
    'work/plans/ra-356-manual-experiment-tooling/fixtures/planner-prompt-io-visual-task.json',
  ],
  allowedMutationSummary: [
    'new explicit temp --out file only',
  ],
  forbiddenMutationSummary: [
    'no model provider call',
    'no .ralph/plan.json write',
    'no decisions log or prompt trace write',
    'no task evidence, proof review, runtime intent or lifecycle write',
    'no executor or controller auto-start',
  ],
  handoff: [
    'inspect_planner_output',
    'run_executor_task_io_later_if_selected',
    'discard_experiment_output',
  ],
  notes: [
    'Agent output fixture must not declare filesChanged or completionPromiseFound.',
    'Planner task evidence/proof/lifecycle-shaped fields are rejected.',
  ],
};

const PlannerPromptIoFixtureSchema = z.object({
  schemaVersion: z.literal(PLANNER_PROMPT_IO_FIXTURE_SCHEMA_VERSION),
  name: z.string().min(1).optional(),
  promptVariantRef: z.string().min(1).optional(),
  promptFixture: z.unknown(),
  agentOutput: z.object({
    success: z.boolean(),
    output: z.string(),
    filesChanged: z.array(z.string()).default([]),
    completionPromiseFound: z.boolean().default(false),
  }).strict(),
}).strict();

export type PlannerPromptIoFixture = z.infer<typeof PlannerPromptIoFixtureSchema>;

export type PlannerPromptIoResult = {
  schemaVersion: typeof PLANNER_PROMPT_IO_RESULT_SCHEMA_VERSION;
  stage: {
    stageId: 'planner_prompt_io';
    mode: 'fixture';
    inputRef: string | null;
    ownerBoundary: 'ralph.planner.prompt-code-path';
    promptVariantRef: string | null;
    sourceRef: null;
    allowedMutations: string[];
    forbiddenMutations: string[];
    handoff: string[];
  };
  fixture: {
    schemaVersion: typeof PLANNER_PROMPT_IO_FIXTURE_SCHEMA_VERSION;
    name: string | null;
    path: string | null;
  };
  prompt: {
    promptId: PromptLabPromptId;
    renderedSha256: string;
    renderedCharCount: number;
  };
  agentOutput: {
    success: boolean;
    outputSha256: string;
    outputCharCount: number;
    filesChanged: string[];
    completionPromiseFound: boolean;
  };
  plannerOutput: {
    status: 'parsed' | 'agent_failed' | 'parse_or_validation_failed';
    projectGoal: string | null;
    phases: Phase[];
    judgments: unknown[];
    summary: {
      phaseCount: number;
      taskCount: number;
      judgmentCount: number;
      tasksByStatus: Record<string, number>;
      structuredVisualExpectationTaskIds: string[];
    };
    error: {
      code: 'agent_failed' | 'parse_or_validation_failed';
      message: string;
    } | null;
  };
  output: {
    resultPath: string | null;
  };
  notes: string[];
};

export async function runPlannerPromptIoFixtureFile(input: {
  fixturePath: string;
  outPath?: string;
  compact?: boolean;
}): Promise<PlannerPromptIoResult> {
  const fixturePath = resolve(input.fixturePath);
  assertStageFixturePathAllowed(fixturePath, 'planner_prompt_io --fixture');
  const rawFixture = await fs.readJson(fixturePath);
  const fixture = parsePlannerPromptIoFixture(rawFixture);
  const outPath = input.outPath ? resolve(input.outPath) : undefined;
  if (outPath) assertDisposableStageOutPathAllowed({
    stageId: 'planner_prompt_io',
    outPath,
    fixturePath,
  });
  const result = runPlannerPromptIoFixture({
    fixture,
    fixturePath,
    outPath: outPath ?? null,
  });

  if (outPath) {
    await fs.ensureDir(dirname(outPath));
    await fs.writeFile(outPath, formatPlannerPromptIoResult(result, input.compact));
  }

  return result;
}

export function parsePlannerPromptIoFixture(raw: unknown): PlannerPromptIoFixture {
  return PlannerPromptIoFixtureSchema.parse(raw);
}

export function runPlannerPromptIoFixture(input: {
  fixture: PlannerPromptIoFixture;
  fixturePath?: string | null;
  outPath?: string | null;
}): PlannerPromptIoResult {
  const fixture = input.fixture;
  const promptFixture = parsePromptLabFixture(fixture.promptFixture);
  if (!isPlannerPromptIoPromptId(promptFixture.promptId)) {
    throw new Error(`planner_prompt_io requires planner.initial or planner.replan prompt fixture, got ${promptFixture.promptId}.`);
  }
  assertPurePlannerPromptIoAgentOutput(fixture.agentOutput);

  const promptReplay = renderPromptLabFixture({
    fixture: promptFixture,
    fixturePath: input.fixturePath ?? null,
  });
  if (input.fixturePath) assertPathOutsideLoopTruthDirs(input.fixturePath, 'planner_prompt_io fixturePath');
  if (input.outPath) assertDisposableStageOutPathAllowed({
    stageId: 'planner_prompt_io',
    outPath: input.outPath,
    fixturePath: input.fixturePath,
  });
  const allowedMutations = input.outPath ? [resolve(input.outPath)] : [];
  const baseResult = {
    schemaVersion: PLANNER_PROMPT_IO_RESULT_SCHEMA_VERSION,
    stage: {
      stageId: 'planner_prompt_io' as const,
      mode: 'fixture' as const,
      inputRef: input.fixturePath ? resolve(input.fixturePath) : null,
      ownerBoundary: 'ralph.planner.prompt-code-path' as const,
      promptVariantRef: fixture.promptVariantRef ?? null,
      sourceRef: null,
      allowedMutations,
      forbiddenMutations: [
        '.ralph/plan.json',
        '.ralph/decisions-log.json',
        '.ralph/prompt-traces/',
        '.arena/',
        'task verificationEvidence',
        'proofReviews[]',
        'ProjectAsset',
        'blockers',
        'runtime intents',
        'lifecycle state',
      ],
      handoff: [
        'inspect_planner_prompt_and_output',
        'adjust_prompt_variant_or_fixture_and_rerun',
        'run_executor_task_io_later_if_selected',
        'discard_experiment_output',
      ],
    },
    fixture: {
      schemaVersion: fixture.schemaVersion,
      name: fixture.name ?? null,
      path: input.fixturePath ? resolve(input.fixturePath) : null,
    },
    prompt: {
      promptId: promptFixture.promptId,
      renderedSha256: `sha256:${sha256(promptReplay.rendered.text)}`,
      renderedCharCount: promptReplay.rendered.charCount,
    },
    agentOutput: {
      success: fixture.agentOutput.success,
      outputSha256: `sha256:${sha256(fixture.agentOutput.output)}`,
      outputCharCount: fixture.agentOutput.output.length,
      filesChanged: fixture.agentOutput.filesChanged,
      completionPromiseFound: fixture.agentOutput.completionPromiseFound,
    },
    output: {
      resultPath: input.outPath ? resolve(input.outPath) : null,
    },
    notes: [
      'planner_prompt_io is a fixture-mode stage run, not lifecycle truth.',
      'It renders a repository-owned planner prompt and parses explicit planner output without calling model providers.',
      'It does not write .ralph/plan.json, decisions log, prompt traces, task evidence, proof reviews, runtime intents or lifecycle state.',
      'The parsed phases and tasks are disposable experiment output until a future explicit apply step is selected.',
    ],
  };

  if (!fixture.agentOutput.success) {
    return {
      ...baseResult,
      plannerOutput: {
        status: 'agent_failed',
        projectGoal: null,
        phases: [],
        judgments: [],
        summary: emptySummary(),
        error: {
          code: 'agent_failed',
          message: 'Fixture agentOutput.success=false; planner output was not parsed or normalized.',
        },
      },
    };
  }

  try {
    const parsedPlannerOutput = parsePlannerAgentOutput(fixture.agentOutput.output);
    assertNoPlannerStageForbiddenTaskFields(parsedPlannerOutput.phases);
    const plannerOutput = validatePlannerParsedAgentOutput(parsedPlannerOutput);
    const tasks = flattenTasks(plannerOutput.phases);
    return {
      ...baseResult,
      plannerOutput: {
        status: 'parsed',
        projectGoal: plannerOutput.projectGoal ?? null,
        phases: plannerOutput.phases,
        judgments: plannerOutput.judgments,
        summary: {
          phaseCount: plannerOutput.phases.length,
          taskCount: tasks.length,
          judgmentCount: plannerOutput.judgments.length,
          tasksByStatus: countTasksByStatus(tasks),
          structuredVisualExpectationTaskIds: tasks
            .filter(hasStructuredVisualExpectation)
            .map((task) => task.id),
        },
        error: null,
      },
    };
  } catch (error: any) {
    return {
      ...baseResult,
      plannerOutput: {
        status: 'parse_or_validation_failed',
        projectGoal: null,
        phases: [],
        judgments: [],
        summary: emptySummary(),
        error: {
          code: 'parse_or_validation_failed',
          message: error instanceof Error ? error.message : String(error),
        },
      },
    };
  }
}

export function formatPlannerPromptIoResult(result: PlannerPromptIoResult, compact = false): string {
  return `${JSON.stringify(result, null, compact ? 0 : 2)}\n`;
}

function isPlannerPromptIoPromptId(promptId: PromptLabPromptId): boolean {
  return promptId === 'planner.initial' || promptId === 'planner.replan';
}

function flattenTasks(phases: Phase[]): Task[] {
  return phases.flatMap((phase) => phase.tasks);
}

function countTasksByStatus(tasks: Task[]): Record<string, number> {
  return tasks.reduce<Record<string, number>>((acc, task) => {
    acc[task.status] = (acc[task.status] ?? 0) + 1;
    return acc;
  }, {});
}

function hasStructuredVisualExpectation(task: Task): boolean {
  return (task.requiredRolePasses ?? []).includes('ux')
    || (task.feedbackItemRefs ?? []).some((ref) => ref.workSurface === 'frontend');
}

function assertPurePlannerPromptIoAgentOutput(agentOutput: PlannerPromptIoFixture['agentOutput']): void {
  if (agentOutput.filesChanged.length > 0) {
    throw new Error('planner_prompt_io fixture agentOutput.filesChanged must be empty; planner_prompt_io does not model workspace mutation.');
  }

  if (agentOutput.completionPromiseFound) {
    throw new Error('planner_prompt_io fixture agentOutput.completionPromiseFound must be false; completion promises belong to executor_task_io, not planner_prompt_io.');
  }
}

function assertNoPlannerStageForbiddenTaskFields(phases: unknown[]): void {
  const forbiddenFields = [
    'verificationEvidence',
    'proofReviews',
    'screenshotProof',
    'runtimeIntent',
    'lifecycleState',
  ];

  for (const rawTask of flattenRawTasks(phases)) {
    const presentForbiddenFields = forbiddenFields.filter((field) => field in rawTask);
    if (presentForbiddenFields.length > 0) {
      const taskId = typeof rawTask.id === 'string' && rawTask.id.trim() ? rawTask.id : '(unknown task)';
      throw new Error(`planner_prompt_io planner output includes forbidden task fields on ${taskId}: ${presentForbiddenFields.join(', ')}`);
    }
  }
}

function flattenRawTasks(phases: unknown[]): Array<Record<string, unknown>> {
  return phases.flatMap((phase) => {
    if (!phase || typeof phase !== 'object') return [];
    const tasks = (phase as { tasks?: unknown }).tasks;
    if (!Array.isArray(tasks)) return [];
    return tasks.filter((task): task is Record<string, unknown> => Boolean(task) && typeof task === 'object');
  });
}

function emptySummary(): PlannerPromptIoResult['plannerOutput']['summary'] {
  return {
    phaseCount: 0,
    taskCount: 0,
    judgmentCount: 0,
    tasksByStatus: {},
    structuredVisualExpectationTaskIds: [],
  };
}
