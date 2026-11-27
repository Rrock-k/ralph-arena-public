#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  buildSlotRolloutPlan,
  writeSlotRolloutArtifacts,
} from "./governance-rollout-slot-plan.mjs";

const baseOptions = {
  appDir: "/opt/agents-arena",
  buildId: "build-123",
  migrationStatus: "compatible",
  port: "3006",
  previousRef: "abc123",
  releaseSha: "def456",
  schedulerRole: "standby",
  siteAddress: "app.arena.example.test",
  slotId: "green",
};

test("builds a non-intervention slot rollout plan", () => {
  const plan = buildSlotRolloutPlan({
    ...baseOptions,
    generatedAt: "2026-06-15T00:00:00.000Z",
  });

  assert.equal(plan.taskId, "RA-344");
  assert.equal(plan.mode, "slot-rollout-plan");
  assert.equal(plan.nonIntervention, true);
  assert.equal(plan.decision, "prepared");
  assert.equal(plan.slot.id, "green");
  assert.equal(plan.slot.port, 3006);
  assert.equal(plan.slot.schedulerRole, "standby");
  assert.match(plan.artifacts.slotEnv, /GOVERNANCE_SLOT_ID=green/);
  assert.match(plan.artifacts.slotEnv, /GOVERNANCE_SCHEDULER_ROLE=standby/);
  assert.match(plan.artifacts.activeUpstreamCaddy, /X-Ralph-Governance-Active-Slot "green"/);
  assert.ok(plan.commands.some((command) => command.id === "canary-standby"));
  assert.ok(plan.commands.some((command) => command.id === "promote-active-upstream" && command.mutates));
  assert.match(
    plan.commands.find((command) => command.id === "build-release").command,
    /npm --prefix packages\/contracts run build/,
  );
  assert.match(
    plan.commands.find((command) => command.id === "build-release").command,
    /npm --prefix packages\/ralph-core run build/,
  );
});

test("rejects active governance entrypoint port", () => {
  assert.throws(
    () => buildSlotRolloutPlan({ ...baseOptions, port: "3000" }),
    /reserved/,
  );
});

test("requires standby or external scheduler role", () => {
  assert.throws(
    () => buildSlotRolloutPlan({ ...baseOptions, schedulerRole: "active" }),
    /scheduler role must be one of/,
  );
});

test("requires readiness URL to target readiness route", () => {
  assert.throws(
    () => buildSlotRolloutPlan({ ...baseOptions, readinessUrl: "http://127.0.0.1:3006/api/health" }),
    /\/api\/readiness/,
  );
});

test("writes slot rollout artifacts", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ra344-slot-plan-"));
  const plan = buildSlotRolloutPlan(baseOptions);
  const written = writeSlotRolloutArtifacts(plan, tempDir);

  assert.ok(fs.existsSync(written.slotEnvPath));
  assert.ok(fs.existsSync(written.caddyPath));
  assert.ok(fs.existsSync(written.reportPath));
  assert.match(fs.readFileSync(written.slotEnvPath, "utf8"), /GOVERNANCE_BUILD_ID=build-123/);
  assert.match(fs.readFileSync(written.caddyPath, "utf8"), /reverse_proxy 127\.0\.0\.1:3006/);
  const report = JSON.parse(fs.readFileSync(written.reportPath, "utf8"));
  assert.equal(report.artifacts.slotEnvBytes > 0, true);
});
