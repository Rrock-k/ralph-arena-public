import type { Browser, Page } from 'playwright';
import fs from 'fs-extra';
import path from 'path';
import { log } from '../utils/logger.js';
import {
  PLATFORM_BROWSER_UNAVAILABLE,
  formatBrowserUnavailableEvidence,
  isPlaywrightBrowserUnavailable,
  launchPlatformChromium,
} from './browser-readiness.js';

// ─── Types ──────────────────────────────────────────────────

export interface PostDeployCheck {
  passed: boolean;
  errors: string[];
}

export interface SmokeTestResult extends PostDeployCheck {
  pages: PageCheckResult[];
  browserUnavailable?: boolean;
}

export interface PageCheckResult {
  url: string;
  status: number | null;
  hasContent: boolean;
  consoleErrors: string[];
  loadTimeMs: number;
  screenshotPath?: string;
}

export interface DockerLogAnalysis extends PostDeployCheck {
  errorLines: string[];
  warningLines: string[];
}

export interface PostDeployResult {
  passed: boolean;
  infraUnavailable?: boolean;
  smoke: SmokeTestResult;
  dockerLogs: DockerLogAnalysis;
  screenshotDir: string | null;
  summary: string;
}

// ─── Helpers ────────────────────────────────────────────────

/**
 * Discover crawlable pages from a base URL by parsing <a> tags.
 * Returns unique internal paths (same origin).
 */
async function discoverPages(page: Page, baseUrl: string, maxPages = 10): Promise<string[]> {
  const paths = new Set<string>(['/']);

  try {
    await page.goto(baseUrl, { waitUntil: 'load', timeout: 15_000 });

    const links = await page.$$eval('a[href]', (anchors, origin) => {
      return anchors
        .map(a => {
          try {
            const url = new URL(a.getAttribute('href') || '', origin);
            if (url.origin === origin) return url.pathname;
          } catch { /* skip */ }
          return null;
        })
        .filter((p): p is string => p !== null);
    }, baseUrl);

    for (const link of links) {
      if (paths.size >= maxPages) break;
      // Skip API routes and static files
      if (link.startsWith('/api/') || link.includes('.')) continue;
      paths.add(link);
    }
  } catch (err: any) {
    log.warn(`Page discovery failed: ${err.message}`);
  }

  return [...paths];
}

// ─── Main verification ──────────────────────────────────────

export interface PostDeployOptions {
  /** Base URL of the deployed app, e.g. http://localhost:3001 */
  baseUrl: string;
  /** Working directory (for saving screenshots) */
  workDir: string;
  /** Screenshot output directory. Defaults to .ralph/screenshots. */
  screenshotDir?: string;
  /** Docker compose log text (if available) */
  dockerLogs?: string;
  /** Max pages to smoke test */
  maxPages?: number;
  /** Take screenshots? */
  screenshots?: boolean;
  /** Test seam for browser readiness failures. Production uses Playwright's platform browser. */
  launchBrowser?: () => Promise<Browser>;
}

/**
 * Run all post-deploy verification checks:
 *   1. Smoke test — visit every discoverable page, check HTTP status + console errors
 *   2. Docker log analysis — scan for errors/exceptions
 *   3. Screenshot capture — evidence of each page rendered
 */
