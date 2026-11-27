#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scriptPath = fileURLToPath(import.meta.url);

const defaultImage = "arena-public-authd:local";
const defaultContainerName = "agents-arena-authd-canary-ra268-http";
const defaultPort = 4319;
const defaultNetwork = "arena-public-network";
const defaultHomeVolume = "agents-arena_authd_home";

export function buildAuthdCanaryReport(options = {}) {
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const checks = [];
  const quotaSnapshot = options.quotaSnapshot ?? null;
  const postMortem = options.postMortem ?? null;
  const logs = `${options.logs ?? ""}`;

  if (options.startError) {
    checks.push(block("container-start", `temporary canary failed to start: ${options.startError}`));
  } else if (options.containerStarted) {
    checks.push(pass("container-start", "temporary authd canary container started"));
  } else {
    checks.push(block("container-start", "temporary authd canary container did not start"));
  }

  validateQuotaSnapshot(quotaSnapshot, checks);
  validatePostMortem(postMortem, checks);

  if (logs.includes("[authd] listening on :4311")) {
    checks.push(pass("server-listen-log", "authd canary logged listening on :4311"));
  } else if (logs.trim()) {
    checks.push(block("server-listen-log", "authd canary logs did not include the listen marker"));
  } else {
    checks.push(block("server-listen-log", "authd canary logs were empty"));
  }

  if (options.cleanupError) {
    checks.push(block("cleanup", `temporary canary cleanup failed: ${options.cleanupError}`));
  } else if (options.cleanupConfirmed) {
    checks.push(pass("cleanup", "temporary authd canary container is not running"));
  } else {
    checks.push(block("cleanup", "temporary authd canary cleanup was not confirmed"));
  }

  const blockedReasons = checks
    .filter((check) => check.status === "block")
    .map((check) => `${check.id}: ${check.reason}`);

  return {
    taskId: "RA-268",
    mode: "authd-http-canary",
    generatedAt,
    operator: "scripts/authd-http-canary.mjs",
    activeServiceMutation: false,
    temporaryContainer: true,
    target: {
      image: options.image ?? defaultImage,
      containerName: options.containerName ?? defaultContainerName,
      port: options.port ?? defaultPort,
      network: options.network ?? defaultNetwork,
      homeVolume: options.homeVolume ?? defaultHomeVolume,
      activeContainerName: "agents-arena-authd-1",
    },
    quotaSnapshot: summarizeQuotaSnapshot(quotaSnapshot),
    postMortem: summarizePostMortem(postMortem),
    checks,
    blockedReasons,
    decision: blockedReasons.length === 0 ? "pass" : "block",
  };
}

export function buildAuthdEndpointReport(options = {}) {
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const checks = [];
  const quotaSnapshot = options.quotaSnapshot ?? null;
  const postMortem = options.postMortem ?? null;

  if (options.quotaFetchError) {
    checks.push(block("quota-fetch", `quota-windows fetch failed: ${options.quotaFetchError}`));
  } else {
    checks.push(pass("quota-fetch", "quota-windows endpoint responded"));
  }
  validateQuotaSnapshot(quotaSnapshot, checks);

  if (options.postMortemFetchError) {
    checks.push(block("post-mortem-fetch", `Claude post-mortem fetch failed: ${options.postMortemFetchError}`));
  } else {
    checks.push(pass("post-mortem-fetch", "Claude post-mortem endpoint responded"));
  }
  validatePostMortem(postMortem, checks);

  const blockedReasons = checks
    .filter((check) => check.status === "block")
    .map((check) => `${check.id}: ${check.reason}`);

  return {
    taskId: "RA-268",
    mode: "authd-http-endpoint-check",
    generatedAt,
    operator: "scripts/authd-http-canary.mjs",
    activeServiceMutation: false,
    temporaryContainer: false,
    target: {
      url: options.url ?? null,
      activeContainerName: "agents-arena-authd-1",
    },
    quotaSnapshot: summarizeQuotaSnapshot(quotaSnapshot),
    postMortem: summarizePostMortem(postMortem),
    checks,
    blockedReasons,
    decision: blockedReasons.length === 0 ? "pass" : "block",
  };
}

