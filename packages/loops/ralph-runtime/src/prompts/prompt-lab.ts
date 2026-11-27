import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { z } from 'zod';
import fs from 'fs-extra';
import {
  PROMPT_REPOSITORY_OWNER,
  PROMPT_REPOSITORY_SCHEMA_VERSION,
  getRalphPromptRepositoryEntries,
  renderControllerAuditPrompt,
  renderE2EApplicabilityPrompt,
  renderExecutorAgentPrompt,
  renderExecutorTaskSection,
  renderPlannerInitialPrompt,
  renderPlannerReplanPrompt,
  renderPlannerSpecMigrationPrompt,
  type PromptRepositoryEntry,
} from './repository.js';
import { TaskSchema } from '../config/types.js';

export const PROMPT_LAB_FIXTURE_SCHEMA_VERSION = 'ra-356.prompt-fixture.v1' as const;
export const PROMPT_LAB_REPLAY_RESULT_SCHEMA_VERSION = 'ra-356.prompt-replay-result.v1' as const;

export const PROMPT_LAB_SUPPORTED_PROMPT_IDS = [
  'planner.initial',
  'planner.replan',
  'planner.specMigration',
  'executor.agentPrompt',
  'executor.taskSection',
  'executor.productSkill',
  'executor.uxSkill',
  'controller.audit',
  'controller.e2eApplicability',
] as const;

const PromptLabPromptIdSchema = z.enum(PROMPT_LAB_SUPPORTED_PROMPT_IDS);
const VisualEvidenceModeSchema = z.enum(['off', 'required', 'new_tasks_only']);

export type PromptLabPromptId = z.infer<typeof PromptLabPromptIdSchema>;

const PromptLabFixtureSchema = z.object({
  schemaVersion: z.literal(PROMPT_LAB_FIXTURE_SCHEMA_VERSION),
  promptId: PromptLabPromptIdSchema,
  name: z.string().min(1).optional(),
  input: z.unknown(),
}).strict();

export type PromptLabFixture = z.infer<typeof PromptLabFixtureSchema>;

export type PromptLabReplayFormat = 'json' | 'text';

export type PromptLabReplayResult = {
  schemaVersion: typeof PROMPT_LAB_REPLAY_RESULT_SCHEMA_VERSION;
  promptRepositorySchemaVersion: typeof PROMPT_REPOSITORY_SCHEMA_VERSION;
  owner: typeof PROMPT_REPOSITORY_OWNER;
  promptId: PromptLabPromptId;
  fixture: {
    schemaVersion: typeof PROMPT_LAB_FIXTURE_SCHEMA_VERSION;
    name: string | null;
    path: string | null;
  };
  entry: {
    id: string;
    title: string;
    owner: PromptRepositoryEntry['owner'];
    kind: PromptRepositoryEntry['kind'];
    source: PromptRepositoryEntry['source'];
  };
  rendered: {
    text: string;
    charCount: number;
    sha256: string;
  };
  notes: string[];
};

const PlannerInitialInputSchema = z.object({
  seed: z.string(),
  previousErrorBlock: z.string(),
  projectName: z.string(),
  projectDescription: z.string(),
  techStack: z.string(),
  deployBlock: z.string(),
  repositoryBlock: z.string(),
  spec: z.string(),
  existingProjectFilesBlock: z.string(),
  judgmentTimestamp: z.string(),
  visualEvidenceMode: VisualEvidenceModeSchema.optional(),
}).strict();

const PlannerReplanInputSchema = z.object({
  reason: z.string(),
  seed: z.string(),
  previousErrorBlock: z.string(),
  spec: z.string(),
  currentPlanJson: z.string(),
  visualEvidenceMode: VisualEvidenceModeSchema.optional(),
}).strict();

const PlannerSpecMigrationInputSchema = z.object({
  previousErrorBlock: z.string(),
  projectName: z.string(),
  projectDescription: z.string(),
  techStack: z.string(),
  specLabel: z.string(),
  newSpec: z.string(),
  requiredFeedbackDispositionsBlock: z.string(),
  currentPlanJson: z.string(),
  nextTaskId: z.string(),
  feedbackDispositionExample: z.string(),
  concreteClosureEvidenceKinds: z.string(),
  nextJudgmentId: z.string(),
  judgmentTimestamp: z.string(),
  visualEvidenceMode: VisualEvidenceModeSchema.optional(),
}).strict();


const ExecutorAgentPromptInputSchema = z.object({
  contextSections: z.string(),
}).strict();

const ExecutorTaskSectionInputSchema = z.object({
  task: TaskSchema,
  iteration: z.coerce.number().int().min(1),
  taskFolder: z.string().min(1).optional(),
  withScopeBoundary: z.boolean().optional(),
  visualEvidenceMode: VisualEvidenceModeSchema.optional(),
}).strict();

const StaticRoleSkillInputSchema = z.object({}).strict();

