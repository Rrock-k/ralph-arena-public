import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'fs-extra';
import path from 'path';
import type { Browser } from 'playwright';
import type { RalphConfig } from '../config/types.js';
import {
  getPlatformBrowserReadiness,
  type PlatformBrowserReadinessResult,
} from './browser-readiness.js';
import {
  exportVisualWorkbenchEvidenceFile,
  getVisualWorkbenchSelectorReadinessFile,
  getVisualWorkbenchShellPolicyFile,
  publishVisualWorkbenchProgressFile,
  type VisualWorkbenchEvidenceExportResult,
  type VisualWorkbenchProgressPublishResult,
  type VisualWorkbenchSelectorReadinessAmbiguity,
  type VisualWorkbenchSelectorReadinessResult,
  type VisualWorkbenchShellPolicyResult,
} from './visual-workbench-evidence.js';
import {
  runVisualWorkbenchCapture,
  sanitizeWorkbenchDiagnosticText,
  type VisualWorkbenchCaptureRunResult,
  type VisualWorkbenchStartInput,
  type VisualWorkbenchStartDiagnostics,
  type VisualWorkbenchStartedProcess,
} from './visual-workbench-runner.js';

export const VISUAL_WORKBENCH_AUTOMATION_SCHEMA_VERSION = 'ra-356.visual-workbench-automation.v5' as const;
export const VISUAL_WORKBENCH_AUTOMATION_STATUS_SCHEMA_VERSION = 'ra-356.visual-workbench-automation-status.v1' as const;
export const VISUAL_WORKBENCH_AUTOMATION_OWNER_BOUNDARY = 'ralph.visual-workbench-evidence-automation' as const;
export const VISUAL_WORKBENCH_AUTOMATION_REPORT_FILENAME = 'visual-workbench-automation-run.json' as const;
const AUTOMATION_START_DIAGNOSTIC_TAIL_LIMIT_CHARS = 2_000;
const execFileAsync = promisify(execFile);

const VISUAL_WORKBENCH_AUTOMATION_STATUSES = new Set([
  'blocked',
  'captured',
  'exported',
  'published',
  'setup_failed',
  'capture_failed',
  'export_failed',
  'publish_failed',
]);

type VisualWorkbenchEvidenceAutomationRunStatus =
  | 'blocked'
  | 'captured'
  | 'exported'
  | 'published'
  | 'setup_failed'
  | 'capture_failed'
  | 'export_failed'
  | 'publish_failed';

type VisualWorkbenchEvidenceAutomationSelectorStatus =
  | VisualWorkbenchSelectorReadinessResult['status']
  | 'not_run';

type VisualWorkbenchEvidenceAutomationShellPolicyStatus =
  | VisualWorkbenchShellPolicyResult['status']
  | 'not_run';

type VisualWorkbenchEvidenceAutomationBrowserReadinessStatus =
  | PlatformBrowserReadinessResult['status']
  | 'not_run';

export interface VisualWorkbenchEvidenceAutomationOptions {
  workDir: string;
  taskId: string;
  sourceRef: string;
  baseUrl: string;
  outDir: string;
  ralphConfig: RalphConfig;
  manifestPath: string;
  startTimeoutMs?: number;
  now?: () => Date;
  launchBrowser?: () => Promise<Browser>;
  startWorkbench?: (input: VisualWorkbenchStartInput) => Promise<VisualWorkbenchStartedProcess>;
}

export interface VisualWorkbenchEvidenceAutomationSelection {
  storyId: string;
  viewportName: string;
}

