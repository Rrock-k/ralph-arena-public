import fs from 'fs-extra';
import path from 'path';
import { LoopState, type Progress, type Feature, type PublicAssumptionCandidate, type FeedbackEvidence } from '../config/types.js';
import { getTaskDisplayTitle } from '../utils/task-display.js';

const ARENA_PROGRESS_FILE = 'progress.json';
const PROGRESS_FILE = 'ralph-progress.json';
const LEGACY_FEATURES_FILE = 'ralph-features.json';

type ArenaProgressState = 'planning' | 'coding' | 'testing' | 'deploying' | 'idle' | 'completed' | 'paused_budget' | 'paused_rate_limit' | 'paused_infra' | 'paused_manual' | 'error';
type ArenaProgressWorkStage = 'planner' | 'controller';

interface ArenaProgressStep {
  id: string;
  label: string;
  description?: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'skipped';
  feedbackItemRefs?: Array<{
    itemId?: string;
    diffItemId?: string;
    targetType?: string;
    targetId?: string;
  }>;
  proofExpectations?: ArenaProgressStepProofExpectation[];
  visualEvidence?: ArenaProgressStepVisualEvidence[];
}

type ArenaProgressProofStatus = 'missing' | 'partial' | 'satisfied';
type ArenaProgressMissingProofEvidence = 'before_screenshot' | 'after_screenshot';

interface ArenaProgressStepProofExpectation {
  kind: 'before_after_screenshot';
  reason: 'ordinary_web_ui_ux_task' | 'ordinary_web_accepted_frontend_work_task';
  source:
    | 'projectConfig.techStack.web+task.requiredRolePasses.ux'
    | 'projectConfig.techStack.web+task.feedbackItemRefs.workSurface.frontend';
  status: ArenaProgressProofStatus;
  missingEvidence?: ArenaProgressMissingProofEvidence[];
  evidence?: ArenaProgressStepProofEvidence[];
}

interface ArenaProgressStepProofEvidence {
  kind: FeedbackEvidence['kind'];
  role: 'before' | 'after' | 'before_after' | 'after_only';
  ref: string;
  result?: 'pass' | 'fail' | 'inconclusive';
  observedAt?: string;
  summary?: string;
  artifactPath?: string;
  target?: NonNullable<FeedbackEvidence['target']>;
}

type ArenaVisualEvidenceSourceKind = 'visual_workbench' | 'visual_scenario';

interface ArenaProgressStepVisualEvidenceAssessment {
  ref: string;
  result: 'pass' | 'fail' | 'inconclusive';
  observedAt?: string;
  summary: string;
  recordedBy?: FeedbackEvidence['recordedBy'];
}

interface ArenaProgressStepVisualEvidence {
  sourceEvidenceRef: string;
  sourceKind: ArenaVisualEvidenceSourceKind;
  result?: 'pass' | 'fail' | 'inconclusive';
  observedAt?: string;
  summary: string;
  feedbackItemIds: string[];
  diffItemIds: string[];
  artifactSha256?: string;
  target: NonNullable<FeedbackEvidence['target']>;
  assessments?: ArenaProgressStepVisualEvidenceAssessment[];
}

interface ArenaProgressSnapshot {
  state: ArenaProgressState;
  workStage?: ArenaProgressWorkStage;
  message?: string;
  iteration?: number;
  steps?: ArenaProgressStep[];
  assumptionReviews?: PublicAssumptionCandidate[];
}

export class ProgressTracker {
  private arenaProgressPath: string;
  private progressPath: string;
  private legacyFeaturesPath: string;
  private progress: Progress;
  private features: Feature[];
  private currentTaskId: string | undefined;
  private assumptionReviews: PublicAssumptionCandidate[] = [];
  private arenaStateOverride: ArenaProgressState | null = null;
  private arenaMessageOverride: string | null = null;
  private pendingFlush: Promise<void> = Promise.resolve();
  
