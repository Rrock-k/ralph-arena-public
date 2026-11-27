/**
 * TokenManager — централизованное управление auth-токенами.
 *
 * Архитектура:
 * - Read-on-demand с TTL кэшем (без watchers, без sync exec)
 * - Читает из .env.local файлов (монтируются с хоста)
 * - refresh-tokens.sh вызывается ASYNC, не блокирует request path
 * - Единственный source of truth для auth в governance
 *
 * Consumers: buildRunAuthEnv(), status endpoint, /api/internal/tokens/:provider
 *
 * Документация: docs/token-manager.md
 */

import { readFileSync } from "fs";
import { resolve } from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { createHash } from "crypto";
import { interpretRefreshTokensScriptOutput } from "@arena/contracts";

const execFileAsync = promisify(execFile);

// ── Types ────────────────────────────────────────────────

export type Provider = "claude-api" | "claude-sub" | "openai-api" | "openai-sub" | "opencode-api" | "github";

export type TokenHealth = "missing" | "fresh" | "stale" | "old";

interface TokenEntry {
  values: Record<string, string>;
  hash: string; // SHA-256 of values for change detection
  updatedAt: number;
}

// ── Config ───────────────────────────────────────────────

/** Don't re-read files more often than this */
const READ_TTL_MS = 5_000;

/** Don't call refresh-tokens.sh more often than this */
const REFRESH_COOLDOWN_MS = 30_000;

/** refresh-tokens.sh may need time to wake Claude CLI and Keychain */
const REFRESH_SCRIPT_TIMEOUT_MS = 60_000;
const REFRESH_REQUEST_TIMEOUT_MS = REFRESH_SCRIPT_TIMEOUT_MS + 5_000;

/** Which env vars belong to which provider */
const PROVIDER_KEYS: Record<Provider, string[]> = {
  "claude-api": ["ANTHROPIC_API_KEY"],
  "claude-sub": ["CLAUDE_CODE_OAUTH_TOKEN", "CLAUDE_CODE_OAUTH_REFRESH_TOKEN"],
  "openai-api": ["OPENAI_API_KEY"],
  "openai-sub": ["CODEX_AUTH_JSON"],
  "opencode-api": ["OPENCODE_API_KEY"],
  github: ["GITHUB_TOKEN"],
};

// ── Singleton ────────────────────────────────────────────

let instance: TokenManager | null = null;

export function getTokenManager(): TokenManager {
  if (!instance) {
    instance = new TokenManager();
  }
  return instance;
}

// ── TokenManager ─────────────────────────────────────────

class TokenManager {
  private store = new Map<Provider, TokenEntry>();
  private lastReadMs = 0;
  private lastRefreshMs = 0;
  private refreshInFlight = false;
  private envFilePaths: string[];

  constructor() {
    this.envFilePaths = [
      resolve(process.cwd(), "../../.env"),
      resolve(process.cwd(), "../../.env.local"),
      resolve(process.cwd(), ".env"),
      resolve(process.cwd(), ".env.local"),
    ];
    // Sync initial load (only once, at startup)
    this.loadFromFiles();
  }

  /**
   * Get current tokens for a provider.
   * Re-reads files if TTL expired.
   */
  getTokens(provider: Provider): Record<string, string> {
    this.readIfStale();
    const entry = this.store.get(provider);
    return entry ? { ...entry.values } : {};
  }

  /**
   * Get all tokens across all providers.
   * Used by buildRunAuthEnv().
   */
  getAllTokens(): Record<string, string> {
    this.readIfStale();
    const result: Record<string, string> = {};
    for (const provider of Object.keys(PROVIDER_KEYS) as Provider[]) {
      const entry = this.store.get(provider);
      if (entry) Object.assign(result, entry.values);
    }
    return result;
  }

  /**
   * Get token metadata for a provider.
   */
  getTokenMeta(provider: Provider): {
    updatedAt: number;
    hasToken: boolean;
    hash: string;
  } {
    this.readIfStale();
    const entry = this.store.get(provider);
    return {
      updatedAt: entry?.updatedAt ?? 0,
      hasToken: !!entry && Object.keys(entry.values).length > 0,
      hash: entry?.hash ?? "",
    };
  }

  /**
   * Snapshot of token freshness across all providers.
   */
  getStatus(): {
    providers: Record<Provider, {
      updatedAt: number;
      hasToken: boolean;
      hash: string;
      ageMs: number | null;
      freshness: TokenHealth;
    }>;
    lastReadAt: number;
    lastRefreshAt: number;
    refreshInFlight: boolean;
    envFilePaths: string[];
  } {
    this.readIfStale();
    const now = Date.now();

    const providers = Object.fromEntries(
      (Object.keys(PROVIDER_KEYS) as Provider[]).map((provider) => {
        const meta = this.getTokenMeta(provider);
        const ageMs = meta.updatedAt > 0 ? now - meta.updatedAt : null;
        return [provider, {
          ...meta,
          ageMs,
          freshness: classifyTokenHealth(meta.hasToken, ageMs),
        }];
      }),
    ) as Record<Provider, {
      updatedAt: number;
      hasToken: boolean;
      hash: string;
      ageMs: number | null;
      freshness: TokenHealth;
    }>;

    return {
      providers,
      lastReadAt: this.lastReadMs,
      lastRefreshAt: this.lastRefreshMs,
      refreshInFlight: this.refreshInFlight,
      envFilePaths: [...this.envFilePaths],
    };
  }

