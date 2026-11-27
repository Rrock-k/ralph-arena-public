/**
 * RA-083: Worker Agent — Docker agent on each host.
 *
 * Two responsibilities:
 * 1. Poll governance runtime intents and reconcile project containers
 * 2. HTTP server for container stop commands from governance (Reaper, cancel)
 *
 * Stateless. Needs only Docker socket and governance URL.
 * ~80 lines of core logic.
 */

import Docker from "dockerode";
import { createServer, type IncomingMessage } from "http";
import { execFileSync } from "child_process";
import { existsSync, mkdirSync, readFileSync, statSync } from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import type {
  RuntimeIntentClaimed,
  RuntimeIntentCompleteRequest,
  WorkerResourcePressure,
} from "@arena/contracts";
import { RuntimeIntentClaimResponseSchema, interpretRefreshTokensScriptOutput, sanitizeOperationalLogText } from "@arena/contracts";
import {
  waitForContainerRunning,
  waitForPreviewServing,
  waitForRunnerControlServing,
} from "./preview-runtime.js";
import { materializeBundledRalphStartScript } from "./ralph-runtime.js";
import { dockerMutationStatus, isDockerNotFoundError } from "./container-http.js";
import { createWorkerMaintenanceController } from "./worker-maintenance.js";
import { readPreviewGeneration } from "./preview-generation.js";
import { configureAntigravityRuntime } from "./antigravity-runtime.js";
import {
  buildPreviewContainerLogConfig,
  dockerLogConfigsMatch,
} from "./docker-log-config.js";
import { buildTelegramPreviewEntryUrl } from "./telegram-preview-entry.js";
import {
  buildUnavailableWorkerResourcePressure,
  calculateResourceAwareClaimCapacity,
  readWorkerResourcePressureConfig,
  summarizeWorkerResourcePressure,
  type DockerResourceSample,
} from "./resource-pressure.js";

// ── Config ────────────────────────────────────────────────

const GOVERNANCE_URL = process.env.GOVERNANCE_URL || "http://governance:3000";
const WORKER_SECRET = process.env.WORKER_SECRET || process.env.RUNNER_WEBHOOK_SECRET || "";
const HOST_ID = process.env.HOST_ID || "local";
const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS || "5000");
const HTTP_PORT = Number(process.env.WORKER_PORT || "4200");
const MAX_CONCURRENT_RUNS = Number(process.env.RUNNER_MAX_CONCURRENT_RUNS || "3");
const REFRESH_SCRIPT_TIMEOUT_MS = Number(process.env.REFRESH_SCRIPT_TIMEOUT_MS || "60000");
const PREVIEW_SERVING_TIMEOUT_MS = Number(process.env.PREVIEW_SERVING_TIMEOUT_MS || "45000");
const RUNTIME_START_TIMEOUT_MS = Number(process.env.RUNTIME_START_TIMEOUT_MS || "15000");
const RUNNER_CONTROL_TIMEOUT_MS = Number(process.env.RUNNER_CONTROL_TIMEOUT_MS || "45000");
const PREVIEW_HEALTH_POLL_MS = Number(process.env.PREVIEW_HEALTH_POLL_MS || "1000");
const PREVIEW_HEALTH_REQUEST_TIMEOUT_MS = Number(process.env.PREVIEW_HEALTH_REQUEST_TIMEOUT_MS || "2000");
const PREVIEW_HEALTH_REQUIRED_SUCCESSES = Number(process.env.PREVIEW_HEALTH_REQUIRED_SUCCESSES || "2");
const WORKER_SELF_RESTART_DELAY_MS = Number(process.env.WORKER_SELF_RESTART_DELAY_MS || "250");
const WORKER_RESOURCE_PRESSURE_CACHE_TTL_MS = Number(process.env.WORKER_RESOURCE_PRESSURE_CACHE_TTL_MS || "15000");
const WORKER_RESOURCE_PRESSURE_TIMEOUT_MS = Number(process.env.WORKER_RESOURCE_PRESSURE_TIMEOUT_MS || "5000");
const WORKER_HEALTH_RESOURCE_PRESSURE_TIMEOUT_MS = Number(process.env.WORKER_HEALTH_RESOURCE_PRESSURE_TIMEOUT_MS || "1500");
const CONTEXT_QUESTION_TIMEOUT_MS = Number(process.env.CONTEXT_QUESTION_TIMEOUT_MS || "120000");
const CONTEXT_QUESTION_MODELS = new Set(["claude-sonnet-4-6", "gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna", "gpt-5.5", "gpt-5.4", "gpt-5.4-mini"]);
const CONTEXT_QUESTION_PROVIDER_BILLING_MODES = new Set(["byok", "platform_credits", "platform_credentials"]);
const CONTEXT_QUESTION_CLAUDE_AUTH_MODES = new Set(["oauth", "api_key"]);
const CONTEXT_QUESTION_CODEX_AUTH_MODES = new Set(["subscription", "api_key"]);
const CONTEXT_QUESTION_AUTH_ENV_KEYS = new Set([
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_BASE_URL",
  "ANTHROPIC_API_URL",
  "CLAUDE_CODE_OAUTH_TOKEN",
  "OPENAI_API_KEY",
  "OPENAI_BASE_URL",
  "OPENAI_API_BASE",
  "CODEX_AUTH_JSON",
]);
const CONTEXT_QUESTION_REQUEST_MAX_BYTES = 16_384;
const CONTEXT_QUESTION_OUTPUT_MAX_BYTES = 96_000;
const CONTEXT_QUESTION_ANSWER_MAX_CHARS = 6_000;
const CONTEXT_QUESTION_OPENAI_PROVIDER_ID = "arena-context-openai";
const DEV_MODE = process.env.ARENA_DEV_MODE === "true";
const ARENA_HOST_PATH = process.env.ARENA_HOST_PATH || "";
const ARENA_NETWORK = process.env.ARENA_NETWORK || "arena-public-network";
const PREVIEW_DOMAIN = process.env.PREVIEW_DOMAIN || "";
const AUTHD_ANTIGRAVITY_DOCKER_VOLUME = process.env.AUTHD_ANTIGRAVITY_DOCKER_VOLUME || "";
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const WORKSPACE_ROOT = process.env.ARENA_PROJECT_WORKSPACES_ROOT || resolveDefaultWorkspaceRoot();
const CONTAINER_WORKSPACE_DIR = "/workspace";
const PROJECT_DATA_ROOT = process.env.ARENA_PROJECT_DATA_ROOT || resolveDefaultProjectDataRoot();
const CONTAINER_PROJECT_DATA_DIR = "/data";
const WORKER_AGENT_VERSION = readWorkerAgentVersion();

function resolveDefaultWorkspaceRoot(): string {
  const explicitArenaHome = process.env.ARENA_HOME_PATH?.trim();
  if (explicitArenaHome) {
    return path.join(explicitArenaHome, ".arena-runtime", "project-workspaces");
  }

  return ARENA_HOST_PATH ? path.join(ARENA_HOST_PATH, "runtime", "project-workspaces") : "";
}

function resolveDefaultProjectDataRoot(): string {
  return WORKSPACE_ROOT ? path.join(path.dirname(WORKSPACE_ROOT), "project-data") : "";
}

const REPO_GIT_SHA = readGitSha(REPO_ROOT);
const WORKER_GIT_SHA = process.env.WORKER_GIT_SHA || REPO_GIT_SHA;
const WORKER_BUILD_TIME = process.env.WORKER_BUILD_TIME || null;
const RUNNER_GIT_SHA = process.env.RUNNER_GIT_SHA || REPO_GIT_SHA;
const RUNNER_BUILD_TIME = process.env.RUNNER_BUILD_TIME || null;
const WORKER_IMAGE_NAME = process.env.WORKER_IMAGE || null;
let lastRuntimeIntentClaimAttemptAt: string | null = null;
let lastRuntimeIntentClaimSuccessAt: string | null = null;
let lastRuntimeIntentClaimError: string | null = null;
const activeContextQuestionContainers = new Set<string>();

const docker = new Docker();
const WORKER_RESOURCE_PRESSURE_CONFIG = readWorkerResourcePressureConfig(process.env);
let cachedWorkerResourcePressure: {
  expiresAt: number;
  value: WorkerResourcePressure;
} | null = null;

type RunnerStartRuntimeIntent = RuntimeIntentClaimed & {
  action: "ensure_running";
  env: Record<string, string>;
};

function readWorkerAgentVersion(): string | null {
  try {
    const raw = readFileSync(new URL("../package.json", import.meta.url), "utf8");
    const parsed = JSON.parse(raw) as { version?: string };
    return parsed.version || null;
  } catch {
    return null;
  }
}