  constructor(private workDir: string, projectName: string) {
    this.arenaProgressPath = path.join(workDir, '.arena', ARENA_PROGRESS_FILE);
    this.progressPath = path.join(workDir, '.ralph', PROGRESS_FILE);
    this.legacyFeaturesPath = path.join(workDir, '.ralph', LEGACY_FEATURES_FILE);
    
    this.progress = {
      projectName,
      startedAt: new Date().toISOString(),
      lastUpdated: new Date().toISOString(),
      totalIterations: 0,
      currentState: 'initializing',
      metrics: {
        testsPassing: 0,
        testsTotal: 0,
      },
    };
    
    this.features = [];
  }
  
  /**
   * Load existing progress or create new
   */
  async load(): Promise<void> {
    await fs.ensureDir(path.dirname(this.progressPath));
    
    if (await fs.pathExists(this.progressPath)) {
      this.progress = this.sanitizeProgress(await fs.readJson(this.progressPath));
    }
  }
  
  /**
   * Save current progress
   */
  async save(): Promise<void> {
    await this.flushNow();
  }

  async flushNow(): Promise<void> {
    this.pendingFlush = this.pendingFlush.then(() => this.commitFlush());
    await this.pendingFlush;
  }

  private async commitFlush(): Promise<void> {
    this.progress.lastUpdated = new Date().toISOString();
    await fs.ensureDir(path.dirname(this.arenaProgressPath));
    await fs.ensureDir(path.dirname(this.progressPath));
    await fs.writeJson(this.arenaProgressPath, this.buildArenaProgressSnapshot(), { spaces: 2 });
    await fs.writeJson(this.progressPath, this.progress, { spaces: 2 });
    await fs.remove(this.legacyFeaturesPath);
  }
  
  /**
   * Increment iteration counter
   */
  incrementIteration(): number {
    this.progress.totalIterations++;
    return this.progress.totalIterations;
  }

  /**
   * Ensure iteration counter never goes backwards when resuming from artifacts.
   * Returns true if the value was updated.
   */
  ensureTotalIterationsAtLeast(minIterations: number): boolean {
    if (!Number.isFinite(minIterations)) return false;
    const normalized = Math.max(0, Math.floor(minIterations));
    if (normalized <= this.progress.totalIterations) return false;
    this.progress.totalIterations = normalized;
    return true;
  }
  
  /**
   * Update state
   */
  setState(state: LoopState): void {
    this.progress.currentState = state;
    this.scheduleFlush();
  }
  
  /**
   * Set current task
   */
  setCurrentTask(taskId: string | undefined): void {
    this.currentTaskId = taskId;
    this.scheduleFlush();
  }
  
  /**
   * Update metrics
   */
  updateMetrics(metrics: Partial<Progress['metrics']>): void {
    this.progress.metrics = { ...this.progress.metrics, ...metrics };
    this.scheduleFlush();
  }
  
  /**
   * Add feature
   */
  addFeature(feature: Feature): void {
    this.features.push(feature);
    this.scheduleFlush();
  }
  
  /**
   * Update feature status
   */
  updateFeature(featureId: string, updates: Partial<Feature>): void {
    const feature = this.features.find(f => f.id === featureId);
    if (feature) {
      Object.assign(feature, updates);
      this.scheduleFlush();
    }
  }

  syncFeatures(nextFeatures: Feature[]): void {
    const existingById = new Map(this.features.map((feature) => [feature.id, feature]));
    this.features = nextFeatures.map((feature) => ({
      ...existingById.get(feature.id),
      ...feature,
    }));
    if (this.currentTaskId && !this.features.some((feature) => feature.id === this.currentTaskId)) {
      this.currentTaskId = undefined;
    }
    this.scheduleFlush();
  }

  addAssumptionReviews(reviews: PublicAssumptionCandidate[]): void {
    const byId = new Map(this.assumptionReviews.map((review) => [review.id, review]));

    for (const review of reviews) {
      const normalized = this.normalizeAssumptionReview(review);
      if (!normalized) continue;
      byId.set(normalized.id, normalized);
    }

    this.assumptionReviews = Array.from(byId.values());
    this.scheduleFlush();
  }
  
  /**
   * Mark feature as completed
   */
  completeFeature(featureId: string, commitHash: string): void {
    this.updateFeature(featureId, {
      status: 'completed',
      completedAt: new Date().toISOString(),
      commitHash,
    });
  }
  