export interface VisualWorkbenchEvidenceAutomationResult {
  schemaVersion: typeof VISUAL_WORKBENCH_AUTOMATION_SCHEMA_VERSION;
  ownerBoundary: typeof VISUAL_WORKBENCH_AUTOMATION_OWNER_BOUNDARY;
  status: VisualWorkbenchEvidenceAutomationRunStatus;
  workDir: string;
  taskId: string;
  sourceRef: string;
  baseUrl: string;
  outDir: string;
  reportPath: string;
  diagnosticReportPath: string;
  manifestPath: string | null;
  setup: {
    status: 'ok' | 'failed';
    errorMessage: string | null;
    reportPathWritten: boolean;
    diagnosticReportPathWritten: boolean;
  };
  selector: {
    schemaVersion: VisualWorkbenchSelectorReadinessResult['schemaVersion'] | null;
    status: VisualWorkbenchEvidenceAutomationSelectorStatus;
    selectedStories: number;
    selectedViewports: number;
    selections: VisualWorkbenchEvidenceAutomationSelection[];
    blockers: string[];
    ambiguities: VisualWorkbenchSelectorReadinessAmbiguity[];
  };
  shellPolicy: {
    schemaVersion: VisualWorkbenchShellPolicyResult['schemaVersion'] | null;
    status: VisualWorkbenchEvidenceAutomationShellPolicyStatus;
    blockers: string[];
  };
  browserReadiness: {
    schemaVersion: PlatformBrowserReadinessResult['schemaVersion'] | null;
    status: VisualWorkbenchEvidenceAutomationBrowserReadinessStatus;
    ownerBoundary: PlatformBrowserReadinessResult['ownerBoundary'] | null;
    provider: PlatformBrowserReadinessResult['provider'] | null;
    executablePath: string | null;
    blockers: string[];
    errorCode: NonNullable<PlatformBrowserReadinessResult['error']>['code'] | null;
    errorMessage: string | null;
  };
  capture: {
    schemaVersion: VisualWorkbenchCaptureRunResult['schemaVersion'] | null;
    status: VisualWorkbenchCaptureRunResult['status'] | null;
    reportPath: string | null;
    viewerPath: string | null;
    capturedStories: number;
    capturedViewports: number;
    blockers: string[];
    errorCode: string | null;
    errorMessage: string | null;
    startDiagnostics: VisualWorkbenchStartDiagnostics | null;
  };
  exports: Array<{
    storyId: string;
    viewportName: string;
    feedbackItemId?: string;
    diffItemId?: string;
    status: VisualWorkbenchEvidenceExportResult['status'] | 'failed';
    evidenceRefs: string[];
    errorMessage: string | null;
  }>;
  publish: {
    schemaVersion: VisualWorkbenchProgressPublishResult['schemaVersion'] | null;
    status: VisualWorkbenchProgressPublishResult['status'] | 'failed' | null;
    progressPath: string | null;
    visualEvidenceRows: number;
    errorMessage: string | null;
  };
  blockers: string[];
  notes: string[];
}

export interface VisualWorkbenchEvidenceAutomationStatusOptions {
  workDir: string;
  taskId?: string;
  reportPath?: string;
}

export interface VisualWorkbenchEvidenceAutomationStatusResult {
  schemaVersion: typeof VISUAL_WORKBENCH_AUTOMATION_STATUS_SCHEMA_VERSION;
  status: 'not_provided' | 'missing' | 'invalid' | 'available';
  workDir: string;
  taskId: string | null;
  reportSource: 'latest' | 'explicit' | null;
  requestedReportPath: string | null;
  resolvedReportPath: string | null;
  diagnosticReportPath: string | null;
  sourceFreshness: VisualWorkbenchEvidenceAutomationSourceFreshness;
  report: VisualWorkbenchEvidenceAutomationResult | null;
  blockers: string[];
  notes: string[];
}

export interface VisualWorkbenchEvidenceAutomationSourceFreshness {
  status: 'not_applicable' | 'current' | 'stale' | 'unknown';
  reportSourceRef: string | null;
  resolvedReportSourceRef: string | null;
  currentHeadRef: string | null;
  unknowns: string[];
  notes: string[];
}

