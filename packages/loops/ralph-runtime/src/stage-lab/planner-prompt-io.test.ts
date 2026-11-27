import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, readFile, stat, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  PLANNER_PROMPT_IO_FIXTURE_SCHEMA_VERSION,
  PLANNER_PROMPT_IO_RESULT_SCHEMA_VERSION,
  formatPlannerPromptIoResult,
  runPlannerPromptIoFixture,
  runPlannerPromptIoFixtureFile,
  type PlannerPromptIoFixture,
} from './planner-prompt-io.js';
import { PROMPT_LAB_FIXTURE_SCHEMA_VERSION } from '../prompts/prompt-lab.js';

test('planner_prompt_io parses explicit planner output without runtime writes', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'planner-prompt-io-'));
  const fixturePath = path.join(tempDir, 'fixture.json');
  const outPath = path.join(tempDir, 'out', 'planner-stage.json');
  const fixture = buildFixture();
  await writeFile(fixturePath, JSON.stringify(fixture, null, 2), 'utf8');

  const beforeRootEntries = await readdir(tempDir);
  const result = await runPlannerPromptIoFixtureFile({
    fixturePath,
    outPath,
  });
  const afterRootEntries = await readdir(tempDir);
  const outFile = JSON.parse(await readFile(outPath, 'utf8'));

  assert.equal(result.schemaVersion, PLANNER_PROMPT_IO_RESULT_SCHEMA_VERSION);
  assert.equal(result.stage.stageId, 'planner_prompt_io');
  assert.equal(result.stage.mode, 'fixture');
  assert.equal(result.stage.ownerBoundary, 'ralph.planner.prompt-code-path');
  assert.deepEqual(result.stage.allowedMutations, [outPath]);
  assert(result.stage.forbiddenMutations.includes('.ralph/plan.json'));
  assert(result.stage.forbiddenMutations.includes('.ralph/decisions-log.json'));
  assert(result.stage.forbiddenMutations.includes('task verificationEvidence'));
  assert.equal(result.prompt.promptId, 'planner.initial');
  assert.match(result.prompt.renderedSha256, /^sha256:[a-f0-9]{64}$/);
  assert.match(result.agentOutput.outputSha256, /^sha256:[a-f0-9]{64}$/);
  assert.equal(result.plannerOutput.status, 'parsed');
  assert.equal(result.plannerOutput.projectGoal, 'Build a tiny visual synth lab.');
  assert.equal(result.plannerOutput.summary.phaseCount, 1);
  assert.equal(result.plannerOutput.summary.taskCount, 2);
  assert.equal(result.plannerOutput.summary.judgmentCount, 0);
  assert.deepEqual(result.plannerOutput.summary.tasksByStatus, { pending: 2 });
  assert.deepEqual(result.plannerOutput.summary.structuredVisualExpectationTaskIds, ['task-001', 'task-002']);
  assert.equal(result.plannerOutput.phases[0].tasks[0].requiredRolePasses?.[0], 'ux');
  assert.match(result.notes.join(' '), /not lifecycle truth/i);
  assert.deepEqual(beforeRootEntries.sort(), ['fixture.json']);
  assert.deepEqual(afterRootEntries.sort(), ['fixture.json', 'out']);
  assert.equal(outFile.plannerOutput.status, 'parsed');
  await assert.rejects(stat(path.join(tempDir, '.ralph')));
});

test('planner_prompt_io records parse failures as disposable output', () => {
  const result = runPlannerPromptIoFixture({
    fixture: buildFixture({
      agentOutput: {
        success: true,
        output: 'Planner said no JSON today.',
        filesChanged: [],
        completionPromiseFound: false,
      },
    }),
  });

  assert.equal(result.plannerOutput.status, 'parse_or_validation_failed');
  assert.equal(result.plannerOutput.summary.taskCount, 0);
  assert.match(result.plannerOutput.error?.message ?? '', /could not find JSON output/);
  assert.equal(JSON.parse(formatPlannerPromptIoResult(result, true)).stage.stageId, 'planner_prompt_io');
});

test('planner_prompt_io rejects non-planner prompt fixtures', () => {
  assert.throws(() => runPlannerPromptIoFixture({
    fixture: buildFixture({
      promptFixture: {
        schemaVersion: PROMPT_LAB_FIXTURE_SCHEMA_VERSION,
        promptId: 'executor.agentPrompt',
        input: {
          contextSections: '# Current Task\nImplement UI.',
        },
      },
    }),
  }), /requires planner\.initial or planner\.replan/);
});

test('planner_prompt_io rejects loop-owned output paths', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'planner-prompt-io-'));
  const fixturePath = path.join(tempDir, 'fixture.json');
  await writeFile(fixturePath, JSON.stringify(buildFixture(), null, 2), 'utf8');
  const existingOutPath = path.join(tempDir, 'existing-stage.json');
  await writeFile(existingOutPath, '{}', 'utf8');

  await assert.rejects(() => runPlannerPromptIoFixtureFile({
    fixturePath,
    outPath: path.join(tempDir, '.ralph', 'plan.json'),
  }), /outside \.ralph and \.arena/);

  await assert.rejects(() => runPlannerPromptIoFixtureFile({
    fixturePath,
    outPath: fixturePath,
  }), /cannot overwrite the input fixture/);

  await assert.rejects(() => runPlannerPromptIoFixtureFile({
    fixturePath,
    outPath: existingOutPath,
  }), /refusing to overwrite an existing path/);

  assert.throws(() => runPlannerPromptIoFixture({
    fixture: buildFixture(),
    outPath: path.join(tempDir, 'decisions-log.json'),
  }), /loop-owned truth file name/);

  assert.throws(() => runPlannerPromptIoFixture({
    fixture: buildFixture(),
    outPath: path.join(process.cwd(), 'src', 'stage-lab', 'planner-stage.json'),
  }), /system temp directory/);
});

