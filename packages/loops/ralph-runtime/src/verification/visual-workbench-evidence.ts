import { createHash } from 'node:crypto';
import fs from 'fs-extra';
import path from 'path';
import { z } from 'zod';
import {
  getVisualWorkbenchManifestIssueDetails,
  parseVisualWorkbenchManifest,
  VISUAL_WORKBENCH_MANIFEST_PATH,
  type VisualWorkbenchManifestIssueDetail,
  type VisualWorkbenchManifest as SourceVisualWorkbenchManifest,
  type VisualWorkbenchStory as SourceVisualWorkbenchStory,
} from '@arena/contracts';
import type { FeedbackEvidence, Plan, RalphConfig, Task } from '../config/types.js';
import { PlanManager } from '../planning/plan-manager.js';
import { getTaskDisplayTitle } from '../utils/task-display.js';
import {
  VISUAL_WORKBENCH_CAPTURE_RUN_SCHEMA_VERSION,
} from './visual-workbench-runner.js';

export const VISUAL_WORKBENCH_EVIDENCE_EXPORT_SCHEMA_VERSION = 'ra-355.visual-workbench-evidence-export.v1' as const;
export const VISUAL_WORKBENCH_ASSESSMENT_SCHEMA_VERSION = 'ra-355.visual-workbench-assessment.v1' as const;
export const VISUAL_WORKBENCH_STATUS_SCHEMA_VERSION = 'ra-355.visual-workbench-status.v1' as const;
export const VISUAL_WORKBENCH_PROGRESS_PUBLISH_SCHEMA_VERSION = 'ra-356.visual-workbench-progress-publish.v1' as const;
export const VISUAL_WORKBENCH_INGEST_MANIFEST_SCHEMA_VERSION = 'ra-356.visual-evidence-ingest-manifest.v1' as const;
export const VISUAL_WORKBENCH_INGEST_MANIFEST_PATH = '.arena/visual-evidence-ingest-manifest.json' as const;
export const VISUAL_WORKBENCH_EVIDENCE_CHAIN_READINESS_SCHEMA_VERSION = 'ra-356.visual-workbench-evidence-chain-readiness.v4' as const;
export const VISUAL_WORKBENCH_SELECTOR_READINESS_SCHEMA_VERSION = 'ra-356.visual-workbench-selector-readiness.v2' as const;
export const VISUAL_WORKBENCH_SHELL_POLICY_SCHEMA_VERSION = 'ra-356.visual-workbench-shell-policy.v1' as const;

const VISUAL_WORKBENCH_SOURCE_REPAIR_TASK_TITLE = 'Repair Visual Workbench coverage';

const StableIdSchema = z.string().trim().min(1).max(160).regex(/^[A-Za-z0-9._-]+$/);
const VisualWorkbenchAssessmentKindSchema = z.literal('manual_note');
const VisualWorkbenchAssessmentResultSchema = z.enum(['pass', 'fail', 'inconclusive']);

const VisualWorkbenchCaptureRunResultSchema = z.object({
  schemaVersion: z.literal(VISUAL_WORKBENCH_CAPTURE_RUN_SCHEMA_VERSION),
  status: z.enum([
    'captured',
    'partial',
    'blocked',
    'failed',
    'workbench_start_failed',
    'workspace_mutation_detected',
  ]),
  capturedAt: z.string(),
  stage: z.object({
    sourceRef: z.string().min(1),
  }).passthrough(),
  stories: z.array(z.object({
    storyId: StableIdSchema,
    title: z.string().min(1),
    kind: z.string().min(1),
    feature: z.string().min(1),
    widget: z.string().min(1),
    state: z.string().min(1),
    route: z.string().min(1),
    claim: z.string().min(1),
    viewports: z.array(z.object({
      name: StableIdSchema,
      width: z.number().int(),
      height: z.number().int(),
      status: z.enum(['captured', 'navigation_failed', 'browser_unavailable', 'capture_failed']),
      screenshotPath: z.string().nullable(),
      screenshotSha256: z.string().nullable(),
      error: z.object({
        code: z.string(),
        message: z.string(),
      }).nullable(),
    }).passthrough()),
  }).passthrough()),
  workspaceMutationCheck: z.object({
    changed: z.boolean().nullable(),
  }).passthrough(),
}).passthrough();

type ParsedVisualWorkbenchCaptureRun = z.infer<typeof VisualWorkbenchCaptureRunResultSchema>;
type VisualWorkbenchViewport = ParsedVisualWorkbenchCaptureRun['stories'][number]['viewports'][number];
type VisualWorkbenchStory = ParsedVisualWorkbenchCaptureRun['stories'][number];

export interface VisualWorkbenchEvidenceExportOptions {
  workDir: string;
  runPath: string;
  taskId: string;
  storyId: string;
  viewportName: string;
  feedbackItemId?: string;
  diffItemId?: string;
}

export interface VisualWorkbenchEvidenceExportResult {
  schemaVersion: typeof VISUAL_WORKBENCH_EVIDENCE_EXPORT_SCHEMA_VERSION;
  runSchemaVersion: typeof VISUAL_WORKBENCH_CAPTURE_RUN_SCHEMA_VERSION;
  status: 'recorded' | 'already_recorded';
  taskId: string;
  feedbackItemIds: string[];
  diffItemIds: string[];
  storyId: string;
  viewportName: string;
  addedEvidenceRows: number;
  evidenceRefs: string[];
  artifactSha256: string;
  adoptedArtifactPath: string;
  evidence: FeedbackEvidence;
  notes: string[];
}

export interface VisualWorkbenchAssessmentOptions {
  workDir: string;
  taskId: string;
  evidenceRef: string;
  kind?: z.infer<typeof VisualWorkbenchAssessmentKindSchema>;
  result: z.infer<typeof VisualWorkbenchAssessmentResultSchema>;
  assessment: string;
  observedAt?: string;
}

export interface VisualWorkbenchAssessmentResult {
  schemaVersion: typeof VISUAL_WORKBENCH_ASSESSMENT_SCHEMA_VERSION;
  status: 'recorded' | 'already_recorded';
  taskId: string;
  sourceEvidenceRef: string;
  assessmentEvidenceRef: string;
  kind: z.infer<typeof VisualWorkbenchAssessmentKindSchema>;
  result: z.infer<typeof VisualWorkbenchAssessmentResultSchema>;
  feedbackItemIds: string[];
  diffItemIds: string[];
  artifactSha256: string;
  evidence: FeedbackEvidence;
  notes: string[];
}

export interface VisualWorkbenchStatusOptions {
  workDir: string;
  taskId?: string;
}

export interface VisualWorkbenchProgressPublishOptions {
  workDir: string;
  taskId?: string;
}

export interface VisualWorkbenchEvidenceChainReadinessOptions {
  workDir: string;
  runPath?: string;
  taskId?: string;
  storyId?: string;
  viewportName?: string;
  feedbackItemId?: string;
  diffItemId?: string;
  evidenceRef?: string;
  projectId?: string;
}

export interface VisualWorkbenchSelectorReadinessOptions {
  workDir: string;
  taskId?: string;
  manifestPath?: string;
  candidateTaskIds?: string[];
}

export interface VisualWorkbenchSelectorReadinessForPlanOptions extends VisualWorkbenchSelectorReadinessOptions {
  plan: Plan;
}

export interface VisualWorkbenchShellPolicyOptions {
  workDir: string;
  manifestPath?: string;
  ralphConfig: RalphConfig;
}

export interface VisualWorkbenchStatusAssessment {
  ref: string;
  kind: FeedbackEvidence['kind'];
  result: FeedbackEvidence['result'];
  observedAt?: string;
  summary: string;
  recordedBy?: FeedbackEvidence['recordedBy'];
  sourceEvidenceRef?: string;
}

export interface VisualWorkbenchStatusSource {
  sourceEvidenceRef: string;
  status: 'unassessed' | 'passed' | 'failed' | 'inconclusive' | 'conflict';
  result: FeedbackEvidence['result'];
  observedAt?: string;
  summary: string;
  feedbackItemIds: string[];
  diffItemIds: string[];
  artifactPath?: string;
  artifactSha256?: string;
  target?: FeedbackEvidence['target'];
  assessments: VisualWorkbenchStatusAssessment[];
  warnings: string[];
}

export interface VisualWorkbenchStatusTask {
  taskId: string;
  status: Task['status'];
  title: string;
  feedbackItemIds: string[];
  diffItemIds: string[];
  totalVerificationEvidenceRows: number;
  visualWorkbenchEvidenceRows: number;
  sources: VisualWorkbenchStatusSource[];
}

export interface VisualWorkbenchStatusIssue {
  taskId: string;
  ref: string;
  kind?: FeedbackEvidence['kind'];
  sourceEvidenceRef?: string;
  reason: string;
}

export interface VisualWorkbenchStatusResult {
  schemaVersion: typeof VISUAL_WORKBENCH_STATUS_SCHEMA_VERSION;
  workDir: string;
  taskFilter: string | null;
  status: 'ready' | 'blocked';
  plan: {
    status: 'ready' | 'blocked';
    path: string;
    reasonCode: 'plan_missing' | 'plan_unreadable' | null;
    blockers: string[];
  };
  summary: {
    tasks: number;
    sources: number;
    assessments: number;
    invalidRows: number;
    orphanAssessments: number;
  };
  tasks: VisualWorkbenchStatusTask[];
  orphanAssessments: VisualWorkbenchStatusIssue[];
  invalidRows: VisualWorkbenchStatusIssue[];
  notes: string[];
}

export interface VisualWorkbenchProgressPublishResult {
  schemaVersion: typeof VISUAL_WORKBENCH_PROGRESS_PUBLISH_SCHEMA_VERSION;
  statusSchemaVersion: typeof VISUAL_WORKBENCH_STATUS_SCHEMA_VERSION;
  workDir: string;
  taskFilter: string | null;
  progressPath: string;
  uploadManifest: {
    schemaVersion: typeof VISUAL_WORKBENCH_INGEST_MANIFEST_SCHEMA_VERSION;
    path: string;
    items: number;
  };
  status: 'published';
  summary: {
    stepsBefore: number;
    stepsAfter: number;
    visualEvidenceRows: number;
    taskIds: string[];
  };
  notes: string[];
}

export interface VisualWorkbenchIngestManifestItem {
  taskId: string;
  sourceEvidenceRef: string;
  artifactPath: string;
  artifactSha256: string;
  artifactContentType: 'image/png';
}

export interface VisualWorkbenchIngestManifest {
  schemaVersion: typeof VISUAL_WORKBENCH_INGEST_MANIFEST_SCHEMA_VERSION;
  ownerBoundary: 'ralph.visual-workbench-progress-publish';
  progressJsonPath: '.arena/progress.json';
  items: VisualWorkbenchIngestManifestItem[];
}

export interface VisualWorkbenchEvidenceChainReadinessCheck {
  stageId:
    | 'visual_workbench_selector_readiness'
    | 'visual_workbench_capture_selection'
    | 'visual_workbench_capture_viewer'
    | 'visual_workbench_evidence_export'
    | 'visual_workbench_assessment'
    | 'visual_workbench_progress_publish'
    | 'arena_visual_evidence_readback';
  status:
    | 'not_provided'
    | 'not_applicable'
    | 'blocked'
    | 'ready'
    | 'already_recorded'
    | 'published';
  blockers: string[];
  warnings: string[];
  commandHint?: string;
}

export interface VisualWorkbenchEvidenceChainReadinessResult {
  schemaVersion: typeof VISUAL_WORKBENCH_EVIDENCE_CHAIN_READINESS_SCHEMA_VERSION;
  workDir: string;
  input: {
    runPath: string | null;
    taskId: string | null;
    storyId: string | null;
    viewportName: string | null;
    feedbackItemId: string | null;
    diffItemId: string | null;
    evidenceRef: string | null;
    projectId: string | null;
  };
  status:
    | 'blocked'
    | 'ready_for_export'
    | 'ready_for_assessment'
    | 'ready_for_progress_publish'
    | 'ready_for_arena_readback';
  task: {
    taskId: string | null;
    status: Task['status'] | null;
    title: string | null;
    feedbackItemIds: string[];
    diffItemIds: string[];
    totalVerificationEvidenceRows: number | null;
    visualWorkbenchEvidenceRows: number | null;
  };
  plan: {
    status: 'ready' | 'blocked';
    path: string;
    reasonCode: 'plan_missing' | 'plan_unreadable' | null;
    blockers: string[];
  };
  captureViewer: {
    viewerPath: string | null;
    exists: boolean | null;
    commandHint: string | null;
  };
  selectedEvidenceRef: string | null;
  checks: VisualWorkbenchEvidenceChainReadinessCheck[];
  nextCommands: string[];
  notes: string[];
}

export interface VisualWorkbenchSelectorReadinessViewport {
  name: string;
  width: number;
  height: number;
}

export interface VisualWorkbenchSelectorReadinessSelection {
  storyId: string;
  title: string;
  kind: string;
  feature: string;
  widget: string;
  state: string;
  claim: string;
  matchedSelectors: string[];
  defaultFor: string[];
  feedbackItemId?: string;
  diffItemId?: string;
  viewports: VisualWorkbenchSelectorReadinessViewport[];
}

export interface VisualWorkbenchSelectorReadinessAmbiguity {
  storyId: string;
  matchedTaskIds: string[];
  matchedSelectorsByTask: Array<{
    taskId: string;
    matchedSelectors: string[];
  }>;
}

export interface VisualWorkbenchSelectorReadinessTask {
  taskId: string;
  status: Task['status'];
  title: string;
  readiness: 'ready' | 'blocked' | 'not_applicable';
  blockers: string[];
  warnings: string[];
  ambiguities: VisualWorkbenchSelectorReadinessAmbiguity[];
  feedbackItemIds: string[];
  diffItemIds: string[];
  selectorIdentities: string[];
  selections: VisualWorkbenchSelectorReadinessSelection[];
  exportSelections: Array<{
    storyId: string;
    viewportName: string;
    feedbackItemId?: string;
    diffItemId?: string;
  }>;
}

export interface VisualWorkbenchSelectorReadinessResult {
  schemaVersion: typeof VISUAL_WORKBENCH_SELECTOR_READINESS_SCHEMA_VERSION;
  workDir: string;
  manifestPath: string;
  taskFilter: string | null;
  status: 'ready' | 'blocked' | 'not_applicable';
  manifest: {
    status: 'ready' | 'blocked';
    blockers: string[];
    issueDetails: VisualWorkbenchManifestIssueDetail[];
    storyCount: number | null;
  };
  plan: {
    status: 'ready' | 'blocked';
    path: string | null;
    source: 'plan_file' | 'injected_plan';
    reasonCode: string | null;
    blockers: string[];
  };
  summary: {
    tasks: number;
    readyTasks: number;
    blockedTasks: number;
    notApplicableTasks: number;
    selectedStories: number;
    selectedViewports: number;
  };
  tasks: VisualWorkbenchSelectorReadinessTask[];
  notes: string[];
}

