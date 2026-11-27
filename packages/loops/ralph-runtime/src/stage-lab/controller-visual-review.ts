import { dirname, resolve } from 'node:path';
import { z } from 'zod';
import fs from 'fs-extra';
import type { ControllerReport } from '../config/types.js';
import {
  PROMPT_LAB_FIXTURE_SCHEMA_VERSION,
  parsePromptLabFixture,
  renderPromptLabFixture,
  type PromptLabPromptId,
} from '../prompts/prompt-lab.js';
import { parseControllerAgentReport } from '../control/controller-output.js';
import {
  VISUAL_WORKBENCH_CAPTURE_RUN_SCHEMA_VERSION,
  type VisualWorkbenchCaptureRunResult,
} from '../verification/visual-workbench-runner.js';
import {
  assertDisposableStageOutPathAllowed,
  assertPathOutsideLoopTruthDirs,
  assertStageFixturePathAllowed,
  sha256,
} from './stage-io.js';
import type { StageCatalogEntry } from './catalog.js';

export const CONTROLLER_VISUAL_REVIEW_FIXTURE_SCHEMA_VERSION = 'ra-356.controller-visual-review-fixture.v1' as const;
export const CONTROLLER_VISUAL_REVIEW_RESULT_SCHEMA_VERSION = 'ra-356.controller-visual-review-result.v1' as const;

export const CONTROLLER_VISUAL_REVIEW_STAGE_CATALOG_ENTRY: StageCatalogEntry = {
  stageId: 'controller_visual_review',
  status: 'supported_now',
  modes: ['fixture'],
  runSurface: 'stage_run_fixture',
  ownerBoundary: 'ralph.controller.prompt-code-path',
  purpose: 'Render a controller audit prompt fixture and review explicit controller output plus visual evidence without applying controller truth.',
  currentCommand: 'ralph stage run controller_visual_review --fixture <fixture.json> --visual-workbench-capture <visual-workbench-capture-run.json> --out <temp-output.json>',
  fixtureSchemaVersion: CONTROLLER_VISUAL_REVIEW_FIXTURE_SCHEMA_VERSION,
  resultSchemaVersion: CONTROLLER_VISUAL_REVIEW_RESULT_SCHEMA_VERSION,
  promptIds: ['controller.audit'],
  fixtureExamples: [
    'work/plans/ra-356-manual-experiment-tooling/fixtures/controller-visual-review-visual-task.json',
  ],
  allowedMutationSummary: [
    'new explicit temp --out file only',
  ],
  forbiddenMutationSummary: [
    'no model provider call',
    'no Controller.audit() side effects',
    'no .ralph/controller-reports or .ralph/agent-logs write',
    'no plan change apply or judgment write',
    'no task evidence, proof review, ProjectAsset, runtime intent or lifecycle write',
    'no hidden screenshot capture',
    'no next-stage auto-start',
  ],
  handoff: [
    'inspect_controller_prompt_and_report',
    'run_visual_workbench_capture_or_assessment_if_visual_evidence_is_unassessed',
    'run_controller_apply_later_if_selected',
    'discard_experiment_output',
  ],
  notes: [
    'Public result is intentionally reduced, not a live controller report.',
    'Visual Workbench capture reports may be passed as explicit input artifacts and are converted to unassessed visual observations.',
    'Captured screenshots remain inconclusive until explicitly assessed.',
  ],
};

const ControllerTriggerSchema = z.enum([
  'phase_complete',
  'periodic',
  'failure_threshold',
  'replan',
  'manual',
  'final',
  'startup',
  'spec_migration',
]);

const ControllerAgentResultFixtureSchema = z.object({
  success: z.boolean(),
  output: z.string(),
  error: z.object({
    category: z.string().min(1).optional(),
    message: z.string().min(1).optional(),
  }).passthrough().optional(),
}).strict();

