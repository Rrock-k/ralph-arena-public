import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { execa } from 'execa';
import type { AgentOptions } from '../agents/base.js';
import type { AgentResult } from '../config/types.js';
import { PLANNER_INITIAL_DRY_RUN_OWNER_BOUNDARY } from '../planning/planner.js';
import {
  PLANNER_PROJECT_DRY_RUN_REPORT_FILE,
  PLANNER_PROJECT_DRY_RUN_RESULT_SCHEMA_VERSION,
  type PlannerProjectDryRunAgent,
  runPlannerProjectDryRun,
} from './planner-project-dry-run.js';

test('planner_project_dry_run runs one planner provider call without applying plan truth', async () => {
  const liveWorkspacePath = await mkdtemp(path.join(os.tmpdir(), 'planner-project-dry-run-live-'));
  const workDir = await createGitWorkspace();
  const sourceRef = await git(workDir, 'rev-parse', 'HEAD');
  const outDir = await mkdtemp(path.join(os.tmpdir(), 'planner-project-dry-run-out-'));
  let capturedPrompt = '';

  const result = await runPlannerProjectDryRun({
    snapshot: baseSnapshot({ liveWorkspacePath, sourceRef }),
    workDir,
    sourceRef,
    spec: 'spec.md',
    visualEvidenceMode: 'new_tasks_only',
    outDir,
    agent: testAgent(async (options) => {
      capturedPrompt = options.prompt;
      assert.equal(options.workDir, workDir);
      assert.equal(options.model, 'test-model');
      assert.equal(options.timeout, 3);
      return agentResult({
        output: plannerJsonOutput(),
      });
    }),
    model: 'test-model',
    timeoutMinutes: 3,
  });

  const report = JSON.parse(await readFile(path.join(outDir, PLANNER_PROJECT_DRY_RUN_REPORT_FILE), 'utf8'));
  assert.equal(result.schemaVersion, PLANNER_PROJECT_DRY_RUN_RESULT_SCHEMA_VERSION);
  assert.equal(result.status, 'completed');
  assert.equal(result.stage.stageId, 'planner_project_dry_run');
  assert.equal(result.stage.mode, 'workspace_dry_run');
  assert.equal(result.stage.ownerBoundary, 'ralph.planner.dry-run-adapter');
  assert.equal(result.input.projectId, 'project-stook');
  assert.equal(result.input.spec, 'spec.md');
  assert.equal(result.input.visualEvidenceMode, 'new_tasks_only');
  assert.equal(result.prepared?.promptId, 'planner.initial');
  assert.equal(result.plannerOutput.ownerBoundary, PLANNER_INITIAL_DRY_RUN_OWNER_BOUNDARY);
  assert.equal(result.plannerOutput.summary?.taskCount, 1);
  assert.equal(result.plannerOutput.projectGoal, 'Build STOOK visual-first synth lab.');
  assert.match(capturedPrompt, /Mini synths for non-musicians/);
  assert.match(capturedPrompt, /Visual Workbench/);
  assert.equal(await pathExists(path.join(workDir, '.ralph', 'plan.json')), false);
  assert.equal(await pathExists(path.join(workDir, '.ralph', 'prompt-traces')), false);
  assert.equal(await git(workDir, 'status', '--porcelain', '-uall'), '');
  assert.equal(report.status, 'completed');
  assert.equal(report.plannerOutput.ownerBoundary, PLANNER_INITIAL_DRY_RUN_OWNER_BOUNDARY);
});

test('planner_project_dry_run blocks source-ref/spec mismatch before calling agent', async () => {
  const liveWorkspacePath = await mkdtemp(path.join(os.tmpdir(), 'planner-project-dry-run-live-'));
  const workDir = await createGitWorkspace();
  const sourceRef = await git(workDir, 'rev-parse', 'HEAD');
  const outDir = await mkdtemp(path.join(os.tmpdir(), 'planner-project-dry-run-out-'));
  let called = false;

  const result = await runPlannerProjectDryRun({
    snapshot: baseSnapshot({ liveWorkspacePath, sourceRef, specFile: 'spec.md' }),
    workDir,
    sourceRef,
    spec: 'other-spec.md',
    visualEvidenceMode: 'off',
    outDir,
    agent: testAgent(async () => {
      called = true;
      return agentResult({ output: plannerJsonOutput() });
    }),
    model: 'test-model',
    timeoutMinutes: 3,
  });

  assert.equal(called, false);
  assert.equal(result.status, 'blocked');
  assert.equal(result.error?.code, 'spec_ref_mismatch');
  assert.equal(result.plannerOutput.ownerBoundary, null);
});