  /**
   * Get next pending feature
   */
  getNextFeature(): Feature | undefined {
    return this.features.find(f => f.status === 'pending');
  }
  
  /**
   * Get current progress
   */
  getProgress(): Progress {
    return this.progress;
  }
  
  /**
   * Get all features
   */
  getFeatures(): Feature[] {
    return this.features;
  }

  setArenaPause(state: ArenaProgressState | null, message?: string): void {
    this.arenaStateOverride = state;
    this.arenaMessageOverride = state ? (message ?? null) : null;
    this.scheduleFlush();
  }
  
  /**
   * Get completion percentage
   */
  getCompletionPercentage(): number {
    const actionableFeatures = this.features.filter(f => f.status !== 'skipped');
    if (actionableFeatures.length === 0) return 0;
    const completed = this.features.filter(f => f.status === 'completed').length;
    return Math.round((completed / actionableFeatures.length) * 100);
  }
  
  /**
   * Generate progress summary for agent context
   */
  generateSummary(): string {
    const completed = this.features.filter(f => f.status === 'completed');
    const inProgress = this.features.filter(f => f.status === 'in_progress');
    const pending = this.features.filter(f => f.status === 'pending');
    const failed = this.features.filter(f => f.status === 'failed');
    const skipped = this.features.filter(f => f.status === 'skipped');
    const actionableTotal = this.features.length - skipped.length;

    const currentOrNext = inProgress[0] ?? pending[0] ?? null;
    const recentCompleted = completed.slice(-3);

    return `# Ralph Loop Progress Summary

## Overview
- **Project:** ${this.progress.projectName}
- **Last Updated:** ${this.progress.lastUpdated}
- **Total Iterations:** ${this.progress.totalIterations}
- **Current State:** ${this.progress.currentState}

## Feature Progress
- **Completed:** ${completed.length}/${actionableTotal} actionable (${this.getCompletionPercentage()}%)
- **Skipped:** ${skipped.length}
- **Failed:** ${failed.length}
- **In Progress:** ${inProgress.length}
- **Pending:** ${pending.length}

## Recently Completed
${recentCompleted.map(f => `- [${f.id}] ${compactProgressText(f.description)}`).join('\n') || 'None yet'}

## Current/Next Task
${currentOrNext
  ? `- [${currentOrNext.status === 'in_progress' ? 'IN PROGRESS' : 'NEXT'}] ${compactProgressText(currentOrNext.description)}`
  : 'All features completed!'}
`;
  }
  
  private buildArenaProgressSnapshot(): ArenaProgressSnapshot {
    const steps = this.features.map(feature => {
      const refs = this.safeFeedbackItemRefs(feature.feedbackItemRefs);
      const proofExpectations = this.safeProofExpectations(feature);
      const visualEvidence = this.safeVisualEvidence(feature);
      const label = this.publicFeatureText(this.featureDisplayTitle(feature), feature.feedbackItemRefs, 400) ?? feature.id;
      const description = this.publicFeatureText(feature.description, feature.feedbackItemRefs, 4000);
      return {
        id: feature.id,
        label,
        ...(description && description !== label ? { description } : {}),
        status: this.mapFeatureStatus(feature.status),
        ...(refs.length > 0 ? { feedbackItemRefs: refs } : {}),
        ...(proofExpectations.length > 0 ? { proofExpectations } : {}),
        ...(visualEvidence.length > 0 ? { visualEvidence } : {}),
      };
    });

    const currentFeature = this.currentTaskId
      ? this.features.find(feature => feature.id === this.currentTaskId)
      : undefined;
    const workStage = this.mapLoopWorkStage(this.progress.currentState);

    const snapshot: ArenaProgressSnapshot = {
      state: this.arenaStateOverride ?? this.mapLoopState(this.progress.currentState),
      ...(workStage ? { workStage } : {}),
      message: this.arenaMessageOverride ?? (currentFeature
        ? `${this.progress.currentState}: ${this.featureDisplayTitle(currentFeature)}`
        : `Ralph state: ${this.progress.currentState}`),
      iteration: this.progress.totalIterations,
    };

    if (steps.length > 0) {
      snapshot.steps = steps;
    }

    if (this.assumptionReviews.length > 0) {
      snapshot.assumptionReviews = this.assumptionReviews;
    }

    return snapshot;
  }

