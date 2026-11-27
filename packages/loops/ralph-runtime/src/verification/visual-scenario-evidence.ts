import { createHash } from 'node:crypto';
import fs from 'fs-extra';
import path from 'path';
import { z } from 'zod';
import type { FeedbackEvidence, Task } from '../config/types.js';
import { PlanManager } from '../planning/plan-manager.js';
import { VISUAL_SCENARIO_RUN_SCHEMA_VERSION, type VisualScenarioRunResult } from './visual-scenario-runner.js';
import { VISUAL_SCENARIO_SCHEMA_VERSION, parseVisualScenario } from './visual-scenario.js';

export const VISUAL_SCENARIO_EVIDENCE_EXPORT_SCHEMA_VERSION = 'ra-355.visual-scenario-evidence-export.v1' as const;
export const VISUAL_SCENARIO_ASSESSMENT_SCHEMA_VERSION = 'ra-355.visual-scenario-assessment.v1' as const;
export const VISUAL_SCENARIO_STATUS_SCHEMA_VERSION = 'ra-355.visual-scenario-status.v1' as const;

const VisualScenarioAssessmentKindSchema = z.literal('manual_note');
const VisualScenarioAssessmentResultSchema = z.enum(['pass', 'fail', 'inconclusive']);
const VisualScenarioRunResultSchema = z.object({
  schemaVersion: z.literal(VISUAL_SCENARIO_RUN_SCHEMA_VERSION),
  scenarioSchemaVersion: z.literal(VISUAL_SCENARIO_SCHEMA_VERSION),
  scenario: z.object({
    scenarioId: z.string().min(1),
    projectClass: z.literal('ordinary_web'),
    name: z.string().nullable(),
    target: z.object({
      route: z.string(),
      viewport: z.object({
        width: z.number().int(),
        height: z.number().int(),
      }).strict(),
      claim: z.string(),
      state: z.string().optional(),
      interaction: z.string().optional(),
    }).strict(),
  }).strict(),
  baseUrl: z.string(),
  status: z.enum(['captured', 'navigation_failed', 'browser_unavailable', 'capture_failed']),
  capturedAt: z.string(),
  output: z.object({
    directory: z.string(),
    reportPath: z.string(),
    screenshotPath: z.string().nullable(),
    screenshotSha256: z.string().nullable(),
  }).strict(),
  error: z.object({
    code: z.string(),
    message: z.string(),
  }).nullable(),
  notes: z.array(z.string()),
}).strict();

export interface VisualScenarioEvidenceExportOptions {
  workDir: string;
  runPath: string;
  taskId: string;
}

export interface VisualScenarioEvidenceExportResult {
  schemaVersion: typeof VISUAL_SCENARIO_EVIDENCE_EXPORT_SCHEMA_VERSION;
  runSchemaVersion: typeof VISUAL_SCENARIO_RUN_SCHEMA_VERSION;
  status: 'recorded' | 'already_recorded';
  taskId: string;
  feedbackItemIds: string[];
  scenarioId: string;
  addedEvidenceRows: number;
  evidenceRefs: string[];
  artifactSha256: string;
  evidence: FeedbackEvidence;
  notes: string[];
}

export interface VisualScenarioAssessmentOptions {
  workDir: string;
  taskId: string;
  evidenceRef: string;
  kind?: z.infer<typeof VisualScenarioAssessmentKindSchema>;
  result: z.infer<typeof VisualScenarioAssessmentResultSchema>;
  assessment: string;
  observedAt?: string;
}

export interface VisualScenarioAssessmentResult {
  schemaVersion: typeof VISUAL_SCENARIO_ASSESSMENT_SCHEMA_VERSION;
  status: 'recorded' | 'already_recorded';
  taskId: string;
  sourceEvidenceRef: string;
  assessmentEvidenceRef: string;
  kind: z.infer<typeof VisualScenarioAssessmentKindSchema>;
  result: z.infer<typeof VisualScenarioAssessmentResultSchema>;
  feedbackItemIds: string[];
  artifactSha256: string;
  evidence: FeedbackEvidence;
  notes: string[];
}

