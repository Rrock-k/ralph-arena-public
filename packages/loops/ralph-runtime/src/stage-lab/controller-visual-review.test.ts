import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, readFile, stat, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { PROMPT_LAB_FIXTURE_SCHEMA_VERSION } from '../prompts/prompt-lab.js';
import {
  CONTROLLER_VISUAL_REVIEW_FIXTURE_SCHEMA_VERSION,
  CONTROLLER_VISUAL_REVIEW_RESULT_SCHEMA_VERSION,
  formatControllerVisualReviewResult,
  runControllerVisualReviewFixture,
  runControllerVisualReviewFixtureFile,
  type ControllerVisualReviewFixture,
} from './controller-visual-review.js';

test('controller_visual_review parses explicit controller output without runtime writes', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'controller-visual-review-'));
  const fixturePath = path.join(tempDir, 'fixture.json');
  const outPath = path.join(tempDir, 'out', 'controller-stage.json');
  await writeFile(fixturePath, JSON.stringify(buildFixture(), null, 2), 'utf8');

  const beforeRootEntries = await readdir(tempDir);
  const result = await runControllerVisualReviewFixtureFile({
    fixturePath,
    outPath,
  });
  const afterRootEntries = await readdir(tempDir);
  const outFile = JSON.parse(await readFile(outPath, 'utf8'));

  assert.equal(result.schemaVersion, CONTROLLER_VISUAL_REVIEW_RESULT_SCHEMA_VERSION);
  assert.equal(result.stage.stageId, 'controller_visual_review');
  assert.equal(result.stage.mode, 'fixture');
  assert.equal(result.stage.ownerBoundary, 'ralph.controller.prompt-code-path');
  assert.deepEqual(result.stage.allowedMutations, [outPath]);
  assert(result.stage.forbiddenMutations.includes('.ralph/controller-reports/'));
  assert(result.stage.forbiddenMutations.includes('task verificationEvidence'));
  assert.equal(result.prompt.promptId, 'controller.audit');
  assert.match(result.prompt.renderedSha256, /^sha256:[a-f0-9]{64}$/);
  assert.match(result.controllerOutput.outputSha256, /^sha256:[a-f0-9]{64}$/);
  assert.equal(result.controllerOutput.status, 'parsed');
  assert.equal(result.controllerObservation.continuationRecommendation, 'continue');
  assert.equal(result.controllerObservation.changeObservationCount, 0);
  assert.equal(result.visualReview.evidenceVerdict, 'pass');
  assert.deepEqual(result.visualReview.positiveEvidenceRefs, ['manual:task-001:synth-pad']);
  assert.deepEqual(result.visualReview.weakEvidenceWarnings, []);
  assert.deepEqual(beforeRootEntries.sort(), ['fixture.json']);
  assert.deepEqual(afterRootEntries.sort(), ['fixture.json', 'out']);
  assert.equal(outFile.visualReview.evidenceVerdict, 'pass');
  assert.equal(Object.prototype.hasOwnProperty.call(outFile, 'controllerReport'), false);
  assert.equal(JSON.stringify(outFile).includes('"planChanges"'), false);
  await assert.rejects(stat(path.join(tempDir, '.ralph')));
});

test('controller_visual_review keeps captured screenshots inconclusive until assessed', () => {
  const result = runControllerVisualReviewFixture({
    fixture: buildFixture({
      visualEvidence: [{
        ref: 'capture:synth-pad.before-after',
        kind: 'visual_workbench_capture',
        result: 'captured',
        taskId: 'task-001',
        feedbackItemIds: [],
      }],
    }),
  });

  assert.equal(result.controllerOutput.status, 'parsed');
  assert.equal(result.visualReview.evidenceVerdict, 'inconclusive');
  assert.deepEqual(result.visualReview.unassessedEvidenceRefs, ['capture:synth-pad.before-after']);
  assert.deepEqual(result.visualReview.weakEvidenceWarnings.map((warning) => warning.code), [
    'unassessed_visual_evidence',
    'continue_without_positive_visual_assessment',
  ]);
});