  private sanitizeProgress(value: unknown): Progress {
    if (!value || typeof value !== 'object') return this.progress;
    const record = value as Record<string, unknown>;
    const metrics = record.metrics && typeof record.metrics === 'object'
      ? record.metrics as Record<string, unknown>
      : {};
    const currentState = typeof record.currentState === 'string'
      ? LoopState.safeParse(record.currentState)
      : null;
    const coveragePercent = typeof metrics.coveragePercent === 'number'
      ? metrics.coveragePercent
      : undefined;

    return {
      projectName: typeof record.projectName === 'string' ? record.projectName : this.progress.projectName,
      startedAt: typeof record.startedAt === 'string' ? record.startedAt : this.progress.startedAt,
      lastUpdated: typeof record.lastUpdated === 'string' ? record.lastUpdated : this.progress.lastUpdated,
      totalIterations: typeof record.totalIterations === 'number' ? record.totalIterations : this.progress.totalIterations,
      currentState: currentState?.success ? currentState.data : this.progress.currentState,
      metrics: {
        testsPassing: typeof metrics.testsPassing === 'number' ? metrics.testsPassing : 0,
        testsTotal: typeof metrics.testsTotal === 'number' ? metrics.testsTotal : 0,
        ...(coveragePercent !== undefined ? { coveragePercent } : {}),
      },
    };
  }

  private normalizeAssumptionReview(review: PublicAssumptionCandidate): PublicAssumptionCandidate | null {
    const id = this.cleanAssumptionId(review.id);
    const title = this.cleanText(review.title, 200);
    const statement = this.cleanText(review.statement, 8000);
    if (!id || !title || !statement) return null;
    if (this.isLoopEvidenceReview(title, statement)) return null;

    return {
      id,
      title,
      statement,
      sourceRefs: Array.from(new Set((review.sourceRefs ?? [])
        .map((ref) => this.cleanAssumptionId(ref))
        .filter((ref): ref is string => !!ref))),
    };
  }

  private isLoopEvidenceReview(title: string, statement: string): boolean {
    const normalizedTitle = title.toLowerCase();
    const normalizedStatement = statement.toLowerCase();
    return normalizedTitle.startsWith('needs confirmation for ')
      || (normalizedStatement.includes('appears implemented')
        && normalizedStatement.includes('product evidence has not confirmed'));
  }

  private cleanAssumptionId(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const id = value.trim().toUpperCase();
    if (!/^[A-Z][A-Z0-9_:\-]{1,119}$/.test(id)) return null;
    if (id.startsWith('JUDGMENT-')) return null;
    return id;
  }

  private cleanText(value: unknown, maxLength: number): string | null {
    if (typeof value !== 'string') return null;
    const text = value.replace(/\s+/g, ' ').trim();
    if (!text) return null;
    return text.length > maxLength ? `${text.slice(0, maxLength - 3).trim()}...` : text;
  }

  private cleanProgressText(value: unknown, maxLength: number): string | null {
    if (typeof value !== 'string') return null;
    const text = value
      .replace(/\r\n?/g, '\n')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    if (!text) return null;
    return text.length > maxLength ? `${text.slice(0, maxLength - 3).trim()}...` : text;
  }

  private publicFeatureText(value: unknown, refs: Feature['feedbackItemRefs'], maxLength: number): string | null {
    const text = this.cleanProgressText(value, maxLength);
    if (!text) return null;
    const redacted = this.redactSourceEvidenceText(text, refs);
    return this.cleanProgressText(redacted, maxLength);
  }

  private redactSourceEvidenceText(text: string, refs: Feature['feedbackItemRefs']): string {
    let result = text;
    for (const fragment of this.sourceEvidenceFragments(refs)) {
      result = result.replace(new RegExp(escapeRegExp(fragment).replace(/\s+/g, '\\s+'), 'giu'), '[source evidence redacted]');
    }
    return result;
  }

