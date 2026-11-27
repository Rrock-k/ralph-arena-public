import type { Browser } from 'playwright';
import fs from 'fs-extra';
import path from 'path';
import type { ScreenshotProofTarget } from '../config/types.js';
import { launchPlatformChromium } from './browser-readiness.js';

export interface ScreenshotProofCaptureOptions {
  baseUrl: string;
  target: ScreenshotProofTarget;
  outputPath: string;
  launchBrowser?: () => Promise<Browser>;
}

export async function captureScreenshotProof(options: ScreenshotProofCaptureOptions): Promise<void> {
  await fs.ensureDir(path.dirname(options.outputPath));

  const browser = await (options.launchBrowser ? options.launchBrowser() : launchPlatformChromium());
  try {
    const page = await browser.newPage({ viewport: options.target.viewport });
    const url = new URL(options.target.route, options.baseUrl);
    const response = await page.goto(url.toString(), { waitUntil: 'load', timeout: 20_000 });
    const status = response?.status() ?? null;
    if (status === null || status >= 400) {
      throw new Error(`Screenshot proof target returned HTTP ${status ?? 'no response'} for ${url.pathname}${url.search}`);
    }
    await page.waitForTimeout(options.target.waitAfterLoadMs ?? 500);
    await page.screenshot({
      path: options.outputPath,
      fullPage: true,
    });
  } finally {
    await browser.close();
  }
}
