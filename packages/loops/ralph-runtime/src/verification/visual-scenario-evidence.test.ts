import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'path';
import test from 'node:test';
import { PlanSchema } from '../config/types.js';
import { hasPositiveFeedbackEvidenceForItem } from '../feedback/evidence.js';
import { VISUAL_SCENARIO_RUN_SCHEMA_VERSION, type VisualScenarioRunResult } from './visual-scenario-runner.js';
import {
  VISUAL_SCENARIO_ASSESSMENT_SCHEMA_VERSION,
  VISUAL_SCENARIO_EVIDENCE_EXPORT_SCHEMA_VERSION,
  VISUAL_SCENARIO_STATUS_SCHEMA_VERSION,
  assessVisualScenarioEvidenceFile,
  exportVisualScenarioEvidenceFile,
  formatVisualScenarioAssessmentResult,
  formatVisualScenarioEvidenceExportResult,
  formatVisualScenarioStatusResult,
  getVisualScenarioStatusFile,
} from './visual-scenario-evidence.js';
import { VISUAL_SCENARIO_SCHEMA_VERSION } from './visual-scenario.js';

test('Visual Scenario evidence export records inconclusive task-linked screenshot evidence by default', async () => {
  const fixture = await createFixture();

  const result = await exportVisualScenarioEvidenceFile({
    workDir: fixture.workDir,
    runPath: fixture.runPath,
    taskId: 'task-001',
  });

  assert.equal(result.schemaVersion, VISUAL_SCENARIO_EVIDENCE_EXPORT_SCHEMA_VERSION);
  assert.equal(result.runSchemaVersion, VISUAL_SCENARIO_RUN_SCHEMA_VERSION);
  assert.equal(result.status, 'recorded');
  assert.equal(result.addedEvidenceRows, 1);
  assert.equal(result.scenarioId, 'mini-jam.home.v1');
  assert.deepEqual(result.evidenceRefs, [`visual-scenario-run:mini-jam.home.v1:${fixture.screenshotSha256.replace(/^sha256:/, '').slice(0, 12)}`]);
  assert.equal(result.artifactSha256, fixture.screenshotSha256);
  assert.equal(result.evidence.kind, 'screenshot');
  assert.equal(result.evidence.ref, result.evidenceRefs[0]);
  assert.equal(result.evidence.result, 'inconclusive');
  assert.deepEqual(result.evidence.feedbackItemIds, ['BUG-001']);
  assert.equal(result.evidence.taskId, 'task-001');
  assert.equal(result.evidence.artifactPath, fixture.screenshotRelativePath);
  assert.equal(result.evidence.artifactSha256, fixture.screenshotSha256);
  assert.equal(result.evidence.recordedBy, 'agent');
  assert.equal(result.evidence.screenshotProof, undefined);
  assert.deepEqual(result.evidence.target, validTarget());
  assert.equal(hasPositiveFeedbackEvidenceForItem('BUG-001', [result.evidence]), false);

  const plan = JSON.parse(await readFile(path.join(fixture.workDir, '.ralph', 'plan.json'), 'utf8'));
  const evidence = plan.phases[0].tasks[0].verificationEvidence;
  assert.equal(evidence.length, 1);
  assert.equal(evidence[0].result, 'inconclusive');
  assert.equal(evidence[0].screenshotProof, undefined);
  assert.doesNotMatch(JSON.stringify(evidence[0]), /assets\/proof|proofReviews|ProjectAsset/);

  assert.equal(JSON.parse(formatVisualScenarioEvidenceExportResult(result)).status, 'recorded');
  assert.equal(JSON.parse(formatVisualScenarioEvidenceExportResult(result, true)).schemaVersion, VISUAL_SCENARIO_EVIDENCE_EXPORT_SCHEMA_VERSION);
});

