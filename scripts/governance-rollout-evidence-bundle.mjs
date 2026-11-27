#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scriptPath = fileURLToPath(import.meta.url);

const reportFiles = {
  preflight: "preflight.json",
  localTopology: "local-topology.json",
  routeProbes: "route-probes.json",
  canary: "canary-standby.json",
  routeCanary: "route-canary-matrix.json",
  slotPlan: "slot-rollout-plan.json",
  promotionPlan: "promotion-plan.json",
  rollbackPlan: "rollback-plan.json",
  vpsExecutionPlan: "vps-execution-plan.json",
  runnerInventory: "runner-inventory.json",
  dbSafetyPlan: "db-safety-plan.json",
  dbBackup: "db-backup.json",
  scratchRestore: "scratch-restore.json",
};

const requiredReports = [
  "preflight",
  "localTopology",
  "routeProbes",
  "canary",
  "routeCanary",
  "slotPlan",
  "promotionPlan",
  "rollbackPlan",
  "vpsExecutionPlan",
];

const requiredArtifacts = [
  "rollout-execution.sh",
  "rollback-execution.sh",
  "summary.md",
];

export function buildRolloutEvidenceBundle(options = {}) {
  const reportDir = normalizeReportDir(options.reportDir ?? options.dir);
  const loaded = loadReportSet(reportDir);
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const checks = [];

  const reports = {};
  for (const key of requiredReports) {
    reports[key] = requireReport(loaded[key], key, checks);
  }
  for (const key of ["runnerInventory", "dbSafetyPlan", "dbBackup", "scratchRestore"]) {
    reports[key] = optionalReport(loaded[key], key, checks);
  }

  validatePreflight(reports.preflight, checks);
  validateLocalTopology(reports.localTopology, checks);
  validateRouteProbes(reports.routeProbes, checks);
  validateSimpleReport(reports.canary, {
    key: "canary",
    mode: "readiness-canary",
    decision: "allow-promotion",
    label: "standby readiness canary",
  }, checks);
  validateSimpleReport(reports.routeCanary, {
    key: "route-canary",
    mode: "route-canary-matrix",
    decision: "allow-promotion",
    label: "route canary matrix",
  }, checks);
  validateSimpleReport(reports.slotPlan, {
    key: "slot-plan",
    mode: "slot-rollout-plan",
    decision: "prepared",
    label: "slot rollout plan",
  }, checks);
  validateSimpleReport(reports.promotionPlan, {
    key: "promotion-plan",
    mode: "promotion-plan",
    decision: "ready-to-promote",
    label: "promotion plan",
  }, checks);
  validateSimpleReport(reports.rollbackPlan, {
    key: "rollback-plan",
    mode: "rollback-plan",
    decision: "prepared",
    label: "rollback plan",
  }, checks);
  validateSimpleReport(reports.vpsExecutionPlan, {
    key: "vps-execution-plan",
    mode: "vps-execution-plan",
    decision: "prepared",
    label: "VPS execution plan",
  }, checks);

  validateMigrationEvidence(reports, checks);
  validateCrossReportCoherence(reports, checks);
  validateExecutionArtifacts(reportDir, reports.vpsExecutionPlan, checks);

  const blockedReasons = checks
    .filter((check) => check.status === "block")
    .map((check) => `${check.id}: ${check.reason}`);
  const release = summarizeRelease(reports);
  const target = summarizeTarget(reports);
  const oldSlotRetention = summarizeOldSlotRetention(reports);

  return {
    taskId: "RA-344",
    mode: "rollout-evidence-bundle",
    generatedAt,
    operator: "scripts/governance-rollout-evidence-bundle.mjs",
    nonIntervention: true,
    input: {
      reportDir,
    },
    release,
    target,
    previous: summarizePrevious(reports),
    reports: summarizeReports(loaded, reports),
    oldSlotRetention,
    checks,
    blockedReasons,
    decision: blockedReasons.length === 0 ? "ready-to-execute" : "block",
  };
}

