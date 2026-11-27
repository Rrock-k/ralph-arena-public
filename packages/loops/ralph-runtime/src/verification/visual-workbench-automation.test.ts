import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { RalphConfigSchema } from '../config/types.js';
import {
  VISUAL_WORKBENCH_AUTOMATION_OWNER_BOUNDARY,
  VISUAL_WORKBENCH_AUTOMATION_SCHEMA_VERSION,
  VISUAL_WORKBENCH_AUTOMATION_REPORT_FILENAME,
  formatVisualWorkbenchEvidenceAutomationResult,
  formatVisualWorkbenchEvidenceAutomationStatusResult,
  getVisualWorkbenchEvidenceAutomationStatusFile,
  runVisualWorkbenchEvidenceAutomation,
} from './visual-workbench-automation.js';
import {
  VISUAL_WORKBENCH_INGEST_MANIFEST_PATH,
  VISUAL_WORKBENCH_INGEST_MANIFEST_SCHEMA_VERSION,
} from './visual-workbench-evidence.js';

const packageRoot = fileURLToPath(new URL('../..', import.meta.url));

test('Visual Workbench automation blocks before starting workbench when shell policy is disabled', async () => {
  const fixture = await createAutomationFixture();
  let startCalled = false;

  const result = await runVisualWorkbenchEvidenceAutomation({
    workDir: fixture.workDir,
    manifestPath: 'visual-workbench/manifest.json',
    taskId: 'task-001',
    sourceRef: fixture.sourceRef,
    baseUrl: 'http://127.0.0.1:43123',
    outDir: fixture.outDir,
    ralphConfig: RalphConfigSchema.parse({}),
    startWorkbench: async () => {
      startCalled = true;
      return { stop: async () => {} };
    },
  });

  assert.equal(result.schemaVersion, VISUAL_WORKBENCH_AUTOMATION_SCHEMA_VERSION);
  assert.equal(result.ownerBoundary, VISUAL_WORKBENCH_AUTOMATION_OWNER_BOUNDARY);
  assert.equal(result.status, 'blocked');
  assert.equal(result.setup.status, 'ok');
  assert.equal(result.setup.reportPathWritten, true);
  assert.equal(result.setup.diagnosticReportPathWritten, true);
  assert.equal(result.selector.status, 'ready');
  assert.equal(result.shellPolicy.status, 'blocked');
  assert(result.blockers.includes('shell_policy_not_allowed'));
  assert.equal(startCalled, false);
  await assert.rejects(stat(path.join(fixture.outDir, 'visual-workbench-capture-run.json')));
  const report = JSON.parse(await readFile(path.join(fixture.outDir, VISUAL_WORKBENCH_AUTOMATION_REPORT_FILENAME), 'utf8'));
  assert.equal(report.status, 'blocked');
  assert.equal(report.ownerBoundary, VISUAL_WORKBENCH_AUTOMATION_OWNER_BOUNDARY);
  assert.equal(report.reportPath, path.join(fixture.outDir, VISUAL_WORKBENCH_AUTOMATION_REPORT_FILENAME));
  assert.equal(report.diagnosticReportPath, path.join(fixture.workDir, '.ralph', 'visual-workbench', 'automation-runs', 'task-001', 'latest.json'));
  const diagnosticReport = JSON.parse(await readFile(report.diagnosticReportPath, 'utf8'));
  assert.equal(diagnosticReport.status, 'blocked');
  assert.equal(diagnosticReport.ownerBoundary, VISUAL_WORKBENCH_AUTOMATION_OWNER_BOUNDARY);
  await assert.rejects(stat(path.join(fixture.workDir, '.arena', 'progress.json')));
  assert.equal(JSON.parse(formatVisualWorkbenchEvidenceAutomationResult(result, true)).status, 'blocked');
});

test('Visual Workbench automation records setup failure diagnostics without writing unsafe outDir report', async () => {
  const fixture = await createAutomationFixture();
  const unsafeOutDir = path.join(fixture.workDir, 'unsafe-capture-output');

  const result = await runVisualWorkbenchEvidenceAutomation({
    workDir: fixture.workDir,
    manifestPath: 'visual-workbench/manifest.json',
    taskId: 'task-001',
    sourceRef: fixture.sourceRef,
    baseUrl: 'http://127.0.0.1:43129',
    outDir: unsafeOutDir,
    ralphConfig: allowlistedConfig(),
    startWorkbench: async () => {
      throw new Error('setup failure test must not start Workbench');
    },
  });

  assert.equal(result.schemaVersion, VISUAL_WORKBENCH_AUTOMATION_SCHEMA_VERSION);
  assert.equal(result.ownerBoundary, VISUAL_WORKBENCH_AUTOMATION_OWNER_BOUNDARY);
  assert.equal(result.status, 'setup_failed');
  assert.equal(result.setup.status, 'failed');
  assert.equal(result.setup.reportPathWritten, false);
  assert.equal(result.setup.diagnosticReportPathWritten, true);
  assert.match(result.setup.errorMessage ?? '', /outDir must resolve outside workDir/);
  assert.equal(result.selector.status, 'not_run');
  assert.equal(result.shellPolicy.status, 'not_run');
  assert.equal(result.capture.status, null);
  assert.deepEqual(result.exports, []);
  assert.equal(result.publish.status, null);
  assert(result.blockers.includes('automation_setup_failed'));
  assert(result.blockers.includes('automation_out_dir_invalid'));

  await assert.rejects(stat(path.join(unsafeOutDir, VISUAL_WORKBENCH_AUTOMATION_REPORT_FILENAME)));
  const diagnosticReport = JSON.parse(await readFile(result.diagnosticReportPath, 'utf8'));
  assert.equal(diagnosticReport.status, 'setup_failed');
  assert.equal(diagnosticReport.ownerBoundary, VISUAL_WORKBENCH_AUTOMATION_OWNER_BOUNDARY);
  assert.equal(diagnosticReport.setup.reportPathWritten, false);

  const status = await getVisualWorkbenchEvidenceAutomationStatusFile({
    workDir: fixture.workDir,
    taskId: 'task-001',
  });
  assert.equal(status.status, 'available');
  assert.equal(status.reportSource, 'latest');
  assert.equal(status.report?.status, 'setup_failed');
  assert.equal(status.report?.ownerBoundary, VISUAL_WORKBENCH_AUTOMATION_OWNER_BOUNDARY);
  assert(status.report?.blockers.includes('automation_setup_failed'));

  const plan = JSON.parse(await readFile(path.join(fixture.workDir, '.ralph', 'plan.json'), 'utf8'));
  assert.equal(plan.phases[0].tasks[0].verificationEvidence, undefined);
  await assert.rejects(stat(path.join(fixture.workDir, '.arena', 'progress.json')));
});

