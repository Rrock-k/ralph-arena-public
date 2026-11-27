#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scriptPath = fileURLToPath(import.meta.url);

export function buildRunnerInventoryReport(options = {}) {
  const oldSlotOrigins = normalizeOriginList(options.oldSlotOrigins, "old slot origin");
  const stableOrigins = normalizeOriginList(options.stableOrigins ?? [], "stable origin", {
    required: false,
  });
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const containers = normalizeInspectInput(options.inspect)
    .map(summarizeContainer)
    .filter((container) => container.isArenaRuntime);
  const runningContainers = containers.filter((container) => container.running);
  const directOldSlot = runningContainers.filter((container) =>
    container.governanceUrlOrigin && oldSlotOrigins.includes(container.governanceUrlOrigin),
  );
  const missingGovernanceUrl = runningContainers.filter((container) => !container.governanceUrlOrigin);
  const stableUrl = runningContainers.filter((container) =>
    container.governanceUrlOrigin && stableOrigins.includes(container.governanceUrlOrigin),
  );
  const otherUrl = runningContainers.filter((container) =>
    container.governanceUrlOrigin
    && !oldSlotOrigins.includes(container.governanceUrlOrigin)
    && !stableOrigins.includes(container.governanceUrlOrigin),
  );
  const checks = [];

  if (oldSlotOrigins.length > 0) {
    checks.push(pass("old-slot-origins", "old slot origins are explicit"));
  } else {
    checks.push(block("old-slot-origins", "at least one old slot origin is required"));
  }

  if (directOldSlot.length === 0) {
    checks.push(pass("direct-old-slot-url", "no running runner uses a direct old-slot governance URL"));
  } else {
    checks.push(block(
      "direct-old-slot-url",
      `${directOldSlot.length} running runner(s) still use a direct old-slot governance URL`,
      { containers: directOldSlot.map((container) => container.name) },
    ));
  }

  if (missingGovernanceUrl.length === 0) {
    checks.push(pass("missing-governance-url", "all running Arena runtime containers expose ARENA_GOVERNANCE_URL"));
  } else {
    checks.push(block(
      "missing-governance-url",
      `${missingGovernanceUrl.length} running Arena runtime container(s) are missing ARENA_GOVERNANCE_URL`,
      { containers: missingGovernanceUrl.map((container) => container.name) },
    ));
  }

  const blockedReasons = checks
    .filter((check) => check.status === "block")
    .map((check) => `${check.id}: ${check.reason}`);

  return {
    taskId: "RA-344",
    mode: "runner-inventory",
    generatedAt,
    operator: "scripts/governance-rollout-runner-inventory.mjs",
    nonIntervention: true,
    input: {
      oldSlotOrigins,
      stableOrigins,
    },
    counts: {
      inspectedContainers: normalizeInspectInput(options.inspect).length,
      arenaRuntimeContainers: containers.length,
      runningArenaRuntimeContainers: runningContainers.length,
      directOldSlotGovernanceUrl: directOldSlot.length,
      missingGovernanceUrl: missingGovernanceUrl.length,
      stableGovernanceUrl: stableUrl.length,
      otherGovernanceUrl: otherUrl.length,
    },
    containers,
    checks,
    blockedReasons,
    oldSlotStop: {
      allowed: blockedReasons.length === 0,
      reason: blockedReasons.length === 0 ? "no-direct-old-slot-governance-url" : "runner-inventory-blocked",
    },
    decision: blockedReasons.length === 0 ? "drained" : "retain-old-slot",
  };
}

export function writeRunnerInventoryReport(report, reportPath) {
  const absolutePath = path.resolve(repoRoot, reportPath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, `${JSON.stringify(report, null, 2)}\n`);
  return absolutePath;
}

function summarizeContainer(container) {
  const env = readEnv(container?.Config?.Env);
  const labels = normalizeRecord(container?.Config?.Labels);
  const name = readContainerName(container);
  const governanceUrl = readNonEmpty(env.ARENA_GOVERNANCE_URL);
  const governanceUrlOrigin = governanceUrl ? normalizeUrlOrigin(governanceUrl) : null;
  const projectId = readNonEmpty(env.ARENA_PROJECT_ID) || readNonEmpty(labels["arena.project.id"]);
  const workspaceLabel = readNonEmpty(labels["arena.project.slug"]);
  const isArenaRuntime = Boolean(
    projectId
    || readNonEmpty(env.ARENA_CONTAINER_NAME)
    || readNonEmpty(env.ARENA_RUNNER_VERSION)
    || readNonEmpty(labels["arena.agent"]),
  );

  return {
    id: readNonEmpty(container?.Id)?.slice(0, 12) ?? null,
    name,
    running: container?.State?.Running === true,
    isArenaRuntime,
    projectId,
    workspaceLabel,
    governanceUrl,
    governanceUrlOrigin,
    governancePublicUrl: readNonEmpty(env.ARENA_GOVERNANCE_PUBLIC_URL),
    runnerVersion: readNonEmpty(env.ARENA_RUNNER_VERSION),
    labels: {
      arenaProjectId: readNonEmpty(labels["arena.project.id"]),
      arenaProjectSlug: readNonEmpty(labels["arena.project.slug"]),
      arenaAgent: readNonEmpty(labels["arena.agent"]),
      arenaHost: readNonEmpty(labels["arena.host"]),
    },
  };
}

