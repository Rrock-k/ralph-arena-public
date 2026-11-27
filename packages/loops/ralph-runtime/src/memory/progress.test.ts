import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { ProgressTracker } from './progress.js';

test('progress tracker emits agents-arena progress.json snapshot', async () => {
  const workDir = mkdtempSync(path.join(tmpdir(), 'ralph-progress-'));
  const tracker = new ProgressTracker(workDir, 'demo-project');

  await tracker.load();
  tracker.addFeature({
    id: 'task-001',
    category: 'task',
    displayTitle: 'Build API shell',
    description: 'Build API\nKeep endpoint names stable',
    status: 'pending',
  });
  tracker.addFeature({
    id: 'task-002',
    category: 'task',
    description: 'Ship UI',
    status: 'pending',
  });
  tracker.setCurrentTask('task-001');
  tracker.updateFeature('task-001', { status: 'in_progress' });
  tracker.setState('coding');
  tracker.incrementIteration();

  await tracker.save();

  const progressPath = path.join(workDir, '.arena', 'progress.json');
  const snapshot = JSON.parse(readFileSync(progressPath, 'utf-8'));

  assert.equal(snapshot.state, 'coding');
  assert.equal(snapshot.workStage, undefined);
  assert.equal(snapshot.iteration, 1);
  assert.equal(snapshot.message, 'coding: Build API shell');
  assert.deepEqual(snapshot.steps, [
    { id: 'task-001', label: 'Build API shell', description: 'Build API\nKeep endpoint names stable', status: 'in_progress' },
    { id: 'task-002', label: 'Ship UI', status: 'pending' },
  ]);
  const internalProgress = JSON.parse(readFileSync(path.join(workDir, '.ralph', 'ralph-progress.json'), 'utf-8'));
  assert.equal(internalProgress.currentTaskId, undefined);
  assert.equal(internalProgress.metrics.featuresCompleted, undefined);
  assert.equal(internalProgress.metrics.featuresTotal, undefined);
  assert.equal(existsSync(path.join(workDir, '.ralph', 'ralph-features.json')), false);
});

test('progress tracker exposes planner and controller work stage hints', async () => {
  const workDir = mkdtempSync(path.join(tmpdir(), 'ralph-progress-stage-'));
  const tracker = new ProgressTracker(workDir, 'demo-project');
  const progressPath = path.join(workDir, '.arena', 'progress.json');

  await tracker.load();
  tracker.setState('planning');
  await tracker.flushNow();
  let snapshot = JSON.parse(readFileSync(progressPath, 'utf-8'));
  assert.equal(snapshot.state, 'planning');
  assert.equal(snapshot.workStage, 'planner');

  tracker.setState('controlling');
  await tracker.flushNow();
  snapshot = JSON.parse(readFileSync(progressPath, 'utf-8'));
  assert.equal(snapshot.state, 'coding');
  assert.equal(snapshot.workStage, 'controller');
});

test('progress tracker carries safe accepted diff refs on public steps', async () => {
  const workDir = mkdtempSync(path.join(tmpdir(), 'ralph-progress-refs-'));
  const tracker = new ProgressTracker(workDir, 'demo-project');

  await tracker.load();
  tracker.addFeature({
    id: 'task-001',
    category: 'task',
    displayTitle: 'Fix checkout',
    description: 'Fix checkout',
    status: 'pending',
    feedbackItemRefs: [{
      itemId: 'BUG-006',
      diffItemId: 'DIFF-003-BUG-006',
      targetType: 'feedback',
      targetId: 'BUG-006',
      specHash: 'sha256:must-not-leak',
      sourceEvidence: [{
        sourceRef: 'SRC-001',
        quote: 'raw quote must not leak',
        intent: 'normalized intent must not leak',
      }],
    }],
  });
  await tracker.flushNow();

  const progressPath = path.join(workDir, '.arena', 'progress.json');
  const snapshot = JSON.parse(readFileSync(progressPath, 'utf-8'));

  assert.deepEqual(snapshot.steps, [{
    id: 'task-001',
    label: 'Fix checkout',
    status: 'pending',
    feedbackItemRefs: [{
      itemId: 'BUG-006',
      diffItemId: 'DIFF-003-BUG-006',
      targetType: 'feedback',
      targetId: 'BUG-006',
    }],
  }]);
  assert.doesNotMatch(JSON.stringify(snapshot), /sha256:must-not-leak/);
  assert.doesNotMatch(JSON.stringify(snapshot), /raw quote must not leak/);
  assert.doesNotMatch(JSON.stringify(snapshot), /normalized intent must not leak/);
});