export interface VisualWorkbenchCaptureShellPolicyInput {
  ralphConfig: RalphConfig;
  serveCommand: string | null;
  baseUrlEnv: string | null;
}

export interface VisualWorkbenchCaptureShellPolicyEvaluation {
  status: 'allowed' | 'blocked';
  policy: {
    mode: RalphConfig['visualWorkbench']['executorCaptureShell']['mode'];
    allowedServeCommandCount: number;
    allowedBaseUrlEnvCount: number;
  };
  workbench: {
    serveCommand: string | null;
    baseUrlEnv: string | null;
  };
  blockers: string[];
}

export interface VisualWorkbenchShellPolicyResult {
  schemaVersion: typeof VISUAL_WORKBENCH_SHELL_POLICY_SCHEMA_VERSION;
  workDir: string;
  manifestPath: string;
  status: 'allowed' | 'blocked';
  manifest: {
    status: 'ready' | 'blocked';
    blockers: string[];
    issueDetails: VisualWorkbenchManifestIssueDetail[];
    storyCount: number | null;
  };
  policy: VisualWorkbenchCaptureShellPolicyEvaluation['policy'];
  workbench: VisualWorkbenchCaptureShellPolicyEvaluation['workbench'];
  blockers: string[];
  notes: string[];
}

export async function exportVisualWorkbenchEvidenceFile(
  options: VisualWorkbenchEvidenceExportOptions,
): Promise<VisualWorkbenchEvidenceExportResult> {
  const run = parseVisualWorkbenchCaptureRun(await fs.readJson(path.resolve(options.runPath)));
  assertCapturedWorkbenchRun(run);
  const story = findRequiredStory(run, options.storyId);
  const viewport = findRequiredViewport(story, options.viewportName);
  assertCapturedViewport(story, viewport);

  const sourceScreenshotPath = path.resolve(viewport.screenshotPath!);
  await assertScreenshotDigest(sourceScreenshotPath, viewport.screenshotSha256!);

  const workDir = path.resolve(options.workDir);
  const planManager = new PlanManager(workDir);
  await planManager.load();
  const task = planManager.findTask(options.taskId);
  if (!task) throw new Error(`Task ${options.taskId} not found.`);
  if (isVisualWorkbenchSourceRepairTask(task)) {
    throw new Error(`Task ${options.taskId} is a Visual Workbench source repair task; visual workbench evidence export requires the canonical implementation/evidence owner.`);
  }

  const { feedbackItemIds, diffItemIds } = resolveTaskFeedbackLinkForEvidenceExport({
    task,
    taskId: options.taskId,
    feedbackItemId: options.feedbackItemId,
    diffItemId: options.diffItemId,
  });

  const adoptedArtifactPath = await adoptWorkbenchScreenshot({
    workDir,
    storyId: story.storyId,
    viewportName: viewport.name,
    sourceScreenshotPath,
    screenshotSha256: viewport.screenshotSha256!,
  });
  const artifactPath = relativeArtifactPath(workDir, adoptedArtifactPath);
  await assertScreenshotDigest(adoptedArtifactPath, viewport.screenshotSha256!);

  const evidenceRef = buildWorkbenchEvidenceRef(story.storyId, viewport.name, viewport.screenshotSha256!);
  const evidence: FeedbackEvidence = {
    kind: 'screenshot',
    ref: evidenceRef,
    observedAt: run.capturedAt,
    summary: buildEvidenceSummary(story, viewport),
    result: 'inconclusive',
    feedbackItemIds,
    diffItemIds,
    taskId: options.taskId,
    artifactPath,
    artifactSha256: viewport.screenshotSha256!,
    recordedBy: 'agent',
    target: buildWorkbenchEvidenceTarget(story, viewport),
  };

  const addedEvidenceRows = await planManager.recordTaskVerificationEvidenceAndSave(options.taskId, [evidence]);

  return {
    schemaVersion: VISUAL_WORKBENCH_EVIDENCE_EXPORT_SCHEMA_VERSION,
    runSchemaVersion: VISUAL_WORKBENCH_CAPTURE_RUN_SCHEMA_VERSION,
    status: addedEvidenceRows > 0 ? 'recorded' : 'already_recorded',
    taskId: options.taskId,
    feedbackItemIds,
    diffItemIds,
    storyId: story.storyId,
    viewportName: viewport.name,
    addedEvidenceRows,
    evidenceRefs: [evidenceRef],
    artifactSha256: viewport.screenshotSha256!,
    adoptedArtifactPath: artifactPath,
    evidence,
    notes: [
      'Visual Workbench evidence export writes only task-linked verificationEvidence through PlanManager.',
      'Captured Workbench screenshots are recorded as inconclusive; this export does not assess or close the visual claim.',
      'The source screenshot is adopted into a workDir-local Ralph evidence artifact before the evidence row is written.',
      'This export does not write screenshotProof, proofReviews, ProjectAsset, blockers, runtime intent, task status or lifecycle state.',
    ],
  };
}

export function formatVisualWorkbenchEvidenceExportResult(
  result: VisualWorkbenchEvidenceExportResult,
  compact = false,
): string {
  return `${JSON.stringify(result, null, compact ? 0 : 2)}\n`;
}

export async function assessVisualWorkbenchEvidenceFile(
  options: VisualWorkbenchAssessmentOptions,
): Promise<VisualWorkbenchAssessmentResult> {
  const workDir = path.resolve(options.workDir);
  const kind = parseAssessmentKind(options.kind ?? 'manual_note');
  const result = VisualWorkbenchAssessmentResultSchema.parse(options.result);
  const assessment = normalizeAssessmentText(options.assessment);

  const planManager = new PlanManager(workDir);
  await planManager.load();
  const task = planManager.findTask(options.taskId);
  if (!task) throw new Error(`Task ${options.taskId} not found.`);

  const sourceEvidence = findVisualWorkbenchSourceEvidence(task, options.evidenceRef);
  assertSourceFeedbackLinksStillMatchTask(task, sourceEvidence);
  const artifactPath = resolveEvidenceArtifactPath(workDir, sourceEvidence.artifactPath!);
  await assertScreenshotDigest(artifactPath, sourceEvidence.artifactSha256!);

  const feedbackItemIds = [...sourceEvidence.feedbackItemIds!].sort();
  const diffItemIds = [...sourceEvidence.diffItemIds!].sort();
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
    diffItemIds,
    taskId: options.taskId,
    artifactPath: sourceEvidence.artifactPath,
    artifactSha256: sourceEvidence.artifactSha256,
    recordedBy: 'manual',
    sourceEvidenceRef: sourceEvidence.ref,
    target: sourceEvidence.target,
  };

  const addedEvidenceRows = await planManager.recordTaskVerificationEvidenceAndSave(options.taskId, [evidence]);

  return {
    schemaVersion: VISUAL_WORKBENCH_ASSESSMENT_SCHEMA_VERSION,
    status: addedEvidenceRows > 0 ? 'recorded' : 'already_recorded',
    taskId: options.taskId,
    sourceEvidenceRef: sourceEvidence.ref,
    assessmentEvidenceRef,
    kind,
    result,
    feedbackItemIds,
    diffItemIds,
    artifactSha256: sourceEvidence.artifactSha256!,
    evidence,
    notes: [
      'Visual Workbench assessment writes only task-linked verificationEvidence through PlanManager.',
      'Assessment evidence is separate from the captured Workbench screenshot evidence; the source screenshot row remains inconclusive.',
      'This assessment does not write screenshotProof, proofReviews, ProjectAsset, blockers, runtime intent, task status or lifecycle state.',
    ],
  };
}

export function formatVisualWorkbenchAssessmentResult(
  result: VisualWorkbenchAssessmentResult,
  compact = false,
): string {
  return `${JSON.stringify(result, null, compact ? 0 : 2)}\n`;
}

export async function getVisualWorkbenchStatusFile(
  options: VisualWorkbenchStatusOptions,
): Promise<VisualWorkbenchStatusResult> {
  const workDir = path.resolve(options.workDir);
  const planPath = path.join(workDir, '.ralph', 'plan.json');
  if (!await fs.pathExists(planPath)) {
    return emptyVisualWorkbenchStatusResult({
      workDir,
      taskId: options.taskId,
      planPath,
      reasonCode: 'plan_missing',
      blockers: ['plan_missing'],
    });
  }

  const planManager = new PlanManager(workDir);
  let plan: Plan;
  try {
    plan = await planManager.load();
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return emptyVisualWorkbenchStatusResult({
      workDir,
      taskId: options.taskId,
      planPath,
      reasonCode: 'plan_unreadable',
      blockers: [`plan_unreadable:${detail}`],
    });
  }
  const tasks = options.taskId
    ? [findRequiredTask(planManager, options.taskId)]
    : plan.phases.flatMap((phase) => phase.tasks);

  const invalidRows: VisualWorkbenchStatusIssue[] = [];
  const orphanAssessments: VisualWorkbenchStatusIssue[] = [];
  const taskStatuses: VisualWorkbenchStatusTask[] = [];

  for (const task of tasks) {
    const { feedbackItemIds: taskFeedbackItemIds, diffItemIds: taskDiffItemIds } = taskFeedbackLinkIds(task);
    const evidenceRows = task.verificationEvidence ?? [];
    const sources = new Map<string, VisualWorkbenchStatusSource>();
    const assessmentsBySource = new Map<string, VisualWorkbenchStatusAssessment[]>();

    for (const row of evidenceRows) {
      if (!isVisualWorkbenchSourceRow(row)) continue;
      const sourceIssue = validateVisualWorkbenchStatusSource(task, taskFeedbackItemIds, taskDiffItemIds, row);
      if (sourceIssue) {
        invalidRows.push(sourceIssue);
        continue;
      }
      sources.set(row.ref, {
        sourceEvidenceRef: row.ref,
        status: 'unassessed',
        result: row.result,
        observedAt: row.observedAt,
        summary: row.summary,
        feedbackItemIds: normalizeFeedbackItemIds(row.feedbackItemIds ?? []),
        diffItemIds: normalizeFeedbackItemIds(row.diffItemIds ?? []),
        artifactPath: row.artifactPath,
        artifactSha256: row.artifactSha256,
        target: row.target,
        assessments: [],
        warnings: [],
      });
    }

    for (const row of evidenceRows) {
      if (!isVisualWorkbenchAssessmentRow(row)) continue;
      const resolved = resolveAssessmentSourceEvidenceRef(row);
      if (resolved.invalidReason) {
        invalidRows.push(statusIssue(task.id, row, resolved.invalidReason, resolved.sourceEvidenceRef ?? undefined));
        continue;
      }
      if (!resolved.sourceEvidenceRef) continue;
      const assessmentIssue = validateVisualWorkbenchStatusAssessment(task, row);
      if (assessmentIssue) {
        invalidRows.push(assessmentIssue);
        continue;
      }
      if (!sources.has(resolved.sourceEvidenceRef)) {
        orphanAssessments.push(statusIssue(task.id, row, 'source_evidence_not_found_on_task', resolved.sourceEvidenceRef));
        continue;
      }
      const source = sources.get(resolved.sourceEvidenceRef)!;
      const copiedFieldIssue = validateVisualWorkbenchStatusAssessmentMatchesSource(task, row, source);
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
      source.status = visualWorkbenchStatusForAssessments(source.assessments);
      if (source.assessments.length > 1 && source.status === 'conflict') {
        source.warnings.push('multiple_assessment_results');
      }
    }

    if (sources.size > 0 || options.taskId) {
      const sortedSources = [...sources.values()].sort((a, b) => a.sourceEvidenceRef.localeCompare(b.sourceEvidenceRef));
      taskStatuses.push({
        taskId: task.id,
        status: task.status,
        title: cleanProgressText(getTaskDisplayTitle(task, 400), 400) ?? task.id,
        feedbackItemIds: taskFeedbackItemIds,
        diffItemIds: taskDiffItemIds,
        totalVerificationEvidenceRows: evidenceRows.length,
        visualWorkbenchEvidenceRows: sortedSources.length,
        sources: sortedSources,
      });
    }
  }

  const sourcesCount = taskStatuses.reduce((count, task) => count + task.sources.length, 0);
  const assessmentsCount = taskStatuses.reduce(
    (count, task) => count + task.sources.reduce((inner, source) => inner + source.assessments.length, 0),
    0,
  );

  return {
    schemaVersion: VISUAL_WORKBENCH_STATUS_SCHEMA_VERSION,
    workDir,
    taskFilter: options.taskId ?? null,
    status: 'ready',
    plan: {
      status: 'ready',
      path: planPath,
      reasonCode: null,
      blockers: [],
    },
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
      'Visual Workbench status is a read-only projection from task verificationEvidence.',
      'This status does not decide lifecycle, task completion, proof readiness, blockers or runtime intent.',
      'Artifact integrity is validated by export/assessment commands; status does not scan files as truth.',
    ],
  };
}

function emptyVisualWorkbenchStatusResult(input: {
  workDir: string;
  taskId?: string;
  planPath: string;
  reasonCode: 'plan_missing' | 'plan_unreadable';
  blockers: string[];
}): VisualWorkbenchStatusResult {
  return {
    schemaVersion: VISUAL_WORKBENCH_STATUS_SCHEMA_VERSION,
    workDir: input.workDir,
    taskFilter: input.taskId ?? null,
    status: 'blocked',
    plan: {
      status: 'blocked',
      path: input.planPath,
      reasonCode: input.reasonCode,
      blockers: uniqueStrings(input.blockers),
    },
    summary: {
      tasks: 0,
      sources: 0,
      assessments: 0,
      invalidRows: 0,
      orphanAssessments: 0,
    },
    tasks: [],
    orphanAssessments: [],
    invalidRows: [],
    notes: [
      'Visual Workbench status is a read-only projection from task verificationEvidence.',
      'The Ralph plan boundary is not available, so task-linked Workbench evidence cannot be read yet.',
      'This blocked status does not infer lifecycle, task completion, proof readiness, blockers or runtime intent.',
    ],
  };
}

export function formatVisualWorkbenchStatusResult(
  result: VisualWorkbenchStatusResult,
  compact = false,
): string {
  return `${JSON.stringify(result, null, compact ? 0 : 2)}\n`;
}

export async function getVisualWorkbenchSelectorReadinessFile(
  options: VisualWorkbenchSelectorReadinessOptions,
): Promise<VisualWorkbenchSelectorReadinessResult> {
  const workDir = path.resolve(options.workDir);
  const manifestRelativePath = normalizeWorkbenchManifestRelativePath(options.manifestPath);
  const manifestPath = path.join(workDir, manifestRelativePath);
  const manifestReadiness = await readSelectorManifest(manifestPath);
  const planReadiness = await readSelectorPlan(workDir);

  return buildVisualWorkbenchSelectorReadinessResult({
    workDir,
    manifestPath,
    taskId: options.taskId,
    candidateTaskIds: options.candidateTaskIds,
    manifestReadiness,
    planReadiness,
  });
}

