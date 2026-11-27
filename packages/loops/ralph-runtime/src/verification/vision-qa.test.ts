import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { PLATFORM_BROWSER_UNAVAILABLE } from './browser-readiness.js';
import { runVisionQA } from './vision-qa.js';

test('vision QA records missing platform browser as infra unavailable evidence', async () => {
  const workDir = mkdtempSync(path.join(tmpdir(), 'ralph-vision-browser-'));
  const e2eDir = path.join(workDir, 'e2e');
  mkdirSync(e2eDir, { recursive: true });
  writeFileSync(path.join(e2eDir, 'e2e-demo.spec.ts'), [
    "import { test, expect } from '@playwright/test';",
    "test('demo', async ({ page }) => {",
    "  await page.goto('/');",
    "  await expect(page.locator('body')).toBeVisible();",
    '});',
  ].join('\n'));

  const report = await runVisionQA({
    projectDir: workDir,
    healthCheckUrl: 'http://127.0.0.1:3000/health',
    openaiApiKey: 'test-key',
    workDir,
    playwrightCommandRunner: () => {
      throw new Error([
        'browserType.launch: Executable does not exist at /home/node/.cache/ms-playwright/chromium_headless_shell-1200/chrome-linux/headless_shell',
        'Please run "npx playwright install"',
      ].join('\n'));
    },
  });

  assert.equal(report.totalTests, 1);
  assert.equal(report.playwrightPassed, 0);
  assert.equal(report.visionFailed, 0);
  assert.match(report.summary, new RegExp(PLATFORM_BROWSER_UNAVAILABLE));
  assert.match(report.results[0].error ?? '', /do not install Chromium/);
  assert.equal(existsSync(path.join(workDir, '_qa-vision-pw.config.js')), false);
});