test('Visual Scenario evidence export deduplicates the same evidence row', async () => {
  const fixture = await createFixture();

  await exportVisualScenarioEvidenceFile({
    workDir: fixture.workDir,
    runPath: fixture.runPath,
    taskId: 'task-001',
  });
  const beforeRepeatPlan = await readFile(path.join(fixture.workDir, '.ralph', 'plan.json'), 'utf8');
  const second = await exportVisualScenarioEvidenceFile({
    workDir: fixture.workDir,
    runPath: fixture.runPath,
    taskId: 'task-001',
  });
  const afterRepeatPlan = await readFile(path.join(fixture.workDir, '.ralph', 'plan.json'), 'utf8');

  assert.equal(second.status, 'already_recorded');
  assert.equal(second.addedEvidenceRows, 0);
  assert.equal(afterRepeatPlan, beforeRepeatPlan);
  const plan = JSON.parse(await readFile(path.join(fixture.workDir, '.ralph', 'plan.json'), 'utf8'));
  assert.equal(plan.phases[0].tasks[0].verificationEvidence.length, 1);
});

test('Visual Scenario evidence export rejects tasks without feedback refs', async () => {
  const fixture = await createFixture({ feedbackItemRefs: [] });

  await assert.rejects(() => exportVisualScenarioEvidenceFile({
    workDir: fixture.workDir,
    runPath: fixture.runPath,
    taskId: 'task-001',
  }), /has no feedbackItemRefs/);
});

test('Visual Scenario evidence export rejects missing plans and missing tasks', async () => {
  const missingPlan = await createFixture({ writePlan: false });
  await assert.rejects(() => exportVisualScenarioEvidenceFile({
    workDir: missingPlan.workDir,
    runPath: missingPlan.runPath,
    taskId: 'task-001',
  }), /ENOENT|no such file/i);

  const missingTask = await createFixture();
  await assert.rejects(() => exportVisualScenarioEvidenceFile({
    workDir: missingTask.workDir,
    runPath: missingTask.runPath,
    taskId: 'task-999',
  }), /Task task-999 not found/);
});

test('Visual Scenario evidence export rejects non-captured runs', async () => {
  const fixture = await createFixture({
    runOverrides: {
      status: 'navigation_failed',
      output: {
        directory: 'unused',
        reportPath: 'unused',
        screenshotPath: null,
        screenshotSha256: null,
      },
      error: {
        code: 'navigation_failed',
        message: 'Scenario target returned HTTP 503.',
      },
    },
  });

  await assert.rejects(() => exportVisualScenarioEvidenceFile({
    workDir: fixture.workDir,
    runPath: fixture.runPath,
    taskId: 'task-001',
  }), /must be captured/);
});

test('Visual Scenario evidence export revalidates embedded scenario targets', async () => {
  const fixture = await createFixture({
    runOverrides: {
      scenario: {
        scenarioId: 'mini-jam.home.v1',
        projectClass: 'ordinary_web',
        name: 'Mini Jam home',
        target: {
          ...validTarget(),
          route: 'https://example.com/',
        },
      },
    },
  });

  await assert.rejects(() => exportVisualScenarioEvidenceFile({
    workDir: fixture.workDir,
    runPath: fixture.runPath,
    taskId: 'task-001',
  }), /Route must be local/);
});

test('Visual Scenario evidence export rejects screenshot digest mismatch', async () => {
  const fixture = await createFixture();
  await writeFile(fixture.screenshotPath, 'tampered-png');

  await assert.rejects(() => exportVisualScenarioEvidenceFile({
    workDir: fixture.workDir,
    runPath: fixture.runPath,
    taskId: 'task-001',
  }), /digest mismatch/);
});

test('Visual Scenario evidence export rejects external screenshot artifacts', async () => {
  const fixture = await createFixture({ externalRunDir: true });

  await assert.rejects(() => exportVisualScenarioEvidenceFile({
    workDir: fixture.workDir,
    runPath: fixture.runPath,
    taskId: 'task-001',
  }), /must be under workDir/);
});