test('progress tracker keeps generic post-deploy smoke out of screenshot proof evidence', async () => {
  const workDir = mkdtempSync(path.join(tmpdir(), 'ralph-progress-proof-'));
  const tracker = new ProgressTracker(workDir, 'demo-project');

  await tracker.load();
  tracker.syncFeatures([{
    id: 'task-001',
    category: 'task',
    displayTitle: 'Fix responsive checkout',
    description: 'Fix responsive checkout',
    status: 'completed',
    proofExpectations: [{
      kind: 'before_after_screenshot',
      reason: 'ordinary_web_ui_ux_task',
      source: 'projectConfig.techStack.web+task.requiredRolePasses.ux',
    }],
    verificationEvidence: [{
      kind: 'post_deploy_smoke',
      ref: 'verification:post-deploy',
      result: 'pass',
      taskId: 'task-001',
      observedAt: '2026-06-02T10:00:00.000Z',
      summary: 'Smoke: 2 pages checked, 2 OK | Screenshots: .ralph/screenshots',
      artifactPath: '.ralph/screenshots',
      recordedBy: 'executor',
    }],
  }]);
  await tracker.flushNow();

  const snapshot = JSON.parse(readFileSync(path.join(workDir, '.arena', 'progress.json'), 'utf-8'));
  assert.deepEqual(snapshot.steps[0].proofExpectations, [{
    kind: 'before_after_screenshot',
    reason: 'ordinary_web_ui_ux_task',
    source: 'projectConfig.techStack.web+task.requiredRolePasses.ux',
    status: 'missing',
    missingEvidence: ['before_screenshot', 'after_screenshot'],
  }]);
});

test('progress tracker does not treat after-only smoke as after screenshot proof', async () => {
  const workDir = mkdtempSync(path.join(tmpdir(), 'ralph-progress-proof-after-only-'));
  const tracker = new ProgressTracker(workDir, 'demo-project');

  await tracker.load();
  tracker.syncFeatures([{
    id: 'task-001',
    category: 'task',
    displayTitle: 'Fix responsive checkout',
    description: 'Fix responsive checkout',
    status: 'completed',
    proofExpectations: [{
      kind: 'before_after_screenshot',
      reason: 'ordinary_web_ui_ux_task',
      source: 'projectConfig.techStack.web+task.requiredRolePasses.ux',
    }],
    verificationEvidence: [{
      kind: 'screenshot',
      ref: 'screenshot-proof:before',
      result: 'pass',
      taskId: 'task-001',
      observedAt: '2026-06-02T10:00:00.000Z',
      summary: 'Before screenshot proof captured for task-001.',
      artifactPath: 'assets/proof/task-001/before.png',
      recordedBy: 'executor',
      screenshotProof: {
        expectationKind: 'before_after_screenshot',
        role: 'before',
      },
    }, {
      kind: 'post_deploy_smoke',
      ref: 'verification:post-deploy',
      result: 'pass',
      taskId: 'task-001',
      observedAt: '2026-06-02T10:05:00.000Z',
      summary: 'Smoke: 2 pages checked, 2 OK | Screenshots: .ralph/screenshots',
      artifactPath: '.ralph/screenshots',
      recordedBy: 'executor',
      screenshotProof: {
        expectationKind: 'before_after_screenshot',
        role: 'after_only',
      },
    }],
  }]);
  await tracker.flushNow();

  const snapshot = JSON.parse(readFileSync(path.join(workDir, '.arena', 'progress.json'), 'utf-8'));
  assert.equal(snapshot.steps[0].proofExpectations[0].status, 'partial');
  assert.deepEqual(snapshot.steps[0].proofExpectations[0].missingEvidence, ['after_screenshot']);
});

