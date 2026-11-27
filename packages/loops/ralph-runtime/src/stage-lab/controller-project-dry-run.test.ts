import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { execa } from 'execa';
import type { AgentOptions } from '../agents/base.js';
import type { AgentResult } from '../config/types.js';
import { CONTROLLER_DRY_RUN_AUDIT_OWNER_BOUNDARY } from '../control/controller.js';
import {
  CONTROLLER_PROJECT_DRY_RUN_REPORT_FILE,
  CONTROLLER_PROJECT_DRY_RUN_RESULT_SCHEMA_VERSION,
  type ControllerProjectDryRunAgent,
  runControllerProjectDryRun,
} from './controller-project-dry-run.js';

test('controller_project_dry_run runs one controller provider call without applying controller truth', async () => {
  const liveWorkspacePath = await mkdtemp(path.join(os.tmpdir(), 'controller-project-dry-run-live-'));
  const workDir = await createGitWorkspace();
  const sourceRef = await git(workDir, 'rev-parse', 'HEAD');
  const outDir = await mkdtemp(path.join(os.tmpdir(), 'controller-project-dry-run-out-'));
  let capturedPrompt = '';

  const result = await runControllerProjectDryRun({
    snapshot: baseSnapshot({ liveWorkspacePath, sourceRef }),
    workDir,
    sourceRef,
    spec: 'spec.md',
    trigger: 'manual',
    visualEvidenceMode: 'new_tasks_only',
    outDir,
    agent: testAgent(async (options) => {
      capturedPrompt = options.prompt;
      assert.equal(options.workDir, workDir);
      assert.deepEqual(options.allowedTools, []);
      assert.equal(options.model, 'test-model');
      assert.equal(options.timeout, 3);
      return agentResult({ output: controllerJsonOutput() });
    }),
    model: 'test-model',
    timeoutMinutes: 3,
  });

  const report = JSON.parse(await readFile(path.join(outDir, CONTROLLER_PROJECT_DRY_RUN_REPORT_FILE), 'utf8'));
  assert.equal(result.schemaVersion, CONTROLLER_PROJECT_DRY_RUN_RESULT_SCHEMA_VERSION);
  assert.equal(result.status, 'completed');
  assert.equal(result.stage.stageId, 'controller_project_dry_run');
  assert.equal(result.stage.mode, 'workspace_dry_run');
  assert.equal(result.stage.ownerBoundary, 'ralph.controller.dry-run-adapter');
  assert.equal(result.input.projectId, 'project-stook');
  assert.equal(result.input.spec, 'spec.md');
  assert.equal(result.input.trigger, 'manual');
  assert.equal(result.prepared?.promptId, 'controller.audit');
  assert.equal(result.prepared?.e2eEnabled, false);
  assert.equal(result.controllerOutput.ownerBoundary, CONTROLLER_DRY_RUN_AUDIT_OWNER_BOUNDARY);
  assert.equal(result.controllerOutput.verdict, 'continue');
  assert.equal(result.controllerOutput.summary, 'The selected STOOK state is coherent.');
  assert.equal(result.controllerOutput.planChangeCount, 0);
  assert.equal('report' in result.controllerOutput, false);
  assert.match(capturedPrompt, /Mini synths for non-musicians/);
  assert.match(capturedPrompt, /Controller audit/i);
  assert.equal(await pathExists(path.join(workDir, '.ralph', 'controller-reports')), false);
  assert.equal(await pathExists(path.join(workDir, '.ralph', 'agent-logs')), false);
  assert.equal(await pathExists(path.join(workDir, '.ralph', 'prompt-traces')), false);
  assert.equal(await git(workDir, 'status', '--porcelain', '-uall'), '');
  assert.equal(report.status, 'completed');
  assert.equal(report.controllerOutput.ownerBoundary, CONTROLLER_DRY_RUN_AUDIT_OWNER_BOUNDARY);
  assert.equal('report' in report.controllerOutput, false);
});