export interface VisualScenarioStatusOptions {
  workDir: string;
  taskId?: string;
}

export interface VisualScenarioStatusAssessment {
  ref: string;
  kind: FeedbackEvidence['kind'];
  result: FeedbackEvidence['result'];
  observedAt?: string;
  summary: string;
  recordedBy?: FeedbackEvidence['recordedBy'];
  sourceEvidenceRef?: string;
}

export interface VisualScenarioStatusSource {
  sourceEvidenceRef: string;
  status: 'unassessed' | 'passed' | 'failed' | 'inconclusive' | 'conflict';
  result: FeedbackEvidence['result'];
  observedAt?: string;
  feedbackItemIds: string[];
  artifactPath?: string;
  artifactSha256?: string;
  target?: FeedbackEvidence['target'];
  assessments: VisualScenarioStatusAssessment[];
  warnings: string[];
}

export interface VisualScenarioStatusTask {
  taskId: string;
  feedbackItemIds: string[];
  sources: VisualScenarioStatusSource[];
}

export interface VisualScenarioStatusIssue {
  taskId: string;
  ref: string;
  kind?: FeedbackEvidence['kind'];
  sourceEvidenceRef?: string;
  reason: string;
}

export interface VisualScenarioStatusResult {
  schemaVersion: typeof VISUAL_SCENARIO_STATUS_SCHEMA_VERSION;
  workDir: string;
  taskFilter: string | null;
  summary: {
    tasks: number;
    sources: number;
    assessments: number;
    invalidRows: number;
    orphanAssessments: number;
  };
  tasks: VisualScenarioStatusTask[];
  orphanAssessments: VisualScenarioStatusIssue[];
  invalidRows: VisualScenarioStatusIssue[];
  notes: string[];
}

export async function exportVisualScenarioEvidenceFile(
  options: VisualScenarioEvidenceExportOptions,
): Promise<VisualScenarioEvidenceExportResult> {
  const runPath = path.resolve(options.runPath);
  const run = parseVisualScenarioRunResult(await fs.readJson(runPath));
  assertCapturedRun(run);

  const screenshotPath = path.resolve(run.output.screenshotPath!);
  await assertScreenshotDigest(screenshotPath, run.output.screenshotSha256!);

  const workDir = path.resolve(options.workDir);
  const artifactPath = relativeArtifactPath(workDir, screenshotPath);
  const planManager = new PlanManager(workDir);
  await planManager.load();
  const task = planManager.findTask(options.taskId);
  if (!task) throw new Error(`Task ${options.taskId} not found.`);

  const feedbackItemIds = normalizeFeedbackItemIds((task.feedbackItemRefs ?? []).map((ref) => ref.itemId));
  if (feedbackItemIds.length === 0) {
    throw new Error(`Task ${options.taskId} has no feedbackItemRefs; visual scenario evidence export cannot invent feedback links.`);
  }

  const evidenceRef = `visual-scenario-run:${run.scenario.scenarioId}:${sha12(run.output.screenshotSha256!)}`;
  const evidence: FeedbackEvidence = {
    kind: 'screenshot',
    ref: evidenceRef,
    observedAt: run.capturedAt,
    summary: buildEvidenceSummary(run),
    result: 'inconclusive',
    feedbackItemIds,
    taskId: options.taskId,
    artifactPath,
    artifactSha256: run.output.screenshotSha256!,
    recordedBy: 'agent',
    target: run.scenario.target,
  };

  const addedEvidenceRows = await planManager.recordTaskVerificationEvidenceAndSave(options.taskId, [evidence]);

  return {
    schemaVersion: VISUAL_SCENARIO_EVIDENCE_EXPORT_SCHEMA_VERSION,
    runSchemaVersion: VISUAL_SCENARIO_RUN_SCHEMA_VERSION,
    status: addedEvidenceRows > 0 ? 'recorded' : 'already_recorded',
    taskId: options.taskId,
    feedbackItemIds,
    scenarioId: run.scenario.scenarioId,
    addedEvidenceRows,
    evidenceRefs: [evidenceRef],
    artifactSha256: run.output.screenshotSha256!,
    evidence,
    notes: [
      'Visual scenario evidence export writes only task-linked verificationEvidence through PlanManager.',
      'Captured visual scenarios are recorded as inconclusive; this export does not assess or close the visual claim.',
      'This export does not write screenshotProof, proofReviews, ProjectAsset, blockers, runtime intent or lifecycle state.',
    ],
  };
}

