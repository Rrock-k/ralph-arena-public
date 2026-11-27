/**
 * Runner auth management.
 *
 * - Applies auth from governance status poll → writes auth.json
 * - Detects token changes (SHA-256 hash comparison)
 * - Checks if current token is alive (HTTP probe to provider API)
 * - Reads fresh auth from auth.json for child respawn
 *
 * Docs: docs/token-manager.md
 */

import { mkdirSync, writeFileSync, readFileSync, rmSync } from "fs";
import { createHash } from "crypto";
import { spawnSync } from "child_process";
import { buildAnthropicAuthHeaders } from "@arena/contracts";

const WORKSPACE = process.env.ARENA_WORKSPACE_DIR || "/workspace";
const ARENA_DIR = `${WORKSPACE}/.arena`;
const AUTH_JSON_PATH = `${ARENA_DIR}/auth.json`;

const AUTH_KEYS = [
  "CLAUDE_CODE_OAUTH_TOKEN",
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_BASE_URL",
  "ANTHROPIC_API_URL",
  "CODEX_AUTH_JSON",
  "OPENAI_API_KEY",
  "OPENAI_BASE_URL",
  "OPENAI_API_BASE",
  "OPENCODE_API_KEY",
  // Scrub-only reservation. AGY stores auth in an OS keyring; a JSON env
  // materialization is unsupported until authd owns a real keyring bridge.
  "ANTIGRAVITY_AUTH_JSON",
] as const;

const SCRUB_AUTH_KEYS = [
  ...AUTH_KEYS,
  "CLAUDE_CODE_OAUTH_REFRESH_TOKEN",
] as const;

const RESERVED_AGENT_PROJECT_SECRET_KEYS = [
  ...SCRUB_AUTH_KEYS,
  "ANTHROPIC_AUTH_TOKEN",
] as const;

const OPENAI_PROXY_AUTH_SENTINEL = "arena-proxy";

export function scrubRunnerAuthEnv(
  env: Record<string, string | undefined>,
): Record<string, string> {
  const sanitized: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) continue;
    if ((SCRUB_AUTH_KEYS as readonly string[]).includes(key)) continue;
    sanitized[key] = value;
  }
  return sanitized;
}

export function mergeProjectSecretsBelowRunnerEnv(
  runnerEnv: Record<string, string | undefined>,
  projectSecrets: Record<string, string>,
): Record<string, string> {
  const sanitizedProjectSecrets: Record<string, string> = {};
  for (const [key, value] of Object.entries(projectSecrets)) {
    const normalizedKey = key.trim().toUpperCase();
    if (
      (RESERVED_AGENT_PROJECT_SECRET_KEYS as readonly string[]).includes(normalizedKey)
    ) {
      continue;
    }
    sanitizedProjectSecrets[key] = value;
  }
  const sanitizedRunnerEnv: Record<string, string> = {};
  for (const [key, value] of Object.entries(runnerEnv)) {
    if (value === undefined) continue;
    sanitizedRunnerEnv[key] = value;
  }
  return {
    ...sanitizedProjectSecrets,
    ...sanitizedRunnerEnv,
  };
}

let lastAuthHash = "";

function openAiBaseUrl(auth: Record<string, string | undefined>): string | null {
  return auth.OPENAI_BASE_URL?.trim() || auth.OPENAI_API_BASE?.trim() || null;
}

function anthropicBaseUrl(auth: Record<string, string | undefined>): string | null {
  return auth.ANTHROPIC_BASE_URL?.trim() || auth.ANTHROPIC_API_URL?.trim() || null;
}

function isCodexProxyAuth(auth: Record<string, string | undefined>): boolean {
  return auth.OPENAI_API_KEY === OPENAI_PROXY_AUTH_SENTINEL && !!openAiBaseUrl(auth);
}

function removeCodexAuthJson(): void {
  const homeDir = process.env.HOME || "/home/node";
  try {
    rmSync(`${homeDir}/.codex/auth.json`, { force: true });
  } catch {
    // ignore cleanup failures
  }
}

function syncCodexApiKeyLogin(auth: Record<string, string>): void {
  const apiKey = auth.OPENAI_API_KEY;
  if (!apiKey || auth.CODEX_AUTH_JSON) return;
  if (isCodexProxyAuth(auth)) {
    removeCodexAuthJson();
    return;
  }

  try {
    const result = spawnSync("codex", ["login", "--with-api-key"], {
      input: `${apiKey}\n`,
      encoding: "utf8",
      env: {
        ...process.env,
        OPENAI_API_KEY: apiKey,
        ...(auth.OPENAI_BASE_URL ? { OPENAI_BASE_URL: auth.OPENAI_BASE_URL } : {}),
        ...(auth.OPENAI_API_BASE ? { OPENAI_API_BASE: auth.OPENAI_API_BASE } : {}),
      },
      stdio: ["pipe", "pipe", "pipe"],
    });

    if (result.status === 0) return;

    const detail = `${result.stderr || result.stdout || ""}`.trim().split("\n").at(-1) || `exit ${result.status ?? "unknown"}`;
    console.warn(`[auth] codex login --with-api-key failed: ${detail}`);
  } catch (error) {
    console.warn(
      "[auth] codex login --with-api-key threw:",
      error instanceof Error ? error.message : String(error),
    );
  }
}

