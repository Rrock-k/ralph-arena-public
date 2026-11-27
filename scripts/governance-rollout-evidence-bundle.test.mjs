#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  buildRolloutEvidenceBundle,
  writeRolloutEvidenceBundle,
} from "./governance-rollout-evidence-bundle.mjs";

test("builds a ready non-intervention rollout evidence bundle", () => {
  const dir = createRolloutFixture();
  const bundle = buildRolloutEvidenceBundle({
    reportDir: dir,
    generatedAt: "2026-06-15T00:00:00.000Z",
  });

  assert.equal(bundle.taskId, "RA-344");
  assert.equal(bundle.mode, "rollout-evidence-bundle");
  assert.equal(bundle.nonIntervention, true);
  assert.equal(bundle.decision, "ready-to-execute");
  assert.equal(bundle.release.sha, releaseSha);
  assert.equal(bundle.target.slot, "green");
  assert.equal(bundle.oldSlotRetention.required, true);
  assert.equal(bundle.oldSlotRetention.stopAllowed, false);
  assert.deepEqual(bundle.blockedReasons, []);
});

test("blocks when required evidence files are missing", () => {
  const dir = createRolloutFixture();
  fs.rmSync(path.join(dir, "route-probes.json"));

  const bundle = buildRolloutEvidenceBundle({ reportDir: dir });

  assert.equal(bundle.decision, "block");
  assert.ok(bundle.blockedReasons.some((reason) => reason.includes("report-routeProbes")));
});

test("blocks incoherent release identity across reports", () => {
  const dir = createRolloutFixture();
  const canary = readJson(dir, "canary-standby.json");
  canary.readiness.releaseSha = "bad-release";
  writeJson(dir, "canary-standby.json", canary);

  const bundle = buildRolloutEvidenceBundle({ reportDir: dir });

  assert.equal(bundle.decision, "block");
  assert.ok(bundle.blockedReasons.some((reason) => reason.startsWith("release-sha:")));
});

test("requires old slot stop script only when drain proof allows stop", () => {
  const dir = createRolloutFixture({ stopAllowed: true });

  const blocked = buildRolloutEvidenceBundle({ reportDir: dir });
  assert.equal(blocked.decision, "block");
  assert.ok(blocked.blockedReasons.some((reason) => reason.includes("old-slot-stop-execution.sh")));

  fs.writeFileSync(path.join(dir, "old-slot-stop-execution.sh"), "#!/usr/bin/env bash\nsystemctl stop governance-web@blue\n");
  const ready = buildRolloutEvidenceBundle({ reportDir: dir });
  assert.equal(ready.decision, "ready-to-execute");
});

test("requires DB safety evidence when preflight requires it", () => {
  const dir = createRolloutFixture();
  const preflight = readJson(dir, "preflight.json");
  preflight.migration.backup.status = "passed";
  preflight.migration.scratchRestore.status = "passed";
  writeJson(dir, "preflight.json", preflight);

  const bundle = buildRolloutEvidenceBundle({ reportDir: dir });

  assert.equal(bundle.decision, "block");
  assert.ok(bundle.blockedReasons.some((reason) => reason.includes("db-safety-plan.json")));
  assert.ok(bundle.blockedReasons.some((reason) => reason.includes("db-backup.json")));
  assert.ok(bundle.blockedReasons.some((reason) => reason.includes("scratch-restore.json")));
});

test("writes bundle report and summary artifacts", () => {
  const dir = createRolloutFixture();
  const bundle = buildRolloutEvidenceBundle({ reportDir: dir });
  const written = writeRolloutEvidenceBundle(bundle, dir);

  assert.equal(path.basename(written.reportPath), "rollout-evidence-bundle.json");
  assert.equal(path.basename(written.summaryPath), "rollout-evidence-summary.md");
  assert.equal(JSON.parse(fs.readFileSync(written.reportPath, "utf8")).decision, "ready-to-execute");
  assert.ok(fs.readFileSync(written.summaryPath, "utf8").includes("Decision: ready-to-execute"));
});

const releaseSha = "def4567890ab";
const buildId = "build-123";
const previousRef = "abc123";
const targetUpstream = "http://127.0.0.1:3006";
const previousUpstream = "http://127.0.0.1:3000";

