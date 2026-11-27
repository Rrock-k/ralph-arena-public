/**
 * Shared utilities for direct-family loop versions.
 *
 * Contains: arg parsing, agent runner, git, deploy, helpers, codex auth, CLAUDE.md.
 * Each version imports what it needs.
 */

import { execSync, spawn as nodeSpawn } from "child_process";
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from "fs";
import { join, basename } from "path";
import { createHash } from "crypto";
import { readEnvFile } from "../env.js";
import { mergeProjectSecretsBelowRunnerEnv, scrubRunnerAuthEnv } from "../auth.js";
import { detectRateLimitSignal, type RateLimitSignal } from "../rate-limit.js";

// ── Arg parsing ──────────────────────────────────────────

export function getArg(name: string, defaultValue = ""): string {
  const args = process.argv.slice(2);
  const idx = args.indexOf(`--${name}`);
  return idx >= 0 && args[idx + 1] ? args[idx + 1] : defaultValue;
}

// ── Constants ────────────────────────────────────────────

const CODEX_REASONING_EFFORT_CONFIG_ARGS = ["-c", 'model_reasoning_effort="xhigh"'];

export interface DirectConfig {
  agent: string;
  model: string;
  specDir: string;
  workDir: string;
  maxIterations: number;
  pushBranch: string;
  progressFile: string;
  resultFile: string;
  authCacheFile: string;
  secretsFile: string;
}

export interface DirectAgentRun {
  output: string;
  rateLimitSignal: RateLimitSignal | null;
}

export function buildConfig(): DirectConfig {
  const agent = getArg("agent", "claude-code");
  const model = getArg("model", "");
  const specDir = getArg("spec-dir", "/workspace/specs");
  const workDir = getArg("work-dir", "/workspace");
  return {
    agent,
    model,
    specDir,
    workDir,
    maxIterations: Number(process.env.DIRECT_MAX_ITERATIONS || "10"),
    pushBranch: process.env.ARENA_PUSH_BRANCH || `arena/project-${process.env.ARENA_PROJECT_ID || "unknown"}`,
    progressFile: join(workDir, ".arena", "progress.json"),
    resultFile: join(workDir, ".arena", "result.json"),
    authCacheFile: join(workDir, ".arena", "auth-refresh.json"),
    secretsFile: join(workDir, ".env.arena-secrets"),
  };
}

// ── Logging ──────────────────────────────────────────────

export function log(msg: string): void {
  console.log(`[direct-cycle] [${new Date().toISOString().slice(11, 19)}] ${msg}`);
}

// ── Progress & done marker ───────────────────────────────

export function writeProgress(cfg: DirectConfig, state: string, iteration: number, extra?: Record<string, unknown>): void {
  mkdirSync(join(cfg.workDir, ".arena"), { recursive: true });
  writeFileSync(cfg.progressFile, JSON.stringify({ state, iteration, ...extra }));
}

// RA-247: Write result.json (terminal signal from loop to runner)
export function writeResult(
  cfg: DirectConfig,
  status: string,
  reason?: string,
  extra?: { pauseReason?: string; retryAt?: Date | string | null },
): void {
  mkdirSync(join(cfg.workDir, ".arena"), { recursive: true });
  const retryAt = extra?.retryAt instanceof Date
    ? extra.retryAt.toISOString()
    : typeof extra?.retryAt === "string"
      ? extra.retryAt
      : null;
  writeFileSync(cfg.resultFile, JSON.stringify({
    status,
    ...(reason ? { reason } : {}),
    ...(extra?.pauseReason ? { pauseReason: extra.pauseReason } : {}),
    ...(retryAt ? { retryAt } : {}),
  }));

}

export function writeRateLimitResultIfDetected(
  cfg: DirectConfig,
  run: DirectAgentRun,
  iteration: number,
  phase: string,
): boolean {
  if (!run.rateLimitSignal) return false;

  const retryAt = run.rateLimitSignal.retryAt?.toISOString();
  log(`Provider rate limit detected during ${phase}; pausing direct cycle${retryAt ? ` until ${retryAt}` : ""}`);
  writeResult(cfg, "CANCELED", run.rateLimitSignal.reasonMessage, {
    pauseReason: "RATE_LIMIT",
    retryAt,
  });
  writeProgress(cfg, "paused_rate_limit", iteration, {
    pauseReason: "RATE_LIMIT",
    ...(retryAt ? { retryAt } : {}),
  });
  return true;
}

// ── Specs ────────────────────────────────────────────────

