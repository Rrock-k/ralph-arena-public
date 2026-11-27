#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  buildDirtyWorktreeGate,
  buildMigrationGateReport,
  buildStaticPreflightReport,
  classifyDirtyWorktreeEntries,
  classifyMigrationFiles,
  classifyMigrationSql,
  validateDbSafetyReport,
  validateCompatibilityMatrix,
  validateLocalTopologyEvidence,
} from "./governance-rollout-preflight.mjs";

const backupSha256 = "a".repeat(64);

test("classifies additive-compatible migration SQL", () => {
  const result = classifyMigrationSql(`
    CREATE TABLE "Widget" ("id" TEXT NOT NULL PRIMARY KEY);
    CREATE INDEX "Widget_createdAt_idx" ON "Widget"("createdAt");
    ALTER TABLE "Project" ADD COLUMN "rolloutLabel" TEXT;
    ALTER TYPE "RunnerBackend" ADD VALUE 'blue_green';
  `);

  assert.equal(result.classification, "additive-compatible");
  assert.deepEqual(result.reasons, [
    "creates a table",
    "creates a non-unique index",
    "adds nullable/defaulted column",
    "adds enum value",
  ]);
});

test("classifies destructive migration SQL", () => {
  const result = classifyMigrationSql(`
    ALTER TABLE "Project" DROP COLUMN "state";
    ALTER TABLE "RuntimeIntent" ADD COLUMN "slotId" TEXT NOT NULL;
    CREATE UNIQUE INDEX "RuntimeIntent_slotId_key" ON "RuntimeIntent"("slotId");
  `);

  assert.equal(result.classification, "destructive");
  assert.deepEqual(result.reasons, [
    "drops a column",
    "adds non-null column without compatible default",
    "adds unique index that can fail existing data",
  ]);
});

test("classifies raw data rewrites as unknown", () => {
  const result = classifyMigrationSql(`
    UPDATE "Project" SET "visibility" = 'public' WHERE "visibility" IS NULL;
  `);

  assert.equal(result.classification, "unknown");
  assert.deepEqual(result.reasons, ["data rewrite requires human classification"]);
});

test("classifies migration files as a blocking destructive set", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ra344-migration-"));
  const migrationPath = path.join(
    tempDir,
    "apps/governance-platform/prisma/migrations/20260615000000_breaking/migration.sql",
  );
  fs.mkdirSync(path.dirname(migrationPath), { recursive: true });
  fs.writeFileSync(migrationPath, 'ALTER TABLE "Project" RENAME COLUMN "name" TO "title";\n');

  const result = classifyMigrationFiles([
    {
      absolutePath: migrationPath,
      relativePath: "apps/governance-platform/prisma/migrations/20260615000000_breaking/migration.sql",
    },
  ]);

  assert.equal(result.classifier, "blocked");
  assert.equal(result.classification, "destructive");
  assert.equal(result.requiresMaintenanceWindow, true);
  assert.equal(result.requiresTwoStepMigration, true);
});

