#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { runGovernanceRolloutDryRun } from "./governance-rollout-dry-run.mjs";

const generatedAt = "2026-06-15T00:00:00.000Z";
const releaseSha = "def4567890ab";
const buildId = "build-123";
const previousRef = "abc123";

test("builds a ready rollout dry-run packet from saved non-intervention evidence", () => {
  const fixture = createInputFixture();
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "ra344-dry-run-out-"));
  const result = runGovernanceRolloutDryRun({
    ...dryRunOptions(fixture, outDir),
    generatedAt,
  });

  assert.equal(result.dryRun.taskId, "RA-344");
  assert.equal(result.dryRun.mode, "rollout-dry-run");
  assert.equal(result.dryRun.nonIntervention, true);
  assert.equal(result.dryRun.decision, "ready-to-execute");
  assert.equal(result.dryRun.reports.preflight.mode, "static");
  assert.equal(result.dryRun.reports.preflight.decision, "allow-standby");
  assert.equal(result.evidenceBundle.decision, "ready-to-execute");
  assert.deepEqual(result.dryRun.blockedReasons, []);
  assert.equal(JSON.parse(fs.readFileSync(path.join(outDir, "rollout-evidence-bundle.json"), "utf8")).decision, "ready-to-execute");
  assert.equal(fs.existsSync(path.join(outDir, "rollout-execution.sh")), true);
  assert.equal(fs.existsSync(path.join(outDir, "rollback-execution.sh")), true);
  assert.equal(fs.existsSync(path.join(outDir, "rollout-dry-run.json")), true);
});

test("blocks the final packet when readiness evidence is incoherent", () => {
  const fixture = createInputFixture({
    readiness: {
      build: {
        id: "wrong-build",
        sha: releaseSha,
      },
    },
  });
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "ra344-dry-run-block-"));
  const result = runGovernanceRolloutDryRun({
    ...dryRunOptions(fixture, outDir),
    generatedAt,
  });

  assert.equal(result.dryRun.decision, "block");
  assert.ok(result.dryRun.blockedReasons.some((reason) => reason.startsWith("promotion-plan-decision:")));
  assert.ok(result.dryRun.blockedReasons.some((reason) => reason.includes("canary-build-id")));
  assert.ok(result.dryRun.blockedReasons.some((reason) => reason.startsWith("build-id:")));
});

test("uses drained runner inventory only with an explicit old-slot service", () => {
  const fixture = createInputFixture({ runnerInventory: true });
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "ra344-dry-run-stop-"));
  const result = runGovernanceRolloutDryRun({
    ...dryRunOptions(fixture, outDir),
    generatedAt,
    oldSlotService: "governance-web@blue",
    runnerInventoryPath: fixture.runnerInventoryPath,
  });

  assert.equal(result.dryRun.decision, "ready-to-execute");
  assert.equal(result.evidenceBundle.oldSlotRetention.stopAllowed, true);
  assert.equal(fs.existsSync(path.join(outDir, "old-slot-stop-execution.sh")), true);
});

function dryRunOptions(fixture, outDir) {
  return {
    activeCaddyfile: "/etc/caddy/Caddyfile",
    appDir: "/opt/agents-arena",
    buildId,
    localTopologyReportPath: fixture.localTopologyPath,
    migrationStatus: "compatible",
    oldSlotRetentionReason: "runner-inventory-pending",
    outDir,
    port: "3006",
    postPromotionUrl: "https://app.arena.example.test/api/readiness",
    preflightReportPath: fixture.preflightPath,
    previousRef,
    previousSchedulerRole: "active",
    previousSlot: "blue",
    previousUpstream: "127.0.0.1:3000",
    promotedSchedulerRole: "active",
    readinessFilePath: fixture.readinessPath,
    releaseSha,
    rollbackCaddyfile: "/opt/agents-arena/ops/governance-rollout/Caddyfile.previous",
    routeProbesPath: fixture.routeProbesPath,
    schedulerRole: "standby",
    siteAddress: "app.arena.example.test",
    slotId: "green",
  };
}

function createInputFixture(options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ra344-dry-run-input-"));
  const paths = {
    dir,
    localTopologyPath: path.join(dir, "local-topology.json"),
    preflightPath: path.join(dir, "preflight.json"),
    readinessPath: path.join(dir, "readiness.json"),
    routeProbesPath: path.join(dir, "route-probes.json"),
    runnerInventoryPath: path.join(dir, "runner-inventory.json"),
  };

  writeJson(paths.preflightPath, preflightReport());
  writeJson(paths.localTopologyPath, localTopologyReport());
  writeJson(paths.routeProbesPath, {
    taskId: "RA-344",
    nonIntervention: true,
    probes: routeProbes(),
  });
  writeJson(paths.readinessPath, readinessPayload(options.readiness));
  if (options.runnerInventory) {
    writeJson(paths.runnerInventoryPath, runnerInventoryReport());
  }

  return paths;
}

