import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  VISUAL_WORKBENCH_CAPTURE_RUN_SCHEMA_VERSION,
  VISUAL_WORKBENCH_CAPTURE_VIEWER_SCHEMA_VERSION,
  VISUAL_WORKBENCH_INSPECT_RESULT_SCHEMA_VERSION,
  formatVisualWorkbenchCaptureViewerResult,
  formatVisualWorkbenchCaptureResult,
  formatVisualWorkbenchInspectResult,
  inspectVisualWorkbenchManifest,
  renderVisualWorkbenchCaptureViewerFile,
  runVisualWorkbenchCapture,
} from './visual-workbench-runner.js';

test('Visual Workbench inspect reads explicit source ref without starting capture or writing artifacts', async () => {
  const workspace = await createWorkbenchWorkspace(validManifest({
    stories: [
      validStory({
        id: 'jam-room.empty.mobile',
        feature: 'jam-room',
        widget: 'JamRoom',
        state: 'empty',
        viewports: [{ name: 'mobile', width: 390, height: 844 }],
      }),
      validStory({
        id: 'transport.playing',
        feature: 'transport',
        widget: 'TransportControls',
        state: 'playing',
        viewports: [
          { name: 'mobile', width: 390, height: 844 },
          { name: 'desktop', width: 1440, height: 900 },
        ],
      }),
    ],
  }));

  const result = await inspectVisualWorkbenchManifest({
    workDir: workspace.workDir,
    sourceRef: workspace.sourceRef,
  });

  assert.equal(result.schemaVersion, VISUAL_WORKBENCH_INSPECT_RESULT_SCHEMA_VERSION);
  assert.equal(result.status, 'ready');
  assert.equal(result.stage.stageId, 'visual_workbench_manifest_readiness');
  assert.equal(result.stage.mode, 'read_only');
  assert.equal(result.stage.ownerBoundary, 'ra-355.visual-workbench-manifest');
  assert.deepEqual(result.stage.allowedMutations, []);
  assert(result.stage.forbiddenMutations.includes('Playwright screenshot capture'));
  assert.equal(result.source.resolvedSourceRef, workspace.sourceRef);
  assert.equal(result.source.headMatchesSourceRef, true);
  assert.equal(result.source.remoteFreshnessChecked, false);
  assert.equal(result.manifest.summary?.storyCount, 2);
  assert.deepEqual(result.manifest.summary?.features, ['jam-room', 'transport']);
  assert.deepEqual(result.manifest.summary?.stories.map((story) => ({
    id: story.id,
    feature: story.feature,
    widget: story.widget,
    state: story.state,
    route: story.route,
    mockStateName: story.mockStateName,
    viewportNames: story.viewportNames,
    taskRelevanceDefaultFor: story.taskRelevanceDefaultFor,
  })), [{
    id: 'jam-room.empty.mobile',
    feature: 'jam-room',
    widget: 'JamRoom',
    state: 'empty',
    route: '/__visual/jam-room.empty.mobile',
    mockStateName: 'jam-room.empty.mobile',
    viewportNames: ['mobile'],
    taskRelevanceDefaultFor: [],
  }, {
    id: 'transport.playing',
    feature: 'transport',
    widget: 'TransportControls',
    state: 'playing',
    route: '/__visual/transport.playing',
    mockStateName: 'transport.playing',
    viewportNames: ['mobile', 'desktop'],
    taskRelevanceDefaultFor: [],
  }]);
  assert.equal(result.canRunWorkbenchCapture, true);
  assert.equal(result.recommendedCapture?.stageId, 'visual_workbench_capture');
  assert.equal(result.recommendedCapture?.requiresCurrentHeadAtSourceRef, true);
  assert.match(result.notes.join(' '), /not proof and not lifecycle truth/);
  assert.match(result.notes.join(' '), /no fallback to app pages/i);
  assert.equal(JSON.parse(formatVisualWorkbenchInspectResult(result, 'json')).status, 'ready');
  assert.equal(JSON.parse(formatVisualWorkbenchInspectResult(result, 'json', true)).schemaVersion, VISUAL_WORKBENCH_INSPECT_RESULT_SCHEMA_VERSION);
  assert.throws(() => formatVisualWorkbenchInspectResult(result, 'text' as any), /Unsupported/);
  await assert.rejects(stat(path.join(workspace.workDir, '.ralph')));
});

test('Visual Workbench inspect reports manifest blockers without writing a capture report', async () => {
  const workspace = await createWorkbenchWorkspace(validManifest({ stories: [] }));

  const result = await inspectVisualWorkbenchManifest({
    workDir: workspace.workDir,
    sourceRef: workspace.sourceRef,
  });

  assert.equal(result.status, 'blocked');
  assert.equal(result.error, null);
  assert.deepEqual(result.manifest.blockers, ['strict_state_gap']);
  assert.equal(result.canRunWorkbenchCapture, false);
  assert.equal(result.recommendedCapture, null);
  await assert.rejects(stat(path.join(workspace.workDir, 'visual-workbench-capture-run.json')));
});

