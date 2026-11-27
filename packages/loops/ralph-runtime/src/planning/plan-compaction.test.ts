import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import {
  compactPlan,
  rollFeedbackLedger,
  appendPlanArchive,
  PLAN_ARCHIVE_RELATIVE_PATH,
  type PlanCompactionConfig,
} from './plan-compaction.js';
import { PlanManager } from './plan-manager.js';
import { PlanSchema } from '../config/types.js';
import type {
  Judgment,
  Plan,
  SpecFeedbackDisposition,
  SpecMigration,
  SpecMigrationFeedbackItem,
  Task,
} from '../config/types.js';

const CONFIG: PlanCompactionConfig = {
  enabled: true,
  minPlanChars: 0,
  migrationDetailRetention: 8,
  judgmentRetention: 20,
  completedTaskDetailRetention: 12,
};

function feedbackItem(itemId: string, overrides: Partial<SpecMigrationFeedbackItem> = {}): SpecMigrationFeedbackItem {
  return {
    itemId,
    kind: 'feedback',
    changeType: 'opened',
    summary: `Summary for ${itemId}`,
    ...overrides,
  };
}

function disposition(itemId: string, overrides: Partial<SpecFeedbackDisposition> = {}): SpecFeedbackDisposition {
  return {
    itemId,
    disposition: 'addTask',
    reason: `Disposition for ${itemId}`,
    ...overrides,
  };
}

function migration(index: number, overrides: Partial<SpecMigration> = {}): SpecMigration {
  return {
    id: `spec-${String(index).padStart(3, '0')}`,
    specFile: 'spec.md',
    specHash: `hash-${index}`,
    appliedAt: new Date(2026, 0, index).toISOString(),
    requiredFeedbackItems: [],
    feedbackDispositions: [],
    ...overrides,
  };
}

function judgment(index: number): Judgment {
  return {
    id: `judgment-${String(index).padStart(3, '0')}`,
    timestamp: new Date(2026, 0, index).toISOString(),
    ambiguity: `Ambiguity ${index}`,
    options: ['a', 'b'],
    chosen: 0,
    reasoning: `Reasoning ${index}`,
    madeBy: 'planner',
  };
}

function task(id: string, status: Task['status'], overrides: Partial<Task> = {}): Task {
  return {
    id,
    description: `Task ${id} `.repeat(40),
    acceptanceCriteria: ['criterion one', 'criterion two'],
    status,
    attempts: 0,
    dependencies: [],
    verificationEvidence: [],
    ...overrides,
  };
}

function basePlan(overrides: Partial<Plan> = {}): Plan {
  return {
    version: 1,
    specFile: 'spec.md',
    specHash: 'hash-current',
    createdAt: new Date(2026, 0, 1).toISOString(),
    updatedAt: new Date(2026, 0, 1).toISOString(),
    phases: [],
    judgments: [],
    specMigrations: [],
    ...overrides,
  };
}

// ── rollFeedbackLedger ─────────────────────────────────────────

test('rollFeedbackLedger keeps the latest item and disposition per itemId', () => {
  const plan = basePlan({
    specMigrations: [
      migration(1, {
        requiredFeedbackItems: [feedbackItem('BUG-1', { status: 'open', fingerprint: 'f1' })],
        feedbackDispositions: [disposition('BUG-1', { disposition: 'addTask' })],
      }),
      migration(2, {
        requiredFeedbackItems: [feedbackItem('BUG-1', { status: 'reopened#1', fingerprint: 'f2' })],
        feedbackDispositions: [disposition('BUG-1', { disposition: 'updateOpenTask' })],
      }),
    ],
  });

  const ledger = rollFeedbackLedger(plan);
  assert.equal(ledger['BUG-1'].item.status, 'reopened#1');
  assert.equal(ledger['BUG-1'].item.fingerprint, 'f2');
  assert.equal(ledger['BUG-1'].disposition?.disposition, 'updateOpenTask');
  assert.equal(ledger['BUG-1'].migrationId, 'spec-002');
});

