#!/usr/bin/env node

import { createServer } from "node:http";
import { createReadStream, existsSync, statSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "@playwright/test";

const appDir = path.resolve(new URL("..", import.meta.url).pathname);

const LAB_STORIES = [
  {
    id: "admin-ops-laboratory--default-status-action",
    texts: ["Project actions", "Check project status", "one project -> one action -> one result"],
    interactions: [
      {
        clickButtonText: "Inspect product pass",
        texts: ["Pinned by selected action. Change the action, not this fixture.", "Product role guidance"],
        exactTexts: ["Selected action"],
        absentExactTexts: ["Debug stage"],
      },
      {
        clickButtonText: "Inspect UX pass",
        texts: ["Pinned by selected action. Change the action, not this fixture.", "UX role guidance"],
        exactTexts: ["Selected action"],
        absentExactTexts: ["Debug stage"],
      },
    ],
  },
  {
    id: "admin-ops-laboratory--manifest-ready-result",
    texts: ["Manifest status", "Capture gate", "source head matches"],
  },
  {
    id: "admin-ops-laboratory--manifest-blocked-result",
    texts: ["Manifest status", "blocked", "Blockers"],
  },
  {
    id: "admin-ops-laboratory--selector-ready-result",
    texts: ["Selector status", "Capture policy can run next", "Fill capture policy"],
    interactions: [
      {
        clickButtonText: "Fill capture policy",
        texts: ["Check capture policy", "Shell policy report; no command execution, screenshots or evidence."],
        exactTexts: ["Selected action"],
        absentExactTexts: ["Debug stage"],
      },
    ],
  },
  {
    id: "admin-ops-laboratory--selector-blocked-result",
    texts: ["Selector status", "blocked", "Viewports"],
  },
  {
    id: "admin-ops-laboratory--task-context-success-checkpoint-result",
    texts: [
      "Executor checkpoint readback",
      "Use Resume agent, not checkpoint resume",
      "Select Resume agent",
      "Visual task readback",
      "Select Check stories",
      "0 resumable",
    ],
    interactions: [
      {
        clickButtonText: "Select Resume agent",
        texts: ["Resume agent", "Agent intent ON result; no relaunch, runtime recreate, task patch or proof write."],
        exactTexts: ["Selected action"],
        absentExactTexts: ["Debug stage"],
      },
    ],
  },
  {
    id: "admin-ops-laboratory--candidate-scan-visual-readback-result",
    texts: ["Candidate projects", "Visual policy: Required", "Stories: ready", "Class: ordinary web"],
  },
  {
    id: "admin-ops-laboratory--candidate-scan-no-visual-marked-result",
    texts: ["No visual-marked executor task in this scan", "visual evidence not required", "Use for executor"],
  },
  {
    id: "admin-ops-laboratory--evidence-chain-handoff-result",
    texts: ["Manual evidence handoffs", "Screenshot catalog", "Copy render command"],
  },
  {
    id: "admin-ops-laboratory--automation-catalog-result",
    texts: ["Screenshot catalog", "Static viewer path was recorded by the automation diagnostic.", "rows: 3 stories / 6 viewports"],
  },
  {
    id: "admin-ops-laboratory--screenshot-readback-empty-result",
    texts: ["Screenshot review gap", "No screenshot reviews yet", "Use ingest handoff"],
    interactions: [
      {
        clickButtonText: "Use ingest handoff",
        texts: ["Ingest evidence", "Terminal handoff", "CLI handoff only; evidence is ingested only when the copied command is run manually."],
        exactTexts: ["Selected action"],
        absentExactTexts: ["Debug stage"],
      },
    ],
  },
  {
    id: "admin-ops-laboratory--screenshot-readback-available-result",
    texts: ["Screenshot reviews", "Desktop proof for the synth control catalog.", "Check screenshots"],
  },
];

function parseArgs() {
  const args = process.argv.slice(2);
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--storybook-dir") {
      const value = args[index + 1];
      if (!value) throw new Error("--storybook-dir requires a value");
      process.env.STORYBOOK_DIR = value;
      index += 1;
    } else if (arg === "--screenshots") {
      process.env.STORYBOOK_CAPTURE_SCREENSHOTS = "1";
    } else if (arg === "--screenshot-dir") {
      const value = args[index + 1];
      if (!value) throw new Error("--screenshot-dir requires a value");
      process.env.STORYBOOK_SCREENSHOT_DIR = value;
      index += 1;
    } else if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
}

