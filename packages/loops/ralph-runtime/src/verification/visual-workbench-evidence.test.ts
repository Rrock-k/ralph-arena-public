import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { execa } from 'execa';
import { PlanSchema, RalphConfigSchema } from '../config/types.js';
import { hasPositiveFeedbackEvidenceForItem } from '../feedback/evidence.js';
import { VISUAL_WORKBENCH_CAPTURE_RUN_SCHEMA_VERSION } from './visual-workbench-runner.js';
import {
  VISUAL_WORKBENCH_ASSESSMENT_SCHEMA_VERSION,
  VISUAL_WORKBENCH_EVIDENCE_CHAIN_READINESS_SCHEMA_VERSION,
  VISUAL_WORKBENCH_EVIDENCE_EXPORT_SCHEMA_VERSION,
  VISUAL_WORKBENCH_INGEST_MANIFEST_PATH,
  VISUAL_WORKBENCH_INGEST_MANIFEST_SCHEMA_VERSION,
  VISUAL_WORKBENCH_PROGRESS_PUBLISH_SCHEMA_VERSION,
  VISUAL_WORKBENCH_SELECTOR_READINESS_SCHEMA_VERSION,
  VISUAL_WORKBENCH_SHELL_POLICY_SCHEMA_VERSION,
  VISUAL_WORKBENCH_STATUS_SCHEMA_VERSION,
  assessVisualWorkbenchEvidenceFile,
  evaluateVisualWorkbenchCaptureShellPolicy,
  exportVisualWorkbenchEvidenceFile,
  formatVisualWorkbenchEvidenceChainReadinessResult,
  formatVisualWorkbenchAssessmentResult,
  formatVisualWorkbenchEvidenceExportResult,
  formatVisualWorkbenchProgressPublishResult,
  formatVisualWorkbenchSelectorReadinessResult,
  formatVisualWorkbenchShellPolicyResult,
  formatVisualWorkbenchStatusResult,
  getVisualWorkbenchEvidenceChainReadinessFile,
  getVisualWorkbenchSelectorReadinessFile,
  getVisualWorkbenchSelectorReadinessForPlan,
  getVisualWorkbenchShellPolicyFile,
  getVisualWorkbenchStatusFile,
  publishVisualWorkbenchProgressFile,
} from './visual-workbench-evidence.js';

const packageRoot = fileURLToPath(new URL('../../', import.meta.url));

