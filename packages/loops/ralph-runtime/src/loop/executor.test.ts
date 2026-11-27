import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { ProjectConfigSchema, RalphConfigSchema } from '../config/types.js';
import { ControllerAuditFailure } from '../control/controller.js';
import { readAcceptedArtifactFeedbackContext } from '../feedback/spec-input.js';
import { VISUAL_WORKBENCH_AUTOMATION_OWNER_BOUNDARY } from '../verification/visual-workbench-automation.js';
import { LoopExecutor } from './executor.js';

const mockCodexCliPath = fileURLToPath(new URL('../agents/fixtures/mock-codex-cli.mjs', import.meta.url));
const mockClaudeCliPath = fileURLToPath(new URL('../agents/fixtures/mock-claude-cli.mjs', import.meta.url));
const mockOpenCodeCliPath = fileURLToPath(new URL('../agents/fixtures/mock-opencode-cli.mjs', import.meta.url));

function jsonBlock(value: unknown): string {
  return `\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\``;
}

function completionOutput(prefix = 'implemented'): string {
  return `${`${prefix} `.repeat(20)}\n<promise>TASK_COMPLETE</promise>`;
}

function buildSequencedAgent(outputs: string[]) {
  let outputIndex = 0;
  return {
    name: 'fake-agent',
    async execute(_options: unknown) {
      const output = outputs[Math.min(outputIndex, outputs.length - 1)] ?? jsonBlock({});
      outputIndex += 1;
      return {
        success: true,
        output,
        changedFiles: [],
      };
    },
    async isAvailable() {
      return true;
    },
    async getVersion() {
      return 'test';
    },
  };
}

function acceptedArtifactFixture(
  workImpact: 'requires_loop_work' | 'context_only' | 'no_loop_work' = 'requires_loop_work',
  sourceVersion = 1,
): Record<string, unknown> {
  const suffix = String(sourceVersion).padStart(3, '0');
  const sourceRef = sourceVersion === 1 ? 'SRC-FIXTURE-001' : `SRC-FIXTURE-${suffix}`;
  const diffId = sourceVersion === 1 ? 'DIFF-001' : `DIFF-${suffix}`;
  const reqId = sourceVersion === 1 ? 'REQ-001' : `REQ-${suffix}`;
  const minute = String(sourceVersion % 60).padStart(2, '0');
  return {
    artifactSchemaVersion: 'ra-287.accepted-spec-artifact.v1',
    artifactId: sourceVersion === 1 ? 'SPEC-FIXTURE-001' : `SPEC-FIXTURE-${suffix}`,
    acceptedAt: sourceVersion === 1 ? '2026-05-16T12:00:00.000Z' : `2026-07-02T10:${minute}:00.000Z`,
    source: {
      id: sourceRef,
      sourceSystem: 'tg-spec',
      sourceProjectId: 'tg-proj-1',
      sourceVersion,
      sourceRefType: 'accepted_spec',
      sourceId: `tg-spec-version-${sourceVersion}`,
    },
    acceptedSpec: {
      id: sourceVersion === 1 ? 'SPEC-FIXTURE-001' : `SPEC-FIXTURE-${suffix}`,
      version: sourceVersion,
      contentHash: `sha256:${'a'.repeat(64)}`,
      sourceRefs: [sourceRef],
      document: {
        specSchemaVersion: 'ra-287.spec-document.v1',
        title: 'Accepted spec fixture',
        sections: [],
        requirements: [{
          id: reqId,
          kind: 'functional',
          title: 'Accepted product change',
          statement: 'Implement the accepted product change.',
          priority: 'normal',
          acceptanceCriteria: ['The accepted product change is implemented.'],
          sourceRefs: [sourceRef],
        }],
        extensionBlocks: [],
      },
    },
    acceptedDiff: {
      id: diffId,
      ...(sourceVersion > 1 ? { baseSpecVersion: sourceVersion - 1 } : {}),
      targetSpecVersion: sourceVersion,
      summary: 'Accepted product change.',
      items: [{
        id: `${diffId}-REQ-001`,
        targetType: 'spec',
        targetId: reqId,
        changeType: 'created',
        workImpact,
        summary: 'Accepted product change.',
        sourceRefs: [sourceRef],
      }],
    },
    feedback: [],
    assumptions: [],
    secretRequirements: [],
    assets: [],
  };
}

function setExecutorAgent(
  executor: unknown,
  execute: (options: any) => Promise<any>,
): void {
  (executor as any).agent = {
    name: 'fake-agent',
    execute,
    isAvailable: async () => true,
    getVersion: async () => 'test',
  };
}

function buildExecutor(
  workDir: string,
  specPath?: string,
  agent: 'claude-code' | 'codex' | 'opencode' = 'claude-code',
  opts?: { controllerEnabled?: boolean; autoCommit?: boolean; autoPush?: boolean; useDefaultAgent?: boolean },
): LoopExecutor {
  const ralphConfig = RalphConfigSchema.parse({
    agent,
    model: agent === 'opencode' ? 'opencode/deepseek-v4-flash-free' : undefined,
    autoCommit: opts?.autoCommit ?? false,
    autoPush: opts?.autoPush ?? false,
    controller: { enabled: opts?.controllerEnabled ?? false },
    visionQA: { enabled: false },
  });
  const projectConfig = ProjectConfigSchema.parse({
    name: 'demo-project',
    description: 'demo',
    techStack: { language: 'typescript', framework: 'node' },
    repository: { url: '', branch: 'main', deployBranch: 'main' },
  });

  const executor = new LoopExecutor({
    workDir,
    ralphConfig,
    projectConfig,
    specPath,
  });
  if (agent !== 'codex' && !opts?.useDefaultAgent) {
    setExecutorAgent(executor, async () => ({
      success: true,
      output: '',
      filesChanged: [],
      completionPromiseFound: false,
    }));
  }
  (executor as any).resolveCurrentGitHeadRef = async () => 'head-sha';
  (executor as any).readExecutorGitStatusLines = async () => [];
  return executor;
}

function setExecutorGitStatusSequence(
  executor: unknown,
  statuses: Array<string[] | null>,
): void {
  const queue = statuses.map((status) => status == null ? null : [...status]);
  (executor as any).readExecutorGitStatusLines = async () => {
    if (queue.length > 1) {
      return queue.shift() ?? null;
    }
    return queue[0] ?? null;
  };
}

function gitStatusForChangedFiles(files: string[]): string[] {
  return files.map((file) => `?? ${file}`);
}

function controllerReportFixture(verdict: 'continue' | 'revise' = 'continue') {
  return {
    id: 'report-001',
    timestamp: '2026-06-05T00:00:00.000Z',
    trigger: 'startup',
    verdict,
    summary: 'Controller audit fixture.',
    planChanges: [],
    newJudgments: [],
    revisedJudgments: [],
  };
}

async function withMockCodexScenario<T>(scenario: string, fn: () => Promise<T>): Promise<T> {
  const previousCodexBin = process.env.ARENA_CODEX_BIN;
  const previousScenario = process.env.ARENA_MOCK_CODEX_SCENARIO;

  process.env.ARENA_CODEX_BIN = mockCodexCliPath;
  process.env.ARENA_MOCK_CODEX_SCENARIO = scenario;

  try {
    return await fn();
  } finally {
    if (previousCodexBin === undefined) {
      delete process.env.ARENA_CODEX_BIN;
    } else {
      process.env.ARENA_CODEX_BIN = previousCodexBin;
    }
    if (previousScenario === undefined) {
      delete process.env.ARENA_MOCK_CODEX_SCENARIO;
    } else {
      process.env.ARENA_MOCK_CODEX_SCENARIO = previousScenario;
    }
  }
}

async function withMockClaudeScenario<T>(scenario: string, fn: () => Promise<T>): Promise<T> {
  const previousClaudeBin = process.env.ARENA_CLAUDE_BIN;
  const previousScenario = process.env.ARENA_MOCK_CLAUDE_SCENARIO;

  process.env.ARENA_CLAUDE_BIN = mockClaudeCliPath;
  process.env.ARENA_MOCK_CLAUDE_SCENARIO = scenario;

  try {
    return await fn();
  } finally {
    if (previousClaudeBin === undefined) {
      delete process.env.ARENA_CLAUDE_BIN;
    } else {
      process.env.ARENA_CLAUDE_BIN = previousClaudeBin;
    }
    if (previousScenario === undefined) {
      delete process.env.ARENA_MOCK_CLAUDE_SCENARIO;
    } else {
      process.env.ARENA_MOCK_CLAUDE_SCENARIO = previousScenario;
    }
  }
}

async function withMockOpenCodeScenario<T>(scenario: string, fn: () => Promise<T>): Promise<T> {
  const previousOpenCodeBin = process.env.ARENA_OPENCODE_BIN;
  const previousScenario = process.env.ARENA_MOCK_OPENCODE_SCENARIO;
  process.env.ARENA_OPENCODE_BIN = mockOpenCodeCliPath;
  process.env.ARENA_MOCK_OPENCODE_SCENARIO = scenario;
  try {
    return await fn();
  } finally {
    if (previousOpenCodeBin === undefined) delete process.env.ARENA_OPENCODE_BIN;
    else process.env.ARENA_OPENCODE_BIN = previousOpenCodeBin;
    if (previousScenario === undefined) delete process.env.ARENA_MOCK_OPENCODE_SCENARIO;
    else process.env.ARENA_MOCK_OPENCODE_SCENARIO = previousScenario;
  }
}

test('executor writes FAILED result.json when bootstrap dies before finalize', async () => {
  const workDir = mkdtempSync(path.join(tmpdir(), 'ralph-executor-'));
  const executor = buildExecutor(workDir) as any;

  executor.initialize = async () => {
    throw new Error('Your organization does not have access to Claude');
  };

  await assert.rejects(() => executor.run(), /does not have access to Claude/);

  const resultPath = path.join(workDir, '.arena', 'result.json');
  const result = JSON.parse(readFileSync(resultPath, 'utf-8'));
  assert.deepEqual(result, {
    status: 'FAILED',
    reason: 'Your organization does not have access to Claude',
  });
});

test('gracefulShutdown parks as CANCELED + pauseReason instead of failed', async () => {
  const workDir = mkdtempSync(path.join(tmpdir(), 'ralph-executor-shutdown-'));
  mkdirSync(path.join(workDir, '.arena'), { recursive: true });

  const executor = buildExecutor(workDir) as any;
  await executor.progress.load();
  executor.setState('coding');

  await executor.gracefulShutdown();

  const result = JSON.parse(readFileSync(path.join(workDir, '.arena', 'result.json'), 'utf-8'));
  const progress = JSON.parse(readFileSync(path.join(workDir, '.arena', 'progress.json'), 'utf-8'));

  assert.deepEqual(result, {
    status: 'CANCELED',
    reason: 'Interrupted by signal — awaiting resume',
    pauseReason: 'INFRA',
  });
  assert.equal(progress.state, 'paused_infra');
  assert.equal(progress.message, 'Interrupted by signal — awaiting resume');
  assert.equal(executor.state, 'idle');
  assert.equal(executor.exitReason, 'paused');
  assert.equal(executor.pauseReason, 'infra');
});

test('writeTerminalResult preserves provider retryAt for rate-limit pauses', async () => {
  const workDir = mkdtempSync(path.join(tmpdir(), 'ralph-executor-rate-limit-retry-at-'));
  mkdirSync(path.join(workDir, '.arena'), { recursive: true });

  const executor = buildExecutor(workDir) as any;
  executor.exitReason = 'paused';
  executor.pauseReason = 'rate_limit';
  executor.pauseRetryAt = '2026-04-22T19:00:00.000Z';
  executor.resolveTerminalStatus = () => 'CANCELED';
  executor.resolveTerminalReason = () => 'Agent hit provider rate limit. Auto-retry at 2026-04-22T19:00:00.000Z (provider reset).';

  await executor.writeTerminalResult();

  const result = JSON.parse(readFileSync(path.join(workDir, '.arena', 'result.json'), 'utf-8'));
  assert.deepEqual(result, {
    status: 'CANCELED',
    reason: 'Agent hit provider rate limit. Auto-retry at 2026-04-22T19:00:00.000Z (provider reset).',
    pauseReason: 'RATE_LIMIT',
    retryAt: '2026-04-22T19:00:00.000Z',
  });
});

test('gracefulShutdown adopts platform stop-request budget reason', async () => {
  const workDir = mkdtempSync(path.join(tmpdir(), 'ralph-executor-budget-stop-request-'));
  mkdirSync(path.join(workDir, '.arena'), { recursive: true });
  writeFileSync(
    path.join(workDir, '.arena', 'stop-request.json'),
    JSON.stringify({ reason: 'budget_exhausted', pauseReason: 'BUDGET' }),
  );

  const executor = buildExecutor(workDir) as any;
  await executor.progress.load();
  executor.setState('coding');

  await executor.gracefulShutdown();

  const result = JSON.parse(readFileSync(path.join(workDir, '.arena', 'result.json'), 'utf-8'));
  const progress = JSON.parse(readFileSync(path.join(workDir, '.arena', 'progress.json'), 'utf-8'));

  assert.deepEqual(result, {
    status: 'CANCELED',
    reason: 'Budget threshold reached — awaiting resume',
    pauseReason: 'BUDGET',
  });
  assert.equal(progress.state, 'paused_budget');
  assert.equal(progress.message, 'Budget threshold reached — awaiting resume');
  assert.equal(existsSync(path.join(workDir, '.arena', 'stop-request.json')), false);
  assert.equal(executor.pauseReason, 'budget');
});

test('gracefulShutdown adopts platform stop-request manual interruption', async () => {
  const workDir = mkdtempSync(path.join(tmpdir(), 'ralph-executor-manual-stop-request-'));
  mkdirSync(path.join(workDir, '.arena'), { recursive: true });
  writeFileSync(
    path.join(workDir, '.arena', 'stop-request.json'),
    JSON.stringify({ reason: 'agent_off', interruption: 'manual' }),
  );

  const executor = buildExecutor(workDir) as any;
  await executor.progress.load();
  executor.setState('coding');

  await executor.gracefulShutdown();

  const result = JSON.parse(readFileSync(path.join(workDir, '.arena', 'result.json'), 'utf-8'));
  const progress = JSON.parse(readFileSync(path.join(workDir, '.arena', 'progress.json'), 'utf-8'));

  assert.deepEqual(result, {
    status: 'CANCELED',
    reason: 'Agent stopped by operator — awaiting resume',
  });
  assert.equal(progress.state, 'paused_manual');
  assert.equal(progress.message, 'Agent stopped by operator — awaiting resume');
  assert.equal(existsSync(path.join(workDir, '.arena', 'stop-request.json')), false);
});

test('completed unchanged plan exits without final controller on restore', async () => {
  const workDir = mkdtempSync(path.join(tmpdir(), 'ralph-executor-completed-restore-'));
  const specPath = path.join(workDir, 'spec.md');
  writeFileSync(specPath, '# Completed project\n\nNo new work.\n');

  const executor = buildExecutor(workDir, specPath, 'claude-code', { controllerEnabled: true }) as any;
  executor.agent = buildSequencedAgent([]);

  const specHash = await executor.planManager.computeSpecHash(specPath);
  executor.planManager.createPlan('spec.md', [{
    id: 'phase-1',
    name: 'Done',
    description: 'Already implemented work.',
    order: 1,
    status: 'completed',
    planLater: false,
    tasks: [{
      id: 'task-001',
      description: 'Already completed task.',
      acceptanceCriteria: ['The task is complete.'],
      status: 'completed',
      attempts: 0,
      dependencies: [],
    }],
  }], [], 'Completed project');
  executor.planManager.currentPlan.specHash = specHash;
  executor.planManager.recordSpecMigration('spec.md', specHash, 'Completed spec already applied');
  await executor.planManager.save();

  let executionLoops = 0;
  let controllerRuns = 0;
  let finalized = false;
  let watchRuns = 0;

  executor.runExecutionLoop = async () => {
    executionLoops++;
  };
  executor.runController = async () => {
    controllerRuns++;
    return controllerReportFixture('continue');
  };
  executor.finalize = async () => {
    finalized = true;
    assert.equal(executor.state, 'completed');
  };
  executor.watchForNewSpecs = async () => {
    watchRuns++;
    return false;
  };

  await executor.run();

  assert.equal(executionLoops, 0);
  assert.equal(controllerRuns, 0);
  assert.equal(finalized, true);
  assert.equal(watchRuns, 1);
  assert.equal(executor.state, 'completed');
});

test('gracefulShutdown flushes verification interruption into plan.json', async () => {
  const workDir = mkdtempSync(path.join(tmpdir(), 'ralph-executor-verification-shutdown-'));
  const specPath = path.join(workDir, 'spec.md');
  mkdirSync(path.join(workDir, '.arena'), { recursive: true });
  writeFileSync(specPath, '# Demo spec\n');

  const executor = buildExecutor(workDir, specPath) as any;
  const planTask = {
    id: 'task-1',
    description: 'Ship the feature',
    acceptanceCriteria: ['It works'],
    status: 'pending',
    attempts: 1,
    dependencies: [],
  };
  executor.planManager.createPlan('spec.md', [
    {
      id: 'phase-1',
      name: 'Phase 1',
      description: 'demo',
      order: 1,
      status: 'in_progress',
      tasks: [planTask],
      planLater: false,
    },
  ], [], 'goal');
  executor.currentTask = executor.planManager.currentPlan.phases[0].tasks[0];
  executor.currentTask.status = 'in_progress';
  executor.setState('verification');
  await executor.progress.load();

  await executor.gracefulShutdown();

  const result = JSON.parse(readFileSync(path.join(workDir, '.arena', 'result.json'), 'utf-8'));
  const persisted = JSON.parse(readFileSync(path.join(workDir, '.ralph', 'plan.json'), 'utf-8'));

  assert.deepEqual(result, {
    status: 'CANCELED',
    reason: 'Verification interrupted by signal before completion',
    pauseReason: 'INFRA',
  });
  assert.equal(persisted.phases[0].tasks[0].status, 'in_progress');
  assert.equal(
    persisted.phases[0].tasks[0].lastError,
    'Verification interrupted by signal before completion',
  );
});

test('markTaskComplete clears stale task lastError in plan.json', async () => {
  const workDir = mkdtempSync(path.join(tmpdir(), 'ralph-executor-complete-clears-error-'));
  const specPath = path.join(workDir, 'spec.md');
  writeFileSync(specPath, '# Demo spec\n');

  const executor = buildExecutor(workDir, specPath) as any;
  await executor.progress.load();
  executor.planManager.createPlan('spec.md', [
    {
      id: 'phase-1',
      name: 'Phase 1',
      description: 'demo',
      order: 1,
      status: 'in_progress',
      tasks: [{
        id: 'task-1',
        description: 'Resume after provider limit',
        acceptanceCriteria: ['It works'],
        status: 'pending',
        attempts: 0,
        dependencies: [],
      }],
      planLater: false,
    },
  ], [], 'goal');
  executor.currentTask = executor.planManager.currentPlan.phases[0].tasks[0];
  executor.currentTask.status = 'in_progress';
  executor.currentTask.lastError = "You've hit your session limit · resets 5:40pm (UTC)";

  executor.markTaskComplete();
  await executor.flushTaskStateNow();

  const persisted = JSON.parse(readFileSync(path.join(workDir, '.ralph', 'plan.json'), 'utf-8'));

  assert.equal(persisted.phases[0].tasks[0].status, 'completed');
  assert.equal('lastError' in persisted.phases[0].tasks[0], false);
});

test('watchForNewSpecs clears stale result.json while entering idle watch', async () => {
  const workDir = mkdtempSync(path.join(tmpdir(), 'ralph-executor-idle-'));
  const specPath = path.join(workDir, 'spec.md');
  mkdirSync(path.join(workDir, '.arena'), { recursive: true });
  writeFileSync(specPath, '# Demo spec\n');
  writeFileSync(
    path.join(workDir, '.arena', 'result.json'),
    JSON.stringify({ status: 'DEPLOYED', reason: 'stale' }),
  );

  const executor = buildExecutor(workDir, specPath) as any;
  await executor.progress.load();
  executor.terminated = true;

  const resumed = await executor.watchForNewSpecs();

  assert.equal(resumed, false);
  assert.equal(executor.state, 'idle');
  assert.equal(existsSync(path.join(workDir, '.arena', 'result.json')), false);
});

