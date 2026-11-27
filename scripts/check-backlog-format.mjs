#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

function repoRoot() {
  try {
    return execFileSync("git", ["rev-parse", "--show-toplevel"], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return process.cwd();
  }
}

function readAllowedStatuses(root) {
  const constantsPath = path.join(root, "apps/task-board/src/lib/constants.ts");
  const constantsSource = readFileSync(constantsPath, "utf-8");
  const match = constantsSource.match(/export const ALL_STATUSES:[\s\S]*?=\s*\[([^\]]+)\]/);
  if (!match) {
    throw new Error(`Could not read ALL_STATUSES from ${path.relative(root, constantsPath)}`);
  }

  const statuses = [...match[1].matchAll(/"([^"]+)"/g)].map((entry) => entry[1]);
  if (statuses.length === 0) {
    throw new Error(`ALL_STATUSES is empty in ${path.relative(root, constantsPath)}`);
  }
  return statuses;
}

const root = repoRoot();
const backlogDir = path.join(root, "docs/backlog");
const allowedStatuses = readAllowedStatuses(root);
const allowedStatusSet = new Set(allowedStatuses);
const taskHeadingRe = /^### \[([^\]]+)\]\s+([A-Z]+-\d+):\s+(.+)$/;
const seenIds = new Map();
const errors = [];

for (const file of readdirSync(backlogDir).filter((entry) => entry.endsWith(".md")).sort()) {
  const filePath = path.join(backlogDir, file);
  const lines = readFileSync(filePath, "utf-8").split("\n");

  lines.forEach((line, index) => {
    const match = line.match(taskHeadingRe);
    if (!match) return;

    const lineNumber = index + 1;
    const status = match[1].trim();
    const taskId = match[2];
    const location = `${file}:${lineNumber}`;

    if (!allowedStatusSet.has(status)) {
      errors.push(
        `${location} ${taskId} uses unsupported status "${status}". Allowed: ${allowedStatuses.join(", ")}`
      );
    }

    const previousLocation = seenIds.get(taskId);
    if (previousLocation) {
      errors.push(`${location} duplicates ${taskId}; first seen at ${previousLocation}`);
    } else {
      seenIds.set(taskId, location);
    }
  });
}

if (errors.length > 0) {
  console.error("Backlog format check failed:");
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

if (process.argv.includes("--verbose")) {
  console.log(`Backlog format OK: ${seenIds.size} tasks checked.`);
}