test('progress tracker projects satisfied before/after screenshot proof evidence', async () => {
  const workDir = mkdtempSync(path.join(tmpdir(), 'ralph-progress-proof-satisfied-'));
  const tracker = new ProgressTracker(workDir, 'demo-project');

  await tracker.load();
  tracker.syncFeatures([{
    id: 'task-001',
    category: 'task',
    displayTitle: 'Fix responsive checkout',
    description: 'Fix responsive checkout',
    status: 'completed',
    proofExpectations: [{
      kind: 'before_after_screenshot',
      reason: 'ordinary_web_ui_ux_task',
      source: 'projectConfig.techStack.web+task.requiredRolePasses.ux',
    }],
    verificationEvidence: [{
      kind: 'screenshot',
      ref: 'screenshot-proof:before',
      result: 'pass',
      taskId: 'task-001',
      observedAt: '2026-06-02T10:00:00.000Z',
      summary: 'Before screenshot proof captured for task-001.',
      artifactPath: 'assets/proof/task-001/before.png',
      artifactSha256: 'sha256-before',
      recordedBy: 'executor',
      screenshotProof: {
        expectationKind: 'before_after_screenshot',
        role: 'before',
      },
      target: {
        route: '/checkout',
        viewport: { width: 1280, height: 800 },
        claim: 'checkout failure is visible before the fix',
      },
    }, {
      kind: 'screenshot',
      ref: 'screenshot-proof:after',
      result: 'pass',
      taskId: 'task-001',
      observedAt: '2026-06-02T10:05:00.000Z',
      summary: 'After screenshot proof captured for task-001.',
      artifactPath: 'assets/proof/task-001/after.png',
      artifactSha256: 'sha256-after',
      recordedBy: 'executor',
      screenshotProof: {
        expectationKind: 'before_after_screenshot',
        role: 'after',
      },
      target: {
        route: '/checkout',
        viewport: { width: 1280, height: 800 },
        claim: 'checkout completes after the fix',
      },
    }],
  }]);
  await tracker.flushNow();

  const snapshot = JSON.parse(readFileSync(path.join(workDir, '.arena', 'progress.json'), 'utf-8'));
  assert.equal(snapshot.steps[0].proofExpectations[0].status, 'satisfied');
  assert.deepEqual(snapshot.steps[0].proofExpectations[0].missingEvidence, undefined);
  assert.deepEqual(
    snapshot.steps[0].proofExpectations[0].evidence.map((row: { role: string; artifactPath: string; target?: unknown }) => ({
      role: row.role,
      artifactPath: row.artifactPath,
      target: row.target,
    })),
    [
      {
        role: 'before',
        artifactPath: 'assets/proof/task-001/before.png',
        target: {
          route: '/checkout',
          viewport: { width: 1280, height: 800 },
          claim: 'checkout failure is visible before the fix',
        },
      },
      {
        role: 'after',
        artifactPath: 'assets/proof/task-001/after.png',
        target: {
          route: '/checkout',
          viewport: { width: 1280, height: 800 },
          claim: 'checkout completes after the fix',
        },
      },
    ],
  );
});