export async function runAuthdCanarySmoke(options = {}) {
  const image = options.image ?? defaultImage;
  const containerName = options.containerName ?? defaultContainerName;
  const port = Number(options.port ?? defaultPort);
  const network = options.network ?? defaultNetwork;
  const homeVolume = options.homeVolume ?? defaultHomeVolume;
  const probeTimeoutMs = Number(options.probeTimeoutMs ?? 8_000);
  const fetchTimeoutMs = Number(options.fetchTimeoutMs ?? 10_000);
  const baseUrl = `http://127.0.0.1:${port}`;

  const runArgs = [
    "run",
    "--rm",
    "-d",
    "--name",
    containerName,
    "--network",
    network,
    "-p",
    `127.0.0.1:${port}:4311`,
    "-v",
    `${homeVolume}:/home/node:ro`,
    "-e",
    `AUTHD_PROBE_TIMEOUT_MS=${probeTimeoutMs}`,
    image,
  ];

  let containerStarted = false;
  let startError = null;
  let quotaSnapshot = null;
  let postMortem = null;
  let logs = "";
  let cleanupError = null;
  let cleanupConfirmed = false;

  const start = spawnSync("docker", runArgs, {
    cwd: repoRoot,
    encoding: "utf8",
  });
  if (start.status !== 0) {
    startError = (start.stderr || start.stdout || `docker exited ${start.status}`).trim();
  } else {
    containerStarted = true;
  }

  try {
    if (containerStarted) {
      quotaSnapshot = await fetchJsonWithRetry(`${baseUrl}/quota-windows`, {
        timeoutMs: fetchTimeoutMs,
      });
      postMortem = await fetchJson(`${baseUrl}/providers/claude/post-mortem`, {
        method: "POST",
        timeoutMs: fetchTimeoutMs,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          failureType: "quota",
          message: "ra-268 authd http canary",
        }),
      });
      logs = runDocker(["logs", containerName]).stdout;
    }
  } finally {
    if (containerStarted) {
      const stop = runDocker(["stop", containerName]);
      if (stop.status !== 0) {
        cleanupError = stop.stderr || stop.stdout || `docker stop exited ${stop.status}`;
      }
      const ps = runDocker(["ps", "--filter", `name=${containerName}`, "--format", "{{.Names}}"]);
      cleanupConfirmed = ps.status === 0 && ps.stdout.trim() === "";
    }
  }

  return buildAuthdCanaryReport({
    generatedAt: options.generatedAt,
    image,
    containerName,
    port,
    network,
    homeVolume,
    containerStarted,
    startError,
    quotaSnapshot,
    postMortem,
    logs,
    cleanupError,
    cleanupConfirmed,
  });
}

export async function runAuthdEndpointCheck(options = {}) {
  const baseUrl = normalizeBaseUrl(options.url);
  const fetchTimeoutMs = Number(options.fetchTimeoutMs ?? 10_000);
  let quotaSnapshot = null;
  let postMortem = null;
  let quotaFetchError = null;
  let postMortemFetchError = null;

  try {
    quotaSnapshot = await fetchJson(`${baseUrl}/quota-windows`, {
      timeoutMs: fetchTimeoutMs,
    });
  } catch (error) {
    quotaFetchError = error instanceof Error ? error.message : String(error);
  }

  try {
    postMortem = await fetchJson(`${baseUrl}/providers/claude/post-mortem`, {
      method: "POST",
      timeoutMs: fetchTimeoutMs,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        failureType: "quota",
        message: "ra-268 authd endpoint check",
      }),
    });
  } catch (error) {
    postMortemFetchError = error instanceof Error ? error.message : String(error);
  }

  return buildAuthdEndpointReport({
    generatedAt: options.generatedAt,
    url: baseUrl,
    quotaSnapshot,
    postMortem,
    quotaFetchError,
    postMortemFetchError,
  });
}