export async function runVisualWorkbenchEvidenceAutomation(
  options: VisualWorkbenchEvidenceAutomationOptions,
): Promise<VisualWorkbenchEvidenceAutomationResult> {
  if (!isAutomationOutDirOutsideWorkDir(options)) {
    return writeAutomationSetupFailureReport(
      options,
      new Error('Visual Workbench automation outDir must resolve outside workDir.'),
      ['automation_out_dir_invalid'],
    );
  }

  let selector: VisualWorkbenchSelectorReadinessResult;
  let shellPolicy: VisualWorkbenchShellPolicyResult;
  try {
    selector = await getVisualWorkbenchSelectorReadinessFile({
      workDir: options.workDir,
      taskId: options.taskId,
      manifestPath: options.manifestPath,
    });
    shellPolicy = await getVisualWorkbenchShellPolicyFile({
      workDir: options.workDir,
      manifestPath: options.manifestPath,
      ralphConfig: options.ralphConfig,
    });
  } catch (error) {
    return writeAutomationSetupFailureReport(options, error, ['automation_setup_readiness_failed']);
  }

  const selections = selector.tasks.flatMap((task) => task.exportSelections);
  const preCaptureBlockers = [
    ...(selector.status !== 'ready' ? ['selector_not_ready'] : []),
    ...selector.tasks.flatMap((task) => task.blockers.map((blocker) => `selector:${blocker}`)),
    ...(selections.length === 0 ? ['selector_has_no_export_selections'] : []),
    ...(shellPolicy.status !== 'allowed' ? ['shell_policy_not_allowed'] : []),
    ...shellPolicy.blockers.map((blocker) => `shell_policy:${blocker}`),
  ];

  if (preCaptureBlockers.length > 0) {
    return writeAutomationReport(automationResult({
      options,
      selector,
      shellPolicy,
      selections,
      status: 'blocked',
      blockers: preCaptureBlockers,
    }));
  }

  const browserReadiness = await getPlatformBrowserReadiness({
    launchBrowser: options.launchBrowser,
  });
  if (browserReadiness.status !== 'ready') {
    return writeAutomationReport(automationResult({
      options,
      selector,
      shellPolicy,
      browserReadiness,
      selections,
      status: 'blocked',
      blockers: browserReadiness.blockers.map((blocker) => `browser_readiness:${blocker}`),
    }));
  }

  const capture = await runVisualWorkbenchCapture({
    workDir: options.workDir,
    manifestPath: options.manifestPath,
    sourceRef: options.sourceRef,
    baseUrl: options.baseUrl,
    outDir: options.outDir,
    ...captureOptionsForSelections(selections),
    startTimeoutMs: options.startTimeoutMs,
    now: options.now,
    launchBrowser: options.launchBrowser,
    startWorkbench: options.startWorkbench,
  });
  if (capture.status !== 'captured') {
    return writeAutomationReport(automationResult({
      options,
      selector,
      shellPolicy,
      browserReadiness,
      selections,
      capture,
      status: 'capture_failed',
      blockers: [`capture_not_captured:${capture.status}`],
    }));
  }

  const exportResults: VisualWorkbenchEvidenceAutomationResult['exports'] = [];
  for (const selection of selections) {
    try {
      const result = await exportVisualWorkbenchEvidenceFile({
        workDir: options.workDir,
        runPath: capture.output.reportPath,
        taskId: options.taskId,
        storyId: selection.storyId,
        viewportName: selection.viewportName,
        feedbackItemId: selection.feedbackItemId,
        diffItemId: selection.diffItemId,
      });
      exportResults.push({
        storyId: selection.storyId,
        viewportName: selection.viewportName,
        ...(selection.feedbackItemId ? { feedbackItemId: selection.feedbackItemId } : {}),
        ...(selection.diffItemId ? { diffItemId: selection.diffItemId } : {}),
        status: result.status,
        evidenceRefs: result.evidenceRefs,
        errorMessage: null,
      });
    } catch (error) {
      exportResults.push({
        storyId: selection.storyId,
        viewportName: selection.viewportName,
        ...(selection.feedbackItemId ? { feedbackItemId: selection.feedbackItemId } : {}),
        ...(selection.diffItemId ? { diffItemId: selection.diffItemId } : {}),
        status: 'failed',
        evidenceRefs: [],
        errorMessage: describeError(error),
      });
      return writeAutomationReport(automationResult({
        options,
        selector,
        shellPolicy,
        browserReadiness,
        selections,
        capture,
        exports: exportResults,
        status: 'export_failed',
        blockers: ['evidence_export_failed'],
      }));
    }
  }

  try {
    const publish = await publishVisualWorkbenchProgressFile({
      workDir: options.workDir,
      taskId: options.taskId,
    });
    return writeAutomationReport(automationResult({
      options,
      selector,
      shellPolicy,
      browserReadiness,
      selections,
      capture,
      exports: exportResults,
      publish,
      status: 'published',
    }));
  } catch (error) {
    return writeAutomationReport(automationResult({
      options,
      selector,
      shellPolicy,
      browserReadiness,
      selections,
      capture,
      exports: exportResults,
      status: 'publish_failed',
      blockers: ['progress_publish_failed'],
      publishErrorMessage: describeError(error),
    }));
  }
}

export function formatVisualWorkbenchEvidenceAutomationResult(
  result: VisualWorkbenchEvidenceAutomationResult,
  compact = false,
): string {
  return `${JSON.stringify(result, null, compact ? 0 : 2)}\n`;
}

export async function getVisualWorkbenchEvidenceAutomationStatusFile(
  options: VisualWorkbenchEvidenceAutomationStatusOptions,
): Promise<VisualWorkbenchEvidenceAutomationStatusResult> {
  const workDir = path.resolve(options.workDir);
  const taskId = options.taskId?.trim() || null;
  const requestedReportPath = options.reportPath?.trim() || null;
  const diagnosticReportPath = taskId
    ? visualWorkbenchAutomationDiagnosticReportPath(workDir, taskId)
    : null;
  const reportSource = requestedReportPath
    ? 'explicit'
    : diagnosticReportPath ? 'latest' : null;
  const resolvedReportPath = requestedReportPath
    ? path.resolve(requestedReportPath)
    : diagnosticReportPath;

  if (!resolvedReportPath) {
    return automationStatusResult({
      workDir,
      taskId,
      reportSource,
      requestedReportPath,
      resolvedReportPath: null,
      diagnosticReportPath,
      status: 'not_provided',
      blockers: ['task_or_report_required'],
      report: null,
    });
  }

  let rawReport: unknown;
  try {
    rawReport = await fs.readJson(resolvedReportPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') {
      return automationStatusResult({
        workDir,
        taskId,
        reportSource,
        requestedReportPath,
        resolvedReportPath,
        diagnosticReportPath,
        status: 'missing',
        blockers: ['automation_report_missing'],
        report: null,
      });
    }
    return automationStatusResult({
      workDir,
      taskId,
      reportSource,
      requestedReportPath,
      resolvedReportPath,
      diagnosticReportPath,
      status: 'invalid',
      blockers: ['automation_report_unreadable'],
      report: null,
    });
  }

  const parsed = parseVisualWorkbenchAutomationReport(rawReport, taskId);
  const report = parsed.blockers.length > 0 ? null : parsed.report;
  const sourceFreshness = await getAutomationReportSourceFreshness(workDir, report);
  return automationStatusResult({
    workDir,
    taskId,
    reportSource,
    requestedReportPath,
    resolvedReportPath,
    diagnosticReportPath,
    status: parsed.blockers.length > 0 ? 'invalid' : 'available',
    blockers: parsed.blockers,
    sourceFreshness,
    report,
  });
}