const VisualEvidenceObservationSchema = z.object({
  ref: z.string().min(1),
  kind: z.enum([
    'visual_workbench_capture',
    'visual_scenario_run',
    'manual_assessment',
    'screenshot',
    'vision_qa',
  ]),
  result: z.enum(['pass', 'fail', 'inconclusive', 'captured']),
  taskId: z.string().min(1).optional(),
  feedbackItemIds: z.array(z.string().min(1)).default([]),
  summary: z.string().optional(),
}).strict();

const ControllerVisualReviewFixtureSchema = z.object({
  schemaVersion: z.literal(CONTROLLER_VISUAL_REVIEW_FIXTURE_SCHEMA_VERSION),
  name: z.string().min(1).optional(),
  promptVariantRef: z.string().min(1).optional(),
  sourceRef: z.string().min(1).optional(),
  trigger: ControllerTriggerSchema,
  promptFixture: z.unknown(),
  controllerOutput: ControllerAgentResultFixtureSchema,
  visualEvidence: z.array(VisualEvidenceObservationSchema).default([]),
}).strict();

export type ControllerVisualReviewFixture = z.infer<typeof ControllerVisualReviewFixtureSchema>;
type VisualEvidenceObservation = z.infer<typeof VisualEvidenceObservationSchema>;

const VisualWorkbenchCaptureReportSchema = z.object({
  schemaVersion: z.literal(VISUAL_WORKBENCH_CAPTURE_RUN_SCHEMA_VERSION),
  status: z.string().min(1),
  stage: z.object({
    sourceRef: z.string().min(1).optional(),
  }).passthrough().optional(),
  stories: z.array(z.object({
    storyId: z.string().min(1),
    viewports: z.array(z.object({
      name: z.string().min(1),
      status: z.string().min(1),
      error: z.object({
        message: z.string().optional(),
      }).passthrough().nullable().optional(),
    }).passthrough()),
  }).passthrough()),
  error: z.object({
    message: z.string().optional(),
  }).passthrough().nullable().optional(),
}).passthrough();

type ControllerContinuationRecommendation = 'continue' | 'revise' | 'escalate';
type EvidenceVerdict = 'pass' | 'fail' | 'inconclusive' | 'needs_follow_up';

type ControllerRawReportWarning = {
  code: 'runtime_truth_field_returned' | 'feedback_matrix_returned';
  fieldPath: string | null;
  message: string;
};

type VisualReviewWarning = {
  code:
    | 'no_visual_evidence'
    | 'unassessed_visual_evidence'
    | 'continue_without_positive_visual_assessment'
    | 'continue_with_failed_visual_assessment'
    | 'controller_change_observations_not_applied'
    | 'runtime_truth_fields_quarantined';
  message: string;
};

type LoadedVisualWorkbenchCaptureReport = {
  path: string;
  sha256: string;
  report: VisualWorkbenchCaptureRunResult;
};

type VisualWorkbenchCaptureReportSummary = {
  path: string;
  sha256: string;
  status: string;
  sourceRef: string | null;
  storyCount: number;
  viewportCount: number;
  capturedViewportCount: number;
  failedViewportCount: number;
  evidenceRefs: string[];
};

