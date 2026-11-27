import fs from 'fs-extra';
import path from 'path';
import crypto from 'crypto';
import type {
  Plan,
  Phase,
  Task,
  Judgment,
  PlanChange,
  SpecMigration,
  FeedbackEvidence,
  FeedbackLedgerEntry,
} from '../config/types.js';
import { PlanSchema, SpecMigrationSchema } from '../config/types.js';
import {
  appendPlanArchive,
  compactPlan,
  type PlanCompactionConfig,
} from './plan-compaction.js';
import { mergeFeedbackEvidence } from '../feedback/evidence.js';
import { resolveSpecInputHash } from '../feedback/spec-input.js';
import { log } from '../utils/logger.js';

type RawPlanObject = Record<string, unknown>;

/**
 * RA-375: a plan change that violates an ownership/lifecycle boundary the LLM
 * does not control (touching executor-owned in_progress or terminal tasks,
 * enforcer/QA-managed tasks, or invalid status transitions). Such a change is
 * simply void — `applyChanges` drops it and keeps the rest of the packet,
 * instead of rejecting the whole packet and forcing a full regeneration.
 * Structural errors (missing refs, duplicate ids, broken dependency graph) are
 * thrown as plain Errors and still cause an atomic reject + retry.
 */
export class PlanBoundaryViolationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PlanBoundaryViolationError';
  }
}

export interface SpecMigrationRecordMetadata {
  summary?: string;
  specChangeSource?: SpecMigration['specChangeSource'];
  requiredFeedbackItems?: SpecMigration['requiredFeedbackItems'];
  feedbackDispositions?: SpecMigration['feedbackDispositions'];
}

export interface PlanStats {
  totalPhases: number;
  completedPhases: number;
  totalTasks: number;
  completedTasks: number;
  skippedTasks: number;
  failedTasks: number;
  pendingTasks: number;
  inProgressTasks: number;
  actionableTasks: number;
  totalJudgments: number;
  revisedJudgments: number;
}

export function formatPlanTaskBreakdown(stats: PlanStats): string {
  const openTasks = stats.pendingTasks + stats.inProgressTasks;
  const parts = [
    `${stats.completedTasks} completed`,
    ...(stats.skippedTasks > 0 ? [`${stats.skippedTasks} skipped`] : []),
    ...(stats.failedTasks > 0 ? [`${stats.failedTasks} failed`] : []),
    ...(openTasks > 0 ? [`${openTasks} open`] : []),
  ];
  return `${parts.join(', ')} / ${stats.totalTasks} total`;
}

export function formatActionableCompletion(stats: PlanStats): string {
  if (stats.actionableTasks === 0) return 'n/a (0 non-skipped tasks)';
  const percent = Math.round((stats.completedTasks / stats.actionableTasks) * 100);
  return `${percent}% (${stats.completedTasks}/${stats.actionableTasks} non-skipped tasks)`;
}

/**
 * PlanManager — CRUD for plan.json
 * 
 * Manages the living plan document: phases, tasks, judgments.
 * Used by Planner (create), Controller (mutate), and Executor (read).
 */
export class PlanManager {
  private plan: Plan | null = null;
  private planPath: string;

  /**
   * `compaction` is opt-in (RA-373): the loop executor passes ralphConfig
   * planCompaction; read-only and narrow-write consumers (visual evidence,
   * stage-lab dry runs) construct without it and never compact.
   */
  constructor(private workDir: string, private compaction?: PlanCompactionConfig) {
    this.planPath = path.join(workDir, '.ralph', 'plan.json');
  }

  // ── Core CRUD ─────────────────────────────────────────────────

  get hasPlan(): boolean {
    return this.plan !== null;
  }

  get currentPlan(): Plan {
    if (!this.plan) throw new Error('No plan loaded. Call load() or createPlan() first.');
    return this.plan;
  }

  async exists(): Promise<boolean> {
    return fs.pathExists(this.planPath);
  }

  async load(): Promise<Plan> {
    const raw = await fs.readJson(this.planPath);
    this.plan = this.normalizePlan(PlanSchema.parse(raw));
    return this.plan;
  }