  private sourceEvidenceFragments(refs: Feature['feedbackItemRefs']): string[] {
    if (!Array.isArray(refs)) return [];
    const seen = new Set<string>();
    const fragments: string[] = [];

    for (const ref of refs) {
      if (!Array.isArray(ref.sourceEvidence)) continue;
      for (const evidence of ref.sourceEvidence) {
        for (const value of [evidence.quote, evidence.intent]) {
          const fragment = this.cleanProgressText(value, 1000);
          if (!fragment || fragment.length < 12 || seen.has(fragment)) continue;
          seen.add(fragment);
          fragments.push(fragment);
        }
      }
    }

    return fragments;
  }

  private featureDisplayTitle(feature: Feature): string {
    return getTaskDisplayTitle(feature);
  }

  private safeFeedbackItemRefs(refs: Feature['feedbackItemRefs']): NonNullable<ArenaProgressStep['feedbackItemRefs']> {
    if (!Array.isArray(refs)) return [];
    return refs
      .map((ref) => ({
        itemId: this.cleanRefText(ref.itemId),
        diffItemId: this.cleanRefText(ref.diffItemId),
        targetType: this.cleanRefText(ref.targetType),
        targetId: this.cleanRefText(ref.targetId),
      }))
      .filter((ref) => ref.itemId || ref.diffItemId || ref.targetType || ref.targetId)
      .slice(0, 10);
  }

  private safeProofExpectations(feature: Feature): NonNullable<ArenaProgressStep['proofExpectations']> {
    if (!Array.isArray(feature.proofExpectations) || feature.proofExpectations.length === 0) return [];

    const evidence = this.safeProofEvidence(feature);
    return feature.proofExpectations
      .filter((expectation) => expectation.kind === 'before_after_screenshot')
      .map((expectation) => {
        const relevantEvidence = evidence.filter(row => row.expectationKind === expectation.kind);
        const positiveEvidence = relevantEvidence.filter(row => row.positive);
        const hasBefore = positiveEvidence.some(row => row.role === 'before' || row.role === 'before_after');
        const hasAfter = positiveEvidence.some(row => row.role === 'after' || row.role === 'before_after');
        const missingEvidence: ArenaProgressMissingProofEvidence[] = [
          ...(!hasBefore ? ['before_screenshot' as const] : []),
          ...(!hasAfter ? ['after_screenshot' as const] : []),
        ];

        const publicEvidence = relevantEvidence.map(({ expectationKind, positive, ...row }) => {
          void expectationKind;
          void positive;
          return row;
        });

        return {
          kind: expectation.kind,
          reason: expectation.reason,
          source: expectation.source,
          status: this.mapProofStatus(missingEvidence, relevantEvidence),
          ...(missingEvidence.length > 0 ? { missingEvidence } : {}),
          ...(publicEvidence.length > 0 ? { evidence: publicEvidence } : {}),
        };
      });
  }

  private safeProofEvidence(feature: Feature): Array<ArenaProgressStepProofEvidence & {
    expectationKind: 'before_after_screenshot';
    positive: boolean;
  }> {
    if (!Array.isArray(feature.verificationEvidence)) return [];

    const rows: Array<ArenaProgressStepProofEvidence & {
      expectationKind: 'before_after_screenshot';
      positive: boolean;
    }> = [];

    for (const evidence of feature.verificationEvidence) {
      const proof = evidence.screenshotProof;
      if (!proof || proof.expectationKind !== 'before_after_screenshot') continue;
      if (evidence.taskId !== feature.id) continue;

      const ref = this.cleanProgressText(evidence.ref, 240);
      if (!ref) continue;

      const summary = this.publicFeatureText(evidence.summary, feature.feedbackItemRefs, 1000);
      const observedAt = this.cleanRefText(evidence.observedAt);
      const artifactPath = this.cleanArtifactPath(evidence.artifactPath);
      const target = this.cleanScreenshotProofTarget(evidence.target);

      rows.push({
        expectationKind: proof.expectationKind,
        positive: evidence.result !== 'fail' && evidence.result !== 'inconclusive',
        kind: evidence.kind,
        role: proof.role,
        ref,
        ...(evidence.result ? { result: evidence.result } : {}),
        ...(observedAt ? { observedAt } : {}),
        ...(summary ? { summary } : {}),
        ...(artifactPath ? { artifactPath } : {}),
        ...(target ? { target } : {}),
      });
    }

    return rows.slice(0, 20);
  }