export type ControllerVisualReviewResult = {
  schemaVersion: typeof CONTROLLER_VISUAL_REVIEW_RESULT_SCHEMA_VERSION;
  stage: {
    stageId: 'controller_visual_review';
    mode: 'fixture';
    inputRef: string | null;
    ownerBoundary: 'ralph.controller.prompt-code-path';
    promptVariantRef: string | null;
    sourceRef: string | null;
    allowedMutations: string[];
    forbiddenMutations: string[];
    handoff: string[];
  };
  fixture: {
    schemaVersion: typeof CONTROLLER_VISUAL_REVIEW_FIXTURE_SCHEMA_VERSION;
    name: string | null;
    path: string | null;
  };
  inputArtifacts: {
    visualWorkbenchCaptureReports: VisualWorkbenchCaptureReportSummary[];
  };
  prompt: {
    promptId: PromptLabPromptId;
    renderedSha256: string;
    renderedCharCount: number;
  };
  controllerOutput: {
    success: boolean;
    outputSha256: string;
    outputCharCount: number;
    status: 'parsed' | 'agent_failed' | 'parse_or_validation_failed';
    errorCategory: string | null;
    errorMessage: string | null;
    parseError: string | null;
  };
  controllerObservation: {
    summaryText: string | null;
    continuationRecommendation: ControllerContinuationRecommendation | null;
    changeObservationCount: number;
    changeObservationsByAction: Record<string, number>;
    judgmentObservationCount: number;
    revisionObservationCount: number;
    modelWarningCount: number;
  };
  visualReview: {
    evidenceCount: number;
    evidenceByResult: Record<string, number>;
    positiveEvidenceRefs: string[];
    unassessedEvidenceRefs: string[];
    failedEvidenceRefs: string[];
    evidenceVerdict: EvidenceVerdict;
    weakEvidenceWarnings: VisualReviewWarning[];
    overclaimFindings: string[];
    rawReportWarnings: ControllerRawReportWarning[];
    followUpSuggestions: string[];
  };
  output: {
    resultPath: string | null;
  };
  notes: string[];
};

export async function runControllerVisualReviewFixtureFile(input: {
  fixturePath: string;
  outPath?: string;
  compact?: boolean;
  visualWorkbenchCaptureReportPaths?: string[];
}): Promise<ControllerVisualReviewResult> {
  const fixturePath = resolve(input.fixturePath);
  assertStageFixturePathAllowed(fixturePath, 'controller_visual_review --fixture');
  const fixture = parseControllerVisualReviewFixture(await fs.readJson(fixturePath));
  const visualWorkbenchCaptureReports = await loadVisualWorkbenchCaptureReportFiles(
    input.visualWorkbenchCaptureReportPaths ?? [],
  );
  const outPath = input.outPath ? resolve(input.outPath) : undefined;
  if (outPath) assertDisposableStageOutPathAllowed({
    stageId: 'controller_visual_review',
    outPath,
    fixturePath,
  });

  const result = runControllerVisualReviewFixture({
    fixture,
    fixturePath,
    outPath: outPath ?? null,
    visualWorkbenchCaptureReports,
  });

  if (outPath) {
    await fs.ensureDir(dirname(outPath));
    await fs.writeFile(outPath, formatControllerVisualReviewResult(result, input.compact));
  }

  return result;
}

export function parseControllerVisualReviewFixture(raw: unknown): ControllerVisualReviewFixture {
  return ControllerVisualReviewFixtureSchema.parse(raw);
}