  async save(): Promise<void> {
    if (!this.plan) throw new Error('No plan to save');
    if (this.compaction?.enabled) {
      const result = compactPlan(this.plan, this.compaction);
      if (result.changed) {
        // Archive first: a crash between append and plan write may duplicate
        // archive rows, but never loses plan truth.
        await appendPlanArchive(this.workDir, result.archiveEntries);
        log.info(
          `Plan compacted: archived ${result.stats.migrationDetailsArchived} migration payload(s), `
          + `${result.stats.judgmentsArchived} judgment(s), ${result.stats.taskDetailsArchived} task detail(s)`,
        );
      }
    }
    this.plan.updatedAt = new Date().toISOString();
    await fs.ensureDir(path.dirname(this.planPath));
    await fs.writeJson(this.planPath, this.plan, { spaces: 2 });
    log.info(`Plan saved → ${this.planPath}`);
  }

  /** RA-373: latest tracked accepted-feedback item + disposition for an itemId, if rolled up. */
  getFeedbackLedgerEntry(itemId: string): FeedbackLedgerEntry | undefined {
    return this.plan?.feedbackLedger?.[itemId];
  }

  /**
   * Create a fresh plan from Planner output
   */
  createPlan(specFile: string, phases: Phase[], judgments: Judgment[], projectGoal?: string): Plan {
    this.assertNoPlannerClaimedTasks(phases, 'createPlan');
    const now = new Date().toISOString();
    this.plan = {
      version: 1,
      specFile,
      projectGoal,
      createdAt: now,
      updatedAt: now,
      phases,
      judgments,
      specMigrations: [],
    };
    return this.plan;
  }

  /**
   * Compute SHA-256 hash of spec file for change detection
   */
  async computeSpecHash(specPath: string): Promise<string> {
    const content = await fs.readFile(specPath, 'utf-8');
    const contentHash = crypto.createHash('sha256').update(content).digest('hex');
    return resolveSpecInputHash(this.workDir, specPath, contentHash);
  }

  // ── Spec migrations ────────────────────────────────────────────

  getSpecMigrations(): SpecMigration[] {
    return this.plan?.specMigrations ?? [];
  }

  hasSpecMigration(specFile: string, specHash: string): boolean {
    return this.getSpecMigrations().some(m => m.specFile === specFile && m.specHash === specHash);
  }

  hasSpecFileMigration(specFile: string): boolean {
    return this.getSpecMigrations().some(m => m.specFile === specFile);
  }

  recordSpecMigration(
    specFile: string,
    specHash: string,
    summaryOrMetadata?: string | SpecMigrationRecordMetadata,
    metadata?: SpecMigrationRecordMetadata,
  ): SpecMigration {
    if (!this.plan) throw new Error('No plan loaded');

    const existing = this.plan.specMigrations.find(
      m => m.specFile === specFile && m.specHash === specHash,
    );
    if (existing) return existing;

    const recordMetadata = typeof summaryOrMetadata === 'string'
      ? { ...metadata, summary: summaryOrMetadata }
      : { ...summaryOrMetadata, ...metadata };

    const migration = SpecMigrationSchema.parse({
      id: this.nextSpecMigrationId(),
      specFile,
      specHash,
      appliedAt: new Date().toISOString(),
      requiredFeedbackItems: recordMetadata.requiredFeedbackItems ?? [],
      feedbackDispositions: (recordMetadata.feedbackDispositions ?? []).map((disposition) => ({
        taskIds: [],
        relatedCompletedTaskIds: [],
        evidence: [],
        judgmentIds: [],
        ...disposition,
      })),
      ...(recordMetadata.summary ? { summary: recordMetadata.summary } : {}),
      ...(recordMetadata.specChangeSource ? { specChangeSource: recordMetadata.specChangeSource } : {}),
    });
    this.plan.specMigrations.push(migration);
    log.info(`Plan: recorded spec migration ${migration.id} (${specFile})`);
    return migration;
  }

  // ── Task accessors ────────────────────────────────────────────

  /**
   * Get all tasks across all phases, flattened in order
   */
  getAllTasks(): Task[] {
    if (!this.plan) return [];
    return this.plan.phases
      .sort((a, b) => a.order - b.order)
      .flatMap(p => p.tasks);
  }

