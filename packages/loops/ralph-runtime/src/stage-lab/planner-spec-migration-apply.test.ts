import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { execa } from 'execa';
import type { AgentOptions } from '../agents/base.js';
import type { AgentResult } from '../config/types.js';
import {
  PLANNER_SPEC_MIGRATION_APPLY_REPORT_FILE,
  PLANNER_SPEC_MIGRATION_APPLY_RESULT_SCHEMA_VERSION,
  type PlannerSpecMigrationApplyAgent,
  runPlannerSpecMigrationApply,
} from './planner-spec-migration-apply.js';

test('planner_spec_migration_apply materializes accepted spec changes through shared plan owner and stops', async () => {
  const workDir = await createGitWorkspace();
  const sourceRef = await git(workDir, 'rev-parse', 'HEAD');
  const outDir = await mkdtemp(path.join(os.tmpdir(), 'planner-spec-apply-out-'));
  let capturedPrompt = '';

  const result = await runPlannerSpecMigrationApply({
    snapshot: baseSnapshot({ liveWorkspacePath: workDir, sourceRef }),
    sourceRef,
    outDir,
    agent: testAgent(async (options) => {
      capturedPrompt = options.prompt;
      assert.equal(options.workDir, workDir);
      assert.equal(options.model, 'test-model');
      assert.equal(options.timeout, 3);
      return agentResult({
        output: migrationJsonOutput(),
      });
    }),
    model: 'test-model',
    timeoutMinutes: 3,
  });

  const report = JSON.parse(await readFile(path.join(outDir, PLANNER_SPEC_MIGRATION_APPLY_REPORT_FILE), 'utf8'));
  const plan = JSON.parse(await readFile(path.join(workDir, '.ralph', 'plan.json'), 'utf8'));
  const headAfter = await git(workDir, 'rev-parse', 'HEAD');

  assert.equal(result.schemaVersion, PLANNER_SPEC_MIGRATION_APPLY_RESULT_SCHEMA_VERSION);
  assert.equal(result.status, 'completed');
  assert.equal(result.stage.stageId, 'planner_spec_migration_apply');
  assert.equal(result.stage.ownerBoundary, 'ralph.planner-spec-migration-apply');
  assert.equal(result.input.projectId, 'project-stook');
  assert.equal(result.input.workDir, workDir);
  assert.equal(result.input.spec, 'spec.md');
  assert.equal(result.input.visualEvidenceMode, 'required');
  assert.equal(result.provider.timeoutMinutes, 3);
  assert.equal(result.applyOutput?.ownerBoundary, 'ralph.planner-spec-migration-apply');
  assert.equal(result.applyOutput?.recordedCount, 1);
  assert.equal(result.applyOutput?.plannerAppliedCount, 1);
  assert.match(capturedPrompt, /Updated mixer controls/);
  assert.equal(plan.phases[0].tasks.some((task: any) => task.id === 'task-002'), true);
  assert.equal(plan.specMigrations.length, 1);
  assert.equal(headAfter, sourceRef);
  assert.deepEqual(result.source.forbiddenChangedFiles, []);
  assert(result.source.allowedChangedFiles.includes('.ralph/plan.json'));
  assert(result.source.allowedChangedFiles.includes('.ralph/decisions-log.json'));
  assert(result.source.allowedChangedFiles.includes('.ralph/prompt-trace.jsonl'));
  assert.equal(report.applyOutput.ownerBoundary, 'ralph.planner-spec-migration-apply');
});

test('planner_spec_migration_apply blocks source-ref mismatch before provider creation', async () => {
  const workDir = await createGitWorkspace();
  const sourceRef = await git(workDir, 'rev-parse', 'HEAD');
  const outDir = await mkdtemp(path.join(os.tmpdir(), 'planner-spec-apply-out-'));
  let called = false;

  const result = await runPlannerSpecMigrationApply({
    snapshot: baseSnapshot({ liveWorkspacePath: workDir, sourceRef }),
    sourceRef: 'HEAD',
    outDir,
    agent: testAgent(async () => {
      called = true;
      return agentResult({ output: migrationJsonOutput() });
    }),
    model: 'test-model',
    timeoutMinutes: 3,
  });

  assert.equal(called, false);
  assert.equal(result.status, 'blocked');
  assert.equal(result.error?.code, 'source_ref_not_snapshot_commit');
  assert.equal(result.applyOutput, null);
});

test('planner_spec_migration_apply reports invalid snapshot spec path before provider creation', async () => {
  const workDir = await createGitWorkspace();
  const sourceRef = await git(workDir, 'rev-parse', 'HEAD');
  const outDir = await mkdtemp(path.join(os.tmpdir(), 'planner-spec-apply-out-'));
  let called = false;

  const result = await runPlannerSpecMigrationApply({
    snapshot: baseSnapshot({ liveWorkspacePath: workDir, sourceRef, specFile: '../spec.md' }),
    sourceRef,
    outDir,
    agent: testAgent(async () => {
      called = true;
      return agentResult({ output: migrationJsonOutput() });
    }),
    model: 'test-model',
    timeoutMinutes: 3,
  });

  const report = JSON.parse(await readFile(path.join(outDir, PLANNER_SPEC_MIGRATION_APPLY_REPORT_FILE), 'utf8'));
  assert.equal(called, false);
  assert.equal(result.status, 'blocked');
  assert.equal(result.error?.code, 'spec_ref_invalid');
  assert.equal(result.applyOutput, null);
  assert.equal(report.error.code, 'spec_ref_invalid');
});