export function runControllerVisualReviewFixture(input: {
  fixture: ControllerVisualReviewFixture;
  fixturePath?: string | null;
  outPath?: string | null;
  visualWorkbenchCaptureReports?: LoadedVisualWorkbenchCaptureReport[];
}): ControllerVisualReviewResult {
  const fixture = input.fixture;
  const visualWorkbenchCaptureReports = input.visualWorkbenchCaptureReports ?? [];
  const derivedVisualEvidence = deriveVisualEvidenceFromCaptureReports(visualWorkbenchCaptureReports);
  const visualEvidence = [
    ...fixture.visualEvidence,
    ...derivedVisualEvidence,
  ];
  const promptFixture = parsePromptLabFixture(fixture.promptFixture);
  if (promptFixture.promptId !== 'controller.audit') {
    throw new Error(`controller_visual_review requires controller.audit fixture, got ${promptFixture.promptId}.`);
  }

  const promptReplay = renderPromptLabFixture({
    fixture: promptFixture,
    fixturePath: input.fixturePath ?? null,
  });
  if (input.fixturePath) assertPathOutsideLoopTruthDirs(input.fixturePath, 'controller_visual_review fixturePath');
  if (input.outPath) assertDisposableStageOutPathAllowed({
    stageId: 'controller_visual_review',
    outPath: input.outPath,
    fixturePath: input.fixturePath,
  });

  const baseResult = {
    schemaVersion: CONTROLLER_VISUAL_REVIEW_RESULT_SCHEMA_VERSION,
    stage: {
      stageId: 'controller_visual_review' as const,
      mode: 'fixture' as const,
      inputRef: input.fixturePath ? resolve(input.fixturePath) : null,
      ownerBoundary: 'ralph.controller.prompt-code-path' as const,
      promptVariantRef: fixture.promptVariantRef ?? null,
      sourceRef: fixture.sourceRef ?? null,
      allowedMutations: input.outPath ? [resolve(input.outPath)] : [],
      forbiddenMutations: [
        '.ralph/plan.json',
        '.ralph/decisions-log.json',
        '.ralph/controller-reports/',
        '.ralph/agent-logs/',
        '.ralph/evidence/',
        '.arena/',
        'task verificationEvidence',
        'proofReviews[]',
        'ProjectAsset',
        'runtime intents',
        'lifecycle state',
      ],
      handoff: [
        'inspect_controller_prompt_and_report',
        'treat_plan_changes_as_observations_until_apply',
        'run_visual_workbench_capture_or_assessment_if_visual_evidence_is_unassessed',
        'run_controller_apply_later_if_selected',
        'discard_experiment_output',
      ],
    },
    fixture: {
      schemaVersion: fixture.schemaVersion,
      name: fixture.name ?? null,
      path: input.fixturePath ? resolve(input.fixturePath) : null,
    },
    inputArtifacts: {
      visualWorkbenchCaptureReports: summarizeVisualWorkbenchCaptureReports(visualWorkbenchCaptureReports),
    },
    prompt: {
      promptId: promptFixture.promptId,
      renderedSha256: `sha256:${sha256(promptReplay.rendered.text)}`,
      renderedCharCount: promptReplay.rendered.charCount,
    },
    output: {
      resultPath: input.outPath ? resolve(input.outPath) : null,
    },
    notes: [
      'controller_visual_review is a fixture-mode stage run, not lifecycle truth.',
      'It renders a repository-owned controller prompt and parses explicit controller output without calling model providers.',
      'It does not apply plan changes, save controller reports, record task evidence, proof reviews, runtime intents or lifecycle state.',
      'It exposes a reduced review summary instead of a live ControllerReport-shaped result.',
      'Visual evidence observations are not closure proof until an explicit assessment/export path records them.',
    ],
  };

  if (!fixture.controllerOutput.success) {
    return {
      ...baseResult,
      controllerOutput: buildControllerOutputSummary(fixture, 'agent_failed', null),
      controllerObservation: emptyControllerObservation(),
      visualReview: buildVisualReviewSummary(visualEvidence, null, []),
    };
  }

  try {
    const parsed = parseControllerAgentReport(fixture.controllerOutput.output, {
      trigger: fixture.trigger as ControllerReport['trigger'],
      reportId: 'controller-visual-review-fixture',
      timestamp: '1970-01-01T00:00:00.000Z',
    });
    const rawReportWarnings = findControllerRawReportWarnings(parsed.rawReport);
    return {
      ...baseResult,
      controllerOutput: buildControllerOutputSummary(fixture, 'parsed', null),
      controllerObservation: summarizeControllerObservation(parsed.report),
      visualReview: buildVisualReviewSummary(visualEvidence, parsed.report, rawReportWarnings),
    };
  } catch (error: any) {
    return {
      ...baseResult,
      controllerOutput: buildControllerOutputSummary(
        fixture,
        'parse_or_validation_failed',
        error instanceof Error ? error.message : String(error),
      ),
      controllerObservation: emptyControllerObservation(),
      visualReview: buildVisualReviewSummary(visualEvidence, null, []),
    };
  }
}

export function formatControllerVisualReviewResult(result: ControllerVisualReviewResult, compact = false): string {
  return `${JSON.stringify(result, null, compact ? 0 : 2)}\n`;
}

