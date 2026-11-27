/**
 * Plan compaction (RA-373)
 *
 * Long-lived plans accumulate unbounded history inside .ralph/plan.json:
 * spec migration payloads, judgments and completed-task detail. That history
 * is audit truth, but it is not hot runtime truth — measured on a 3-month
 * project it grew plan.json to 3.7 MB and inflated controller/planner context
 * by orders of magnitude.
 *
 * Compaction moves historical detail into an append-only archive file
 * (.ralph/plan-archive.jsonl) while preserving every runtime invariant the
 * consumer map in docs/backlog/ralph-arena.md (RA-373) records:
 *
 * - `hasSpecMigration(specFile, specHash)` dedupe: migration index rows keep
 *   id/specFile/specHash/appliedAt/specChangeSource/summary.
 * - `collectPlanAcknowledgedSourceVersions`: specChangeSource survives on
 *   index rows.
 * - `findLatestTrackedFeedbackItem` / `findLatestFeedbackDisposition`: the
 *   plan-level feedback ledger keeps the latest tracked item + disposition
 *   per itemId (rolled up from full history before any payload is stripped).
 * - `nextSpecMigrationId`: ids survive on index rows.
 * - `nextJudgmentNumber`: `compaction.judgmentIdWatermark` keeps numbering
 *   monotonic after judgment pruning.
 * - Feedback-linked tasks (feedbackItemRefs or referenced by any ledger
 *   disposition) are never stubbed — controller evidence matrix and
 *   `planReferencesFeedbackItem` keep their structured truth.
 *
 * Archive rows are append-only forensic history; a crash between archive
 * append and plan save may duplicate archive rows, never lose plan truth.
 */

import * as path from 'path';
import fs from 'fs-extra';
import type {
  FeedbackLedgerEntry,
  Judgment,
  Plan,
  SpecMigration,
  Task,
} from '../config/types.js';

export interface PlanCompactionConfig {
  enabled: boolean;
  minPlanChars: number;
  migrationDetailRetention: number;
  judgmentRetention: number;
  completedTaskDetailRetention: number;
}

export const PLAN_ARCHIVE_RELATIVE_PATH = path.join('.ralph', 'plan-archive.jsonl');

const ARCHIVE_SCHEMA_VERSION = 'ra-373.plan-archive.v1';
const STUB_DESCRIPTION_MAX_CHARS = 200;

export type PlanArchiveEntry = {
  schemaVersion: typeof ARCHIVE_SCHEMA_VERSION;
  archivedAt: string;
  kind: 'migration_detail' | 'judgment' | 'task_detail';
  payload: unknown;
};

export interface PlanCompactionResult {
  changed: boolean;
  archiveEntries: PlanArchiveEntry[];
  stats: {
    migrationDetailsArchived: number;
    judgmentsArchived: number;
    taskDetailsArchived: number;
  };
}

/**
 * Roll the latest tracked feedback item + disposition per itemId out of the
 * migrations that still carry payloads, merging over the existing ledger.
 * Migrations are ordered oldest → newest in plan.specMigrations, so a plain
 * forward pass leaves the latest occurrence in the ledger.
 */
export function rollFeedbackLedger(plan: Plan): Record<string, FeedbackLedgerEntry> {
  const ledger: Record<string, FeedbackLedgerEntry> = { ...(plan.feedbackLedger ?? {}) };

  for (const migration of plan.specMigrations) {
    for (const item of migration.requiredFeedbackItems ?? []) {
      ledger[item.itemId] = {
        itemId: item.itemId,
        migrationId: migration.id,
        appliedAt: migration.appliedAt,
        item,
        // Preserve a previously rolled-up disposition until this pass finds a
        // newer one below; a fresh tracked item does not erase disposition truth.
        disposition: ledger[item.itemId]?.disposition,
      };
    }
    for (const disposition of migration.feedbackDispositions ?? []) {
      const existing = ledger[disposition.itemId];
      if (existing) {
        ledger[disposition.itemId] = { ...existing, disposition };
      } else {
        // Disposition without a tracked item in any retained migration:
        // synthesize a minimal ledger row so the disposition survives.
        ledger[disposition.itemId] = {
          itemId: disposition.itemId,
          migrationId: migration.id,
          appliedAt: migration.appliedAt,
          item: {
            itemId: disposition.itemId,
            kind: 'feedback',
            changeType: 'unknown',
            summary: disposition.reason,
          },
          disposition,
        };
      }
    }
  }

  return ledger;
}