test("static preflight accepts the local production runtime default", () => {
  const report = buildStaticPreflightReport({
    generatedAt: "2026-06-15T00:00:00.000Z",
  });
  const blockedIds = new Set(
    report.checks
      .filter((check) => check.status === "block")
      .map((check) => check.id),
  );

  assert.equal(report.taskId, "RA-344");
  assert.equal(report.nonIntervention, true);
  assert.equal(report.decision, "block");
  assert.equal(report.migration.classifier, "not-run");
  assert.equal(report.runtimeDefault.nodeEnv, "production");
  assert.equal(report.runtimeDefault.usesNextDev, false);
  assert.equal(report.runtimeDefault.usesTurbopack, false);
  assert.equal(report.runtimeDefault.persistsNextCache, false);
  assert.equal(report.runtimeDefault.usesImageRuntime, true);
  assert.equal(report.runtimeDefault.usesMountedRepoRuntime, false);
  assert.equal(report.runtimeDefault.imageBuildGuard, true);
  assert.equal(report.runtimeDefault.imageRevisionGuard, true);
  assert.equal(report.runtimeDefault.canaryRevisionGuard, true);
  assert.equal(report.runtimeDefault.readinessMarkerDefaultGuard, true);
  assert.equal(report.runtimeDefault.committedSourceBuildContext, true);
  assert.equal(report.runtimeDefault.governanceImageBuildBeforeDockerSetup, true);
  assert.equal(report.runtimeDefault.rolloutMarkerEnv.wired, true);
  assert.deepEqual(report.runtimeDefault.rolloutMarkerEnv.missing, []);
  assert.equal(report.buildArtifact.hasReadinessRoute, true);
  assert.equal(report.buildArtifact.localProductionImage.rootContext, true);
  assert.equal(report.buildArtifact.localProductionImage.rootDockerignore, true);
  assert.equal(report.buildArtifact.localProductionImage.excludesDirectStaticPublicAssets, true);
  assert.equal(report.buildArtifact.directStaticPublicAssets.imagePolicy, "excluded-from-governance-image");
  assert.equal(blockedIds.has("governance-local-production-image"), false);
  assert.equal(blockedIds.has("governance-root-dockerignore"), false);
  assert.equal(blockedIds.has("governance-image-direct-static-boundary"), false);
  assert.equal(report.router.activeUpstreamOwner, "caddy-template");
  assert.equal(report.router.shortHtmlDirectStatic, true);
  assert.equal(blockedIds.has("short-html-direct-static"), false);
  assert.equal(blockedIds.has("governance-node-env"), false);
  assert.equal(blockedIds.has("governance-default-runtime"), false);
  assert.equal(blockedIds.has("governance-image-runtime"), false);
  assert.equal(blockedIds.has("governance-image-build-guard"), false);
  assert.equal(blockedIds.has("governance-image-revision-guard"), false);
  assert.equal(blockedIds.has("governance-canary-revision-guard"), false);
  assert.equal(blockedIds.has("governance-next-cache"), false);
  assert.equal(blockedIds.has("governance-rollout-marker-env"), false);
  assert.equal(blockedIds.has("migration-startup-command"), false);
  assert.equal(report.migration.startupCommands.length, 0);
  assert.equal(blockedIds.has("migration-deploy-gate"), false);
  assert.equal(report.migration.deployCommands.length, 0);
  assert.equal(report.dbSafetyPlan.executablePresent, true);
  assert.equal(report.dbSafetyPlan.testPresent, true);
  assert.equal(report.dbSafetyPlan.documented, true);
  assert.equal(blockedIds.has("db-safety-plan"), false);
  assert.equal(report.router.directRestartGuard, true);
  assert.equal(blockedIds.has("direct-restart-guard"), false);
  assert.equal(report.scheduler.role, "configured");
  assert.equal(report.scheduler.roleSource, "GOVERNANCE_SCHEDULER_ROLE");
  assert.equal(report.scheduler.envContracted, true);
  assert.equal(report.scheduler.dbLeaseGate, "present");
  assert.equal(report.scheduler.hasAdvisorySchedulerLease, true);
  assert.equal(blockedIds.has("scheduler-db-lease"), false);
  assert.equal(blockedIds.has("scheduler-role"), false);
  assert.equal(report.compatibility.matrixResult, "passed");
  assert.equal(report.compatibility.requiredEdges, 13);
  assert.equal(blockedIds.has("compatibility-matrix"), false);
  assert.equal(report.canary.executablePresent, true);
  assert.equal(report.canary.testPresent, true);
  assert.equal(report.canary.documented, true);
  assert.equal(report.canary.localWrapperRepeatable, true);
  assert.equal(blockedIds.has("readiness-canary"), false);
  assert.equal(report.routeProbeCollector.executablePresent, true);
  assert.equal(report.routeProbeCollector.testPresent, true);
  assert.equal(report.routeProbeCollector.documented, true);
  assert.equal(blockedIds.has("route-probe-collector"), false);
  assert.equal(report.routeCanaryMatrix.executablePresent, true);
  assert.equal(report.routeCanaryMatrix.testPresent, true);
  assert.equal(report.routeCanaryMatrix.documented, true);
  assert.equal(blockedIds.has("route-canary-matrix"), false);
  assert.equal(report.localTopologyInspector.executablePresent, true);
  assert.equal(report.localTopologyInspector.testPresent, true);
  assert.equal(report.localTopologyInspector.documented, true);
  assert.equal(report.localTopologyInspector.wrapperEarly, true);
  assert.equal(blockedIds.has("local-topology-inspector"), false);
  assert.equal(report.localTopologyEvidence.status, "not-run");
  assert.equal(blockedIds.has("local-topology-evidence"), true);
  assert.equal(report.slotRollout.executablePresent, true);
  assert.equal(report.slotRollout.testPresent, true);
  assert.equal(report.slotRollout.documented, true);
  assert.equal(blockedIds.has("slot-rollout-plan"), false);
  assert.equal(report.promotionPlan.executablePresent, true);
  assert.equal(report.promotionPlan.testPresent, true);
  assert.equal(report.promotionPlan.documented, true);
  assert.equal(blockedIds.has("promotion-plan"), false);
  assert.equal(report.vpsExecutionPlan.executablePresent, true);
  assert.equal(report.vpsExecutionPlan.testPresent, true);
  assert.equal(report.vpsExecutionPlan.documented, true);
  assert.equal(blockedIds.has("vps-execution-plan"), false);
  assert.equal(report.runnerInventory.executablePresent, true);
  assert.equal(report.runnerInventory.testPresent, true);
  assert.equal(report.runnerInventory.documented, true);
  assert.equal(blockedIds.has("runner-inventory"), false);
  assert.equal(report.evidenceBundle.executablePresent, true);
  assert.equal(report.evidenceBundle.testPresent, true);
  assert.equal(report.evidenceBundle.documented, true);
  assert.equal(blockedIds.has("evidence-bundle"), false);
  assert.equal(report.rolloutDryRun.executablePresent, true);
  assert.equal(report.rolloutDryRun.testPresent, true);
  assert.equal(report.rolloutDryRun.documented, true);
  assert.equal(blockedIds.has("rollout-dry-run"), false);
});