export function formatVisualScenarioEvidenceExportResult(
  result: VisualScenarioEvidenceExportResult,
  compact = false,
): string {
  return `${JSON.stringify(result, null, compact ? 0 : 2)}\n`;
}

export async function assessVisualScenarioEvidenceFile(
  options: VisualScenarioAssessmentOptions,
): Promise<VisualScenarioAssessmentResult> {
  const workDir = path.resolve(options.workDir);
  const kind = parseAssessmentKind(options.kind ?? 'manual_note');
  const result = VisualScenarioAssessmentResultSchema.parse(options.result);
  const assessment = normalizeAssessmentText(options.assessment);

  const planManager = new PlanManager(workDir);
  await planManager.load();
  const task = planManager.findTask(options.taskId);
  if (!task) throw new Error(`Task ${options.taskId} not found.`);

  const sourceEvidence = findVisualScenarioSourceEvidence(task, options.evidenceRef);
  assertSourceFeedbackLinksStillMatchTask(task, sourceEvidence);
  const artifactPath = resolveEvidenceArtifactPath(workDir, sourceEvidence.artifactPath!);
  await assertScreenshotDigest(artifactPath, sourceEvidence.artifactSha256!);

  const feedbackItemIds = [...sourceEvidence.feedbackItemIds!].sort();
  const assessmentEvidenceRef = buildAssessmentEvidenceRef(sourceEvidence.ref, kind, result, assessment);
  const summary = buildAssessmentSummary(sourceEvidence, result, assessment);
  assertNoConflictingAssessment(task, sourceEvidence.ref, kind, assessmentEvidenceRef, result, summary);

  const evidence: FeedbackEvidence = {
    kind,
    ref: assessmentEvidenceRef,
    observedAt: options.observedAt ?? new Date().toISOString(),
    summary,
    result,
    feedbackItemIds,
    taskId: options.taskId,
    artifactPath: sourceEvidence.artifactPath,
    artifactSha256: sourceEvidence.artifactSha256,
    recordedBy: 'manual',
    sourceEvidenceRef: sourceEvidence.ref,
    target: sourceEvidence.target,
  };

  const addedEvidenceRows = await planManager.recordTaskVerificationEvidenceAndSave(options.taskId, [evidence]);

  return {
    schemaVersion: VISUAL_SCENARIO_ASSESSMENT_SCHEMA_VERSION,
    status: addedEvidenceRows > 0 ? 'recorded' : 'already_recorded',
    taskId: options.taskId,
    sourceEvidenceRef: sourceEvidence.ref,
    assessmentEvidenceRef,
    kind,
    result,
    feedbackItemIds,
    artifactSha256: sourceEvidence.artifactSha256!,
    evidence,
    notes: [
      'Visual scenario assessment writes only task-linked verificationEvidence through PlanManager.',
      'Assessment evidence is separate from the captured screenshot evidence; the source screenshot row remains inconclusive.',
      'This assessment does not write screenshotProof, proofReviews, ProjectAsset, blockers, runtime intent, task status or lifecycle state.',
    ],
  };
}

export function formatVisualScenarioAssessmentResult(
  result: VisualScenarioAssessmentResult,
  compact = false,
): string {
  return `${JSON.stringify(result, null, compact ? 0 : 2)}\n`;
}