test('Visual Workbench automation status reports source freshness without changing report availability', async () => {
  const fixture = await createAutomationFixture();

  const automation = await runVisualWorkbenchEvidenceAutomation({
    workDir: fixture.workDir,
    manifestPath: 'visual-workbench/manifest.json',
    taskId: 'task-001',
    sourceRef: fixture.sourceRef,
    baseUrl: 'http://127.0.0.1:43132',
    outDir: fixture.outDir,
    ralphConfig: RalphConfigSchema.parse({}),
    startWorkbench: async () => {
      throw new Error('freshness test must not start Workbench');
    },
  });
  assert.equal(automation.status, 'blocked');

  const currentStatus = await getVisualWorkbenchEvidenceAutomationStatusFile({
    workDir: fixture.workDir,
    taskId: 'task-001',
  });
  assert.equal(currentStatus.status, 'available');
  assert.equal(currentStatus.sourceFreshness.status, 'current');
  assert.equal(currentStatus.sourceFreshness.reportSourceRef, fixture.sourceRef);
  assert.equal(currentStatus.sourceFreshness.resolvedReportSourceRef, fixture.sourceRef);
  assert.equal(currentStatus.sourceFreshness.currentHeadRef, fixture.sourceRef);
  assert.deepEqual(currentStatus.sourceFreshness.unknowns, []);

  await writeFile(path.join(fixture.workDir, 'later-source.txt'), 'new source after automation report\n');
  execFileSync('git', ['add', 'later-source.txt'], { cwd: fixture.workDir, stdio: 'ignore' });
  execFileSync('git', ['commit', '-m', 'later source'], { cwd: fixture.workDir, stdio: 'ignore' });
  const laterSourceRef = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: fixture.workDir, encoding: 'utf8' }).trim();

  const staleStatus = await getVisualWorkbenchEvidenceAutomationStatusFile({
    workDir: fixture.workDir,
    taskId: 'task-001',
  });
  assert.equal(staleStatus.status, 'available');
  assert.equal(staleStatus.sourceFreshness.status, 'stale');
  assert.equal(staleStatus.sourceFreshness.reportSourceRef, fixture.sourceRef);
  assert.equal(staleStatus.sourceFreshness.resolvedReportSourceRef, fixture.sourceRef);
  assert.equal(staleStatus.sourceFreshness.currentHeadRef, laterSourceRef);
  assert.deepEqual(staleStatus.sourceFreshness.unknowns, []);
  assert.deepEqual(staleStatus.blockers, []);
  assert.match(JSON.stringify(staleStatus.sourceFreshness.notes), /not screenshot proof/);

  const mutableRefReport = JSON.parse(await readFile(automation.reportPath, 'utf8'));
  mutableRefReport.sourceRef = 'HEAD';
  await writeFile(automation.reportPath, JSON.stringify(mutableRefReport, null, 2));
  const mutableRefStatus = await getVisualWorkbenchEvidenceAutomationStatusFile({
    workDir: fixture.workDir,
    taskId: 'task-001',
    reportPath: automation.reportPath,
  });
  assert.equal(mutableRefStatus.status, 'available');
  assert.equal(mutableRefStatus.sourceFreshness.status, 'unknown');
  assert.equal(mutableRefStatus.sourceFreshness.reportSourceRef, 'HEAD');
  assert.equal(mutableRefStatus.sourceFreshness.resolvedReportSourceRef, null);
  assert.equal(mutableRefStatus.sourceFreshness.currentHeadRef, laterSourceRef);
  assert(mutableRefStatus.sourceFreshness.unknowns.includes('automation_report_source_ref_not_immutable'));
  assert.deepEqual(mutableRefStatus.blockers, []);
});

test('Visual Workbench automation persists selector ambiguity diagnostics without capture', async () => {
  const fixture = await createAutomationFixture({ duplicateTaskForSelector: true });
  let startCalled = false;

  const result = await runVisualWorkbenchEvidenceAutomation({
    workDir: fixture.workDir,
    manifestPath: 'visual-workbench/manifest.json',
    taskId: 'task-001',
    sourceRef: fixture.sourceRef,
    baseUrl: 'http://127.0.0.1:43130',
    outDir: fixture.outDir,
    ralphConfig: allowlistedConfig(),
    startWorkbench: async () => {
      startCalled = true;
      return { stop: async () => {} };
    },
  });

  assert.equal(result.status, 'blocked');
  assert.equal(result.selector.status, 'blocked');
  assert(result.blockers.includes('selector_not_ready'));
  assert(result.selector.blockers.includes('task:task-001:story_matches_multiple_tasks:synth-pad.playing.desktop'));
  assert.deepEqual(result.selector.ambiguities, [{
    storyId: 'synth-pad.playing.desktop',
    matchedTaskIds: ['task-001', 'task-002'],
    matchedSelectorsByTask: [
      { taskId: 'task-001', matchedSelectors: ['BUG-001'] },
      { taskId: 'task-002', matchedSelectors: ['BUG-001'] },
    ],
  }]);
  assert.equal(startCalled, false);
  assert.equal(result.capture.status, null);
  assert.deepEqual(result.exports, []);

  const diagnosticReport = JSON.parse(await readFile(result.diagnosticReportPath, 'utf8'));
  assert.deepEqual(diagnosticReport.selector.ambiguities, result.selector.ambiguities);
  const status = await getVisualWorkbenchEvidenceAutomationStatusFile({
    workDir: fixture.workDir,
    taskId: 'task-001',
  });
  assert.equal(status.status, 'available');
  assert.deepEqual(status.report?.selector.ambiguities, result.selector.ambiguities);
});