test('planner_prompt_io rejects symlinked output parents into loop-owned dirs', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'planner-prompt-io-'));
  const loopTruthDir = path.join(tempDir, 'source', '.ralph');
  const symlinkPath = path.join(tempDir, 'linked-output');
  await mkdir(loopTruthDir, { recursive: true });
  await symlink(loopTruthDir, symlinkPath);

  assert.throws(() => runPlannerPromptIoFixture({
    fixture: buildFixture(),
    outPath: path.join(symlinkPath, 'planner-stage.json'),
  }), /must be outside \.ralph and \.arena/);
});

test('planner_prompt_io rejects mutation-shaped fixture agent output', () => {
  const base = buildFixture();

  assert.throws(() => runPlannerPromptIoFixture({
    fixture: buildFixture({
      agentOutput: {
        ...base.agentOutput,
        filesChanged: ['src/App.tsx'],
      },
    }),
  }), /filesChanged must be empty/);

  assert.throws(() => runPlannerPromptIoFixture({
    fixture: buildFixture({
      agentOutput: {
        ...base.agentOutput,
        completionPromiseFound: true,
      },
    }),
  }), /completionPromiseFound must be false/);
});

test('planner_prompt_io treats task evidence fields in planner output as invalid fixture output', () => {
  const result = runPlannerPromptIoFixture({
    fixture: buildFixture({
      agentOutput: {
        success: true,
        output: jsonBlock({
          projectGoal: 'Build a tiny visual synth lab.',
          phases: [{
            id: 'phase-1',
            name: 'Visual UI slice',
            description: 'Build and cover the first visual UI states.',
            order: 1,
            status: 'pending',
            planLater: false,
            tasks: [{
              id: 'task-001',
              displayTitle: 'Add synth pad story',
              description: 'Add a SynthPad visual workbench story.',
              acceptanceCriteria: ['SynthPad story renders.'],
              status: 'pending',
              attempts: 0,
              dependencies: [],
              verificationEvidence: [],
              proofReviews: [],
            }],
          }],
          judgments: [],
        }),
        filesChanged: [],
        completionPromiseFound: false,
      },
    }),
  });

  assert.equal(result.plannerOutput.status, 'parse_or_validation_failed');
  assert.match(result.plannerOutput.error?.message ?? '', /forbidden task fields/);
});

function buildFixture(overrides: Partial<PlannerPromptIoFixture> = {}): PlannerPromptIoFixture {
  return {
    schemaVersion: PLANNER_PROMPT_IO_FIXTURE_SCHEMA_VERSION,
    name: 'tiny-visual-planner',
    promptVariantRef: 'visual-workbench-v0',
    promptFixture: {
      schemaVersion: PROMPT_LAB_FIXTURE_SCHEMA_VERSION,
      promptId: 'planner.initial',
      name: 'tiny-visual-planner-prompt',
      input: {
        seed: 'fixture-seed',
        previousErrorBlock: '',
        projectName: 'Tiny Synth Lab',
        projectDescription: 'Small web synth lab',
        techStack: 'typescript / vite',
        deployBlock: '',
        repositoryBlock: '',
        spec: '# Spec\nBuild a tiny synth UI with visual workbench stories.',
        existingProjectFilesBlock: '',
        judgmentTimestamp: '2026-06-07T00:00:00.000Z',
      },
    },
    agentOutput: {
      success: true,
      output: jsonBlock({
        projectGoal: 'Build a tiny visual synth lab.',
        phases: [{
          id: 'phase-1',
          name: 'Visual UI slice',
          description: 'Build and cover the first visual UI states.',
          order: 1,
          status: 'pending',
          planLater: false,
          tasks: [
            {
              id: 'task-001',
              displayTitle: 'Add synth pad story',
              description: 'Add a SynthPad visual workbench story for the playing state.',
              acceptanceCriteria: [
                'SynthPad playing state renders through visual-workbench/manifest.json.',
              ],
              status: 'pending',
              attempts: 0,
              dependencies: [],
              requiredRolePasses: ['ux'],
            },
            {
              id: 'task-002',
              displayTitle: 'Cover connection error',
              description: 'Add a connection error state story for collaboration UI.',
              acceptanceCriteria: [
                'Connection error story renders in the Visual Workbench.',
              ],
              status: 'pending',
              attempts: 0,
              dependencies: [],
              feedbackItemRefs: [{
                itemId: 'DIFF-001',
                diffItemId: 'DIFF-001',
                targetType: 'feature',
                targetId: 'collaboration',
                changeType: 'add',
                workImpact: 'requires_loop_work',
                workSurface: 'frontend',
                summary: 'Add visible connection error state.',
              }],
            },
          ],
        }],
        judgments: [],
      }),
      filesChanged: [],
      completionPromiseFound: false,
    },
    ...overrides,
  };
}

function jsonBlock(value: unknown): string {
  return `\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\``;
}
