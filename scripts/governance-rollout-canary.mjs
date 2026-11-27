#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scriptPath = fileURLToPath(import.meta.url);
const readinessSchemaVersion = "ra-344.governance-readiness.v1";
const allowedSlots = new Set(["blue", "green"]);
const allowedSchedulerRoles = new Set(["active", "standby", "external"]);
const readyMigrationStatuses = new Set(["compatible", "not_required"]);

export function buildReadinessCanaryReport(options = {}) {
  const checks = [];
  const expectedSlot = normalizeOptionalEnum(options.expectedSlot, allowedSlots, "slot");
  const expectedSchedulerRole = normalizeOptionalEnum(
    options.expectedSchedulerRole,
    allowedSchedulerRoles,
    "scheduler role",
  );
  const expectedReleaseSha = normalizeOptionalGitSha(options.expectedReleaseSha);
  const readiness = options.readiness ?? null;
  const generatedAt = options.generatedAt ?? new Date().toISOString();

  if (options.transportError) {
    checks.push(block("transport", `readiness endpoint fetch failed: ${options.transportError}`));
  }

  if (options.httpStatus !== undefined) {
    if (options.httpStatus === 200) {
      checks.push(pass("http-status", "readiness endpoint returned 200"));
    } else {
      checks.push(block("http-status", `readiness endpoint returned ${options.httpStatus}`));
    }
  }

  if (options.contentType !== undefined) {
    if (isJsonContentType(options.contentType)) {
      checks.push(pass("content-type", "readiness endpoint returned JSON"));
    } else {
      checks.push(block("content-type", `readiness endpoint returned ${options.contentType || "unknown"}`));
    }
  }

  if (!readiness || typeof readiness !== "object" || Array.isArray(readiness)) {
    checks.push(block("readiness-json", "readiness payload is not an object"));
  } else {
    checks.push(pass("readiness-json", "readiness payload is a JSON object"));
    validateReadinessPayload(readiness, { expectedSlot, expectedSchedulerRole, expectedReleaseSha }, checks);
  }

  const blockedReasons = checks
    .filter((check) => check.status === "block")
    .map((check) => `${check.id}: ${check.reason}`);

  return {
    taskId: "RA-344",
    mode: "readiness-canary",
    generatedAt,
    operator: "scripts/governance-rollout-canary.mjs",
    nonIntervention: true,
    target: {
      url: options.url ?? null,
      slot: expectedSlot,
      schedulerRole: expectedSchedulerRole,
      releaseSha: expectedReleaseSha,
    },
    readiness: summarizeReadiness(readiness),
    checks,
    blockedReasons,
    decision: blockedReasons.length === 0 ? "allow-promotion" : "block",
  };
}

function validateReadinessPayload(readiness, options, checks) {
  if (readiness.schemaVersion === readinessSchemaVersion) {
    checks.push(pass("schema-version", "readiness schema version matches RA-344"));
  } else {
    checks.push(block("schema-version", "readiness schema version is missing or unexpected"));
  }

  if (readiness.status === "ready") {
    checks.push(pass("readiness-status", "readiness status is ready"));
  } else {
    checks.push(block("readiness-status", `readiness status is ${readiness.status ?? "missing"}`));
  }

  const buildId = readNonEmpty(readiness.build?.id);
  if (buildId) {
    checks.push(pass("build-id", "readiness includes build id"));
  } else {
    checks.push(block("build-id", "readiness is missing build id"));
  }

  const releaseSha = normalizeOptionalGitSha(readiness.build?.sha);
  if (options.expectedReleaseSha && gitShaMatches(releaseSha, options.expectedReleaseSha)) {
    checks.push(pass("release-sha", `readiness release sha matches ${options.expectedReleaseSha}`));
  } else if (options.expectedReleaseSha) {
    checks.push(block(
      "release-sha",
      `readiness release sha is ${releaseSha || "missing"}, expected ${options.expectedReleaseSha}`,
    ));
  } else if (releaseSha) {
    checks.push(pass("release-sha", "readiness includes release sha"));
  } else {
    checks.push(block("release-sha", "readiness is missing release sha"));
  }

  const slotId = readNonEmpty(readiness.slot?.id);
  if (options.expectedSlot && slotId === options.expectedSlot) {
    checks.push(pass("slot-id", `readiness slot matches ${options.expectedSlot}`));
  } else if (options.expectedSlot) {
    checks.push(block("slot-id", `readiness slot is ${slotId || "missing"}, expected ${options.expectedSlot}`));
  } else if (slotId) {
    checks.push(pass("slot-id", "readiness includes slot id"));
  } else {
    checks.push(block("slot-id", "readiness is missing slot id"));
  }

  const schedulerRole = readNonEmpty(readiness.scheduler?.role);
  if (options.expectedSchedulerRole && schedulerRole === options.expectedSchedulerRole) {
    checks.push(pass("scheduler-role", `scheduler role matches ${options.expectedSchedulerRole}`));
  } else if (options.expectedSchedulerRole) {
    checks.push(block(
      "scheduler-role",
      `scheduler role is ${schedulerRole || "missing"}, expected ${options.expectedSchedulerRole}`,
    ));
  } else if (allowedSchedulerRoles.has(schedulerRole)) {
    checks.push(pass("scheduler-role", "scheduler role is explicit"));
  } else {
    checks.push(block("scheduler-role", "scheduler role is missing or invalid"));
  }

  if (readiness.database?.status === "reachable") {
    checks.push(pass("database", "database probe is reachable"));
  } else {
    checks.push(block("database", `database probe is ${readiness.database?.status ?? "missing"}`));
  }

  const migrationStatus = readiness.migration?.status;
  if (readyMigrationStatuses.has(migrationStatus)) {
    checks.push(pass("migration-status", `migration status is ${migrationStatus}`));
  } else {
    checks.push(block("migration-status", `migration status is ${migrationStatus ?? "missing"}`));
  }

  const blockers = Array.isArray(readiness.blockers) ? readiness.blockers : [];
  if (blockers.length === 0) {
    checks.push(pass("readiness-blockers", "readiness has no blockers"));
  } else {
    checks.push(block("readiness-blockers", `readiness blockers: ${blockers.join(", ")}`));
  }
}