  /**
   * Trigger async refresh if cooldown passed.
   * Non-blocking — fires refresh-tokens.sh in background.
   * Returns immediately.
   */
  triggerRefreshAsync(): void {
    const now = Date.now();
    if (now - this.lastRefreshMs < REFRESH_COOLDOWN_MS) return;
    if (this.refreshInFlight) return;

    this.lastRefreshMs = now;
    this.refreshInFlight = true;

    const script = resolve(process.cwd(), "../../scripts/refresh-tokens.sh");
    execFile(script, [], { timeout: REFRESH_SCRIPT_TIMEOUT_MS, encoding: "utf8" }, (err, stdout, stderr) => {
      this.refreshInFlight = false;
      if (err) {
        // Non-fatal: script may not exist on VPS
        console.warn(
          "[token-manager] refresh-tokens.sh failed (non-fatal):",
          (err as Error).message?.slice(0, 120)
        );
      } else {
        const outcome = interpretRefreshTokensScriptOutput(`${stdout || ""}\n${stderr || ""}`);
        if (outcome.ok) {
          console.log("[token-manager] refresh-tokens.sh succeeded");
          // Force re-read on next access
          this.lastReadMs = 0;
        } else {
          console.warn("[token-manager] refresh-tokens.sh returned:", outcome.reason);
        }
      }
    });
  }

  /**
   * RA-203: Blocking refresh — asks worker-agent (on host) to run refresh-tokens.sh.
   * Governance runs in Docker without Keychain access, so it delegates to worker-agent.
   * Falls back to local script if WORKER_AGENT_URL is not set.
   */
  async triggerRefreshSync(opts?: { force?: boolean }): Promise<boolean> {
    const now = Date.now();
    if (!opts?.force && now - this.lastRefreshMs < REFRESH_COOLDOWN_MS) return false;

    this.lastRefreshMs = now;

    // Primary: ask worker-agent (runs on host, has Keychain)
    const workerUrl = process.env.WORKER_AGENT_URL || process.env.WORKER_URL;
    if (workerUrl) {
      try {
        const secret = process.env.WORKER_SECRET || process.env.RUNNER_WEBHOOK_SECRET || "";
        const res = await fetch(`${workerUrl}/refresh-tokens`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(secret ? { "x-worker-secret": secret } : {}),
          },
          signal: AbortSignal.timeout(REFRESH_REQUEST_TIMEOUT_MS),
        });
        const body = await res.json().catch(() => ({})) as Record<string, unknown>;
        if (body.ok) {
          console.log("[token-manager] sync refresh via worker-agent succeeded");
          this.loadFromFiles();
          return true;
        }
        console.warn("[token-manager] worker-agent refresh returned:", body.reason || "unknown");
      } catch (err) {
        console.warn("[token-manager] worker-agent refresh failed:", (err as Error).message?.slice(0, 120));
      }
    }

    // Fallback: local script (works on macOS host, no-op in Docker)
    const script = resolve(process.cwd(), "../../scripts/refresh-tokens.sh");
    try {
      const { stdout, stderr } = await execFileAsync(script, [], {
        timeout: REFRESH_SCRIPT_TIMEOUT_MS,
        encoding: "utf8",
      });
      const outcome = interpretRefreshTokensScriptOutput(`${stdout || ""}\n${stderr || ""}`);
      if (outcome.ok) {
        console.log("[token-manager] sync refresh (local) succeeded");
        this.loadFromFiles();
        return true;
      }
      console.warn("[token-manager] sync refresh (local) returned:", outcome.reason);
      return false;
    } catch (err) {
      console.warn("[token-manager] sync refresh (local) failed (non-fatal):", (err as Error).message?.slice(0, 120));
      return false;
    }
  }

  /**
   * Synchronous force reload from files.
   * Use sparingly (e.g., POST /api/internal/tokens/:provider).
   */
  forceReload(): void {
    this.loadFromFiles();
  }

  // ── Private ──────────────────────────────────────────

  private readIfStale(): void {
    const now = Date.now();
    if (now - this.lastReadMs < READ_TTL_MS) return;
    this.loadFromFiles();
  }

  private loadFromFiles(): void {
    this.lastReadMs = Date.now();
    const allVars = new Map<string, string>();

    for (const filePath of this.envFilePaths) {
      try {
        const content = readFileSync(filePath, "utf-8");
        for (const line of content.split("\n")) {
          const eqIdx = line.indexOf("=");
          if (eqIdx === -1 || line.startsWith("#")) continue;
          const key = line.slice(0, eqIdx).trim();
          const value = line.slice(eqIdx + 1).trim();
          if (key && value) allVars.set(key, value);
        }
      } catch {
        continue;
      }
    }

    // Fallback to process.env
    for (const keys of Object.values(PROVIDER_KEYS)) {
      for (const key of keys) {
        if (!allVars.has(key) && process.env[key]) {
          allVars.set(key, process.env[key]!);
        }
      }
    }

    // Update store per provider
    const now = Date.now();
    for (const [provider, keys] of Object.entries(PROVIDER_KEYS)) {
      const values: Record<string, string> = {};
      for (const key of keys) {
        const val = allVars.get(key);
        if (val) values[key] = val;
      }

      const newHash = createHash("sha256")
        .update(JSON.stringify(values))
        .digest("hex")
        .slice(0, 16);

      const existing = this.store.get(provider as Provider);
      if (!existing || existing.hash !== newHash) {
        this.store.set(provider as Provider, {
          values,
          hash: newHash,
          updatedAt: now,
        });
        if (existing) {
          console.log(`[token-manager] ${provider} tokens updated`);
        }
      }
    }
  }
}

function classifyTokenHealth(hasToken: boolean, ageMs: number | null): TokenHealth {
  if (!hasToken) return "missing";
  if (ageMs === null) return "fresh";
  if (ageMs <= 10 * 60 * 1000) return "fresh";
  if (ageMs <= 60 * 60 * 1000) return "stale";
  return "old";
}