export async function getVisualWorkbenchSelectorReadinessForPlan(
  options: VisualWorkbenchSelectorReadinessForPlanOptions,
): Promise<VisualWorkbenchSelectorReadinessResult> {
  const workDir = path.resolve(options.workDir);
  const manifestRelativePath = normalizeWorkbenchManifestRelativePath(options.manifestPath);
  const manifestPath = path.join(workDir, manifestRelativePath);
  const manifestReadiness = await readSelectorManifest(manifestPath);
  return buildVisualWorkbenchSelectorReadinessResult({
    workDir,
    manifestPath,
    taskId: options.taskId,
    candidateTaskIds: options.candidateTaskIds,
    manifestReadiness,
    planReadiness: {
      status: 'ready',
      path: null,
      source: 'injected_plan',
      reasonCode: null,
      blockers: [],
      plan: options.plan,
    },
  });
}

function buildVisualWorkbenchSelectorReadinessResult(input: {
  workDir: string;
  manifestPath: string;
  taskId?: string;
  candidateTaskIds?: string[];
  manifestReadiness: SelectorManifestReadiness;
  planReadiness: SelectorPlanReadiness;
}): VisualWorkbenchSelectorReadinessResult {
  if (input.manifestReadiness.status === 'blocked' || input.planReadiness.status === 'blocked') {
    return selectorReadinessResult({
      workDir: input.workDir,
      manifestPath: input.manifestPath,
      taskFilter: input.taskId ?? null,
      manifestReadiness: input.manifestReadiness,
      planReadiness: input.planReadiness,
      tasks: [],
    });
  }

  const allTasks = input.planReadiness.plan!.phases.flatMap((phase) => phase.tasks);
  const candidateTaskIds = new Set((input.candidateTaskIds ?? []).filter(Boolean));
  const candidateTasks = candidateTaskIds.size > 0
    ? allTasks.filter((task) => candidateTaskIds.has(task.id))
    : allTasks;
  const selectedTasks = input.taskId
    ? candidateTasks.filter((task) => task.id === input.taskId)
    : candidateTasks;

  if (input.taskId && selectedTasks.length === 0) {
    return selectorReadinessResult({
      workDir: input.workDir,
      manifestPath: input.manifestPath,
      taskFilter: input.taskId,
      manifestReadiness: input.manifestReadiness,
      planReadiness: {
        status: 'blocked',
        path: input.planReadiness.path,
        source: input.planReadiness.source,
        reasonCode: input.planReadiness.reasonCode,
        blockers: ['task_not_found'],
        plan: input.planReadiness.plan,
      },
      tasks: [],
    });
  }

  const taskSelections = buildSelectorTaskReadiness(candidateTasks, input.manifestReadiness.manifest!);
  const filteredTaskSelections = input.taskId
    ? taskSelections.filter((task) => task.taskId === input.taskId)
    : taskSelections;

  return selectorReadinessResult({
    workDir: input.workDir,
    manifestPath: input.manifestPath,
    taskFilter: input.taskId ?? null,
    manifestReadiness: input.manifestReadiness,
    planReadiness: input.planReadiness,
    tasks: filteredTaskSelections,
  });
}

export function formatVisualWorkbenchSelectorReadinessResult(
  result: VisualWorkbenchSelectorReadinessResult,
  compact = false,
): string {
  return `${JSON.stringify(result, null, compact ? 0 : 2)}\n`;
}

export function evaluateVisualWorkbenchCaptureShellPolicy(
  input: VisualWorkbenchCaptureShellPolicyInput,
): VisualWorkbenchCaptureShellPolicyEvaluation {
  const shellPolicy = input.ralphConfig.visualWorkbench.executorCaptureShell;
  const serveCommand = normalizePolicyText(input.serveCommand);
  const baseUrlEnv = normalizePolicyText(input.baseUrlEnv);
  const allowedServeCommands = shellPolicy.allowedServeCommands.map(normalizePolicyText).filter((value): value is string => !!value);
  const allowedBaseUrlEnv = shellPolicy.allowedBaseUrlEnv.map(normalizePolicyText).filter((value): value is string => !!value);
  const blockers: string[] = [];

  if (shellPolicy.mode !== 'allowlisted') {
    blockers.push('visual_workbench_executor_capture_shell_disabled');
  }
  if (shellPolicy.mode === 'allowlisted' && allowedServeCommands.length === 0) {
    blockers.push('serve_command_allowlist_empty');
  }
  if (shellPolicy.mode === 'allowlisted' && allowedBaseUrlEnv.length === 0) {
    blockers.push('base_url_env_allowlist_empty');
  }
  if (!serveCommand) {
    blockers.push('serve_command_missing');
  } else if (shellPolicy.mode === 'allowlisted' && !allowedServeCommands.includes(serveCommand)) {
    blockers.push('serve_command_not_allowlisted');
  }
  if (!baseUrlEnv) {
    blockers.push('base_url_env_missing');
  } else if (shellPolicy.mode === 'allowlisted' && !allowedBaseUrlEnv.includes(baseUrlEnv)) {
    blockers.push('base_url_env_not_allowlisted');
  }

  const uniqueBlockers = uniqueStrings(blockers);
  return {
    status: uniqueBlockers.length === 0 ? 'allowed' : 'blocked',
    policy: {
      mode: shellPolicy.mode,
      allowedServeCommandCount: allowedServeCommands.length,
      allowedBaseUrlEnvCount: allowedBaseUrlEnv.length,
    },
    workbench: {
      serveCommand,
      baseUrlEnv,
    },
    blockers: uniqueBlockers,
  };
}

export async function getVisualWorkbenchShellPolicyFile(
  options: VisualWorkbenchShellPolicyOptions,
): Promise<VisualWorkbenchShellPolicyResult> {
  const workDir = path.resolve(options.workDir);
  const manifestRelativePath = normalizeWorkbenchManifestRelativePath(options.manifestPath);
  const manifestPath = path.join(workDir, manifestRelativePath);
  const manifestReadiness = await readSelectorManifest(manifestPath);
  const policyEvaluation = evaluateVisualWorkbenchCaptureShellPolicy({
    ralphConfig: options.ralphConfig,
    serveCommand: manifestReadiness.manifest?.workbench.serveCommand ?? null,
    baseUrlEnv: manifestReadiness.manifest?.workbench.baseUrlEnv ?? null,
  });
  const blockers = uniqueStrings([
    ...(manifestReadiness.status === 'blocked' ? ['manifest_not_ready'] : []),
    ...manifestReadiness.blockers,
    ...policyEvaluation.blockers,
  ]);

  return {
    schemaVersion: VISUAL_WORKBENCH_SHELL_POLICY_SCHEMA_VERSION,
    workDir,
    manifestPath,
    status: blockers.length === 0 ? 'allowed' : 'blocked',
    manifest: {
      status: manifestReadiness.status,
      blockers: manifestReadiness.blockers,
      issueDetails: manifestReadiness.issueDetails,
      storyCount: manifestReadiness.storyCount,
    },
    policy: policyEvaluation.policy,
    workbench: policyEvaluation.workbench,
    blockers,
    notes: [
      'Visual Workbench shell policy is a read-only precondition for future executor-owned capture automation.',
      'visual-workbench/manifest.json is source-owned execution input; it does not authorize executor shell execution.',
      'Ralph first-party config owns the executor shell allowlist; policy denial is a blocked diagnostic only.',
      'This command does not start Workbench, run Playwright, export evidence, publish progress, mutate task/proof/lifecycle/runtime state or trigger Telegram availability.',
    ],
  };
}

export function formatVisualWorkbenchShellPolicyResult(
  result: VisualWorkbenchShellPolicyResult,
  compact = false,
): string {
  return `${JSON.stringify(result, null, compact ? 0 : 2)}\n`;
}

export async function publishVisualWorkbenchProgressFile(
  options: VisualWorkbenchProgressPublishOptions,
): Promise<VisualWorkbenchProgressPublishResult> {
  const workDir = path.resolve(options.workDir);
  const planManager = new PlanManager(workDir);
  const plan = await planManager.load();
  const status = await getVisualWorkbenchStatusFile({ workDir, taskId: options.taskId });

  const progressPath = path.join(workDir, '.arena', 'progress.json');
  const existingProgress = await readExistingArenaProgress(progressPath);
  const existingSteps = Array.isArray(existingProgress.steps)
    ? existingProgress.steps.filter(isPlainRecord).map(sanitizeExistingArenaProgressStep)
    : [];
  const existingStepIds = new Set(existingSteps.map((step) => readString(step.id)).filter((id): id is string => !!id));
  const tasksById = new Map(plan.phases.flatMap((phase) => phase.tasks).map((task) => [task.id, task]));
  const visualEvidenceByTask = new Map(status.tasks.map((taskStatus) => [
    taskStatus.taskId,
    taskStatus.sources
      .map(progressVisualEvidenceForStatusSource)
      .filter((row): row is Record<string, unknown> => !!row),
  ]));

  const mergedSteps = existingSteps.map((step) => {
    const taskId = readString(step.id);
    if (!taskId || !visualEvidenceByTask.has(taskId)) return step;
    const visualEvidence = visualEvidenceByTask.get(taskId)!;
    const { visualEvidence: _previousVisualEvidence, ...rest } = step;
    void _previousVisualEvidence;
    const task = tasksById.get(taskId);
    const feedbackItemRefs = task ? safeProgressFeedbackItemRefs(task.feedbackItemRefs) : [];
    return {
      ...rest,
      ...(feedbackItemRefs.length > 0 ? { feedbackItemRefs } : {}),
      ...(visualEvidence.length > 0 ? { visualEvidence } : {}),
    };
  });

  for (const [taskId, visualEvidence] of visualEvidenceByTask) {
    if (existingStepIds.has(taskId) || visualEvidence.length === 0) continue;
    const task = tasksById.get(taskId);
    if (!task) continue;
    const label = cleanProgressText(getTaskDisplayTitle(task, 400), 400) ?? task.id;
    const description = cleanProgressText(task.description, 4000);
    const feedbackItemRefs = safeProgressFeedbackItemRefs(task.feedbackItemRefs);
    mergedSteps.push({
      id: task.id,
      label,
      ...(description && description !== label ? { description } : {}),
      status: task.status,
      ...(feedbackItemRefs.length > 0 ? { feedbackItemRefs } : {}),
      visualEvidence,
    });
  }

  const publishedProgress = {
    state: readArenaProgressState(existingProgress.state) ?? 'idle',
    message: readString(existingProgress.message) ?? 'Visual Workbench evidence readback refreshed',
    ...(typeof existingProgress.iteration === 'number' && Number.isFinite(existingProgress.iteration)
      ? { iteration: existingProgress.iteration }
      : {}),
    ...(mergedSteps.length > 0 ? { steps: mergedSteps } : {}),
    ...(Array.isArray(existingProgress.assumptionReviews) ? { assumptionReviews: existingProgress.assumptionReviews } : {}),
  };

  await fs.ensureDir(path.dirname(progressPath));
  await fs.writeJson(progressPath, publishedProgress, { spaces: 2 });
  const uploadManifest = await writeVisualWorkbenchIngestManifest({
    workDir,
    status,
  });

  const visualEvidenceRows = [...visualEvidenceByTask.values()].reduce((count, rows) => count + rows.length, 0);
  return {
    schemaVersion: VISUAL_WORKBENCH_PROGRESS_PUBLISH_SCHEMA_VERSION,
    statusSchemaVersion: VISUAL_WORKBENCH_STATUS_SCHEMA_VERSION,
    workDir,
    taskFilter: options.taskId ?? null,
    progressPath,
    uploadManifest: {
      schemaVersion: uploadManifest.schemaVersion,
      path: path.join(workDir, VISUAL_WORKBENCH_INGEST_MANIFEST_PATH),
      items: uploadManifest.items.length,
    },
    status: 'published',
    summary: {
      stepsBefore: existingSteps.length,
      stepsAfter: mergedSteps.length,
      visualEvidenceRows,
      taskIds: [...visualEvidenceByTask.keys()].sort(),
    },
    notes: [
      'Visual Workbench progress publish writes only .arena/progress.json as a read-side projection from .ralph/plan.json.',
      'It preserves existing Arena progress state/message when present and does not decide lifecycle, task completion, blockers or runtime intent.',
      'It publishes sanitized visualEvidence metadata without raw artifactPath values so Arena can derive visualEvidenceReviews.',
      'It writes a private .arena visual-evidence ingest manifest for runner transport; the manifest is not public progress truth.',
      'It does not scan capture directories, upload ProjectAsset rows, write proofReviews or infer screenshot-review availability in tg-spec.',
    ],
  };
}

export function formatVisualWorkbenchProgressPublishResult(
  result: VisualWorkbenchProgressPublishResult,
  compact = false,
): string {
  return `${JSON.stringify(result, null, compact ? 0 : 2)}\n`;
}

