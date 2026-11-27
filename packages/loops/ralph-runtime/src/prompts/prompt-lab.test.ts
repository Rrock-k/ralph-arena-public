import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  PROMPT_LAB_FIXTURE_SCHEMA_VERSION,
  PROMPT_LAB_REPLAY_RESULT_SCHEMA_VERSION,
  formatPromptLabReplayResult,
  parsePromptLabFixture,
  renderPromptLabFixture,
  replayPromptFixtureFile,
  type PromptLabFixture,
} from './prompt-lab.js';

test('Prompt Lab replays planner fixture without model calls or runtime writes', () => {
  const fixture: PromptLabFixture = {
    schemaVersion: PROMPT_LAB_FIXTURE_SCHEMA_VERSION,
    promptId: 'planner.initial',
    name: 'tiny-planner',
    input: {
      seed: 'fixture-seed',
      previousErrorBlock: '',
      projectName: 'Tiny Todo',
      projectDescription: 'Small todo app',
      techStack: 'typescript',
      deployBlock: '',
      repositoryBlock: '',
      spec: '# Spec\nBuild a tiny todo app.',
      existingProjectFilesBlock: '',
      judgmentTimestamp: '2026-06-06T00:00:00.000Z',
    },
  };

  const result = renderPromptLabFixture({ fixture, fixturePath: '/tmp/tiny-fixture.json' });

  assert.equal(result.schemaVersion, PROMPT_LAB_REPLAY_RESULT_SCHEMA_VERSION);
  assert.equal(result.promptId, 'planner.initial');
  assert.equal(result.fixture.name, 'tiny-planner');
  assert.equal(result.entry.owner, 'planner');
  assert.match(result.rendered.text, /Tiny Todo/);
  assert.match(result.rendered.text, /Build a tiny todo app/);
  assert.doesNotMatch(result.rendered.text, /\{\{[a-zA-Z]/);
  assert.equal(result.rendered.charCount, result.rendered.text.length);
  assert.match(result.rendered.sha256, /^[a-f0-9]{64}$/);
  assert.match(result.notes.join(' '), /does not call model providers/i);
});

test('Prompt Lab replays executor fixture from explicit context sections only', () => {
  const result = renderPromptLabFixture({
    fixture: {
      schemaVersion: PROMPT_LAB_FIXTURE_SCHEMA_VERSION,
      promptId: 'executor.agentPrompt',
      input: {
        contextSections: '# Current Task\nBuild the app shell.',
      },
    },
  });

  assert.equal(result.promptId, 'executor.agentPrompt');
  assert.equal(result.entry.owner, 'executor');
  assert.equal(result.rendered.text, '# Current Task\nBuild the app shell.');
});

test('Prompt Lab replays executor task section through production renderer', () => {
  const result = renderPromptLabFixture({
    fixture: {
      schemaVersion: PROMPT_LAB_FIXTURE_SCHEMA_VERSION,
      promptId: 'executor.taskSection',
      name: 'executor-visual-task-section',
      input: {
        task: {
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
          feedbackItemRefs: [
            {
              itemId: 'DIFF-001',
              diffItemId: 'DIFF-001',
              targetType: 'feature',
              targetId: 'synth-pad',
              changeType: 'add',
              workImpact: 'requires_loop_work',
              workSurface: 'frontend',
              summary: 'Add visible synth pad playing state.',
            },
          ],
        },
        iteration: 1,
        taskFolder: '.ralph/tasks/task-001',
        withScopeBoundary: true,
        visualEvidenceMode: 'required',
      },
    },
  });

  assert.equal(result.promptId, 'executor.taskSection');
  assert.equal(result.entry.owner, 'executor');
  assert.equal(result.entry.kind, 'context_section');
  assert.match(result.rendered.text, /## Visual Workbench Coverage/);
  assert.match(result.rendered.text, /visual-workbench\/manifest\.json/);
  assert.match(result.rendered.text, /visual-workbench\/stories\//);
  assert.match(result.rendered.text, /schemaVersion="ra-355\.visual-coverage-manifest\.v0"/);
  assert.match(result.rendered.text, /projectClass="ordinary_web"/);
  assert.match(result.rendered.text, /coveragePolicy\.selectionDefault="full_manifest"/);
  assert.match(result.rendered.text, /Do not rename the schema/);
  assert.match(result.rendered.text, /invent any other `schemaVersion`/);
  assert.match(result.rendered.text, /taskRelevance\.defaultFor/);
  assert.match(result.rendered.text, /`task-001`, `task-001#DIFF-001`, `task-001#synth-pad`, `DIFF-001`, `synth-pad`/);
  assert.match(result.rendered.text, /only tokens the selector-readiness stage will use/);
  assert.match(result.rendered.text, /## Required Role Passes/);
  assert.match(result.rendered.text, /## Current Accepted Diff Packet/);
  assert.doesNotMatch(result.rendered.text, /\{\{[a-zA-Z]/);
  assert.match(result.notes.join(' '), /does not call model providers/i);
});

test('Prompt Lab replays static product and UX role skills from the prompt repository', () => {
  const product = renderPromptLabFixture({
    fixture: {
      schemaVersion: PROMPT_LAB_FIXTURE_SCHEMA_VERSION,
      promptId: 'executor.productSkill',
      name: 'product-role-skill',
      input: {},
    },
  });
  const ux = renderPromptLabFixture({
    fixture: {
      schemaVersion: PROMPT_LAB_FIXTURE_SCHEMA_VERSION,
      promptId: 'executor.uxSkill',
      name: 'ux-role-skill',
      input: {},
    },
  });

  assert.equal(product.entry.owner, 'executor');
  assert.equal(product.entry.kind, 'task_template');
  assert.match(product.rendered.text, /^# Product Skill/);
  assert.match(product.rendered.text, /product\.md/);
  assert.match(product.rendered.text, /Do not invent product truth beyond the accepted spec\/diff/);

  assert.equal(ux.entry.owner, 'executor');
  assert.equal(ux.entry.kind, 'task_template');
  assert.match(ux.rendered.text, /^# UX Skill/);
  assert.match(ux.rendered.text, /ux\.md/);
  assert.match(ux.rendered.text, /visual-workbench\/manifest\.json/);
  assert.match(ux.notes.join(' '), /does not call model providers/i);
});

test('Prompt Lab replays controller fixture', () => {
  const result = renderPromptLabFixture({
    fixture: {
      schemaVersion: PROMPT_LAB_FIXTURE_SCHEMA_VERSION,
      promptId: 'controller.audit',
      input: {
        trigger: 'manual-lab',
        spec: '# Spec\nShip a todo app.',
        planJson: '{"phases":[]}',
        historyText: 'No history.',
        projectSnapshot: '{}',
        visionReportBlock: '',
        feedbackMatrixBlock: '',
        judgmentTimestamp: '2026-06-06T00:00:00.000Z',
        e2ePolicyBlock: '',
      },
    },
  });

  assert.equal(result.promptId, 'controller.audit');
  assert.equal(result.entry.owner, 'controller');
  assert.match(result.rendered.text, /manual-lab/);
  assert.match(result.rendered.text, /Ship a todo app/);
});

test('Prompt Lab validates fixture shape and output formatting', () => {
  assert.throws(() => parsePromptLabFixture({
    schemaVersion: PROMPT_LAB_FIXTURE_SCHEMA_VERSION,
    promptId: 'planner.unknown',
    input: {},
  }), /Invalid enum value|invalid/i);

  const result = renderPromptLabFixture({
    fixture: {
      schemaVersion: PROMPT_LAB_FIXTURE_SCHEMA_VERSION,
      promptId: 'controller.e2eApplicability',
      input: {
        specContent: 'Build a web form.',
        packageJson: '{"scripts":{"start":"next start"}}',
      },
    },
  });

  assert.match(formatPromptLabReplayResult(result, 'text'), /^You are deciding whether automated Playwright e2e tests are useful/);
  assert.equal(JSON.parse(formatPromptLabReplayResult(result, 'json')).promptId, 'controller.e2eApplicability');
});

test('Prompt Lab writes only explicit disposable --out files', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'prompt-lab-'));
  const fixturePath = path.join(tempDir, 'fixture.json');
  const outPath = path.join(tempDir, 'out', 'prompt.json');
  await writeFile(fixturePath, JSON.stringify({
    schemaVersion: PROMPT_LAB_FIXTURE_SCHEMA_VERSION,
    promptId: 'executor.agentPrompt',
    name: 'executor-context',
    input: {
      contextSections: '# Lab Context\nNo runtime writes.',
    },
  }), 'utf8');

  const beforeRootEntries = await readdir(tempDir);
  const result = await replayPromptFixtureFile({
    fixturePath,
    outPath,
    format: 'json',
  });
  const afterRootEntries = await readdir(tempDir);
  const outFile = JSON.parse(await readFile(outPath, 'utf8'));

  assert.deepEqual(beforeRootEntries.sort(), ['fixture.json']);
  assert.deepEqual(afterRootEntries.sort(), ['fixture.json', 'out']);
  assert.equal(outFile.promptId, 'executor.agentPrompt');
  assert.equal(outFile.rendered.sha256, result.rendered.sha256);
  await assert.rejects(stat(path.join(tempDir, '.ralph')));
});
