#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildReadinessCanaryReport } from "./governance-rollout-canary.mjs";
import {
  buildRolloutEvidenceBundle,
  writeRolloutEvidenceBundle,
} from "./governance-rollout-evidence-bundle.mjs";
import { buildStaticPreflightReport } from "./governance-rollout-preflight.mjs";
import {
  buildPromotionPlan,
  writePromotionPlanArtifacts,
} from "./governance-rollout-promotion-plan.mjs";
import { buildRouteCanaryReport } from "./governance-rollout-route-canary.mjs";
import {
  buildSlotRolloutPlan,
  writeSlotRolloutArtifacts,
} from "./governance-rollout-slot-plan.mjs";
import {
  buildVpsExecutionPlan,
  writeVpsExecutionArtifacts,
} from "./governance-rollout-vps-execution-plan.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scriptPath = fileURLToPath(import.meta.url);
const reportFileNames = {
  dbBackup: "db-backup.json",
  dbSafetyPlan: "db-safety-plan.json",
  localTopology: "local-topology.json",
  preflight: "preflight.json",
  routeProbes: "route-probes.json",
  runnerInventory: "runner-inventory.json",
  scratchRestore: "scratch-restore.json",
};

export function runGovernanceRolloutDryRun(options = {}) {
  const outDir = normalizeOutDir(options.outDir);
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  fs.mkdirSync(outDir, { recursive: true });

  const written = {};
  const copiedReports = {};

  copiedReports.localTopology = copyJsonReport(
    options.localTopologyReportPath,
    path.join(outDir, reportFileNames.localTopology),
    "local topology report",
  );
  copiedReports.routeProbes = copyJsonReport(
    options.routeProbesPath,
    path.join(outDir, reportFileNames.routeProbes),
    "route probes report",
  );
  copiedReports.dbSafetyPlan = copyOptionalJsonReport(
    options.dbSafetyPlanPath,
    path.join(outDir, reportFileNames.dbSafetyPlan),
    "DB safety plan report",
  );
  copiedReports.dbBackup = copyOptionalJsonReport(
    options.dbBackupReportPath,
    path.join(outDir, reportFileNames.dbBackup),
    "DB backup report",
  );
  copiedReports.scratchRestore = copyOptionalJsonReport(
    options.scratchRestoreReportPath,
    path.join(outDir, reportFileNames.scratchRestore),
    "scratch restore report",
  );
  copiedReports.runnerInventory = copyOptionalJsonReport(
    options.runnerInventoryPath,
    path.join(outDir, reportFileNames.runnerInventory),
    "runner inventory report",
  );

  let preflight;
  if (options.preflightReportPath) {
    copiedReports.preflight = copyJsonReport(
      options.preflightReportPath,
      path.join(outDir, reportFileNames.preflight),
      "preflight report",
    );
    preflight = copiedReports.preflight.value;
    written.preflightPath = copiedReports.preflight.path;
  } else {
    preflight = buildStaticPreflightReport({
        backupReportPath: copiedReports.dbBackup?.path,
        generatedAt,
        localTopologyReportPath: copiedReports.localTopology.path,
        previousRef: options.previousRef,
        scratchRestoreReportPath: copiedReports.scratchRestore?.path,
      });
    written.preflightPath = writeJson(path.join(outDir, reportFileNames.preflight), preflight);
  }

  const slotPlan = buildSlotRolloutPlan({
    appDir: options.appDir,
    buildId: options.buildId,
    generatedAt,
    migrationStatus: options.migrationStatus,
    port: options.port,
    previousRef: options.previousRef,
    readinessUrl: options.readinessUrl,
    releaseSha: options.releaseSha,
    schedulerRole: options.schedulerRole,
    siteAddress: options.siteAddress,
    slotId: options.slotId,
    upstream: options.upstream,
  });
  const slotArtifacts = writeSlotRolloutArtifacts(slotPlan, outDir);

  const readinessInput = readJsonReport(options.readinessFilePath, "readiness file");
  const canaryReport = buildReadinessCanaryReport({
    contentType: readinessInput.contentType ?? "application/json",
    generatedAt,
    httpStatus: readinessInput.httpStatus ?? 200,
    readiness: readinessInput.readiness ?? readinessInput,
    url: readinessInput.url ?? slotPlan.slot.readinessUrl,
    expectedSchedulerRole: slotPlan.slot.schedulerRole,
    expectedSlot: slotPlan.slot.id,
  });
  written.canaryPath = writeJson(path.join(outDir, "canary-standby.json"), canaryReport);

  const routeCanaryReport = buildRouteCanaryReport({
    generatedAt,
    input: copiedReports.routeProbes.value,
  });
  written.routeCanaryPath = writeJson(path.join(outDir, "route-canary-matrix.json"), routeCanaryReport);

  const promotionPlan = buildPromotionPlan({
    activeCaddyfile: options.activeCaddyfile,
    canaryReport,
    generatedAt,
    postPromotionUrl: options.postPromotionUrl,
    previousSchedulerRole: options.previousSchedulerRole,
    previousSlot: options.previousSlot,
    previousUpstream: options.previousUpstream,
    promotedSchedulerRole: options.promotedSchedulerRole,
    rollbackCaddyfile: options.rollbackCaddyfile,
    slotPlan,
  });
  const promotionArtifacts = writePromotionPlanArtifacts(promotionPlan, outDir);

  const vpsExecutionPlan = buildVpsExecutionPlan({
    generatedAt,
    oldSlotRetentionReason: options.oldSlotRetentionReason,
    oldSlotService: options.oldSlotService,
    promotionPlan,
    runnerInventory: copiedReports.runnerInventory?.value,
  });
  const vpsArtifacts = writeVpsExecutionArtifacts(vpsExecutionPlan, outDir);

  const evidenceBundle = buildRolloutEvidenceBundle({
    generatedAt,
    reportDir: outDir,
  });
  const evidenceArtifacts = writeRolloutEvidenceBundle(evidenceBundle, outDir);

  const dryRun = {
    taskId: "RA-344",
    mode: "rollout-dry-run",
    generatedAt,
    operator: "scripts/governance-rollout-dry-run.mjs",
    nonIntervention: true,
    input: {
      reportDir: outDir,
      preflightSource: options.preflightReportPath ? "provided-report" : "generated-static",
    },
    reports: {
      preflight: decisionSummary(preflight),
      slotPlan: decisionSummary(slotPlan),
      canary: decisionSummary(canaryReport),
      routeCanary: decisionSummary(routeCanaryReport),
      promotionPlan: decisionSummary(promotionPlan),
      rollbackPlan: decisionSummary(promotionPlan.rollback),
      vpsExecutionPlan: decisionSummary(vpsExecutionPlan),
      evidenceBundle: decisionSummary(evidenceBundle),
    },
    written: {
      preflightPath: written.preflightPath,
      localTopologyPath: copiedReports.localTopology.path,
      routeProbesPath: copiedReports.routeProbes.path,
      slotPlanPath: slotArtifacts.reportPath,
      canaryPath: written.canaryPath,
      routeCanaryPath: written.routeCanaryPath,
      promotionPlanPath: promotionArtifacts.promotionPlanPath,
      rollbackPlanPath: promotionArtifacts.rollbackPlanPath,
      vpsExecutionPlanPath: vpsArtifacts.planPath,
      rolloutExecutionPath: vpsArtifacts.rolloutScriptPath,
      rollbackExecutionPath: vpsArtifacts.rollbackScriptPath,
      oldSlotStopExecutionPath: vpsArtifacts.oldSlotStopScriptPath,
      evidenceBundlePath: evidenceArtifacts.reportPath,
      evidenceSummaryPath: evidenceArtifacts.summaryPath,
    },
    blockedReasons: evidenceBundle.blockedReasons,
    decision: evidenceBundle.decision,
  };
  const dryRunPath = writeJson(path.join(outDir, "rollout-dry-run.json"), dryRun);

  return {
    dryRun,
    evidenceBundle,
    reports: {
      preflight,
      slotPlan,
      canaryReport,
      routeCanaryReport,
      promotionPlan,
      vpsExecutionPlan,
    },
    written: {
      ...dryRun.written,
      dryRunPath,
    },
  };
}

