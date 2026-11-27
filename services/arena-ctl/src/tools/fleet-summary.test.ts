import assert from "node:assert/strict";
import test from "node:test";
import { buildFleetSummary } from "./fleet-summary.js";

test("buildFleetSummary reports a healthy fleet without active damage", () => {
  const summary = buildFleetSummary({
    metrics: { totalProjects: 3 },
    workers: [],
    projects: [
      {
        visibility: "featured",
        archivedAt: null,
        app: { powerIntent: "ON", agentIntent: "OFF", runtimeState: "RUNNING", agentState: "IDLE", previewHealth: "HEALTHY", blockers: [] },
      },
      {
        visibility: "public",
        archivedAt: null,
        app: { powerIntent: "OFF", agentIntent: "OFF", runtimeState: "ABSENT", agentState: "IDLE", previewHealth: "UNKNOWN", blockers: [] },
      },
      {
        visibility: "public",
        archivedAt: "2026-04-21T00:00:00.000Z",
        app: { powerIntent: "OFF", agentIntent: "OFF", runtimeState: "ABSENT", agentState: "IDLE", previewHealth: "UNKNOWN", blockers: [] },
      },
    ],
  }, {
    totals: { flaggedProjects: 0, distinctClasses: 0 },
    classes: [],
  });

  assert.equal(summary.truth.runningHealthy, 1);
  assert.equal(summary.truth.parked, 1);
  assert.equal(summary.truth.archived, 1);
  assert.equal(summary.truth.activeBroken, 0);
  assert.equal(summary.truth.featuredHealthy, 1);
  assert.equal(summary.truth.publicHealthy, 0);
  assert.equal(summary.truth.workerServiceDriftCount, 0);
  assert.equal(summary.classification.status, "healthy_live_fleet");
  assert.equal(summary.recommendedNextAction, "no_action");
  assert.deepEqual(summary.allowedActions, ["no_action", "inspect_parked_cohorts", "cleanup_orphans"]);
});

test("buildFleetSummary keeps residual cohorts explicit when active damage remains", () => {
  const summary = buildFleetSummary({
    metrics: { totalProjects: 2 },
    workers: [],
    projects: [
      {
        visibility: "featured",
        archivedAt: null,
        app: { powerIntent: "ON", agentIntent: "ON", runtimeState: "ABSENT", agentState: "IDLE", previewHealth: "UNKNOWN", blockers: ["INFRA"] },
      },
      {
        visibility: "public",
        archivedAt: null,
        app: { powerIntent: "ON", agentIntent: "ON", runtimeState: "RUNNING", agentState: "RUNNING", previewHealth: "HEALTHY", blockers: [] },
      },
    ],
  }, {
    totals: { flaggedProjects: 1, distinctClasses: 1 },
    classes: [
      {
        code: "preview_restore_needed",
        count: 1,
        severity: "high",
        meaning: "power on rows are not converging to live preview",
        recommendedAction: "restore_preview_wave",
      },
    ],
  });

  assert.equal(summary.truth.runningHealthy, 1);
  assert.equal(summary.truth.activeBroken, 1);
  assert.equal(summary.truth.activeAgentRuns, 1);
  assert.equal(summary.classification.status, "residual_damage_present");
  assert.deepEqual(summary.classification.residualCohorts, [
    {
      code: "preview_restore_needed",
      count: 1,
      severity: "high",
      meaning: "power on rows are not converging to live preview",
    },
  ]);
  assert.equal(summary.recommendedNextAction, "restore_preview_wave");
  assert.deepEqual(summary.allowedActions, ["restore_preview_wave", "inspect_active_broken_rows"]);
});

test("buildFleetSummary uses canonical app snapshot instead of stale component order baggage", () => {
  const summary = buildFleetSummary({
    metrics: { totalProjects: 1 },
    workers: [],
    projects: [
      {
        visibility: "featured",
        archivedAt: null,
        app: { powerIntent: "OFF", agentIntent: "OFF", runtimeState: "ABSENT", agentState: "IDLE", previewHealth: "UNKNOWN", blockers: [] },
      },
    ],
  }, {
    totals: { flaggedProjects: 0, distinctClasses: 0 },
    classes: [],
  });

  assert.equal(summary.truth.runningHealthy, 0);
  assert.equal(summary.truth.parked, 1);
  assert.equal(summary.truth.activeBroken, 0);
});

test("buildFleetSummary recommends worker maintenance when live fleet is healthy but worker service is stale", () => {
  const summary = buildFleetSummary({
    metrics: { totalProjects: 1 },
    workers: [
      {
        host: "local",
        parityStatus: "mismatch",
        actionableParityReasons: ["worker_sha_mismatch:671fac8a7691"],
      },
    ],
    projects: [
      {
        visibility: "featured",
        archivedAt: null,
        app: { powerIntent: "ON", agentIntent: "OFF", runtimeState: "RUNNING", agentState: "IDLE", previewHealth: "HEALTHY", blockers: [] },
      },
    ],
  }, {
    totals: { flaggedProjects: 0, distinctClasses: 0 },
    classes: [],
  });

  assert.equal(summary.truth.runningHealthy, 1);
  assert.equal(summary.truth.activeBroken, 0);
  assert.equal(summary.truth.workerServiceDriftCount, 1);
  assert.equal(summary.classification.status, "healthy_live_fleet");
  assert.equal(summary.recommendedNextAction, "restart_worker_service");
  assert.match(summary.why.join(" "), /worker service\(s\) still report stale generation/i);
  assert.match(summary.operatorNotes.join(" "), /Workers with stale service generation: local/i);
});

test("buildFleetSummary waits for a safe worker maintenance window when agent work is active", () => {
  const summary = buildFleetSummary({
    metrics: { totalProjects: 1 },
    workers: [
      {
        host: "local",
        parityStatus: "mismatch",
        actionableParityReasons: ["worker_sha_mismatch:671fac8a7691"],
      },
    ],
    projects: [
      {
        visibility: "featured",
        archivedAt: null,
        app: { powerIntent: "ON", agentIntent: "ON", runtimeState: "RUNNING", agentState: "RUNNING", previewHealth: "HEALTHY", blockers: [] },
      },
    ],
  }, {
    totals: { flaggedProjects: 0, distinctClasses: 0 },
    classes: [],
  });

  assert.equal(summary.truth.runningHealthy, 1);
  assert.equal(summary.truth.activeBroken, 0);
  assert.equal(summary.truth.activeAgentRuns, 1);
  assert.equal(summary.truth.workerServiceDriftCount, 1);
  assert.equal(summary.recommendedNextAction, "wait_for_worker_maintenance_window");
  assert.deepEqual(summary.allowedActions, ["no_action", "inspect_parked_cohorts", "wait_for_worker_maintenance_window", "cleanup_orphans"]);
  assert.match(summary.why.join(" "), /active agent run\(s\) must finish before worker restart/i);
});