test('progress tracker projects visual workbench evidence without raw artifact paths', async () => {
  const workDir = mkdtempSync(path.join(tmpdir(), 'ralph-progress-visual-evidence-'));
  const tracker = new ProgressTracker(workDir, 'demo-project');

  await tracker.load();
  tracker.syncFeatures([{
    id: 'task-001',
    category: 'task',
    displayTitle: 'Fix synth pad visual state',
    description: 'Fix synth pad visual state',
    status: 'completed',
    feedbackItemRefs: [{
      itemId: 'BUG-006',
      diffItemId: 'DIFF-003-BUG-006',
      targetType: 'feedback',
      targetId: 'BUG-006',
    }],
    verificationEvidence: [{
      kind: 'screenshot',
      ref: 'visual-workbench-capture:synth-pad.playing.desktop:desktop:aaaaaaaaaaaa',
      result: 'inconclusive',
      taskId: 'task-001',
      observedAt: '2026-06-07T09:00:00.000Z',
      summary: 'Visual Workbench story synth-pad.playing.desktop captured at desktop.',
      feedbackItemIds: ['BUG-006'],
      diffItemIds: ['DIFF-003-BUG-006'],
      artifactPath: '.ralph/visual-workbench/synth-pad.playing.desktop/desktop/aaaaaaaaaaaa.png',
      artifactSha256: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      recordedBy: 'agent',
      target: {
        route: '/visual-workbench/synth-pad.playing.desktop',
        viewport: { width: 1280, height: 800 },
        claim: 'synth pad shows the active playing state',
        state: 'playing',
      },
    }, {
      kind: 'manual_note',
      ref: 'visual-workbench-assessment:manual_note:synth-pad.playing.desktop:desktop:aaaaaaaaaaaa:bbbbbbbbbbbb',
      result: 'pass',
      taskId: 'task-001',
      observedAt: '2026-06-07T09:01:00.000Z',
      summary: 'Manual Visual Workbench assessment (pass): active state is visible.',
      feedbackItemIds: ['BUG-006'],
      diffItemIds: ['DIFF-003-BUG-006'],
      sourceEvidenceRef: 'visual-workbench-capture:synth-pad.playing.desktop:desktop:aaaaaaaaaaaa',
      artifactPath: '.ralph/visual-workbench/synth-pad.playing.desktop/desktop/aaaaaaaaaaaa.png',
      artifactSha256: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      recordedBy: 'manual',
      target: {
        route: '/visual-workbench/synth-pad.playing.desktop',
        viewport: { width: 1280, height: 800 },
        claim: 'synth pad shows the active playing state',
        state: 'playing',
      },
    }],
  }]);
  await tracker.flushNow();

  const snapshot = JSON.parse(readFileSync(path.join(workDir, '.arena', 'progress.json'), 'utf-8'));
  assert.deepEqual(snapshot.steps[0].visualEvidence, [{
    sourceEvidenceRef: 'visual-workbench-capture:synth-pad.playing.desktop:desktop:aaaaaaaaaaaa',
    sourceKind: 'visual_workbench',
    result: 'inconclusive',
    observedAt: '2026-06-07T09:00:00.000Z',
    summary: 'Visual Workbench story synth-pad.playing.desktop captured at desktop.',
    feedbackItemIds: ['BUG-006'],
    diffItemIds: ['DIFF-003-BUG-006'],
    artifactSha256: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    target: {
      route: '/visual-workbench/synth-pad.playing.desktop',
      viewport: { width: 1280, height: 800 },
      claim: 'synth pad shows the active playing state',
      state: 'playing',
    },
    assessments: [{
      ref: 'visual-workbench-assessment:manual_note:synth-pad.playing.desktop:desktop:aaaaaaaaaaaa:bbbbbbbbbbbb',
      result: 'pass',
      observedAt: '2026-06-07T09:01:00.000Z',
      summary: 'Manual Visual Workbench assessment (pass): active state is visible.',
      recordedBy: 'manual',
    }],
  }]);
  assert.doesNotMatch(JSON.stringify(snapshot), /\.ralph\/visual-workbench/);
  assert.doesNotMatch(JSON.stringify(snapshot), /artifactPath/);
});

test('progress tracker redacts source evidence copied into public task prose', async () => {
  const workDir = mkdtempSync(path.join(tmpdir(), 'ralph-progress-source-evidence-prose-'));
  const tracker = new ProgressTracker(workDir, 'demo-project');

  await tracker.load();
  tracker.addFeature({
    id: 'task-001',
    category: 'task',
    displayTitle: 'Replace raw quote must not leak',
    description: 'Implement this exactly: raw quote must not leak. normalized intent must not leak.',
    status: 'pending',
    feedbackItemRefs: [{
      itemId: 'DIFF-001',
      diffItemId: 'DIFF-001',
      targetType: 'spec',
      targetId: 'SPEC-001',
      sourceEvidence: [{
        sourceRef: 'SRC-001',
        quote: 'raw quote must not leak',
        intent: 'normalized intent must not leak',
      }],
    }],
  });
  await tracker.flushNow();

  const snapshot = JSON.parse(readFileSync(path.join(workDir, '.arena', 'progress.json'), 'utf-8'));
  assert.doesNotMatch(JSON.stringify(snapshot), /raw quote must not leak/);
  assert.doesNotMatch(JSON.stringify(snapshot), /normalized intent must not leak/);
  assert.match(snapshot.steps[0].label, /\[source evidence redacted\]/);
  assert.match(snapshot.steps[0].description, /\[source evidence redacted\]/);
});