test('spec-dir resolves to canonical workDir/spec.md instead of .ralph temp state', async () => {
  const workDir = mkdtempSync(path.join(tmpdir(), 'ralph-executor-specdir-'));
  const specsDir = path.join(workDir, 'specs');
  mkdirSync(specsDir, { recursive: true });
  writeFileSync(path.join(specsDir, '001-alpha.md'), '# Alpha\n\nOne\n');
  writeFileSync(path.join(specsDir, '002-beta.md'), '# Beta\n\nTwo\n');

  const executor = buildExecutor(workDir) as any;
  const resolved = await executor.resolveSpecDir(specsDir);

  assert.equal(resolved, path.join(workDir, 'spec.md'));
  assert.equal(existsSync(path.join(workDir, '.ralph', 'combined-spec.md')), false);
  const content = readFileSync(resolved, 'utf-8');
  assert.match(content, /# Alpha/);
  assert.match(content, /# Beta/);
});

test('metadata-aware runner spec input uses canonical spec.md as the only migration identity', async () => {
  const workDir = mkdtempSync(path.join(tmpdir(), 'ralph-executor-canonical-spec-'));
  const specPath = path.join(workDir, 'spec.md');
  const specsDir = path.join(workDir, 'specs');
  mkdirSync(path.join(workDir, '.arena'), { recursive: true });
  mkdirSync(specsDir, { recursive: true });
  writeFileSync(specPath, '<!-- spec: 001-evolution.md -->\n# Accepted spec\n');
  writeFileSync(path.join(specsDir, '001-evolution.md'), '# Accepted spec\n');
  writeFileSync(path.join(workDir, '.arena', 'spec-input.json'), JSON.stringify({
    schemaVersion: 1,
    aggregateHash: 'accepted-input-hash',
    specs: [{
      id: 'spec-1',
      slug: '001-evolution',
      hash: 'content-hash',
      inputHash: 'accepted-input-hash',
      metadataHash: 'sha256:metadata',
      acceptedArtifact: acceptedArtifactFixture(),
    }],
  }));

  const executor = buildExecutor(workDir, specPath) as any;
  executor.planManager.createPlan('spec.md', [{
    id: 'phase-1',
    name: 'Implementation',
    description: 'done',
    order: 1,
    status: 'completed',
    tasks: [{
      id: 'task-001',
      description: 'Already done',
      acceptanceCriteria: ['done'],
      status: 'completed',
      attempts: 0,
      dependencies: [],
    }],
    planLater: false,
  }], [], 'goal');
  executor.planManager.recordSpecMigration('spec.md', 'runner:accepted-input-hash', {
    specChangeSource: { kind: 'accepted_artifact', itemCount: 0 },
  });

  assert.equal(await executor.hasPendingSpecMigrations(specPath), false);
});

test('metadata-aware runner spec input applies migration once for canonical spec.md', async () => {
  const workDir = mkdtempSync(path.join(tmpdir(), 'ralph-executor-canonical-apply-'));
  const specPath = path.join(workDir, 'spec.md');
  const specsDir = path.join(workDir, 'specs');
  mkdirSync(path.join(workDir, '.arena'), { recursive: true });
  mkdirSync(specsDir, { recursive: true });
  writeFileSync(specPath, '<!-- spec: 001-evolution.md -->\n# Accepted spec\n');
  writeFileSync(path.join(specsDir, '001-evolution.md'), '# Accepted spec\n');
  writeFileSync(path.join(workDir, '.arena', 'spec-input.json'), JSON.stringify({
    schemaVersion: 1,
    aggregateHash: 'accepted-input-hash',
    specs: [{
      id: 'spec-1',
      slug: '001-evolution',
      hash: 'content-hash',
      inputHash: 'accepted-input-hash',
      metadataHash: 'sha256:metadata',
      acceptedArtifact: acceptedArtifactFixture(),
    }],
  }));

  const executor = buildExecutor(workDir, specPath) as any;
  executor.planManager.createPlan('spec.md', [{
    id: 'phase-1',
    name: 'Implementation',
    description: 'demo',
    order: 1,
    status: 'pending',
    tasks: [],
    planLater: false,
  }], [], 'goal');
  executor.syncProgressFeaturesFromPlan = () => {};
  executor.progress.save = async () => {};
  const migratedSpecs: string[] = [];
  executor.planner.applySpecMigration = async ({ specPath: migratedSpecPath }: { specPath: string }) => {
    migratedSpecs.push(path.relative(workDir, migratedSpecPath));
    return {
      summary: 'Canonical accepted spec migration',
      appliedChanges: 0,
      errors: [],
      newJudgments: 0,
      specChangeSource: { kind: 'accepted_artifact', itemCount: 0 },
      requiredFeedbackItems: [],
      feedbackDispositions: [],
    };
  };

  const applied = await executor.applyPendingSpecMigrations(specPath);

  assert.equal(applied, true);
  assert.deepEqual(migratedSpecs, ['spec.md']);
  assert.deepEqual(executor.planManager.getSpecMigrations().map((m: any) => ({
    specFile: m.specFile,
    specHash: m.specHash,
  })), [{
    specFile: 'spec.md',
    specHash: 'runner:accepted-input-hash',
  }]);
});

test('spec migration commits materialized accepted spec inputs before executor work', async () => {
  const workDir = mkdtempSync(path.join(tmpdir(), 'ralph-executor-spec-input-source-delivery-'));
  const specPath = path.join(workDir, 'spec.md');
  const specsDir = path.join(workDir, 'specs');
  const assetPath = 'assets/telegram/chat-1/msg-2/reference.jpg';
  mkdirSync(path.join(workDir, '.arena'), { recursive: true });
  mkdirSync(specsDir, { recursive: true });
  mkdirSync(path.join(workDir, 'assets', 'telegram', 'chat-1', 'msg-2'), { recursive: true });
  writeFileSync(specPath, '<!-- spec: 001-evolution.md -->\n# Accepted spec\n');
  writeFileSync(path.join(specsDir, '001-evolution.md'), '# Accepted spec\n');
  writeFileSync(path.join(workDir, assetPath), 'reference image bytes');
  writeFileSync(path.join(workDir, '.arena', 'assets-manifest.json'), JSON.stringify({
    assets: [{ id: 'asset-1', path: assetPath, sha256: 'sha' }],
  }));
  writeFileSync(path.join(workDir, '.arena', 'spec-input.json'), JSON.stringify({
    schemaVersion: 1,
    aggregateHash: 'accepted-input-hash',
    specs: [{
      id: 'spec-1',
      slug: '001-evolution',
      hash: 'content-hash',
      inputHash: 'accepted-input-hash',
      metadataHash: 'sha256:metadata',
      acceptedArtifact: acceptedArtifactFixture(),
    }],
  }));

  const executor = buildExecutor(workDir, specPath, 'claude-code', {
    autoCommit: true,
    autoPush: true,
  }) as any;
  executor.planManager.createPlan('spec.md', [{
    id: 'phase-1',
    name: 'Implementation',
    description: 'demo',
    order: 1,
    status: 'pending',
    tasks: [],
    planLater: false,
  }], [], 'goal');
  executor.syncProgressFeaturesFromPlan = () => {};
  executor.progress.save = async () => {};
  executor.planner.applySpecMigration = async () => ({
    summary: 'Accepted spec with asset',
    appliedChanges: 1,
    errors: [],
    newJudgments: 0,
    specChangeSource: { kind: 'accepted_artifact', itemCount: 2 },
    requiredFeedbackItems: [],
    feedbackDispositions: [],
  });

  const calls: string[] = [];
  executor.git = {
    commitPaths: async (message: string, paths: string[]) => {
      calls.push(`commit:${message}`);
      calls.push(`paths:${paths.join(',')}`);
      return { success: true, hash: 'abc1234567890abcdef1234567890abcdef1234' };
    },
    push: async () => {
      calls.push('push');
      return { success: true };
    },
  };

  const applied = await executor.applyPendingSpecMigrations(specPath);

  assert.equal(applied, true);
  assert.deepEqual(calls, [
    'commit:chore: record accepted spec inputs',
    `paths:.ralph/plan.json,.ralph/plan-archive.jsonl,.ralph/decisions-log.json,.ralph/ralph-progress.json,.ralph/iteration-log.json,.gitignore,spec.md,specs,${assetPath}`,
    'push',
  ]);
});

test('spec migration delivers runner-retired asset deletions before executor work', async () => {
  const workDir = mkdtempSync(path.join(tmpdir(), 'ralph-executor-retired-asset-source-delivery-'));
  const specPath = path.join(workDir, 'spec.md');
  const specsDir = path.join(workDir, 'specs');
  const assetPath = 'assets/telegram/chat-1/msg-107/Portal_Room_00.glb';
  const retiredAssetPath = 'assets/telegram/chat-1/msg-89/Room_00.glb';
  mkdirSync(path.join(workDir, '.arena'), { recursive: true });
  mkdirSync(specsDir, { recursive: true });
  mkdirSync(path.join(workDir, 'assets', 'telegram', 'chat-1', 'msg-107'), { recursive: true });
  writeFileSync(specPath, '<!-- spec: 001-evolution.md -->\n# Accepted spec\n');
  writeFileSync(path.join(specsDir, '001-evolution.md'), '# Accepted spec\n');
  writeFileSync(path.join(workDir, assetPath), 'room model bytes');
  // The runner already deleted the superseded asset from the workspace; only its
  // declaration is left to tell the loop whose deletion this is.
  writeFileSync(path.join(workDir, '.arena', 'assets-manifest.json'), JSON.stringify({
    assets: [{ id: 'asset-1', path: assetPath, sha256: 'sha' }],
    retiredPaths: [retiredAssetPath],
  }));
  writeFileSync(path.join(workDir, '.arena', 'spec-input.json'), JSON.stringify({
    schemaVersion: 1,
    aggregateHash: 'accepted-input-hash',
    specs: [{
      id: 'spec-1',
      slug: '001-evolution',
      hash: 'content-hash',
      inputHash: 'accepted-input-hash',
      metadataHash: 'sha256:metadata',
      acceptedArtifact: acceptedArtifactFixture(),
    }],
  }));

  const executor = buildExecutor(workDir, specPath, 'claude-code', {
    autoCommit: true,
    autoPush: true,
  }) as any;
  executor.planManager.createPlan('spec.md', [{
    id: 'phase-1',
    name: 'Implementation',
    description: 'demo',
    order: 1,
    status: 'pending',
    tasks: [],
    planLater: false,
  }], [], 'goal');
  executor.syncProgressFeaturesFromPlan = () => {};
  executor.progress.save = async () => {};
  executor.planner.applySpecMigration = async () => ({
    summary: 'Accepted spec replacing a room asset',
    appliedChanges: 1,
    errors: [],
    newJudgments: 0,
    specChangeSource: { kind: 'accepted_artifact', itemCount: 2 },
    requiredFeedbackItems: [],
    feedbackDispositions: [],
  });

  const calls: string[] = [];
  executor.git = {
    commitPaths: async (message: string, paths: string[]) => {
      calls.push(`commit:${message}`);
      calls.push(`paths:${paths.join(',')}`);
      return { success: true, hash: 'abc1234567890abcdef1234567890abcdef1234' };
    },
    push: async () => {
      calls.push('push');
      return { success: true };
    },
  };

  const applied = await executor.applyPendingSpecMigrations(specPath);

  assert.equal(applied, true);
  assert.deepEqual(calls, [
    'commit:chore: record accepted spec inputs',
    `paths:.ralph/plan.json,.ralph/plan-archive.jsonl,.ralph/decisions-log.json,.ralph/ralph-progress.json,.ralph/iteration-log.json,.gitignore,spec.md,specs,${assetPath},${retiredAssetPath}`,
    'push',
  ]);
});

test('fresh plan creation delivers materialized spec inputs without waiting for a migration', async () => {
  const workDir = mkdtempSync(path.join(tmpdir(), 'ralph-executor-fresh-plan-source-delivery-'));
  const specPath = path.join(workDir, 'spec.md');
  const specsDir = path.join(workDir, 'specs');
  mkdirSync(path.join(workDir, '.arena'), { recursive: true });
  mkdirSync(specsDir, { recursive: true });
  writeFileSync(specPath, '# Accepted spec\n');
  writeFileSync(path.join(specsDir, '001-evolution.md'), '# Accepted spec\n');
  writeFileSync(path.join(workDir, 'CLAUDE.md'), 'contract\n');
  writeFileSync(path.join(workDir, '.arena', 'materialized-source.json'), JSON.stringify({
    paths: ['CLAUDE.md'],
  }));

  const executor = buildExecutor(workDir, specPath, 'claude-code', {
    autoCommit: true,
    autoPush: true,
  }) as any;
  executor.syncProgressFeaturesFromPlan = () => {};
  executor.progress.save = async () => {};
  // A first plan has no pending migration to apply, so migration-time delivery
  // never fires for it.
  executor.applyPendingSpecMigrations = async () => false;
  executor.planner.createPlan = async () => {
    executor.planManager.createPlan('spec.md', [{
      id: 'phase-1',
      name: 'Implementation',
      description: 'demo',
      order: 1,
      status: 'pending',
      tasks: [],
      planLater: false,
    }], [], 'goal');
  };

  const calls: string[] = [];
  executor.git.commitPaths = async (message: string, paths: string[]) => {
    calls.push(`commit:${message}`);
    calls.push(`paths:${paths.join(',')}`);
    return { success: true, hash: 'fresh-plan-delivery-hash' };
  };
  executor.pushChanges = async () => {
    calls.push('pushChanges');
    return { success: true };
  };

  await executor.initSpecDrivenMode();

  assert.deepEqual(calls, [
    'commit:chore: record accepted spec inputs',
    'paths:.ralph/plan.json,.ralph/plan-archive.jsonl,.ralph/decisions-log.json,.ralph/ralph-progress.json,.ralph/iteration-log.json,.gitignore,spec.md,specs,CLAUDE.md',
    'pushChanges',
  ]);
});

test('spec migration source delivery failure keeps executor paused', async () => {
  const workDir = mkdtempSync(path.join(tmpdir(), 'ralph-executor-spec-input-source-delivery-failure-'));
  const specPath = path.join(workDir, 'spec.md');
  mkdirSync(path.join(workDir, '.arena'), { recursive: true });
  writeFileSync(specPath, '# Accepted spec\n');
  writeFileSync(path.join(workDir, '.arena', 'spec-input.json'), JSON.stringify({
    schemaVersion: 1,
    aggregateHash: 'accepted-input-hash',
    specs: [{
      id: 'spec-1',
      slug: '001-evolution',
      hash: 'content-hash',
      inputHash: 'accepted-input-hash',
      metadataHash: 'sha256:metadata',
      acceptedArtifact: acceptedArtifactFixture(),
    }],
  }));

  const executor = buildExecutor(workDir, specPath, 'claude-code', {
    autoCommit: true,
    autoPush: true,
  }) as any;
  executor.state = 'running';
  executor.planManager.createPlan('spec.md', [{
    id: 'phase-1',
    name: 'Implementation',
    description: 'demo',
    order: 1,
    status: 'pending',
    tasks: [],
    planLater: false,
  }], [], 'goal');
  executor.syncProgressFeaturesFromPlan = () => {};
  executor.progress.save = async () => {};
  executor.progress.flushNow = async () => {};
  executor.progress.setArenaPause = () => {};
  executor.recordIteration = async () => {};
  executor.planner.applySpecMigration = async () => ({
    summary: 'Accepted spec',
    appliedChanges: 1,
    errors: [],
    newJudgments: 0,
    specChangeSource: { kind: 'accepted_artifact', itemCount: 1 },
    requiredFeedbackItems: [],
    feedbackDispositions: [],
  });
  executor.git = {
    commitPaths: async () => ({ success: false, error: 'remote unavailable' }),
  };

  const applied = await executor.applyPendingSpecMigrations(specPath);

  assert.equal(applied, true);
  assert.equal(executor.state, 'paused');
  assert.equal(executor.pauseReason, 'infra');
  assert.match(executor.previousErrors[0], /accepted spec input commit: remote unavailable/);
});

test('completed metadata-aware no-work accepted artifact records canonical identity without planner', async () => {
  const workDir = mkdtempSync(path.join(tmpdir(), 'ralph-executor-canonical-no-work-'));
  const specPath = path.join(workDir, 'spec.md');
  const specsDir = path.join(workDir, 'specs');
  const materializedSpecPath = path.join(specsDir, '001-evolution.md');
  mkdirSync(path.join(workDir, '.arena'), { recursive: true });
  mkdirSync(specsDir, { recursive: true });
  writeFileSync(specPath, '<!-- spec: 001-evolution.md -->\n# Accepted spec\n');
  writeFileSync(materializedSpecPath, '# Accepted spec\n');
  writeFileSync(path.join(workDir, '.arena', 'spec-input.json'), JSON.stringify({
    schemaVersion: 1,
    aggregateHash: 'no-work-input-hash',
    specs: [{
      id: 'spec-1',
      slug: '001-evolution',
      hash: 'content-hash',
      inputHash: 'no-work-input-hash',
      metadataHash: 'sha256:metadata-no-work',
      acceptedArtifact: acceptedArtifactFixture('no_loop_work'),
    }],
  }));

  const executor = buildExecutor(workDir, specPath) as any;
  executor.planManager.createPlan('specs/001-evolution.md', [{
    id: 'phase-1',
    name: 'Implementation',
    description: 'done',
    order: 1,
    status: 'completed',
    tasks: [{
      id: 'task-001',
      description: 'Already done',
      acceptanceCriteria: ['done'],
      status: 'completed',
      attempts: 0,
      dependencies: [],
    }],
    planLater: false,
  }], [], 'goal');
  executor.planManager.recordSpecMigration(
    'specs/001-evolution.md',
    await executor.planManager.computeSpecHash(materializedSpecPath),
    'Legacy materialized spec handled',
  );
  executor.planner.applySpecMigration = async () => {
    throw new Error('planner should not run for no-work accepted artifact reconciliation');
  };

  const applied = await executor.applyPendingSpecMigrations(specPath);

  assert.equal(applied, true);
  assert.equal(executor.planManager.currentPlan.specFile, 'spec.md');
  assert.equal(executor.planManager.currentPlan.specHash, 'runner:no-work-input-hash');
  const canonical = executor.planManager.getSpecMigrations().find((m: any) => m.specFile === 'spec.md');
  assert.equal(canonical?.specHash, 'runner:no-work-input-hash');
  assert.equal(canonical?.specChangeSource?.kind, 'accepted_artifact');
  assert.equal(canonical?.specChangeSource?.itemCount, 0);
  assert.deepEqual(canonical?.requiredFeedbackItems, []);
  assert.deepEqual(canonical?.feedbackDispositions, []);
});

test('completed context-only accepted artifact records no-work identity without legacy materialized history', async () => {
  const workDir = mkdtempSync(path.join(tmpdir(), 'ralph-executor-context-only-no-work-'));
  const specPath = path.join(workDir, 'spec.md');
  mkdirSync(path.join(workDir, '.arena'), { recursive: true });
  writeFileSync(specPath, '# Accepted spec with assumption\n');
  writeFileSync(path.join(workDir, '.arena', 'spec-input.json'), JSON.stringify({
    schemaVersion: 1,
    aggregateHash: 'context-only-input-hash',
    specs: [{
      id: 'spec-1',
      slug: '001-evolution',
      hash: 'content-hash',
      inputHash: 'context-only-input-hash',
      metadataHash: 'sha256:metadata-context-only',
      acceptedArtifact: acceptedArtifactFixture('context_only'),
    }],
  }));

  const executor = buildExecutor(workDir, specPath) as any;
  executor.planManager.createPlan('spec.md', [{
    id: 'phase-1',
    name: 'Implementation',
    description: 'done',
    order: 1,
    status: 'completed',
    tasks: [{
      id: 'task-001',
      description: 'Already done',
      acceptanceCriteria: ['done'],
      status: 'completed',
      attempts: 0,
      dependencies: [],
    }],
    planLater: false,
  }], [], 'goal');
  executor.planner.applySpecMigration = async () => {
    throw new Error('planner should not run for context-only accepted diff');
  };

  const applied = await executor.applyPendingSpecMigrations(specPath);

  assert.equal(applied, true);
  assert.equal(executor.planManager.currentPlan.specFile, 'spec.md');
  assert.equal(executor.planManager.currentPlan.specHash, 'runner:context-only-input-hash');
  const canonical = executor.planManager.getSpecMigrations().find((m: any) => m.specFile === 'spec.md');
  assert.equal(canonical?.specHash, 'runner:context-only-input-hash');
  assert.equal(canonical?.specChangeSource?.kind, 'accepted_artifact');
  assert.equal(canonical?.specChangeSource?.itemCount, 0);
  assert.equal(canonical?.summary, 'Recorded accepted spec identity with no loop-work required items.');
});

test('metadata-aware accepted artifact requiring loop work uses planner migration', async () => {
  const workDir = mkdtempSync(path.join(tmpdir(), 'ralph-executor-canonical-required-work-'));
  const specPath = path.join(workDir, 'spec.md');
  const specsDir = path.join(workDir, 'specs');
  const materializedSpecPath = path.join(specsDir, '001-evolution.md');
  mkdirSync(path.join(workDir, '.arena'), { recursive: true });
  mkdirSync(specsDir, { recursive: true });
  writeFileSync(specPath, '<!-- spec: 001-evolution.md -->\n# Accepted spec\n');
  writeFileSync(materializedSpecPath, '# Accepted spec\n');
  writeFileSync(path.join(workDir, '.arena', 'spec-input.json'), JSON.stringify({
    schemaVersion: 1,
    aggregateHash: 'required-work-input-hash',
    specs: [{
      id: 'spec-1',
      slug: '001-evolution',
      hash: 'content-hash',
      inputHash: 'required-work-input-hash',
      metadataHash: 'sha256:metadata-required-work',
      acceptedArtifact: acceptedArtifactFixture('requires_loop_work'),
    }],
  }));

  const executor = buildExecutor(workDir, specPath) as any;
  executor.planManager.createPlan('specs/001-evolution.md', [{
    id: 'phase-1',
    name: 'Implementation',
    description: 'done',
    order: 1,
    status: 'completed',
    tasks: [{
      id: 'task-001',
      description: 'Already done',
      acceptanceCriteria: ['done'],
      status: 'completed',
      attempts: 0,
      dependencies: [],
    }],
    planLater: false,
  }], [], 'goal');
  executor.planManager.recordSpecMigration(
    'specs/001-evolution.md',
    await executor.planManager.computeSpecHash(materializedSpecPath),
    'Legacy materialized spec handled',
  );
  let plannerCalls = 0;
  executor.planner.applySpecMigration = async ({ specPath: migratedSpecPath }: { specPath: string }) => {
    plannerCalls++;
    assert.equal(path.relative(workDir, migratedSpecPath), 'spec.md');
    return {
      summary: 'Planner handled required accepted diff work',
      appliedChanges: 0,
      errors: [],
      newJudgments: 0,
      specChangeSource: { kind: 'accepted_artifact', itemCount: 1 },
      requiredFeedbackItems: [{
        itemId: 'DIFF-003-001',
        diffItemId: 'DIFF-003-001',
        targetType: 'spec',
        targetId: 'REQ-HTML',
        kind: 'accepted_diff:spec',
        changeType: 'updated',
        status: 'updated',
        summary: 'Move rendering to HTML elements.',
      }],
      feedbackDispositions: [{
        itemId: 'DIFF-003-001',
        disposition: 'blocked',
        reason: 'Test fixture only verifies that required accepted diff work is not silently reconciled.',
      }],
    };
  };
  executor.syncProgressFeaturesFromPlan = () => {};
  executor.progress.save = async () => {};

  const applied = await executor.applyPendingSpecMigrations(specPath);

  assert.equal(applied, true);
  assert.equal(plannerCalls, 1);
  const canonical = executor.planManager.getSpecMigrations().find((m: any) => m.specFile === 'spec.md');
  assert.equal(canonical?.specHash, 'runner:required-work-input-hash');
  assert.equal(canonical?.summary, 'Planner handled required accepted diff work');
  assert.equal(canonical?.specChangeSource?.kind, 'accepted_artifact');
  assert.equal(canonical?.requiredFeedbackItems?.[0]?.itemId, 'DIFF-003-001');
});

test('accepted artifact backlog migration records every covered source version from one materialized spec', async () => {
  const workDir = mkdtempSync(path.join(tmpdir(), 'ralph-executor-accepted-backlog-migration-'));
  const specPath = path.join(workDir, 'spec.md');
  mkdirSync(path.join(workDir, '.arena'), { recursive: true });
  writeFileSync(specPath, '# Latest cumulative accepted spec\n');
  writeFileSync(path.join(workDir, '.arena', 'spec-input.json'), JSON.stringify({
    schemaVersion: 1,
    aggregateHash: 'sushi-backlog-input-hash',
    specs: [{
      id: 'spec-1',
      slug: '001-evolution',
      hash: 'content-hash',
      inputHash: 'sushi-backlog-input-hash',
      metadataHash: 'sha256:metadata-66',
      acceptedArtifact: acceptedArtifactFixture('requires_loop_work', 66),
      acceptedArtifactBacklog: [63, 64, 65, 66].map((sourceVersion) => ({
        currentVersion: {
          id: `spec-version-${sourceVersion}`,
          version: sourceVersion,
          createdAt: `2026-07-02T10:${String(sourceVersion % 60).padStart(2, '0')}:00.000Z`,
        },
        source: {
          system: 'tg-spec',
          projectId: 'tg-proj-1',
          version: sourceVersion,
        },
        metadataHash: `sha256:metadata-${sourceVersion}`,
        acceptedArtifact: acceptedArtifactFixture(
          'requires_loop_work',
          sourceVersion,
        ),
      })),
    }],
  }));

  const executor = buildExecutor(workDir, specPath) as any;
  executor.planManager.createPlan('spec.md', [{
    id: 'phase-1',
    name: 'Implementation',
    description: 'demo',
    order: 1,
    status: 'pending',
    tasks: [],
    planLater: false,
  }], [], 'goal');
  executor.planManager.recordSpecMigration('spec.md', 'runner:input-hash-v62', {
    summary: 'Previously handled accepted source 62',
    specChangeSource: {
      kind: 'accepted_artifact',
      version: 62,
      specVersionId: 'spec-version-62',
      artifactHash: 'sha256:metadata-62',
      itemCount: 1,
    },
  });
  executor.agent = buildSequencedAgent([
    jsonBlock({
      summary: 'Applied Sushi backlog accepted diffs.',
      planChanges: [63, 64, 65, 66].map((sourceVersion) => ({
        action: 'addTask',
        phaseId: 'phase-1',
        task: {
          id: `task-${sourceVersion}`,
          description: `Implement accepted source ${sourceVersion}.`,
          acceptanceCriteria: [`Source ${sourceVersion} accepted diff is implemented.`],
          status: 'pending',
          attempts: 0,
          dependencies: [],
        },
      })),
      newJudgments: [],
      feedbackDispositions: [63, 64, 65, 66].map((sourceVersion) => ({
        itemId: `DIFF-${String(sourceVersion).padStart(3, '0')}-REQ-001`,
        feedbackStatus: 'created',
        disposition: 'addTask',
        taskIds: [`task-${sourceVersion}`],
        relatedCompletedTaskIds: [],
        evidence: [],
        judgmentIds: [],
        reason: `Accepted source ${sourceVersion} requires loop work.`,
      })),
    }),
  ]);
  executor.syncProgressFeaturesFromPlan = () => {};
  executor.progress.save = async () => {};

  const applied = await executor.applyPendingSpecMigrations(specPath);

  assert.equal(applied, true);
  const migration = executor.planManager.getSpecMigrations().find((entry: any) => (
    entry.specHash === 'runner:sushi-backlog-input-hash'
  ));
  assert.ok(migration);
  assert.equal(migration.specFile, 'spec.md');
  assert.equal(migration.specHash, 'runner:sushi-backlog-input-hash');
  assert.deepEqual(migration.specChangeSource?.coveredSourceVersions, [63, 64, 65, 66]);
  assert.equal(migration.specChangeSource?.itemCount, 4);
  assert.deepEqual(migration.requiredFeedbackItems?.map((item: any) => item.itemId), [
    'DIFF-063-REQ-001',
    'DIFF-064-REQ-001',
    'DIFF-065-REQ-001',
    'DIFF-066-REQ-001',
  ]);
  assert.deepEqual(migration.feedbackDispositions?.map((item: any) => item.itemId), [
    'DIFF-063-REQ-001',
    'DIFF-064-REQ-001',
    'DIFF-065-REQ-001',
    'DIFF-066-REQ-001',
  ]);
  assert.deepEqual(executor.planManager.getAllTasks().map((task: any) => task.feedbackItemRefs?.[0]?.itemId), [
    'DIFF-063-REQ-001',
    'DIFF-064-REQ-001',
    'DIFF-065-REQ-001',
    'DIFF-066-REQ-001',
  ]);
});

test('accepted artifact backlog migration does not duplicate already tracked source versions', async () => {
  const workDir = mkdtempSync(path.join(tmpdir(), 'ralph-executor-accepted-backlog-filter-'));
  const specPath = path.join(workDir, 'spec.md');
  mkdirSync(path.join(workDir, '.arena'), { recursive: true });
  writeFileSync(specPath, '# Latest cumulative accepted spec\n');
  writeFileSync(path.join(workDir, '.arena', 'spec-input.json'), JSON.stringify({
    schemaVersion: 1,
    aggregateHash: 'sushi-backlog-filter-input-hash',
    specs: [{
      id: 'spec-1',
      slug: '001-evolution',
      hash: 'content-hash',
      inputHash: 'sushi-backlog-filter-input-hash',
      metadataHash: 'sha256:metadata-64',
      acceptedArtifact: acceptedArtifactFixture('requires_loop_work', 64),
      acceptedArtifactBacklog: [63, 64].map((sourceVersion) => ({
        currentVersion: {
          id: `spec-version-${sourceVersion}`,
          version: sourceVersion,
          createdAt: `2026-07-02T10:${String(sourceVersion % 60).padStart(2, '0')}:00.000Z`,
        },
        source: {
          system: 'tg-spec',
          projectId: 'tg-proj-1',
          version: sourceVersion,
        },
        metadataHash: `sha256:metadata-${sourceVersion}`,
        acceptedArtifact: acceptedArtifactFixture('requires_loop_work', sourceVersion),
      })),
    }],
  }));

  const executor = buildExecutor(workDir, specPath) as any;
  executor.planManager.createPlan('spec.md', [{
    id: 'phase-1',
    name: 'Implementation',
    description: 'demo',
    order: 1,
    status: 'pending',
    tasks: [],
    planLater: false,
  }], [], 'goal');
  const previousContext = await readAcceptedArtifactFeedbackContext(workDir);
  const previousItem = previousContext?.requiredItems.find((item) => item.itemId === 'DIFF-063-REQ-001');
  assert.ok(previousItem);
  const { specChangeSource: _specChangeSource, ...previousRequiredItem } = previousItem;
  void _specChangeSource;
  executor.planManager.recordSpecMigration('spec.md', 'runner:input-hash-v63', {
    summary: 'Previously handled accepted source 63',
    specChangeSource: {
      kind: 'accepted_artifact',
      version: 63,
      specVersionId: 'spec-version-63',
      artifactHash: 'sha256:metadata-63',
      itemCount: 1,
    },
    requiredFeedbackItems: [previousRequiredItem],
  });
  executor.agent = buildSequencedAgent([
    jsonBlock({
      summary: 'Applied remaining Sushi backlog accepted diff.',
      planChanges: [{
        action: 'addTask',
        phaseId: 'phase-1',
        task: {
          id: 'task-64',
          description: 'Implement accepted source 64.',
          acceptanceCriteria: ['Source 64 accepted diff is implemented.'],
          status: 'pending',
          attempts: 0,
          dependencies: [],
        },
      }],
      newJudgments: [],
      feedbackDispositions: [{
        itemId: 'DIFF-064-REQ-001',
        feedbackStatus: 'created',
        disposition: 'addTask',
        taskIds: ['task-64'],
        relatedCompletedTaskIds: [],
        evidence: [],
        judgmentIds: [],
        reason: 'Accepted source 64 requires loop work.',
      }],
    }),
  ]);
  executor.syncProgressFeaturesFromPlan = () => {};
  executor.progress.save = async () => {};

  const applied = await executor.applyPendingSpecMigrations(specPath);

  assert.equal(applied, true);
  const migration = executor.planManager.getSpecMigrations().find((entry: any) => (
    entry.specHash === 'runner:sushi-backlog-filter-input-hash'
  ));
  assert.ok(migration);
  assert.equal(migration.specChangeSource?.version, 64);
  assert.equal(migration.specChangeSource?.itemCount, 1);
  assert.equal(migration.specChangeSource?.coveredSourceVersions, undefined);
  assert.deepEqual(migration.requiredFeedbackItems?.map((item: any) => item.itemId), ['DIFF-064-REQ-001']);
  assert.deepEqual(executor.planManager.getAllTasks().map((task: any) => task.feedbackItemRefs?.[0]?.itemId), [
    'DIFF-064-REQ-001',
  ]);
});

test('fresh metadata-aware frontend accepted spec links initial task before execution', async () => {
  const workDir = mkdtempSync(path.join(tmpdir(), 'ralph-executor-initial-frontend-refs-'));
  const specPath = path.join(workDir, 'spec.md');
  const specsDir = path.join(workDir, 'specs');
  mkdirSync(path.join(workDir, '.arena'), { recursive: true });
  mkdirSync(specsDir, { recursive: true });
  writeFileSync(specPath, '<!-- spec: 001-initial.md -->\n# Mini synth pad\n');
  writeFileSync(path.join(specsDir, '001-initial.md'), '# Mini synth pad\n');

  const artifact = acceptedArtifactFixture('requires_loop_work');
  const diffItem = (artifact.acceptedDiff as any).items[0];
  diffItem.targetType = 'spec';
  diffItem.targetId = 'REQ-001';
  diffItem.changeType = 'created';
  diffItem.workSurface = 'frontend';
  diffItem.summary = 'Build the ordinary-web synth pad UI and source-owned Visual Workbench stories.';
  writeFileSync(path.join(workDir, '.arena', 'spec-input.json'), JSON.stringify({
    schemaVersion: 1,
    aggregateHash: 'initial-frontend-input-hash',
    specs: [{
      id: 'spec-1',
      slug: '001-initial',
      hash: 'content-hash',
      inputHash: 'initial-frontend-input-hash',
      metadataHash: 'sha256:metadata-initial-frontend',
      acceptedArtifact: artifact,
    }],
  }));

  const executor = buildExecutor(workDir, specPath) as any;
  executor.agent = buildSequencedAgent([
    jsonBlock({
      projectGoal: 'Build a tiny ordinary-web synth pad with isolated Visual Workbench coverage.',
      phases: [{
        id: 'phase-1',
        name: 'Initial frontend implementation',
        description: 'Build the initial frontend feature from accepted spec truth.',
        order: 1,
        status: 'pending',
        planLater: false,
        tasks: [{
          id: 'task-001',
          displayTitle: 'Build synth pad',
          description: 'Build the ordinary-web synth pad UI and source-owned Visual Workbench stories for the accepted frontend requirement.',
          acceptanceCriteria: [
            'The synth pad UI renders in the app.',
            'visual-workbench/manifest.json and visual-workbench/stories/ cover the synth pad ready and playing states.',
          ],
          status: 'pending',
          priority: 3,
          dependencies: [],
          estimatedComplexity: 'medium',
          requiredRolePasses: ['ux'],
          attempts: 0,
        }],
      }],
      judgments: [],
      feedbackDispositions: [{
        itemId: 'DIFF-001-REQ-001',
        feedbackStatus: null,
        disposition: 'coveredByOpenTask',
        taskIds: ['task-001'],
        relatedCompletedTaskIds: [],
        evidence: [],
        judgmentIds: [],
        reason: 'The initial pending frontend task covers the accepted spec diff item before execution starts.',
      }],
    }),
  ]);
  executor.syncProgressFeaturesFromPlan = () => {};
  executor.progress.save = async () => {};

  await executor.initSpecDrivenMode();

  const task = executor.planManager.findTask('task-001');
  assert.ok(task);
  assert.equal(task.status, 'pending');
  assert.equal(task.feedbackItemRefs?.length, 1);
  assert.equal(task.feedbackItemRefs?.[0]?.itemId, 'DIFF-001-REQ-001');
  assert.equal(task.feedbackItemRefs?.[0]?.targetType, 'spec');
  assert.equal(task.feedbackItemRefs?.[0]?.targetId, 'REQ-001');
  assert.equal(task.feedbackItemRefs?.[0]?.workImpact, 'requires_loop_work');
  assert.equal(task.feedbackItemRefs?.[0]?.workSurface, 'frontend');
  assert.equal(task.feedbackItemRefs?.[0]?.specHash, 'runner:initial-frontend-input-hash');
  assert.equal(task.requiredRolePasses?.includes('ux'), true);

  const migrations = executor.planManager.getSpecMigrations();
  assert.deepEqual(migrations.map((migration: any) => ({
    specFile: migration.specFile,
    specHash: migration.specHash,
    requiredItem: migration.requiredFeedbackItems?.[0]?.itemId,
    disposition: migration.feedbackDispositions?.[0]?.disposition,
  })), [{
    specFile: 'spec.md',
    specHash: 'runner:initial-frontend-input-hash',
    requiredItem: 'DIFF-001-REQ-001',
    disposition: 'coveredByOpenTask',
  }]);
});

test('resumed legacy plan does not bootstrap over required accepted artifact work', async () => {
  const workDir = mkdtempSync(path.join(tmpdir(), 'ralph-executor-legacy-required-work-'));
  const specPath = path.join(workDir, 'spec.md');
  mkdirSync(path.join(workDir, '.arena'), { recursive: true });
  writeFileSync(specPath, '# Accepted spec\n');
  writeFileSync(path.join(workDir, '.arena', 'spec-input.json'), JSON.stringify({
    schemaVersion: 1,
    aggregateHash: 'legacy-required-work-input-hash',
    specs: [{
      id: 'spec-1',
      slug: 'accepted',
      hash: 'content-hash',
      inputHash: 'legacy-required-work-input-hash',
      metadataHash: 'sha256:metadata-required-work',
      acceptedArtifact: acceptedArtifactFixture('requires_loop_work'),
    }],
  }));

  const executor = buildExecutor(workDir, specPath) as any;
  executor.planManager.createPlan('spec.md', [{
    id: 'phase-1',
    name: 'Legacy complete phase',
    description: 'Previously completed work',
    order: 1,
    status: 'completed',
    tasks: [{
      id: 'task-001',
      description: 'Legacy task',
      acceptanceCriteria: ['done'],
      status: 'completed',
      attempts: 0,
      dependencies: [],
    }],
    planLater: false,
  }], [], 'legacy goal');
  await executor.planManager.save();

  let plannerCalls = 0;
  executor.planner.applySpecMigration = async () => {
    plannerCalls++;
    return {
      summary: 'Structured accepted diff migration',
      appliedChanges: 0,
      errors: [],
      newJudgments: 0,
      specChangeSource: { kind: 'accepted_artifact', itemCount: 1 },
      requiredFeedbackItems: [{
        itemId: 'DIFF-001-REQ-001',
        diffItemId: 'DIFF-001-REQ-001',
        targetType: 'spec',
        targetId: 'REQ-001',
        kind: 'accepted_diff:spec',
        changeType: 'created',
        workImpact: 'requires_loop_work',
        status: 'created',
        summary: 'Accepted product change.',
      }],
      feedbackDispositions: [{
        itemId: 'DIFF-001-REQ-001',
        disposition: 'blocked',
        reason: 'Fixture verifies legacy bootstrap cannot mark required accepted diff work as handled.',
      }],
    };
  };
  executor.syncProgressFeaturesFromPlan = () => {};

  await executor.initSpecDrivenMode();

  assert.equal(plannerCalls, 1);
  assert.deepEqual(executor.planManager.getSpecMigrations().map((migration: any) => ({
    specFile: migration.specFile,
    specHash: migration.specHash,
    summary: migration.summary,
    source: migration.specChangeSource?.kind,
    requiredItem: migration.requiredFeedbackItems?.[0]?.itemId,
  })), [{
    specFile: 'spec.md',
    specHash: 'runner:legacy-required-work-input-hash',
    summary: 'Structured accepted diff migration',
    source: 'accepted_artifact',
    requiredItem: 'DIFF-001-REQ-001',
  }]);
});

test('applyPendingSpecMigrations persists planner feedback disposition metadata', async () => {
  const workDir = mkdtempSync(path.join(tmpdir(), 'ralph-executor-spec-feedback-migration-'));
  const specPath = path.join(workDir, 'spec.md');
  writeFileSync(specPath, [
    '## Implementation Gaps',
    '### Open',
    '- BUG-005 (reopened#1): Queue still too dense',
  ].join('\n'));

  const executor = buildExecutor(workDir, specPath) as any;
  executor.planManager.createPlan('spec.md', [
    {
      id: 'phase-1',
      name: 'Implementation',
      description: 'demo',
      order: 1,
      status: 'pending',
      tasks: [],
      planLater: false,
    },
  ], [], 'goal');
  executor.syncProgressFeaturesFromPlan = () => {};
  executor.progress.save = async () => {};
  executor.planner.applySpecMigration = async () => ({
    summary: 'Reopened BUG-005',
    appliedChanges: 1,
    errors: [],
    newJudgments: 0,
    specChangeSource: {
      kind: 'extracted_current_feedback',
      itemCount: 1,
    },
    requiredFeedbackItems: [{
      itemId: 'BUG-005',
      kind: 'implementation_gap',
      changeType: 'reopened',
      status: 'reopened#1',
      summary: 'Queue still too dense.',
      fingerprint: 'bug-005-v2',
    }],
    feedbackDispositions: [{
      itemId: 'BUG-005',
      feedbackStatus: 'reopened#1',
      disposition: 'addTask',
      taskIds: ['task-011'],
      relatedCompletedTaskIds: ['task-010'],
      evidence: [],
      judgmentIds: [],
      reason: 'Current accepted feedback says the bug remains.',
    }],
  });

  const applied = await executor.applyPendingSpecMigrations(specPath);

  assert.equal(applied, true);
  const [migration] = executor.planManager.getSpecMigrations();
  assert.equal(migration.summary, 'Reopened BUG-005');
  assert.deepEqual(migration.specChangeSource, {
    kind: 'extracted_current_feedback',
    itemCount: 1,
  });
  assert.equal(migration.requiredFeedbackItems[0].itemId, 'BUG-005');
  assert.equal(migration.feedbackDispositions[0].itemId, 'BUG-005');
});

test('recordCurrentTaskTargetEvidence appends verification evidence for feedback-linked task', async () => {
  const workDir = mkdtempSync(path.join(tmpdir(), 'ralph-executor-target-evidence-'));
  const specPath = path.join(workDir, 'spec.md');
  writeFileSync(specPath, '# Demo spec\n');

  const executor = buildExecutor(workDir, specPath) as any;
  executor.planManager.createPlan('spec.md', [{
    id: 'phase-1',
    name: 'Implementation',
    description: 'demo',
    order: 1,
    status: 'in_progress',
    tasks: [{
      id: 'task-011',
      description: 'Re-fix BUG-005',
      acceptanceCriteria: ['BUG-005 is fixed'],
      status: 'pending',
      attempts: 1,
      dependencies: [],
      feedbackItemRefs: [{ itemId: 'BUG-005' }],
    }],
    planLater: false,
  }], [], 'goal');
  executor.currentTask = executor.planManager.findTask('task-011');
  executor.currentTask.status = 'in_progress';
  executor.lastVerification = {
    passed: true,
    lint: { passed: true, errors: [] },
    build: { passed: true, errors: [] },
    unitTests: {
      passed: true,
      total: 2,
      passed_count: 2,
      errors: [],
      evidenceHints: [{
        kind: 'test',
        ref: 'verification:unit-tests:browser-responsive',
        command: 'npm test',
        summary: 'Browser-responsive visual test suite ran inside the unit test command. Signals: mobile-390, desktop-1440.',
      }],
    },
    integrationTests: { passed: true, total: 2, passed_count: 2, errors: [] },
    postDeploy: {
      passed: true,
      summary: 'Smoke: 1 pages checked, 1 OK | Screenshots: .ralph/screenshots',
      errors: [],
      screenshotDir: '.ralph/screenshots',
    },
  };

  executor.recordCurrentTaskTargetEvidence();
  executor.recordCurrentTaskTargetEvidence();

  const task = executor.planManager.findTask('task-011');
  assert.deepEqual(task.verificationEvidence.map((row: any) => row.kind), ['unit_test', 'test', 'integration_test', 'post_deploy_smoke']);
  assert.deepEqual(task.verificationEvidence[0].feedbackItemIds, ['BUG-005']);
  assert.equal(task.verificationEvidence[0].result, 'pass');
  assert.equal(task.verificationEvidence[1].ref, 'verification:unit-tests:browser-responsive');
  assert.equal(task.verificationEvidence[1].command, 'npm test');
});

test('recordCurrentTaskTargetEvidence skips non-feedback task evidence noise', async () => {
  const workDir = mkdtempSync(path.join(tmpdir(), 'ralph-executor-target-evidence-skip-'));
  const specPath = path.join(workDir, 'spec.md');
  writeFileSync(specPath, '# Demo spec\n');

  const executor = buildExecutor(workDir, specPath) as any;
  executor.planManager.createPlan('spec.md', [{
    id: 'phase-1',
    name: 'Implementation',
    description: 'demo',
    order: 1,
    status: 'in_progress',
    tasks: [{
      id: 'task-001',
      description: 'Build ordinary UI',
      acceptanceCriteria: ['UI works'],
      status: 'pending',
      attempts: 1,
      dependencies: [],
    }],
    planLater: false,
  }], [], 'goal');
  executor.currentTask = executor.planManager.findTask('task-001');
  executor.currentTask.status = 'in_progress';
  executor.lastVerification = {
    passed: true,
    integrationTests: { passed: true, total: 1, passed_count: 1, errors: [] },
  };

  executor.recordCurrentTaskTargetEvidence();

  assert.deepEqual(executor.planManager.findTask('task-001').verificationEvidence ?? [], []);
});

test('controller audit commit is pushed when autoPush is enabled', async () => {
  const workDir = mkdtempSync(path.join(tmpdir(), 'ralph-executor-controller-push-'));
  const specPath = path.join(workDir, 'spec.md');
  writeFileSync(specPath, '# Demo spec\n');

  const executor = buildExecutor(workDir, specPath, 'codex', {
    controllerEnabled: true,
    autoCommit: true,
    autoPush: true,
  }) as any;
  const calls: string[] = [];

  executor.controller.audit = async () => controllerReportFixture('continue');
  executor.git = {
    commitPaths: async (message: string, paths: string[]) => {
      calls.push(`commit:${message}`);
      calls.push(`paths:${paths.join(',')}`);
      return { success: true, hash: 'abc1234567890abcdef1234567890abcdef1234' };
    },
    push: async () => {
      calls.push('push');
      return { success: true };
    },
  };

  await executor.runController('startup');

  assert.deepEqual(calls, [
    'commit:chore: controller startup audit — continue',
    'paths:.ralph/plan.json,.ralph/plan-archive.jsonl,.ralph/decisions-log.json,.ralph/ralph-progress.json',
    'push',
  ]);
});

test('controller audit no-changes commit is not pushed', async () => {
  const workDir = mkdtempSync(path.join(tmpdir(), 'ralph-executor-controller-no-changes-'));
  const specPath = path.join(workDir, 'spec.md');
  writeFileSync(specPath, '# Demo spec\n');

  const executor = buildExecutor(workDir, specPath, 'codex', {
    controllerEnabled: true,
    autoCommit: true,
    autoPush: true,
  }) as any;
  const calls: string[] = [];

  executor.controller.audit = async () => controllerReportFixture('continue');
  executor.git = {
    commitPaths: async (message: string) => {
      calls.push(`commit:${message}`);
      return { success: true, hash: 'no-changes' };
    },
    push: async () => {
      calls.push('push');
      return { success: true };
    },
  };

  await executor.runController('startup');

  assert.deepEqual(calls, ['commit:chore: controller startup audit — continue']);
});

test('controller audit push failure parks as INFRA instead of continuing to false completion', async () => {
  const workDir = mkdtempSync(path.join(tmpdir(), 'ralph-executor-controller-push-failure-'));
  const specPath = path.join(workDir, 'spec.md');
  writeFileSync(specPath, '# Demo spec\n');

  const executor = buildExecutor(workDir, specPath, 'codex', {
    controllerEnabled: true,
    autoCommit: true,
    autoPush: true,
  }) as any;

  await executor.progress.load();
  executor.controller.audit = async () => controllerReportFixture('continue');
  executor.git = {
    commitPaths: async () => ({ success: true, hash: 'abc1234567890abcdef1234567890abcdef1234' }),
    push: async () => ({ success: false, error: 'remote unavailable' }),
  };

  await executor.runController('final');

  const progress = JSON.parse(readFileSync(path.join(workDir, '.arena', 'progress.json'), 'utf-8'));

  assert.equal(executor.state, 'paused');
  assert.equal(executor.pauseReason, 'infra');
  assert.equal(progress.state, 'paused_infra');
  assert.match(progress.message, /Source delivery failed during controller final audit push: remote unavailable/);
});

test('finalize parks as INFRA instead of DEPLOYED when final source push fails', async () => {
  const workDir = mkdtempSync(path.join(tmpdir(), 'ralph-executor-final-push-failure-'));
  const specPath = path.join(workDir, 'spec.md');
  writeFileSync(specPath, '# Demo spec\n');

  const executor = buildExecutor(workDir, specPath, 'codex', {
    autoCommit: true,
    autoPush: true,
  }) as any;

  await executor.progress.load();
  executor.state = 'completed';
  const calls: string[] = [];
  executor.git = {
    commitPaths: async (message: string, paths: string[]) => {
      calls.push(`commit:${message}`);
      calls.push(`paths:${paths.join(',')}`);
      return { success: true, hash: 'abc1234567890abcdef1234567890abcdef1234' };
    },
    push: async () => {
      calls.push('push');
      return { success: false, error: 'remote unavailable' };
    },
  };

  await executor.finalize();

  const result = JSON.parse(readFileSync(path.join(workDir, '.arena', 'result.json'), 'utf-8'));
  const progress = JSON.parse(readFileSync(path.join(workDir, '.arena', 'progress.json'), 'utf-8'));

  assert.equal(executor.state, 'paused');
  assert.equal(executor.pauseReason, 'infra');
  assert.deepEqual(calls, [
    'commit:chore: final run state',
    'paths:.ralph/plan.json,.ralph/plan-archive.jsonl,.ralph/decisions-log.json,.ralph/ralph-progress.json,.ralph/iteration-log.json',
    'push',
  ]);
  assert.equal(result.status, 'CANCELED');
  assert.equal(result.pauseReason, 'INFRA');
  assert.match(result.reason, /Source delivery failed during final run state push: remote unavailable/);
  assert.equal(progress.state, 'paused_infra');
});

test('legacy plan specFile is normalized back to canonical spec.md', async () => {
  const workDir = mkdtempSync(path.join(tmpdir(), 'ralph-executor-plan-normalize-'));
  mkdirSync(path.join(workDir, '.ralph'), { recursive: true });
  writeFileSync(path.join(workDir, 'spec.md'), '# Canonical spec\n');

  const executor = buildExecutor(workDir) as any;
  executor.planManager.createPlan('.ralph/combined-spec.md', [
    {
      id: 'phase-1',
      name: 'Phase',
      description: 'demo',
      order: 1,
      status: 'pending',
      tasks: [],
      planLater: false,
    },
  ], [], 'goal');
  await executor.planManager.save();

  await executor.normalizeLegacySpecFilePath();

  assert.equal(executor.planManager.currentPlan.specFile, 'spec.md');
  const persisted = JSON.parse(readFileSync(path.join(workDir, '.ralph', 'plan.json'), 'utf-8'));
  assert.equal(persisted.specFile, 'spec.md');
});

test('arena runtime rate limit parks executor in paused state', async () => {
  const workDir = mkdtempSync(path.join(tmpdir(), 'ralph-executor-rate-limit-'));
  const previousProjectId = process.env.ARENA_PROJECT_ID;
  const previousGovernanceUrl = process.env.ARENA_GOVERNANCE_URL;

  process.env.ARENA_PROJECT_ID = 'proj-1';
  process.env.ARENA_GOVERNANCE_URL = 'http://governance:3000';

  try {
    mkdirSync(path.join(workDir, '.arena'), { recursive: true });
    const executor = buildExecutor(workDir) as any;
    await executor.progress.load();
    executor.recordIteration = async () => {};

    const result = await executor.handleRateLimit({
      success: false,
      output: 'Usage limit reached, try again later',
      filesChanged: [],
      completionPromiseFound: false,
      error: {
        category: 'rate_limit',
        message: 'Usage limit reached, try again later',
        retryAfterSec: 180,
      },
    });

    const progress = JSON.parse(readFileSync(path.join(workDir, '.arena', 'progress.json'), 'utf-8'));

    assert.equal(result, 'no_work');
    assert.equal(executor.state, 'paused');
    assert.equal(executor.exitReason, 'paused');
    assert.equal(executor.pauseReason, 'rate_limit');
    assert.equal(progress.state, 'paused_rate_limit');
    assert.equal(progress.message, 'Usage limit reached, try again later');
  } finally {
    if (previousProjectId === undefined) {
      delete process.env.ARENA_PROJECT_ID;
    } else {
      process.env.ARENA_PROJECT_ID = previousProjectId;
    }
    if (previousGovernanceUrl === undefined) {
      delete process.env.ARENA_GOVERNANCE_URL;
    } else {
      process.env.ARENA_GOVERNANCE_URL = previousGovernanceUrl;
    }
  }
});

test('arena runtime auth failure pauses without consuming product task retries', async () => {
  const workDir = mkdtempSync(path.join(tmpdir(), 'ralph-executor-auth-pause-'));
  const previousProjectId = process.env.ARENA_PROJECT_ID;
  const previousGovernanceUrl = process.env.ARENA_GOVERNANCE_URL;

  process.env.ARENA_PROJECT_ID = 'proj-1';
  process.env.ARENA_GOVERNANCE_URL = 'http://governance:3000';

  try {
    mkdirSync(path.join(workDir, '.arena'), { recursive: true });
    const executor = buildExecutor(workDir) as any;
    await executor.progress.load();

    executor.currentTask = {
      id: 'task-auth',
      description: 'Ship the feature',
      acceptanceCriteria: ['It works'],
      status: 'pending',
      attempts: 0,
      dependencies: [],
    };
    executor.context.build = async () => 'context';
    executor.savePlanState = () => {};

    let verifyCalled = false;
    let controllerCalled = false;
    const iterationStatuses: string[] = [];
    setExecutorAgent(executor, async () => ({
      success: false,
      output: 'Failed to authenticate. API Error: 401 Invalid authentication credentials',
      filesChanged: [],
      completionPromiseFound: false,
      error: {
        category: 'auth',
        message: 'Failed to authenticate. API Error: 401 Invalid authentication credentials',
      },
    }));
    executor.verify = async () => {
      verifyCalled = true;
      return { passed: true };
    };
    executor.runController = async () => {
      controllerCalled = true;
      return { verdict: 'continue' };
    };
    executor.recordIteration = async (_result: unknown, status: string) => {
      iterationStatuses.push(status);
    };

    const result = await executor.executeIteration();
    const progress = JSON.parse(readFileSync(path.join(workDir, '.arena', 'progress.json'), 'utf-8'));

    assert.equal(result, 'no_work');
    assert.equal(verifyCalled, false);
    assert.equal(controllerCalled, false);
    assert.equal(executor.state, 'paused');
    assert.equal(executor.exitReason, 'paused');
    assert.equal(executor.pauseReason, 'infra');
    assert.equal(executor.currentTask.status, 'in_progress');
    assert.equal(executor.currentTask.attempts, 0);
    assert.match(executor.currentTask.lastError, /Provider auth unavailable/);
    assert.deepEqual(iterationStatuses, ['error']);
    assert.equal(progress.state, 'paused_infra');
    assert.match(progress.message, /Provider auth unavailable/);
  } finally {
    if (previousProjectId === undefined) {
      delete process.env.ARENA_PROJECT_ID;
    } else {
      process.env.ARENA_PROJECT_ID = previousProjectId;
    }
    if (previousGovernanceUrl === undefined) {
      delete process.env.ARENA_GOVERNANCE_URL;
    } else {
      process.env.ARENA_GOVERNANCE_URL = previousGovernanceUrl;
    }
  }
});

for (const fixture of [
  {
    label: 'Codex',
    agent: 'codex' as const,
    scenario: 'hard_stderr_auth',
    withScenario: withMockCodexScenario,
    messagePattern: /401|invalid authentication/i,
  },
  {
    label: 'Claude',
    agent: 'claude-code' as const,
    scenario: 'auth',
    withScenario: withMockClaudeScenario,
    messagePattern: /authentication required|oauth token/i,
  },
  {
    label: 'OpenCode',
    agent: 'opencode' as const,
    scenario: 'auth',
    withScenario: withMockOpenCodeScenario,
    messagePattern: /authentication required|OPENCODE_API_KEY/i,
  },
]) {
  test(`arena runtime ${fixture.label} auth-stale adapter failure pauses without product completion`, async () => {
    const workDir = mkdtempSync(path.join(tmpdir(), `ralph-executor-${fixture.agent}-auth-stale-`));
    const previousProjectId = process.env.ARENA_PROJECT_ID;
    const previousGovernanceUrl = process.env.ARENA_GOVERNANCE_URL;

    process.env.ARENA_PROJECT_ID = 'proj-1';
    process.env.ARENA_GOVERNANCE_URL = 'http://governance:3000';

    try {
      await fixture.withScenario(fixture.scenario, async () => {
        mkdirSync(path.join(workDir, '.arena'), { recursive: true });
        const executor = buildExecutor(workDir, undefined, fixture.agent, { useDefaultAgent: true }) as any;
        await executor.progress.load();

        executor.currentTask = {
          id: `task-${fixture.agent}-auth`,
          description: 'Continue active WIP after auth recovers',
          acceptanceCriteria: ['Product work remains resumable'],
          status: 'pending',
          attempts: 0,
          dependencies: [],
        };
        executor.context.build = async () => 'context';
        executor.savePlanState = () => {};

        let verifyCalled = false;
        let controllerCalled = false;
        let markTaskCompleteCalled = false;
        const iterationStatuses: string[] = [];

        executor.verify = async () => {
          verifyCalled = true;
          return { passed: true };
        };
        executor.runController = async () => {
          controllerCalled = true;
          return { verdict: 'continue' };
        };
        executor.markTaskComplete = () => {
          markTaskCompleteCalled = true;
        };
        executor.recordIteration = async (_result: unknown, status: string) => {
          iterationStatuses.push(status);
        };

        const result = await executor.executeIteration();
        await executor.writeTerminalResult();

        const progress = JSON.parse(readFileSync(path.join(workDir, '.arena', 'progress.json'), 'utf-8'));
        const terminalResult = JSON.parse(readFileSync(path.join(workDir, '.arena', 'result.json'), 'utf-8'));

        assert.equal(result, 'no_work');
        assert.equal(verifyCalled, false);
        assert.equal(controllerCalled, false);
        assert.equal(markTaskCompleteCalled, false);
        assert.deepEqual(iterationStatuses, ['error']);
        assert.equal(executor.state, 'paused');
        assert.equal(executor.exitReason, 'paused');
        assert.equal(executor.pauseReason, 'infra');
        assert.equal(executor.currentTask.status, 'in_progress');
        assert.equal(executor.currentTask.attempts, 0);
        assert.match(executor.currentTask.lastError, /Provider auth unavailable/);
        assert.match(executor.currentTask.lastError, fixture.messagePattern);
        assert.equal(progress.state, 'paused_infra');
        assert.match(progress.message, /Provider auth unavailable/);
        assert.equal(terminalResult.status, 'CANCELED');
        assert.equal(terminalResult.pauseReason, 'INFRA');
        assert.match(terminalResult.reason, /Provider auth unavailable/);
        assert.match(terminalResult.reason, fixture.messagePattern);
      });
    } finally {
      if (previousProjectId === undefined) {
        delete process.env.ARENA_PROJECT_ID;
      } else {
        process.env.ARENA_PROJECT_ID = previousProjectId;
      }
      if (previousGovernanceUrl === undefined) {
        delete process.env.ARENA_GOVERNANCE_URL;
      } else {
        process.env.ARENA_GOVERNANCE_URL = previousGovernanceUrl;
      }
    }
  });
}

test('startup planner rate limit parks executor instead of failing the run', async () => {
  const workDir = mkdtempSync(path.join(tmpdir(), 'ralph-executor-startup-planner-rate-limit-'));
  const specPath = path.join(workDir, 'spec.md');
  const previousProjectId = process.env.ARENA_PROJECT_ID;
  const previousGovernanceUrl = process.env.ARENA_GOVERNANCE_URL;

  writeFileSync(specPath, '# Demo spec\n\nBuild something useful.\n');
  process.env.ARENA_PROJECT_ID = 'proj-1';
  process.env.ARENA_GOVERNANCE_URL = 'http://governance:3000';

  try {
    const executor = buildExecutor(workDir, specPath) as any;
    let executeCalls = 0;
    executor.git.init = async () => {};
    executor.agent.isAvailable = async () => true;
    executor.agent.getVersion = async () => 'mock';
    executor.agent.execute = async () => {
      executeCalls += 1;
      return {
        success: false,
        output: "You've hit your limit · resets 10am (UTC)",
        filesChanged: [],
        completionPromiseFound: false,
        error: {
          category: 'rate_limit',
          message: "You've hit your limit · resets 10am (UTC)",
          retryAt: '2026-04-23T10:00:00.000Z',
        },
      };
    };

    await executor.run();

    const result = JSON.parse(readFileSync(path.join(workDir, '.arena', 'result.json'), 'utf-8'));
    const progress = JSON.parse(readFileSync(path.join(workDir, '.arena', 'progress.json'), 'utf-8'));

    assert.equal(executeCalls, 1);
    assert.equal(executor.exitReason, 'paused');
    assert.equal(executor.pauseReason, 'rate_limit');
    assert.equal(executor.state, 'paused');
    assert.deepEqual(result, {
      status: 'CANCELED',
      reason: "You've hit your limit · resets 10am (UTC)",
      pauseReason: 'RATE_LIMIT',
      retryAt: '2026-04-23T10:00:00.000Z',
    });
    assert.equal(progress.state, 'paused_rate_limit');
    assert.equal(progress.message, "You've hit your limit · resets 10am (UTC)");
  } finally {
    if (previousProjectId === undefined) {
      delete process.env.ARENA_PROJECT_ID;
    } else {
      process.env.ARENA_PROJECT_ID = previousProjectId;
    }
    if (previousGovernanceUrl === undefined) {
      delete process.env.ARENA_GOVERNANCE_URL;
    } else {
      process.env.ARENA_GOVERNANCE_URL = previousGovernanceUrl;
    }
  }
});

test('final controller rate limit parks the run instead of completing it', async () => {
  const workDir = mkdtempSync(path.join(tmpdir(), 'ralph-executor-final-controller-rate-limit-'));
  const specPath = path.join(workDir, 'spec.md');
  const previousProjectId = process.env.ARENA_PROJECT_ID;
  const previousGovernanceUrl = process.env.ARENA_GOVERNANCE_URL;

  writeFileSync(specPath, '# Demo spec\n\nBuild something useful.\n');
  process.env.ARENA_PROJECT_ID = 'proj-1';
  process.env.ARENA_GOVERNANCE_URL = 'http://governance:3000';

  try {
    const executor = buildExecutor(workDir, specPath, 'claude-code', { controllerEnabled: true }) as any;
    executor.initialize = async () => {
      await executor.progress.load();
      executor.setState('coding');
    };
    executor.runExecutionLoop = async () => {};
    executor.runController = async () => {
      throw new ControllerAuditFailure(
        'final',
        "Final controller audit failed: You've hit your limit · resets 10am (UTC)",
        {
          category: 'rate_limit',
          message: "You've hit your limit · resets 10am (UTC)",
          retryAt: '2026-04-23T10:00:00.000Z',
        },
      );
    };

    await executor.run();

    const result = JSON.parse(readFileSync(path.join(workDir, '.arena', 'result.json'), 'utf-8'));
    const progress = JSON.parse(readFileSync(path.join(workDir, '.arena', 'progress.json'), 'utf-8'));

    assert.equal(executor.state, 'paused');
    assert.equal(executor.exitReason, 'paused');
    assert.equal(executor.pauseReason, 'rate_limit');
    assert.deepEqual(result, {
      status: 'CANCELED',
      reason: "You've hit your limit · resets 10am (UTC)",
      pauseReason: 'RATE_LIMIT',
      retryAt: '2026-04-23T10:00:00.000Z',
    });
    assert.equal(progress.state, 'paused_rate_limit');
    assert.equal(progress.message, "You've hit your limit · resets 10am (UTC)");
  } finally {
    if (previousProjectId === undefined) {
      delete process.env.ARENA_PROJECT_ID;
    } else {
      process.env.ARENA_PROJECT_ID = previousProjectId;
    }
    if (previousGovernanceUrl === undefined) {
      delete process.env.ARENA_GOVERNANCE_URL;
    } else {
      process.env.ARENA_GOVERNANCE_URL = previousGovernanceUrl;
    }
  }
});

test('final controller infra failure parks the arena run instead of failing it', async () => {
  const workDir = mkdtempSync(path.join(tmpdir(), 'ralph-executor-final-controller-fail-'));
  const specPath = path.join(workDir, 'spec.md');
  const previousProjectId = process.env.ARENA_PROJECT_ID;
  const previousGovernanceUrl = process.env.ARENA_GOVERNANCE_URL;

  writeFileSync(specPath, '# Demo spec\n\nBuild something useful.\n');
  process.env.ARENA_PROJECT_ID = 'proj-1';
  process.env.ARENA_GOVERNANCE_URL = 'http://governance:3000';

  try {
    const executor = buildExecutor(workDir, specPath, 'claude-code', { controllerEnabled: true }) as any;
    executor.initialize = async () => {
      await executor.progress.load();
      executor.setState('coding');
    };
    executor.runExecutionLoop = async () => {};
    executor.runController = async () => {
      throw new ControllerAuditFailure(
        'final',
        'Final controller audit failed: controller transport crashed',
        {
          category: 'infra',
          message: 'controller transport crashed',
        },
      );
    };

    await executor.run();

    const result = JSON.parse(readFileSync(path.join(workDir, '.arena', 'result.json'), 'utf-8'));
    const progress = JSON.parse(readFileSync(path.join(workDir, '.arena', 'progress.json'), 'utf-8'));

    assert.equal(executor.state, 'paused');
    assert.equal(executor.exitReason, 'paused');
    assert.equal(executor.pauseReason, 'infra');
    assert.deepEqual(result, {
      status: 'CANCELED',
      reason: 'controller transport crashed',
      pauseReason: 'INFRA',
    });
    assert.equal(progress.state, 'paused_infra');
    assert.equal(progress.message, 'controller transport crashed');
  } finally {
    if (previousProjectId === undefined) {
      delete process.env.ARENA_PROJECT_ID;
    } else {
      process.env.ARENA_PROJECT_ID = previousProjectId;
    }
    if (previousGovernanceUrl === undefined) {
      delete process.env.ARENA_GOVERNANCE_URL;
    } else {
      process.env.ARENA_GOVERNANCE_URL = previousGovernanceUrl;
    }
  }
});

test('final controller report-contract failure parks the arena run as infra', async () => {
  const workDir = mkdtempSync(path.join(tmpdir(), 'ralph-executor-final-controller-contract-fail-'));
  const specPath = path.join(workDir, 'spec.md');
  const previousProjectId = process.env.ARENA_PROJECT_ID;
  const previousGovernanceUrl = process.env.ARENA_GOVERNANCE_URL;

  writeFileSync(specPath, '# Demo spec\n\nBuild something useful.\n');
  process.env.ARENA_PROJECT_ID = 'proj-1';
  process.env.ARENA_GOVERNANCE_URL = 'http://governance:3000';

  try {
    const executor = buildExecutor(workDir, specPath, 'claude-code', { controllerEnabled: true }) as any;
    executor.initialize = async () => {
      await executor.progress.load();
      executor.setState('coding');
    };
    executor.runExecutionLoop = async () => {};
    executor.runController = async () => {
      throw new ControllerAuditFailure(
        'final',
        'Final controller audit parse error: Could not find JSON in controller output',
      );
    };

    await executor.run();

    const result = JSON.parse(readFileSync(path.join(workDir, '.arena', 'result.json'), 'utf-8'));
    const progress = JSON.parse(readFileSync(path.join(workDir, '.arena', 'progress.json'), 'utf-8'));

    assert.equal(executor.state, 'paused');
    assert.equal(executor.exitReason, 'paused');
    assert.equal(executor.pauseReason, 'infra');
    assert.deepEqual(result, {
      status: 'CANCELED',
      reason: 'Final controller audit parse error: Could not find JSON in controller output',
      pauseReason: 'INFRA',
    });
    assert.equal(progress.state, 'paused_infra');
    assert.equal(progress.message, 'Final controller audit parse error: Could not find JSON in controller output');
  } finally {
    if (previousProjectId === undefined) {
      delete process.env.ARENA_PROJECT_ID;
    } else {
      process.env.ARENA_PROJECT_ID = previousProjectId;
    }
    if (previousGovernanceUrl === undefined) {
      delete process.env.ARENA_GOVERNANCE_URL;
    } else {
      process.env.ARENA_GOVERNANCE_URL = previousGovernanceUrl;
    }
  }
});

test('final controller escalation does not create a manual lifecycle pause', async () => {
  const workDir = mkdtempSync(path.join(tmpdir(), 'ralph-executor-final-controller-escalate-nonblocking-'));
  const specPath = path.join(workDir, 'spec.md');

  writeFileSync(specPath, '# Demo spec\n\nBuild something useful.\n');

  const executor = buildExecutor(workDir, specPath, 'claude-code', { controllerEnabled: true }) as any;
  executor.isArenaRuntime = true;
  executor.initialize = async () => {
    await executor.progress.load();
    executor.setState('coding');
  };
  executor.runExecutionLoop = async () => {};
  executor.controller.audit = async () => ({
    id: 'report-001',
    timestamp: new Date().toISOString(),
    trigger: 'final',
    verdict: 'escalate',
    summary: 'Production user evidence is required before this can be accepted.',
    planChanges: [],
    newJudgments: [],
    revisedJudgments: [],
  });

  await executor.run();

  const result = JSON.parse(readFileSync(path.join(workDir, '.arena', 'result.json'), 'utf-8'));
  const progress = JSON.parse(readFileSync(path.join(workDir, '.arena', 'progress.json'), 'utf-8'));

  assert.equal(executor.state, 'completed');
  assert.equal(executor.exitReason, 'success');
  assert.equal(executor.pauseReason, null);
  assert.deepEqual(result, {
    status: 'DEPLOYED',
    reason: 'success',
  });
  assert.equal(progress.state, 'completed');
});

test('Arena runtime task completion refreshes preview through control sidecar', async () => {
  const workDir = mkdtempSync(path.join(tmpdir(), 'ralph-executor-arena-task-refresh-'));
  const previousProjectId = process.env.ARENA_PROJECT_ID;
  const previousGovernanceUrl = process.env.ARENA_GOVERNANCE_URL;
  const previousControlPort = process.env.ARENA_PREVIEW_CONTROL_PORT;
  const previousFetch = globalThis.fetch;
  const refreshCalls: Array<{ url: string; method?: string }> = [];

  try {
    process.env.ARENA_PROJECT_ID = 'project-1';
    process.env.ARENA_GOVERNANCE_URL = 'http://governance.test';
    process.env.ARENA_PREVIEW_CONTROL_PORT = '4999';

    (globalThis as any).fetch = async (url: URL | string, init?: RequestInit) => {
      refreshCalls.push({ url: String(url), method: init?.method });
      return new Response(JSON.stringify({ previewActual: 'SERVING' }), { status: 200 });
    };

    const executor = buildExecutor(workDir) as any;
    executor.currentTask = { id: 'task-008', verificationEvidence: [] };

    const refreshed = await executor.refreshArenaRuntimePreviewAfterTaskCompletion();

    assert.equal(refreshed, true);
    assert.equal(refreshCalls.length, 1);
    assert.equal(refreshCalls[0].method, 'POST');
    assert.match(refreshCalls[0].url, /^http:\/\/127\.0\.0\.1:4999\/__arena\/internal\/refresh-preview\?/);
    assert.match(refreshCalls[0].url, /trigger=task_completion/);
    assert.match(refreshCalls[0].url, /taskId=task-008/);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousProjectId === undefined) {
      delete process.env.ARENA_PROJECT_ID;
    } else {
      process.env.ARENA_PROJECT_ID = previousProjectId;
    }
    if (previousGovernanceUrl === undefined) {
      delete process.env.ARENA_GOVERNANCE_URL;
    } else {
      process.env.ARENA_GOVERNANCE_URL = previousGovernanceUrl;
    }
    if (previousControlPort === undefined) {
      delete process.env.ARENA_PREVIEW_CONTROL_PORT;
    } else {
      process.env.ARENA_PREVIEW_CONTROL_PORT = previousControlPort;
    }
  }
});

test('Arena runtime task completion refresh reports false when preview refresh fails', async () => {
  const workDir = mkdtempSync(path.join(tmpdir(), 'ralph-executor-arena-task-refresh-fail-'));
  const previousProjectId = process.env.ARENA_PROJECT_ID;
  const previousGovernanceUrl = process.env.ARENA_GOVERNANCE_URL;
  const previousFetch = globalThis.fetch;

  try {
    process.env.ARENA_PROJECT_ID = 'project-1';
    process.env.ARENA_GOVERNANCE_URL = 'http://governance.test';

    (globalThis as any).fetch = async () => new Response(
      JSON.stringify({ previewActual: 'ERROR', reasonCode: 'preview_start_unhealthy' }),
      { status: 503 },
    );

    const executor = buildExecutor(workDir) as any;
    executor.currentTask = { id: 'task-009', verificationEvidence: [] };

    const refreshed = await executor.refreshArenaRuntimePreviewAfterTaskCompletion();

    assert.equal(refreshed, false);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousProjectId === undefined) {
      delete process.env.ARENA_PROJECT_ID;
    } else {
      process.env.ARENA_PROJECT_ID = previousProjectId;
    }
    if (previousGovernanceUrl === undefined) {
      delete process.env.ARENA_GOVERNANCE_URL;
    } else {
      process.env.ARENA_GOVERNANCE_URL = previousGovernanceUrl;
    }
  }
});

