#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  normalizeSlotId,
  normalizeUpstream,
} from "./governance-rollout-router-config.mjs";
import { renderSlotEnv } from "./governance-rollout-slot-plan.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scriptPath = fileURLToPath(import.meta.url);
const prePromotionSchedulerRoles = new Set(["standby", "external"]);
const promotedSchedulerRoles = new Set(["active", "external"]);
const readyMigrationStatuses = new Set(["compatible", "not_required"]);

export function buildPromotionPlan(options = {}) {
  const slotPlan = normalizeRecord(options.slotPlan, "slot plan");
  const canaryReport = normalizeRecord(options.canaryReport, "canary report");
  const previousSlot = normalizeSlotId(options.previousSlot);
  const previousUpstream = normalizeUpstream(options.previousUpstream);
  const previousSchedulerRole = normalizeEnum(
    options.previousSchedulerRole,
    promotedSchedulerRoles,
    "previous scheduler role",
  );
  const promotedSchedulerRole = normalizeEnum(
    options.promotedSchedulerRole,
    promotedSchedulerRoles,
    "promoted scheduler role",
  );
  const activeCaddyfile = normalizeAbsolutePath(options.activeCaddyfile, "active caddyfile");
  const rollbackCaddyfile = normalizeAbsolutePath(options.rollbackCaddyfile, "rollback caddyfile");
  const postPromotionUrl = normalizeReadinessUrl(options.postPromotionUrl, "post-promotion url");
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const checks = [];

  const target = summarizeSlotPlan(slotPlan, checks);
  validateCanaryReport(canaryReport, target, checks);
  validatePreviousActive({
    activeCaddyfile,
    checks,
    previousSlot,
    previousUpstream,
    rollbackCaddyfile,
    target,
  });

  const promotedSlotEnv = target.valid
    ? renderSlotEnv({
      slotId: target.slotId,
      port: target.port,
      releaseSha: target.releaseSha,
      buildId: target.buildId,
      migrationStatus: target.migrationStatus,
      schedulerRole: promotedSchedulerRole,
    })
    : "";

  const rollback = buildRollbackPlan({
    activeCaddyfile,
    generatedAt,
    postPromotionUrl,
    previousSchedulerRole,
    previousSlot,
    previousUpstream,
    releaseSha: target.releaseSha,
    rollbackCaddyfile,
    schemaCompatible: readyMigrationStatuses.has(target.migrationStatus),
  });

  const blockedReasons = checks
    .filter((check) => check.status === "block")
    .map((check) => `${check.id}: ${check.reason}`);

  return {
    taskId: "RA-344",
    mode: "promotion-plan",
    generatedAt,
    operator: "scripts/governance-rollout-promotion-plan.mjs",
    nonIntervention: true,
    release: {
      sha: target.releaseSha,
      buildId: target.buildId,
      previousRef: target.previousRef,
      migrationStatus: target.migrationStatus,
    },
    target: {
      slot: target.slotId,
      upstream: target.upstream,
      readinessUrl: target.readinessUrl,
      prePromotionSchedulerRole: target.schedulerRole,
      promotedSchedulerRole,
      candidateCaddyfile: target.candidateCaddyfile,
      slotEnvPath: target.slotEnvPath,
    },
    previous: {
      slot: previousSlot,
      upstream: previousUpstream,
      schedulerRole: previousSchedulerRole,
      activeCaddyfile,
      rollbackCaddyfile,
    },
    schedulerTransfer: {
      method: promotedSchedulerRole === "external" ? "external-stays-owner" : "standby-to-active-before-promotion",
      requiresStandbyRestart: target.schedulerRole !== promotedSchedulerRole,
      dbLeaseRequired: promotedSchedulerRole === "active",
    },
    router: {
      switchMethod: "caddy-active-upstream",
      siteAddress: target.siteAddress,
    },
    artifacts: {
      promotedSlotEnv,
    },
    commands: buildPromotionCommands({
      activeCaddyfile,
      postPromotionUrl,
      promotedSchedulerRole,
      promotedSlotEnvPath: "promoted-slot.env",
      rollbackCaddyfile,
      target,
    }),
    rollback,
    checks,
    blockedReasons,
    decision: blockedReasons.length === 0 ? "ready-to-promote" : "block",
  };
}