test('Visual Workbench automation blocks before starting workbench when platform browser is unavailable', async () => {
  const fixture = await createAutomationFixture();
  let startCalled = false;

  const result = await runVisualWorkbenchEvidenceAutomation({
    workDir: fixture.workDir,
    manifestPath: 'visual-workbench/manifest.json',
    taskId: 'task-001',
    sourceRef: fixture.sourceRef,
    baseUrl: 'http://127.0.0.1:43131',
    outDir: fixture.outDir,
    ralphConfig: allowlistedConfig(),
    launchBrowser: async () => {
      throw new Error("browserType.launch: Executable doesn't exist at /tmp/ms-playwright/chromium/chrome");
    },
    startWorkbench: async () => {
      startCalled = true;
      return { stop: async () => {} };
    },
  });

  assert.equal(result.schemaVersion, VISUAL_WORKBENCH_AUTOMATION_SCHEMA_VERSION);
  assert.equal(result.ownerBoundary, VISUAL_WORKBENCH_AUTOMATION_OWNER_BOUNDARY);
  assert.equal(result.status, 'blocked');
  assert.equal(result.selector.status, 'ready');
  assert.equal(result.shellPolicy.status, 'allowed');
  assert.equal(result.browserReadiness.status, 'blocked');
  assert.equal(result.browserReadiness.ownerBoundary, 'platform.browser-readiness');
  assert(result.browserReadiness.blockers.includes('INFRA_BROWSER_UNAVAILABLE'));
  assert.equal(result.browserReadiness.errorCode, 'INFRA_BROWSER_UNAVAILABLE');
  assert(result.blockers.includes('browser_readiness:INFRA_BROWSER_UNAVAILABLE'));
  assert.equal(result.capture.status, null);
  assert.deepEqual(result.exports, []);
  assert.equal(result.publish.status, null);
  assert.equal(startCalled, false);

  await assert.rejects(stat(path.join(fixture.outDir, 'visual-workbench-capture-run.json')));
  const report = JSON.parse(await readFile(path.join(fixture.outDir, VISUAL_WORKBENCH_AUTOMATION_REPORT_FILENAME), 'utf8'));
  assert.equal(report.status, 'blocked');
  assert.equal(report.browserReadiness.status, 'blocked');
  const diagnosticReport = JSON.parse(await readFile(report.diagnosticReportPath, 'utf8'));
  assert.equal(diagnosticReport.browserReadiness.errorCode, 'INFRA_BROWSER_UNAVAILABLE');
  const plan = JSON.parse(await readFile(path.join(fixture.workDir, '.ralph', 'plan.json'), 'utf8'));
  assert.equal(plan.phases[0].tasks[0].verificationEvidence, undefined);
  await assert.rejects(stat(path.join(fixture.workDir, '.arena', 'progress.json')));
});

