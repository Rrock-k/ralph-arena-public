import { chromium, type Browser, type LaunchOptions } from 'playwright';

export const PLATFORM_BROWSER_UNAVAILABLE = 'INFRA_BROWSER_UNAVAILABLE';
export const PLATFORM_BROWSER_READINESS_SCHEMA_VERSION = 'ra-356.platform-browser-readiness.v1' as const;

export interface PlatformBrowserReadinessResult {
  schemaVersion: typeof PLATFORM_BROWSER_READINESS_SCHEMA_VERSION;
  status: 'ready' | 'blocked';
  ownerBoundary: 'platform.browser-readiness';
  provider: 'playwright.chromium';
  executablePath: string | null;
  blockers: string[];
  error: {
    code: typeof PLATFORM_BROWSER_UNAVAILABLE | 'browser_launch_failed';
    message: string;
  } | null;
  notes: string[];
}

export interface PlatformChromiumLaunchPlan {
  executablePath: string | null;
  launchOptions: LaunchOptions;
}

export async function getPlatformBrowserReadiness(options: {
  launchBrowser?: () => Promise<Browser>;
  env?: NodeJS.ProcessEnv;
} = {}): Promise<PlatformBrowserReadinessResult> {
  let browser: Browser | null = null;
  const launchPlan = getPlatformChromiumLaunchPlan(options.env);
  try {
    browser = await (options.launchBrowser ? options.launchBrowser() : launchPlatformChromium(options.env));
    return {
      schemaVersion: PLATFORM_BROWSER_READINESS_SCHEMA_VERSION,
      status: 'ready',
      ownerBoundary: 'platform.browser-readiness',
      provider: 'playwright.chromium',
      executablePath: launchPlan.executablePath ?? chromium.executablePath(),
      blockers: [],
      error: null,
      notes: platformBrowserReadinessNotes(),
    };
  } catch (error) {
    const browserUnavailable = isPlaywrightBrowserUnavailable(error);
    return {
      schemaVersion: PLATFORM_BROWSER_READINESS_SCHEMA_VERSION,
      status: 'blocked',
      ownerBoundary: 'platform.browser-readiness',
      provider: 'playwright.chromium',
      executablePath: null,
      blockers: [browserUnavailable ? PLATFORM_BROWSER_UNAVAILABLE : 'browser_launch_failed'],
      error: {
        code: browserUnavailable ? PLATFORM_BROWSER_UNAVAILABLE : 'browser_launch_failed',
        message: browserUnavailable
          ? formatBrowserUnavailableEvidence(error)
          : firstErrorLine(error),
      },
      notes: platformBrowserReadinessNotes(),
    };
  } finally {
    await browser?.close().catch(() => undefined);
  }
}

export async function launchPlatformChromium(env: NodeJS.ProcessEnv = process.env): Promise<Browser> {
  return chromium.launch(getPlatformChromiumLaunchPlan(env).launchOptions);
}

export function getPlatformChromiumLaunchPlan(
  env: NodeJS.ProcessEnv = process.env,
): PlatformChromiumLaunchPlan {
  const chromeBin = env.CHROME_BIN?.trim();
  return {
    executablePath: chromeBin || null,
    launchOptions: chromeBin ? { headless: true, executablePath: chromeBin } : { headless: true },
  };
}

export function formatPlatformBrowserReadinessResult(
  result: PlatformBrowserReadinessResult,
  compact = false,
): string {
  return `${JSON.stringify(result, null, compact ? 0 : 2)}\n`;
}

export function isPlaywrightBrowserUnavailable(error: unknown): boolean {
  const text = collectErrorText(error);
  if (!text) return false;

  return [
    /executable (doesn't|does not) exist[\s\S]*(chromium|chrome|ms-playwright|playwright)/i,
    /(chromium|chrome|ms-playwright|playwright)[\s\S]*executable (doesn't|does not) exist/i,
    /please run[\s\S]*playwright install/i,
    /host system is missing dependencies[\s\S]*playwright install-deps/i,
    /browserType\.launch[\s\S]*(executable doesn't exist|browser.*not found)/i,
    /ms-playwright[\s\S]*(missing|not found|doesn't exist|does not exist)/i,
  ].some((pattern) => pattern.test(text));
}

export function formatBrowserUnavailableEvidence(error: unknown): string {
  const firstLine = collectErrorText(error)
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.length > 0 && !isBrowserInstallInstruction(line))
    ?.slice(0, 320) ?? 'Playwright browser executable is unavailable.';

  return `${PLATFORM_BROWSER_UNAVAILABLE}: Platform Playwright browser readiness is unavailable. Browser verification infrastructure is platform-owned; do not install Chromium or run playwright install/install-deps inside the project workspace. Evidence: ${firstLine}`;
}

function isBrowserInstallInstruction(line: string): boolean {
  return /(?:npx\s+)?playwright\s+install(?:-deps)?/i.test(line)
    || /please run/i.test(line) && /install/i.test(line) && /(playwright|chromium|chrome)/i.test(line)
    || /please run/i.test(line) && /download new browsers/i.test(line);
}

function collectErrorText(error: unknown): string {
  if (typeof error === 'string') return error;
  if (!error || typeof error !== 'object') return String(error ?? '');

  const record = error as Record<string, unknown>;
  const parts: string[] = [];

  for (const key of ['message', 'stdout', 'stderr']) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) parts.push(value);
    if (Buffer.isBuffer(value) && value.length > 0) parts.push(value.toString('utf-8'));
  }

  const output = record.output;
  if (Array.isArray(output)) {
    for (const part of output) {
      if (typeof part === 'string' && part.trim()) parts.push(part);
      if (Buffer.isBuffer(part) && part.length > 0) parts.push(part.toString('utf-8'));
    }
  }

  return parts.join('\n');
}

function firstErrorLine(error: unknown): string {
  return collectErrorText(error)
    .split('\n')
    .map((line) => line.trim())
    .find(Boolean)
    ?.slice(0, 320) ?? 'Playwright Chromium launch failed.';
}

function platformBrowserReadinessNotes(): string[] {
  return [
    'Platform browser readiness is a read-only check of the current Ralph runtime Playwright Chromium environment.',
    'Browser verification infrastructure belongs to the worker image/platform, not to project workspaces.',
    'Do not install Chromium, run playwright install or run playwright install-deps inside a project workspace to satisfy this check.',
    'This check does not start previews, run Workbench capture, write screenshots, export evidence, mutate lifecycle or notify Telegram.',
  ];
}