function readGitSha(cwd: string): string | null {
  const direct = readGitShaFromDotGit(cwd);
  if (direct) {
    return direct;
  }

  try {
    return execFileSync("git", ["rev-parse", "--short=12", "HEAD"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim() || null;
  } catch {
    return null;
  }
}

function readGitShaFromDotGit(cwd: string): string | null {
  try {
    const gitEntry = path.join(cwd, ".git");
    if (!existsSync(gitEntry)) {
      return null;
    }

    const gitDir = resolveGitDir(gitEntry, cwd);
    if (!gitDir) {
      return null;
    }

    const headRaw = readFileSync(path.join(gitDir, "HEAD"), "utf8").trim();
    if (/^[0-9a-f]{40}$/i.test(headRaw)) {
      return headRaw.slice(0, 12);
    }

    const match = headRaw.match(/^ref:\s+(.+)$/);
    if (!match) {
      return null;
    }

    const refPath = path.join(gitDir, match[1]);
    if (existsSync(refPath)) {
      const refSha = readFileSync(refPath, "utf8").trim();
      return /^[0-9a-f]{40}$/i.test(refSha) ? refSha.slice(0, 12) : null;
    }

    const packedRefsPath = path.join(gitDir, "packed-refs");
    if (!existsSync(packedRefsPath)) {
      return null;
    }

    const packedRefs = readFileSync(packedRefsPath, "utf8")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#") && !line.startsWith("^"));

    const packedLine = packedRefs.find((line) => line.endsWith(` ${match[1]}`));
    if (!packedLine) {
      return null;
    }

    const [sha] = packedLine.split(" ");
    return /^[0-9a-f]{40}$/i.test(sha) ? sha.slice(0, 12) : null;
  } catch {
    return null;
  }
}

function resolveGitDir(gitEntry: string, cwd: string): string | null {
  const stat = statSync(gitEntry);
  if (stat.isDirectory()) {
    return gitEntry;
  }

  const raw = readFileSync(gitEntry, "utf8").trim();
  const match = raw.match(/^gitdir:\s+(.+)$/i);
  if (!match) {
    return null;
  }

  return path.resolve(cwd, match[1]);
}

function summarizeHttpErrorBody(body: string): string {
  const normalized = body.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "";
  }
  return normalized.length > 240 ? `${normalized.slice(0, 240)}...` : normalized;
}

async function runtimeIntentLoop(): Promise<void> {
  console.log(
    `[worker-agent] Starting runtime intent loop (host=${HOST_ID}, interval=${POLL_INTERVAL_MS}ms)`,
  );

  while (true) {
    try {
      const activeContainers = await listActivePreviewContainers();
      const resourcePressure = await getWorkerResourcePressure({
        timeoutMs: WORKER_RESOURCE_PRESSURE_TIMEOUT_MS,
        fallbackRunningContainerCount: activeContainers.length,
      });
      const intent = await claimRuntimeIntent(
        getRuntimeIntentClaimCapacity(activeContainers.length, resourcePressure),
        activeContainers,
        resourcePressure,
      );
      if (intent) {
        console.log(
          `[worker-agent] Claimed runtime intent ${intent.intentId} (${intent.action}/${intent.runnerMode}) for project ${intent.projectId}`,
        );
        await executeRuntimeIntent(intent);
      }
    } catch (err) {
      if (err instanceof Error && !err.message.includes("timeout")) {
        console.error("[worker-agent] Runtime intent loop error:", err.message);
      }
    }

    await sleep(POLL_INTERVAL_MS);
  }
}

async function claimRuntimeIntent(
  capacity: number,
  activePreviewContainers: string[],
  resourcePressure: WorkerResourcePressure,
): Promise<RuntimeIntentClaimed | null> {
  lastRuntimeIntentClaimAttemptAt = new Date().toISOString();
  try {
    const res = await fetch(`${GOVERNANCE_URL}/api/internal/runtime-intents/claim`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-worker-secret": WORKER_SECRET,
      },
      body: JSON.stringify({ host: HOST_ID, capacity, activePreviewContainers, resourcePressure }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      const summary = summarizeHttpErrorBody(body);
      lastRuntimeIntentClaimError = `HTTP ${res.status}${summary ? `: ${summary}` : ""}`;
      console.error(`[worker-agent] Runtime intent claim failed (${res.status})${summary ? `: ${summary}` : ""}`);
      return null;
    }

    lastRuntimeIntentClaimSuccessAt = new Date().toISOString();
    lastRuntimeIntentClaimError = null;
    const raw = await res.json().catch(() => null);
    return RuntimeIntentClaimResponseSchema.parse(raw);
  } catch (err) {
    lastRuntimeIntentClaimError = err instanceof Error ? err.message : String(err);
    throw err;
  }
}

async function completeRuntimeIntent(
  intentId: string,
  body: RuntimeIntentCompleteRequest,
): Promise<void> {
  const res = await fetch(`${GOVERNANCE_URL}/api/internal/runtime-intents/${encodeURIComponent(intentId)}/complete`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-worker-secret": WORKER_SECRET,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const summary = summarizeHttpErrorBody(text);
    throw new Error(`Runtime intent completion failed (${res.status})${summary ? `: ${summary}` : ""}`);
  }
}

function isRunnerStartRuntimeIntent(intent: RuntimeIntentClaimed): intent is RunnerStartRuntimeIntent {
  return intent.action === "ensure_running";
}

async function executeRuntimeIntent(intent: RuntimeIntentClaimed): Promise<void> {
  let completionBody: RuntimeIntentCompleteRequest;
  let successMessage: string;
  let startedContainerName: string | null = null;
  try {
    if (isRunnerStartRuntimeIntent(intent)) {
      const started = await startRunnerContainer({
        projectId: intent.projectId,
        workerImage: intent.workerImage,
        workspaceLabel: intent.workspaceLabel,
        resources: intent.resources,
        env: intent.env,
        preferredContainerName: intent.containerName || `preview-${intent.workspaceLabel}`,
      });
      startedContainerName = started.containerName;
      const inspectContainer = async (containerName: string) => docker.getContainer(containerName).inspect().catch(() => null);
      if (intent.runnerMode === "preview_only") {
        await waitForPreviewServing(started.containerName, {
          inspectContainer,
          healthTimeoutMs: PREVIEW_SERVING_TIMEOUT_MS,
          healthPollMs: PREVIEW_HEALTH_POLL_MS,
          requestTimeoutMs: PREVIEW_HEALTH_REQUEST_TIMEOUT_MS,
          requiredSuccesses: PREVIEW_HEALTH_REQUIRED_SUCCESSES,
          sleep,
        });
      } else {
        await waitForContainerRunning(started.containerName, {
          inspectContainer,
          runningTimeoutMs: RUNTIME_START_TIMEOUT_MS,
          runningPollMs: PREVIEW_HEALTH_POLL_MS,
          requiredRunningPolls: PREVIEW_HEALTH_REQUIRED_SUCCESSES,
          sleep,
        });
        await waitForRunnerControlServing(started.containerName, {
          inspectContainer,
          controlTimeoutMs: RUNNER_CONTROL_TIMEOUT_MS,
          controlPollMs: PREVIEW_HEALTH_POLL_MS,
          requestTimeoutMs: PREVIEW_HEALTH_REQUEST_TIMEOUT_MS,
          requiredSuccesses: PREVIEW_HEALTH_REQUIRED_SUCCESSES,
          sleep,
        });
      }
      completionBody = {
        ok: true,
        actualRuntime: "RUNNING",
        containerName: started.containerName,
        previewUrl: started.previewUrl,
      };
      successMessage = intent.runnerMode === "agent_run"
        ? `started ${started.containerName}`
        : `restored ${started.containerName}`;
    } else if (intent.runnerMode === "preview_only" && intent.action === "ensure_stopped") {
      await ensurePreviewOnlyStopped(intent);
      completionBody = {
        ok: true,
        actualRuntime: "ABSENT",
        containerName: intent.containerName ?? null,
      };
      successMessage = `stopped ${intent.containerName ?? intent.workspaceLabel}`;
    } else if (intent.runnerMode === "preview_only" && intent.action === "ensure_removed") {
      await ensurePreviewOnlyRemoved(intent);
      completionBody = {
        ok: true,
        actualRuntime: "ABSENT",
      };
      successMessage = `removed ${intent.containerName ?? intent.workspaceLabel}`;
    } else {
      await completeRuntimeIntent(intent.intentId, {
        ok: false,
        error: `Unsupported runtime intent ${intent.action}/${intent.runnerMode}`,
        retryable: false,
      });
      return;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[worker-agent] Runtime intent ${intent.intentId} failed:`, message);
    if (startedContainerName) {
      await removeStartedRuntimeContainer(startedContainerName, intent.intentId);
    }
    try {
      await completeRuntimeIntent(intent.intentId, {
        ok: false,
        error: message,
        retryable: true,
      });
    } catch (completionErr) {
      console.error(
        `[worker-agent] Failed to report runtime intent ${intent.intentId} failure:`,
        completionErr instanceof Error ? completionErr.message : completionErr,
      );
    }
    return;
  }

  try {
    await completeRuntimeIntent(intent.intentId, completionBody);
    console.log(`[worker-agent] Runtime intent ${intent.intentId} ${successMessage}`);
  } catch (completionErr) {
    console.error(
      `[worker-agent] Failed to report runtime intent ${intent.intentId} success:`,
      completionErr instanceof Error ? completionErr.message : completionErr,
    );
  }
}

async function removeStartedRuntimeContainer(containerName: string, intentId: string): Promise<void> {
  try {
    const container = docker.getContainer(containerName);
    await container.stop({ t: 5 }).catch(() => {});
    await container.remove({ force: true });
    console.log(`[worker-agent] Removed failed runtime container ${containerName} for intent ${intentId}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("No such container") || message.includes("404")) {
      return;
    }
    console.error(`[worker-agent] Failed to remove failed runtime container ${containerName}:`, message);
  }
}

async function ensurePreviewOnlyStopped(intent: RuntimeIntentClaimed): Promise<void> {
  if (!intent.containerName) {
    return;
  }

  try {
    const container = docker.getContainer(intent.containerName);
    await container.stop({ t: 10 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (
      message.includes("No such container")
      || message.includes("404")
      || message.includes("is already stopped")
      || message.includes("is not running")
    ) {
      return;
    }
    throw err;
  }
}

async function ensurePreviewOnlyRemoved(intent: RuntimeIntentClaimed): Promise<void> {
  if (!intent.containerName) {
    return;
  }

  try {
    const container = docker.getContainer(intent.containerName);
    await container.stop({ t: 5 }).catch(() => {});
    await container.remove({ force: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("No such container") || message.includes("404")) {
      return;
    }
    throw err;
  }
}

// ── Container management ──────────────────────────────────

type RunnerContainerLaunch = {
  projectId: string;
  workerImage: string | null;
  workspaceLabel: string;
  env: Record<string, string>;
  resources?: RuntimeIntentClaimed["resources"];
  preferredContainerName: string;
};

async function registerApiProxyProjectForLaunch(claimed: RunnerContainerLaunch): Promise<void> {
  if (
    claimed.env.ARENA_RUNTIME_INTENT_RUNNER_MODE !== "agent_run"
    || claimed.env.ARENA_PROVIDER_BILLING_MODE !== "platform_credits"
  ) {
    return;
  }

  const apiProxyUrl = claimed.env.ARENA_API_PROXY_URL?.trim();
  if (!apiProxyUrl) {
    throw new Error("Platform Credits run requires ARENA_API_PROXY_URL");
  }

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const proxySecret = claimed.env.ARENA_API_PROXY_SECRET?.trim() || process.env.API_PROXY_SECRET?.trim();
  if (proxySecret) {
    headers["x-proxy-secret"] = proxySecret;
  }

  const res = await fetch(`${apiProxyUrl.replace(/\/$/, "")}/projects/${encodeURIComponent(claimed.projectId)}/register`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      projectId: claimed.projectId,
      providerBillingMode: claimed.env.ARENA_PROVIDER_BILLING_MODE,
    }),
    signal: AbortSignal.timeout(5_000),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    const summary = summarizeHttpErrorBody(body);
    throw new Error(`API proxy registration failed (${res.status})${summary ? `: ${summary}` : ""}`);
  }
}

async function startRunnerContainer(claimed: RunnerContainerLaunch): Promise<{ containerName: string; previewUrl: string }> {
  const preferredContainerName = claimed.preferredContainerName;
  const image = claimed.workerImage || "arena-public-worker:local";
  const workspaceLabel = claimed.workspaceLabel;
  const workspaceHostPath = WORKSPACE_ROOT ? path.join(WORKSPACE_ROOT, workspaceLabel) : "";
  const projectDataHostPath = PROJECT_DATA_ROOT ? path.join(PROJECT_DATA_ROOT, workspaceLabel) : "";
  const mountHostRepo = claimed.env.ARENA_MOUNT_HOST_REPO === "1";
  const previewUrl = buildPreviewUrl(preferredContainerName);
  const previewOrigin = buildPreviewOrigin(preferredContainerName);
  const telegramPreviewEntryUrl = buildTelegramPreviewEntryUrl(
    claimed.env.ARENA_GOVERNANCE_PUBLIC_URL,
    claimed.projectId,
  );
  // Resource priority: per-project env > per-project resources from governance > worker-agent default > hardcoded 4096/2
  const envMemoryMb = Number(claimed.env?.ARENA_CONTAINER_MEMORY_MB) || 0;
  const envCpuCount = Number(claimed.env?.ARENA_CONTAINER_CPUS) || 0;
  const requestedMemoryMb = claimed.resources?.memoryMb;
  const requestedCpuCount = claimed.resources?.cpuCount;
  const memoryMb: number = envMemoryMb > 0 ? envMemoryMb
    : requestedMemoryMb !== undefined && Number.isFinite(requestedMemoryMb) && requestedMemoryMb > 0
      ? Math.round(requestedMemoryMb)
    : Number(process.env.RUNNER_WORKER_MEMORY_MB) || 4096;
  const cpuCount: number = envCpuCount > 0 ? envCpuCount
    : requestedCpuCount !== undefined && Number.isFinite(requestedCpuCount) && requestedCpuCount > 0
      ? requestedCpuCount
    : Number(process.env.RUNNER_WORKER_CPUS) || 2;

  await registerApiProxyProjectForLaunch(claimed);

  if (workspaceHostPath) {
    mkdirSync(workspaceHostPath, { recursive: true });
    try {
      execFileSync("chown", ["-R", "1000:1000", workspaceHostPath], { stdio: "ignore" });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[worker-agent] Failed to chown workspace ${workspaceHostPath} to 1000:1000: ${message}`);
    }

    if (mountHostRepo) {
      try {
        const templatePath = path.join(REPO_ROOT, "packages/loops/ralph-runtime/arena-start.sh");
        const created = materializeBundledRalphStartScript(workspaceHostPath, templatePath);
        if (created) {
          console.log(`[worker-agent] Materialized arena-start.sh for ${claimed.projectId}`);
        }
      } catch (err) {
        console.warn(
          `[worker-agent] Failed to materialize arena-start.sh for ${claimed.projectId}:`,
          err instanceof Error ? err.message : err,
        );
      }
    }
  } else {
    console.warn(`[worker-agent] No workspace root configured, project ${claimed.projectId} will use container-local workspace`);
  }
  if (projectDataHostPath) {
    mkdirSync(projectDataHostPath, { recursive: true });
    try {
      execFileSync("chown", ["-R", "1000:1000", projectDataHostPath], { stdio: "ignore" });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[worker-agent] Failed to chown project data ${projectDataHostPath} to 1000:1000: ${message}`);
    }
  } else {
    console.warn(`[worker-agent] No project data root configured, project ${claimed.projectId} will use container-local ${CONTAINER_PROJECT_DATA_DIR}`);
  }

  const runtimeEnv: Record<string, string> = {
    ...claimed.env,
    ARENA_CONTAINER_NAME: preferredContainerName,
    ARENA_DATA_DIR: CONTAINER_PROJECT_DATA_DIR,
    ARENA_WORKER_HOST: HOST_ID,
    ARENA_RUNNER_VERSION: RUNNER_GIT_SHA || "unknown",
    ...(previewUrl ? { ARENA_PREVIEW_URL: previewUrl } : {}),
    ...(previewOrigin ? { ARENA_PREVIEW_ORIGIN: previewOrigin } : {}),
    ...(telegramPreviewEntryUrl ? { ARENA_TELEGRAM_PREVIEW_URL: telegramPreviewEntryUrl } : {}),
  };

  // Build container config
  const createOpts: Docker.ContainerCreateOptions = {
    name: preferredContainerName,
    Image: image,
    Labels: {
      "arena.project.id": claimed.projectId,
      "arena.project.slug": workspaceLabel,
      "arena.agent": claimed.env.ARENA_AGENT || "",
      "arena.agent.impl": claimed.env.ARENA_AGENT_IMPL || "",
      "arena.host": HOST_ID,
    },
    Cmd: ["node", "/arena/index.js"],
    HostConfig: {
      NetworkMode: ARENA_NETWORK,
      Memory: memoryMb * 1024 * 1024,
      NanoCpus: Math.round(cpuCount * 1_000_000_000),
      RestartPolicy: { Name: "on-failure", MaximumRetryCount: 3 },
      LogConfig: buildPreviewContainerLogConfig(process.env),
    },
    ExposedPorts: { "3000/tcp": {} },
  };

  const antigravityRuntime = configureAntigravityRuntime({
    env: runtimeEnv,
    hostConfig: createOpts.HostConfig!,
    authVolumeName: AUTHD_ANTIGRAVITY_DOCKER_VOLUME,
  });
  if (antigravityRuntime.configured) {
    console.log(`[worker-agent] Project ${claimed.projectId}: Antigravity keyring auth ${antigravityRuntime.reason}`);
  }

  createOpts.Env = Object.entries(runtimeEnv).map(([k, v]) => `${k}=${v}`);

  // Dev mode: mount loop repos as local git sources (not ready-to-use code).
  // Runner will `git clone file:///arena/loops/{name}-src` at the correct version tag,
  // so version selection from DB works even in dev mode (RA-212).
  if (DEV_MODE && ARENA_HOST_PATH) {
    createOpts.HostConfig!.Binds = [];
    const ralephPath = process.env.RALEPH_HOST_PATH;
    if (ralephPath) {
      createOpts.HostConfig!.Binds.push(`${ralephPath}:/arena/loops/raleph-src:ro`);
    }
    const symphoPath = process.env.SYMPHO_HOST_PATH;
    if (symphoPath) {
      createOpts.HostConfig!.Binds.push(`${symphoPath}:/arena/loops/sympho-src:ro`);
    }
  }
  // A2E mode: bind mount host repo as read-only source for git clone
  if (mountHostRepo && ARENA_HOST_PATH) {
    createOpts.HostConfig!.Binds = createOpts.HostConfig!.Binds || [];
    createOpts.HostConfig!.Binds.push(`${ARENA_HOST_PATH}:/host-repo:ro`);
    console.log(`[worker-agent] Project ${claimed.projectId}: Mounting host repo ${ARENA_HOST_PATH} as /host-repo:ro (A2E workspace copy)`);
  }
  if (workspaceHostPath) {
    createOpts.HostConfig!.Binds = createOpts.HostConfig!.Binds || [];
    createOpts.HostConfig!.Binds.push(`${workspaceHostPath}:${CONTAINER_WORKSPACE_DIR}`);
  }
  if (projectDataHostPath) {
    createOpts.HostConfig!.Binds = createOpts.HostConfig!.Binds || [];
    createOpts.HostConfig!.Binds.push(`${projectDataHostPath}:${CONTAINER_PROJECT_DATA_DIR}`);
  }

  const { container, containerName } = await prepareContainer(
    preferredContainerName,
    createOpts,
  );
  await container.start();
  console.log(`[worker-agent] Container ${containerName} started for project ${claimed.projectId}`);

  // Connect to extra networks (e.g. A2E test network)
  const extraNetworks = (claimed.env?.ARENA_EXTRA_NETWORKS || "").split(",").map(s => s.trim()).filter(Boolean);
  for (const net of extraNetworks) {
    try {
      const network = docker.getNetwork(net);
      await network.connect({ Container: containerName });
      console.log(`[worker-agent] Connected ${containerName} to network ${net}`);
    } catch (netErr: any) {
      console.log(`[worker-agent] Failed to connect to network ${net}: ${netErr.message}`);
    }
  }

  return { containerName, previewUrl: buildPreviewUrl(containerName) };
}

async function prepareContainer(
  preferredContainerName: string,
  createOpts: Docker.ContainerCreateOptions,
): Promise<{ container: Docker.Container; containerName: string }> {
  const expectedImageId = await resolveImageId(String(createOpts.Image || ""));
  try {
    const container = docker.getContainer(preferredContainerName);
    const inspect = await container.inspect();

    if (inspect.State?.Running) {
      console.log(`[worker-agent] Replacing running preview container ${preferredContainerName}`);
      await container.remove({ force: true });
      return {
        container: await docker.createContainer(createOpts),
        containerName: preferredContainerName,
      };
    }

    if (canReuseContainer(inspect, createOpts, expectedImageId)) {
      console.log(`[worker-agent] Reusing stopped container ${preferredContainerName}`);
      return { container, containerName: preferredContainerName };
    }

    console.log(`[worker-agent] Recreating stale container ${preferredContainerName}`);
    await container.remove({ force: true });
    return {
      container: await docker.createContainer(createOpts),
      containerName: preferredContainerName,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!msg.includes("No such container") && !msg.includes("404")) {
      throw err;
    }
    return {
      container: await docker.createContainer(createOpts),
      containerName: preferredContainerName,
    };
  }
}

function canReuseContainer(
  inspect: Docker.ContainerInspectInfo,
  createOpts: Docker.ContainerCreateOptions,
  expectedImageId: string | null,
): boolean {
  const sameImage = inspect.Config?.Image === createOpts.Image;
  const sameImageId = expectedImageId !== null && inspect.Image === expectedImageId;
  const sameCommand = matchesCommand(inspect.Config?.Cmd || [], createOpts.Cmd || []);
  const sameEnv = matchesEnv(
    normalizeEnv(inspect.Config?.Env || []),
    normalizeEnv(createOpts.Env || []),
  );
  const sameBinds = matchesBinds(inspect.HostConfig?.Binds || [], createOpts.HostConfig?.Binds || []);
  const sameLogConfig = dockerLogConfigsMatch(inspect.HostConfig?.LogConfig, createOpts.HostConfig?.LogConfig);

  return sameImage && sameImageId && sameCommand && sameEnv && sameBinds && sameLogConfig;
}

async function resolveImageId(imageName: string): Promise<string | null> {
  if (!imageName) return null;
  try {
    const image = await docker.getImage(imageName).inspect();
    return image.Id || null;
  } catch {
    return null;
  }
}

function normalizeEnv(env: string[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const entry of env) {
    const idx = entry.indexOf("=");
    if (idx <= 0) continue;
    map.set(entry.slice(0, idx), entry.slice(idx + 1));
  }
  return map;
}

function matchesEnv(existing: Map<string, string>, expected: Map<string, string>): boolean {
  for (const [key, value] of expected) {
    if (existing.get(key) !== value) return false;
  }
  return true;
}

function matchesBinds(existing: string[], expected: string[]): boolean {
  if (existing.length !== expected.length) return false;
  const existingSorted = [...existing].sort();
  const expectedSorted = [...expected].sort();
  return existingSorted.every((bind, index) => bind === expectedSorted[index]);
}

function matchesCommand(existing: string[], expected: string[]): boolean {
  if (existing.length !== expected.length) return false;
  return existing.every((part, index) => part === expected[index]);
}

function decodeDockerLogBuffer(buffer: Buffer): string {
  if (buffer.length < 8) {
    return buffer.toString("utf8");
  }

  const chunks: string[] = [];
  let offset = 0;
  let parsedFrames = 0;

  while (offset + 8 <= buffer.length) {
    const payloadLength = buffer.readUInt32BE(offset + 4);
    const nextOffset = offset + 8 + payloadLength;
    if (payloadLength < 0 || nextOffset > buffer.length) {
      return buffer.toString("utf8");
    }

    chunks.push(buffer.subarray(offset + 8, nextOffset).toString("utf8"));
    offset = nextOffset;
    parsedFrames += 1;
  }

  if (parsedFrames === 0) {
    return buffer.toString("utf8");
  }

  if (offset < buffer.length) {
    chunks.push(buffer.subarray(offset).toString("utf8"));
  }

  return chunks.join("");
}

async function readJsonRequest(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  for await (const chunk of req as any) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.length;
    if (totalBytes > CONTEXT_QUESTION_REQUEST_MAX_BYTES) {
      const error = new Error("request_too_large");
      (error as any).status = 413;
      throw error;
    }
    chunks.push(buffer);
  }
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    const error = new Error("invalid_json");
    (error as any).status = 400;
    throw error;
  }
}