test('final controller does not complete while revised plan still has unfinished non-runnable work', async () => {
  const workDir = mkdtempSync(path.join(tmpdir(), 'ralph-executor-final-controller-unfinished-'));
  const specPath = path.join(workDir, 'spec.md');

  writeFileSync(specPath, '# Demo spec\n\nBuild something useful.\n');

  const executor = buildExecutor(workDir, specPath, 'claude-code', { controllerEnabled: true }) as any;
  let executionLoops = 0;
  let controllerRuns = 0;
  let hasUnfinishedTasks = true;

  executor.initialize = async () => {
    await executor.progress.load();
    executor.setState('coding');
  };
  executor.runExecutionLoop = async () => {
    executionLoops++;
    executor.setState('completed');
    if (executionLoops >= 2) {
      hasUnfinishedTasks = false;
    }
  };
  executor.runController = async () => {
    controllerRuns++;
    return {
      id: `report-${String(controllerRuns).padStart(3, '0')}`,
      timestamp: new Date().toISOString(),
      trigger: 'final',
      verdict: controllerRuns === 1 ? 'revise' : 'continue',
      summary: 'audit summary',
      planChanges: [],
      newJudgments: [],
      revisedJudgments: [],
    };
  };
  executor.selectNextTask = async () => null;
  executor.planManager.hasUnfinishedTasks = () => hasUnfinishedTasks;
  executor.finalize = async () => {};
  executor.watchForNewSpecs = async () => false;

  await executor.run();

  assert.equal(executionLoops, 2);
  assert.equal(controllerRuns, 2);
  assert.equal(executor.state, 'completed');
});