export async function getVisualWorkbenchEvidenceChainReadinessFile(
  options: VisualWorkbenchEvidenceChainReadinessOptions,
): Promise<VisualWorkbenchEvidenceChainReadinessResult> {
  const workDir = path.resolve(options.workDir);
  const runPath = options.runPath ? path.resolve(options.runPath) : null;
  const taskId = normalizeOptionalStableInput(options.taskId);
  const storyId = normalizeOptionalStableInput(options.storyId);
  const viewportName = normalizeOptionalStableInput(options.viewportName);
  const feedbackItemId = normalizeOptionalStableInput(options.feedbackItemId);
  const diffItemId = normalizeOptionalStableInput(options.diffItemId);
  const evidenceRef = normalizeOptionalStableInput(options.evidenceRef);
  const projectId = normalizeOptionalStableInput(options.projectId);

  const checks: VisualWorkbenchEvidenceChainReadinessCheck[] = [];
  const nextCommands: string[] = [];
  const selectedEvidenceRefs = new Set<string>();
  let selectedEvidenceRef: string | null = null;
  let taskFeedbackItemIds: string[] = [];
  let taskDiffItemIds: string[] = [];
  let taskStatus: Task['status'] | null = null;
  let taskTitle: string | null = null;
  let totalVerificationEvidenceRows: number | null = null;
  let visualWorkbenchEvidenceRows: number | null = null;

  const selectorCheck = await buildEvidenceChainSelectorReadiness({
    workDir,
    taskId,
  });
  checks.push(selectorCheck);

  const captureCheck = await buildCaptureSelectionReadiness({
    runPath,
    storyId,
    viewportName,
  });
  checks.push(captureCheck);

  const captureViewerCheck = await buildCaptureViewerReadiness({ runPath });
  checks.push(captureViewerCheck);

  const taskReadiness = await readTaskEvidenceReadiness({
    workDir,
    taskId,
    evidenceRef,
  });
  taskFeedbackItemIds = taskReadiness.feedbackItemIds;
  taskDiffItemIds = taskReadiness.diffItemIds;
  taskStatus = taskReadiness.taskStatus;
  taskTitle = taskReadiness.taskTitle;
  totalVerificationEvidenceRows = taskReadiness.totalVerificationEvidenceRows;
  visualWorkbenchEvidenceRows = taskReadiness.visualWorkbenchEvidenceRows;
  selectedEvidenceRef = taskReadiness.selectedEvidenceRef;
  if (selectedEvidenceRef) selectedEvidenceRefs.add(selectedEvidenceRef);

  const exportCheck = buildEvidenceExportReadiness({
    taskId,
    storyId,
    viewportName,
    feedbackItemId,
    diffItemId,
    captureCheck,
    selectorCheck,
    taskReadiness,
    runPath,
  });
  checks.push(exportCheck);

  const assessmentCheck = buildAssessmentReadiness({
    taskId,
    taskReadiness,
    selectedEvidenceRef,
  });
  checks.push(assessmentCheck);

  const progressCheck = await buildProgressPublishReadiness({
    workDir,
    taskId,
    selectedEvidenceRefs,
    taskReadiness,
  });
  checks.push(progressCheck);

  const arenaReadbackCheck = buildArenaReadbackReadiness({
    projectId,
    progressCheck,
  });
  checks.push(arenaReadbackCheck);

  if (exportCheck.status === 'ready' && runPath && taskId && storyId && viewportName) {
    nextCommands.push([
      `ralph visual-workbench export-evidence --work-dir ${shellArg(workDir)} --run ${shellArg(runPath)} --task ${shellArg(taskId)} --story ${shellArg(storyId)} --viewport ${shellArg(viewportName)}`,
      feedbackItemId ? `--feedback-item ${shellArg(feedbackItemId)}` : '',
      diffItemId ? `--diff-item ${shellArg(diffItemId)}` : '',
    ].filter(Boolean).join(' '));
  }
  if (captureViewerCheck.status === 'ready' && runPath) {
    nextCommands.unshift(`ralph visual-workbench render-viewer --run ${shellArg(runPath)}`);
  }
  if (assessmentCheck.status === 'ready' && taskId && selectedEvidenceRef) {
    nextCommands.push(`ralph visual-workbench assess --work-dir ${shellArg(workDir)} --task ${shellArg(taskId)} --evidence-ref ${shellArg(selectedEvidenceRef)} --result pass|fail|inconclusive --assessment <text>`);
  }
  if (progressCheck.status === 'ready') {
    nextCommands.push(`ralph visual-workbench publish-progress --work-dir ${shellArg(workDir)}${taskId ? ` --task ${shellArg(taskId)}` : ''}`);
  }
  if (arenaReadbackCheck.status === 'ready' && projectId) {
    nextCommands.push(`services/arena-ctl/cli.sh project_proof_reviews --project-id ${shellArg(projectId)}`);
    nextCommands.push(`services/arena-ctl/cli.sh project_visual_evidence_artifact_check --project-id ${shellArg(projectId)}`);
  }

  return {
    schemaVersion: VISUAL_WORKBENCH_EVIDENCE_CHAIN_READINESS_SCHEMA_VERSION,
    workDir,
    input: {
      runPath,
      taskId: taskId ?? null,
      storyId: storyId ?? null,
      viewportName: viewportName ?? null,
      feedbackItemId: feedbackItemId ?? null,
      diffItemId: diffItemId ?? null,
      evidenceRef: evidenceRef ?? null,
      projectId: projectId ?? null,
    },
    status: summarizeEvidenceChainStatus({
      exportCheck,
      assessmentCheck,
      progressCheck,
      arenaReadbackCheck,
    }),
    task: {
      taskId: taskId ?? null,
      status: taskStatus,
      title: taskTitle,
      feedbackItemIds: taskFeedbackItemIds,
      diffItemIds: taskDiffItemIds,
      totalVerificationEvidenceRows,
      visualWorkbenchEvidenceRows,
    },
    plan: taskReadiness.plan,
    captureViewer: buildCaptureViewerSummary(runPath, captureViewerCheck),
    selectedEvidenceRef,
    checks,
    nextCommands,
    notes: [
      'Visual Workbench evidence-chain readiness is read-only diagnostic output for RA-356 manual experiments.',
      'captureViewer is a convenience surface over the capture report; it is not evidence, proof or screenshot-review availability truth.',
      'selector readiness is delegated to the existing Visual Workbench selector owner; this command reports that owner state but does not auto-select stories or viewports.',
      'It delegates evidence truth to .ralph/plan.json status/export boundaries and Arena availability truth to ProjectInteractionSnapshot readback.',
      'ready_for_arena_readback means the next explicit step is to query Arena; it does not mean Arena or tg-spec already has a screenshot-review button.',
      'Run project_visual_evidence_artifact_check only after project_proof_reviews returns current visualEvidenceReviews; it verifies artifact downloadability without becoming screenshot availability truth.',
      'It does not write .ralph/plan.json, .arena/progress.json, proofReviews, ProjectAsset rows, lifecycle, runtime intent, task status or Telegram messages.',
    ],
  };
}

export function formatVisualWorkbenchEvidenceChainReadinessResult(
  result: VisualWorkbenchEvidenceChainReadinessResult,
  compact = false,
): string {
  return `${JSON.stringify(result, null, compact ? 0 : 2)}\n`;
}

async function buildEvidenceChainSelectorReadiness(input: {
  workDir: string;
  taskId?: string;
}): Promise<VisualWorkbenchEvidenceChainReadinessCheck> {
  const commandHint = input.taskId
    ? `ralph visual-workbench selector-readiness --work-dir ${shellArg(input.workDir)} --task ${shellArg(input.taskId)}`
    : `ralph visual-workbench selector-readiness --work-dir ${shellArg(input.workDir)} --task <taskId>`;
  if (!input.taskId) {
    return readinessCheck(
      'visual_workbench_selector_readiness',
      'not_provided',
      ['task_not_selected'],
      [],
      commandHint,
    );
  }

  try {
    const selectorReadiness = await getVisualWorkbenchSelectorReadinessFile({
      workDir: input.workDir,
      taskId: input.taskId,
    });
    const task = selectorReadiness.tasks.find((candidate) => candidate.taskId === input.taskId) ?? null;
    const blockers = uniqueStrings([
      ...(selectorReadiness.manifest.status === 'blocked' ? ['manifest_not_ready'] : []),
      ...selectorReadiness.manifest.blockers,
      ...(selectorReadiness.plan.status === 'blocked' ? ['plan_not_ready'] : []),
      ...selectorReadiness.plan.blockers,
      ...(task?.blockers ?? []),
    ]);
    const warnings = uniqueStrings(task?.warnings ?? []);
    const status = selectorReadiness.status === 'ready'
      ? 'ready'
      : selectorReadiness.status === 'not_applicable'
        ? 'not_applicable'
        : 'blocked';
    return readinessCheck(
      'visual_workbench_selector_readiness',
      status,
      blockers,
      warnings,
      status === 'ready' ? undefined : commandHint,
    );
  } catch (error) {
    return readinessCheck(
      'visual_workbench_selector_readiness',
      'blocked',
      ['selector_readiness_unreadable'],
      [error instanceof Error ? error.message : String(error)],
      commandHint,
    );
  }
}

async function buildCaptureSelectionReadiness(input: {
  runPath: string | null;
  storyId?: string;
  viewportName?: string;
}): Promise<VisualWorkbenchEvidenceChainReadinessCheck> {
  if (!input.runPath) {
    return readinessCheck('visual_workbench_capture_selection', 'not_provided', ['capture_run_not_provided'], [], undefined);
  }
  const blockers: string[] = [];
  const warnings: string[] = [];

  try {
    if (!await fs.pathExists(input.runPath)) {
      return readinessCheck('visual_workbench_capture_selection', 'blocked', ['capture_run_file_missing'], [], undefined);
    }
    const run = parseVisualWorkbenchCaptureRun(await fs.readJson(input.runPath));
    if (run.status !== 'captured') blockers.push(`capture_run_not_captured:${run.status}`);
    if (run.workspaceMutationCheck.changed !== false) blockers.push('capture_workspace_mutation_not_clean');
    if (!input.storyId) blockers.push('story_not_selected');
    if (!input.viewportName) blockers.push('viewport_not_selected');

    if (input.storyId) {
      const story = run.stories.find((candidate) => candidate.storyId === input.storyId);
      if (!story) {
        blockers.push('story_not_found');
      } else if (input.viewportName) {
        const viewport = story.viewports.find((candidate) => candidate.name === input.viewportName);
        if (!viewport) {
          blockers.push('viewport_not_found');
        } else {
          if (viewport.status !== 'captured') blockers.push(`viewport_not_captured:${viewport.status}`);
          if (!viewport.screenshotPath) blockers.push('viewport_missing_screenshot_path');
          if (!viewport.screenshotSha256) blockers.push('viewport_missing_screenshot_sha256');
          if (viewport.screenshotSha256 && !/^sha256:[a-f0-9]{64}$/.test(viewport.screenshotSha256)) {
            blockers.push('viewport_screenshot_sha256_invalid');
          }
        }
      }
    }

    const commandHint = blockers.length === 0
      ? undefined
      : 'ralph visual-workbench capture --work-dir <project-workdir> --source-ref <sourceRef> --base-url <url> --out-dir <capture-output-dir>';
    return readinessCheck('visual_workbench_capture_selection', blockers.length > 0 ? 'blocked' : 'ready', blockers, warnings, commandHint);
  } catch (error) {
    return readinessCheck(
      'visual_workbench_capture_selection',
      'blocked',
      ['capture_run_invalid'],
      [error instanceof Error ? error.message : String(error)],
      undefined,
    );
  }
}

interface TaskEvidenceReadiness {
  plan: VisualWorkbenchEvidenceChainReadinessResult['plan'];
  planAvailable: boolean;
  taskAvailable: boolean;
  blockers: string[];
  warnings: string[];
  taskStatus: Task['status'] | null;
  taskTitle: string | null;
  feedbackItemIds: string[];
  diffItemIds: string[];
  totalVerificationEvidenceRows: number | null;
  visualWorkbenchEvidenceRows: number | null;
  sourceEvidenceRefs: string[];
  selectedEvidenceRef: string | null;
  selectedSourceStatus: VisualWorkbenchStatusSource['status'] | null;
}

async function readTaskEvidenceReadiness(input: {
  workDir: string;
  taskId?: string;
  evidenceRef?: string;
}): Promise<TaskEvidenceReadiness> {
  const blockers: string[] = [];
  const warnings: string[] = [];
  const planPath = path.join(input.workDir, '.ralph', 'plan.json');
  if (!await fs.pathExists(planPath)) {
    const planReadiness: VisualWorkbenchEvidenceChainReadinessResult['plan'] = {
      status: 'blocked',
      path: planPath,
      reasonCode: 'plan_missing',
      blockers: ['plan_missing'],
    };
    return emptyTaskEvidenceReadiness({
      plan: planReadiness,
      blockers: uniqueStrings([
        ...planReadiness.blockers,
        ...(!input.taskId ? ['task_not_selected'] : []),
      ]),
      warnings,
    });
  }

  const planManager = new PlanManager(input.workDir);
  try {
    await planManager.load();
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    const planReadiness: VisualWorkbenchEvidenceChainReadinessResult['plan'] = {
      status: 'blocked',
      path: planPath,
      reasonCode: 'plan_unreadable',
      blockers: [`plan_unreadable:${detail}`],
    };
    return emptyTaskEvidenceReadiness({
      plan: planReadiness,
      blockers: planReadiness.blockers,
      warnings,
    });
  }

  const planReadiness: VisualWorkbenchEvidenceChainReadinessResult['plan'] = {
    status: 'ready',
    path: planPath,
    reasonCode: null,
    blockers: [],
  };

  if (!input.taskId) {
    return emptyTaskEvidenceReadiness({
      plan: planReadiness,
      blockers: ['task_not_selected'],
      warnings,
    });
  }

  try {
    const task = planManager.findTask(input.taskId);
    if (!task) {
      return emptyTaskEvidenceReadiness({
        plan: planReadiness,
        blockers: ['task_not_found'],
        warnings,
      });
    }
    const { feedbackItemIds, diffItemIds } = taskFeedbackLinkIds(task);
    if (feedbackItemIds.length === 0) blockers.push('task_has_no_feedback_item_refs');
    if (diffItemIds.length === 0) blockers.push('task_has_no_feedback_diff_item_ids');

    const status = await getVisualWorkbenchStatusFile({ workDir: input.workDir, taskId: input.taskId });
    const sourceEvidenceRefs = status.tasks.flatMap((taskStatus) => taskStatus.sources.map((source) => source.sourceEvidenceRef));
    const sourceRows = status.tasks.flatMap((taskStatus) => taskStatus.sources);
    let selectedSource: VisualWorkbenchStatusSource | null = null;
    if (input.evidenceRef) {
      selectedSource = sourceRows.find((source) => source.sourceEvidenceRef === input.evidenceRef) ?? null;
      if (!selectedSource) blockers.push('evidence_ref_not_found');
    } else if (sourceRows.length === 1) {
      selectedSource = sourceRows[0];
    } else if (sourceRows.length > 1) {
      blockers.push('ambiguous_evidence_selection');
    }
    for (const issue of status.invalidRows) warnings.push(`invalid:${issue.reason}:${issue.ref}`);
    for (const issue of status.orphanAssessments) warnings.push(`orphan:${issue.reason}:${issue.ref}`);

    return {
      plan: planReadiness,
      planAvailable: true,
      taskAvailable: true,
      blockers,
      warnings,
      taskStatus: task.status,
      taskTitle: cleanProgressText(getTaskDisplayTitle(task, 400), 400) ?? task.id,
      feedbackItemIds,
      diffItemIds,
      totalVerificationEvidenceRows: (task.verificationEvidence ?? []).length,
      visualWorkbenchEvidenceRows: sourceRows.length,
      sourceEvidenceRefs,
      selectedEvidenceRef: selectedSource?.sourceEvidenceRef ?? null,
      selectedSourceStatus: selectedSource?.status ?? null,
    };
  } catch (error) {
    return emptyTaskEvidenceReadiness({
      plan: planReadiness,
      blockers: ['plan_or_status_unreadable'],
      warnings: [error instanceof Error ? error.message : String(error)],
    });
  }
}

