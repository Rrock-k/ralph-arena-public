import { createHash } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import fs from 'fs-extra';
import type { Browser } from 'playwright';
import {
  getVisualWorkbenchManifestIssueCodes,
  getVisualWorkbenchManifestIssueDetails,
  isRunnerManagedReplayableDirtyEntry,
  normalizeGitPorcelainStatusCode,
  parseGitPorcelainStatusEntries,
  parseVisualWorkbenchManifest,
  readVisualWorkbenchManifestSchemaVersion,
  summarizeVisualWorkbenchManifest,
  type GitPorcelainStatusEntry,
  VISUAL_WORKBENCH_MANIFEST_PATH,
  VISUAL_WORKBENCH_MANIFEST_SCHEMA_VERSION,
  type VisualWorkbenchManifest,
  type VisualWorkbenchManifestIssueCode,
  type VisualWorkbenchManifestIssueDetail,
  type VisualWorkbenchStory,
  type VisualWorkbenchViewport,
} from '@arena/contracts';
import {
  PLATFORM_BROWSER_UNAVAILABLE,
  formatBrowserUnavailableEvidence,
  isPlaywrightBrowserUnavailable,
} from './browser-readiness.js';
import { captureScreenshotProof } from './screenshot-proof.js';

const execFileAsync = promisify(execFile);

export const VISUAL_WORKBENCH_CAPTURE_RUN_SCHEMA_VERSION = 'ra-355.visual-workbench-capture-run.v0' as const;
export const VISUAL_WORKBENCH_INSPECT_RESULT_SCHEMA_VERSION = 'ra-356.visual-workbench-inspect-result.v0' as const;
export const VISUAL_WORKBENCH_CAPTURE_VIEWER_SCHEMA_VERSION = 'ra-356.visual-workbench-capture-viewer.v1' as const;

export type VisualWorkbenchCaptureSelection = 'full_manifest' | 'story_viewports';
export type VisualWorkbenchCaptureRunFormat = 'json';
export type VisualWorkbenchInspectResultFormat = 'json';
export type VisualWorkbenchStoryCaptureStatus =
  | 'captured'
  | 'navigation_failed'
  | 'browser_unavailable'
  | 'capture_failed';
export type VisualWorkbenchCaptureRunStatus =
  | 'captured'
  | 'partial'
  | 'blocked'
  | 'failed'
  | 'workbench_start_failed'
  | 'workspace_mutation_detected';
export type VisualWorkbenchInspectStatus = 'ready' | 'blocked';
export type VisualWorkbenchInspectBlocker =
  | VisualWorkbenchManifestIssueCode
  | 'manifest_missing'
  | 'manifest_invalid_json'
  | 'source_ref_unavailable';

export interface VisualWorkbenchStartedProcess {
  stop: () => Promise<void>;
}

export interface VisualWorkbenchStartDiagnostics {
  command: string;
  cwd: string;
  baseUrl: string;
  readinessPath: string;
  timeoutMs: number;
  elapsedMs: number;
  exited: boolean;
  exitCode: number | null;
  signal: string | null;
  errorMessage: string | null;
  stdoutTail: string;
  stderrTail: string;
  outputLimitChars: number;
}

export interface VisualWorkbenchStartInput {
  command: string;
  cwd: string;
  baseUrl: string;
  baseUrlEnv: string | null;
  readinessPath: string;
  timeoutMs: number;
}

export interface VisualWorkbenchCaptureRunResult {
  schemaVersion: typeof VISUAL_WORKBENCH_CAPTURE_RUN_SCHEMA_VERSION;
  manifestSchemaVersion: typeof VISUAL_WORKBENCH_MANIFEST_SCHEMA_VERSION | null;
  stage: {
    stageId: 'visual_workbench_capture';
    mode: 'workspace_mutation';
    inputRef: string;
    ownerBoundary: 'ra-355.visual-workbench-capture';
    sourceRef: string;
    selection: VisualWorkbenchCaptureSelection;
    selectionScope: {
      storyId: string | null;
      viewportNames: string[];
    };
    allowedMutations: string[];
    forbiddenMutations: string[];
    handoff: string[];
  };
  workbench: {
    serveCommand: string | null;
    baseUrl: string;
    baseUrlEnv: string | null;
    storyRoutePattern: string | null;
    startDiagnostics: VisualWorkbenchStartDiagnostics | null;
  };
  manifest: {
    path: string;
    sourceRef: string;
    sha256: string | null;
    snapshotPath: string | null;
    summary: ReturnType<typeof summarizeVisualWorkbenchManifest> | null;
    blockers: Array<VisualWorkbenchManifestIssueCode | 'manifest_missing' | 'manifest_invalid_json' | 'source_ref_unavailable' | 'source_ref_mismatch'>;
    issueDetails: VisualWorkbenchManifestIssueDetail[];
  };
  status: VisualWorkbenchCaptureRunStatus;
  capturedAt: string;
  output: {
    directory: string;
    reportPath: string;
    screenshotsDir: string;
    viewerPath: string;
  };
  stories: VisualWorkbenchCapturedStory[];
  workspaceMutationCheck: {
    available: boolean;
    changed: boolean | null;
    beforeStatusPreview: string[];
    afterStatusPreview: string[];
  };
  error: {
    code:
      | 'manifest_missing'
      | 'manifest_invalid_json'
      | 'source_ref_unavailable'
      | 'source_ref_mismatch'
      | 'workspace_dirty'
      | 'workspace_mutation_detected'
      | 'workbench_start_failed'
      | 'selection_invalid'
      | 'selection_story_not_found'
      | 'selection_viewport_not_found'
      | 'artifact_write_failed';
    message: string;
  } | null;
  notes: string[];
}

export interface VisualWorkbenchCaptureViewerResult {
  schemaVersion: typeof VISUAL_WORKBENCH_CAPTURE_VIEWER_SCHEMA_VERSION;
  stage: {
    stageId: 'visual_workbench_capture_viewer';
    mode: 'artifact_write';
    inputRef: string;
    ownerBoundary: 'ra-355.visual-workbench-capture-viewer';
    allowedMutations: string[];
    forbiddenMutations: string[];
  };
  status: 'rendered';
  reportPath: string;
  viewerPath: string;
  notes: string[];
}

export interface VisualWorkbenchInspectResult {
  schemaVersion: typeof VISUAL_WORKBENCH_INSPECT_RESULT_SCHEMA_VERSION;
  manifestSchemaVersion: typeof VISUAL_WORKBENCH_MANIFEST_SCHEMA_VERSION | null;
  stage: {
    stageId: 'visual_workbench_manifest_readiness';
    mode: 'read_only';
    inputRef: string;
    ownerBoundary: 'ra-355.visual-workbench-manifest';
    sourceRef: string;
    allowedMutations: [];
    forbiddenMutations: string[];
    handoff: string[];
  };
  source: {
    workDir: string;
    requestedSourceRef: string;
    resolvedSourceRef: string | null;
    headRef: string | null;
    headMatchesSourceRef: boolean | null;
    remoteFreshnessChecked: false;
  };
  manifest: {
    path: string;
    sourceRef: string;
    sha256: string | null;
    schemaVersion: string | null;
    projectClass: string | null;
    serveCommand: string | null;
    baseUrlEnv: string | null;
    storyRoutePattern: string | null;
    coveragePolicy: {
      mode: string | null;
      selectionDefault: string | null;
      simplificationRequiresEvidence: boolean | null;
    };
    summary: ReturnType<typeof summarizeVisualWorkbenchManifest> | null;
    blockers: VisualWorkbenchInspectBlocker[];
    issueDetails: VisualWorkbenchManifestIssueDetail[];
  };
  status: VisualWorkbenchInspectStatus;
  canRunWorkbenchCapture: boolean;
  recommendedCapture: {
    stageId: 'visual_workbench_capture';
    selection: VisualWorkbenchCaptureSelection;
    sourceRef: string;
    requiresCurrentHeadAtSourceRef: true;
    outputDirRequirement: 'outside_work_dir';
    commandHint: string;
  } | null;
  error: {
    code: 'source_ref_unavailable' | 'manifest_missing' | 'manifest_invalid_json';
    message: string;
  } | null;
  notes: string[];
}