function buildControllerOutputSummary(
  fixture: ControllerVisualReviewFixture,
  status: ControllerVisualReviewResult['controllerOutput']['status'],
  parseError: string | null,
): ControllerVisualReviewResult['controllerOutput'] {
  return {
    success: fixture.controllerOutput.success,
    outputSha256: `sha256:${sha256(fixture.controllerOutput.output)}`,
    outputCharCount: fixture.controllerOutput.output.length,
    status,
    errorCategory: fixture.controllerOutput.error?.category ?? null,
    errorMessage: fixture.controllerOutput.error?.message ?? null,
    parseError,
  };
}

function summarizeControllerObservation(report: ControllerReport): ControllerVisualReviewResult['controllerObservation'] {
  return {
    summaryText: report.summary,
    continuationRecommendation: report.verdict,
    changeObservationCount: report.planChanges.length,
    changeObservationsByAction: report.planChanges.reduce<Record<string, number>>((acc, change) => {
      acc[change.action] = (acc[change.action] ?? 0) + 1;
      return acc;
    }, {}),
    judgmentObservationCount: report.newJudgments.length,
    revisionObservationCount: report.revisedJudgments.length,
    modelWarningCount: report.overclaimWarnings?.length ?? 0,
  };
}

function emptyControllerObservation(): ControllerVisualReviewResult['controllerObservation'] {
  return {
    summaryText: null,
    continuationRecommendation: null,
    changeObservationCount: 0,
    changeObservationsByAction: {},
    judgmentObservationCount: 0,
    revisionObservationCount: 0,
    modelWarningCount: 0,
  };
}

function buildVisualReviewSummary(
  evidence: VisualEvidenceObservation[],
  report: ControllerReport | null,
  rawReportWarnings: ControllerRawReportWarning[],
): ControllerVisualReviewResult['visualReview'] {
  const positiveEvidenceRefs = evidence
    .filter((item) => item.result === 'pass')
    .map((item) => item.ref);
  const failedEvidenceRefs = evidence
    .filter((item) => item.result === 'fail')
    .map((item) => item.ref);
  const unassessedEvidenceRefs = evidence
    .filter((item) => item.result === 'captured' || item.result === 'inconclusive')
    .map((item) => item.ref);
  const evidenceByResult = evidence.reduce<Record<string, number>>((acc, item) => {
    acc[item.result] = (acc[item.result] ?? 0) + 1;
    return acc;
  }, {});
  const weakEvidenceWarnings: VisualReviewWarning[] = [];
  const followUpSuggestions: string[] = [];

  if (evidence.length === 0) {
    weakEvidenceWarnings.push({
      code: 'no_visual_evidence',
      message: 'Fixture has no visual evidence observations.',
    });
    followUpSuggestions.push('Run visual_workbench_capture or provide an explicit manual visual assessment before treating the UI task as visually reviewed.');
  }
  if (unassessedEvidenceRefs.length > 0) {
    weakEvidenceWarnings.push({
      code: 'unassessed_visual_evidence',
      message: `Visual evidence is present but not positively assessed: ${unassessedEvidenceRefs.join(', ')}`,
    });
    followUpSuggestions.push('Convert captured screenshots into an explicit pass/fail/inconclusive assessment before export.');
  }
  if (report?.verdict === 'continue' && evidence.length > 0 && positiveEvidenceRefs.length === 0) {
    weakEvidenceWarnings.push({
      code: 'continue_without_positive_visual_assessment',
      message: 'Controller verdict is continue but fixture visual evidence has no positive assessment.',
    });
  }
  if (report?.verdict === 'continue' && failedEvidenceRefs.length > 0) {
    weakEvidenceWarnings.push({
      code: 'continue_with_failed_visual_assessment',
      message: `Controller verdict is continue but failed visual evidence exists: ${failedEvidenceRefs.join(', ')}`,
    });
    followUpSuggestions.push('Re-run the executor or controller path after failed visual evidence is addressed.');
  }
  if ((report?.planChanges.length ?? 0) > 0) {
    weakEvidenceWarnings.push({
      code: 'controller_change_observations_not_applied',
      message: 'Controller fixture output includes plan changes; this stage records them as observations only.',
    });
    followUpSuggestions.push('Use the live controller apply path later if these change observations should update the plan.');
  }
  if (rawReportWarnings.length > 0) {
    weakEvidenceWarnings.push({
      code: 'runtime_truth_fields_quarantined',
      message: 'Controller raw report contained fields that fixture-mode did not apply or treat as truth.',
    });
    followUpSuggestions.push('Inspect quarantined raw fields before trusting the controller output shape.');
  }

  return {
    evidenceCount: evidence.length,
    evidenceByResult,
    positiveEvidenceRefs,
    unassessedEvidenceRefs,
    failedEvidenceRefs,
    evidenceVerdict: classifyEvidenceVerdict({
      positiveEvidenceRefs,
      failedEvidenceRefs,
      unassessedEvidenceRefs,
      rawReportWarnings,
      report,
    }),
    weakEvidenceWarnings,
    overclaimFindings: report?.overclaimWarnings ?? [],
    rawReportWarnings,
    followUpSuggestions,
  };
}