test('executeIteration does not continue into verification after interrupted non-zero exit with completion signal', async () => {
  const workDir = mkdtempSync(path.join(tmpdir(), 'ralph-executor-completion-bypass-'));
  const previousProjectId = process.env.ARENA_PROJECT_ID;
  const previousGovernanceUrl = process.env.ARENA_GOVERNANCE_URL;

  process.env.ARENA_PROJECT_ID = 'proj-1';
  process.env.ARENA_GOVERNANCE_URL = 'http://governance:3000';

  try {
    const executor = buildExecutor(workDir) as any;
    await executor.progress.load();

    executor.currentTask = {
      id: 'task-007',
      description: 'Ship the feature',
      acceptanceCriteria: ['It works'],
      status: 'pending',
      attempts: 0,
      dependencies: [],
    };
    executor.context.build = async () => 'context';
    executor.savePlanState = () => {};

    let verifyCalled = false;
    let markTaskCompleteCalled = false;
    const iterationStatuses: string[] = [];

    setExecutorAgent(executor, async () => ({
      success: false,
      output: 'Usage limit reached',
      filesChanged: ['src/index.ts'],
      completionPromiseFound: true,
      error: {
        category: 'rate_limit',
        message: 'Usage limit reached',
      },
    }));
    executor.verify = async () => {
      verifyCalled = true;
      return { passed: true };
    };
    executor.recordIteration = async (_result: unknown, status: string) => {
      iterationStatuses.push(status);
    };
    executor.markTaskComplete = () => {
      markTaskCompleteCalled = true;
    };

    const result = await executor.executeIteration();

    assert.equal(result, 'no_work');
    assert.equal(verifyCalled, false);
    assert.equal(markTaskCompleteCalled, false);
    assert.deepEqual(iterationStatuses, ['error']);
    assert.equal(executor.pauseReason, 'rate_limit');
    assert.equal(executor.exitReason, 'paused');
  } finally {
    if (previousProjectId === undefined) {
      delete process.env.ARENA_PROJECT_ID;
    } else {
      process.env.ARENA_PROJECT_ID = previousProjectId;
    }
    if (previousGovernanceUrl === undefined) {
      delete process.env.ARENA_GOVERNANCE_URL;
    } else {
      process.env.ARENA_GOVERNANCE_URL = previousGovernanceUrl;
    }
  }
});