export interface VisualWorkbenchCapturedStory {
  storyId: string;
  title: string;
  kind: VisualWorkbenchStory['kind'];
  feature: string;
  widget: string;
  state: string;
  route: string;
  claim: string;
  viewports: Array<{
    name: string;
    width: number;
    height: number;
    status: VisualWorkbenchStoryCaptureStatus;
    screenshotPath: string | null;
    screenshotSha256: string | null;
    error: {
      code: 'navigation_failed' | typeof PLATFORM_BROWSER_UNAVAILABLE | 'capture_failed';
      message: string;
    } | null;
  }>;
}

export interface VisualWorkbenchCaptureOptions {
  workDir: string;
  manifestPath?: string;
  sourceRef: string;
  baseUrl: string;
  outDir: string;
  selection?: VisualWorkbenchCaptureSelection;
  storyId?: string;
  viewportNames?: string[];
  startTimeoutMs?: number;
  now?: () => Date;
  launchBrowser?: () => Promise<Browser>;
  startWorkbench?: (input: VisualWorkbenchStartInput) => Promise<VisualWorkbenchStartedProcess>;
}

type VisualWorkbenchCaptureError = NonNullable<VisualWorkbenchCaptureRunResult['error']>;

type NormalizedCaptureSelection = {
  selection: VisualWorkbenchCaptureSelection;
  storyId: string | null;
  viewportNames: string[];
  error: VisualWorkbenchCaptureError | null;
};

export interface VisualWorkbenchInspectOptions {
  workDir: string;
  manifestPath?: string;
  sourceRef: string;
}

export async function inspectVisualWorkbenchManifestFile(options: VisualWorkbenchInspectOptions): Promise<VisualWorkbenchInspectResult> {
  return inspectVisualWorkbenchManifest(options);
}

export async function inspectVisualWorkbenchManifest(options: VisualWorkbenchInspectOptions): Promise<VisualWorkbenchInspectResult> {
  const workDir = path.resolve(options.workDir);
  const manifestRelativePath = normalizeManifestRelativePath(workDir, options.manifestPath ?? VISUAL_WORKBENCH_MANIFEST_PATH);
  const requestedSourceRef = options.sourceRef.trim();
  if (!requestedSourceRef) throw new Error('Visual Workbench inspect requires an explicit sourceRef.');

  const resolvedSourceRef = await gitValue(workDir, ['rev-parse', requestedSourceRef]);
  const headRef = await gitValue(workDir, ['rev-parse', 'HEAD']);
  if (!resolvedSourceRef) {
    return baseInspectResult({
      workDir,
      requestedSourceRef,
      resolvedSourceRef: null,
      headRef,
      manifestRelativePath,
      manifestSourceRef: requestedSourceRef,
      status: 'blocked',
      blockers: ['source_ref_unavailable'],
      error: {
        code: 'source_ref_unavailable',
        message: 'Visual Workbench inspect requires a git workspace and a resolvable explicit sourceRef.',
      },
    });
  }

  const rawManifest = await gitRawValue(workDir, ['show', `${resolvedSourceRef}:${manifestRelativePath}`]);
  if (rawManifest == null) {
    return baseInspectResult({
      workDir,
      requestedSourceRef,
      resolvedSourceRef,
      headRef,
      manifestRelativePath,
      manifestSourceRef: resolvedSourceRef,
      status: 'blocked',
      blockers: ['manifest_missing'],
      error: {
        code: 'manifest_missing',
        message: `Visual Workbench manifest is not available at ${resolvedSourceRef}:${manifestRelativePath}.`,
      },
    });
  }

  let rawManifestJson: unknown;
  try {
    rawManifestJson = JSON.parse(rawManifest);
  } catch {
    return baseInspectResult({
      workDir,
      requestedSourceRef,
      resolvedSourceRef,
      headRef,
      manifestRelativePath,
      manifestSourceRef: resolvedSourceRef,
      status: 'blocked',
      blockers: ['manifest_invalid_json'],
      error: {
        code: 'manifest_invalid_json',
        message: `Visual Workbench manifest is not valid JSON at ${resolvedSourceRef}:${manifestRelativePath}.`,
      },
    });
  }

  const manifestIssues = getVisualWorkbenchManifestIssueCodes(rawManifestJson);
  const manifestIssueDetails = getVisualWorkbenchManifestIssueDetails(rawManifestJson);
  if (manifestIssues.length > 0) {
    return baseInspectResult({
      workDir,
      requestedSourceRef,
      resolvedSourceRef,
      headRef,
      manifestRelativePath,
      manifestSourceRef: resolvedSourceRef,
      status: 'blocked',
      blockers: manifestIssues,
      issueDetails: manifestIssueDetails,
      declaredSchemaVersion: readVisualWorkbenchManifestSchemaVersion(rawManifestJson),
      error: null,
    });
  }

  const manifest = parseVisualWorkbenchManifest(rawManifestJson);
  return buildCompletedInspectResult({
    workDir,
    requestedSourceRef,
    resolvedSourceRef,
    headRef,
    manifestRelativePath,
    manifest,
    manifestSha256: sha256Text(rawManifest),
  });
}

export function formatVisualWorkbenchInspectResult(
  result: VisualWorkbenchInspectResult,
  format: VisualWorkbenchInspectResultFormat = 'json',
  compact = false,
): string {
  if (format === 'json') return `${JSON.stringify(result, null, compact ? 0 : 2)}\n`;
  throw new Error(`Unsupported Visual Workbench inspect format: ${format}`);
}

export function formatVisualWorkbenchCaptureViewerResult(
  result: VisualWorkbenchCaptureViewerResult,
  compact = false,
): string {
  return `${JSON.stringify(result, null, compact ? 0 : 2)}\n`;
}

export async function runVisualWorkbenchCaptureFile(options: VisualWorkbenchCaptureOptions): Promise<VisualWorkbenchCaptureRunResult> {
  return runVisualWorkbenchCapture(options);
}

export async function renderVisualWorkbenchCaptureViewerFile(input: { runPath: string }): Promise<VisualWorkbenchCaptureViewerResult> {
  const reportPath = path.resolve(input.runPath);
  const reportDir = path.dirname(reportPath);
  const raw = await fs.readFile(reportPath, 'utf8');
  let parsed: VisualWorkbenchCaptureRunResult;
  try {
    parsed = JSON.parse(raw) as VisualWorkbenchCaptureRunResult;
  } catch {
    throw new Error(`capture_viewer_report_invalid: ${reportPath} is not valid JSON.`);
  }
  if (parsed.schemaVersion !== VISUAL_WORKBENCH_CAPTURE_RUN_SCHEMA_VERSION) {
    throw new Error(`capture_viewer_report_invalid: expected ${VISUAL_WORKBENCH_CAPTURE_RUN_SCHEMA_VERSION}.`);
  }
  if (!parsed.output || !Array.isArray(parsed.stories)) {
    throw new Error('capture_viewer_report_invalid: capture report is missing output or stories.');
  }

  const viewerPath = path.join(reportDir, 'index.html');
  const reportForViewer: VisualWorkbenchCaptureRunResult = {
    ...parsed,
    output: {
      ...parsed.output,
      directory: reportDir,
      reportPath,
      screenshotsDir: parsed.output.screenshotsDir || path.join(reportDir, 'screenshots'),
      viewerPath,
    },
  };
  await fs.writeFile(viewerPath, renderCaptureViewerHtml(reportForViewer), 'utf8');

  return {
    schemaVersion: VISUAL_WORKBENCH_CAPTURE_VIEWER_SCHEMA_VERSION,
    stage: {
      stageId: 'visual_workbench_capture_viewer',
      mode: 'artifact_write',
      inputRef: reportPath,
      ownerBoundary: 'ra-355.visual-workbench-capture-viewer',
      allowedMutations: [viewerPath],
      forbiddenMutations: [
        'source workspace writes',
        'task verificationEvidence',
        'lifecycle state',
        'runtime intents',
        'proof reviews',
        'screenshot capture',
      ],
    },
    status: 'rendered',
    reportPath,
    viewerPath,
    notes: [
      'This viewer is derived from an existing Visual Workbench capture report and screenshots.',
      'It is convenience UI only; the capture report remains the structured artifact.',
      'It does not export task evidence, assess screenshots, publish progress or mutate lifecycle state.',
    ],
  };
}

