import { execSync, spawn } from "node:child_process";
import { existsSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(scriptDir, "..");
const repoRoot = path.resolve(appDir, "../..");
const workerDir = path.join(repoRoot, "services/worker-agent");
const readyFile = process.env.PLAYWRIGHT_READY_FILE?.trim() || path.join(appDir, ".playwright-server-ready");

const env = { ...process.env };
const defaultDb = env.DATABASE_URL?.trim() ?? "";
const appPort = env.PORT?.trim() || env.APP_PORT?.trim() || "3000";
const workerPort = env.PLAYWRIGHT_WORKER_PORT?.trim() || "4299";
const maxConcurrentRuns = env.PLAYWRIGHT_WORKER_MAX_CONCURRENT_RUNS?.trim() || "128";
const sharedWorkerSecret = env.PLAYWRIGHT_WORKER_SECRET?.trim()
  || env.WORKER_SECRET?.trim()
  || env.RUNNER_WEBHOOK_SECRET?.trim()
  || "playwright-worker-secret";
const cronSecret = env.PLAYWRIGHT_CRON_SECRET?.trim()
  || env.CRON_SECRET?.trim()
  || "playwright-cron-secret";
const workerAgentUrl = env.WORKER_AGENT_URL?.trim() || `http://localhost:${workerPort}`;
const governanceInternalUrl = env.GOVERNANCE_INTERNAL_URL?.trim() || `http://host.docker.internal:${appPort}`;
const repoPath = env.ARENA_HOST_PATH?.trim() || repoRoot;
const governanceUrl = env.PLAYWRIGHT_BASE_URL?.trim() || `http://localhost:${appPort}`;
const secretsEncryptionKey = env.SECRETS_ENCRYPTION_KEY?.trim()
  || "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const warmupTimeoutMs = Number(env.PLAYWRIGHT_WARMUP_TIMEOUT_MS?.trim() || "120000");
const warmupPollMs = Number(env.PLAYWRIGHT_WARMUP_POLL_MS?.trim() || "1000");

env.PLAYWRIGHT_TEST = "1";
env.PORT = appPort;
env.APP_PORT = appPort;
env.WORKER_SECRET = sharedWorkerSecret;
env.RUNNER_WEBHOOK_SECRET = sharedWorkerSecret;
env.CRON_SECRET = cronSecret;
env.WORKER_AGENT_URL = workerAgentUrl;
env.GOVERNANCE_INTERNAL_URL = governanceInternalUrl;
env.AUTHD_URL = env.AUTHD_URL?.trim() || "http://localhost:4311";
env.API_PROXY_HOST_URL = env.API_PROXY_HOST_URL?.trim() || "http://localhost:4100";
env.PREVIEW_DOMAIN = env.PREVIEW_DOMAIN?.trim() || "localhost:8080";
env.ARENA_NETWORK = env.ARENA_NETWORK?.trim() || "arena-public-network";
env.ARENA_HOST_PATH = repoPath;
env.ARENA_DEV_MODE = env.ARENA_DEV_MODE?.trim() || "true";
env.WORKER_IMAGE = env.WORKER_IMAGE?.trim() || "arena-public-worker:local";
env.SECRETS_ENCRYPTION_KEY = secretsEncryptionKey;
env.PLAYWRIGHT_READY_FILE = readyFile;

rmSync(readyFile, { force: true });

const playwrightDb = env.PLAYWRIGHT_DATABASE_URL?.trim();
if (!playwrightDb) {
  console.error("[playwright-dev] PLAYWRIGHT_DATABASE_URL is required. Refusing to run against dev DB.");
  process.exit(1);
}
env.DATABASE_URL = playwrightDb;
console.log("[playwright-dev] Using PLAYWRIGHT_DATABASE_URL");

if (defaultDb && playwrightDb === defaultDb) {
  console.error("[playwright-dev] PLAYWRIGHT_DATABASE_URL must differ from DATABASE_URL (dev DB).");
  process.exit(1);
}

try {
  console.log("[playwright-dev] Applying Prisma migrations to e2e DB...");
  execSync("npm run db:deploy", { cwd: appDir, stdio: "inherit", env });
} catch (error) {
  console.error("[playwright-dev] Failed to apply migrations for e2e DB.");
  process.exit(1);
}

try {
  console.log("[playwright-dev] Generating Prisma client...");
  execSync("npm run db:generate", { cwd: appDir, stdio: "inherit", env });
} catch (error) {
  console.error("[playwright-dev] Failed to generate Prisma client.");
  process.exit(1);
}

if (!existsSync(path.join(workerDir, "node_modules", "tsx", "package.json"))) {
  try {
    console.log("[playwright-dev] Installing worker-agent dependencies...");
    execSync("npm install --include=dev", { cwd: workerDir, stdio: "inherit", env });
  } catch {
    console.error("[playwright-dev] Failed to install worker-agent dependencies.");
    process.exit(1);
  }
}

const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";

const server = spawn(npmCmd, ["exec", "--", "next", "dev", "--hostname", "0.0.0.0", "--port", appPort], {
  stdio: "inherit",
  env,
  cwd: appDir,
});

const children = [server];
let shuttingDown = false;
let worker = null;

function stopChildren(signal = "SIGTERM") {
  for (const child of children) {
    if (!child.killed) {
      child.kill(signal);
    }
  }
}

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  rmSync(readyFile, { force: true });
  stopChildren();
  setTimeout(() => stopChildren("SIGKILL"), 5_000).unref();
  process.exit(code);
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => shutdown(0));
}