export function formatVisualWorkbenchEvidenceAutomationStatusResult(
  result: VisualWorkbenchEvidenceAutomationStatusResult,
  compact = false,
): string {
  return `${JSON.stringify(result, null, compact ? 0 : 2)}\n`;
}

function automationResult(input: {
  options: VisualWorkbenchEvidenceAutomationOptions;
  selector: VisualWorkbenchSelectorReadinessResult;
  shellPolicy: VisualWorkbenchShellPolicyResult;
  browserReadiness?: PlatformBrowserReadinessResult;
  selections: VisualWorkbenchEvidenceAutomationSelection[];
  status: VisualWorkbenchEvidenceAutomationResult['status'];
  blockers?: string[];
  capture?: VisualWorkbenchCaptureRunResult;
  exports?: VisualWorkbenchEvidenceAutomationResult['exports'];
  publish?: VisualWorkbenchProgressPublishResult;
  publishErrorMessage?: string;
}): VisualWorkbenchEvidenceAutomationResult {
  const blockers = uniqueStrings(input.blockers ?? []);
  return {
    schemaVersion: VISUAL_WORKBENCH_AUTOMATION_SCHEMA_VERSION,
    ownerBoundary: VISUAL_WORKBENCH_AUTOMATION_OWNER_BOUNDARY,
    status: input.status,
    workDir: input.options.workDir,
    taskId: input.options.taskId,
    sourceRef: input.options.sourceRef,
    baseUrl: input.options.baseUrl,
    outDir: input.options.outDir,
    reportPath: visualWorkbenchAutomationReportPath(input.options.outDir),
    diagnosticReportPath: visualWorkbenchAutomationDiagnosticReportPath(input.options.workDir, input.options.taskId),
    manifestPath: input.options.manifestPath,
    setup: {
      status: 'ok',
      errorMessage: null,
      reportPathWritten: true,
      diagnosticReportPathWritten: true,
    },
    selector: {
      schemaVersion: input.selector.schemaVersion,
      status: input.selector.status,
      selectedStories: input.selector.summary.selectedStories,
      selectedViewports: input.selector.summary.selectedViewports,
      selections: input.selections.map((selection) => ({
        storyId: selection.storyId,
        viewportName: selection.viewportName,
      })),
      blockers: uniqueStrings([
        ...input.selector.manifest.blockers.map((blocker) => `manifest:${blocker}`),
        ...input.selector.plan.blockers.map((blocker) => `plan:${blocker}`),
        ...input.selector.tasks.flatMap((task) => task.blockers.map((blocker) => `task:${task.taskId}:${blocker}`)),
      ]),
      ambiguities: input.selector.tasks.flatMap((task) => task.ambiguities),
    },
    shellPolicy: {
      schemaVersion: input.shellPolicy.schemaVersion,
      status: input.shellPolicy.status,
      blockers: input.shellPolicy.blockers,
    },
    browserReadiness: summarizeBrowserReadiness(input.browserReadiness),
    capture: summarizeCapture(input.capture),
    exports: input.exports ?? [],
    publish: input.publish
      ? {
        schemaVersion: input.publish.schemaVersion,
        status: input.publish.status,
        progressPath: input.publish.progressPath,
        visualEvidenceRows: input.publish.summary.visualEvidenceRows,
        errorMessage: null,
      }
      : {
        schemaVersion: null,
        status: input.publishErrorMessage ? 'failed' : null,
        progressPath: null,
        visualEvidenceRows: 0,
        errorMessage: input.publishErrorMessage ?? null,
      },
    blockers,
    notes: [
      'Visual Workbench evidence automation composes existing selector, shell policy, platform browser readiness, capture, export and progress-publish boundaries.',
      'Platform browser readiness is checked before starting the source-owned Workbench server; INFRA_BROWSER_UNAVAILABLE is platform maintenance, not a project task.',
      'It requires explicit taskId, sourceRef, baseUrl and outDir inputs; it does not infer page screenshots or choose fallback commands.',
      'The automation report is a diagnostic stage artifact only; it is not proof, task status, lifecycle state or Telegram availability.',
      'Captured screenshots are exported as inconclusive task verificationEvidence only; this automation does not assess pass/fail.',
      'This automation does not write screenshotProof, proofReviews, ProjectAsset, blockers, runtime intents, lifecycle state, task status or Telegram availability.',
    ],
  };
}