test('Visual Workbench inspect reports actionable manifest issue details', async () => {
  const workspace = await createWorkbenchWorkspace(validManifest({
    stories: [{
      ...validStory({ id: 'jam-room.extra-source' }),
      source: 'stories/jam-room.extra-source.json',
    }],
  }));

  const result = await inspectVisualWorkbenchManifest({
    workDir: workspace.workDir,
    sourceRef: workspace.sourceRef,
  });

  assert.equal(result.status, 'blocked');
  assert.deepEqual(result.manifest.blockers, ['story_required_field_missing']);
  assert.equal(result.manifest.issueDetails.length, 1);
  assert.deepEqual(result.manifest.issueDetails[0], {
    ...result.manifest.issueDetails[0],
    code: 'story_required_field_missing',
    path: ['stories', 0],
    field: 'source',
    storyIndex: 0,
    storyId: 'jam-room.extra-source',
    keys: ['source'],
  });
  assert.match(result.manifest.issueDetails[0]?.message ?? '', /source/);
  assert.equal(result.canRunWorkbenchCapture, false);
});

test('Visual Workbench inspect reports declared unsupported manifest schema version', async () => {
  const workspace = await createWorkbenchWorkspace({
    ...validManifest(),
    schemaVersion: 'ra-356.visual-coverage-manifest.v1',
  });

  const result = await inspectVisualWorkbenchManifest({
    workDir: workspace.workDir,
    sourceRef: workspace.sourceRef,
  });

  assert.equal(result.status, 'blocked');
  assert.equal(result.manifest.schemaVersion, 'ra-356.visual-coverage-manifest.v1');
  assert(result.manifest.blockers.includes('manifest_schema_unsupported'));
  assert.equal(result.canRunWorkbenchCapture, false);
  assert.equal(result.recommendedCapture, null);
});

test('Visual Workbench inspect can read a non-head source ref but marks capture as not currently runnable', async () => {
  const workspace = await createWorkbenchWorkspace(validManifest());
  await writeFile(path.join(workspace.workDir, 'later.txt'), 'later\n', 'utf8');
  execFileSync('git', ['add', '.'], { cwd: workspace.workDir, stdio: 'ignore' });
  execFileSync('git', ['commit', '-m', 'later source'], { cwd: workspace.workDir, stdio: 'ignore' });
  const laterRef = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: workspace.workDir, encoding: 'utf8' }).trim();

  const result = await inspectVisualWorkbenchManifest({
    workDir: workspace.workDir,
    sourceRef: workspace.sourceRef,
  });

  assert.equal(result.status, 'ready');
  assert.equal(result.source.resolvedSourceRef, workspace.sourceRef);
  assert.equal(result.source.headRef, laterRef);
  assert.equal(result.source.headMatchesSourceRef, false);
  assert.equal(result.canRunWorkbenchCapture, false);
  assert.equal(result.recommendedCapture?.sourceRef, workspace.sourceRef);
  assert(result.stage.handoff.includes('checkout_source_ref_before_capture_if_needed'));
});