test('Visual Workbench evidence export adopts one captured viewport into inconclusive task evidence', async () => {
  const fixture = await createFixture();

  const result = await exportVisualWorkbenchEvidenceFile({
    workDir: fixture.workDir,
    runPath: fixture.runPath,
    taskId: 'task-001',
    storyId: 'synth-pad.playing.desktop',
    viewportName: 'desktop',
  });

  assert.equal(result.schemaVersion, VISUAL_WORKBENCH_EVIDENCE_EXPORT_SCHEMA_VERSION);
  assert.equal(result.runSchemaVersion, VISUAL_WORKBENCH_CAPTURE_RUN_SCHEMA_VERSION);
  assert.equal(result.status, 'recorded');
  assert.equal(result.addedEvidenceRows, 1);
  assert.equal(result.storyId, 'synth-pad.playing.desktop');
  assert.equal(result.viewportName, 'desktop');
  assert.deepEqual(result.evidenceRefs, [`visual-workbench-capture:synth-pad.playing.desktop:desktop:${fixture.screenshotSha256.replace(/^sha256:/, '').slice(0, 12)}`]);
  assert.equal(result.artifactSha256, fixture.screenshotSha256);
  assert.match(result.adoptedArtifactPath, /^\.ralph\/visual-workbench\/synth-pad\.playing\.desktop\/desktop\//);
  assert.equal(result.evidence.kind, 'screenshot');
  assert.equal(result.evidence.result, 'inconclusive');
  assert.deepEqual(result.evidence.feedbackItemIds, ['BUG-001']);
  assert.deepEqual(result.evidence.diffItemIds, ['DIFF-001-BUG-001']);
  assert.equal(result.evidence.taskId, 'task-001');
  assert.equal(result.evidence.artifactPath, result.adoptedArtifactPath);
  assert.equal(result.evidence.artifactSha256, fixture.screenshotSha256);
  assert.equal(result.evidence.recordedBy, 'agent');
  assert.equal(result.evidence.screenshotProof, undefined);
  assert.deepEqual(result.evidence.target, {
    route: '/__visual/synth-pad.playing.desktop',
    viewport: {
      width: 1280,
      height: 832,
    },
    claim: 'The synth pad shows the active note and pressure level.',
    state: 'playing',
  });
  assert.equal(hasPositiveFeedbackEvidenceForItem('BUG-001', [result.evidence]), false);
  assert.equal(await readFile(path.join(fixture.workDir, result.adoptedArtifactPath), 'utf8'), 'fake-workbench-png');

  const plan = JSON.parse(await readFile(path.join(fixture.workDir, '.ralph', 'plan.json'), 'utf8'));
  const evidence = plan.phases[0].tasks[0].verificationEvidence;
  assert.equal(evidence.length, 1);
  assert.equal(evidence[0].result, 'inconclusive');
  assert.equal(evidence[0].screenshotProof, undefined);
  assert.doesNotMatch(JSON.stringify(evidence[0]), /assets\/proof|proofReviews|ProjectAsset/);

  assert.equal(JSON.parse(formatVisualWorkbenchEvidenceExportResult(result)).status, 'recorded');
  assert.equal(JSON.parse(formatVisualWorkbenchEvidenceExportResult(result, true)).schemaVersion, VISUAL_WORKBENCH_EVIDENCE_EXPORT_SCHEMA_VERSION);
});

test('Visual Workbench evidence export deduplicates exact repeats', async () => {
  const fixture = await createFixture();
  const options = {
    workDir: fixture.workDir,
    runPath: fixture.runPath,
    taskId: 'task-001',
    storyId: 'synth-pad.playing.desktop',
    viewportName: 'desktop',
  };

  await exportVisualWorkbenchEvidenceFile(options);
  const beforeRepeatPlan = await readFile(path.join(fixture.workDir, '.ralph', 'plan.json'), 'utf8');
  const second = await exportVisualWorkbenchEvidenceFile(options);
  const afterRepeatPlan = await readFile(path.join(fixture.workDir, '.ralph', 'plan.json'), 'utf8');

  assert.equal(second.status, 'already_recorded');
  assert.equal(second.addedEvidenceRows, 0);
  assert.equal(afterRepeatPlan, beforeRepeatPlan);
  const plan = JSON.parse(await readFile(path.join(fixture.workDir, '.ralph', 'plan.json'), 'utf8'));
  assert.equal(plan.phases[0].tasks[0].verificationEvidence.length, 1);
});

test('Visual Workbench evidence export rejects weak or unsafe inputs', async () => {
  const noFeedbackRefs = await createFixture({ feedbackItemRefs: [] });
  await assert.rejects(() => exportVisualWorkbenchEvidenceFile({
    workDir: noFeedbackRefs.workDir,
    runPath: noFeedbackRefs.runPath,
    taskId: 'task-001',
    storyId: 'synth-pad.playing.desktop',
    viewportName: 'desktop',
  }), /has no feedbackItemRefs/);

  const multi = await createFixture({
    feedbackItemRefs: [
      { itemId: 'BUG-001', diffItemId: 'DIFF-001-BUG-001' },
      { itemId: 'BUG-002', diffItemId: 'DIFF-001-BUG-002' },
    ],
  });
  await assert.rejects(() => exportVisualWorkbenchEvidenceFile({
    workDir: multi.workDir,
    runPath: multi.runPath,
    taskId: 'task-001',
    storyId: 'synth-pad.playing.desktop',
    viewportName: 'desktop',
  }), /requires exactly one feedbackItemId/);
  await assert.rejects(() => exportVisualWorkbenchEvidenceFile({
    workDir: multi.workDir,
    runPath: multi.runPath,
    taskId: 'task-001',
    storyId: 'synth-pad.playing.desktop',
    viewportName: 'desktop',
    feedbackItemId: 'BUG-MISSING',
    diffItemId: 'DIFF-MISSING',
  }), /not attached to task task-001/);

  const repairTask = await createFixture({
    taskOverrides: {
      displayTitle: 'Repair Visual Workbench coverage',
      description: 'Repair source-owned Visual Workbench coverage.',
      acceptanceCriteria: ['Fix taskRelevance.defaultFor mappings.'],
      addedBy: 'controller',
    },
  });
  await assert.rejects(() => exportVisualWorkbenchEvidenceFile({
    workDir: repairTask.workDir,
    runPath: repairTask.runPath,
    taskId: 'task-001',
    storyId: 'synth-pad.playing.desktop',
    viewportName: 'desktop',
  }), /source repair task/);

  const partial = await createFixture({
    runOverrides: { status: 'partial' },
  });
  await assert.rejects(() => exportVisualWorkbenchEvidenceFile({
    workDir: partial.workDir,
    runPath: partial.runPath,
    taskId: 'task-001',
    storyId: 'synth-pad.playing.desktop',
    viewportName: 'desktop',
  }), /must be fully captured/);

  const mutated = await createFixture({
    runOverrides: {
      workspaceMutationCheck: {
        changed: true,
      },
    },
  });
  await assert.rejects(() => exportVisualWorkbenchEvidenceFile({
    workDir: mutated.workDir,
    runPath: mutated.runPath,
    taskId: 'task-001',
    storyId: 'synth-pad.playing.desktop',
    viewportName: 'desktop',
  }), /workspaceMutationCheck\.changed=false/);

  const missingViewport = await createFixture();
  await assert.rejects(() => exportVisualWorkbenchEvidenceFile({
    workDir: missingViewport.workDir,
    runPath: missingViewport.runPath,
    taskId: 'task-001',
    storyId: 'synth-pad.playing.desktop',
    viewportName: 'tablet',
  }), /viewport not found/);

  const failedViewport = await createFixture({
    viewportOverrides: {
      status: 'capture_failed',
      screenshotPath: null,
      screenshotSha256: null,
      error: {
        code: 'capture_failed',
        message: 'Screenshot failed.',
      },
    },
  });
  await assert.rejects(() => exportVisualWorkbenchEvidenceFile({
    workDir: failedViewport.workDir,
    runPath: failedViewport.runPath,
    taskId: 'task-001',
    storyId: 'synth-pad.playing.desktop',
    viewportName: 'desktop',
  }), /must be captured/);

  const badDigest = await createFixture();
  await writeFile(badDigest.screenshotPath, 'tampered-png');
  await assert.rejects(() => exportVisualWorkbenchEvidenceFile({
    workDir: badDigest.workDir,
    runPath: badDigest.runPath,
    taskId: 'task-001',
    storyId: 'synth-pad.playing.desktop',
    viewportName: 'desktop',
  }), /digest mismatch/);
});

test('Visual Workbench assessment records explicit manual pass without mutating the source screenshot row', async () => {
  const fixture = await createExportedFixture();

  const result = await assessVisualWorkbenchEvidenceFile({
    workDir: fixture.workDir,
    taskId: 'task-001',
    evidenceRef: fixture.exportResult.evidenceRefs[0],
    result: 'pass',
    assessment: 'The isolated synth pad playing state matches the claim.',
    observedAt: '2026-06-07T13:00:00.000Z',
  });

  assert.equal(result.schemaVersion, VISUAL_WORKBENCH_ASSESSMENT_SCHEMA_VERSION);
  assert.equal(result.status, 'recorded');
  assert.equal(result.kind, 'manual_note');
  assert.equal(result.result, 'pass');
  assert.equal(result.sourceEvidenceRef, fixture.exportResult.evidenceRefs[0]);
  assert.match(result.assessmentEvidenceRef, /^visual-workbench-assessment:manual_note:synth-pad\.playing\.desktop:desktop:/);
  assert.deepEqual(result.feedbackItemIds, ['BUG-001']);
  assert.equal(result.artifactSha256, fixture.screenshotSha256);
  assert.equal(result.evidence.kind, 'manual_note');
  assert.equal(result.evidence.recordedBy, 'manual');
  assert.equal(result.evidence.sourceEvidenceRef, fixture.exportResult.evidenceRefs[0]);
  assert.equal(result.evidence.result, 'pass');
  assert.equal(result.evidence.artifactPath, fixture.exportResult.adoptedArtifactPath);
  assert.equal(result.evidence.artifactSha256, fixture.screenshotSha256);
  assert.equal(result.evidence.screenshotProof, undefined);

  const plan = JSON.parse(await readFile(path.join(fixture.workDir, '.ralph', 'plan.json'), 'utf8'));
  const evidence = plan.phases[0].tasks[0].verificationEvidence;
  assert.equal(evidence.length, 2);
  assert.equal(evidence[0].kind, 'screenshot');
  assert.equal(evidence[0].result, 'inconclusive');
  assert.equal(hasPositiveFeedbackEvidenceForItem('BUG-001', [evidence[0]]), false);
  assert.equal(hasPositiveFeedbackEvidenceForItem('BUG-001', [evidence[1]]), true);
  assert.doesNotMatch(JSON.stringify(evidence), /assets\/proof|proofReviews|ProjectAsset/);

  const parsed = PlanSchema.parse(plan);
  const assessment = parsed.phases[0].tasks[0].verificationEvidence?.find((row) => row.kind === 'manual_note');
  assert.equal(assessment?.sourceEvidenceRef, fixture.exportResult.evidenceRefs[0]);
  assert.equal(JSON.parse(formatVisualWorkbenchAssessmentResult(result)).schemaVersion, VISUAL_WORKBENCH_ASSESSMENT_SCHEMA_VERSION);
});

test('Visual Workbench assessment rejects conflicts, drift and multi-feedback source rows', async () => {
  const fixture = await createExportedFixture();
  const options = {
    workDir: fixture.workDir,
    taskId: 'task-001',
    evidenceRef: fixture.exportResult.evidenceRefs[0],
    result: 'pass' as const,
    assessment: 'Manual review confirms the story claim.',
  };
  await assessVisualWorkbenchEvidenceFile(options);
  assert.equal((await assessVisualWorkbenchEvidenceFile(options)).status, 'already_recorded');
  await assert.rejects(() => assessVisualWorkbenchEvidenceFile({
    ...options,
    result: 'fail',
    assessment: 'Conflicting result.',
  }), /Conflicting Visual Workbench assessment/);

  const driftedLinks = await createExportedFixture();
  await mutateTask(driftedLinks, { feedbackItemRefs: [{ itemId: 'BUG-999', diffItemId: 'DIFF-999-BUG-999' }] });
  await assert.rejects(() => assessVisualWorkbenchEvidenceFile({
    workDir: driftedLinks.workDir,
    taskId: 'task-001',
    evidenceRef: driftedLinks.exportResult.evidenceRefs[0],
    result: 'pass',
    assessment: 'Links drifted.',
  }), /feedback links no longer match/);

  const badDigest = await createExportedFixture();
  await writeFile(path.join(badDigest.workDir, badDigest.exportResult.adoptedArtifactPath), 'tampered-png');
  await assert.rejects(() => assessVisualWorkbenchEvidenceFile({
    workDir: badDigest.workDir,
    taskId: 'task-001',
    evidenceRef: badDigest.exportResult.evidenceRefs[0],
    result: 'pass',
    assessment: 'Digest mismatch.',
  }), /digest mismatch/);

  const multiSource = await createExportedFixture();
  await mutatePlan(multiSource.workDir, (plan) => {
    const evidence = plan.phases[0].tasks[0].verificationEvidence[0];
    evidence.feedbackItemIds = ['BUG-001', 'BUG-002'];
    evidence.diffItemIds = ['DIFF-001-BUG-001', 'DIFF-002-BUG-002'];
  });
  await assert.rejects(() => assessVisualWorkbenchEvidenceFile({
    workDir: multiSource.workDir,
    taskId: 'task-001',
    evidenceRef: multiSource.exportResult.evidenceRefs[0],
    result: 'pass',
    assessment: 'This must not close multiple feedback items at once.',
  }), /requires exactly one feedbackItemId/);
});

test('Visual Workbench status groups sources and manual assessments without writing plan truth', async () => {
  const fixture = await createExportedFixture();
  await assessVisualWorkbenchEvidenceFile({
    workDir: fixture.workDir,
    taskId: 'task-001',
    evidenceRef: fixture.exportResult.evidenceRefs[0],
    result: 'pass',
    assessment: 'Manual review confirms the story claim.',
    observedAt: '2026-06-07T13:00:00.000Z',
  });
  const beforePlan = await readFile(path.join(fixture.workDir, '.ralph', 'plan.json'), 'utf8');

  const status = await getVisualWorkbenchStatusFile({ workDir: fixture.workDir });
  const afterPlan = await readFile(path.join(fixture.workDir, '.ralph', 'plan.json'), 'utf8');

  assert.equal(afterPlan, beforePlan);
  assert.equal(status.schemaVersion, VISUAL_WORKBENCH_STATUS_SCHEMA_VERSION);
  assert.equal(status.status, 'ready');
  assert.equal(status.plan.status, 'ready');
  assert.equal(status.plan.path, path.join(fixture.workDir, '.ralph', 'plan.json'));
  assert.equal(status.plan.reasonCode, null);
  assert.deepEqual(status.plan.blockers, []);
  assert.equal(status.summary.tasks, 1);
  assert.equal(status.summary.sources, 1);
  assert.equal(status.summary.assessments, 1);
  assert.equal(status.summary.invalidRows, 0);
  assert.equal(status.summary.orphanAssessments, 0);
  assert.equal(status.tasks[0].status, 'pending');
  assert.equal(status.tasks[0].title, 'Make the synth pad playing state visible.');
  assert.deepEqual(status.tasks[0].diffItemIds, ['DIFF-001-BUG-001']);
  assert.equal(status.tasks[0].totalVerificationEvidenceRows, 2);
  assert.equal(status.tasks[0].visualWorkbenchEvidenceRows, 1);
  const source = status.tasks[0].sources[0];
  assert.equal(source.sourceEvidenceRef, fixture.exportResult.evidenceRefs[0]);
  assert.equal(source.status, 'passed');
  assert.equal(source.result, 'inconclusive');
  assert.deepEqual(source.diffItemIds, ['DIFF-001-BUG-001']);
  assert.equal(source.artifactPath, fixture.exportResult.adoptedArtifactPath);
  assert.equal(source.artifactSha256, fixture.screenshotSha256);
  assert.deepEqual(source.warnings, []);
  assert.equal(source.assessments[0].sourceEvidenceRef, fixture.exportResult.evidenceRefs[0]);
  assert.equal(source.assessments[0].result, 'pass');

  assert.equal(JSON.parse(formatVisualWorkbenchStatusResult(status)).schemaVersion, VISUAL_WORKBENCH_STATUS_SCHEMA_VERSION);
  assert.equal(JSON.parse(formatVisualWorkbenchStatusResult(status, true)).summary.sources, 1);
});

test('Visual Workbench status reports missing and unreadable plan as structured blocked readback', async () => {
  const missing = await mkdtemp(path.join(os.tmpdir(), 'visual-workbench-status-no-plan-'));

  const missingStatus = await getVisualWorkbenchStatusFile({
    workDir: missing,
    taskId: 'task-001',
  });

  assert.equal(missingStatus.schemaVersion, VISUAL_WORKBENCH_STATUS_SCHEMA_VERSION);
  assert.equal(missingStatus.status, 'blocked');
  assert.equal(missingStatus.plan.status, 'blocked');
  assert.equal(missingStatus.plan.path, path.join(missing, '.ralph', 'plan.json'));
  assert.equal(missingStatus.plan.reasonCode, 'plan_missing');
  assert.deepEqual(missingStatus.plan.blockers, ['plan_missing']);
  assert.equal(missingStatus.summary.tasks, 0);
  assert.deepEqual(missingStatus.tasks, []);

  const unreadable = await mkdtemp(path.join(os.tmpdir(), 'visual-workbench-status-bad-plan-'));
  await mkdir(path.join(unreadable, '.ralph'), { recursive: true });
  await writeFile(path.join(unreadable, '.ralph', 'plan.json'), '{not-json');

  const unreadableStatus = await getVisualWorkbenchStatusFile({
    workDir: unreadable,
    taskId: 'task-001',
  });

  assert.equal(unreadableStatus.status, 'blocked');
  assert.equal(unreadableStatus.plan.path, path.join(unreadable, '.ralph', 'plan.json'));
  assert.equal(unreadableStatus.plan.reasonCode, 'plan_unreadable');
  assert.match(unreadableStatus.plan.blockers[0], /^plan_unreadable:/);
  assert.equal(JSON.parse(formatVisualWorkbenchStatusResult(unreadableStatus, true)).status, 'blocked');
});

test('Visual Workbench status CLI returns blocked JSON when plan is missing', async () => {
  const workDir = await mkdtemp(path.join(os.tmpdir(), 'visual-workbench-status-cli-no-plan-'));

  const status = await runRalphCli([
    'visual-workbench',
    'status',
    '--work-dir',
    workDir,
    '--task',
    'task-001',
    '--compact',
  ]);

  assert.equal(status.exitCode, 0);
  const statusJson = parseLastJsonLine(status.stdout);
  assert.equal(statusJson.schemaVersion, VISUAL_WORKBENCH_STATUS_SCHEMA_VERSION);
  assert.equal(statusJson.status, 'blocked');
  assert.equal(statusJson.plan.path, path.join(workDir, '.ralph', 'plan.json'));
  assert.equal(statusJson.plan.reasonCode, 'plan_missing');
  assert.deepEqual(statusJson.plan.blockers, ['plan_missing']);
});

test('Visual Workbench progress publish writes sanitized Arena read-side metadata only', async () => {
  const fixture = await createExportedFixture();
  await assessVisualWorkbenchEvidenceFile({
    workDir: fixture.workDir,
    taskId: 'task-001',
    evidenceRef: fixture.exportResult.evidenceRefs[0],
    result: 'pass',
    assessment: 'Manual review confirms the story claim.',
    observedAt: '2026-06-07T13:00:00.000Z',
  });
  await mkdir(path.join(fixture.workDir, '.arena'), { recursive: true });
  await writeFile(path.join(fixture.workDir, '.arena', 'progress.json'), JSON.stringify({
    state: 'paused_rate_limit',
    message: 'Provider quota wait.',
    iteration: 7,
    steps: [{
      id: 'task-unrelated',
      label: 'Unrelated work',
      status: 'pending',
      visualEvidence: [{
        sourceEvidenceRef: 'visual-workbench-capture:old:desktop:aaaaaaaaaaaa',
        sourceKind: 'visual_workbench',
        summary: 'Existing visual evidence row must not leak raw artifact paths.',
        feedbackItemIds: ['BUG-OLD'],
        artifactPath: '.ralph/must-not-leak.png',
        target: {
          route: '/__visual/old',
          viewport: { width: 320, height: 240 },
          claim: 'Old visual row.',
        },
      }],
    }],
    assumptionReviews: [{
      id: 'BUG-001',
      title: 'Existing public assumption review',
      statement: 'Preserved from the current read-side progress file.',
      sourceRefs: ['BUG-001'],
    }],
  }, null, 2));
  const beforePlan = await readFile(path.join(fixture.workDir, '.ralph', 'plan.json'), 'utf8');

  const result = await publishVisualWorkbenchProgressFile({ workDir: fixture.workDir });

  assert.equal(result.schemaVersion, VISUAL_WORKBENCH_PROGRESS_PUBLISH_SCHEMA_VERSION);
  assert.equal(result.statusSchemaVersion, VISUAL_WORKBENCH_STATUS_SCHEMA_VERSION);
  assert.equal(result.status, 'published');
  assert.equal(result.uploadManifest.schemaVersion, VISUAL_WORKBENCH_INGEST_MANIFEST_SCHEMA_VERSION);
  assert.equal(result.uploadManifest.path, path.join(fixture.workDir, VISUAL_WORKBENCH_INGEST_MANIFEST_PATH));
  assert.equal(result.uploadManifest.items, 1);
  assert.equal(result.summary.stepsBefore, 1);
  assert.equal(result.summary.stepsAfter, 2);
  assert.equal(result.summary.visualEvidenceRows, 1);
  assert.deepEqual(result.summary.taskIds, ['task-001']);
  assert.equal(await readFile(path.join(fixture.workDir, '.ralph', 'plan.json'), 'utf8'), beforePlan);

  const progress = JSON.parse(await readFile(path.join(fixture.workDir, '.arena', 'progress.json'), 'utf8'));
  assert.equal(progress.state, 'paused_rate_limit');
  assert.equal(progress.message, 'Provider quota wait.');
  assert.equal(progress.iteration, 7);
  assert.equal(progress.assumptionReviews[0].id, 'BUG-001');
  assert.equal(progress.steps.length, 2);
  assert.equal(progress.steps[0].id, 'task-unrelated');
  assert.equal(progress.steps[0].visualEvidence[0].artifactPath, undefined);

  const step = progress.steps.find((candidate: any) => candidate.id === 'task-001');
  assert.equal(step.label, 'Make the synth pad playing state visible.');
  assert.equal(step.status, 'pending');
  assert.deepEqual(step.feedbackItemRefs, [{ itemId: 'BUG-001', diffItemId: 'DIFF-001-BUG-001' }]);
  assert.equal(step.visualEvidence.length, 1);

  const visualEvidence = step.visualEvidence[0];
  assert.equal(visualEvidence.sourceEvidenceRef, fixture.exportResult.evidenceRefs[0]);
  assert.equal(visualEvidence.sourceKind, 'visual_workbench');
  assert.equal(visualEvidence.result, 'inconclusive');
  assert.equal(visualEvidence.observedAt, '2026-06-07T12:00:00.000Z');
  assert.equal(visualEvidence.summary, fixture.exportResult.evidence.summary);
  assert.deepEqual(visualEvidence.feedbackItemIds, ['BUG-001']);
  assert.deepEqual(visualEvidence.diffItemIds, ['DIFF-001-BUG-001']);
  assert.equal(visualEvidence.artifactSha256, fixture.screenshotSha256);
  assert.deepEqual(visualEvidence.target, fixture.exportResult.evidence.target);
  assert.equal(visualEvidence.assessments.length, 1);
  assert.equal(visualEvidence.assessments[0].result, 'pass');
  assert.equal(visualEvidence.assessments[0].recordedBy, 'manual');

  const rawProgress = JSON.stringify(progress);
  assert.doesNotMatch(rawProgress, /artifactPath|\.ralph|assets\/proof|proofReviews|ProjectAsset/);

  const manifest = JSON.parse(await readFile(path.join(fixture.workDir, VISUAL_WORKBENCH_INGEST_MANIFEST_PATH), 'utf8'));
  assert.equal(manifest.schemaVersion, VISUAL_WORKBENCH_INGEST_MANIFEST_SCHEMA_VERSION);
  assert.equal(manifest.ownerBoundary, 'ralph.visual-workbench-progress-publish');
  assert.equal(manifest.progressJsonPath, '.arena/progress.json');
  assert.deepEqual(manifest.items, [{
    taskId: 'task-001',
    sourceEvidenceRef: fixture.exportResult.evidenceRefs[0],
    artifactPath: fixture.exportResult.adoptedArtifactPath,
    artifactSha256: fixture.screenshotSha256,
    artifactContentType: 'image/png',
  }]);
  assert.doesNotMatch(JSON.stringify(manifest), /artifactContentBase64|"progressJson"|assets\/proof|proofReviews|ProjectAsset/);

  assert.equal(JSON.parse(formatVisualWorkbenchProgressPublishResult(result)).schemaVersion, VISUAL_WORKBENCH_PROGRESS_PUBLISH_SCHEMA_VERSION);
  assert.equal(JSON.parse(formatVisualWorkbenchProgressPublishResult(result, true)).summary.visualEvidenceRows, 1);
});

test('Visual Workbench progress publish adds plan feedback refs to touched existing steps', async () => {
  const fixture = await createExportedFixture();
  await mkdir(path.join(fixture.workDir, '.arena'), { recursive: true });
  await writeFile(path.join(fixture.workDir, '.arena', 'progress.json'), JSON.stringify({
    state: 'coding',
    steps: [{
      id: 'task-001',
      label: 'Existing task step without refs',
      status: 'in_progress',
    }],
  }, null, 2));

  const result = await publishVisualWorkbenchProgressFile({ workDir: fixture.workDir });

  assert.equal(result.status, 'published');
  assert.equal(result.summary.stepsBefore, 1);
  assert.equal(result.summary.stepsAfter, 1);

  const progress = JSON.parse(await readFile(path.join(fixture.workDir, '.arena', 'progress.json'), 'utf8'));
  assert.deepEqual(progress.steps[0].feedbackItemRefs, [{
    itemId: 'BUG-001',
    diffItemId: 'DIFF-001-BUG-001',
  }]);
  assert.deepEqual(progress.steps[0].visualEvidence[0].diffItemIds, ['DIFF-001-BUG-001']);
});

test('Visual Workbench selector readiness maps tasks to explicit story defaultFor selectors', async () => {
  const fixture = await createSelectorFixture({
    feedbackItemRefs: [{
      itemId: 'BUG-001',
      diffItemId: 'DIFF-001',
      targetId: 'REQ-001',
      workSurface: 'frontend',
    }],
    stories: [
      selectorStory('synth-pad.by-task', ['task-001'], ['desktop', 'mobile']),
      selectorStory('synth-pad.by-item', ['BUG-001']),
      selectorStory('synth-pad.by-diff', ['DIFF-001']),
      selectorStory('synth-pad.by-target', ['REQ-001']),
    ],
  });

  const result = await getVisualWorkbenchSelectorReadinessFile({
    workDir: fixture.workDir,
    taskId: 'task-001',
  });

  assert.equal(result.schemaVersion, VISUAL_WORKBENCH_SELECTOR_READINESS_SCHEMA_VERSION);
  assert.equal(result.status, 'ready');
  assert.equal(result.manifest.status, 'ready');
  assert.equal(result.plan.status, 'ready');
  assert.equal(result.summary.readyTasks, 1);
  assert.equal(result.summary.selectedStories, 4);
  assert.equal(result.summary.selectedViewports, 5);
  const task = result.tasks[0];
  assert.equal(task.readiness, 'ready');
  assert.deepEqual(task.feedbackItemIds, ['BUG-001']);
  assert.deepEqual(task.selectorIdentities, [
    'task-001',
    'BUG-001',
    'DIFF-001',
    'REQ-001',
    'task-001#BUG-001',
    'task-001#DIFF-001',
    'task-001#REQ-001',
  ]);
  assert.deepEqual(task.selections.map((selection) => selection.storyId), [
    'synth-pad.by-diff',
    'synth-pad.by-item',
    'synth-pad.by-target',
    'synth-pad.by-task',
  ]);
  assert.deepEqual(task.exportSelections.filter((selection) => selection.storyId === 'synth-pad.by-task'), [
    { storyId: 'synth-pad.by-task', viewportName: 'desktop', feedbackItemId: 'BUG-001', diffItemId: 'DIFF-001' },
    { storyId: 'synth-pad.by-task', viewportName: 'mobile', feedbackItemId: 'BUG-001', diffItemId: 'DIFF-001' },
  ]);
  assert.equal(JSON.parse(formatVisualWorkbenchSelectorReadinessResult(result, true)).status, 'ready');
});

test('Visual Workbench selector readiness uses task plus feedback ref for multi-ref frontend tasks', async () => {
  const fixture = await createSelectorFixture({
    feedbackItemRefs: [
      { itemId: 'DIFF-STOOK-JAM-ROOM', diffItemId: 'DIFF-STOOK-JAM-ROOM', targetId: 'REQ-STOOK-JAM-ROOM', workSurface: 'frontend' },
      { itemId: 'DIFF-STOOK-VISUAL-CATALOG', diffItemId: 'DIFF-STOOK-VISUAL-CATALOG', targetId: 'REQ-STOOK-VISUAL-CATALOG', workSurface: 'frontend' },
    ],
    stories: [
      selectorStory('jam-room.ready', ['task-001#DIFF-STOOK-JAM-ROOM']),
      selectorStory('visual-catalog.ready', ['task-001#DIFF-STOOK-VISUAL-CATALOG']),
    ],
  });

  const result = await getVisualWorkbenchSelectorReadinessFile({
    workDir: fixture.workDir,
    taskId: 'task-001',
  });

  assert.equal(result.status, 'ready');
  assert.deepEqual(result.tasks[0].exportSelections, [{
    storyId: 'jam-room.ready',
    viewportName: 'desktop',
    feedbackItemId: 'DIFF-STOOK-JAM-ROOM',
    diffItemId: 'DIFF-STOOK-JAM-ROOM',
  }, {
    storyId: 'visual-catalog.ready',
    viewportName: 'desktop',
    feedbackItemId: 'DIFF-STOOK-VISUAL-CATALOG',
    diffItemId: 'DIFF-STOOK-VISUAL-CATALOG',
  }]);
});

test('Visual Workbench selector readiness blocks task-id-only multi-ref story selection', async () => {
  const fixture = await createSelectorFixture({
    feedbackItemRefs: [
      { itemId: 'BUG-001', diffItemId: 'DIFF-001-BUG-001', workSurface: 'frontend' },
      { itemId: 'BUG-002', diffItemId: 'DIFF-002-BUG-002', workSurface: 'frontend' },
    ],
    stories: [selectorStory('synth-pad.task-only', ['task-001'])],
  });

  const result = await getVisualWorkbenchSelectorReadinessFile({
    workDir: fixture.workDir,
    taskId: 'task-001',
  });

  assert.equal(result.status, 'blocked');
  assert(result.tasks[0].blockers.includes('ambiguous_task_feedback_ref:synth-pad.task-only'));
  assert(!result.tasks[0].blockers.includes('multi_ref_visual_export_owner'));
  assert.deepEqual(result.tasks[0].exportSelections, [{
    storyId: 'synth-pad.task-only',
    viewportName: 'desktop',
  }]);
});

test('Visual Workbench selector readiness excludes generic controller verify tasks as evidence owners', async () => {
  const fixture = await createSelectorFixture({
    tasks: [{
      id: 'task-001',
      description: 'Build the jam room Workbench story.',
      acceptanceCriteria: ['Jam room visual state is visible.'],
      status: 'completed',
      attempts: 1,
      dependencies: [],
      feedbackItemRefs: [{ itemId: 'DIFF-STOOK-JAM-ROOM', diffItemId: 'DIFF-STOOK-JAM-ROOM', workSurface: 'frontend' }],
    }, {
      id: 'task-006',
      displayTitle: 'Verify accepted changes',
      description: 'Verify accepted changes for DIFF-STOOK-JAM-ROOM.',
      acceptanceCriteria: ['Check the accepted frontend behavior.'],
      status: 'completed',
      attempts: 1,
      dependencies: [],
      addedBy: 'controller',
      feedbackItemRefs: [{ itemId: 'DIFF-STOOK-JAM-ROOM', diffItemId: 'DIFF-STOOK-JAM-ROOM', workSurface: 'frontend' }],
    }],
    stories: [selectorStory('jam-room.accepted', ['DIFF-STOOK-JAM-ROOM'])],
  });

  const result = await getVisualWorkbenchSelectorReadinessFile({
    workDir: fixture.workDir,
  });
  const implementationTask = result.tasks.find((task) => task.taskId === 'task-001');
  const verifyTask = result.tasks.find((task) => task.taskId === 'task-006');

  assert.equal(result.status, 'ready');
  assert.equal(implementationTask?.readiness, 'ready');
  assert.equal(verifyTask?.readiness, 'not_applicable');
  assert(verifyTask?.blockers.includes('controller_verification_task_not_evidence_owner'));
  assert(!implementationTask?.blockers.some((blocker) => blocker.startsWith('story_matches_multiple_tasks:')));
});

test('Visual Workbench selector readiness reports expected plan boundary when plan is missing', async () => {
  const workDir = await mkdtemp(path.join(os.tmpdir(), 'visual-workbench-selector-no-plan-'));
  await mkdir(path.join(workDir, 'visual-workbench'), { recursive: true });
  await writeFile(path.join(workDir, 'visual-workbench', 'manifest.json'), JSON.stringify({
    schemaVersion: 'ra-355.visual-coverage-manifest.v0',
    projectClass: 'ordinary_web',
    workbench: {
      serveCommand: 'npm run visual-workbench',
      storyRoutePattern: '/__visual/:storyId',
    },
    coveragePolicy: {
      mode: 'strict_canary',
      selectionDefault: 'full_manifest',
      simplificationRequiresEvidence: true,
    },
    stories: [selectorStory('synth-pad.by-item', ['BUG-001'])],
  }, null, 2));

  const result = await getVisualWorkbenchSelectorReadinessFile({
    workDir,
    taskId: 'task-001',
  });

  assert.equal(result.status, 'blocked');
  assert.equal(result.manifest.status, 'ready');
  assert.equal(result.plan.status, 'blocked');
  assert.equal(result.plan.path, path.join(workDir, '.ralph', 'plan.json'));
  assert.equal(result.plan.source, 'plan_file');
  assert.equal(result.plan.reasonCode, 'plan_missing');
  assert.deepEqual(result.plan.blockers, ['plan_missing']);
  assert.equal(result.summary.tasks, 0);
  assert.deepEqual(result.tasks, []);
});

test('Visual Workbench selector readiness reports plan readability separately from task selection', async () => {
  const unreadable = await mkdtemp(path.join(os.tmpdir(), 'visual-workbench-selector-bad-plan-'));
  await mkdir(path.join(unreadable, '.ralph'), { recursive: true });
  await mkdir(path.join(unreadable, 'visual-workbench'), { recursive: true });
  await writeFile(path.join(unreadable, '.ralph', 'plan.json'), '{not-json');
  await writeFile(path.join(unreadable, 'visual-workbench', 'manifest.json'), JSON.stringify({
    schemaVersion: 'ra-355.visual-coverage-manifest.v0',
    projectClass: 'ordinary_web',
    workbench: {
      serveCommand: 'npm run visual-workbench',
      storyRoutePattern: '/__visual/:storyId',
    },
    coveragePolicy: {
      mode: 'strict_canary',
      selectionDefault: 'full_manifest',
      simplificationRequiresEvidence: true,
    },
    stories: [selectorStory('synth-pad.by-item', ['BUG-001'])],
  }, null, 2));

  const unreadableResult = await getVisualWorkbenchSelectorReadinessFile({
    workDir: unreadable,
    taskId: 'task-001',
  });

  assert.equal(unreadableResult.status, 'blocked');
  assert.equal(unreadableResult.plan.path, path.join(unreadable, '.ralph', 'plan.json'));
  assert.equal(unreadableResult.plan.source, 'plan_file');
  assert.equal(unreadableResult.plan.reasonCode, 'plan_unreadable');
  assert.match(unreadableResult.plan.blockers[0], /^plan_unreadable:/);

  const injected = await createSelectorFixture({
    feedbackItemRefs: [{ itemId: 'BUG-001', diffItemId: 'DIFF-001-BUG-001', workSurface: 'frontend' }],
    stories: [selectorStory('synth-pad.by-item', ['BUG-001'])],
  });
  const injectedPlan = PlanSchema.parse(JSON.parse(await readFile(path.join(injected.workDir, '.ralph', 'plan.json'), 'utf8')));
  const injectedResult = await getVisualWorkbenchSelectorReadinessForPlan({
    workDir: injected.workDir,
    taskId: 'task-001',
    plan: injectedPlan,
  });

  assert.equal(injectedResult.status, 'ready');
  assert.equal(injectedResult.plan.path, null);
  assert.equal(injectedResult.plan.source, 'injected_plan');
  assert.equal(injectedResult.plan.reasonCode, null);
  assert.deepEqual(injectedResult.plan.blockers, []);

  const missingTaskResult = await getVisualWorkbenchSelectorReadinessFile({
    workDir: injected.workDir,
    taskId: 'task-does-not-exist',
  });

  assert.equal(missingTaskResult.status, 'blocked');
  assert.equal(missingTaskResult.plan.path, path.join(injected.workDir, '.ralph', 'plan.json'));
  assert.equal(missingTaskResult.plan.source, 'plan_file');
  assert.equal(missingTaskResult.plan.reasonCode, null);
  assert.deepEqual(missingTaskResult.plan.blockers, ['task_not_found']);
});

test('Visual Workbench selector readiness refuses text route and claim inference', async () => {
  const fixture = await createSelectorFixture({
    feedbackItemRefs: [{
      itemId: 'BUG-001',
      diffItemId: 'DIFF-001',
      targetId: 'REQ-001',
      workSurface: 'frontend',
    }],
    stories: [{
      ...selectorStory('task-001-BUG-001', [], ['desktop']),
      title: 'BUG-001 task-001 title looks related',
      feature: 'DIFF-001',
      widget: 'REQ-001',
      state: 'task-001',
      claim: 'This claim mentions BUG-001, DIFF-001, REQ-001 and task-001.',
      render: { type: 'workbench_route', path: '/__visual/task-001-BUG-001' },
      taskRelevance: undefined,
    }],
  });

  const result = await getVisualWorkbenchSelectorReadinessFile({
    workDir: fixture.workDir,
    taskId: 'task-001',
  });

  assert.equal(result.status, 'blocked');
  assert.equal(result.tasks[0].readiness, 'blocked');
  assert.deepEqual(result.tasks[0].selections, []);
  assert(result.tasks[0].blockers.includes('no_story_selection'));
});

test('Visual Workbench selector readiness ignores non-frontend non-UX tasks', async () => {
  const fixture = await createSelectorFixture({
    feedbackItemRefs: [{ itemId: 'BUG-001', diffItemId: 'DIFF-001-BUG-001', workSurface: 'backend' }],
    stories: [selectorStory('synth-pad.by-item', ['BUG-001'])],
  });

  const result = await getVisualWorkbenchSelectorReadinessFile({
    workDir: fixture.workDir,
    taskId: 'task-001',
  });

  assert.equal(result.status, 'not_applicable');
  assert.equal(result.tasks[0].readiness, 'not_applicable');
  assert(result.tasks[0].blockers.includes('task_not_frontend_or_ux'));
  assert.deepEqual(result.tasks[0].selections, []);
});

test('Visual Workbench selector readiness blocks missing feedback refs and ambiguous story ownership', async () => {
  const missingRefs = await createSelectorFixture({
    feedbackItemRefs: [],
    taskOverrides: {
      requiredRolePasses: ['ux'],
    },
    stories: [selectorStory('synth-pad.by-task', ['task-001'])],
  });
  const missingRefsResult = await getVisualWorkbenchSelectorReadinessFile({
    workDir: missingRefs.workDir,
    taskId: 'task-001',
  });
  assert.equal(missingRefsResult.status, 'blocked');
  assert(missingRefsResult.tasks[0].blockers.includes('task_has_no_feedback_item_refs'));

  const ambiguous = await createSelectorFixture({
    tasks: [{
      id: 'task-001',
      description: 'Fix synth pad.',
      acceptanceCriteria: ['Task one.'],
      status: 'completed',
      attempts: 1,
      dependencies: [],
      feedbackItemRefs: [{ itemId: 'BUG-SHARED', diffItemId: 'DIFF-001-BUG-SHARED', workSurface: 'frontend' }],
    }, {
      id: 'task-002',
      description: 'Fix related synth pad.',
      acceptanceCriteria: ['Task two.'],
      status: 'completed',
      attempts: 1,
      dependencies: [],
      feedbackItemRefs: [{ itemId: 'BUG-SHARED', diffItemId: 'DIFF-001-BUG-SHARED', workSurface: 'frontend' }],
    }],
    stories: [selectorStory('synth-pad.shared', ['BUG-SHARED'])],
  });
  const ambiguousResult = await getVisualWorkbenchSelectorReadinessFile({
    workDir: ambiguous.workDir,
    taskId: 'task-001',
  });
  assert.equal(ambiguousResult.status, 'blocked');
  assert(ambiguousResult.tasks[0].blockers.includes('story_matches_multiple_tasks:synth-pad.shared'));
  assert.deepEqual(ambiguousResult.tasks[0].ambiguities, [{
    storyId: 'synth-pad.shared',
    matchedTaskIds: ['task-001', 'task-002'],
    matchedSelectorsByTask: [
      { taskId: 'task-001', matchedSelectors: ['BUG-SHARED'] },
      { taskId: 'task-002', matchedSelectors: ['BUG-SHARED'] },
    ],
  }]);

  const cli = await runRalphCli([
    'visual-workbench',
    'selector-readiness',
    '--work-dir',
    ambiguous.workDir,
    '--task',
    'task-001',
    '--compact',
  ]);
  assert.equal(cli.exitCode, 0);
  const cliResult = parseLastJsonLine(cli.stdout);
  assert.deepEqual(cliResult.tasks[0].ambiguities, [{
    storyId: 'synth-pad.shared',
    matchedTaskIds: ['task-001', 'task-002'],
    matchedSelectorsByTask: [
      { taskId: 'task-001', matchedSelectors: ['BUG-SHARED'] },
      { taskId: 'task-002', matchedSelectors: ['BUG-SHARED'] },
    ],
  }]);
});

test('Visual Workbench selector readiness blocks repair-task-only and multi-ref evidence owners', async () => {
  const repairContextRefs = await createSelectorFixture({
    tasks: [{
      id: 'task-001',
      description: 'Build synth pad and source-owned Workbench stories.',
      acceptanceCriteria: ['Synth pad renders with Visual Workbench coverage.'],
      status: 'completed',
      attempts: 1,
      dependencies: [],
      requiredRolePasses: ['ux'],
      feedbackItemRefs: [{ itemId: 'BUG-001', diffItemId: 'DIFF-001-BUG-001', workSurface: 'frontend' }],
    }, {
      id: 'task-008',
      displayTitle: 'Repair accepted Workbench selectors',
      description: 'Fix visual-workbench/manifest.json so accepted frontend selector groups select source-owned Workbench stories.',
      acceptanceCriteria: ['Fix source-owned Workbench stories without becoming the evidence owner.'],
      status: 'completed',
      attempts: 1,
      dependencies: [],
      addedBy: 'controller',
      requiredRolePasses: ['ux'],
      feedbackItemRefs: [{ itemId: 'BUG-001', diffItemId: 'DIFF-001-BUG-001', workSurface: 'frontend' }],
    }],
    stories: [selectorStory('synth-pad.by-item', ['BUG-001'])],
  });

  const contextResult = await getVisualWorkbenchSelectorReadinessFile({
    workDir: repairContextRefs.workDir,
  });
  const ownerTask = contextResult.tasks.find((task) => task.taskId === 'task-001');
  const repairContextTask = contextResult.tasks.find((task) => task.taskId === 'task-008');
  assert.equal(contextResult.status, 'ready');
  assert.equal(ownerTask?.readiness, 'ready');
  assert.deepEqual(ownerTask?.selections.map((selection) => selection.storyId), ['synth-pad.by-item']);
  assert.equal(repairContextTask?.readiness, 'not_applicable');
  assert.deepEqual(repairContextTask?.selectorIdentities, ['task-008']);
  assert.deepEqual(repairContextTask?.feedbackItemIds, ['BUG-001']);
  assert(repairContextTask?.blockers.includes('source_repair_task_not_evidence_owner'));

  const singleRefRepairSelection = await createSelectorFixture({
    tasks: [{
      id: 'task-008',
      displayTitle: 'Repair Visual Workbench coverage',
      description: 'Repair source-owned Visual Workbench coverage for blocked selector readiness.',
      acceptanceCriteria: ['Fix taskRelevance.defaultFor mappings in source-owned Workbench stories.'],
      status: 'completed',
      attempts: 1,
      dependencies: [],
      addedBy: 'controller',
      requiredRolePasses: ['ux'],
      feedbackItemRefs: [{ itemId: 'BUG-001', diffItemId: 'DIFF-001-BUG-001', workSurface: 'frontend' }],
    }],
    stories: [selectorStory('synth-pad.repair-owned-single-ref', ['task-008'])],
  });

  const singleRefResult = await getVisualWorkbenchSelectorReadinessFile({
    workDir: singleRefRepairSelection.workDir,
    taskId: 'task-008',
  });
  assert.equal(singleRefResult.status, 'blocked');
  assert(singleRefResult.tasks[0].blockers.includes('repair_task_only_story_selection'));
  assert(!singleRefResult.tasks[0].blockers.includes('multi_ref_visual_export_owner'));

  const repairWithoutSelections = await createSelectorFixture({
    tasks: [{
      id: 'task-008',
      displayTitle: 'Repair Visual Workbench coverage',
      description: 'Repair source-owned Visual Workbench coverage for blocked selector readiness.',
      acceptanceCriteria: ['Fix source-owned Workbench stories without becoming the evidence owner.'],
      status: 'completed',
      attempts: 1,
      dependencies: [],
      addedBy: 'controller',
      requiredRolePasses: ['ux'],
      feedbackItemRefs: [
        { itemId: 'BUG-001', diffItemId: 'DIFF-001-BUG-001', workSurface: 'frontend' },
        { itemId: 'BUG-002', diffItemId: 'DIFF-002-BUG-002', workSurface: 'frontend' },
      ],
    }],
    stories: [selectorStory('synth-pad.original-owned', ['task-001'])],
  });

  const notOwnerResult = await getVisualWorkbenchSelectorReadinessFile({
    workDir: repairWithoutSelections.workDir,
    taskId: 'task-008',
  });

  assert.equal(notOwnerResult.status, 'not_applicable');
  assert.equal(notOwnerResult.tasks[0].readiness, 'not_applicable');
  assert(notOwnerResult.tasks[0].blockers.includes('source_repair_task_not_evidence_owner'));
  assert(!notOwnerResult.tasks[0].blockers.includes('no_story_selection'));

  const fixture = await createSelectorFixture({
    tasks: [{
      id: 'task-001',
      description: 'Build synth pad and source-owned Workbench stories.',
      acceptanceCriteria: ['Synth pad renders with Visual Workbench coverage.'],
      status: 'completed',
      attempts: 1,
      dependencies: [],
      requiredRolePasses: ['ux'],
      feedbackItemRefs: [{ itemId: 'BUG-001', diffItemId: 'DIFF-001-BUG-001', workSurface: 'frontend' }],
    }, {
      id: 'task-008',
      displayTitle: 'Repair Visual Workbench coverage',
      description: 'Repair source-owned Visual Workbench coverage for blocked selector readiness.',
      acceptanceCriteria: ['Fix taskRelevance.defaultFor mappings in source-owned Workbench stories.'],
      status: 'completed',
      attempts: 1,
      dependencies: [],
      addedBy: 'controller',
      requiredRolePasses: ['ux'],
      feedbackItemRefs: [
        { itemId: 'BUG-001', diffItemId: 'DIFF-001-BUG-001', workSurface: 'frontend' },
        { itemId: 'BUG-002', diffItemId: 'DIFF-002-BUG-002', workSurface: 'frontend' },
      ],
    }],
    stories: [selectorStory('synth-pad.repair-owned', ['task-008'])],
  });

  const result = await getVisualWorkbenchSelectorReadinessFile({
    workDir: fixture.workDir,
    taskId: 'task-008',
  });

  assert.equal(result.status, 'blocked');
  assert.equal(result.tasks[0].readiness, 'blocked');
  assert(result.tasks[0].blockers.includes('repair_task_only_story_selection'));
  assert(!result.tasks[0].blockers.includes('multi_ref_visual_export_owner'));
  assert.deepEqual(result.tasks[0].feedbackItemIds, ['BUG-001', 'BUG-002']);
  assert.deepEqual(result.tasks[0].diffItemIds, ['DIFF-001-BUG-001', 'DIFF-002-BUG-002']);
  assert.deepEqual(result.tasks[0].exportSelections, [{
    storyId: 'synth-pad.repair-owned',
    viewportName: 'desktop',
  }]);

  const originalTask = await getVisualWorkbenchSelectorReadinessFile({
    workDir: fixture.workDir,
    taskId: 'task-001',
  });
  assert.equal(originalTask.status, 'blocked');
  assert(originalTask.tasks[0].blockers.includes('no_story_selection'));
});

test('Visual Workbench selector readiness reports duplicate viewport names without defaulting', async () => {
  const fixture = await createSelectorFixture({
    feedbackItemRefs: [{ itemId: 'BUG-001', diffItemId: 'DIFF-001-BUG-001', workSurface: 'frontend' }],
    stories: [selectorStory('synth-pad.duplicate-viewports', ['BUG-001'], ['desktop', 'desktop'])],
  });

  const result = await getVisualWorkbenchSelectorReadinessFile({
    workDir: fixture.workDir,
    taskId: 'task-001',
  });

  assert.equal(result.status, 'blocked');
  assert.deepEqual(result.tasks[0].exportSelections, [
    { storyId: 'synth-pad.duplicate-viewports', viewportName: 'desktop', feedbackItemId: 'BUG-001', diffItemId: 'DIFF-001-BUG-001' },
    { storyId: 'synth-pad.duplicate-viewports', viewportName: 'desktop', feedbackItemId: 'BUG-001', diffItemId: 'DIFF-001-BUG-001' },
  ]);
  assert(result.tasks[0].blockers.includes('story_viewport_name_duplicate:synth-pad.duplicate-viewports:desktop'));
});

test('Visual Workbench evidence-chain readiness surfaces selector ownership blockers', async () => {
  const repairFixture = await createSelectorFixture({
    tasks: [{
      id: 'task-001',
      description: 'Build synth pad and source-owned Workbench stories.',
      acceptanceCriteria: ['Synth pad renders with Visual Workbench coverage.'],
      status: 'completed',
      attempts: 1,
      dependencies: [],
      requiredRolePasses: ['ux'],
      feedbackItemRefs: [{ itemId: 'BUG-001', diffItemId: 'DIFF-001-BUG-001', workSurface: 'frontend' }],
    }, {
      id: 'task-008',
      displayTitle: 'Repair Visual Workbench coverage',
      description: 'Repair source-owned Visual Workbench coverage for blocked selector readiness.',
      acceptanceCriteria: ['Fix taskRelevance.defaultFor mappings in source-owned Workbench stories.'],
      status: 'completed',
      attempts: 1,
      dependencies: [],
      addedBy: 'controller',
      requiredRolePasses: ['ux'],
      feedbackItemRefs: [
        { itemId: 'BUG-001', diffItemId: 'DIFF-001-BUG-001', workSurface: 'frontend' },
        { itemId: 'BUG-002', diffItemId: 'DIFF-002-BUG-002', workSurface: 'frontend' },
      ],
    }],
    stories: [selectorStory('synth-pad.repair-owned', ['task-008'])],
  });

  const repairReadiness = await getVisualWorkbenchEvidenceChainReadinessFile({
    workDir: repairFixture.workDir,
    taskId: 'task-008',
    projectId: 'project-1',
  });
  const repairSelector = checkByStage(repairReadiness, 'visual_workbench_selector_readiness');
  assert.equal(repairSelector.status, 'blocked');
  assert(repairSelector.blockers.includes('repair_task_only_story_selection'));
  assert(!repairSelector.blockers.includes('multi_ref_visual_export_owner'));
  const repairExport = checkByStage(repairReadiness, 'visual_workbench_evidence_export');
  assert(repairExport.blockers.includes('selector_readiness_blocked'));
  assert(repairExport.blockers.includes('selector:repair_task_only_story_selection'));

  const ambiguousFixture = await createSelectorFixture({
    tasks: [{
      id: 'task-001',
      description: 'Fix synth pad.',
      acceptanceCriteria: ['Task one.'],
      status: 'completed',
      attempts: 1,
      dependencies: [],
      feedbackItemRefs: [{ itemId: 'BUG-SHARED', diffItemId: 'DIFF-001-BUG-SHARED', workSurface: 'frontend' }],
    }, {
      id: 'task-002',
      description: 'Fix related synth pad.',
      acceptanceCriteria: ['Task two.'],
      status: 'completed',
      attempts: 1,
      dependencies: [],
      feedbackItemRefs: [{ itemId: 'BUG-SHARED', diffItemId: 'DIFF-001-BUG-SHARED', workSurface: 'frontend' }],
    }],
    stories: [selectorStory('synth-pad.shared', ['BUG-SHARED'])],
  });

  const ambiguousReadiness = await getVisualWorkbenchEvidenceChainReadinessFile({
    workDir: ambiguousFixture.workDir,
    taskId: 'task-001',
  });
  const ambiguousSelector = checkByStage(ambiguousReadiness, 'visual_workbench_selector_readiness');
  assert.equal(ambiguousSelector.status, 'blocked');
  assert(ambiguousSelector.blockers.includes('story_matches_multiple_tasks:synth-pad.shared'));
  assert(checkByStage(ambiguousReadiness, 'visual_workbench_evidence_export').blockers.includes('selector:story_matches_multiple_tasks:synth-pad.shared'));
});

test('Visual Workbench evidence-chain readiness does not offer export for source repair tasks', async () => {
  const fixture = await createFixture({
    feedbackItemRefs: [
      { itemId: 'BUG-001', diffItemId: 'DIFF-001-BUG-001', workSurface: 'frontend' },
      { itemId: 'BUG-002', diffItemId: 'DIFF-002-BUG-002', workSurface: 'frontend' },
    ],
    taskOverrides: {
      displayTitle: 'Repair Visual Workbench coverage',
      description: 'Repair source-owned Visual Workbench coverage.',
      acceptanceCriteria: ['Fix taskRelevance.defaultFor mappings.'],
      addedBy: 'controller',
    },
  });

  const readiness = await getVisualWorkbenchEvidenceChainReadinessFile({
    workDir: fixture.workDir,
    runPath: fixture.runPath,
    taskId: 'task-001',
    storyId: 'synth-pad.playing.desktop',
    viewportName: 'desktop',
    projectId: 'project-1',
  });

  assert.equal(checkByStage(readiness, 'visual_workbench_capture_selection').status, 'ready');
  const selectorCheck = checkByStage(readiness, 'visual_workbench_selector_readiness');
  assert.equal(selectorCheck.status, 'not_applicable');
  assert(selectorCheck.blockers.includes('source_repair_task_not_evidence_owner'));
  const exportCheck = checkByStage(readiness, 'visual_workbench_evidence_export');
  assert.equal(exportCheck.status, 'blocked');
  assert(exportCheck.blockers.includes('selector_readiness_not_applicable'));
  assert.doesNotMatch(readiness.nextCommands.join('\n'), /visual-workbench export-evidence/);
});

test('Visual Workbench shell policy is disabled by default and read-only', async () => {
  const fixture = await createSelectorFixture({
    feedbackItemRefs: [{ itemId: 'BUG-001', diffItemId: 'DIFF-001-BUG-001', workSurface: 'frontend' }],
    stories: [selectorStory('synth-pad.by-item', ['BUG-001'])],
    workbenchOverrides: {
      baseUrlEnv: 'VISUAL_WORKBENCH_BASE_URL',
    },
  });
  const planPath = path.join(fixture.workDir, '.ralph', 'plan.json');
  const manifestPath = path.join(fixture.workDir, 'visual-workbench', 'manifest.json');
  const beforePlan = await readFile(planPath, 'utf8');
  const beforeManifest = await readFile(manifestPath, 'utf8');

  const result = await getVisualWorkbenchShellPolicyFile({
    workDir: fixture.workDir,
    ralphConfig: RalphConfigSchema.parse({}),
  });

  assert.equal(result.schemaVersion, VISUAL_WORKBENCH_SHELL_POLICY_SCHEMA_VERSION);
  assert.equal(result.status, 'blocked');
  assert.equal(result.manifest.status, 'ready');
  assert.equal(result.policy.mode, 'disabled');
  assert.equal(result.policy.allowedServeCommandCount, 0);
  assert.equal(result.policy.allowedBaseUrlEnvCount, 0);
  assert.equal(result.workbench.serveCommand, 'npm run visual-workbench');
  assert.equal(result.workbench.baseUrlEnv, 'VISUAL_WORKBENCH_BASE_URL');
  assert(result.blockers.includes('visual_workbench_executor_capture_shell_disabled'));
  assert.equal(JSON.parse(formatVisualWorkbenchShellPolicyResult(result, true)).schemaVersion, VISUAL_WORKBENCH_SHELL_POLICY_SCHEMA_VERSION);
  assert.equal(await readFile(planPath, 'utf8'), beforePlan);
  assert.equal(await readFile(manifestPath, 'utf8'), beforeManifest);
});

test('Visual Workbench shell policy allows only exact serve command and baseUrlEnv matches', async () => {
  const fixture = await createSelectorFixture({
    feedbackItemRefs: [{ itemId: 'BUG-001', diffItemId: 'DIFF-001-BUG-001', workSurface: 'frontend' }],
    stories: [selectorStory('synth-pad.by-item', ['BUG-001'])],
    workbenchOverrides: {
      baseUrlEnv: 'VISUAL_WORKBENCH_BASE_URL',
    },
  });

  const allowedConfig = RalphConfigSchema.parse({
    visualWorkbench: {
      executorCaptureShell: {
        mode: 'allowlisted',
        allowedServeCommands: ['npm run visual-workbench'],
        allowedBaseUrlEnv: ['VISUAL_WORKBENCH_BASE_URL'],
      },
    },
  });
  const allowed = await getVisualWorkbenchShellPolicyFile({
    workDir: fixture.workDir,
    ralphConfig: allowedConfig,
  });
  assert.equal(allowed.status, 'allowed');
  assert.deepEqual(allowed.blockers, []);

  const blockedConfig = RalphConfigSchema.parse({
    visualWorkbench: {
      executorCaptureShell: {
        mode: 'allowlisted',
        allowedServeCommands: ['npm run other-workbench'],
        allowedBaseUrlEnv: ['OTHER_WORKBENCH_BASE_URL'],
      },
    },
  });
  const blocked = await getVisualWorkbenchShellPolicyFile({
    workDir: fixture.workDir,
    ralphConfig: blockedConfig,
  });
  assert.equal(blocked.status, 'blocked');
  assert(blocked.blockers.includes('serve_command_not_allowlisted'));
  assert(blocked.blockers.includes('base_url_env_not_allowlisted'));

  assert.throws(() => RalphConfigSchema.parse({
    visualWorkbench: {
      executorCaptureShell: {
        mode: 'allowlisted',
        allowedServeCommands: [],
        allowedBaseUrlEnv: ['VISUAL_WORKBENCH_BASE_URL'],
      },
    },
  }), /requires allowedServeCommands/);
});

test('Visual Workbench shell policy blocks missing baseUrlEnv and invalid manifests without self-authorization', async () => {
  const missingEnv = await createSelectorFixture({
    feedbackItemRefs: [{ itemId: 'BUG-001', diffItemId: 'DIFF-001-BUG-001', workSurface: 'frontend' }],
    stories: [selectorStory('synth-pad.by-item', ['BUG-001'])],
  });
  const ralphConfig = RalphConfigSchema.parse({
    visualWorkbench: {
      executorCaptureShell: {
        mode: 'allowlisted',
        allowedServeCommands: ['npm run visual-workbench'],
        allowedBaseUrlEnv: ['VISUAL_WORKBENCH_BASE_URL'],
      },
    },
  });
  const missingEnvResult = await getVisualWorkbenchShellPolicyFile({
    workDir: missingEnv.workDir,
    ralphConfig,
  });
  assert.equal(missingEnvResult.status, 'blocked');
  assert(missingEnvResult.blockers.includes('base_url_env_missing'));

  await writeFile(path.join(missingEnv.workDir, 'visual-workbench', 'manifest.json'), JSON.stringify({
    visualWorkbench: {
      executorCaptureShell: {
        mode: 'allowlisted',
        allowedServeCommands: ['npm run visual-workbench'],
        allowedBaseUrlEnv: ['VISUAL_WORKBENCH_BASE_URL'],
      },
    },
  }, null, 2));
  const invalidManifest = await getVisualWorkbenchShellPolicyFile({
    workDir: missingEnv.workDir,
    ralphConfig,
  });
  assert.equal(invalidManifest.status, 'blocked');
  assert.equal(invalidManifest.manifest.status, 'blocked');
  assert(invalidManifest.blockers.includes('manifest_not_ready'));
  assert(invalidManifest.blockers.includes('manifest_contract_invalid'));
});

test('Visual Workbench shell policy evaluator is pure and fail-closed', () => {
  const disabled = evaluateVisualWorkbenchCaptureShellPolicy({
    ralphConfig: RalphConfigSchema.parse({}),
    serveCommand: 'npm run visual-workbench',
    baseUrlEnv: 'VISUAL_WORKBENCH_BASE_URL',
  });
  assert.equal(disabled.status, 'blocked');
  assert(disabled.blockers.includes('visual_workbench_executor_capture_shell_disabled'));

  const allowed = evaluateVisualWorkbenchCaptureShellPolicy({
    ralphConfig: RalphConfigSchema.parse({
      visualWorkbench: {
        executorCaptureShell: {
          mode: 'allowlisted',
          allowedServeCommands: ['npm run visual-workbench'],
          allowedBaseUrlEnv: ['VISUAL_WORKBENCH_BASE_URL'],
        },
      },
    }),
    serveCommand: ' npm run visual-workbench ',
    baseUrlEnv: ' VISUAL_WORKBENCH_BASE_URL ',
  });
  assert.equal(allowed.status, 'allowed');
  assert.deepEqual(allowed.blockers, []);
});

test('Visual Workbench evidence-chain readiness points to the next explicit boundary', async () => {
  const fixture = await createFixture();
  const beforeReadinessPlan = await readFile(path.join(fixture.workDir, '.ralph', 'plan.json'), 'utf8');

  const readyForExport = await getVisualWorkbenchEvidenceChainReadinessFile({
    workDir: fixture.workDir,
    runPath: fixture.runPath,
    taskId: 'task-001',
    storyId: 'synth-pad.playing.desktop',
    viewportName: 'desktop',
    projectId: 'project-1',
  });

  assert.equal(readyForExport.schemaVersion, VISUAL_WORKBENCH_EVIDENCE_CHAIN_READINESS_SCHEMA_VERSION);
  assert.equal(readyForExport.status, 'ready_for_export');
  assert.equal(readyForExport.task.status, 'pending');
  assert.equal(readyForExport.task.title, 'Make the synth pad playing state visible.');
  assert.deepEqual(readyForExport.task.feedbackItemIds, ['BUG-001']);
  assert.equal(readyForExport.task.totalVerificationEvidenceRows, 0);
  assert.equal(readyForExport.task.visualWorkbenchEvidenceRows, 0);
  assert.equal(readyForExport.plan.status, 'ready');
  assert.equal(readyForExport.plan.path, path.join(fixture.workDir, '.ralph', 'plan.json'));
  assert.equal(readyForExport.plan.reasonCode, null);
  assert.deepEqual(readyForExport.plan.blockers, []);
  assert.equal(checkByStage(readyForExport, 'visual_workbench_selector_readiness').status, 'ready');
  assert.equal(checkByStage(readyForExport, 'visual_workbench_capture_selection').status, 'ready');
  assert.equal(checkByStage(readyForExport, 'visual_workbench_capture_viewer').status, 'ready');
  assert.equal(readyForExport.captureViewer.viewerPath, path.join(fixture.runDir, 'index.html'));
  assert.equal(readyForExport.captureViewer.exists, false);
  assert.equal(checkByStage(readyForExport, 'visual_workbench_evidence_export').status, 'ready');
  assert.equal(checkByStage(readyForExport, 'visual_workbench_assessment').status, 'not_applicable');
  assert.match(readyForExport.nextCommands[0], /visual-workbench render-viewer/);
  assert.match(readyForExport.nextCommands[1], /visual-workbench export-evidence/);
  assert.equal(await readFile(path.join(fixture.workDir, '.ralph', 'plan.json'), 'utf8'), beforeReadinessPlan);
  assert.equal(JSON.parse(formatVisualWorkbenchEvidenceChainReadinessResult(readyForExport)).schemaVersion, VISUAL_WORKBENCH_EVIDENCE_CHAIN_READINESS_SCHEMA_VERSION);

  await writeFile(path.join(fixture.runDir, 'index.html'), '<!doctype html><title>Workbench</title>');
  const readyWithViewer = await getVisualWorkbenchEvidenceChainReadinessFile({
    workDir: fixture.workDir,
    runPath: fixture.runPath,
    taskId: 'task-001',
    storyId: 'synth-pad.playing.desktop',
    viewportName: 'desktop',
  });
  assert.equal(checkByStage(readyWithViewer, 'visual_workbench_capture_viewer').status, 'already_recorded');
  assert.equal(readyWithViewer.captureViewer.exists, true);
  assert.doesNotMatch(readyWithViewer.nextCommands.join('\n'), /render-viewer/);

  const exportResult = await exportVisualWorkbenchEvidenceFile({
    workDir: fixture.workDir,
    runPath: fixture.runPath,
    taskId: 'task-001',
    storyId: 'synth-pad.playing.desktop',
    viewportName: 'desktop',
  });
  const readyForAssessment = await getVisualWorkbenchEvidenceChainReadinessFile({
    workDir: fixture.workDir,
    taskId: 'task-001',
  });
  assert.equal(readyForAssessment.status, 'ready_for_progress_publish');
  assert.equal(readyForAssessment.task.status, 'pending');
  assert.equal(readyForAssessment.task.totalVerificationEvidenceRows, 1);
  assert.equal(readyForAssessment.task.visualWorkbenchEvidenceRows, 1);
  assert.equal(readyForAssessment.selectedEvidenceRef, exportResult.evidenceRefs[0]);
  assert.equal(checkByStage(readyForAssessment, 'visual_workbench_evidence_export').status, 'already_recorded');
  assert.equal(checkByStage(readyForAssessment, 'visual_workbench_assessment').status, 'ready');
  assert.equal(checkByStage(readyForAssessment, 'visual_workbench_progress_publish').status, 'ready');

  await assessVisualWorkbenchEvidenceFile({
    workDir: fixture.workDir,
    taskId: 'task-001',
    evidenceRef: exportResult.evidenceRefs[0],
    result: 'pass',
    assessment: 'Manual review confirms the story claim.',
  });
  const readyForPublish = await getVisualWorkbenchEvidenceChainReadinessFile({
    workDir: fixture.workDir,
    taskId: 'task-001',
  });
  assert.equal(readyForPublish.status, 'ready_for_progress_publish');
  assert.equal(checkByStage(readyForPublish, 'visual_workbench_progress_publish').status, 'ready');

  await publishVisualWorkbenchProgressFile({ workDir: fixture.workDir, taskId: 'task-001' });
  const publishedWithoutProject = await getVisualWorkbenchEvidenceChainReadinessFile({
    workDir: fixture.workDir,
    taskId: 'task-001',
  });
  assert.equal(publishedWithoutProject.status, 'blocked');
  assert.equal(checkByStage(publishedWithoutProject, 'visual_workbench_progress_publish').status, 'published');
  assert(checkByStage(publishedWithoutProject, 'arena_visual_evidence_readback').blockers.includes('project_id_not_provided'));

  const readyForArena = await getVisualWorkbenchEvidenceChainReadinessFile({
    workDir: fixture.workDir,
    taskId: 'task-001',
    projectId: 'project-1',
  });
  assert.equal(readyForArena.status, 'ready_for_arena_readback');
  assert.equal(checkByStage(readyForArena, 'visual_workbench_progress_publish').status, 'published');
  assert.equal(checkByStage(readyForArena, 'arena_visual_evidence_readback').status, 'ready');
  assert.match(readyForArena.nextCommands.join('\n'), /project_proof_reviews --project-id project-1/);
  assert.match(readyForArena.nextCommands.join('\n'), /project_visual_evidence_artifact_check --project-id project-1/);
  assert(readyForArena.notes.some((note) => /after project_proof_reviews returns current visualEvidenceReviews/i.test(note)));

  const afterReadinessPlan = await readFile(path.join(fixture.workDir, '.ralph', 'plan.json'), 'utf8');
  assert.notEqual(afterReadinessPlan, beforeReadinessPlan);
  assert.doesNotMatch(JSON.stringify(readyForArena), /artifactPath|\.ralph\/visual-workbench/);
});

test('Visual Workbench evidence-chain readiness explains capture-only canaries without plan truth', async () => {
  const fixture = await createFixture();
  const captureOnlyWorkDir = await mkdtemp(path.join(os.tmpdir(), 'visual-workbench-capture-only-work-'));

  const result = await getVisualWorkbenchEvidenceChainReadinessFile({
    workDir: captureOnlyWorkDir,
    runPath: fixture.runPath,
    taskId: 'task-001',
    storyId: 'synth-pad.playing.desktop',
    viewportName: 'desktop',
    projectId: 'project-1',
  });

  assert.equal(result.status, 'blocked');
  assert.equal(result.plan.status, 'blocked');
  assert.equal(result.plan.path, path.join(captureOnlyWorkDir, '.ralph', 'plan.json'));
  assert.equal(result.plan.reasonCode, 'plan_missing');
  assert.deepEqual(result.plan.blockers, ['plan_missing']);
  assert.equal(checkByStage(result, 'visual_workbench_capture_selection').status, 'ready');
  assert.equal(checkByStage(result, 'visual_workbench_evidence_export').status, 'blocked');
  assert(checkByStage(result, 'visual_workbench_evidence_export').blockers.includes('plan_missing'));
  assert.equal(checkByStage(result, 'arena_visual_evidence_readback').status, 'blocked');
  assert(checkByStage(result, 'arena_visual_evidence_readback').blockers.includes('progress_visual_evidence_not_published'));
  assert.equal(
    checkByStage(result, 'arena_visual_evidence_readback').commandHint,
    'services/arena-ctl/cli.sh project_proof_reviews --project-id project-1',
  );
});

test('Visual Workbench evidence-chain readiness reports plan readability as the plan boundary', async () => {
  const fixture = await createFixture();
  const unreadableWorkDir = await mkdtemp(path.join(os.tmpdir(), 'visual-workbench-chain-bad-plan-'));
  await mkdir(path.join(unreadableWorkDir, '.ralph'), { recursive: true });
  await writeFile(path.join(unreadableWorkDir, '.ralph', 'plan.json'), '{not-json');

  const result = await getVisualWorkbenchEvidenceChainReadinessFile({
    workDir: unreadableWorkDir,
    runPath: fixture.runPath,
    taskId: 'task-001',
    storyId: 'synth-pad.playing.desktop',
    viewportName: 'desktop',
    projectId: 'project-1',
  });

  assert.equal(result.status, 'blocked');
  assert.equal(result.plan.status, 'blocked');
  assert.equal(result.plan.path, path.join(unreadableWorkDir, '.ralph', 'plan.json'));
  assert.equal(result.plan.reasonCode, 'plan_unreadable');
  assert.match(result.plan.blockers[0], /^plan_unreadable:/);
  assert.equal(checkByStage(result, 'visual_workbench_capture_selection').status, 'ready');
  assert.equal(checkByStage(result, 'visual_workbench_evidence_export').status, 'blocked');
  assert(checkByStage(result, 'visual_workbench_evidence_export').blockers.some((blocker) => /^plan_unreadable:/.test(blocker)));
});

test('Visual Workbench evidence-chain readiness keeps task selection separate from plan readiness', async () => {
  const fixture = await createFixture();

  const noTask = await getVisualWorkbenchEvidenceChainReadinessFile({
    workDir: fixture.workDir,
    runPath: fixture.runPath,
    storyId: 'synth-pad.playing.desktop',
    viewportName: 'desktop',
  });

  assert.equal(noTask.status, 'blocked');
  assert.equal(noTask.plan.status, 'ready');
  assert.equal(noTask.plan.reasonCode, null);
  assert.deepEqual(noTask.plan.blockers, []);
  assert(checkByStage(noTask, 'visual_workbench_evidence_export').blockers.includes('task_not_selected'));

  const missingTask = await getVisualWorkbenchEvidenceChainReadinessFile({
    workDir: fixture.workDir,
    runPath: fixture.runPath,
    taskId: 'task-does-not-exist',
    storyId: 'synth-pad.playing.desktop',
    viewportName: 'desktop',
  });

  assert.equal(missingTask.status, 'blocked');
  assert.equal(missingTask.plan.status, 'ready');
  assert.equal(missingTask.plan.reasonCode, null);
  assert.deepEqual(missingTask.plan.blockers, []);
  assert(checkByStage(missingTask, 'visual_workbench_evidence_export').blockers.includes('task_not_found'));
  assert(!checkByStage(missingTask, 'visual_workbench_evidence_export').blockers.includes('plan_missing'));
});

test('Visual Workbench evidence-chain readiness does not rehash raw screenshots', async () => {
  const fixture = await createFixture();
  await writeFile(fixture.screenshotPath, 'tampered-workbench-png');

  const readiness = await getVisualWorkbenchEvidenceChainReadinessFile({
    workDir: fixture.workDir,
    runPath: fixture.runPath,
    taskId: 'task-001',
    storyId: 'synth-pad.playing.desktop',
    viewportName: 'desktop',
  });

  assert.equal(readiness.status, 'ready_for_export');
  assert.equal(checkByStage(readiness, 'visual_workbench_capture_selection').status, 'ready');
  assert.equal(checkByStage(readiness, 'visual_workbench_evidence_export').status, 'ready');

  await assert.rejects(() => exportVisualWorkbenchEvidenceFile({
    workDir: fixture.workDir,
    runPath: fixture.runPath,
    taskId: 'task-001',
    storyId: 'synth-pad.playing.desktop',
    viewportName: 'desktop',
  }), /digest mismatch/);
});

test('Visual Workbench evidence-chain readiness requires explicit evidence ref when sources are ambiguous', async () => {
  const fixture = await createExportedFixture();
  const otherEvidenceRef = 'visual-workbench-capture:other-story:desktop:bbbbbbbbbbbb';
  await mutatePlan(fixture.workDir, (plan) => {
    const first = plan.phases[0].tasks[0].verificationEvidence[0];
    plan.phases[0].tasks[0].verificationEvidence.push({
      ...first,
      ref: otherEvidenceRef,
      summary: 'Second source row for ambiguity testing.',
      target: {
        ...first.target,
        route: '/__visual/other-story',
      },
    });
  });

  const ambiguous = await getVisualWorkbenchEvidenceChainReadinessFile({
    workDir: fixture.workDir,
    taskId: 'task-001',
  });
  assert.equal(ambiguous.status, 'blocked');
  assert.equal(checkByStage(ambiguous, 'visual_workbench_assessment').status, 'blocked');
  assert(checkByStage(ambiguous, 'visual_workbench_assessment').blockers.includes('ambiguous_evidence_selection'));
  assert.equal(checkByStage(ambiguous, 'visual_workbench_progress_publish').status, 'blocked');

  await mkdir(path.join(fixture.workDir, '.arena'), { recursive: true });
  await writeFile(path.join(fixture.workDir, '.arena', 'progress.json'), JSON.stringify({
    steps: [{
      id: 'task-001',
      visualEvidence: [{ sourceEvidenceRef: otherEvidenceRef }],
    }],
  }, null, 2));

  const selected = await getVisualWorkbenchEvidenceChainReadinessFile({
    workDir: fixture.workDir,
    taskId: 'task-001',
    evidenceRef: fixture.exportResult.evidenceRefs[0],
  });
  assert.equal(selected.status, 'ready_for_progress_publish');
  assert.equal(selected.selectedEvidenceRef, fixture.exportResult.evidenceRefs[0]);
  assert.equal(checkByStage(selected, 'visual_workbench_assessment').status, 'ready');
  assert.equal(checkByStage(selected, 'visual_workbench_progress_publish').status, 'ready');
});

test('Visual Workbench progress publish refuses malformed existing Arena progress', async () => {
  const fixture = await createExportedFixture();
  await mkdir(path.join(fixture.workDir, '.arena'), { recursive: true });
  await writeFile(path.join(fixture.workDir, '.arena', 'progress.json'), JSON.stringify([]));

  await assert.rejects(() => publishVisualWorkbenchProgressFile({
    workDir: fixture.workDir,
  }), /Arena progress file must be a JSON object/);
});

test('Visual Workbench status reports invalid and orphan visual rows', async () => {
  const fixture = await createExportedFixture();
  await addAssessmentRow(fixture, {
    ref: 'visual-workbench-assessment:manual_note:synth-pad.playing.desktop:desktop:aaaaaaaaaaaa:111111111111',
    result: 'pass',
    summary: 'Missing sourceEvidenceRef should be invalid.',
  });
  await addAssessmentRow(fixture, {
    ref: 'visual-workbench-assessment:manual_note:missing:desktop:aaaaaaaaaaaa:222222222222',
    result: 'pass',
    summary: 'Source does not exist.',
    sourceEvidenceRef: 'visual-workbench-capture:missing:desktop:aaaaaaaaaaaa',
  });
  await addAssessmentRow(fixture, {
    ref: 'visual-scenario-assessment:manual_note:route:333333333333',
    result: 'pass',
    summary: 'Scenario assessment belongs to another evidence family.',
    sourceEvidenceRef: 'visual-scenario-run:route:333333333333',
  });
  await mutatePlan(fixture.workDir, (plan) => {
    plan.phases[0].tasks[0].verificationEvidence.push({
      kind: 'screenshot',
      ref: 'generic:screenshot',
      result: 'pass',
      summary: 'Generic screenshot should be ignored.',
      feedbackItemIds: ['BUG-001'],
      taskId: 'task-001',
    });
  });

  const status = await getVisualWorkbenchStatusFile({ workDir: fixture.workDir });
  assert.equal(status.summary.sources, 1);
  assert.equal(status.summary.assessments, 0);
  assert.equal(status.summary.invalidRows, 1);
  assert.equal(status.summary.orphanAssessments, 1);
  assert.equal(status.invalidRows[0].reason, 'assessment_missing_source_evidence_ref');
  assert.equal(status.orphanAssessments[0].reason, 'source_evidence_not_found_on_task');
});

test('Visual Workbench evidence CLI exports, assesses and reads status', async () => {
  const selectorFixture = await createSelectorFixture({
    feedbackItemRefs: [{ itemId: 'BUG-001', diffItemId: 'DIFF-001-BUG-001', workSurface: 'frontend' }],
    stories: [selectorStory('synth-pad.by-item', ['BUG-001'])],
  });
  const selector = await runRalphCli([
    'visual-workbench',
    'selector-readiness',
    '--work-dir',
    selectorFixture.workDir,
    '--task',
    'task-001',
    '--compact',
  ]);
  assert.equal(selector.exitCode, 0);
  const selectorJson = parseLastJsonLine(selector.stdout);
  assert.equal(selectorJson.schemaVersion, VISUAL_WORKBENCH_SELECTOR_READINESS_SCHEMA_VERSION);
  assert.equal(selectorJson.status, 'ready');
  assert.deepEqual(selectorJson.tasks[0].exportSelections, [{
    storyId: 'synth-pad.by-item',
    viewportName: 'desktop',
    feedbackItemId: 'BUG-001',
    diffItemId: 'DIFF-001-BUG-001',
  }]);

  const policyFixture = await createSelectorFixture({
    feedbackItemRefs: [{ itemId: 'BUG-001', diffItemId: 'DIFF-001-BUG-001', workSurface: 'frontend' }],
    stories: [selectorStory('synth-pad.by-item', ['BUG-001'])],
    workbenchOverrides: {
      baseUrlEnv: 'VISUAL_WORKBENCH_BASE_URL',
    },
  });
  await writeFile(path.join(policyFixture.workDir, 'ralph.config.json'), JSON.stringify({
    visualWorkbench: {
      executorCaptureShell: {
        mode: 'allowlisted',
        allowedServeCommands: ['npm run visual-workbench'],
        allowedBaseUrlEnv: ['VISUAL_WORKBENCH_BASE_URL'],
      },
    },
  }, null, 2));
  const shellPolicy = await runRalphCli([
    'visual-workbench',
    'shell-policy',
    '--work-dir',
    policyFixture.workDir,
    '--compact',
  ]);
  assert.equal(shellPolicy.exitCode, 0);
  const shellPolicyJson = parseLastJsonLine(shellPolicy.stdout);
  assert.equal(shellPolicyJson.schemaVersion, VISUAL_WORKBENCH_SHELL_POLICY_SCHEMA_VERSION);
  assert.equal(shellPolicyJson.status, 'allowed');

  const fixture = await createFixture();
  const readinessBeforeExport = await runRalphCli([
    'visual-workbench',
    'evidence-chain-readiness',
    '--work-dir',
    fixture.workDir,
    '--run',
    fixture.runPath,
    '--task',
    'task-001',
    '--story',
    'synth-pad.playing.desktop',
    '--viewport',
    'desktop',
    '--project-id',
    'project-1',
    '--compact',
  ]);
  assert.equal(readinessBeforeExport.exitCode, 0);
  assert.equal(parseLastJsonLine(readinessBeforeExport.stdout).status, 'ready_for_export');

  const exported = await runRalphCli([
    'visual-workbench',
    'export-evidence',
    '--work-dir',
    fixture.workDir,
    '--run',
    fixture.runPath,
    '--task',
    'task-001',
    '--story',
    'synth-pad.playing.desktop',
    '--viewport',
    'desktop',
    '--compact',
  ]);
  assert.equal(exported.exitCode, 0);
  const exportJson = parseLastJsonLine(exported.stdout);
  assert.equal(exportJson.schemaVersion, VISUAL_WORKBENCH_EVIDENCE_EXPORT_SCHEMA_VERSION);

  const assessed = await runRalphCli([
    'visual-workbench',
    'assess',
    '--work-dir',
    fixture.workDir,
    '--task',
    'task-001',
    '--evidence-ref',
    exportJson.evidenceRefs[0],
    '--result',
    'pass',
    '--assessment',
    'Manual review confirms the story claim.',
    '--compact',
  ]);
  assert.equal(assessed.exitCode, 0);
  assert.equal(parseLastJsonLine(assessed.stdout).schemaVersion, VISUAL_WORKBENCH_ASSESSMENT_SCHEMA_VERSION);

  const status = await runRalphCli([
    'visual-workbench',
    'status',
    '--work-dir',
    fixture.workDir,
    '--compact',
  ]);
  assert.equal(status.exitCode, 0);
  assert.equal(parseLastJsonLine(status.stdout).summary.sources, 1);

  const published = await runRalphCli([
    'visual-workbench',
    'publish-progress',
    '--work-dir',
    fixture.workDir,
    '--compact',
  ]);
  assert.equal(published.exitCode, 0);
  const publishedJson = parseLastJsonLine(published.stdout);
  assert.equal(publishedJson.schemaVersion, VISUAL_WORKBENCH_PROGRESS_PUBLISH_SCHEMA_VERSION);
  assert.equal(publishedJson.summary.visualEvidenceRows, 1);

  const readinessAfterPublish = await runRalphCli([
    'visual-workbench',
    'evidence-chain-readiness',
    '--work-dir',
    fixture.workDir,
    '--task',
    'task-001',
    '--project-id',
    'project-1',
    '--compact',
  ]);
  assert.equal(readinessAfterPublish.exitCode, 0);
  assert.equal(parseLastJsonLine(readinessAfterPublish.stdout).status, 'ready_for_arena_readback');
});

async function runRalphCli(args: string[]) {
  return execa(process.execPath, ['--import', 'tsx', 'src/index.ts', ...args], {
    cwd: packageRoot,
    reject: false,
  });
}

function parseLastJsonLine(stdout: string) {
  const line = stdout.trim().split('\n').reverse().find((candidate) => candidate.trim().startsWith('{'));
  if (!line) throw new Error(`No JSON line in stdout: ${stdout}`);
  return JSON.parse(line);
}

function checkByStage(
  result: Awaited<ReturnType<typeof getVisualWorkbenchEvidenceChainReadinessFile>>,
  stageId: string,
) {
  const check = result.checks.find((candidate) => candidate.stageId === stageId);
  if (!check) throw new Error(`Missing readiness check: ${stageId}`);
  return check;
}

async function createSelectorFixture(options: {
  tasks?: any[];
  taskOverrides?: Record<string, unknown>;
  feedbackItemRefs?: any[];
  stories: any[];
  workbenchOverrides?: Record<string, unknown>;
}) {
  const workDir = await mkdtemp(path.join(os.tmpdir(), 'visual-workbench-selector-work-'));
  await mkdir(path.join(workDir, '.ralph'), { recursive: true });
  await mkdir(path.join(workDir, 'visual-workbench'), { recursive: true });
  await writeFile(path.join(workDir, 'spec.md'), '# Spec\n');
  const tasks = options.tasks ?? [{
    id: 'task-001',
    description: 'Make the synth pad playing state visible.',
    acceptanceCriteria: ['Synth pad playing state is visible.'],
    status: 'completed',
    attempts: 1,
    dependencies: [],
    feedbackItemRefs: options.feedbackItemRefs ?? [{ itemId: 'BUG-001', diffItemId: 'DIFF-001-BUG-001', workSurface: 'frontend' }],
    ...options.taskOverrides,
  }];
  await writeFile(path.join(workDir, '.ralph', 'plan.json'), JSON.stringify({
    version: 1,
    specFile: 'spec.md',
    createdAt: '2026-06-07T12:00:00.000Z',
    updatedAt: '2026-06-07T12:00:00.000Z',
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
      storyRoutePattern: '/__visual/:storyId',
      ...options.workbenchOverrides,
    },
    coveragePolicy: {
      mode: 'strict_canary',
      selectionDefault: 'full_manifest',
      simplificationRequiresEvidence: true,
    },
    stories: options.stories,
  }, null, 2));
  return { workDir };
}