test('Visual Scenario assessment records an explicit manual pass without mutating the source screenshot row', async () => {
  const fixture = await createExportedFixture();

  const result = await assessVisualScenarioEvidenceFile({
    workDir: fixture.workDir,
    taskId: 'task-001',
    evidenceRef: fixture.exportResult.evidenceRefs[0],
    result: 'pass',
    assessment: 'The shared synth surface is visible and matches the scenario claim.',
    observedAt: '2026-06-06T13:00:00.000Z',
  });

  assert.equal(result.schemaVersion, VISUAL_SCENARIO_ASSESSMENT_SCHEMA_VERSION);
  assert.equal(result.status, 'recorded');
  assert.equal(result.kind, 'manual_note');
  assert.equal(result.result, 'pass');
  assert.equal(result.sourceEvidenceRef, fixture.exportResult.evidenceRefs[0]);
  assert.match(result.assessmentEvidenceRef, /^visual-scenario-assessment:manual_note:mini-jam\.home\.v1:/);
  assert.deepEqual(result.feedbackItemIds, ['BUG-001']);
  assert.equal(result.artifactSha256, fixture.screenshotSha256);
  assert.equal(result.evidence.kind, 'manual_note');
  assert.equal(result.evidence.recordedBy, 'manual');
  assert.equal(result.evidence.sourceEvidenceRef, fixture.exportResult.evidenceRefs[0]);
  assert.equal(result.evidence.result, 'pass');
  assert.equal(result.evidence.artifactPath, fixture.screenshotRelativePath);
  assert.equal(result.evidence.artifactSha256, fixture.screenshotSha256);
  assert.deepEqual(result.evidence.target, validTarget());
  assert.equal(result.evidence.screenshotProof, undefined);

  const plan = JSON.parse(await readFile(path.join(fixture.workDir, '.ralph', 'plan.json'), 'utf8'));
  const evidence = plan.phases[0].tasks[0].verificationEvidence;
  assert.equal(evidence.length, 2);
  assert.equal(evidence[0].kind, 'screenshot');
  assert.equal(evidence[0].result, 'inconclusive');
  assert.equal(hasPositiveFeedbackEvidenceForItem('BUG-001', [evidence[0]]), false);
  assert.equal(hasPositiveFeedbackEvidenceForItem('BUG-001', [evidence[1]]), true);
  assert.doesNotMatch(JSON.stringify(evidence), /assets\/proof|proofReviews|ProjectAsset/);

  assert.equal(JSON.parse(formatVisualScenarioAssessmentResult(result)).schemaVersion, VISUAL_SCENARIO_ASSESSMENT_SCHEMA_VERSION);
  assert.equal(JSON.parse(formatVisualScenarioAssessmentResult(result, true)).status, 'recorded');
});

test('FeedbackEvidence schema preserves visual scenario assessment sourceEvidenceRef', async () => {
  const fixture = await createExportedFixture();
  await assessVisualScenarioEvidenceFile({
    workDir: fixture.workDir,
    taskId: 'task-001',
    evidenceRef: fixture.exportResult.evidenceRefs[0],
    result: 'pass',
    assessment: 'Manual review confirms the scenario claim.',
  });

  const parsed = PlanSchema.parse(JSON.parse(await readFile(path.join(fixture.workDir, '.ralph', 'plan.json'), 'utf8')));
  const assessment = parsed.phases[0].tasks[0].verificationEvidence?.find((row) => row.kind === 'manual_note');
  assert.equal(assessment?.sourceEvidenceRef, fixture.exportResult.evidenceRefs[0]);
});

test('Visual Scenario assessment fail and inconclusive do not become positive closure evidence', async () => {
  for (const assessmentResult of ['fail', 'inconclusive'] as const) {
    const fixture = await createExportedFixture();
    const result = await assessVisualScenarioEvidenceFile({
      workDir: fixture.workDir,
      taskId: 'task-001',
      evidenceRef: fixture.exportResult.evidenceRefs[0],
      result: assessmentResult,
      assessment: `Manual review result is ${assessmentResult}.`,
    });

    assert.equal(result.evidence.result, assessmentResult);
    assert.equal(hasPositiveFeedbackEvidenceForItem('BUG-001', [result.evidence]), false);
  }
});