test('executeIteration fails before verification when shared observer reports forbidden mutation', async () => {
  const workDir = mkdtempSync(path.join(tmpdir(), 'ralph-executor-forbidden-mutation-'));
  const executor = buildExecutor(workDir) as any;
  setExecutorGitStatusSequence(executor, [
    [],
    gitStatusForChangedFiles(['.ralph/plan.json']),
  ]);
  await executor.progress.load();

  executor.currentTask = {
    id: 'task-forbidden',
    description: 'Ship the feature',
    acceptanceCriteria: ['It works'],
    status: 'pending',
    attempts: 0,
    dependencies: [],
  };
  executor.context.build = async () => 'context';
  executor.savePlanState = () => {};

  let verifyCalled = false;
  let commitCalled = false;
  let markTaskCompleteCalled = false;
  let controllerGateCalled = false;
  let controllerCalled = false;
  const iterationRecords: Array<{ status: string; messages: string[] }> = [];

  setExecutorAgent(executor, async () => ({
    success: true,
    output: completionOutput(),
    filesChanged: ['.ralph/plan.json'],
    completionPromiseFound: true,
  }));
  executor.verify = async () => {
    verifyCalled = true;
    return { passed: true };
  };
  executor.commitCurrentExecutorSourceChanges = async () => {
    commitCalled = true;
    return { success: true, hash: 'commit-sha' };
  };
  executor.markTaskComplete = () => {
    markTaskCompleteCalled = true;
  };
  executor.shouldRunController = () => {
    controllerGateCalled = true;
    return true;
  };
  executor.runController = async () => {
    controllerCalled = true;
    return { verdict: 'continue' };
  };
  executor.recordIteration = async (_result: unknown, status: string, messages: string[] = []) => {
    iterationRecords.push({ status, messages });
  };

  const result = await executor.executeIteration();

  assert.equal(result, 'error');
  assert.equal(executor.state, 'failed');
  assert.equal(verifyCalled, false);
  assert.equal(commitCalled, false);
  assert.equal(markTaskCompleteCalled, false);
  assert.equal(controllerGateCalled, false);
  assert.equal(controllerCalled, false);
  assert.deepEqual(iterationRecords.map((record) => record.status), ['error']);
  assert.match(iterationRecords[0].messages[0], /LoopExecutor\.executeIteration changed forbidden runner\/loop\/proof\/lifecycle paths: \.ralph\/plan\.json/);
  assert.equal(executor.currentTask.attempts, 1);
  assert.equal(executor.currentTask.status, 'failed');
  assert.match(executor.currentTask.lastError, /LoopExecutor\.executeIteration changed forbidden runner\/loop\/proof\/lifecycle paths: \.ralph\/plan\.json/);
  assert.match(executor.previousErrors[0], /Only edit product source files/);
});

test('executeIteration observes workspace diff instead of agent-declared filesChanged', async () => {
  const workDir = mkdtempSync(path.join(tmpdir(), 'ralph-executor-workspace-diff-truth-'));
  const executor = buildExecutor(workDir) as any;
  setExecutorGitStatusSequence(executor, [
    [],
    gitStatusForChangedFiles(['src/App.tsx']),
  ]);
  await executor.progress.load();

  executor.currentTask = {
    id: 'task-workspace-truth',
    description: 'Ship the feature',
    acceptanceCriteria: ['It works'],
    status: 'pending',
    attempts: 0,
    dependencies: [],
  };
  executor.context.build = async () => 'context';
  executor.savePlanState = () => {};

  let verifyCalled = false;
  setExecutorAgent(executor, async () => ({
    success: true,
    output: completionOutput(),
    filesChanged: ['.ralph/plan.json'],
    completionPromiseFound: true,
  }));
  executor.validateTaskWorkspaceCompletion = async () => [];
  executor.validateRuntimeDataContractCompletion = async () => [];
  executor.verify = async () => {
    verifyCalled = true;
    return { passed: false };
  };
  executor.verification.getErrors = () => ['unit test failed'];
  executor.handleVerificationFailure = async () => {};

  const result = await executor.executeIteration();

  assert.equal(result, 'error');
  assert.equal(verifyCalled, true);
  assert.notEqual(executor.state, 'failed');
  const history = JSON.parse(readFileSync(path.join(workDir, '.ralph', 'iteration-log.json'), 'utf-8'));
  assert.deepEqual(history[0].filesChanged, ['src/App.tsx']);
  assert.deepEqual(history[0].executorOutput.summary.forbiddenChangedFiles, []);
});

test('executeIteration preserves active WIP when exhausted verification follows source changes', async () => {
  const workDir = mkdtempSync(path.join(tmpdir(), 'ralph-executor-verification-wip-'));
  const executor = buildExecutor(workDir, undefined, 'claude-code', {
    controllerEnabled: true,
  }) as any;
  setExecutorGitStatusSequence(executor, [
    [],
    gitStatusForChangedFiles(['src/App.tsx']),
  ]);
  await executor.progress.load();

  executor.currentTask = {
    id: 'task-verification-wip',
    description: 'Ship the feature',
    acceptanceCriteria: ['It works'],
    status: 'pending',
    attempts: executor.options.ralphConfig.maxRetries - 1,
    dependencies: [],
  };
  executor.context.build = async () => 'context';
  executor.savePlanState = () => {};

  let controllerCalled = false;
  setExecutorAgent(executor, async () => ({
    success: true,
    output: completionOutput(),
    filesChanged: ['src/App.tsx'],
    completionPromiseFound: true,
  }));
  executor.validateTaskWorkspaceCompletion = async () => [];
  executor.validateRuntimeDataContractCompletion = async () => [];
  executor.verify = async () => ({ passed: false });
  executor.verification.getErrors = () => ['unit test failed'];
  executor.runController = async () => {
    controllerCalled = true;
    return { verdict: 'revise' };
  };

  const result = await executor.executeIteration();

  assert.equal(result, 'error');
  assert.equal(controllerCalled, false);
  assert.equal(executor.state, 'recovery');
  assert.equal(executor.currentTask.status, 'in_progress');
  assert.equal(executor.currentTask.attempts, executor.options.ralphConfig.maxRetries);
  assert.match(executor.currentTask.lastError, /unit test failed/);
});

test('executeIteration treats declared files as no-op when workspace diff is empty', async () => {
  const workDir = mkdtempSync(path.join(tmpdir(), 'ralph-executor-empty-workspace-diff-'));
  const executor = buildExecutor(workDir) as any;
  setExecutorGitStatusSequence(executor, [
    [],
    [],
  ]);
  await executor.progress.load();

  executor.currentTask = {
    id: 'task-empty-workspace',
    description: 'Ship the feature',
    acceptanceCriteria: ['It works'],
    status: 'pending',
    attempts: 0,
    dependencies: [],
  };
  executor.context.build = async () => 'context';
  executor.savePlanState = () => {};

  let verifyCalled = false;
  const iterationRecords: Array<{ status: string; messages: string[] }> = [];

  setExecutorAgent(executor, async () => ({
    success: true,
    output: 'implemented without completion signal',
    filesChanged: ['src/App.tsx'],
    completionPromiseFound: false,
  }));
  executor.verify = async () => {
    verifyCalled = true;
    return { passed: true };
  };
  executor.recordIteration = async (_result: unknown, status: string, messages: string[] = [], executorOutput?: unknown) => {
    iterationRecords.push({ status, messages });
    assert.equal((executorOutput as any).summary.filesChangedCount, 0);
  };

  const result = await executor.executeIteration();

  assert.equal(result, 'error');
  assert.equal(verifyCalled, false);
  assert.deepEqual(iterationRecords.map((record) => record.status), ['error']);
  assert.deepEqual(iterationRecords[0].messages, ['Agent changed 0 files — no-op iteration']);
  assert.equal(executor.currentTask.attempts, 1);
});