export function hashSpecs(specDir: string): string {
  try {
    const files = readdirSync(specDir)
      .filter((f) => f.endsWith(".md"))
      .sort();
    const content = files.map((f) => readFileSync(join(specDir, f), "utf-8")).join("\n");
    return createHash("sha256").update(content).digest("hex");
  } catch {
    return "none";
  }
}

export function readAllSpecs(specDir: string): string {
  try {
    const files = readdirSync(specDir)
      .filter((f) => f.endsWith(".md"))
      .sort();
    return files
      .map((f) => `--- ${basename(f)} ---\n${readFileSync(join(specDir, f), "utf-8")}`)
      .join("\n\n");
  } catch {
    return "(no specs found)";
  }
}

// ── Auth & secrets ───────────────────────────────────────

function readRefreshedAuthEnv(authCacheFile: string): Record<string, string> {
  try {
    const raw = readFileSync(authCacheFile, "utf-8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const authEnv: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === "string" && value.length > 0) authEnv[key] = value;
    }
    return authEnv;
  } catch {
    return {};
  }
}

function readRuntimeSecretsEnv(secretsFile: string): Record<string, string> {
  return readEnvFile(secretsFile);
}

export function setupCodexAuth(): void {
  const authJson = process.env.CODEX_AUTH_JSON;
  if (authJson) {
    const codexDir = join(process.env.HOME || "/home/node", ".codex");
    mkdirSync(codexDir, { recursive: true });
    writeFileSync(join(codexDir, "auth.json"), authJson, { mode: 0o600 });
  }
}

// ── RA-135: stream-json parsing for usage tracking ───────

let lastUsageSignature = "";

function extractUsage(msg: any): { inputTokens: number; outputTokens: number } | null {
  for (const candidate of [msg?.usage, msg?.message?.usage, msg?.result?.usage, msg]) {
    if (!candidate || typeof candidate !== "object") continue;
    const inp =
      typeof candidate.input_tokens === "number" ? candidate.input_tokens :
      typeof candidate.inputTokens === "number" ? candidate.inputTokens : null;
    const out =
      typeof candidate.output_tokens === "number" ? candidate.output_tokens :
      typeof candidate.outputTokens === "number" ? candidate.outputTokens : null;
    if (inp != null || out != null) return { inputTokens: inp ?? 0, outputTokens: out ?? 0 };
  }
  return null;
}

function printStreamJson(msg: any): void {
  const usage = extractUsage(msg);
  if (usage) {
    const sig = `${usage.inputTokens}:${usage.outputTokens}`;
    if (sig !== lastUsageSignature) {
      lastUsageSignature = sig;
      process.stdout.write(`[tokens: ${usage.inputTokens} in / ${usage.outputTokens} out]\n`);
    }
  }

  const type = msg.type;
  if (type === "assistant" && msg.message?.content) {
    for (const block of msg.message.content) {
      if (block.type === "text") {
        process.stdout.write(block.text);
      } else if (block.type === "tool_use") {
        const tool = block.name || "tool";
        const input = typeof block.input === "string" ? block.input : JSON.stringify(block.input);
        const short = input.length > 200 ? input.slice(0, 200) + "..." : input;
        process.stdout.write(`\n[tool] ${tool}: ${short}\n`);
      }
    }
  } else if (type === "result") {
    // Final result — skip, captured in fullOutput
  } else if (type === "system" || type === "error") {
    const text = msg.message || msg.error || JSON.stringify(msg);
    process.stdout.write(`[${type}] ${text}\n`);
  }
}

// ── Agent runner ─────────────────────────────────────────