const ControllerAuditInputSchema = z.object({
  trigger: z.string(),
  spec: z.string(),
  planJson: z.string(),
  historyText: z.string(),
  projectSnapshot: z.string(),
  visionReportBlock: z.string(),
  feedbackMatrixBlock: z.string(),
  judgmentTimestamp: z.string(),
  e2ePolicyBlock: z.string(),
}).strict();

const E2EApplicabilityInputSchema = z.object({
  specContent: z.string(),
  packageJson: z.string(),
}).strict();

export async function replayPromptFixtureFile(input: {
  fixturePath: string;
  format?: PromptLabReplayFormat;
  outPath?: string;
  compact?: boolean;
}): Promise<PromptLabReplayResult> {
  const fixturePath = resolve(input.fixturePath);
  const fixture = parsePromptLabFixture(await fs.readJson(fixturePath));
  const result = renderPromptLabFixture({ fixture, fixturePath });

  if (input.outPath) {
    const outPath = resolve(input.outPath);
    await fs.ensureDir(dirname(outPath));
    await fs.writeFile(outPath, formatPromptLabReplayResult(result, input.format ?? 'json', input.compact));
  }

  return result;
}

export function parsePromptLabFixture(raw: unknown): PromptLabFixture {
  return PromptLabFixtureSchema.parse(raw);
}

export function renderPromptLabFixture(input: {
  fixture: PromptLabFixture;
  fixturePath?: string | null;
}): PromptLabReplayResult {
  const fixture = input.fixture;
  const text = renderPromptById(fixture.promptId, fixture.input);
  const entry = findPromptEntry(fixture.promptId);

  return {
    schemaVersion: PROMPT_LAB_REPLAY_RESULT_SCHEMA_VERSION,
    promptRepositorySchemaVersion: PROMPT_REPOSITORY_SCHEMA_VERSION,
    owner: PROMPT_REPOSITORY_OWNER,
    promptId: fixture.promptId,
    fixture: {
      schemaVersion: fixture.schemaVersion,
      name: fixture.name ?? null,
      path: input.fixturePath ? resolve(input.fixturePath) : null,
    },
    entry: {
      id: entry.id,
      title: entry.title,
      owner: entry.owner,
      kind: entry.kind,
      source: { ...entry.source },
    },
    rendered: {
      text,
      charCount: text.length,
      sha256: sha256(text),
    },
    notes: [
      'Prompt Lab replay renders repository-owned prompts and context sections from explicit fixtures only.',
      'It does not call model providers, mutate live projects, write prompt traces, parse model output, or update runtime/task/evidence truth.',
    ],
  };
}

export function formatPromptLabReplayResult(
  result: PromptLabReplayResult,
  format: PromptLabReplayFormat,
  compact = false,
): string {
  if (format === 'text') return `${result.rendered.text}\n`;
  if (format === 'json') return `${JSON.stringify(result, null, compact ? 0 : 2)}\n`;
  throw new Error(`Unsupported prompt replay format: ${format}`);
}

function renderPromptById(promptId: PromptLabPromptId, rawInput: unknown): string {
  switch (promptId) {
    case 'planner.initial':
      return renderPlannerInitialPrompt(PlannerInitialInputSchema.parse(rawInput));
    case 'planner.replan':
      return renderPlannerReplanPrompt(PlannerReplanInputSchema.parse(rawInput));
    case 'planner.specMigration':
      return renderPlannerSpecMigrationPrompt(PlannerSpecMigrationInputSchema.parse(rawInput));
    case 'executor.agentPrompt':
      return renderExecutorAgentPrompt(ExecutorAgentPromptInputSchema.parse(rawInput).contextSections);
    case 'executor.taskSection':
      return renderExecutorTaskSection(ExecutorTaskSectionInputSchema.parse(rawInput));
    case 'executor.productSkill':
    case 'executor.uxSkill':
      StaticRoleSkillInputSchema.parse(rawInput);
      return renderStaticPromptRepositoryEntry(promptId);
    case 'controller.audit':
      return renderControllerAuditPrompt(ControllerAuditInputSchema.parse(rawInput));
    case 'controller.e2eApplicability': {
      const parsed = E2EApplicabilityInputSchema.parse(rawInput);
      return renderE2EApplicabilityPrompt(parsed.specContent, parsed.packageJson);
    }
  }
}

function findPromptEntry(promptId: PromptLabPromptId): PromptRepositoryEntry {
  const entry = getRalphPromptRepositoryEntries().find((candidate) => candidate.id === promptId);
  if (!entry) throw new Error(`Prompt repository entry not found: ${promptId}`);
  return entry;
}

function renderStaticPromptRepositoryEntry(promptId: PromptLabPromptId): string {
  const entry = findPromptEntry(promptId);
  const body = entry.templateBody;
  if (entry.bodyMode !== 'repository_constant' || !body || body.placeholders.length !== 0) {
    throw new Error(`Prompt repository entry is not a static replayable body: ${promptId}`);
  }
  return body.text;
}

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}