test('executeIteration pauses source delivery when executor source commit fails', async () => {
  const workDir = mkdtempSync(path.join(tmpdir(), 'ralph-executor-source-commit-failure-'));
  const executor = buildExecutor(workDir, undefined, 'claude-code', {
    autoCommit: true,
    autoPush: true,
  }) as any;
  setExecutorGitStatusSequence(executor, [
    [],
    gitStatusForChangedFiles(['src/App.tsx']),
  ]);
  await executor.progress.load();

  executor.currentTask = {
    id: 'task-source-commit',
    description: 'Ship the feature',
    acceptanceCriteria: ['It works'],
    status: 'pending',
    attempts: 0,
    dependencies: [],
  };
  executor.context.build = async () => 'context';
  executor.savePlanState = () => {};

  let markTaskCompleteCalled = false;
  let pushCalled = false;
  let controllerCalled = false;
  setExecutorAgent(executor, async () => ({
    success: true,
    output: completionOutput(),
    filesChanged: ['src/App.tsx'],
    completionPromiseFound: true,
  }));
  executor.validateTaskWorkspaceCompletion = async () => [];
  executor.validateRuntimeDataContractCompletion = async () => [];
  executor.verify = async () => ({ passed: true });
  executor.commitCurrentExecutorSourceChanges = async () => ({
    success: false,
    error: "fatal: Unable to create '/workspace/.git/index.lock': File exists.",
  });
  executor.pushChanges = async () => {
    pushCalled = true;
    return { success: true };
  };
  executor.markTaskComplete = () => {
    markTaskCompleteCalled = true;
  };
  executor.shouldRunController = () => true;
  executor.runController = async () => {
    controllerCalled = true;
    return { verdict: 'continue' };
  };

  const result = await executor.executeIteration();

  const progress = JSON.parse(readFileSync(path.join(workDir, '.arena', 'progress.json'), 'utf-8'));
  assert.equal(result, 'no_work');
  assert.equal(executor.state, 'paused');
  assert.equal(executor.pauseReason, 'infra');
  assert.equal(progress.state, 'paused_infra');
  assert.match(progress.message, /Source delivery failed during agent iteration commit: fatal: Unable to create '\/workspace\/\.git\/index\.lock'/);
  assert.equal(executor.currentTask.status, 'in_progress');
  assert.match(executor.currentTask.lastError, /Source delivery failed during agent iteration commit/);
  assert.equal(markTaskCompleteCalled, false);
  assert.equal(pushCalled, false);
  assert.equal(controllerCalled, false);
});

test('executeIteration pauses source delivery when task status commit fails', async () => {
  const workDir = mkdtempSync(path.join(tmpdir(), 'ralph-executor-task-status-commit-failure-'));
  const specPath = path.join(workDir, 'spec.md');
  writeFileSync(specPath, '# Demo spec\n');

  const executor = buildExecutor(workDir, specPath, 'claude-code', {
    autoCommit: true,
    autoPush: true,
    controllerEnabled: true,
  }) as any;
  setExecutorGitStatusSequence(executor, [
    [],
    gitStatusForChangedFiles(['src/App.tsx']),
  ]);
  await executor.progress.load();

  executor.currentTask = {
    id: 'task-status-commit',
    description: 'Ship the feature',
    acceptanceCriteria: ['It works'],
    status: 'pending',
    attempts: 0,
    dependencies: [],
  };
  executor.context.build = async () => 'context';
  executor.savePlanState = () => {};

  const calls: string[] = [];
  setExecutorAgent(executor, async () => ({
    success: true,
    output: completionOutput(),
    filesChanged: ['src/App.tsx'],
    completionPromiseFound: true,
  }));
  executor.validateTaskWorkspaceCompletion = async () => [];
  executor.validateRuntimeDataContractCompletion = async () => [];
  executor.verify = async () => ({ passed: true });
  executor.refreshArenaRuntimePreviewAfterTaskCompletion = async () => false;
  executor.captureCurrentTaskAfterScreenshotProof = async () => {};
  executor.git.commit = async () => {
    calls.push('source-commit');
    return { success: true, hash: 'source-sha' };
  };
  executor.git.commitPaths = async () => {
    calls.push('status-commit');
    return { success: false, error: "fatal: Unable to create '/workspace/.git/index.lock': File exists." };
  };
  executor.git.push = async () => {
    calls.push('push');
    return { success: true };
  };
  executor.runPostTaskVisualWorkbenchEvidenceAutomation = async () => {
    calls.push('workbench');
    return null;
  };
  executor.shouldRunController = () => true;
  executor.runController = async () => {
    calls.push('controller');
    return { verdict: 'continue' };
  };

  const result = await executor.executeIteration();

  const progress = JSON.parse(readFileSync(path.join(workDir, '.arena', 'progress.json'), 'utf-8'));
  assert.equal(result, 'no_work');
  assert.equal(executor.state, 'paused');
  assert.equal(executor.pauseReason, 'infra');
  assert.equal(progress.state, 'paused_infra');
  assert.match(progress.message, /Source delivery failed during task status commit: fatal: Unable to create '\/workspace\/\.git\/index\.lock'/);
  assert.deepEqual(calls, ['source-commit', 'push', 'status-commit']);
});

test('executeIteration blocks pre-existing source dirtiness before provider call', async () => {
  const workDir = mkdtempSync(path.join(tmpdir(), 'ralph-executor-dirty-before-'));
  const executor = buildExecutor(workDir) as any;
  setExecutorGitStatusSequence(executor, [
    [' M src/App.tsx'],
  ]);
  await executor.progress.load();

  executor.currentTask = {
    id: 'task-dirty-before',
    description: 'Ship the feature',
    acceptanceCriteria: ['It works'],
    status: 'pending',
    attempts: 0,
    dependencies: [],
  };
  executor.context.build = async () => 'context';
  executor.savePlanState = () => {};

  let agentCalled = false;
  setExecutorAgent(executor, async () => {
    agentCalled = true;
    return {
      success: true,
      output: completionOutput(),
      filesChanged: ['src/App.tsx'],
      completionPromiseFound: true,
    };
  });

  const result = await executor.executeIteration();
  const progress = JSON.parse(readFileSync(path.join(workDir, '.arena', 'progress.json'), 'utf-8'));

  assert.equal(result, 'no_work');
  assert.equal(executor.state, 'paused');
  assert.equal(executor.pauseReason, 'infra');
  assert.equal(agentCalled, false);
  assert.equal(executor.currentTask.status, 'pending');
  assert.equal(executor.currentTask.attempts, 0);
  assert.match(executor.currentTask.lastError, /pre-existing changed files are ambiguous: src\/App\.tsx/);
  assert.equal(progress.state, 'paused_infra');
  assert.match(progress.message, /Source delivery failed during pre-agent source evidence check/);
});

test('executeIteration retries materialized spec input source delivery before provider call', async () => {
  const workDir = mkdtempSync(path.join(tmpdir(), 'ralph-executor-materialized-input-dirty-before-'));
  const specPath = path.join(workDir, 'spec.md');
  mkdirSync(path.join(workDir, 'specs'), { recursive: true });
  writeFileSync(path.join(workDir, '.gitignore'), '.ralph/\n');
  writeFileSync(specPath, '# Demo spec\n');
  writeFileSync(path.join(workDir, 'specs', '001-evolution-spec.md'), '# Demo spec\n');

  const executor = buildExecutor(workDir, specPath, 'claude-code', {
    autoCommit: true,
    autoPush: true,
  }) as any;
  setExecutorGitStatusSequence(executor, [
    [' M .gitignore', ' M spec.md', ' M specs/001-evolution-spec.md'],
    [],
    [' M src/App.tsx'],
  ]);
  await executor.progress.load();

  executor.currentTask = {
    id: 'task-materialized-retry',
    description: 'Ship the feature',
    acceptanceCriteria: ['It works'],
    status: 'pending',
    attempts: 0,
    dependencies: [],
  };
  executor.context.build = async () => 'context';
  executor.savePlanState = () => {};

  const calls: string[] = [];
  let agentCalled = false;
  setExecutorAgent(executor, async () => {
    agentCalled = true;
    return {
      success: true,
      output: completionOutput(),
      filesChanged: ['src/App.tsx'],
      completionPromiseFound: true,
    };
  });
  executor.git.commitPaths = async (message: string, paths: string[]) => {
    calls.push(`commit:${message}`);
    calls.push(`paths:${paths.join(',')}`);
    return { success: true, hash: `${message}-hash` };
  };
  executor.git.push = async () => {
    calls.push('git-push');
    return { success: true };
  };
  executor.pushChanges = async () => {
    calls.push('pushChanges');
    return { success: true };
  };
  executor.validateTaskWorkspaceCompletion = async () => [];
  executor.validateRuntimeDataContractCompletion = async () => [];
  executor.verify = async () => ({ passed: true });
  executor.commitCurrentExecutorSourceChanges = async () => {
    calls.push('source-commit');
    return { success: true, hash: 'source-commit-hash' };
  };
  executor.shouldRunController = () => false;

  const result = await executor.executeIteration();

  assert.equal(result, 'success');
  assert.equal(agentCalled, true);
  assert.deepEqual(calls.slice(0, 3), [
    'commit:chore: record accepted spec inputs',
    'paths:.ralph/plan.json,.ralph/plan-archive.jsonl,.ralph/decisions-log.json,.ralph/ralph-progress.json,.ralph/iteration-log.json,.gitignore,spec.md,specs',
    'pushChanges',
  ]);
});

test('executeIteration delivers runner-declared materialized source before provider call', async () => {
  const workDir = mkdtempSync(path.join(tmpdir(), 'ralph-executor-materialized-source-declared-'));
  const specPath = path.join(workDir, 'spec.md');
  mkdirSync(path.join(workDir, 'specs'), { recursive: true });
  mkdirSync(path.join(workDir, '.arena'), { recursive: true });
  writeFileSync(path.join(workDir, '.gitignore'), '.ralph/\n');
  writeFileSync(specPath, '# Demo spec\n');
  writeFileSync(path.join(workDir, 'specs', '001-evolution-spec.md'), '# Demo spec\n');
  writeFileSync(path.join(workDir, 'CLAUDE.md'), '<!-- arena:platform:start -->\ncontract\n<!-- arena:platform:end -->\n');
  writeFileSync(path.join(workDir, '.arena', 'materialized-source.json'), JSON.stringify({
    paths: ['CLAUDE.md'],
  }));

  const executor = buildExecutor(workDir, specPath, 'claude-code', {
    autoCommit: true,
    autoPush: true,
  }) as any;
  setExecutorGitStatusSequence(executor, [
    ['?? .gitignore', '?? CLAUDE.md', '?? spec.md', '?? specs/001-evolution-spec.md'],
    [],
    [' M src/App.tsx'],
  ]);
  await executor.progress.load();

  executor.currentTask = {
    id: 'task-materialized-source',
    description: 'Ship the feature',
    acceptanceCriteria: ['It works'],
    status: 'pending',
    attempts: 0,
    dependencies: [],
  };
  executor.context.build = async () => 'context';
  executor.savePlanState = () => {};

  const calls: string[] = [];
  let agentCalled = false;
  setExecutorAgent(executor, async () => {
    agentCalled = true;
    return {
      success: true,
      output: completionOutput(),
      filesChanged: ['src/App.tsx'],
      completionPromiseFound: true,
    };
  });
  executor.git.commitPaths = async (message: string, paths: string[]) => {
    calls.push(`commit:${message}`);
    calls.push(`paths:${paths.join(',')}`);
    return { success: true, hash: `${message}-hash` };
  };
  executor.git.push = async () => {
    calls.push('git-push');
    return { success: true };
  };
  executor.pushChanges = async () => {
    calls.push('pushChanges');
    return { success: true };
  };
  executor.validateTaskWorkspaceCompletion = async () => [];
  executor.validateRuntimeDataContractCompletion = async () => [];
  executor.verify = async () => ({ passed: true });
  executor.commitCurrentExecutorSourceChanges = async () => {
    calls.push('source-commit');
    return { success: true, hash: 'source-commit-hash' };
  };
  executor.shouldRunController = () => false;

  const result = await executor.executeIteration();

  assert.equal(result, 'success');
  assert.equal(agentCalled, true);
  assert.notEqual(executor.state, 'paused');
  assert.deepEqual(calls.slice(0, 3), [
    'commit:chore: record accepted spec inputs',
    'paths:.ralph/plan.json,.ralph/plan-archive.jsonl,.ralph/decisions-log.json,.ralph/ralph-progress.json,.ralph/iteration-log.json,.gitignore,spec.md,specs,CLAUDE.md',
    'pushChanges',
  ]);
});

test('executeIteration pauses when runner-materialized source is undeclared', async () => {
  const workDir = mkdtempSync(path.join(tmpdir(), 'ralph-executor-materialized-source-undeclared-'));
  const specPath = path.join(workDir, 'spec.md');
  mkdirSync(path.join(workDir, 'specs'), { recursive: true });
  mkdirSync(path.join(workDir, '.arena'), { recursive: true });
  writeFileSync(path.join(workDir, '.gitignore'), '.ralph/\n');
  writeFileSync(specPath, '# Demo spec\n');
  writeFileSync(path.join(workDir, 'specs', '001-evolution-spec.md'), '# Demo spec\n');
  writeFileSync(path.join(workDir, 'CLAUDE.md'), 'contract\n');

  const executor = buildExecutor(workDir, specPath, 'claude-code', {
    autoCommit: true,
    autoPush: true,
  }) as any;
  setExecutorGitStatusSequence(executor, [
    ['?? .gitignore', '?? CLAUDE.md', '?? spec.md', '?? specs/001-evolution-spec.md'],
  ]);
  await executor.progress.load();

  executor.currentTask = {
    id: 'task-materialized-source-undeclared',
    description: 'Ship the feature',
    acceptanceCriteria: ['It works'],
    status: 'pending',
    attempts: 0,
    dependencies: [],
  };
  executor.context.build = async () => 'context';
  executor.savePlanState = () => {};

  let agentCalled = false;
  setExecutorAgent(executor, async () => {
    agentCalled = true;
    return {
      success: true,
      output: completionOutput(),
      filesChanged: [],
      completionPromiseFound: true,
    };
  });
  executor.git.commitPaths = async () => ({ success: true, hash: 'unexpected-commit' });
  executor.shouldRunController = () => false;

  const result = await executor.executeIteration();

  assert.equal(result, 'no_work');
  assert.equal(agentCalled, false);
  assert.equal(executor.state, 'paused');
  assert.match(executor.currentTask.lastError, /pre-existing changed files are ambiguous: .*CLAUDE\.md/);
});

test('executeIteration ignores pre-existing current task workspace notes in source delta', async () => {
  const workDir = mkdtempSync(path.join(tmpdir(), 'ralph-executor-task-workspace-dirty-before-'));
  const executor = buildExecutor(workDir) as any;
  setExecutorGitStatusSequence(executor, [
    ['?? .ralph/tasks/task-workspace/plan.md'],
    [
      '?? .ralph/tasks/task-workspace/plan.md',
      ' M src/App.tsx',
    ],
  ]);
  await executor.progress.load();

  executor.currentTask = {
    id: 'task-workspace',
    description: 'Ship the feature',
    acceptanceCriteria: ['It works'],
    status: 'pending',
    attempts: 0,
    dependencies: [],
  };
  executor.context.build = async () => 'context';
  executor.savePlanState = () => {};

  setExecutorAgent(executor, async () => ({
    success: true,
    output: 'implemented without completion signal',
    filesChanged: ['.ralph/tasks/task-workspace/plan.md', 'src/App.tsx'],
    completionPromiseFound: false,
  }));
  executor.verify = async () => ({ passed: false });
  executor.verification.getErrors = () => ['unit test failed'];
  executor.handleVerificationFailure = async () => {};

  const result = await executor.executeIteration();

  assert.equal(result, 'error');
  const history = JSON.parse(readFileSync(path.join(workDir, '.ralph', 'iteration-log.json'), 'utf-8'));
  assert.deepEqual(history[0].filesChanged, ['src/App.tsx']);
  assert.equal(history[0].executorOutput.summary.filesChangedCount, 1);
});

test('executeIteration allows loop-owned plan status transition before provider call', async () => {
  const workDir = mkdtempSync(path.join(tmpdir(), 'ralph-executor-plan-transition-before-'));
  const executor = buildExecutor(workDir) as any;
  setExecutorGitStatusSequence(executor, [
    [' M .ralph/plan.json'],
    [
      ' M .ralph/plan.json',
      ' M src/App.tsx',
    ],
  ]);
  await executor.progress.load();

  executor.currentTask = {
    id: 'task-plan-transition',
    description: 'Ship the feature',
    acceptanceCriteria: ['It works'],
    status: 'pending',
    attempts: 0,
    dependencies: [],
  };
  executor.context.build = async () => 'context';
  executor.savePlanState = () => {};

  let agentCalled = false;
  setExecutorAgent(executor, async () => {
    agentCalled = true;
    return {
      success: true,
      output: 'implemented without completion signal',
      filesChanged: ['.ralph/plan.json', 'src/App.tsx'],
      completionPromiseFound: false,
    };
  });
  executor.verify = async () => ({ passed: false });
  executor.verification.getErrors = () => ['unit test failed'];
  executor.handleVerificationFailure = async () => {};

  const result = await executor.executeIteration();

  assert.equal(result, 'error');
  assert.equal(agentCalled, true);
  const history = JSON.parse(readFileSync(path.join(workDir, '.ralph', 'iteration-log.json'), 'utf-8'));
  assert.deepEqual(history[0].filesChanged, ['src/App.tsx']);
  assert.equal(history[0].executorOutput.summary.filesChangedCount, 1);
});

test('executeIteration pauses before provider call when source evidence is unavailable', async () => {
  const workDir = mkdtempSync(path.join(tmpdir(), 'ralph-executor-source-evidence-before-'));
  const executor = buildExecutor(workDir) as any;
  setExecutorGitStatusSequence(executor, [null]);
  await executor.progress.load();

  executor.currentTask = {
    id: 'task-source-before',
    description: 'Ship the feature',
    acceptanceCriteria: ['It works'],
    status: 'pending',
    attempts: 0,
    dependencies: [],
  };
  executor.context.build = async () => 'context';
  executor.savePlanState = () => {};

  let agentCalled = false;
  setExecutorAgent(executor, async () => {
    agentCalled = true;
    return {
      success: true,
      output: completionOutput(),
      filesChanged: ['src/App.tsx'],
      completionPromiseFound: true,
    };
  });

  const result = await executor.executeIteration();
  const progress = JSON.parse(readFileSync(path.join(workDir, '.arena', 'progress.json'), 'utf-8'));

  assert.equal(result, 'no_work');
  assert.equal(agentCalled, false);
  assert.equal(executor.state, 'paused');
  assert.equal(executor.pauseReason, 'infra');
  assert.equal(executor.currentTask.status, 'pending');
  assert.equal(executor.currentTask.attempts, 0);
  assert.match(executor.currentTask.lastError, /requires git status evidence before executor agent call/);
  assert.equal(progress.state, 'paused_infra');
});

test('executeIteration fails closed after provider call when source evidence is unavailable', async () => {
  const workDir = mkdtempSync(path.join(tmpdir(), 'ralph-executor-source-evidence-after-'));
  const executor = buildExecutor(workDir) as any;
  setExecutorGitStatusSequence(executor, [
    [],
    null,
  ]);
  await executor.progress.load();

  executor.currentTask = {
    id: 'task-source-after',
    description: 'Ship the feature',
    acceptanceCriteria: ['It works'],
    status: 'pending',
    attempts: 0,
    dependencies: [],
  };
  executor.context.build = async () => 'context';
  executor.savePlanState = () => {};

  let verifyCalled = false;
  const iterationRecords: Array<{ status: string; messages: string[] }> = [];

  setExecutorAgent(executor, async () => ({
    success: true,
    output: completionOutput(),
    filesChanged: ['src/App.tsx'],
    completionPromiseFound: true,
  }));
  executor.verify = async () => {
    verifyCalled = true;
    return { passed: true };
  };
  executor.recordIteration = async (_result: unknown, status: string, messages: string[] = []) => {
    iterationRecords.push({ status, messages });
  };

  const result = await executor.executeIteration();

  assert.equal(result, 'error');
  assert.equal(verifyCalled, false);
  assert.equal(executor.state, 'failed');
  assert.deepEqual(iterationRecords.map((record) => record.status), ['error']);
  assert.match(iterationRecords[0].messages[0], /requires git status evidence after executor agent call/);
  assert.equal(executor.currentTask.status, 'failed');
  assert.equal(executor.currentTask.attempts, 1);
});

test('executeIteration fails before verification when executor changes HEAD', async () => {
  const workDir = mkdtempSync(path.join(tmpdir(), 'ralph-executor-head-mutation-'));
  const executor = buildExecutor(workDir) as any;
  setExecutorGitStatusSequence(executor, [
    [],
    gitStatusForChangedFiles(['src/App.tsx']),
  ]);
  await executor.progress.load();

  executor.currentTask = {
    id: 'task-head',
    description: 'Ship the feature',
    acceptanceCriteria: ['It works'],
    status: 'pending',
    attempts: 0,
    dependencies: [],
  };
  executor.context.build = async () => 'context';
  executor.savePlanState = () => {};

  const heads = ['before-sha', 'after-sha'];
  executor.resolveCurrentGitHeadRef = async () => heads.shift() ?? 'after-sha';

  let verifyCalled = false;
  let controllerGateCalled = false;
  const iterationRecords: Array<{ status: string; messages: string[] }> = [];

  setExecutorAgent(executor, async () => ({
    success: true,
    output: completionOutput(),
    filesChanged: ['src/App.tsx'],
    completionPromiseFound: true,
  }));
  executor.verify = async () => {
    verifyCalled = true;
    return { passed: true };
  };
  executor.shouldRunController = () => {
    controllerGateCalled = true;
    return true;
  };
  executor.recordIteration = async (_result: unknown, status: string, messages: string[] = []) => {
    iterationRecords.push({ status, messages });
  };

  const result = await executor.executeIteration();

  assert.equal(result, 'error');
  assert.equal(executor.state, 'failed');
  assert.equal(verifyCalled, false);
  assert.equal(controllerGateCalled, false);
  assert.deepEqual(iterationRecords.map((record) => record.status), ['error']);
  assert.match(iterationRecords[0].messages[0], /LoopExecutor\.executeIteration must not change HEAD; before=before-sha, after=after-sha/);
  assert.equal(executor.currentTask.status, 'failed');
  assert.equal(executor.currentTask.attempts, 1);
  assert.match(executor.previousErrors[0], /must not change HEAD/);
});