test('Visual Workbench automation captures, exports inconclusive evidence and publishes sanitized progress', async () => {
  const fixture = await createAutomationFixture();
  const screenshotBytes = Buffer.from('automation-workbench-png');
  const screenshotSha256 = `sha256:${createHash('sha256').update(screenshotBytes).digest('hex')}`;
  let stopped = false;
  const visitedUrls: string[] = [];

  const result = await runVisualWorkbenchEvidenceAutomation({
    workDir: fixture.workDir,
    manifestPath: 'visual-workbench/manifest.json',
    taskId: 'task-001',
    sourceRef: fixture.sourceRef,
    baseUrl: 'http://127.0.0.1:43124',
    outDir: fixture.outDir,
    ralphConfig: allowlistedConfig(),
    now: () => new Date('2026-06-11T12:00:00.000Z'),
    startWorkbench: async () => ({
      stop: async () => {
        stopped = true;
      },
    }),
    launchBrowser: async () => ({
      newPage: async () => ({
        goto: async (url: string) => {
          visitedUrls.push(url);
          return { status: () => 200 };
        },
        waitForTimeout: async () => {},
        screenshot: async (options: { path: string }) => {
          await writeFile(options.path, screenshotBytes);
        },
      }),
      close: async () => {},
    } as any),
  });

  assert.equal(result.status, 'published');
  assert.equal(result.ownerBoundary, VISUAL_WORKBENCH_AUTOMATION_OWNER_BOUNDARY);
  assert.equal(result.setup.status, 'ok');
  assert.equal(result.reportPath, path.join(fixture.outDir, VISUAL_WORKBENCH_AUTOMATION_REPORT_FILENAME));
  assert.equal(result.diagnosticReportPath, path.join(fixture.workDir, '.ralph', 'visual-workbench', 'automation-runs', 'task-001', 'latest.json'));
  assert.equal(result.browserReadiness.status, 'ready');
  assert.deepEqual(result.browserReadiness.blockers, []);
  assert.equal(result.capture.status, 'captured');
  assert.equal(result.capture.reportPath, path.join(fixture.outDir, 'visual-workbench-capture-run.json'));
  assert.equal(result.capture.viewerPath, path.join(fixture.outDir, 'index.html'));
  assert.equal(result.capture.capturedStories, 1);
  assert.equal(result.capture.capturedViewports, 1);
  assert.deepEqual(result.exports.map((entry) => ({
    storyId: entry.storyId,
    viewportName: entry.viewportName,
    status: entry.status,
  })), [{
    storyId: 'synth-pad.playing.desktop',
    viewportName: 'desktop',
    status: 'recorded',
  }]);
  assert.equal(result.publish.status, 'published');
  assert.equal(result.publish.visualEvidenceRows, 1);
  assert.equal(stopped, true);
  assert.deepEqual(visitedUrls, ['http://127.0.0.1:43124/__visual/synth-pad.playing.desktop']);
  await stat(path.join(fixture.outDir, 'index.html'));
  const report = JSON.parse(await readFile(path.join(fixture.outDir, VISUAL_WORKBENCH_AUTOMATION_REPORT_FILENAME), 'utf8'));
  assert.equal(report.status, 'published');
  assert.equal(report.ownerBoundary, VISUAL_WORKBENCH_AUTOMATION_OWNER_BOUNDARY);
  assert.equal(report.publish.visualEvidenceRows, 1);
  const diagnosticReport = JSON.parse(await readFile(result.diagnosticReportPath, 'utf8'));
  assert.equal(diagnosticReport.status, 'published');
  assert.equal(diagnosticReport.ownerBoundary, VISUAL_WORKBENCH_AUTOMATION_OWNER_BOUNDARY);
  assert.equal(diagnosticReport.publish.visualEvidenceRows, 1);
  const captureReport = JSON.parse(await readFile(path.join(fixture.outDir, 'visual-workbench-capture-run.json'), 'utf8'));
  assert.equal(captureReport.stage.selection, 'story_viewports');
  assert.deepEqual(captureReport.stage.selectionScope, {
    storyId: 'synth-pad.playing.desktop',
    viewportNames: ['desktop'],
  });
  assert.equal(captureReport.manifest.summary.storyCount, 2);
  assert.deepEqual(captureReport.stories.map((story: { storyId: string }) => story.storyId), ['synth-pad.playing.desktop']);

  const plan = JSON.parse(await readFile(path.join(fixture.workDir, '.ralph', 'plan.json'), 'utf8'));
  const task = plan.phases[0].tasks[0];
  assert.equal(task.status, 'completed');
  assert.equal(task.verificationEvidence.length, 1);
  assert.equal(task.verificationEvidence[0].result, 'inconclusive');
  assert.equal(task.verificationEvidence[0].artifactSha256, screenshotSha256);
  assert.equal(task.verificationEvidence[0].screenshotProof, undefined);

  const progress = JSON.parse(await readFile(path.join(fixture.workDir, '.arena', 'progress.json'), 'utf8'));
  assert.equal(progress.steps[0].visualEvidence[0].result, 'inconclusive');
  assert.equal(progress.steps[0].visualEvidence[0].artifactSha256, screenshotSha256);
  const rawProgress = JSON.stringify(progress);
  assert.doesNotMatch(rawProgress, /artifactPath|\.ralph|proofReviews|ProjectAsset/);

  const ingestManifest = JSON.parse(await readFile(path.join(fixture.workDir, VISUAL_WORKBENCH_INGEST_MANIFEST_PATH), 'utf8'));
  assert.equal(ingestManifest.schemaVersion, VISUAL_WORKBENCH_INGEST_MANIFEST_SCHEMA_VERSION);
  assert.equal(ingestManifest.items.length, 1);
  assert.equal(ingestManifest.items[0].taskId, 'task-001');
  assert.equal(ingestManifest.items[0].sourceEvidenceRef, task.verificationEvidence[0].ref);
  assert.equal(ingestManifest.items[0].artifactSha256, screenshotSha256);
  assert.match(ingestManifest.items[0].artifactPath, /^\.ralph\/visual-workbench\/synth-pad\.playing\.desktop\/desktop\//);
  assert.doesNotMatch(JSON.stringify(ingestManifest), /artifactContentBase64|"progressJson"|proofReviews|ProjectAsset/);
});

test('Visual Workbench automation exports the selector-selected feedback ref for multi-ref tasks', async () => {
  const fixture = await createAutomationFixture({
    feedbackItemRefs: [
      { itemId: 'BUG-001', diffItemId: 'DIFF-001-BUG-001', workSurface: 'frontend' },
      { itemId: 'BUG-002', diffItemId: 'DIFF-002-BUG-002', workSurface: 'frontend' },
    ],
    storyDefaultFor: ['task-001#BUG-001'],
  });
  const screenshotBytes = Buffer.from('automation-workbench-multi-ref-png');

  const result = await runVisualWorkbenchEvidenceAutomation({
    workDir: fixture.workDir,
    manifestPath: 'visual-workbench/manifest.json',
    taskId: 'task-001',
    sourceRef: fixture.sourceRef,
    baseUrl: 'http://127.0.0.1:43128',
    outDir: fixture.outDir,
    ralphConfig: allowlistedConfig(),
    now: () => new Date('2026-06-11T12:00:00.000Z'),
    startWorkbench: async () => ({ stop: async () => {} }),
    launchBrowser: async () => ({
      newPage: async () => ({
        goto: async () => ({ status: () => 200 }),
        waitForTimeout: async () => {},
        screenshot: async (options: { path: string }) => {
          await writeFile(options.path, screenshotBytes);
        },
      }),
      close: async () => {},
    } as any),
  });

  assert.equal(result.status, 'published');
  assert.deepEqual(result.exports.map((entry) => ({
    storyId: entry.storyId,
    viewportName: entry.viewportName,
    feedbackItemId: entry.feedbackItemId,
    diffItemId: entry.diffItemId,
    status: entry.status,
  })), [{
    storyId: 'synth-pad.playing.desktop',
    viewportName: 'desktop',
    feedbackItemId: 'BUG-001',
    diffItemId: 'DIFF-001-BUG-001',
    status: 'recorded',
  }]);

  const plan = JSON.parse(await readFile(path.join(fixture.workDir, '.ralph', 'plan.json'), 'utf8'));
  const evidence = plan.phases[0].tasks[0].verificationEvidence[0];
  assert.deepEqual(evidence.feedbackItemIds, ['BUG-001']);
  assert.deepEqual(evidence.diffItemIds, ['DIFF-001-BUG-001']);
});

test('Visual Workbench automation selected capture handles one story with multiple viewports', async () => {
  const fixture = await createAutomationFixture({
    selectedViewports: [
      { name: 'desktop', width: 1280, height: 832 },
      { name: 'mobile', width: 390, height: 844 },
    ],
  });
  const screenshotBytes = Buffer.from('automation-workbench-multi-viewport-png');
  const visitedUrls: string[] = [];

  const result = await runVisualWorkbenchEvidenceAutomation({
    workDir: fixture.workDir,
    manifestPath: 'visual-workbench/manifest.json',
    taskId: 'task-001',
    sourceRef: fixture.sourceRef,
    baseUrl: 'http://127.0.0.1:43130',
    outDir: fixture.outDir,
    ralphConfig: allowlistedConfig(),
    startWorkbench: async () => ({ stop: async () => {} }),
    launchBrowser: async () => ({
      newPage: async () => ({
        goto: async (url: string) => {
          visitedUrls.push(url);
          return { status: () => 200 };
        },
        waitForTimeout: async () => {},
        screenshot: async (options: { path: string }) => {
          await writeFile(options.path, screenshotBytes);
        },
      }),
      close: async () => {},
    } as any),
  });

  assert.equal(result.status, 'published');
  assert.equal(result.capture.status, 'captured');
  assert.equal(result.capture.capturedStories, 1);
  assert.equal(result.capture.capturedViewports, 2);
  assert.deepEqual(result.exports.map((entry) => ({
    storyId: entry.storyId,
    viewportName: entry.viewportName,
    status: entry.status,
  })), [
    {
      storyId: 'synth-pad.playing.desktop',
      viewportName: 'desktop',
      status: 'recorded',
    },
    {
      storyId: 'synth-pad.playing.desktop',
      viewportName: 'mobile',
      status: 'recorded',
    },
  ]);
  assert.deepEqual(visitedUrls, [
    'http://127.0.0.1:43130/__visual/synth-pad.playing.desktop',
    'http://127.0.0.1:43130/__visual/synth-pad.playing.desktop',
  ]);

  const captureReport = JSON.parse(await readFile(path.join(fixture.outDir, 'visual-workbench-capture-run.json'), 'utf8'));
  assert.equal(captureReport.stage.selection, 'story_viewports');
  assert.deepEqual(captureReport.stage.selectionScope, {
    storyId: 'synth-pad.playing.desktop',
    viewportNames: ['desktop', 'mobile'],
  });
  assert.deepEqual(captureReport.stories[0].viewports.map((viewport: { name: string }) => viewport.name), ['desktop', 'mobile']);

  const plan = JSON.parse(await readFile(path.join(fixture.workDir, '.ralph', 'plan.json'), 'utf8'));
  assert.equal(plan.phases[0].tasks[0].verificationEvidence.length, 2);
  const progress = JSON.parse(await readFile(path.join(fixture.workDir, '.arena', 'progress.json'), 'utf8'));
  assert.equal(progress.steps[0].visualEvidence.length, 2);
});

test('Visual Workbench automation does not export or publish when capture fails', async () => {
  const fixture = await createAutomationFixture();

  const result = await runVisualWorkbenchEvidenceAutomation({
    workDir: fixture.workDir,
    manifestPath: 'visual-workbench/manifest.json',
    taskId: 'task-001',
    sourceRef: fixture.sourceRef,
    baseUrl: 'http://127.0.0.1:43125',
    outDir: fixture.outDir,
    ralphConfig: allowlistedConfig(),
    startWorkbench: async () => ({ stop: async () => {} }),
    launchBrowser: async () => ({
      newPage: async () => ({
        goto: async () => ({ status: () => 404 }),
        waitForTimeout: async () => {},
        screenshot: async () => {
          throw new Error('screenshot should not run after navigation failure');
        },
      }),
      close: async () => {},
    } as any),
  });

  assert.equal(result.status, 'capture_failed');
  assert.equal(result.setup.status, 'ok');
  assert.equal(result.capture.status, 'failed');
  assert.deepEqual(result.exports, []);
  assert.equal(result.publish.status, null);
  assert(result.blockers.includes('capture_not_captured:failed'));
  const report = JSON.parse(await readFile(path.join(fixture.outDir, VISUAL_WORKBENCH_AUTOMATION_REPORT_FILENAME), 'utf8'));
  assert.equal(report.status, 'capture_failed');
  assert.equal(report.capture.status, 'failed');
  const diagnosticReport = JSON.parse(await readFile(report.diagnosticReportPath, 'utf8'));
  assert.equal(diagnosticReport.status, 'capture_failed');
  assert.equal(diagnosticReport.capture.status, 'failed');
  const plan = JSON.parse(await readFile(path.join(fixture.workDir, '.ralph', 'plan.json'), 'utf8'));
  assert.equal(plan.phases[0].tasks[0].verificationEvidence, undefined);
  await assert.rejects(stat(path.join(fixture.workDir, '.arena', 'progress.json')));
});

test('Visual Workbench automation exposes bounded Workbench start diagnostics on capture failure', async () => {
  const fixture = await createAutomationFixture();
  const startError = new Error('Workbench command exited before becoming reachable (code=1 signal=none).') as Error & {
    workbenchStartDiagnostics?: unknown;
  };
  startError.workbenchStartDiagnostics = {
    command: 'npm run visual-workbench',
    cwd: fixture.workDir,
    baseUrl: 'http://127.0.0.1:43132/',
    readinessPath: '/__visual/synth-pad.playing.desktop',
    timeoutMs: 20_000,
    elapsedMs: 314,
    exited: true,
    exitCode: 1,
    signal: null,
    errorMessage: null,
    stdoutTail: 'ready? no',
    stderrTail: 'listen EPERM 0.0.0.0:43132 Bearer <redacted>',
    outputLimitChars: 2_000,
  };

  const result = await runVisualWorkbenchEvidenceAutomation({
    workDir: fixture.workDir,
    manifestPath: 'visual-workbench/manifest.json',
    taskId: 'task-001',
    sourceRef: fixture.sourceRef,
    baseUrl: 'http://127.0.0.1:43132',
    outDir: fixture.outDir,
    ralphConfig: allowlistedConfig(),
    launchBrowser: async () => ({ close: async () => {} } as any),
    startWorkbench: async () => {
      throw startError;
    },
  });

  assert.equal(result.status, 'capture_failed');
  assert.equal(result.capture.status, 'workbench_start_failed');
  assert.equal(result.capture.errorCode, 'workbench_start_failed');
  assert(result.blockers.includes('capture_not_captured:workbench_start_failed'));
  assert.equal(result.capture.startDiagnostics?.exitCode, 1);
  assert.match(result.capture.startDiagnostics?.stderrTail ?? '', /listen EPERM/);
  assert.deepEqual(result.exports, []);
  assert.equal(result.publish.status, null);

  const report = JSON.parse(await readFile(result.reportPath, 'utf8'));
  assert.equal(report.capture.status, 'workbench_start_failed');
  assert.equal(report.capture.startDiagnostics.exitCode, 1);
  const diagnosticReport = JSON.parse(await readFile(result.diagnosticReportPath, 'utf8'));
  assert.equal(diagnosticReport.capture.startDiagnostics.stderrTail, 'listen EPERM 0.0.0.0:43132 Bearer <redacted>');

  const status = await getVisualWorkbenchEvidenceAutomationStatusFile({
    workDir: fixture.workDir,
    taskId: 'task-001',
  });
  assert.equal(status.status, 'available');
  assert.equal(status.report?.capture.status, 'workbench_start_failed');
  assert.equal(status.report?.capture.startDiagnostics?.readinessPath, '/__visual/synth-pad.playing.desktop');

  const plan = JSON.parse(await readFile(path.join(fixture.workDir, '.ralph', 'plan.json'), 'utf8'));
  assert.equal(plan.phases[0].tasks[0].verificationEvidence, undefined);
  await assert.rejects(stat(path.join(fixture.workDir, '.arena', 'progress.json')));
});

test('Visual Workbench automation status reads the latest Ralph-local diagnostic report', async () => {
  const fixture = await createAutomationFixture();
  const automation = await runVisualWorkbenchEvidenceAutomation({
    workDir: fixture.workDir,
    manifestPath: 'visual-workbench/manifest.json',
    taskId: 'task-001',
    sourceRef: fixture.sourceRef,
    baseUrl: 'http://127.0.0.1:43126',
    outDir: fixture.outDir,
    ralphConfig: RalphConfigSchema.parse({}),
    startWorkbench: async () => {
      throw new Error('status test should not start Workbench');
    },
  });

  const status = await getVisualWorkbenchEvidenceAutomationStatusFile({
    workDir: fixture.workDir,
    taskId: 'task-001',
  });

  assert.equal(status.status, 'available');
  assert.equal(status.reportSource, 'latest');
  assert.equal(status.resolvedReportPath, automation.diagnosticReportPath);
  assert.equal(status.report?.status, 'blocked');
  assert(status.report?.blockers.includes('shell_policy_not_allowed'));
  assert.deepEqual(status.blockers, []);
  assert.equal(JSON.parse(formatVisualWorkbenchEvidenceAutomationStatusResult(status, true)).status, 'available');
});

test('Visual Workbench automation status normalizes historical v5 reports without ownerBoundary or selector ambiguities', async () => {
  const fixture = await createAutomationFixture();
  const automation = await runVisualWorkbenchEvidenceAutomation({
    workDir: fixture.workDir,
    manifestPath: 'visual-workbench/manifest.json',
    taskId: 'task-001',
    sourceRef: fixture.sourceRef,
    baseUrl: 'http://127.0.0.1:43126',
    outDir: fixture.outDir,
    ralphConfig: RalphConfigSchema.parse({}),
    startWorkbench: async () => {
      throw new Error('legacy status test should not start Workbench');
    },
  });
  const legacyReport = JSON.parse(await readFile(automation.diagnosticReportPath, 'utf8'));
  delete legacyReport.ownerBoundary;
  delete legacyReport.selector.ambiguities;
  delete legacyReport.capture.startDiagnostics;
  await writeFile(automation.diagnosticReportPath, JSON.stringify(legacyReport, null, 2));

  const status = await getVisualWorkbenchEvidenceAutomationStatusFile({
    workDir: fixture.workDir,
    taskId: 'task-001',
  });

  assert.equal(status.status, 'available');
  assert.deepEqual(status.blockers, []);
  assert.equal(status.report?.ownerBoundary, VISUAL_WORKBENCH_AUTOMATION_OWNER_BOUNDARY);
  assert.deepEqual(status.report?.selector.ambiguities, []);
  assert.equal(status.report?.capture.startDiagnostics, null);
});

test('Visual Workbench automation status can read an explicit report path without task truth', async () => {
  const fixture = await createAutomationFixture();
  const automation = await runVisualWorkbenchEvidenceAutomation({
    workDir: fixture.workDir,
    manifestPath: 'visual-workbench/manifest.json',
    taskId: 'task-001',
    sourceRef: fixture.sourceRef,
    baseUrl: 'http://127.0.0.1:43127',
    outDir: fixture.outDir,
    ralphConfig: RalphConfigSchema.parse({}),
  });

  const status = await getVisualWorkbenchEvidenceAutomationStatusFile({
    workDir: fixture.workDir,
    reportPath: automation.reportPath,
  });

  assert.equal(status.status, 'available');
  assert.equal(status.taskId, null);
  assert.equal(status.reportSource, 'explicit');
  assert.equal(status.requestedReportPath, automation.reportPath);
  assert.equal(status.report?.taskId, 'task-001');
});

test('Visual Workbench automation status CLI reads latest diagnostics', async () => {
  const fixture = await createAutomationFixture();
  await runVisualWorkbenchEvidenceAutomation({
    workDir: fixture.workDir,
    manifestPath: 'visual-workbench/manifest.json',
    taskId: 'task-001',
    sourceRef: fixture.sourceRef,
    baseUrl: 'http://127.0.0.1:43128',
    outDir: fixture.outDir,
    ralphConfig: RalphConfigSchema.parse({}),
  });

  const stdout = execFileSync(process.execPath, [
    '--import',
    'tsx',
    'src/index.ts',
    'visual-workbench',
    'automation-status',
    '--work-dir',
    fixture.workDir,
    '--task',
    'task-001',
    '--compact',
  ], {
    cwd: packageRoot,
    encoding: 'utf8',
  });
  const status = JSON.parse(stdout.trim());
  assert.equal(status.schemaVersion, 'ra-356.visual-workbench-automation-status.v1');
  assert.equal(status.status, 'available');
  assert.equal(status.reportSource, 'latest');
  assert.equal(status.report.status, 'blocked');
});

test('Visual Workbench automation status reports missing and invalid diagnostics without writes', async () => {
  const fixture = await createAutomationFixture();
  const missing = await getVisualWorkbenchEvidenceAutomationStatusFile({
    workDir: fixture.workDir,
    taskId: 'missing-task',
  });
  assert.equal(missing.status, 'missing');
  assert(missing.blockers.includes('automation_report_missing'));

  const invalidPath = path.join(fixture.outDir, 'invalid-automation.json');
  await writeFile(invalidPath, '{"schemaVersion":"wrong","status":"green"}\n');
  const invalid = await getVisualWorkbenchEvidenceAutomationStatusFile({
    workDir: fixture.workDir,
    taskId: 'task-001',
    reportPath: invalidPath,
  });
  assert.equal(invalid.status, 'invalid');
  assert(invalid.blockers.includes('automation_report_schema_unsupported'));
  assert(invalid.blockers.includes('automation_report_status_unsupported'));
  assert.equal(invalid.report, null);

  const automation = await runVisualWorkbenchEvidenceAutomation({
    workDir: fixture.workDir,
    manifestPath: 'visual-workbench/manifest.json',
    taskId: 'task-001',
    sourceRef: fixture.sourceRef,
    baseUrl: 'http://127.0.0.1:43131',
    outDir: fixture.outDir,
    ralphConfig: RalphConfigSchema.parse({}),
  });
  const badAmbiguitiesReport = JSON.parse(await readFile(automation.reportPath, 'utf8'));
  badAmbiguitiesReport.selector.ambiguities = 'bad';
  await writeFile(automation.reportPath, JSON.stringify(badAmbiguitiesReport, null, 2));
  const badAmbiguities = await getVisualWorkbenchEvidenceAutomationStatusFile({
    workDir: fixture.workDir,
    taskId: 'task-001',
    reportPath: automation.reportPath,
  });
  assert.equal(badAmbiguities.status, 'invalid');
  assert(badAmbiguities.blockers.includes('automation_report_selector_ambiguities_invalid'));
  assert.equal(badAmbiguities.report, null);

  const badOwnerBoundaryReport = JSON.parse(await readFile(automation.reportPath, 'utf8'));
  badOwnerBoundaryReport.selector.ambiguities = [];
  badOwnerBoundaryReport.ownerBoundary = 'ralph.other-owner';
  await writeFile(automation.reportPath, JSON.stringify(badOwnerBoundaryReport, null, 2));
  const badOwnerBoundary = await getVisualWorkbenchEvidenceAutomationStatusFile({
    workDir: fixture.workDir,
    taskId: 'task-001',
    reportPath: automation.reportPath,
  });
  assert.equal(badOwnerBoundary.status, 'invalid');
  assert(badOwnerBoundary.blockers.includes('automation_report_owner_boundary_unsupported'));
  assert.equal(badOwnerBoundary.report, null);

  const overlongDiagnosticsReport = JSON.parse(await readFile(automation.reportPath, 'utf8'));
  overlongDiagnosticsReport.ownerBoundary = VISUAL_WORKBENCH_AUTOMATION_OWNER_BOUNDARY;
  overlongDiagnosticsReport.selector.ambiguities = [];
  overlongDiagnosticsReport.capture.startDiagnostics = {
    command: 'API_KEY=diagnostic-secret npm run visual-workbench',
    cwd: fixture.workDir,
    baseUrl: 'http://127.0.0.1:43131/',
    readinessPath: '/__visual/synth-pad.playing.desktop',
    timeoutMs: 20_000,
    elapsedMs: 42,
    exited: true,
    exitCode: 1,
    signal: null,
    errorMessage: 'Bearer diagnosticsecret',
    stdoutTail: `${'x'.repeat(2200)} token=stdout-secret`,
    stderrTail: 'listen EPERM Bearer stderrsecret',
    outputLimitChars: 20_000,
    ignoredExtraField: 'ignored',
  };
  await writeFile(automation.reportPath, JSON.stringify(overlongDiagnosticsReport, null, 2));
  const normalizedDiagnostics = await getVisualWorkbenchEvidenceAutomationStatusFile({
    workDir: fixture.workDir,
    taskId: 'task-001',
    reportPath: automation.reportPath,
  });
  assert.equal(normalizedDiagnostics.status, 'available');
  assert.match(normalizedDiagnostics.report?.capture.startDiagnostics?.command ?? '', /API_KEY=<redacted>/);
  assert.doesNotMatch(JSON.stringify(normalizedDiagnostics.report?.capture.startDiagnostics), /diagnostic-secret|stdout-secret|stderrsecret|diagnosticsecret/);
  assert((normalizedDiagnostics.report?.capture.startDiagnostics?.stdoutTail.length ?? 0) <= 2_000);
  assert.equal(normalizedDiagnostics.report?.capture.startDiagnostics?.outputLimitChars, 2_000);
  assert.equal((normalizedDiagnostics.report?.capture.startDiagnostics as any).ignoredExtraField, undefined);

  const badStartDiagnosticsReport = JSON.parse(await readFile(automation.reportPath, 'utf8'));
  badStartDiagnosticsReport.capture.startDiagnostics = 'bad';
  await writeFile(automation.reportPath, JSON.stringify(badStartDiagnosticsReport, null, 2));
  const badStartDiagnostics = await getVisualWorkbenchEvidenceAutomationStatusFile({
    workDir: fixture.workDir,
    taskId: 'task-001',
    reportPath: automation.reportPath,
  });
  assert.equal(badStartDiagnostics.status, 'invalid');
  assert(badStartDiagnostics.blockers.includes('automation_report_capture_start_diagnostics_invalid'));
  assert.equal(badStartDiagnostics.report, null);

  const notProvided = await getVisualWorkbenchEvidenceAutomationStatusFile({
    workDir: fixture.workDir,
  });
  assert.equal(notProvided.status, 'not_provided');
  assert.equal(notProvided.reportSource, null);
  assert(notProvided.blockers.includes('task_or_report_required'));
  await assert.rejects(stat(path.join(fixture.workDir, '.arena', 'progress.json')));
});

function allowlistedConfig() {
  return RalphConfigSchema.parse({
    visualWorkbench: {
      executorCaptureShell: {
        mode: 'allowlisted',
        allowedServeCommands: ['npm run visual-workbench'],
        allowedBaseUrlEnv: ['VISUAL_WORKBENCH_BASE_URL'],
      },
    },
  });
}

async function createAutomationFixture(options: {
  selectedViewports?: Array<{ name: string; width: number; height: number }>;
  duplicateTaskForSelector?: boolean;
  feedbackItemRefs?: Array<{ itemId: string; diffItemId?: string; workSurface?: string }>;
  storyDefaultFor?: string[];
} = {}) {
  const workDir = await mkdtemp(path.join(os.tmpdir(), 'visual-workbench-automation-work-'));
  const outDir = await mkdtemp(path.join(os.tmpdir(), 'visual-workbench-automation-out-'));
  const selectedViewports = options.selectedViewports ?? [{ name: 'desktop', width: 1280, height: 832 }];
  await mkdir(path.join(workDir, '.ralph'), { recursive: true });
  await mkdir(path.join(workDir, 'visual-workbench'), { recursive: true });
  await writeFile(path.join(workDir, 'spec.md'), '# Visual automation spec\n');
  const tasks = [{
    id: 'task-001',
    description: 'Make the synth pad playing state visible.',
    acceptanceCriteria: ['Synth pad playing state is visible.'],
    status: 'completed',
    attempts: 1,
    dependencies: [],
    feedbackItemRefs: options.feedbackItemRefs ?? [{ itemId: 'BUG-001', diffItemId: 'DIFF-001-BUG-001', workSurface: 'frontend' }],
  }];
  if (options.duplicateTaskForSelector) {
    tasks.push({
      id: 'task-002',
      description: 'Make the synth pad playing state visible on mobile.',
      acceptanceCriteria: ['Synth pad playing state is visible on mobile.'],
      status: 'completed',
      attempts: 1,
      dependencies: [],
      feedbackItemRefs: [{ itemId: 'BUG-001', diffItemId: 'DIFF-001-BUG-001', workSurface: 'frontend' }],
    });
  }

  await writeFile(path.join(workDir, '.ralph', 'plan.json'), JSON.stringify({
    version: 1,
    specFile: 'spec.md',
    createdAt: '2026-06-11T12:00:00.000Z',
    updatedAt: '2026-06-11T12:00:00.000Z',
    phases: [{
      id: 'phase-1',
      name: 'UI fixes',
      description: 'Fix reported UI behavior',
      order: 1,
      status: 'completed',
      tasks,
      planLater: false,
    }],
    judgments: [],
    specMigrations: [],
  }, null, 2));
  await writeFile(path.join(workDir, 'visual-workbench', 'manifest.json'), JSON.stringify({
    schemaVersion: 'ra-355.visual-coverage-manifest.v0',
    projectClass: 'ordinary_web',
    workbench: {
      serveCommand: 'npm run visual-workbench',
      baseUrlEnv: 'VISUAL_WORKBENCH_BASE_URL',
      storyRoutePattern: '/__visual/:storyId',
    },
    coveragePolicy: {
      mode: 'strict_canary',
      selectionDefault: 'full_manifest',
      simplificationRequiresEvidence: true,
    },
    stories: [{
      id: 'synth-pad.playing.desktop',
      title: 'Synth pad playing state',
      kind: 'widget',
      feature: 'instrument-surface',
      widget: 'SynthPad',
      state: 'playing',
      claim: 'The synth pad shows the active note and pressure level.',
      render: { type: 'workbench_route', path: '/__visual/synth-pad.playing.desktop' },
      mockState: { name: 'playing' },
      viewports: selectedViewports,
      taskRelevance: { defaultFor: options.storyDefaultFor ?? ['BUG-001'] },
    }, {
      id: 'mixer.idle.desktop',
      title: 'Mixer idle state',
      kind: 'widget',
      feature: 'mixer',
      widget: 'MixerStrip',
      state: 'idle',
      claim: 'The mixer strip shows idle levels.',
      render: { type: 'workbench_route', path: '/__visual/mixer.idle.desktop' },
      mockState: { name: 'idle' },
      viewports: [{ name: 'desktop', width: 1280, height: 832 }],
      taskRelevance: { defaultFor: ['BUG-OTHER'] },
    }],
  }, null, 2));

  execFileSync('git', ['init'], { cwd: workDir, stdio: 'ignore' });
  execFileSync('git', ['checkout', '-B', 'main'], { cwd: workDir, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.email', 'ralph-test@example.com'], { cwd: workDir });
  execFileSync('git', ['config', 'user.name', 'Ralph Test'], { cwd: workDir });
  execFileSync('git', ['add', '.'], { cwd: workDir, stdio: 'ignore' });
  execFileSync('git', ['commit', '-m', 'visual workbench automation'], { cwd: workDir, stdio: 'ignore' });
  const sourceRef = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: workDir, encoding: 'utf8' }).trim();

  return { workDir, outDir, sourceRef };
}