function emptyTaskEvidenceReadiness(input: {
  plan: VisualWorkbenchEvidenceChainReadinessResult['plan'];
  blockers: string[];
  warnings: string[];
}): TaskEvidenceReadiness {
  return {
    plan: input.plan,
    planAvailable: input.plan.status === 'ready',
    taskAvailable: false,
    blockers: uniqueStrings(input.blockers),
    warnings: uniqueStrings(input.warnings),
    taskStatus: null,
    taskTitle: null,
    feedbackItemIds: [],
    diffItemIds: [],
    totalVerificationEvidenceRows: null,
    visualWorkbenchEvidenceRows: null,
    sourceEvidenceRefs: [],
    selectedEvidenceRef: null,
    selectedSourceStatus: null,
  };
}

async function buildCaptureViewerReadiness(input: {
  runPath: string | null;
}): Promise<VisualWorkbenchEvidenceChainReadinessCheck> {
  if (!input.runPath) {
    return readinessCheck('visual_workbench_capture_viewer', 'not_provided', ['capture_run_not_provided'], [], undefined);
  }

  try {
    if (!await fs.pathExists(input.runPath)) {
      return readinessCheck('visual_workbench_capture_viewer', 'blocked', ['capture_run_file_missing'], [], undefined);
    }
    parseVisualWorkbenchCaptureRun(await fs.readJson(input.runPath));
    const viewerPath = path.join(path.dirname(input.runPath), 'index.html');
    if (await fs.pathExists(viewerPath)) {
      return readinessCheck('visual_workbench_capture_viewer', 'already_recorded', [], [], undefined);
    }
    return readinessCheck(
      'visual_workbench_capture_viewer',
      'ready',
      [],
      [],
      `ralph visual-workbench render-viewer --run ${input.runPath}`,
    );
  } catch (error) {
    return readinessCheck(
      'visual_workbench_capture_viewer',
      'blocked',
      ['capture_run_invalid'],
      [error instanceof Error ? error.message : String(error)],
      undefined,
    );
  }
}

function buildCaptureViewerSummary(
  runPath: string | null,
  captureViewerCheck: VisualWorkbenchEvidenceChainReadinessCheck,
): VisualWorkbenchEvidenceChainReadinessResult['captureViewer'] {
  if (!runPath) {
    return {
      viewerPath: null,
      exists: null,
      commandHint: captureViewerCheck.commandHint ?? null,
    };
  }
  return {
    viewerPath: path.join(path.dirname(runPath), 'index.html'),
    exists: captureViewerCheck.status === 'already_recorded'
      ? true
      : captureViewerCheck.status === 'ready'
        ? false
        : null,
    commandHint: captureViewerCheck.commandHint ?? null,
  };
}

function buildEvidenceExportReadiness(input: {
  taskId?: string;
  storyId?: string;
  viewportName?: string;
  feedbackItemId?: string;
  diffItemId?: string;
  captureCheck: VisualWorkbenchEvidenceChainReadinessCheck;
  selectorCheck: VisualWorkbenchEvidenceChainReadinessCheck;
  taskReadiness: Awaited<ReturnType<typeof readTaskEvidenceReadiness>>;
  runPath: string | null;
}): VisualWorkbenchEvidenceChainReadinessCheck {
  const blockers = [...input.taskReadiness.blockers];
  const warnings = [...input.taskReadiness.warnings];
  if (input.taskReadiness.sourceEvidenceRefs.length > 0) {
    return readinessCheck('visual_workbench_evidence_export', 'already_recorded', [], warnings, undefined);
  }
  if (input.selectorCheck.status === 'blocked') {
    blockers.push('selector_readiness_blocked');
    blockers.push(...input.selectorCheck.blockers.map((blocker) => `selector:${blocker}`));
  }
  if (input.selectorCheck.status === 'not_applicable') blockers.push('selector_readiness_not_applicable');
  if (input.captureCheck.status !== 'ready') blockers.push(...input.captureCheck.blockers);
  if (!input.runPath) blockers.push('capture_run_not_provided');
  if (!input.taskId) blockers.push('task_not_selected');
  if (!input.storyId) blockers.push('story_not_selected');
  if (!input.viewportName) blockers.push('viewport_not_selected');

  const commandHint = blockers.length === 0
    ? [
      `ralph visual-workbench export-evidence --work-dir <project-workdir> --run <visual-workbench-capture-run.json> --task ${input.taskId} --story ${input.storyId} --viewport ${input.viewportName}`,
      input.feedbackItemId ? `--feedback-item ${input.feedbackItemId}` : '',
      input.diffItemId ? `--diff-item ${input.diffItemId}` : '',
    ].filter(Boolean).join(' ')
    : undefined;
  return readinessCheck('visual_workbench_evidence_export', blockers.length > 0 ? 'blocked' : 'ready', uniqueStrings(blockers), warnings, commandHint);
}

function buildAssessmentReadiness(input: {
  taskId?: string;
  taskReadiness: Awaited<ReturnType<typeof readTaskEvidenceReadiness>>;
  selectedEvidenceRef: string | null;
}): VisualWorkbenchEvidenceChainReadinessCheck {
  const warnings = [...input.taskReadiness.warnings];
  const selectionBlockers = input.taskReadiness.blockers.filter((blocker) => blocker === 'ambiguous_evidence_selection' || blocker === 'evidence_ref_not_found');
  if (selectionBlockers.length > 0) {
    return readinessCheck('visual_workbench_assessment', 'blocked', selectionBlockers, warnings, undefined);
  }
  if (!input.selectedEvidenceRef) {
    return readinessCheck('visual_workbench_assessment', 'not_applicable', ['source_evidence_not_exported'], warnings, undefined);
  }
  if (input.taskReadiness.selectedSourceStatus === 'unassessed') {
    return readinessCheck(
      'visual_workbench_assessment',
      'ready',
      [],
      warnings,
      `ralph visual-workbench assess --work-dir <project-workdir> --task ${input.taskId ?? '<taskId>'} --evidence-ref ${input.selectedEvidenceRef} --result pass|fail|inconclusive --assessment <text>`,
    );
  }
  if (input.taskReadiness.selectedSourceStatus === 'conflict') {
    return readinessCheck('visual_workbench_assessment', 'blocked', ['assessment_conflict'], warnings, undefined);
  }
  return readinessCheck('visual_workbench_assessment', 'already_recorded', [], warnings, undefined);
}

async function buildProgressPublishReadiness(input: {
  workDir: string;
  taskId?: string;
  selectedEvidenceRefs: Set<string>;
  taskReadiness: Awaited<ReturnType<typeof readTaskEvidenceReadiness>>;
}): Promise<VisualWorkbenchEvidenceChainReadinessCheck> {
  const warnings = [...input.taskReadiness.warnings];
  const selectionBlockers = input.taskReadiness.blockers.filter((blocker) => blocker === 'ambiguous_evidence_selection' || blocker === 'evidence_ref_not_found');
  if (selectionBlockers.length > 0) {
    return readinessCheck('visual_workbench_progress_publish', 'blocked', selectionBlockers, warnings, undefined);
  }
  if (input.selectedEvidenceRefs.size === 0) {
    return readinessCheck('visual_workbench_progress_publish', 'not_applicable', ['source_evidence_not_exported'], warnings, undefined);
  }
  const progressPath = path.join(input.workDir, '.arena', 'progress.json');
  let published = false;
  if (await fs.pathExists(progressPath)) {
    try {
      const progress = await readExistingArenaProgress(progressPath);
      const steps = Array.isArray(progress.steps) ? progress.steps.filter(isPlainRecord) : [];
      published = steps.some((step) => Array.isArray(step.visualEvidence)
        && step.visualEvidence.filter(isPlainRecord).some((row) => {
          const ref = readString(row.sourceEvidenceRef);
          return !!ref && input.selectedEvidenceRefs.has(ref);
        }));
    } catch (error) {
      return readinessCheck(
        'visual_workbench_progress_publish',
        'blocked',
        ['progress_json_malformed'],
        [error instanceof Error ? error.message : String(error)],
        undefined,
      );
    }
  }
  if (published) return readinessCheck('visual_workbench_progress_publish', 'published', [], warnings, undefined);
  return readinessCheck(
    'visual_workbench_progress_publish',
    'ready',
    [],
    warnings,
    `ralph visual-workbench publish-progress --work-dir <project-workdir>${input.taskId ? ` --task ${input.taskId}` : ''}`,
  );
}

function buildArenaReadbackReadiness(input: {
  projectId?: string;
  progressCheck: VisualWorkbenchEvidenceChainReadinessCheck;
}): VisualWorkbenchEvidenceChainReadinessCheck {
  const blockers: string[] = [];
  if (input.progressCheck.status !== 'published') blockers.push('progress_visual_evidence_not_published');
  if (!input.projectId) blockers.push('project_id_not_provided');
  return readinessCheck(
    'arena_visual_evidence_readback',
    blockers.length > 0 ? 'blocked' : 'ready',
    blockers,
    [],
    input.projectId
      ? `services/arena-ctl/cli.sh project_proof_reviews --project-id ${shellArg(input.projectId)}`
      : 'services/arena-ctl/cli.sh project_proof_reviews --project-id <projectId>',
  );
}

function summarizeEvidenceChainStatus(input: {
  exportCheck: VisualWorkbenchEvidenceChainReadinessCheck;
  assessmentCheck: VisualWorkbenchEvidenceChainReadinessCheck;
  progressCheck: VisualWorkbenchEvidenceChainReadinessCheck;
  arenaReadbackCheck: VisualWorkbenchEvidenceChainReadinessCheck;
}): VisualWorkbenchEvidenceChainReadinessResult['status'] {
  if (input.arenaReadbackCheck.status === 'ready') return 'ready_for_arena_readback';
  if (input.progressCheck.status === 'ready') return 'ready_for_progress_publish';
  if (input.progressCheck.status === 'published') return 'blocked';
  if (input.assessmentCheck.status === 'ready') return 'ready_for_assessment';
  if (input.exportCheck.status === 'ready') return 'ready_for_export';
  return 'blocked';
}

function readinessCheck(
  stageId: VisualWorkbenchEvidenceChainReadinessCheck['stageId'],
  status: VisualWorkbenchEvidenceChainReadinessCheck['status'],
  blockers: string[],
  warnings: string[],
  commandHint?: string,
): VisualWorkbenchEvidenceChainReadinessCheck {
  return {
    stageId,
    status,
    blockers: uniqueStrings(blockers),
    warnings: uniqueStrings(warnings),
    ...(commandHint ? { commandHint } : {}),
  };
}

interface SelectorManifestReadiness {
  status: 'ready' | 'blocked';
  blockers: string[];
  issueDetails: VisualWorkbenchManifestIssueDetail[];
  storyCount: number | null;
  manifest: SourceVisualWorkbenchManifest | null;
}

interface SelectorPlanReadiness {
  status: 'ready' | 'blocked';
  path: string | null;
  source: 'plan_file' | 'injected_plan';
  reasonCode: string | null;
  blockers: string[];
  plan: Plan | null;
}

function selectorReadinessResult(input: {
  workDir: string;
  manifestPath: string;
  taskFilter: string | null;
  manifestReadiness: SelectorManifestReadiness;
  planReadiness: SelectorPlanReadiness;
  tasks: VisualWorkbenchSelectorReadinessTask[];
}): VisualWorkbenchSelectorReadinessResult {
  const readyTasks = input.tasks.filter((task) => task.readiness === 'ready').length;
  const blockedTasks = input.tasks.filter((task) => task.readiness === 'blocked').length;
  const notApplicableTasks = input.tasks.filter((task) => task.readiness === 'not_applicable').length;
  const selectedStories = input.tasks.reduce((count, task) => count + task.selections.length, 0);
  const selectedViewports = input.tasks.reduce((count, task) => count + task.exportSelections.length, 0);
  const status = summarizeSelectorReadinessStatus({
    manifestReadiness: input.manifestReadiness,
    planReadiness: input.planReadiness,
    tasks: input.tasks,
    taskFilter: input.taskFilter,
    readyTasks,
    blockedTasks,
    notApplicableTasks,
  });

  return {
    schemaVersion: VISUAL_WORKBENCH_SELECTOR_READINESS_SCHEMA_VERSION,
    workDir: input.workDir,
    manifestPath: input.manifestPath,
    taskFilter: input.taskFilter,
    status,
    manifest: {
      status: input.manifestReadiness.status,
      blockers: input.manifestReadiness.blockers,
      issueDetails: input.manifestReadiness.issueDetails,
      storyCount: input.manifestReadiness.storyCount,
    },
    plan: {
      status: input.planReadiness.status,
      path: input.planReadiness.path,
      source: input.planReadiness.source,
      reasonCode: input.planReadiness.reasonCode,
      blockers: input.planReadiness.blockers,
    },
    summary: {
      tasks: input.tasks.length,
      readyTasks,
      blockedTasks,
      notApplicableTasks,
      selectedStories,
      selectedViewports,
    },
    tasks: input.tasks,
    notes: [
      'Visual Workbench selector readiness is read-only diagnostic output for RA-356 manual experiments and future executor orchestration.',
      'It maps evidence-owner task ids and accepted-diff feedback refs to story taskRelevance.defaultFor values only; source-repair task feedback refs are context only. It does not infer evidence from titles, routes, widgets, states, claims or files.',
      'It does not start the Workbench, run Playwright, capture screenshots, export evidence, publish progress, assess screenshots, write lifecycle state or notify Telegram.',
      'A ready selector means story/viewport choices are explicit enough for a later capture/export step; it does not mean screenshot evidence already exists.',
    ],
  };
}

function summarizeSelectorReadinessStatus(input: {
  manifestReadiness: SelectorManifestReadiness;
  planReadiness: SelectorPlanReadiness;
  tasks: VisualWorkbenchSelectorReadinessTask[];
  taskFilter: string | null;
  readyTasks: number;
  blockedTasks: number;
  notApplicableTasks: number;
}): VisualWorkbenchSelectorReadinessResult['status'] {
  if (input.manifestReadiness.status === 'blocked') return 'blocked';
  if (input.planReadiness.status === 'blocked') return 'blocked';
  if (input.tasks.length === 0) return input.taskFilter ? 'blocked' : 'not_applicable';
  if (input.notApplicableTasks === input.tasks.length) return 'not_applicable';
  if (input.blockedTasks > 0) return 'blocked';
  if (input.readyTasks > 0) return 'ready';
  return 'not_applicable';
}

function normalizeWorkbenchManifestRelativePath(value: string | undefined): string {
  const raw = (value ?? VISUAL_WORKBENCH_MANIFEST_PATH).trim();
  if (!raw) throw new Error('Visual Workbench manifest path is required.');
  if (path.isAbsolute(raw)) throw new Error('Visual Workbench manifest path must be relative to work-dir.');
  const normalized = path.posix.normalize(raw.replace(/\\/g, '/'));
  if (normalized === '.' || normalized === '..' || normalized.startsWith('../')) {
    throw new Error('Visual Workbench manifest path must stay inside work-dir.');
  }
  return normalized;
}

