#!/usr/bin/env node
// Standalone screenshot capture script — called from gallery server action
// Usage: node capture-screenshot.mjs <url> <outputPath>
// Exits 0 on success, 1 on error (message on stderr)

import { chromium } from "playwright-core";

const [url, outputPath] = process.argv.slice(2);

if (!url || !outputPath) {
  console.error("Usage: capture-screenshot.mjs <url> <outputPath>");
  process.exit(1);
}

try {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto(url, { waitUntil: "networkidle", timeout: 30_000 });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: outputPath, type: "png" });
  await browser.close();
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