function printUsage() {
  console.log(`Usage:
  STORYBOOK_DIR=/private/tmp/storybook npm run verify:storybook:lab
  node scripts/verify-lab-storybook.mjs --storybook-dir /private/tmp/storybook [--screenshots]

This verifies Admin Lab Storybook states only. It does not run Lab actions,
create evidence, ingest proof rows, scan raw artifacts or write storybook-static.`);
}

function contentType(filePath) {
  if (filePath.endsWith(".html")) return "text/html; charset=utf-8";
  if (filePath.endsWith(".js")) return "application/javascript; charset=utf-8";
  if (filePath.endsWith(".json")) return "application/json; charset=utf-8";
  if (filePath.endsWith(".css")) return "text/css; charset=utf-8";
  if (filePath.endsWith(".svg")) return "image/svg+xml";
  if (filePath.endsWith(".png")) return "image/png";
  if (filePath.endsWith(".woff2")) return "font/woff2";
  if (filePath.endsWith(".map")) return "application/json; charset=utf-8";
  return "application/octet-stream";
}

function safeJoin(root, requestPath) {
  const decoded = decodeURIComponent(requestPath.split("?")[0] || "/");
  const normalized = path.normalize(decoded).replace(/^(\.\.(\/|\\|$))+/, "");
  const filePath = path.resolve(root, `.${normalized}`);
  if (filePath !== root && !filePath.startsWith(`${root}${path.sep}`)) return null;
  return filePath;
}

async function startStaticServer(root) {
  const server = createServer((request, response) => {
    const filePath = safeJoin(root, request.url || "/");
    if (!filePath) {
      response.writeHead(403);
      response.end("Forbidden");
      return;
    }
    const resolved = existsSync(filePath) && statSync(filePath).isDirectory()
      ? path.join(filePath, "index.html")
      : filePath;
    if (!existsSync(resolved) || !statSync(resolved).isFile()) {
      response.writeHead(404);
      response.end("Not found");
      return;
    }
    response.writeHead(200, {
      "content-type": contentType(resolved),
      "cache-control": "no-store",
    });
    createReadStream(resolved).pipe(response);
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Could not resolve static server address");
  }
  return {
    server,
    baseUrl: `http://127.0.0.1:${address.port}`,
  };
}

async function verifyStoryIndex(storybookDir) {
  const indexPath = path.join(storybookDir, "index.json");
  const indexPayload = JSON.parse(await readFile(indexPath, "utf8"));
  const entries = indexPayload.entries && typeof indexPayload.entries === "object"
    ? indexPayload.entries
    : {};
  const missing = LAB_STORIES.filter((story) => !entries[story.id]).map((story) => story.id);
  if (missing.length > 0) {
    throw new Error(`Missing Lab stories in Storybook index: ${missing.join(", ")}`);
  }
}

async function verifyRenderedStories(baseUrl, screenshotDir, shouldCapture) {
  const executablePath = process.env.CHROME_BIN?.trim()
    || process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH?.trim()
    || undefined;
  const browser = await chromium.launch({
    headless: true,
    ...(executablePath ? { executablePath } : {}),
  });

  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
    for (const story of LAB_STORIES) {
      const url = `${baseUrl}/iframe.html?id=${encodeURIComponent(story.id)}&viewMode=story`;
      await page.goto(url, { waitUntil: "networkidle", timeout: 45_000 });
      await page.locator("#storybook-root").waitFor({ state: "visible", timeout: 20_000 });
      for (const text of story.texts) {
        await waitForVisibleText(page, text, story.id);
      }
      const bodyText = (await page.locator("body").innerText()).trim();
      if (bodyText.length < 100) {
        throw new Error(`Story rendered too little text: ${story.id}`);
      }
      if (shouldCapture) {
        await page.screenshot({
          path: path.join(screenshotDir, `${story.id}.png`),
          fullPage: true,
        });
      }
      if (story.interactions?.length) {
        await verifyStoryInteractions(page, url, story);
      }
    }
  } finally {
    await browser.close();
  }
}