export function writePromotionPlanArtifacts(plan, outDir) {
  const absoluteOutDir = path.resolve(repoRoot, outDir);
  const promotedSlotEnvPath = path.join(absoluteOutDir, "promoted-slot.env");
  const promotionPlanPath = path.join(absoluteOutDir, "promotion-plan.json");
  const rollbackPlanPath = path.join(absoluteOutDir, "rollback-plan.json");

  fs.mkdirSync(absoluteOutDir, { recursive: true });
  fs.writeFileSync(promotedSlotEnvPath, plan.artifacts.promotedSlotEnv);
  fs.writeFileSync(promotionPlanPath, `${JSON.stringify(withoutInlineArtifacts(plan), null, 2)}\n`);
  fs.writeFileSync(rollbackPlanPath, `${JSON.stringify(plan.rollback, null, 2)}\n`);

  return {
    outDir: absoluteOutDir,
    promotedSlotEnvPath,
    promotionPlanPath,
    rollbackPlanPath,
  };
}

function summarizeSlotPlan(slotPlan, checks) {
  const summary = {
    valid: true,
    releaseSha: readNonEmpty(slotPlan.release?.sha),
    buildId: readNonEmpty(slotPlan.release?.buildId),
    previousRef: readNonEmpty(slotPlan.release?.previousRef),
    migrationStatus: readNonEmpty(slotPlan.release?.migrationStatus),
    slotId: null,
    port: Number(slotPlan.slot?.port),
    upstream: null,
    readinessUrl: readNonEmpty(slotPlan.slot?.readinessUrl),
    schedulerRole: readNonEmpty(slotPlan.slot?.schedulerRole),
    candidateCaddyfile: readNonEmpty(slotPlan.router?.candidatePath),
    slotEnvPath: readNonEmpty(slotPlan.slot?.envPath),
    siteAddress: readNonEmpty(slotPlan.router?.siteAddress),
  };

  if (slotPlan.taskId === "RA-344" && slotPlan.mode === "slot-rollout-plan") {
    checks.push(pass("slot-plan-identity", "slot rollout plan identity matches RA-344"));
  } else {
    summary.valid = false;
    checks.push(block("slot-plan-identity", "slot rollout plan identity is missing or unexpected"));
  }

  if (slotPlan.decision === "prepared" && slotPlan.nonIntervention === true) {
    checks.push(pass("slot-plan-decision", "slot rollout plan is prepared and non-intervention"));
  } else {
    summary.valid = false;
    checks.push(block("slot-plan-decision", "slot rollout plan is not prepared"));
  }

  summary.slotId = tryNormalize("slot-plan-slot", () => normalizeSlotId(slotPlan.slot?.id), checks);
  summary.upstream = tryNormalize("slot-plan-upstream", () => normalizeUpstream(slotPlan.slot?.upstream), checks);

  if (summary.releaseSha && summary.buildId && summary.previousRef) {
    checks.push(pass("slot-plan-release", "slot rollout plan includes release identity"));
  } else {
    summary.valid = false;
    checks.push(block("slot-plan-release", "slot rollout plan is missing release sha, build id, or previous ref"));
  }

  if (readyMigrationStatuses.has(summary.migrationStatus)) {
    checks.push(pass("slot-plan-migration", `migration status is ${summary.migrationStatus}`));
  } else {
    summary.valid = false;
    checks.push(block("slot-plan-migration", "migration status is not compatible with code rollback"));
  }

  if (Number.isInteger(summary.port) && summary.port >= 1024 && summary.port <= 65535 && summary.port !== 3000) {
    checks.push(pass("slot-plan-port", "slot rollout plan targets a non-active slot port"));
  } else {
    summary.valid = false;
    checks.push(block("slot-plan-port", "slot rollout plan port is missing, invalid, or active entrypoint 3000"));
  }

  if (prePromotionSchedulerRoles.has(summary.schedulerRole)) {
    checks.push(pass("slot-plan-scheduler", `pre-promotion scheduler role is ${summary.schedulerRole}`));
  } else {
    summary.valid = false;
    checks.push(block("slot-plan-scheduler", "pre-promotion scheduler role must be standby or external"));
  }

  if (
    summary.readinessUrl
    && summary.slotEnvPath
    && summary.candidateCaddyfile
    && summary.siteAddress
    && slotPlan.router?.activeUpstreamOwner === "caddy-template"
  ) {
    checks.push(pass("slot-plan-router", "slot rollout plan includes readiness, slot env, and candidate Caddy paths"));
  } else {
    summary.valid = false;
    checks.push(block("slot-plan-router", "slot rollout plan is missing readiness/router artifact paths"));
  }

  if (!summary.slotId || !summary.upstream) summary.valid = false;
  return summary;
}