export async function runPostDeployVerification(opts: PostDeployOptions): Promise<PostDeployResult> {
  const { baseUrl, workDir, dockerLogs, maxPages = 10, screenshots = true, launchBrowser } = opts;

  const screenshotDir = opts.screenshotDir ?? path.join(workDir, '.ralph', 'screenshots');
  if (screenshots) {
    await fs.ensureDir(screenshotDir);
    // Clean old screenshots
    const files = await fs.readdir(screenshotDir);
    for (const f of files) {
      if (f.endsWith('.png')) await fs.remove(path.join(screenshotDir, f));
    }
  }

  // 1. Smoke test with Playwright
  const smoke = await runSmokeTest(baseUrl, screenshotDir, maxPages, screenshots, launchBrowser);

  // 2. Docker log analysis
  const dockerLogAnalysis = analyzeDockerLogs(dockerLogs || '');

  // 3. Overall result
  const infraUnavailable = smoke.browserUnavailable === true;
  const passed = smoke.passed && dockerLogAnalysis.passed;

  const summaryParts: string[] = [];
  if (infraUnavailable) {
    summaryParts.push(`Smoke skipped: ${PLATFORM_BROWSER_UNAVAILABLE}`);
  } else {
    summaryParts.push(`Smoke: ${smoke.pages.length} pages checked, ${smoke.pages.filter(p => p.status === 200).length} OK`);
  }
  if (!infraUnavailable && smoke.pages.some(p => p.consoleErrors.length > 0)) {
    const totalConsoleErrors = smoke.pages.reduce((acc, p) => acc + p.consoleErrors.length, 0);
    summaryParts.push(`Console errors: ${totalConsoleErrors}`);
  }
  if (dockerLogAnalysis.errorLines.length > 0) {
    summaryParts.push(`Docker errors: ${dockerLogAnalysis.errorLines.length}`);
  }
  if (screenshots && !infraUnavailable) {
    summaryParts.push(`Screenshots: ${screenshotDir}`);
  }

  const summary = summaryParts.join(' | ');

  return {
    passed,
    infraUnavailable,
    smoke,
    dockerLogs: dockerLogAnalysis,
    screenshotDir: screenshots && !infraUnavailable ? screenshotDir : null,
    summary,
  };
}

// ─── Smoke test ─────────────────────────────────────────────

async function runSmokeTest(
  baseUrl: string,
  screenshotDir: string,
  maxPages: number,
  takeScreenshots: boolean,
  launchBrowser: (() => Promise<Browser>) | undefined,
): Promise<SmokeTestResult> {
  let browser: Browser | null = null;
  const pages: PageCheckResult[] = [];
  const errors: string[] = [];

  try {
    browser = launchBrowser
      ? await launchBrowser()
      : await launchPlatformChromium();
    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
    });
    const page = await context.newPage();

    // Discover pages
    log.info('Post-deploy: discovering pages...');
    const paths = await discoverPages(page, baseUrl, maxPages);
    log.info(`Post-deploy: found ${paths.length} pages to check`);

    // Check each page (retry once on non-200 to handle transient failures)
    for (const pagePath of paths) {
      const url = `${baseUrl}${pagePath}`;
      let result = await checkPage(page, url, screenshotDir, pagePath, takeScreenshots);

      // Retry once if we got a non-200 status (transient server glitch)
      if (result.status !== null && result.status !== 200) {
        log.warn(`  ${pagePath} returned ${result.status} — retrying once...`);
        await page.waitForTimeout(2000);
        result = await checkPage(page, url, screenshotDir, pagePath, takeScreenshots);
      }

      pages.push(result);

      const status = result.status === 200 ? '✓' : `✗ ${result.status}`;
      const consoleSuffix = result.consoleErrors.length > 0
        ? ` (${result.consoleErrors.length} console warnings)`
        : '';
      log.info(`  ${status} ${pagePath} (${result.loadTimeMs}ms)${consoleSuffix}`);

      if (result.status !== 200) {
        errors.push(`${pagePath}: HTTP ${result.status}`);
      }
      // Console errors are informational — logged but not added to errors array
      if (result.consoleErrors.length > 0) {
        for (const e of result.consoleErrors) {
          log.warn(`  Console: ${e.slice(0, 150)}`);
        }
      }
      if (!result.hasContent) {
        errors.push(`${pagePath}: page appears empty`);
      }
    }

    await context.close();
  } catch (err: any) {
    if (isPlaywrightBrowserUnavailable(err)) {
      const evidence = formatBrowserUnavailableEvidence(err);
      errors.push(evidence);
      log.warn(`Post-deploy smoke skipped: ${evidence}`);
      return { passed: false, errors, pages, browserUnavailable: true };
    }

    errors.push(`Playwright error: ${err.message}`);
    log.error(`Post-deploy smoke test error: ${err.message}`);
  } finally {
    if (browser) await browser.close();
  }

  // Consider passed if all pages returned 200 and have content
  // Console errors are warnings, not failures (React hydration, etc.)
  const passed = pages.length > 0 &&
    pages.every(p => p.status === 200 && p.hasContent);

  return { passed, errors, pages };
}

