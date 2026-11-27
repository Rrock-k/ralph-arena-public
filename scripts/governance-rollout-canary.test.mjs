#!/usr/bin/env node
import assert from "node:assert/strict";
import test from "node:test";

import { buildReadinessCanaryReport } from "./governance-rollout-canary.mjs";

const readyReadiness = {
  schemaVersion: "ra-344.governance-readiness.v1",
  status: "ready",
  generatedAt: "2026-06-15T00:00:00.000Z",
  build: {
    id: "build-123",
    sha: "abcdef123456",
    source: "GOVERNANCE_BUILD_ID",
  },
  slot: {
    id: "green",
  },
  scheduler: {
    role: "standby",
    enabled: false,
  },
  database: {
    status: "reachable",
  },
  migration: {
    status: "compatible",
  },
  blockers: [],
};

test("readiness canary allows matching standby slot", () => {
  const report = buildReadinessCanaryReport({
    readiness: readyReadiness,
    expectedSlot: "green",
    expectedSchedulerRole: "standby",
    expectedReleaseSha: "abcdef123456",
    httpStatus: 200,
    contentType: "application/json; charset=utf-8",
    generatedAt: "2026-06-15T00:00:00.000Z",
  });

  assert.equal(report.taskId, "RA-344");
  assert.equal(report.nonIntervention, true);
  assert.equal(report.decision, "allow-promotion");
  assert.equal(report.readiness.slotId, "green");
  assert.equal(report.target.releaseSha, "abcdef123456");
  assert.deepEqual(report.blockedReasons, []);
});

test("readiness canary blocks wrong release sha", () => {
  const report = buildReadinessCanaryReport({
    readiness: readyReadiness,
    expectedSlot: "green",
    expectedSchedulerRole: "standby",
    expectedReleaseSha: "badcafe12345",
    httpStatus: 200,
    contentType: "application/json",
  });

  assert.equal(report.decision, "block");
  assert.ok(report.blockedReasons.some((reason) => reason.includes("release-sha")));
});

test("readiness canary blocks HTML route-cache responses", () => {
  const report = buildReadinessCanaryReport({
    readiness: null,
    expectedSlot: "green",
    expectedSchedulerRole: "standby",
    httpStatus: 200,
    contentType: "text/html",
  });

  assert.equal(report.decision, "block");
  assert.ok(report.blockedReasons.some((reason) => reason.includes("content-type")));
  assert.ok(report.blockedReasons.some((reason) => reason.includes("readiness-json")));
});

test("readiness canary blocks wrong slot", () => {
  const report = buildReadinessCanaryReport({
    readiness: readyReadiness,
    expectedSlot: "blue",
    expectedSchedulerRole: "standby",
    httpStatus: 200,
    contentType: "application/json",
  });

  assert.equal(report.decision, "block");
  assert.ok(report.blockedReasons.some((reason) => reason.includes("slot-id")));
});

test("readiness canary blocks not-ready payload blockers", () => {
  const report = buildReadinessCanaryReport({
    readiness: {
      ...readyReadiness,
      status: "not_ready",
      blockers: ["missing_build_id"],
      build: { id: null, sha: null, source: null },
    },
    expectedSlot: "green",
    expectedSchedulerRole: "standby",
    httpStatus: 503,
    contentType: "application/json",
  });

  assert.equal(report.decision, "block");
  assert.ok(report.blockedReasons.some((reason) => reason.includes("http-status")));
  assert.ok(report.blockedReasons.some((reason) => reason.includes("build-id")));
  assert.ok(report.blockedReasons.some((reason) => reason.includes("readiness-blockers")));
});

test("readiness canary reports transport errors as blockers", () => {
  const report = buildReadinessCanaryReport({
    readiness: null,
    expectedSlot: "green",
    expectedSchedulerRole: "standby",
    transportError: "connection refused",
  });

  assert.equal(report.decision, "block");
  assert.ok(report.blockedReasons.some((reason) => reason.includes("transport")));
});
