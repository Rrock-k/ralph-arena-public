import { existsSync, readFileSync } from "fs";
import { execFile, spawn } from "child_process";
import { promisify } from "util";
import path from "path";
import { hashPayload } from "../hash.js";
import { buildProviderPostMortem, mapClaudeQuotaResponse } from "../quota.js";
import type {
  AuthProvider,
  MintedProviderAuth,
  ProviderHealth,
  ProviderPostMortem,
  ProviderPostMortemInput,
  ProviderQuotaResult,
  ProviderStatus,
} from "../types.js";

const execFileAsync = promisify(execFile);

interface ClaudeProviderOptions {
  credentialsPath: string;
  fetchImpl?: typeof fetch;
  probeTimeoutMs?: number;
  source?: string;
  refreshCommand?: string;
}

interface ClaudeOAuthState {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: string | null;
  scopes: string[];
  subscriptionType: string | null;
  rateLimitTier: string | null;
}

interface ParsedClaudeCredentials {
  state: ClaudeOAuthState | null;
  rawCredentials: string | null;
  detail: string | null;
}

function buildClaudeOAuthUsageHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    "anthropic-beta": "oauth-2025-04-20",
  };
}

export function parseClaudeCredentials(rawCredentials: string): ParsedClaudeCredentials {
  if (typeof rawCredentials !== "string" || rawCredentials.trim().length === 0) {
    return {
      state: null,
      rawCredentials: null,
      detail: "Claude credentials file is empty.",
    };
  }

  let parsed: any;
  try {
    parsed = JSON.parse(rawCredentials);
  } catch {
    return {
      state: null,
      rawCredentials: rawCredentials.trim(),
      detail: "Claude credentials file is not valid JSON.",
    };
  }

  const oauth = parsed?.claudeAiOauth;
  if (!oauth || typeof oauth !== "object" || Array.isArray(oauth)) {
    return {
      state: null,
      rawCredentials: rawCredentials.trim(),
      detail: "Claude credentials file is missing claudeAiOauth.",
    };
  }

  const accessToken = typeof oauth.accessToken === "string" ? oauth.accessToken.trim() : "";
  if (!accessToken) {
    return {
      state: null,
      rawCredentials: rawCredentials.trim(),
      detail: "Claude credentials file is missing claudeAiOauth.accessToken.",
    };
  }

  const refreshToken = typeof oauth.refreshToken === "string" && oauth.refreshToken.trim().length > 0
    ? oauth.refreshToken.trim()
    : null;
  const expiresAt = typeof oauth.expiresAt === "string" && oauth.expiresAt.trim().length > 0
    ? oauth.expiresAt.trim()
    : null;
  const scopes = Array.isArray(oauth.scopes) ? oauth.scopes.filter((value: unknown): value is string => typeof value === "string") : [];
  const subscriptionType = typeof oauth.subscriptionType === "string" && oauth.subscriptionType.trim().length > 0
    ? oauth.subscriptionType.trim()
    : null;
  const rateLimitTier = typeof oauth.rateLimitTier === "string" && oauth.rateLimitTier.trim().length > 0
    ? oauth.rateLimitTier.trim()
    : null;

  return {
    state: {
      accessToken,
      refreshToken,
      expiresAt,
      scopes,
      subscriptionType,
      rateLimitTier,
    },
    rawCredentials: rawCredentials.trim(),
    detail: null,
  };
}

export class ClaudeOAuthProvider implements AuthProvider {
  readonly id = "claude" as const;

  private readonly credentialsPath: string;
  private readonly fetchImpl: typeof fetch;
  private readonly probeTimeoutMs: number;
  private readonly source: string;
  private readonly refreshCommand?: string;

  constructor(options: ClaudeProviderOptions) {
    this.credentialsPath = options.credentialsPath;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.probeTimeoutMs = options.probeTimeoutMs ?? 5_000;
    this.source = options.source ?? "claude-oauth-credentials";
    this.refreshCommand = options.refreshCommand;
  }

  async health(): Promise<ProviderHealth> {
    return this.evaluate().then((result) => result.health);
  }

  async mintRunAuth(): Promise<MintedProviderAuth> {
    const result = await this.evaluate();
    if (!result.state?.accessToken) {
      return { auth: {}, health: result.health };
    }

    if (result.health.status === "invalid") {
      return { auth: {}, health: result.health };
    }

    return {
      auth: {
        CLAUDE_CODE_OAUTH_TOKEN: result.state.accessToken,
      },
      health: result.health,
    };
  }

  async refresh(): Promise<ProviderHealth> {
    try {
      if (this.refreshCommand) {
        await execFileAsync("sh", ["-lc", this.refreshCommand], {
          timeout: Math.max(this.probeTimeoutMs, 20_000),
        });
      } else {
        await runClaudeRefresh({
          timeoutMs: Math.max(this.probeTimeoutMs, 20_000),
          homeDir: process.env.HOME || path.dirname(path.dirname(this.credentialsPath)),
        });
      }
    } catch (error) {
      const health = await this.health();
      if (health.status === "ready" || health.status === "unknown") {
        const message = error instanceof Error ? error.message : String(error);
        return {
          ...health,
          detail: message ? `Refresh command failed; using existing Claude OAuth snapshot. ${message}` : health.detail,
        };
      }
      throw error;
    }

    return this.health();
  }