async function checkPage(
  page: Page,
  url: string,
  screenshotDir: string,
  pagePath: string,
  takeScreenshot: boolean,
): Promise<PageCheckResult> {
  const consoleErrors: string[] = [];

  // Listen for console errors
  const errorHandler = (msg: any) => {
    if (msg.type() === 'error') {
      const text = msg.text();
      // Skip common non-critical messages
      if (text.includes('favicon.ico') || text.includes('Download the React DevTools')) return;
      consoleErrors.push(text.slice(0, 300));
    }
  };
  page.on('console', errorHandler);

  const start = Date.now();
  let status: number | null = null;
  let hasContent = false;

  try {
    const response = await page.goto(url, {
      waitUntil: 'load',
      timeout: 20_000,
    });
    status = response?.status() ?? null;

    // Check page has meaningful content (not just empty HTML shell)
    const bodyText = await page.evaluate(() => (globalThis as any).document?.body?.innerText?.trim() || '');
    hasContent = bodyText.length > 1;

    // Wait a moment for any late JS errors
    await page.waitForTimeout(500);

    // Take screenshot
    if (takeScreenshot) {
      const filename = pagePath === '/' ? 'home' : pagePath.replace(/\//g, '_').replace(/^_/, '');
      await page.screenshot({
        path: path.join(screenshotDir, `${filename}.png`),
        fullPage: true,
      });
    }
  } catch (err: any) {
    consoleErrors.push(`Navigation error: ${err.message}`);
  }

  page.off('console', errorHandler);

  return {
    url,
    status,
    hasContent,
    consoleErrors,
    loadTimeMs: Date.now() - start,
    screenshotPath: takeScreenshot
      ? path.join(screenshotDir, `${pagePath === '/' ? 'home' : pagePath.replace(/\//g, '_').replace(/^_/, '')}.png`)
      : undefined,
  };
}

// ─── Docker log analysis ────────────────────────────────────

function analyzeDockerLogs(logs: string): DockerLogAnalysis {
  const lines = logs.split('\n');
  const errorLines: string[] = [];
  const warningLines: string[] = [];

  const errorPatterns = [
    /error/i,
    /exception/i,
    /fatal/i,
    /panic/i,
    /ENOSPC/,
    /ENOMEM/,
    /segfault/i,
    /killed/i,
    /OOMKilled/i,
    /exit code [^0]/i,
    /unhandled.*rejection/i,
    /cannot find module/i,
    /module not found/i,
  ];

  // Patterns that look like errors but are actually fine
  const falsePositivePatterns = [
    /prisma:warn/i,           // Prisma binary warning during build
    /experimentalWarning/i,   // Node experimental feature warnings
    /DeprecationWarning/i,    // Deprecation warnings
    /punycode/i,              // Common node punycode warning
    /prisma.*openssl/i,       // Prisma OpenSSL warnings
    /Database already contains/i, // Our idempotent seed message
    /Skipping seed/i,
  ];

  for (const line of lines) {
    if (!line.trim()) continue;

    // Check false positives first
    if (falsePositivePatterns.some(p => p.test(line))) continue;

    if (errorPatterns.some(p => p.test(line))) {
      errorLines.push(line.trim().slice(0, 300));
    } else if (/warn/i.test(line)) {
      warningLines.push(line.trim().slice(0, 300));
    }
  }

  // Docker errors are informational — we don't fail on warnings
  // Only fail if there are actual error-level lines (excluding false positives)
  // Limit: if there are many errors it's likely a real problem
  const passed = errorLines.length <= 2; // allow a couple of minor error-like lines

  return {
    passed,
    errors: errorLines.length > 0 ? [`Docker logs contain ${errorLines.length} error-level lines`] : [],
    errorLines: errorLines.slice(0, 10), // cap at 10
    warningLines: warningLines.slice(0, 10),
  };
}