function automationSetupFailureResult(input: {
  options: VisualWorkbenchEvidenceAutomationOptions;
  error: unknown;
  blockers: string[];
  reportPathWritten: boolean;
  diagnosticReportPathWritten: boolean;
}): VisualWorkbenchEvidenceAutomationResult {
  return {
    schemaVersion: VISUAL_WORKBENCH_AUTOMATION_SCHEMA_VERSION,
    ownerBoundary: VISUAL_WORKBENCH_AUTOMATION_OWNER_BOUNDARY,
    status: 'setup_failed',
    workDir: input.options.workDir,
    taskId: input.options.taskId,
    sourceRef: input.options.sourceRef,
    baseUrl: input.options.baseUrl,
    outDir: input.options.outDir,
    reportPath: visualWorkbenchAutomationReportPath(input.options.outDir),
    diagnosticReportPath: visualWorkbenchAutomationDiagnosticReportPath(input.options.workDir, input.options.taskId),
    manifestPath: input.options.manifestPath,
    setup: {
      status: 'failed',
      errorMessage: describeError(input.error),
      reportPathWritten: input.reportPathWritten,
      diagnosticReportPathWritten: input.diagnosticReportPathWritten,
    },
    selector: {
      schemaVersion: null,
      status: 'not_run',
      selectedStories: 0,
      selectedViewports: 0,
      selections: [],
      blockers: [],
      ambiguities: [],
    },
    shellPolicy: {
      schemaVersion: null,
      status: 'not_run',
      blockers: [],
    },
    browserReadiness: summarizeBrowserReadiness(undefined),
    capture: summarizeCapture(undefined),
    exports: [],
    publish: {
      schemaVersion: null,
      status: null,
      progressPath: null,
      visualEvidenceRows: 0,
      errorMessage: null,
    },
    blockers: uniqueStrings(['automation_setup_failed', ...input.blockers]),
    notes: [
      'Visual Workbench evidence automation setup failed before selector, shell policy, platform browser readiness, capture, export or publish could complete.',
      'This setup failure report is diagnostic only; it is not proof, task status, lifecycle state or Telegram availability.',
      'When the explicit outDir is unsafe, only the Ralph-local diagnostic report is written.',
      'This automation does not write screenshotProof, proofReviews, ProjectAsset, blockers, runtime intents, lifecycle state, task status or Telegram availability.',
    ],
  };
}

function automationStatusResult(input: {
  workDir: string;
  taskId: string | null;
  reportSource: VisualWorkbenchEvidenceAutomationStatusResult['reportSource'];
  requestedReportPath: string | null;
  resolvedReportPath: string | null;
  diagnosticReportPath: string | null;
  status: VisualWorkbenchEvidenceAutomationStatusResult['status'];
  blockers: string[];
  sourceFreshness?: VisualWorkbenchEvidenceAutomationSourceFreshness;
  report: VisualWorkbenchEvidenceAutomationResult | null;
}): VisualWorkbenchEvidenceAutomationStatusResult {
  return {
    schemaVersion: VISUAL_WORKBENCH_AUTOMATION_STATUS_SCHEMA_VERSION,
    status: input.status,
    workDir: input.workDir,
    taskId: input.taskId,
    reportSource: input.reportSource,
    requestedReportPath: input.requestedReportPath,
    resolvedReportPath: input.resolvedReportPath,
    diagnosticReportPath: input.diagnosticReportPath,
    sourceFreshness: input.sourceFreshness ?? notApplicableAutomationSourceFreshness(),
    report: input.report,
    blockers: uniqueStrings(input.blockers),
    notes: [
      'Visual Workbench automation status is a read-only diagnostic readback over a previously written automation report.',
      'sourceFreshness compares report.sourceRef to the current workDir git HEAD only; it does not rerun selector, capture, export or publish.',
      'It does not scan capture directories, infer screenshot proof, publish progress, mutate task status or change lifecycle/Telegram availability.',
    ],
  };
}