test('Visual Scenario assessment deduplicates exact repeats and rejects conflicts for the same source', async () => {
  const fixture = await createExportedFixture();
  const options = {
    workDir: fixture.workDir,
    taskId: 'task-001',
    evidenceRef: fixture.exportResult.evidenceRefs[0],
    result: 'pass' as const,
    assessment: 'Manual review confirms the scenario claim.',
  };

  await assessVisualScenarioEvidenceFile(options);
  const duplicate = await assessVisualScenarioEvidenceFile(options);
  assert.equal(duplicate.status, 'already_recorded');

  await assert.rejects(() => assessVisualScenarioEvidenceFile({
    ...options,
    result: 'fail',
    assessment: 'A later conflicting review should not silently supersede pass.',
  }), /Conflicting visual scenario assessment/);
});

test('Visual Scenario assessment rejects unsupported kind, bad result and blank assessment', async () => {
  const fixture = await createExportedFixture();
  const base = {
    workDir: fixture.workDir,
    taskId: 'task-001',
    evidenceRef: fixture.exportResult.evidenceRefs[0],
    result: 'pass' as const,
    assessment: 'Manual review confirms the scenario claim.',
  };

  await assert.rejects(() => assessVisualScenarioEvidenceFile({
    ...base,
    kind: 'vision_qa' as any,
  }), /Invalid literal value|manual_note/);
  await assert.rejects(() => assessVisualScenarioEvidenceFile({
    ...base,
    result: 'maybe' as any,
  }), /Invalid enum value|pass/);
  await assert.rejects(() => assessVisualScenarioEvidenceFile({
    ...base,
    assessment: '   ',
  }), /assessment text is required/);
});

test('Visual Scenario assessment rejects multi-feedback source rows until explicit item selection exists', async () => {
  const fixture = await createFixture({ feedbackItemRefs: [{ itemId: 'BUG-001' }, { itemId: 'BUG-002' }] });
  const exportResult = await exportVisualScenarioEvidenceFile({
    workDir: fixture.workDir,
    runPath: fixture.runPath,
    taskId: 'task-001',
  });

  await assert.rejects(() => assessVisualScenarioEvidenceFile({
    workDir: fixture.workDir,
    taskId: 'task-001',
    evidenceRef: exportResult.evidenceRefs[0],
    result: 'pass',
    assessment: 'This must not close multiple feedback items at once.',
  }), /requires exactly one feedbackItemId/);
});

test('Visual Scenario assessment rejects forged or stale source rows', async () => {
  const fixture = await createExportedFixture();

  await assert.rejects(() => assessVisualScenarioEvidenceFile({
    workDir: fixture.workDir,
    taskId: 'task-001',
    evidenceRef: 'visual-scenario-run:missing:000000000000',
    result: 'pass',
    assessment: 'Missing source.',
  }), /source evidence not found/);

  await mutateSourceEvidence(fixture, { kind: 'manual_note' });
  await assert.rejects(() => assessVisualScenarioEvidenceFile({
    workDir: fixture.workDir,
    taskId: 'task-001',
    evidenceRef: fixture.exportResult.evidenceRefs[0],
    result: 'pass',
    assessment: 'Wrong source kind.',
  }), /must be kind=screenshot/);

  const passedSource = await createExportedFixture();
  await mutateSourceEvidence(passedSource, { result: 'pass' });
  await assert.rejects(() => assessVisualScenarioEvidenceFile({
    workDir: passedSource.workDir,
    taskId: 'task-001',
    evidenceRef: passedSource.exportResult.evidenceRefs[0],
    result: 'pass',
    assessment: 'Source already pass.',
  }), /must stay inconclusive/);

  const proofSource = await createExportedFixture();
  await mutateSourceEvidence(proofSource, { screenshotProof: { expectationKind: 'before_after_screenshot', role: 'after' } });
  await assert.rejects(() => assessVisualScenarioEvidenceFile({
    workDir: proofSource.workDir,
    taskId: 'task-001',
    evidenceRef: proofSource.exportResult.evidenceRefs[0],
    result: 'pass',
    assessment: 'Source is proof evidence.',
  }), /must not be screenshotProof/);
});