test('planner_spec_migration_apply fails closed when provider mutates source files', async () => {
  const workDir = await createGitWorkspace();
  const sourceRef = await git(workDir, 'rev-parse', 'HEAD');
  const outDir = await mkdtemp(path.join(os.tmpdir(), 'planner-spec-apply-out-'));

  const result = await runPlannerSpecMigrationApply({
    snapshot: baseSnapshot({ liveWorkspacePath: workDir, sourceRef }),
    sourceRef,
    outDir,
    agent: testAgent(async () => {
      await writeFile(path.join(workDir, 'src', 'PlannerSideEffect.tsx'), 'export const sideEffect = true;\n', 'utf8');
      return agentResult({ output: migrationJsonOutput() });
    }),
    model: 'test-model',
    timeoutMinutes: 3,
  });

  assert.equal(result.status, 'forbidden_mutation');
  assert.equal(result.error?.code, 'forbidden_mutation');
  assert(result.source.forbiddenChangedFiles.includes('src/PlannerSideEffect.tsx'));
});

async function createGitWorkspace(): Promise<string> {
  const workDir = await mkdtemp(path.join(os.tmpdir(), 'planner-spec-apply-src-'));
  await mkdir(path.join(workDir, 'src'), { recursive: true });
  await mkdir(path.join(workDir, '.ralph'), { recursive: true });
  await writeFile(path.join(workDir, 'src', 'App.tsx'), 'export const App = () => "STOOK";\n', 'utf8');
  await writeFile(path.join(workDir, 'spec.md'), '# STOOK\n\nUpdated mixer controls.\n', 'utf8');
  await writeFile(path.join(workDir, 'project.config.json'), JSON.stringify({
    name: 'STOOK',
    description: 'Mini synths for non-musicians.',
    techStack: {
      language: 'TypeScript',
      framework: 'React',
      runtime: 'Vite',
    },
    repository: {
      url: 'https://example.invalid/stook.git',
      branch: 'main',
    },
  }, null, 2), 'utf8');
  await writeFile(path.join(workDir, '.ralph', 'plan.json'), JSON.stringify({
    version: 1,
    specFile: 'spec.md',
    specHash: 'old-spec-hash',
    projectGoal: 'Build STOOK visual-first synth lab.',
    createdAt: '2026-06-15T00:00:00.000Z',
    updatedAt: '2026-06-15T00:00:00.000Z',
    phases: [
      {
        id: 'phase-1',
        name: 'Build mixer',
        description: 'Mixer basics.',
        order: 1,
        status: 'pending',
        tasks: [
          {
            id: 'task-001',
            displayTitle: 'Create base mixer',
            description: 'Base mixer shell.',
            acceptanceCriteria: ['Mixer shell exists.'],
            status: 'completed',
          },
        ],
      },
    ],
    judgments: [],
    specMigrations: [],
  }, null, 2), 'utf8');
  await git(workDir, 'init');
  await git(workDir, 'config', 'user.email', 'test@example.com');
  await git(workDir, 'config', 'user.name', 'Test User');
  await git(workDir, 'add', '.');
  await git(workDir, 'commit', '-m', 'initial');
  return workDir;
}

function baseSnapshot(input: {
  liveWorkspacePath: string;
  sourceRef: string;
  specFile?: string | null;
}) {
  return {
    schemaVersion: 'ra-356.project-stage-snapshot.v1',
    generatedAt: '2026-06-15T13:00:00.000Z',
    projectId: 'project-stook',
    selectedTaskId: null,
    stageBoundary: {
      ownerBoundary: 'arena-ctl.project-stage-snapshot',
      mode: 'read_only',
      allowed: ['none'],
      forbidden: ['no_provider_call'],
    },
    source: {
      workspace: {
        available: true,
        path: input.liveWorkspacePath,
        isGitRepo: true,
        commitSha: input.sourceRef,
      },
    },
    visualEvidencePolicy: {
      owner: 'governance.runner-init-readiness.ralphConfig',
      status: 'ready',
      visualEvidenceMode: 'required',
      blockers: [],
      notes: ['visualEvidenceMode=required'],
    },
    plan: {
      status: 'ready',
      reasonCode: null,
      specFile: input.specFile === undefined ? 'spec.md' : input.specFile,
    },
  };
}

function migrationJsonOutput(): string {
  const payload = JSON.stringify({
    summary: 'Add the updated mixer controls task.',
    planChanges: [
      {
        action: 'addTask',
        phaseId: 'phase-1',
        task: {
          id: 'task-002',
          displayTitle: 'Add mixer controls',
          description: 'Add the updated mixer controls for live jamming.',
          acceptanceCriteria: ['Mixer controls are visible.'],
          status: 'pending',
          visualEvidenceRequired: true,
        },
      },
    ],
    newJudgments: [],
    feedbackDispositions: [],
  });
  return `Planner migration result:\n\`\`\`json\n${payload}\n\`\`\``;
}

function testAgent(execute: (options: AgentOptions) => Promise<AgentResult>): PlannerSpecMigrationApplyAgent {
  return {
    name: 'codex',
    execute,
  };
}

function agentResult(input: {
  output: string;
  success?: boolean;
  filesChanged?: string[];
}): AgentResult {
  return {
    success: input.success ?? true,
    output: input.output,
    filesChanged: input.filesChanged ?? [],
    completionPromiseFound: false,
  };
}

async function git(cwd: string, ...args: string[]): Promise<string> {
  const result = await execa('git', args, { cwd });
  return result.stdout.trim();
}