function createRolloutFixture(options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ra344-evidence-bundle-"));
  const stopAllowed = options.stopAllowed === true;

  writeJson(dir, "preflight.json", {
    taskId: "RA-344",
    mode: "static",
    releaseSha,
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
  });
  writeJson(dir, "local-topology.json", {
    taskId: "RA-344",
    mode: "local-topology-inspector",
    operator: "./scripts/docker-local-stack.sh inspect topology",
    nonIntervention: true,
    blockedReasons: [],
    decision: "captured",
  });
  writeJson(dir, "route-probes.json", {
    taskId: "RA-344",
    nonIntervention: true,
    probes: [],
  });
  writeJson(dir, "slot-rollout-plan.json", {
    taskId: "RA-344",
    mode: "slot-rollout-plan",
    operator: "scripts/governance-rollout-slot-plan.mjs",
    nonIntervention: true,
    release: {
      sha: releaseSha,
      buildId,
      previousRef,
      migrationStatus: "compatible",
    },
    slot: {
      id: "green",
      port: 3006,
      upstream: targetUpstream,
      readinessUrl: "http://127.0.0.1:3006/api/readiness",
      schedulerRole: "standby",
    },
    router: {
      activeUpstreamOwner: "caddy-template",
    },
    blockedReasons: [],
    decision: "prepared",
  });
  writeJson(dir, "canary-standby.json", {
    taskId: "RA-344",
    mode: "readiness-canary",
    operator: "scripts/governance-rollout-canary.mjs",
    nonIntervention: true,
    target: {
      slot: "green",
      schedulerRole: "standby",
    },
    readiness: {
      releaseSha,
      buildId,
      slotId: "green",
      schedulerRole: "standby",
      migrationStatus: "compatible",
    },
    blockedReasons: [],
    decision: "allow-promotion",
  });
  writeJson(dir, "route-canary-matrix.json", {
    taskId: "RA-344",
    mode: "route-canary-matrix",
    operator: "scripts/governance-rollout-route-canary.mjs",
    nonIntervention: true,
    blockedReasons: [],
    decision: "allow-promotion",
  });
  const rollbackPlan = {
    taskId: "RA-344",
    mode: "rollback-plan",
    operator: "scripts/governance-rollout-promotion-plan.mjs",
    nonIntervention: true,
    releaseSha,
    rollbackTarget: previousUpstream,
    previousSlot: "blue",
    previousSchedulerRole: "active",
    schemaCompatible: true,
    switchMethod: "caddy-active-upstream",
    commands: [
      { id: "validate-rollback-caddy", mutates: false, command: "caddy validate --config /rollback" },
      { id: "rollback-active-upstream", mutates: true, command: "install -m 0644 /rollback /active && systemctl reload caddy" },
      { id: "post-rollback-canary", mutates: false, command: "node scripts/governance-rollout-canary.mjs --url https://app.arena.example.test/api/readiness --slot blue --scheduler-role active" },
    ],
    blockedReasons: [],
    decision: "prepared",
  };
  writeJson(dir, "promotion-plan.json", {
    taskId: "RA-344",
    mode: "promotion-plan",
    operator: "scripts/governance-rollout-promotion-plan.mjs",
    nonIntervention: true,
    release: {
      sha: releaseSha,
      buildId,
      previousRef,
      migrationStatus: "compatible",
    },
    target: {
      slot: "green",
      upstream: targetUpstream,
      prePromotionSchedulerRole: "standby",
      promotedSchedulerRole: "active",
    },
    previous: {
      slot: "blue",
      upstream: previousUpstream,
      schedulerRole: "active",
    },
    router: {
      switchMethod: "caddy-active-upstream",
    },
    rollback: rollbackPlan,
    blockedReasons: [],
    decision: "ready-to-promote",
  });
  writeJson(dir, "rollback-plan.json", rollbackPlan);
  writeJson(dir, "vps-execution-plan.json", {
    taskId: "RA-344",
    mode: "vps-execution-plan",
    operator: "scripts/governance-rollout-vps-execution-plan.mjs",
    nonIntervention: true,
    release: {
      sha: releaseSha,
      buildId,
      previousRef,
      migrationStatus: "compatible",
    },
    target: {
      slot: "green",
      upstream: targetUpstream,
    },
    previous: {
      slot: "blue",
      upstream: previousUpstream,
    },
    switchMethod: "caddy-active-upstream",
    oldSlotRetention: {
      required: !stopAllowed,
      stopAllowed,
      reason: stopAllowed ? "runner-inventory-drained" : "runner-inventory-pending",
    },
    oldSlotStop: {
      status: stopAllowed ? "ready-to-stop" : "not-run",
      stopAllowed,
      retentionReason: stopAllowed ? "runner-inventory-drained" : "runner-inventory-pending",
    },
    blockedReasons: [],
    decision: "prepared",
  });
  if (stopAllowed) {
    writeJson(dir, "runner-inventory.json", {
      taskId: "RA-344",
      mode: "runner-inventory",
      operator: "scripts/governance-rollout-runner-inventory.mjs",
      nonIntervention: true,
      counts: {
        directOldSlotGovernanceUrl: 0,
        missingGovernanceUrl: 0,
      },
      oldSlotStop: {
        allowed: true,
      },
      blockedReasons: [],
      decision: "drained",
    });
  }
  fs.writeFileSync(path.join(dir, "rollout-execution.sh"), "#!/usr/bin/env bash\necho rollout\n");
  fs.writeFileSync(path.join(dir, "rollback-execution.sh"), "#!/usr/bin/env bash\necho rollback\n");
  fs.writeFileSync(path.join(dir, "summary.md"), "# Summary\n");
  return dir;
}

function readJson(dir, fileName) {
  return JSON.parse(fs.readFileSync(path.join(dir, fileName), "utf8"));
}

function writeJson(dir, fileName, value) {
  fs.writeFileSync(path.join(dir, fileName), `${JSON.stringify(value, null, 2)}\n`);
}