function summarizeReadiness(readiness) {
  if (!readiness || typeof readiness !== "object" || Array.isArray(readiness)) {
    return null;
  }
  return {
    schemaVersion: readiness.schemaVersion ?? null,
    status: readiness.status ?? null,
    buildId: readiness.build?.id ?? null,
    releaseSha: readiness.build?.sha ?? null,
    slotId: readiness.slot?.id ?? null,
    schedulerRole: readiness.scheduler?.role ?? null,
    databaseStatus: readiness.database?.status ?? null,
    migrationStatus: readiness.migration?.status ?? null,
    blockers: Array.isArray(readiness.blockers) ? readiness.blockers : null,
  };
}

function normalizeOptionalEnum(value, allowed, name) {
  const normalized = `${value ?? ""}`.trim();
  if (!normalized) return null;
  if (!allowed.has(normalized)) {
    throw new Error(`${name} must be one of: ${[...allowed].join(", ")}`);
  }
  return normalized;
}

function normalizeOptionalGitSha(value) {
  const normalized = readNonEmpty(value);
  if (!normalized) return null;
  return /^[0-9a-f]{7,40}$/i.test(normalized) ? normalized.toLowerCase() : normalized;
}

function gitShaMatches(actual, expected) {
  if (!actual || !expected) return false;
  if (!/^[0-9a-f]{7,40}$/i.test(actual) || !/^[0-9a-f]{7,40}$/i.test(expected)) {
    return actual === expected;
  }
  return actual.startsWith(expected) || expected.startsWith(actual);
}

function readNonEmpty(value) {
  const trimmed = `${value ?? ""}`.trim();
  return trimmed || null;
}

function isJsonContentType(contentType) {
  return contentType.toLowerCase().split(";")[0].trim() === "application/json";
}

function pass(id, reason) {
  return { id, status: "pass", reason };
}

function block(id, reason) {
  return { id, status: "block", reason };
}

function parseArgs(argv) {
  const parsed = {
    filePath: null,
    url: null,
    expectedSlot: null,
    expectedSchedulerRole: null,
    expectedReleaseSha: null,
    reportPath: null,
    json: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--file") {
      parsed.filePath = argv[++index];
    } else if (arg === "--url") {
      parsed.url = argv[++index];
    } else if (arg === "--slot") {
      parsed.expectedSlot = argv[++index];
    } else if (arg === "--scheduler-role") {
      parsed.expectedSchedulerRole = argv[++index];
    } else if (arg === "--release-sha" || arg === "--expected-release-sha") {
      parsed.expectedReleaseSha = argv[++index];
    } else if (arg === "--report") {
      parsed.reportPath = argv[++index];
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
  console.log(`Usage: node scripts/governance-rollout-canary.mjs (--url <readiness-url> | --file <readiness-json>) [options]

Options:
  --slot <blue|green>                 Require a specific readiness slot id.
  --scheduler-role <role>             Require active, standby, or external.
  --release-sha <sha>                 Require a specific readiness build sha.
  --report <path>                     Write canary report JSON.
  --json                              Print canary report JSON.
`);
}

async function readInput(args) {
  if (args.filePath && args.url) {
    throw new Error("choose either --file or --url, not both");
  }
  if (args.filePath) {
    const absolutePath = path.resolve(repoRoot, args.filePath);
    return {
      readiness: JSON.parse(fs.readFileSync(absolutePath, "utf8")),
      url: null,
    };
  }
  if (args.url) {
    let response;
    try {
      response = await fetch(args.url, {
        method: "GET",
        headers: { accept: "application/json" },
      });
    } catch (error) {
      return {
        readiness: null,
        url: args.url,
        transportError: error instanceof Error ? error.message : String(error),
      };
    }
    const contentType = response.headers.get("content-type") ?? "";
    let readiness = null;
    if (isJsonContentType(contentType)) {
      readiness = await response.json();
    } else {
      await response.text();
    }
    return {
      readiness,
      url: args.url,
      httpStatus: response.status,
      contentType,
    };
  }
  throw new Error("--file or --url is required");
}

function writeReport(reportPath, report) {
  const absolutePath = path.resolve(repoRoot, reportPath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, `${JSON.stringify(report, null, 2)}\n`);
}

function printSummary(report) {
  console.log(`RA-344 governance readiness canary: ${report.decision}`);
  if (report.target.url) console.log(`target: ${report.target.url}`);
  if (report.readiness?.slotId) console.log(`slot: ${report.readiness.slotId}`);
  if (report.readiness?.buildId) console.log(`build: ${report.readiness.buildId}`);
  if (report.blockedReasons.length > 0) {
    console.log("blocked reasons:");
    for (const reason of report.blockedReasons) {
      console.log(`- ${reason}`);
    }
  }
}

async function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) {
      printHelp();
      return;
    }
    const input = await readInput(args);
    const report = buildReadinessCanaryReport({
      ...input,
      expectedSlot: args.expectedSlot,
      expectedSchedulerRole: args.expectedSchedulerRole,
      expectedReleaseSha: args.expectedReleaseSha,
    });
    if (args.reportPath) {
      writeReport(args.reportPath, report);
    }
    if (args.json) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      printSummary(report);
    }
    process.exit(report.decision === "allow-promotion" ? 0 : 1);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  main();
}