export async function runVisualWorkbenchCapture(options: VisualWorkbenchCaptureOptions): Promise<VisualWorkbenchCaptureRunResult> {
  const workDir = path.resolve(options.workDir);
  const outDir = path.resolve(options.outDir);
  assertOutputDirOutsideWorkDir({ workDir, outDir });

  const selection = normalizeCaptureSelection({
    selection: options.selection ?? 'full_manifest',
    storyId: options.storyId,
    viewportNames: options.viewportNames ?? [],
  });

  const manifestRelativePath = normalizeManifestRelativePath(workDir, options.manifestPath ?? VISUAL_WORKBENCH_MANIFEST_PATH);
  const baseUrl = normalizeHttpBaseUrl(options.baseUrl);
  const capturedAt = (options.now ?? (() => new Date()))().toISOString();
  const reportPath = path.join(outDir, 'visual-workbench-capture-run.json');
  const screenshotsDir = path.join(outDir, 'screenshots');
  const sourceRef = options.sourceRef.trim();
  if (!sourceRef) throw new Error('Visual Workbench capture requires an explicit sourceRef.');

  await fs.ensureDir(outDir);

  if (selection.error) {
    const result = baseCaptureResult({
      manifestRelativePath,
      sourceRef,
      baseUrl,
      outDir,
      reportPath,
      screenshotsDir,
      capturedAt,
      status: 'blocked',
      manifestBlockers: [],
      error: selection.error,
      selection,
    });
    await writeCaptureReport(reportPath, result);
    return result;
  }

  const sourceResolution = await resolveAndValidateSourceRef({ workDir, sourceRef });
  if (sourceResolution.error) {
    const result = baseCaptureResult({
      manifestRelativePath,
      sourceRef,
      baseUrl,
      outDir,
      reportPath,
      screenshotsDir,
      capturedAt,
      status: 'blocked',
      manifestBlockers: [sourceResolution.error.code],
      error: sourceResolution.error,
      selection,
    });
    await writeCaptureReport(reportPath, result);
    return result;
  }

  const rawManifest = await gitRawValue(workDir, ['show', `${sourceResolution.resolvedSourceRef}:${manifestRelativePath}`]);
  if (rawManifest == null) {
    const result = baseCaptureResult({
      manifestRelativePath,
      sourceRef: sourceResolution.resolvedSourceRef,
      baseUrl,
      outDir,
      reportPath,
      screenshotsDir,
      capturedAt,
      status: 'blocked',
      manifestBlockers: ['manifest_missing'],
      error: {
        code: 'manifest_missing',
        message: `Visual Workbench manifest is not available at ${sourceResolution.resolvedSourceRef}:${manifestRelativePath}.`,
      },
      selection,
    });
    await writeCaptureReport(reportPath, result);
    return result;
  }

  let rawManifestJson: unknown;
  try {
    rawManifestJson = JSON.parse(rawManifest);
  } catch {
    const result = baseCaptureResult({
      manifestRelativePath,
      sourceRef: sourceResolution.resolvedSourceRef,
      baseUrl,
      outDir,
      reportPath,
      screenshotsDir,
      capturedAt,
      status: 'blocked',
      manifestBlockers: ['manifest_invalid_json'],
      error: {
        code: 'manifest_invalid_json',
        message: `Visual Workbench manifest is not valid JSON at ${sourceResolution.resolvedSourceRef}:${manifestRelativePath}.`,
      },
      selection,
    });
    await writeCaptureReport(reportPath, result);
    return result;
  }

  const manifestIssues = getVisualWorkbenchManifestIssueCodes(rawManifestJson);
  const manifestIssueDetails = getVisualWorkbenchManifestIssueDetails(rawManifestJson);
  if (manifestIssues.length > 0) {
    const result = baseCaptureResult({
      manifestRelativePath,
      sourceRef: sourceResolution.resolvedSourceRef,
      baseUrl,
      outDir,
      reportPath,
      screenshotsDir,
      capturedAt,
      status: 'blocked',
      manifestBlockers: manifestIssues,
      manifestIssueDetails,
      error: null,
      selection,
    });
    await writeCaptureReport(reportPath, result);
    return result;
  }

  const manifest = parseVisualWorkbenchManifest(rawManifestJson);
  const manifestSha256 = sha256Text(rawManifest);
  const manifestSnapshotPath = path.join(outDir, 'manifest.snapshot.json');
  await fs.writeFile(manifestSnapshotPath, rawManifest, 'utf8');
  const selectedStories = selectStoriesForCapture(manifest, selection);
  if (selectedStories.error) {
    const result = buildCompletedCaptureResult({
      manifestRelativePath,
      sourceRef: sourceResolution.resolvedSourceRef,
      baseUrl,
      outDir,
      reportPath,
      screenshotsDir,
      capturedAt,
      manifest,
      manifestSha256,
      manifestSnapshotPath,
      stories: [],
      beforeGitStatus: null,
      afterGitStatus: null,
      status: 'blocked',
      error: selectedStories.error,
      selection,
    });
    await writeCaptureReport(reportPath, result);
    return result;
  }

  const beforeWorkspaceStatus = await readGitWorkspaceStatus(workDir);
  if (beforeWorkspaceStatus == null) {
    const result = buildCompletedCaptureResult({
      manifestRelativePath,
      sourceRef: sourceResolution.resolvedSourceRef,
      baseUrl,
      outDir,
      reportPath,
      screenshotsDir,
      capturedAt,
      manifest,
      manifestSha256,
      manifestSnapshotPath,
      stories: [],
      beforeGitStatus: null,
      afterGitStatus: null,
      status: 'blocked',
      error: {
        code: 'source_ref_unavailable',
        message: 'Visual Workbench capture requires git status evidence before starting the workbench.',
      },
      selection,
    });
    await writeCaptureReport(reportPath, result);
    return result;
  }
  const beforeGitStatus = beforeWorkspaceStatus.lines;
  if (beforeWorkspaceStatus.blockingPaths.length > 0) {
    const result = buildCompletedCaptureResult({
      manifestRelativePath,
      sourceRef: sourceResolution.resolvedSourceRef,
      baseUrl,
      outDir,
      reportPath,
      screenshotsDir,
      capturedAt,
      manifest,
      manifestSha256,
      manifestSnapshotPath,
      stories: [],
      beforeGitStatus,
      afterGitStatus: beforeGitStatus,
      status: 'blocked',
      error: {
        code: 'workspace_dirty',
        message: `Visual Workbench capture requires no product-source dirty entries so artifacts match the explicit sourceRef. Blocking paths: ${beforeWorkspaceStatus.blockingPaths.join(', ')}`,
      },
      selection,
    });
    await writeCaptureReport(reportPath, result);
    return result;
  }
  let workbenchProcess: VisualWorkbenchStartedProcess | null = null;
  try {
    workbenchProcess = await (options.startWorkbench ?? startVisualWorkbenchProcess)({
      command: manifest.workbench.serveCommand,
      cwd: workDir,
      baseUrl,
      baseUrlEnv: manifest.workbench.baseUrlEnv ?? null,
      readinessPath: selectedStories.stories[0]?.render.path ?? '/',
      timeoutMs: options.startTimeoutMs ?? 20_000,
    });
  } catch (error) {
    const result = buildCompletedCaptureResult({
      manifestRelativePath,
      sourceRef: sourceResolution.resolvedSourceRef,
      baseUrl,
      outDir,
      reportPath,
      screenshotsDir,
      capturedAt,
      manifest,
      manifestSha256,
      manifestSnapshotPath,
      stories: [],
      beforeGitStatus,
      afterGitStatus: await gitStatus(workDir),
      status: 'workbench_start_failed',
      error: {
        code: 'workbench_start_failed',
        message: error instanceof Error ? error.message : String(error),
      },
      workbenchStartDiagnostics: getWorkbenchStartDiagnostics(error),
      selection,
    });
    await writeCaptureReport(reportPath, result);
    return result;
  }

  let capturedStories: VisualWorkbenchCapturedStory[] = [];
  try {
    capturedStories = await captureManifestStories({
      stories: selectedStories.stories,
      baseUrl,
      screenshotsDir,
      launchBrowser: options.launchBrowser,
    });
  } finally {
    await workbenchProcess.stop();
  }

  const afterGitStatus = await gitStatus(workDir);
  const workspaceMutated = afterGitStatus != null
    && beforeGitStatus.join('\n') !== afterGitStatus.join('\n');
  const result = buildCompletedCaptureResult({
    manifestRelativePath,
    sourceRef: sourceResolution.resolvedSourceRef,
    baseUrl,
    outDir,
    reportPath,
    screenshotsDir,
    capturedAt,
    manifest,
    manifestSha256,
    manifestSnapshotPath,
    stories: capturedStories,
    beforeGitStatus,
    afterGitStatus,
    status: workspaceMutated ? 'workspace_mutation_detected' : captureStatusForStories(capturedStories),
    error: workspaceMutated
      ? {
        code: 'workspace_mutation_detected',
        message: 'Visual Workbench serveCommand changed the project workspace during capture; artifacts are not accepted as clean source-ref capture.',
      }
      : null,
    selection,
  });
  await writeCaptureReport(reportPath, result);
  return result;
}