async function getAutomationReportSourceFreshness(
  workDir: string,
  report: VisualWorkbenchEvidenceAutomationResult | null,
): Promise<VisualWorkbenchEvidenceAutomationSourceFreshness> {
  if (!report) return notApplicableAutomationSourceFreshness();

  const reportSourceRef = typeof report.sourceRef === 'string' && report.sourceRef.trim().length > 0
    ? report.sourceRef.trim()
    : null;
  if (!reportSourceRef) {
    return automationSourceFreshness({
      status: 'unknown',
      reportSourceRef,
      resolvedReportSourceRef: null,
      currentHeadRef: null,
      unknowns: ['automation_report_source_ref_missing'],
    });
  }
  if (!isImmutableCommitRef(reportSourceRef)) {
    const currentHead = await gitValue(workDir, ['rev-parse', 'HEAD']);
    return automationSourceFreshness({
      status: 'unknown',
      reportSourceRef,
      resolvedReportSourceRef: null,
      currentHeadRef: currentHead.ok ? currentHead.value : null,
      unknowns: [
        'automation_report_source_ref_not_immutable',
        ...(!currentHead.ok ? ['workdir_git_head_unavailable'] : []),
      ],
    });
  }

  const currentHead = await gitValue(workDir, ['rev-parse', 'HEAD']);
  if (!currentHead.ok) {
    return automationSourceFreshness({
      status: 'unknown',
      reportSourceRef,
      resolvedReportSourceRef: null,
      currentHeadRef: null,
      unknowns: ['workdir_git_head_unavailable'],
    });
  }

  const resolvedReportSource = await gitValue(workDir, ['rev-parse', reportSourceRef]);
  if (!resolvedReportSource.ok) {
    return automationSourceFreshness({
      status: 'unknown',
      reportSourceRef,
      resolvedReportSourceRef: null,
      currentHeadRef: currentHead.value,
      unknowns: ['automation_report_source_ref_unresolvable'],
    });
  }

  return automationSourceFreshness({
    status: resolvedReportSource.value === currentHead.value ? 'current' : 'stale',
    reportSourceRef,
    resolvedReportSourceRef: resolvedReportSource.value,
    currentHeadRef: currentHead.value,
    unknowns: [],
  });
}

function automationSourceFreshness(input: {
  status: VisualWorkbenchEvidenceAutomationSourceFreshness['status'];
  reportSourceRef: string | null;
  resolvedReportSourceRef: string | null;
  currentHeadRef: string | null;
  unknowns: string[];
}): VisualWorkbenchEvidenceAutomationSourceFreshness {
  return {
    status: input.status,
    reportSourceRef: input.reportSourceRef,
    resolvedReportSourceRef: input.resolvedReportSourceRef,
    currentHeadRef: input.currentHeadRef,
    unknowns: uniqueStrings(input.unknowns),
    notes: [
      'Freshness is diagnostic only: it compares the saved automation report sourceRef with current workDir HEAD.',
      'A current report is not screenshot proof; a stale report means rerun explicit readiness/capture steps before using it for current-source decisions.',
    ],
  };
}

function notApplicableAutomationSourceFreshness(): VisualWorkbenchEvidenceAutomationSourceFreshness {
  return automationSourceFreshness({
    status: 'not_applicable',
    reportSourceRef: null,
    resolvedReportSourceRef: null,
    currentHeadRef: null,
    unknowns: [],
  });
}

function isImmutableCommitRef(value: string): boolean {
  return /^[0-9a-f]{40}$/.test(value) || /^[0-9a-f]{64}$/.test(value);
}

function parseVisualWorkbenchAutomationReport(
  rawReport: unknown,
  requestedTaskId: string | null,
): {
  report: VisualWorkbenchEvidenceAutomationResult | null;
  blockers: string[];
} {
  const blockers: string[] = [];
  if (!rawReport || typeof rawReport !== 'object' || Array.isArray(rawReport)) {
    return { report: null, blockers: ['automation_report_not_object'] };
  }

  const record = rawReport as Record<string, unknown>;
  if (record.schemaVersion !== VISUAL_WORKBENCH_AUTOMATION_SCHEMA_VERSION) {
    blockers.push('automation_report_schema_unsupported');
  }
  if ('ownerBoundary' in record && record.ownerBoundary !== VISUAL_WORKBENCH_AUTOMATION_OWNER_BOUNDARY) {
    blockers.push('automation_report_owner_boundary_unsupported');
  }
  if (typeof record.status !== 'string' || !VISUAL_WORKBENCH_AUTOMATION_STATUSES.has(record.status)) {
    blockers.push('automation_report_status_unsupported');
  }
  if (typeof record.taskId !== 'string' || record.taskId.trim().length === 0) {
    blockers.push('automation_report_task_missing');
  } else if (requestedTaskId && record.taskId !== requestedTaskId) {
    blockers.push('automation_report_task_mismatch');
  }
  if (typeof record.reportPath !== 'string' || record.reportPath.trim().length === 0) {
    blockers.push('automation_report_path_missing');
  }
  if (typeof record.diagnosticReportPath !== 'string' || record.diagnosticReportPath.trim().length === 0) {
    blockers.push('automation_report_diagnostic_path_missing');
  }
  if (!record.setup || typeof record.setup !== 'object' || Array.isArray(record.setup)) {
    blockers.push('automation_report_setup_missing');
  }
  const selector = record.selector && typeof record.selector === 'object' && !Array.isArray(record.selector)
    ? record.selector as Record<string, unknown>
    : null;
  if (!selector) {
    blockers.push('automation_report_selector_missing');
  } else if ('ambiguities' in selector && !Array.isArray(selector.ambiguities)) {
    blockers.push('automation_report_selector_ambiguities_invalid');
  }
  const capture = record.capture && typeof record.capture === 'object' && !Array.isArray(record.capture)
    ? record.capture as Record<string, unknown>
    : null;
  const startDiagnostics = capture
    ? normalizeAutomationStartDiagnostics(capture.startDiagnostics)
    : { diagnostics: null, blocker: null };
  if (startDiagnostics.blocker) blockers.push(startDiagnostics.blocker);

  return {
    report: blockers.length > 0 ? null : normalizeVisualWorkbenchAutomationReport(record, selector ?? {}, capture, startDiagnostics.diagnostics),
    blockers,
  };
}

