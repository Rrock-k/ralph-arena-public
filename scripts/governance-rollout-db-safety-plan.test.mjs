#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  buildDbSafetyPlan,
  writeDbSafetyArtifacts,
} from "./governance-rollout-db-safety-plan.mjs";

const baseOptions = {
  appDir: "/opt/agents-arena",
  backupPath: "/opt/agents-arena/work/rollouts/governance-production/backup.dump",
  databaseUrlEnv: "DATABASE_URL",
  generatedAt: "2026-06-15T00:00:00.000Z",
  previousRef: "abc123",
  releaseSha: "def456",
  scratchDatabaseUrlEnv: "SCRATCH_DATABASE_URL",
};

test("builds a non-intervention DB safety plan", () => {
  const plan = buildDbSafetyPlan(baseOptions);

  assert.equal(plan.taskId, "RA-344");
  assert.equal(plan.mode, "db-safety-plan");
  assert.equal(plan.nonIntervention, true);
  assert.equal(plan.decision, "prepared");
  assert.equal(plan.release.sha, "def456");
  assert.equal(plan.expectedReports.backup, "/opt/agents-arena/work/rollouts/governance-production/db-backup.json");
  assert.equal(
    plan.expectedReports.scratchRestore,
    "/opt/agents-arena/work/rollouts/governance-production/scratch-restore.json",
  );
  assert.match(plan.artifacts.backupScript, /pg_dump --format=custom/);
  assert.match(plan.artifacts.scratchRestoreScript, /pg_restore --clean --if-exists/);
});

test("rejects unsafe env names and relative backup paths", () => {
  assert.throws(() => buildDbSafetyPlan({
    ...baseOptions,
    databaseUrlEnv: "DATABASE_URL;rm",
  }), /database url env/);
  assert.throws(() => buildDbSafetyPlan({
    ...baseOptions,
    backupPath: "backup.dump",
  }), /backup path/);
  assert.throws(() => buildDbSafetyPlan({
    ...baseOptions,
    backupPath: "/opt/agents-arena/work/rollouts/governance-production/bad\"backup.dump",
  }), /backup path contains unsupported characters/);
});

test("accepts underscores in release refs", () => {
  const plan = buildDbSafetyPlan({
    ...baseOptions,
    previousRef: "release_2026_06_15",
  });

  assert.equal(plan.release.previousRef, "release_2026_06_15");
});

test("writes DB safety plan and execution artifacts without executing them", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ra344-db-safety-"));
  const plan = buildDbSafetyPlan(baseOptions);
  const written = writeDbSafetyArtifacts(plan, tempDir);

  assert.ok(fs.existsSync(written.planPath));
  assert.ok(fs.existsSync(written.backupScriptPath));
  assert.ok(fs.existsSync(written.scratchRestoreScriptPath));
  assert.ok(fs.existsSync(written.summaryPath));
  assert.match(fs.readFileSync(written.backupScriptPath, "utf8"), /db-backup/);
  assert.match(fs.readFileSync(written.scratchRestoreScriptPath, "utf8"), /scratch-restore/);
  const report = JSON.parse(fs.readFileSync(written.planPath, "utf8"));
  assert.equal(report.decision, "prepared");
  assert.equal(report.artifacts.backupScriptBytes > 0, true);
});