test('Visual Workbench capture starts explicit workbench and captures full manifest artifacts only', async () => {
  const workspace = await createWorkbenchWorkspace(validManifest({
    stories: [
      validStory({
        id: 'jam-room.empty.mobile',
        feature: 'jam-room',
        widget: 'JamRoom',
        state: 'empty',
        viewports: [{ name: 'mobile', width: 390, height: 844 }],
        waitAfterLoadMs: 750,
      }),
      validStory({
        id: 'transport.playing',
        feature: 'transport',
        widget: 'TransportControls',
        state: 'playing',
        viewports: [
          { name: 'mobile', width: 390, height: 844 },
          { name: 'desktop', width: 1440, height: 900 },
        ],
      }),
    ],
  }));
  const outDir = await mkdtemp(path.join(os.tmpdir(), 'visual-workbench-out-'));
  const screenshotBytes = Buffer.from('fake-workbench-png');
  const gotoUrls: string[] = [];
  const viewportsSeen: unknown[] = [];
  const waitsSeen: number[] = [];
  let stopped = false;
  let startInput: unknown = null;

  const result = await runVisualWorkbenchCapture({
    workDir: workspace.workDir,
    sourceRef: workspace.sourceRef,
    baseUrl: 'http://127.0.0.1:43123',
    outDir,
    now: () => new Date('2026-06-07T10:00:00.000Z'),
    startWorkbench: async (input) => {
      startInput = input;
      return {
        stop: async () => {
          stopped = true;
        },
      };
    },
    launchBrowser: async () => ({
      newPage: async (options: unknown) => {
        viewportsSeen.push(options);
        return {
          goto: async (url: string) => {
            gotoUrls.push(url);
            return { status: () => 200 };
          },
          waitForTimeout: async (ms: number) => {
            waitsSeen.push(ms);
          },
          screenshot: async (options: { path: string }) => {
            await writeFile(options.path, screenshotBytes);
          },
        };
      },
      close: async () => {},
    } as any),
  });

  assert.equal(result.schemaVersion, VISUAL_WORKBENCH_CAPTURE_RUN_SCHEMA_VERSION);
  assert.equal(result.status, 'captured');
  assert.equal(result.capturedAt, '2026-06-07T10:00:00.000Z');
  assert.equal(result.stage.stageId, 'visual_workbench_capture');
  assert.equal(result.stage.mode, 'workspace_mutation');
  assert.equal(result.stage.sourceRef, workspace.sourceRef);
  assert.equal(result.stage.selection, 'full_manifest');
  assert.deepEqual(result.stage.selectionScope, { storyId: null, viewportNames: [] });
  assert.deepEqual(result.stage.allowedMutations, [outDir]);
  assert(result.stage.forbiddenMutations.includes('task verificationEvidence'));
  assert(result.stage.forbiddenMutations.includes('lifecycle state'));
  assert.equal(result.workbench.serveCommand, 'npm run visual-workbench');
  assert.equal(result.workbench.baseUrlEnv, 'VISUAL_WORKBENCH_BASE_URL');
  assert.equal(result.manifest.summary?.storyCount, 2);
  assert.deepEqual(result.manifest.summary?.features, ['jam-room', 'transport']);
  assert.equal(result.stories.length, 2);
  assert.equal(result.stories[1].viewports.length, 2);
  assert.equal(result.stories[0].viewports[0].screenshotSha256, `sha256:${createHash('sha256').update(screenshotBytes).digest('hex')}`);
  assert.equal(stopped, true);
  assert.deepEqual(startInput, {
    command: 'npm run visual-workbench',
    cwd: workspace.workDir,
    baseUrl: 'http://127.0.0.1:43123/',
    baseUrlEnv: 'VISUAL_WORKBENCH_BASE_URL',
    readinessPath: '/__visual/jam-room.empty.mobile',
    timeoutMs: 20_000,
  });
  assert.deepEqual(gotoUrls, [
    'http://127.0.0.1:43123/__visual/jam-room.empty.mobile',
    'http://127.0.0.1:43123/__visual/transport.playing',
    'http://127.0.0.1:43123/__visual/transport.playing',
  ]);
  assert.deepEqual(viewportsSeen, [
    { viewport: { width: 390, height: 844 } },
    { viewport: { width: 390, height: 844 } },
    { viewport: { width: 1440, height: 900 } },
  ]);
  assert.deepEqual(waitsSeen, [750, 500, 500]);
  assert.equal(result.workspaceMutationCheck.changed, false);
  assert.match(result.notes.join(' '), /does not write \.ralph\/plan\.json/);
  assert.match(result.notes.join(' '), /no fallback to app pages/i);

  const report = JSON.parse(await readFile(path.join(outDir, 'visual-workbench-capture-run.json'), 'utf8'));
  assert.equal(report.status, 'captured');
  assert.equal(report.stories.length, 2);
  assert.equal(report.output.viewerPath, path.join(outDir, 'index.html'));
  assert.equal(JSON.parse(formatVisualWorkbenchCaptureResult(result, 'json')).status, 'captured');
  assert.equal(JSON.parse(formatVisualWorkbenchCaptureResult(result, 'json', true)).schemaVersion, VISUAL_WORKBENCH_CAPTURE_RUN_SCHEMA_VERSION);
  assert.throws(() => formatVisualWorkbenchCaptureResult(result, 'text' as any), /Unsupported/);

  const viewer = await readFile(path.join(outDir, 'index.html'), 'utf8');
  assert.match(viewer, /Visual Workbench Capture/);
  assert.match(viewer, /transport\.playing/);
  assert.match(viewer, /screenshots\/transport\.playing\/desktop\.png/);
  assert.match(viewer, /Open raw capture report/);

  await rm(path.join(outDir, 'index.html'));
  const viewerResult = await renderVisualWorkbenchCaptureViewerFile({
    runPath: path.join(outDir, 'visual-workbench-capture-run.json'),
  });
  assert.equal(viewerResult.schemaVersion, VISUAL_WORKBENCH_CAPTURE_VIEWER_SCHEMA_VERSION);
  assert.equal(viewerResult.status, 'rendered');
  assert.equal(viewerResult.viewerPath, path.join(outDir, 'index.html'));
  assert.equal(JSON.parse(formatVisualWorkbenchCaptureViewerResult(viewerResult, true)).status, 'rendered');
  assert.match(await readFile(path.join(outDir, 'index.html'), 'utf8'), /transport\.playing/);

  const manifestSnapshot = JSON.parse(await readFile(path.join(outDir, 'manifest.snapshot.json'), 'utf8'));
  assert.equal(manifestSnapshot.schemaVersion, 'ra-355.visual-coverage-manifest.v0');
  await assert.rejects(stat(path.join(workspace.workDir, '.ralph')));
});