test('rollFeedbackLedger keeps older disposition when a newer migration tracks the item without one', () => {
  const plan = basePlan({
    specMigrations: [
      migration(1, {
        requiredFeedbackItems: [feedbackItem('BUG-002')],
        feedbackDispositions: [disposition('BUG-002', { disposition: 'closedByEvidence' })],
      }),
      migration(2, {
        requiredFeedbackItems: [feedbackItem('BUG-002', { status: 'reopened#1' })],
      }),
    ],
  });

  const ledger = rollFeedbackLedger(plan);
  assert.equal(ledger['BUG-002'].item.status, 'reopened#1');
  assert.equal(ledger['BUG-002'].disposition?.disposition, 'closedByEvidence');
});

test('rollFeedbackLedger synthesizes an entry for a disposition without a tracked item', () => {
  const plan = basePlan({
    specMigrations: [
      migration(1, { feedbackDispositions: [disposition('BUG-003')] }),
    ],
  });

  const ledger = rollFeedbackLedger(plan);
  assert.equal(ledger['BUG-003'].disposition?.disposition, 'addTask');
  assert.equal(ledger['BUG-003'].item.itemId, 'BUG-003');
});

test('rollFeedbackLedger preserves prior ledger entries not present in retained migrations', () => {
  const plan = basePlan({
    feedbackLedger: {
      'BUG-OLD': {
        itemId: 'BUG-OLD',
        migrationId: 'spec-000',
        appliedAt: new Date(2025, 0, 1).toISOString(),
        item: feedbackItem('BUG-OLD', { status: 'open' }),
        disposition: disposition('BUG-OLD', { disposition: 'blocked' }),
      },
    },
    specMigrations: [migration(5, { requiredFeedbackItems: [feedbackItem('BUG-NEW')] })],
  });

  const ledger = rollFeedbackLedger(plan);
  assert.equal(ledger['BUG-OLD'].disposition?.disposition, 'blocked');
  assert.ok(ledger['BUG-NEW']);
});

// ── compactPlan: gating ────────────────────────────────────────

test('compactPlan is a no-op when disabled or below minPlanChars', () => {
  const plan = basePlan({
    specMigrations: Array.from({ length: 30 }, (_, i) => migration(i + 1, {
      requiredFeedbackItems: [feedbackItem(`BUG-${i}`)],
    })),
  });

  const disabled = compactPlan(plan, { ...CONFIG, enabled: false });
  assert.equal(disabled.changed, false);

  const tooSmall = compactPlan(plan, { ...CONFIG, minPlanChars: 100_000_000 });
  assert.equal(tooSmall.changed, false);
  assert.equal(plan.specMigrations[0].archivedDetail, undefined);
});

// ── compactPlan: migrations ────────────────────────────────────

test('compactPlan archives old migration payloads but keeps index rows and invariants', () => {
  const plan = basePlan({
    specMigrations: Array.from({ length: 20 }, (_, i) => migration(i + 1, {
      requiredFeedbackItems: [feedbackItem(`BUG-${i + 1}`)],
      feedbackDispositions: [disposition(`BUG-${i + 1}`)],
      specChangeSource: { system: 'tg-spec', projectId: 'p1', version: i + 1 },
    })),
  });

  const result = compactPlan(plan, CONFIG);
  assert.equal(result.changed, true);
  // 20 migrations, retention 8, latest-per-specFile protects spec-020 (already retained).
  assert.equal(result.stats.migrationDetailsArchived, 12);

  const stripped = plan.specMigrations[0];
  assert.equal(stripped.archivedDetail, true);
  assert.equal(stripped.requiredFeedbackItems, undefined);
  assert.equal(stripped.feedbackDispositions, undefined);
  // Index invariants survive: id, specFile, specHash, specChangeSource.
  assert.equal(stripped.id, 'spec-001');
  assert.equal(stripped.specHash, 'hash-1');
  assert.equal(stripped.specChangeSource?.version, 1);
  // Recent window keeps payloads.
  const retained = plan.specMigrations[plan.specMigrations.length - 1];
  assert.equal(retained.requiredFeedbackItems?.length, 1);
  // Ledger covers every archived item.
  assert.equal(plan.feedbackLedger?.['BUG-1']?.disposition?.disposition, 'addTask');
});

