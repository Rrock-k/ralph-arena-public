import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  VISUAL_SCENARIO_RUN_SCHEMA_VERSION,
  formatVisualScenarioRunResult,
  runVisualScenario,
  runVisualScenarioFile,
} from './visual-scenario-runner.js';
import { VISUAL_SCENARIO_SCHEMA_VERSION, type VisualScenario } from './visual-scenario.js';

function validScenario(overrides: Partial<VisualScenario> = {}): VisualScenario {
  return {
    schemaVersion: VISUAL_SCENARIO_SCHEMA_VERSION,
    scenarioId: 'mini-jam.home.v1',
    projectClass: 'ordinary_web',
    name: 'Mini Jam home',
    target: {
      route: '/?mode=lab',
      viewport: {
        width: 1280,
        height: 720,
      },
      claim: 'The shared synth surface is visible.',
    },
    ...overrides,
  };
}

test('Visual Scenario runner captures a disposable lab screenshot and report', async () => {
  const outDir = await mkdtemp(path.join(os.tmpdir(), 'visual-scenario-run-'));
  const screenshotBytes = Buffer.from('fake-png');
  let closed = false;
  let capturedPath: string | null = null;
  let viewportSeen: unknown = null;
  let urlSeen: string | null = null;
  let waitSeen: number | null = null;

  const result = await runVisualScenario({
    scenario: validScenario({
      target: {
        ...validScenario().target,
        waitAfterLoadMs: 1500,
      },
    }),
    baseUrl: 'http://127.0.0.1:3000',
    outDir,
    now: () => new Date('2026-06-06T12:00:00.000Z'),
    launchBrowser: async () => ({
      newPage: async (options: unknown) => {
        viewportSeen = options;
        return {
          goto: async (url: string) => {
            urlSeen = url;
            return { status: () => 200 };
          },
          waitForTimeout: async (ms: number) => {
            waitSeen = ms;
          },
          screenshot: async (options: { path: string }) => {
            capturedPath = options.path;
            await writeFile(options.path, screenshotBytes);
          },
        };
      },
      close: async () => {
        closed = true;
      },
    } as any),
  });

  assert.equal(result.schemaVersion, VISUAL_SCENARIO_RUN_SCHEMA_VERSION);
  assert.equal(result.status, 'captured');
  assert.equal(result.capturedAt, '2026-06-06T12:00:00.000Z');
  assert.equal(result.scenario.scenarioId, 'mini-jam.home.v1');
  assert.equal(result.output.screenshotPath, path.join(outDir, 'mini-jam.home.v1.png'));
  assert.equal(result.output.screenshotSha256, `sha256:${createHash('sha256').update(screenshotBytes).digest('hex')}`);
  assert.equal(capturedPath, result.output.screenshotPath);
  assert.deepEqual(viewportSeen, { viewport: { width: 1280, height: 720 } });
  assert.equal(urlSeen, 'http://127.0.0.1:3000/?mode=lab');
  assert.equal(waitSeen, 1500);
  assert.equal(closed, true);
  assert.match(result.notes.join(' '), /does not write \.ralph\/plan\.json/);
  assert.match(result.notes.join(' '), /task verificationEvidence/);

  const report = JSON.parse(await readFile(path.join(outDir, 'scenario-run.json'), 'utf8'));
  assert.equal(report.status, 'captured');
  assert.equal(report.output.screenshotSha256, result.output.screenshotSha256);
});

test('Visual Scenario runner reads scenario fixtures and writes only the output directory', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'visual-scenario-fixture-'));
  const fixturePath = path.join(tempDir, 'scenario.json');
  const outDir = path.join(tempDir, 'out');
  await writeFile(fixturePath, JSON.stringify(validScenario()), 'utf8');

  const beforeRootEntries = await readdir(tempDir);
  const result = await runVisualScenarioFile({
    scenarioPath: fixturePath,
    baseUrl: 'http://localhost:4000/',
    outDir,
    launchBrowser: async () => ({
      newPage: async () => ({
        goto: async () => ({ status: () => 200 }),
        waitForTimeout: async () => {},
        screenshot: async (options: { path: string }) => {
          await writeFile(options.path, 'fixture-png');
        },
      }),
      close: async () => {},
    } as any),
  });
  const afterRootEntries = await readdir(tempDir);

  assert.deepEqual(beforeRootEntries.sort(), ['scenario.json']);
  assert.deepEqual(afterRootEntries.sort(), ['out', 'scenario.json']);
  assert.equal(result.status, 'captured');
  await assert.rejects(stat(path.join(tempDir, '.ralph')));
});