test('Visual Workbench capture can capture one selected story viewport without falling back to full manifest', async () => {
  const workspace = await createWorkbenchWorkspace(validManifest({
    stories: [
      validStory({
        id: 'jam-room.empty.mobile',
        feature: 'jam-room',
        widget: 'JamRoom',
        state: 'empty',
        viewports: [{ name: 'mobile', width: 390, height: 844 }],
      }),
      validStory({
        id: 'transport.playing',
        feature: 'transport',
        widget: 'TransportControls',
        state: 'playing',
        waitAfterLoadMs: 825,
        viewports: [
          { name: 'mobile', width: 390, height: 844 },
          { name: 'desktop', width: 1440, height: 900 },
        ],
      }),
    ],
  }));
  const outDir = await mkdtemp(path.join(os.tmpdir(), 'visual-workbench-selected-'));
  const gotoUrls: string[] = [];
  const viewportsSeen: unknown[] = [];
  const waitsSeen: number[] = [];
  let startInput: unknown = null;

  const result = await runVisualWorkbenchCapture({
    workDir: workspace.workDir,
    sourceRef: workspace.sourceRef,
    baseUrl: 'http://127.0.0.1:43133',
    outDir,
    selection: 'story_viewports',
    storyId: 'transport.playing',
    viewportNames: ['desktop'],
    startWorkbench: async (input) => {
      startInput = input;
      return { stop: async () => {} };
    },
    launchBrowser: async () => ({
      newPage: async (options: unknown) => {
        viewportsSeen.push(options);
        return {
          goto: async (url: string) => {
            gotoUrls.push(url);
            return { status: () => 200 };
          },
          waitForTimeout: async (ms: number) => {
            waitsSeen.push(ms);
          },
          screenshot: async (options: { path: string }) => {
            await writeFile(options.path, Buffer.from('selected-workbench-png'));
          },
        };
      },
      close: async () => {},
    } as any),
  });

  assert.equal(result.status, 'captured');
  assert.equal(result.stage.selection, 'story_viewports');
  assert.deepEqual(result.stage.selectionScope, {
    storyId: 'transport.playing',
    viewportNames: ['desktop'],
  });
  assert.equal(result.manifest.summary?.storyCount, 2);
  assert.equal(result.stories.length, 1);
  assert.equal(result.stories[0].storyId, 'transport.playing');
  assert.deepEqual(result.stories[0].viewports.map((viewport) => viewport.name), ['desktop']);
  assert.deepEqual(startInput, {
    command: 'npm run visual-workbench',
    cwd: workspace.workDir,
    baseUrl: 'http://127.0.0.1:43133/',
    baseUrlEnv: 'VISUAL_WORKBENCH_BASE_URL',
    readinessPath: '/__visual/transport.playing',
    timeoutMs: 20_000,
  });
  assert.deepEqual(gotoUrls, ['http://127.0.0.1:43133/__visual/transport.playing']);
  assert.deepEqual(viewportsSeen, [{ viewport: { width: 1440, height: 900 } }]);
  assert.deepEqual(waitsSeen, [825]);

  const report = JSON.parse(await readFile(path.join(outDir, 'visual-workbench-capture-run.json'), 'utf8'));
  assert.equal(report.stage.selection, 'story_viewports');
  assert.equal(report.stories.length, 1);
  assert.equal(report.stories[0].storyId, 'transport.playing');
  assert.deepEqual(report.stories[0].viewports.map((viewport: { name: string }) => viewport.name), ['desktop']);
});

test('Visual Workbench selected capture writes blocked reports for missing story or viewport before starting workbench', async () => {
  const workspace = await createWorkbenchWorkspace(validManifest({
    stories: [
      validStory({
        id: 'transport.playing',
        viewports: [{ name: 'desktop', width: 1440, height: 900 }],
      }),
    ],
  }));
  let startCalled = false;

  const missingStoryOutDir = await mkdtemp(path.join(os.tmpdir(), 'visual-workbench-missing-story-'));
  const missingStory = await runVisualWorkbenchCapture({
    workDir: workspace.workDir,
    sourceRef: workspace.sourceRef,
    baseUrl: 'http://127.0.0.1:43134',
    outDir: missingStoryOutDir,
    selection: 'story_viewports',
    storyId: 'does-not-exist',
    viewportNames: ['desktop'],
    startWorkbench: async () => {
      startCalled = true;
      return { stop: async () => {} };
    },
  });

  assert.equal(missingStory.status, 'blocked');
  assert.equal(missingStory.error?.code, 'selection_story_not_found');
  assert.equal(missingStory.stories.length, 0);
  assert.equal(startCalled, false);
  assert.equal(JSON.parse(await readFile(path.join(missingStoryOutDir, 'visual-workbench-capture-run.json'), 'utf8')).error.code, 'selection_story_not_found');

  const missingViewportOutDir = await mkdtemp(path.join(os.tmpdir(), 'visual-workbench-missing-viewport-'));
  const missingViewport = await runVisualWorkbenchCapture({
    workDir: workspace.workDir,
    sourceRef: workspace.sourceRef,
    baseUrl: 'http://127.0.0.1:43135',
    outDir: missingViewportOutDir,
    selection: 'story_viewports',
    storyId: 'transport.playing',
    viewportNames: ['mobile'],
    startWorkbench: async () => {
      startCalled = true;
      return { stop: async () => {} };
    },
  });

  assert.equal(missingViewport.status, 'blocked');
  assert.equal(missingViewport.error?.code, 'selection_viewport_not_found');
  assert.equal(missingViewport.stories.length, 0);
  assert.equal(startCalled, false);
  assert.equal(JSON.parse(await readFile(path.join(missingViewportOutDir, 'visual-workbench-capture-run.json'), 'utf8')).error.code, 'selection_viewport_not_found');
});