test('Visual Scenario assessment revalidates source links and artifact integrity', async () => {
  const driftedLinks = await createExportedFixture();
  await mutateTask(driftedLinks, { feedbackItemRefs: [{ itemId: 'BUG-999' }] });
  await assert.rejects(() => assessVisualScenarioEvidenceFile({
    workDir: driftedLinks.workDir,
    taskId: 'task-001',
    evidenceRef: driftedLinks.exportResult.evidenceRefs[0],
    result: 'pass',
    assessment: 'Links drifted.',
  }), /feedback links no longer match/);

  const badDigest = await createExportedFixture();
  await writeFile(badDigest.screenshotPath, 'tampered-png');
  await assert.rejects(() => assessVisualScenarioEvidenceFile({
    workDir: badDigest.workDir,
    taskId: 'task-001',
    evidenceRef: badDigest.exportResult.evidenceRefs[0],
    result: 'pass',
    assessment: 'Digest mismatch.',
  }), /digest mismatch/);

  const proofPath = await createExportedFixture();
  await mutateSourceEvidence(proofPath, { artifactPath: 'assets/proof/after.png' });
  await assert.rejects(() => assessVisualScenarioEvidenceFile({
    workDir: proofPath.workDir,
    taskId: 'task-001',
    evidenceRef: proofPath.exportResult.evidenceRefs[0],
    result: 'pass',
    assessment: 'Proof path rejected.',
  }), /must not reuse screenshot-proof assets/);

  const escapingPath = await createExportedFixture();
  await mutateSourceEvidence(escapingPath, { artifactPath: '../outside.png' });
  await assert.rejects(() => assessVisualScenarioEvidenceFile({
    workDir: escapingPath.workDir,
    taskId: 'task-001',
    evidenceRef: escapingPath.exportResult.evidenceRefs[0],
    result: 'pass',
    assessment: 'Escaping path rejected.',
  }), /must be under workDir/);
});

test('Visual Scenario status groups source screenshot and manual assessment by sourceEvidenceRef', async () => {
  const fixture = await createExportedFixture();
  await assessVisualScenarioEvidenceFile({
    workDir: fixture.workDir,
    taskId: 'task-001',
    evidenceRef: fixture.exportResult.evidenceRefs[0],
    result: 'pass',
    assessment: 'Manual review confirms the scenario claim.',
    observedAt: '2026-06-06T13:00:00.000Z',
  });
  const beforePlan = await readFile(path.join(fixture.workDir, '.ralph', 'plan.json'), 'utf8');

  const status = await getVisualScenarioStatusFile({ workDir: fixture.workDir });
  const afterPlan = await readFile(path.join(fixture.workDir, '.ralph', 'plan.json'), 'utf8');

  assert.equal(afterPlan, beforePlan);
  assert.equal(status.schemaVersion, VISUAL_SCENARIO_STATUS_SCHEMA_VERSION);
  assert.equal(status.summary.tasks, 1);
  assert.equal(status.summary.sources, 1);
  assert.equal(status.summary.assessments, 1);
  assert.equal(status.summary.invalidRows, 0);
  assert.equal(status.summary.orphanAssessments, 0);
  assert.equal(status.tasks[0].taskId, 'task-001');
  assert.deepEqual(status.tasks[0].feedbackItemIds, ['BUG-001']);
  const source = status.tasks[0].sources[0];
  assert.equal(source.sourceEvidenceRef, fixture.exportResult.evidenceRefs[0]);
  assert.equal(source.status, 'passed');
  assert.equal(source.result, 'inconclusive');
  assert.equal(source.artifactPath, fixture.screenshotRelativePath);
  assert.equal(source.artifactSha256, fixture.screenshotSha256);
  assert.deepEqual(source.target, validTarget());
  assert.deepEqual(source.warnings, []);
  assert.equal(source.assessments[0].sourceEvidenceRef, fixture.exportResult.evidenceRefs[0]);
  assert.equal(source.assessments[0].result, 'pass');

  assert.equal(JSON.parse(formatVisualScenarioStatusResult(status)).schemaVersion, VISUAL_SCENARIO_STATUS_SCHEMA_VERSION);
  assert.equal(JSON.parse(formatVisualScenarioStatusResult(status, true)).summary.sources, 1);
});

