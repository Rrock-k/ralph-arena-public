#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scriptPath = fileURLToPath(import.meta.url);

const safeEnvKeys = [
  "ARENA_GOVERNANCE_URL",
  "ARENA_GOVERNANCE_PUBLIC_URL",
  "GOVERNANCE_BUILD_ID",
  "GOVERNANCE_INTERNAL_URL",
  "GOVERNANCE_MIGRATION_STATUS",
  "GOVERNANCE_PUBLIC_URL",
  "GOVERNANCE_RELEASE_SHA",
  "GOVERNANCE_SCHEDULER_ROLE",
  "GOVERNANCE_SLOT_ID",
  "GOVERNANCE_URL",
  "NODE_ENV",
  "PORT",
];

export function buildLocalTopologyReport(options = {}) {
  const inspect = normalizeInspectInput(options.inspect ?? []);
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const projectName = readNonEmpty(options.projectName) || "agents-arena";
  const composeFile = readNonEmpty(options.composeFile) || "docker-compose.local.yml";
  const commandErrors = Array.isArray(options.commandErrors) ? options.commandErrors.filter(Boolean) : [];
  const composeContainers = inspect.filter((container) => getLabel(container, "com.docker.compose.project") === projectName);
  const runtimeContainers = inspect.filter(isArenaRuntimeContainer);
  const services = composeContainers
    .map(summarizeComposeService)
    .sort((a, b) => `${a.service}:${a.name}`.localeCompare(`${b.service}:${b.name}`));
  const governanceUrlEnv = inspect.flatMap(summarizeGovernanceUrlEnv);
  const schedulerOwners = services
    .filter((service) => service.selectedEnv.GOVERNANCE_SCHEDULER_ROLE)
    .map((service) => ({
      name: service.name,
      service: service.service,
      running: service.running,
      schedulerRole: service.selectedEnv.GOVERNANCE_SCHEDULER_ROLE,
      slotId: service.selectedEnv.GOVERNANCE_SLOT_ID ?? null,
      buildId: service.selectedEnv.GOVERNANCE_BUILD_ID ?? null,
      migrationStatus: service.selectedEnv.GOVERNANCE_MIGRATION_STATUS ?? null,
    }));
  const apiProxyServices = services
    .filter((service) => service.service === "api-proxy")
    .map((service) => ({
      name: service.name,
      running: service.running,
      pid: service.pid,
      startedAt: service.startedAt,
      health: service.health,
      activeRegistrationCount: null,
    }));
  const runtimeInventory = runtimeContainers
    .map(summarizeRuntimeContainer)
    .sort((a, b) => a.name.localeCompare(b.name));
  const checks = [];

  checks.push(pass("read-only-command-set", "inspector uses docker ps and docker inspect only"));

  if (commandErrors.length === 0) {
    checks.push(pass("docker-read-commands", "docker read commands completed"));
  } else {
    checks.push(block("docker-read-commands", "one or more docker read commands failed", { commandErrors }));
  }

  if (services.length > 0) {
    checks.push(pass("compose-services", "compose project containers were observed"));
  } else {
    checks.push(pass("compose-services", "no compose project containers were observed"));
  }

  const blockedReasons = checks
    .filter((check) => check.status === "block")
    .map((check) => `${check.id}: ${check.reason}`);

  return {
    taskId: "RA-344",
    mode: "local-topology-inspector",
    generatedAt,
    operator: "./scripts/docker-local-stack.sh inspect topology",
    nonIntervention: true,
    input: {
      projectName,
      composeFile,
    },
    counts: {
      inspectedContainers: inspect.length,
      composeProjectContainers: composeContainers.length,
      arenaRuntimeContainers: runtimeContainers.length,
      runningArenaRuntimeContainers: runtimeInventory.filter((container) => container.running).length,
      governanceUrlEnvEntries: governanceUrlEnv.length,
      schedulerOwners: schedulerOwners.length,
      apiProxyServices: apiProxyServices.length,
    },
    compose: {
      projectName,
      services,
    },
    governanceUrlEnv,
    scheduler: {
      owners: schedulerOwners,
    },
    apiProxy: {
      services: apiProxyServices,
    },
    runtimeContainers: runtimeInventory,
    checks,
    blockedReasons,
    decision: blockedReasons.length === 0 ? "captured" : "partial",
  };
}