test('Visual Workbench selected capture rejects ambiguous selection options without fallback', async () => {
  const workspace = await createWorkbenchWorkspace(validManifest());
  const missingOutDir = await mkdtemp(path.join(os.tmpdir(), 'visual-workbench-missing-selection-'));
  let startCalled = false;

  const missingSelection = await runVisualWorkbenchCapture({
    workDir: workspace.workDir,
    sourceRef: workspace.sourceRef,
    baseUrl: 'http://127.0.0.1:43136',
    outDir: missingOutDir,
    selection: 'story_viewports',
    storyId: 'jam-room.empty.mobile',
    startWorkbench: async () => {
      startCalled = true;
      return { stop: async () => {} };
    },
  });

  assert.equal(missingSelection.status, 'blocked');
  assert.equal(missingSelection.error?.code, 'selection_invalid');
  assert.match(missingSelection.error?.message ?? '', /--viewport/);
  assert.equal(startCalled, false);

  const fullManifestOutDir = await mkdtemp(path.join(os.tmpdir(), 'visual-workbench-full-with-story-'));
  const fullManifestWithStory = await runVisualWorkbenchCapture({
    workDir: workspace.workDir,
    sourceRef: workspace.sourceRef,
    baseUrl: 'http://127.0.0.1:43137',
    outDir: fullManifestOutDir,
    selection: 'full_manifest',
    storyId: 'jam-room.empty.mobile',
    startWorkbench: async () => {
      startCalled = true;
      return { stop: async () => {} };
    },
  });

  assert.equal(fullManifestWithStory.status, 'blocked');
  assert.equal(fullManifestWithStory.error?.code, 'selection_invalid');
  assert.match(fullManifestWithStory.error?.message ?? '', /story_viewports/);
  assert.equal(startCalled, false);

  const duplicateViewportOutDir = await mkdtemp(path.join(os.tmpdir(), 'visual-workbench-duplicate-viewport-'));
  const duplicateViewport = await runVisualWorkbenchCapture({
    workDir: workspace.workDir,
    sourceRef: workspace.sourceRef,
    baseUrl: 'http://127.0.0.1:43138',
    outDir: duplicateViewportOutDir,
    selection: 'story_viewports',
    storyId: 'jam-room.empty.mobile',
    viewportNames: ['mobile', 'mobile'],
    startWorkbench: async () => {
      startCalled = true;
      return { stop: async () => {} };
    },
  });

  assert.equal(duplicateViewport.status, 'blocked');
  assert.equal(duplicateViewport.error?.code, 'selection_invalid');
  assert.match(duplicateViewport.error?.message ?? '', /repeats viewport/);
  assert.equal(startCalled, false);
});