test('progress tracker keeps skipped tasks visible as skipped', async () => {
  const workDir = mkdtempSync(path.join(tmpdir(), 'ralph-progress-skipped-'));
  const tracker = new ProgressTracker(workDir, 'demo-project');

  await tracker.load();
  tracker.syncFeatures([
    { id: 'task-001', category: 'task', description: 'Build API', status: 'completed' },
    { id: 'task-002', category: 'task', description: 'Optional deployment', status: 'skipped' },
    { id: 'task-003', category: 'task', description: 'Ship UI', status: 'pending' },
  ]);
  await tracker.flushNow();

  const progressPath = path.join(workDir, '.arena', 'progress.json');
  const snapshot = JSON.parse(readFileSync(progressPath, 'utf-8'));

  assert.deepEqual(snapshot.steps, [
    { id: 'task-001', label: 'Build API', status: 'completed' },
    { id: 'task-002', label: 'Optional deployment', status: 'skipped' },
    { id: 'task-003', label: 'Ship UI', status: 'pending' },
  ]);
  assert.equal(tracker.getCompletionPercentage(), 50);
});

test('progress tracker flushes background progress updates without explicit save', async () => {
  const workDir = mkdtempSync(path.join(tmpdir(), 'ralph-progress-live-'));
  const tracker = new ProgressTracker(workDir, 'demo-project');

  await tracker.load();
  tracker.setState('coding');
  tracker.setCurrentTask(undefined);

  await new Promise(resolve => setTimeout(resolve, 25));

  const progressPath = path.join(workDir, '.arena', 'progress.json');
  const snapshot = JSON.parse(readFileSync(progressPath, 'utf-8'));
  assert.equal(snapshot.state, 'coding');
});

test('progress tracker supports paused budget override for arena runner', async () => {
  const workDir = mkdtempSync(path.join(tmpdir(), 'ralph-progress-pause-'));
  const tracker = new ProgressTracker(workDir, 'demo-project');

  await tracker.load();
  tracker.setArenaPause('paused_budget', 'budget exhausted');
  await tracker.flushNow();

  const progressPath = path.join(workDir, '.arena', 'progress.json');
  const snapshot = JSON.parse(readFileSync(progressPath, 'utf-8'));
  assert.equal(snapshot.state, 'paused_budget');
  assert.equal(snapshot.message, 'budget exhausted');
});

test('progress tracker supports paused manual override for arena runner', async () => {
  const workDir = mkdtempSync(path.join(tmpdir(), 'ralph-progress-manual-pause-'));
  const tracker = new ProgressTracker(workDir, 'demo-project');

  await tracker.load();
  tracker.setArenaPause('paused_manual', 'Agent stopped by operator — awaiting resume');
  await tracker.flushNow();

  const progressPath = path.join(workDir, '.arena', 'progress.json');
  const snapshot = JSON.parse(readFileSync(progressPath, 'utf-8'));
  assert.equal(snapshot.state, 'paused_manual');
  assert.equal(snapshot.message, 'Agent stopped by operator — awaiting resume');
});

test('progress tracker syncFeatures drops removed plan tasks from public progress', async () => {
  const workDir = mkdtempSync(path.join(tmpdir(), 'ralph-progress-sync-'));
  const tracker = new ProgressTracker(workDir, 'demo-project');

  await tracker.load();
  tracker.syncFeatures([
    { id: 'task-001', category: 'task', description: 'Build API', status: 'completed' },
    { id: 'task-002', category: 'task', description: 'Ship UI', status: 'pending' },
  ]);
  tracker.setCurrentTask('task-002');
  await tracker.flushNow();

  tracker.syncFeatures([
    { id: 'task-001', category: 'task', description: 'Build API', status: 'completed' },
  ]);
  await tracker.flushNow();

  const progressPath = path.join(workDir, '.arena', 'progress.json');
  const snapshot = JSON.parse(readFileSync(progressPath, 'utf-8'));

  assert.deepEqual(snapshot.steps, [
    { id: 'task-001', label: 'Build API', status: 'completed' },
  ]);
  assert.equal(tracker.getProgress().metrics.testsTotal, 0);
  assert.equal(tracker.getProgress().metrics.testsPassing, 0);
});