  async quota(): Promise<ProviderQuotaResult> {
    const result = await this.evaluate();
    if (!result.state?.accessToken || result.health.status === "invalid") {
      return {
        provider: "anthropic",
        source: "anthropic-oauth",
        ok: false,
        error: result.health.detail ?? `Claude auth health is ${result.health.status}.`,
        windows: [],
      };
    }

    try {
      const response = await this.fetchImpl("https://api.anthropic.com/api/oauth/usage", {
        headers: buildClaudeOAuthUsageHeaders(result.state.accessToken),
        signal: AbortSignal.timeout(this.probeTimeoutMs),
      });

      if (!response.ok) {
        const statusDetail = response.status === 429
          ? "Anthropic OAuth usage API returned 429; quota is currently limited."
          : `Anthropic OAuth usage API returned ${response.status}.`;
        return {
          provider: "anthropic",
          source: "anthropic-oauth",
          ok: false,
          error: statusDetail,
          windows: [],
        };
      }

      return {
        provider: "anthropic",
        source: "anthropic-oauth",
        ok: true,
        windows: mapClaudeQuotaResponse(await response.json()),
      };
    } catch (error) {
      return {
        provider: "anthropic",
        source: "anthropic-oauth",
        ok: false,
        error: error instanceof Error ? error.message : String(error),
        windows: [],
      };
    }
  }

  async postMortem(input?: ProviderPostMortemInput): Promise<ProviderPostMortem> {
    const [health, quota] = await Promise.all([this.health(), this.quota()]);
    return buildProviderPostMortem({
      provider: this.id,
      health,
      quota,
      postMortemInput: input,
    });
  }

  private async evaluate(): Promise<{ state: ClaudeOAuthState | null; health: ProviderHealth }> {
    const credentials = this.readCredentials();
    const checkedAt = new Date().toISOString();
    const version = credentials.rawCredentials ? hashPayload(credentials.rawCredentials) : null;

    if (!credentials.rawCredentials) {
      return {
        state: null,
        health: this.buildHealth("missing", version, checkedAt, "Claude credentials file is missing or empty."),
      };
    }

    if (!credentials.state) {
      return {
        state: null,
        health: this.buildHealth("invalid", version, checkedAt, credentials.detail),
      };
    }

    const probe = await this.probeToken(credentials.state.accessToken);
    return {
      state: credentials.state,
      health: this.buildHealth(probe.status, version, checkedAt, probe.detail),
    };
  }

  private readCredentials(): ParsedClaudeCredentials {
    if (!existsSync(this.credentialsPath)) {
      return {
        state: null,
        rawCredentials: null,
        detail: "Claude credentials file does not exist.",
      };
    }

    const rawCredentials = readFileSync(this.credentialsPath, "utf8").trim();
    return parseClaudeCredentials(rawCredentials);
  }

  private buildHealth(
    status: ProviderStatus,
    version: string | null,
    checkedAt: string,
    detail: string | null,
  ): ProviderHealth {
    return {
      provider: this.id,
      source: this.source,
      status,
      version,
      checkedAt,
      detail,
    };
  }

  private async probeToken(token: string): Promise<{ status: ProviderStatus; detail: string | null }> {
    try {
      const response = await this.fetchImpl("https://api.anthropic.com/api/oauth/usage", {
        method: "GET",
        headers: buildClaudeOAuthUsageHeaders(token),
        signal: AbortSignal.timeout(this.probeTimeoutMs),
      });

      if (response.status === 401 || response.status === 403) {
        return {
          status: "invalid",
          detail: `Anthropic OAuth usage API returned ${response.status}; Claude OAuth credentials are not usable.`,
        };
      }

      if (response.ok) {
        return { status: "ready", detail: null };
      }

      if (response.status === 429) {
        return {
          status: "ready",
          detail: "Anthropic OAuth usage API returned 429; Claude OAuth credentials are usable but quota is currently limited.",
        };
      }

      return {
        status: "unknown",
        detail: `Anthropic OAuth usage API returned ${response.status}.`,
      };
    } catch (error) {
      return {
        status: "unknown",
        detail: error instanceof Error ? error.message : String(error),
      };
    }
  }
}

async function runClaudeRefresh(options: { timeoutMs: number; homeDir: string }): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn("claude", ["-p", "Reply with OK.", "--output-format", "text"], {
      env: {
        ...process.env,
        HOME: options.homeDir,
      },
      stdio: "ignore",
    });

    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve();
    };

    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 2_000).unref();
      finish(new Error(`Claude refresh command timed out after ${options.timeoutMs}ms.`));
    }, options.timeoutMs);

    child.once("error", (error) => finish(error instanceof Error ? error : new Error(String(error))));
    child.once("exit", (code, signal) => {
      if (code === 0) {
        finish();
        return;
      }
      finish(new Error(`Claude refresh command exited with ${signal || code || "unknown"}.`));
    });
  });
}