function selectorStory(id: string, defaultFor: string[], viewportNames = ['desktop']) {
  return {
    id,
    title: `Selector story ${id}`,
    kind: 'widget',
    feature: 'instrument-surface',
    widget: 'SynthPad',
    state: 'playing',
    claim: `The ${id} story renders the selected state.`,
    render: { type: 'workbench_route', path: `/__visual/${id}` },
    mockState: { name: 'playing' },
    viewports: viewportNames.map((name) => ({
      name,
      width: name === 'mobile' ? 390 : 1280,
      height: name === 'mobile' ? 844 : 832,
    })),
    ...(defaultFor.length > 0 ? { taskRelevance: { defaultFor } } : {}),
  };
}

async function createFixture(options: {
  feedbackItemRefs?: { itemId: string; diffItemId?: string; workSurface?: string }[];
  runOverrides?: Record<string, unknown>;
  taskOverrides?: Record<string, unknown>;
  viewportOverrides?: Record<string, unknown>;
} = {}) {
  const workDir = await mkdtemp(path.join(os.tmpdir(), 'visual-workbench-evidence-work-'));
  const runDir = await mkdtemp(path.join(os.tmpdir(), 'visual-workbench-evidence-run-'));
  await mkdir(path.join(workDir, '.ralph'), { recursive: true });
  await mkdir(path.join(workDir, 'visual-workbench'), { recursive: true });
  await mkdir(path.join(runDir, 'screenshots', 'synth-pad.playing.desktop'), { recursive: true });
  const screenshotPath = path.join(runDir, 'screenshots', 'synth-pad.playing.desktop', 'desktop.png');
  const screenshotBytes = Buffer.from('fake-workbench-png');
  const screenshotSha256 = `sha256:${createHash('sha256').update(screenshotBytes).digest('hex')}`;
  const runPath = path.join(runDir, 'visual-workbench-capture-run.json');
  await writeFile(screenshotPath, screenshotBytes);
  await writeFile(path.join(workDir, 'spec.md'), '# Spec\n');
  await writeFile(path.join(workDir, '.ralph', 'plan.json'), JSON.stringify({
    version: 1,
    specFile: 'spec.md',
    createdAt: '2026-06-07T12:00:00.000Z',
    updatedAt: '2026-06-07T12:00:00.000Z',
    phases: [{
      id: 'phase-1',
      name: 'UI fixes',
      description: 'Fix reported UI behavior',
      order: 1,
      status: 'pending',
      tasks: [{
        id: 'task-001',
        description: 'Make the synth pad playing state visible.',
        acceptanceCriteria: ['Synth pad playing state is visible.'],
        status: 'pending',
        attempts: 0,
        dependencies: [],
        requiredRolePasses: ['ux'],
        feedbackItemRefs: options.feedbackItemRefs ?? [{ itemId: 'BUG-001', diffItemId: 'DIFF-001-BUG-001' }],
        ...options.taskOverrides,
      }],
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
      storyRoutePattern: '/__visual/:storyId',
    },
    coveragePolicy: {
      mode: 'strict_canary',
      selectionDefault: 'full_manifest',
      simplificationRequiresEvidence: true,
    },
    stories: [selectorStory('synth-pad.playing.desktop', ['BUG-001'])],
  }, null, 2));

  const viewport = {
    name: 'desktop',
    width: 1280,
    height: 832,
    status: 'captured',
    screenshotPath,
    screenshotSha256,
    error: null,
    ...options.viewportOverrides,
  };
  const run = {
    schemaVersion: VISUAL_WORKBENCH_CAPTURE_RUN_SCHEMA_VERSION,
    manifestSchemaVersion: 'ra-355.visual-coverage-manifest.v0',
    stage: {
      stageId: 'visual_workbench_capture',
      mode: 'workspace_mutation',
      inputRef: 'visual-workbench/manifest.json',
      ownerBoundary: 'ra-355.visual-workbench-capture',
      sourceRef: 'source-ref',
      selection: 'full_manifest',
      allowedMutations: [runDir],
      forbiddenMutations: ['task verificationEvidence'],
      handoff: [],
    },
    workbench: {
      serveCommand: 'npm run visual-workbench',
      baseUrl: 'http://127.0.0.1:43123/',
      baseUrlEnv: 'VISUAL_WORKBENCH_BASE_URL',
      storyRoutePattern: '/__visual/:storyId',
      startDiagnostics: null,
    },
    manifest: {
      path: 'visual-workbench/manifest.json',
      sourceRef: 'source-ref',
      sha256: 'sha256:manifest',
      snapshotPath: path.join(runDir, 'manifest.snapshot.json'),
      summary: null,
      blockers: [],
    },
    status: 'captured',
    capturedAt: '2026-06-07T12:00:00.000Z',
    output: {
      directory: runDir,
      reportPath: runPath,
      screenshotsDir: path.join(runDir, 'screenshots'),
    },
    stories: [{
      storyId: 'synth-pad.playing.desktop',
      title: 'Synth pad playing state',
      kind: 'widget',
      feature: 'instrument-surface',
      widget: 'SynthPad',
      state: 'playing',
      route: '/__visual/synth-pad.playing.desktop',
      claim: 'The synth pad shows the active note and pressure level.',
      viewports: [viewport],
    }],
    workspaceMutationCheck: {
      available: true,
      changed: false,
      beforeStatusPreview: [],
      afterStatusPreview: [],
    },
    error: null,
    notes: [],
    ...options.runOverrides,
  };
  await writeFile(runPath, JSON.stringify(run, null, 2));

  return {
    workDir,
    runDir,
    runPath,
    screenshotPath,
    screenshotSha256,
  };
}

async function createExportedFixture() {
  const fixture = await createFixture();
  const exportResult = await exportVisualWorkbenchEvidenceFile({
    workDir: fixture.workDir,
    runPath: fixture.runPath,
    taskId: 'task-001',
    storyId: 'synth-pad.playing.desktop',
    viewportName: 'desktop',
  });
  return {
    ...fixture,
    exportResult,
  };
}

async function mutateTask(
  fixture: Awaited<ReturnType<typeof createExportedFixture>>,
  changes: Record<string, unknown>,
) {
  const planPath = path.join(fixture.workDir, '.ralph', 'plan.json');
  const plan = JSON.parse(await readFile(planPath, 'utf8'));
  Object.assign(plan.phases[0].tasks[0], changes);
  await writeFile(planPath, JSON.stringify(plan, null, 2));
}

async function addAssessmentRow(
  fixture: Awaited<ReturnType<typeof createExportedFixture>>,
  row: {
    ref: string;
    result: 'pass' | 'fail' | 'inconclusive';
    summary: string;
    sourceEvidenceRef?: string;
  },
) {
  await mutatePlan(fixture.workDir, (plan) => {
    plan.phases[0].tasks[0].verificationEvidence.push({
      kind: 'manual_note',
      ref: row.ref,
      observedAt: '2026-06-07T13:00:00.000Z',
      summary: row.summary,
      result: row.result,
      feedbackItemIds: ['BUG-001'],
      diffItemIds: ['DIFF-001-BUG-001'],
      taskId: 'task-001',
      artifactPath: fixture.exportResult.adoptedArtifactPath,
      artifactSha256: fixture.screenshotSha256,
      recordedBy: 'manual',
      sourceEvidenceRef: row.sourceEvidenceRef,
      target: fixture.exportResult.evidence.target,
    });
  });
}

async function mutatePlan(workDir: string, mutate: (plan: any) => void) {
  const planPath = path.join(workDir, '.ralph', 'plan.json');
  const plan = JSON.parse(await readFile(planPath, 'utf8'));
  mutate(plan);
  await writeFile(planPath, JSON.stringify(plan, null, 2));
}
