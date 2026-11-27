import assert from 'node:assert/strict';
import test from 'node:test';
import type { ScreenshotProofTarget } from '../config/types.js';
import {
  VISUAL_SCENARIO_SCHEMA_VERSION,
  parseVisualScenario,
  visualScenarioTargetForScreenshotProof,
  type VisualScenario,
} from './visual-scenario.js';

function validScenario(overrides: Partial<VisualScenario> = {}) {
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
      claim: 'The shared synth surface is visible and ready for interaction.',
      state: 'fresh project fixture',
      interaction: 'initial page load',
      waitAfterLoadMs: 1500,
    },
    ...overrides,
  };
}

test('Visual Scenario parses a minimal ordinary-web target contract', () => {
  const scenario = parseVisualScenario(validScenario());
  const target: ScreenshotProofTarget = visualScenarioTargetForScreenshotProof(scenario);

  assert.equal(scenario.schemaVersion, VISUAL_SCENARIO_SCHEMA_VERSION);
  assert.equal(scenario.projectClass, 'ordinary_web');
  assert.equal(scenario.scenarioId, 'mini-jam.home.v1');
  assert.equal(target.route, '/?mode=lab');
  assert.deepEqual(target.viewport, { width: 1280, height: 720 });
  assert.equal(target.claim, 'The shared synth surface is visible and ready for interaction.');
  assert.equal(target.waitAfterLoadMs, 1500);
});

test('Visual Scenario rejects unknown root and target fields', () => {
  assert.throws(() => parseVisualScenario({
    ...validScenario(),
    verificationEvidence: [],
  }), /unrecognized_keys|Unrecognized key/i);

  assert.throws(() => parseVisualScenario(validScenario({
    target: {
      ...validScenario().target,
      proofReviews: [],
    } as unknown as VisualScenario['target'],
  })), /unrecognized_keys|Unrecognized key/i);
});

test('Visual Scenario rejects task, proof and evidence ownership fields', () => {
  for (const forbiddenKey of ['taskId', 'feedbackItemIds', 'proofReviews', 'verificationEvidence', 'artifactPath', 'artifactSha256']) {
    assert.throws(() => parseVisualScenario({
      ...validScenario(),
      [forbiddenKey]: 'not-a-lab-contract-field',
    }), /unrecognized_keys|Unrecognized key/i);
  }
});

test('Visual Scenario requires an explicit visual claim', () => {
  assert.throws(() => parseVisualScenario(validScenario({
    target: {
      ...validScenario().target,
      claim: '',
    },
  })), /too_small|String must contain/i);

  const { claim: _claim, ...targetWithoutClaim } = validScenario().target;
  assert.throws(() => parseVisualScenario(validScenario({
    target: targetWithoutClaim as VisualScenario['target'],
  })), /Required|invalid_type/i);

  assert.throws(() => parseVisualScenario(validScenario({
    target: {
      ...validScenario().target,
      claim: '   ',
    },
  })), /Claim must/i);
});

test('Visual Scenario accepts only local browser routes', () => {
  for (const route of ['https://example.com/', '//example.com/path', '/admin\\settings', '/admin\nsettings']) {
    assert.throws(() => parseVisualScenario(validScenario({
      target: {
        ...validScenario().target,
        route,
      },
    })), /Route must/i);
  }
});

test('Visual Scenario validates viewport bounds', () => {
  for (const viewport of [
    { width: 0, height: 720 },
    { width: 1280, height: 0 },
    { width: 10_001, height: 720 },
    { width: 1280.5, height: 720 },
  ]) {
    assert.throws(() => parseVisualScenario(validScenario({
      target: {
        ...validScenario().target,
        viewport,
      },
    })), /too_small|too_big|int|integer|number/i);
  }
});

test('Visual Scenario validates bounded explicit settle wait', () => {
  assert.equal(parseVisualScenario(validScenario({
    target: {
      ...validScenario().target,
      waitAfterLoadMs: 0,
    },
  })).target.waitAfterLoadMs, 0);

  for (const waitAfterLoadMs of [-1, 10_001, 100.5]) {
    assert.throws(() => parseVisualScenario(validScenario({
      target: {
        ...validScenario().target,
        waitAfterLoadMs,
      },
    })), /too_small|too_big|int|integer|number/i);
  }
});