  /**
   * Get the next runnable task.
   * Selection rules:
   * 1) Collect all in_progress and runnable pending tasks across all phases.
   * 2) Sort by: priority → phase order → task order.
   * 3) Final tiebreaker: prefer in_progress (resume) over pending (start new).
   *
   * Lower numeric priority means higher urgency (priority 1 runs before 5).
   * Missing priority falls back to medium urgency.
   */
  getNextTask(): Task | null {
    if (!this.plan) return null;

    const orderedPhases = [...this.plan.phases].sort((a, b) => a.order - b.order);

    const inProgressCandidates: Array<{ task: Task; phaseOrder: number; taskOrder: number }> = [];
    const pendingCandidates: Array<{ task: Task; phaseOrder: number; taskOrder: number }> = [];

    for (const phase of orderedPhases) {
      if (phase.status === 'completed') continue;

      for (let idx = 0; idx < phase.tasks.length; idx++) {
        const task = phase.tasks[idx];

        if (task.status === 'in_progress') {
          inProgressCandidates.push({ task, phaseOrder: phase.order, taskOrder: idx });
          continue;
        }

        if (task.status !== 'pending') continue;

        const depsOk = task.dependencies.every(depId => {
          const depTask = this.findTask(depId);
          return depTask && (depTask.status === 'completed' || depTask.status === 'skipped');
        });

        if (depsOk) {
          pendingCandidates.push({ task, phaseOrder: phase.order, taskOrder: idx });
        }
      }
    }

    if (inProgressCandidates.length > 1) {
      const taskIds = inProgressCandidates.map(c => c.task.id).join(', ');
      throw new Error(`Plan invariant violation: multiple in_progress tasks in a sequential loop (${taskIds})`);
    }

    if (inProgressCandidates.length === 1) {
      return inProgressCandidates[0].task;
    }

    // Merge both pools and pick the best candidate.
    // Pending work is priority-ordered only when no active WIP lease exists.
    const allCandidates = [
      ...pendingCandidates.map(c => ({ ...c, isInProgress: false })),
    ];

    if (allCandidates.length > 0) {
      const winner = allCandidates.sort((a, b) => {
        const cmp = this.compareTaskScheduling(
          a.task, a.phaseOrder, a.taskOrder,
          b.task, b.phaseOrder, b.taskOrder,
        );
        if (cmp !== 0) return cmp;
        return 0;
      })[0];
      return winner.task;
    }

    return null;
  }

  reconcileTaskStateForSelection(maxRetries = 5): boolean {
    if (!this.plan) return false;

    let changed = false;
    const orderedPhases = [...this.plan.phases].sort((a, b) => a.order - b.order);

    for (const phase of orderedPhases) {
      // Self-heal phase status: if tasks were added later (e.g. by controller/enforcer),
      // a phase may still be marked completed even though new tasks are pending.
      if (phase.status === 'completed' && !this.isPhaseDone(phase)) {
        phase.status = phase.tasks.some(t => t.status === 'in_progress') ? 'in_progress' : 'pending';
        changed = true;
        log.warn(`Plan: phase ${phase.id} was marked completed but has unfinished tasks — reopening`);
      }

      // Auto-heal failed tasks: reset to pending if retries remain,
      // or skip them so they don't block the phase.
      for (const task of phase.tasks) {
        if (task.status === 'failed') {
          if (task.attempts < maxRetries) {
            log.info(`Plan: resetting failed task ${task.id} to pending (attempt ${task.attempts}/${maxRetries})`);
            task.status = 'pending';
            changed = true;
          } else {
            log.warn(`Plan: task ${task.id} exhausted retries (${task.attempts}/${maxRetries}) — marking skipped`);
            task.status = 'skipped';
            changed = true;
          }
        }
      }

      // Keep phase status in sync with current task states.
      if (this.isPhaseDone(phase) && phase.status !== 'completed') {
        phase.status = 'completed';
        changed = true;
      }
    }

    return changed;
  }

