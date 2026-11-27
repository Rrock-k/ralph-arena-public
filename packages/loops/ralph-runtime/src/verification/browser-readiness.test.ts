import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  PLATFORM_BROWSER_READINESS_SCHEMA_VERSION,
  PLATFORM_BROWSER_UNAVAILABLE,
  formatPlatformBrowserReadinessResult,
  formatBrowserUnavailableEvidence,
  getPlatformChromiumLaunchPlan,
  getPlatformBrowserReadiness,
  isPlaywrightBrowserUnavailable,
} from './browser-readiness.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../..');

test('detects missing Playwright-managed Chromium as platform browser unavailable', () => {
  const error = {
    message: [
      'browserType.launch: Executable does not exist at /home/node/.cache/ms-playwright/chromium_headless_shell-1200/chrome-linux/headless_shell',
      'Please run the following command to download new browsers:',
      'npx playwright install',
    ].join('\n'),
  };

  assert.equal(isPlaywrightBrowserUnavailable(error), true);
  assert.match(formatBrowserUnavailableEvidence(error), new RegExp(PLATFORM_BROWSER_UNAVAILABLE));
  assert.match(formatBrowserUnavailableEvidence(error), /do not install Chromium/);
});

test('detects missing Playwright OS dependencies as platform browser unavailable', () => {
  const error = {
    stderr: 'Host system is missing dependencies to run browsers. Run "npx playwright install-deps".',
  };

  assert.equal(isPlaywrightBrowserUnavailable(error), true);
});

test('browser unavailable evidence does not repeat browser install instructions', () => {
  const evidence = formatBrowserUnavailableEvidence({
    message: [
      'Please run the following command to download new browsers:',
      'npx playwright install',
    ].join('\n'),
  });

  assert.match(evidence, /do not install Chromium/);
  assert.doesNotMatch(evidence, /Evidence: .*playwright install/i);
  assert.match(evidence, /Evidence: Playwright browser executable is unavailable\./);
});

test('does not classify ordinary Playwright assertion failures as browser infra', () => {
  const error = {
    message: 'Error: expect(locator).toBeVisible() failed because the button is hidden',
  };

  assert.equal(isPlaywrightBrowserUnavailable(error), false);
});

test('platform browser readiness reports ready after a launchable browser closes', async () => {
  let closed = false;
  const result = await getPlatformBrowserReadiness({
    launchBrowser: async () => ({
      close: async () => {
        closed = true;
      },
    } as any),
  });

  assert.equal(result.schemaVersion, PLATFORM_BROWSER_READINESS_SCHEMA_VERSION);
  assert.equal(result.status, 'ready');
  assert.equal(result.ownerBoundary, 'platform.browser-readiness');
  assert.deepEqual(result.blockers, []);
  assert.equal(result.error, null);
  assert.equal(closed, true);
  assert.equal(JSON.parse(formatPlatformBrowserReadinessResult(result, true)).status, 'ready');
});

test('platform browser launch plan uses CHROME_BIN when the platform provides it', () => {
  const plan = getPlatformChromiumLaunchPlan({
    CHROME_BIN: '/usr/bin/chromium',
  } as NodeJS.ProcessEnv);

  assert.equal(plan.executablePath, '/usr/bin/chromium');
  assert.deepEqual(plan.launchOptions, {
    headless: true,
    executablePath: '/usr/bin/chromium',
  });
});

test('platform browser readiness reports CHROME_BIN executable path when configured', async () => {
  const result = await getPlatformBrowserReadiness({
    env: { CHROME_BIN: '/usr/bin/chromium' } as NodeJS.ProcessEnv,
    launchBrowser: async () => ({
      close: async () => {},
    } as any),
  });

  assert.equal(result.status, 'ready');
  assert.equal(result.executablePath, '/usr/bin/chromium');
});

test('platform browser readiness reports missing Chromium as platform infra', async () => {
  const result = await getPlatformBrowserReadiness({
    launchBrowser: async () => {
      throw new Error([
        'browserType.launch: Executable does not exist at /home/node/.cache/ms-playwright/chromium_headless_shell-1200/chrome-linux/headless_shell',
        'Please run "npx playwright install"',
      ].join('\n'));
    },
  });

  assert.equal(result.status, 'blocked');
  assert.equal(result.executablePath, null);
  assert.deepEqual(result.blockers, [PLATFORM_BROWSER_UNAVAILABLE]);
  assert.equal(result.error?.code, PLATFORM_BROWSER_UNAVAILABLE);
  assert.match(result.error?.message ?? '', /do not install Chromium/);
  assert.doesNotMatch(result.error?.message ?? '', /Evidence: .*playwright install/i);
});

test('worker image exposes a stable project-local Chromium executable contract', () => {
  const dockerfile = readFileSync(
    path.join(repoRoot, 'services/worker-agent/Dockerfile.worker'),
    'utf-8',
  );

  assert.match(dockerfile, /ENV PLAYWRIGHT_BROWSERS_PATH="\/home\/node\/\.cache\/ms-playwright"/);
  assert.match(dockerfile, /npm exec --prefix \/packages\/loops\/ralph-runtime -- playwright install chromium/);
  assert.match(dockerfile, /ln -sf \/usr\/local\/bin\/arena-chromium \/usr\/bin\/chromium/);
  assert.match(dockerfile, /ENV CHROME_BIN="\/usr\/bin\/chromium"/);
  assert.equal(dockerfile.split('\n').some((line) => /^\s*chromium\s*\\?\s*$/.test(line)), false);
});

test('Ralph browser capture consumers use the shared platform launch helper', () => {
  const screenshotProof = readFileSync(
    path.join(repoRoot, 'packages/loops/ralph-runtime/src/verification/screenshot-proof.ts'),
    'utf-8',
  );
  const postDeploy = readFileSync(
    path.join(repoRoot, 'packages/loops/ralph-runtime/src/verification/post-deploy.ts'),
    'utf-8',
  );

  for (const source of [screenshotProof, postDeploy]) {
    assert.match(source, /launchPlatformChromium/);
    assert.doesNotMatch(source, /import\s+\{[^}]*\bchromium\b[^}]*\}\s+from 'playwright'/);
    assert.doesNotMatch(source, /chromium\.launch/);
  }
});