export async function getVisualScenarioStatusFile(
  options: VisualScenarioStatusOptions,
): Promise<VisualScenarioStatusResult> {
  const workDir = path.resolve(options.workDir);
  const planManager = new PlanManager(workDir);
  const plan = await planManager.load();
  const tasks = options.taskId
    ? [findRequiredTask(planManager, options.taskId)]
    : plan.phases.flatMap((phase) => phase.tasks);

  const invalidRows: VisualScenarioStatusIssue[] = [];
  const orphanAssessments: VisualScenarioStatusIssue[] = [];
  const taskStatuses: VisualScenarioStatusTask[] = [];

  for (const task of tasks) {
    const taskFeedbackItemIds = normalizeFeedbackItemIds((task.feedbackItemRefs ?? []).map((ref) => ref.itemId));
    const evidenceRows = task.verificationEvidence ?? [];
    const sources = new Map<string, VisualScenarioStatusSource>();
    const assessmentsBySource = new Map<string, VisualScenarioStatusAssessment[]>();

    for (const row of evidenceRows) {
      if (!isVisualScenarioSourceRow(row)) continue;
      const sourceIssue = validateVisualScenarioStatusSource(task, taskFeedbackItemIds, row);
      if (sourceIssue) {
        invalidRows.push(sourceIssue);
        continue;
      }
      sources.set(row.ref, {
        sourceEvidenceRef: row.ref,
        status: 'unassessed',
        result: row.result,
        observedAt: row.observedAt,
        feedbackItemIds: normalizeFeedbackItemIds(row.feedbackItemIds ?? []),
        artifactPath: row.artifactPath,
        artifactSha256: row.artifactSha256,
        target: row.target,
        assessments: [],
        warnings: [],
      });
    }

    for (const row of evidenceRows) {
      if (!isVisualScenarioAssessmentRow(row)) continue;
      const resolved = resolveAssessmentSourceEvidenceRef(row);
      if (resolved.invalidReason) {
        invalidRows.push(statusIssue(task.id, row, resolved.invalidReason, resolved.sourceEvidenceRef ?? undefined));
        continue;
      }
      if (!resolved.sourceEvidenceRef) continue;
      const assessmentIssue = validateVisualScenarioStatusAssessment(task, row);
      if (assessmentIssue) {
        invalidRows.push(assessmentIssue);
        continue;
      }
      if (!sources.has(resolved.sourceEvidenceRef)) {
        orphanAssessments.push(statusIssue(task.id, row, 'source_evidence_not_found_on_task', resolved.sourceEvidenceRef));
        continue;
      }
      const source = sources.get(resolved.sourceEvidenceRef)!;
      const copiedFieldIssue = validateVisualScenarioStatusAssessmentMatchesSource(task, row, source);
      if (copiedFieldIssue) {
        invalidRows.push(copiedFieldIssue);
        continue;
      }
      const assessments = assessmentsBySource.get(resolved.sourceEvidenceRef) ?? [];
      assessments.push({
        ref: row.ref,
        kind: row.kind,
        result: row.result,
        observedAt: row.observedAt,
        summary: row.summary,
        recordedBy: row.recordedBy,
        sourceEvidenceRef: resolved.sourceEvidenceRef,
      });
      assessmentsBySource.set(resolved.sourceEvidenceRef, assessments);
    }

    for (const [sourceRef, source] of sources) {
      if (source.feedbackItemIds.length !== 1) {
        source.warnings.push('not_assessable_multi_feedback_source');
      }
      source.assessments = (assessmentsBySource.get(sourceRef) ?? [])
        .sort((a, b) => (a.observedAt ?? '').localeCompare(b.observedAt ?? '') || a.ref.localeCompare(b.ref));
      source.status = visualScenarioStatusForAssessments(source.assessments);
      if (source.assessments.length > 1 && source.status === 'conflict') {
        source.warnings.push('multiple_assessment_results');
      }
    }

    if (sources.size > 0 || options.taskId) {
      taskStatuses.push({
        taskId: task.id,
        feedbackItemIds: taskFeedbackItemIds,
        sources: [...sources.values()].sort((a, b) => a.sourceEvidenceRef.localeCompare(b.sourceEvidenceRef)),
      });
    }
  }

  const sourcesCount = taskStatuses.reduce((count, task) => count + task.sources.length, 0);
  const assessmentsCount = taskStatuses.reduce(
    (count, task) => count + task.sources.reduce((inner, source) => inner + source.assessments.length, 0),
    0,
  );

  return {
    schemaVersion: VISUAL_SCENARIO_STATUS_SCHEMA_VERSION,
    workDir,
    taskFilter: options.taskId ?? null,
    summary: {
      tasks: taskStatuses.length,
      sources: sourcesCount,
      assessments: assessmentsCount,
      invalidRows: invalidRows.length,
      orphanAssessments: orphanAssessments.length,
    },
    tasks: taskStatuses,
    orphanAssessments,
    invalidRows,
    notes: [
      'Visual scenario status is a read-only projection from task verificationEvidence.',
      'This status does not decide lifecycle, task completion, proof readiness, blockers or runtime intent.',
      'Artifact integrity is validated by export/assessment commands; status does not scan files as truth.',
    ],
  };
}

