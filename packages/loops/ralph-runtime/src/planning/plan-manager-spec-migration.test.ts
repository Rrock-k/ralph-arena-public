import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { PlanManager } from './plan-manager.js';

function createWorkDir(prefix: string): string {
  return mkdtempSync(path.join(tmpdir(), prefix));
}

function readPersistedPlan(workDir: string): any {
  return JSON.parse(readFileSync(path.join(workDir, '.ralph', 'plan.json'), 'utf-8'));
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

test('old minimal plan JSON parses with RA-286 defaults', async () => {
  const workDir = createWorkDir('ralph-plan-migration-old-');
  mkdirSync(path.join(workDir, '.ralph'), { recursive: true });
  writeFileSync(
    path.join(workDir, '.ralph', 'plan.json'),
    JSON.stringify({
      specFile: 'spec.md',
      createdAt: '2026-05-14T00:00:00.000Z',
      updatedAt: '2026-05-14T00:00:00.000Z',
      phases: [{
        id: 'phase-1',
        name: 'Implementation',
        description: 'Build it',
        order: 1,
        tasks: [{
          id: 'task-001',
          description: 'Build the UI',
          acceptanceCriteria: ['UI works'],
        }],
      }],
      specMigrations: [{
        id: 'spec-001',
        specFile: 'spec.md',
        specHash: 'old-hash',
        appliedAt: '2026-05-14T00:00:00.000Z',
      }],
    }),
  );

  const manager = new PlanManager(workDir);
  const plan = await manager.load();

  assert.equal(plan.version, 1);
  assert.deepEqual(plan.judgments, []);
  assert.equal(plan.phases[0].status, 'pending');
  assert.equal(plan.phases[0].planLater, false);
  assert.equal(plan.phases[0].tasks[0].status, 'pending');
  assert.equal(plan.phases[0].tasks[0].attempts, 0);
  assert.deepEqual(plan.phases[0].tasks[0].dependencies, []);
  assert.deepEqual(plan.phases[0].tasks[0].feedbackItemRefs, []);
  assert.deepEqual(plan.phases[0].tasks[0].verificationEvidence, []);
  assert.deepEqual(plan.specMigrations[0].requiredFeedbackItems, []);
  assert.deepEqual(plan.specMigrations[0].feedbackDispositions, []);
});

test('recordSpecMigration persists feedback metadata on new migration entries', async () => {
  const workDir = createWorkDir('ralph-plan-migration-metadata-');
  const manager = new PlanManager(workDir);
  manager.createPlan('spec.md', [], []);

  const migration = manager.recordSpecMigration('spec.md', 'hash-v2', 'Reopened current bug feedback', {
    specChangeSource: {
      kind: 'extracted_current_feedback',
      itemCount: 1,
    },
    requiredFeedbackItems: [{
      itemId: 'BUG-005',
      kind: 'implementation_gap',
      changeType: 'reopened',
      status: 'reopened#1',
      summary: 'Users report the queue/card issue still exists.',
      fingerprint: 'bug-005-v2',
    }],
    feedbackDispositions: [{
      itemId: 'BUG-005',
      feedbackStatus: 'reopened#1',
      disposition: 'addTask',
      taskIds: ['task-046'],
      relatedCompletedTaskIds: ['task-010'],
      evidence: [{
        kind: 'manual_note',
        ref: 'feedback:BUG-005',
        summary: 'Accepted spec says the previous fix did not resolve the bug.',
      }],
      reason: 'Current accepted feedback supersedes completed historical task evidence.',
    }],
  });
  await manager.save();

  const persisted = readPersistedPlan(workDir);

  assert.equal(migration.id, 'spec-001');
  assert.equal(persisted.specMigrations.length, 1);
  assert.deepEqual(persisted.specMigrations[0].specChangeSource, {
    kind: 'extracted_current_feedback',
    itemCount: 1,
  });
  assert.deepEqual(persisted.specMigrations[0].requiredFeedbackItems, [{
    itemId: 'BUG-005',
    kind: 'implementation_gap',
    changeType: 'reopened',
    status: 'reopened#1',
    summary: 'Users report the queue/card issue still exists.',
    fingerprint: 'bug-005-v2',
  }]);
  assert.deepEqual(persisted.specMigrations[0].feedbackDispositions, [{
    itemId: 'BUG-005',
    feedbackStatus: 'reopened#1',
    disposition: 'addTask',
    taskIds: ['task-046'],
    relatedCompletedTaskIds: ['task-010'],
    evidence: [{
      kind: 'manual_note',
      ref: 'feedback:BUG-005',
      summary: 'Accepted spec says the previous fix did not resolve the bug.',
    }],
    judgmentIds: [],
    reason: 'Current accepted feedback supersedes completed historical task evidence.',
  }]);
});

test('computeSpecHash uses runner spec input hash for metadata-aware accepted specs', async () => {
  const workDir = createWorkDir('ralph-plan-spec-input-hash-');
  const specPath = path.join(workDir, 'spec.md');
  writeFileSync(specPath, '# Spec\n\nSame markdown\n');
  mkdirSync(path.join(workDir, '.arena'), { recursive: true });
  writeFileSync(path.join(workDir, '.arena', 'spec-input.json'), JSON.stringify({
    schemaVersion: 1,
    aggregateHash: 'input-hash-a',
    specs: [{
      id: 'spec-1',
      slug: 'Spec',
      hash: 'content-hash',
      inputHash: 'input-hash-a',
      metadataHash: 'sha256:metadata-a',
    }],
  }));

  const manager = new PlanManager(workDir);
  assert.equal(await manager.computeSpecHash(specPath), 'runner:input-hash-a');

  writeFileSync(path.join(workDir, '.arena', 'spec-input.json'), JSON.stringify({
    schemaVersion: 1,
    aggregateHash: 'legacy-hash',
    specs: [{
      id: 'spec-1',
      slug: 'Spec',
      hash: 'content-hash',
    }],
  }));
  assert.equal(await manager.computeSpecHash(specPath), sha256('# Spec\n\nSame markdown\n'));
});

test('duplicate recordSpecMigration returns existing entry without overwriting evidence', async () => {
  const workDir = createWorkDir('ralph-plan-migration-duplicate-');
  const manager = new PlanManager(workDir);
  manager.createPlan('spec.md', [], []);

  const first = manager.recordSpecMigration('spec.md', 'same-hash', {
    summary: 'First evidence',
    specChangeSource: {
      kind: 'extracted_current_feedback',
      itemCount: 1,
    },
    requiredFeedbackItems: [{
      itemId: 'BUG-005',
      kind: 'implementation_gap',
      changeType: 'reopened',
      summary: 'Original required feedback item.',
    }],
    feedbackDispositions: [{
      itemId: 'BUG-005',
      disposition: 'addTask',
      taskIds: ['task-046'],
      reason: 'Original disposition.',
    }],
  });

  const duplicate = manager.recordSpecMigration('spec.md', 'same-hash', {
    summary: 'Replacement evidence',
    specChangeSource: {
      kind: 'accepted_artifact',
      itemCount: 99,
    },
    requiredFeedbackItems: [{
      itemId: 'BUG-999',
      kind: 'implementation_gap',
      changeType: 'opened',
      summary: 'This should not overwrite.',
    }],
    feedbackDispositions: [{
      itemId: 'BUG-999',
      disposition: 'blocked',
      reason: 'This should not overwrite.',
    }],
  });
  await manager.save();

  const persisted = readPersistedPlan(workDir);

  assert.strictEqual(duplicate, first);
  assert.equal(persisted.specMigrations.length, 1);
  assert.equal(persisted.specMigrations[0].summary, 'First evidence');
  assert.deepEqual(persisted.specMigrations[0].specChangeSource, {
    kind: 'extracted_current_feedback',
    itemCount: 1,
  });
  assert.equal(persisted.specMigrations[0].requiredFeedbackItems[0].itemId, 'BUG-005');
  assert.equal(persisted.specMigrations[0].feedbackDispositions[0].itemId, 'BUG-005');
});

test('recordTaskVerificationEvidence persists deduplicated target evidence on linked task', async () => {
  const workDir = createWorkDir('ralph-plan-task-evidence-');
  const manager = new PlanManager(workDir);
  manager.createPlan('spec.md', [{
    id: 'phase-1',
    name: 'Implementation',
    description: 'Build it',
    order: 1,
    status: 'in_progress',
    planLater: false,
    tasks: [{
      id: 'task-011',
      description: 'Re-fix BUG-005',
      acceptanceCriteria: ['BUG-005 is fixed'],
      status: 'pending',
      attempts: 1,
      dependencies: [],
      feedbackItemRefs: [{ itemId: 'BUG-005' }],
    }],
  }], []);
  manager.findTask('task-011')!.status = 'in_progress';

  const evidence = [{
    kind: 'integration_test' as const,
    ref: 'verification:integration-tests',
    result: 'pass' as const,
    feedbackItemIds: ['BUG-005'],
    taskId: 'task-011',
    observedAt: '2026-05-14T00:00:00.000Z',
    summary: 'Integration tests passed (1/1).',
    recordedBy: 'executor' as const,
  }];

  assert.equal(manager.recordTaskVerificationEvidence('task-011', evidence), 1);
  assert.equal(manager.recordTaskVerificationEvidence('task-011', evidence), 0);
  await manager.save();

  const persisted = readPersistedPlan(workDir);
  assert.deepEqual(persisted.phases[0].tasks[0].verificationEvidence, evidence);
});

test('recordTaskVerificationEvidenceAndSave preserves unrelated raw plan shape', async () => {
  const workDir = createWorkDir('ralph-plan-narrow-evidence-write-');
  mkdirSync(path.join(workDir, '.ralph'), { recursive: true });
  const planPath = path.join(workDir, '.ralph', 'plan.json');
  const initialPlan = {
    version: 1,
    specFile: 'spec.md',
    specHash: 'runner:old-hash',
    createdAt: '2026-05-14T00:00:00.000Z',
    updatedAt: '2026-05-14T00:00:00.000Z',
    phases: [{
      id: 'phase-1',
      name: 'Implementation',
      description: 'Build it',
      order: 1,
      status: 'in_progress',
      tasks: [{
        id: 'task-target',
        description: 'Capture the visual state',
        acceptanceCriteria: ['Visual state is captured'],
        status: 'completed',
        attempts: 1,
        dependencies: [],
      }, {
        id: 'task-unrelated',
        description: 'Keep old evidence untouched',
        acceptanceCriteria: ['Old evidence stays as-is'],
        status: 'completed',
        attempts: 1,
        dependencies: [],
        verificationEvidence: [{
          kind: 'unit_test',
          ref: 'verification:unit-tests',
          result: 'pass',
          feedbackItemIds: ['BUG-OLD'],
          taskId: 'task-unrelated',
          observedAt: '2026-05-14T01:00:00.000Z',
          summary: 'Unit tests passed.',
          recordedBy: 'executor',
        }],
      }],
    }],
    judgments: [],
    specMigrations: [{
      id: 'spec-001',
      specFile: 'spec.md',
      specHash: 'runner:old-hash',
      appliedAt: '2026-05-14T00:00:00.000Z',
      feedbackDispositions: [{
        taskIds: ['task-target'],
        itemId: 'BUG-OLD',
        feedbackStatus: 'created',
        disposition: 'coveredByOpenTask',
        reason: 'Existing migration disposition.',
      }],
    }],
  };
  writeFileSync(planPath, JSON.stringify(initialPlan, null, 2));

  const evidence = [{
    kind: 'screenshot' as const,
    ref: 'visual-workbench-capture:story:desktop:abcdef123456',
    observedAt: '2026-05-14T02:00:00.000Z',
    summary: 'Visual Workbench story captured.',
    result: 'inconclusive' as const,
    feedbackItemIds: ['BUG-NEW'],
    taskId: 'task-target',
    artifactPath: '.ralph/visual-workbench/story/desktop/abcdef123456.png',
    artifactSha256: `sha256:${sha256('fake-png')}`,
    recordedBy: 'agent' as const,
  }];

  const manager = new PlanManager(workDir);
  assert.equal(await manager.recordTaskVerificationEvidenceAndSave('task-target', evidence), 1);

  const persisted = readPersistedPlan(workDir);
  assert.notEqual(persisted.updatedAt, initialPlan.updatedAt);
  assert.deepEqual(persisted.phases[0].tasks[0], {
    ...initialPlan.phases[0].tasks[0],
    verificationEvidence: evidence,
  });
  assert.deepEqual(persisted.phases[0].tasks[1], initialPlan.phases[0].tasks[1]);
  assert.deepEqual(persisted.specMigrations, initialPlan.specMigrations);
  assert.equal(persisted.specHash, initialPlan.specHash);
  assert.equal(Object.prototype.hasOwnProperty.call(persisted.phases[0].tasks[0], 'feedbackItemRefs'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(persisted.phases[0].tasks[1], 'feedbackItemRefs'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(persisted.specMigrations[0], 'requiredFeedbackItems'), false);

  const beforeRepeat = readFileSync(planPath, 'utf-8');
  assert.equal(await manager.recordTaskVerificationEvidenceAndSave('task-target', evidence), 0);
  assert.equal(readFileSync(planPath, 'utf-8'), beforeRepeat);
});