export function collectTopologyInspect(options = {}) {
  const projectName = readNonEmpty(options.projectName) || "agents-arena";
  const commandErrors = [];
  const containerRows = [
    ...runDockerPs(["--filter", `label=com.docker.compose.project=${projectName}`], commandErrors),
    ...runDockerPs(["--filter", "label=arena.project.id"], commandErrors),
  ];
  const ids = unique(containerRows.map((row) => readNonEmpty(row.ID) || readNonEmpty(row.Id)).filter(Boolean));
  if (ids.length === 0) {
    return { inspect: [], commandErrors };
  }
  const inspectResult = runDockerJson(["inspect", ...ids], commandErrors);
  return {
    inspect: Array.isArray(inspectResult) ? inspectResult : [],
    commandErrors,
  };
}

export function writeLocalTopologyReport(report, reportPath) {
  const absolutePath = path.resolve(repoRoot, reportPath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, `${JSON.stringify(report, null, 2)}\n`);
  return absolutePath;
}

export function dockerLocalStackInspectIsEarly(scriptText) {
  const inspectIndex = scriptText.indexOf('if [ "$command_word" = "inspect" ] && [ "$target_word" = "topology" ]; then');
  const mkdirIndex = scriptText.indexOf("mkdir -p");
  const networkIndex = scriptText.indexOf("docker network create");
  const npmCiIndex = scriptText.indexOf("npm ci");
  const dockerBuildIndex = scriptText.indexOf("docker build");

  return inspectIndex >= 0
    && (mkdirIndex < 0 || inspectIndex < mkdirIndex)
    && (networkIndex < 0 || inspectIndex < networkIndex)
    && (npmCiIndex < 0 || inspectIndex < npmCiIndex)
    && (dockerBuildIndex < 0 || inspectIndex < dockerBuildIndex);
}

function summarizeComposeService(container) {
  const env = readEnv(container?.Config?.Env);
  const labels = normalizeRecord(container?.Config?.Labels);
  return {
    id: readNonEmpty(container?.Id)?.slice(0, 12) ?? null,
    name: readContainerName(container),
    service: readNonEmpty(labels["com.docker.compose.service"]) ?? "unknown",
    running: container?.State?.Running === true,
    status: readNonEmpty(container?.State?.Status) ?? (container?.State?.Running === true ? "running" : "unknown"),
    health: readNonEmpty(container?.State?.Health?.Status) ?? "none",
    pid: Number.isFinite(Number(container?.State?.Pid)) ? Number(container.State.Pid) : null,
    startedAt: readNonEmpty(container?.State?.StartedAt),
    image: readNonEmpty(container?.Config?.Image ?? container?.Image),
    selectedEnv: selectSafeEnv(env),
    composeProject: readNonEmpty(labels["com.docker.compose.project"]),
  };
}

function summarizeGovernanceUrlEnv(container) {
  const env = readEnv(container?.Config?.Env);
  const labels = normalizeRecord(container?.Config?.Labels);
  const name = readContainerName(container);
  const service = readNonEmpty(labels["com.docker.compose.service"]);
  const entries = [];

  for (const key of ["ARENA_GOVERNANCE_URL", "ARENA_GOVERNANCE_PUBLIC_URL", "GOVERNANCE_INTERNAL_URL", "GOVERNANCE_PUBLIC_URL", "GOVERNANCE_URL"]) {
    const value = readNonEmpty(env[key]);
    if (!value) continue;
    entries.push({
      container: name,
      service,
      key,
      value,
      origin: normalizeUrlOrigin(value),
    });
  }

  return entries;
}