test('planner_project_dry_run rejects spec paths outside the fork workspace', async () => {
  const liveWorkspacePath = await mkdtemp(path.join(os.tmpdir(), 'planner-project-dry-run-live-'));
  const workDir = await createGitWorkspace();
  const sourceRef = await git(workDir, 'rev-parse', 'HEAD');
  const outDir = await mkdtemp(path.join(os.tmpdir(), 'planner-project-dry-run-out-'));

  await assert.rejects(() => runPlannerProjectDryRun({
    snapshot: baseSnapshot({ liveWorkspacePath, sourceRef, specFile: null }),
    workDir,
    sourceRef,
    spec: '..',
    visualEvidenceMode: 'off',
    outDir,
    agent: testAgent(async () => agentResult({ output: plannerJsonOutput() })),
    model: 'test-model',
    timeoutMinutes: 3,
  }), /must stay inside --work-dir/);
});

test('planner_project_dry_run blocks missing project config without fallback context', async () => {
  const liveWorkspacePath = await mkdtemp(path.join(os.tmpdir(), 'planner-project-dry-run-live-'));
  const workDir = await createGitWorkspace({ includeProjectConfig: false });
  const sourceRef = await git(workDir, 'rev-parse', 'HEAD');
  const outDir = await mkdtemp(path.join(os.tmpdir(), 'planner-project-dry-run-out-'));
  let called = false;

  const result = await runPlannerProjectDryRun({
    snapshot: baseSnapshot({ liveWorkspacePath, sourceRef }),
    workDir,
    sourceRef,
    spec: 'spec.md',
    visualEvidenceMode: 'off',
    outDir,
    agent: testAgent(async () => {
      called = true;
      return agentResult({ output: plannerJsonOutput() });
    }),
    model: 'test-model',
    timeoutMinutes: 3,
  });

  assert.equal(called, false);
  assert.equal(result.status, 'blocked');
  assert.equal(result.error?.code, 'project_config_missing');
});

test('planner_project_dry_run fails closed when agent mutates the source workspace', async () => {
  const liveWorkspacePath = await mkdtemp(path.join(os.tmpdir(), 'planner-project-dry-run-live-'));
  const workDir = await createGitWorkspace();
  const sourceRef = await git(workDir, 'rev-parse', 'HEAD');
  const outDir = await mkdtemp(path.join(os.tmpdir(), 'planner-project-dry-run-out-'));

  const result = await runPlannerProjectDryRun({
    snapshot: baseSnapshot({ liveWorkspacePath, sourceRef }),
    workDir,
    sourceRef,
    spec: 'spec.md',
    visualEvidenceMode: 'required',
    outDir,
    agent: testAgent(async () => {
      await writeFile(path.join(workDir, 'src', 'PlannerSideEffect.tsx'), 'export const sideEffect = true;\n', 'utf8');
      return agentResult({
        output: plannerJsonOutput(),
        filesChanged: ['src/PlannerSideEffect.tsx'],
      });
    }),
    model: 'test-model',
    timeoutMinutes: 3,
  });

  assert.equal(result.status, 'forbidden_mutation');
  assert.equal(result.error?.code, 'forbidden_mutation');
  assert.deepEqual(result.source.changedFilesFromGitStatus, ['src/PlannerSideEffect.tsx']);
});

async function createGitWorkspace(options: { includeProjectConfig?: boolean } = {}): Promise<string> {
  const workDir = await mkdtemp(path.join(os.tmpdir(), 'planner-project-dry-run-src-'));
  await mkdir(path.join(workDir, 'src'), { recursive: true });
  await writeFile(path.join(workDir, 'src', 'App.tsx'), 'export const App = () => "STOOK";\n', 'utf8');
  await writeFile(path.join(workDir, 'spec.md'), '# STOOK\n\nMini synths for non-musicians.\n', 'utf8');
  await writeFile(path.join(workDir, 'package.json'), '{"scripts":{"dev":"vite"},"dependencies":{"@vitejs/plugin-react":"latest"}}\n', 'utf8');
  if (options.includeProjectConfig !== false) {
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
  }
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

function plannerJsonOutput(): string {
  return `Planner result:
\`\`\`json
{
  "projectGoal": "Build STOOK visual-first synth lab.",
  "phases": [
    {
      "id": "phase-001",
      "name": "Synth UI",
      "description": "Create the first visible synth interface.",
      "order": 1,
      "status": "pending",
      "tasks": [
        {
          "id": "task-001",
          "displayTitle": "Add synth pad",
          "description": "Add the initial STOOK synth pad UI.",
          "acceptanceCriteria": ["A visible synth pad can be rendered in the app."],
          "status": "pending",
          "requiredRolePasses": ["ux"],
          "visualEvidenceRequired": true
        }
      ]
    }
  ],
  "judgments": []
}
\`\`\``;
}

function testAgent(execute: (options: AgentOptions) => Promise<AgentResult>): PlannerProjectDryRunAgent {
  return {
    name: 'test-injected-agent',
    execute,
  };
}

function agentResult(overrides: Partial<AgentResult> = {}): AgentResult {
  return {
    success: true,
    output: plannerJsonOutput(),
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