test('controller_visual_review ingests Visual Workbench capture reports as unassessed visual evidence', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'controller-visual-review-capture-'));
  const fixturePath = path.join(tempDir, 'fixture.json');
  const captureReportPath = path.join(tempDir, 'visual-workbench-capture-run.json');
  await writeFile(fixturePath, JSON.stringify(buildFixture({ visualEvidence: [] }), null, 2), 'utf8');
  await writeFile(captureReportPath, JSON.stringify(buildVisualWorkbenchCaptureReport(), null, 2), 'utf8');

  const result = await runControllerVisualReviewFixtureFile({
    fixturePath,
    visualWorkbenchCaptureReportPaths: [captureReportPath],
  });

  assert.equal(result.inputArtifacts.visualWorkbenchCaptureReports.length, 1);
  assert.equal(result.inputArtifacts.visualWorkbenchCaptureReports[0]?.status, 'captured');
  assert.equal(result.inputArtifacts.visualWorkbenchCaptureReports[0]?.storyCount, 1);
  assert.equal(result.inputArtifacts.visualWorkbenchCaptureReports[0]?.capturedViewportCount, 1);
  assert.deepEqual(result.visualReview.evidenceByResult, { captured: 1 });
  assert.equal(result.visualReview.evidenceVerdict, 'inconclusive');
  assert.deepEqual(result.visualReview.unassessedEvidenceRefs, result.inputArtifacts.visualWorkbenchCaptureReports[0]?.evidenceRefs);
  assert.deepEqual(result.visualReview.weakEvidenceWarnings.map((warning) => warning.code), [
    'unassessed_visual_evidence',
    'continue_without_positive_visual_assessment',
  ]);

  await writeFile(captureReportPath, JSON.stringify({
    schemaVersion: 'wrong.schema',
    stories: [],
  }, null, 2), 'utf8');
  await assert.rejects(() => runControllerVisualReviewFixtureFile({
    fixturePath,
    visualWorkbenchCaptureReportPaths: [captureReportPath],
  }), /unsupported schemaVersion/);

  await writeFile(captureReportPath, JSON.stringify({
    schemaVersion: 'ra-355.visual-workbench-capture-run.v0',
    status: 'captured',
    stories: [{ storyId: 'missing-viewports' }],
  }, null, 2), 'utf8');
  await assert.rejects(() => runControllerVisualReviewFixtureFile({
    fixturePath,
    visualWorkbenchCaptureReportPaths: [captureReportPath],
  }), /invalid capture report shape/);
});

test('controller_visual_review treats failed visual assessment as failed evidence', () => {
  const result = runControllerVisualReviewFixture({
    fixture: buildFixture({
      visualEvidence: [{
        ref: 'manual:task-001:error-state',
        kind: 'manual_assessment',
        result: 'fail',
        taskId: 'task-001',
        feedbackItemIds: [],
        summary: 'Error state is clipped on mobile.',
      }],
    }),
  });

  assert.equal(result.visualReview.evidenceVerdict, 'fail');
  assert.deepEqual(result.visualReview.failedEvidenceRefs, ['manual:task-001:error-state']);
  assert.deepEqual(result.visualReview.weakEvidenceWarnings.map((warning) => warning.code), [
    'continue_without_positive_visual_assessment',
    'continue_with_failed_visual_assessment',
  ]);
});

test('controller_visual_review quarantines controller mutation-shaped raw fields', () => {
  const result = runControllerVisualReviewFixture({
    fixture: buildFixture({
      controllerOutput: {
        success: true,
        output: controllerJsonBlock({
          verdict: 'continue',
          summary: 'Looks acceptable, but the raw report is over-shaped.',
          planChanges: [{
            action: 'updateTask',
            taskId: 'task-001',
            changes: {
              acceptanceCriteria: ['Visual workbench story has a pass assessment.'],
            },
          }],
          newJudgments: [],
          revisedJudgments: [],
          overclaimWarnings: [{
            scope: 'visual',
            warning: 'Screenshot was captured but not independently assessed.',
          }],
          feedbackMatrix: [],
          verificationEvidence: [],
          proofReviews: [],
          runtimeIntents: [],
          lifecycleState: 'COMPLETE',
        }),
      },
    }),
  });

  assert.equal(result.controllerOutput.status, 'parsed');
  assert.equal(result.controllerObservation.changeObservationCount, 1);
  assert.deepEqual(result.controllerObservation.changeObservationsByAction, { updateTask: 1 });
  assert.equal(result.visualReview.evidenceVerdict, 'needs_follow_up');
  assert.deepEqual(result.visualReview.overclaimFindings, [
    'visual: Screenshot was captured but not independently assessed.',
  ]);
  assert.deepEqual(result.visualReview.rawReportWarnings.map((warning) => warning.code), [
    'feedback_matrix_returned',
    'runtime_truth_field_returned',
    'runtime_truth_field_returned',
    'runtime_truth_field_returned',
    'runtime_truth_field_returned',
  ]);
  assert.deepEqual(result.visualReview.weakEvidenceWarnings.map((warning) => warning.code), [
    'controller_change_observations_not_applied',
    'runtime_truth_fields_quarantined',
  ]);
});

