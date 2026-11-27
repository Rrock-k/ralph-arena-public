#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  buildRunnerInventoryReport,
  writeRunnerInventoryReport,
} from "./governance-rollout-runner-inventory.mjs";

test("allows old slot stop when running runners use the stable governance origin", () => {
  const report = buildRunnerInventoryReport({
    generatedAt: "2026-06-15T00:00:00.000Z",
    inspect: [
      container({
        name: "/preview-good",
        running: true,
        env: [
          "ARENA_PROJECT_ID=proj_1",
          "ARENA_GOVERNANCE_URL=https://app.arena.example.test",
          "ARENA_RUNNER_VERSION=abc123",
        ],
        labels: {
          "arena.project.id": "proj_1",
          "arena.project.slug": "good",
          "arena.agent": "codex",
        },
      }),
    ],
    oldSlotOrigins: ["127.0.0.1:3000"],
    stableOrigins: ["https://app.arena.example.test"],
  });

  assert.equal(report.decision, "drained");
  assert.equal(report.oldSlotStop.allowed, true);
  assert.equal(report.counts.runningArenaRuntimeContainers, 1);
  assert.equal(report.counts.stableGovernanceUrl, 1);
  assert.deepEqual(report.blockedReasons, []);
});

test("retains old slot when a running runner uses a direct old-slot governance URL", () => {
  const report = buildRunnerInventoryReport({
    inspect: [
      container({
        name: "/preview-old",
        running: true,
        env: [
          "ARENA_PROJECT_ID=proj_old",
          "ARENA_GOVERNANCE_URL=http://127.0.0.1:3000",
          "ARENA_RUNNER_VERSION=abc123",
        ],
      }),
    ],
    oldSlotOrigins: ["127.0.0.1:3000"],
  });

  assert.equal(report.decision, "retain-old-slot");
  assert.equal(report.oldSlotStop.allowed, false);
  assert.equal(report.counts.directOldSlotGovernanceUrl, 1);
  assert.ok(report.blockedReasons.some((reason) => reason.startsWith("direct-old-slot-url:")));
});

test("retains old slot when a running runner is missing ARENA_GOVERNANCE_URL", () => {
  const report = buildRunnerInventoryReport({
    inspect: [
      container({
        name: "/preview-missing",
        running: true,
        env: ["ARENA_RUNNER_VERSION=abc123"],
        labels: {
          "arena.project.id": "proj_missing",
        },
      }),
    ],
    oldSlotOrigins: ["127.0.0.1:3000"],
  });

  assert.equal(report.decision, "retain-old-slot");
  assert.equal(report.oldSlotStop.allowed, false);
  assert.equal(report.counts.missingGovernanceUrl, 1);
  assert.ok(report.blockedReasons.some((reason) => reason.startsWith("missing-governance-url:")));
});

test("does not block old slot stop for stopped runners with direct old-slot URL", () => {
  const report = buildRunnerInventoryReport({
    inspect: [
      container({
        name: "/preview-stopped",
        running: false,
        env: [
          "ARENA_PROJECT_ID=proj_stopped",
          "ARENA_GOVERNANCE_URL=http://127.0.0.1:3000",
        ],
      }),
    ],
    oldSlotOrigins: ["127.0.0.1:3000"],
  });

  assert.equal(report.decision, "drained");
  assert.equal(report.oldSlotStop.allowed, true);
  assert.equal(report.counts.directOldSlotGovernanceUrl, 0);
});

test("writes runner inventory report artifacts", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ra344-runner-inventory-"));
  const reportPath = path.join(tempDir, "runner-inventory.json");
  const report = buildRunnerInventoryReport({
    generatedAt: "2026-06-15T00:00:00.000Z",
    inspect: [
      container({
        name: "/preview-good",
        running: true,
        env: [
          "ARENA_PROJECT_ID=proj_1",
          "ARENA_GOVERNANCE_URL=https://app.arena.example.test",
        ],
      }),
    ],
    oldSlotOrigins: ["127.0.0.1:3000"],
  });

  const written = writeRunnerInventoryReport(report, reportPath);
  const parsed = JSON.parse(fs.readFileSync(written, "utf8"));

  assert.equal(parsed.taskId, "RA-344");
  assert.equal(parsed.mode, "runner-inventory");
  assert.equal(parsed.decision, "drained");
});

function container(options) {
  return {
    Id: options.id ?? "1234567890abcdef",
    Name: options.name,
    State: {
      Running: options.running,
    },
    Config: {
      Env: options.env ?? [],
      Labels: options.labels ?? {},
      Hostname: "fallback-hostname",
    },
  };
}