test('Visual Workbench capture viewer escapes story metadata', async () => {
  const workspace = await createWorkbenchWorkspace(validManifest({
    stories: [
      validStory({
        id: 'transport.safe',
        title: 'Transport <script>alert(1)</script>',
        claim: 'Shows <playing> & release controls.',
      }),
    ],
  }));
  const outDir = await mkdtemp(path.join(os.tmpdir(), 'visual-workbench-viewer-safe-'));

  await runVisualWorkbenchCapture({
    workDir: workspace.workDir,
    sourceRef: workspace.sourceRef,
    baseUrl: 'http://127.0.0.1:43131',
    outDir,
    startWorkbench: async () => ({ stop: async () => {} }),
    launchBrowser: async () => ({
      newPage: async () => ({
        goto: async () => ({ status: () => 200 }),
        waitForTimeout: async () => {},
        screenshot: async (options: { path: string }) => {
          await writeFile(options.path, Buffer.from('safe-viewer-png'));
        },
      }),
      close: async () => {},
    } as any),
  });

  const viewer = await readFile(path.join(outDir, 'index.html'), 'utf8');
  assert.doesNotMatch(viewer, /<script>alert\(1\)<\/script>/);
  assert.match(viewer, /Transport &lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(viewer, /Shows &lt;playing&gt; &amp; release controls\./);
});

test('Visual Workbench capture blocks invalid manifests before starting workbench', async () => {
  const workspace = await createWorkbenchWorkspace(validManifest({
    stories: [{
      ...validStory({ id: 'jam-room.extra-source' }),
      source: 'stories/jam-room.extra-source.json',
    }],
  }));
  const outDir = await mkdtemp(path.join(os.tmpdir(), 'visual-workbench-invalid-'));
  let startCalled = false;

  const result = await runVisualWorkbenchCapture({
    workDir: workspace.workDir,
    sourceRef: workspace.sourceRef,
    baseUrl: 'http://127.0.0.1:43124',
    outDir,
    startWorkbench: async () => {
      startCalled = true;
      return { stop: async () => {} };
    },
  });

  assert.equal(result.status, 'blocked');
  assert.equal(result.error, null);
  assert.deepEqual(result.manifest.blockers, ['story_required_field_missing']);
  assert.equal(result.manifest.issueDetails[0]?.storyId, 'jam-room.extra-source');
  assert.deepEqual(result.manifest.issueDetails[0]?.keys, ['source']);
  assert.equal(result.stories.length, 0);
  assert.equal(startCalled, false);
  assert.equal((await readdir(outDir)).includes('visual-workbench-capture-run.json'), true);
  const report = JSON.parse(await readFile(path.join(outDir, 'visual-workbench-capture-run.json'), 'utf8'));
  assert.equal(report.manifest.issueDetails[0]?.storyId, 'jam-room.extra-source');
});

test('Visual Workbench capture reports story navigation failure without page fallback', async () => {
  const workspace = await createWorkbenchWorkspace(validManifest({
    stories: [
      validStory({
        id: 'jam-room.missing',
        renderPath: '/__visual/jam-room.missing',
      }),
    ],
  }));
  const outDir = await mkdtemp(path.join(os.tmpdir(), 'visual-workbench-nav-'));
  const gotoUrls: string[] = [];

  const result = await runVisualWorkbenchCapture({
    workDir: workspace.workDir,
    sourceRef: workspace.sourceRef,
    baseUrl: 'http://127.0.0.1:43125',
    outDir,
    startWorkbench: async () => ({ stop: async () => {} }),
    launchBrowser: async () => ({
      newPage: async () => ({
        goto: async (url: string) => {
          gotoUrls.push(url);
          return { status: () => 404 };
        },
        waitForTimeout: async () => {},
        screenshot: async () => {
          throw new Error('screenshot should not run for 404');
        },
      }),
      close: async () => {},
    } as any),
  });

  assert.equal(result.status, 'failed');
  assert.equal(result.stories[0].route, '/__visual/jam-room.missing');
  assert.equal(result.stories[0].viewports[0].status, 'navigation_failed');
  assert.equal(result.stories[0].viewports[0].screenshotPath, null);
  assert.equal(result.stories[0].viewports[0].error?.code, 'navigation_failed');
  assert.deepEqual(gotoUrls, ['http://127.0.0.1:43125/__visual/jam-room.missing']);
});

test('Visual Workbench capture records bounded start diagnostics when serveCommand exits early', async () => {
  const failingCommand = 'API_KEY=command-secret node -e "process.stdout.write(\'x\'.repeat(2105) + \' token=stdout-secret\'); process.stderr.write(\'listen EPERM 127.0.0.1:43131 Bearer stderrsecret\'); process.exit(1)"';
  const workspace = await createWorkbenchWorkspace(validManifest({
    serveCommand: failingCommand,
  }));
  const outDir = await mkdtemp(path.join(os.tmpdir(), 'visual-workbench-start-failed-'));

  const result = await runVisualWorkbenchCapture({
    workDir: workspace.workDir,
    sourceRef: workspace.sourceRef,
    baseUrl: 'http://127.0.0.1:43131',
    outDir,
    startTimeoutMs: 5_000,
  });

  assert.equal(result.status, 'workbench_start_failed');
  assert.equal(result.error?.code, 'workbench_start_failed');
  assert.match(result.error?.message ?? '', /Workbench command exited before becoming reachable/);
  assert.match(result.workbench.startDiagnostics?.command ?? '', /API_KEY=<redacted>/);
  assert.doesNotMatch(result.workbench.startDiagnostics?.command ?? '', /command-secret/);
  assert.equal(result.workbench.startDiagnostics?.cwd, workspace.workDir);
  assert.equal(result.workbench.startDiagnostics?.baseUrl, 'http://127.0.0.1:43131/');
  assert.equal(result.workbench.startDiagnostics?.readinessPath, '/__visual/jam-room.empty.mobile');
  assert.equal(result.workbench.startDiagnostics?.timeoutMs, 5_000);
  assert.equal(result.workbench.startDiagnostics?.exited, true);
  assert.equal(result.workbench.startDiagnostics?.exitCode, 1);
  assert.equal(result.workbench.startDiagnostics?.signal, null);
  assert((result.workbench.startDiagnostics?.stdoutTail.length ?? 0) <= 2_000);
  assert.match(result.workbench.startDiagnostics?.stdoutTail ?? '', /token=<redacted>/);
  assert.doesNotMatch(result.workbench.startDiagnostics?.stdoutTail ?? '', /stdout-secret/);
  assert.match(result.workbench.startDiagnostics?.stderrTail ?? '', /listen EPERM 127.0.0.1:43131 Bearer <redacted>/);
  assert.doesNotMatch(result.workbench.startDiagnostics?.stderrTail ?? '', /stderrsecret/);
  assert.equal(result.workbench.startDiagnostics?.outputLimitChars, 2_000);

  const report = JSON.parse(await readFile(path.join(outDir, 'visual-workbench-capture-run.json'), 'utf8'));
  assert.equal(report.status, 'workbench_start_failed');
  assert.match(report.workbench.startDiagnostics.stderrTail, /Bearer <redacted>/);
});

test('Visual Workbench capture requires experiment output outside project source', async () => {
  const workspace = await createWorkbenchWorkspace(validManifest());

  await assert.rejects(() => runVisualWorkbenchCapture({
    workDir: workspace.workDir,
    sourceRef: workspace.sourceRef,
    baseUrl: 'http://127.0.0.1:43126',
    outDir: workspace.workDir,
  }), /outDir must be outside workDir/);

  await assert.rejects(() => runVisualWorkbenchCapture({
    workDir: workspace.workDir,
    sourceRef: workspace.sourceRef,
    baseUrl: 'http://127.0.0.1:43126',
    outDir: path.join(workspace.workDir, 'work', 'experiments'),
  }), /outDir must be outside workDir/);
});

test('Visual Workbench capture blocks dirty source workspaces before starting workbench', async () => {
  const workspace = await createWorkbenchWorkspace(validManifest());
  await writeFile(path.join(workspace.workDir, 'src-dirty.txt'), 'dirty\n', 'utf8');
  const outDir = await mkdtemp(path.join(os.tmpdir(), 'visual-workbench-dirty-'));
  let startCalled = false;

  const result = await runVisualWorkbenchCapture({
    workDir: workspace.workDir,
    sourceRef: workspace.sourceRef,
    baseUrl: 'http://127.0.0.1:43127',
    outDir,
    startWorkbench: async () => {
      startCalled = true;
      return { stop: async () => {} };
    },
  });

  assert.equal(result.status, 'blocked');
  assert.equal(result.error?.code, 'workspace_dirty');
  assert.equal(result.workspaceMutationCheck.changed, false);
  assert.equal(result.workspaceMutationCheck.beforeStatusPreview.some((line) => line.includes('src-dirty.txt')), true);
  assert.equal(startCalled, false);
});

test('Visual Workbench capture allows runner-managed replayable dirty entries without source repair', async () => {
  const workspace = await createWorkbenchWorkspace(validManifest());
  await writeFile(path.join(workspace.workDir, 'arena-start.sh'), '#!/usr/bin/env bash\nnode server.mjs\n', 'utf8');
  execFileSync('git', ['add', 'arena-start.sh'], { cwd: workspace.workDir, stdio: 'ignore' });
  execFileSync('git', ['commit', '-m', 'add bootstrap'], { cwd: workspace.workDir, stdio: 'ignore' });
  const sourceRef = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: workspace.workDir, encoding: 'utf8' }).trim();
  await chmod(path.join(workspace.workDir, 'arena-start.sh'), 0o755);
  await writeFile(path.join(workspace.workDir, 'CLAUDE.md'), 'runner prompt stamp\n', 'utf8');
  await writeFile(path.join(workspace.workDir, 'spec.md'), 'runner spec snapshot\n', 'utf8');
  await mkdir(path.join(workspace.workDir, 'specs'), { recursive: true });
  await writeFile(path.join(workspace.workDir, 'specs', '001-initial.md'), 'runner spec part\n', 'utf8');
  await mkdir(path.join(workspace.workDir, '.arena'), { recursive: true });
  await writeFile(path.join(workspace.workDir, '.arena', 'platform.md'), 'runner platform stamp\n', 'utf8');
  const outDir = await mkdtemp(path.join(os.tmpdir(), 'visual-workbench-replayable-dirty-'));
  let startCalled = false;

  const result = await runVisualWorkbenchCapture({
    workDir: workspace.workDir,
    sourceRef,
    baseUrl: 'http://127.0.0.1:43132',
    outDir,
    startWorkbench: async () => {
      startCalled = true;
      return { stop: async () => {} };
    },
    launchBrowser: async () => ({
      newPage: async () => ({
        goto: async () => ({ status: () => 200 }),
        waitForTimeout: async () => {},
        screenshot: async (options: { path: string }) => {
          await writeFile(options.path, 'replayable-dirty-png');
        },
      }),
      close: async () => {},
    } as any),
  });

  assert.equal(startCalled, true);
  assert.equal(result.status, 'captured');
  assert.equal(result.error, null);
  assert.equal(result.workspaceMutationCheck.changed, false);
  assert.equal(result.workspaceMutationCheck.beforeStatusPreview.some((line) => line.includes('CLAUDE.md')), true);
  assert.equal(result.workspaceMutationCheck.beforeStatusPreview.some((line) => line.includes('arena-start.sh')), true);
});