async function loadVisualWorkbenchCaptureReportFiles(
  reportPaths: string[],
): Promise<LoadedVisualWorkbenchCaptureReport[]> {
  const reports: LoadedVisualWorkbenchCaptureReport[] = [];
  for (const reportPathInput of reportPaths) {
    const reportPath = resolve(reportPathInput);
    assertPathOutsideLoopTruthDirs(reportPath, 'controller_visual_review --visual-workbench-capture');
    const raw = await fs.readFile(reportPath, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    const report = parseVisualWorkbenchCaptureReport(parsed, reportPath);
    reports.push({
      path: reportPath,
      sha256: `sha256:${sha256(raw)}`,
      report,
    });
  }
  return reports;
}

function parseVisualWorkbenchCaptureReport(raw: unknown, reportPath: string): VisualWorkbenchCaptureRunResult {
  if (!raw || typeof raw !== 'object') {
    throw new Error(`controller_visual_review --visual-workbench-capture must be a JSON object: ${reportPath}`);
  }
  const record = raw as Record<string, unknown>;
  if (record.schemaVersion !== VISUAL_WORKBENCH_CAPTURE_RUN_SCHEMA_VERSION) {
    throw new Error(`controller_visual_review --visual-workbench-capture has unsupported schemaVersion at ${reportPath}: ${String(record.schemaVersion)}`);
  }
  const parsed = VisualWorkbenchCaptureReportSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`controller_visual_review --visual-workbench-capture has invalid capture report shape at ${reportPath}: ${parsed.error.issues.map((issue) => issue.path.join('.') || issue.message).join(', ')}`);
  }
  return parsed.data as unknown as VisualWorkbenchCaptureRunResult;
}

function summarizeVisualWorkbenchCaptureReports(
  reports: LoadedVisualWorkbenchCaptureReport[],
): VisualWorkbenchCaptureReportSummary[] {
  return reports.map((input) => {
    const viewportCount = input.report.stories.reduce((count, story) => count + story.viewports.length, 0);
    const capturedViewportCount = input.report.stories.reduce((count, story) => (
      count + story.viewports.filter((viewport) => viewport.status === 'captured').length
    ), 0);
    return {
      path: input.path,
      sha256: input.sha256,
      status: input.report.status,
      sourceRef: input.report.stage?.sourceRef ?? null,
      storyCount: input.report.stories.length,
      viewportCount,
      capturedViewportCount,
      failedViewportCount: viewportCount - capturedViewportCount,
      evidenceRefs: deriveVisualEvidenceFromCaptureReport(input).map((evidence) => evidence.ref),
    };
  });
}

function deriveVisualEvidenceFromCaptureReports(
  reports: LoadedVisualWorkbenchCaptureReport[],
): VisualEvidenceObservation[] {
  return reports.flatMap(deriveVisualEvidenceFromCaptureReport);
}