export interface RunnerAuthSnapshot {
  auth: Record<string, string>;
  version?: string;
}

function hashAuth(auth: Record<string, string>): string {
  const entries = Object.entries(auth)
    .filter(([, value]) => typeof value === "string" && value.length > 0)
    .sort(([left], [right]) => left.localeCompare(right));
  return createHash("sha256")
    .update(JSON.stringify(entries))
    .digest("hex")
    .slice(0, 16);
}

function collectInitialAuth(): Record<string, string> {
  const auth: Record<string, string> = {};
  for (const key of AUTH_KEYS) {
    const value = process.env[key];
    if (value) auth[key] = value;
  }
  return auth;
}

function filterRunAuth(auth: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(auth).filter(([key, value]) => (
      (AUTH_KEYS as readonly string[]).includes(key) && typeof value === "string" && value.length > 0
    )),
  );
}

/**
 * Apply auth from status poll (or initial env).
 * Writes auth.json for child processes.
 * Returns true if token changed since last call.
 */
export function applyRunnerAuth(auth?: Record<string, string>, version?: string): boolean {
  const nextAuth = filterRunAuth(auth === undefined ? collectInitialAuth() : auth);
  if (!Object.keys(nextAuth).length) {
    const hadAuth = Boolean(lastAuthHash) || SCRUB_AUTH_KEYS.some((key) => Boolean(process.env[key]));
    for (const key of SCRUB_AUTH_KEYS) {
      delete process.env[key];
    }
    removeCodexAuthJson();
    rmSync(AUTH_JSON_PATH, { force: true });
    lastAuthHash = "";
    return hadAuth;
  }
  const effectiveVersion = version?.trim() || hashAuth(nextAuth);
  const authChanged = !lastAuthHash || effectiveVersion !== lastAuthHash;

  mkdirSync(ARENA_DIR, { recursive: true });

  // Write auth.json (JSON format — handles multiline values like CODEX_AUTH_JSON)
  writeFileSync(AUTH_JSON_PATH, JSON.stringify({ version: effectiveVersion, auth: nextAuth }, null, 2), {
    mode: 0o600,
  });

  // Update process.env
  for (const key of SCRUB_AUTH_KEYS) {
    if (!(key in nextAuth)) {
      delete process.env[key];
    }
  }
  for (const [key, value] of Object.entries(nextAuth)) {
    process.env[key] = value;
  }

  // Write codex auth.json if present
  if (nextAuth.CODEX_AUTH_JSON) {
    const homeDir = process.env.HOME || "/home/node";
    const codexDir = `${homeDir}/.codex`;
    mkdirSync(codexDir, { recursive: true });
    writeFileSync(`${codexDir}/auth.json`, nextAuth.CODEX_AUTH_JSON, {
      mode: 0o600,
    });
  } else if (!nextAuth.OPENAI_API_KEY) {
    removeCodexAuthJson();
  }

  if (authChanged) {
    syncCodexApiKeyLogin(nextAuth);
  }

  // Detect change
  if (lastAuthHash && effectiveVersion !== lastAuthHash) {
    console.log("[auth] Token updated (hash changed)");
    lastAuthHash = effectiveVersion;
    return true;
  }
  lastAuthHash = effectiveVersion;
  return false;
}

export function readAuthSnapshot(): RunnerAuthSnapshot {
  try {
    const content = readFileSync(AUTH_JSON_PATH, "utf-8");
    const parsed = JSON.parse(content) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const candidate = parsed as Record<string, unknown>;
      if (candidate.auth && typeof candidate.auth === "object" && !Array.isArray(candidate.auth)) {
        const auth = filterRunAuth(Object.fromEntries(
          Object.entries(candidate.auth as Record<string, unknown>).flatMap(([key, value]) => (
            typeof value === "string" && value.length > 0 ? [[key, value]] : []
          )),
        ));
        return {
          auth,
          version: typeof candidate.version === "string" && candidate.version.length > 0
            ? candidate.version
            : hashAuth(auth),
        };
      }

      const auth = filterRunAuth(Object.fromEntries(
        Object.entries(candidate).flatMap(([key, value]) => (
          typeof value === "string" && value.length > 0 ? [[key, value]] : []
        )),
      ));
      return {
        auth,
        version: Object.keys(auth).length > 0 ? hashAuth(auth) : undefined,
      };
    }
  } catch {
    // ignore
  }

  return { auth: {} };
}

