#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { buildReadinessCanaryReport } from "./governance-rollout-canary.mjs";
import {
  buildPromotionPlan,
  writePromotionPlanArtifacts,
} from "./governance-rollout-promotion-plan.mjs";
import { buildSlotRolloutPlan } from "./governance-rollout-slot-plan.mjs";

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

test("builds a ready promotion plan from matching slot plan and canary", () => {
  const slotPlan = buildSlotRolloutPlan(baseSlotOptions);
  const canaryReport = buildMatchingCanary(slotPlan);
  const plan = buildPromotionPlan({
    ...basePromotionOptions,
    slotPlan,
    canaryReport,
  });

  assert.equal(plan.taskId, "RA-344");
  assert.equal(plan.mode, "promotion-plan");
  assert.equal(plan.nonIntervention, true);
  assert.equal(plan.decision, "ready-to-promote");
  assert.equal(plan.target.slot, "green");
  assert.equal(plan.target.promotedSchedulerRole, "active");
  assert.equal(plan.previous.slot, "blue");
  assert.equal(plan.schedulerTransfer.requiresStandbyRestart, true);
  assert.match(plan.artifacts.promotedSlotEnv, /GOVERNANCE_SCHEDULER_ROLE=active/);
  assert.ok(plan.commands.some((command) => command.id === "canary-promoted-standby"));
  assert.ok(plan.commands.some((command) => command.id === "promote-active-upstream" && command.mutates));
  assert.equal(plan.rollback.mode, "rollback-plan");
  assert.equal(plan.rollback.decision, "prepared");
});

test("blocks promotion when canary build identity does not match the slot plan", () => {
  const slotPlan = buildSlotRolloutPlan(baseSlotOptions);
  const canaryReport = buildMatchingCanary(slotPlan, {
    build: {
      id: "other-build",
      sha: slotPlan.release.sha,
      source: "GOVERNANCE_BUILD_ID",
    },
  });
  const plan = buildPromotionPlan({
    ...basePromotionOptions,
    slotPlan,
    canaryReport,
  });

  assert.equal(plan.decision, "block");
  assert.ok(plan.blockedReasons.some((reason) => reason.includes("canary-build-id")));
});

test("blocks promotion into the already active slot and upstream", () => {
  const slotPlan = buildSlotRolloutPlan(baseSlotOptions);
  const canaryReport = buildMatchingCanary(slotPlan);
  const plan = buildPromotionPlan({
    ...basePromotionOptions,
    previousSlot: "green",
    previousUpstream: "127.0.0.1:3006",
    slotPlan,
    canaryReport,
  });

  assert.equal(plan.decision, "block");
  assert.ok(plan.blockedReasons.some((reason) => reason.includes("previous-slot")));
  assert.ok(plan.blockedReasons.some((reason) => reason.includes("previous-upstream")));
});

test("keeps external scheduler promotion free of standby restart", () => {
  const slotPlan = buildSlotRolloutPlan({
    ...baseSlotOptions,
    schedulerRole: "external",
  });
  const canaryReport = buildMatchingCanary(slotPlan);
  const plan = buildPromotionPlan({
    ...basePromotionOptions,
    previousSchedulerRole: "external",
    promotedSchedulerRole: "external",
    slotPlan,
    canaryReport,
  });

  assert.equal(plan.decision, "ready-to-promote");
  assert.equal(plan.schedulerTransfer.method, "external-stays-owner");
  assert.equal(plan.schedulerTransfer.requiresStandbyRestart, false);
  assert.equal(plan.commands.some((command) => command.id === "restart-standby-with-promoted-scheduler-role"), false);
});

test("writes promotion and rollback plan artifacts", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ra344-promotion-plan-"));
  const slotPlan = buildSlotRolloutPlan(baseSlotOptions);
  const canaryReport = buildMatchingCanary(slotPlan);
  const plan = buildPromotionPlan({
    ...basePromotionOptions,
    slotPlan,
    canaryReport,
  });
  const written = writePromotionPlanArtifacts(plan, tempDir);

  assert.ok(fs.existsSync(written.promotedSlotEnvPath));
  assert.ok(fs.existsSync(written.promotionPlanPath));
  assert.ok(fs.existsSync(written.rollbackPlanPath));
  assert.match(fs.readFileSync(written.promotedSlotEnvPath, "utf8"), /GOVERNANCE_SLOT_ID=green/);
  const promotionJson = JSON.parse(fs.readFileSync(written.promotionPlanPath, "utf8"));
  const rollbackJson = JSON.parse(fs.readFileSync(written.rollbackPlanPath, "utf8"));
  assert.equal(promotionJson.artifacts.promotedSlotEnvBytes > 0, true);
  assert.equal(rollbackJson.switchMethod, "caddy-active-upstream");
});

function buildMatchingCanary(slotPlan, readinessOverrides = {}) {
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
      ...readinessOverrides,
    },
  });
}