export function formatVisualWorkbenchCaptureResult(
  result: VisualWorkbenchCaptureRunResult,
  format: VisualWorkbenchCaptureRunFormat = 'json',
  compact = false,
): string {
  if (format === 'json') return `${JSON.stringify(result, null, compact ? 0 : 2)}\n`;
  throw new Error(`Unsupported Visual Workbench capture format: ${format}`);
}

async function captureManifestStories(input: {
  stories: VisualWorkbenchStory[];
  baseUrl: string;
  screenshotsDir: string;
  launchBrowser?: () => Promise<Browser>;
}): Promise<VisualWorkbenchCapturedStory[]> {
  const results: VisualWorkbenchCapturedStory[] = [];
  for (const story of input.stories) {
    const viewports = [];
    for (const viewport of story.viewports) {
      const screenshotPath = path.join(input.screenshotsDir, story.id, `${viewport.name}.png`);
      let status: VisualWorkbenchStoryCaptureStatus = 'captured';
      let screenshotSha256: string | null = null;
      let error: VisualWorkbenchCapturedStory['viewports'][number]['error'] = null;
      try {
        await captureScreenshotProof({
          baseUrl: input.baseUrl,
          target: visualWorkbenchTargetForScreenshot(story, viewport),
          outputPath: screenshotPath,
          launchBrowser: input.launchBrowser,
        });
        screenshotSha256 = await sha256File(screenshotPath);
      } catch (captureError) {
        const classified = classifyCaptureError(captureError);
        status = classified.status;
        error = classified.error;
      }

      viewports.push({
        name: viewport.name,
        width: viewport.width,
        height: viewport.height,
        status,
        screenshotPath: status === 'captured' ? screenshotPath : null,
        screenshotSha256,
        error,
      });
    }

    results.push({
      storyId: story.id,
      title: story.title,
      kind: story.kind,
      feature: story.feature,
      widget: story.widget,
      state: story.state,
      route: story.render.path,
      claim: story.claim,
      viewports,
    });
  }
  return results;
}

function visualWorkbenchTargetForScreenshot(story: VisualWorkbenchStory, viewport: VisualWorkbenchViewport) {
  return {
    route: story.render.path,
    viewport: {
      width: viewport.width,
      height: viewport.height,
    },
    claim: story.claim,
    state: story.state,
    interaction: story.interaction,
    waitAfterLoadMs: story.waitAfterLoadMs,
  };
}

function classifyCaptureError(error: unknown): Pick<VisualWorkbenchCapturedStory['viewports'][number], 'status' | 'error'> {
  if (isPlaywrightBrowserUnavailable(error)) {
    return {
      status: 'browser_unavailable',
      error: {
        code: PLATFORM_BROWSER_UNAVAILABLE,
        message: formatBrowserUnavailableEvidence(error),
      },
    };
  }

  const message = error instanceof Error ? error.message : String(error);
  const navigationMatch = message.match(/HTTP ([^ ]+)/i);
  if (navigationMatch) {
    return {
      status: 'navigation_failed',
      error: {
        code: 'navigation_failed',
        message: `Workbench story target returned HTTP ${navigationMatch[1]}.`,
      },
    };
  }

  return {
    status: 'capture_failed',
    error: {
      code: 'capture_failed',
      message,
    },
  };
}