export function formatVisualScenarioStatusResult(
  result: VisualScenarioStatusResult,
  compact = false,
): string {
  return `${JSON.stringify(result, null, compact ? 0 : 2)}\n`;
}

function parseVisualScenarioRunResult(raw: unknown): VisualScenarioRunResult {
  const parsed = VisualScenarioRunResultSchema.parse(raw) as VisualScenarioRunResult;
  const scenario = parseVisualScenario({
    schemaVersion: VISUAL_SCENARIO_SCHEMA_VERSION,
    scenarioId: parsed.scenario.scenarioId,
    projectClass: parsed.scenario.projectClass,
    ...(parsed.scenario.name ? { name: parsed.scenario.name } : {}),
    target: parsed.scenario.target,
  });
  return {
    ...parsed,
    scenario: {
      scenarioId: scenario.scenarioId,
      projectClass: scenario.projectClass,
      name: scenario.name ?? null,
      target: scenario.target,
    },
  };
}

function assertCapturedRun(run: VisualScenarioRunResult): void {
  if (run.status !== 'captured') {
    throw new Error(`Visual scenario run must be captured before evidence export; got ${run.status}.`);
  }
  if (!run.output.screenshotPath) {
    throw new Error('Captured visual scenario run is missing output.screenshotPath.');
  }
  if (!run.output.screenshotSha256) {
    throw new Error('Captured visual scenario run is missing output.screenshotSha256.');
  }
}

function findVisualScenarioSourceEvidence(task: Task, evidenceRef: string): FeedbackEvidence {
  const matches = (task.verificationEvidence ?? []).filter((row) => row.ref === evidenceRef);
  if (matches.length === 0) {
    throw new Error(`Visual scenario source evidence not found on task ${task.id}: ${evidenceRef}`);
  }
  if (matches.length > 1) {
    throw new Error(`Visual scenario source evidence ref is duplicated on task ${task.id}: ${evidenceRef}`);
  }

  const evidence = matches[0];
  if (evidence.kind !== 'screenshot') {
    throw new Error(`Visual scenario source evidence must be kind=screenshot; got ${evidence.kind}.`);
  }
  if (!evidence.ref.startsWith('visual-scenario-run:')) {
    throw new Error('Visual scenario source evidence ref must start with visual-scenario-run:.');
  }
  if (evidence.taskId !== task.id) {
    throw new Error(`Visual scenario source evidence taskId must be ${task.id}; got ${evidence.taskId ?? 'undefined'}.`);
  }
  if (evidence.result !== 'inconclusive') {
    throw new Error(`Visual scenario source evidence must stay inconclusive; got ${evidence.result ?? 'undefined'}.`);
  }
  if (evidence.recordedBy !== 'agent') {
    throw new Error(`Visual scenario source evidence must be recordedBy=agent; got ${evidence.recordedBy ?? 'undefined'}.`);
  }
  if (evidence.screenshotProof) {
    throw new Error('Visual scenario assessment source must not be screenshotProof evidence.');
  }
  if (!evidence.artifactPath) {
    throw new Error('Visual scenario source evidence is missing artifactPath.');
  }
  if (!evidence.artifactSha256) {
    throw new Error('Visual scenario source evidence is missing artifactSha256.');
  }
  if (!evidence.target) {
    throw new Error('Visual scenario source evidence is missing target.');
  }
  if ((evidence.feedbackItemIds ?? []).length === 0) {
    throw new Error('Visual scenario source evidence is missing feedbackItemIds.');
  }
  return evidence;
}