async function verifyStoryInteractions(page, url, story) {
  for (const interaction of story.interactions) {
    await page.goto(url, { waitUntil: "networkidle", timeout: 45_000 });
    await page.locator("#storybook-root").waitFor({ state: "visible", timeout: 20_000 });
    const button = page.getByRole("button", { name: new RegExp(escapeRegExp(interaction.clickButtonText)) }).first();
    await button.waitFor({ state: "visible", timeout: 10_000 });
    await button.click();
    for (const text of interaction.texts ?? []) {
      await waitForVisibleText(page, text, `${story.id} after ${interaction.clickButtonText}`);
    }
    for (const text of interaction.exactTexts ?? []) {
      await waitForVisibleExactText(page, text, `${story.id} after ${interaction.clickButtonText}`);
    }
    for (const text of interaction.absentExactTexts ?? []) {
      await assertNoVisibleExactText(page, text, `${story.id} after ${interaction.clickButtonText}`);
    }
  }
}

async function waitForVisibleText(page, expectedText, storyId) {
  await page.waitForFunction(
    (input) => {
      const { expectedText } = input;
      for (const element of Array.from(document.body.querySelectorAll("*"))) {
        const text = element.textContent || "";
        if (!text.includes(expectedText)) continue;
        const style = window.getComputedStyle(element);
        if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) continue;
        if (element.getClientRects().length === 0) continue;
        return true;
      }
      return false;
    },
    { expectedText },
    { timeout: 10_000 },
  ).catch((error) => {
    throw new Error(`Story ${storyId} did not render visible text "${expectedText}": ${error.message}`);
  });
}

async function waitForVisibleExactText(page, expectedText, storyId) {
  await page.waitForFunction(
    (input) => {
      const { expectedText } = input;
      for (const element of Array.from(document.body.querySelectorAll("*"))) {
        const text = (element.textContent || "").trim();
        if (text !== expectedText) continue;
        const style = window.getComputedStyle(element);
        if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) continue;
        if (element.getClientRects().length === 0) continue;
        return true;
      }
      return false;
    },
    { expectedText },
    { timeout: 10_000 },
  ).catch((error) => {
    throw new Error(`Story ${storyId} did not render visible exact text "${expectedText}": ${error.message}`);
  });
}

async function assertNoVisibleExactText(page, expectedText, storyId) {
  const found = await page.evaluate(
    (input) => {
      const { expectedText } = input;
      for (const element of Array.from(document.body.querySelectorAll("*"))) {
        const text = (element.textContent || "").trim();
        if (text !== expectedText) continue;
        const style = window.getComputedStyle(element);
        if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) continue;
        if (element.getClientRects().length === 0) continue;
        return true;
      }
      return false;
    },
    { expectedText },
  );
  if (found) {
    throw new Error(`Story ${storyId} unexpectedly rendered visible exact text "${expectedText}"`);
  }
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function main() {
  parseArgs();
  const storybookDirInput = process.env.STORYBOOK_DIR?.trim();
  if (!storybookDirInput) {
    throw new Error("STORYBOOK_DIR is required. Build Storybook into /private/tmp and pass that path explicitly.");
  }
  const storybookDir = path.resolve(appDir, storybookDirInput);
  const screenshotDir = path.resolve(
    process.env.STORYBOOK_SCREENSHOT_DIR?.trim() || "/private/tmp/ra356-labtab-storybook-verify",
  );
  const shouldCapture = process.env.STORYBOOK_CAPTURE_SCREENSHOTS === "1";
  if (!existsSync(path.join(storybookDir, "iframe.html"))) {
    throw new Error(`Storybook build not found at ${storybookDir}. Run build-storybook to a temp dir first.`);
  }
  if (shouldCapture) {
    await mkdir(screenshotDir, { recursive: true });
  }
  await verifyStoryIndex(storybookDir);
  const { server, baseUrl } = await startStaticServer(storybookDir);
  try {
    await verifyRenderedStories(baseUrl, screenshotDir, shouldCapture);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
  console.log(JSON.stringify({
    schemaVersion: "ra-356.lab-storybook-render-smoke.v1",
    status: "ready",
    storybookDir,
    storyCount: LAB_STORIES.length,
    screenshots: shouldCapture ? screenshotDir : null,
    notes: [
      "Render smoke verifies Admin Lab Storybook UI states only.",
      "It does not run /api/admin/lab/run, create evidence, ingest proof rows, scan raw artifacts or write storybook-static.",
    ],
  }));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