test('Visual Scenario runner records browser infra as lab status, not project failure', async () => {
  const outDir = await mkdtemp(path.join(os.tmpdir(), 'visual-scenario-browser-'));
  const result = await runVisualScenario({
    scenario: validScenario(),
    baseUrl: 'http://127.0.0.1:3000',
    outDir,
    launchBrowser: async () => {
      throw new Error([
        'browserType.launch: Executable does not exist at /home/node/.cache/ms-playwright/chromium_headless_shell-1200/chrome-linux/headless_shell',
        'Please run "npx playwright install"',
      ].join('\n'));
    },
  });

  assert.equal(result.status, 'browser_unavailable');
  assert.equal(result.output.screenshotPath, null);
  assert.equal(result.output.screenshotSha256, null);
  assert.equal(result.error?.code, 'INFRA_BROWSER_UNAVAILABLE');
  assert.match(result.error?.message ?? '', /do not install Chromium/);
  const report = JSON.parse(await readFile(path.join(outDir, 'scenario-run.json'), 'utf8'));
  assert.equal(report.status, 'browser_unavailable');
});

test('Visual Scenario runner records navigation failures without proof wording', async () => {
  const outDir = await mkdtemp(path.join(os.tmpdir(), 'visual-scenario-nav-'));
  const result = await runVisualScenario({
    scenario: validScenario(),
    baseUrl: 'http://127.0.0.1:3000',
    outDir,
    launchBrowser: async () => ({
      newPage: async () => ({
        goto: async () => ({ status: () => 404 }),
        waitForTimeout: async () => {},
        screenshot: async () => {
          throw new Error('screenshot should not be called');
        },
      }),
      close: async () => {},
    } as any),
  });

  assert.equal(result.status, 'navigation_failed');
  assert.equal(result.output.screenshotPath, null);
  assert.equal(result.error?.code, 'navigation_failed');
  assert.equal(result.error?.message, 'Scenario target returned HTTP 404.');
  assert.doesNotMatch(result.error?.message ?? '', /proof/i);
});

test('Visual Scenario runner validates base URL before writing output', async () => {
  const outDir = await mkdtemp(path.join(os.tmpdir(), 'visual-scenario-url-'));
  const nestedOutDir = path.join(outDir, 'nested', 'out');

  await assert.rejects(() => runVisualScenario({
    scenario: validScenario(),
    baseUrl: 'ftp://example.com',
    outDir: nestedOutDir,
  }), /http or https/);

  await assert.rejects(() => runVisualScenario({
    scenario: validScenario(),
    baseUrl: 'http://user:password@example.com',
    outDir,
  }), /must not contain credentials/);

  assert.deepEqual(await readdir(outDir), []);
});

test('Visual Scenario runner revalidates direct scenario inputs before writing output', async () => {
  const outDir = await mkdtemp(path.join(os.tmpdir(), 'visual-scenario-direct-'));

  await assert.rejects(() => runVisualScenario({
    scenario: {
      ...validScenario(),
      scenarioId: '../escape',
    } as VisualScenario,
    baseUrl: 'http://127.0.0.1:3000',
    outDir: path.join(outDir, 'nested'),
    launchBrowser: async () => {
      throw new Error('browser should not launch');
    },
  }), /Invalid|regex/i);

  assert.deepEqual(await readdir(outDir), []);
});

test('Visual Scenario runner formats JSON output', async () => {
  const outDir = await mkdtemp(path.join(os.tmpdir(), 'visual-scenario-format-'));
  const result = await runVisualScenario({
    scenario: validScenario(),
    baseUrl: 'http://127.0.0.1:3000',
    outDir,
    launchBrowser: async () => ({
      newPage: async () => ({
        goto: async () => ({ status: () => 200 }),
        waitForTimeout: async () => {},
        screenshot: async (options: { path: string }) => {
          await writeFile(options.path, 'format-png');
        },
      }),
      close: async () => {},
    } as any),
  });

  assert.equal(JSON.parse(formatVisualScenarioRunResult(result, 'json')).status, 'captured');
  assert.equal(JSON.parse(formatVisualScenarioRunResult(result, 'json', true)).schemaVersion, VISUAL_SCENARIO_RUN_SCHEMA_VERSION);
  assert.throws(() => formatVisualScenarioRunResult(result, 'text' as any), /Unsupported/);
});