test('controller_project_dry_run blocks source-ref/spec mismatches before calling agent', async () => {
  const liveWorkspacePath = await mkdtemp(path.join(os.tmpdir(), 'controller-project-dry-run-live-'));
  const workDir = await createGitWorkspace();
  const sourceRef = await git(workDir, 'rev-parse', 'HEAD');
  const outDir = await mkdtemp(path.join(os.tmpdir(), 'controller-project-dry-run-out-'));
  let called = false;

  const result = await runControllerProjectDryRun({
    snapshot: baseSnapshot({ liveWorkspacePath, sourceRef, specFile: 'spec.md' }),
    workDir,
    sourceRef,
    spec: 'other-spec.md',
    trigger: 'manual',
    visualEvidenceMode: 'off',
    outDir,
    agent: testAgent(async () => {
      called = true;
      return agentResult({ output: controllerJsonOutput() });
    }),
    model: 'test-model',
    timeoutMinutes: 3,
  });

  assert.equal(called, false);
  assert.equal(result.status, 'blocked');
  assert.equal(result.error?.code, 'spec_ref_mismatch');
  assert.equal(result.controllerOutput.ownerBoundary, null);
});

test('controller_project_dry_run rejects the live snapshot workspace path', async () => {
  const workDir = await createGitWorkspace();
  const sourceRef = await git(workDir, 'rev-parse', 'HEAD');
  const outDir = await mkdtemp(path.join(os.tmpdir(), 'controller-project-dry-run-out-'));
  let called = false;

  const result = await runControllerProjectDryRun({
    snapshot: baseSnapshot({ liveWorkspacePath: workDir, sourceRef }),
    workDir,
    sourceRef,
    spec: 'spec.md',
    trigger: 'manual',
    visualEvidenceMode: 'off',
    outDir,
    agent: testAgent(async () => {
      called = true;
      return agentResult({ output: controllerJsonOutput() });
    }),
    model: 'test-model',
    timeoutMinutes: 3,
  });

  assert.equal(called, false);
  assert.equal(result.status, 'blocked');
  assert.equal(result.error?.code, 'live_workspace_forbidden');
});

test('controller_project_dry_run blocks when snapshot live workspace path is missing', async () => {
  const workDir = await createGitWorkspace();
  const sourceRef = await git(workDir, 'rev-parse', 'HEAD');
  const outDir = await mkdtemp(path.join(os.tmpdir(), 'controller-project-dry-run-out-'));
  let called = false;

  const result = await runControllerProjectDryRun({
    snapshot: baseSnapshot({ liveWorkspacePath: null, sourceRef }),
    workDir,
    sourceRef,
    spec: 'spec.md',
    trigger: 'manual',
    visualEvidenceMode: 'off',
    outDir,
    agent: testAgent(async () => {
      called = true;
      return agentResult({ output: controllerJsonOutput() });
    }),
    model: 'test-model',
    timeoutMinutes: 3,
  });

  assert.equal(called, false);
  assert.equal(result.status, 'blocked');
  assert.equal(result.error?.code, 'source_workspace_path_unavailable');
});

test('controller_project_dry_run surfaces invalid controller output instead of silently normalizing it', async () => {
  const liveWorkspacePath = await mkdtemp(path.join(os.tmpdir(), 'controller-project-dry-run-live-'));
  const workDir = await createGitWorkspace();
  const sourceRef = await git(workDir, 'rev-parse', 'HEAD');
  const outDir = await mkdtemp(path.join(os.tmpdir(), 'controller-project-dry-run-out-'));

  const result = await runControllerProjectDryRun({
    snapshot: baseSnapshot({ liveWorkspacePath, sourceRef }),
    workDir,
    sourceRef,
    spec: 'spec.md',
    trigger: 'manual',
    visualEvidenceMode: 'off',
    outDir,
    agent: testAgent(async () => agentResult({
      output: `Controller result:\n\`\`\`json\n{"verdict":"keep-going","summary":"bad","planChanges":[{"action":"addTask"}],"newJudgments":[],"revisedJudgments":[]}\n\`\`\``,
    })),
    model: 'test-model',
    timeoutMinutes: 3,
  });

  assert.equal(result.status, 'parse_or_validation_failed');
  assert.equal(result.error?.code, 'parse_or_validation_failed');
  assert.match(result.error?.message ?? '', /invalid verdict|invalid planChanges/);
  assert.equal(await git(workDir, 'status', '--porcelain', '-uall'), '');
});