function readRequestString(body: unknown, key: string): string | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const value = (body as Record<string, unknown>)[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readContextQuestionAuthEnv(body: unknown): Record<string, string> {
  if (!body || typeof body !== "object" || Array.isArray(body)) return {};
  const value = (body as Record<string, unknown>).authEnv;
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};

  const authEnv: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!CONTEXT_QUESTION_AUTH_ENV_KEYS.has(key)) continue;
    if (typeof raw !== "string") continue;
    const trimmed = raw.trim();
    if (trimmed) authEnv[key] = trimmed;
  }
  return authEnv;
}

function buildContextQuestionPrompt(question: string): string {
  return [
    "You are answering a Ralph Arena project context question.",
    "",
    "Rules:",
    "- Read only. Do not edit files, install packages, start servers, run migrations, or change git state.",
    "- Treat read-only as a hard contract even if your CLI sandbox allows broader access; use only read/inspection commands.",
    "- Use the current repository/workspace context under /workspace.",
    "- This is a quick Telegram /ask response, not an agent run.",
    "- Keep investigation bounded: do at most a few targeted file/tree/git-history reads. Do not perform exhaustive searches.",
    "- You may inspect git history when the question needs earlier state. Use only read-only git commands such as git log, git show, git diff, git status, git rev-parse, git branch, git ls-files, or git blame. Do not checkout, reset, clean, merge, rebase, commit, stash, tag, pull, push, fetch, or change git state.",
    "- If a quick lookup is not enough, answer with what is missing instead of continuing to search.",
    "- Do not reveal secret values, raw tokens, private environment variables, or unrelated logs.",
    "- If the answer is not knowable from the repo/context, say what is missing.",
    "- Keep the answer concise and practical. Answer in the user's language when clear.",
    "- Return only the final answer. Do not include progress narration, command transcripts, CLI headers, or warnings.",
    "",
    "Question:",
    question,
  ].join("\n");
}