  /**
   * Find the next planLater phase that is ready for expansion.
   * A phase is ready when all earlier non-deferred phases are completed.
   * Empty planLater phases are unfinished work even if an older plan
   * accidentally marked them completed.
   */
  getNextPlanLaterPhase(): Phase | null {
    if (!this.plan) return null;
    const orderedPhases = [...this.plan.phases].sort((a, b) => a.order - b.order);

    for (const phase of orderedPhases) {
      if (phase.planLater && phase.tasks.length === 0) return phase;
      if (phase.status === 'completed') continue;
      // Otherwise there's real work to do before any planLater phase.
      return null;
    }
    return null;
  }

  /**
   * Expand a planLater phase: replace it with concrete tasks.
   * Called by the executor after the planner generates tasks for the phase.
   */
  expandPlanLaterPhase(phaseId: string, tasks: Task[]): void {
    if (!this.plan) throw new Error('No plan loaded');
    const phase = this.plan.phases.find(p => p.id === phaseId);
    if (!phase) throw new Error(`Phase ${phaseId} not found`);
    if (!phase.planLater) throw new Error(`Phase ${phaseId} is not a planLater phase`);
    this.assertNoPlannerClaimedTasks([{ ...phase, tasks }], 'expandPlanLaterPhase');

    phase.tasks = tasks;
    phase.planLater = false;
    phase.status = 'pending';
    log.info(`Plan: expanded planLater phase ${phaseId} with ${tasks.length} tasks`);
  }

  /**
   * Find a task by id across all phases
   */
  findTask(taskId: string): Task | null {
    if (!this.plan) return null;
    for (const phase of this.plan.phases) {
      const task = phase.tasks.find(t => t.id === taskId);
      if (task) return task;
    }
    return null;
  }

  /**
   * Find the phase a task belongs to
   */
  findTaskPhase(taskId: string): Phase | null {
    if (!this.plan) return null;
    for (const phase of this.plan.phases) {
      if (phase.tasks.some(t => t.id === taskId)) return phase;
    }
    return null;
  }

  /**
   * Get current active phase (first non-completed phase)
   */
  getCurrentPhase(): Phase | null {
    if (!this.plan) return null;
    return this.plan.phases
      .sort((a, b) => a.order - b.order)
      .find(p => p.status !== 'completed') || null;
  }

  /**
   * Check if a phase just completed (all tasks done)
   */
  isPhaseComplete(phaseId: string): boolean {
    const phase = this.plan?.phases.find(p => p.id === phaseId);
    if (!phase) return false;
    return this.isPhaseDone(phase);
  }

  /**
   * Mark a phase as complete
   */
  markPhaseComplete(phaseId: string): void {
    const phase = this.plan?.phases.find(p => p.id === phaseId);
    if (phase) phase.status = 'completed';
  }

  /**
   * Update phase status to in_progress
   */
  markPhaseInProgress(phaseId: string): void {
    const phase = this.plan?.phases.find(p => p.id === phaseId);
    if (phase && phase.status === 'pending') phase.status = 'in_progress';
  }

  // ── Plan mutation (used by Controller) ────────────────────────

  /**
   * Apply a set of plan changes from Controller
   */
  applyChanges(changes: PlanChange[]): { applied: number; errors: string[]; dropped: string[] } {
    if (!this.plan) throw new Error('No plan loaded');

    // A controller/planner report is one mutation packet. Boundary-violating
    // changes (touching executor-owned/enforcer/QA tasks) are dropped so one
    // void change does not force a full plan regeneration; structural errors
    // (missing refs, duplicates, broken dependency graph) still reject the
    // whole packet atomically so the durable plan is never left half-updated.
    const originalPlan = this.plan;
    this.plan = this.normalizePlan(PlanSchema.parse(structuredClone(originalPlan)));
    const result = this.applyChangesInPlace(changes);
    if (result.errors.length > 0) {
      this.plan = originalPlan;
      return { applied: 0, errors: result.errors, dropped: [] };
    }

    try {
      this.assertDependencyGraph();
      return { applied: result.applied, errors: [], dropped: result.dropped };
    } catch (error) {
      this.plan = originalPlan;
      return {
        applied: 0,
        errors: [error instanceof Error ? error.message : String(error)],
        dropped: [],
      };
    }
  }