  private safeVisualEvidence(feature: Feature): ArenaProgressStepVisualEvidence[] {
    if (!Array.isArray(feature.verificationEvidence)) return [];

    const rows: ArenaProgressStepVisualEvidence[] = [];
    const evidenceRows = feature.verificationEvidence;
    for (const evidence of evidenceRows) {
      const sourceKind = this.visualEvidenceSourceKind(evidence.ref);
      if (!sourceKind) continue;
      if (evidence.kind !== 'screenshot') continue;
      if (evidence.screenshotProof) continue;
      if (evidence.taskId !== feature.id) continue;

      const sourceEvidenceRef = this.cleanVisualEvidenceRef(evidence.ref);
      const summary = this.publicFeatureText(evidence.summary, feature.feedbackItemRefs, 1000);
      const observedAt = this.cleanRefText(evidence.observedAt);
      const target = this.cleanScreenshotProofTarget(evidence.target);
      const feedbackItemIds = this.safeVisualFeedbackItemIds(evidence.feedbackItemIds);
      const diffItemIds = this.safeVisualDiffItemIds(feature.feedbackItemRefs, feedbackItemIds);
      if (!sourceEvidenceRef || !summary || !target || feedbackItemIds.length === 0 || diffItemIds.length === 0) continue;

      const assessments = this.safeVisualEvidenceAssessments(feature, evidenceRows, sourceEvidenceRef);
      rows.push({
        sourceEvidenceRef,
        sourceKind,
        ...(evidence.result ? { result: evidence.result } : {}),
        ...(observedAt ? { observedAt } : {}),
        summary,
        feedbackItemIds,
        diffItemIds,
        ...(this.cleanArtifactDigest(evidence.artifactSha256) ? { artifactSha256: this.cleanArtifactDigest(evidence.artifactSha256) } : {}),
        target,
        ...(assessments.length > 0 ? { assessments } : {}),
      });
    }

    return rows.slice(0, 20);
  }

  private safeVisualEvidenceAssessments(
    feature: Feature,
    evidenceRows: FeedbackEvidence[],
    sourceEvidenceRef: string,
  ): ArenaProgressStepVisualEvidenceAssessment[] {
    const assessments: ArenaProgressStepVisualEvidenceAssessment[] = [];
    for (const row of evidenceRows) {
      if (row.sourceEvidenceRef !== sourceEvidenceRef) continue;
      if (row.taskId !== feature.id) continue;
      if (row.kind !== 'manual_note') continue;
      if (row.recordedBy !== 'manual') continue;
      if (!row.result) continue;
      if (row.screenshotProof) continue;

      const ref = this.cleanVisualEvidenceRef(row.ref);
      const summary = this.publicFeatureText(row.summary, feature.feedbackItemRefs, 1000);
      const observedAt = this.cleanRefText(row.observedAt);
      if (!ref || !summary) continue;
      assessments.push({
        ref,
        result: row.result,
        ...(observedAt ? { observedAt } : {}),
        summary,
        ...(row.recordedBy ? { recordedBy: row.recordedBy } : {}),
      });
    }
    return assessments.slice(0, 20);
  }

  private visualEvidenceSourceKind(ref: unknown): ArenaVisualEvidenceSourceKind | null {
    if (typeof ref !== 'string') return null;
    if (ref.startsWith('visual-workbench-capture:')) return 'visual_workbench';
    if (ref.startsWith('visual-scenario-run:')) return 'visual_scenario';
    return null;
  }

  private cleanVisualEvidenceRef(value: unknown): string | undefined {
    if (typeof value !== 'string') return undefined;
    const text = value.trim();
    if (!text || text.length > 420 || !/^[A-Za-z0-9._:-]+$/.test(text)) return undefined;
    return text;
  }

  private safeVisualFeedbackItemIds(values: unknown): string[] {
    if (!Array.isArray(values)) return [];
    return Array.from(new Set(values
      .map((value) => this.cleanRefText(value))
      .filter((value): value is string => typeof value === 'string'))).slice(0, 20);
  }