function migrationHasPayload(migration: SpecMigration): boolean {
  return (migration.requiredFeedbackItems?.length ?? 0) > 0
    || (migration.feedbackDispositions?.length ?? 0) > 0;
}

function judgmentNumber(judgment: Judgment): number {
  const match = judgment.id.match(/^judgment-(\d+)$/);
  return match ? parseInt(match[1], 10) : 0;
}

function taskIsFeedbackLinked(task: Task, ledger: Record<string, FeedbackLedgerEntry>): boolean {
  if ((task.feedbackItemRefs?.length ?? 0) > 0) return true;
  for (const entry of Object.values(ledger)) {
    const disposition = entry.disposition;
    if (!disposition) continue;
    if (disposition.taskIds?.includes(task.id)) return true;
    if (disposition.relatedCompletedTaskIds?.includes(task.id)) return true;
  }
  return false;
}

function stubDescription(description: string): string {
  if (description.length <= STUB_DESCRIPTION_MAX_CHARS) return description;
  return `${description.slice(0, STUB_DESCRIPTION_MAX_CHARS - 1)}…`;
}

/**
 * Compact the plan in place. Returns archive entries the caller must append
 * to the archive file BEFORE persisting the compacted plan.
 */
export function compactPlan(plan: Plan, config: PlanCompactionConfig): PlanCompactionResult {
  const noop: PlanCompactionResult = {
    changed: false,
    archiveEntries: [],
    stats: { migrationDetailsArchived: 0, judgmentsArchived: 0, taskDetailsArchived: 0 },
  };
  if (!config.enabled) return noop;
  if (JSON.stringify(plan).length < config.minPlanChars) return noop;

  // Retention floors: never retain less than the widest prompt projection
  // window (controller: 12 completed / 20 judgments / 8 migrations; planner:
  // 8 migrations / 12 judgments), so projections never render stripped rows.
  const migrationDetailRetention = Math.max(config.migrationDetailRetention, 8);
  const judgmentRetention = Math.max(config.judgmentRetention, 20);
  const completedTaskDetailRetention = Math.max(config.completedTaskDetailRetention, 12);

  const archivedAt = new Date().toISOString();
  const archiveEntries: PlanArchiveEntry[] = [];

  // 1. Ledger first: roll up the full retained history before stripping payloads.
  plan.feedbackLedger = rollFeedbackLedger(plan);

  // 2. Migration payloads beyond retention → archive, keep index row.
  // The latest migration of every distinct specFile always keeps its payload:
  // for multi-spec projects the current accepted-diff migration of a rarely
  // updated spec can be much older than the global retention window, and the
  // controller matrix builds directly from that payload.
  const latestPerSpecFile = new Map<string, string>();
  for (const migration of plan.specMigrations) {
    latestPerSpecFile.set(migration.specFile, migration.id);
  }
  const protectedMigrationIds = new Set(latestPerSpecFile.values());
  const detailBoundary = Math.max(0, plan.specMigrations.length - migrationDetailRetention);
  let migrationDetailsArchived = 0;
  for (const migration of plan.specMigrations.slice(0, detailBoundary)) {
    if (protectedMigrationIds.has(migration.id)) continue;
    if (!migrationHasPayload(migration)) continue;
    archiveEntries.push({
      schemaVersion: ARCHIVE_SCHEMA_VERSION,
      archivedAt,
      kind: 'migration_detail',
      payload: {
        migrationId: migration.id,
        specFile: migration.specFile,
        specHash: migration.specHash,
        appliedAt: migration.appliedAt,
        requiredFeedbackItems: migration.requiredFeedbackItems ?? [],
        feedbackDispositions: migration.feedbackDispositions ?? [],
      },
    });
    delete migration.requiredFeedbackItems;
    delete migration.feedbackDispositions;
    migration.archivedDetail = true;
    migrationDetailsArchived++;
  }

  // 3. Judgments beyond retention → archive + prune (decisions-log already
  // holds append-only history; the archive keeps plan.json self-sufficient).
  let judgmentsArchived = 0;
  let judgmentIdWatermark = plan.compaction?.judgmentIdWatermark ?? 0;
  if (plan.judgments.length > judgmentRetention) {
    const pruned = plan.judgments.slice(0, plan.judgments.length - judgmentRetention);
    for (const judgment of pruned) {
      archiveEntries.push({
        schemaVersion: ARCHIVE_SCHEMA_VERSION,
        archivedAt,
        kind: 'judgment',
        payload: judgment,
      });
      judgmentIdWatermark = Math.max(judgmentIdWatermark, judgmentNumber(judgment));
      judgmentsArchived++;
    }
    plan.judgments = plan.judgments.slice(-judgmentRetention);
  }

  // 4. Completed/skipped task detail beyond retention → archive, keep stub.
  // Feedback-linked tasks are never stubbed (see module doc).
  const ledger = plan.feedbackLedger;
  const closedTasks = plan.phases
    .flatMap(phase => phase.tasks)
    .filter(task => task.status === 'completed' || task.status === 'skipped');
  const detailRetained = new Set(
    closedTasks.slice(-completedTaskDetailRetention).map(task => task.id),
  );
  let taskDetailsArchived = 0;
  for (const task of closedTasks) {
    if (task.archivedDetail) continue;
    if (detailRetained.has(task.id)) continue;
    if (taskIsFeedbackLinked(task, ledger)) continue;
    archiveEntries.push({
      schemaVersion: ARCHIVE_SCHEMA_VERSION,
      archivedAt,
      kind: 'task_detail',
      payload: task,
    });
    task.description = stubDescription(task.description);
    task.acceptanceCriteria = [];
    delete task.lastError;
    delete task.verificationEvidence;
    task.archivedDetail = true;
    taskDetailsArchived++;
  }

  const changed = archiveEntries.length > 0;
  if (changed || !plan.compaction) {
    plan.compaction = {
      lastCompactedAt: archivedAt,
      archiveFile: PLAN_ARCHIVE_RELATIVE_PATH,
      archivedMigrationDetails: (plan.compaction?.archivedMigrationDetails ?? 0) + migrationDetailsArchived,
      archivedJudgments: (plan.compaction?.archivedJudgments ?? 0) + judgmentsArchived,
      archivedTaskDetails: (plan.compaction?.archivedTaskDetails ?? 0) + taskDetailsArchived,
      judgmentIdWatermark,
    };
  }

  return {
    changed,
    archiveEntries,
    stats: { migrationDetailsArchived, judgmentsArchived, taskDetailsArchived },
  };
}

/** Append archive entries as JSONL. Caller invokes this before saving the compacted plan. */
export async function appendPlanArchive(
  workDir: string,
  entries: PlanArchiveEntry[],
): Promise<void> {
  if (entries.length === 0) return;
  const archivePath = path.join(workDir, PLAN_ARCHIVE_RELATIVE_PATH);
  await fs.ensureDir(path.dirname(archivePath));
  const lines = entries.map(entry => `${JSON.stringify(entry)}\n`).join('');
  await fs.appendFile(archivePath, lines, 'utf-8');
}