function preflightReport() {
  return {
    taskId: "RA-344",
    mode: "static",
    releaseSha,
    generatedAt,
    operator: "scripts/governance-rollout-preflight.mjs",
    nonIntervention: true,
    dirtyWorktree: {
      clean: true,
      statusSummary: [],
    },
    migration: {
      classifier: "passed",
      classification: "additive-compatible",
      files: [],
      backup: { status: "not-required" },
      scratchRestore: { status: "not-required" },
    },
    compatibility: {
      matrixResult: "passed",
    },
    localTopologyEvidence: {
      status: "passed",
    },
    blockedReasons: [],
    decision: "allow-standby",
  };
}

function localTopologyReport() {
  return {
    taskId: "RA-344",
    mode: "local-topology-inspector",
    generatedAt,
    operator: "./scripts/docker-local-stack.sh inspect topology",
    nonIntervention: true,
    blockedReasons: [],
    decision: "captured",
  };
}

function readinessPayload(overrides = {}) {
  return {
    schemaVersion: "ra-344.governance-readiness.v1",
    status: "ready",
    build: {
      id: buildId,
      sha: releaseSha,
      ...overrides.build,
    },
    slot: {
      id: "green",
      ...overrides.slot,
    },
    scheduler: {
      role: "standby",
      ...overrides.scheduler,
    },
    database: {
      status: "reachable",
      ...overrides.database,
    },
    migration: {
      status: "compatible",
      ...overrides.migration,
    },
    blockers: overrides.blockers ?? [],
  };
}

function runnerInventoryReport() {
  return {
    taskId: "RA-344",
    mode: "runner-inventory",
    generatedAt,
    operator: "scripts/governance-rollout-runner-inventory.mjs",
    nonIntervention: true,
    counts: {
      inspectedContainers: 1,
      arenaRuntimeContainers: 1,
      runningArenaRuntimeContainers: 1,
      directOldSlotGovernanceUrl: 0,
      missingGovernanceUrl: 0,
      stableGovernanceUrl: 1,
      otherGovernanceUrl: 0,
    },
    oldSlotStop: {
      allowed: true,
      reason: "no-direct-old-slot-governance-url",
    },
    blockedReasons: [],
    decision: "drained",
  };
}

function routeProbes() {
  return [
    {
      id: "readiness",
      method: "GET",
      target: "https://app.arena.example.test/api/readiness",
      httpStatus: 200,
      contentType: "application/json; charset=utf-8",
      json: { status: "ready" },
    },
    {
      id: "auth-session",
      method: "GET",
      target: "https://app.arena.example.test/api/auth/session",
      httpStatus: 200,
      contentType: "application/json",
      json: { user: null },
    },
    {
      id: "project-page",
      method: "GET",
      target: "https://app.arena.example.test/projects/proj_123",
      httpStatus: 200,
      contentType: "text/html; charset=utf-8",
      bodySample: "<main><h1>Project</h1><div id=\"app\"></div></main>",
    },
    {
      id: "static-asset",
      method: "GET",
      target: "https://app.arena.example.test/_next/static/chunks/app.js",
      httpStatus: 200,
      contentType: "application/javascript; charset=utf-8",
      bodySample: "self.__next_f.push([])",
    },
    {
      id: "runtime-intents-route",
      method: "POST",
      target: "https://app.arena.example.test/api/internal/runtime-intents/claim",
      httpStatus: 401,
      contentType: "application/json",
      authenticated: false,
      json: { error: "unauthorized" },
    },
    {
      id: "runner-status-route",
      method: "GET",
      target: "https://app.arena.example.test/api/internal/projects/proj_123/status",
      httpStatus: 401,
      contentType: "application/json",
      authenticated: false,
      json: { error: "unauthorized" },
    },
    {
      id: "preview-normal-path",
      method: "GET",
      target: "https://proj-123.arena.example.test/",
      through: "caddy",
      httpStatus: 200,
      contentType: "text/html; charset=utf-8",
      bodySample: "<main>Preview app</main>",
    },
    {
      id: "preview-websocket",
      method: "GET",
      target: "https://proj-123.arena.example.test/socket",
      through: "caddy",
      upgradeRequested: true,
      httpStatus: 101,
      headers: { Upgrade: "websocket" },
    },
    {
      id: "preview-sw",
      method: "GET",
      target: "https://proj-123.arena.example.test/sw.js",
      through: "caddy",
      httpStatus: 200,
      contentType: "application/javascript; charset=utf-8",
      bodySample: "self.addEventListener('install', () => {})",
    },
    {
      id: "preview-generation",
      method: "GET",
      target: "https://proj-123.arena.example.test/__arena/preview-generation",
      through: "caddy",
      httpStatus: 200,
      contentType: "application/json",
      json: { generation: "abcdef" },
    },
    {
      id: "preview-project-sw",
      method: "GET",
      target: "https://proj-123.arena.example.test/__arena/project-sw.js",
      through: "caddy",
      httpStatus: 200,
      contentType: "application/javascript; charset=utf-8",
      bodySample: "self.addEventListener('fetch', () => {})",
    },
    {
      id: "sse",
      method: "GET",
      target: "https://app.arena.example.test/api/events",
      httpStatus: 200,
      contentType: "text/event-stream; charset=utf-8",
      bodySample: ":keepalive\n\n",
    },
  ];
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}