async function readSelectorManifest(manifestPath: string): Promise<SelectorManifestReadiness> {
  if (!await fs.pathExists(manifestPath)) {
    return {
      status: 'blocked',
      blockers: ['manifest_missing'],
      issueDetails: [],
      storyCount: null,
      manifest: null,
    };
  }

  let raw: unknown;
  try {
    raw = JSON.parse(await fs.readFile(manifestPath, 'utf-8'));
  } catch {
    return {
      status: 'blocked',
      blockers: ['manifest_invalid_json'],
      issueDetails: [],
      storyCount: null,
      manifest: null,
    };
  }

  const issueDetails = getVisualWorkbenchManifestIssueDetails(raw);
  try {
    const manifest = parseVisualWorkbenchManifest(raw);
    return {
      status: 'ready',
      blockers: [],
      issueDetails: [],
      storyCount: manifest.stories.length,
      manifest,
    };
  } catch {
    return {
      status: 'blocked',
      blockers: ['manifest_contract_invalid'],
      issueDetails,
      storyCount: null,
      manifest: null,
    };
  }
}

async function readSelectorPlan(workDir: string): Promise<SelectorPlanReadiness> {
  const planPath = path.join(workDir, '.ralph', 'plan.json');
  if (!await fs.pathExists(planPath)) {
    return {
      status: 'blocked',
      path: planPath,
      source: 'plan_file',
      reasonCode: 'plan_missing',
      blockers: ['plan_missing'],
      plan: null,
    };
  }

  try {
    const planManager = new PlanManager(workDir);
    const plan = await planManager.load();
    return {
      status: 'ready',
      path: planPath,
      source: 'plan_file',
      reasonCode: null,
      blockers: [],
      plan,
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return {
      status: 'blocked',
      path: planPath,
      source: 'plan_file',
      reasonCode: 'plan_unreadable',
      blockers: [`plan_unreadable:${detail}`],
      plan: null,
    };
  }
}

function buildSelectorTaskReadiness(
  tasks: Task[],
  manifest: SourceVisualWorkbenchManifest,
): VisualWorkbenchSelectorReadinessTask[] {
  const matchesByTaskId = new Map<string, VisualWorkbenchSelectorReadinessSelection[]>();
  const storyMatchedTaskIds = new Map<string, Set<string>>();
  const taskInputs = tasks.map((task) => selectorTaskInput(task));

  for (const input of taskInputs) {
    if (!input.candidate || input.feedbackItemIds.length === 0) {
      matchesByTaskId.set(input.task.id, []);
      continue;
    }
    const selections = manifest.stories
      .map((story) => selectorSelectionForStory(story, input))
      .filter((selection): selection is VisualWorkbenchSelectorReadinessSelection => !!selection)
      .sort((a, b) => a.storyId.localeCompare(b.storyId));
    matchesByTaskId.set(input.task.id, selections);
    for (const selection of selections) {
      const matchedTaskIds = storyMatchedTaskIds.get(selection.storyId) ?? new Set<string>();
      matchedTaskIds.add(input.task.id);
      storyMatchedTaskIds.set(selection.storyId, matchedTaskIds);
    }
  }

  return taskInputs.map((input) => {
    const blockers: string[] = [];
    const warnings: string[] = [];
    const ambiguities: VisualWorkbenchSelectorReadinessAmbiguity[] = [];
    const selections = matchesByTaskId.get(input.task.id) ?? [];

    if (!input.candidate) {
      return selectorTaskResult(input, 'not_applicable', ['task_not_frontend_or_ux'], warnings, [], []);
    }
    if (input.controllerVerificationTask && selections.length === 0) {
      return selectorTaskResult(input, 'not_applicable', ['controller_verification_task_not_evidence_owner'], warnings, [], []);
    }
    if (input.sourceRepairTask && selections.length === 0) {
      return selectorTaskResult(input, 'not_applicable', ['source_repair_task_not_evidence_owner'], warnings, [], []);
    }
    if (input.feedbackItemIds.length === 0) blockers.push('task_has_no_feedback_item_refs');
    if (input.feedbackItemIds.length > 0 && input.diffItemIds.length === 0) blockers.push('task_has_no_feedback_diff_item_ids');
    if (selections.length === 0) blockers.push('no_story_selection');
    if (selections.length > 0 && input.sourceRepairTask) {
      blockers.push('repair_task_only_story_selection');
    }
    if (selections.length > 0 && input.controllerVerificationTask) {
      blockers.push('controller_verification_task_only_story_selection');
    }

    for (const selection of selections) {
      if (!input.sourceRepairTask && !input.controllerVerificationTask && (!selection.feedbackItemId || !selection.diffItemId)) {
        blockers.push(`ambiguous_task_feedback_ref:${selection.storyId}`);
      }
      const storyTaskIds = storyMatchedTaskIds.get(selection.storyId) ?? new Set<string>();
      if (storyTaskIds.size > 1) {
        blockers.push(`story_matches_multiple_tasks:${selection.storyId}`);
        ambiguities.push(selectorStoryAmbiguity(selection.storyId, storyTaskIds, matchesByTaskId));
      }
      for (const duplicate of duplicateViewportNames(selection.viewports)) {
        blockers.push(`story_viewport_name_duplicate:${selection.storyId}:${duplicate}`);
      }
    }

    return selectorTaskResult(input, blockers.length > 0 ? 'blocked' : 'ready', blockers, warnings, ambiguities, selections);
  });
}

function selectorStoryAmbiguity(
  storyId: string,
  storyTaskIds: Set<string>,
  matchesByTaskId: Map<string, VisualWorkbenchSelectorReadinessSelection[]>,
): VisualWorkbenchSelectorReadinessAmbiguity {
  const matchedTaskIds = [...storyTaskIds].sort((a, b) => a.localeCompare(b));
  return {
    storyId,
    matchedTaskIds,
    matchedSelectorsByTask: matchedTaskIds.map((taskId) => ({
      taskId,
      matchedSelectors: matchesByTaskId.get(taskId)
        ?.find((selection) => selection.storyId === storyId)
        ?.matchedSelectors ?? [],
    })),
  };
}

interface VisualWorkbenchFeedbackRefSelection {
  feedbackItemId: string;
  diffItemId: string | null;
  selectors: string[];
}

function selectorTaskInput(task: Task): {
  task: Task;
  title: string;
  candidate: boolean;
  feedbackItemIds: string[];
  diffItemIds: string[];
  selectorIdentities: string[];
  sourceRepairTask: boolean;
  controllerVerificationTask: boolean;
  feedbackRefSelections: VisualWorkbenchFeedbackRefSelection[];
} {
  const feedbackRefs = task.feedbackItemRefs ?? [];
  const feedbackItemIds = normalizeFeedbackItemIds(feedbackRefs.map((ref) => ref.itemId));
  const diffItemIds = normalizeFeedbackItemIds(feedbackRefs.map((ref) => ref.diffItemId ?? ''));
  const sourceRepairTask = isVisualWorkbenchSourceRepairTask(task);
  const controllerVerificationTask = isGenericControllerVisualVerificationTask(task);
  const feedbackRefSelections = visualWorkbenchFeedbackRefSelections(task.id, feedbackRefs);
  const selectorIdentities = uniqueStrings([
    task.id,
    ...(sourceRepairTask || controllerVerificationTask
      ? []
      : feedbackRefSelections.flatMap((selection) => selection.selectors)),
  ].map((value) => selectorToken(value)));
  const candidate = (task.requiredRolePasses ?? []).includes('ux')
    || feedbackRefs.some((ref) => ref.workSurface === 'frontend');

  return {
    task,
    title: cleanProgressText(getTaskDisplayTitle(task, 400), 400) ?? task.id,
    candidate,
    feedbackItemIds,
    diffItemIds,
    selectorIdentities,
    sourceRepairTask,
    controllerVerificationTask,
    feedbackRefSelections,
  };
}

function visualWorkbenchFeedbackRefSelections(
  taskId: string,
  refs: NonNullable<Task['feedbackItemRefs']>,
): VisualWorkbenchFeedbackRefSelection[] {
  return refs
    .map((ref) => {
      const feedbackItemId = selectorToken(ref.itemId);
      if (!feedbackItemId) return null;
      const diffItemId = selectorToken(ref.diffItemId) || null;
      const selectors = uniqueStrings([
        ref.itemId,
        ref.diffItemId,
        ref.targetId,
        visualWorkbenchCompositeSelectorToken(taskId, ref.itemId),
        visualWorkbenchCompositeSelectorToken(taskId, ref.diffItemId),
        visualWorkbenchCompositeSelectorToken(taskId, ref.targetId),
      ].map((value) => selectorToken(value)));
      return {
        feedbackItemId,
        diffItemId,
        selectors,
      };
    })
    .filter((selection): selection is VisualWorkbenchFeedbackRefSelection => !!selection);
}

function visualWorkbenchCompositeSelectorToken(taskId: string, value: string | undefined): string {
  const token = selectorToken(value);
  return token ? `${selectorToken(taskId)}#${token}` : '';
}

function selectFeedbackRefForMatchedSelectors(
  input: ReturnType<typeof selectorTaskInput>,
  matchedSelectors: string[],
): { feedbackItemId: string; diffItemId: string } | null {
  const matchedRefSelections = input.feedbackRefSelections.filter((selection) => (
    selection.selectors.some((selector) => matchedSelectors.includes(selector))
  ));
  const completeMatches = uniqueFeedbackRefSelections(
    matchedRefSelections.filter((selection) => !!selection.diffItemId),
  );
  if (completeMatches.length === 1) return completeMatches[0];
  if (completeMatches.length > 1) return null;
  if (matchedRefSelections.length > 0) return null;

  if (input.feedbackItemIds.length === 1 && input.diffItemIds.length === 1) {
    return {
      feedbackItemId: input.feedbackItemIds[0],
      diffItemId: input.diffItemIds[0],
    };
  }
  return null;
}

function uniqueFeedbackRefSelections(
  selections: VisualWorkbenchFeedbackRefSelection[],
): Array<{ feedbackItemId: string; diffItemId: string }> {
  const byKey = new Map<string, { feedbackItemId: string; diffItemId: string }>();
  for (const selection of selections) {
    if (!selection.diffItemId) continue;
    byKey.set(`${selection.feedbackItemId}\0${selection.diffItemId}`, {
      feedbackItemId: selection.feedbackItemId,
      diffItemId: selection.diffItemId,
    });
  }
  return [...byKey.values()].sort((left, right) => (
    left.feedbackItemId.localeCompare(right.feedbackItemId)
    || left.diffItemId.localeCompare(right.diffItemId)
  ));
}

function selectorTaskResult(
  input: ReturnType<typeof selectorTaskInput>,
  readiness: VisualWorkbenchSelectorReadinessTask['readiness'],
  blockers: string[],
  warnings: string[],
  ambiguities: VisualWorkbenchSelectorReadinessAmbiguity[],
  selections: VisualWorkbenchSelectorReadinessSelection[],
): VisualWorkbenchSelectorReadinessTask {
  const exportSelections = selections.flatMap((selection) => (
    selection.viewports.map((viewport) => ({
      storyId: selection.storyId,
      viewportName: viewport.name,
      ...(selection.feedbackItemId ? { feedbackItemId: selection.feedbackItemId } : {}),
      ...(selection.diffItemId ? { diffItemId: selection.diffItemId } : {}),
    }))
  ));

  return {
    taskId: input.task.id,
    status: input.task.status,
    title: input.title,
    readiness,
    blockers: uniqueStrings(blockers),
    warnings: uniqueStrings(warnings),
    ambiguities,
    feedbackItemIds: input.feedbackItemIds,
    diffItemIds: input.diffItemIds,
    selectorIdentities: input.selectorIdentities,
    selections,
    exportSelections,
  };
}

function selectorSelectionForStory(
  story: SourceVisualWorkbenchStory,
  input: ReturnType<typeof selectorTaskInput>,
): VisualWorkbenchSelectorReadinessSelection | null {
  const defaultFor = uniqueStrings((story.taskRelevance?.defaultFor ?? []).map((value) => selectorToken(value)));
  if (defaultFor.length === 0) return null;
  const matchedSelectors = defaultFor.filter((selector) => input.selectorIdentities.includes(selector));
  if (matchedSelectors.length === 0) return null;
  const selectedRef = selectFeedbackRefForMatchedSelectors(input, matchedSelectors);

  return {
    storyId: story.id,
    title: story.title,
    kind: story.kind,
    feature: story.feature,
    widget: story.widget,
    state: story.state,
    claim: story.claim,
    matchedSelectors,
    defaultFor,
    ...(selectedRef ? { feedbackItemId: selectedRef.feedbackItemId, diffItemId: selectedRef.diffItemId } : {}),
    viewports: story.viewports.map((viewport) => ({
      name: viewport.name,
      width: viewport.width,
      height: viewport.height,
    })),
  };
}

function duplicateViewportNames(viewports: VisualWorkbenchSelectorReadinessViewport[]): string[] {
  const seen = new Set<string>();
  const duplicates: string[] = [];
  for (const viewport of viewports) {
    if (seen.has(viewport.name)) {
      duplicates.push(viewport.name);
      continue;
    }
    seen.add(viewport.name);
  }
  return uniqueStrings(duplicates);
}

function selectorToken(value: string | undefined): string {
  return typeof value === 'string' ? value.trim() : '';
}

function isVisualWorkbenchSourceRepairTask(task: Task): boolean {
  if (task.addedBy !== 'controller') return false;
  if ((task.displayTitle ?? '').trim() === VISUAL_WORKBENCH_SOURCE_REPAIR_TASK_TITLE) return true;

  const text = [
    task.displayTitle,
    task.description,
    ...task.acceptanceCriteria,
  ].filter(Boolean).join('\n').toLowerCase();
  if (!text.includes('visual workbench') && !text.includes('visual-workbench')) return false;

  return text.includes('source coverage repair')
    || text.includes('repair source-owned visual workbench coverage')
    || text.includes('selector_readiness_blocked')
    || ((text.includes('repair') || text.includes('fix')) && text.includes('selector'));
}

function isGenericControllerVisualVerificationTask(task: Task): boolean {
  if (task.addedBy !== 'controller') return false;
  const title = (task.displayTitle ?? '').trim().toLowerCase();
  if (title === 'verify accepted changes') return true;

  const text = [
    task.displayTitle,
    task.description,
    ...task.acceptanceCriteria,
  ].filter(Boolean).join('\n').toLowerCase();
  return text.includes('verify accepted changes')
    || text.includes('verify frontend accepted changes')
    || text.includes('verify the accepted changes');
}

function normalizeOptionalStableInput(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized || undefined;
}

function normalizePolicyText(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function shellArg(value: string): string {
  if (/^[A-Za-z0-9_./:=@%+-]+$/.test(value)) return value;
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

async function readExistingArenaProgress(progressPath: string): Promise<Record<string, unknown>> {
  if (!await fs.pathExists(progressPath)) {
    return {};
  }

  const value = await fs.readJson(progressPath);
  if (!isPlainRecord(value)) {
    throw new Error(`Arena progress file must be a JSON object before Visual Workbench progress publish: ${progressPath}`);
  }
  return value;
}

async function writeVisualWorkbenchIngestManifest(input: {
  workDir: string;
  status: VisualWorkbenchStatusResult;
}): Promise<VisualWorkbenchIngestManifest> {
  const manifestPath = path.join(input.workDir, VISUAL_WORKBENCH_INGEST_MANIFEST_PATH);
  const existing = await readExistingVisualWorkbenchIngestManifest(manifestPath);
  const currentItems = input.status.tasks
    .flatMap((taskStatus) => taskStatus.sources.map((source) => (
      visualWorkbenchIngestManifestItemForSource(taskStatus.taskId, source)
    )))
    .filter((item): item is VisualWorkbenchIngestManifestItem => !!item);
  const manifest: VisualWorkbenchIngestManifest = {
    schemaVersion: VISUAL_WORKBENCH_INGEST_MANIFEST_SCHEMA_VERSION,
    ownerBoundary: 'ralph.visual-workbench-progress-publish',
    progressJsonPath: '.arena/progress.json',
    items: mergeVisualWorkbenchIngestManifestItems(existing.items, currentItems),
  };

  await fs.ensureDir(path.dirname(manifestPath));
  await fs.writeJson(manifestPath, manifest, { spaces: 2 });
  return manifest;
}

async function readExistingVisualWorkbenchIngestManifest(
  manifestPath: string,
): Promise<VisualWorkbenchIngestManifest> {
  if (!await fs.pathExists(manifestPath)) {
    return emptyVisualWorkbenchIngestManifest();
  }
  try {
    return parseVisualWorkbenchIngestManifest(await fs.readJson(manifestPath));
  } catch {
    return emptyVisualWorkbenchIngestManifest();
  }
}

function parseVisualWorkbenchIngestManifest(value: unknown): VisualWorkbenchIngestManifest {
  if (!isPlainRecord(value) || value.schemaVersion !== VISUAL_WORKBENCH_INGEST_MANIFEST_SCHEMA_VERSION) {
    return emptyVisualWorkbenchIngestManifest();
  }
  const items = Array.isArray(value.items)
    ? value.items
      .map(parseVisualWorkbenchIngestManifestItem)
      .filter((item): item is VisualWorkbenchIngestManifestItem => !!item)
    : [];
  return {
    schemaVersion: VISUAL_WORKBENCH_INGEST_MANIFEST_SCHEMA_VERSION,
    ownerBoundary: 'ralph.visual-workbench-progress-publish',
    progressJsonPath: '.arena/progress.json',
    items,
  };
}

function emptyVisualWorkbenchIngestManifest(): VisualWorkbenchIngestManifest {
  return {
    schemaVersion: VISUAL_WORKBENCH_INGEST_MANIFEST_SCHEMA_VERSION,
    ownerBoundary: 'ralph.visual-workbench-progress-publish',
    progressJsonPath: '.arena/progress.json',
    items: [],
  };
}

function parseVisualWorkbenchIngestManifestItem(value: unknown): VisualWorkbenchIngestManifestItem | null {
  if (!isPlainRecord(value)) return null;
  const taskId = cleanRefText(value.taskId);
  const sourceEvidenceRef = cleanVisualEvidenceRef(value.sourceEvidenceRef);
  const artifactPath = cleanVisualEvidenceArtifactPath(value.artifactPath);
  const artifactSha256 = cleanArtifactDigest(value.artifactSha256);
  const artifactContentType = value.artifactContentType === 'image/png' ? 'image/png' : null;
  if (!taskId || !sourceEvidenceRef || !artifactPath || !artifactSha256 || !artifactContentType) return null;
  return {
    taskId,
    sourceEvidenceRef,
    artifactPath,
    artifactSha256,
    artifactContentType,
  };
}

function visualWorkbenchIngestManifestItemForSource(
  taskId: string,
  source: VisualWorkbenchStatusSource,
): VisualWorkbenchIngestManifestItem | null {
  const cleanTaskId = cleanRefText(taskId);
  const sourceEvidenceRef = cleanVisualEvidenceRef(source.sourceEvidenceRef);
  const artifactPath = cleanVisualEvidenceArtifactPath(source.artifactPath);
  const artifactSha256 = cleanArtifactDigest(source.artifactSha256);
  if (!cleanTaskId || !sourceEvidenceRef || !artifactPath || !artifactSha256) return null;
  return {
    taskId: cleanTaskId,
    sourceEvidenceRef,
    artifactPath,
    artifactSha256,
    artifactContentType: 'image/png',
  };
}

function mergeVisualWorkbenchIngestManifestItems(
  existingItems: VisualWorkbenchIngestManifestItem[],
  currentItems: VisualWorkbenchIngestManifestItem[],
): VisualWorkbenchIngestManifestItem[] {
  const byKey = new Map<string, VisualWorkbenchIngestManifestItem>();
  for (const item of [...existingItems, ...currentItems]) {
    byKey.set(`${item.taskId}\0${item.sourceEvidenceRef}`, item);
  }
  return [...byKey.values()]
    .sort((a, b) => (
      a.taskId.localeCompare(b.taskId)
      || a.sourceEvidenceRef.localeCompare(b.sourceEvidenceRef)
    ));
}

function cleanVisualEvidenceArtifactPath(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const text = value.trim().replace(/\\/g, '/');
  if (!text || text.includes('\0') || path.posix.isAbsolute(text)) return undefined;
  const normalized = path.posix.normalize(text);
  if (
    normalized !== text
    || normalized.startsWith('../')
    || normalized.includes('/../')
    || !normalized.startsWith('.ralph/visual-workbench/')
    || !normalized.endsWith('.png')
  ) {
    return undefined;
  }
  return normalized;
}

function progressVisualEvidenceForStatusSource(source: VisualWorkbenchStatusSource): Record<string, unknown> | null {
  const sourceEvidenceRef = cleanVisualEvidenceRef(source.sourceEvidenceRef);
  const summary = cleanProgressText(source.summary, 1000);
  const feedbackItemIds = safeVisualFeedbackItemIds(source.feedbackItemIds);
  const diffItemIds = safeVisualFeedbackItemIds(source.diffItemIds);
  const target = cleanVisualEvidenceTarget(source.target);
  if (!sourceEvidenceRef || !summary || feedbackItemIds.length === 0 || diffItemIds.length === 0 || !target) return null;

  const artifactSha256 = cleanArtifactDigest(source.artifactSha256);
  const assessments = source.assessments
    .map(progressVisualEvidenceAssessment)
    .filter((row): row is Record<string, unknown> => !!row)
    .slice(0, 20);

  return {
    sourceEvidenceRef,
    sourceKind: 'visual_workbench',
    ...(source.result ? { result: source.result } : {}),
    ...(cleanRefText(source.observedAt) ? { observedAt: cleanRefText(source.observedAt) } : {}),
    summary,
    feedbackItemIds,
    diffItemIds,
    ...(artifactSha256 ? { artifactSha256 } : {}),
    target,
    ...(assessments.length > 0 ? { assessments } : {}),
  };
}

function sanitizeExistingArenaProgressStep(step: Record<string, unknown>): Record<string, unknown> {
  if (!Array.isArray(step.visualEvidence)) return step;
  const visualEvidence = step.visualEvidence
    .filter(isPlainRecord)
    .map((row) => {
      const { artifactPath: _artifactPath, ...rest } = row;
      void _artifactPath;
      return rest;
    })
    .filter((row) => Object.keys(row).length > 0);

  const { visualEvidence: _visualEvidence, ...rest } = step;
  void _visualEvidence;
  return {
    ...rest,
    ...(visualEvidence.length > 0 ? { visualEvidence } : {}),
  };
}

function progressVisualEvidenceAssessment(assessment: VisualWorkbenchStatusAssessment): Record<string, unknown> | null {
  const ref = cleanVisualEvidenceRef(assessment.ref);
  const summary = cleanProgressText(assessment.summary, 1000);
  if (!ref || !summary) return null;

  return {
    ref,
    result: assessment.result,
    ...(cleanRefText(assessment.observedAt) ? { observedAt: cleanRefText(assessment.observedAt) } : {}),
    summary,
    ...(cleanRefText(assessment.recordedBy) ? { recordedBy: cleanRefText(assessment.recordedBy) } : {}),
  };
}

function readArenaProgressState(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  return [
    'planning',
    'coding',
    'testing',
    'deploying',
    'idle',
    'completed',
    'paused_budget',
    'paused_rate_limit',
    'paused_infra',
    'paused_manual',
    'error',
  ].includes(value) ? value : null;
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function cleanProgressText(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null;
  const text = value
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (!text) return null;
  return text.length > maxLength ? `${text.slice(0, maxLength - 3).trim()}...` : text;
}

function cleanRefText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const text = value.trim();
  if (!text || text.length > 160 || !/^[A-Za-z0-9_:\-./]+$/.test(text)) return undefined;
  return text;
}

function cleanVisualEvidenceRef(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const text = value.trim();
  if (!text || text.length > 420 || !/^[A-Za-z0-9._:-]+$/.test(text)) return undefined;
  return text;
}

function cleanArtifactDigest(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const text = value.trim().toLowerCase();
  return /^sha256:[a-f0-9]{64}$/.test(text) ? text : undefined;
}

function safeVisualFeedbackItemIds(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return Array.from(new Set(values
    .map((value) => cleanRefText(value))
    .filter((value): value is string => typeof value === 'string')))
    .slice(0, 20);
}

function safeProgressFeedbackItemRefs(refs: Task['feedbackItemRefs']): Array<{
  itemId?: string;
  diffItemId?: string;
  targetType?: string;
  targetId?: string;
}> {
  if (!Array.isArray(refs)) return [];
  return refs
    .map((ref) => ({
      itemId: cleanRefText(ref.itemId),
      diffItemId: cleanRefText(ref.diffItemId),
      targetType: cleanRefText(ref.targetType),
      targetId: cleanRefText(ref.targetId),
    }))
    .filter((ref) => ref.itemId || ref.diffItemId || ref.targetType || ref.targetId)
    .slice(0, 10);
}

function cleanVisualEvidenceTarget(value: unknown): NonNullable<FeedbackEvidence['target']> | undefined {
  if (!isPlainRecord(value)) return undefined;
  const route = cleanProgressText(value.route, 240);
  if (!route || !route.startsWith('/') || route.includes('\\')) return undefined;

  const viewport = value.viewport;
  if (!isPlainRecord(viewport)) return undefined;
  const width = cleanPositiveViewportInteger(viewport.width);
  const height = cleanPositiveViewportInteger(viewport.height);
  if (!width || !height) return undefined;

  const claim = cleanProgressText(value.claim, 500);
  const state = cleanProgressText(value.state, 500);
  const interaction = cleanProgressText(value.interaction, 500);
  if (!claim && !state && !interaction) return undefined;

  return {
    route,
    viewport: { width, height },
    ...(claim ? { claim } : {}),
    ...(state ? { state } : {}),
    ...(interaction ? { interaction } : {}),
  };
}

function cleanPositiveViewportInteger(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isInteger(value)) return undefined;
  if (value < 1 || value > 10_000) return undefined;
  return value;
}

function parseVisualWorkbenchCaptureRun(raw: unknown): ParsedVisualWorkbenchCaptureRun {
  return VisualWorkbenchCaptureRunResultSchema.parse(raw) as ParsedVisualWorkbenchCaptureRun;
}

function assertCapturedWorkbenchRun(run: ParsedVisualWorkbenchCaptureRun): void {
  if (run.status !== 'captured') {
    throw new Error(`Visual Workbench capture run must be fully captured before evidence export; got ${run.status}.`);
  }
  if (run.workspaceMutationCheck.changed !== false) {
    throw new Error('Visual Workbench capture run must have workspaceMutationCheck.changed=false before evidence export.');
  }
}

function findRequiredStory(run: ParsedVisualWorkbenchCaptureRun, storyId: string): VisualWorkbenchStory {
  const story = run.stories.find((candidate) => candidate.storyId === storyId);
  if (!story) throw new Error(`Visual Workbench capture story not found: ${storyId}`);
  return story;
}

function findRequiredViewport(story: VisualWorkbenchStory, viewportName: string): VisualWorkbenchViewport {
  const viewport = story.viewports.find((candidate) => candidate.name === viewportName);
  if (!viewport) throw new Error(`Visual Workbench capture viewport not found for ${story.storyId}: ${viewportName}`);
  return viewport;
}

function assertCapturedViewport(story: VisualWorkbenchStory, viewport: VisualWorkbenchViewport): void {
  if (viewport.status !== 'captured') {
    throw new Error(`Visual Workbench viewport must be captured before evidence export; got ${story.storyId}/${viewport.name}=${viewport.status}.`);
  }
  if (!viewport.screenshotPath) {
    throw new Error(`Visual Workbench viewport is missing screenshotPath: ${story.storyId}/${viewport.name}.`);
  }
  if (!viewport.screenshotSha256) {
    throw new Error(`Visual Workbench viewport is missing screenshotSha256: ${story.storyId}/${viewport.name}.`);
  }
}

async function adoptWorkbenchScreenshot(input: {
  workDir: string;
  storyId: string;
  viewportName: string;
  sourceScreenshotPath: string;
  screenshotSha256: string;
}): Promise<string> {
  const digest = sha12(input.screenshotSha256);
  const targetPath = path.join(
    input.workDir,
    '.ralph',
    'visual-workbench',
    safePathSegment(input.storyId),
    safePathSegment(input.viewportName),
    `${digest}.png`,
  );
  await fs.ensureDir(path.dirname(targetPath));
  await fs.copyFile(input.sourceScreenshotPath, targetPath);
  return targetPath;
}

function safePathSegment(value: string): string {
  const normalized = value.trim();
  if (!/^[A-Za-z0-9._-]+$/.test(normalized)) {
    throw new Error(`Visual Workbench evidence path segment is not stable: ${value}`);
  }
  return normalized;
}

function buildWorkbenchEvidenceRef(storyId: string, viewportName: string, screenshotSha256: string): string {
  return `visual-workbench-capture:${storyId}:${viewportName}:${sha12(screenshotSha256)}`;
}

function buildWorkbenchEvidenceTarget(story: VisualWorkbenchStory, viewport: VisualWorkbenchViewport): FeedbackEvidence['target'] {
  return {
    route: story.route,
    viewport: {
      width: viewport.width,
      height: viewport.height,
    },
    claim: story.claim,
    state: story.state,
  };
}

function buildEvidenceSummary(story: VisualWorkbenchStory, viewport: VisualWorkbenchViewport): string {
  return `Visual Workbench story ${story.storyId} captured at ${viewport.name}; the visual claim is not verified by this export.`;
}

function findVisualWorkbenchSourceEvidence(task: Task, evidenceRef: string): FeedbackEvidence {
  const matches = (task.verificationEvidence ?? []).filter((row) => row.ref === evidenceRef);
  if (matches.length === 0) {
    throw new Error(`Visual Workbench source evidence not found on task ${task.id}: ${evidenceRef}`);
  }
  if (matches.length > 1) {
    throw new Error(`Visual Workbench source evidence ref is duplicated on task ${task.id}: ${evidenceRef}`);
  }

  const evidence = matches[0];
  if (evidence.kind !== 'screenshot') {
    throw new Error(`Visual Workbench source evidence must be kind=screenshot; got ${evidence.kind}.`);
  }
  if (!evidence.ref.startsWith('visual-workbench-capture:')) {
    throw new Error('Visual Workbench source evidence ref must start with visual-workbench-capture:.');
  }
  if (evidence.taskId !== task.id) {
    throw new Error(`Visual Workbench source evidence taskId must be ${task.id}; got ${evidence.taskId ?? 'undefined'}.`);
  }
  if (evidence.result !== 'inconclusive') {
    throw new Error(`Visual Workbench source evidence must stay inconclusive; got ${evidence.result ?? 'undefined'}.`);
  }
  if (evidence.recordedBy !== 'agent') {
    throw new Error(`Visual Workbench source evidence must be recordedBy=agent; got ${evidence.recordedBy ?? 'undefined'}.`);
  }
  if (evidence.screenshotProof) {
    throw new Error('Visual Workbench assessment source must not be screenshotProof evidence.');
  }
  if (!evidence.artifactPath) {
    throw new Error('Visual Workbench source evidence is missing artifactPath.');
  }
  if (!evidence.artifactSha256) {
    throw new Error('Visual Workbench source evidence is missing artifactSha256.');
  }
  if (!evidence.target) {
    throw new Error('Visual Workbench source evidence is missing target.');
  }
  if ((evidence.feedbackItemIds ?? []).length === 0) {
    throw new Error('Visual Workbench source evidence is missing feedbackItemIds.');
  }
  if ((evidence.diffItemIds ?? []).length === 0) {
    throw new Error('Visual Workbench source evidence is missing diffItemIds.');
  }
  return evidence;
}

function findRequiredTask(planManager: PlanManager, taskId: string): Task {
  const task = planManager.findTask(taskId);
  if (!task) throw new Error(`Task ${taskId} not found.`);
  return task;
}

function parseAssessmentKind(value: string): z.infer<typeof VisualWorkbenchAssessmentKindSchema> {
  if (value !== 'manual_note') {
    throw new Error('Visual Workbench assessment kind must be manual_note; vision_qa requires a structured vision report boundary.');
  }
  return VisualWorkbenchAssessmentKindSchema.parse(value);
}

async function assertScreenshotDigest(screenshotPath: string, expectedDigest: string): Promise<void> {
  if (!/^sha256:[a-f0-9]{64}$/.test(expectedDigest)) {
    throw new Error('Visual Workbench screenshot digest must be sha256:<64 lowercase hex chars>.');
  }
  if (!await fs.pathExists(screenshotPath)) {
    throw new Error(`Visual Workbench screenshot file not found: ${screenshotPath}`);
  }
  const actualDigest = `sha256:${createHash('sha256').update(await fs.readFile(screenshotPath)).digest('hex')}`;
  if (actualDigest !== expectedDigest) {
    throw new Error(`Visual Workbench screenshot digest mismatch: expected ${expectedDigest}, got ${actualDigest}.`);
  }
}

function assertSourceFeedbackLinksStillMatchTask(task: Task, evidence: FeedbackEvidence): void {
  const { feedbackItemIds: taskIds, diffItemIds: taskDiffIds } = taskFeedbackLinkIds(task);
  const evidenceIds = normalizeFeedbackItemIds(evidence.feedbackItemIds ?? []);
  const evidenceDiffIds = normalizeFeedbackItemIds(evidence.diffItemIds ?? []);
  if (taskIds.length === 0) {
    throw new Error(`Task ${task.id} has no feedbackItemRefs; visual workbench assessment cannot invent feedback links.`);
  }
  if (taskDiffIds.length === 0) {
    throw new Error(`Task ${task.id} has no feedbackItemRefs.diffItemId; visual workbench assessment requires accepted diff identity.`);
  }
  if (evidenceIds.length !== 1) {
    throw new Error('Visual Workbench assessment currently requires exactly one feedbackItemId on the source evidence.');
  }
  if (evidenceDiffIds.length !== 1) {
    throw new Error('Visual Workbench assessment currently requires exactly one diffItemId on the source evidence.');
  }
  if (evidenceIds.some((itemId) => !taskIds.includes(itemId))) {
    throw new Error(`Visual Workbench source feedback links no longer match task ${task.id}.`);
  }
  if (evidenceDiffIds.some((diffItemId) => !taskDiffIds.includes(diffItemId))) {
    throw new Error(`Visual Workbench source diff links no longer match task ${task.id}.`);
  }
  if (!taskHasFeedbackDiffPair(task, evidenceIds[0], evidenceDiffIds[0])) {
    throw new Error(`Visual Workbench source feedback/diff pair no longer matches task ${task.id}.`);
  }
}

function resolveTaskFeedbackLinkForEvidenceExport(input: {
  task: Task;
  taskId: string;
  feedbackItemId?: string;
  diffItemId?: string;
}): {
  feedbackItemIds: string[];
  diffItemIds: string[];
} {
  const requestedFeedbackItemId = selectorToken(input.feedbackItemId);
  const requestedDiffItemId = selectorToken(input.diffItemId);
  const refs = input.task.feedbackItemRefs ?? [];

  if (requestedFeedbackItemId || requestedDiffItemId) {
    const matches = refs.filter((ref) => (
      (!requestedFeedbackItemId || ref.itemId === requestedFeedbackItemId)
      && (!requestedDiffItemId || ref.diffItemId === requestedDiffItemId)
    ));
    const selected = uniqueFeedbackRefSelections(visualWorkbenchFeedbackRefSelections(input.taskId, matches));
    if (selected.length === 0) {
      throw new Error(`Selected Visual Workbench feedback/diff ref is not attached to task ${input.taskId}.`);
    }
    if (selected.length !== 1) {
      throw new Error(`Selected Visual Workbench feedback/diff ref is ambiguous on task ${input.taskId}.`);
    }
    return {
      feedbackItemIds: [selected[0].feedbackItemId],
      diffItemIds: [selected[0].diffItemId],
    };
  }

  const { feedbackItemIds, diffItemIds } = taskFeedbackLinkIds(input.task);
  if (feedbackItemIds.length === 0) {
    throw new Error(`Task ${input.taskId} has no feedbackItemRefs; visual workbench evidence export cannot invent feedback links.`);
  }
  if (diffItemIds.length === 0) {
    throw new Error(`Task ${input.taskId} has no feedbackItemRefs.diffItemId; visual workbench evidence export requires accepted diff identity.`);
  }
  if (feedbackItemIds.length !== 1) {
    throw new Error('Visual Workbench evidence export currently requires exactly one feedbackItemId on the target task unless --feedback-item or --diff-item selects an existing task ref.');
  }
  if (diffItemIds.length !== 1) {
    throw new Error('Visual Workbench evidence export currently requires exactly one diffItemId on the target task unless --feedback-item or --diff-item selects an existing task ref.');
  }
  return { feedbackItemIds, diffItemIds };
}

function taskFeedbackLinkIds(task: Task): {
  feedbackItemIds: string[];
  diffItemIds: string[];
} {
  const refs = task.feedbackItemRefs ?? [];
  return {
    feedbackItemIds: normalizeFeedbackItemIds(refs.map((ref) => ref.itemId)),
    diffItemIds: normalizeFeedbackItemIds(refs.map((ref) => ref.diffItemId ?? '')),
  };
}

function taskHasFeedbackDiffPair(task: Task, feedbackItemId: string, diffItemId: string): boolean {
  return (task.feedbackItemRefs ?? []).some((ref) => (
    ref.itemId === feedbackItemId && ref.diffItemId === diffItemId
  ));
}

function normalizeFeedbackItemIds(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim())
    .filter(Boolean))).sort();
}