function validateQuotaSnapshot(snapshot, checks) {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    checks.push(block("quota-snapshot", "quota-windows response is not a JSON object"));
    return;
  }
  const results = Array.isArray(snapshot.results) ? snapshot.results : [];
  const anthropic = results.find((result) => result?.provider === "anthropic");
  const openai = results.find((result) => result?.provider === "openai");

  if (anthropic?.source === "anthropic-oauth" && anthropic.ok === false) {
    checks.push(pass("anthropic-quota-source", "Anthropic quota comes from authd OAuth source"));
  } else {
    checks.push(block("anthropic-quota-source", "Anthropic quota result is missing or not provider-scoped"));
  }

  if (isClaudeAuthInvalidText(anthropic?.error)) {
    checks.push(block(
      "anthropic-auth-invalid",
      "Claude OAuth credentials are invalid; re-login in authd before RA-268 active proof",
    ));
  } else if (typeof anthropic?.error === "string" && anthropic.error.includes("quota is currently limited")) {
    checks.push(pass("anthropic-quota-limited-text", "Anthropic quota error is explicitly quota-limited"));
  } else {
    checks.push(block("anthropic-quota-limited-text", "Anthropic quota error does not use the quota-limited wording"));
  }

  if (openai?.provider === "openai" && openai.source === "codex-rpc") {
    checks.push(pass("codex-quota-source", "Codex quota result comes from authd Codex RPC source"));
  } else {
    checks.push(block("codex-quota-source", "Codex quota result is missing or not provider-scoped"));
  }
}

function validatePostMortem(postMortem, checks) {
  if (!postMortem || typeof postMortem !== "object" || Array.isArray(postMortem)) {
    checks.push(block("post-mortem", "Claude post-mortem response is not a JSON object"));
    return;
  }
  if (
    postMortem.diagnosis === "auth_invalid"
    || postMortem.health?.status === "invalid"
    || isClaudeAuthInvalidText(postMortem.quota?.error)
    || isClaudeAuthInvalidText(postMortem.detail)
  ) {
    checks.push(block(
      "post-mortem-auth-invalid",
      "Claude post-mortem reports auth_invalid; re-login in authd before RA-268 active proof",
    ));
    return;
  }
  if (postMortem.health?.status === "ready") {
    checks.push(pass("post-mortem-health", "Claude health remains ready"));
  } else {
    checks.push(block("post-mortem-health", `Claude health is ${postMortem.health?.status ?? "missing"}`));
  }
  if (postMortem.quota?.ok === false && `${postMortem.quota?.error ?? ""}`.includes("quota is currently limited")) {
    checks.push(pass("post-mortem-quota", "Claude post-mortem carries quota-limited quota truth"));
  } else {
    checks.push(block("post-mortem-quota", "Claude post-mortem quota truth is missing or not quota-limited"));
  }
  if (postMortem.diagnosis === "quota_limited") {
    checks.push(pass("post-mortem-diagnosis", "Claude post-mortem diagnosis is quota_limited"));
  } else {
    checks.push(block("post-mortem-diagnosis", `Claude post-mortem diagnosis is ${postMortem.diagnosis ?? "missing"}`));
  }
}

function isClaudeAuthInvalidText(value) {
  const text = `${value ?? ""}`.toLowerCase();
  return text.includes("401") || text.includes("credentials are not usable");
}

function summarizeQuotaSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) return null;
  const results = Array.isArray(snapshot.results) ? snapshot.results : [];
  return {
    generatedAt: snapshot.generatedAt ?? null,
    results: results.map((result) => ({
      provider: result?.provider ?? null,
      source: result?.source ?? null,
      ok: result?.ok ?? null,
      error: result?.error ?? null,
      windowCount: Array.isArray(result?.windows) ? result.windows.length : null,
    })),
  };
}