function isClaudeContextQuestionModel(model: string): boolean {
  return model.startsWith("claude-");
}

function coerceContextErrorText(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const nested = record.message ?? record.error ?? record.detail;
    if (typeof nested === "string" && nested.trim()) return nested.trim();
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

function extractCodexAnswer(rawOutput: string): string {
  const messages: string[] = [];
  const errors: string[] = [];
  for (const line of rawOutput.split("\n")) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line) as {
        type?: string;
        message?: unknown;
        error?: unknown;
        item?: { type?: string; text?: string };
      };
      if (event.type === "item.completed" && event.item?.type === "agent_message" && event.item.text) {
        messages.push(event.item.text);
      }
      if (event.type === "error") {
        const text = coerceContextErrorText(event.message ?? event.error);
        if (text) errors.push(text);
      }
    } catch {
      // Non-JSON output is kept as a last-resort answer below.
    }
  }
  if (messages.length > 0) {
    return messages.join("\n").trim();
  }
  if (errors.length > 0) {
    return errors.join("\n").trim();
  }
  return rawOutput.trim();
}

function extractClaudeAnswer(rawOutput: string): string {
  const messages: string[] = [];
  const errors: string[] = [];
  for (const line of rawOutput.split("\n")) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line) as {
        type?: string;
        subtype?: string;
        is_error?: boolean;
        message?: { content?: Array<{ type?: string; text?: string }> } | string;
        result?: string;
        error?: string;
      };
      if (event.type === "assistant" && typeof event.message === "object" && Array.isArray(event.message.content)) {
        for (const block of event.message.content) {
          if (block.type === "text" && block.text) messages.push(block.text);
        }
      }
      if (event.type === "result" && event.result) {
        if (event.subtype === "success" && event.is_error !== true) {
          messages.push(event.result);
        } else {
          errors.push(event.result);
        }
      }
      if (event.type === "error" && (typeof event.message === "string" || event.error)) {
        errors.push((typeof event.message === "string" ? event.message : event.error) || "");
      }
    } catch {
      // Non-JSON output is kept as a last-resort answer below.
    }
  }
  if (messages.length > 0) {
    return messages.join("\n").trim();
  }
  if (errors.length > 0) {
    return errors.join("\n").trim();
  }
  return rawOutput.trim();
}

function capContextQuestionAnswer(answer: string): string {
  const trimmed = answer.trim();
  if (trimmed.length <= CONTEXT_QUESTION_ANSWER_MAX_CHARS) return trimmed;
  return `${trimmed.slice(0, CONTEXT_QUESTION_ANSWER_MAX_CHARS)}\n\n[context question answer truncated]`;
}