test('compactPlan never strips the latest migration of each distinct specFile', () => {
  const plan = basePlan({
    specMigrations: [
      migration(1, {
        specFile: 'specs/other.md',
        requiredFeedbackItems: [feedbackItem('OTHER-1')],
      }),
      ...Array.from({ length: 20 }, (_, i) => migration(i + 2, {
        requiredFeedbackItems: [feedbackItem(`BUG-${i + 2}`)],
      })),
    ],
  });

  compactPlan(plan, CONFIG);
  const other = plan.specMigrations[0];
  assert.equal(other.archivedDetail, undefined);
  assert.equal(other.requiredFeedbackItems?.length, 1);
});

test('compactPlan enforces retention floors below projection windows', () => {
  const plan = basePlan({
    specMigrations: Array.from({ length: 10 }, (_, i) => migration(i + 1, {
      requiredFeedbackItems: [feedbackItem(`BUG-${i + 1}`)],
    })),
  });

  // Configured retention 1 must be clamped to the floor of 8.
  compactPlan(plan, { ...CONFIG, migrationDetailRetention: 1 });
  const withPayload = plan.specMigrations.filter(m => (m.requiredFeedbackItems?.length ?? 0) > 0);
  assert.equal(withPayload.length, 8);
});

// ── compactPlan: judgments ─────────────────────────────────────

test('compactPlan prunes old judgments and keeps the id watermark monotonic', () => {
  const plan = basePlan({
    judgments: Array.from({ length: 30 }, (_, i) => judgment(i + 1)),
  });

  const result = compactPlan(plan, CONFIG);
  assert.equal(result.stats.judgmentsArchived, 10);
  assert.equal(plan.judgments.length, 20);
  assert.equal(plan.judgments[0].id, 'judgment-011');
  assert.equal(plan.compaction?.judgmentIdWatermark, 10);

  // Second pass: nothing more to prune, watermark survives.
  const again = compactPlan(plan, CONFIG);
  assert.equal(again.stats.judgmentsArchived, 0);
  assert.equal(plan.compaction?.judgmentIdWatermark, 10);
});

// ── compactPlan: completed task detail ─────────────────────────

test('compactPlan stubs old completed tasks but never open or feedback-linked ones', () => {
  const tasks: Task[] = [
    ...Array.from({ length: 20 }, (_, i) => task(`task-${String(i + 1).padStart(3, '0')}`, 'completed')),
    task('task-linked', 'completed', { feedbackItemRefs: [{ itemId: 'BUG-100', status: 'open' }] as Task['feedbackItemRefs'] }),
    task('task-open', 'in_progress'),
    task('task-pending', 'pending'),
  ];
  const plan = basePlan({
    phases: [{
      id: 'phase-1', name: 'p', description: 'p', order: 1, status: 'in_progress', planLater: false, tasks,
    }],
    specMigrations: [
      migration(1, {
        feedbackDispositions: [disposition('BUG-200', { relatedCompletedTaskIds: ['task-002'] })],
      }),
    ],
  });

  const result = compactPlan(plan, CONFIG);
  // 21 closed tasks, retention 12 keeps the last 12 (incl. task-linked);
  // task-001..task-009 are candidates, minus task-002 (ledger-linked) = 8.
  assert.equal(result.stats.taskDetailsArchived, 8);

  const byId = new Map(plan.phases[0].tasks.map(t => [t.id, t]));
  assert.equal(byId.get('task-001')?.archivedDetail, true);
  assert.equal(byId.get('task-001')?.acceptanceCriteria.length, 0);
  assert.equal(byId.get('task-001')?.verificationEvidence, undefined);
  assert.ok((byId.get('task-001')?.description.length ?? 0) <= 200);
  // Ledger-linked completed task keeps full detail.
  assert.equal(byId.get('task-002')?.archivedDetail, undefined);
  assert.equal(byId.get('task-002')?.acceptanceCriteria.length, 2);
  // Feedback-ref task keeps full detail.
  assert.equal(byId.get('task-linked')?.archivedDetail, undefined);
  // Open tasks untouched.
  assert.equal(byId.get('task-open')?.archivedDetail, undefined);
  assert.equal(byId.get('task-pending')?.archivedDetail, undefined);
});

