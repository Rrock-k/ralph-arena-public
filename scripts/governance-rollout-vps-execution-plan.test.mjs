#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { buildReadinessCanaryReport } from "./governance-rollout-canary.mjs";
import { buildPromotionPlan } from "./governance-rollout-promotion-plan.mjs";
import { buildRunnerInventoryReport } from "./governance-rollout-runner-inventory.mjs";
import { buildSlotRolloutPlan } from "./governance-rollout-slot-plan.mjs";
import {
  buildVpsExecutionPlan,
  writeVpsExecutionArtifacts,
} from "./governance-rollout-vps-execution-plan.mjs";

const baseSlotOptions = {
  appDir: "/opt/agents-arena",
  buildId: "build-123",
  migrationStatus: "compatible",
  port: "3006",
  previousRef: "abc123",
  releaseSha: "def456",
  schedulerRole: "standby",
  siteAddress: "app.arena.example.test",
  slotId: "green",
  generatedAt: "2026-06-15T00:00:00.000Z",
};

const basePromotionOptions = {
  activeCaddyfile: "/etc/caddy/Caddyfile",
  postPromotionUrl: "https://app.arena.example.test/api/readiness",
  previousSchedulerRole: "active",
  previousSlot: "blue",
  previousUpstream: "127.0.0.1:3000",
  promotedSchedulerRole: "active",
  rollbackCaddyfile: "/opt/agents-arena/ops/governance-rollout/Caddyfile.previous",
  generatedAt: "2026-06-15T00:00:00.000Z",
};

test("builds a non-intervention VPS execution bundle plan", () => {
  const promotionPlan = buildReadyPromotionPlan();
  const plan = buildVpsExecutionPlan({
    promotionPlan,
    generatedAt: "2026-06-15T00:00:00.000Z",
  });

  assert.equal(plan.taskId, "RA-344");
  assert.equal(plan.mode, "vps-execution-plan");
  assert.equal(plan.nonIntervention, true);
  assert.equal(plan.decision, "prepared");
  assert.equal(plan.target.slot, "green");
  assert.equal(plan.previous.slot, "blue");
  assert.equal(plan.oldSlotRetention.required, true);
  assert.equal(plan.oldSlotRetention.stopAllowed, false);
  assert.equal(plan.oldSlotRetention.reason, "runner-inventory-pending");
  assert.equal(plan.oldSlotStop.status, "not-run");
  assert.equal(plan.oldSlotStop.command, null);
  assert.deepEqual(
    plan.commands.map((command) => command.id),
    [
      "validate-candidate-caddy",
      "install-promoted-slot-env",
      "restart-standby-with-promoted-scheduler-role",
      "canary-promoted-standby",
      "save-rollback-caddyfile",
      "promote-active-upstream",
      "post-promotion-canary",
    ],
  );
});

test("plans old slot stop only with drained runner inventory and explicit service", () => {
  const plan = buildVpsExecutionPlan({
    promotionPlan: buildReadyPromotionPlan(),
    runnerInventory: buildDrainedRunnerInventory(),
    oldSlotService: "governance-web@blue",
  });

  assert.equal(plan.decision, "prepared");
  assert.equal(plan.oldSlotRetention.required, false);
  assert.equal(plan.oldSlotRetention.stopAllowed, true);
  assert.equal(plan.oldSlotRetention.reason, "runner-inventory-drained");
  assert.equal(plan.oldSlotStop.status, "ready-to-stop");
  assert.equal(plan.oldSlotStop.command, "systemctl stop governance-web@blue");
});

test("withholds old slot stop script when drained inventory has no explicit service", () => {
  const plan = buildVpsExecutionPlan({
    promotionPlan: buildReadyPromotionPlan(),
    runnerInventory: buildDrainedRunnerInventory(),
  });

  assert.equal(plan.decision, "prepared");
  assert.equal(plan.oldSlotRetention.required, true);
  assert.equal(plan.oldSlotRetention.stopAllowed, false);
  assert.equal(plan.oldSlotRetention.reason, "old-slot-stop-service-required");
  assert.equal(plan.oldSlotStop.status, "stop-service-required");
  assert.equal(plan.oldSlotStop.command, null);
});

test("keeps rollout prepared but retained when runner inventory blocks drain", () => {
  const plan = buildVpsExecutionPlan({
    promotionPlan: buildReadyPromotionPlan(),
    runnerInventory: buildRetainedRunnerInventory(),
  });

  assert.equal(plan.decision, "prepared");
  assert.equal(plan.oldSlotRetention.required, true);
  assert.equal(plan.oldSlotRetention.stopAllowed, false);
  assert.equal(plan.oldSlotRetention.reason, "runner-inventory-blocked");
  assert.equal(plan.oldSlotStop.status, "retain-old-slot");
  assert.equal(plan.oldSlotStop.evidence.directOldSlotGovernanceUrl, 1);
});

test("blocks execution bundle on invalid runner inventory evidence", () => {
  const plan = buildVpsExecutionPlan({
    promotionPlan: buildReadyPromotionPlan(),
    runnerInventory: {
      taskId: "RA-344",
      mode: "not-runner-inventory",
      decision: "drained",
    },
  });

  assert.equal(plan.decision, "block");
  assert.ok(plan.blockedReasons.some((reason) => reason.includes("runner-inventory-identity")));
});

test("blocks execution bundle when promotion plan is not ready", () => {
  const promotionPlan = {
    ...buildReadyPromotionPlan(),
    decision: "block",
    blockedReasons: ["canary-build-id: mismatch"],
  };
  const plan = buildVpsExecutionPlan({ promotionPlan });

  assert.equal(plan.decision, "block");
  assert.ok(plan.blockedReasons.some((reason) => reason.includes("promotion-plan-decision")));
});

