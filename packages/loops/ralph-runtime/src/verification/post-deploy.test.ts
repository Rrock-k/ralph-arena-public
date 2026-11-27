import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { PLATFORM_BROWSER_UNAVAILABLE } from './browser-readiness.js';
import { runPostDeployVerification } from './post-deploy.js';

test('post-deploy smoke records missing platform browser as infra evidence, not project failure', async () => {
  const workDir = mkdtempSync(path.join(tmpdir(), 'ralph-post-deploy-browser-'));
  const result = await runPostDeployVerification({
    baseUrl: 'http://127.0.0.1:3000',
    workDir,
    dockerLogs: '',
    launchBrowser: async () => {
      throw new Error([
        'browserType.launch: Executable does not exist at /home/node/.cache/ms-playwright/chromium_headless_shell-1200/chrome-linux/headless_shell',
        'Please run "npx playwright install"',
      ].join('\n'));
    },
  });

  assert.equal(result.passed, false);
  assert.equal(result.infraUnavailable, true);
  assert.equal(result.smoke.browserUnavailable, true);
  assert.equal(result.screenshotDir, null);
  assert.match(result.summary, new RegExp(`Smoke skipped: ${PLATFORM_BROWSER_UNAVAILABLE}`));
  assert.match(result.smoke.errors[0], /do not install Chromium/);
});