function findRequiredTask(planManager: PlanManager, taskId: string): Task {
  const task = planManager.findTask(taskId);
  if (!task) throw new Error(`Task ${taskId} not found.`);
  return task;
}

function parseAssessmentKind(value: string): z.infer<typeof VisualScenarioAssessmentKindSchema> {
  if (value !== 'manual_note') {
    throw new Error('Visual scenario assessment kind must be manual_note; vision_qa requires a structured vision report boundary.');
  }
  return VisualScenarioAssessmentKindSchema.parse(value);
}

async function assertScreenshotDigest(screenshotPath: string, expectedDigest: string): Promise<void> {
  if (!/^sha256:[a-f0-9]{64}$/.test(expectedDigest)) {
    throw new Error('Visual scenario screenshot digest must be sha256:<64 lowercase hex chars>.');
  }
  if (!await fs.pathExists(screenshotPath)) {
    throw new Error(`Visual scenario screenshot file not found: ${screenshotPath}`);
  }
  const actualDigest = `sha256:${createHash('sha256').update(await fs.readFile(screenshotPath)).digest('hex')}`;
  if (actualDigest !== expectedDigest) {
    throw new Error(`Visual scenario screenshot digest mismatch: expected ${expectedDigest}, got ${actualDigest}.`);
  }
}

function assertSourceFeedbackLinksStillMatchTask(task: Task, evidence: FeedbackEvidence): void {
  const taskIds = normalizeFeedbackItemIds((task.feedbackItemRefs ?? []).map((ref) => ref.itemId));
  const evidenceIds = normalizeFeedbackItemIds(evidence.feedbackItemIds ?? []);
  if (taskIds.length === 0) {
    throw new Error(`Task ${task.id} has no feedbackItemRefs; visual scenario assessment cannot invent feedback links.`);
  }
  if (evidenceIds.length !== 1) {
    throw new Error('Visual scenario assessment currently requires exactly one feedbackItemId on the source evidence.');
  }
  if (taskIds.length !== evidenceIds.length || taskIds.some((itemId, index) => itemId !== evidenceIds[index])) {
    throw new Error(`Visual scenario source feedback links no longer match task ${task.id}.`);
  }
}

function normalizeFeedbackItemIds(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim())
    .filter(Boolean))).sort();
}

function normalizeAssessmentText(value: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error('Visual scenario assessment text is required.');
  }
  if (normalized.length > 2000) {
    throw new Error('Visual scenario assessment text must be 2000 characters or fewer.');
  }
  return normalized;
}

function buildEvidenceSummary(run: VisualScenarioRunResult): string {
  return `Visual scenario ${run.scenario.scenarioId} captured for review; the visual claim is not verified by this export.`;
}

function buildAssessmentSummary(
  sourceEvidence: FeedbackEvidence,
  result: z.infer<typeof VisualScenarioAssessmentResultSchema>,
  assessment: string,
): string {
  return `Manual visual scenario assessment (${result}) for ${sourceEvidence.ref}: ${assessment}`;
}