function redactKnownContextQuestionSecrets(answer: string): string {
  let redacted = answer;
  for (const value of [
    process.env.ANTHROPIC_API_KEY,
    process.env.CLAUDE_CODE_OAUTH_TOKEN,
    process.env.CLAUDE_CODE_OAUTH_REFRESH_TOKEN,
    process.env.OPENAI_API_KEY,
  ]) {
    const secret = value?.trim();
    if (secret && secret.length >= 8) {
      redacted = redacted.split(secret).join("[redacted]");
    }
  }
  return redacted;
}

function classifyContextQuestionFailureStatus(answer: string, exitCode: number): number {
  const normalized = answer.toLowerCase();
  if (
    normalized.includes("quota exceeded")
    || normalized.includes("insufficient_quota")
    || normalized.includes("check your plan and billing")
    || normalized.includes("you've hit your limit")
    || normalized.includes("you’ve hit your limit")
    || normalized.includes("you've hit your session limit")
    || normalized.includes("you’ve hit your session limit")
  ) {
    return 429;
  }
  if (
    normalized.includes("missing bearer")
    || normalized.includes("unauthorized")
    || normalized.includes("incorrect api key")
    || normalized.includes("invalid api key")
    || normalized.includes("context_question_openai_auth_missing")
    || normalized.includes("context_question_openai_api_key_missing")
    || normalized.includes("context_question_openai_proxy_auth_missing")
    || normalized.includes("context_question_openai_proxy_base_missing")
    || normalized.includes("context_question_claude_auth_missing")
    || normalized.includes("context_question_claude_oauth_missing")
    || normalized.includes("context_question_claude_api_key_missing")
    || normalized.includes("context_question_codex_subscription_auth_missing")
    || normalized.includes("oauth token has expired")
    || normalized.includes("authentication required")
  ) {
    return 401;
  }
  return exitCode === 124 ? 504 : 502;
}

function contextQuestionExecutionMode(model: string | null | undefined): string | null {
  if (!model) return null;
  return isClaudeContextQuestionModel(model) ? "claude_tool_allowlist" : "codex_prompt_only";
}

function contextQuestionFailureKind(status: number): "rate_limit" | "auth" | "timeout" | "worker" {
  if (status === 429) return "rate_limit";
  if (status === 401) return "auth";
  if (status === 504) return "timeout";
  return "worker";
}

function contextQuestionFailureCode(kind: ReturnType<typeof contextQuestionFailureKind>): string {
  switch (kind) {
    case "rate_limit":
      return "context_question_provider_rate_limit";
    case "auth":
      return "context_question_auth_unavailable";
    case "timeout":
      return "context_question_timeout";
    case "worker":
      return "context_question_worker_error";
  }
}

function contextQuestionFailurePayload(input: {
  status: number;
  message: string;
  model?: string | null;
}): Record<string, unknown> {
  const kind = contextQuestionFailureKind(input.status);
  const executionMode = contextQuestionExecutionMode(input.model);
  return {
    error: input.message.slice(0, 1000),
    code: contextQuestionFailureCode(kind),
    kind,
    retryable: kind === "rate_limit",
    ...(executionMode ? { executionMode } : {}),
  };
}

function buildContextQuestionRunnerScript(): string {
  const providerId = JSON.stringify(CONTEXT_QUESTION_OPENAI_PROVIDER_ID);
  return `
const { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } = require("node:fs");
const { spawn, spawnSync } = require("node:child_process");

const providerId = ${providerId};
const model = process.argv[1];
const providerBillingMode = process.argv[2] || "";
const claudeAuthMode = process.argv[3] || "";
const codexAuthMode = process.argv[4] || "";
const workspaceDir = ${JSON.stringify(CONTAINER_WORKSPACE_DIR)};
const defaultOpenAiBaseUrl = "https://api.openai.com/v1";
const proxySentinel = "arena-proxy";

function trim(value) {
  return typeof value === "string" ? value.trim() : "";
}

let openAiBaseUrl = trim(process.env.OPENAI_BASE_URL) || trim(process.env.OPENAI_API_BASE);
const openAiKey = trim(process.env.OPENAI_API_KEY);
if (!openAiBaseUrl && openAiKey === proxySentinel) {
  const apiProxyUrl = trim(process.env.ARENA_API_PROXY_URL).replace(/\\/$/, "");
  const projectId = trim(process.env.ARENA_PROJECT_ID);
  if (apiProxyUrl && projectId) {
    openAiBaseUrl = \`\${apiProxyUrl}/openai/project/\${encodeURIComponent(projectId)}\`;
  }
}

if (model.startsWith("claude-")) {
  const anthropicKey = trim(process.env.ANTHROPIC_API_KEY);
  const claudeOauthToken = trim(process.env.CLAUDE_CODE_OAUTH_TOKEN);
  const useClaudeOauth = claudeAuthMode === "oauth";
  const useClaudeApiKey = claudeAuthMode === "api_key";

  if (useClaudeOauth && !claudeOauthToken) {
    console.error("context_question_claude_oauth_missing");
    process.exit(86);
  }
  if (useClaudeApiKey && !anthropicKey) {
    console.error("context_question_claude_api_key_missing");
    process.exit(86);
  }
  if (!useClaudeOauth && !useClaudeApiKey && !anthropicKey && !claudeOauthToken) {
    console.error("context_question_claude_auth_missing");
    process.exit(86);
  }

  const readOnlyGitTools = [
    "Bash(git log)",
    "Bash(git log *)",
    "Bash(git show)",
    "Bash(git show *)",
    "Bash(git diff)",
    "Bash(git diff *)",
    "Bash(git status)",
    "Bash(git status *)",
    "Bash(git rev-parse)",
    "Bash(git rev-parse *)",
    "Bash(git branch)",
    "Bash(git branch *)",
    "Bash(git ls-files)",
    "Bash(git ls-files *)",
    "Bash(git blame)",
    "Bash(git blame *)",
  ];
  const args = [
    "--print",
    "--output-format",
    "json",
    "--model",
    model,
    "--effort",
    "low",
    "--max-budget-usd",
    "0.20",
    "--tools",
    "Read,Grep,Glob,LS,Bash",
    "--allowedTools",
    ["Read", "Grep", "Glob", "LS", ...readOnlyGitTools].join(","),
    "--mcp-config",
    '{"mcpServers":{}}',
    "--strict-mcp-config",
    "--disallowedTools",
    "Edit,Write,MultiEdit,NotebookEdit",
    "--permission-mode",
    "dontAsk",
    "--no-session-persistence",
    "--disable-slash-commands",
  ];
  const childEnv = { ...process.env, CI: "true", NO_COLOR: "1" };
  delete childEnv.CLAUDE_CODE_OAUTH_REFRESH_TOKEN;
  if (useClaudeOauth || (!useClaudeApiKey && claudeOauthToken)) {
    delete childEnv.ANTHROPIC_API_KEY;
    delete childEnv.ANTHROPIC_BASE_URL;
    delete childEnv.ANTHROPIC_API_URL;
  }
  if (useClaudeApiKey) {
    delete childEnv.CLAUDE_CODE_OAUTH_TOKEN;
  }
  const child = spawn("claude", args, {
    cwd: workspaceDir,
    env: childEnv,
    stdio: ["inherit", "inherit", "inherit"],
  });
  child.on("exit", (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    process.exit(code ?? 1);
  });
  child.on("error", (error) => {
    console.error(error.message);
    process.exit(1);
  });
} else {
  // Codex read-only sandboxing is not reliable inside preview containers yet.
  // For /ask, Codex is explicitly prompt-only read-only until a stronger
  // execution boundary exists.
  const args = [
    "exec",
    "--json",
    "--ephemeral",
    "--skip-git-repo-check",
    "--dangerously-bypass-approvals-and-sandbox",
    "--color",
    "never",
  ];
  const childEnv = {
    ...process.env,
    CI: "true",
    NO_COLOR: "1",
  };

  const useCodexSubscription = codexAuthMode === "subscription";
  const useCodexApiKey = codexAuthMode === "api_key";
  const usePlatformCredits = providerBillingMode === "platform_credits";
  const codexAuthJson = trim(process.env.CODEX_AUTH_JSON);
  let temporaryCodexHome = "";

  if (useCodexSubscription) {
    delete childEnv.OPENAI_API_KEY;
    delete childEnv.OPENAI_BASE_URL;
    delete childEnv.OPENAI_API_BASE;
    let codexHome = trim(process.env.CODEX_HOME) || "/tmp/.codex";
    if (codexAuthJson) {
      temporaryCodexHome = mkdtempSync("/tmp/arena-context-codex-");
      mkdirSync(temporaryCodexHome, { recursive: true });
      writeFileSync(\`\${temporaryCodexHome}/auth.json\`, codexAuthJson, { mode: 0o600 });
      codexHome = temporaryCodexHome;
      childEnv.CODEX_HOME = codexHome;
      delete childEnv.CODEX_AUTH_JSON;
    }
    if (!existsSync(\`\${codexHome}/auth.json\`)) {
      console.error("context_question_codex_subscription_auth_missing");
      process.exit(86);
    }
  } else if (usePlatformCredits || openAiKey === proxySentinel) {
    if (!openAiBaseUrl && openAiKey === proxySentinel) {
      console.error("context_question_openai_proxy_base_missing");
      process.exit(86);
    }

    if (openAiKey !== proxySentinel) {
      console.error("context_question_openai_proxy_auth_missing");
      process.exit(86);
    }
    const baseUrl = openAiBaseUrl || defaultOpenAiBaseUrl;
    args.push(
      "-c",
      \`model_provider=\${JSON.stringify(providerId)}\`,
      "-c",
      \`model_providers.\${providerId}={name="Arena Context OpenAI", base_url=\${JSON.stringify(baseUrl)}, wire_api="responses", bearer_token_env_var="OPENAI_API_KEY"}\`,
    );
  } else if (useCodexApiKey || openAiKey) {
    if (!openAiKey) {
      console.error("context_question_openai_api_key_missing");
      process.exit(86);
    }
    const login = spawnSync("codex", ["login", "--with-api-key"], {
      input: openAiKey + "\\n",
      encoding: "utf8",
      env: childEnv,
      stdio: ["pipe", "pipe", "pipe"],
    });
    if (login.status !== 0) {
      const detail = String(login.stderr || login.stdout || "").trim().split("\\n").at(-1) || "codex_login_failed";
      console.error(detail);
      process.exit(86);
    }
    delete childEnv.OPENAI_API_KEY;
  } else {
    const codexHome = trim(process.env.CODEX_HOME) || "/tmp/.codex";
    if (!existsSync(\`\${codexHome}/auth.json\`)) {
      console.error("context_question_openai_auth_missing");
      process.exit(86);
    }
  }

  args.push("--model", model, "-C", workspaceDir, "-");

  const child = spawn("codex", args, {
    cwd: workspaceDir,
    env: childEnv,
    stdio: ["inherit", "pipe", "pipe"],
  });
  let stdoutBuffer = "";
  let nonJsonTail = "";
  let stderrTail = "";
  const agentMessages = [];
  const eventErrors = [];
  function rememberNonJson(value) {
    nonJsonTail = (nonJsonTail + value).slice(-4000);
  }
  function coerceErrText(value) {
    if (value == null) return "";
    if (typeof value === "string") return value.trim();
    if (typeof value === "object") {
      const nested = value.message || value.error || value.detail;
      if (typeof nested === "string" && nested.trim()) return nested.trim();
      try { return JSON.stringify(value); } catch (e) { return String(value); }
    }
    return String(value);
  }
  function consumeCodexJsonLine(line) {
    const trimmed = line.trim();
    if (!trimmed) return;
    try {
      const event = JSON.parse(trimmed);
      if (event?.type === "item.completed" && event.item?.type === "agent_message" && event.item.text) {
        agentMessages.push(String(event.item.text));
      }
      if (event?.type === "error") {
        const text = coerceErrText(event.message || event.error);
        if (text) eventErrors.push(text);
      }
    } catch {
      rememberNonJson(line + "\\n");
    }
  }
  child.stdout.on("data", (chunk) => {
    stdoutBuffer += String(chunk);
    let newlineIndex = stdoutBuffer.indexOf("\\n");
    while (newlineIndex >= 0) {
      const line = stdoutBuffer.slice(0, newlineIndex);
      stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1);
      consumeCodexJsonLine(line);
      newlineIndex = stdoutBuffer.indexOf("\\n");
    }
    if (stdoutBuffer.length > 1_000_000) {
      rememberNonJson(stdoutBuffer.slice(-4000));
      stdoutBuffer = "";
    }
  });
  child.stderr.on("data", (chunk) => {
    stderrTail = (stderrTail + String(chunk)).slice(-4000);
  });

  child.on("exit", (code, signal) => {
    if (stdoutBuffer.trim()) {
      consumeCodexJsonLine(stdoutBuffer);
    }
    const answer = (agentMessages.at(-1) || "").trim()
      || eventErrors.join("\\n").trim()
      || nonJsonTail.trim();
    if (answer) {
      process.stdout.write(answer + "\\n");
    }
    if (code && stderrTail.trim()) {
      process.stderr.write(stderrTail.trim() + "\\n");
    }
    if (temporaryCodexHome) rmSync(temporaryCodexHome, { recursive: true, force: true });
    if (signal) process.kill(process.pid, signal);
    process.exit(code ?? 1);
  });
  child.on("error", (error) => {
    if (temporaryCodexHome) rmSync(temporaryCodexHome, { recursive: true, force: true });
    console.error(error.message);
    process.exit(1);
  });
}
`.trim();
}