function summarizePostMortem(postMortem) {
  if (!postMortem || typeof postMortem !== "object" || Array.isArray(postMortem)) return null;
  return {
    provider: postMortem.provider ?? null,
    healthStatus: postMortem.health?.status ?? null,
    healthSource: postMortem.health?.source ?? null,
    quotaOk: postMortem.quota?.ok ?? null,
    quotaError: postMortem.quota?.error ?? null,
    diagnosis: postMortem.diagnosis ?? null,
    detail: postMortem.detail ?? null,
  };
}

async function fetchJsonWithRetry(url, options = {}) {
  const timeoutAt = Date.now() + Number(options.timeoutMs ?? 10_000);
  let lastError = null;
  while (Date.now() < timeoutAt) {
    try {
      return await fetchJson(url, options);
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  throw lastError ?? new Error(`fetch failed for ${url}`);
}

async function fetchJson(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number(options.timeoutMs ?? 10_000));
  try {
    const response = await fetch(url, {
      method: options.method ?? "GET",
      headers: options.headers,
      body: options.body,
      signal: controller.signal,
    });
    const text = await response.text();
    const body = text ? JSON.parse(text) : null;
    if (!response.ok) {
      throw new Error(`${url} returned ${response.status}: ${text}`);
    }
    return body;
  } finally {
    clearTimeout(timeout);
  }
}

function runDocker(args) {
  return spawnSync("docker", args, {
    cwd: repoRoot,
    encoding: "utf8",
  });
}

function normalizeBaseUrl(url) {
  const normalized = `${url ?? ""}`.trim().replace(/\/+$/, "");
  if (!normalized) {
    throw new Error("--url is required for endpoint check mode");
  }
  return normalized;
}

function pass(id, reason) {
  return { id, status: "pass", reason };
}

function block(id, reason) {
  return { id, status: "block", reason };
}

function parseArgs(argv) {
  const parsed = {
    image: defaultImage,
    containerName: defaultContainerName,
    port: defaultPort,
    network: defaultNetwork,
    homeVolume: defaultHomeVolume,
    url: null,
    reportPath: null,
    json: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--image") {
      parsed.image = argv[++index];
    } else if (arg === "--url") {
      parsed.url = argv[++index];
    } else if (arg === "--container-name") {
      parsed.containerName = argv[++index];
    } else if (arg === "--port") {
      parsed.port = Number(argv[++index]);
    } else if (arg === "--network") {
      parsed.network = argv[++index];
    } else if (arg === "--home-volume") {
      parsed.homeVolume = argv[++index];
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

  if (!Number.isInteger(parsed.port) || parsed.port <= 0) {
    throw new Error("--port must be a positive integer");
  }

  return parsed;
}

function printHelp() {
  console.log(`Usage: node scripts/authd-http-canary.mjs [options]

Starts a temporary non-active authd container from the requested image, probes
the real HTTP quota/post-mortem endpoints, then stops the container.
With --url, checks an existing authd endpoint read-only without Docker.

Options:
  --url <base-url>                Check an existing authd endpoint without Docker.
  --image <image>                 Authd image to smoke. Default: ${defaultImage}
  --container-name <name>          Temporary container name. Default: ${defaultContainerName}
  --port <port>                    Host port for temporary canary. Default: ${defaultPort}
  --network <name>                 Docker network. Default: ${defaultNetwork}
  --home-volume <volume>           Authd home volume mounted read-only. Default: ${defaultHomeVolume}
  --report <path>                  Write report JSON.
  --json                           Print report JSON.
`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  const report = args.url
    ? await runAuthdEndpointCheck(args)
    : await runAuthdCanarySmoke(args);
  if (args.reportPath) {
    const reportPath = path.resolve(repoRoot, args.reportPath);
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  }
  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`${report.mode}: ${report.decision}`);
    for (const reason of report.blockedReasons) {
      console.log(`- ${reason}`);
    }
  }

  if (report.decision !== "pass") {
    process.exitCode = 1;
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack || error.message : String(error));
    process.exit(1);
  });
}