test('Visual Scenario status reports unassessed, failed, inconclusive and conflict projections', async () => {
  const unassessed = await createExportedFixture();
  assert.equal((await getVisualScenarioStatusFile({ workDir: unassessed.workDir })).tasks[0].sources[0].status, 'unassessed');

  const failed = await createExportedFixture();
  await assessVisualScenarioEvidenceFile({
    workDir: failed.workDir,
    taskId: 'task-001',
    evidenceRef: failed.exportResult.evidenceRefs[0],
    result: 'fail',
    assessment: 'Manual review found the claim is not met.',
  });
  assert.equal((await getVisualScenarioStatusFile({ workDir: failed.workDir })).tasks[0].sources[0].status, 'failed');

  const inconclusive = await createExportedFixture();
  await assessVisualScenarioEvidenceFile({
    workDir: inconclusive.workDir,
    taskId: 'task-001',
    evidenceRef: inconclusive.exportResult.evidenceRefs[0],
    result: 'inconclusive',
    assessment: 'Manual review could not determine the claim.',
  });
  assert.equal((await getVisualScenarioStatusFile({ workDir: inconclusive.workDir })).tasks[0].sources[0].status, 'inconclusive');

  const conflict = await createExportedFixture();
  await addAssessmentRow(conflict, {
    ref: 'visual-scenario-assessment:manual_note:mini-jam.home.v1:aaaaaaaaaaaa:111111111111',
    result: 'pass',
    summary: 'Manual pass.',
    sourceEvidenceRef: conflict.exportResult.evidenceRefs[0],
  });
  await addAssessmentRow(conflict, {
    ref: 'visual-scenario-assessment:manual_note:mini-jam.home.v1:aaaaaaaaaaaa:222222222222',
    result: 'fail',
    summary: 'Manual fail.',
    sourceEvidenceRef: conflict.exportResult.evidenceRefs[0],
  });
  const conflictSource = (await getVisualScenarioStatusFile({ workDir: conflict.workDir })).tasks[0].sources[0];
  assert.equal(conflictSource.status, 'conflict');
  assert.deepEqual(conflictSource.warnings, ['multiple_assessment_results']);
});

test('Visual Scenario status supports task filters and rejects unknown tasks', async () => {
  const fixture = await createExportedFixture();
  await mutatePlan(fixture.workDir, (plan) => {
    plan.phases[0].tasks.push({
      id: 'task-002',
      description: 'Unrelated task',
      acceptanceCriteria: ['No visual evidence'],
      status: 'pending',
      attempts: 0,
      dependencies: [],
      feedbackItemRefs: [{ itemId: 'BUG-002' }],
    });
  });

  const filtered = await getVisualScenarioStatusFile({ workDir: fixture.workDir, taskId: 'task-002' });
  assert.equal(filtered.taskFilter, 'task-002');
  assert.equal(filtered.summary.tasks, 1);
  assert.equal(filtered.summary.sources, 0);

  await assert.rejects(() => getVisualScenarioStatusFile({
    workDir: fixture.workDir,
    taskId: 'task-999',
  }), /Task task-999 not found/);
});