function validateCanaryReport(canaryReport, target, checks) {
  if (canaryReport.taskId === "RA-344" && canaryReport.mode === "readiness-canary") {
    checks.push(pass("canary-identity", "canary report identity matches RA-344"));
  } else {
    checks.push(block("canary-identity", "canary report identity is missing or unexpected"));
  }

  if (canaryReport.decision === "allow-promotion" && canaryReport.nonIntervention === true) {
    checks.push(pass("canary-decision", "standby canary allows promotion"));
  } else {
    checks.push(block("canary-decision", "standby canary does not allow promotion"));
  }

  const blockedReasons = Array.isArray(canaryReport.blockedReasons) ? canaryReport.blockedReasons : [];
  if (blockedReasons.length === 0) {
    checks.push(pass("canary-blockers", "canary report has no blocked reasons"));
  } else {
    checks.push(block("canary-blockers", `canary report blocked: ${blockedReasons.join("; ")}`));
  }

  compareValue("canary-target-slot", canaryReport.target?.slot, target.slotId, "canary target slot", checks);
  compareValue("canary-readiness-slot", canaryReport.readiness?.slotId, target.slotId, "readiness slot", checks);
  compareValue("canary-build-id", canaryReport.readiness?.buildId, target.buildId, "readiness build id", checks);
  compareValue("canary-release-sha", canaryReport.readiness?.releaseSha, target.releaseSha, "readiness release sha", checks);
  compareValue(
    "canary-scheduler-role",
    canaryReport.readiness?.schedulerRole,
    target.schedulerRole,
    "readiness scheduler role",
    checks,
  );
  compareValue(
    "canary-migration-status",
    canaryReport.readiness?.migrationStatus,
    target.migrationStatus,
    "readiness migration status",
    checks,
  );
}

function validatePreviousActive(options) {
  const {
    activeCaddyfile,
    checks,
    previousSlot,
    previousUpstream,
    rollbackCaddyfile,
    target,
  } = options;

  if (previousSlot !== target.slotId) {
    checks.push(pass("previous-slot", "previous active slot differs from promotion target"));
  } else {
    checks.push(block("previous-slot", "previous active slot must differ from promotion target"));
  }

  if (previousUpstream !== target.upstream) {
    checks.push(pass("previous-upstream", "previous active upstream differs from promotion target"));
  } else {
    checks.push(block("previous-upstream", "previous active upstream must differ from promotion target"));
  }

  if (activeCaddyfile !== rollbackCaddyfile) {
    checks.push(pass("rollback-target", "rollback Caddyfile path is separate from the active Caddyfile"));
  } else {
    checks.push(block("rollback-target", "rollback Caddyfile path must differ from the active Caddyfile"));
  }
}

function buildPromotionCommands(options) {
  const commands = [
    {
      id: "validate-candidate-caddy",
      mutates: false,
      command: `caddy validate --config ${shellQuote(options.target.candidateCaddyfile)}`,
    },
  ];

  if (options.target.schedulerRole !== options.promotedSchedulerRole) {
    commands.push(
      {
        id: "install-promoted-slot-env",
        mutates: true,
        command:
          `install -m 0640 ${shellQuote(options.promotedSlotEnvPath)} ${shellQuote(options.target.slotEnvPath)}`,
      },
      {
        id: "restart-standby-with-promoted-scheduler-role",
        mutates: true,
        command: `systemctl restart governance-web@${options.target.slotId}`,
      },
      {
        id: "canary-promoted-standby",
        mutates: false,
        command:
          `node scripts/governance-rollout-canary.mjs --url ${shellQuote(options.target.readinessUrl)} --slot ${options.target.slotId} --scheduler-role ${options.promotedSchedulerRole} --report ${shellQuote("canary-promoted-standby.json")}`,
      },
    );
  }

  commands.push(
    {
      id: "save-rollback-caddyfile",
      mutates: true,
      command:
        `install -m 0644 ${shellQuote(options.activeCaddyfile)} ${shellQuote(options.rollbackCaddyfile)}`,
    },
    {
      id: "promote-active-upstream",
      mutates: true,
      command:
        `install -m 0644 ${shellQuote(options.target.candidateCaddyfile)} ${shellQuote(options.activeCaddyfile)} && systemctl reload caddy`,
    },
    {
      id: "post-promotion-canary",
      mutates: false,
      command:
        `node scripts/governance-rollout-canary.mjs --url ${shellQuote(options.postPromotionUrl)} --slot ${options.target.slotId} --scheduler-role ${options.promotedSchedulerRole} --report ${shellQuote("canary-active.json")}`,
    },
  );

  return commands;
}