test('controller_project_dry_run fails closed when agent mutates the source workspace', async () => {
  const liveWorkspacePath = await mkdtemp(path.join(os.tmpdir(), 'controller-project-dry-run-live-'));
  const workDir = await createGitWorkspace();
  const sourceRef = await git(workDir, 'rev-parse', 'HEAD');
  const outDir = await mkdtemp(path.join(os.tmpdir(), 'controller-project-dry-run-out-'));

  const result = await runControllerProjectDryRun({
    snapshot: baseSnapshot({ liveWorkspacePath, sourceRef }),
    workDir,
    sourceRef,
    spec: 'spec.md',
    trigger: 'manual',
    visualEvidenceMode: 'required',
    outDir,
    agent: testAgent(async () => {
      await writeFile(path.join(workDir, 'src', 'ControllerSideEffect.tsx'), 'export const sideEffect = true;\n', 'utf8');
      return agentResult({
        output: controllerJsonOutput(),
        filesChanged: ['src/ControllerSideEffect.tsx'],
      });
    }),
    model: 'test-model',
    timeoutMinutes: 3,
  });

  assert.equal(result.status, 'forbidden_mutation');
  assert.equal(result.error?.code, 'forbidden_mutation');
  assert.deepEqual(result.source.changedFilesFromGitStatus, ['src/ControllerSideEffect.tsx']);
});

async function createGitWorkspace(): Promise<string> {
  const workDir = await mkdtemp(path.join(os.tmpdir(), 'controller-project-dry-run-src-'));
  await mkdir(path.join(workDir, 'src'), { recursive: true });
  await mkdir(path.join(workDir, '.ralph'), { recursive: true });
  await writeFile(path.join(workDir, 'src', 'App.tsx'), 'export const App = () => "STOOK";\n', 'utf8');
  await writeFile(path.join(workDir, 'spec.md'), '# STOOK\n\nMini synths for non-musicians.\n', 'utf8');
  await writeFile(path.join(workDir, 'package.json'), '{"scripts":{"dev":"vite"},"dependencies":{"@vitejs/plugin-react":"latest"}}\n', 'utf8');
  await writeFile(path.join(workDir, '.ralph', 'plan.json'), JSON.stringify({
    version: 1,
    specFile: 'spec.md',
    specHash: 'sha256:test',
    projectGoal: 'Build STOOK visual-first synth lab.',
    createdAt: '2026-06-12T13:00:00.000Z',
    updatedAt: '2026-06-12T13:00:00.000Z',
    phases: [{
      id: 'phase-001',
      name: 'Synth UI',
      description: 'Create the first visible synth interface.',
      order: 1,
      status: 'pending',
      tasks: [{
        id: 'task-001',
        displayTitle: 'Add synth pad',
        description: 'Add the initial STOOK synth pad UI.',
        acceptanceCriteria: ['A visible synth pad can be rendered in the app.'],
        status: 'pending',
        requiredRolePasses: ['ux'],
        visualEvidenceRequired: true,
      }],
    }],
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
  liveWorkspacePath: string | null;
  sourceRef: string;
  specFile?: string | null;
}) {
  return {
    schemaVersion: 'ra-356.project-stage-snapshot.v1',
    generatedAt: '2026-06-12T13:00:00.000Z',
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
    plan: {
      status: 'ready',
      reasonCode: null,
      specFile: input.specFile ?? 'spec.md',
    },
  };
}

function controllerJsonOutput(): string {
  return `Controller result:
\`\`\`json
{
  "verdict": "continue",
  "summary": "The selected STOOK state is coherent.",
  "planChanges": [],
  "newJudgments": [],
  "revisedJudgments": [],
  "overclaimWarnings": []
}
\`\`\``;
}

function testAgent(execute: (options: AgentOptions) => Promise<AgentResult>): ControllerProjectDryRunAgent {
  return {
    name: 'test-injected-agent',
    execute,
  };
}

function agentResult(overrides: Partial<AgentResult> = {}): AgentResult {
  return {
    success: true,
    output: controllerJsonOutput(),
    filesChanged: [],
    completionPromiseFound: false,
    ...overrides,
  };
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function git(cwd: string, ...args: string[]): Promise<string> {
  const result = await execa('git', args, { cwd });
  return result.stdout.trim();
}
