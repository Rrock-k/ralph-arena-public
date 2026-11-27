import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { Agent, AgentOptions } from '../agents/base.js';
import { PROVIDER_CALL_CHECKPOINT_RELATIVE_PATH } from '../agents/provider-call-checkpoint.js';
import type { AgentResult, Phase, SpecMigrationFeedbackItem, Task } from '../config/types.js';
import { ProjectConfigSchema } from '../config/types.js';
import {
  readAcceptedArtifactFeedbackContext,
  type AcceptedArtifactFeedbackItem,
} from '../feedback/spec-input.js';
import { JudgmentLog } from './judgments.js';
import { PlanManager } from './plan-manager.js';
import { Planner } from './planner.js';

class FakeAgent implements Agent {
  name = 'fake-agent';
  prompts: string[] = [];
  private outputIndex = 0;

  constructor(private outputs: string[]) {}

  async execute(options: AgentOptions): Promise<AgentResult> {
    this.prompts.push(options.prompt);
    const output = this.outputs[Math.min(this.outputIndex, this.outputs.length - 1)] ?? jsonBlock({
      summary: 'No changes',
      planChanges: [],
      feedbackDispositions: [],
      newJudgments: [],
    });
    this.outputIndex++;
    return {
      success: true,
      output,
      filesChanged: [],
      completionPromiseFound: false,
    };
  }

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async getVersion(): Promise<string> {
    return 'fake';
  }
}

class ProviderSessionFakeAgent implements Agent {
  name = 'fake-agent';
  resumeIds: Array<string | undefined> = [];
  private resultIndex = 0;

  constructor(private results: AgentResult[]) {}

  async execute(options: AgentOptions): Promise<AgentResult> {
    this.resumeIds.push(options.providerSessionResumeId);
    const result = this.results[Math.min(this.resultIndex, this.results.length - 1)];
    this.resultIndex++;
    if (!result) {
      throw new Error('ProviderSessionFakeAgent has no result configured');
    }
    return result;
  }

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async getVersion(): Promise<string> {
    return 'fake';
  }
}

function jsonBlock(value: unknown): string {
  return `\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\``;
}

function createProjectConfig() {
  return ProjectConfigSchema.parse({
    name: 'Sushi Kitties',
    description: 'Sushi restaurant game',
    techStack: { language: 'typescript', framework: 'vite' },
    repository: { url: '', branch: 'main', deployBranch: 'main' },
  });
}

function planTask(overrides: Partial<Task> & Pick<Task, 'id' | 'status'>): Task {
  const { id, status, ...rest } = overrides;
  return {
    id,
    description: `Task ${id}`,
    acceptanceCriteria: ['done'],
    status,
    attempts: 0,
    priority: 5,
    dependencies: [],
    ...rest,
  };
}

function planPhase(overrides: Partial<Phase> & Pick<Phase, 'id' | 'tasks'>): Phase {
  const { id, ...rest } = overrides;
  return {
    id,
    name: id,
    description: id,
    order: 1,
    status: 'pending',
    planLater: false,
    ...rest,
  };
}

function createMigrationWorkDir(specMarkdown: string): { workDir: string; specPath: string } {
  const workDir = mkdtempSync(path.join(tmpdir(), 'ralph-planner-migration-'));
  const specPath = path.join(workDir, 'spec.md');
  writeFileSync(specPath, specMarkdown);
  return { workDir, specPath };
}

function seedCompletedBugPlan(planManager: PlanManager): void {
  planManager.createPlan('spec.md', [
    {
      id: 'phase-1',
      name: 'Implementation',
      description: 'Build the game',
      order: 1,
      status: 'completed',
      planLater: false,
      tasks: [{
        id: 'task-010',
        description: 'Fix BUG-005 queue/card readability',
        acceptanceCriteria: ['BUG-005 is fixed'],
        status: 'completed',
        attempts: 1,
        priority: 3,
        dependencies: [],
      }],
    },
  ], [], 'Build a sushi restaurant game');
}

function writeAcceptedArtifactManifest(workDir: string): void {
  mkdirSync(path.join(workDir, '.arena'), { recursive: true });
  writeFileSync(path.join(workDir, '.arena', 'spec-input.json'), JSON.stringify({
    schemaVersion: 1,
    aggregateHash: 'input-hash-v3',
    specs: [{
      id: 'spec-1',
      slug: 'Spec',
      hash: 'content-hash',
      inputHash: 'input-hash-v3',
      currentVersion: {
        id: 'spec-version-3',
        version: 3,
      },
      metadataHash: 'sha256:artifact-v3',
      acceptedArtifact: {
        artifactSchemaVersion: 'ra-287.accepted-spec-artifact.v1',
        artifactId: 'SPEC-003',
        acceptedAt: '2026-05-16T12:00:00.000Z',
        source: {
          id: 'SRC-003',
          sourceSystem: 'tg-spec',
          sourceProjectId: 'tg-proj-1',
          sourceVersion: 9,
          sourceRefType: 'accepted_spec',
          sourceId: 'tg-spec-version-9',
        },
        acceptedSpec: {
          id: 'SPEC-003',
          version: 9,
          contentHash: `sha256:${'a'.repeat(64)}`,
          sourceRefs: ['SRC-003'],
          document: {
            specSchemaVersion: 'ra-287.spec-document.v1',
            title: 'Sushi Kitties',
            sections: [],
            requirements: [{
              id: 'REQ-HTML',
              kind: 'constraint',
              title: 'HTML gameplay surface',
              statement: 'Game and level UI must use HTML elements instead of canvas.',
              priority: 'high',
              acceptanceCriteria: ['Gameplay and level UI are rendered with HTML elements instead of a canvas game surface.'],
              sourceRefs: ['SRC-003'],
            }],
            extensionBlocks: [],
          },
        },
        acceptedDiff: {
          id: 'DIFF-009',
          baseSpecVersion: 8,
          targetSpecVersion: 9,
          summary: 'BUG-005 reopened again from accepted artifact.',
          items: [
            {
              id: 'DIFF-009-001',
              targetType: 'feedback',
              targetId: 'BUG-005',
              changeType: 'reopened',
              workImpact: 'requires_loop_work',
              workSurface: 'frontend',
              summary: 'Users still see too many customers after the second fix.',
              sourceRefs: ['SRC-003'],
              sourceEvidence: [{
                sourceRef: 'SRC-003',
                quote: 'кнопку Play не текстом, а той же play-иконкой',
                intent: 'Play is an icon button; visible Play/play text must not remain.',
              }],
            },
            {
              id: 'DIFF-009-002',
              targetType: 'spec',
              targetId: 'REQ-HTML',
              changeType: 'updated',
              workImpact: 'requires_loop_work',
              workSurface: 'frontend',
              summary: 'Game and level UI must move from canvas to HTML elements.',
              sourceRefs: ['SRC-003'],
            },
          ],
        },
        feedback: [{
          id: 'BUG-005',
          title: 'Queue/card readability',
          body: 'Users still see too many customers after the second fix.',
          state: 'reopened',
          reopenCount: 3,
          defaultClosurePolicy: 'loop_claim_is_enough_until_reopened',
          sourceRefs: ['SRC-003'],
        }],
        assumptions: [],
        secretRequirements: [],
        assets: [],
      },
    }],
  }));
}

function plannerBacklogArtifact(options: {
  sourceVersion: number;
  baseSpecVersion?: number;
  workImpact?: 'requires_loop_work' | 'context_only' | 'no_loop_work';
  artifactId?: string;
}): unknown {
  const suffix = String(options.sourceVersion).padStart(3, '0');
  const sourceRef = `SRC-LEGACY-${suffix}`;
  return {
    artifactSchemaVersion: 'ra-287.accepted-spec-artifact.v1',
    artifactId: options.artifactId ?? `SPEC-ARTIFACT-LEGACY-${suffix}`,
    acceptedAt: `2026-07-02T12:${String(options.sourceVersion % 60).padStart(2, '0')}:00.000Z`,
    source: {
      id: sourceRef,
      sourceSystem: 'tg-spec',
      sourceProjectId: 'tg-proj-1',
      sourceVersion: options.sourceVersion,
      sourceRefType: 'accepted_spec',
      sourceId: `tg-spec-version-${options.sourceVersion}`,
    },
    acceptedSpec: {
      id: `SPEC-LEGACY-${suffix}`,
      version: options.sourceVersion,
      contentHash: `sha256:${'c'.repeat(64)}`,
      sourceRefs: [sourceRef],
      document: {
        specSchemaVersion: 'ra-287.spec-document.v1',
        title: 'Legacy backlog fixture',
        sections: [],
        requirements: [],
        extensionBlocks: [],
      },
    },
    acceptedDiff: {
      id: `DIFF-LEGACY-${suffix}`,
      ...(options.baseSpecVersion != null ? { baseSpecVersion: options.baseSpecVersion } : {}),
      targetSpecVersion: options.sourceVersion,
      summary: `Legacy backlog update ${options.sourceVersion}`,
      items: [{
        id: `DIFF-LEGACY-${suffix}-001`,
        targetType: 'spec',
        targetId: `SPEC-LEGACY-${suffix}`,
        changeType: options.artifactId?.startsWith('OPREPAIR:') ? 'accepted' : 'updated',
        workImpact: options.workImpact ?? 'requires_loop_work',
        workSurface: 'frontend',
        summary: `Implement source version ${options.sourceVersion}`,
        sourceRefs: [sourceRef],
      }],
    },
    feedback: [],
    assumptions: [],
    secretRequirements: [],
    assets: [],
  };
}

function writeLegacyOperatorRepairBacklogManifest(workDir: string): void {
  const backlog = [{
    currentVersion: { id: 'spec-version-30', version: 15 },
    source: { system: 'tg-spec', projectId: 'tg-proj-1', version: 30 },
    metadataHash: 'sha256:metadata-30',
    acceptedArtifact: plannerBacklogArtifact({
      sourceVersion: 30,
      workImpact: 'no_loop_work',
      artifactId: 'OPREPAIR:LEGACY-030',
    }),
  }, {
    currentVersion: { id: 'spec-version-37', version: 16 },
    source: { system: 'tg-spec', projectId: 'tg-proj-1', version: 37 },
    metadataHash: 'sha256:metadata-37',
    acceptedArtifact: plannerBacklogArtifact({
      sourceVersion: 37,
      baseSpecVersion: 35,
    }),
  }, {
    currentVersion: { id: 'spec-version-159', version: 102 },
    source: { system: 'tg-spec', projectId: 'tg-proj-1', version: 159 },
    metadataHash: 'sha256:metadata-159',
    acceptedArtifact: plannerBacklogArtifact({
      sourceVersion: 159,
      baseSpecVersion: 37,
    }),
  }, {
    currentVersion: { id: 'spec-version-162', version: 105 },
    source: { system: 'tg-spec', projectId: 'tg-proj-1', version: 162 },
    metadataHash: 'sha256:metadata-162',
    acceptedArtifact: plannerBacklogArtifact({
      sourceVersion: 162,
      baseSpecVersion: 159,
    }),
  }];
  mkdirSync(path.join(workDir, '.arena'), { recursive: true });
  writeFileSync(path.join(workDir, '.arena', 'spec-input.json'), JSON.stringify({
    schemaVersion: 1,
    aggregateHash: 'input-hash-oprepair-cutover',
    specs: [{
      id: 'spec-1',
      slug: 'Spec',
      hash: 'content-hash',
      inputHash: 'input-hash-oprepair-cutover',
      currentVersion: { id: 'spec-version-162', version: 105 },
      metadataHash: 'sha256:metadata-162',
      acceptedArtifact: backlog.at(-1)?.acceptedArtifact,
      acceptedArtifactBacklog: backlog,
    }],
  }));
}

