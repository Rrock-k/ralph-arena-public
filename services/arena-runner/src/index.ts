/**
 * RA-083: Arena Runner — PID 1 inside the worker container.
 *
 * Responsibilities:
 * - Fetch init data (repo/specs/config) from governance
 * - Optional git clone into /workspace/
 * - Write spec files
 * - Spawn one command (ARENA_AGENT_COMMAND)
 * - Capture stdout/stderr → batch push logs
 * - Read .arena/progress.json → push progress
 * - Poll /status → graceful stop (SIGTERM to child)
 * - Poll /specs → update spec files
 * - On exit → report terminal state
 *
 * Runner does NOT know about iterations, completion signals, git commit/push,
 * or agent frameworks. That's the cycle's job.
 */

import { execSync, spawn, type ChildProcess } from "child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, readlinkSync, rmSync, unlinkSync, writeFileSync } from "fs";
import { join } from "path";
import { sanitizeOperationalLogText } from "@arena/contracts";
import type { PauseReason, TerminalForensics, TerminalStatus } from "@arena/contracts";

import { fetchInit, fetchStatus, pushProgress, pushLifecycleEvent, reportTerminal, reportTerminalUntilAccepted, type InitData } from "./api.js";
import {
  gitCheckoutCommit,
  gitClone,
  gitSyncBranchToRemoteHead,
  ensureLocalGitIdentity,
  isGitRepo,
  getCommitSha,
  getCurrentBranch,
  getOriginUrl,
  getWorkspaceDirtyStatusPreview,
  isWorkspaceDirtyBeforeSyncError,
  pushWorkspaceAheadBeforeWipe,
} from "./git.js";
import { syncSpecWorkspace, checkSpecChanges } from "./specs.js";
import { writeAssetFiles, checkAssetChanges } from "./assets.js";
import { LogCollector } from "./logs.js";
import { ProgressWatcher } from "./progress.js";
import { cloneHostRepoIntoWorkspacePreservingBootstrapStartScript } from "./workspace-bootstrap.js";

import { calculateCostUsd, parseUsageFromOutput, shouldTrackCliBudgetUsage } from "./usage.js";
import {
  applyRunnerAuth,
  clearRunnerAuth,
  getCurrentAuthVersion,
  hasRelevantAuth,
  isTokenAlive,
  mergeProjectSecretsBelowRunnerEnv,
  readAuthSnapshot,
  scrubRunnerAuthEnv,
} from "./auth.js";
import { getPausedSupervisorAction, type PausedSupervisorAction } from "./supervisor.js";
import { readEnvFile } from "./env.js";
import { EventSync } from "./events.js";
import { evaluatePreviewWorkspace, resolvePreviewRestoreBranches } from "./preview-workspace.js";
import { decideAuthFailureAction } from "./auth-retry.js";
import { resolveLoopRateLimitRetryAt } from "./rate-limit.js";
import { getIdleDirective } from "./idle-supervisor.js";
import { syncIdleResourceUpdates } from "./idle-resource-sync.js";
import {
  buildTerminalResultArtifact,
  isVerificationLikeProgressState,
  resolveTimeoutTerminalResolution,
  shouldPersistTerminalResultArtifact,
  type TerminalResultArtifact,
} from "./progress-phase.js";
import { resolveRunnerBootstrapMode } from "./bootstrap-mode.js";
import { buildStopRequestArtifact, resolveGovernanceStop } from "./governance-stop.js";
import {
  buildIdlePreviewExitedReport,
  buildIdleResumeReclaimReport,
  buildPausedRuntimeShutdownReport,
} from "./idle-reclaim.js";
import { pruneArenaContractBallast } from "./arena-contract.js";
import { createPreviewGenerationState, startPreviewControlServer, type PreviewRefreshResult } from "./preview-service-worker.js";
import {
  buildResourceKilledTerminalReport,
  type ChildExitSnapshot,
} from "./resource-forensics.js";
import {
  PLATFORM_STAMP_END,
  PLATFORM_STAMP_START,
  buildClaudeMdStamp,
  buildPlatformRules,
  resolveLoopContractMode,
  type LoopContractMode,
} from "./platform-contract.js";
import {
  appendRalphConfigFlagToCommand,
  materializeRalphProjectConfig,
  materializeRalphRuntimeConfig,
} from "./project-config.js";
import { writeMaterializedSourceManifest } from "./materialized-source.js";
import { shouldYieldPreviewOnlyMissingBootstrapToAgent } from "./preview-only-yield.js";

// ── Subscription budget tracker ──────────────────────────

const BUDGET_PUSH_INTERVAL_MS = 15_000; // Push cost estimate every 15s

class SubscriptionBudgetTracker {
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastPushedCostUsd = 0;
  private pushInFlight: Promise<void> | null = null;

  constructor(
    private logs: LogCollector,
    private model: string | null,
  ) {}

  start(): void {
    this.timer = setInterval(() => void this.pushDelta(), BUDGET_PUSH_INTERVAL_MS);
  }

  async stop(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.pushInFlight) {
      await this.pushInFlight;
    }
    await this.pushDelta();
  }

  private async pushDelta(): Promise<void> {
    if (this.pushInFlight) return;

    const usage = parseUsageFromOutput(this.logs.getFullLog());
    if (!usage) return;

    const totalCostUsd = calculateCostUsd(usage.inputTokens, usage.outputTokens, this.model);
    const delta = totalCostUsd - this.lastPushedCostUsd;
    if (delta <= 0) return;

    this.pushInFlight = (async () => {
      const persisted = await pushProgress({
        eventType: "budget_debit",
        budgetDebitedUsd: delta,
        estimatedCostUsd: totalCostUsd,
      });
      if (!persisted) {
        console.warn(`[runner] Budget debit not persisted; will retry +$${delta.toFixed(4)} (total: $${totalCostUsd.toFixed(4)})`);
        return;
      }

      this.lastPushedCostUsd = totalCostUsd;
      console.log(`[runner] Budget debit pushed: +$${delta.toFixed(4)} (total: $${totalCostUsd.toFixed(4)})`);
    })();
    try {
      await this.pushInFlight;
    } finally {
      this.pushInFlight = null;
    }
  }
}

// ── Crash log collection ──────────────────────────────────

/**
 * Scan /tmp for application log files written by child processes.
 * Many tools (e.g. openclaw) write structured logs to files instead of stdout.
 * On crash, these logs contain the real error but runner never sees them.
 * Returns a combined string (capped) suitable for appending to the runner log.
 */