function copyJsonReport(sourcePath, destinationPath, name) {
  if (!sourcePath) {
    throw new Error(`--${argumentNameForReport(name)} is required`);
  }
  const value = readJsonReport(sourcePath, name);
  const pathWritten = writeJson(destinationPath, value);
  return {
    path: pathWritten,
    value,
  };
}

function copyOptionalJsonReport(sourcePath, destinationPath, name) {
  if (!sourcePath) return null;
  return copyJsonReport(sourcePath, destinationPath, name);
}

function readJsonReport(filePath, name) {
  if (!filePath) {
    throw new Error(`${name} path is required`);
  }
  const absolutePath = path.resolve(repoRoot, filePath);
  try {
    return JSON.parse(fs.readFileSync(absolutePath, "utf8"));
  } catch (error) {
    throw new Error(`failed to read ${name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function writeJson(filePath, value) {
  const absolutePath = path.resolve(repoRoot, filePath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, `${JSON.stringify(value, null, 2)}\n`);
  return absolutePath;
}

function decisionSummary(report) {
  return {
    present: Boolean(report),
    mode: report?.mode ?? null,
    decision: report?.decision ?? null,
    blockedReasons: Array.isArray(report?.blockedReasons) ? report.blockedReasons : [],
  };
}

function normalizeOutDir(value) {
  const normalized = `${value ?? ""}`.trim();
  if (!normalized) {
    throw new Error("--out-dir is required");
  }
  if (normalized.includes("\0")) {
    throw new Error("--out-dir contains unsupported characters");
  }
  return path.resolve(repoRoot, normalized);
}

function argumentNameForReport(name) {
  return name
    .replace(" report", "")
    .replace(" file", "")
    .replaceAll(" ", "-");
}

function parseArgs(argv) {
  const parsed = {
    activeCaddyfile: null,
    appDir: null,
    buildId: null,
    dbBackupReportPath: null,
    dbSafetyPlanPath: null,
    generatedAt: null,
    json: false,
    localTopologyReportPath: null,
    migrationStatus: null,
    oldSlotRetentionReason: null,
    oldSlotService: null,
    outDir: null,
    port: null,
    postPromotionUrl: null,
    preflightReportPath: null,
    previousRef: null,
    previousSchedulerRole: null,
    previousSlot: null,
    previousUpstream: null,
    promotedSchedulerRole: null,
    readinessFilePath: null,
    readinessUrl: null,
    releaseSha: null,
    rollbackCaddyfile: null,
    routeProbesPath: null,
    runnerInventoryPath: null,
    schedulerRole: null,
    scratchRestoreReportPath: null,
    siteAddress: null,
    slotId: null,
    upstream: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--active-caddyfile") {
      parsed.activeCaddyfile = argv[++index];
    } else if (arg === "--app-dir") {
      parsed.appDir = argv[++index];
    } else if (arg === "--build-id") {
      parsed.buildId = argv[++index];
    } else if (arg === "--db-backup-report") {
      parsed.dbBackupReportPath = argv[++index];
    } else if (arg === "--db-safety-plan") {
      parsed.dbSafetyPlanPath = argv[++index];
    } else if (arg === "--generated-at") {
      parsed.generatedAt = argv[++index];
    } else if (arg === "--json") {
      parsed.json = true;
    } else if (arg === "--local-topology-report") {
      parsed.localTopologyReportPath = argv[++index];
    } else if (arg === "--migration-status") {
      parsed.migrationStatus = argv[++index];
    } else if (arg === "--old-slot-retention-reason") {
      parsed.oldSlotRetentionReason = argv[++index];
    } else if (arg === "--old-slot-service") {
      parsed.oldSlotService = argv[++index];
    } else if (arg === "--out-dir") {
      parsed.outDir = argv[++index];
    } else if (arg === "--port") {
      parsed.port = argv[++index];
    } else if (arg === "--post-promotion-url") {
      parsed.postPromotionUrl = argv[++index];
    } else if (arg === "--preflight-report") {
      parsed.preflightReportPath = argv[++index];
    } else if (arg === "--previous-ref") {
      parsed.previousRef = argv[++index];
    } else if (arg === "--previous-scheduler-role") {
      parsed.previousSchedulerRole = argv[++index];
    } else if (arg === "--previous-slot") {
      parsed.previousSlot = argv[++index];
    } else if (arg === "--previous-upstream") {
      parsed.previousUpstream = argv[++index];
    } else if (arg === "--promoted-scheduler-role") {
      parsed.promotedSchedulerRole = argv[++index];
    } else if (arg === "--readiness-file") {
      parsed.readinessFilePath = argv[++index];
    } else if (arg === "--readiness-url") {
      parsed.readinessUrl = argv[++index];
    } else if (arg === "--release-sha") {
      parsed.releaseSha = argv[++index];
    } else if (arg === "--rollback-caddyfile") {
      parsed.rollbackCaddyfile = argv[++index];
    } else if (arg === "--route-probes") {
      parsed.routeProbesPath = argv[++index];
    } else if (arg === "--runner-inventory") {
      parsed.runnerInventoryPath = argv[++index];
    } else if (arg === "--scheduler-role") {
      parsed.schedulerRole = argv[++index];
    } else if (arg === "--scratch-restore-report") {
      parsed.scratchRestoreReportPath = argv[++index];
    } else if (arg === "--site-address") {
      parsed.siteAddress = argv[++index];
    } else if (arg === "--slot") {
      parsed.slotId = argv[++index];
    } else if (arg === "--upstream") {
      parsed.upstream = argv[++index];
    } else if (arg === "--help" || arg === "-h") {
      parsed.help = true;
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }

  return parsed;
}

function printHelp() {
  console.log(`Usage: node scripts/governance-rollout-dry-run.mjs --out-dir <dir> --local-topology-report <local-topology.json> --route-probes <route-probes.json> --readiness-file <readiness.json> --slot <blue|green> --port <port> --release-sha <sha> --build-id <id> --previous-ref <ref> --migration-status <compatible|not_required> --scheduler-role <standby|external> --site-address <addr> --app-dir <abs-path> --previous-slot <blue|green> --previous-upstream <origin> --previous-scheduler-role <active|external> --promoted-scheduler-role <active|external> --active-caddyfile <abs-path> --rollback-caddyfile <abs-path> --post-promotion-url <url> [options]

Options:
  --preflight-report <path>          Use a saved preflight.json instead of generating static preflight from this repo.
  --upstream <origin>                Override target slot upstream. Defaults to 127.0.0.1:<port>.
  --readiness-url <url>              Override standby readiness URL.
  --runner-inventory <path>          Copy runner-inventory.json into the bundle and use it for old-slot stop proof.
  --old-slot-service <service>       Explicit governance-web old-slot service for stop artifact when inventory is drained.
  --old-slot-retention-reason <text> Record explicit retention reason when stop is withheld.
  --db-safety-plan <path>            Copy db-safety-plan.json when preflight requires DB evidence.
  --db-backup-report <path>          Copy db-backup.json when preflight requires DB evidence.
  --scratch-restore-report <path>    Copy scratch-restore.json when preflight requires DB evidence.
  --generated-at <iso>               Fixed timestamp for deterministic tests.
  --json                             Print rollout-dry-run.json.

The dry-run writes reports only. It does not fetch live URLs, call Docker, run DB backup/restore/migrations, reload Caddy/systemd, execute generated scripts, or mutate project/runtime lifecycle truth.
`);
}

function printSummary(result) {
  console.log(`RA-344 governance rollout dry-run: ${result.dryRun.decision}`);
  console.log(`report dir: ${result.dryRun.input.reportDir}`);
  console.log(`evidence bundle: ${result.written.evidenceBundlePath}`);
  if (result.dryRun.blockedReasons.length > 0) {
    console.log("blocked reasons:");
    for (const reason of result.dryRun.blockedReasons) {
      console.log(`- ${reason}`);
    }
  }
}

function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) {
      printHelp();
      return;
    }
    const result = runGovernanceRolloutDryRun(args);
    if (args.json) {
      console.log(JSON.stringify(result.dryRun, null, 2));
    } else {
      printSummary(result);
    }
    process.exit(result.dryRun.decision === "ready-to-execute" ? 0 : 1);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  main();
}