test("dirty worktree classifier highlights governance production build inputs", () => {
  const result = classifyDirtyWorktreeEntries([
    " M docs/backlog/ralph-arena.md",
    "M docs/local-docker-stack.md",
    "?? apps/governance-platform/public/short-html/example.html",
    "?? apps/governance-platform/public/docs.html",
    " M scripts/governance-rollout-preflight.mjs",
    "?? scratch.txt",
  ]);

  assert.deepEqual(result.directStaticPublicInputs, [
    "apps/governance-platform/public/short-html/example.html",
  ]);
  assert.deepEqual(result.productionBuildInputs, [
    "apps/governance-platform/public/docs.html",
  ]);
  assert.deepEqual(result.rolloutControlInputs, [
    "scripts/governance-rollout-preflight.mjs",
  ]);
  assert.deepEqual(result.docsOrWorkNotes, [
    "docs/backlog/ralph-arena.md",
    "docs/local-docker-stack.md",
  ]);
  assert.deepEqual(result.otherPaths, ["scratch.txt"]);
});

test("dirty worktree gate reports direct public static inputs without blocking governance image rollout", () => {
  const classification = classifyDirtyWorktreeEntries([
    " M docs/backlog/ralph-arena.md",
    "?? apps/governance-platform/public/short-html/example.html",
  ]);
  const gate = buildDirtyWorktreeGate(classification, {
    committedSourceBuildContext: true,
  });

  assert.equal(gate.allowed, true);
  assert.deepEqual(gate.directStaticPublicInputs, [
    "apps/governance-platform/public/short-html/example.html",
  ]);
  assert.deepEqual(gate.ignoredProductionBuildInputs, []);
  assert.deepEqual(gate.blockingPaths, []);
});