  private applyChangesInPlace(changes: PlanChange[]): { applied: number; errors: string[]; dropped: string[] } {
    let applied = 0;
    const errors: string[] = [];
    const dropped: string[] = [];

    for (const change of changes) {
      try {
        // Enforcer/QA-managed tasks are owned by those subsystems, not the LLM
        // controller. A removal attempt is a boundary violation → drop it.
        if (change.action === 'removeTask' && change.taskId.startsWith('e2e-')) {
          throw new PlanBoundaryViolationError(`removeTask: cannot remove enforcer-managed task ${change.taskId}`);
        }
        if (change.action === 'removeTask' && change.taskId.startsWith('qa-')) {
          throw new PlanBoundaryViolationError(`removeTask: cannot remove QA planner-managed task ${change.taskId}`);
        }

        switch (change.action) {
          case 'addTask':
            this.addTask(change.phaseId, change.task);
            break;
          case 'removeTask':
            this.removeTask(change.taskId);
            break;
          case 'updateTask':
            this.updateTask(change.taskId, change.changes);
            break;
          case 'addPhase':
            this.addPhase(change.phase);
            break;
          case 'reorderTasks':
            this.reorderTasks(change.phaseId, change.taskIds);
            break;
        }
        applied++;
      } catch (err: any) {
        const message = `${change.action}: ${err.message}`;
        if (err instanceof PlanBoundaryViolationError) {
          dropped.push(message);
          log.warn(`Plan: dropped boundary-violating change — ${message}`);
        } else {
          errors.push(message);
        }
      }
    }

    return { applied, errors, dropped };
  }

  private assertDependencyGraph(): void {
    if (!this.plan) throw new Error('No plan loaded');

    const tasks = new Map<string, Task>();
    for (const phase of this.plan.phases) {
      for (const task of phase.tasks) {
        tasks.set(task.id, task);
      }
    }

    for (const task of tasks.values()) {
      for (const dependencyId of task.dependencies) {
        if (!tasks.has(dependencyId)) {
          throw new Error(`Plan dependency error: ${task.id} depends on missing task ${dependencyId}`);
        }
      }
    }

    const visiting = new Set<string>();
    const visited = new Set<string>();
    const visit = (taskId: string): void => {
      if (visited.has(taskId)) return;
      if (visiting.has(taskId)) {
        throw new Error(`Plan dependency error: cycle includes ${taskId}`);
      }

      visiting.add(taskId);
      const task = tasks.get(taskId);
      for (const dependencyId of task?.dependencies ?? []) visit(dependencyId);
      visiting.delete(taskId);
      visited.add(taskId);
    };

    for (const taskId of tasks.keys()) visit(taskId);
  }

  addTask(phaseId: string, task: Task): void {
    if (!this.plan) throw new Error('No plan loaded');
    if (task.status === 'in_progress') {
      throw new PlanBoundaryViolationError(`addTask: ${task.id} cannot start as in_progress; only the executor may claim active work`);
    }
    const phase = this.plan.phases.find(p => p.id === phaseId);
    if (!phase) throw new Error(`Phase ${phaseId} not found`);
    
    // Check for duplicate id
    if (this.findTask(task.id)) {
      throw new Error(`Task ${task.id} already exists`);
    }

    phase.tasks.push(task);

    if (phase.planLater) {
      phase.planLater = false;
      log.info(`Plan: phase ${phaseId} is no longer planLater after adding task ${task.id}`);
    }

    // Reopen phase if a non-terminal task was added to a completed phase.
    if (phase.status === 'completed' && !this.isTaskDone(task)) {
      phase.status = 'in_progress';
      log.info(`Plan: reopened phase ${phaseId} after adding task ${task.id}`);
    }

    log.info(`Plan: added task ${task.id} to ${phaseId}`);
  }