test('compactPlan is idempotent over already-stubbed tasks', () => {
  const tasks = Array.from({ length: 20 }, (_, i) => task(`task-${String(i + 1).padStart(3, '0')}`, 'completed'));
  const plan = basePlan({
    phases: [{ id: 'phase-1', name: 'p', description: 'p', order: 1, status: 'in_progress', planLater: false, tasks }],
  });

  const first = compactPlan(plan, CONFIG);
  const second = compactPlan(plan, CONFIG);
  assert.equal(first.stats.taskDetailsArchived, 8);
  assert.equal(second.stats.taskDetailsArchived, 0);
  assert.equal(second.changed, false);
});

// ── schema round-trip and PlanManager wiring ───────────────────

test('compacted plan round-trips through PlanSchema and PlanManager save/load', async () => {
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ralph-compaction-'));
  try {
    const plan = basePlan({
      specMigrations: Array.from({ length: 20 }, (_, i) => migration(i + 1, {
        requiredFeedbackItems: [feedbackItem(`BUG-${i + 1}`)],
        feedbackDispositions: [disposition(`BUG-${i + 1}`)],
      })),
      judgments: Array.from({ length: 25 }, (_, i) => judgment(i + 1)),
    });

    const result = compactPlan(plan, CONFIG);
    assert.equal(result.changed, true);
    await appendPlanArchive(workDir, result.archiveEntries);

    // Archive is valid JSONL with schemaVersion rows.
    const archivePath = path.join(workDir, PLAN_ARCHIVE_RELATIVE_PATH);
    const lines = (await fs.readFile(archivePath, 'utf-8')).trim().split('\n');
    assert.equal(lines.length, result.archiveEntries.length);
    for (const line of lines) {
      const row = JSON.parse(line);
      assert.equal(row.schemaVersion, 'ra-373.plan-archive.v1');
    }

    // Compacted plan still parses strictly and loads through PlanManager.
    const parsed = PlanSchema.parse(JSON.parse(JSON.stringify(plan)));
    assert.ok(parsed.feedbackLedger?.['BUG-1']);

    await fs.ensureDir(path.join(workDir, '.ralph'));
    await fs.writeJson(path.join(workDir, '.ralph', 'plan.json'), plan, { spaces: 2 });
    const manager = new PlanManager(workDir);
    const loaded = await manager.load();
    assert.equal(loaded.compaction?.archivedMigrationDetails, 12);
    assert.equal(manager.getFeedbackLedgerEntry('BUG-1')?.itemId, 'BUG-1');
    // normalizePlan re-adds empty arrays; stripped migrations must not re-archive.
    const rerun = compactPlan(loaded, CONFIG);
    assert.equal(rerun.stats.migrationDetailsArchived, 0);
  } finally {
    await fs.remove(workDir);
  }
});

test('PlanManager.save runs compaction only when configured', async () => {
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ralph-compaction-save-'));
  try {
    const plan = basePlan({
      specMigrations: Array.from({ length: 20 }, (_, i) => migration(i + 1, {
        requiredFeedbackItems: [feedbackItem(`BUG-${i + 1}`)],
      })),
    });
    await fs.ensureDir(path.join(workDir, '.ralph'));
    await fs.writeJson(path.join(workDir, '.ralph', 'plan.json'), plan, { spaces: 2 });

    // Without compaction config: no archive file appears.
    const plain = new PlanManager(workDir);
    await plain.load();
    await plain.save();
    assert.equal(await fs.pathExists(path.join(workDir, PLAN_ARCHIVE_RELATIVE_PATH)), false);

    // With compaction config: archive appears and plan shrinks.
    const compacting = new PlanManager(workDir, CONFIG);
    await compacting.load();
    await compacting.save();
    assert.equal(await fs.pathExists(path.join(workDir, PLAN_ARCHIVE_RELATIVE_PATH)), true);
    const saved = PlanSchema.parse(await fs.readJson(path.join(workDir, '.ralph', 'plan.json')));
    assert.equal(saved.specMigrations[0].archivedDetail, true);
    assert.ok(saved.feedbackLedger?.['BUG-1']);
  } finally {
    await fs.remove(workDir);
  }
});