function normalizeInspectInput(input) {
  if (!input) {
    throw new Error("docker inspect input is required");
  }
  if (Array.isArray(input)) {
    return input.filter((entry) => entry && typeof entry === "object" && !Array.isArray(entry));
  }
  if (typeof input === "object") {
    return [input];
  }
  throw new Error("docker inspect input must be an object or array");
}

function normalizeOriginList(values, name, options = {}) {
  const required = options.required !== false;
  const list = Array.isArray(values) ? values : [values];
  const origins = [];
  for (const value of list) {
    if (!readNonEmpty(value)) {
      if (required) {
        throw new Error(`${name} is required`);
      }
      continue;
    }
    const origin = normalizeUrlOrigin(value);
    if (!origins.includes(origin)) {
      origins.push(origin);
    }
  }
  if (required && origins.length === 0) {
    throw new Error(`${name} is required`);
  }
  return origins;
}

function normalizeUrlOrigin(value) {
  const raw = readNonEmpty(value);
  if (!raw) {
    throw new Error("origin is required");
  }
  const candidate = raw.includes("://") ? raw : `http://${raw}`;
  let parsed;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new Error(`invalid origin: ${value}`);
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error(`origin must use http or https: ${value}`);
  }
  if (parsed.pathname !== "/" || parsed.search || parsed.hash) {
    throw new Error(`origin must not include path, query, or hash: ${value}`);
  }
  if (!parsed.port && parsed.protocol === "http:") {
    throw new Error(`http origin must include an explicit port: ${value}`);
  }
  return parsed.origin;
}

function readEnv(envEntries) {
  const env = {};
  if (!Array.isArray(envEntries)) {
    return env;
  }
  for (const entry of envEntries) {
    if (typeof entry !== "string") continue;
    const separator = entry.indexOf("=");
    if (separator <= 0) continue;
    env[entry.slice(0, separator)] = entry.slice(separator + 1);
  }
  return env;
}

function readContainerName(container) {
  const rawName = readNonEmpty(container?.Name);
  if (rawName) {
    return rawName.replace(/^\/+/, "");
  }
  const names = Array.isArray(container?.Names) ? container.Names : [];
  for (const name of names) {
    const normalized = readNonEmpty(name);
    if (normalized) {
      return normalized.replace(/^\/+/, "");
    }
  }
  return readNonEmpty(container?.Config?.Hostname) || "unknown";
}

function normalizeRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function readNonEmpty(value) {
  const normalized = `${value ?? ""}`.trim();
  return normalized || null;
}

function pass(id, reason, details = undefined) {
  return { id, status: "pass", reason, ...(details ? { details } : {}) };
}

function block(id, reason, details = undefined) {
  return { id, status: "block", reason, ...(details ? { details } : {}) };
}

function readJsonFile(filePath) {
  const absolutePath = path.resolve(repoRoot, filePath);
  try {
    return JSON.parse(fs.readFileSync(absolutePath, "utf8"));
  } catch (error) {
    throw new Error(`failed to read docker inspect JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function parseArgs(argv) {
  const parsed = {
    inspectPath: null,
    oldSlotOrigins: [],
    stableOrigins: [],
    reportPath: null,
    json: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--inspect") {
      parsed.inspectPath = argv[++index];
    } else if (arg === "--old-slot-origin") {
      parsed.oldSlotOrigins.push(argv[++index]);
    } else if (arg === "--stable-origin") {
      parsed.stableOrigins.push(argv[++index]);
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
  console.log(`Usage: node scripts/governance-rollout-runner-inventory.mjs --inspect <docker-inspect.json> --old-slot-origin <origin> [options]

Options:
  --old-slot-origin <origin>  Origin for a direct old-slot governance URL. Repeatable.
  --stable-origin <origin>    Known stable governance origin for classification. Repeatable.
  --report <path>             Write runner-inventory.json report.
  --json                      Print full report JSON.
`);
}

function printSummary(report) {
  console.log(`RA-344 runner inventory: ${report.decision}`);
  console.log(`running arena runtime containers: ${report.counts.runningArenaRuntimeContainers}`);
  console.log(`direct old-slot URLs: ${report.counts.directOldSlotGovernanceUrl}`);
  if (report.blockedReasons.length > 0) {
    console.log("blocked reasons:");
    for (const reason of report.blockedReasons) {
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
    if (!args.inspectPath) throw new Error("--inspect is required");
    if (args.oldSlotOrigins.length === 0) throw new Error("--old-slot-origin is required");

    const report = buildRunnerInventoryReport({
      inspect: readJsonFile(args.inspectPath),
      oldSlotOrigins: args.oldSlotOrigins,
      stableOrigins: args.stableOrigins,
    });
    const written = args.reportPath ? writeRunnerInventoryReport(report, args.reportPath) : null;
    const output = written ? { ...report, written } : report;

    if (args.json) {
      console.log(JSON.stringify(output, null, 2));
    } else {
      printSummary(report);
      if (written) console.log(`report: ${written}`);
    }
    process.exit(report.decision === "drained" ? 0 : 1);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  main();
}