test('executeIteration writes shared executorOutput into production iteration log', async () => {
  const workDir = mkdtempSync(path.join(tmpdir(), 'ralph-executor-output-log-'));
  const executor = buildExecutor(workDir) as any;
  setExecutorGitStatusSequence(executor, [
    [],
    gitStatusForChangedFiles(['src/App.tsx', 'visual-workbench/stories/synth-pad.tsx']),
  ]);
  await executor.progress.load();

  executor.currentTask = {
    id: 'task-output',
    description: 'Ship the visual feature',
    acceptanceCriteria: ['It works'],
    status: 'pending',
    attempts: 0,
    dependencies: [],
    feedbackItemRefs: [{ itemId: 'BUG-001', diffItemId: 'DIFF-001-BUG-001', workSurface: 'frontend' }],
  };
  executor.context.build = async () => 'context';
  executor.savePlanState = () => {};
  setExecutorAgent(executor, async () => ({
    success: true,
    output: 'implemented without completion signal',
    filesChanged: ['src/App.tsx', 'visual-workbench/stories/synth-pad.tsx'],
    completionPromiseFound: false,
  }));
  executor.verify = async () => ({ passed: false });
  executor.verification.getErrors = () => ['unit test failed'];
  executor.handleVerificationFailure = async () => {};

  const result = await executor.executeIteration();

  assert.equal(result, 'error');
  const history = JSON.parse(readFileSync(path.join(workDir, '.ralph', 'iteration-log.json'), 'utf-8'));
  assert.equal(history.length, 1);
  assert.equal(history[0].outcome, 'verification_failed');
  assert.deepEqual(history[0].filesChanged, [
    'src/App.tsx',
    'visual-workbench/stories/synth-pad.tsx',
  ]);
  assert.equal(history[0].executorOutput.ownerBoundary, 'ralph.executor-observer');
  assert.equal(history[0].executorOutput.status, 'work_without_completion_signal');
  assert.equal(history[0].executorOutput.visualEvidenceMode, 'off');
  assert.deepEqual(history[0].executorOutput.visualExpectation, {
    hasStructuredVisualExpectation: true,
    sources: ['task.feedbackItemRefs.workSurface.frontend'],
  });
  assert.equal(history[0].executorOutput.summary.filesChangedCount, 2);
  assert.deepEqual(history[0].executorOutput.summary.changedProductFiles, [
    'src/App.tsx',
    'visual-workbench/stories/synth-pad.tsx',
  ]);
  assert.deepEqual(history[0].executorOutput.summary.changedVisualWorkbenchFiles, [
    'visual-workbench/stories/synth-pad.tsx',
  ]);
});

test('run writes FAILED terminal result for forbidden executor mutation', async () => {
  const workDir = mkdtempSync(path.join(tmpdir(), 'ralph-executor-forbidden-terminal-'));
  const executor = buildExecutor(workDir) as any;
  setExecutorGitStatusSequence(executor, [
    [],
    gitStatusForChangedFiles(['.ralph/plan.json']),
  ]);

  executor.initialize = async () => {
    await executor.progress.load();
    executor.setState('context_building');
    executor.currentTask = {
      id: 'task-terminal',
      description: 'Ship the feature',
      acceptanceCriteria: ['It works'],
      status: 'pending',
      attempts: 0,
      dependencies: [],
    };
    executor.context.build = async () => 'context';
    executor.savePlanState = () => {};
    setExecutorAgent(executor, async () => ({
      success: true,
      output: completionOutput(),
      filesChanged: ['.ralph/plan.json'],
      completionPromiseFound: true,
    }));
    executor.verify = async () => {
      throw new Error('verify must not run');
    };
    executor.recordIteration = async () => {};
  };

  await assert.rejects(() => executor.run(), /Run finished in failed state/);

  const result = JSON.parse(readFileSync(path.join(workDir, '.arena', 'result.json'), 'utf-8'));
  assert.deepEqual(result, {
    status: 'FAILED',
    reason: 'LoopExecutor.executeIteration changed forbidden runner/loop/proof/lifecycle paths: .ralph/plan.json Only edit product source files for this task; do not edit runner/loop/proof/lifecycle truth files.',
  });
});

test('executeIteration distinguishes fresh claims from resumed active WIP', async () => {
  for (const scenario of [
    { name: 'fresh-pending', initialStatus: 'pending', providerHistory: false, expectedActiveWip: false },
    { name: 'pending-with-provider-history', initialStatus: 'pending', providerHistory: true, expectedActiveWip: true },
    { name: 'in-progress', initialStatus: 'in_progress', providerHistory: true, expectedActiveWip: true },
  ] as const) {
    const workDir = mkdtempSync(path.join(tmpdir(), `ralph-executor-active-wip-${scenario.name}-`));
    const executor = buildExecutor(workDir) as any;
    await executor.progress.load();

    executor.currentTask = {
      id: `task-${scenario.name}`,
      description: 'Ship the feature',
      acceptanceCriteria: ['It works'],
      status: scenario.initialStatus,
      attempts: 0,
      dependencies: [],
    };
    executor.savePlanState = () => {};

    let contextActiveWip: boolean | undefined;
    let receivedResumeId: string | undefined;
    executor.context.build = async (options: any) => {
      contextActiveWip = options.activeWipReconciliation;
      return 'context';
    };
    if (scenario.providerHistory) {
      const match = executor.buildProviderSessionCheckpointMatch();
      await executor.providerSessionCheckpoints.recordTaskSession({
        ...match,
        specHash: 'previous-spec-hash',
        sessionId: 'session-active-wip',
        reason: 'task_attempt',
        outcome: 'error',
      });
    }
    setExecutorGitStatusSequence(executor, scenario.expectedActiveWip
      ? [
          [' M src/started.ts'],
          [' M src/started.ts'],
        ]
      : [
          [],
          [],
        ]);
    setExecutorAgent(executor, async (options: any) => {
      receivedResumeId = options.providerSessionResumeId;
      return {
        success: false,
        output: 'Budget exhausted',
        filesChanged: [],
        completionPromiseFound: false,
        error: {
          category: 'budget',
          message: 'Budget exhausted',
        },
      };
    });

    const result = await executor.executeIteration();

    assert.equal(result, 'no_work');
    assert.equal(contextActiveWip, scenario.expectedActiveWip);
    assert.equal(receivedResumeId, scenario.expectedActiveWip ? 'session-active-wip' : undefined);
  }
});

test('executeIteration runs Workbench evidence automation after task status commit and before controller', async () => {
  const workDir = mkdtempSync(path.join(tmpdir(), 'ralph-executor-workbench-hook-order-'));
  const specPath = path.join(workDir, 'spec.md');
  writeFileSync(specPath, '# Visual spec\n');

  const executor = buildExecutor(workDir, specPath, 'claude-code', {
    autoCommit: true,
    autoPush: false,
    controllerEnabled: true,
  }) as any;
  setExecutorGitStatusSequence(executor, [
    [],
    gitStatusForChangedFiles(['src/App.tsx']),
  ]);
  await executor.progress.load();
  executor.options.ralphConfig.visualWorkbench.executorCaptureShell = {
    mode: 'allowlisted',
    allowedServeCommands: ['npm run visual-workbench'],
    allowedBaseUrlEnv: ['VISUAL_WORKBENCH_BASE_URL'],
  };
  executor.options.ralphConfig.visualWorkbench.visualEvidenceMode = 'required';
  executor.planManager.createPlan('spec.md', [{
    id: 'phase-1',
    name: 'Visual work',
    description: 'demo',
    order: 1,
    status: 'in_progress',
    tasks: [{
      id: 'task-vw',
      description: 'Fix the synth pad visual state',
      acceptanceCriteria: ['The synth pad visual state is fixed'],
      status: 'pending',
      attempts: 0,
      dependencies: [],
      feedbackItemRefs: [{ itemId: 'BUG-001', diffItemId: 'DIFF-001-BUG-001', workSurface: 'frontend' }],
    }],
    planLater: false,
  }], [], 'goal');

  const calls: string[] = [];
  executor.context.build = async () => 'context';
  setExecutorAgent(executor, async () => ({
    success: true,
    output: completionOutput(),
    filesChanged: ['src/App.tsx'],
    completionPromiseFound: true,
  }));
  executor.validateTaskWorkspaceCompletion = async () => [];
  executor.validateRuntimeDataContractCompletion = async () => [];
  executor.verify = async () => ({ passed: true });
  executor.refreshArenaRuntimePreviewAfterTaskCompletion = async () => false;
  executor.captureCurrentTaskAfterScreenshotProof = async () => {};
  executor.recordIteration = async () => {};
  executor.git.commit = async (message: string) => {
    calls.push(`commit:${message}`);
    return { success: true, hash: `hash-${calls.length}` };
  };
  executor.git.commitPaths = async (message: string) => {
    calls.push(`commit:${message}`);
    return { success: true, hash: `hash-${calls.length}` };
  };
  executor.shouldRunController = () => true;
  executor.detectControllerTrigger = () => 'phase_completed';
  executor.runPostTaskVisualWorkbenchEvidenceAutomation = async (taskId: string) => {
    calls.push(`workbench:${taskId}:currentTask=${executor.currentTask === null ? 'cleared' : 'present'}`);
    return null;
  };
  executor.runController = async (trigger: string) => {
    calls.push(`controller:${trigger}`);
    return { verdict: 'continue' };
  };

  const result = await executor.executeIteration();

  assert.equal(result, 'success');
  assert.deepEqual(calls, [
    [
      'commit:executor task-vw: Fix the synth pad visual state',
      '',
      'stage: LoopExecutor.executeIteration',
      'action: executor',
      'taskId: task-vw',
      'iteration: 0',
      'verification: passed',
      '[ralph-runtime]',
    ].join('\n'),
    'commit:chore: update task status',
    'workbench:task-vw:currentTask=cleared',
    'controller:phase_completed',
  ]);
});

test('post-task Workbench evidence automation reloads plan, syncs progress and commits evidence separately', async () => {
  const workDir = mkdtempSync(path.join(tmpdir(), 'ralph-executor-workbench-hook-sync-'));
  const specPath = path.join(workDir, 'spec.md');
  writeFileSync(specPath, '# Visual spec\n');

  const executor = buildExecutor(workDir, specPath, 'claude-code', {
    autoCommit: true,
    autoPush: true,
  }) as any;
  await executor.progress.load();
  executor.options.ralphConfig.visualWorkbench.executorCaptureShell = {
    mode: 'allowlisted',
    allowedServeCommands: ['npm run visual-workbench'],
    allowedBaseUrlEnv: ['VISUAL_WORKBENCH_BASE_URL'],
  };
  executor.options.ralphConfig.visualWorkbench.visualEvidenceMode = 'required';
  executor.planManager.createPlan('spec.md', [{
    id: 'phase-1',
    name: 'Visual work',
    description: 'demo',
    order: 1,
    status: 'completed',
    tasks: [{
      id: 'task-vw',
      description: 'Fix the synth pad visual state',
      acceptanceCriteria: ['The synth pad visual state is fixed'],
      status: 'completed',
      attempts: 1,
      dependencies: [],
      feedbackItemRefs: [{ itemId: 'BUG-001', diffItemId: 'DIFF-001-BUG-001', workSurface: 'frontend' }],
    }],
    planLater: false,
  }], [], 'goal');
  await executor.planManager.save();

  const calls: string[] = [];
  let automationInput: any;
  executor.resolveCurrentGitHeadRef = async () => 'head-sha';
  executor.allocateVisualWorkbenchBaseUrl = async () => 'http://127.0.0.1:43001';
  executor.createVisualWorkbenchCaptureOutDir = async () => path.join(tmpdir(), 'ralph-vw-out');
  executor.visualWorkbenchEvidenceAutomationRunner = async (input: any) => {
    automationInput = input;
    executor.planManager.recordTaskVerificationEvidence('task-vw', [{
      kind: 'screenshot',
      ref: 'visual-workbench-capture:synth-pad.playing.desktop:desktop:aaaaaaaaaaaa',
      observedAt: '2026-06-11T12:00:00.000Z',
      summary: 'Captured SynthPad playing state in desktop viewport.',
      result: 'inconclusive',
      feedbackItemIds: ['BUG-001'],
      diffItemIds: ['DIFF-001-BUG-001'],
      taskId: 'task-vw',
      artifactPath: '.ralph/visual-workbench/synth-pad.playing.desktop/desktop/aaaaaaaaaaaa.png',
      artifactSha256: `sha256:${'a'.repeat(64)}`,
      recordedBy: 'agent',
      target: {
        route: '/__visual/synth-pad.playing.desktop',
        viewport: { width: 1280, height: 832 },
        claim: 'The synth pad shows the playing state.',
        state: 'playing',
      },
    }]);
    await executor.planManager.save();
    return {
      schemaVersion: 'ra-356.visual-workbench-automation.v5',
      ownerBoundary: VISUAL_WORKBENCH_AUTOMATION_OWNER_BOUNDARY,
      status: 'published',
      sourceRef: 'head-sha',
      reportPath: path.join(tmpdir(), 'ralph-vw-out', 'visual-workbench-automation-run.json'),
      diagnosticReportPath: path.join(workDir, '.ralph', 'visual-workbench', 'automation-runs', 'task-vw', 'latest.json'),
      taskId: 'task-vw',
      setup: { status: 'ok', errorMessage: null, reportPathWritten: true, diagnosticReportPathWritten: true },
      selector: { status: 'ready', selectedStories: 1, selectedViewports: 1, selections: [], blockers: [], ambiguities: [] },
      shellPolicy: { status: 'allowed', blockers: [] },
      browserReadiness: {
        schemaVersion: 'ra-356.platform-browser-readiness.v1',
        status: 'ready',
        ownerBoundary: 'platform.browser-readiness',
        provider: 'playwright.chromium',
        executablePath: '/tmp/chromium',
        blockers: [],
        errorCode: null,
        errorMessage: null,
      },
      capture: {
        status: 'captured',
        viewerPath: path.join(tmpdir(), 'ralph-vw-out', 'index.html'),
      },
      exports: [{
        storyId: 'synth-pad.playing.desktop',
        viewportName: 'desktop',
        status: 'recorded',
        evidenceRefs: ['visual-workbench-capture:synth-pad.playing.desktop:desktop:aaaaaaaaaaaa'],
        errorMessage: null,
      }],
      publish: { status: 'published', visualEvidenceRows: 1 },
      blockers: [],
    };
  };
  executor.iterationHistory = [{
    iteration: 0,
    taskId: 'task-vw',
    timestamp: '2026-06-11T12:00:00.000Z',
    outcome: 'completed',
    filesChanged: ['src/App.tsx'],
    verificationPassed: true,
  }];
  executor.git.commit = async (message: string) => {
    calls.push(`commit:${message}`);
    return { success: true, hash: 'evidence-commit' };
  };
  executor.pushChanges = async () => {
    calls.push('push');
    return { success: true };
  };

  const pause = await executor.runPostTaskVisualWorkbenchEvidenceAutomation('task-vw');

  assert.equal(pause, null);
  assert.equal(automationInput.sourceRef, 'head-sha');
  assert.equal(automationInput.baseUrl, 'http://127.0.0.1:43001');
  assert.equal(automationInput.manifestPath, 'visual-workbench/manifest.json');
  assert.equal(calls.length, 2);
  assert.match(calls[0] ?? '', /^commit:executor task-vw: Fix the synth pad visual state/m);
  assert.match(calls[0] ?? '', /stage: LoopExecutor\.runPostTaskVisualWorkbenchEvidenceAutomation/);
  assert.match(calls[0] ?? '', /action: visual_workbench_evidence/);
  assert.match(calls[0] ?? '', /taskId: task-vw/);
  assert.match(calls[0] ?? '', /sourceRef: head-sha/);
  assert.match(calls[0] ?? '', /status: published/);
  assert.match(calls[0] ?? '', /evidenceRefs: 1/);
  assert.match(calls[0] ?? '', /publishedRows: 1/);
  assert.equal(calls[1], 'push');

  const plan = JSON.parse(readFileSync(path.join(workDir, '.ralph', 'plan.json'), 'utf8'));
  assert.equal(plan.phases[0].tasks[0].verificationEvidence[0].result, 'inconclusive');
  const progress = JSON.parse(readFileSync(path.join(workDir, '.arena', 'progress.json'), 'utf8'));
  assert.equal(progress.steps[0].visualEvidence[0].sourceEvidenceRef, 'visual-workbench-capture:synth-pad.playing.desktop:desktop:aaaaaaaaaaaa');
  assert.deepEqual(progress.steps[0].visualEvidence[0].diffItemIds, ['DIFF-001-BUG-001']);
  assert.equal(progress.steps[0].visualEvidence[0].artifactSha256, `sha256:${'a'.repeat(64)}`);
  assert.doesNotMatch(JSON.stringify(progress), /artifactPath|proofReviews|ProjectAsset/);
  const iterationLog = JSON.parse(readFileSync(path.join(workDir, '.ralph', 'iteration-log.json'), 'utf8'));
  assert.equal(iterationLog.length, 1);
  assert.equal(iterationLog[0].visualWorkbenchAutomation.ownerBoundary, VISUAL_WORKBENCH_AUTOMATION_OWNER_BOUNDARY);
  assert.equal(iterationLog[0].visualWorkbenchAutomation.status, 'published');
  assert.equal(iterationLog[0].visualWorkbenchAutomation.taskId, 'task-vw');
  assert.equal(iterationLog[0].visualWorkbenchAutomation.sourceRef, 'head-sha');
  assert.equal(iterationLog[0].visualWorkbenchAutomation.selectorStatus, 'ready');
  assert.equal(iterationLog[0].visualWorkbenchAutomation.exportedEvidenceRefs, 1);
  assert.equal(iterationLog[0].visualWorkbenchAutomation.publishedRows, 1);
  assert.deepEqual(iterationLog[0].visualWorkbenchAutomation.blockers, []);
  assert.doesNotMatch(JSON.stringify(iterationLog[0].visualWorkbenchAutomation), /artifactPath|visualEvidenceReviews|proofReviews/);
});