test("dirty worktree gate allows ignored production inputs for committed-source build", () => {
  const classification = classifyDirtyWorktreeEntries([
    " M docs/backlog/ralph-arena.md",
    "?? apps/governance-platform/public/docs.html",
  ]);
  const gate = buildDirtyWorktreeGate(classification, {
    committedSourceBuildContext: true,
  });

  assert.equal(gate.allowed, true);
  assert.deepEqual(gate.ignoredProductionBuildInputs, [
    "apps/governance-platform/public/docs.html",
  ]);
  assert.deepEqual(gate.blockingPaths, []);
});

test("dirty worktree gate blocks rollout-control dirty paths", () => {
  const classification = classifyDirtyWorktreeEntries([
    " M scripts/docker-local-stack.sh",
    "?? apps/governance-platform/public/short-html/example.html",
  ]);
  const gate = buildDirtyWorktreeGate(classification, {
    committedSourceBuildContext: true,
  });

  assert.equal(gate.allowed, false);
  assert.deepEqual(gate.blockingPaths, ["scripts/docker-local-stack.sh"]);
});

test("local topology evidence validator accepts production-ready captured topology", () => {
  const result = validateLocalTopologyEvidence(localTopologyReport());

  assert.equal(result.status, "passed");
  assert.deepEqual(result.failures, []);
  assert.equal(result.governanceServices[0].nodeEnv, "production");
  assert.equal(result.activeSchedulerOwners[0].schedulerRole, "active");
});

test("local topology evidence records missing runtime governance URL as retention warning", () => {
  const result = validateLocalTopologyEvidence(localTopologyReport({
    runtimeContainers: [
      runtimeContainer({
        name: "preview-missing-url",
        env: ["ARENA_PROJECT_ID=proj_missing"],
      }),
    ],
  }));

  assert.equal(result.status, "passed");
  assert.deepEqual(result.failures, []);
  assert.deepEqual(result.missingGovernanceUrl, ["preview-missing-url"]);
  assert.ok(result.warnings.some((warning) => warning.includes("preview-missing-url")));
});

test("local topology evidence validator blocks live drift from production rollout markers", () => {
  const report = localTopologyReport({
    governanceEnv: {
      NODE_ENV: "development",
      PORT: "3000",
      GOVERNANCE_INTERNAL_URL: "http://governance-platform:3000",
    },
    runtimeContainers: [
      runtimeContainer({
        name: "preview-missing-url",
        env: ["ARENA_PROJECT_ID=proj_missing"],
      }),
    ],
  });
  const result = validateLocalTopologyEvidence(report);

  assert.equal(result.status, "blocked");
  assert.ok(result.failures.some((failure) => failure.includes("NODE_ENV must be production")));
  assert.ok(result.failures.some((failure) => failure.includes("GOVERNANCE_SCHEDULER_ROLE")));
  assert.ok(result.failures.some((failure) => failure.includes("GOVERNANCE_SLOT_ID")));
  assert.ok(result.failures.some((failure) => failure.includes("GOVERNANCE_BUILD_ID or GOVERNANCE_RELEASE_SHA")));
  assert.ok(result.failures.some((failure) => failure.includes("GOVERNANCE_MIGRATION_STATUS")));
  assert.ok(result.failures.some((failure) => failure.includes("exactly one running active/external scheduler owner")));
  assert.ok(result.warnings.some((warning) => warning.includes("preview-missing-url")));
});

test("migration gate passes when previous ref has no migration SQL changes", () => {
  const report = buildMigrationGateReport({
    previousRef: "HEAD",
    generatedAt: "2026-06-15T00:00:00.000Z",
  });

  assert.equal(report.mode, "migration-gate");
  assert.equal(report.decision, "allow-migration");
  assert.equal(report.migration.classifier, "passed");
  assert.equal(report.migration.summary, "no migration SQL changed");
  assert.equal(report.migration.backup.status, "not-required");
  assert.equal(report.migration.scratchRestore.status, "not-required");
});