test('Visual Scenario status ignores generic evidence and reports invalid/orphan visual rows', async () => {
  const fixture = await createExportedFixture();
  await addAssessmentRow(fixture, {
    ref: 'visual-scenario-assessment:manual_note:mini-jam.home.v1:aaaaaaaaaaaa:333333333333',
    result: 'pass',
    summary: 'Missing sourceEvidenceRef should not be parsed as truth.',
  });
  await addAssessmentRow(fixture, {
    ref: 'visual-scenario-assessment:manual_note:missing:aaaaaaaaaaaa:444444444444',
    result: 'pass',
    summary: 'Source does not exist.',
    sourceEvidenceRef: 'visual-scenario-run:missing:aaaaaaaaaaaa',
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

  const status = await getVisualScenarioStatusFile({ workDir: fixture.workDir });
  assert.equal(status.summary.sources, 1);
  assert.equal(status.summary.assessments, 0);
  assert.equal(status.invalidRows[0].reason, 'assessment_missing_source_evidence_ref');
  assert.equal(status.orphanAssessments[0].reason, 'source_evidence_not_found_on_task');
});

test('Visual Scenario status reports mismatched assessment copies and multi-feedback source warnings', async () => {
  const mismatch = await createExportedFixture();
  await addAssessmentRow(mismatch, {
    ref: 'visual-scenario-assessment:manual_note:mini-jam.home.v1:aaaaaaaaaaaa:555555555555',
    result: 'pass',
    summary: 'Copied fields are stale.',
    sourceEvidenceRef: mismatch.exportResult.evidenceRefs[0],
    artifactSha256: 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
  });
  const mismatchStatus = await getVisualScenarioStatusFile({ workDir: mismatch.workDir });
  assert.equal(mismatchStatus.summary.assessments, 0);
  assert.equal(mismatchStatus.invalidRows[0].reason, 'assessment_artifact_sha256_does_not_match_source');

  const multi = await createFixture({ feedbackItemRefs: [{ itemId: 'BUG-001' }, { itemId: 'BUG-002' }] });
  await exportVisualScenarioEvidenceFile({
    workDir: multi.workDir,
    runPath: multi.runPath,
    taskId: 'task-001',
  });
  const multiSource = (await getVisualScenarioStatusFile({ workDir: multi.workDir })).tasks[0].sources[0];
  assert.deepEqual(multiSource.feedbackItemIds, ['BUG-001', 'BUG-002']);
  assert.deepEqual(multiSource.warnings, ['not_assessable_multi_feedback_source']);
});

function validTarget() {
  return {
    route: '/',
    viewport: {
      width: 1280,
      height: 720,
    },
    claim: 'The shared synth surface is visible.',
  };
}

async function createFixture(options: {
  runOverrides?: Partial<VisualScenarioRunResult>;
  feedbackItemRefs?: { itemId: string }[];
  externalRunDir?: boolean;
  writePlan?: boolean;
} = {}) {
  const workDir = await mkdtemp(path.join(os.tmpdir(), 'visual-scenario-evidence-work-'));
  const runDir = options.externalRunDir
    ? await mkdtemp(path.join(os.tmpdir(), 'visual-scenario-evidence-run-'))
    : path.join(workDir, '.ralph', 'visual-scenarios', 'mini-jam.home.v1');
  await mkdir(path.join(workDir, '.ralph'), { recursive: true });
  await mkdir(runDir, { recursive: true });
  const screenshotPath = path.join(runDir, 'mini-jam.home.v1.png');
  const screenshotRelativePath = path.relative(workDir, screenshotPath).split(path.sep).join('/');
  const screenshotBytes = Buffer.from('fake-png');
  const screenshotSha256 = `sha256:${createHash('sha256').update(screenshotBytes).digest('hex')}`;
  const runPath = path.join(runDir, 'scenario-run.json');

  await writeFile(screenshotPath, screenshotBytes);
  await writeFile(path.join(workDir, 'spec.md'), '# Spec\n');
  if (options.writePlan !== false) {
    await writeFile(path.join(workDir, '.ralph', 'plan.json'), JSON.stringify({
      version: 1,
      specFile: 'spec.md',
      createdAt: '2026-06-06T12:00:00.000Z',
      updatedAt: '2026-06-06T12:00:00.000Z',
      phases: [{
        id: 'phase-1',
        name: 'UI fixes',
        description: 'Fix reported UI behavior',
        order: 1,
        status: 'pending',
        tasks: [{
          id: 'task-001',
          description: 'Make the shared synth surface visible.',
          acceptanceCriteria: ['Shared synth surface is visible.'],
          status: 'pending',
          attempts: 0,
          dependencies: [],
          feedbackItemRefs: options.feedbackItemRefs ?? [{ itemId: 'BUG-001' }],
        }],
        planLater: false,
      }],
      judgments: [],
      specMigrations: [],
    }, null, 2));
  }

  const run: VisualScenarioRunResult = {
    schemaVersion: VISUAL_SCENARIO_RUN_SCHEMA_VERSION,
    scenarioSchemaVersion: VISUAL_SCENARIO_SCHEMA_VERSION,
    scenario: {
      scenarioId: 'mini-jam.home.v1',
      projectClass: 'ordinary_web',
      name: 'Mini Jam home',
      target: validTarget(),
    },
    baseUrl: 'http://127.0.0.1:3000/',
    status: 'captured',
    capturedAt: '2026-06-06T12:00:00.000Z',
    output: {
      directory: runDir,
      reportPath: runPath,
      screenshotPath,
      screenshotSha256,
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
    screenshotRelativePath,
    screenshotSha256,
  };
}

async function createExportedFixture() {
  const fixture = await createFixture();
  const exportResult = await exportVisualScenarioEvidenceFile({
    workDir: fixture.workDir,
    runPath: fixture.runPath,
    taskId: 'task-001',
  });
  return {
    ...fixture,
    exportResult,
  };
}

async function mutateSourceEvidence(
  fixture: Awaited<ReturnType<typeof createExportedFixture>>,
  changes: Record<string, unknown>,
) {
  const planPath = path.join(fixture.workDir, '.ralph', 'plan.json');
  const plan = JSON.parse(await readFile(planPath, 'utf8'));
  const evidence = plan.phases[0].tasks[0].verificationEvidence;
  const row = evidence.find((entry: { ref: string }) => entry.ref === fixture.exportResult.evidenceRefs[0]);
  Object.assign(row, changes);
  await writeFile(planPath, JSON.stringify(plan, null, 2));
}

async function addAssessmentRow(
  fixture: Awaited<ReturnType<typeof createExportedFixture>>,
  row: {
    ref: string;
    result: 'pass' | 'fail' | 'inconclusive';
    summary: string;
    sourceEvidenceRef?: string;
    artifactSha256?: string;
  },
) {
  await mutatePlan(fixture.workDir, (plan) => {
    plan.phases[0].tasks[0].verificationEvidence.push({
      kind: 'manual_note',
      ref: row.ref,
      observedAt: '2026-06-06T13:00:00.000Z',
      summary: row.summary,
      result: row.result,
      feedbackItemIds: ['BUG-001'],
      taskId: 'task-001',
      artifactPath: fixture.screenshotRelativePath,
      artifactSha256: row.artifactSha256 ?? fixture.screenshotSha256,
      recordedBy: 'manual',
      sourceEvidenceRef: row.sourceEvidenceRef,
      target: validTarget(),
    });
  });
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

async function mutatePlan(workDir: string, mutate: (plan: any) => void) {
  const planPath = path.join(workDir, '.ralph', 'plan.json');
  const plan = JSON.parse(await readFile(planPath, 'utf8'));
  mutate(plan);
  await writeFile(planPath, JSON.stringify(plan, null, 2));
}