test("uses shorter command order when external scheduler remains owner", () => {
  const slotPlan = buildSlotRolloutPlan({
    ...baseSlotOptions,
    schedulerRole: "external",
  });
  const promotionPlan = buildPromotionPlan({
    ...basePromotionOptions,
    previousSchedulerRole: "external",
    promotedSchedulerRole: "external",
    slotPlan,
    canaryReport: buildMatchingCanary(slotPlan),
  });
  const plan = buildVpsExecutionPlan({ promotionPlan });

  assert.equal(plan.decision, "prepared");
  assert.deepEqual(
    plan.commands.map((command) => command.id),
    [
      "validate-candidate-caddy",
      "save-rollback-caddyfile",
      "promote-active-upstream",
      "post-promotion-canary",
    ],
  );
});

test("blocks unexpected rollout command ids", () => {
  const promotionPlan = buildReadyPromotionPlan();
  promotionPlan.commands = [
    ...promotionPlan.commands,
    {
      id: "stop-old-slot",
      mutates: true,
      command: "systemctl stop governance-web@blue",
    },
  ];
  const plan = buildVpsExecutionPlan({ promotionPlan });

  assert.equal(plan.decision, "block");
  assert.ok(plan.blockedReasons.some((reason) => reason.includes("rollout-command-order")));
  assert.ok(plan.blockedReasons.some((reason) => reason.includes("unexpected command id stop-old-slot")));
});

test("writes execution plan and shell artifacts without executing them", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ra344-vps-execution-"));
  const plan = buildVpsExecutionPlan({ promotionPlan: buildReadyPromotionPlan() });
  const written = writeVpsExecutionArtifacts(plan, tempDir);

  assert.ok(fs.existsSync(written.planPath));
  assert.ok(fs.existsSync(written.rolloutScriptPath));
  assert.ok(fs.existsSync(written.rollbackScriptPath));
  assert.equal(written.oldSlotStopScriptPath, null);
  assert.ok(fs.existsSync(written.summaryPath));
  assert.match(fs.readFileSync(written.rolloutScriptPath, "utf8"), /systemctl reload caddy/);
  assert.match(
    fs.readFileSync(written.rolloutScriptPath, "utf8"),
    /The generator is non-intervention; running this script mutates live VPS state\./,
  );
  const report = JSON.parse(fs.readFileSync(written.planPath, "utf8"));
  assert.equal(report.decision, "prepared");
});

test("writes old slot stop script only after drain proof", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ra344-vps-execution-stop-"));
  const plan = buildVpsExecutionPlan({
    promotionPlan: buildReadyPromotionPlan(),
    runnerInventory: buildDrainedRunnerInventory(),
    oldSlotService: "governance-web@blue",
  });
  const written = writeVpsExecutionArtifacts(plan, tempDir);

  assert.ok(written.oldSlotStopScriptPath);
  assert.ok(fs.existsSync(written.oldSlotStopScriptPath));
  assert.match(
    fs.readFileSync(written.oldSlotStopScriptPath, "utf8"),
    /systemctl stop governance-web@blue/,
  );
});

function buildReadyPromotionPlan() {
  const slotPlan = buildSlotRolloutPlan(baseSlotOptions);
  return buildPromotionPlan({
    ...basePromotionOptions,
    slotPlan,
    canaryReport: buildMatchingCanary(slotPlan),
  });
}

function buildDrainedRunnerInventory() {
  return buildRunnerInventoryReport({
    generatedAt: "2026-06-15T00:00:00.000Z",
    inspect: [
      runnerContainer({
        governanceUrl: "https://app.arena.example.test",
      }),
    ],
    oldSlotOrigins: ["127.0.0.1:3000"],
    stableOrigins: ["https://app.arena.example.test"],
  });
}

function buildRetainedRunnerInventory() {
  return buildRunnerInventoryReport({
    generatedAt: "2026-06-15T00:00:00.000Z",
    inspect: [
      runnerContainer({
        governanceUrl: "http://127.0.0.1:3000",
      }),
    ],
    oldSlotOrigins: ["127.0.0.1:3000"],
  });
}

function runnerContainer(options) {
  return {
    Id: "abcdef1234567890",
    Name: "/preview-runner",
    State: {
      Running: true,
    },
    Config: {
      Env: [
        "ARENA_PROJECT_ID=proj_1",
        `ARENA_GOVERNANCE_URL=${options.governanceUrl}`,
        "ARENA_RUNNER_VERSION=abc123",
      ],
      Labels: {
        "arena.project.id": "proj_1",
        "arena.agent": "codex",
      },
    },
  };
}

function buildMatchingCanary(slotPlan) {
  return buildReadinessCanaryReport({
    expectedSchedulerRole: slotPlan.slot.schedulerRole,
    expectedSlot: slotPlan.slot.id,
    url: slotPlan.slot.readinessUrl,
    httpStatus: 200,
    contentType: "application/json",
    generatedAt: "2026-06-15T00:00:00.000Z",
    readiness: {
      schemaVersion: "ra-344.governance-readiness.v1",
      status: "ready",
      generatedAt: "2026-06-15T00:00:00.000Z",
      build: {
        id: slotPlan.release.buildId,
        sha: slotPlan.release.sha,
        source: "GOVERNANCE_BUILD_ID",
      },
      slot: {
        id: slotPlan.slot.id,
      },
      scheduler: {
        role: slotPlan.slot.schedulerRole,
        enabled: slotPlan.slot.schedulerRole === "active",
      },
      database: {
        status: "reachable",
      },
      migration: {
        status: slotPlan.release.migrationStatus,
      },
      blockers: [],
    },
  });
}