test("migration gate blocks changed migration SQL without backup and scratch restore evidence", () => {
  const fixture = createMigrationFixture(`
    CREATE TABLE "Widget" ("id" TEXT NOT NULL PRIMARY KEY);
  `);
  const report = buildMigrationGateReport({
    repoRoot: fixture.root,
    migrations: [fixture.migration],
    generatedAt: "2026-06-15T00:00:00.000Z",
  });
  const blockedIds = new Set(report.checks
    .filter((check) => check.status === "block")
    .map((check) => check.id));

  assert.equal(report.decision, "block");
  assert.equal(report.migration.classifier, "passed");
  assert.equal(report.migration.backup.status, "not-run");
  assert.equal(report.migration.scratchRestore.status, "not-run");
  assert.equal(blockedIds.has("migration-backup"), true);
  assert.equal(blockedIds.has("migration-scratch-restore"), true);
});

test("migration gate allows changed migration SQL with backup and scratch restore evidence", () => {
  const fixture = createMigrationFixture(`
    CREATE TABLE "Widget" ("id" TEXT NOT NULL PRIMARY KEY);
  `);
  writeDbSafetyReports(fixture.root);
  const report = buildMigrationGateReport({
    repoRoot: fixture.root,
    migrations: [fixture.migration],
    backupReportPath: "backup-report.json",
    scratchRestoreReportPath: "scratch-restore-report.json",
    generatedAt: "2026-06-15T00:00:00.000Z",
  });

  assert.equal(report.decision, "allow-migration");
  assert.equal(report.migration.classifier, "passed");
  assert.equal(report.migration.backup.status, "passed");
  assert.equal(report.migration.scratchRestore.status, "passed");
  assert.deepEqual(report.blockedReasons, []);
});

test("validates DB backup safety report shape", () => {
  const result = validateDbSafetyReport({
    taskId: "RA-344",
    mode: "db-backup",
    nonIntervention: true,
    decision: "passed",
    artifact: {
      path: "/tmp/backup.dump",
      sha256: backupSha256,
    },
    source: {
      database: "ralph_arena",
    },
  }, "db-backup");

  assert.equal(result.status, "passed");
  assert.deepEqual(result.failures, []);
});

test("compatibility matrix gate blocks missing required edges", () => {
  const result = validateCompatibilityMatrix({
    schemaVersion: "ra-344.governance-wire-compatibility.v1",
    taskId: "RA-344",
    mutatingLiveChecksAllowed: false,
    promotionBlockers: [
      "required-fields",
      "enum-values",
      "auth-headers",
      "response-content-type",
    ],
    entries: [],
  });

  assert.equal(result.matrixResult, "blocked");
  assert.ok(result.missingEdges.includes("worker-claim"));
  assert.ok(result.missingEdges.includes("api-proxy"));
});

function createMigrationFixture(sql) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ra344-migration-gate-"));
  const migration = "apps/governance-platform/prisma/migrations/20260615000000_add_widget/migration.sql";
  const migrationPath = path.join(root, migration);
  fs.mkdirSync(path.dirname(migrationPath), { recursive: true });
  fs.writeFileSync(migrationPath, sql);
  return { root, migration };
}

function writeDbSafetyReports(root) {
  fs.writeFileSync(path.join(root, "backup-report.json"), JSON.stringify({
    taskId: "RA-344",
    mode: "db-backup",
    nonIntervention: true,
    decision: "passed",
    artifact: {
      path: "/tmp/backup.dump",
      sha256: backupSha256,
    },
    source: {
      database: "ralph_arena",
    },
  }, null, 2));
  fs.writeFileSync(path.join(root, "scratch-restore-report.json"), JSON.stringify({
    taskId: "RA-344",
    mode: "scratch-restore",
    nonIntervention: true,
    decision: "passed",
    sourceBackupSha256: backupSha256,
    target: {
      kind: "scratch-postgres",
    },
    restore: {
      status: "passed",
    },
  }, null, 2));
}