function normalizeAssessmentText(value: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error('Visual Workbench assessment text is required.');
  }
  if (normalized.length > 2000) {
    throw new Error('Visual Workbench assessment text must be 2000 characters or fewer.');
  }
  return normalized;
}

function buildAssessmentSummary(
  sourceEvidence: FeedbackEvidence,
  result: z.infer<typeof VisualWorkbenchAssessmentResultSchema>,
  assessment: string,
): string {
  return `Manual Visual Workbench assessment (${result}) for ${sourceEvidence.ref}: ${assessment}`;
}

function relativeArtifactPath(workDir: string, screenshotPath: string): string {
  const relativePath = path.relative(workDir, screenshotPath);
  if (!relativePath || relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    throw new Error(`Visual Workbench screenshot artifact must be under workDir: ${workDir}`);
  }
  if (relativePath.split(path.sep).includes('assets') && relativePath.split(path.sep).includes('proof')) {
    throw new Error('Visual Workbench evidence export must not reuse screenshot-proof assets.');
  }
  return relativePath.split(path.sep).join('/');
}

function resolveEvidenceArtifactPath(workDir: string, artifactPath: string): string {
  if (path.isAbsolute(artifactPath)) {
    throw new Error('Visual Workbench assessment artifactPath must be relative to workDir.');
  }
  const absolutePath = path.resolve(workDir, artifactPath);
  const relativePath = path.relative(workDir, absolutePath);
  if (!relativePath || relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    throw new Error(`Visual Workbench assessment artifact must be under workDir: ${workDir}`);
  }
  if (relativePath.split(path.sep).includes('assets') && relativePath.split(path.sep).includes('proof')) {
    throw new Error('Visual Workbench assessment must not reuse screenshot-proof assets.');
  }
  return absolutePath;
}