function relativeArtifactPath(workDir: string, screenshotPath: string): string {
  const relativePath = path.relative(workDir, screenshotPath);
  if (!relativePath || relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    throw new Error(`Visual scenario screenshot artifact must be under workDir: ${workDir}`);
  }
  if (relativePath.split(path.sep).includes('assets') && relativePath.split(path.sep).includes('proof')) {
    throw new Error('Visual scenario evidence export must not reuse screenshot-proof assets.');
  }
  return relativePath.split(path.sep).join('/');
}

function resolveEvidenceArtifactPath(workDir: string, artifactPath: string): string {
  if (path.isAbsolute(artifactPath)) {
    throw new Error('Visual scenario assessment artifactPath must be relative to workDir.');
  }
  const absolutePath = path.resolve(workDir, artifactPath);
  const relativePath = path.relative(workDir, absolutePath);
  if (!relativePath || relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    throw new Error(`Visual scenario assessment artifact must be under workDir: ${workDir}`);
  }
  if (relativePath.split(path.sep).includes('assets') && relativePath.split(path.sep).includes('proof')) {
    throw new Error('Visual scenario assessment must not reuse screenshot-proof assets.');
  }
  return absolutePath;
}

function sha12(digest: string): string {
  return digest.replace(/^sha256:/, '').slice(0, 12);
}

function buildAssessmentEvidenceRef(
  sourceRef: string,
  kind: z.infer<typeof VisualScenarioAssessmentKindSchema>,
  result: z.infer<typeof VisualScenarioAssessmentResultSchema>,
  assessment: string,
): string {
  const sourceSuffix = sourceRef.replace(/^visual-scenario-run:/, '');
  const assessmentDigest = createHash('sha256').update(`${kind}\n${result}\n${assessment}`).digest('hex').slice(0, 12);
  return `visual-scenario-assessment:${kind}:${sourceSuffix}:${assessmentDigest}`;
}

function isVisualScenarioSourceRow(row: FeedbackEvidence): boolean {
  return row.kind === 'screenshot' && row.ref.startsWith('visual-scenario-run:');
}

function isVisualScenarioAssessmentRow(row: FeedbackEvidence): boolean {
  return typeof row.sourceEvidenceRef === 'string'
    || row.ref.startsWith('visual-scenario-assessment:');
}

function validateVisualScenarioStatusSource(
  task: Task,
  taskFeedbackItemIds: string[],
  row: FeedbackEvidence,
): VisualScenarioStatusIssue | null {
  if (row.result !== 'inconclusive') return statusIssue(task.id, row, 'source_result_must_be_inconclusive');
  if (row.recordedBy !== 'agent') return statusIssue(task.id, row, 'source_recorded_by_must_be_agent');
  if (row.taskId !== task.id) return statusIssue(task.id, row, 'source_task_id_mismatch');
  if (row.screenshotProof) return statusIssue(task.id, row, 'source_must_not_be_screenshot_proof');
  if (!row.target) return statusIssue(task.id, row, 'source_missing_target');
  if (!row.artifactPath) return statusIssue(task.id, row, 'source_missing_artifact_path');
  if (!row.artifactSha256) return statusIssue(task.id, row, 'source_missing_artifact_sha256');
  const sourceFeedbackItemIds = normalizeFeedbackItemIds(row.feedbackItemIds ?? []);
  if (sourceFeedbackItemIds.length === 0) return statusIssue(task.id, row, 'source_missing_feedback_item_ids');
  if (sourceFeedbackItemIds.some((itemId) => !taskFeedbackItemIds.includes(itemId))) {
    return statusIssue(task.id, row, 'source_feedback_links_not_on_task');
  }
  return null;
}

function validateVisualScenarioStatusAssessment(task: Task, row: FeedbackEvidence): VisualScenarioStatusIssue | null {
  if (row.taskId !== task.id) return statusIssue(task.id, row, 'assessment_task_id_mismatch', row.sourceEvidenceRef);
  if (row.screenshotProof) return statusIssue(task.id, row, 'assessment_must_not_be_screenshot_proof', row.sourceEvidenceRef);
  if (row.kind !== 'manual_note') return statusIssue(task.id, row, 'assessment_kind_must_be_manual_note', row.sourceEvidenceRef);
  if (row.recordedBy !== 'manual') return statusIssue(task.id, row, 'assessment_recorded_by_must_be_manual', row.sourceEvidenceRef);
  if (row.result !== 'pass' && row.result !== 'fail' && row.result !== 'inconclusive') {
    return statusIssue(task.id, row, 'assessment_missing_explicit_result', row.sourceEvidenceRef);
  }
  return null;
}