async function runContextQuestionInContainer(input: {
  containerName: string;
  question: string;
  model: string;
  providerBillingMode?: string | null;
  claudeAuthMode?: string | null;
  codexAuthMode?: string | null;
  authEnv?: Record<string, string>;
}) {
  const container = docker.getContainer(input.containerName);
  const inspect = await container.inspect();
  if (!inspect.State?.Running) {
    const error = new Error("container_not_running");
    (error as any).status = 409;
    throw error;
  }

  const timeoutSeconds = Math.max(1, Math.ceil(CONTEXT_QUESTION_TIMEOUT_MS / 1000));
  const runnerScriptBase64 = Buffer.from(buildContextQuestionRunnerScript(), "utf8").toString("base64");
  const shellCommand = [
    "set -eu",
    `exec timeout ${timeoutSeconds}s env -i \\`,
    `  PATH="\${PATH:-/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin}" \\`,
    `  HOME="\${HOME:-/tmp}" \\`,
    `  CODEX_HOME="\${CODEX_HOME:-\${HOME:-/tmp}/.codex}" \\`,
    `  CI=true \\`,
    `  NO_COLOR=1 \\`,
    `  ARENA_PROJECT_ID="\${ARENA_PROJECT_ID:-}" \\`,
    `  ARENA_API_PROXY_URL="\${ARENA_API_PROXY_URL:-}" \\`,
    `  ANTHROPIC_API_KEY="\${ANTHROPIC_API_KEY:-}" \\`,
    `  ANTHROPIC_BASE_URL="\${ANTHROPIC_BASE_URL:-}" \\`,
    `  ANTHROPIC_API_URL="\${ANTHROPIC_API_URL:-}" \\`,
    `  CLAUDE_CODE_OAUTH_TOKEN="\${CLAUDE_CODE_OAUTH_TOKEN:-}" \\`,
    `  OPENAI_API_KEY="\${OPENAI_API_KEY:-}" \\`,
    `  OPENAI_BASE_URL="\${OPENAI_BASE_URL:-}" \\`,
    `  OPENAI_API_BASE="\${OPENAI_API_BASE:-}" \\`,
    `  CODEX_AUTH_JSON="\${CODEX_AUTH_JSON:-}" \\`,
    `  ARENA_PROVIDER_BILLING_MODE="\${ARENA_PROVIDER_BILLING_MODE:-}" \\`,
    `  ARENA_CONTEXT_QUESTION_RUNNER_B64="${runnerScriptBase64}" \\`,
    `  node -e 'eval(Buffer.from(process.env.ARENA_CONTEXT_QUESTION_RUNNER_B64 || "", "base64").toString("utf8"))' "$1" "$2" "$3" "$4"`,
  ].join("\n");

  const exec = await container.exec({
    Cmd: [
      "sh",
      "-lc",
      shellCommand,
      "arena-context-question",
      input.model,
      input.providerBillingMode ?? "",
      input.claudeAuthMode ?? "",
      input.codexAuthMode ?? "",
    ],
    Env: Object.entries(input.authEnv ?? {}).map(([key, value]) => `${key}=${value}`),
    AttachStdout: true,
    AttachStderr: true,
    AttachStdin: true,
    Tty: false,
    WorkingDir: CONTAINER_WORKSPACE_DIR,
  });

  const stream = await exec.start({ hijack: true, stdin: true }) as NodeJS.ReadWriteStream;
  const chunks: Buffer[] = [];
  const startedAt = Date.now();
  let outputBytes = 0;
  let outputTooLarge = false;

  const closed = new Promise<void>((resolve, reject) => {
    stream.on("data", (chunk: Buffer | string) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      outputBytes += buffer.length;
      if (outputBytes > CONTEXT_QUESTION_OUTPUT_MAX_BYTES) {
        outputTooLarge = true;
        (stream as any).destroy?.();
        resolve();
        return;
      }
      chunks.push(buffer);
    });
    stream.on("end", () => resolve());
    stream.on("close", () => resolve());
    stream.on("error", reject);
  });

  stream.write(buildContextQuestionPrompt(input.question));
  stream.end();

  const timeout = new Promise<never>((_, reject) => {
    setTimeout(() => {
      (stream as any).destroy?.();
      const error = new Error("context_question_timeout");
      (error as any).status = 504;
      reject(error);
    }, CONTEXT_QUESTION_TIMEOUT_MS + 5_000);
  });

  await Promise.race([closed, timeout]);

  if (outputTooLarge) {
    const error = new Error("context_question_output_too_large");
    (error as any).status = 502;
    throw error;
  }

  const execInspect = await exec.inspect();
  const rawOutput = decodeDockerLogBuffer(Buffer.concat(chunks));
  const extractedAnswer = isClaudeContextQuestionModel(input.model)
    ? extractClaudeAnswer(rawOutput)
    : extractCodexAnswer(rawOutput);
  const answer = capContextQuestionAnswer(redactKnownContextQuestionSecrets(extractedAnswer));
  if (execInspect.ExitCode && execInspect.ExitCode !== 0) {
    const error = new Error(answer || `context_question_exit_${execInspect.ExitCode}`);
    (error as any).status = classifyContextQuestionFailureStatus(answer, execInspect.ExitCode);
    throw error;
  }

  return {
    answer,
    durationMs: Date.now() - startedAt,
  };
}

// ── HTTP server for stop commands ─────────────────────────