  removeTask(taskId: string): void {
    if (!this.plan) throw new Error('No plan loaded');
    for (const phase of this.plan.phases) {
      const idx = phase.tasks.findIndex(t => t.id === taskId);
      if (idx !== -1) {
        const task = phase.tasks[idx];
        if (task.status === 'in_progress') {
          throw new PlanBoundaryViolationError(`removeTask: cannot remove active in_progress task ${taskId}; executor must reconcile the WIP`);
        }
        if (task.status === 'completed' || task.status === 'skipped') {
          throw new PlanBoundaryViolationError(`removeTask: cannot remove terminal task ${taskId}; add follow-up work instead`);
        }
        phase.tasks.splice(idx, 1);
        log.info(`Plan: removed task ${taskId} from ${phase.id}`);
        return;
      }
    }
    throw new Error(`Task ${taskId} not found`);
  }

  updateTask(taskId: string, changes: Partial<Pick<Task, 'displayTitle' | 'description' | 'acceptanceCriteria' | 'priority' | 'dependencies' | 'requiredRolePasses' | 'visualEvidenceRequired' | 'status'>>): void {
    const task = this.findTask(taskId);
    if (!task) throw new Error(`Task ${taskId} not found`);
    if (changes.status && changes.status !== 'pending') {
      throw new PlanBoundaryViolationError(`updateTask: cannot set ${taskId} to ${changes.status}; executor owns task lifecycle status`);
    }
    if (task.status === 'in_progress') {
      throw new PlanBoundaryViolationError(`updateTask: cannot mutate active in_progress task ${taskId}; executor must reconcile the WIP`);
    }
    if (task.status === 'completed' || task.status === 'skipped') {
      throw new PlanBoundaryViolationError(`updateTask: cannot mutate terminal task ${taskId}; add follow-up work instead`);
    }
    Object.assign(task, changes);
    log.info(`Plan: updated task ${taskId}`);
  }

  recordTaskVerificationEvidence(taskId: string, evidence: FeedbackEvidence[]): number {
    const task = this.findTask(taskId);
    if (!task) throw new Error(`Task ${taskId} not found`);
    const previousCount = task.verificationEvidence?.length ?? 0;
    task.verificationEvidence = mergeFeedbackEvidence(task.verificationEvidence ?? [], evidence);
    const added = task.verificationEvidence.length - previousCount;
    if (added > 0) log.info(`Plan: recorded ${added} verification evidence row(s) for ${taskId}`);
    return added;
  }

  async recordTaskVerificationEvidenceAndSave(taskId: string, evidence: FeedbackEvidence[]): Promise<number> {
    const rawPlan = await this.readRawPlanForNarrowEvidenceWrite();
    const parsedPlan = this.normalizePlan(PlanSchema.parse(rawPlan));
    const parsedTaskMatches = parsedPlan.phases
      .flatMap(phase => phase.tasks)
      .filter(task => task.id === taskId);
    if (parsedTaskMatches.length !== 1) {
      throw new Error(`Plan narrow evidence write requires exactly one parsed task ${taskId}; found ${parsedTaskMatches.length}`);
    }

    const rawTask = this.findRawTaskForNarrowEvidenceWrite(rawPlan, taskId);
    const existingRawEvidence = rawTask.verificationEvidence;
    if (existingRawEvidence !== undefined && !Array.isArray(existingRawEvidence)) {
      throw new Error(`Plan narrow evidence write found non-array verificationEvidence on ${taskId}`);
    }

    const previousEvidence = (existingRawEvidence ?? []) as FeedbackEvidence[];
    const mergedEvidence = mergeFeedbackEvidence(previousEvidence, evidence);
    const added = mergedEvidence.length - previousEvidence.length;
    if (added === 0) {
      this.plan = parsedPlan;
      return 0;
    }

    rawTask.verificationEvidence = mergedEvidence;
    rawPlan.updatedAt = new Date().toISOString();
    this.plan = this.normalizePlan(PlanSchema.parse(rawPlan));

    await fs.ensureDir(path.dirname(this.planPath));
    await fs.writeJson(this.planPath, rawPlan, { spaces: 2 });
    log.info(`Plan: recorded ${added} verification evidence row(s) for ${taskId}`);
    log.info(`Plan saved → ${this.planPath}`);
    return added;
  }