function buildRollbackPlan(options) {
  return {
    taskId: "RA-344",
    mode: "rollback-plan",
    generatedAt: options.generatedAt,
    operator: "scripts/governance-rollout-promotion-plan.mjs",
    nonIntervention: true,
    releaseSha: options.releaseSha,
    rollbackTarget: options.previousUpstream,
    previousSlot: options.previousSlot,
    previousSchedulerRole: options.previousSchedulerRole,
    schemaCompatible: options.schemaCompatible,
    switchMethod: "caddy-active-upstream",
    postRollbackCanary: "not-run",
    commands: [
      {
        id: "validate-rollback-caddy",
        mutates: false,
        command: `caddy validate --config ${shellQuote(options.rollbackCaddyfile)}`,
      },
      {
        id: "rollback-active-upstream",
        mutates: true,
        command:
          `install -m 0644 ${shellQuote(options.rollbackCaddyfile)} ${shellQuote(options.activeCaddyfile)} && systemctl reload caddy`,
      },
      {
        id: "post-rollback-canary",
        mutates: false,
        command:
          `node scripts/governance-rollout-canary.mjs --url ${shellQuote(options.postPromotionUrl)} --slot ${options.previousSlot} --scheduler-role ${options.previousSchedulerRole} --report ${shellQuote("canary-rollback.json")}`,
      },
    ],
    decision: "prepared",
  };
}

function withoutInlineArtifacts(plan) {
  return {
    ...plan,
    artifacts: {
      promotedSlotEnvBytes: Buffer.byteLength(plan.artifacts.promotedSlotEnv, "utf8"),
    },
  };
}

function compareValue(id, actual, expected, label, checks) {
  const actualValue = readNonEmpty(actual);
  const expectedValue = readNonEmpty(expected);
  if (actualValue && expectedValue && actualValue === expectedValue) {
    checks.push(pass(id, `${label} matches ${expectedValue}`));
  } else {
    checks.push(block(id, `${label} is ${actualValue || "missing"}, expected ${expectedValue || "missing"}`));
  }
}

function tryNormalize(id, fn, checks) {
  try {
    const value = fn();
    checks.push(pass(id, `${id} is valid`));
    return value;
  } catch (error) {
    checks.push(block(id, error instanceof Error ? error.message : String(error)));
    return null;
  }
}