test('Visual Workbench capture marks workspace mutations as failed experiment status', async () => {
  const workspace = await createWorkbenchWorkspace(validManifest());
  const outDir = await mkdtemp(path.join(os.tmpdir(), 'visual-workbench-mutated-'));

  const result = await runVisualWorkbenchCapture({
    workDir: workspace.workDir,
    sourceRef: workspace.sourceRef,
    baseUrl: 'http://127.0.0.1:43128',
    outDir,
    startWorkbench: async () => ({
      stop: async () => {
        await writeFile(path.join(workspace.workDir, 'mutation.txt'), 'mutation\n', 'utf8');
      },
    }),
    launchBrowser: async () => ({
      newPage: async () => ({
        goto: async () => ({ status: () => 200 }),
        waitForTimeout: async () => {},
        screenshot: async (options: { path: string }) => {
          await writeFile(options.path, 'mutated-png');
        },
      }),
      close: async () => {},
    } as any),
  });

  assert.equal(result.status, 'workspace_mutation_detected');
  assert.equal(result.error?.code, 'workspace_mutation_detected');
  assert.equal(result.workspaceMutationCheck.changed, true);
  assert.equal(result.workspaceMutationCheck.afterStatusPreview.some((line) => line.includes('mutation.txt')), true);
});

test('Visual Workbench manifest contract blocks story paths outside storyRoutePattern', async () => {
  const workspace = await createWorkbenchWorkspace(validManifest({
    stories: [
      validStory({
        id: 'jam-room.page-fallback',
        renderPath: '/',
      }),
    ],
  }));
  const outDir = await mkdtemp(path.join(os.tmpdir(), 'visual-workbench-pattern-'));

  const result = await runVisualWorkbenchCapture({
    workDir: workspace.workDir,
    sourceRef: workspace.sourceRef,
    baseUrl: 'http://127.0.0.1:43129',
    outDir,
    startWorkbench: async () => {
      throw new Error('workbench should not start');
    },
  });

  assert.equal(result.status, 'blocked');
  assert.deepEqual(result.manifest.blockers, ['story_route_pattern_mismatch']);
});