export function runAgent(cfg: DirectConfig, prompt: string, continueConvo: boolean): Promise<DirectAgentRun> {
  return new Promise((resolve, reject) => {
    log(`Running ${cfg.agent} (continue=${continueConvo})`);
    lastUsageSignature = "";
    let rateLimitSignal: RateLimitSignal | null = null;

    let cmd: string;
    let spawnArgs: string[];
    let stdinData: string | null = null;

    if (cfg.agent === "claude-code") {
      cmd = "claude";
      spawnArgs = ["--print", "--dangerously-skip-permissions", "--output-format", "stream-json", "--verbose"];
      if (cfg.model) spawnArgs.push("--model", cfg.model);
      if (continueConvo) spawnArgs.push("--continue");
      stdinData = prompt;
    } else if (cfg.agent === "codex") {
      cmd = "codex";
      const fullPrompt = continueConvo
        ? `This is a continuation of previous work. Review what was done so far in the workspace and continue.\n\n${prompt}`
        : prompt;
      spawnArgs = [
        "exec",
        "--dangerously-bypass-approvals-and-sandbox",
        ...CODEX_REASONING_EFFORT_CONFIG_ARGS,
        "-C",
        cfg.workDir,
      ];
      if (cfg.model) spawnArgs.push("--model", cfg.model);
      spawnArgs.push(fullPrompt);
    } else {
      reject(new Error(`Unsupported direct runtime agent: ${cfg.agent}`));
      return;
    }

    const child = nodeSpawn(cmd, spawnArgs, {
      cwd: cfg.workDir,
      env: {
        ...mergeProjectSecretsBelowRunnerEnv(
          { ...process.env, ...readRefreshedAuthEnv(cfg.authCacheFile) },
          readRuntimeSecretsEnv(cfg.secretsFile),
        ),
        CI: "true",
      },
      stdio: ["pipe", "pipe", "pipe"],
    });

    let output = "";
    const isStreamJson = cfg.agent === "claude-code";
    const observeRateLimit = (text: string): void => {
      if (rateLimitSignal) return;
      rateLimitSignal = detectRateLimitSignal(text);
    };

    if (isStreamJson) {
      let buffer = "";
      child.stdout?.on("data", (data: Buffer) => {
        const text = data.toString();
        output += text;
        buffer += text;
        observeRateLimit(text);

        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const msg = JSON.parse(line);
            printStreamJson(msg);
          } catch {
            process.stdout.write(line + "\n");
          }
        }
      });
    } else {
      child.stdout?.on("data", (data: Buffer) => {
        const text = data.toString();
        output += text;
        observeRateLimit(text);
        process.stdout.write(text);
      });
    }

    child.stderr?.on("data", (data: Buffer) => {
      const text = data.toString();
      output += text;
      observeRateLimit(text);
      process.stderr.write(text);
    });

    if (stdinData) {
      child.stdin?.write(stdinData);
    }
    child.stdin?.end();

    // 30min timeout per iteration
    const timeout = setTimeout(() => {
      log("Agent timeout (30min), killing...");
      child.kill("SIGTERM");
    }, 30 * 60 * 1000);

    child.on("exit", () => {
      clearTimeout(timeout);
      resolve({ output, rateLimitSignal });
    });

    child.on("error", (err) => {
      clearTimeout(timeout);
      log(`Agent spawn error: ${err.message}`);
      observeRateLimit(err.message);
      resolve({ output, rateLimitSignal });
    });
  });
}

// ── Git ──────────────────────────────────────────────────

export function gitCommitAndPush(cfg: DirectConfig, message: string): void {
  try {
    execSync("git add -A", { cwd: cfg.workDir, stdio: "pipe" });
    execSync(`git commit -m "${message}" --allow-empty`, { cwd: cfg.workDir, stdio: "pipe" });
    execSync(`git push origin ${cfg.pushBranch}`, { cwd: cfg.workDir, stdio: "pipe", timeout: 60_000 });
  } catch {
    log("Git commit/push failed (non-fatal)");
  }
}

// ── Deploy ───────────────────────────────────────────────

// RA-247: Strict preview contract — only arena-start.sh
export function deployApp(cfg: DirectConfig): void {
  log("Deploying app...");
  const startSh = join(cfg.workDir, "arena-start.sh");
  if (!existsSync(startSh)) {
    log("No arena-start.sh — skipping deploy");
    return;
  }

  try {
    execSync("fuser -k 3000/tcp 2>/dev/null || true", { cwd: cfg.workDir, stdio: "pipe" });
  } catch {
    // Ignore
  }

  try {
    execSync(`chmod +x ${startSh} && setsid ${startSh} </dev/null >/tmp/app.log 2>&1 &`, {
      cwd: cfg.workDir,
      stdio: "pipe",
      env: { ...scrubRunnerAuthEnv(process.env), ...readRuntimeSecretsEnv(cfg.secretsFile), PORT: "3000" },
      shell: "/bin/bash",
    });

    execSync("sleep 3", { stdio: "pipe" });
    try {
      execSync("curl -sf http://localhost:3000/health", { stdio: "pipe", timeout: 5000 });
      log("App deployed on :3000 (health OK)");
    } catch {
      log("App started (health check unavailable)");
    }
  } catch (err) {
    log(`App deployment failed: ${err}`);
  }
}

// ── Completion detection ─────────────────────────────────
// RA-247: Check .arena/result.json existence

export function checkCompletion(cfg: DirectConfig): boolean {
  return existsSync(cfg.resultFile);
}