function localTopologyReport(options = {}) {
  const governanceEnv = options.governanceEnv ?? {
    NODE_ENV: "production",
    PORT: "3000",
    GOVERNANCE_INTERNAL_URL: "http://governance-platform:3000",
    GOVERNANCE_PUBLIC_URL: "https://app.arena.example.test",
    GOVERNANCE_SCHEDULER_ROLE: "active",
    GOVERNANCE_SLOT_ID: "blue",
    GOVERNANCE_BUILD_ID: "build-123",
    GOVERNANCE_MIGRATION_STATUS: "not_required",
  };
  const runtimeContainers = options.runtimeContainers ?? [
    runtimeContainer({
      name: "preview-smoke",
      env: [
        "ARENA_PROJECT_ID=proj_smoke",
        "ARENA_GOVERNANCE_URL=http://governance-platform:3000",
      ],
    }),
  ];
  const governanceService = {
    id: "governance-id",
    name: "agents-arena-governance-platform-1",
    service: "governance-platform",
    running: true,
    status: "running",
    health: "none",
    pid: 123,
    startedAt: "2026-06-15T00:00:00.000Z",
    image: "node:20-slim",
    selectedEnv: governanceEnv,
    composeProject: "agents-arena",
  };
  const schedulerOwners = governanceEnv.GOVERNANCE_SCHEDULER_ROLE
    ? [{
        name: governanceService.name,
        service: governanceService.service,
        running: governanceService.running,
        schedulerRole: governanceEnv.GOVERNANCE_SCHEDULER_ROLE,
        slotId: governanceEnv.GOVERNANCE_SLOT_ID ?? null,
        buildId: governanceEnv.GOVERNANCE_BUILD_ID ?? null,
        migrationStatus: governanceEnv.GOVERNANCE_MIGRATION_STATUS ?? null,
      }]
    : [];

  return {
    taskId: "RA-344",
    mode: "local-topology-inspector",
    generatedAt: "2026-06-15T00:00:00.000Z",
    operator: "./scripts/docker-local-stack.sh inspect topology",
    nonIntervention: true,
    input: {
      projectName: "agents-arena",
      composeFile: "/repo/docker-compose.local.yml",
    },
    counts: {
      inspectedContainers: 1 + runtimeContainers.length,
      composeProjectContainers: 1,
      arenaRuntimeContainers: runtimeContainers.length,
      runningArenaRuntimeContainers: runtimeContainers.filter((container) => container.running).length,
      governanceUrlEnvEntries: runtimeContainers.filter((container) => container.governanceUrlOrigin).length,
      schedulerOwners: schedulerOwners.length,
      apiProxyServices: 0,
    },
    compose: {
      projectName: "agents-arena",
      services: [governanceService],
    },
    governanceUrlEnv: [],
    scheduler: {
      owners: schedulerOwners,
    },
    apiProxy: {
      services: [],
    },
    runtimeContainers,
    checks: [
      {
        id: "read-only-command-set",
        status: "pass",
        reason: "inspector uses docker ps and docker inspect only",
      },
      {
        id: "docker-read-commands",
        status: "pass",
        reason: "docker read commands completed",
      },
    ],
    blockedReasons: [],
    decision: "captured",
  };
}

function runtimeContainer(options = {}) {
  const env = Object.fromEntries((options.env ?? []).map((entry) => {
    const separator = entry.indexOf("=");
    return [entry.slice(0, separator), entry.slice(separator + 1)];
  }));
  const governanceUrl = env.ARENA_GOVERNANCE_URL ?? null;
  return {
    id: options.id ?? "runtime-id",
    name: options.name ?? "preview-smoke",
    running: options.running ?? true,
    status: options.running === false ? "exited" : "running",
    health: "none",
    projectId: env.ARENA_PROJECT_ID ?? "proj_smoke",
    workspaceLabel: options.name ?? "preview-smoke",
    governanceUrl,
    governanceUrlOrigin: governanceUrl ? new URL(governanceUrl).origin : null,
    governancePublicUrl: null,
    runnerVersion: "test",
    labels: {
      arenaProjectId: env.ARENA_PROJECT_ID ?? "proj_smoke",
      arenaProjectSlug: options.name ?? "preview-smoke",
      arenaAgent: "codex",
      arenaHost: "local",
    },
  };
}