function startHttpServer(): void {
  const server = createServer(async (req, res) => {
    // GET /health
    if (req.method === "GET" && req.url === "/health") {
      const activePreviewContainers = await listActivePreviewContainers().catch(() => []);
      const resourcePressure = await getWorkerResourcePressureForHealth(activePreviewContainers.length);
      const activePreviewContainerCount = activePreviewContainers.length;
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        ok: true,
        host: HOST_ID,
        governanceReachable: lastRuntimeIntentClaimSuccessAt != null,
        maxConcurrentRuns: MAX_CONCURRENT_RUNS,
        activePreviewContainerCount,
        availableStartCapacity: getRuntimeIntentClaimCapacity(activePreviewContainerCount, resourcePressure),
        activePreviewContainers,
        resourcePressure,
        runtimeIntentClaim: {
          lastAttemptAt: lastRuntimeIntentClaimAttemptAt,
          lastSuccessAt: lastRuntimeIntentClaimSuccessAt,
          lastError: lastRuntimeIntentClaimError,
        },
      }));
      return;
    }

    // GET /meta — worker/runner/runtime parity metadata
    if (req.method === "GET" && req.url === "/meta") {
      if (WORKER_SECRET && req.headers["x-worker-secret"] !== WORKER_SECRET) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Unauthorized" }));
        return;
      }

      let dockerVersion: string | null = null;
      try {
        const version = await docker.version();
        dockerVersion = version.Version || null;
      } catch {
        dockerVersion = null;
      }

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        hostId: HOST_ID,
        capturedAt: new Date().toISOString(),
        worker: {
          version: WORKER_AGENT_VERSION,
          gitSha: WORKER_GIT_SHA,
          buildTime: WORKER_BUILD_TIME,
          image: WORKER_IMAGE_NAME,
          nodeVersion: process.version,
          platform: process.platform,
          arch: process.arch,
          hostname: os.hostname(),
        },
        runner: {
          gitSha: RUNNER_GIT_SHA,
          buildTime: RUNNER_BUILD_TIME,
          defaultImage: WORKER_IMAGE_NAME,
        },
        containerRuntime: {
          engine: "docker",
          version: dockerVersion,
          network: ARENA_NETWORK,
          previewDomain: PREVIEW_DOMAIN || null,
        },
      }));
      return;
    }

    // GET /containers/:name/inspect — status, exit info, uptime, memory
    const inspectMatch = req.url?.match(/^\/containers\/([^/]+)\/inspect$/);
    if (req.method === "GET" && inspectMatch) {
      const containerName = decodeURIComponent(inspectMatch[1]);

      if (WORKER_SECRET && req.headers["x-worker-secret"] !== WORKER_SECRET) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Unauthorized" }));
        return;
      }

      try {
        const container = docker.getContainer(containerName);
        const inspect = await container.inspect();
        const state = inspect.State;
        const inspectEnv = normalizeEnv(inspect.Config?.Env || []);
        const startedAt = state?.StartedAt || null;
        const finishedAt = state?.FinishedAt || null;
        const rawStatus = state?.Status || "unknown";
        const status = state?.Running ? "running"
          : (rawStatus === "exited" || rawStatus === "dead" || rawStatus === "created") ? "stopped"
          : rawStatus;

        let memoryUsageBytes: number | null = null;
        let memoryLimitBytes: number | null = null;
        let pidsCurrent: number | null = null;
        if (state?.Running) {
          try {
            const stats = await container.stats({ stream: false });
            memoryUsageBytes = stats.memory_stats?.usage ?? null;
            memoryLimitBytes = stats.memory_stats?.limit ?? null;
            pidsCurrent = stats.pids_stats?.current ?? null;
          } catch {
            // stats may not be available
          }
        }

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          status,
          startedAt,
          finishedAt,
          exitCode: typeof state?.ExitCode === "number" ? state.ExitCode : null,
          oomKilled: state?.OOMKilled === true,
          error: state?.Error || null,
          image: inspect.Config?.Image || null,
          runnerVersion: inspectEnv.get("ARENA_RUNNER_VERSION") || null,
          memoryUsageBytes,
          memoryLimitBytes,
          pidsCurrent,
        }));
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (isDockerNotFoundError(err)) {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ status: "not_found" }));
        } else {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: msg }));
        }
      }
      return;
    }

    // GET /containers/:name/preview-generation — read-only runner control proxy
    const previewGenerationMatch = req.url?.match(/^\/containers\/([^/]+)\/preview-generation$/);
    if (req.method === "GET" && previewGenerationMatch) {
      const containerName = decodeURIComponent(previewGenerationMatch[1]);
      if (WORKER_SECRET && req.headers["x-worker-secret"] !== WORKER_SECRET) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Unauthorized" }));
        return;
      }
      const result = await readPreviewGeneration(containerName);
      if (!result.ok) {
        res.writeHead(503, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: result.error }));
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ generation: result.generation }));
      return;
    }

    // GET /containers/:name/logs?tail=200 — auth-gated tail of container stdout/stderr
    const logsMatch = req.url?.match(/^\/containers\/([^/]+)\/logs(?:\?.*)?$/);
    if (req.method === "GET" && logsMatch) {
      const containerName = decodeURIComponent(logsMatch[1]);

      if (WORKER_SECRET && req.headers["x-worker-secret"] !== WORKER_SECRET) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Unauthorized" }));
        return;
      }

      const url = new URL(req.url || "/", "http://worker-agent.local");
      const tailParam = url.searchParams.get("tail");
      const requestedTail = tailParam !== null ? Number(tailParam) : 200;
      // tail=0 means "all logs", omit tail param; otherwise clamp to 5000
      const tail: number | undefined = (Number.isFinite(requestedTail) && requestedTail === 0)
        ? undefined
        : (Number.isFinite(requestedTail) && requestedTail > 0 ? Math.min(Math.round(requestedTail), 5000) : 200);

      try {
        const container = docker.getContainer(containerName);
        const stream = await container.logs({
          stdout: true,
          stderr: true,
          ...(tail !== undefined ? { tail } : {}),
          timestamps: true,
        });

        const chunks: Buffer[] = [];
        for await (const chunk of stream) {
          if (typeof chunk === "string") {
            chunks.push(Buffer.from(chunk, "utf8"));
            continue;
          }
          if (typeof chunk === "number") {
            chunks.push(Buffer.from([chunk]));
            continue;
          }
          chunks.push(Buffer.from(chunk));
        }

        const rawBuffer = Buffer.concat(chunks);

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          containerName,
          tail,
          logs: sanitizeOperationalLogText(decodeDockerLogBuffer(rawBuffer)),
        }));
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (isDockerNotFoundError(err)) {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ containerName, tail, logs: "", status: "not_found" }));
        } else {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: msg }));
        }
      }
      return;
    }

    // POST /containers/:name/context-question — read-only project context Q&A
    const contextQuestionMatch = req.url?.match(/^\/containers\/([^/]+)\/context-question$/);
    if (req.method === "POST" && contextQuestionMatch) {
      const containerName = decodeURIComponent(contextQuestionMatch[1]);
      let modelForFailure: string | null = null;

      if (WORKER_SECRET && req.headers["x-worker-secret"] !== WORKER_SECRET) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Unauthorized" }));
        return;
      }

      try {
        const body = await readJsonRequest(req);
        const question = readRequestString(body, "question");
        const model = readRequestString(body, "model");
        modelForFailure = model;
        const providerBillingMode = readRequestString(body, "providerBillingMode");
        const claudeAuthMode = readRequestString(body, "claudeAuthMode");
        const codexAuthMode = readRequestString(body, "codexAuthMode");
        const authEnv = readContextQuestionAuthEnv(body);
        if (!question || !model) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "question_and_model_required" }));
          return;
        }
        if (question.length > 2000) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "question_too_long" }));
          return;
        }
        if (!CONTEXT_QUESTION_MODELS.has(model)) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "context_question_model_unsupported" }));
          return;
        }
        if (providerBillingMode && !CONTEXT_QUESTION_PROVIDER_BILLING_MODES.has(providerBillingMode)) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "context_question_provider_billing_mode_unsupported" }));
          return;
        }
        if (claudeAuthMode && !CONTEXT_QUESTION_CLAUDE_AUTH_MODES.has(claudeAuthMode)) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "context_question_claude_auth_mode_unsupported" }));
          return;
        }
        if (codexAuthMode && !CONTEXT_QUESTION_CODEX_AUTH_MODES.has(codexAuthMode)) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "context_question_codex_auth_mode_unsupported" }));
          return;
        }
        if (activeContextQuestionContainers.has(containerName)) {
          res.writeHead(429, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "context_question_already_running" }));
          return;
        }

        activeContextQuestionContainers.add(containerName);
        let result: Awaited<ReturnType<typeof runContextQuestionInContainer>>;
        try {
          result = await runContextQuestionInContainer({
            containerName,
            question,
            model,
            providerBillingMode,
            claudeAuthMode,
            codexAuthMode,
            authEnv,
          });
        } finally {
          activeContextQuestionContainers.delete(containerName);
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          ok: true,
          containerName,
          model,
          executionMode: isClaudeContextQuestionModel(model) ? "claude_tool_allowlist" : "codex_prompt_only",
          answer: result.answer,
          durationMs: result.durationMs,
        }));
      } catch (err: any) {
        const status = Number.isFinite(err?.status) ? Number(err.status) : 500;
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[worker-agent] Context question failed in ${containerName}: (${status})`, msg.slice(0, 500));
        res.writeHead(status, { "Content-Type": "application/json" });
        res.end(JSON.stringify(contextQuestionFailurePayload({
          status,
          message: msg,
          model: modelForFailure,
        })));
      }
      return;
    }

    // POST /containers/:name/start
    const startMatch = req.url?.match(/^\/containers\/([^/]+)\/start$/);
    if (req.method === "POST" && startMatch) {
      const containerName = decodeURIComponent(startMatch[1]);

      if (WORKER_SECRET && req.headers["x-worker-secret"] !== WORKER_SECRET) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Unauthorized" }));
        return;
      }

      try {
        const container = docker.getContainer(containerName);
        await container.start();
        console.log(`[worker-agent] Started container ${containerName}`);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      } catch (err: any) {
        const status = dockerMutationStatus(err);
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[worker-agent] Failed to start ${containerName}: (${status})`, msg);
        res.writeHead(status, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: msg }));
      }
      return;
    }

    // POST /containers/:name/restart
    const restartMatch = req.url?.match(/^\/containers\/([^/]+)\/restart$/);
    if (req.method === "POST" && restartMatch) {
      const containerName = decodeURIComponent(restartMatch[1]);

      if (WORKER_SECRET && req.headers["x-worker-secret"] !== WORKER_SECRET) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Unauthorized" }));
        return;
      }

      try {
        const container = docker.getContainer(containerName);
        await container.restart({ t: 10 });
        console.log(`[worker-agent] Restarted container ${containerName}`);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      } catch (err: any) {
        const status = dockerMutationStatus(err);
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[worker-agent] Failed to restart ${containerName}: (${status})`, msg);
        res.writeHead(status, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: msg }));
      }
      return;
    }

    // POST /containers/:name/stop
    const stopMatch = req.url?.match(/^\/containers\/([^/]+)\/stop$/);
    if (req.method === "POST" && stopMatch) {
      const containerName = decodeURIComponent(stopMatch[1]);

      // Auth check
      if (WORKER_SECRET && req.headers["x-worker-secret"] !== WORKER_SECRET) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Unauthorized" }));
        return;
      }

      try {
        const container = docker.getContainer(containerName);
        await container.stop({ t: 10 }); // 10s grace before SIGKILL
        console.log(`[worker-agent] Stopped container ${containerName}`);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      } catch (err: any) {
        const status = dockerMutationStatus(err);
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[worker-agent] Failed to stop ${containerName}: (${status})`, msg);
        res.writeHead(status, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: msg }));
      }
      return;
    }

    // POST /refresh-tokens — RA-203: run refresh-tokens.sh on host (has Keychain access)
    if (req.method === "POST" && req.url === "/maintenance/restart-self") {
      if (WORKER_SECRET && req.headers["x-worker-secret"] !== WORKER_SECRET) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Unauthorized" }));
        return;
      }

      res.writeHead(202, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        ok: true,
        status: workerMaintenance.isRestartScheduled() ? "already_scheduled" : "scheduled",
        delayMs: workerMaintenance.delayMs,
        host: HOST_ID,
      }), () => {
        workerMaintenance.requestSelfRestart("worker_service_maintenance");
      });
      return;
    }

    // POST /refresh-tokens — RA-203: run refresh-tokens.sh on host (has Keychain access)
    if (req.method === "POST" && req.url === "/refresh-tokens") {
      if (WORKER_SECRET && req.headers["x-worker-secret"] !== WORKER_SECRET) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Unauthorized" }));
        return;
      }

      const scriptPath = path.join(REPO_ROOT, "scripts", "refresh-tokens.sh");
      if (!existsSync(scriptPath)) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, reason: "script_not_found" }));
        return;
      }

      try {
        const output = execFileSync(scriptPath, [], {
          timeout: REFRESH_SCRIPT_TIMEOUT_MS,
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
        });
        const outcome = interpretRefreshTokensScriptOutput(output || "");
        if (!outcome.ok) {
          console.warn("[worker-agent] refresh-tokens.sh returned:", outcome.reason);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, reason: outcome.reason }));
          return;
        }
        console.log("[worker-agent] refresh-tokens.sh succeeded");
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      } catch (err: any) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn("[worker-agent] refresh-tokens.sh failed:", msg.slice(0, 200));
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, reason: msg.slice(0, 200) }));
      }
      return;
    }

    // DELETE /containers/:name — stop + remove container
    const deleteMatch = req.url?.match(/^\/containers\/([^/]+)$/);
    if (req.method === "DELETE" && deleteMatch) {
      const containerName = decodeURIComponent(deleteMatch[1]);

      if (WORKER_SECRET && req.headers["x-worker-secret"] !== WORKER_SECRET) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Unauthorized" }));
        return;
      }

      try {
        const container = docker.getContainer(containerName);
        await container.stop({ t: 5 }).catch(() => {}); // may already be stopped
        await container.remove({ force: true });
        console.log(`[worker-agent] Removed container ${containerName}`);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      } catch (err: any) {
        const status = dockerMutationStatus(err);
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[worker-agent] Failed to remove ${containerName}: (${status})`, msg);
        res.writeHead(status, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: msg }));
      }
      return;
    }

    res.writeHead(404);
    res.end("Not Found");
  });

  const workerMaintenance = createWorkerMaintenanceController({
    delayMs: WORKER_SELF_RESTART_DELAY_MS,
    log: (message) => console.warn(message),
    shutdownImpl: () => {
      server.close(() => {
        process.exit(0);
      });
    },
  });

  server.listen(HTTP_PORT, () => {
    console.log(`[worker-agent] HTTP server on :${HTTP_PORT}`);
  });
}

// ── Util ──────────────────────────────────────────────────

function buildPreviewUrl(containerName: string): string {
  if (!PREVIEW_DOMAIN) return "";
  // RA-133: nip.io uses HTTP (no TLS), localhost uses HTTP, everything else HTTPS
  const useHttp = PREVIEW_DOMAIN.includes("localhost") || PREVIEW_DOMAIN.includes("nip.io");
  const scheme = useHttp ? "http" : "https";
  return `${scheme}://${containerName}.${PREVIEW_DOMAIN}`;
}

