import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildTaskProofExpectations,
  collectTaskVerificationEvidence,
  hasPositiveFeedbackEvidenceForItem,
  mergeFeedbackEvidence,
} from './evidence.js';
import type { Task, VerificationResult } from '../config/types.js';

function linkedTask(): Task {
  return {
    id: 'task-011',
    description: 'Re-fix BUG-005',
    acceptanceCriteria: ['BUG-005 is fixed against the current spec'],
    status: 'in_progress',
    attempts: 1,
    dependencies: [],
    feedbackItemRefs: [{
      itemId: 'BUG-005',
      targetType: 'feedback',
      targetId: 'BUG-005',
      workImpact: 'requires_loop_work',
      workSurface: 'frontend',
    }],
  };
}

test('collectTaskVerificationEvidence records only checks with concrete target signal for linked feedback', () => {
  const verification: VerificationResult = {
    passed: true,
    lint: { passed: true, errors: [] },
    build: { passed: true, errors: [] },
    typecheck: { passed: true, errors: [] },
    unitTests: { passed: true, total: 0, passed_count: 0, errors: [] },
    integrationTests: { passed: true, total: 3, passed_count: 3, errors: [] },
    postDeploy: {
      passed: true,
      summary: 'Smoke: 2 pages checked, 2 OK | Screenshots: .ralph/screenshots',
      errors: [],
      screenshotDir: '.ralph/screenshots',
    },
  };

  const evidence = collectTaskVerificationEvidence(linkedTask(), verification, '2026-05-14T00:00:00.000Z');

  assert.deepEqual(evidence.map((row) => row.kind), ['integration_test', 'post_deploy_smoke']);
  assert.deepEqual(evidence[0].feedbackItemIds, ['BUG-005']);
  assert.equal(evidence[0].result, 'pass');
  assert.equal(evidence[1].artifactPath, '.ralph/screenshots');
  assert.equal(evidence[1].screenshotProof, undefined);
});

test('collectTaskVerificationEvidence preserves targeted unit-test evidence hints', () => {
  const verification: VerificationResult = {
    passed: true,
    unitTests: {
      passed: true,
      total: 2,
      passed_count: 2,
      errors: [],
      evidenceHints: [{
        kind: 'test',
        ref: 'verification:unit-tests:browser-responsive',
        command: 'npm test',
        summary: 'Browser-responsive visual test suite ran inside the unit test command. Signals: mobile-390, desktop-1440.',
        target: {
          route: '/study',
          viewport: { width: 390, height: 844 },
          claim: 'Study buttons stay visible during the animation.',
        },
      }],
    },
  };

  const evidence = collectTaskVerificationEvidence(linkedTask(), verification, '2026-05-14T00:00:00.000Z');

  assert.deepEqual(evidence.map((row) => row.kind), ['unit_test', 'test']);
  assert.equal(evidence[1].ref, 'verification:unit-tests:browser-responsive');
  assert.equal(evidence[1].command, 'npm test');
  assert.equal(evidence[1].result, 'pass');
  assert.deepEqual(evidence[1].feedbackItemIds, ['BUG-005']);
  assert.deepEqual(evidence[1].target, {
    route: '/study',
    viewport: { width: 390, height: 844 },
    claim: 'Study buttons stay visible during the animation.',
  });
});

test('buildTaskProofExpectations stays disabled while screenshot proof review is redesigned', () => {
  const task = linkedTask();
  task.requiredRolePasses = ['ux'];
  const webProject = {
    techStack: {
      language: 'typescript',
      framework: 'next.js',
      runtime: 'node.js',
    },
  };

  assert.deepEqual(buildTaskProofExpectations(webProject, task), []);
  assert.deepEqual(buildTaskProofExpectations(webProject, {
    ...task,
    requiredRolePasses: ['product'],
  }), []);
  assert.deepEqual(buildTaskProofExpectations({
    techStack: { language: 'typescript', framework: 'three.js', runtime: 'webgl' },
  }, task), []);
});

test('collectTaskVerificationEvidence skips tasks without feedback refs', () => {
  const task = linkedTask();
  task.feedbackItemRefs = [];
  const evidence = collectTaskVerificationEvidence(task, {
    passed: true,
    integrationTests: { passed: true, total: 1, passed_count: 1, errors: [] },
  });

  assert.deepEqual(evidence, []);
});

test('collectTaskVerificationEvidence does not treat browser infra skip as post-deploy closure evidence', () => {
  const evidence = collectTaskVerificationEvidence(linkedTask(), {
    passed: true,
    postDeploy: {
      passed: true,
      infraUnavailable: true,
      summary: 'Smoke skipped: INFRA_BROWSER_UNAVAILABLE',
      errors: ['INFRA_BROWSER_UNAVAILABLE: Platform Playwright browser readiness is unavailable.'],
      screenshotDir: null,
    },
  });

  assert.deepEqual(evidence, []);
});

test('mergeFeedbackEvidence deduplicates stable evidence rows', () => {
  const evidence = collectTaskVerificationEvidence(linkedTask(), {
    passed: true,
    integrationTests: { passed: true, total: 1, passed_count: 1, errors: [] },
  }, '2026-05-14T00:00:00.000Z');

  assert.equal(mergeFeedbackEvidence(evidence, evidence).length, 1);
});

test('hasPositiveFeedbackEvidenceForItem rejects failing, generic and commit-only evidence', () => {
  assert.equal(hasPositiveFeedbackEvidenceForItem('BUG-005', [{
    kind: 'integration_test',
    ref: 'verification:integration-tests',
    result: 'fail',
    feedbackItemIds: ['BUG-005'],
    summary: 'Integration tests failed.',
  }]), false);

  assert.equal(hasPositiveFeedbackEvidenceForItem('BUG-005', [{
    kind: 'integration_test',
    ref: 'verification:integration-tests',
    result: 'pass',
    feedbackItemIds: ['BUG-009'],
    summary: 'Integration tests passed.',
  }]), false);

  assert.equal(hasPositiveFeedbackEvidenceForItem('BUG-005', [{
    kind: 'commit',
    ref: 'abc123',
    feedbackItemIds: ['BUG-005'],
    summary: 'Committed a change.',
  }]), false);

  assert.equal(hasPositiveFeedbackEvidenceForItem('BUG-005', [{
    kind: 'manual_note',
    ref: 'controller:test',
    summary: 'Manual verification directly checked BUG-005.',
  }], { allowImplicitItemLink: true }), true);
});