async function startVisualWorkbenchProcess(input: VisualWorkbenchStartInput): Promise<VisualWorkbenchStartedProcess> {
  const startedAt = Date.now();
  const env = {
    ...process.env,
    ...(input.baseUrlEnv ? { [input.baseUrlEnv]: input.baseUrl } : {}),
  };
  const child = spawn(input.command, {
    cwd: input.cwd,
    env,
    shell: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const exitState = trackChildExit(child);
  const output = trackChildOutput(child, WORKBENCH_OUTPUT_TAIL_LIMIT_CHARS);
  try {
    await waitForWorkbenchReachable({
      baseUrl: input.baseUrl,
      readinessPath: input.readinessPath,
      timeoutMs: input.timeoutMs,
      childExitState: exitState,
    });
  } catch (error) {
    await stopVisualWorkbenchChild(child, exitState);
    throw attachWorkbenchStartDiagnostics(error, {
      input,
      exitState,
      output,
      elapsedMs: Date.now() - startedAt,
    });
  }
  return {
    stop: async () => {
      await stopVisualWorkbenchChild(child, exitState);
    },
  };
}

const WORKBENCH_OUTPUT_TAIL_LIMIT_CHARS = 2_000;

function trackChildOutput(child: ChildProcess, limitChars: number) {
  const state = {
    stdoutTail: '',
    stderrTail: '',
  };
  child.stdout?.setEncoding('utf8');
  child.stderr?.setEncoding('utf8');
  child.stdout?.on('data', (chunk) => {
    state.stdoutTail = appendTail(state.stdoutTail, String(chunk), limitChars);
  });
  child.stderr?.on('data', (chunk) => {
    state.stderrTail = appendTail(state.stderrTail, String(chunk), limitChars);
  });
  return state;
}

function appendTail(current: string, next: string, limitChars: number): string {
  const value = sanitizeWorkbenchDiagnosticText(current + next);
  return value.length > limitChars ? value.slice(value.length - limitChars) : value;
}

export function sanitizeWorkbenchDiagnosticText(value: string): string {
  return value
    .replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, '$1<redacted>')
    .replace(/((?:api[_-]?key|token|secret|password|passwd|oauth[_-]?token)\s*[:=]\s*)["']?[^"'\s&]+/gi, '$1<redacted>')
    .replace(/([?&](?:token|access_token|refresh_token|api_key|key|secret|password)=)[^&\s]+/gi, '$1<redacted>');
}

function attachWorkbenchStartDiagnostics(
  error: unknown,
  input: {
    input: VisualWorkbenchStartInput;
    exitState: ReturnType<typeof trackChildExit>;
    output: ReturnType<typeof trackChildOutput>;
    elapsedMs: number;
  },
): Error {
  const wrapped = error instanceof Error ? error : new Error(String(error));
  (wrapped as Error & { workbenchStartDiagnostics?: VisualWorkbenchStartDiagnostics }).workbenchStartDiagnostics = {
    command: sanitizeWorkbenchDiagnosticText(input.input.command),
    cwd: input.input.cwd,
    baseUrl: input.input.baseUrl,
    readinessPath: input.input.readinessPath,
    timeoutMs: input.input.timeoutMs,
    elapsedMs: input.elapsedMs,
    exited: input.exitState.exited,
    exitCode: input.exitState.code,
    signal: input.exitState.signal,
    errorMessage: input.exitState.error?.message
      ? sanitizeWorkbenchDiagnosticText(input.exitState.error.message)
      : null,
    stdoutTail: input.output.stdoutTail,
    stderrTail: input.output.stderrTail,
    outputLimitChars: WORKBENCH_OUTPUT_TAIL_LIMIT_CHARS,
  };
  return wrapped;
}

function getWorkbenchStartDiagnostics(error: unknown): VisualWorkbenchStartDiagnostics | null {
  if (!error || typeof error !== 'object') return null;
  const diagnostics = (error as { workbenchStartDiagnostics?: unknown }).workbenchStartDiagnostics;
  if (!diagnostics || typeof diagnostics !== 'object') return null;
  return diagnostics as VisualWorkbenchStartDiagnostics;
}

async function stopVisualWorkbenchChild(
  child: ChildProcess,
  exitState: ReturnType<typeof trackChildExit>,
): Promise<void> {
  if (exitState.exited) return;
  child.kill('SIGTERM');
  await Promise.race([
    exitState.done.catch(() => undefined),
    sleep(2_000).then(() => {
      if (!exitState.exited) child.kill('SIGKILL');
    }),
  ]);
}

function trackChildExit(child: ChildProcess) {
  const state = {
    exited: false,
    code: null as number | null,
    signal: null as NodeJS.Signals | null,
    error: null as Error | null,
    done: Promise.resolve(undefined) as Promise<void>,
  };
  state.done = new Promise((resolve) => {
    child.once('error', (error) => {
      state.exited = true;
      state.error = error;
      resolve();
    });
    child.once('exit', (code, signal) => {
      state.exited = true;
      state.code = code;
      state.signal = signal;
      resolve();
    });
  });
  return state;
}

async function waitForWorkbenchReachable(input: {
  baseUrl: string;
  readinessPath: string;
  timeoutMs: number;
  childExitState: ReturnType<typeof trackChildExit>;
}): Promise<void> {
  const deadline = Date.now() + input.timeoutMs;
  const url = new URL(input.readinessPath, input.baseUrl).toString();
  while (Date.now() < deadline) {
    if (input.childExitState.exited) {
      throw new Error(`Workbench command exited before becoming reachable (code=${input.childExitState.code ?? 'unknown'} signal=${input.childExitState.signal ?? 'none'}).`);
    }
    try {
      await fetchWithShortTimeout(url, 1_000);
      return;
    } catch {
      await sleep(250);
    }
  }
  throw new Error(`Workbench did not become reachable at ${url} within ${input.timeoutMs}ms.`);
}

async function fetchWithShortTimeout(url: string, timeoutMs: number): Promise<void> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function baseCaptureResult(input: {
  manifestRelativePath: string;
  sourceRef: string;
  baseUrl: string;
  outDir: string;
  reportPath: string;
  screenshotsDir: string;
  capturedAt: string;
  status: VisualWorkbenchCaptureRunStatus;
  manifestBlockers: VisualWorkbenchCaptureRunResult['manifest']['blockers'];
  manifestIssueDetails?: VisualWorkbenchManifestIssueDetail[];
  error: VisualWorkbenchCaptureRunResult['error'];
  selection: NormalizedCaptureSelection;
}): VisualWorkbenchCaptureRunResult {
  return {
    schemaVersion: VISUAL_WORKBENCH_CAPTURE_RUN_SCHEMA_VERSION,
    manifestSchemaVersion: null,
    stage: stageEnvelope({
      inputRef: input.manifestRelativePath,
      sourceRef: input.sourceRef,
      outDir: input.outDir,
      selection: input.selection,
    }),
    workbench: {
      serveCommand: null,
      baseUrl: input.baseUrl,
      baseUrlEnv: null,
      storyRoutePattern: null,
      startDiagnostics: null,
    },
    manifest: {
      path: input.manifestRelativePath,
      sourceRef: input.sourceRef,
      sha256: null,
      snapshotPath: null,
      summary: null,
      blockers: input.manifestBlockers,
      issueDetails: input.manifestIssueDetails ?? [],
    },
    status: input.status,
    capturedAt: input.capturedAt,
    output: {
      directory: input.outDir,
      reportPath: input.reportPath,
      screenshotsDir: input.screenshotsDir,
      viewerPath: path.join(input.outDir, 'index.html'),
    },
    stories: [],
    workspaceMutationCheck: {
      available: false,
      changed: null,
      beforeStatusPreview: [],
      afterStatusPreview: [],
    },
    error: input.error,
    notes: baseCaptureNotes(),
  };
}

function buildCompletedCaptureResult(input: {
  manifestRelativePath: string;
  sourceRef: string;
  baseUrl: string;
  outDir: string;
  reportPath: string;
  screenshotsDir: string;
  capturedAt: string;
  manifest: VisualWorkbenchManifest;
  manifestSha256: string;
  manifestSnapshotPath: string;
  stories: VisualWorkbenchCapturedStory[];
  beforeGitStatus: string[] | null;
  afterGitStatus: string[] | null;
  status: VisualWorkbenchCaptureRunStatus;
  error: VisualWorkbenchCaptureRunResult['error'];
  workbenchStartDiagnostics?: VisualWorkbenchStartDiagnostics | null;
  selection: NormalizedCaptureSelection;
}): VisualWorkbenchCaptureRunResult {
  return {
    schemaVersion: VISUAL_WORKBENCH_CAPTURE_RUN_SCHEMA_VERSION,
    manifestSchemaVersion: VISUAL_WORKBENCH_MANIFEST_SCHEMA_VERSION,
    stage: stageEnvelope({
      inputRef: input.manifestRelativePath,
      sourceRef: input.sourceRef,
      outDir: input.outDir,
      selection: input.selection,
    }),
    workbench: {
      serveCommand: input.manifest.workbench.serveCommand,
      baseUrl: input.baseUrl,
      baseUrlEnv: input.manifest.workbench.baseUrlEnv ?? null,
      storyRoutePattern: input.manifest.workbench.storyRoutePattern,
      startDiagnostics: input.workbenchStartDiagnostics ?? null,
    },
    manifest: {
      path: input.manifestRelativePath,
      sourceRef: input.sourceRef,
      sha256: input.manifestSha256,
      snapshotPath: input.manifestSnapshotPath,
      summary: summarizeVisualWorkbenchManifest(input.manifest),
      blockers: [],
      issueDetails: [],
    },
    status: input.status,
    capturedAt: input.capturedAt,
    output: {
      directory: input.outDir,
      reportPath: input.reportPath,
      screenshotsDir: input.screenshotsDir,
      viewerPath: path.join(input.outDir, 'index.html'),
    },
    stories: input.stories,
    workspaceMutationCheck: {
      available: input.beforeGitStatus != null && input.afterGitStatus != null,
      changed: input.beforeGitStatus != null && input.afterGitStatus != null
        ? input.beforeGitStatus.join('\n') !== input.afterGitStatus.join('\n')
        : null,
      beforeStatusPreview: input.beforeGitStatus?.slice(0, 20) ?? [],
      afterStatusPreview: input.afterGitStatus?.slice(0, 20) ?? [],
    },
    error: input.error,
    notes: baseCaptureNotes(),
  };
}

function stageEnvelope(input: {
  inputRef: string;
  sourceRef: string;
  outDir: string;
  selection: NormalizedCaptureSelection;
}): VisualWorkbenchCaptureRunResult['stage'] {
  return {
    stageId: 'visual_workbench_capture',
    mode: 'workspace_mutation',
    inputRef: input.inputRef,
    ownerBoundary: 'ra-355.visual-workbench-capture',
    sourceRef: input.sourceRef,
    selection: input.selection.selection,
    selectionScope: {
      storyId: input.selection.storyId,
      viewportNames: input.selection.viewportNames,
    },
    allowedMutations: [input.outDir],
    forbiddenMutations: [
      '.ralph/plan.json',
      'task verificationEvidence',
      'proofReviews[]',
      'ProjectAsset',
      'blockers',
      'runtime intents',
      'lifecycle state',
    ],
    handoff: [
      'inspect_visual_workbench_artifacts',
      'fix_manifest_or_story_and_rerun',
      'run_explicit_evidence_export_later_if_needed',
      'run_controller_visual_review_later_if_needed',
    ],
  };
}

function baseInspectResult(input: {
  workDir: string;
  requestedSourceRef: string;
  resolvedSourceRef: string | null;
  headRef: string | null;
  manifestRelativePath: string;
  manifestSourceRef: string;
  status: VisualWorkbenchInspectStatus;
  blockers: VisualWorkbenchInspectBlocker[];
  issueDetails?: VisualWorkbenchManifestIssueDetail[];
  error: VisualWorkbenchInspectResult['error'];
  declaredSchemaVersion?: string | null;
}): VisualWorkbenchInspectResult {
  const headMatchesSourceRef = input.resolvedSourceRef && input.headRef
    ? input.resolvedSourceRef === input.headRef
    : null;
  return {
    schemaVersion: VISUAL_WORKBENCH_INSPECT_RESULT_SCHEMA_VERSION,
    manifestSchemaVersion: null,
    stage: inspectStageEnvelope({
      inputRef: `${input.manifestSourceRef}:${input.manifestRelativePath}`,
      sourceRef: input.manifestSourceRef,
      canRunWorkbenchCapture: false,
    }),
    source: {
      workDir: input.workDir,
      requestedSourceRef: input.requestedSourceRef,
      resolvedSourceRef: input.resolvedSourceRef,
      headRef: input.headRef,
      headMatchesSourceRef,
      remoteFreshnessChecked: false,
    },
    manifest: {
      path: input.manifestRelativePath,
      sourceRef: input.manifestSourceRef,
      sha256: null,
      schemaVersion: input.declaredSchemaVersion ?? null,
      projectClass: null,
      serveCommand: null,
      baseUrlEnv: null,
      storyRoutePattern: null,
      coveragePolicy: {
        mode: null,
        selectionDefault: null,
        simplificationRequiresEvidence: null,
      },
      summary: null,
      blockers: input.blockers,
      issueDetails: input.issueDetails ?? [],
    },
    status: input.status,
    canRunWorkbenchCapture: false,
    recommendedCapture: null,
    error: input.error,
    notes: baseInspectNotes(),
  };
}

function buildCompletedInspectResult(input: {
  workDir: string;
  requestedSourceRef: string;
  resolvedSourceRef: string;
  headRef: string | null;
  manifestRelativePath: string;
  manifest: VisualWorkbenchManifest;
  manifestSha256: string;
}): VisualWorkbenchInspectResult {
  const headMatchesSourceRef = input.headRef != null
    ? input.headRef === input.resolvedSourceRef
    : null;
  const canRunWorkbenchCapture = headMatchesSourceRef === true;
  return {
    schemaVersion: VISUAL_WORKBENCH_INSPECT_RESULT_SCHEMA_VERSION,
    manifestSchemaVersion: VISUAL_WORKBENCH_MANIFEST_SCHEMA_VERSION,
    stage: inspectStageEnvelope({
      inputRef: `${input.resolvedSourceRef}:${input.manifestRelativePath}`,
      sourceRef: input.resolvedSourceRef,
      canRunWorkbenchCapture,
    }),
    source: {
      workDir: input.workDir,
      requestedSourceRef: input.requestedSourceRef,
      resolvedSourceRef: input.resolvedSourceRef,
      headRef: input.headRef,
      headMatchesSourceRef,
      remoteFreshnessChecked: false,
    },
    manifest: {
      path: input.manifestRelativePath,
      sourceRef: input.resolvedSourceRef,
      sha256: input.manifestSha256,
      schemaVersion: input.manifest.schemaVersion,
      projectClass: input.manifest.projectClass,
      serveCommand: input.manifest.workbench.serveCommand,
      baseUrlEnv: input.manifest.workbench.baseUrlEnv ?? null,
      storyRoutePattern: input.manifest.workbench.storyRoutePattern,
      coveragePolicy: {
        mode: input.manifest.coveragePolicy.mode,
        selectionDefault: input.manifest.coveragePolicy.selectionDefault,
        simplificationRequiresEvidence: input.manifest.coveragePolicy.simplificationRequiresEvidence,
      },
      summary: summarizeVisualWorkbenchManifest(input.manifest),
      blockers: [],
      issueDetails: [],
    },
    status: 'ready',
    canRunWorkbenchCapture,
    recommendedCapture: {
      stageId: 'visual_workbench_capture',
      selection: 'full_manifest',
      sourceRef: input.resolvedSourceRef,
      requiresCurrentHeadAtSourceRef: true,
      outputDirRequirement: 'outside_work_dir',
      commandHint: `ralph visual-workbench capture --work-dir ${input.workDir} --source-ref ${input.resolvedSourceRef} --base-url <http://127.0.0.1:port> --out-dir <experiment-output-dir-outside-work-dir>`,
    },
    error: null,
    notes: baseInspectNotes(),
  };
}

function inspectStageEnvelope(input: {
  inputRef: string;
  sourceRef: string;
  canRunWorkbenchCapture: boolean;
}): VisualWorkbenchInspectResult['stage'] {
  return {
    stageId: 'visual_workbench_manifest_readiness',
    mode: 'read_only',
    inputRef: input.inputRef,
    ownerBoundary: 'ra-355.visual-workbench-manifest',
    sourceRef: input.sourceRef,
    allowedMutations: [],
    forbiddenMutations: [
      'source workspace writes',
      'Visual Workbench server start',
      'Playwright screenshot capture',
      'task verificationEvidence',
      'proofReviews[]',
      'ProjectAsset',
      'runtime intents',
      'lifecycle state',
    ],
    handoff: input.canRunWorkbenchCapture
      ? [
        'run_visual_workbench_capture_if_selected',
        'inspect_manifest_gaps_before_executor_or_controller',
      ]
      : [
        'fix_manifest_or_select_matching_source_ref',
        'checkout_source_ref_before_capture_if_needed',
      ],
  };
}

function captureStatusForStories(stories: VisualWorkbenchCapturedStory[]): VisualWorkbenchCaptureRunStatus {
  const viewportStatuses = stories.flatMap((story) => story.viewports.map((viewport) => viewport.status));
  if (viewportStatuses.length === 0) return 'failed';
  const capturedCount = viewportStatuses.filter((status) => status === 'captured').length;
  if (capturedCount === viewportStatuses.length) return 'captured';
  if (capturedCount > 0) return 'partial';
  return 'failed';
}

function normalizeCaptureSelection(input: {
  selection: VisualWorkbenchCaptureSelection;
  storyId?: string;
  viewportNames: string[];
}): NormalizedCaptureSelection {
  const selection = String(input.selection).trim();
  if (selection !== 'full_manifest' && selection !== 'story_viewports') {
    throw new Error(`Unsupported Visual Workbench capture selection: ${selection}`);
  }

  const storyId = normalizeOptionalText(input.storyId);
  const viewportNormalization = normalizeViewportNames(input.viewportNames);
  const { viewportNames } = viewportNormalization;
  if (selection === 'full_manifest') {
    return {
      selection,
      storyId,
      viewportNames,
      error: viewportNormalization.error ?? (storyId || viewportNames.length > 0
        ? {
          code: 'selection_invalid',
          message: 'Visual Workbench full_manifest capture does not accept --story or --viewport. Use --selection story_viewports for selected capture.',
        }
        : null),
    };
  }

  const missing: string[] = [];
  if (!storyId) missing.push('--story');
  if (viewportNames.length === 0) missing.push('--viewport');
  return {
    selection,
    storyId,
    viewportNames,
    error: viewportNormalization.error ?? (missing.length > 0
      ? {
        code: 'selection_invalid',
        message: `Visual Workbench story_viewports capture requires ${missing.join(' and ')}.`,
      }
      : null),
  };
}

function selectStoriesForCapture(
  manifest: VisualWorkbenchManifest,
  selection: NormalizedCaptureSelection,
): { stories: VisualWorkbenchStory[]; error: VisualWorkbenchCaptureError | null } {
  if (selection.error) return { stories: [], error: selection.error };
  if (selection.selection === 'full_manifest') return { stories: manifest.stories, error: null };
  const story = manifest.stories.find((candidate) => candidate.id === selection.storyId);
  if (!story || !selection.storyId) {
    return {
      stories: [],
      error: {
        code: 'selection_story_not_found',
        message: `Visual Workbench selected story is not present in the manifest: ${selection.storyId ?? '<missing>'}.`,
      },
    };
  }

  const viewportByName = new Map(story.viewports.map((viewport) => [viewport.name, viewport] as const));
  const missingViewports = selection.viewportNames.filter((name) => !viewportByName.has(name));
  if (missingViewports.length > 0) {
    return {
      stories: [],
      error: {
        code: 'selection_viewport_not_found',
        message: `Visual Workbench selected story ${story.id} does not include viewport(s): ${missingViewports.join(', ')}.`,
      },
    };
  }

  return {
    stories: [{
      ...story,
      viewports: selection.viewportNames.map((name) => viewportByName.get(name)!),
    }],
    error: null,
  };
}

function normalizeOptionalText(value: string | undefined): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text || null;
}

function normalizeViewportNames(values: string[]): {
  viewportNames: string[];
  error: VisualWorkbenchCaptureError | null;
} {
  const seen = new Set<string>();
  const viewportNames: string[] = [];
  const duplicates: string[] = [];
  let hasEmpty = false;
  for (const value of values) {
    const text = value.trim();
    if (!text) {
      hasEmpty = true;
      continue;
    }
    if (seen.has(text)) {
      if (!duplicates.includes(text)) duplicates.push(text);
      continue;
    }
    seen.add(text);
    viewportNames.push(text);
  }
  if (hasEmpty) {
    return {
      viewportNames,
      error: {
        code: 'selection_invalid',
        message: 'Visual Workbench selected capture requires non-empty viewport names.',
      },
    };
  }
  if (duplicates.length > 0) {
    return {
      viewportNames,
      error: {
        code: 'selection_invalid',
        message: `Visual Workbench selected capture repeats viewport name(s): ${duplicates.join(', ')}.`,
      },
    };
  }
  return { viewportNames, error: null };
}

async function resolveAndValidateSourceRef(input: {
  workDir: string;
  sourceRef: string;
}): Promise<{
  resolvedSourceRef: string;
  error: null;
} | {
  resolvedSourceRef: string;
  error: {
    code: 'source_ref_unavailable' | 'source_ref_mismatch';
    message: string;
  };
}> {
  const resolvedSourceRef = await gitValue(input.workDir, ['rev-parse', input.sourceRef]);
  const headRef = await gitValue(input.workDir, ['rev-parse', 'HEAD']);
  if (!resolvedSourceRef || !headRef) {
    return {
      resolvedSourceRef: input.sourceRef,
      error: {
        code: 'source_ref_unavailable',
        message: 'Visual Workbench capture requires a git workspace and a resolvable explicit sourceRef.',
      },
    };
  }
  if (resolvedSourceRef !== headRef) {
    return {
      resolvedSourceRef,
      error: {
        code: 'source_ref_mismatch',
        message: `Visual Workbench capture sourceRef ${resolvedSourceRef} does not match current workspace HEAD ${headRef}.`,
      },
    };
  }
  return { resolvedSourceRef, error: null };
}

function normalizeManifestRelativePath(workDir: string, manifestPath: string): string {
  const resolved = path.resolve(workDir, manifestPath);
  const relative = path.relative(workDir, resolved);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Visual Workbench manifest path must be inside workDir.');
  }
  return relative.split(path.sep).join('/');
}

function assertOutputDirOutsideWorkDir(input: { workDir: string; outDir: string }): void {
  const relative = path.relative(input.workDir, input.outDir);
  if (!relative || (!relative.startsWith('..') && !path.isAbsolute(relative))) {
    throw new Error('Visual Workbench capture outDir must be outside workDir so experiment artifacts do not mutate project source.');
  }
}

function normalizeHttpBaseUrl(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('Visual Workbench base URL must be a valid http(s) URL.');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Visual Workbench base URL must use http or https.');
  }
  if (parsed.username || parsed.password) {
    throw new Error('Visual Workbench base URL must not contain credentials.');
  }
  return parsed.toString();
}