test('post-task Workbench evidence automation does not mask publish failure with progress sync', async () => {
  const workDir = mkdtempSync(path.join(tmpdir(), 'ralph-executor-workbench-hook-publish-failure-'));
  const specPath = path.join(workDir, 'spec.md');
  writeFileSync(specPath, '# Visual spec\n');

  const executor = buildExecutor(workDir, specPath, 'claude-code', {
    autoCommit: true,
    autoPush: false,
  }) as any;
  await executor.progress.load();
  executor.options.ralphConfig.visualWorkbench.executorCaptureShell = {
    mode: 'allowlisted',
    allowedServeCommands: ['npm run visual-workbench'],
    allowedBaseUrlEnv: ['VISUAL_WORKBENCH_BASE_URL'],
  };
  executor.options.ralphConfig.visualWorkbench.visualEvidenceMode = 'required';
  executor.planManager.createPlan('spec.md', [{
    id: 'phase-1',
    name: 'Visual work',
    description: 'demo',
    order: 1,
    status: 'completed',
    tasks: [{
      id: 'task-vw',
      description: 'Fix the synth pad visual state',
      acceptanceCriteria: ['The synth pad visual state is fixed'],
      status: 'completed',
      attempts: 1,
      dependencies: [],
      feedbackItemRefs: [{ itemId: 'BUG-001', diffItemId: 'DIFF-001-BUG-001', workSurface: 'frontend' }],
    }],
    planLater: false,
  }], [], 'goal');
  await executor.planManager.save();

  const calls: string[] = [];
  executor.resolveCurrentGitHeadRef = async () => 'head-sha';
  executor.allocateVisualWorkbenchBaseUrl = async () => 'http://127.0.0.1:43001';
  executor.createVisualWorkbenchCaptureOutDir = async () => path.join(tmpdir(), 'ralph-vw-out');
  executor.visualWorkbenchEvidenceAutomationRunner = async () => {
    executor.planManager.recordTaskVerificationEvidence('task-vw', [{
      kind: 'screenshot',
      ref: 'visual-workbench-capture:synth-pad.playing.desktop:desktop:bbbbbbbbbbbb',
      observedAt: '2026-06-11T12:00:00.000Z',
      summary: 'Captured SynthPad playing state in desktop viewport.',
      result: 'inconclusive',
      feedbackItemIds: ['BUG-001'],
      diffItemIds: ['DIFF-001-BUG-001'],
      taskId: 'task-vw',
      artifactPath: '.ralph/visual-workbench/synth-pad.playing.desktop/desktop/bbbbbbbbbbbb.png',
      artifactSha256: `sha256:${'b'.repeat(64)}`,
      recordedBy: 'agent',
      target: {
        route: '/__visual/synth-pad.playing.desktop',
        viewport: { width: 1280, height: 832 },
        claim: 'The synth pad shows the playing state.',
        state: 'playing',
      },
    }]);
    await executor.planManager.save();
    return {
      schemaVersion: 'ra-356.visual-workbench-automation.v5',
      ownerBoundary: VISUAL_WORKBENCH_AUTOMATION_OWNER_BOUNDARY,
      status: 'publish_failed',
      sourceRef: 'head-sha',
      reportPath: path.join(tmpdir(), 'ralph-vw-out', 'visual-workbench-automation-run.json'),
      diagnosticReportPath: path.join(workDir, '.ralph', 'visual-workbench', 'automation-runs', 'task-vw', 'latest.json'),
      taskId: 'task-vw',
      setup: { status: 'ok', errorMessage: null, reportPathWritten: true, diagnosticReportPathWritten: true },
      selector: { status: 'ready', selectedStories: 1, selectedViewports: 1, selections: [], blockers: [], ambiguities: [] },
      shellPolicy: { status: 'allowed', blockers: [] },
      browserReadiness: {
        schemaVersion: 'ra-356.platform-browser-readiness.v1',
        status: 'ready',
        ownerBoundary: 'platform.browser-readiness',
        provider: 'playwright.chromium',
        executablePath: '/tmp/chromium',
        blockers: [],
        errorCode: null,
        errorMessage: null,
      },
      capture: {
        status: 'captured',
        viewerPath: path.join(tmpdir(), 'ralph-vw-out', 'index.html'),
      },
      exports: [{
        storyId: 'synth-pad.playing.desktop',
        viewportName: 'desktop',
        status: 'recorded',
        evidenceRefs: ['visual-workbench-capture:synth-pad.playing.desktop:desktop:bbbbbbbbbbbb'],
        errorMessage: null,
      }],
      publish: { status: 'failed', visualEvidenceRows: 0, errorMessage: 'progress publish failed' },
      blockers: ['progress_publish_failed'],
    };
  };
  executor.git.commit = async (message: string) => {
    calls.push(`commit:${message}`);
    return { success: true, hash: 'evidence-commit' };
  };

  const pause = await executor.runPostTaskVisualWorkbenchEvidenceAutomation('task-vw');

  assert.equal(pause, null);
  assert.equal(calls.length, 1);
  assert.match(calls[0] ?? '', /^commit:executor task-vw: Fix the synth pad visual state/m);
  assert.match(calls[0] ?? '', /action: visual_workbench_evidence/);
  assert.match(calls[0] ?? '', /sourceRef: head-sha/);
  assert.match(calls[0] ?? '', /status: publish_failed/);
  assert.match(calls[0] ?? '', /evidenceRefs: 1/);
  assert.match(calls[0] ?? '', /publishedRows: 0/);
  const plan = JSON.parse(readFileSync(path.join(workDir, '.ralph', 'plan.json'), 'utf8'));
  assert.equal(plan.phases[0].tasks[0].verificationEvidence[0].ref, 'visual-workbench-capture:synth-pad.playing.desktop:desktop:bbbbbbbbbbbb');
  const progressPath = path.join(workDir, '.arena', 'progress.json');
  if (existsSync(progressPath)) {
    assert.doesNotMatch(readFileSync(progressPath, 'utf8'), /visualEvidence/);
  }
});

test('executeIteration does not resume successful provider session checkpoints', async () => {
  const workDir = mkdtempSync(path.join(tmpdir(), 'ralph-executor-active-wip-success-checkpoint-'));
  const executor = buildExecutor(workDir) as any;
  await executor.progress.load();

  executor.currentTask = {
    id: 'task-in-progress',
    description: 'Ship the feature',
    acceptanceCriteria: ['It works'],
    status: 'in_progress',
    attempts: 0,
    dependencies: [],
  };
  executor.savePlanState = () => {};

  const match = executor.buildProviderSessionCheckpointMatch();
  await executor.providerSessionCheckpoints.recordTaskSession({
    ...match,
    specHash: 'previous-spec-hash',
    sessionId: 'session-success',
    reason: 'task_attempt',
    outcome: 'success',
  });

  let receivedResumeId: string | undefined;
  setExecutorAgent(executor, async (options: any) => {
    receivedResumeId = options.providerSessionResumeId;
    return {
      success: false,
      output: 'Budget exhausted',
      filesChanged: [],
      completionPromiseFound: false,
      error: {
        category: 'budget',
        message: 'Budget exhausted',
      },
    };
  });

  const result = await executor.executeIteration();

  assert.equal(result, 'no_work');
  assert.equal(receivedResumeId, undefined);
});

test('executor action core wrapper records provider sessions for successful task attempts without enabling fresh-claim resume', async () => {
  const workDir = mkdtempSync(path.join(tmpdir(), 'ralph-executor-provider-session-success-'));
  const executor = buildExecutor(workDir) as any;
  await executor.progress.load();

  executor.currentTask = {
    id: 'task-001',
    description: 'Ship the feature',
    acceptanceCriteria: ['It works'],
    status: 'pending',
    attempts: 0,
    dependencies: [],
  };

  let receivedResumeId: string | undefined;
  setExecutorAgent(executor, async (options: any) => {
    receivedResumeId = options.providerSessionResumeId;
    return {
      success: true,
      output: completionOutput(),
      filesChanged: [],
      completionPromiseFound: false,
      providerSession: { id: 'session-success' },
    };
  });

  const result = await executor.runExecutorActionCoreForCurrentTask('prompt', {
    allowProviderSessionResume: false,
  });

  assert.equal(result.status, 'observed');
  assert.equal(result.agentResult.completionPromiseFound, true);
  assert.equal(receivedResumeId, undefined);
  const ledger = JSON.parse(readFileSync(path.join(workDir, '.ralph', 'provider-session-checkpoint.json'), 'utf-8'));
  assert.equal(ledger.version, 2);
  assert.deepEqual(ledger.sessions.map((entry: any) => ({
    taskId: entry.taskId,
    sessionId: entry.sessionId,
    outcome: entry.outcome,
    reason: entry.reason,
  })), [{
    taskId: 'task-001',
    sessionId: 'session-success',
    outcome: 'success',
    reason: 'task_attempt',
  }]);
});

test('executor action core wrapper allows pre-existing loop progress bookkeeping before provider call', async () => {
  const workDir = mkdtempSync(path.join(tmpdir(), 'ralph-executor-loop-progress-pre-agent-'));
  mkdirSync(path.join(workDir, '.ralph'), { recursive: true });
  writeFileSync(path.join(workDir, '.ralph', 'ralph-progress.json'), '{"state":"context_building"}\n');
  const executor = buildExecutor(workDir) as any;
  await executor.progress.load();

  executor.currentTask = {
    id: 'task-001',
    description: 'Ship the feature',
    acceptanceCriteria: ['It works'],
    status: 'pending',
    attempts: 0,
    dependencies: [],
  };
  setExecutorGitStatusSequence(executor, [
    [' M .ralph/ralph-progress.json'],
    [' M .ralph/ralph-progress.json', ' M src/app.ts'],
  ]);

  let called = false;
  setExecutorAgent(executor, async () => {
    called = true;
    return {
      success: true,
      output: completionOutput(),
      filesChanged: ['src/app.ts'],
      completionPromiseFound: false,
    };
  });

  const result = await executor.runExecutorActionCoreForCurrentTask('prompt', {
    allowProviderSessionResume: false,
  });

  assert.equal(called, true);
  assert.equal(result.status, 'observed');
  assert.deepEqual(result.sourceEvidence.preExistingChangedFiles, ['.ralph/ralph-progress.json']);
  assert.deepEqual(result.sourceEvidence.changedFilesForObserver, ['src/app.ts']);
  assert.equal(result.mutationOutcome.status, 'completed');
});

test('executor action core wrapper resumes active WIP dirty product files with a matching provider checkpoint', async () => {
  const workDir = mkdtempSync(path.join(tmpdir(), 'ralph-executor-active-wip-continuation-'));
  const executor = buildExecutor(workDir) as any;
  await executor.progress.load();

  executor.currentTask = {
    id: 'task-001',
    description: 'Ship the feature',
    acceptanceCriteria: ['It works'],
    status: 'in_progress',
    attempts: 0,
    dependencies: [],
  };

  const match = executor.buildProviderSessionCheckpointMatch();
  await executor.providerSessionCheckpoints.recordTaskSession({
    ...match,
    specHash: 'previous-spec-hash',
    sessionId: 'session-active-wip',
    reason: 'task_attempt',
    outcome: 'error',
  });
  setExecutorGitStatusSequence(executor, [
    [' M src/started.ts'],
    [' M src/started.ts', ' M src/finished.ts'],
  ]);

  let receivedResumeId: string | undefined;
  setExecutorAgent(executor, async (options: any) => {
    receivedResumeId = options.providerSessionResumeId;
    return {
      success: true,
      output: completionOutput(),
      filesChanged: [],
      completionPromiseFound: false,
      providerSession: { id: 'session-finished', resumedFrom: 'session-active-wip' },
    };
  });

  const result = await executor.runExecutorActionCoreForCurrentTask('prompt', {
    allowActiveWipWorkspaceResume: true,
    allowSpecHashMismatch: true,
    allowProviderSessionResume: true,
  });

  assert.equal(result.status, 'observed');
  assert.equal(receivedResumeId, 'session-active-wip');
  assert.deepEqual(result.sourceEvidence.preExistingChangedFiles, ['src/started.ts']);
  assert.deepEqual(result.sourceEvidence.changedFilesForObserver, [
    'src/started.ts',
    'src/finished.ts',
  ]);
  assert.equal(result.sourceEvidence.changedFilesSourceLabel, 'Continuation workspace diff');
  assert.equal(result.mutationOutcome.status, 'completed');
});

test('executor action core wrapper continues dirty active WIP even when no provider checkpoint matches', async () => {
  const workDir = mkdtempSync(path.join(tmpdir(), 'ralph-executor-active-wip-no-checkpoint-'));
  const executor = buildExecutor(workDir) as any;
  await executor.progress.load();

  executor.currentTask = {
    id: 'task-001',
    description: 'Ship the feature',
    acceptanceCriteria: ['It works'],
    status: 'in_progress',
    attempts: 0,
    dependencies: [],
  };
  setExecutorGitStatusSequence(executor, [
    [' M src/started.ts'],
    [' M src/started.ts', ' M src/finished.ts'],
  ]);

  let receivedResumeId: string | undefined;
  let called = false;
  setExecutorAgent(executor, async (options: any) => {
    called = true;
    receivedResumeId = options.providerSessionResumeId;
    return {
      success: true,
      output: completionOutput(),
      filesChanged: [],
      completionPromiseFound: false,
    };
  });

  const result = await executor.runExecutorActionCoreForCurrentTask('prompt', {
    allowActiveWipWorkspaceResume: true,
    allowSpecHashMismatch: true,
    allowProviderSessionResume: true,
  });

  assert.equal(called, true);
  assert.equal(result.status, 'observed');
  assert.equal(receivedResumeId, undefined);
  assert.deepEqual(result.sourceEvidence.preExistingChangedFiles, ['src/started.ts']);
  assert.deepEqual(result.sourceEvidence.changedFilesForObserver, [
    'src/started.ts',
    'src/finished.ts',
  ]);
  assert.equal(result.sourceEvidence.changedFilesSourceLabel, 'Continuation workspace diff');
});

test('executeIteration does not continue into verification after a real Codex CLI rate-limit failure with completion signal', async () => {
  const workDir = mkdtempSync(path.join(tmpdir(), 'ralph-executor-real-codex-completion-bypass-'));
  const previousProjectId = process.env.ARENA_PROJECT_ID;
  const previousGovernanceUrl = process.env.ARENA_GOVERNANCE_URL;

  process.env.ARENA_PROJECT_ID = 'proj-1';
  process.env.ARENA_GOVERNANCE_URL = 'http://governance:3000';

  try {
    await withMockCodexScenario('completion_then_rate_limit', async () => {
      const executor = buildExecutor(workDir, undefined, 'codex') as any;
      await executor.progress.load();

      executor.currentTask = {
        id: 'task-009',
        description: 'Ship the feature',
        acceptanceCriteria: ['It works'],
        status: 'pending',
        attempts: 0,
        dependencies: [],
      };
      executor.context.build = async () => 'context';
      executor.savePlanState = () => {};

      let verifyCalled = false;
      let markTaskCompleteCalled = false;
      const iterationStatuses: string[] = [];

      executor.verify = async () => {
        verifyCalled = true;
        return { passed: true };
      };
      executor.recordIteration = async (_result: unknown, status: string) => {
        iterationStatuses.push(status);
      };
      executor.markTaskComplete = () => {
        markTaskCompleteCalled = true;
      };

      const result = await executor.executeIteration();

      assert.equal(result, 'no_work');
      assert.equal(verifyCalled, false);
      assert.equal(markTaskCompleteCalled, false);
      assert.deepEqual(iterationStatuses, ['error']);
      assert.equal(executor.pauseReason, 'rate_limit');
      assert.equal(executor.exitReason, 'paused');
    });
  } finally {
    if (previousProjectId === undefined) {
      delete process.env.ARENA_PROJECT_ID;
    } else {
      process.env.ARENA_PROJECT_ID = previousProjectId;
    }
    if (previousGovernanceUrl === undefined) {
      delete process.env.ARENA_GOVERNANCE_URL;
    } else {
      process.env.ARENA_GOVERNANCE_URL = previousGovernanceUrl;
    }
  }
});

test('executeIteration pauses the arena run on a real Codex CLI budget failure', async () => {
  const workDir = mkdtempSync(path.join(tmpdir(), 'ralph-executor-real-codex-budget-'));
  const previousProjectId = process.env.ARENA_PROJECT_ID;
  const previousGovernanceUrl = process.env.ARENA_GOVERNANCE_URL;

  process.env.ARENA_PROJECT_ID = 'proj-1';
  process.env.ARENA_GOVERNANCE_URL = 'http://governance:3000';

  try {
    await withMockCodexScenario('budget', async () => {
      const executor = buildExecutor(workDir, undefined, 'codex') as any;
      await executor.progress.load();

      executor.currentTask = {
        id: 'task-010',
        description: 'Ship the feature',
        acceptanceCriteria: ['It works'],
        status: 'pending',
        attempts: 0,
        dependencies: [],
      };
      executor.context.build = async () => 'context';
      executor.savePlanState = () => {};

      let verifyCalled = false;
      executor.verify = async () => {
        verifyCalled = true;
        return { passed: true };
      };

      const result = await executor.executeIteration();
      const progress = JSON.parse(readFileSync(path.join(workDir, '.arena', 'progress.json'), 'utf-8'));

      assert.equal(result, 'no_work');
      assert.equal(verifyCalled, false);
      assert.equal(executor.state, 'paused');
      assert.equal(executor.exitReason, 'paused');
      assert.equal(executor.pauseReason, 'budget');
      assert.equal(progress.state, 'paused_budget');
      assert.match(progress.message, /budget exhausted/i);
    });
  } finally {
    if (previousProjectId === undefined) {
      delete process.env.ARENA_PROJECT_ID;
    } else {
      process.env.ARENA_PROJECT_ID = previousProjectId;
    }
    if (previousGovernanceUrl === undefined) {
      delete process.env.ARENA_GOVERNANCE_URL;
    } else {
      process.env.ARENA_GOVERNANCE_URL = previousGovernanceUrl;
    }
  }
});

test('executeIteration rejects completion when task plan remains the scaffold', async () => {
  const workDir = mkdtempSync(path.join(tmpdir(), 'ralph-executor-task-plan-required-'));
  const specPath = path.join(workDir, 'spec.md');
  writeFileSync(specPath, '# Demo spec\n');

  const executor = buildExecutor(workDir, specPath) as any;
  await executor.progress.load();

  executor.currentTask = {
    id: 'task-009',
    description: 'Ship the feature',
    acceptanceCriteria: ['It works'],
    status: 'pending',
    attempts: 0,
    dependencies: [],
  };
  executor.savePlanState = () => {};

  let verifyCalled = false;
  const iterationStatuses: string[] = [];

  setExecutorAgent(executor, async () => ({
    success: true,
    output: completionOutput(),
    filesChanged: ['src/index.ts'],
    completionPromiseFound: true,
  }));
  executor.verify = async () => {
    verifyCalled = true;
    return { passed: true };
  };
  executor.recordIteration = async (_result: unknown, status: string) => {
    iterationStatuses.push(status);
  };

  const result = await executor.executeIteration();

  assert.equal(result, 'error');
  assert.equal(verifyCalled, false);
  assert.deepEqual(iterationStatuses, ['error']);
  assert.equal(executor.currentTask.attempts, 1);
  assert.match(executor.currentTask.lastError, /plan\.md/);
});

test('executeIteration requires role-pass output files before completion', async () => {
  const workDir = mkdtempSync(path.join(tmpdir(), 'ralph-executor-task-role-output-required-'));
  const specPath = path.join(workDir, 'spec.md');
  writeFileSync(specPath, '# Demo spec\n');

  const executor = buildExecutor(workDir, specPath) as any;
  await executor.progress.load();

  executor.currentTask = {
    id: 'task-010',
    description: 'Ship the product-heavy feature',
    acceptanceCriteria: ['It works'],
    status: 'pending',
    attempts: 0,
    dependencies: [],
    requiredRolePasses: ['product'],
  };
  executor.savePlanState = () => {};

  let verifyCalled = false;
  const iterationStatuses: string[] = [];

  setExecutorAgent(executor, async () => {
    const taskFolder = path.join(workDir, '.ralph', 'tasks', 'task-010');
    writeFileSync(
      path.join(taskFolder, 'plan.md'),
      [
        '# task-010 Plan',
        '',
        '## Approach',
        '- Implement the product-heavy behavior directly in the app surface.',
        '',
        '## Files / Surfaces',
        '- src/index.ts',
        '',
        '## Checks',
        '- focused smoke',
        '',
      ].join('\n'),
    );
    return {
      success: true,
      output: completionOutput(),
      filesChanged: ['src/index.ts', '.ralph/tasks/task-010/plan.md'],
      completionPromiseFound: true,
    };
  });
  executor.verify = async () => {
    verifyCalled = true;
    return { passed: true };
  };
  executor.recordIteration = async (_result: unknown, status: string) => {
    iterationStatuses.push(status);
  };

  const result = await executor.executeIteration();

  assert.equal(result, 'error');
  assert.equal(verifyCalled, false);
  assert.deepEqual(iterationStatuses, ['error']);
  assert.match(executor.currentTask.lastError, /product\.md/);
});

test('executeIteration does not mark a task completed after shutdown interrupts verification', async () => {
  const workDir = mkdtempSync(path.join(tmpdir(), 'ralph-executor-verify-shutdown-'));
  const previousProjectId = process.env.ARENA_PROJECT_ID;
  const previousGovernanceUrl = process.env.ARENA_GOVERNANCE_URL;

  process.env.ARENA_PROJECT_ID = 'proj-1';
  process.env.ARENA_GOVERNANCE_URL = 'http://governance:3000';

  try {
    const executor = buildExecutor(workDir) as any;
    await executor.progress.load();

    executor.currentTask = {
      id: 'task-008',
      description: 'Verify the feature',
      acceptanceCriteria: ['It works'],
      status: 'pending',
      attempts: 0,
      dependencies: [],
    };
    executor.context.build = async () => {
      const taskFolder = path.join(workDir, '.ralph', 'tasks', 'task-008');
      mkdirSync(taskFolder, { recursive: true });
      writeFileSync(
        path.join(taskFolder, 'plan.md'),
        [
          '# task-008 Plan',
          '',
          '## Approach',
          '- Verify the feature with the existing source implementation.',
          '',
          '## Files / Surfaces',
          '- src/index.ts',
          '',
          '## Checks',
          '- verification shutdown path',
          '',
        ].join('\n'),
      );
      return 'context';
    };
    executor.savePlanState = () => {};

    let markTaskCompleteCalled = false;
    const iterationStatuses: string[] = [];

    setExecutorAgent(executor, async () => ({
      success: true,
      output: completionOutput('done'),
      filesChanged: ['src/index.ts'],
      completionPromiseFound: true,
    }));
    executor.verify = async () => {
      await executor.gracefulShutdown();
      return { passed: true };
    };
    executor.recordIteration = async (_result: unknown, status: string) => {
      iterationStatuses.push(status);
    };
    executor.markTaskComplete = () => {
      markTaskCompleteCalled = true;
    };

    const result = await executor.executeIteration();
    const progress = JSON.parse(readFileSync(path.join(workDir, '.arena', 'progress.json'), 'utf-8'));
    const terminal = JSON.parse(readFileSync(path.join(workDir, '.arena', 'result.json'), 'utf-8'));

    assert.equal(result, 'no_work');
    assert.equal(markTaskCompleteCalled, false);
    assert.deepEqual(iterationStatuses, []);
    assert.equal(executor.currentTask.status, 'in_progress');
    assert.equal(progress.state, 'paused_infra');
    assert.deepEqual(terminal, {
      status: 'CANCELED',
      reason: 'Verification interrupted by signal before completion',
      pauseReason: 'INFRA',
    });
  } finally {
    if (previousProjectId === undefined) {
      delete process.env.ARENA_PROJECT_ID;
    } else {
      process.env.ARENA_PROJECT_ID = previousProjectId;
    }
    if (previousGovernanceUrl === undefined) {
      delete process.env.ARENA_GOVERNANCE_URL;
    } else {
      process.env.ARENA_GOVERNANCE_URL = previousGovernanceUrl;
    }
  }
});