function normalizeVisualWorkbenchAutomationReport(
  record: Record<string, unknown>,
  selector: Record<string, unknown>,
  capture: Record<string, unknown> | null,
  startDiagnostics: VisualWorkbenchStartDiagnostics | null,
): VisualWorkbenchEvidenceAutomationResult {
  return {
    ...record,
    ownerBoundary: typeof record.ownerBoundary === 'string'
      ? record.ownerBoundary
      : VISUAL_WORKBENCH_AUTOMATION_OWNER_BOUNDARY,
    selector: {
      ...selector,
      ambiguities: Array.isArray(selector.ambiguities) ? selector.ambiguities : [],
    },
    ...(capture ? {
      capture: {
        ...capture,
        startDiagnostics,
      },
    } : {}),
  } as unknown as VisualWorkbenchEvidenceAutomationResult;
}

function normalizeAutomationStartDiagnostics(value: unknown): {
  diagnostics: VisualWorkbenchStartDiagnostics | null;
  blocker: string | null;
} {
  if (value === undefined || value === null) return { diagnostics: null, blocker: null };
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { diagnostics: null, blocker: 'automation_report_capture_start_diagnostics_invalid' };
  }

  const record = value as Record<string, unknown>;
  const command = readDiagnosticString(record.command);
  const cwd = readDiagnosticString(record.cwd);
  const baseUrl = readDiagnosticString(record.baseUrl);
  const readinessPath = readDiagnosticString(record.readinessPath);
  const timeoutMs = readDiagnosticNumber(record.timeoutMs);
  const elapsedMs = readDiagnosticNumber(record.elapsedMs);
  const exited = typeof record.exited === 'boolean' ? record.exited : null;
  const exitCode = readDiagnosticNullableNumber(record.exitCode);
  const signal = readDiagnosticNullableString(record.signal);
  const errorMessage = readDiagnosticNullableString(record.errorMessage);
  const stdoutTail = readDiagnosticString(record.stdoutTail);
  const stderrTail = readDiagnosticString(record.stderrTail);
  const outputLimitChars = readDiagnosticNumber(record.outputLimitChars);

  if (
    command === null
    || cwd === null
    || baseUrl === null
    || readinessPath === null
    || timeoutMs === null
    || elapsedMs === null
    || exited === null
    || exitCode === undefined
    || signal === undefined
    || errorMessage === undefined
    || stdoutTail === null
    || stderrTail === null
    || outputLimitChars === null
  ) {
    return { diagnostics: null, blocker: 'automation_report_capture_start_diagnostics_invalid' };
  }

  return {
    diagnostics: {
      command,
      cwd,
      baseUrl,
      readinessPath,
      timeoutMs,
      elapsedMs,
      exited,
      exitCode,
      signal,
      errorMessage,
      stdoutTail,
      stderrTail,
      outputLimitChars: Math.min(outputLimitChars, AUTOMATION_START_DIAGNOSTIC_TAIL_LIMIT_CHARS),
    },
    blocker: null,
  };
}

function readDiagnosticString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  return boundedDiagnosticText(value);
}

function readDiagnosticNullableString(value: unknown): string | null | undefined {
  if (value === null) return null;
  if (typeof value !== 'string') return undefined;
  return boundedDiagnosticText(value);
}

function readDiagnosticNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function readDiagnosticNullableNumber(value: unknown): number | null | undefined {
  if (value === null) return null;
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function boundedDiagnosticText(value: string): string {
  const sanitized = sanitizeWorkbenchDiagnosticText(value);
  return sanitized.length > AUTOMATION_START_DIAGNOSTIC_TAIL_LIMIT_CHARS
    ? sanitized.slice(sanitized.length - AUTOMATION_START_DIAGNOSTIC_TAIL_LIMIT_CHARS)
    : sanitized;
}

async function writeAutomationReport(
  result: VisualWorkbenchEvidenceAutomationResult,
): Promise<VisualWorkbenchEvidenceAutomationResult> {
  await fs.ensureDir(path.dirname(result.reportPath));
  await fs.writeJson(result.reportPath, result, { spaces: 2 });
  await writeAutomationDiagnosticReport(result);
  return result;
}

async function writeAutomationSetupFailureReport(
  options: VisualWorkbenchEvidenceAutomationOptions,
  error: unknown,
  blockers: string[],
): Promise<VisualWorkbenchEvidenceAutomationResult> {
  const reportPathSafe = isAutomationOutDirOutsideWorkDir(options);
  const result = automationSetupFailureResult({
    options,
    error,
    blockers,
    reportPathWritten: reportPathSafe,
    diagnosticReportPathWritten: true,
  });
  if (reportPathSafe) {
    await fs.ensureDir(path.dirname(result.reportPath));
    await fs.writeJson(result.reportPath, result, { spaces: 2 });
  }
  await writeAutomationDiagnosticReport(result);
  return result;
}

async function writeAutomationDiagnosticReport(
  result: VisualWorkbenchEvidenceAutomationResult,
): Promise<void> {
  await fs.ensureDir(path.dirname(result.diagnosticReportPath));
  await fs.writeJson(result.diagnosticReportPath, result, { spaces: 2 });
}

function visualWorkbenchAutomationReportPath(outDir: string): string {
  return path.join(path.resolve(outDir), VISUAL_WORKBENCH_AUTOMATION_REPORT_FILENAME);
}

function visualWorkbenchAutomationDiagnosticReportPath(workDir: string, taskId: string): string {
  return path.join(
    path.resolve(workDir),
    '.ralph',
    'visual-workbench',
    'automation-runs',
    safePathSegment(taskId),
    'latest.json',
  );
}

function safePathSegment(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 80) || 'task';
}

function isAutomationOutDirOutsideWorkDir(options: VisualWorkbenchEvidenceAutomationOptions): boolean {
  const workDir = path.resolve(options.workDir);
  const outDir = path.resolve(options.outDir);
  const relative = path.relative(workDir, outDir);
  return Boolean(relative && (relative.startsWith('..') || path.isAbsolute(relative)));
}

async function gitValue(cwd: string, args: string[]): Promise<{ ok: true; value: string } | { ok: false }> {
  try {
    const result = await execFileAsync('git', args, {
      cwd,
      encoding: 'utf8',
      maxBuffer: 1024 * 1024,
      timeout: 5_000,
    });
    const value = result.stdout.trim();
    return value ? { ok: true, value } : { ok: false };
  } catch {
    return { ok: false };
  }
}

function captureOptionsForSelections(selections: VisualWorkbenchEvidenceAutomationSelection[]): {
  selection: 'full_manifest';
} | {
  selection: 'story_viewports';
  storyId: string;
  viewportNames: string[];
} {
  const storyIds = uniqueStrings(selections.map((selection) => selection.storyId));
  if (storyIds.length !== 1) return { selection: 'full_manifest' };
  return {
    selection: 'story_viewports',
    storyId: storyIds[0],
    viewportNames: uniqueStrings(selections.map((selection) => selection.viewportName)),
  };
}

function summarizeCapture(capture: VisualWorkbenchCaptureRunResult | undefined): VisualWorkbenchEvidenceAutomationResult['capture'] {
  if (!capture) {
    return {
      schemaVersion: null,
      status: null,
      reportPath: null,
      viewerPath: null,
      capturedStories: 0,
      capturedViewports: 0,
      blockers: [],
      errorCode: null,
      errorMessage: null,
      startDiagnostics: null,
    };
  }

  return {
    schemaVersion: capture.schemaVersion,
    status: capture.status,
    reportPath: capture.output.reportPath,
    viewerPath: capture.output.viewerPath,
    capturedStories: capture.stories.length,
    capturedViewports: capture.stories.reduce((count, story) => (
      count + story.viewports.filter((viewport) => viewport.status === 'captured').length
    ), 0),
    blockers: capture.manifest.blockers,
    errorCode: capture.error?.code ?? null,
    errorMessage: capture.error?.message ?? null,
    startDiagnostics: capture.workbench.startDiagnostics ?? null,
  };
}

function summarizeBrowserReadiness(
  browserReadiness: PlatformBrowserReadinessResult | undefined,
): VisualWorkbenchEvidenceAutomationResult['browserReadiness'] {
  if (!browserReadiness) {
    return {
      schemaVersion: null,
      status: 'not_run',
      ownerBoundary: null,
      provider: null,
      executablePath: null,
      blockers: [],
      errorCode: null,
      errorMessage: null,
    };
  }

  return {
    schemaVersion: browserReadiness.schemaVersion,
    status: browserReadiness.status,
    ownerBoundary: browserReadiness.ownerBoundary,
    provider: browserReadiness.provider,
    executablePath: browserReadiness.executablePath,
    blockers: browserReadiness.blockers,
    errorCode: browserReadiness.error?.code ?? null,
    errorMessage: browserReadiness.error?.message ?? null,
  };
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean))).sort();
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