function collectCrashLogs(maxBytes = 8192): string {
  const TMP = "/tmp";
  const parts: string[] = [];
  let totalSize = 0;

  try {
    for (const entry of readdirSync(TMP, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const dir = join(TMP, entry.name);
      try {
        for (const file of readdirSync(dir)) {
          if (!file.endsWith(".log")) continue;
          const filePath = join(dir, file);
          try {
            const content = readFileSync(filePath, "utf-8").trim();
            if (!content) continue;
            // Try to extract human-readable messages from JSON log lines
            const readable = content
              .split("\n")
              .map((line) => {
                try {
                  const obj = JSON.parse(line);
                  const level = obj._meta?.logLevelName ?? "?";
                  const msg = obj["1"] ?? obj["0"] ?? line;
                  return `[${level}] ${typeof msg === "string" ? msg : JSON.stringify(msg)}`;
                } catch {
                  return line;
                }
              })
              .join("\n");
            const header = `\n--- ${filePath} ---\n`;
            if (totalSize + header.length + readable.length > maxBytes) {
              const remaining = maxBytes - totalSize - header.length;
              if (remaining > 100) {
                parts.push(header + readable.slice(-remaining));
              }
              return parts.join("");
            }
            parts.push(header + readable);
            totalSize += header.length + readable.length;
          } catch { /* unreadable file */ }
        }
      } catch { /* unreadable dir */ }
    }
  } catch { /* /tmp not accessible */ }

  return parts.join("");
}

function killProcessOnPort(port: number): number {
  const hexPort = port.toString(16).toUpperCase().padStart(4, "0");
  const inodes = new Set<string>();

  for (const file of ["/proc/net/tcp", "/proc/net/tcp6"]) {
    try {
      const content = readFileSync(file, "utf8");
      for (const line of content.split("\n")) {
        const cols = line.trim().split(/\s+/);
        if (cols[1]?.endsWith(`:${hexPort}`) && cols[3] === "0A") {
          inodes.add(cols[9]);
        }
      }
    } catch {
      // Not Linux or file unavailable inside this image.
    }
  }

  if (inodes.size === 0) return 0;

  const pids = new Set<number>();
  try {
    for (const dir of readdirSync("/proc")) {
      if (!/^\d+$/.test(dir)) continue;
      try {
        for (const fd of readdirSync(`/proc/${dir}/fd`)) {
          try {
            const link = readlinkSync(`/proc/${dir}/fd/${fd}`);
            for (const inode of inodes) {
              if (link === `socket:[${inode}]`) {
                pids.add(Number.parseInt(dir, 10));
              }
            }
          } catch {
            // Permission denied or fd disappeared.
          }
        }
      } catch {
        // Permission denied or process disappeared.
      }
    }
  } catch {
    // /proc unavailable.
  }

  let killed = 0;
  for (const pid of pids) {
    if (pid === process.pid) continue;
    try {
      process.kill(pid, "SIGKILL");
      killed++;
      console.log(`[runner] Killed PID ${pid} occupying port ${port}`);
    } catch {
      // Process already exited.
    }
  }

  return killed;
}

// ── Post-mortem probes ──────────────────────────────────

/** RA-247: Probe if provider API is reachable (not 503/529). */
async function isApiReachable(agentType: string): Promise<boolean> {
  if (agentType === "antigravity") {
    // There is no proven stable Antigravity provider probe yet. Let the adapter
    // classify CLI/auth failures instead of probing Anthropic/OpenAI by mistake.
    return true;
  }

  if (agentType === "opencode") {
    try {
      const res = await fetch("https://opencode.ai/zen/v1/models", {
        method: "HEAD",
        headers: process.env.OPENCODE_API_KEY
          ? { Authorization: `Bearer ${process.env.OPENCODE_API_KEY}` }
          : {},
        signal: AbortSignal.timeout(5000),
      });
      return res.status !== 503 && res.status !== 529;
    } catch {
      return false;
    }
  }

  const baseUrl = agentType === "codex"
    ? (process.env.OPENAI_BASE_URL?.trim() || process.env.OPENAI_API_BASE?.trim() || "https://api.openai.com/v1")
    : (process.env.ANTHROPIC_BASE_URL?.trim() || process.env.ANTHROPIC_API_URL?.trim() || "https://api.anthropic.com");
  const normalizedBaseUrl = baseUrl.replace(/\/$/, "");
  const url = agentType === "codex"
    ? (normalizedBaseUrl === "https://api.openai.com"
        ? "https://api.openai.com/v1/models"
        : `${normalizedBaseUrl}/models`)
    : (normalizedBaseUrl.endsWith("/v1")
        ? `${normalizedBaseUrl}/models`
        : `${normalizedBaseUrl}/v1/models`);
  try {
    const res = await fetch(url, {
      method: "HEAD",
      headers: {
        ...(agentType === "codex" && process.env.OPENAI_API_KEY
          ? { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` }
          : {}),
        ...(agentType !== "codex" && process.env.ANTHROPIC_API_KEY
          ? { "x-api-key": process.env.ANTHROPIC_API_KEY }
          : {}),
      },
      signal: AbortSignal.timeout(5000),
    });
    // 401/403 = API is up (just auth issue). 503/529 = down.
    return res.status !== 503 && res.status !== 529;
  } catch {
    return false;
  }
}

// ── Result file reader ───────────────────────────────────

function readResultJson(): TerminalResultArtifact | null {
  try {
    const raw = readFileSync(RESULT_FILE, "utf-8");
    const parsed = JSON.parse(raw);
    if (typeof parsed?.status === "string") return parsed;
    return null;
  } catch {
    return null;
  }
}

function persistTerminalResultArtifact(artifact: TerminalResultArtifact): void {
  try {
    if (!shouldPersistTerminalResultArtifact(readResultJson(), artifact)) {
      return;
    }
    mkdirSync(join(WORKSPACE_DIR, ".arena"), { recursive: true });
    writeFileSync(RESULT_FILE, JSON.stringify(artifact));
  } catch (error) {
    console.warn(
      "[runner] Failed to persist terminal result artifact:",
      error instanceof Error ? error.message : String(error),
    );
  }
}

function clearArtifactFile(path: string, label: string): void {
  try {
    unlinkSync(path);
  } catch (error) {
    if (
      error
      && typeof error === "object"
      && "code" in error
      && (error as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      return;
    }
    console.warn(
      `[runner] Failed to clear ${label}:`,
      error instanceof Error ? error.message : String(error),
    );
  }
}

function persistStopRequestArtifact(stopReason?: string): void {
  const artifact = stopReason ? buildStopRequestArtifact(stopReason) : null;
  if (!artifact) {
    clearArtifactFile(STOP_REQUEST_FILE, "stop request artifact");
    return;
  }

  try {
    mkdirSync(join(WORKSPACE_DIR, ".arena"), { recursive: true });
    writeFileSync(STOP_REQUEST_FILE, JSON.stringify(artifact));
  } catch (error) {
    console.warn(
      "[runner] Failed to persist stop request artifact:",
      error instanceof Error ? error.message : String(error),
    );
  }
}

// ── Config ────────────────────────────────────────────────

const WORKSPACE_DIR = process.env.ARENA_WORKSPACE_DIR || "/workspace";
const RESULT_FILE = `${WORKSPACE_DIR}/.arena/result.json`;
const PROGRESS_FILE = `${WORKSPACE_DIR}/.arena/progress.json`;
const STOP_REQUEST_FILE = `${WORKSPACE_DIR}/.arena/stop-request.json`;
const RUNNER_VERSION = process.env.ARENA_RUNNER_VERSION || "unknown";
const SPECS_DIR = `${WORKSPACE_DIR}/specs`;
const SECRETS_FILE = `${WORKSPACE_DIR}/.env.arena-secrets`;
const STATUS_POLL_MS = 10_000;
const SPECS_POLL_MS = 30_000;
const VERIFICATION_IDLE_TIMEOUT_MS = Number(process.env.ARENA_VERIFICATION_IDLE_TIMEOUT_MS || String(10 * 60 * 1000));
const GENERAL_IDLE_TIMEOUT_MS = Number(process.env.ARENA_GENERAL_IDLE_TIMEOUT_MS || String(30 * 60 * 1000));

function resolveAgentCommand(
  init: InitData,
  loopDir?: string,
  options: { ralphConfigPath?: string | null } = {},
): string {
  // Explicit override via env
  const envCommand = process.env.ARENA_AGENT_COMMAND;
  if (envCommand) {
    const command = interpolateCommand(envCommand, init, loopDir);
    return options.ralphConfigPath ? appendRalphConfigFlagToCommand(command, options.ralphConfigPath) : command;
  }

  // Command template from governance init
  if (init.commandTemplate) {
    const command = interpolateCommand(init.commandTemplate, init, loopDir);
    return options.ralphConfigPath ? appendRalphConfigFlagToCommand(command, options.ralphConfigPath) : command;
  }

  throw new Error(`No command template for agentImpl="${init.project.agentImpl}". Governance must provide commandTemplate in init response.`);
}

function interpolateCommand(template: string, init: InitData, loopDir?: string): string {
  let result = template
    .replace(/\{agent\}/g, init.project.agent)
    .replace(/\{specdir\}/g, SPECS_DIR)
    .replace(/\{specfile\}/g, `${WORKSPACE_DIR}/spec.md`)
    .replace(/\{workdir\}/g, WORKSPACE_DIR);
  // RA-149: Replace {loopdir} with actual loop directory
  if (loopDir) {
    result = result.replace(/\{loopdir\}/g, loopDir);
  }
  // Remove --model flag entirely when model is null/empty (avoids arg parsing issues)
  if (init.project.model) {
    result = result.replace(/\{model\}/g, init.project.model);
  } else {
    result = result.replace(/--model\s+\{model\}/g, "");
    result = result.replace(/\{model\}/g, "");
  }
  return result;
}

// RA-149: Git-based loop loading
const LOOPS_DIR = "/arena/loops";

function loadLoopFromGit(loopSource: { url: string; ref?: string; installCommand?: string }): string {
  const loopName = loopSource.url.replace(/\.git$/, "").split("/").pop() || "loop";
  const loopDir = `${LOOPS_DIR}/${loopName}`;

  // RA-212: Check for local source mount (dev mode). Worker mounts host repo as {name}-src.
  const localSource = `${LOOPS_DIR}/${loopName}-src`;
  const hasLocalSource = existsSync(`${localSource}/.git`);

  mkdirSync(LOOPS_DIR, { recursive: true });

  // Clean up stale loop dir from previous run (container restart)
  if (existsSync(loopDir)) {
    execSync(`rm -rf ${loopDir}`, { stdio: "inherit" });
  }

  if (hasLocalSource) {
    // Dev mode: clone from local mount (instant, no network)
    const branchArg = loopSource.ref ? `--branch ${loopSource.ref}` : "";
    const label = loopSource.ref ?? "HEAD";
    console.log(`[runner] Cloning loop from local source: ${localSource} @ ${label}`);
    execSync(
      `git clone ${branchArg} file://${localSource} ${loopDir}`.replace(/\s+/g, " "),
      { stdio: "inherit", timeout: 30_000 },
    );
  } else {
    // Prod: clone from remote URL
    const refLabel = loopSource.ref ?? "HEAD";
    console.log(`[runner] Loading loop from git: ${loopSource.url} @ ${refLabel}`);
    let cloneUrl = loopSource.url;
    const githubToken = process.env.GITHUB_TOKEN;
    if (githubToken && cloneUrl.includes("github.com")) {
      cloneUrl = cloneUrl.replace("https://github.com/", `https://x-access-token:${githubToken}@github.com/`);
    }
    const cloneCommand = loopSource.ref
      ? `git clone --depth 1 --branch ${loopSource.ref} ${cloneUrl} ${loopDir}`
      : `git clone --depth 1 ${cloneUrl} ${loopDir}`;
    execSync(cloneCommand, { stdio: "inherit", timeout: 120_000 });
  }

  const installCmd = loopSource.installCommand ?? "npm ci --production";
  if (existsSync(`${loopDir}/package.json`)) {
    console.log(`[runner] Installing loop dependencies: ${installCmd}`);
    execSync(installCmd, { cwd: loopDir, stdio: "inherit", timeout: 120_000 });
  }

  console.log(`[runner] Loop loaded at ${loopDir}`);
  return loopDir;
}

function ensureWorkspaceWritable(): void {
  try {
    execSync(`sudo mkdir -p "${WORKSPACE_DIR}" && sudo chown -R $(id -u):$(id -g) "${WORKSPACE_DIR}"`, { stdio: "ignore" });
  } catch {
    // sudo may not be available — ok, will fail later if truly unwritable
  }
}

function clearWorkspaceDir(): void {
  mkdirSync(WORKSPACE_DIR, { recursive: true });
  for (const entry of readdirSync(WORKSPACE_DIR)) {
    rmSync(join(WORKSPACE_DIR, entry), { recursive: true, force: true });
  }
}

// RA-385: keep the tail of the preview app's own output so a crash can be
// explained without `docker logs` on a container the worker is about to delete.
// A project whose code does not run is a project defect; without this the only
// thing reaching the operator is `INFRA`, which points at the platform instead.
const PREVIEW_OUTPUT_TAIL_LINES = 40;
const PREVIEW_OUTPUT_TAIL_CHARS = 1_500;
const previewOutputTail: string[] = [];

function rememberPreviewOutput(text: string): void {
  for (const line of text.split("\n")) {
    const trimmed = line.trimEnd();
    if (!trimmed) continue;
    previewOutputTail.push(trimmed);
  }
  if (previewOutputTail.length > PREVIEW_OUTPUT_TAIL_LINES) {
    previewOutputTail.splice(0, previewOutputTail.length - PREVIEW_OUTPUT_TAIL_LINES);
  }
}

function previewOutputTailText(): string {
  const joined = previewOutputTail.join("\n");
  return joined.length > PREVIEW_OUTPUT_TAIL_CHARS
    ? joined.slice(-PREVIEW_OUTPUT_TAIL_CHARS)
    : joined;
}

// RA-247: Stamp CLAUDE.md with platform contract (idempotent, preserves existing content)
// Returns the workspace-relative product-source paths the stamp materialized.
async function stampClaudeMd(mode: LoopContractMode): Promise<string[]> {
  const { writeFileSync } = await import("fs");
  const claudeMdRelativePath = "CLAUDE.md";
  const claudeMdPath = `${WORKSPACE_DIR}/${claudeMdRelativePath}`;
  const stamp = buildClaudeMdStamp(mode);

  if (!existsSync(claudeMdPath)) {
    writeFileSync(claudeMdPath, stamp + "\n");
    return [claudeMdRelativePath];
  }
  const content = readFileSync(claudeMdPath, "utf-8");
  if (content.includes(PLATFORM_STAMP_START)) {
    const re = new RegExp(`${PLATFORM_STAMP_START}[\\s\\S]*?${PLATFORM_STAMP_END}`);
    writeFileSync(claudeMdPath, content.replace(re, stamp));
  } else {
    writeFileSync(claudeMdPath, stamp + "\n\n" + content);
  }
  return [claudeMdRelativePath];
}

// RA-247: Strict preview contract — only arena-start.sh, no fallbacks
function isProcessRunning(proc: ChildProcess | null): boolean {
  return !!proc && proc.exitCode === null;
}

function startWorkspaceApp(
  logs: LogCollector,
  opts?: { captureLogs?: boolean },
): ChildProcess | null {
  const startSh = `${WORKSPACE_DIR}/arena-start.sh`;
  if (!existsSync(startSh)) {
    console.error("[runner] No arena-start.sh found — cannot start preview");
    return null;
  }

  const killed = killProcessOnPort(3000);
  if (killed > 0) {
    console.log(`[runner] Cleared ${killed} process(es) from port 3000 before preview start`);
  }

  const command = `chmod +x ${startSh} && exec ${startSh}`;
  const appChild = spawn("sh", ["-lc", command], {
    cwd: WORKSPACE_DIR,
    env: {
      ...scrubRunnerAuthEnv(process.env),
      ...readEnvFile(SECRETS_FILE),
      PORT: "3000",
      APP_PORT: "3000",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  previewOutputTail.length = 0;

  appChild.stdout?.on("data", (data: Buffer) => {
    const text = sanitizeOperationalLogText(data.toString());
    process.stdout.write(text);
    rememberPreviewOutput(text);
    if (opts?.captureLogs !== false) {
      logs.append("stdout", text);
    }
  });

  appChild.stderr?.on("data", (data: Buffer) => {
    const text = sanitizeOperationalLogText(data.toString());
    process.stderr.write(text);
    rememberPreviewOutput(text);
    if (opts?.captureLogs !== false) {
      logs.append("stderr", text);
    }
  });

  return appChild;
}

async function waitForWorkspaceHealth(): Promise<boolean> {
  const requestTimeoutMs = 3_000;
  const pollIntervalMs = 1_000;
  const maxAttempts = 180;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const res = await fetch("http://127.0.0.1:3000/health", {
        signal: AbortSignal.timeout(requestTimeoutMs),
      });
      if (res.ok) return true;
    } catch {
      // App may still be starting.
    }
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }
  return false;
}

async function startHealthyWorkspacePreview(
  logs: LogCollector,
): Promise<{
  child: ChildProcess | null;
  previewActual: "SERVING" | "ERROR";
  reasonCode?: string;
  reasonMessage?: string;
}> {
  const child = startWorkspaceApp(logs);
  if (!child) {
    return {
      child: null,
      previewActual: "ERROR",
      reasonCode: "preview_start_missing",
      reasonMessage: "No arena-start.sh — cannot start preview",
    };
  }

  const healthy = await waitForWorkspaceHealth();
  if (!healthy) {
    const reasonMessage = "Preview app failed health check on port 3000";
    child.kill("SIGTERM");
    return {
      child: null,
      previewActual: "ERROR",
      reasonCode: "preview_start_unhealthy",
      reasonMessage,
    };
  }

  previewGenerationState.markServing();
  return {
    child,
    previewActual: "SERVING",
  };
}

let previewChild: ChildProcess | null = null;
let previewChildHealthy = false;
let previewRefreshHandler: ((trigger: string) => Promise<PreviewRefreshResult>) | null = null;
const previewGenerationState = createPreviewGenerationState({
  workspaceDir: WORKSPACE_DIR,
  stateFile: process.env.ARENA_PREVIEW_GENERATION_STATE_FILE || "/tmp/arena-preview-generation.json",
});

function isPreviewServing(): boolean {
  return isProcessRunning(previewChild) && previewChildHealthy;
}

function startWorkspacePreviewSidecar(logs: LogCollector): {
  started: boolean;
  reasonCode?: string;
  reasonMessage?: string;
} {
  if (isProcessRunning(previewChild)) {
    return { started: previewChildHealthy };
  }

  const appChild = startWorkspaceApp(logs, { captureLogs: false });
  if (!appChild) {
    previewChild = null;
    previewChildHealthy = false;
    return {
      started: false,
      reasonCode: "preview_start_missing",
      reasonMessage: "No arena-start.sh — cannot start preview",
    };
  }

  previewChild = appChild;
  previewChildHealthy = false;

  appChild.once("exit", () => {
    if (previewChild === appChild) {
      previewChild = null;
      previewChildHealthy = false;
    }
  });
  appChild.once("error", () => {
    if (previewChild === appChild) {
      previewChild = null;
      previewChildHealthy = false;
    }
  });

  void (async () => {
    const healthy = await waitForWorkspaceHealth();
    if (previewChild !== appChild) return;
    if (!healthy) {
      console.warn("[runner] Active preview sidecar failed health check");
      previewChildHealthy = false;
      appChild.kill("SIGTERM");
      return;
    }
    previewChildHealthy = true;
    previewGenerationState.markServing();
    console.log("[runner] Active preview sidecar is serving on port 3000");
  })().catch((error) => {
    if (previewChild !== appChild) return;
    previewChildHealthy = false;
    console.warn(
      "[runner] Active preview sidecar health check failed:",
      error instanceof Error ? error.message : String(error),
    );
  });

  return { started: true };
}

// ── Retry helper ─────────────────────────────────────────

async function retryAsync<T>(
  fn: () => Promise<T>,
  opts: { retries: number; baseDelayMs: number },
): Promise<T> {
  for (let attempt = 1; attempt <= opts.retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt === opts.retries) throw err;
      const delay = opts.baseDelayMs * attempt;
      console.log(`[runner] Attempt ${attempt}/${opts.retries} failed, retrying in ${delay}ms...`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw new Error("unreachable");
}

async function stopPreviewChild(reason: string): Promise<void> {
  if (!previewChild || previewChild.exitCode !== null) return;
  console.log(`[runner] Stopping preview child (${reason})`);
  const proc = previewChild;
  proc.kill("SIGTERM");
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      if (proc.exitCode === null) proc.kill("SIGKILL");
      resolve();
    }, 10_000);
    proc.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
    proc.once("error", () => {
      clearTimeout(timer);
      resolve();
    });
  });
  if (previewChild === proc) {
    previewChild = null;
    previewChildHealthy = false;
  }
}

async function waitForPauseResolution(): Promise<PausedSupervisorAction> {
  while (true) {
    try {
      const status = await fetchStatus({ state: "paused" });
      applyRunnerAuth(status.auth, status.authVersion);
      const action = getPausedSupervisorAction(status);
      if (action !== "stay_paused") {
        console.log(`[runner] Pause supervisor resolved: ${action}${status.reason ? ` (${status.reason})` : ""}`);
        return action;
      }
    } catch (error) {
      console.warn(
        "[runner] Pause supervisor poll failed:",
        error instanceof Error ? error.message : String(error),
      );
    }
    await new Promise((resolve) => setTimeout(resolve, STATUS_POLL_MS));
  }
}

async function superviseIdlePreview(
  projectTitle: string,
  currentSpecsHash: string,
  currentAssetsHash: string,
  eventSync: EventSync | null,
): Promise<"resume_agent" | "shutdown" | "preview_exited"> {
  let nextSpecPollAt = Date.now();
  let pendingLoopWork = false;
  const unsubscribeQaFeedback = eventSync?.addEventCallback((evt) => {
    if (evt.type === "qa_feedback_batch") {
      console.log("[runner] Idle supervisor: QA feedback queued new loop work");
      pendingLoopWork = true;
    }
  });

  try {
    while (true) {
      if (!previewChild || previewChild.exitCode !== null) {
        return "preview_exited";
      }

      try {
        const status = await fetchStatus({ state: "idle" });
        applyRunnerAuth(status.auth, status.authVersion);
        const directive = getIdleDirective(status, pendingLoopWork);
        if (directive === "resume_agent") {
          console.log("[runner] Idle supervisor: resuming agent loop");
          return "resume_agent";
        }
        if (directive === "shutdown") {
          console.log(`[runner] Idle supervisor: shutdown requested (${status.reason})`);
          return "shutdown";
        }
      } catch (error) {
        console.warn(
          "[runner] Idle supervisor poll failed:",
          error instanceof Error ? error.message : String(error),
        );
      }

      if (Date.now() >= nextSpecPollAt) {
        try {
          const syncResult = await syncIdleResourceUpdates({
            workspaceDir: WORKSPACE_DIR,
            specsDir: SPECS_DIR,
            projectTitle,
            currentSpecsHash,
            currentAssetsHash,
          });
          currentSpecsHash = syncResult.currentSpecsHash;
          currentAssetsHash = syncResult.currentAssetsHash;
          pendingLoopWork ||= syncResult.pendingLoopWork;
        } catch {
          // Transient failure — ignore
        }
        nextSpecPollAt = Date.now() + SPECS_POLL_MS;
      }

      await new Promise((resolve) => setTimeout(resolve, STATUS_POLL_MS));
    }
  } finally {
    unsubscribeQaFeedback?.();
  }
}

async function reclaimIdleRuntimeForResume(
  reasonMessage: string,
  eventSync: EventSync | null,
  logs: LogCollector,
  progress: ProgressWatcher,
): Promise<void> {
  await eventSync?.stop();
  logs.stop();
  await progress.stopAndDrain();
  await reportTerminalUntilAccepted({
    ...buildIdleResumeReclaimReport(reasonMessage),
    ...(isGitRepo(WORKSPACE_DIR) ? { commitSha: getCommitSha(WORKSPACE_DIR) ?? undefined } : {}),
  }, {
    context: "idle_resume_reclaim",
  });
}

async function reportIdlePreviewExited(
  reasonMessage: string,
  eventSync: EventSync | null,
  logs: LogCollector,
  progress: ProgressWatcher,
): Promise<void> {
  await eventSync?.stop();
  logs.stop();
  await progress.stopAndDrain();
  await reportTerminalUntilAccepted({
    ...buildIdlePreviewExitedReport(reasonMessage),
    ...(isGitRepo(WORKSPACE_DIR) ? { commitSha: getCommitSha(WORKSPACE_DIR) ?? undefined } : {}),
  }, {
    context: "idle_preview_exited",
  });
}

async function reportPausedRuntimeShutdown(
  reasonMessage: string,
  eventSync: EventSync | null,
  logs: LogCollector,
  progress: ProgressWatcher,
): Promise<void> {
  await eventSync?.stop();
  logs.stop();
  await progress.stopAndDrain();
  await reportTerminalUntilAccepted({
    ...buildPausedRuntimeShutdownReport(reasonMessage),
    ...(isGitRepo(WORKSPACE_DIR) ? { commitSha: getCommitSha(WORKSPACE_DIR) ?? undefined } : {}),
  }, {
    context: "paused_runtime_shutdown",
  });
}

async function fetchFreshAuthAfterFailure(
  agentType: string,
  state: string | null,
): Promise<{
  authVersion?: string;
  hasRelevantFreshAuth: boolean;
}> {
  try {
    const status = await fetchStatus({ state, refreshAuth: true });
    applyRunnerAuth(status.auth, status.authVersion);
  } catch (error) {
    console.warn(
      "[runner] Failed to fetch fresh auth after auth failure:",
      error instanceof Error ? error.message : String(error),
    );
  }

  const snapshot = readAuthSnapshot();
  return {
    authVersion: snapshot.version,
    hasRelevantFreshAuth: hasRelevantAuth(agentType, snapshot.auth),
  };
}

// ── Main ──────────────────────────────────────────────────

let child: ChildProcess | null = null;
let shouldStop = false;
let verificationTimedOut = false;
let stopReason: string | undefined;
let terminationRequested = false;


async function main(): Promise<void> {
  console.log("[runner] Arena Runner starting (PID 1)");
  console.log(`[runner] PROJECT_ID=${process.env.ARENA_PROJECT_ID}`);
  startPreviewControlServer({
    workspaceDir: WORKSPACE_DIR,
    generationState: previewGenerationState,
    refreshPreview: async (trigger) => {
      if (!previewRefreshHandler) {
        return {
          previewActual: "ERROR",
          reasonCode: "preview_refresh_not_ready",
          reasonMessage: "Preview refresh handler is not initialized yet.",
        };
      }
      return previewRefreshHandler(trigger);
    },
  });

  // 1. Fetch init data (with retry — governance may be briefly unavailable at startup)
  const init = await retryAsync(() => fetchInit(), { retries: 5, baseDelayMs: 2000 });
  console.log(
    `[runner] Init: project=${init.project.id}, agent=${init.project.agent}, impl=${init.project.agentImpl}`,
  );
  const loopContractMode = resolveLoopContractMode({
    agentImpl: init.project.agentImpl,
    commandTemplate: init.commandTemplate,
  });

  await pushLifecycleEvent("RUNNER_INIT");

  // RA-247: agentIntent from governance — explicit agent ON/OFF
  const agentIntent = init.project.agentIntent ?? "ON";
  const bootstrapMode = resolveRunnerBootstrapMode(
    agentIntent,
    process.env.ARENA_RUNTIME_INTENT_RUNNER_MODE,
  );
  const skipAgent = bootstrapMode === "preview_only";
  const agentOffBootstrap = agentIntent === "OFF";

  // 2. Ensure workspace is writable (bind-mounted dirs may be root-owned)
  // RA-131: Runner ensures workspace is writable by 'node' (1000)
  console.log(`[runner] Ensuring ${WORKSPACE_DIR} is writable by runtime user`);
  ensureWorkspaceWritable();

  // A2E workspace copy: clone from read-only host mount (always takes priority over repoUrl)
  if (existsSync("/host-repo")) {
    if (existsSync(WORKSPACE_DIR) && isGitRepo(WORKSPACE_DIR)) {
      console.log("[runner] A2E mode: workspace already has git repo, reusing");
    } else {
      console.log("[runner] A2E mode: cloning from /host-repo into workspace...");
      cloneHostRepoIntoWorkspacePreservingBootstrapStartScript("/host-repo", WORKSPACE_DIR);
      // Ensure workspace is writable after clone
      ensureWorkspaceWritable();
      // Remove read-only remote to prevent push failures
      try {
        execSync(`git -C "${WORKSPACE_DIR}" remote remove origin`, { stdio: "ignore" });
      } catch { /* ok if no remote */ }
      console.log("[runner] A2E mode: workspace copy ready (remote removed)");
      await pushLifecycleEvent("REPO_CLONED");
    }
  }

  // 2. Git bootstrap when configured (or reuse existing workspace)
  if (skipAgent) {
    if (agentOffBootstrap) {
      console.log("[runner] agentIntent=OFF — preview-only mode");
    } else {
      console.log("[runner] runtime-intent preview_only — resident preview bootstrap");
    }
    const repo = init.repo;

    const workspaceExists = existsSync(WORKSPACE_DIR) && readdirSync(WORKSPACE_DIR).length > 0;
    const workspaceDecision = evaluatePreviewWorkspace(
      {
        exists: workspaceExists,
        isGitRepo: workspaceExists && isGitRepo(WORKSPACE_DIR),
        originUrl: workspaceExists ? getOriginUrl(WORKSPACE_DIR) : null,
        branch: workspaceExists ? getCurrentBranch(WORKSPACE_DIR) : null,
        commitSha: workspaceExists ? getCommitSha(WORKSPACE_DIR) : null,
      },
      {
        repoUrl: repo?.url ?? null,
        repoBranch: repo?.baseBranch ?? null,
        projectBranch: repo?.projectBranch ?? null,
        commitSha: init.project.commitSha ?? null,
      },
    );
    const restoreBranches = resolvePreviewRestoreBranches({
      repoBranch: repo?.baseBranch,
      projectBranch: repo?.projectBranch,
    });

    if (!workspaceDecision.reuseExistingWorkspace) {
      if (!repo?.url) {
        throw new Error("Preview-only mode: workspace missing and no repo URL configured");
      }

      console.log(
        `[runner] Preview-only: refreshing workspace (${workspaceDecision.reasonCode}: ${workspaceDecision.reasonMessage})`,
      );

      // RA-383: the restore below wipes the directory, so anything origin does
      // not already have must go there first. A failure here deliberately stops
      // the runtime instead of proceeding: a stopped runtime is visible and
      // recoverable, silently destroyed work is neither.
      if (workspaceExists) {
        const rescue = pushWorkspaceAheadBeforeWipe(WORKSPACE_DIR, {
          projectBranch: repo.projectBranch ?? null,
          rescueBranch: `arena/rescue/${init.project.id}/${new Date().toISOString().replace(/[:.]/g, "-")}`,
        });
        console.log(
          rescue.pushed
            ? `[runner] Preview-only: rescued workspace to origin/${rescue.ref} (${rescue.reason})`
            : `[runner] Preview-only: nothing to rescue (${rescue.reason})`,
        );
      }

      clearWorkspaceDir();
      let cloned = false;
      let lastCloneError: unknown;
      for (const branch of restoreBranches) {
        try {
          gitClone(repo.url, branch, WORKSPACE_DIR);
          cloned = true;
          break;
        } catch (error) {
          lastCloneError = error;
          clearWorkspaceDir();
          console.warn(`[runner] Preview-only: failed to clone ${branch}, trying next restore branch if available`);
        }
      }
      if (!cloned) {
        throw lastCloneError instanceof Error
          ? lastCloneError
          : new Error("Preview-only restore failed to clone any configured branch");
      }
      if (init.project.commitSha) {
        gitCheckoutCommit(WORKSPACE_DIR, init.project.commitSha);
      }
      console.log("[runner] Preview-only: cloned workspace from git");
    } else {
      console.log(
        `[runner] Preview-only: reusing existing workspace (${workspaceDecision.reasonCode}: ${workspaceDecision.reasonMessage})`,
      );
      if (!init.project.commitSha && restoreBranches[0]) {
        gitSyncBranchToRemoteHead(WORKSPACE_DIR, restoreBranches[0], {
          restoreRunnerManagedDirtyPaths: true,
          pushLocalAheadBeforeSync: true,
          expectedRepoUrl: repo?.url ?? null,
        });
      }
    }
  } else {
    const repo = init.repo;

    if (repo?.url) {
      if (existsSync(WORKSPACE_DIR) && isGitRepo(WORKSPACE_DIR)) {
        console.log("[runner] Workspace exists, syncing project branch to origin head");
      } else {
        if (existsSync(WORKSPACE_DIR) && readdirSync(WORKSPACE_DIR).length > 0) {
          throw new Error("Workspace directory exists but is not a git repository");
        }
        mkdirSync(WORKSPACE_DIR, { recursive: true });
        gitClone(repo.url, repo.baseBranch, WORKSPACE_DIR);
        await pushLifecycleEvent("REPO_CLONED");
      }
      gitSyncBranchToRemoteHead(WORKSPACE_DIR, repo.projectBranch, {
        restoreRunnerManagedDirtyPaths: true,
        pushLocalAheadBeforeSync: true,
        allowDirtyAgentResume: true,
        initializeMissingRemoteBranch: true,
        expectedRepoUrl: repo.url,
      });
    } else {
      mkdirSync(WORKSPACE_DIR, { recursive: true });
      console.log("[runner] No repo bootstrap configured, using direct-command workspace");
    }
  }

  ensureLocalGitIdentity(WORKSPACE_DIR);

  // 3. Write specs (individual files + combined spec.md)
  // Prepend project title so agent knows WHAT to build (spec may omit it)
  const projectTitle = init.proposal?.title || "";
  syncSpecWorkspace(WORKSPACE_DIR, SPECS_DIR, init.specs, projectTitle);
  await pushLifecycleEvent("SPECS_WRITTEN");
  let currentSpecsHash = init.specsHash;
  console.log(`[runner] Wrote ${init.specs.length} spec files`);

  const projectConfigResult = materializeRalphProjectConfig(WORKSPACE_DIR, init);
  if (projectConfigResult.status === "written") {
    const tech = projectConfigResult.techStack;
    console.log(
      `[runner] Wrote project.config.json (${[tech.language, tech.framework, tech.runtime].filter(Boolean).join(" / ")})`,
    );
  } else if (projectConfigResult.status === "preserved") {
    console.log("[runner] Preserved existing project.config.json");
  } else {
    console.log(`[runner] Skipped project.config.json materialization (${projectConfigResult.reason})`);
  }

  const ralphRuntimeConfigResult = materializeRalphRuntimeConfig(WORKSPACE_DIR, init);
  const ralphRuntimeConfigPath = ralphRuntimeConfigResult.status === "written"
    ? ralphRuntimeConfigResult.path
    : null;
  if (ralphRuntimeConfigPath) {
    console.log("[runner] Wrote runner-owned .arena/ralph.config.json");
  }

  // RA-247: Stamp CLAUDE.md with platform contract block
  const stampedSourcePaths = await stampClaudeMd(loopContractMode);
  // Declare runner-stamped product source so the loop can deliver it before the
  // agent runs; undeclared platform-written files read as ambiguous source and
  // block the loop's pre-agent source evidence guard.
  const materializedSourceManifest = writeMaterializedSourceManifest(WORKSPACE_DIR, stampedSourcePaths);
  console.log(
    `[runner] Declared runner-materialized source: ${materializedSourceManifest.paths.join(", ")}`,
  );

  // 3b. Sync project assets (passive inputs referenced by specs)
  const initialAssets = init.assets ?? [];
  await writeAssetFiles(WORKSPACE_DIR, initialAssets);
  await pushLifecycleEvent("ASSETS_SYNCED");
  let currentAssetsHash = init.assetsHash ?? "";
  console.log(`[runner] Synced ${initialAssets.length} project assets`);

  // 4. Write secrets to .env in workspace (agent can source them)
  if (Object.keys(init.secrets).length > 0) {
    const { writeFileSync } = await import("fs");
    const envContent = Object.entries(init.secrets)
      .map(([k, v]) => `${k}=${v}`)
      .join("\n");
    writeFileSync(`${WORKSPACE_DIR}/.env.arena-secrets`, envContent, { mode: 0o600 });
    console.log(`[runner] Wrote ${Object.keys(init.secrets).length} secrets to .env.arena-secrets`);
  }

  // 5. Write platform prompt — RA-247: full platform rules + RA-222 runtime context
  {
    const { writeFileSync: writeFileSyncFs } = await import("fs");
    const arenaDir = `${WORKSPACE_DIR}/.arena`;
    mkdirSync(arenaDir, { recursive: true });
    const removedArenaBallast = pruneArenaContractBallast(WORKSPACE_DIR);
    if (removedArenaBallast.length > 0) {
      console.log(`[runner] Removed non-contract .arena artifacts: ${removedArenaBallast.join(", ")}`);
    }

    const platformRules = buildPlatformRules({
      mode: loopContractMode,
      projectId: init.project.id,
    });

    const runtimeContext = init.platformPrompt
      ? `\n---\n\n## Runtime Context\n\n${init.platformPrompt}\n`
      : "";

    writeFileSyncFs(`${arenaDir}/platform.md`, platformRules + runtimeContext);
    console.log("[runner] Wrote .arena/platform.md");
  }

  applyRunnerAuth();

  // 6. Setup log collector & progress watcher (RA-149: capabilities-driven)
  const capabilities = new Set(init.capabilities ?? []);
  // Service-like agents (recipes) don't use log streaming, progress sync, or event sync
  // Previously hardcoded to agent name; now driven by absence of capabilities
  const hasAgentCapabilities = capabilities.has("log_streaming") || capabilities.has("progress");
  const logStreamingEnabled = hasAgentCapabilities && capabilities.has("log_streaming");
  const progressSyncEnabled = hasAgentCapabilities && capabilities.has("progress");
  const eventSyncEnabled = hasAgentCapabilities;

  const logs = new LogCollector({
    streamLogs: logStreamingEnabled,
    tailBytes: hasAgentCapabilities ? 512 * 1024 : 64 * 1024,
  });
  if (logStreamingEnabled) {
    logs.start();
  }

  const runnerStartedAtMs = Date.now();
  let previewRefreshChain = Promise.resolve();
  const refreshWorkspacePreview = async (trigger: string): Promise<PreviewRefreshResult> => {
    if (terminationRequested || shouldStop) {
      return {
        previewActual: "ERROR",
        reasonCode: "runner_stopping",
        reasonMessage: "Runner is stopping; preview refresh skipped.",
      };
    }

    console.log(`[runner] Refreshing preview sidecar (${trigger})`);
    await stopPreviewChild(trigger);
    const preview = await startHealthyWorkspacePreview(logs);
    previewChild = preview.child;
    previewChildHealthy = preview.previewActual === "SERVING";
    return {
      previewActual: preview.previewActual,
      ...(preview.reasonCode ? { reasonCode: preview.reasonCode } : {}),
      ...(preview.reasonMessage ? { reasonMessage: preview.reasonMessage } : {}),
    };
  };
  const queuePreviewRefresh = (trigger: string): Promise<void> => {
    previewRefreshChain = previewRefreshChain
      .catch(() => {
        // Keep the refresh queue alive after prior failures.
      })
      .then(async () => {
        const result = await refreshWorkspacePreview(trigger);
        if (result.previewActual !== "SERVING") {
          console.warn(`[runner] Preview refresh unavailable: ${result.reasonMessage ?? result.reasonCode ?? "unknown"}`);
        }
      });
    return previewRefreshChain;
  };
  previewRefreshHandler = async (trigger: string) => {
    await queuePreviewRefresh(`control_${trigger}`);
    if (isPreviewServing()) {
      return { previewActual: "SERVING" };
    }
    return {
      previewActual: "ERROR",
      reasonCode: "preview_not_serving_after_refresh",
      reasonMessage: "Preview is not serving after refresh.",
    };
  };

  const progress = new ProgressWatcher(WORKSPACE_DIR, {
    getPreviewActual: () => (isPreviewServing() ? "SERVING" : undefined),
    onIterationAdvanced: (iteration) => {
      if (skipAgent) return;
      if (!child || child.exitCode !== null) return;
      return queuePreviewRefresh(`iteration_refresh_${iteration}`);
    },
  });
  console.log(
    `[runner] Capabilities: [${[...capabilities].join(", ")}]`,
  );
  console.log(
    `[runner] Runtime features: agentCaps=${hasAgentCapabilities}, logs=${logStreamingEnabled}, progress=${progressSyncEnabled}, events=${eventSyncEnabled}`,
  );
  if (progressSyncEnabled) {
    progress.start(() => {});
  }

  // RA-089: Event sync (agent ↔ human communication)
  const eventSync = eventSyncEnabled ? new EventSync(WORKSPACE_DIR) : null;
  eventSync?.start();
  eventSync?.addEventCallback((evt) => {
    if (evt.type !== "preview_refresh_requested") return;
    if (evt.createdAt) {
      const requestedAtMs = Date.parse(evt.createdAt);
      if (Number.isFinite(requestedAtMs) && requestedAtMs < runnerStartedAtMs) {
        return;
      }
    }
    void queuePreviewRefresh("manual_preview_refresh").catch((error) => {
      console.warn(`[runner] Manual preview refresh failed: ${error instanceof Error ? error.message : String(error)}`);
    });
  });

  if (!skipAgent) {
    try {
      const bootstrapStatus = await fetchStatus({ state: "paused" });
      applyRunnerAuth(bootstrapStatus.auth, bootstrapStatus.authVersion);
      const bootstrapAction = getPausedSupervisorAction(bootstrapStatus);
      if (bootstrapAction === "stay_paused") {
        console.log(`[runner] Bootstrap paused by governance (${bootstrapStatus.reason ?? "unknown"})`);
        const preview = startWorkspacePreviewSidecar(logs);
        if (!preview.started && preview.reasonMessage) {
          console.warn(`[runner] Paused bootstrap preview unavailable: ${preview.reasonMessage}`);
        }
        const action = await waitForPauseResolution();
        if (action === "resume") {
          await stopPreviewChild("bootstrap_pause_resume");
          console.log("[runner] Bootstrap pause cleared — yielding runtime for a fresh claim");
          await reclaimIdleRuntimeForResume(
            "Bootstrap-paused runtime yielded so cleared blockers can resume through a fresh claim.",
            eventSync,
            logs,
            progress,
          );
          return;
        }
        await stopPreviewChild("bootstrap_pause_shutdown");
        await reportPausedRuntimeShutdown(
          "Bootstrap-paused runtime shut down after governance requested shutdown.",
          eventSync,
          logs,
          progress,
        );
        return;
      }
      if (bootstrapAction === "shutdown") {
        console.log(`[runner] Bootstrap shutdown requested by governance (${bootstrapStatus.reason ?? "unknown"})`);
        await stopPreviewChild("bootstrap_shutdown");
        await reportPausedRuntimeShutdown(
          "Bootstrap runtime shut down before agent start after governance requested shutdown.",
          eventSync,
          logs,
          progress,
        );
        return;
      }
    } catch (error) {
      console.warn(
        "[runner] Bootstrap status gate failed; continuing with normal status supervision:",
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  if (skipAgent) {
    if (agentOffBootstrap) {
      console.log("[runner] agentIntent=OFF: starting preview without agent");
    } else {
      console.log("[runner] preview_only runtime intent: starting resident preview without agent");
    }

    const preview = await startHealthyWorkspacePreview(logs);
    previewChild = preview.child;
    previewChildHealthy = preview.previewActual === "SERVING";
    if (!previewChild) {
      const reasonMessage = preview.reasonMessage || "No arena-start.sh — cannot start preview";
      if (shouldYieldPreviewOnlyMissingBootstrapToAgent({
        agentIntent,
        hasPendingLoopWork: init.project.hasPendingLoopWork,
        previewStarted: false,
        previewReasonCode: preview.reasonCode,
      })) {
        console.log("[runner] preview_only missing bootstrap while loop work is pending — yielding for agent_run");
        await reclaimIdleRuntimeForResume(
          "Preview-only runtime yielded because pending loop work must create the preview bootstrap.",
          eventSync,
          logs,
          progress,
        );
        return;
      }
      await reportTerminal({
        terminalState: "CANCELED",
        pauseReason: "INFRA",
        reasonCode: preview.reasonCode || (agentOffBootstrap ? "preview_start_missing" : "resident_preview_start_missing"),
        reasonMessage,
        containerName: process.env.ARENA_CONTAINER_NAME || undefined,
        previewUrl: process.env.ARENA_PREVIEW_URL || undefined,
        workerHost: process.env.ARENA_WORKER_HOST || undefined,
        previewActual: preview.previewActual,
        previewLastError: reasonMessage,
        ...(isGitRepo(WORKSPACE_DIR) ? { commitSha: getCommitSha(WORKSPACE_DIR) ?? undefined } : {}),
      });
      await eventSync?.stop();
      logs.stop();
      await progress.stopAndDrain();
      return;
    }

    if (agentOffBootstrap) {
      await reportTerminal({
        terminalState: "CANCELED",
        reasonCode: "agent_off",
        reasonMessage: "Preview-only — agentIntent=OFF",
        containerName: process.env.ARENA_CONTAINER_NAME || undefined,
        previewUrl: process.env.ARENA_PREVIEW_URL || undefined,
        workerHost: process.env.ARENA_WORKER_HOST || undefined,
        previewActual: preview.previewActual,
        ...(isGitRepo(WORKSPACE_DIR) ? { commitSha: getCommitSha(WORKSPACE_DIR) ?? undefined } : {}),
      });
    } else {
      console.log("[runner] preview_only runtime intent: preview healthy, entering idle supervision");
    }

    const idleAction = await superviseIdlePreview(
      projectTitle,
      currentSpecsHash,
      currentAssetsHash,
      eventSync,
    );
    if (idleAction === "resume_agent") {
      await stopPreviewChild(agentOffBootstrap ? "preview_only_resume_agent" : "resident_preview_resume_agent");
      await reclaimIdleRuntimeForResume(
        agentOffBootstrap
          ? "Preview-only runtime yielded so AGENT ON can resume through a fresh claim."
          : "Resident preview yielded so pending loop work can resume through a fresh claim.",
        eventSync,
        logs,
        progress,
      );
      process.exit(0);
    }

    if (idleAction === "shutdown") {
      await stopPreviewChild(agentOffBootstrap ? "preview_only_shutdown" : "resident_preview_shutdown");
      await eventSync?.stop();
      logs.stop();
      await progress.stopAndDrain();
      process.exit(0);
    }

    await eventSync?.stop();
    logs.stop();
    await progress.stopAndDrain();
    const exitCode = previewChild?.exitCode ?? 1;
    // RA-385: the app's own last words travel with the report. The container is
    // removed right after this, taking `docker logs` with it, so whatever is not
    // carried here is lost.
    const outputTail = previewOutputTailText();
    const reasonMessage = outputTail
      ? `Preview app exited unexpectedly with code ${exitCode}. Last output:\n${outputTail}`
      : `Preview app exited unexpectedly with code ${exitCode} (no output captured)`;
    console.error(`[runner] Preview app exited unexpectedly with code ${exitCode}`);
    await reportTerminal({
      terminalState: "CANCELED",
      pauseReason: "INFRA",
      reasonCode: agentOffBootstrap ? `preview_only_exit_${exitCode}` : `resident_preview_exit_${exitCode}`,
      reasonMessage,
      containerName: process.env.ARENA_CONTAINER_NAME || undefined,
      previewUrl: process.env.ARENA_PREVIEW_URL || undefined,
      workerHost: process.env.ARENA_WORKER_HOST || undefined,
      previewActual: "ERROR",
      previewLastError: reasonMessage,
      ...(isGitRepo(WORKSPACE_DIR) ? { commitSha: getCommitSha(WORKSPACE_DIR) ?? undefined } : {}),
    });
    // RA-387: the app is gone and nothing here will bring it back. Exiting
    // non-zero stops the container, so a dead preview looks dead from the
    // outside instead of sitting `Up` with an idle PID 1. Governance may have
    // already terminated the project (409 above) — that changes who reports the
    // state, not whether this process should keep running.
    process.exit(1);
  }

  // 7b. RA-149: Load loop from git if configured
  let loopDir: string | undefined;
  if (init.loopSource?.url) {
    loopDir = loadLoopFromGit(init.loopSource);
  }

  // 8. Resolve and spawn agent command
  const command = resolveAgentCommand(init, loopDir, { ralphConfigPath: ralphRuntimeConfigPath });
  const shouldTrackBudgetUsage = shouldTrackCliBudgetUsage(
    init.project.agent,
    process.env,
    init.project.providerBillingMode ?? process.env.ARENA_PROVIDER_BILLING_MODE,
  );
  const budgetTracker = shouldTrackBudgetUsage
    ? new SubscriptionBudgetTracker(logs, init.project.model)
    : null;
  const agentType = init.project.agent;
  const attemptedAuthVersions = new Set<string>();
  let childEnv: Record<string, string> = {};
  let terminalState: TerminalStatus = "FAILED";
  let pauseReason: PauseReason | undefined;
  let pauseRetryAt: string | undefined;
  let reasonCode: string | undefined;
  let reasonMessage: string | undefined;
  let previewActual: "SERVING" | "ERROR" | undefined;
  let previewLastError: string | undefined;
  let finalExitCode = 1;
  let finalExitSignal: string | null = null;
  let terminalForensics: TerminalForensics | undefined;
  let keepPreviewAliveOnStop = false;

  for (let attempt = 1; ; attempt += 1) {
    if (terminationRequested) {
      terminalState = "CANCELED";
      reasonCode = "stopped_by_governance";
      reasonMessage = "Runner received termination signal before starting the next attempt.";
      break;
    }

    shouldStop = false;
    verificationTimedOut = false;
    stopReason = undefined;
    pauseReason = undefined;
    pauseRetryAt = undefined;
    keepPreviewAliveOnStop = false;
    let generalIdleTimedOut = false;

    const attemptAuthVersion = getCurrentAuthVersion();
    if (attemptAuthVersion) {
      attemptedAuthVersions.add(attemptAuthVersion);
    }

    childEnv = mergeProjectSecretsBelowRunnerEnv(
      process.env,
      init.secrets,
    );
    if (capabilities.size > 0) {
      childEnv.ARENA_CAPABILITIES = [...capabilities].join(",");
    }

    console.log(
      `[runner] Spawning attempt ${attempt}: ${command}` +
      (attemptAuthVersion ? ` (authVersion=${attemptAuthVersion})` : ""),
    );
    await pushLifecycleEvent(attempt === 1 ? "AGENT_STARTED" : "AGENT_RESTARTED_AUTH");

    try { unlinkSync(RESULT_FILE); } catch {}
    clearArtifactFile(STOP_REQUEST_FILE, "stop request artifact");

    child = spawn("sh", ["-c", command], {
      cwd: WORKSPACE_DIR,
      env: childEnv,
      stdio: ["pipe", "pipe", "pipe"],
      detached: true,
    });

    child.stdout?.on("data", (data: Buffer) => {
      const text = sanitizeOperationalLogText(data.toString());
      process.stdout.write(text);
      logs.append("stdout", text);
    });

    child.stderr?.on("data", (data: Buffer) => {
      const text = sanitizeOperationalLogText(data.toString());
      process.stderr.write(text);
      logs.append("stderr", text);
    });

    budgetTracker?.start();

    if (!isProcessRunning(previewChild)) {
      const livePreview = startWorkspacePreviewSidecar(logs);
      if (!livePreview.started && livePreview.reasonMessage) {
        console.warn(`[runner] Active preview sidecar unavailable: ${livePreview.reasonMessage}`);
      }
    }

    const statusTimer = setInterval(async () => {
      try {
        const status = await fetchStatus({ state: progress.getLastState() });
        applyRunnerAuth(status.auth, status.authVersion);
        if ((status as any).runnerOutdated) {
          console.warn(`[runner] WARNING: runner version outdated (${RUNNER_VERSION}). Relaunch to update.`);
        }
        if (status.shouldStop) {
          // status_deployed is handled via result.json now
          console.log(`[runner] Stop signal received: ${status.reason}`);
          shouldStop = true;
          stopReason = status.reason || "stopped";
          persistStopRequestArtifact(stopReason);
          gracefulStop(status.reason || "stopped");
        }
      } catch {
        // Transient failure — ignore
      }
    }, STATUS_POLL_MS);

    const verificationTimer = setInterval(() => {
      if (!child || shouldStop || verificationTimedOut) return;
      if (!isVerificationLikeProgressState(progress.getLastState())) return;

      const baseline = Math.max(
        progress.getLastActivityAt() ?? 0,
        logs.getLastActivityAt() ?? 0,
        progress.getLastStateChangedAt() ?? 0,
      );
      if (!baseline) return;

      if (Date.now() - baseline >= VERIFICATION_IDLE_TIMEOUT_MS) {
        verificationTimedOut = true;
        shouldStop = true;
        console.log(
          `[runner] Verification timed out after ${Math.round(VERIFICATION_IDLE_TIMEOUT_MS / 60000)}m without new logs or progress`,
        );
        gracefulStop("verification_timeout");
      }
    }, STATUS_POLL_MS);

    const generalIdleTimer = setInterval(() => {
      if (!child || shouldStop || generalIdleTimedOut || verificationTimedOut) return;
      // RA-247: Long-running loop in idle watch mode — don't kill it
      if (progress.getLastState() === "idle") return;

      const baseline = Math.max(
        progress.getLastActivityAt() ?? 0,
        logs.getLastActivityAt() ?? 0,
        progress.getLastStateChangedAt() ?? 0,
      );
      if (!baseline) return;

      const idleMs = Date.now() - baseline;
      if (idleMs >= GENERAL_IDLE_TIMEOUT_MS) {
        generalIdleTimedOut = true;
        shouldStop = true;
        console.log(
          `[runner] General idle timeout: no activity for ${Math.round(idleMs / 60000)}m — killing child`,
        );
        gracefulStop("general_idle_timeout");
      }
    }, STATUS_POLL_MS);

    const specsTimer = setInterval(async () => {
      try {
        const changed = await checkSpecChanges(currentSpecsHash);
        if (changed) {
          console.log("[runner] Specs changed, updating files");
          syncSpecWorkspace(WORKSPACE_DIR, SPECS_DIR, changed.specs, projectTitle);
          currentSpecsHash = changed.hash;
        }
      } catch {
        // Transient failure — ignore
      }
    }, SPECS_POLL_MS);

    const assetsTimer = setInterval(async () => {
      try {
        const changed = await checkAssetChanges(currentAssetsHash);
        if (changed) {
          console.log("[runner] Assets changed, syncing files");
          await writeAssetFiles(WORKSPACE_DIR, changed.assets);
          currentAssetsHash = changed.hash;
        }
      } catch {
        // Transient failure — ignore
      }
    }, SPECS_POLL_MS);

    const childExit = await new Promise<ChildExitSnapshot>((resolve) => {
      child!.on("exit", (code, signal) => {
        resolve({
          exitCode: code ?? (signal === "SIGKILL" ? 137 : 1),
          signal,
          lastProgressState: progress.getLastState(),
        });
      });
      child!.on("error", (err) => {
        console.error("[runner] Child process error:", err);
        resolve({
          exitCode: 1,
          signal: null,
          lastProgressState: progress.getLastState(),
        });
      });
    });
    const exitCode = childExit.exitCode;
    finalExitCode = exitCode;
    finalExitSignal = childExit.signal ?? null;

    clearInterval(statusTimer);
    clearInterval(specsTimer);
    clearInterval(assetsTimer);
    clearInterval(verificationTimer);
    clearInterval(generalIdleTimer);
    await budgetTracker?.stop();
    await eventSync?.flush();

    // RA-247: Simplified terminal state resolution
    // Priority 1: Runner-initiated stop (timeouts, governance signal)
    const timeoutResolution = resolveTimeoutTerminalResolution({
      verificationTimedOut,
      generalIdleTimedOut,
      verificationIdleTimeoutMs: VERIFICATION_IDLE_TIMEOUT_MS,
      generalIdleTimeoutMs: GENERAL_IDLE_TIMEOUT_MS,
    });
    if (timeoutResolution) {
      terminalState = timeoutResolution.terminalState;
      pauseReason = timeoutResolution.pauseReason;
      reasonCode = timeoutResolution.reasonCode;
      reasonMessage = timeoutResolution.reasonMessage;
      break;
    }

    if (shouldStop) {
      if (stopReason) {
        const resolvedStop = resolveGovernanceStop(stopReason);
        terminalState = resolvedStop.terminalState;
        pauseReason = resolvedStop.pauseReason;
        reasonCode = resolvedStop.reasonCode;
        keepPreviewAliveOnStop = resolvedStop.keepPreviewAlive === true;
      } else {
        terminalState = "CANCELED";
        reasonCode = "stopped_by_governance";
      }
      reasonMessage = stopReason === "agent_off"
        ? "Agent stopped — agentIntent set to OFF"
        : `Governance stop: ${stopReason ?? "stopped"}`;
      break;
    }

    // Priority 2: Loop's result.json
    const result = readResultJson();
    if (result) {
      terminalState = result.status;
      pauseReason = result.pauseReason as PauseReason | undefined;
      pauseRetryAt = resolveLoopRateLimitRetryAt(result);
      reasonCode = result.status.toLowerCase();
      reasonMessage = result.reason || result.status;
      break;
    }

    // Priority 3: Exit code fallback (no result.json)
    if (exitCode === 0) {
      terminalState = "DEPLOYED";
      reasonCode = "exit_0_no_result";
      reasonMessage = "Agent exited successfully (no result.json)";
    } else {
      const resourceKilledReport = buildResourceKilledTerminalReport(childExit, {
        workspaceStatusPreview: isGitRepo(WORKSPACE_DIR)
          ? getWorkspaceDirtyStatusPreview(WORKSPACE_DIR)
          : null,
      });
      if (resourceKilledReport) {
        terminalState = resourceKilledReport.terminalState;
        pauseReason = resourceKilledReport.pauseReason;
        reasonCode = resourceKilledReport.reasonCode;
        reasonMessage = resourceKilledReport.reasonMessage;
        terminalForensics = resourceKilledReport.forensics;
        break;
      }

      // Check if auth token expired — only retry case we keep
      const tokenAlive = await isTokenAlive(agentType);
      if (!tokenAlive) {
        const freshAuth = await fetchFreshAuthAfterFailure(agentType, progress.getLastState());
        const authDecision = decideAuthFailureAction({
          attemptAuthVersion,
          refreshedAuthVersion: freshAuth.authVersion,
          hasRelevantFreshAuth: freshAuth.hasRelevantFreshAuth,
          attemptedAuthVersions,
        });
        if (authDecision.action === "retry_now") {
          console.log(`[runner] Auth expired — newer snapshot ${authDecision.authVersion} available, restarting`);
          continue;
        }
        terminalState = "CANCELED";
        pauseReason = "API";
        reasonCode = authDecision.reasonCode;
        reasonMessage = authDecision.reasonMessage;
        break;
      }

      // RA-247: API reachability probe — transient infra issues (503/529/timeout)
      // Quota/rate-limit pauses require structured loop result truth.
      const apiReachable = await isApiReachable(agentType);
      if (!apiReachable) {
        console.log(`[runner] Provider API unreachable — marking INFRA pause`);
        terminalState = "CANCELED";
        pauseReason = "INFRA";
        reasonCode = "api_unreachable";
        reasonMessage = "Provider API unreachable (503/529/timeout)";
        break;
      }

      terminalState = "FAILED";
      reasonCode = `exit_code_${exitCode}`;
      reasonMessage = `Agent exited with code ${exitCode} (no result.json)`;
    }
    break;
  }

  if (progressSyncEnabled) {
    await progress.stopAndDrain();
  }

  const shouldAttemptPreview =
    keepPreviewAliveOnStop ||
    terminalState === "DEPLOYED" ||
    terminalState === "FAILED" ||
    pauseReason != null;

  if (isPreviewServing()) {
    previewActual = "SERVING";
  } else if (shouldAttemptPreview) {
    const preview = await startHealthyWorkspacePreview(logs);
    previewActual = preview.previewActual;
    previewLastError = preview.reasonMessage;

    if (preview.child) {
      previewChild = preview.child;
      previewChildHealthy = preview.previewActual === "SERVING";
    } else if (terminalState === "DEPLOYED") {
      terminalState = "FAILED";
      reasonCode = preview.reasonCode || "deploy_start_failed";
      reasonMessage = preview.reasonMessage || "Workspace app could not be started after agent completion";
    }
  }

  // Collect crash logs from child process log files (e.g. openclaw writes to /tmp/)
  if (terminalState === "FAILED") {
    const crashLogs = collectCrashLogs();
    if (crashLogs) {
      console.log("[runner] Collected crash logs from child process log files");
      logs.append("stderr", crashLogs);
    }
  }

  console.log(`[runner] Terminal: ${terminalState} (exit=${finalExitCode}, signal=${finalExitSignal ?? "none"}, lastState=${progress.getLastState()})`);

  const parsedUsage = shouldTrackBudgetUsage
    ? parseUsageFromOutput(logs.getFullLog())
    : null;

  // RA-144: Report commitSha so gallery revive can restore from git
  const commitSha = isGitRepo(WORKSPACE_DIR) ? getCommitSha(WORKSPACE_DIR) : null;
  const reportIdentity = {
    containerName: process.env.ARENA_CONTAINER_NAME || undefined,
    previewUrl: process.env.ARENA_PREVIEW_URL || undefined,
    workerHost: process.env.ARENA_WORKER_HOST || undefined,
  };
  persistTerminalResultArtifact(buildTerminalResultArtifact({
    terminalState,
    pauseReason,
    reasonMessage,
    retryAt: pauseRetryAt,
  }));
  clearArtifactFile(PROGRESS_FILE, "progress artifact");
  clearArtifactFile(STOP_REQUEST_FILE, "stop request artifact");

  await reportTerminal({
    terminalState,
    ...(pauseReason ? { pauseReason } : {}),
    ...(pauseRetryAt ? { retryAt: pauseRetryAt } : {}),
    reasonCode,
    reasonMessage,
    ...reportIdentity,
    ...(previewActual ? { previewActual } : {}),
    ...(previewLastError ? { previewLastError } : {}),
    log: logs.getFullLog().slice(-50000), // Last 50KB of log
    inputTokens: parsedUsage?.inputTokens,
    outputTokens: parsedUsage?.outputTokens,
    estimatedCostUsd: parsedUsage
      ? calculateCostUsd(parsedUsage.inputTokens, parsedUsage.outputTokens, init.project.model)
      : undefined,
    ...(terminalForensics ? { forensics: terminalForensics } : {}),
    ...(commitSha ? { commitSha } : {}),
  });
  clearRunnerAuth();

  console.log("[runner] Done.");

  const previewPreservedStop = keepPreviewAliveOnStop && previewActual === "SERVING";
  const shouldStayAlive =
    previewPreservedStop ||
    terminalState === "DEPLOYED" ||
    pauseReason != null ||
    (terminalState === "FAILED" && previewActual === "SERVING");

  if (shouldStayAlive) {
    // Stop EventSync for paused/failed-preview states (no loop to consume events), keep for DEPLOYED (QA feedback loop)
    if (terminalState !== "DEPLOYED") {
      await eventSync?.stop();
    }

    if (pauseReason != null) {
      console.log("[runner] Staying alive for pause supervisor...");
      const action = await waitForPauseResolution();
      if (action === "resume") {
        await stopPreviewChild("pause_resume");
        console.log("[runner] Pause cleared — yielding runtime for a fresh claim");
        await reclaimIdleRuntimeForResume(
          "Paused runtime yielded so cleared blockers can resume through a fresh claim.",
          eventSync,
          logs,
          progress,
        );
        return;
      }
      await stopPreviewChild("pause_shutdown");
      await reportPausedRuntimeShutdown(
        "Paused runtime shut down after governance requested shutdown.",
        eventSync,
        logs,
        progress,
      );
      return;
    } else if (
      previewPreservedStop ||
      terminalState === "DEPLOYED" ||
      (terminalState === "FAILED" && previewActual === "SERVING")
    ) {
      const idleAction = await superviseIdlePreview(projectTitle, currentSpecsHash, currentAssetsHash, eventSync);
      if (idleAction === "resume_agent") {
        await stopPreviewChild(
          previewPreservedStop
            ? "agent_off_idle_resume_agent"
            : terminalState === "DEPLOYED"
            ? "deployed_idle_resume_agent"
            : "failed_idle_resume_agent",
        );
        await reclaimIdleRuntimeForResume(
          previewPreservedStop
            ? "Paused preview yielded so AGENT ON can resume through a fresh claim."
            : terminalState === "DEPLOYED"
            ? "Completed preview yielded so new loop work can resume through a fresh claim."
            : "Failed preview yielded so new loop work can resume through a fresh claim.",
          eventSync,
          logs,
          progress,
        );
        return;
      }
      if (idleAction === "preview_exited") {
        await reportIdlePreviewExited(
          previewPreservedStop
            ? "Paused preview exited unexpectedly; governance should restore the waiting project through the normal claim path."
            : terminalState === "DEPLOYED"
            ? "Completed preview exited unexpectedly; governance should restore preview or resume new loop work through the normal claim path."
            : "Failed preview exited unexpectedly; governance should restore preview or resume new loop work through the normal claim path.",
          eventSync,
          logs,
          progress,
        );
        return;
      }
      await stopPreviewChild(
        previewPreservedStop
          ? "agent_off_idle_shutdown"
          : terminalState === "DEPLOYED"
          ? "deployed_idle_shutdown"
          : "failed_idle_shutdown",
      );
    }
  } else {
    await stopPreviewChild("runner_exit");
    await eventSync?.stop();
  }

  if (logStreamingEnabled) {
    logs.stop();
  }
  process.exit(0);
}

// ── Graceful shutdown ─────────────────────────────────────

function gracefulStop(reason: string): void {
  if (!child || child.exitCode !== null) return;
  const pid = child.pid;
  if (!pid) return;

  console.log(`[runner] Sending SIGTERM to process group ${pid} (reason: ${reason})`);
  try {
    process.kill(-pid, "SIGTERM"); // Kill entire process group (loop + agent + children)
  } catch {
    // Process group may already be dead
  }

  // Force kill after 30s
  setTimeout(() => {
    if (child && child.exitCode === null) {
      console.log("[runner] Process group did not exit after SIGTERM, sending SIGKILL");
      try {
        process.kill(-pid, "SIGKILL");
      } catch {
        // Process group may already be dead
      }
    }
  }, 30_000);
}

// Handle SIGTERM from docker stop
process.on("SIGTERM", () => {
  console.log("[runner] Received SIGTERM");
  terminationRequested = true;
  shouldStop = true;
  gracefulStop("sigterm");
});

process.on("SIGINT", () => {
  console.log("[runner] Received SIGINT");
  terminationRequested = true;
  shouldStop = true;
  gracefulStop("sigint");
});

// Start
//
// RA-387: every path out of main() must end the process. A container that is
// `Up` with a PID 1 that has stopped supervising anything is indistinguishable
// from a healthy one for Docker, worker-agent and governance alike — that is
// how a dead preview kept reporting HEALTHY. main() exits explicitly on its
// normal paths; this backstop covers the early returns, so no future `return`
// can silently leave a zombie behind.
main().then(() => {
  console.error("[runner] main() returned without exiting — stopping container");
  process.exit(1);
}).catch((err) => {
  console.error("[runner] Fatal error:", err);
  if (isWorkspaceDirtyBeforeSyncError(err)) {
    void reportTerminal({
      terminalState: "CANCELED",
      pauseReason: "MANUAL",
      reasonCode: "workspace_dirty_before_sync",
      reasonMessage: err.message,
      containerName: process.env.ARENA_CONTAINER_NAME || undefined,
      previewUrl: process.env.ARENA_PREVIEW_URL || undefined,
      workerHost: process.env.ARENA_WORKER_HOST || undefined,
      ...(isGitRepo(WORKSPACE_DIR) ? { commitSha: getCommitSha(WORKSPACE_DIR) ?? undefined } : {}),
    }).finally(() => process.exit(1));
    return;
  }
  process.exit(1);
});