function validateVisualScenarioStatusAssessmentMatchesSource(
  task: Task,
  row: FeedbackEvidence,
  source: VisualScenarioStatusSource,
): VisualScenarioStatusIssue | null {
  if (!sameStringList(normalizeFeedbackItemIds(row.feedbackItemIds ?? []), source.feedbackItemIds)) {
    return statusIssue(task.id, row, 'assessment_feedback_item_ids_do_not_match_source', source.sourceEvidenceRef);
  }
  if (row.artifactPath !== source.artifactPath) {
    return statusIssue(task.id, row, 'assessment_artifact_path_does_not_match_source', source.sourceEvidenceRef);
  }
  if (row.artifactSha256 !== source.artifactSha256) {
    return statusIssue(task.id, row, 'assessment_artifact_sha256_does_not_match_source', source.sourceEvidenceRef);
  }
  if (!sameJson(row.target, source.target)) {
    return statusIssue(task.id, row, 'assessment_target_does_not_match_source', source.sourceEvidenceRef);
  }
  return null;
}

function resolveAssessmentSourceEvidenceRef(row: FeedbackEvidence): {
  sourceEvidenceRef: string | null;
  invalidReason?: string;
} {
  const explicit = row.sourceEvidenceRef?.trim();
  if (!explicit && row.ref.startsWith('visual-scenario-assessment:')) {
    return {
      sourceEvidenceRef: null,
      invalidReason: 'assessment_missing_source_evidence_ref',
    };
  }
  return { sourceEvidenceRef: explicit || null };
}

function visualScenarioStatusForAssessments(
  assessments: VisualScenarioStatusAssessment[],
): VisualScenarioStatusSource['status'] {
  if (assessments.length === 0) return 'unassessed';
  const results = new Set(assessments.map((assessment) => assessment.result));
  if (results.size !== 1) return 'conflict';
  const [result] = [...results];
  if (result === 'pass') return 'passed';
  if (result === 'fail') return 'failed';
  if (result === 'inconclusive') return 'inconclusive';
  return 'conflict';
}

function statusIssue(
  taskId: string,
  row: FeedbackEvidence,
  reason: string,
  sourceEvidenceRef = row.sourceEvidenceRef,
): VisualScenarioStatusIssue {
  return {
    taskId,
    ref: row.ref,
    kind: row.kind,
    sourceEvidenceRef,
    reason,
  };
}

function sameStringList(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function assessmentConflictPrefix(
  sourceRef: string,
  kind: z.infer<typeof VisualScenarioAssessmentKindSchema>,
): string {
  return `visual-scenario-assessment:${kind}:${sourceRef.replace(/^visual-scenario-run:/, '')}:`;
}

function assertNoConflictingAssessment(
  task: Task,
  sourceRef: string,
  kind: z.infer<typeof VisualScenarioAssessmentKindSchema>,
  assessmentEvidenceRef: string,
  result: z.infer<typeof VisualScenarioAssessmentResultSchema>,
  summary: string,
): void {
  const prefix = assessmentConflictPrefix(sourceRef, kind);
  const existing = (task.verificationEvidence ?? []).filter((row) => row.ref.startsWith(prefix));
  if (existing.length === 0) return;

  const exactDuplicate = existing.find((row) => row.ref === assessmentEvidenceRef
    && row.kind === kind
    && row.result === result
    && row.summary === summary);
  if (exactDuplicate) return;

  throw new Error(`Conflicting visual scenario assessment already exists for source evidence ${sourceRef}.`);
}