export function getCurrentAuthVersion(): string | undefined {
  return readAuthSnapshot().version;
}

export function clearRunnerAuth(): void {
  for (const key of SCRUB_AUTH_KEYS) {
    delete process.env[key];
  }
  lastAuthHash = "";

  try {
    rmSync(AUTH_JSON_PATH, { force: true });
  } catch {
    // ignore cleanup failures
  }

  const homeDir = process.env.HOME || "/home/node";
  try {
    rmSync(`${homeDir}/.codex/auth.json`, { force: true });
  } catch {
    // ignore cleanup failures
  }
}

/**
 * Read current auth from auth.json.
 * Used when respawning child after auth error.
 */
export function readAuthEnv(): Record<string, string> {
  return readAuthSnapshot().auth;
}

export function hasRelevantAuth(agent: string, auth: Record<string, string>): boolean {
  if (agent === "codex") {
    return !!(auth.CODEX_AUTH_JSON || auth.OPENAI_API_KEY);
  }
  if (agent === "antigravity") {
    return false;
  }
  if (agent === "opencode") {
    // OpenCode Zen free models are a credentialless CLI path. A provided
    // OPENCODE_API_KEY is still useful, but it is not required auth truth.
    return true;
  }

  return !!(auth.CLAUDE_CODE_OAUTH_TOKEN || auth.ANTHROPIC_API_KEY);
}

/**
 * Check if current token is valid by probing the provider API.
 * Returns true if token works (not 401/403).
 * Non-blocking with 5s timeout.
 */
export async function isTokenAlive(agent: string): Promise<boolean> {
  try {
    if (agent === "antigravity") {
      // Antigravity's CLI auth contract is a native Google session. Until
      // authd can mint and materialize that session for AGY, Antigravity auth
      // must stay blocked instead of reusing Claude/OpenAI probes.
      return false;
    }

    if (agent === "opencode") {
      const key = process.env.OPENCODE_API_KEY;
      const res = await fetch("https://opencode.ai/zen/v1/models", {
        method: "GET",
        headers: key ? { Authorization: `Bearer ${key}` } : {},
        signal: AbortSignal.timeout(5_000),
      });
      return res.status !== 401 && res.status !== 403;
    }

    if (agent === "codex") {
      const authJson = process.env.CODEX_AUTH_JSON;
      if (authJson) {
        try {
          const parsed = JSON.parse(authJson) as {
            accessToken?: string;
            accountId?: string;
            tokens?: { access_token?: string; account_id?: string };
          };
          const accessToken = parsed.accessToken || parsed.tokens?.access_token;
          if (accessToken) {
            const headers: Record<string, string> = {
              Authorization: `Bearer ${accessToken}`,
            };
            const accountId = parsed.accountId || parsed.tokens?.account_id;
            if (accountId) {
              headers["ChatGPT-Account-Id"] = accountId;
            }

            const res = await fetch("https://chatgpt.com/backend-api/wham/usage", {
              method: "GET",
              headers,
              signal: AbortSignal.timeout(5_000),
            });
            return res.status !== 401 && res.status !== 403;
          }
        } catch {
          return false;
        }
      }

      const key = process.env.OPENAI_API_KEY;
      if (!key) return false;
      const baseUrl = openAiBaseUrl(process.env) ?? "https://api.openai.com/v1";
      const normalizedBaseUrl = baseUrl.replace(/\/$/, "");
      const modelsUrl = normalizedBaseUrl === "https://api.openai.com"
        ? "https://api.openai.com/v1/models"
        : `${normalizedBaseUrl}/models`;
      const res = await fetch(modelsUrl, {
        method: "GET",
        headers: { Authorization: `Bearer ${key}` },
        signal: AbortSignal.timeout(5_000),
      });
      return res.status !== 401 && res.status !== 403;
    }

    // Claude Code OAuth is a CLI-owned first-party session, not an Anthropic
    // API key. The public API-key probe can return 401 for a usable CLI token.
    if (process.env.CLAUDE_CODE_OAUTH_TOKEN) return true;

    // Default: Anthropic API key
    const token = process.env.ANTHROPIC_API_KEY;
    if (!token) return false;

    const baseUrl = anthropicBaseUrl(process.env) ?? "https://api.anthropic.com";
    const normalizedBaseUrl = baseUrl.replace(/\/$/, "");
    const modelsUrl = normalizedBaseUrl.endsWith("/v1")
      ? `${normalizedBaseUrl}/models`
      : `${normalizedBaseUrl}/v1/models`;
    const res = await fetch(modelsUrl, {
      method: "GET",
      headers: buildAnthropicAuthHeaders(token),
      signal: AbortSignal.timeout(5_000),
    });
    return res.status !== 401 && res.status !== 403;
  } catch {
    // Network error — not an auth issue
    return true;
  }
}
