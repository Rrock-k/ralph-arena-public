import { createHash } from 'node:crypto';
import path from 'node:path';
import fs from 'fs-extra';
import type { Browser } from 'playwright';
import {
  PLATFORM_BROWSER_UNAVAILABLE,
  formatBrowserUnavailableEvidence,
  isPlaywrightBrowserUnavailable,
} from './browser-readiness.js';
import { captureScreenshotProof } from './screenshot-proof.js';
import {
  VISUAL_SCENARIO_SCHEMA_VERSION,
  parseVisualScenario,
  visualScenarioTargetForScreenshotProof,
  type VisualScenario,
} from './visual-scenario.js';

export const VISUAL_SCENARIO_RUN_SCHEMA_VERSION = 'ra-355.visual-scenario-run.v1' as const;

export type VisualScenarioRunStatus = 'captured' | 'navigation_failed' | 'browser_unavailable' | 'capture_failed';
export type VisualScenarioRunFormat = 'json';

export interface VisualScenarioRunResult {
  schemaVersion: typeof VISUAL_SCENARIO_RUN_SCHEMA_VERSION;
  scenarioSchemaVersion: typeof VISUAL_SCENARIO_SCHEMA_VERSION;
  scenario: {
    scenarioId: string;
    projectClass: VisualScenario['projectClass'];
    name: string | null;
    target: VisualScenario['target'];
  };
  baseUrl: string;
  status: VisualScenarioRunStatus;
  capturedAt: string;
  output: {
    directory: string;
    reportPath: string;
    screenshotPath: string | null;
    screenshotSha256: string | null;
  };
  error: {
    code: 'navigation_failed' | typeof PLATFORM_BROWSER_UNAVAILABLE | 'capture_failed';
    message: string;
  } | null;
  notes: string[];
}

export interface VisualScenarioRunOptions {
  scenario: VisualScenario;
  baseUrl: string;
  outDir: string;
  launchBrowser?: () => Promise<Browser>;
  now?: () => Date;
}

export async function runVisualScenarioFile(input: {
  scenarioPath: string;
  baseUrl: string;
  outDir: string;
  launchBrowser?: () => Promise<Browser>;
  now?: () => Date;
}): Promise<VisualScenarioRunResult> {
  const scenario = parseVisualScenario(await fs.readJson(path.resolve(input.scenarioPath)));
  return runVisualScenario({
    scenario,
    baseUrl: input.baseUrl,
    outDir: input.outDir,
    launchBrowser: input.launchBrowser,
    now: input.now,
  });
}

export async function runVisualScenario(options: VisualScenarioRunOptions): Promise<VisualScenarioRunResult> {
  const scenario = parseVisualScenario(options.scenario);
  const outDir = path.resolve(options.outDir);
  const reportPath = path.join(outDir, 'scenario-run.json');
  const screenshotPath = path.join(outDir, `${scenario.scenarioId}.png`);
  const baseUrl = normalizeHttpBaseUrl(options.baseUrl);
  const capturedAt = (options.now ?? (() => new Date()))().toISOString();

  await fs.ensureDir(outDir);

  let status: VisualScenarioRunStatus = 'captured';
  let screenshotSha256: string | null = null;
  let error: VisualScenarioRunResult['error'] = null;

  try {
    await captureScreenshotProof({
      baseUrl,
      target: visualScenarioTargetForScreenshotProof(scenario),
      outputPath: screenshotPath,
      launchBrowser: options.launchBrowser,
    });
    screenshotSha256 = await sha256File(screenshotPath);
  } catch (captureError) {
    const classified = classifyVisualScenarioCaptureError(captureError);
    status = classified.status;
    error = classified.error;
  }

  const result: VisualScenarioRunResult = {
    schemaVersion: VISUAL_SCENARIO_RUN_SCHEMA_VERSION,
    scenarioSchemaVersion: VISUAL_SCENARIO_SCHEMA_VERSION,
    scenario: {
      scenarioId: scenario.scenarioId,
      projectClass: scenario.projectClass,
      name: scenario.name ?? null,
      target: scenario.target,
    },
    baseUrl,
    status,
    capturedAt,
    output: {
      directory: outDir,
      reportPath,
      screenshotPath: status === 'captured' ? screenshotPath : null,
      screenshotSha256,
    },
    error,
    notes: [
      'Visual Scenario Lab output is disposable execution-lab evidence.',
      'This run does not verify the visual claim; it only captures the configured scenario target.',
      'This run does not write .ralph/plan.json, task verificationEvidence, proofReviews, ProjectAsset, blockers, runtime intent or lifecycle state.',
    ],
  };

  await fs.writeJson(reportPath, result, { spaces: 2 });
  return result;
}

export function formatVisualScenarioRunResult(
  result: VisualScenarioRunResult,
  format: VisualScenarioRunFormat = 'json',
  compact = false,
): string {
  if (format === 'json') return `${JSON.stringify(result, null, compact ? 0 : 2)}\n`;
  throw new Error(`Unsupported visual scenario run format: ${format}`);
}

function normalizeHttpBaseUrl(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('Visual scenario base URL must be a valid http(s) URL.');
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Visual scenario base URL must use http or https.');
  }
  if (parsed.username || parsed.password) {
    throw new Error('Visual scenario base URL must not contain credentials.');
  }

  return parsed.toString();
}

function classifyVisualScenarioCaptureError(error: unknown): Pick<VisualScenarioRunResult, 'status' | 'error'> {
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
        message: `Scenario target returned HTTP ${navigationMatch[1]}.`,
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

async function sha256File(filePath: string): Promise<string> {
  const buffer = await fs.readFile(filePath);
  return `sha256:${createHash('sha256').update(buffer).digest('hex')}`;
}