function normalizeRecord(value, name) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${name} must be a JSON object`);
  }
  return value;
}

function normalizeEnum(value, allowed, name) {
  const normalized = readNonEmpty(value);
  if (!allowed.has(normalized)) {
    throw new Error(`${name} must be one of: ${[...allowed].join(", ")}`);
  }
  return normalized;
}

function normalizeAbsolutePath(value, name) {
  const normalized = readNonEmpty(value);
  if (!normalized) {
    throw new Error(`${name} is required`);
  }
  if (!path.posix.isAbsolute(normalized)) {
    throw new Error(`${name} must be an absolute path`);
  }
  if (normalized.includes("\n") || normalized.includes("'")) {
    throw new Error(`${name} contains unsupported characters`);
  }
  return normalized.replace(/\/+$/, "");
}

function normalizeReadinessUrl(value, name) {
  const normalized = readNonEmpty(value);
  if (!normalized) {
    throw new Error(`${name} is required`);
  }
  let parsed;
  try {
    parsed = new URL(normalized);
  } catch {
    throw new Error(`${name} must be a valid URL`);
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error(`${name} must use http or https`);
  }
  if (parsed.pathname !== "/api/readiness") {
    throw new Error(`${name} must target /api/readiness`);
  }
  if (parsed.search || parsed.hash) {
    throw new Error(`${name} must not include query or hash`);
  }
  return parsed.toString();
}

function readJsonFile(filePath, name) {
  const absolutePath = path.resolve(repoRoot, filePath);
  try {
    return JSON.parse(fs.readFileSync(absolutePath, "utf8"));
  } catch (error) {
    throw new Error(`failed to read ${name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function readNonEmpty(value) {
  const normalized = `${value ?? ""}`.trim();
  return normalized || null;
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

function pass(id, reason) {
  return { id, status: "pass", reason };
}

function block(id, reason) {
  return { id, status: "block", reason };
}

function parseArgs(argv) {
  const parsed = {
    slotPlanPath: null,
    canaryPath: null,
    previousSlot: null,
    previousUpstream: null,
    previousSchedulerRole: null,
    promotedSchedulerRole: null,
    activeCaddyfile: null,
    rollbackCaddyfile: null,
    postPromotionUrl: null,
    outDir: null,
    json: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--slot-plan") {
      parsed.slotPlanPath = argv[++index];
    } else if (arg === "--canary") {
      parsed.canaryPath = argv[++index];
    } else if (arg === "--previous-slot") {
      parsed.previousSlot = argv[++index];
    } else if (arg === "--previous-upstream") {
      parsed.previousUpstream = argv[++index];
    } else if (arg === "--previous-scheduler-role") {
      parsed.previousSchedulerRole = argv[++index];
    } else if (arg === "--promoted-scheduler-role") {
      parsed.promotedSchedulerRole = argv[++index];
    } else if (arg === "--active-caddyfile") {
      parsed.activeCaddyfile = argv[++index];
    } else if (arg === "--rollback-caddyfile") {
      parsed.rollbackCaddyfile = argv[++index];
    } else if (arg === "--post-promotion-url") {
      parsed.postPromotionUrl = argv[++index];
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
  console.log(`Usage: node scripts/governance-rollout-promotion-plan.mjs --slot-plan <slot-rollout-plan.json> --canary <canary-standby.json> --previous-slot <blue|green> --previous-upstream <origin> --previous-scheduler-role <active|external> --promoted-scheduler-role <active|external> --active-caddyfile <path> --rollback-caddyfile <path> --post-promotion-url <url> [options]

Options:
  --out-dir <path>   Write promoted-slot.env, promotion-plan.json, and rollback-plan.json.
  --json             Print full promotion plan JSON.
`);
}

function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) {
      printHelp();
      return;
    }
    if (!args.slotPlanPath) throw new Error("--slot-plan is required");
    if (!args.canaryPath) throw new Error("--canary is required");

    const plan = buildPromotionPlan({
      slotPlan: readJsonFile(args.slotPlanPath, "slot rollout plan"),
      canaryReport: readJsonFile(args.canaryPath, "canary report"),
      previousSlot: args.previousSlot,
      previousUpstream: args.previousUpstream,
      previousSchedulerRole: args.previousSchedulerRole,
      promotedSchedulerRole: args.promotedSchedulerRole,
      activeCaddyfile: args.activeCaddyfile,
      rollbackCaddyfile: args.rollbackCaddyfile,
      postPromotionUrl: args.postPromotionUrl,
    });
    const written = args.outDir ? writePromotionPlanArtifacts(plan, args.outDir) : null;
    const output = written ? { ...withoutInlineArtifacts(plan), written } : withoutInlineArtifacts(plan);

    if (args.json) {
      console.log(JSON.stringify(output, null, 2));
    } else {
      console.log(`RA-344 governance promotion plan: ${plan.decision}`);
      console.log(`target: ${plan.target.slot} ${plan.target.upstream}`);
      console.log(`previous: ${plan.previous.slot} ${plan.previous.upstream}`);
      if (written) console.log(`report: ${written.promotionPlanPath}`);
      if (plan.blockedReasons.length > 0) {
        console.log("blocked reasons:");
        for (const reason of plan.blockedReasons) {
          console.log(`- ${reason}`);
        }
      }
    }

    process.exit(plan.decision === "ready-to-promote" ? 0 : 1);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  main();
}