server.on("exit", (code, signal) => {
  if (shuttingDown) return;
  const exitCode = code ?? (signal ? 1 : 0);
  console.error(`[playwright-dev] governance server exited (${signal ?? exitCode})`);
  shutdown(exitCode);
});

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRouteModuleReady(response, body) {
  const contentType = response.headers.get("content-type")?.toLowerCase() || "";
  return !(response.status === 404 && contentType.includes("text/html") && body.includes("This page could not be found."));
}

async function waitForRouteWarmup(name, requestFactory) {
  const startedAt = Date.now();
  let lastDetail = "no response";

  while (Date.now() - startedAt < warmupTimeoutMs) {
    try {
      const response = await requestFactory();
      const body = await response.text().catch(() => "");
      if (isRouteModuleReady(response, body)) {
        console.log(`[playwright-dev] Warmed ${name} (${response.status})`);
        return;
      }
      lastDetail = `${response.status} ${body.slice(0, 120).replace(/\s+/g, " ").trim()}`;
    } catch (error) {
      lastDetail = error instanceof Error ? error.message : String(error);
    }

    await sleep(warmupPollMs);
  }

  throw new Error(`Timed out warming ${name}: ${lastDetail}`);
}

async function warmGovernanceRoutes() {
  const adminHeaders = { cookie: "e2e_admin_bypass=1" };

  await waitForRouteWarmup("landing page", () =>
    fetch(`${governanceUrl}/`, { signal: AbortSignal.timeout(10_000) }),
  );
  await waitForRouteWarmup("playwright ready route", () =>
    fetch(`${governanceUrl}/api/test/ready`, { signal: AbortSignal.timeout(10_000) }),
  );
  await waitForRouteWarmup("auth session route", () =>
    fetch(`${governanceUrl}/api/auth/session`, { headers: adminHeaders, signal: AbortSignal.timeout(10_000) }),
  );
  await waitForRouteWarmup("runtime intent claim route", () =>
    fetch(`${governanceUrl}/api/internal/runtime-intents/claim`, {
      headers: { "x-worker-secret": sharedWorkerSecret },
      signal: AbortSignal.timeout(10_000),
    }),
  );
  await waitForRouteWarmup("A2E test route", () =>
    fetch(`${governanceUrl}/api/test/a2e?projectId=warmup`, {
      headers: adminHeaders,
      signal: AbortSignal.timeout(10_000),
    }),
  );
  await waitForRouteWarmup("budget scenario route", () =>
    fetch(`${governanceUrl}/api/test/budget-scenarios`, {
      headers: adminHeaders,
      signal: AbortSignal.timeout(10_000),
    }),
  );
  await waitForRouteWarmup("budget relaunch route", () =>
    fetch(`${governanceUrl}/api/test/budget-scenarios/relaunch-attempt`, {
      headers: adminHeaders,
      signal: AbortSignal.timeout(10_000),
    }),
  );
  await waitForRouteWarmup("budget paused-resume route", () =>
    fetch(`${governanceUrl}/api/test/budget-scenarios/paused-resume`, {
      headers: adminHeaders,
      signal: AbortSignal.timeout(10_000),
    }),
  );
  await waitForRouteWarmup("budget top-up route", () =>
    fetch(`${governanceUrl}/api/test/budget-scenarios/paused-resume/top-up`, {
      headers: adminHeaders,
      signal: AbortSignal.timeout(10_000),
    }),
  );
  await waitForRouteWarmup("ops data route", () =>
    fetch(`${governanceUrl}/api/admin/ops-data?tab=gallery`, {
      headers: adminHeaders,
      signal: AbortSignal.timeout(10_000),
    }),
  );
}

function spawnWorker() {
  worker = spawn(npmCmd, ["run", "start"], {
    stdio: "inherit",
    cwd: workerDir,
    env: {
      ...env,
      GOVERNANCE_URL: env.GOVERNANCE_URL?.trim() || governanceUrl,
      HOST_ID: env.HOST_ID?.trim() || "local",
      POLL_INTERVAL_MS: env.PLAYWRIGHT_WORKER_POLL_INTERVAL_MS?.trim() || "1000",
      WORKER_PORT: workerPort,
      RUNNER_MAX_CONCURRENT_RUNS: env.RUNNER_MAX_CONCURRENT_RUNS?.trim() || maxConcurrentRuns,
    },
  });
  children.push(worker);

  worker.on("exit", (code, signal) => {
    if (shuttingDown) return;
    const exitCode = code ?? (signal ? 1 : 0);
    console.error(`[playwright-dev] worker-agent exited (${signal ?? exitCode})`);
    shutdown(exitCode);
  });
}

try {
  await warmGovernanceRoutes();
  writeFileSync(readyFile, JSON.stringify({ readyAt: new Date().toISOString() }), "utf8");
  console.log(`[playwright-dev] Ready file written to ${readyFile}`);
  spawnWorker();
} catch (error) {
  console.error(
    `[playwright-dev] Failed to warm governance routes: ${error instanceof Error ? error.message : String(error)}`,
  );
  shutdown(1);
}