test('controller_visual_review surfaces agent and parse failures without fallback continue', () => {
  const agentFailed = runControllerVisualReviewFixture({
    fixture: buildFixture({
      controllerOutput: {
        success: false,
        output: 'provider failed',
        error: {
          category: 'rate_limit',
          message: 'provider rate limit',
        },
      },
    }),
  });
  assert.equal(agentFailed.controllerOutput.status, 'agent_failed');
  assert.equal(agentFailed.controllerObservation.continuationRecommendation, null);
  assert.equal(agentFailed.visualReview.evidenceVerdict, 'inconclusive');

  const parseFailed = runControllerVisualReviewFixture({
    fixture: buildFixture({
      controllerOutput: {
        success: true,
        output: 'not json',
      },
    }),
  });
  assert.equal(parseFailed.controllerOutput.status, 'parse_or_validation_failed');
  assert.match(parseFailed.controllerOutput.parseError ?? '', /Could not find JSON/);
  assert.equal(parseFailed.controllerObservation.continuationRecommendation, null);
  assert.equal(JSON.parse(formatControllerVisualReviewResult(parseFailed, true)).stage.stageId, 'controller_visual_review');
});

test('controller_visual_review rejects non-controller prompt fixtures', () => {
  assert.throws(() => runControllerVisualReviewFixture({
    fixture: buildFixture({
      promptFixture: {
        schemaVersion: PROMPT_LAB_FIXTURE_SCHEMA_VERSION,
        promptId: 'executor.agentPrompt',
        input: {
          contextSections: '# Current Task\nImplement UI.',
        },
      },
    }),
  }), /requires controller\.audit/);
});

test('controller_visual_review rejects unsafe output paths', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'controller-visual-review-'));
  const fixturePath = path.join(tempDir, 'fixture.json');
  const existingOutPath = path.join(tempDir, 'existing-stage.json');
  await writeFile(fixturePath, JSON.stringify(buildFixture(), null, 2), 'utf8');
  await writeFile(existingOutPath, '{}', 'utf8');

  await assert.rejects(() => runControllerVisualReviewFixtureFile({
    fixturePath,
    outPath: path.join(tempDir, '.ralph', 'controller-reports', 'report.json'),
  }), /outside \.ralph and \.arena/);

  await assert.rejects(() => runControllerVisualReviewFixtureFile({
    fixturePath,
    outPath: fixturePath,
  }), /cannot overwrite the input fixture/);

  await assert.rejects(() => runControllerVisualReviewFixtureFile({
    fixturePath,
    outPath: existingOutPath,
  }), /refusing to overwrite an existing path/);

  assert.throws(() => runControllerVisualReviewFixture({
    fixture: buildFixture(),
    outPath: path.join(process.cwd(), 'src', 'stage-lab', 'controller-stage.json'),
  }), /system temp directory/);

  const loopOwnedCapturePath = path.join(tempDir, '.ralph', 'evidence', 'visual-workbench-capture-run.json');
  await mkdir(path.dirname(loopOwnedCapturePath), { recursive: true });
  await writeFile(loopOwnedCapturePath, JSON.stringify(buildVisualWorkbenchCaptureReport(), null, 2), 'utf8');
  await assert.rejects(() => runControllerVisualReviewFixtureFile({
    fixturePath,
    visualWorkbenchCaptureReportPaths: [loopOwnedCapturePath],
  }), /outside \.ralph and \.arena/);
});