  private safeVisualDiffItemIds(refs: Feature['feedbackItemRefs'], feedbackItemIds: string[]): string[] {
    if (!Array.isArray(refs)) return [];
    const linkedFeedbackIds = new Set(feedbackItemIds);
    return Array.from(new Set(refs
      .filter((ref) => {
        const itemId = this.cleanRefText(ref.itemId);
        return itemId ? linkedFeedbackIds.has(itemId) : false;
      })
      .map((ref) => this.cleanRefText(ref.diffItemId))
      .filter((value): value is string => typeof value === 'string'))).slice(0, 20);
  }

  private cleanArtifactDigest(value: unknown): string | undefined {
    if (typeof value !== 'string') return undefined;
    const text = value.trim().toLowerCase();
    return /^sha256:[a-f0-9]{64}$/.test(text) ? text : undefined;
  }

  private mapProofStatus(
    missingEvidence: ArenaProgressMissingProofEvidence[],
    evidence: Array<{ role: string }>,
  ): ArenaProgressProofStatus {
    if (missingEvidence.length === 0) return 'satisfied';
    return evidence.length > 0 ? 'partial' : 'missing';
  }

  private cleanArtifactPath(value: unknown): string | undefined {
    const text = this.cleanText(value, 500);
    if (!text || /[\u0000-\u001f]/.test(text)) return undefined;
    return text;
  }

  private cleanScreenshotProofTarget(value: unknown): NonNullable<FeedbackEvidence['target']> | undefined {
    if (!value || typeof value !== 'object') return undefined;
    const record = value as Record<string, unknown>;
    const route = this.cleanProgressText(record.route, 240);
    if (!route || !route.startsWith('/') || route.includes('\\')) return undefined;

    const viewport = record.viewport;
    if (!viewport || typeof viewport !== 'object') return undefined;
    const viewportRecord = viewport as Record<string, unknown>;
    const width = this.cleanPositiveViewportInteger(viewportRecord.width);
    const height = this.cleanPositiveViewportInteger(viewportRecord.height);
    if (!width || !height) return undefined;

    const claim = this.cleanProgressText(record.claim, 500);
    const state = this.cleanProgressText(record.state, 500);
    const interaction = this.cleanProgressText(record.interaction, 500);
    if (!claim && !state && !interaction) return undefined;

    return {
      route,
      viewport: { width, height },
      ...(claim ? { claim } : {}),
      ...(state ? { state } : {}),
      ...(interaction ? { interaction } : {}),
    };
  }

  private cleanPositiveViewportInteger(value: unknown): number | undefined {
    if (typeof value !== 'number' || !Number.isInteger(value)) return undefined;
    if (value < 1 || value > 10_000) return undefined;
    return value;
  }

  private cleanRefText(value: unknown): string | undefined {
    if (typeof value !== 'string') return undefined;
    const text = value.trim();
    if (!text || text.length > 160 || !/^[A-Za-z0-9_:\-./]+$/.test(text)) return undefined;
    return text;
  }

  private mapLoopState(state: LoopState): ArenaProgressState {
    switch (state) {
      case 'initializing':
      case 'planning':
      case 'context_building':
        return 'planning';
      case 'coding':
      case 'controlling':
      case 'recovery':
        return 'coding';
      case 'verification':
        return 'testing';
      case 'committing':
      case 'pushing':
      case 'waiting_deploy':
      case 'deploy_verification':
        return 'deploying';
      case 'completed':
        return 'completed';
      case 'failed':
        return 'error';
      default:
        return 'idle';
    }
  }

  private mapLoopWorkStage(state: LoopState): ArenaProgressWorkStage | undefined {
    switch (state) {
      case 'planning':
      case 'context_building':
        return 'planner';
      case 'controlling':
        return 'controller';
      default:
        return undefined;
    }
  }

  private mapFeatureStatus(status: Feature['status']): ArenaProgressStep['status'] {
    return status;
  }

  private scheduleFlush(): void {
    this.pendingFlush = this.pendingFlush
      .then(() => this.commitFlush())
      .catch(() => {
        // Best-effort background flush; explicit save/flushNow will surface errors.
      });
  }
}

function compactProgressText(value: string, maxLength = 160): string {
  const text = value.replace(/\s+/g, ' ').trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 3).trim()}...`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