function buildPreviewOrigin(containerName: string): string {
  const previewUrl = buildPreviewUrl(containerName);
  if (!previewUrl) return "";
  try {
    return new URL(previewUrl).origin;
  } catch {
    return "";
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function getWorkerResourcePressure(options: {
  timeoutMs?: number;
  fallbackRunningContainerCount?: number;
} = {}): Promise<WorkerResourcePressure> {
  const now = Date.now();
  if (cachedWorkerResourcePressure && cachedWorkerResourcePressure.expiresAt > now) {
    return cachedWorkerResourcePressure.value;
  }

  let value: WorkerResourcePressure;
  try {
    value = await withTimeout(
      readWorkerResourcePressure(),
      options.timeoutMs ?? 0,
      `worker resource pressure sampling timed out after ${options.timeoutMs}ms`,
    );
  } catch (error) {
    value = buildUnavailableWorkerResourcePressure(
      error instanceof Error ? error.message : String(error),
      { runningContainerCount: options.fallbackRunningContainerCount },
    );
  }
  cachedWorkerResourcePressure = {
    expiresAt: now + Math.max(WORKER_RESOURCE_PRESSURE_CACHE_TTL_MS, 0),
    value,
  };
  return value;
}

async function getWorkerResourcePressureForHealth(activePreviewContainerCount: number): Promise<WorkerResourcePressure> {
  return getWorkerResourcePressure({
    timeoutMs: WORKER_HEALTH_RESOURCE_PRESSURE_TIMEOUT_MS,
    fallbackRunningContainerCount: activePreviewContainerCount,
  });
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return promise;

  let timeout: NodeJS.Timeout | null = null;
  return new Promise<T>((resolve, reject) => {
    timeout = setTimeout(() => {
      timeout = null;
      reject(new Error(message));
    }, timeoutMs);

    promise.then(
      (value) => {
        if (timeout) clearTimeout(timeout);
        resolve(value);
      },
      (error) => {
        if (timeout) clearTimeout(timeout);
        reject(error);
      },
    );
  });
}

async function readWorkerResourcePressure(): Promise<WorkerResourcePressure> {
  const containers = await docker.listContainers({ all: false });
  const samples: DockerResourceSample[] = [];

  for (const containerInfo of containers) {
    try {
      const stats = await docker.getContainer(containerInfo.Id).stats({ stream: false }) as {
        memory_stats?: { usage?: number; limit?: number };
        pids_stats?: { current?: number };
      };
      samples.push({
        memoryUsageBytes: readNonNegativeNumber(stats.memory_stats?.usage),
        memoryLimitBytes: readPositiveNumber(stats.memory_stats?.limit),
        pidsCurrent: readNonNegativeNumber(stats.pids_stats?.current),
      });
    } catch {
      // A container can disappear between list and stats. Capacity remains based
      // on available evidence, with sampled/running exposing any telemetry gap.
    }
  }

  return summarizeWorkerResourcePressure(samples, {
    ...WORKER_RESOURCE_PRESSURE_CONFIG,
    capturedAt: new Date().toISOString(),
  }, {
    runningContainerCount: containers.length,
  });
}

function getRuntimeIntentClaimCapacity(
  activeContainerCount: number,
  resourcePressure?: WorkerResourcePressure | null,
): number {
  return calculateResourceAwareClaimCapacity({
    activeContainerCount,
    maxConcurrentRuns: MAX_CONCURRENT_RUNS,
    resourcePressure,
  });
}

async function listActivePreviewContainers(): Promise<string[]> {
  const containers = await docker.listContainers({
    all: false,
    filters: { name: ["^/preview-"] },
  });
  return containers
    .map((c) => c.Names[0]?.replace(/^\//, ""))
    .filter((name): name is string => Boolean(name));
}

function readNonNegativeNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null;
}

function readPositiveNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : null;
}

// ── Start ─────────────────────────────────────────────────

startHttpServer();
void runtimeIntentLoop();