test('controller_visual_review rejects symlinked output parents into loop-owned dirs', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'controller-visual-review-'));
  const loopTruthDir = path.join(tempDir, 'source', '.ralph', 'controller-reports');
  const symlinkPath = path.join(tempDir, 'linked-output');
  await mkdir(loopTruthDir, { recursive: true });
  await symlink(loopTruthDir, symlinkPath);

  assert.throws(() => runControllerVisualReviewFixture({
    fixture: buildFixture(),
    outPath: path.join(symlinkPath, 'controller-stage.json'),
  }), /must be outside \.ralph and \.arena/);
});

function buildFixture(overrides: Partial<ControllerVisualReviewFixture> = {}): ControllerVisualReviewFixture {
  return {
    schemaVersion: CONTROLLER_VISUAL_REVIEW_FIXTURE_SCHEMA_VERSION,
    name: 'tiny-visual-controller-review',
    promptVariantRef: 'visual-workbench-v0',
    sourceRef: 'fixture-source-ref',
    trigger: 'phase_complete',
    promptFixture: {
      schemaVersion: PROMPT_LAB_FIXTURE_SCHEMA_VERSION,
      promptId: 'controller.audit',
      name: 'tiny-visual-controller-prompt',
      input: {
        trigger: 'phase_complete',
        spec: '# Spec\nBuild a tiny synth UI with visual workbench stories.',
        planJson: JSON.stringify({
          projectGoal: 'Build a tiny synth lab.',
          phases: [{
            id: 'phase-1',
            name: 'Visual UI slice',
            description: 'Build and cover the first visual UI states.',
            order: 1,
            status: 'in_progress',
            planLater: false,
            tasks: [{
              id: 'task-001',
              displayTitle: 'Add synth pad story',
              description: 'Add a SynthPad visual workbench story.',
              acceptanceCriteria: ['SynthPad playing state renders.'],
              status: 'done',
              attempts: 1,
              dependencies: [],
              requiredRolePasses: ['ux'],
            }],
          }],
          judgments: [],
        }, null, 2),
        historyText: 'task-001 completed by executor fixture.',
        projectSnapshot: 'visual-workbench/stories/synth-pad.playing.tsx exists.',
        visionReportBlock: 'manual:task-001:synth-pad passed.',
        feedbackMatrixBlock: '',
        judgmentTimestamp: '2026-06-07T00:00:00.000Z',
        e2ePolicyBlock: 'E2E not applicable for this fixture.',
      },
    },
    controllerOutput: {
      success: true,
      output: controllerJsonBlock({
        verdict: 'continue',
        summary: 'Visual UI work has positive visual evidence.',
        planChanges: [],
        newJudgments: [],
        revisedJudgments: [],
        overclaimWarnings: [],
      }),
    },
    visualEvidence: [{
      ref: 'manual:task-001:synth-pad',
      kind: 'manual_assessment',
      result: 'pass',
      taskId: 'task-001',
      feedbackItemIds: ['DIFF-001'],
      summary: 'Synth pad story renders and matches the requested state.',
    }],
    ...overrides,
  };
}

function controllerJsonBlock(value: unknown): string {
  return `\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\``;
}

function buildVisualWorkbenchCaptureReport() {
  return {
    schemaVersion: 'ra-355.visual-workbench-capture-run.v0',
    status: 'captured',
    stage: {
      sourceRef: 'capture-source-ref',
    },
    stories: [{
      storyId: 'synth-pad.playing.desktop',
      title: 'Synth pad playing state',
      kind: 'widget',
      feature: 'instrument-surface',
      widget: 'SynthPad',
      state: 'playing',
      route: '/__visual/synth-pad.playing.desktop',
      claim: 'The synth pad shows the active note, pressure level and clear release affordance.',
      viewports: [{
        name: 'desktop',
        width: 1280,
        height: 832,
        status: 'captured',
        screenshotPath: '/tmp/screenshots/synth-pad.playing.desktop/desktop.png',
        screenshotSha256: 'sha256:abc123',
        error: null,
      }],
    }],
    error: null,
  };
}