test('progress tracker ignores and removes legacy ralph-features.json cache', async () => {
  const workDir = mkdtempSync(path.join(tmpdir(), 'ralph-progress-legacy-features-'));
  mkdirSync(path.join(workDir, '.ralph'), { recursive: true });
  const legacyPath = path.join(workDir, '.ralph', 'ralph-features.json');
  const internalProgressPath = path.join(workDir, '.ralph', 'ralph-progress.json');
  writeFileSync(legacyPath, JSON.stringify([
    { id: 'task-stale', category: 'task', description: 'Stale task', status: 'in_progress' },
  ]));
  writeFileSync(internalProgressPath, JSON.stringify({
    projectName: 'legacy-project',
    startedAt: '2026-01-01T00:00:00.000Z',
    lastUpdated: '2026-01-01T00:00:00.000Z',
    totalIterations: 7,
    currentState: 'paused',
    currentTaskId: 'task-stale',
    metrics: {
      featuresCompleted: 3,
      featuresTotal: 9,
      testsPassing: 2,
      testsTotal: 4,
    },
  }));

  const tracker = new ProgressTracker(workDir, 'demo-project');
  await tracker.load();
  tracker.setState('coding');
  await tracker.flushNow();

  const arenaProgressPath = path.join(workDir, '.arena', 'progress.json');
  const snapshot = JSON.parse(readFileSync(arenaProgressPath, 'utf-8'));

  assert.equal(snapshot.steps, undefined);
  assert.equal(existsSync(legacyPath), false);
  const internalProgress = JSON.parse(readFileSync(internalProgressPath, 'utf-8'));
  assert.equal(internalProgress.currentTaskId, undefined);
  assert.equal(internalProgress.metrics.featuresCompleted, undefined);
  assert.equal(internalProgress.metrics.featuresTotal, undefined);
  assert.equal(internalProgress.metrics.testsPassing, 2);
  assert.equal(internalProgress.metrics.testsTotal, 4);
});

test('progress tracker emits safe public assumption reviews without raw judgment ids', async () => {
  const workDir = mkdtempSync(path.join(tmpdir(), 'ralph-progress-assumptions-'));
  const tracker = new ProgressTracker(workDir, 'demo-project');

  await tracker.load();
  tracker.addAssumptionReviews([
    {
      id: 'ASM-RALPH-PROVIDER',
      title: 'Provider choice',
      statement: 'The spec does not name a production provider, so Ralph will use the configured provider.',
      sourceRefs: ['ASM-001', 'judgment-001'],
    },
    {
      id: 'ASM-RALPH-BUG-005',
      title: 'Needs confirmation for BUG-005',
      statement: 'BUG-005 appears implemented, but product evidence has not confirmed it yet.',
      sourceRefs: ['BUG-005'],
    },
    {
      id: 'judgment-002',
      title: 'Raw private judgment must be dropped',
      statement: 'This should not be public.',
      sourceRefs: [],
    },
  ]);
  await tracker.flushNow();

  const progressPath = path.join(workDir, '.arena', 'progress.json');
  const snapshot = JSON.parse(readFileSync(progressPath, 'utf-8'));

  assert.deepEqual(snapshot.assumptionReviews, [{
    id: 'ASM-RALPH-PROVIDER',
    title: 'Provider choice',
    statement: 'The spec does not name a production provider, so Ralph will use the configured provider.',
    sourceRefs: ['ASM-001'],
  }]);
  assert.doesNotMatch(JSON.stringify(snapshot), /judgment-00/);
  assert.doesNotMatch(JSON.stringify(snapshot), /Needs confirmation/);
});