  addPhase(phase: Phase): void {
    if (!this.plan) throw new Error('No plan loaded');
    if (this.plan.phases.find(p => p.id === phase.id)) {
      throw new Error(`Phase ${phase.id} already exists`);
    }
    this.assertNoPlannerClaimedTasks([phase], 'addPhase');
    this.plan.phases.push(phase);
    this.plan.phases.sort((a, b) => a.order - b.order);
    log.info(`Plan: added phase ${phase.id} (order: ${phase.order})`);
  }

  private assertNoPlannerClaimedTasks(phases: Phase[], owner: string): void {
    const activeTask = phases.flatMap(phase => phase.tasks).find(task => task.status === 'in_progress');
    if (activeTask) {
      throw new PlanBoundaryViolationError(`${owner}: ${activeTask.id} cannot start as in_progress; only the executor may claim active work`);
    }
  }

  reorderTasks(phaseId: string, taskIds: string[]): void {
    if (!this.plan) throw new Error('No plan loaded');
    const phase = this.plan.phases.find(p => p.id === phaseId);
    if (!phase) throw new Error(`Phase ${phaseId} not found`);

    const taskMap = new Map(phase.tasks.map(t => [t.id, t]));
    const reordered: Task[] = [];

    for (const id of taskIds) {
      const task = taskMap.get(id);
      if (!task) throw new Error(`Task ${id} not found in phase ${phaseId}`);
      reordered.push(task);
      taskMap.delete(id);
    }

    // Append any tasks not in the reorder list
    for (const task of taskMap.values()) {
      reordered.push(task);
    }

    phase.tasks = reordered;
    log.info(`Plan: reordered tasks in ${phaseId}`);
  }

  // ── Judgments ─────────────────────────────────────────────────

  addJudgment(judgment: Judgment): void {
    if (!this.plan) throw new Error('No plan loaded');
    this.plan.judgments.push(judgment);
    log.info(`Plan: added judgment ${judgment.id} — ${judgment.ambiguity.slice(0, 60)}`);
  }

  reviseJudgment(judgmentId: string, newChoice: number, reasoning: string): void {
    if (!this.plan) throw new Error('No plan loaded');
    const j = this.plan.judgments.find(j => j.id === judgmentId);
    if (!j) throw new Error(`Judgment ${judgmentId} not found`);
    j.previousChoice = j.chosen;
    j.chosen = newChoice;
    j.reasoning = reasoning;
    j.revisedBy = 'controller';
    log.info(`Plan: revised judgment ${judgmentId} → option ${newChoice}`);
  }

  getJudgments(): Judgment[] {
    return this.plan?.judgments ?? [];
  }

  /**
   * Returns true if at least one task is still not in a terminal state.
   * Used by executor to distinguish "all done" vs "blocked".
   */
  hasUnfinishedTasks(): boolean {
    if (!this.plan) return false;
    return this.plan.phases.some(phase => {
      if (phase.planLater && phase.tasks.length === 0) return true;
      return phase.tasks.some(task => !this.isTaskDone(task));
    });
  }

  // ── Stats ─────────────────────────────────────────────────────

  getStats(): PlanStats {
    if (!this.plan) {
      return {
        totalPhases: 0,
        completedPhases: 0,
        totalTasks: 0,
        completedTasks: 0,
        skippedTasks: 0,
        failedTasks: 0,
        pendingTasks: 0,
        inProgressTasks: 0,
        actionableTasks: 0,
        totalJudgments: 0,
        revisedJudgments: 0,
      };
    }

    const phases = this.plan.phases;
    const tasks = this.getAllTasks();
    const skippedTasks = tasks.filter(t => t.status === 'skipped').length;

    return {
      totalPhases: phases.length,
      completedPhases: phases.filter(p => p.status === 'completed').length,
      totalTasks: tasks.length,
      completedTasks: tasks.filter(t => t.status === 'completed').length,
      skippedTasks,
      failedTasks: tasks.filter(t => t.status === 'failed').length,
      pendingTasks: tasks.filter(t => t.status === 'pending').length,
      inProgressTasks: tasks.filter(t => t.status === 'in_progress').length,
      actionableTasks: tasks.length - skippedTasks,
      totalJudgments: this.plan.judgments.length,
      revisedJudgments: this.plan.judgments.filter(j => j.revisedBy).length,
    };
  }

