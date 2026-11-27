import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { captureScreenshotProof } from './screenshot-proof.js';

test('captureScreenshotProof rejects non-successful target responses', async () => {
  const workDir = mkdtempSync(path.join(tmpdir(), 'ralph-screenshot-proof-'));
  let screenshotCalled = false;
  let closed = false;

  await assert.rejects(
    () => captureScreenshotProof({
      baseUrl: 'http://127.0.0.1:3000',
      target: {
        route: '/missing',
        viewport: { width: 430, height: 844 },
        claim: 'Missing route should not become proof.',
      },
      outputPath: path.join(workDir, 'proof.png'),
      launchBrowser: async () => ({
        newPage: async () => ({
          goto: async () => ({ status: () => 404 }),
          waitForTimeout: async () => {},
          screenshot: async () => {
            screenshotCalled = true;
          },
        }),
        close: async () => {
          closed = true;
        },
      } as any),
    }),
    /HTTP 404/,
  );

  assert.equal(screenshotCalled, false);
  assert.equal(closed, true);
});

test('captureScreenshotProof uses explicit waitAfterLoadMs and keeps 500ms default', async () => {
  const workDir = mkdtempSync(path.join(tmpdir(), 'ralph-screenshot-proof-wait-'));
  const waits: number[] = [];

  async function capture(waitAfterLoadMs?: number) {
    await captureScreenshotProof({
      baseUrl: 'http://127.0.0.1:3000',
      target: {
        route: '/',
        viewport: { width: 430, height: 844 },
        claim: 'Loaded route should settle before capture.',
        ...(waitAfterLoadMs !== undefined ? { waitAfterLoadMs } : {}),
      },
      outputPath: path.join(workDir, `${waitAfterLoadMs ?? 'default'}.png`),
      launchBrowser: async () => ({
        newPage: async () => ({
          goto: async () => ({ status: () => 200 }),
          waitForTimeout: async (ms: number) => {
            waits.push(ms);
          },
          screenshot: async () => {},
        }),
        close: async () => {},
      } as any),
    });
  }

  await capture(2500);
  await capture();

  assert.deepEqual(waits, [2500, 500]);
});