function summarizeRuntimeContainer(container) {
  const env = readEnv(container?.Config?.Env);
  const labels = normalizeRecord(container?.Config?.Labels);
  const governanceUrl = readNonEmpty(env.ARENA_GOVERNANCE_URL);
  return {
    id: readNonEmpty(container?.Id)?.slice(0, 12) ?? null,
    name: readContainerName(container),
    running: container?.State?.Running === true,
    status: readNonEmpty(container?.State?.Status) ?? (container?.State?.Running === true ? "running" : "unknown"),
    health: readNonEmpty(container?.State?.Health?.Status) ?? "none",
    projectId: readNonEmpty(env.ARENA_PROJECT_ID) ?? readNonEmpty(labels["arena.project.id"]),
    workspaceLabel: readNonEmpty(labels["arena.project.slug"]),
    governanceUrl,
    governanceUrlOrigin: governanceUrl ? normalizeUrlOrigin(governanceUrl) : null,
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

function runDockerPs(args, commandErrors) {
  const rows = runDockerJsonLines([
    "ps",
    "-a",
    ...args,
    "--format",
    "{{json .}}",
  ], commandErrors);
  return Array.isArray(rows) ? rows : [];
}

function runDockerJsonLines(args, commandErrors) {
  const result = spawnSync("docker", args, { encoding: "utf8" });
  if (result.status !== 0) {
    commandErrors.push({
      command: ["docker", ...args].join(" "),
      status: result.status,
      stderr: result.stderr.trim(),
    });
    return [];
  }
  return result.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function runDockerJson(args, commandErrors) {
  const result = spawnSync("docker", args, { encoding: "utf8" });
  if (result.status !== 0) {
    commandErrors.push({
      command: ["docker", ...args].join(" "),
      status: result.status,
      stderr: result.stderr.trim(),
    });
    return null;
  }
  return JSON.parse(result.stdout || "null");
}

function normalizeInspectInput(input) {
  if (Array.isArray(input)) {
    return input.filter((entry) => entry && typeof entry === "object" && !Array.isArray(entry));
  }
  if (input && typeof input === "object") {
    return [input];
  }
  return [];
}

function isArenaRuntimeContainer(container) {
  const env = readEnv(container?.Config?.Env);
  const labels = normalizeRecord(container?.Config?.Labels);
  return Boolean(
    readNonEmpty(env.ARENA_PROJECT_ID)
    || readNonEmpty(env.ARENA_CONTAINER_NAME)
    || readNonEmpty(env.ARENA_RUNNER_VERSION)
    || readNonEmpty(labels["arena.project.id"])
    || readNonEmpty(labels["arena.agent"]),
  );
}

function selectSafeEnv(env) {
  const selected = {};
  for (const key of safeEnvKeys) {
    const value = readNonEmpty(env[key]);
    if (value) selected[key] = value;
  }
  return selected;
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

function getLabel(container, key) {
  return readNonEmpty(normalizeRecord(container?.Config?.Labels)[key]);
}

function normalizeUrlOrigin(value) {
  const raw = readNonEmpty(value);
  if (!raw) return null;
  const candidate = raw.includes("://") ? raw : `http://${raw}`;
  try {
    return new URL(candidate).origin;
  } catch {
    return null;
  }
}

function readNonEmpty(value) {
  const normalized = `${value ?? ""}`.trim();
  return normalized || null;
}

function unique(values) {
  return [...new Set(values)];
}

function pass(id, reason, details = undefined) {
  return { id, status: "pass", reason, ...(details ? { details } : {}) };
}

function block(id, reason, details = undefined) {
  return { id, status: "block", reason, ...(details ? { details } : {}) };
}

function parseArgs(argv) {
  const parsed = {
    composeFile: null,
    fixtureInspectPath: null,
    generatedAt: null,
    json: false,
    projectName: null,
    reportPath: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--compose-file") {
      parsed.composeFile = argv[++index];
    } else if (arg === "--fixture-inspect") {
      parsed.fixtureInspectPath = argv[++index];
    } else if (arg === "--generated-at") {
      parsed.generatedAt = argv[++index];
    } else if (arg === "--json") {
      parsed.json = true;
    } else if (arg === "--project-name") {
      parsed.projectName = argv[++index];
    } else if (arg === "--report") {
      parsed.reportPath = argv[++index];
    } else if (arg === "--help" || arg === "-h") {
      parsed.help = true;
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }

  return parsed;
}

function printHelp() {
  console.log(`Usage: ./scripts/docker-local-stack.sh inspect topology [options]

Options:
  --report <path>          Write topology report JSON.
  --json                   Print topology report JSON.
  --fixture-inspect <path> Use saved docker inspect JSON instead of live Docker reads.
`);
}

function readFixtureInspect(fixturePath) {
  const absolutePath = path.resolve(repoRoot, fixturePath);
  return JSON.parse(fs.readFileSync(absolutePath, "utf8"));
}

function printSummary(report) {
  console.log(`RA-344 local topology inspector: ${report.decision}`);
  console.log(`project: ${report.input.projectName}`);
  console.log(`compose containers: ${report.counts.composeProjectContainers}`);
  console.log(`arena runtime containers: ${report.counts.arenaRuntimeContainers}`);
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
    const live = args.fixtureInspectPath
      ? { inspect: readFixtureInspect(args.fixtureInspectPath), commandErrors: [] }
      : collectTopologyInspect({ projectName: args.projectName });
    const report = buildLocalTopologyReport({
      ...live,
      composeFile: args.composeFile,
      generatedAt: args.generatedAt,
      projectName: args.projectName,
    });

    if (args.reportPath) {
      writeLocalTopologyReport(report, args.reportPath);
    }
    if (args.json) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      printSummary(report);
    }
    process.exit(report.decision === "captured" ? 0 : 1);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  main();
}