  /**
   * Generate a concise text summary of plan status (for logging / context)
   */
  /**
   * Build a plan overview showing phases and tasks with the current task highlighted.
   * This gives the agent visibility into what's planned without needing the full spec.
   */
  generateSummary(): string {
    const stats = this.getStats();
    return `Progress: ${formatPlanTaskBreakdown(stats)}, actionable completion ${formatActionableCompletion(stats)}, ${stats.completedPhases}/${stats.totalPhases} phases done. Full plan: \`.ralph/plan.json\``;
  }

  /**
   * Get the LLM-generated project goal summary (stored in plan.json at creation time).
   */
  getProjectGoal(): string | undefined {
    return this.plan?.projectGoal;
  }

  private isTaskDone(task: Task): boolean {
    return task.status === 'completed' || task.status === 'skipped';
  }

  private isPhaseDone(phase: Phase): boolean {
    if (phase.planLater && phase.tasks.length === 0) return false;
    if (phase.tasks.length === 0) return false;
    return phase.tasks.every(task => this.isTaskDone(task));
  }

  private normalizePriority(task: Task): number {
    if (typeof task.priority === 'number' && Number.isFinite(task.priority)) {
      return task.priority;
    }
    return 5;
  }

  private compareTaskScheduling(
    a: Task,
    aPhaseOrder: number,
    aTaskOrder: number,
    b: Task,
    bPhaseOrder: number,
    bTaskOrder: number,
  ): number {
    const byPriority = this.normalizePriority(a) - this.normalizePriority(b);
    if (byPriority !== 0) return byPriority;
    if (aPhaseOrder !== bPhaseOrder) return aPhaseOrder - bPhaseOrder;
    return aTaskOrder - bTaskOrder;
  }

  private nextSpecMigrationId(): string {
    if (!this.plan) return 'spec-001';
    let max = 0;
    for (const m of this.plan.specMigrations) {
      const mm = m.id.match(/^spec-(\d+)$/);
      if (mm) max = Math.max(max, parseInt(mm[1], 10));
    }
    return `spec-${String(max + 1).padStart(3, '0')}`;
  }

  private normalizePlan(plan: Plan): Plan {
    for (const phase of plan.phases) {
      for (const task of phase.tasks) {
        task.feedbackItemRefs ??= [];
        task.verificationEvidence ??= [];
      }
    }
    for (const migration of plan.specMigrations) {
      migration.requiredFeedbackItems ??= [];
      migration.feedbackDispositions = (migration.feedbackDispositions ?? []).map((disposition) => ({
        taskIds: [],
        relatedCompletedTaskIds: [],
        evidence: [],
        judgmentIds: [],
        ...disposition,
      }));
    }
    return plan;
  }

  private async readRawPlanForNarrowEvidenceWrite(): Promise<RawPlanObject> {
    const raw = await fs.readJson(this.planPath);
    if (!this.isRawObject(raw)) {
      throw new Error('Plan narrow evidence write requires a JSON object plan root');
    }
    return raw;
  }

  private findRawTaskForNarrowEvidenceWrite(rawPlan: RawPlanObject, taskId: string): RawPlanObject {
    const phases = rawPlan.phases;
    if (!Array.isArray(phases)) {
      throw new Error('Plan narrow evidence write requires raw phases array');
    }

    const matches: RawPlanObject[] = [];
    for (const phase of phases) {
      if (!this.isRawObject(phase)) {
        throw new Error('Plan narrow evidence write found non-object phase');
      }
      const tasks = phase.tasks;
      if (!Array.isArray(tasks)) {
        throw new Error('Plan narrow evidence write found phase without raw tasks array');
      }
      for (const task of tasks) {
        if (!this.isRawObject(task)) {
          throw new Error('Plan narrow evidence write found non-object task');
        }
        if (task.id === taskId) matches.push(task);
      }
    }

    if (matches.length !== 1) {
      throw new Error(`Plan narrow evidence write requires exactly one raw task ${taskId}; found ${matches.length}`);
    }
    return matches[0];
  }

  private isRawObject(value: unknown): value is RawPlanObject {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }
}