async function writeCaptureReport(reportPath: string, result: VisualWorkbenchCaptureRunResult): Promise<void> {
  try {
    await fs.writeJson(reportPath, result, { spaces: 2 });
    await fs.writeFile(result.output.viewerPath, renderCaptureViewerHtml(result), 'utf8');
  } catch (error) {
    throw new Error(`artifact_write_failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function renderCaptureViewerHtml(result: VisualWorkbenchCaptureRunResult): string {
  const storyCount = result.stories.length;
  const viewportCount = result.stories.reduce((count, story) => count + story.viewports.length, 0);
  const capturedCount = result.stories.reduce(
    (count, story) => count + story.viewports.filter((viewport) => viewport.status === 'captured').length,
    0,
  );
  const storySections = result.stories.map((story) => renderCaptureViewerStory(result, story)).join('\n');
  const errorBlock = result.error
    ? `<section class="notice error"><strong>${escapeHtml(result.error.code)}</strong><p>${escapeHtml(result.error.message)}</p></section>`
    : '';
  const emptyBlock = storySections
    ? ''
    : '<section class="notice"><p>No captured stories are present in this run.</p></section>';

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Visual Workbench Capture</title>
  <style>
    :root { color-scheme: light; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #f8fafc; color: #111827; }
    body { margin: 0; }
    main { width: min(1180px, calc(100% - 32px)); margin: 0 auto; padding: 28px 0 40px; }
    header { display: grid; gap: 10px; margin-bottom: 22px; }
    h1 { font-size: 24px; line-height: 1.2; margin: 0; letter-spacing: 0; }
    h2 { font-size: 17px; margin: 0; letter-spacing: 0; }
    p { margin: 0; line-height: 1.45; }
    a { color: #0f766e; }
    .meta { display: flex; flex-wrap: wrap; gap: 8px; color: #475569; font-size: 13px; }
    .pill { border: 1px solid #cbd5e1; border-radius: 999px; padding: 4px 9px; background: #fff; }
    .stories { display: grid; gap: 18px; }
    .story { border: 1px solid #d1d5db; border-radius: 8px; background: #fff; overflow: hidden; }
    .story-head { display: grid; gap: 8px; padding: 16px; border-bottom: 1px solid #e5e7eb; }
    .claim { color: #374151; font-size: 14px; }
    .viewport-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 14px; padding: 16px; }
    figure { margin: 0; display: grid; gap: 8px; }
    figcaption { display: flex; align-items: center; justify-content: space-between; gap: 8px; font-size: 13px; color: #475569; }
    img { width: 100%; height: auto; border: 1px solid #e5e7eb; border-radius: 6px; background: #fff; }
    .status { font-size: 12px; border-radius: 999px; padding: 3px 7px; border: 1px solid #cbd5e1; }
    .status-captured { color: #166534; background: #dcfce7; border-color: #bbf7d0; }
    .status-failed { color: #991b1b; background: #fee2e2; border-color: #fecaca; }
    .notice { border: 1px solid #cbd5e1; border-radius: 8px; background: #fff; padding: 14px; margin-bottom: 18px; }
    .notice.error { border-color: #fecaca; background: #fff1f2; color: #7f1d1d; }
    .missing-shot { min-height: 180px; display: grid; place-items: center; border: 1px dashed #cbd5e1; border-radius: 6px; color: #64748b; background: #f8fafc; padding: 16px; text-align: center; }
    code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }
  </style>
</head>
<body>
  <main>
    <header>
      <h1>Visual Workbench Capture</h1>
      <div class="meta">
        <span class="pill">status: ${escapeHtml(result.status)}</span>
        <span class="pill">stories: ${storyCount}</span>
        <span class="pill">captured viewports: ${capturedCount}/${viewportCount}</span>
        <span class="pill">source: <code>${escapeHtml(result.stage.sourceRef)}</code></span>
      </div>
      <p><a href="visual-workbench-capture-run.json">Open raw capture report</a></p>
    </header>
    ${errorBlock}
    ${emptyBlock}
    <section class="stories">
      ${storySections}
    </section>
  </main>
</body>
</html>
`;
}

function renderCaptureViewerStory(result: VisualWorkbenchCaptureRunResult, story: VisualWorkbenchCapturedStory): string {
  const viewports = story.viewports.map((viewport) => {
    const image = viewport.status === 'captured' && viewport.screenshotPath && isArtifactInsideOutput(result.output.directory, viewport.screenshotPath)
      ? `<a href="${escapeAttribute(relativeArtifactHref(result.output.directory, viewport.screenshotPath))}"><img src="${escapeAttribute(relativeArtifactHref(result.output.directory, viewport.screenshotPath))}" alt="${escapeAttribute(`${story.title} ${viewport.name}`)}" /></a>`
      : `<div class="missing-shot">${escapeHtml(viewport.error?.message ?? (viewport.screenshotPath ? 'Screenshot artifact is outside capture output.' : 'Screenshot was not captured.'))}</div>`;
    const statusClass = viewport.status === 'captured' ? 'status-captured' : 'status-failed';
    return `<figure>
        <figcaption>
          <span>${escapeHtml(viewport.name)} - ${viewport.width}x${viewport.height}</span>
          <span class="status ${statusClass}">${escapeHtml(viewport.status)}</span>
        </figcaption>
        ${image}
      </figure>`;
  }).join('\n');

  return `<article class="story">
        <div class="story-head">
          <h2>${escapeHtml(story.title)}</h2>
          <div class="meta">
            <span class="pill">feature: ${escapeHtml(story.feature)}</span>
            <span class="pill">widget: ${escapeHtml(story.widget)}</span>
            <span class="pill">state: ${escapeHtml(story.state)}</span>
          </div>
          <p class="claim">${escapeHtml(story.claim)}</p>
        </div>
        <div class="viewport-grid">
          ${viewports}
        </div>
      </article>`;
}

function relativeArtifactHref(fromDir: string, artifactPath: string): string {
  return path.relative(fromDir, artifactPath)
    .split(path.sep)
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

function isArtifactInsideOutput(outputDir: string, artifactPath: string): boolean {
  const relativePath = path.relative(outputDir, artifactPath);
  return Boolean(relativePath) && !relativePath.startsWith('..') && !path.isAbsolute(relativePath);
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function escapeAttribute(value: string): string {
  return escapeHtml(value);
}

async function gitStatus(cwd: string): Promise<string[] | null> {
  const raw = await gitRawValue(cwd, ['status', '--porcelain', '-uall']);
  if (raw == null) return null;
  return raw.split('\n').filter(Boolean);
}

type GitWorkspaceStatus = {
  lines: string[];
  blockingPaths: string[];
};

async function readGitWorkspaceStatus(cwd: string): Promise<GitWorkspaceStatus | null> {
  const raw = await gitRawValue(cwd, ['status', '--porcelain', '-uall']);
  if (raw == null) return null;

  const lines = raw.split('\n').filter(Boolean);
  const entries = parseGitPorcelainStatusEntries(raw);
  const replayability = await Promise.all(entries.map(async (entry) => ({
    entry,
    replayable: await isReplayableDirtyEntry(cwd, entry),
  })));

  return {
    lines,
    blockingPaths: replayability
      .filter(({ replayable }) => !replayable)
      .map(({ entry }) => entry.path),
  };
}

async function isReplayableDirtyEntry(cwd: string, entry: GitPorcelainStatusEntry): Promise<boolean> {
  if (isRunnerManagedReplayableDirtyEntry({ path: entry.path })) return true;
  if (entry.path !== '.gitignore' && entry.path !== 'arena-start.sh') return false;

  const contents = await readDirtyEntryContents(cwd, entry);
  return isRunnerManagedReplayableDirtyEntry({
    path: entry.path,
    headContent: contents.headContent,
    indexContent: contents.indexContent,
    worktreeContent: contents.worktreeContent,
  });
}

async function readDirtyEntryContents(cwd: string, entry: GitPorcelainStatusEntry): Promise<{
  headContent: string | null;
  indexContent?: string | null;
  worktreeContent?: string | null;
}> {
  const headContent = await gitRawValue(cwd, ['show', `HEAD:${entry.path}`]);
  const code = normalizeGitPorcelainStatusCode(entry.code);
  const indexContent = touchesIndex(code)
    ? await gitRawValue(cwd, ['show', `:${entry.path}`])
    : undefined;
  const worktreeContent = touchesWorktree(code)
    ? await readWorkspaceFile(cwd, entry.path)
    : undefined;
  return { headContent, indexContent, worktreeContent };
}

function touchesIndex(code: string): boolean {
  return code !== '??' && code[0] !== ' ';
}

function touchesWorktree(code: string): boolean {
  return code === '??' || code[1] !== ' ';
}

async function readWorkspaceFile(cwd: string, filePath: string): Promise<string | null> {
  const resolved = path.resolve(cwd, filePath);
  const relative = path.relative(cwd, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) return null;
  try {
    return await fs.readFile(resolved, 'utf8');
  } catch {
    return null;
  }
}

async function gitValue(cwd: string, args: string[]): Promise<string | null> {
  try {
    const result = await execFileAsync('git', args, {
      cwd,
      timeout: 10_000,
      maxBuffer: 1024 * 1024,
    });
    return result.stdout.trim() || null;
  } catch {
    return null;
  }
}

async function gitRawValue(cwd: string, args: string[]): Promise<string | null> {
  try {
    const result = await execFileAsync('git', args, {
      cwd,
      timeout: 10_000,
      maxBuffer: 1024 * 1024,
    });
    return result.stdout;
  } catch {
    return null;
  }
}

async function sha256File(filePath: string): Promise<string> {
  const buffer = await fs.readFile(filePath);
  return `sha256:${createHash('sha256').update(buffer).digest('hex')}`;
}

function sha256Text(value: string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function baseCaptureNotes(): string[] {
  return [
    'Visual Workbench capture output is experiment evidence, not lifecycle truth.',
    'This run captures source-owned isolated stories and does not verify the visual claims.',
    'This run does not write .ralph/plan.json, task verificationEvidence, proofReviews, ProjectAsset, blockers, runtime intent or lifecycle state.',
    'Missing or broken stories are capture failures; no fallback to app pages or old visual scenarios is allowed.',
    'remoteFreshnessNotChecked unless the caller separately proves the sourceRef is fresh.',
  ];
}

function baseInspectNotes(): string[] {
  return [
    'Visual Workbench inspect output is readiness evidence, not proof and not lifecycle truth.',
    'This command reads the configured Visual Workbench manifest path from an explicit git sourceRef through the shared @arena/contracts parser.',
    'It does not start the workbench, run Playwright, write screenshots, export task evidence or mutate lifecycle state.',
    'canRunWorkbenchCapture is true only when the manifest is valid and current workspace HEAD matches sourceRef, because capture requires that match.',
    'Missing or broken manifest stories are blockers; no fallback to app pages or old visual scenarios is allowed.',
    'remoteFreshnessNotChecked unless the caller separately proves the sourceRef is fresh.',
  ];
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