function deriveVisualEvidenceFromCaptureReport(
  input: LoadedVisualWorkbenchCaptureReport,
): VisualEvidenceObservation[] {
  const reportRef = shortReportRef(input.sha256);
  const observations: VisualEvidenceObservation[] = [];
  for (const story of input.report.stories) {
    for (const viewport of story.viewports) {
      observations.push({
        ref: `visual-workbench-capture:${reportRef}:${story.storyId}:${viewport.name}`,
        kind: 'visual_workbench_capture',
        result: viewport.status === 'captured' ? 'captured' : 'inconclusive',
        feedbackItemIds: [],
        summary: viewport.status === 'captured'
          ? `Captured ${story.storyId} at ${viewport.name} viewport.`
          : `Visual Workbench ${story.storyId} at ${viewport.name} ended ${viewport.status}: ${viewport.error?.message ?? 'no screenshot captured'}`,
      });
    }
  }
  if (observations.length === 0) {
    observations.push({
      ref: `visual-workbench-capture:${reportRef}:run`,
      kind: 'visual_workbench_capture',
      result: 'inconclusive',
      feedbackItemIds: [],
      summary: `Visual Workbench capture status ${input.report.status}: ${input.report.error?.message ?? 'no story screenshots captured'}`,
    });
  }
  return observations;
}

function shortReportRef(reportSha256: string): string {
  return reportSha256.replace(/^sha256:/, '').slice(0, 12);
}

function classifyEvidenceVerdict(input: {
  positiveEvidenceRefs: string[];
  failedEvidenceRefs: string[];
  unassessedEvidenceRefs: string[];
  rawReportWarnings: ControllerRawReportWarning[];
  report: ControllerReport | null;
}): EvidenceVerdict {
  if (input.failedEvidenceRefs.length > 0) return 'fail';
  if (!input.report || input.positiveEvidenceRefs.length === 0) return 'inconclusive';
  if (
    input.unassessedEvidenceRefs.length > 0
    || input.rawReportWarnings.length > 0
    || input.report.planChanges.length > 0
    || input.report.verdict !== 'continue'
  ) {
    return 'needs_follow_up';
  }
  return 'pass';
}

function findControllerRawReportWarnings(rawReport: Record<string, unknown>): ControllerRawReportWarning[] {
  const warnings: ControllerRawReportWarning[] = [];
  if ('feedbackMatrix' in rawReport) {
    warnings.push({
      code: 'feedback_matrix_returned',
      fieldPath: 'feedbackMatrix',
      message: 'Controller output returned feedbackMatrix; fixture-mode ignores it because feedback matrix is runtime-owned.',
    });
  }

  const forbiddenPaths = findForbiddenRawFields(rawReport);
  for (const forbiddenPath of forbiddenPaths) {
    warnings.push({
      code: 'runtime_truth_field_returned',
      fieldPath: forbiddenPath,
      message: `Controller output contains proof/lifecycle/truth-shaped field that fixture-mode quarantines: ${forbiddenPath}`,
    });
  }

  return warnings;
}

function findForbiddenRawFields(value: unknown, path: string[] = []): string[] {
  if (!value || typeof value !== 'object') return [];
  const record = value as Record<string, unknown>;
  const forbidden = new Set([
    'verificationEvidence',
    'proofReviews',
    'ProjectAsset',
    'runtimeIntent',
    'runtimeIntents',
    'lifecycleState',
    'proofStatus',
  ]);
  const matches: string[] = [];
  for (const [key, child] of Object.entries(record)) {
    const nextPath = [...path, key];
    if (forbidden.has(key)) matches.push(nextPath.join('.'));
    if (child && typeof child === 'object') {
      if (Array.isArray(child)) {
        child.forEach((item, index) => {
          matches.push(...findForbiddenRawFields(item, [...nextPath, String(index)]));
        });
      } else {
        matches.push(...findForbiddenRawFields(child, nextPath));
      }
    }
  }
  return matches;
}