async function createWorkbenchWorkspace(manifest: Record<string, unknown>) {
  const workDir = await mkdtemp(path.join(os.tmpdir(), 'visual-workbench-workspace-'));
  await writeJson(path.join(workDir, 'visual-workbench', 'manifest.json'), manifest);
  execFileSync('git', ['init'], { cwd: workDir, stdio: 'ignore' });
  execFileSync('git', ['checkout', '-B', 'main'], { cwd: workDir, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.email', 'ralph-test@example.com'], { cwd: workDir });
  execFileSync('git', ['config', 'user.name', 'Ralph Test'], { cwd: workDir });
  execFileSync('git', ['add', '.'], { cwd: workDir, stdio: 'ignore' });
  execFileSync('git', ['commit', '-m', 'visual workbench'], { cwd: workDir, stdio: 'ignore' });
  const sourceRef = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: workDir, encoding: 'utf8' }).trim();
  return { workDir, sourceRef };
}

async function writeJson(filePath: string, value: unknown) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(value, null, 2), 'utf8');
}

function validManifest(input: {
  stories?: Record<string, unknown>[];
  serveCommand?: string;
} = {}) {
  return {
    schemaVersion: 'ra-355.visual-coverage-manifest.v0',
    projectClass: 'ordinary_web',
    workbench: {
      serveCommand: input.serveCommand ?? 'npm run visual-workbench',
      baseUrlEnv: 'VISUAL_WORKBENCH_BASE_URL',
      storyRoutePattern: '/__visual/:storyId',
    },
    coveragePolicy: {
      mode: 'strict_canary',
      selectionDefault: 'full_manifest',
      simplificationRequiresEvidence: true,
    },
    stories: input.stories ?? [validStory({ id: 'jam-room.empty.mobile' })],
  };
}

function validStory(input: {
  id: string;
  title?: string;
  feature?: string;
  widget?: string;
  state?: string;
  claim?: string;
  renderPath?: string;
  viewports?: Array<{ name: string; width: number; height: number }>;
  waitAfterLoadMs?: number;
}) {
  return {
    id: input.id,
    title: input.title ?? input.id,
    kind: 'feature',
    feature: input.feature ?? 'jam-room',
    widget: input.widget ?? 'JamRoom',
    state: input.state ?? 'empty',
    claim: input.claim ?? 'The isolated story renders.',
    render: {
      type: 'workbench_route',
      path: input.renderPath ?? `/__visual/${input.id}`,
    },
    mockState: {
      name: input.id,
    },
    viewports: input.viewports ?? [{ name: 'mobile', width: 390, height: 844 }],
    waitAfterLoadMs: input.waitAfterLoadMs,
  };
}
