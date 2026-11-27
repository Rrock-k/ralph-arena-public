import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { enforceE2ECoverage } from './e2e-enforcer.js';
import { PlanManager } from '../planning/plan-manager.js';

test('e2e enforcer tasks forbid project-local browser infra installs', () => {
  const workDir = mkdtempSync(path.join(tmpdir(), 'ralph-e2e-enforcer-browser-'));
  const manager = new PlanManager(workDir);

  manager.createPlan('spec.md', [{
    id: 'phase-1',
    name: 'Feature',
    description: 'Feature phase',
    order: 1,
    status: 'in_progress',
    planLater: false,
    tasks: [
      {
        id: 'task-001',
        description: 'Build profile form',
        acceptanceCriteria: ['Form saves'],
        status: 'completed',
        attempts: 1,
        dependencies: [],
      },
      {
        id: 'task-002',
        description: 'Build settings page',
        acceptanceCriteria: ['Settings save'],
        status: 'completed',
        attempts: 1,
        dependencies: [],
      },
    ],
  }], []);

  const { changes } = enforceE2ECoverage(manager);
  const addedTasks = changes
    .filter((change) => change.action === 'addTask')
    .map((change) => (change as any).task);

  assert.equal(addedTasks.length, 3);
  for (const task of addedTasks) {
    const text = [task.description, ...task.acceptanceCriteria].join('\n');
    assert.match(text, /platform-provided browser readiness|platform browser readiness/i);
    assert.match(text, /INFRA_BROWSER_UNAVAILABLE/);
    assert.match(text, /Do not install Chromium|without project-local browser install/);
    assert.doesNotMatch(text, /Must pass `npx playwright test/);
    assert.doesNotMatch(text, /All tests must pass with 0 failures/);
  }
});

test('e2e enforcer normalizes pending legacy e2e task wording', () => {
  const workDir = mkdtempSync(path.join(tmpdir(), 'ralph-e2e-enforcer-legacy-browser-'));
  const manager = new PlanManager(workDir);

  manager.createPlan('spec.md', [{
    id: 'phase-1',
    name: 'Feature',
    description: 'Feature phase',
    order: 1,
    status: 'in_progress',
    planLater: false,
    tasks: [
      {
        id: 'task-001',
        description: 'Build profile form',
        acceptanceCriteria: ['Form saves'],
        status: 'completed',
        attempts: 1,
        dependencies: [],
      },
      {
        id: 'task-002',
        description: 'Build settings page',
        acceptanceCriteria: ['Settings save'],
        status: 'completed',
        attempts: 1,
        dependencies: [],
      },
      {
        id: 'e2e-task-001',
        description: 'Write Playwright e2e test. Must pass `npx playwright test e2e-task-001`.',
        acceptanceCriteria: ['All tests must pass with 0 failures'],
        status: 'pending',
        attempts: 0,
        dependencies: ['task-001'],
      },
      {
        id: 'e2e-run-all',
        description: 'Run all Playwright tests.',
        acceptanceCriteria: ['All tests must pass with 0 failures'],
        status: 'pending',
        attempts: 0,
        dependencies: ['e2e-task-001'],
      },
    ],
  }], []);

  const { changes } = enforceE2ECoverage(manager);
  const updates = changes.filter((change) => change.action === 'updateTask');

  assert.deepEqual(updates.map((change: any) => change.taskId).sort(), ['e2e-run-all', 'e2e-task-001']);
  for (const change of updates as any[]) {
    const text = [change.changes.description, ...change.changes.acceptanceCriteria].join('\n');
    assert.match(text, /INFRA_BROWSER_UNAVAILABLE/);
    assert.match(text, /without project-local browser install|Do not install Chromium/);
    assert.doesNotMatch(text, /Must pass `npx playwright test/);
    assert.doesNotMatch(text, /All tests must pass with 0 failures/);
  }
});