export function writeRolloutEvidenceBundle(bundle, outDir) {
  const absoluteOutDir = path.resolve(repoRoot, outDir);
  const reportPath = path.join(absoluteOutDir, "rollout-evidence-bundle.json");
  const summaryPath = path.join(absoluteOutDir, "rollout-evidence-summary.md");

  fs.mkdirSync(absoluteOutDir, { recursive: true });
  fs.writeFileSync(reportPath, `${JSON.stringify(bundle, null, 2)}\n`);
  fs.writeFileSync(summaryPath, renderSummary(bundle));

  return {
    outDir: absoluteOutDir,
    reportPath,
    summaryPath,
  };
}

function loadReportSet(reportDir) {
  const loaded = {};
  for (const [key, fileName] of Object.entries(reportFiles)) {
    loaded[key] = loadJsonReport(reportDir, fileName);
  }
  return loaded;
}

function loadJsonReport(reportDir, fileName) {
  const filePath = path.join(reportDir, fileName);
  try {
    return {
      fileName,
      path: filePath,
      exists: true,
      value: JSON.parse(fs.readFileSync(filePath, "utf8")),
    };
  } catch (error) {
    return {
      fileName,
      path: filePath,
      exists: fs.existsSync(filePath),
      value: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function requireReport(loaded, key, checks) {
  if (loaded?.value) {
    checks.push(pass(`report-${key}`, `${loaded.fileName} is present and parseable`));
    return loaded.value;
  }
  checks.push(block(`report-${key}`, `${loaded?.fileName ?? key} is required and must be valid JSON`, {
    error: loaded?.error ?? null,
  }));
  return null;
}

function optionalReport(loaded, key, checks) {
  if (loaded?.value) {
    checks.push(pass(`report-${key}`, `${loaded.fileName} is present and parseable`));
    return loaded.value;
  }
  return null;
}

function validatePreflight(preflight, checks) {
  if (!preflight) return;
  validateIdentity(preflight, "preflight", "static", checks);
  if (preflight.decision === "allow-standby") {
    checks.push(pass("preflight-decision", "preflight allows standby"));
  } else {
    checks.push(block("preflight-decision", `preflight decision is ${preflight.decision || "missing"}`));
  }
  if (preflight.dirtyWorktree?.clean === true) {
    checks.push(pass("preflight-clean-worktree", "preflight was captured from a clean worktree"));
  } else {
    checks.push(block("preflight-clean-worktree", "preflight must be captured from a clean worktree"));
  }
  if ((preflight.blockedReasons?.length ?? 0) === 0) {
    checks.push(pass("preflight-blockers", "preflight has no blocked reasons"));
  } else {
    checks.push(block("preflight-blockers", `preflight is blocked: ${preflight.blockedReasons.join("; ")}`));
  }
  if (preflight.migration?.classifier === "passed") {
    checks.push(pass("preflight-migration", "preflight migration classifier passed"));
  } else {
    checks.push(block("preflight-migration", "preflight migration classifier must pass"));
  }
  if (preflight.localTopologyEvidence?.status === "passed") {
    checks.push(pass("preflight-local-topology-evidence", "preflight accepted local topology evidence"));
  } else {
    checks.push(block("preflight-local-topology-evidence", "preflight must accept local topology evidence"));
  }
  if (preflight.compatibility?.matrixResult === "passed") {
    checks.push(pass("preflight-compatibility", "preflight compatibility matrix passed"));
  } else {
    checks.push(block("preflight-compatibility", "preflight compatibility matrix must pass"));
  }
}

function validateLocalTopology(report, checks) {
  if (!report) return;
  validateIdentity(report, "local-topology", "local-topology-inspector", checks);
  if (report.decision === "captured" && (report.blockedReasons?.length ?? 0) === 0) {
    checks.push(pass("local-topology-decision", "local topology is captured without blockers"));
  } else {
    checks.push(block("local-topology-decision", "local topology report must be captured without blockers"));
  }
}

function validateRouteProbes(routeProbes, checks) {
  if (!routeProbes) return;
  if (Array.isArray(routeProbes) || typeof routeProbes === "object") {
    checks.push(pass("route-probes-shape", "route probe evidence is present"));
  } else {
    checks.push(block("route-probes-shape", "route probe evidence must be a JSON object or array"));
  }
  if (routeProbes?.taskId !== undefined && routeProbes.taskId !== "RA-344") {
    checks.push(block("route-probes-task", "route probe evidence taskId must be RA-344 when present"));
  }
  if (routeProbes?.nonIntervention !== undefined && routeProbes.nonIntervention !== true) {
    checks.push(block("route-probes-boundary", "route probe evidence must be non-intervention when declared"));
  }
}

function validateSimpleReport(report, options, checks) {
  if (!report) return;
  validateIdentity(report, options.key, options.mode, checks);
  if (report.decision === options.decision) {
    checks.push(pass(`${options.key}-decision`, `${options.label} decision is ${options.decision}`));
  } else {
    checks.push(block(`${options.key}-decision`, `${options.label} decision is ${report.decision || "missing"}`));
  }
  if ((report.blockedReasons?.length ?? 0) === 0) {
    checks.push(pass(`${options.key}-blockers`, `${options.label} has no blocked reasons`));
  } else {
    checks.push(block(`${options.key}-blockers`, `${options.label} is blocked: ${report.blockedReasons.join("; ")}`));
  }
}

function validateIdentity(report, key, mode, checks) {
  if (report.taskId === "RA-344" && report.mode === mode && report.nonIntervention === true) {
    checks.push(pass(`${key}-identity`, `${key} identity matches RA-344 ${mode}`));
  } else {
    checks.push(block(`${key}-identity`, `${key} identity must be RA-344 ${mode} non-intervention evidence`));
  }
}

function validateMigrationEvidence(reports, checks) {
  const migration = reports.preflight?.migration;
  if (!migration) return;
  const backupStatus = migration.backup?.status;
  const scratchStatus = migration.scratchRestore?.status;
  if (backupStatus === "not-required" && scratchStatus === "not-required") {
    checks.push(pass("db-evidence", "DB backup and scratch restore evidence are not required"));
    return;
  }
  if (backupStatus !== "passed" || scratchStatus !== "passed") {
    checks.push(block("db-evidence", "DB backup and scratch restore evidence must pass when required"));
    return;
  }

  if (!reports.dbSafetyPlan) {
    checks.push(block("db-safety-plan-required", "db-safety-plan.json is required when preflight requires DB evidence"));
  } else {
    validateSimpleReport(reports.dbSafetyPlan, {
      key: "db-safety-plan",
      mode: "db-safety-plan",
      decision: "prepared",
      label: "DB safety plan",
    }, checks);
  }
  validateDbBackup(reports.dbBackup, checks);
  validateScratchRestore(reports.dbBackup, reports.scratchRestore, checks);
}

function validateDbBackup(report, checks) {
  if (!report) {
    checks.push(block("db-backup-required", "db-backup.json is required when preflight requires backup evidence"));
    return;
  }
  if (
    report.taskId === "RA-344"
    && report.mode === "db-backup"
    && report.nonIntervention === true
    && report.decision === "passed"
    && isSha256(report.artifact?.sha256)
  ) {
    checks.push(pass("db-backup-evidence", "DB backup evidence passed"));
  } else {
    checks.push(block("db-backup-evidence", "DB backup evidence is invalid"));
  }
}

function validateScratchRestore(backup, report, checks) {
  if (!report) {
    checks.push(block("scratch-restore-required", "scratch-restore.json is required when preflight requires restore evidence"));
    return;
  }
  if (
    report.taskId === "RA-344"
    && report.mode === "scratch-restore"
    && report.nonIntervention === true
    && report.decision === "passed"
    && report.target?.kind === "scratch-postgres"
    && report.restore?.status === "passed"
  ) {
    checks.push(pass("scratch-restore-evidence", "scratch restore evidence passed"));
  } else {
    checks.push(block("scratch-restore-evidence", "scratch restore evidence is invalid"));
  }
  if (backup?.artifact?.sha256 && report.sourceBackupSha256 === backup.artifact.sha256) {
    checks.push(pass("scratch-restore-source", "scratch restore references the DB backup artifact"));
  } else {
    checks.push(block("scratch-restore-source", "scratch restore must reference the DB backup artifact sha256"));
  }
}

function validateCrossReportCoherence(reports, checks) {
  const slot = reports.slotPlan;
  const canary = reports.canary;
  const promotion = reports.promotionPlan;
  const rollback = reports.rollbackPlan;
  const vps = reports.vpsExecutionPlan;
  if (!slot || !canary || !promotion || !rollback || !vps) return;

  compareIdentity("release-sha", [
    reports.preflight?.releaseSha,
    slot.release?.sha,
    canary.readiness?.releaseSha,
    promotion.release?.sha,
    rollback.releaseSha,
    vps.release?.sha,
  ], checks);
  compareExact("build-id", [
    slot.release?.buildId,
    canary.readiness?.buildId,
    promotion.release?.buildId,
    vps.release?.buildId,
  ], checks);
  compareExact("migration-status", [
    slot.release?.migrationStatus,
    canary.readiness?.migrationStatus,
    promotion.release?.migrationStatus,
    vps.release?.migrationStatus,
  ], checks);
  compareExact("target-slot", [
    slot.slot?.id,
    canary.target?.slot,
    canary.readiness?.slotId,
    promotion.target?.slot,
    vps.target?.slot,
  ], checks);
  compareExact("target-upstream", [
    slot.slot?.upstream,
    promotion.target?.upstream,
    vps.target?.upstream,
  ], checks);
  compareExact("pre-promotion-scheduler-role", [
    slot.slot?.schedulerRole,
    canary.target?.schedulerRole,
    canary.readiness?.schedulerRole,
    promotion.target?.prePromotionSchedulerRole,
  ], checks);
  compareExact("previous-slot", [
    promotion.previous?.slot,
    rollback.previousSlot,
    vps.previous?.slot,
  ], checks);
  compareExact("previous-upstream", [
    promotion.previous?.upstream,
    rollback.rollbackTarget,
    vps.previous?.upstream,
  ], checks);

  if (promotion.rollback?.decision === "prepared" && rollback.decision === "prepared") {
    checks.push(pass("rollback-artifact", "promotion and rollback plan both prepare rollback"));
  } else {
    checks.push(block("rollback-artifact", "rollback must be prepared in both promotion and rollback artifacts"));
  }
  validateOldSlotRetention(reports, checks);
}

function validateOldSlotRetention(reports, checks) {
  const vps = reports.vpsExecutionPlan;
  const inventory = reports.runnerInventory;
  if (!vps) return;
  const stopAllowed = vps.oldSlotStop?.stopAllowed === true || vps.oldSlotRetention?.stopAllowed === true;

  if (!stopAllowed) {
    if (vps.oldSlotRetention?.required === true) {
      checks.push(pass("old-slot-retention", "old slot remains retained unless explicit drain proof allows stop"));
    } else {
      checks.push(block("old-slot-retention", "old slot retention must be explicit when stop is not allowed"));
    }
    return;
  }

  if (
    inventory?.taskId === "RA-344"
    && inventory.mode === "runner-inventory"
    && inventory.nonIntervention === true
    && inventory.decision === "drained"
    && inventory.oldSlotStop?.allowed === true
    && inventory.counts?.directOldSlotGovernanceUrl === 0
    && inventory.counts?.missingGovernanceUrl === 0
  ) {
    checks.push(pass("runner-inventory-stop-proof", "runner inventory proves old slot stop is allowed"));
  } else {
    checks.push(block("runner-inventory-stop-proof", "old slot stop requires drained runner inventory evidence"));
  }
}

function validateExecutionArtifacts(reportDir, vps, checks) {
  for (const fileName of requiredArtifacts) {
    const filePath = path.join(reportDir, fileName);
    if (fs.existsSync(filePath) && fs.statSync(filePath).size > 0) {
      checks.push(pass(`artifact-${fileName}`, `${fileName} is present`));
    } else {
      checks.push(block(`artifact-${fileName}`, `${fileName} is required`));
    }
  }

  if (vps?.oldSlotStop?.stopAllowed === true || vps?.oldSlotRetention?.stopAllowed === true) {
    const fileName = "old-slot-stop-execution.sh";
    const filePath = path.join(reportDir, fileName);
    if (fs.existsSync(filePath) && fs.statSync(filePath).size > 0) {
      checks.push(pass(`artifact-${fileName}`, `${fileName} is present after drain proof`));
    } else {
      checks.push(block(`artifact-${fileName}`, `${fileName} is required when old-slot stop is allowed`));
    }
  } else {
    checks.push(pass("artifact-old-slot-stop-execution.sh", "old-slot stop script is withheld"));
  }
}

function compareExact(id, values, checks) {
  const normalized = values.map(readNonEmpty).filter(Boolean);
  const unique = [...new Set(normalized)];
  if (normalized.length === values.length && unique.length === 1) {
    checks.push(pass(id, `${id} is coherent`));
  } else {
    checks.push(block(id, `${id} mismatch: ${values.map((value) => readNonEmpty(value) ?? "missing").join(", ")}`));
  }
}

function compareIdentity(id, values, checks) {
  const normalized = values.map(readNonEmpty).filter(Boolean);
  if (normalized.length !== values.length) {
    checks.push(block(id, `${id} mismatch: ${values.map((value) => readNonEmpty(value) ?? "missing").join(", ")}`));
    return;
  }
  const sorted = [...normalized].sort((a, b) => b.length - a.length);
  const longest = sorted[0];
  if (sorted.every((value) => longest === value || longest.startsWith(value) || value.startsWith(longest))) {
    checks.push(pass(id, `${id} is coherent`));
  } else {
    checks.push(block(id, `${id} mismatch: ${values.join(", ")}`));
  }
}

function summarizeRelease(reports) {
  return {
    sha: reports.slotPlan?.release?.sha ?? reports.promotionPlan?.release?.sha ?? null,
    buildId: reports.slotPlan?.release?.buildId ?? reports.promotionPlan?.release?.buildId ?? null,
    previousRef: reports.slotPlan?.release?.previousRef ?? reports.promotionPlan?.release?.previousRef ?? null,
    migrationStatus: reports.slotPlan?.release?.migrationStatus ?? reports.promotionPlan?.release?.migrationStatus ?? null,
  };
}

function summarizeTarget(reports) {
  return {
    slot: reports.slotPlan?.slot?.id ?? reports.promotionPlan?.target?.slot ?? null,
    upstream: reports.slotPlan?.slot?.upstream ?? reports.promotionPlan?.target?.upstream ?? null,
    schedulerRole: reports.promotionPlan?.target?.promotedSchedulerRole ?? reports.slotPlan?.slot?.schedulerRole ?? null,
    switchMethod: reports.promotionPlan?.router?.switchMethod ?? reports.vpsExecutionPlan?.switchMethod ?? null,
  };
}

function summarizePrevious(reports) {
  return {
    slot: reports.promotionPlan?.previous?.slot ?? reports.rollbackPlan?.previousSlot ?? null,
    upstream: reports.promotionPlan?.previous?.upstream ?? reports.rollbackPlan?.rollbackTarget ?? null,
    schedulerRole: reports.promotionPlan?.previous?.schedulerRole ?? reports.rollbackPlan?.previousSchedulerRole ?? null,
  };
}

function summarizeOldSlotRetention(reports) {
  const vps = reports.vpsExecutionPlan;
  return {
    required: vps?.oldSlotRetention?.required ?? null,
    stopAllowed: vps?.oldSlotRetention?.stopAllowed ?? vps?.oldSlotStop?.stopAllowed ?? null,
    reason: vps?.oldSlotRetention?.reason ?? vps?.oldSlotStop?.retentionReason ?? null,
    runnerInventoryDecision: reports.runnerInventory?.decision ?? "not-provided",
  };
}

function summarizeReports(loaded, reports) {
  const summary = {};
  for (const [key, entry] of Object.entries(loaded)) {
    summary[key] = {
      path: entry.path,
      present: Boolean(entry.value),
      required: requiredReports.includes(key)
        || isRequiredDbEvidence(key, reports.preflight),
      mode: entry.value?.mode ?? null,
      decision: entry.value?.decision ?? null,
    };
  }
  return summary;
}

function isRequiredDbEvidence(key, preflight) {
  const requiresDbEvidence = preflight?.migration?.backup?.status === "passed"
    || preflight?.migration?.scratchRestore?.status === "passed";
  return requiresDbEvidence && ["dbSafetyPlan", "dbBackup", "scratchRestore"].includes(key);
}

function renderSummary(bundle) {
  return [
    "# RA-344 Rollout Evidence Bundle",
    "",
    `Decision: ${bundle.decision}`,
    `Release: ${bundle.release.sha ?? "unknown"}`,
    `Target: ${bundle.target.slot ?? "unknown"} ${bundle.target.upstream ?? "unknown"}`,
    `Previous: ${bundle.previous.slot ?? "unknown"} ${bundle.previous.upstream ?? "unknown"}`,
    "",
    "Old slot retention:",
    `- required: ${bundle.oldSlotRetention.required}`,
    `- stopAllowed: ${bundle.oldSlotRetention.stopAllowed}`,
    `- reason: ${bundle.oldSlotRetention.reason}`,
    `- runnerInventory: ${bundle.oldSlotRetention.runnerInventoryDecision}`,
    "",
    "Blocked reasons:",
    ...(bundle.blockedReasons.length > 0
      ? bundle.blockedReasons.map((reason) => `- ${reason}`)
      : ["- none"]),
    "",
  ].join("\n");
}

function normalizeReportDir(value) {
  const normalized = readNonEmpty(value);
  if (!normalized) {
    throw new Error("report dir is required");
  }
  return path.resolve(repoRoot, normalized);
}

function readNonEmpty(value) {
  const normalized = `${value ?? ""}`.trim();
  return normalized || null;
}

function isSha256(value) {
  return /^[a-f0-9]{64}$/i.test(`${value ?? ""}`.trim());
}

function pass(id, reason, details = undefined) {
  return { id, status: "pass", reason, ...(details ? { details } : {}) };
}

function block(id, reason, details = undefined) {
  return { id, status: "block", reason, ...(details ? { details } : {}) };
}

function parseArgs(argv) {
  const parsed = {
    reportDir: null,
    outDir: null,
    json: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--dir") {
      parsed.reportDir = argv[++index];
    } else if (arg === "--out-dir") {
      parsed.outDir = argv[++index];
    } else if (arg === "--json") {
      parsed.json = true;
    } else if (arg === "--help" || arg === "-h") {
      parsed.help = true;
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }

  return parsed;
}

function printHelp() {
  console.log(`Usage: node scripts/governance-rollout-evidence-bundle.mjs --dir <rollout-report-dir> [options]

Options:
  --out-dir <path>  Write rollout-evidence-bundle.json and rollout-evidence-summary.md. Defaults to --dir.
  --json            Print full bundle JSON.
`);
}

function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) {
      printHelp();
      return;
    }
    if (!args.reportDir) throw new Error("--dir is required");

    const bundle = buildRolloutEvidenceBundle({ reportDir: args.reportDir });
    const written = writeRolloutEvidenceBundle(bundle, args.outDir ?? args.reportDir);
    const output = { ...bundle, written };

    if (args.json) {
      console.log(JSON.stringify(output, null, 2));
    } else {
      console.log(`RA-344 rollout evidence bundle: ${bundle.decision}`);
      console.log(`release: ${bundle.release.sha ?? "unknown"}`);
      console.log(`target: ${bundle.target.slot ?? "unknown"} ${bundle.target.upstream ?? "unknown"}`);
      console.log(`report: ${written.reportPath}`);
      if (bundle.blockedReasons.length > 0) {
        console.log("blocked reasons:");
        for (const reason of bundle.blockedReasons) {
          console.log(`- ${reason}`);
        }
      }
    }

    process.exit(bundle.decision === "ready-to-execute" ? 0 : 1);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  main();
}