function keepAcceptedDiffItems(workDir: string, itemIds: string[]): void {
  const manifestPath = path.join(workDir, '.arena', 'spec-input.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
  const keep = new Set(itemIds);
  for (const spec of manifest.specs ?? []) {
    const artifact = spec.currentVersion?.acceptedArtifact ?? spec.acceptedArtifact;
    if (!artifact?.acceptedDiff?.items) continue;
    artifact.acceptedDiff.items = artifact.acceptedDiff.items.filter((item: { id?: string }) => (
      item.id && keep.has(item.id)
    ));
  }
  writeFileSync(manifestPath, JSON.stringify(manifest), 'utf-8');
}

function addAddonArtifactToManifest(workDir: string): void {
  const manifestPath = path.join(workDir, '.arena', 'spec-input.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
  manifest.aggregateHash = 'input-hash-v4';
  manifest.specs.push({
    id: 'spec-addon-telegram',
    slug: 'Addon: Telegram Mini App',
    hash: 'addon-content-hash',
    inputHash: 'addon-input-hash',
    currentVersion: {
      id: 'addon-version-1',
      version: 1,
    },
    metadataHash: 'sha256:addon-artifact',
    acceptedArtifact: {
      artifactSchemaVersion: 'ra-287.accepted-spec-artifact.v1',
      artifactId: 'SPEC-ARTIFACT-ARENA-ADDON-TELEGRAM_MINI_APP',
      acceptedAt: '2026-05-29T00:00:00.000Z',
      source: {
        id: 'SRC-ARENA-ADDON-TELEGRAM_MINI_APP',
        sourceSystem: 'arena',
        sourceVersion: 1,
        sourceRefType: 'operator_note',
        sourceId: 'project-addon:telegram_mini_app',
      },
      acceptedSpec: {
        id: 'SPEC-ARENA-ADDON-TELEGRAM_MINI_APP',
        version: 1,
        contentHash: `sha256:${'b'.repeat(64)}`,
        sourceRefs: ['SRC-ARENA-ADDON-TELEGRAM_MINI_APP'],
        document: {
          specSchemaVersion: 'ra-287.spec-document.v1',
          title: 'Telegram Mini App add-on',
          sections: [],
          requirements: [],
          extensionBlocks: [],
        },
      },
      acceptedDiff: {
        id: 'DIFF-ARENA-ADDON-TELEGRAM_MINI_APP',
        targetSpecVersion: 1,
        summary: 'Project add-on selected: Telegram Mini App.',
        items: [{
          id: 'DIFF-ARENA-ADDON-TELEGRAM_MINI_APP-SPEC',
          targetType: 'spec',
          targetId: 'SPEC-ARENA-ADDON-TELEGRAM_MINI_APP',
          changeType: 'created',
          workImpact: 'requires_loop_work',
          summary: 'Implement Telegram Mini App add-on with getMe, setChatMenuButton, and safe TELEGRAM_BOT_TOKEN handling.',
          sourceRefs: ['SRC-ARENA-ADDON-TELEGRAM_MINI_APP'],
        }],
      },
      feedback: [],
      assumptions: [],
      secretRequirements: [{
        id: 'SECRET-ARENA-ADDON-TELEGRAM_MINI_APP-TELEGRAM_BOT_TOKEN',
        key: 'TELEGRAM_BOT_TOKEN',
        description: 'Project-owned Telegram bot token used to expose the preview as a Mini App.',
        required: true,
        blocking: true,
        sourceRefs: ['SRC-ARENA-ADDON-TELEGRAM_MINI_APP'],
      }],
      assets: [],
    },
  });
  writeFileSync(manifestPath, JSON.stringify(manifest), 'utf-8');
}

async function acceptedRequiredItems(workDir: string): Promise<AcceptedArtifactFeedbackItem[]> {
  const context = await readAcceptedArtifactFeedbackContext(workDir);
  assert.ok(context);
  return context.requiredItems;
}

function stripSpecChangeSource(item: AcceptedArtifactFeedbackItem): SpecMigrationFeedbackItem {
  const { specChangeSource, ...requiredItem } = item;
  void specChangeSource;
  return requiredItem;
}

function stripFreshRefs(item: AcceptedArtifactFeedbackItem): SpecMigrationFeedbackItem {
  const requiredItem = stripSpecChangeSource(item);
  delete requiredItem.sourceEvidence;
  delete requiredItem.fingerprint;
  return requiredItem;
}

function reopenedBugSpec(): string {
  return [
    '## Product Spec',
    'Sushi restaurant game.',
    '',
    '## Implementation Gaps',
    '### Open',
    '- BUG-005 (reopened#1): Customer queue/card readability',
    '  - Expected: show only 5-6 customers and keep urgent/VIP customers near the front.',
    '  - Actual: users still see too many customers at once after the previous fix.',
  ].join('\n');
}

function openBugSpec(): string {
  return [
    '## Product Spec',
    'Sushi restaurant game.',
    '',
    '## Implementation Gaps',
    '### Open',
    '- BUG-005: Customer queue/card readability',
    '  - Expected: show only 5-6 customers and keep urgent/VIP customers near the front.',
    '  - Actual: users see too many customers at once.',
  ].join('\n');
}

test('planner prompt tells tiny MVPs to merge low-risk bootstrap UI setup work', () => {
  const planner = new Planner();
  const prompt = (planner as any).buildPlanningPrompt(
    'Build a tiny todo app.',
    {
      name: 'Tiny Todo',
      description: 'Tiny todo app',
      techStack: { language: 'typescript' },
    },
    '',
  );

  assert.match(
    prompt,
    /For tiny MVPs, merge low-risk bootstrap\/UI\/setup work instead of splitting it\./,
  );
});

test('planner dry-run initial plan does not write provider call checkpoint', async () => {
  const { workDir, specPath } = createMigrationWorkDir('# Dry run spec\n');
  const planner = new Planner();
  const agent = new ProviderSessionFakeAgent([{
    success: true,
    output: 'not json',
    filesChanged: [],
    completionPromiseFound: false,
    providerSession: { id: 'session-dry-run' },
  }]);

  const result = await planner.dryRunInitialPlan({
    workDir,
    specPath,
    projectConfig: createProjectConfig(),
    agent,
    model: 'gpt-5-codex',
    verbose: false,
  });

  assert.equal(result.status, 'parse_or_validation_failed');
  assert.equal(existsSync(path.join(workDir, PROVIDER_CALL_CHECKPOINT_RELATIVE_PATH)), false);
});

test('initial plan records required accepted diff dispositions before execution', async () => {
  const { workDir, specPath } = createMigrationWorkDir('# Accepted spec\n');
  writeAcceptedArtifactManifest(workDir);
  const planner = new Planner();
  const planManager = new PlanManager(workDir);
  const judgmentLog = new JudgmentLog(workDir);
  const agent = new FakeAgent([jsonBlock({
    projectGoal: 'Build accepted spec',
    phases: [{
      id: 'phase-1',
      name: 'Implementation',
      description: 'Build the accepted change',
      order: 1,
      status: 'pending',
      planLater: false,
      tasks: [{
        id: 'task-001',
        description: 'Implement current accepted spec: Users still see too many customers after the second fix, and game and level UI must move from canvas to HTML elements.',
        acceptanceCriteria: [
          'Customer queue/card readability is fixed for the reopened frontend feedback.',
          'Gameplay and level UI use HTML elements instead of canvas.',
        ],
        status: 'pending',
        attempts: 0,
        dependencies: [],
      }],
    }],
    judgments: [],
    feedbackDispositions: [
      {
        itemId: 'DIFF-009-001',
        feedbackStatus: 'reopened',
        disposition: 'coveredByOpenTask',
        taskIds: ['task-001'],
        relatedCompletedTaskIds: [],
        evidence: [],
        judgmentIds: [],
        reason: 'The generated initial task carries the reopened queue/card readability outcome.',
      },
      {
        itemId: 'DIFF-009-002',
        feedbackStatus: 'updated',
        disposition: 'coveredByOpenTask',
        taskIds: ['task-001'],
        relatedCompletedTaskIds: [],
        evidence: [],
        judgmentIds: [],
        reason: 'The generated initial task carries the HTML gameplay surface outcome.',
      },
    ],
  })]);

  await planner.createPlan({
    workDir,
    specPath,
    projectConfig: createProjectConfig(),
    agent,
  }, planManager, judgmentLog);

  assert.equal(planManager.currentPlan.specHash, 'runner:input-hash-v3');
  assert.deepEqual(planManager.findTask('task-001')?.feedbackItemRefs?.map((ref) => ref.itemId), [
    'DIFF-009-001',
    'DIFF-009-002',
  ]);
  assert.deepEqual(planManager.getSpecMigrations().map((migration) => ({
    specFile: migration.specFile,
    specHash: migration.specHash,
    required: migration.requiredFeedbackItems?.map((item) => item.itemId),
    dispositions: migration.feedbackDispositions?.map((item) => item.disposition),
  })), [{
    specFile: 'spec.md',
    specHash: 'runner:input-hash-v3',
    required: ['DIFF-009-001', 'DIFF-009-002'],
    dispositions: ['coveredByOpenTask', 'coveredByOpenTask'],
  }]);
});

test('initial plan attaches accepted diff refs without summary text matching', async () => {
  const { workDir, specPath } = createMigrationWorkDir('# Accepted spec\n');
  writeAcceptedArtifactManifest(workDir);
  keepAcceptedDiffItems(workDir, ['DIFF-009-001']);
  const planner = new Planner();
  const planManager = new PlanManager(workDir);
  const judgmentLog = new JudgmentLog(workDir);
  const agent = new FakeAgent([jsonBlock({
    projectGoal: 'Build accepted spec',
    phases: [{
      id: 'phase-1',
      name: 'Implementation',
      description: 'Build the accepted change',
      order: 1,
      status: 'pending',
      planLater: false,
      tasks: [{
        id: 'task-001',
        description: 'Replace the visible text play control with an icon-only affordance in the exercise UI.',
        acceptanceCriteria: [
          'The play affordance is shown as an icon button rather than visible Play/play text.',
          'No separate user-facing Play/play label remains next to the control.',
        ],
        status: 'pending',
        attempts: 0,
        dependencies: [],
      }],
    }],
    judgments: [],
    feedbackDispositions: [
      {
        itemId: 'DIFF-009-001',
        feedbackStatus: 'reopened#3',
        disposition: 'coveredByOpenTask',
        taskIds: ['task-001'],
        relatedCompletedTaskIds: [],
        evidence: [],
        judgmentIds: [],
        reason: 'The generated initial task maps the accepted source-evidence row to executable product work; Ralph attaches the structured ref before execution.',
      },
    ],
  })]);

  await planner.createPlan({
    workDir,
    specPath,
    projectConfig: createProjectConfig(),
    agent,
  }, planManager, judgmentLog);

  const task = planManager.findTask('task-001');
  assert.equal(task?.feedbackItemRefs?.[0]?.itemId, 'DIFF-009-001');
  assert.equal(task?.feedbackItemRefs?.[0]?.summary, 'Users still see too many customers after the second fix. | Queue/card readability');
  assert.equal(task?.feedbackItemRefs?.[0]?.sourceEvidence?.[0]?.intent, 'Play is an icon button; visible Play/play text must not remain.');
});

test('plan revision cannot pre-claim fresh active work', () => {
  const workDir = mkdtempSync(path.join(tmpdir(), 'ralph-planner-revision-'));
  const planner = new Planner();
  const planManager = new PlanManager(workDir);
  const judgmentLog = new JudgmentLog(workDir);
  planManager.createPlan('spec.md', [
    planPhase({
      id: 'phase-1',
      tasks: [planTask({ id: 'task-001', status: 'pending' })],
    }),
  ], [], 'goal');

  assert.throws(
    () => (planner as any).mergePlanRevision(planManager, [
      planPhase({
        id: 'phase-1',
        tasks: [planTask({ id: 'task-002', status: 'in_progress' })],
      }),
    ], [], judgmentLog),
    /mergePlanRevision: task-002 cannot start as in_progress/,
  );
});

test('plan revision cannot remove active WIP', () => {
  const workDir = mkdtempSync(path.join(tmpdir(), 'ralph-planner-revision-'));
  const planner = new Planner();
  const planManager = new PlanManager(workDir);
  const judgmentLog = new JudgmentLog(workDir);
  planManager.createPlan('spec.md', [
    planPhase({
      id: 'phase-1',
      tasks: [planTask({ id: 'task-001', status: 'pending' })],
    }),
  ], [], 'goal');
  planManager.findTask('task-001')!.status = 'in_progress';

  assert.throws(
    () => (planner as any).mergePlanRevision(planManager, [
      planPhase({
        id: 'phase-1',
        tasks: [planTask({ id: 'task-002', status: 'pending' })],
      }),
    ], [], judgmentLog),
    /mergePlanRevision: cannot remove active in_progress task task-001/,
  );
});

test('plan revision preserves active WIP contents and phase status', () => {
  const workDir = mkdtempSync(path.join(tmpdir(), 'ralph-planner-revision-'));
  const planner = new Planner();
  const planManager = new PlanManager(workDir);
  const judgmentLog = new JudgmentLog(workDir);
  planManager.createPlan('spec.md', [
    planPhase({
      id: 'phase-1',
      tasks: [
        planTask({
          id: 'task-001',
          status: 'pending',
          description: 'Original active WIP',
          attempts: 2,
        }),
      ],
    }),
  ], [], 'goal');
  planManager.findTask('task-001')!.status = 'in_progress';

  (planner as any).mergePlanRevision(planManager, [
    planPhase({
      id: 'phase-1',
      status: 'completed',
      tasks: [
        planTask({
          id: 'task-001',
          status: 'completed',
          description: 'Planner tried to rewrite active WIP',
          attempts: 0,
        }),
        planTask({ id: 'task-002', status: 'pending' }),
      ],
    }),
  ], [], judgmentLog);

  const activeTask = planManager.findTask('task-001')!;
  assert.equal(activeTask.status, 'in_progress');
  assert.equal(activeTask.description, 'Original active WIP');
  assert.equal(activeTask.attempts, 2);
  assert.equal(planManager.currentPlan.phases[0].status, 'in_progress');
});

test('spec migration prompt treats current feedback as mandatory accepted truth', () => {
  const planner = new Planner();
  const prompt = (planner as any).buildSpecMigrationPrompt(
    reopenedBugSpec(),
    {
      version: 1,
      specFile: 'spec.md',
      createdAt: '2026-05-14T00:00:00.000Z',
      updatedAt: '2026-05-14T00:00:00.000Z',
      phases: [],
      judgments: [],
      specMigrations: [],
    },
    createProjectConfig(),
    11,
    2,
    'spec.md',
    [{
      itemId: 'BUG-005',
      kind: 'implementation_gap',
      changeType: 'reopened',
      status: 'reopened#1',
      summary: 'Users still see too many customers after the previous fix.',
      fingerprint: 'bug-005-v2',
    }],
  );

  assert.match(prompt, /CURRENT accepted specification/);
  assert.match(prompt, /Required Accepted Diff Work Dispositions/);
  assert.match(prompt, /BUG-005/);
  assert.match(prompt, /completed historical task is context only/i);
  assert.match(prompt, /"feedbackDispositions"/);
});

test('spec migration prompt projects large plans instead of embedding completed task history', () => {
  const { workDir } = createMigrationWorkDir(reopenedBugSpec());
  const planner = new Planner();
  const planManager = new PlanManager(workDir);
  const noisyCompletedTasks = Array.from({ length: 160 }, (_, index) => planTask({
    id: `task-${String(index + 1).padStart(3, '0')}`,
    status: 'completed',
    description: `${index === 0 ? 'OLD-BULK-001 ' : ''}Historical completed task ${index + 1}. ${'Irrelevant implementation detail. '.repeat(260)}`,
    acceptanceCriteria: [`Historical criterion ${index + 1}. ${'Already verified. '.repeat(160)}`],
  }));
  const relevantCompletedTask = planTask({
    id: 'task-200',
    status: 'completed',
    description: 'Previous BUG-005 / DIFF-009-001 fix attempt that is useful context but cannot close current accepted work.',
    acceptanceCriteria: ['BUG-005 historical fix attempt exists.'],
  });
  const openTask = planTask({
    id: 'task-201',
    status: 'pending',
    description: 'Open implementation task that must remain visible to migration planning.',
    acceptanceCriteria: ['Open work remains visible.'],
  });
  planManager.createPlan('spec.md', [
    planPhase({
      id: 'phase-1',
      tasks: [
        ...noisyCompletedTasks,
        relevantCompletedTask,
        openTask,
      ],
    }),
  ], [], 'Large historical plan');
  const fullPlanLength = JSON.stringify(planManager.currentPlan, null, 2).length;
  assert.ok(fullPlanLength > 1_048_576, `expected large plan fixture, got ${fullPlanLength} chars`);

  const prompt = (planner as any).buildSpecMigrationPrompt(
    reopenedBugSpec(),
    planManager.currentPlan,
    createProjectConfig(),
    202,
    1,
    'spec.md',
    [{
      itemId: 'DIFF-009-001',
      diffItemId: 'DIFF-009-001',
      targetType: 'feedback',
      targetId: 'BUG-005',
      kind: 'implementation_gap',
      changeType: 'reopened',
      workImpact: 'requires_loop_work',
      workSurface: 'frontend',
      status: 'reopened#3',
      summary: 'Users still see too many customers after the second fix.',
      sourceRefs: ['SRC-003'],
      sourceEvidence: [{
        sourceRef: 'SRC-003',
        quote: 'кнопку Play не текстом, а той же play-иконкой',
        intent: 'Play is an icon button; visible Play/play text must not remain.',
      }],
      fingerprint: 'bug-005-v3',
    }],
  );

  assert.ok(prompt.length < 300_000, `expected compact migration prompt, got ${prompt.length} chars`);
  assert.match(prompt, /migrationPlannerProjection/);
  assert.match(prompt, /"originalCharCount"/);
  assert.match(prompt, /DIFF-009-001/);
  assert.match(prompt, /task-200/);
  assert.match(prompt, /task-201/);
  assert.doesNotMatch(prompt, /OLD-BULK-001/);
});

test('spec migration prompt constrains closedByEvidence to existing concrete evidence kinds', () => {
  const planner = new Planner();
  const prompt = (planner as any).buildSpecMigrationPrompt(
    openBugSpec(),
    {
      version: 1,
      specFile: 'spec.md',
      createdAt: '2026-05-14T00:00:00.000Z',
      updatedAt: '2026-05-14T00:00:00.000Z',
      phases: [],
      judgments: [],
      specMigrations: [],
    },
    createProjectConfig(),
    11,
    2,
    'spec.md',
    [{
      itemId: 'DIFF-012-ASSET-REMOVED',
      diffItemId: 'DIFF-012-ASSET-REMOVED',
      targetType: 'asset',
      targetId: 'ASSET-OLD-REFERENCE',
      kind: 'accepted_diff:asset',
      changeType: 'removed',
      status: 'removed',
      summary: 'The accepted spec removed an old asset reference.',
      fingerprint: 'asset-removed-v1',
    }],
  );

  assert.match(prompt, /Concrete `closedByEvidence` evidence kinds are:/);
  assert.match(prompt, /"code_inspection"/);
  assert.match(prompt, /Do NOT invent domain-specific `evidence\[\]\.kind` values/);
  assert.match(prompt, /accepted_spec_asset_list/);
  assert.match(prompt, /sourceEvidence` rows, `closedByEvidence` requires product-facing proof/);
  assert.match(prompt, /For removed asset\/reference rows/);
});

test('spec migration parser defaults missing feedbackDispositions to empty array', () => {
  const planner = new Planner();
  const parsed = (planner as any).parseSpecMigrationOutput(jsonBlock({
    summary: 'Legacy output',
    planChanges: [],
    newJudgments: [],
  }));

  assert.deepEqual(parsed.feedbackDispositions, []);
});

test('spec migration rejects current feedback without a disposition', async () => {
  const { workDir, specPath } = createMigrationWorkDir(reopenedBugSpec());
  const planner = new Planner();
  const planManager = new PlanManager(workDir);
  const judgmentLog = new JudgmentLog(workDir);
  seedCompletedBugPlan(planManager);

  const agent = new FakeAgent([jsonBlock({
    summary: 'No changes needed because BUG-005 was already fixed.',
    planChanges: [],
    feedbackDispositions: [],
    newJudgments: [],
  })]);

  await assert.rejects(
    () => planner.applySpecMigration({
      workDir,
      specPath,
      projectConfig: createProjectConfig(),
      agent,
    }, planManager, judgmentLog),
    /missing feedback disposition\(s\): BUG-005/,
  );
  assert.equal(agent.prompts.length, 3);
  assert.equal(planManager.findTask('task-011'), null);
});

test('spec migration does not require legacy open feedback that already has plan work', async () => {
  const { workDir, specPath } = createMigrationWorkDir(openBugSpec());
  const planner = new Planner();
  const planManager = new PlanManager(workDir);
  const judgmentLog = new JudgmentLog(workDir);
  seedCompletedBugPlan(planManager);

  const agent = new FakeAgent([jsonBlock({
    summary: 'No diff-scoped feedback requires new work.',
    planChanges: [],
    feedbackDispositions: [],
    newJudgments: [],
  })]);

  const result = await planner.applySpecMigration({
    workDir,
    specPath,
    projectConfig: createProjectConfig(),
    agent,
  }, planManager, judgmentLog);

  assert.equal(result.requiredFeedbackItems.length, 0);
  assert.equal(result.feedbackDispositions.length, 0);
  assert.match(agent.prompts[0], /No current implementation feedback items require a new disposition/);
  assert.equal(planManager.findTask('task-011'), null);
});

test('spec migration still requires new open feedback without existing plan work', async () => {
  const { workDir, specPath } = createMigrationWorkDir(openBugSpec());
  const planner = new Planner();
  const planManager = new PlanManager(workDir);
  const judgmentLog = new JudgmentLog(workDir);
  planManager.createPlan('spec.md', [{
    id: 'phase-1',
    name: 'Implementation',
    description: 'Build the game',
    order: 1,
    status: 'completed',
    planLater: false,
    tasks: [],
  }], [], 'Build a sushi restaurant game');

  const agent = new FakeAgent([jsonBlock({
    summary: 'No changes needed.',
    planChanges: [],
    feedbackDispositions: [],
    newJudgments: [],
  })]);

  await assert.rejects(
    () => planner.applySpecMigration({
      workDir,
      specPath,
      projectConfig: createProjectConfig(),
      agent,
    }, planManager, judgmentLog),
    /missing feedback disposition\(s\): BUG-005/,
  );
});

test('spec migration records addTask disposition and links current feedback to new task', async () => {
  const { workDir, specPath } = createMigrationWorkDir(reopenedBugSpec());
  const planner = new Planner();
  const planManager = new PlanManager(workDir);
  const judgmentLog = new JudgmentLog(workDir);
  seedCompletedBugPlan(planManager);

  const agent = new FakeAgent([jsonBlock({
    summary: 'Reopened BUG-005 with a follow-up task.',
    planChanges: [{
      action: 'addTask',
      phaseId: 'phase-1',
      task: {
        id: 'task-011',
        description: 'Re-fix BUG-005 queue/card readability from the current accepted feedback.',
        acceptanceCriteria: ['BUG-005 shows only 5-6 visible customers and urgent/VIP customers are near the front.'],
        status: 'pending',
        priority: 3,
        dependencies: [],
        estimatedComplexity: 'medium',
        attempts: 0,
      },
    }],
    feedbackDispositions: [{
      itemId: 'BUG-005',
      feedbackStatus: 'reopened#1',
      disposition: 'addTask',
      taskIds: ['task-011'],
      relatedCompletedTaskIds: ['task-010'],
      evidence: [],
      judgmentIds: [],
      reason: 'Current accepted feedback says the completed historical fix did not resolve BUG-005.',
    }],
    newJudgments: [],
  })]);

  const result = await planner.applySpecMigration({
    workDir,
    specPath,
    projectConfig: createProjectConfig(),
    agent,
  }, planManager, judgmentLog);

  assert.equal(result.requiredFeedbackItems.length, 1);
  assert.equal(result.requiredFeedbackItems[0].itemId, 'BUG-005');
  assert.equal(result.feedbackDispositions.length, 1);
  assert.equal(result.feedbackDispositions[0].disposition, 'addTask');
  assert.equal(result.specChangeSource?.kind, 'extracted_current_feedback');

  const task = planManager.findTask('task-011');
  assert.ok(task);
  const feedbackItemRefs = task.feedbackItemRefs ?? [];
  assert.deepEqual(feedbackItemRefs.map((ref) => ref.itemId), ['BUG-005']);
  assert.equal(feedbackItemRefs[0].specFile, 'spec.md');
  assert.ok(feedbackItemRefs[0].specHash);
  assert.equal(planManager.currentPlan.phases[0].status, 'in_progress');
});

test('spec migration uses accepted artifact manifest as the required feedback packet', async () => {
  const { workDir, specPath } = createMigrationWorkDir(openBugSpec());
  writeAcceptedArtifactManifest(workDir);
  const planner = new Planner();
  const planManager = new PlanManager(workDir);
  const judgmentLog = new JudgmentLog(workDir);
  seedCompletedBugPlan(planManager);

  const agent = new FakeAgent([jsonBlock({
    summary: 'Accepted artifact reopens BUG-005 and requires HTML gameplay UI.',
    planChanges: [
      {
        action: 'addTask',
        phaseId: 'phase-1',
        task: {
          id: 'task-011',
          description: 'Re-fix BUG-005 queue/card readability from DIFF-009-001.',
          acceptanceCriteria: ['Accepted diff outcome is resolved: Users still see too many customers after the second fix.'],
          status: 'pending',
          priority: 3,
          dependencies: [],
          estimatedComplexity: 'medium',
          attempts: 0,
        },
      },
      {
        action: 'addTask',
        phaseId: 'phase-1',
        task: {
          id: 'task-012',
          description: 'Implement DIFF-009-002 REQ-HTML by moving game and level UI from canvas to HTML elements.',
          acceptanceCriteria: ['REQ-HTML is implemented with HTML elements instead of canvas.'],
          status: 'pending',
          priority: 3,
          dependencies: [],
          estimatedComplexity: 'high',
          attempts: 0,
        },
      },
    ],
    feedbackDispositions: [
      {
        itemId: 'DIFF-009-001',
        feedbackStatus: 'reopened#3',
        disposition: 'addTask',
        taskIds: ['task-011'],
        relatedCompletedTaskIds: ['task-010'],
        evidence: [],
        judgmentIds: [],
        reason: 'The accepted artifact says the prior fix did not resolve BUG-005.',
      },
      {
        itemId: 'DIFF-009-002',
        feedbackStatus: 'updated',
        disposition: 'addTask',
        taskIds: ['task-012'],
        relatedCompletedTaskIds: [],
        evidence: [],
        judgmentIds: [],
        reason: 'The accepted diff requires the gameplay UI to move from canvas to HTML elements.',
      },
    ],
    newJudgments: [],
  })]);

  const result = await planner.applySpecMigration({
    workDir,
    specPath,
    projectConfig: createProjectConfig(),
    agent,
  }, planManager, judgmentLog);

  assert.equal(result.specChangeSource?.kind, 'accepted_artifact');
  assert.equal(result.specChangeSource?.projectId, 'tg-proj-1');
  assert.equal(result.specChangeSource?.version, 9);
  assert.equal(result.specChangeSource?.specVersionId, 'spec-version-3');
  assert.equal(result.specChangeSource?.baseVersion, 8);
  assert.equal(result.requiredFeedbackItems.length, 2);
  assert.deepEqual(result.requiredFeedbackItems.map((item) => ({
    itemId: item.itemId,
    targetType: item.targetType,
    targetId: item.targetId,
    workImpact: item.workImpact,
    workSurface: item.workSurface,
    status: item.status,
  })), [
    {
      itemId: 'DIFF-009-001',
      targetType: 'feedback',
      targetId: 'BUG-005',
      workImpact: 'requires_loop_work',
      workSurface: 'frontend',
      status: 'reopened#3',
    },
    {
      itemId: 'DIFF-009-002',
      targetType: 'spec',
      targetId: 'REQ-HTML',
      workImpact: 'requires_loop_work',
      workSurface: 'frontend',
      status: 'updated',
    },
  ]);
  assert.equal(result.requiredFeedbackItems[0].status, 'reopened#3');
  assert.equal(result.requiredFeedbackItems[0].summary, 'Users still see too many customers after the second fix. | Queue/card readability');
  assert.deepEqual(result.requiredFeedbackItems[0].sourceEvidence, [{
    sourceRef: 'SRC-003',
    quote: 'кнопку Play не текстом, а той же play-иконкой',
    intent: 'Play is an icon button; visible Play/play text must not remain.',
  }]);
  const task = planManager.findTask('task-011');
  assert.ok(task);
  assert.equal(task.feedbackItemRefs?.[0]?.itemId, 'DIFF-009-001');
  assert.equal(task.feedbackItemRefs?.[0]?.targetId, 'BUG-005');
  assert.equal(task.feedbackItemRefs?.[0]?.workImpact, 'requires_loop_work');
  assert.equal(task.feedbackItemRefs?.[0]?.workSurface, 'frontend');
  assert.equal(task.feedbackItemRefs?.[0]?.summary, 'Users still see too many customers after the second fix. | Queue/card readability');
  assert.deepEqual(task.feedbackItemRefs?.[0]?.sourceEvidence, [{
    sourceRef: 'SRC-003',
    quote: 'кнопку Play не текстом, а той же play-иконкой',
    intent: 'Play is an icon button; visible Play/play text must not remain.',
  }]);
  assert.equal(task.feedbackItemRefs?.[0]?.specHash, 'runner:input-hash-v3');
  const htmlTask = planManager.findTask('task-012');
  assert.ok(htmlTask);
  assert.equal(htmlTask.feedbackItemRefs?.[0]?.itemId, 'DIFF-009-002');
  assert.equal(htmlTask.feedbackItemRefs?.[0]?.targetType, 'spec');
  assert.equal(htmlTask.feedbackItemRefs?.[0]?.targetId, 'REQ-HTML');
  assert.equal(htmlTask.feedbackItemRefs?.[0]?.workSurface, 'frontend');
  assert.equal(htmlTask.feedbackItemRefs?.[0]?.summary, 'Game and level UI must move from canvas to HTML elements. | HTML gameplay surface: Game and level UI must use HTML elements instead of canvas.');
});

test('accepted artifact requires structured disposition even when open task text names diff ids', async () => {
  const { workDir, specPath } = createMigrationWorkDir(openBugSpec());
  writeAcceptedArtifactManifest(workDir);
  const planner = new Planner();
  const planManager = new PlanManager(workDir);
  const judgmentLog = new JudgmentLog(workDir);
  planManager.createPlan('spec.md', [
    planPhase({
      id: 'phase-1',
      tasks: [planTask({
        id: 'task-001',
        status: 'pending',
        description: 'Already planned DIFF-009-001 and DIFF-009-002 work from the initial accepted spec.',
        acceptanceCriteria: ['Accepted diff outcome is resolved: Users still see too many customers after the second fix.'],
      })],
    }),
  ], [], 'Build current accepted spec');

  const agent = new FakeAgent([jsonBlock({
    summary: 'Open task already covers the accepted diff packet.',
    planChanges: [],
    feedbackDispositions: [
      {
        itemId: 'DIFF-009-001',
        feedbackStatus: 'reopened#3',
        disposition: 'coveredByOpenTask',
        taskIds: ['task-001'],
        relatedCompletedTaskIds: [],
        evidence: [],
        judgmentIds: [],
        reason: 'The open task already covers this feedback diff item.',
      },
      {
        itemId: 'DIFF-009-002',
        feedbackStatus: 'updated',
        disposition: 'coveredByOpenTask',
        taskIds: ['task-001'],
        relatedCompletedTaskIds: [],
        evidence: [],
        judgmentIds: [],
        reason: 'The open task already covers this spec diff item.',
      },
    ],
    newJudgments: [],
  })]);

  const result = await planner.applySpecMigration({
    workDir,
    specPath,
    projectConfig: createProjectConfig(),
    agent,
  }, planManager, judgmentLog);

  assert.deepEqual(result.requiredFeedbackItems.map((item) => item.itemId), ['DIFF-009-001', 'DIFF-009-002']);
  assert.deepEqual(result.feedbackDispositions.map((item) => item.disposition), ['coveredByOpenTask', 'coveredByOpenTask']);
  const taskRefs = planManager.findTask('task-001')?.feedbackItemRefs ?? [];
  assert.deepEqual(taskRefs.map((ref) => ref.itemId), ['DIFF-009-001', 'DIFF-009-002']);
});

test('accepted artifact sourceEvidence rejects open task that carries only diff ids', async () => {
  const { workDir, specPath } = createMigrationWorkDir(openBugSpec());
  writeAcceptedArtifactManifest(workDir);
  const planner = new Planner();
  const planManager = new PlanManager(workDir);
  const judgmentLog = new JudgmentLog(workDir);
  planManager.createPlan('spec.md', [
    planPhase({
      id: 'phase-1',
      tasks: [planTask({
        id: 'task-001',
        status: 'pending',
        description: 'Handle DIFF-009-001.',
        acceptanceCriteria: ['DIFF-009-001 is handled.'],
      })],
    }),
  ], [], 'Build current accepted spec');

  const agent = new FakeAgent([jsonBlock({
    summary: 'Incorrectly treat an id-only task as sourceEvidence coverage.',
    planChanges: [],
    feedbackDispositions: [
      {
        itemId: 'DIFF-009-001',
        feedbackStatus: 'reopened#3',
        disposition: 'coveredByOpenTask',
        taskIds: ['task-001'],
        relatedCompletedTaskIds: [],
        evidence: [],
        judgmentIds: [],
        reason: 'This task names the diff id, but not the product outcome.',
      },
      {
        itemId: 'DIFF-009-002',
        feedbackStatus: 'updated',
        disposition: 'addTask',
        taskIds: ['task-011'],
        relatedCompletedTaskIds: [],
        evidence: [],
        judgmentIds: [],
        reason: 'The second diff item would be handled separately.',
      },
    ],
    newJudgments: [],
  })]);

  await assert.rejects(
    () => planner.applySpecMigration({
      workDir,
      specPath,
      projectConfig: createProjectConfig(),
      agent,
    }, planManager, judgmentLog),
    /does not carry the sourceEvidence product outcome/,
  );
});

test('accepted artifact sourceEvidence accepts open task with matching structured lineage', async () => {
  const { workDir, specPath } = createMigrationWorkDir(openBugSpec());
  writeAcceptedArtifactManifest(workDir);
  keepAcceptedDiffItems(workDir, ['DIFF-009-001']);
  const planner = new Planner();
  const planManager = new PlanManager(workDir);
  const judgmentLog = new JudgmentLog(workDir);
  planManager.createPlan('spec.md', [
    planPhase({
      id: 'phase-1',
      tasks: [planTask({
        id: 'task-001',
        status: 'pending',
        description: 'Handle BUG-005 without restating private source evidence text.',
        acceptanceCriteria: ['BUG-005 is handled.'],
        feedbackItemRefs: [{
          itemId: 'DIFF-009-001',
          diffItemId: 'DIFF-009-001',
          targetType: 'feedback',
          targetId: 'BUG-005',
          changeType: 'reopened',
          summary: 'Previous accepted artifact row for the same product outcome.',
          sourceEvidence: [{
            sourceRef: 'SRC-003',
            quote: 'кнопку Play не текстом, а той же play-иконкой',
            intent: 'Play is an icon button; visible Play/play text must not remain.',
          }],
          fingerprint: 'previous-artifact-hash',
        }],
      })],
    }),
  ], [], 'Build current accepted spec');

  const agent = new FakeAgent([jsonBlock({
    summary: 'Reuse pending task with current sourceEvidence lineage.',
    planChanges: [],
    feedbackDispositions: [{
      itemId: 'DIFF-009-001',
      feedbackStatus: 'reopened#3',
      disposition: 'coveredByOpenTask',
      taskIds: ['task-001'],
      relatedCompletedTaskIds: [],
      evidence: [],
      judgmentIds: [],
      reason: 'The task already has structured lineage for the same sourceEvidence outcome, so Ralph can attach the current artifact ref.',
    }],
    newJudgments: [],
  })]);

  const result = await planner.applySpecMigration({
    workDir,
    specPath,
    projectConfig: createProjectConfig(),
    agent,
  }, planManager, judgmentLog);

  assert.equal(result.feedbackDispositions[0]?.disposition, 'coveredByOpenTask');
  const taskRefs = planManager.findTask('task-001')?.feedbackItemRefs ?? [];
  assert.equal(taskRefs.length, 2);
  assert.equal(taskRefs[1]?.itemId, 'DIFF-009-001');
  assert.notEqual(taskRefs[1]?.fingerprint, 'previous-artifact-hash');
});

test('accepted artifact sourceEvidence can reconcile active WIP through structured refs', async () => {
  const { workDir, specPath } = createMigrationWorkDir(openBugSpec());
  writeAcceptedArtifactManifest(workDir);
  keepAcceptedDiffItems(workDir, ['DIFF-009-001']);
  const planner = new Planner();
  const planManager = new PlanManager(workDir);
  const judgmentLog = new JudgmentLog(workDir);
  planManager.createPlan('spec.md', [
    planPhase({
      id: 'phase-1',
      status: 'in_progress',
      tasks: [planTask({
        id: 'task-055',
        status: 'pending',
        description: 'Fix BUG-005 queue/card readability as the active WIP.',
        acceptanceCriteria: ['BUG-005 queue/card readability is handled.'],
      })],
    }),
  ], [], 'Build current accepted spec');
  planManager.findTask('task-055')!.status = 'in_progress';

  const agent = new FakeAgent([jsonBlock({
    summary: 'Fresh accepted BUG-005 feedback touches active WIP.',
    planChanges: [],
    feedbackDispositions: [{
      itemId: 'DIFF-009-001',
      feedbackStatus: 'reopened#3',
      disposition: 'coveredByOpenTask',
      taskIds: ['task-055'],
      relatedCompletedTaskIds: [],
      evidence: [],
      judgmentIds: [],
      reason: 'The active WIP already owns BUG-005 and must reconcile the fresh accepted feedback.',
    }],
    newJudgments: [],
  })]);

  const result = await planner.applySpecMigration({
    workDir,
    specPath,
    projectConfig: createProjectConfig(),
    agent,
  }, planManager, judgmentLog);

  assert.equal(result.appliedChanges, 0);
  assert.deepEqual(result.feedbackDispositions.map((item) => item.disposition), ['coveredByOpenTask']);

  const activeTask = planManager.findTask('task-055');
  assert.ok(activeTask);
  assert.equal(activeTask.status, 'in_progress');
  assert.equal(activeTask.description, 'Fix BUG-005 queue/card readability as the active WIP.');
  assert.equal(activeTask.feedbackItemRefs?.[0]?.itemId, 'DIFF-009-001');
  assert.equal(activeTask.feedbackItemRefs?.[0]?.targetId, 'BUG-005');
  assert.equal(activeTask.feedbackItemRefs?.[0]?.sourceEvidence?.[0]?.sourceRef, 'SRC-003');
  assert.match(activeTask.feedbackItemRefs?.[0]?.sourceEvidence?.[0]?.intent ?? '', /visible Play\/play text must not remain/);
});

test('spec migration normalizes active WIP update attempts into executor reconciliation', async () => {
  const { workDir, specPath } = createMigrationWorkDir(openBugSpec());
  writeAcceptedArtifactManifest(workDir);
  keepAcceptedDiffItems(workDir, ['DIFF-009-001']);
  const planner = new Planner();
  const planManager = new PlanManager(workDir);
  const judgmentLog = new JudgmentLog(workDir);
  planManager.createPlan('spec.md', [
    planPhase({
      id: 'phase-1',
      status: 'in_progress',
      tasks: [planTask({
        id: 'task-055',
        status: 'pending',
        description: 'Fix BUG-005 queue/card readability as the active WIP.',
        acceptanceCriteria: ['BUG-005 queue/card readability is handled.'],
      })],
    }),
  ], [], 'Build current accepted spec');
  planManager.findTask('task-055')!.status = 'in_progress';

  const agent = new FakeAgent([jsonBlock({
    summary: 'Planner tried to rewrite active WIP for fresh accepted feedback.',
    planChanges: [{
      action: 'updateTask',
      taskId: 'task-055',
      changes: {
        description: 'Rewrite active WIP with the new sourceEvidence product outcome.',
        acceptanceCriteria: ['Visible Play/play text must not remain.'],
      },
    }],
    feedbackDispositions: [{
      itemId: 'DIFF-009-001',
      feedbackStatus: 'reopened#3',
      disposition: 'updateOpenTask',
      taskIds: ['task-055'],
      relatedCompletedTaskIds: [],
      evidence: [],
      judgmentIds: [],
      reason: 'The active task should be updated for the fresh accepted diff.',
    }],
    newJudgments: [],
  })]);

  const result = await planner.applySpecMigration({
    workDir,
    specPath,
    projectConfig: createProjectConfig(),
    agent,
  }, planManager, judgmentLog);

  assert.equal(result.appliedChanges, 0);
  assert.deepEqual(result.feedbackDispositions.map((item) => item.disposition), ['coveredByOpenTask']);
  assert.match(result.feedbackDispositions[0].reason, /Planner cannot mutate active in_progress task/);

  const activeTask = planManager.findTask('task-055');
  assert.ok(activeTask);
  assert.equal(activeTask.status, 'in_progress');
  assert.equal(activeTask.description, 'Fix BUG-005 queue/card readability as the active WIP.');
  assert.deepEqual(activeTask.acceptanceCriteria, ['BUG-005 queue/card readability is handled.']);
  assert.equal(activeTask.feedbackItemRefs?.[0]?.itemId, 'DIFF-009-001');
  assert.equal(activeTask.feedbackItemRefs?.[0]?.specFile, 'spec.md');
  assert.ok(activeTask.feedbackItemRefs?.[0]?.specHash);
  assert.match(activeTask.feedbackItemRefs?.[0]?.sourceEvidence?.[0]?.intent ?? '', /visible Play\/play text must not remain/);
});

test('accepted artifact sourceEvidence addTask may rely on runtime-attached structured refs', async () => {
  const { workDir, specPath } = createMigrationWorkDir(openBugSpec());
  writeAcceptedArtifactManifest(workDir);
  const planner = new Planner();
  const planManager = new PlanManager(workDir);
  const judgmentLog = new JudgmentLog(workDir);
  seedCompletedBugPlan(planManager);

  const agent = new FakeAgent([jsonBlock({
    summary: 'Add a current implementation task from a source-evidence product outcome.',
    planChanges: [{
      action: 'addTask',
      phaseId: 'phase-1',
      task: {
        id: 'task-011',
        description: 'Replace the textual play control with an icon-only play button and remove visible Play/play labels from the user-facing control.',
        acceptanceCriteria: [
          'The play affordance is an icon button rather than visible text.',
          'No user-facing Play/play text remains around the play control.',
        ],
        status: 'pending',
        priority: 3,
        dependencies: [],
        estimatedComplexity: 'medium',
        attempts: 0,
      },
    }],
    feedbackDispositions: [{
      itemId: 'DIFF-009-001',
      feedbackStatus: 'reopened#3',
      disposition: 'addTask',
      taskIds: ['task-011'],
      relatedCompletedTaskIds: ['task-010'],
      evidence: [],
      judgmentIds: [],
      reason: 'The new task carries the source-evidence product outcome in task language; Ralph attaches the structured private sourceEvidence ref during migration.',
    }, {
      itemId: 'DIFF-009-002',
      feedbackStatus: 'updated',
      disposition: 'closedByEvidence',
      taskIds: [],
      relatedCompletedTaskIds: [],
      evidence: [{
        kind: 'code_inspection',
        ref: 'spec.md',
        result: 'pass',
        feedbackItemIds: ['DIFF-009-002'],
        summary: 'The HTML gameplay surface requirement is already present in the accepted spec baseline.',
      }],
      judgmentIds: [],
      reason: 'The non-source-evidence spec row is already closed by accepted-spec inspection.',
    }],
    newJudgments: [],
  })]);

  const result = await planner.applySpecMigration({
    workDir,
    specPath,
    projectConfig: createProjectConfig(),
    agent,
  }, planManager, judgmentLog);

  assert.equal(result.feedbackDispositions[0]?.disposition, 'addTask');
  const task = planManager.findTask('task-011');
  assert.ok(task);
  assert.equal(task.feedbackItemRefs?.[0]?.itemId, 'DIFF-009-001');
  assert.deepEqual(task.feedbackItemRefs?.[0]?.sourceEvidence, [{
    sourceRef: 'SRC-003',
    quote: 'кнопку Play не текстом, а той же play-иконкой',
    intent: 'Play is an icon button; visible Play/play text must not remain.',
  }]);
});

test('accepted artifact stale structured refs do not suppress current fingerprint disposition', async () => {
  const { workDir, specPath } = createMigrationWorkDir(openBugSpec());
  writeAcceptedArtifactManifest(workDir);
  const planner = new Planner();
  const planManager = new PlanManager(workDir);
  const judgmentLog = new JudgmentLog(workDir);
  planManager.createPlan('spec.md', [
    planPhase({
      id: 'phase-1',
      tasks: [planTask({
        id: 'task-001',
        status: 'pending',
        description: 'Open task from an older accepted artifact run covering DIFF-009-001 and DIFF-009-002.',
        acceptanceCriteria: ['Accepted diff outcome is resolved: Users still see too many customers after the second fix.'],
        feedbackItemRefs: [
          {
            itemId: 'DIFF-009-001',
            targetType: 'feedback',
            targetId: 'BUG-005',
            changeType: 'reopened',
            fingerprint: 'stale-fingerprint',
          },
          {
            itemId: 'DIFF-009-002',
            targetType: 'spec',
            targetId: 'REQ-HTML',
            changeType: 'updated',
            fingerprint: 'stale-fingerprint',
          },
        ],
      })],
    }),
  ], [], 'Build current accepted spec');

  const agent = new FakeAgent([jsonBlock({
    summary: 'Current accepted artifact still requires disposition despite stale refs.',
    planChanges: [],
    feedbackDispositions: [
      {
        itemId: 'DIFF-009-001',
        feedbackStatus: 'reopened#3',
        disposition: 'coveredByOpenTask',
        taskIds: ['task-001'],
        relatedCompletedTaskIds: [],
        evidence: [],
        judgmentIds: [],
        reason: 'The current fingerprinted feedback diff is covered by the open task.',
      },
      {
        itemId: 'DIFF-009-002',
        feedbackStatus: 'updated',
        disposition: 'coveredByOpenTask',
        taskIds: ['task-001'],
        relatedCompletedTaskIds: [],
        evidence: [],
        judgmentIds: [],
        reason: 'The current fingerprinted spec diff is covered by the open task.',
      },
    ],
    newJudgments: [],
  })]);

  const result = await planner.applySpecMigration({
    workDir,
    specPath,
    projectConfig: createProjectConfig(),
    agent,
  }, planManager, judgmentLog);

  assert.deepEqual(result.requiredFeedbackItems.map((item) => item.itemId), ['DIFF-009-001', 'DIFF-009-002']);
  const taskRefs = planManager.findTask('task-001')?.feedbackItemRefs ?? [];
  assert.equal(taskRefs.filter((ref) => ref.itemId === 'DIFF-009-001').length, 2);
  assert.equal(taskRefs.filter((ref) => ref.itemId === 'DIFF-009-002').length, 2);
  assert.ok(taskRefs.some((ref) => ref.itemId === 'DIFF-009-001' && ref.fingerprint && ref.fingerprint !== 'stale-fingerprint'));
  assert.ok(taskRefs.some((ref) => ref.itemId === 'DIFF-009-002' && ref.fingerprint && ref.fingerprint !== 'stale-fingerprint'));
});

test('accepted artifact legacy tracked row missing sourceEvidence requires fresh disposition', async () => {
  const { workDir, specPath } = createMigrationWorkDir(openBugSpec());
  writeAcceptedArtifactManifest(workDir);
  const currentItems = await acceptedRequiredItems(workDir);
  const bugItem = currentItems.find((item) => item.itemId === 'DIFF-009-001');
  const htmlItem = currentItems.find((item) => item.itemId === 'DIFF-009-002');
  assert.ok(bugItem);
  assert.ok(htmlItem);

  const planner = new Planner();
  const planManager = new PlanManager(workDir);
  const judgmentLog = new JudgmentLog(workDir);
  seedCompletedBugPlan(planManager);
  planManager.recordSpecMigration('spec.md', 'runner:input-hash-v3', {
    summary: 'Legacy accepted artifact migration lacked current structured refs.',
    requiredFeedbackItems: [
      stripFreshRefs(bugItem),
      stripSpecChangeSource(htmlItem),
    ],
    feedbackDispositions: [{
      itemId: 'DIFF-009-001',
      feedbackStatus: 'reopened#3',
      disposition: 'closedByEvidence',
      taskIds: [],
      relatedCompletedTaskIds: ['task-010'],
      evidence: [{
        kind: 'code_inspection',
        ref: 'task-010',
        feedbackItemIds: ['DIFF-009-001'],
        summary: 'Legacy migration did not carry the source evidence or fingerprint.',
        result: 'pass',
      }],
      judgmentIds: [],
      reason: 'Previous migration was recorded before sourceEvidence became current structured truth.',
    }, {
      itemId: 'DIFF-009-002',
      feedbackStatus: 'updated',
      disposition: 'closedByEvidence',
      taskIds: [],
      relatedCompletedTaskIds: ['task-010'],
      evidence: [{
        kind: 'code_inspection',
        ref: 'task-010',
        feedbackItemIds: ['DIFF-009-002'],
        summary: 'Existing task covered the current HTML requirement.',
        result: 'pass',
      }],
      judgmentIds: [],
      reason: 'Previous migration already handled this accepted item.',
    }],
  });

  const agent = new FakeAgent([jsonBlock({
    summary: 'Refresh the source-evidence feedback ref for the current accepted artifact.',
    planChanges: [{
      action: 'addTask',
      phaseId: 'phase-1',
      task: {
        id: 'task-011',
        description: 'Replace the textual play control with an icon-only play button and remove visible Play/play labels from the user-facing control.',
        acceptanceCriteria: [
          'The play affordance is an icon button rather than visible text.',
          'No user-facing Play/play text remains around the play control.',
        ],
        status: 'pending',
        priority: 3,
        dependencies: [],
        estimatedComplexity: 'medium',
        attempts: 0,
      },
    }],
    feedbackDispositions: [{
      itemId: 'DIFF-009-001',
      feedbackStatus: 'reopened#3',
      disposition: 'addTask',
      taskIds: ['task-011'],
      relatedCompletedTaskIds: ['task-010'],
      evidence: [],
      judgmentIds: [],
      reason: 'The current artifact includes sourceEvidence that the legacy migration did not carry.',
    }],
    newJudgments: [],
  })]);

  const result = await planner.applySpecMigration({
    workDir,
    specPath,
    projectConfig: createProjectConfig(),
    agent,
  }, planManager, judgmentLog);

  assert.deepEqual(result.requiredFeedbackItems.map((item) => item.itemId), ['DIFF-009-001']);
  const taskRef = planManager.findTask('task-011')?.feedbackItemRefs?.[0];
  assert.equal(taskRef?.itemId, 'DIFF-009-001');
  assert.ok(taskRef?.fingerprint);
  assert.deepEqual(taskRef?.sourceEvidence, bugItem.sourceEvidence);
});

test('accepted artifact coveredByOpenTask rejects unrelated open tasks', async () => {
  const { workDir, specPath } = createMigrationWorkDir(openBugSpec());
  writeAcceptedArtifactManifest(workDir);
  const planner = new Planner();
  const planManager = new PlanManager(workDir);
  const judgmentLog = new JudgmentLog(workDir);
  planManager.createPlan('spec.md', [
    planPhase({
      id: 'phase-1',
      tasks: [planTask({
        id: 'task-001',
        status: 'pending',
        description: 'Build unrelated settings screen.',
        acceptanceCriteria: ['Settings screen works'],
      })],
    }),
  ], [], 'Build current accepted spec');

  const agent = new FakeAgent([jsonBlock({
    summary: 'Incorrectly claim unrelated work covers current accepted diff.',
    planChanges: [{
      action: 'addTask',
      phaseId: 'phase-1',
      task: {
        id: 'task-011',
        description: 'Re-fix BUG-005 queue/card readability from DIFF-009-001.',
        acceptanceCriteria: ['Accepted diff outcome is resolved: Users still see too many customers after the second fix.'],
        status: 'pending',
        priority: 3,
        dependencies: [],
        estimatedComplexity: 'medium',
        attempts: 0,
      },
    }],
    feedbackDispositions: [
      {
        itemId: 'DIFF-009-001',
        feedbackStatus: 'reopened#3',
        disposition: 'addTask',
        taskIds: ['task-011'],
        relatedCompletedTaskIds: [],
        evidence: [],
        judgmentIds: [],
        reason: 'The source-evidence row gets a real follow-up task.',
      },
      {
        itemId: 'DIFF-009-002',
        feedbackStatus: 'updated',
        disposition: 'coveredByOpenTask',
        taskIds: ['task-001'],
        relatedCompletedTaskIds: [],
        evidence: [],
        judgmentIds: [],
        reason: 'This should be rejected because the task is unrelated.',
      },
    ],
    newJudgments: [],
  })]);

  await assert.rejects(
    () => planner.applySpecMigration({
      workDir,
      specPath,
      projectConfig: createProjectConfig(),
      agent,
    }, planManager, judgmentLog),
    /coveredByOpenTask with task\(s\) that do not reference the accepted diff item: task-001/,
  );
});

test('accepted artifact manifest applies only to canonical spec.md migration', async () => {
  const { workDir } = createMigrationWorkDir(openBugSpec());
  const specsDir = path.join(workDir, 'specs');
  mkdirSync(specsDir, { recursive: true });
  const secondarySpecPath = path.join(specsDir, '001-spec.md');
  writeFileSync(secondarySpecPath, openBugSpec());
  writeAcceptedArtifactManifest(workDir);
  const planner = new Planner();
  const planManager = new PlanManager(workDir);
  const judgmentLog = new JudgmentLog(workDir);
  seedCompletedBugPlan(planManager);

  const agent = new FakeAgent([jsonBlock({
    summary: 'No diff-scoped feedback requires new work for secondary spec file.',
    planChanges: [],
    feedbackDispositions: [],
    newJudgments: [],
  })]);

  const result = await planner.applySpecMigration({
    workDir,
    specPath: secondarySpecPath,
    projectConfig: createProjectConfig(),
    agent,
  }, planManager, judgmentLog);

  assert.equal(result.specChangeSource?.kind, 'none');
  assert.equal(result.requiredFeedbackItems.length, 0);
  assert.match(agent.prompts[0], /No current implementation feedback items require a new disposition/);
});

test('accepted artifact migration skips already tracked unchanged items while requiring new add-on work', async () => {
  const { workDir, specPath } = createMigrationWorkDir(openBugSpec());
  writeAcceptedArtifactManifest(workDir);
  addAddonArtifactToManifest(workDir);
  const currentItems = await acceptedRequiredItems(workDir);
  const previouslyHandledItems = currentItems
    .filter((item) => item.itemId === 'DIFF-009-001' || item.itemId === 'DIFF-009-002')
    .map((item) => {
      const requiredItem = stripSpecChangeSource(item);
      delete requiredItem.workImpact;
      delete requiredItem.workSurface;
      return {
        ...requiredItem,
        fingerprint: `legacy-transport-bound-${item.itemId}`,
      };
    });
  assert.equal(previouslyHandledItems.length, 2);
  const planner = new Planner();
  const planManager = new PlanManager(workDir);
  const judgmentLog = new JudgmentLog(workDir);
  seedCompletedBugPlan(planManager);
  planManager.recordSpecMigration('spec.md', 'runner:input-hash-v3', {
    summary: 'Previous accepted artifact work was already planned.',
    requiredFeedbackItems: previouslyHandledItems,
    feedbackDispositions: [{
      itemId: 'DIFF-009-001',
      feedbackStatus: 'reopened#3',
      disposition: 'closedByEvidence',
      taskIds: [],
      relatedCompletedTaskIds: ['task-010'],
      evidence: [{
        kind: 'code_inspection',
        ref: 'task-010',
        feedbackItemIds: ['DIFF-009-001'],
        summary: 'Existing task covered the previous reopened feedback requirement.',
        result: 'pass',
      }],
      judgmentIds: [],
      reason: 'Previous migration already handled this accepted item.',
    }, {
      itemId: 'DIFF-009-002',
      feedbackStatus: 'updated',
      disposition: 'closedByEvidence',
      taskIds: [],
      relatedCompletedTaskIds: ['task-010'],
      evidence: [{
        kind: 'code_inspection',
        ref: 'task-010',
        feedbackItemIds: ['DIFF-009-002'],
        summary: 'Existing task covered the previous HTML requirement.',
        result: 'pass',
      }],
      judgmentIds: [],
      reason: 'Previous migration already handled this accepted item.',
    }],
  });

  const agent = new FakeAgent([jsonBlock({
    summary: 'Add Telegram Mini App add-on implementation work.',
    planChanges: [{
      action: 'addTask',
      phaseId: 'phase-1',
      task: {
        id: 'task-011',
        description: 'Implement the Telegram Mini App add-on: call getMe, call setChatMenuButton with ARENA_TELEGRAM_PREVIEW_URL, and remove any API that exposes TELEGRAM_BOT_TOKEN.',
        acceptanceCriteria: [
          'Startup verifies TELEGRAM_BOT_TOKEN with getMe.',
          'Startup configures setChatMenuButton with a web_app URL from ARENA_TELEGRAM_PREVIEW_URL.',
          'No endpoint returns TELEGRAM_BOT_TOKEN to the browser.',
        ],
        status: 'pending',
        priority: 3,
        dependencies: [],
        estimatedComplexity: 'medium',
        attempts: 0,
      },
    }],
    feedbackDispositions: [{
      itemId: 'DIFF-ARENA-ADDON-TELEGRAM_MINI_APP-SPEC',
      feedbackStatus: 'created',
      disposition: 'addTask',
      taskIds: ['task-011'],
      relatedCompletedTaskIds: [],
      evidence: [],
      judgmentIds: [],
      reason: 'The new add-on artifact has no current plan task under the stricter contract.',
    }],
    newJudgments: [],
  })]);

  const result = await planner.applySpecMigration({
    workDir,
    specPath,
    projectConfig: createProjectConfig(),
    agent,
  }, planManager, judgmentLog);

  assert.deepEqual(result.requiredFeedbackItems.map((item) => item.itemId), [
    'DIFF-ARENA-ADDON-TELEGRAM_MINI_APP-SPEC',
  ]);
  assert.equal(result.specChangeSource?.itemCount, 1);
  assert.equal(result.specChangeSource?.system, 'arena');
  assert.equal(result.specChangeSource?.specVersionId, 'addon-version-1');
  assert.equal(result.specChangeSource?.artifactHash, 'sha256:addon-artifact');
  const task = planManager.findTask('task-011');
  assert.ok(task);
  assert.equal(task.feedbackItemRefs?.[0]?.itemId, 'DIFF-ARENA-ADDON-TELEGRAM_MINI_APP-SPEC');
  assert.equal(task.feedbackItemRefs?.[0]?.targetId, 'SPEC-ARENA-ADDON-TELEGRAM_MINI_APP');
  assert.deepEqual(task.feedbackItemRefs?.[0]?.sourceRefs, ['SRC-ARENA-ADDON-TELEGRAM_MINI_APP']);
  assert.equal(task.feedbackItemRefs?.[0]?.specHash, 'runner:input-hash-v4');
});

test('accepted artifact migration treats OPREPAIR backlog history as a legacy cutover', async () => {
  const { workDir, specPath } = createMigrationWorkDir(openBugSpec());
  writeLegacyOperatorRepairBacklogManifest(workDir);
  const planner = new Planner();
  const planManager = new PlanManager(workDir);
  const judgmentLog = new JudgmentLog(workDir);
  seedCompletedBugPlan(planManager);
  planManager.recordSpecMigration('spec.md', 'runner:pre-cutover-159', {
    summary: 'Legacy structured history was already handled before full backlog handoff.',
    specChangeSource: {
      kind: 'accepted_artifact',
      system: 'tg-spec',
      projectId: 'tg-proj-1',
      version: 159,
      itemCount: 1,
    },
    requiredFeedbackItems: [],
    feedbackDispositions: [],
  });

  const agent = new FakeAgent([jsonBlock({
    summary: 'Apply only the post-cutover accepted source version.',
    planChanges: [{
      action: 'addTask',
      phaseId: 'phase-1',
      task: {
        id: 'task-011',
        description: 'Implement source version 162 from the accepted backlog.',
        acceptanceCriteria: ['DIFF-LEGACY-162-001 is implemented.'],
        status: 'pending',
        priority: 3,
        dependencies: [],
        estimatedComplexity: 'medium',
        attempts: 0,
      },
    }],
    feedbackDispositions: [{
      itemId: 'DIFF-LEGACY-162-001',
      feedbackStatus: 'updated',
      disposition: 'addTask',
      taskIds: ['task-011'],
      relatedCompletedTaskIds: [],
      evidence: [],
      judgmentIds: [],
      reason: 'Only v162 is newer than the acknowledged OPREPAIR cutover history.',
    }],
    newJudgments: [],
  })]);

  const result = await planner.applySpecMigration({
    workDir,
    specPath,
    projectConfig: createProjectConfig(),
    agent,
  }, planManager, judgmentLog);

  assert.deepEqual(result.requiredFeedbackItems.map((item) => item.itemId), [
    'DIFF-LEGACY-162-001',
  ]);
  assert.equal(result.specChangeSource?.version, 162);
  assert.equal(result.specChangeSource?.itemCount, 1);
});

test('spec migration accepts addTask dispositions that reference tasks inside an added phase', async () => {
  const { workDir, specPath } = createMigrationWorkDir(openBugSpec());
  writeAcceptedArtifactManifest(workDir);
  const planner = new Planner();
  const planManager = new PlanManager(workDir);
  const judgmentLog = new JudgmentLog(workDir);
  seedCompletedBugPlan(planManager);

  const agent = new FakeAgent([jsonBlock({
    summary: 'Accepted artifact creates a dedicated migration phase.',
    planChanges: [{
      action: 'addPhase',
      phase: {
        id: 'phase-9',
        name: 'HTML Migration',
        description: 'Handle current accepted diff work.',
        order: 9,
        status: 'pending',
        planLater: false,
        tasks: [
          {
            id: 'task-011',
            description: 'Re-fix BUG-005 queue/card readability from DIFF-009-001.',
            acceptanceCriteria: ['Accepted diff outcome is resolved: Users still see too many customers after the second fix.'],
            status: 'pending',
            priority: 3,
            dependencies: [],
            estimatedComplexity: 'medium',
            attempts: 0,
          },
          {
            id: 'task-012',
            description: 'Implement DIFF-009-002 REQ-HTML by moving game and level UI from canvas to HTML elements.',
            acceptanceCriteria: ['REQ-HTML is implemented with HTML elements instead of canvas.'],
            status: 'pending',
            priority: 3,
            dependencies: ['task-011'],
            estimatedComplexity: 'high',
            attempts: 0,
            feedbackItemRefs: [{ itemId: 'MODEL-SUPPLIED-REF' }],
            verificationEvidence: [{
              kind: 'manual_note',
              ref: 'model-output',
              summary: 'Model-supplied evidence must not persist.',
            }],
          },
        ],
      },
    }],
    feedbackDispositions: [
      {
        itemId: 'DIFF-009-001',
        feedbackStatus: 'reopened#3',
        disposition: 'addTask',
        taskIds: ['task-011'],
        relatedCompletedTaskIds: ['task-010'],
        evidence: [],
        judgmentIds: [],
        reason: 'The accepted artifact says the prior BUG-005 fix did not resolve the issue.',
      },
      {
        itemId: 'DIFF-009-002',
        feedbackStatus: 'updated',
        disposition: 'addTask',
        taskIds: ['task-012'],
        relatedCompletedTaskIds: [],
        evidence: [],
        judgmentIds: [],
        reason: 'The accepted diff requires the gameplay UI to move from canvas to HTML elements.',
      },
    ],
    newJudgments: [],
  })]);

  const result = await planner.applySpecMigration({
    workDir,
    specPath,
    projectConfig: createProjectConfig(),
    agent,
  }, planManager, judgmentLog);

  assert.equal(result.feedbackDispositions.length, 2);
  assert.equal(result.feedbackDispositions[1].taskIds?.[0], 'task-012');
  const htmlTask = planManager.findTask('task-012');
  assert.ok(htmlTask);
  assert.equal(htmlTask.feedbackItemRefs?.[0]?.itemId, 'DIFF-009-002');
  assert.equal(htmlTask.feedbackItemRefs?.[0]?.targetType, 'spec');
  assert.equal(htmlTask.feedbackItemRefs?.[0]?.targetId, 'REQ-HTML');
  assert.equal(htmlTask.feedbackItemRefs?.length, 1);
  assert.equal(htmlTask.verificationEvidence, undefined);
});

test('spec migration rejects needsJudgment as the sole disposition for hard accepted spec diff work', async () => {
  const { workDir, specPath } = createMigrationWorkDir(openBugSpec());
  writeAcceptedArtifactManifest(workDir);
  const planner = new Planner();
  const planManager = new PlanManager(workDir);
  const judgmentLog = new JudgmentLog(workDir);
  seedCompletedBugPlan(planManager);

  const agent = new FakeAgent([jsonBlock({
    summary: 'Handle feedback but defer the HTML requirement to a judgment.',
    planChanges: [{
      action: 'addTask',
      phaseId: 'phase-1',
      task: {
        id: 'task-011',
        description: 'Re-fix BUG-005 queue/card readability from DIFF-009-001.',
        acceptanceCriteria: ['Accepted diff outcome is resolved: Users still see too many customers after the second fix.'],
        status: 'pending',
        priority: 3,
        dependencies: [],
        estimatedComplexity: 'medium',
        attempts: 0,
      },
    }],
    feedbackDispositions: [
      {
        itemId: 'DIFF-009-001',
        feedbackStatus: 'reopened#3',
        disposition: 'addTask',
        taskIds: ['task-011'],
        evidence: [],
        judgmentIds: [],
        reason: 'The accepted artifact says the prior fix did not resolve BUG-005.',
      },
      {
        itemId: 'DIFF-009-002',
        feedbackStatus: 'updated',
        disposition: 'needsJudgment',
        taskIds: [],
        evidence: [],
        judgmentIds: ['judgment-002'],
        reason: 'Use a judgment instead of implementing REQ-HTML.',
      },
    ],
    newJudgments: [{
      id: 'judgment-002',
      timestamp: new Date().toISOString(),
      taskId: null,
      ambiguity: 'Whether keeping canvas is acceptable despite REQ-HTML.',
      options: ['Keep canvas', 'Move to HTML elements'],
      chosen: 0,
      reasoning: 'This should not be allowed for hard accepted diff work.',
      madeBy: 'planner',
    }],
  })]);

  await assert.rejects(
    () => planner.applySpecMigration({
      workDir,
      specPath,
      projectConfig: createProjectConfig(),
      agent,
    }, planManager, judgmentLog),
    /uses needsJudgment for hard accepted diff work/,
  );
});

test('spec migration ignores model-supplied runtime-managed feedback fields on added tasks', async () => {
  const { workDir, specPath } = createMigrationWorkDir(reopenedBugSpec());
  const planner = new Planner();
  const planManager = new PlanManager(workDir);
  const judgmentLog = new JudgmentLog(workDir);
  seedCompletedBugPlan(planManager);

  const agent = new FakeAgent([jsonBlock({
    summary: 'Reopened BUG-005 with a follow-up task.',
    planChanges: [{
      action: 'addTask',
      phaseId: 'phase-1',
      task: {
        id: 'task-011',
        description: 'Re-fix BUG-005 queue/card readability from the current accepted feedback.',
        acceptanceCriteria: ['BUG-005 shows only 5-6 visible customers and urgent/VIP customers are near the front.'],
        status: 'pending',
        priority: 3,
        dependencies: [],
        estimatedComplexity: 'medium',
        attempts: 0,
        feedbackItemRefs: ['BUG-005'],
        verificationEvidence: [],
      },
    }],
    feedbackDispositions: [{
      itemId: 'BUG-005',
      feedbackStatus: 'reopened#1',
      disposition: 'addTask',
      taskIds: ['task-011'],
      relatedCompletedTaskIds: ['task-010'],
      evidence: [],
      judgmentIds: [],
      reason: 'Current accepted feedback says the completed historical fix did not resolve BUG-005.',
    }],
    newJudgments: [],
  })]);

  await planner.applySpecMigration({
    workDir,
    specPath,
    projectConfig: createProjectConfig(),
    agent,
  }, planManager, judgmentLog);

  const task = planManager.findTask('task-011');
  assert.ok(task);
  assert.deepEqual(task.feedbackItemRefs?.map((ref) => ref.itemId), ['BUG-005']);
  assert.equal(task.feedbackItemRefs?.[0]?.specFile, 'spec.md');
  assert.deepEqual(task.verificationEvidence, undefined);
});

test('spec migration rejects closedByEvidence without concrete evidence', async () => {
  const { workDir, specPath } = createMigrationWorkDir(reopenedBugSpec());
  const planner = new Planner();
  const planManager = new PlanManager(workDir);
  const judgmentLog = new JudgmentLog(workDir);
  seedCompletedBugPlan(planManager);

  const agent = new FakeAgent([jsonBlock({
    summary: 'Treat BUG-005 as closed.',
    planChanges: [],
    feedbackDispositions: [{
      itemId: 'BUG-005',
      feedbackStatus: 'reopened#1',
      disposition: 'closedByEvidence',
      taskIds: ['task-010'],
      evidence: [],
      reason: 'Completed historical task exists.',
    }],
    newJudgments: [],
  })]);

  await assert.rejects(
    () => planner.applySpecMigration({
      workDir,
      specPath,
      projectConfig: createProjectConfig(),
      agent,
    }, planManager, judgmentLog),
    /closedByEvidence without concrete evidence/,
  );
});

test('spec migration accepts removed asset closure with code inspection evidence', () => {
  const workDir = mkdtempSync(path.join(tmpdir(), 'ralph-planner-migration-'));
  const planner = new Planner();
  const planManager = new PlanManager(workDir);
  seedCompletedBugPlan(planManager);

  const itemId = 'DIFF-012-ASSET-REMOVED';
  const dispositions = (planner as any).validateFeedbackDispositions(
    [{
      itemId,
      diffItemId: itemId,
      targetType: 'asset',
      targetId: 'ASSET-OLD-REFERENCE',
      kind: 'accepted_diff:asset',
      changeType: 'removed',
      status: 'removed',
      summary: 'The accepted spec removed an old asset reference.',
      fingerprint: 'asset-removed-v1',
    }],
    [{
      itemId,
      feedbackStatus: 'removed',
      disposition: 'closedByEvidence',
      taskIds: [],
      relatedCompletedTaskIds: [],
      evidence: [{
        kind: 'code_inspection',
        ref: 'spec.md:Asset References',
        result: 'pass',
        feedbackItemIds: [itemId],
        summary: 'The current accepted spec asset list no longer includes the old asset reference.',
        recordedBy: 'planner',
      }],
      judgmentIds: [],
      reason: 'A removed asset reference needs no product task once the accepted spec absence is inspected.',
    }],
    planManager.currentPlan,
    [],
    [],
  );

  assert.equal(dispositions[0].itemId, itemId);
  assert.equal(dispositions[0].evidence?.[0]?.kind, 'code_inspection');
});

test('spec migration rejects sourceEvidence closure backed only by implementation inspection', () => {
  const workDir = mkdtempSync(path.join(tmpdir(), 'ralph-planner-migration-'));
  const planner = new Planner();
  const planManager = new PlanManager(workDir);
  seedCompletedBugPlan(planManager);

  assert.throws(
    () => (planner as any).validateFeedbackDispositions(
      [{
        itemId: 'DIFF-009-001',
        diffItemId: 'DIFF-009-001',
        targetType: 'feedback',
        targetId: 'BUG-005',
        kind: 'accepted_diff:feedback',
        changeType: 'reopened',
        status: 'reopened#3',
        summary: 'Play is an icon button; visible Play/play text must not remain.',
        sourceEvidence: [{
          sourceRef: 'SRC-003',
          quote: 'кнопку Play не текстом, а той же play-иконкой',
          intent: 'Play is an icon button; visible Play/play text must not remain.',
        }],
        fingerprint: 'source-evidence-v1',
      }],
      [{
        itemId: 'DIFF-009-001',
        feedbackStatus: 'reopened#3',
        disposition: 'closedByEvidence',
        taskIds: [],
        relatedCompletedTaskIds: [],
        evidence: [{
          kind: 'code_inspection',
          ref: 'src/App.tsx',
          result: 'pass',
          feedbackItemIds: ['DIFF-009-001'],
          summary: 'The code no longer renders a Play text label.',
          recordedBy: 'planner',
        }],
        judgmentIds: [],
        reason: 'Implementation inspection alone must not close sourceEvidence.',
      }],
      planManager.currentPlan,
      [],
      [],
    ),
    /sourceEvidence without product-facing proof/,
  );
});

test('spec migration accepts sourceEvidence closure with product-facing proof', () => {
  const workDir = mkdtempSync(path.join(tmpdir(), 'ralph-planner-migration-'));
  const planner = new Planner();
  const planManager = new PlanManager(workDir);
  seedCompletedBugPlan(planManager);

  const itemId = 'DIFF-009-001';
  const dispositions = (planner as any).validateFeedbackDispositions(
    [{
      itemId,
      diffItemId: itemId,
      targetType: 'feedback',
      targetId: 'BUG-005',
      kind: 'accepted_diff:feedback',
      changeType: 'reopened',
      status: 'reopened#3',
      summary: 'Play is an icon button; visible Play/play text must not remain.',
      sourceEvidence: [{
        sourceRef: 'SRC-003',
        quote: 'кнопку Play не текстом, а той же play-иконкой',
        intent: 'Play is an icon button; visible Play/play text must not remain.',
      }],
      fingerprint: 'source-evidence-v1',
    }],
    [{
      itemId,
      feedbackStatus: 'reopened#3',
      disposition: 'closedByEvidence',
      taskIds: [],
      relatedCompletedTaskIds: [],
      evidence: [{
        kind: 'manual_note',
        ref: 'manual:product-review',
        result: 'pass',
        feedbackItemIds: [itemId],
        summary: 'Product review confirms the visible Play/play text is absent and the play affordance is icon-only.',
        recordedBy: 'manual',
      }],
      judgmentIds: [],
      reason: 'Manual product proof verifies the source intent outcome.',
    }],
    planManager.currentPlan,
    [],
    [],
  );

  assert.equal(dispositions[0].itemId, itemId);
  assert.equal(dispositions[0].evidence?.[0]?.kind, 'manual_note');
});

test('spec migration rejects invented evidence kind with concrete-kind guidance', () => {
  const workDir = mkdtempSync(path.join(tmpdir(), 'ralph-planner-migration-'));
  const planner = new Planner();
  const planManager = new PlanManager(workDir);
  seedCompletedBugPlan(planManager);

  assert.throws(
    () => (planner as any).validateFeedbackDispositions(
      [{
        itemId: 'DIFF-012-ASSET-REMOVED',
        diffItemId: 'DIFF-012-ASSET-REMOVED',
        targetType: 'asset',
        targetId: 'ASSET-OLD-REFERENCE',
        kind: 'accepted_diff:asset',
        changeType: 'removed',
        status: 'removed',
        summary: 'The accepted spec removed an old asset reference.',
        fingerprint: 'asset-removed-v1',
      }],
      [{
        itemId: 'DIFF-012-ASSET-REMOVED',
        feedbackStatus: 'removed',
        disposition: 'closedByEvidence',
        evidence: [{
          kind: 'accepted_spec_asset_list',
          ref: 'spec.md:Asset References',
          result: 'pass',
          summary: 'The accepted spec no longer references the asset.',
        }],
        reason: 'Invalid invented kind should be rejected.',
      }],
      planManager.currentPlan,
      [],
      [],
    ),
    /Do not invent domain-specific evidence kinds; use "code_inspection"/,
  );
});

test('spec migration rejects closedByEvidence backed only by failing evidence', async () => {
  const { workDir, specPath } = createMigrationWorkDir(reopenedBugSpec());
  const planner = new Planner();
  const planManager = new PlanManager(workDir);
  const judgmentLog = new JudgmentLog(workDir);
  seedCompletedBugPlan(planManager);

  const agent = new FakeAgent([jsonBlock({
    summary: 'Treat BUG-005 as closed by failed evidence.',
    planChanges: [],
    feedbackDispositions: [{
      itemId: 'BUG-005',
      feedbackStatus: 'reopened#1',
      disposition: 'closedByEvidence',
      taskIds: ['task-010'],
      evidence: [{
        kind: 'manual_note',
        ref: 'manual:bug-005',
        result: 'fail',
        summary: 'Manual verification says BUG-005 is still broken.',
      }],
      reason: 'This should not close.',
    }],
    newJudgments: [],
  })]);

  await assert.rejects(
    () => planner.applySpecMigration({
      workDir,
      specPath,
      projectConfig: createProjectConfig(),
      agent,
    }, planManager, judgmentLog),
    /closedByEvidence without concrete evidence/,
  );
});