function sha12(digest: string): string {
  return digest.replace(/^sha256:/, '').slice(0, 12);
}

function buildAssessmentEvidenceRef(
  sourceRef: string,
  kind: z.infer<typeof VisualWorkbenchAssessmentKindSchema>,
  result: z.infer<typeof VisualWorkbenchAssessmentResultSchema>,
  assessment: string,
): string {
  const sourceSuffix = sourceRef.replace(/^visual-workbench-capture:/, '');
  const assessmentDigest = createHash('sha256').update(`${kind}\n${result}\n${assessment}`).digest('hex').slice(0, 12);
  return `visual-workbench-assessment:${kind}:${sourceSuffix}:${assessmentDigest}`;
}

function isVisualWorkbenchSourceRow(row: FeedbackEvidence): boolean {
  return row.kind === 'screenshot' && row.ref.startsWith('visual-workbench-capture:');
}

function isVisualWorkbenchAssessmentRow(row: FeedbackEvidence): boolean {
  return row.sourceEvidenceRef?.startsWith('visual-workbench-capture:') === true
    || row.ref.startsWith('visual-workbench-assessment:');
}

function validateVisualWorkbenchStatusSource(
  task: Task,
  taskFeedbackItemIds: string[],
  taskDiffItemIds: string[],
  row: FeedbackEvidence,
): VisualWorkbenchStatusIssue | null {
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
  const sourceDiffItemIds = normalizeFeedbackItemIds(row.diffItemIds ?? []);
  if (sourceDiffItemIds.length === 0) return statusIssue(task.id, row, 'source_missing_diff_item_ids');
  if (sourceDiffItemIds.some((diffItemId) => !taskDiffItemIds.includes(diffItemId))) {
    return statusIssue(task.id, row, 'source_diff_links_not_on_task');
  }
  return null;
}

function validateVisualWorkbenchStatusAssessment(task: Task, row: FeedbackEvidence): VisualWorkbenchStatusIssue | null {
  if (row.taskId !== task.id) return statusIssue(task.id, row, 'assessment_task_id_mismatch', row.sourceEvidenceRef);
  if (row.screenshotProof) return statusIssue(task.id, row, 'assessment_must_not_be_screenshot_proof', row.sourceEvidenceRef);
  if (row.kind !== 'manual_note') return statusIssue(task.id, row, 'assessment_kind_must_be_manual_note', row.sourceEvidenceRef);
  if (row.recordedBy !== 'manual') return statusIssue(task.id, row, 'assessment_recorded_by_must_be_manual', row.sourceEvidenceRef);
  if (row.result !== 'pass' && row.result !== 'fail' && row.result !== 'inconclusive') {
    return statusIssue(task.id, row, 'assessment_missing_explicit_result', row.sourceEvidenceRef);
  }
  return null;
}

function validateVisualWorkbenchStatusAssessmentMatchesSource(
  task: Task,
  row: FeedbackEvidence,
  source: VisualWorkbenchStatusSource,
): VisualWorkbenchStatusIssue | null {
  if (!sameStringList(normalizeFeedbackItemIds(row.feedbackItemIds ?? []), source.feedbackItemIds)) {
    return statusIssue(task.id, row, 'assessment_feedback_item_ids_do_not_match_source', source.sourceEvidenceRef);
  }
  if (!sameStringList(normalizeFeedbackItemIds(row.diffItemIds ?? []), source.diffItemIds)) {
    return statusIssue(task.id, row, 'assessment_diff_item_ids_do_not_match_source', source.sourceEvidenceRef);
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
  if (!explicit && row.ref.startsWith('visual-workbench-assessment:')) {
    return {
      sourceEvidenceRef: null,
      invalidReason: 'assessment_missing_source_evidence_ref',
    };
  }
  return { sourceEvidenceRef: explicit || null };
}

function visualWorkbenchStatusForAssessments(
  assessments: VisualWorkbenchStatusAssessment[],
): VisualWorkbenchStatusSource['status'] {
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
): VisualWorkbenchStatusIssue {
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
  kind: z.infer<typeof VisualWorkbenchAssessmentKindSchema>,
): string {
  return `visual-workbench-assessment:${kind}:${sourceRef.replace(/^visual-workbench-capture:/, '')}:`;
}

function assertNoConflictingAssessment(
  task: Task,
  sourceRef: string,
  kind: z.infer<typeof VisualWorkbenchAssessmentKindSchema>,
  assessmentEvidenceRef: string,
  result: z.infer<typeof VisualWorkbenchAssessmentResultSchema>,
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

  throw new Error(`Conflicting Visual Workbench assessment already exists for source evidence ${sourceRef}.`);
}
