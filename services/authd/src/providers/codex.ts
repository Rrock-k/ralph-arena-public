import { existsSync, readFileSync, writeFileSync } from "fs";
import { mkdir, mkdtemp, rm, writeFile as writeFileAsync } from "fs/promises";
import { execFile, spawn } from "child_process";
import { promisify } from "util";
import os from "os";
import path from "path";
import { hashPayload } from "../hash.js";
import { buildProviderPostMortem, mapCodexRpcQuota } from "../quota.js";
import type {
  AuthProvider,
  MintedProviderAuth,
  ProviderHealth,
  ProviderPostMortem,
  ProviderPostMortemInput,
  ProviderQuotaResult,
  ProviderStatus,
  QuotaWindow,
} from "../types.js";
import type { CodexRpcRateLimitsResult } from "../quota.js";

const execFileAsync = promisify(execFile);

/**
 * Keep aligned with the first-party Codex CLI refresh endpoint.
 * See openai/codex codex-rs/login/src/auth/manager.rs.
 */
const OPENAI_TOKEN_ENDPOINT = "https://auth.openai.com/oauth/token";
const CODEX_MODELS_ENDPOINT = "https://chatgpt.com/backend-api/codex/models?client_version=0.144.4";

/**
 * Client ID extracted from Codex CLI's OAuth tokens (audience claim).
 * This is the public client used by `codex login --device-auth`.
 */
const CODEX_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";

interface CodexProviderOptions {
  authJsonPath: string;
  fetchImpl?: typeof fetch;
  probeTimeoutMs?: number;
  source?: string;
  refreshCommand?: string;
  quotaWindowsImpl?: (authJson: string) => Promise<QuotaWindow[]>;
}

export interface CodexAuthInfo {
  accessToken: string;
  idToken: string;
  accountId: string | null;
  refreshToken: string | null;
  lastRefresh: string | null;
  accessTokenExpiresAt: string | null;
  idTokenExpiresAt: string | null;
}

export function parseCodexAuthInfo(authJson: string): CodexAuthInfo | null {
  if (typeof authJson !== "string" || authJson.trim().length === 0) return null;

  let parsed: any;
  try {
    parsed = JSON.parse(authJson);
  } catch {
    return null;
  }

  const accessToken = parsed?.accessToken ?? parsed?.tokens?.access_token ?? null;
  const idToken = parsed?.idToken ?? parsed?.tokens?.id_token ?? null;
  const accountId = parsed?.accountId ?? parsed?.tokens?.account_id ?? null;
  const refreshToken = parsed?.refreshToken ?? parsed?.tokens?.refresh_token ?? null;
  const lastRefresh = parsed?.last_refresh ?? parsed?.lastRefresh ?? null;

  if (typeof accessToken !== "string" || accessToken.trim().length === 0) {
    return null;
  }
  if (typeof idToken !== "string" || idToken.trim().length === 0) {
    return null;
  }

  return {
    accessToken: accessToken.trim(),
    idToken: idToken.trim(),
    accountId: typeof accountId === "string" && accountId.trim().length > 0 ? accountId.trim() : null,
    refreshToken: typeof refreshToken === "string" && refreshToken.trim().length > 0 ? refreshToken.trim() : null,
    lastRefresh: typeof lastRefresh === "string" && lastRefresh.trim().length > 0 ? lastRefresh.trim() : null,
    accessTokenExpiresAt: parseJwtExpiresAt(accessToken.trim()),
    idTokenExpiresAt: parseJwtExpiresAt(idToken.trim()),
  };
}

export function buildCodexRunAuthJson(authJson: string): string | null {
  const auth = parseCodexAuthInfo(authJson);
  if (!auth) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(authJson);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;

  const runAuth = { ...(parsed as Record<string, unknown>) };
  delete runAuth.refreshToken;
  delete runAuth.refresh_token;

  if (runAuth.tokens && typeof runAuth.tokens === "object" && !Array.isArray(runAuth.tokens)) {
    const tokens = { ...(runAuth.tokens as Record<string, unknown>) };
    delete tokens.refreshToken;
    tokens.access_token = auth.accessToken;
    tokens.id_token = auth.idToken;
    tokens.refresh_token = "";
    if (auth.accountId) tokens.account_id = auth.accountId;
    runAuth.tokens = tokens;
  } else {
    runAuth.tokens = {
      access_token: auth.accessToken,
      id_token: auth.idToken,
      refresh_token: "",
      ...(auth.accountId ? { account_id: auth.accountId } : {}),
    };
  }

  return JSON.stringify(runAuth);
}

function buildCodexAccessHeaders(auth: CodexAuthInfo): Record<string, string> {
  return {
    Authorization: `Bearer ${auth.accessToken}`,
    ...(auth.accountId ? { "ChatGPT-Account-Id": auth.accountId } : {}),
  };
}

export function parseJwtExpiresAt(token: string): string | null {
  const parts = token.split(".");
  if (parts.length < 2 || !parts[1]) return null;

  try {
    const payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = payload.padEnd(Math.ceil(payload.length / 4) * 4, "=");
    const decoded = JSON.parse(Buffer.from(padded, "base64").toString("utf8"));
    const exp = decoded?.exp;
    if (!Number.isFinite(exp)) return null;
    return new Date(exp * 1000).toISOString();
  } catch {
    return null;
  }
}

export class CodexSubscriptionProvider implements AuthProvider {
  readonly id = "codex" as const;

  private readonly authJsonPath: string;
  private readonly fetchImpl: typeof fetch;
  private readonly probeTimeoutMs: number;
  private readonly source: string;
  private readonly refreshCommand?: string;
  private readonly quotaWindowsImpl: (authJson: string) => Promise<QuotaWindow[]>;
  private lastRefreshFailure: { status: ProviderStatus; detail: string; version: string | null } | null = null;

  constructor(options: CodexProviderOptions) {
    this.authJsonPath = options.authJsonPath;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.probeTimeoutMs = options.probeTimeoutMs ?? 5_000;
    this.source = options.source ?? "codex-auth-json";
    this.refreshCommand = options.refreshCommand;
    this.quotaWindowsImpl = options.quotaWindowsImpl ?? fetchCodexQuotaWindows;
  }

  async health(): Promise<ProviderHealth> {
    return this.evaluate().then((result) => result.health);
  }

  async mintRunAuth(): Promise<MintedProviderAuth> {
    const result = await this.evaluate();
    if (!result.authJson || result.health.status === "invalid") {
      return { auth: {}, health: result.health };
    }
    const runAuthJson = buildCodexRunAuthJson(result.authJson);
    if (!runAuthJson) {
      return { auth: {}, health: result.health };
    }

    return {
      auth: {
        CODEX_AUTH_JSON: runAuthJson,
      },
      health: result.health,
    };
  }

  async refresh(): Promise<ProviderHealth> {
    if (this.refreshCommand) {
      await execFileAsync("sh", ["-lc", this.refreshCommand], {
        timeout: this.probeTimeoutMs,
      });
      return this.health();
    }

    // OAuth2 refresh_token grant — rotate tokens via OpenAI token endpoint
    const authJson = this.readAuthJson();
    if (!authJson) return this.health();

    let parsed: any;
    try { parsed = JSON.parse(authJson); } catch { return this.health(); }

    const refreshToken = parsed?.tokens?.refresh_token;
    if (typeof refreshToken !== "string" || !refreshToken.trim()) {
      return this.health();
    }

    try {
      const response = await this.fetchImpl(OPENAI_TOKEN_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          grant_type: "refresh_token",
          client_id: CODEX_CLIENT_ID,
          refresh_token: refreshToken,
        }),
        signal: AbortSignal.timeout(15_000),
      });

      if (!response.ok) {
        await response.text().catch(() => "");
        console.warn(`[authd] Codex OAuth refresh failed: ${response.status}`);
        const local = await this.evaluate({ ignoreRefreshFailure: true });
        if (local.health.status === "ready") {
          const currentAuth = local.authJson ? parseCodexAuthInfo(local.authJson) : null;
          const currentAccessUsable = currentAuth ? await this.probeCurrentAccess(currentAuth) : false;
          if (!currentAccessUsable) {
            return this.evaluateWithOverride(
              "invalid",
              `Codex OAuth refresh failed with ${response.status}; current access token was rejected by Codex.`,
            );
          }

          this.lastRefreshFailure = null;
          return {
            ...local.health,
            detail: `Codex OAuth refresh failed with ${response.status}; using current access token until expiry.`,
            metadata: {
              ...local.health.metadata,
              refreshStatus: "failed_current_access_valid",
              refreshFailure: `Codex OAuth refresh failed with ${response.status}.`,
            },
          };
        }

        return this.evaluateWithOverride(
          response.status === 400 || response.status === 401 || response.status === 403 ? "invalid" : "unknown",
          `Codex OAuth refresh failed with ${response.status}.`,
        );
      }

      const result = await response.json() as {
        access_token?: string;
        refresh_token?: string;
        id_token?: string;
        expires_in?: number;
      };

      if (!result.access_token) {
        console.warn("[authd] Codex OAuth refresh returned no access_token");
        return this.evaluateWithOverride("invalid", "Codex OAuth refresh returned no access_token.");
      }

      // Update auth.json with new tokens
      const updated = { ...parsed };
      updated.tokens = {
        ...updated.tokens,
        access_token: result.access_token,
        ...(result.refresh_token ? { refresh_token: result.refresh_token } : {}),
        ...(result.id_token ? { id_token: result.id_token } : {}),
      };
      updated.last_refresh = new Date().toISOString();

      writeFileSync(this.authJsonPath, JSON.stringify(updated, null, 2) + "\n", "utf8");
      this.lastRefreshFailure = null;
      console.log("[authd] Codex tokens refreshed via OAuth2");
    } catch (error) {
      console.warn("[authd] Codex OAuth refresh error:", error instanceof Error ? error.message : String(error));
      return this.evaluateWithOverride(
        "unknown",
        error instanceof Error ? `Codex OAuth refresh error: ${error.message}` : "Codex OAuth refresh error.",
      );
    }

    return this.health();
  }

  async quota(): Promise<ProviderQuotaResult> {
    const result = await this.evaluate();
    if (!result.authJson || result.health.status === "invalid") {
      return {
        provider: "openai",
        source: "codex-rpc",
        ok: false,
        error: result.health.detail ?? `Codex auth health is ${result.health.status}.`,
        windows: [],
      };
    }

    try {
      return {
        provider: "openai",
        source: "codex-rpc",
        ok: true,
        windows: await this.quotaWindowsImpl(result.authJson),
      };
    } catch (error) {
      return {
        provider: "openai",
        source: "codex-rpc",
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

  private async evaluateWithOverride(status: ProviderStatus, detail: string): Promise<ProviderHealth> {
    const result = await this.evaluate();
    if (status === "invalid") {
      this.lastRefreshFailure = {
        status,
        detail,
        version: result.health.version,
      };
    }
    return {
      ...result.health,
      status,
      detail,
    };
  }

  private async evaluate(options?: { ignoreRefreshFailure?: boolean }): Promise<{ authJson: string | null; health: ProviderHealth }> {
    const authJson = this.readAuthJson();
    const version = authJson ? hashPayload(authJson) : null;
    const checkedAt = new Date().toISOString();

    if (!authJson) {
      return {
        authJson,
        health: this.buildHealth("missing", version, checkedAt, "Codex auth.json is missing or empty."),
      };
    }

    const auth = parseCodexAuthInfo(authJson);
    if (!auth) {
      return {
        authJson,
        health: this.buildHealth("invalid", version, checkedAt, "Codex auth.json is malformed."),
      };
    }

    const accessExpired = isIsoAtOrBefore(auth.accessTokenExpiresAt, checkedAt);
    const idExpired = isIsoAtOrBefore(auth.idTokenExpiresAt, checkedAt);
    const expired = accessExpired || idExpired;
    const health = this.buildHealth(
      expired ? "invalid" : "ready",
      version,
      checkedAt,
      accessExpired
        ? "Codex access token is expired; refresh required."
        : idExpired
          ? "Codex id token is expired; refresh required."
          : null,
      this.buildMetadata(auth, checkedAt),
    );
    if (!options?.ignoreRefreshFailure && health.status === "ready" && this.lastRefreshFailure?.version === version) {
      return {
        authJson,
        health: {
          ...health,
          status: this.lastRefreshFailure.status,
          detail: this.lastRefreshFailure.detail,
        },
      };
    }
    return {
      authJson,
      health,
    };
  }

  private readAuthJson(): string | null {
    if (!existsSync(this.authJsonPath)) return null;
    const value = readFileSync(this.authJsonPath, "utf8").trim();
    return value.length > 0 ? value : null;
  }

  private async probeCurrentAccess(auth: CodexAuthInfo): Promise<boolean> {
    try {
      const response = await this.fetchImpl(CODEX_MODELS_ENDPOINT, {
        method: "GET",
        headers: buildCodexAccessHeaders(auth),
        signal: AbortSignal.timeout(this.probeTimeoutMs),
      });
      return response.status !== 401 && response.status !== 403;
    } catch {
      return false;
    }
  }

  private buildHealth(
    status: ProviderStatus,
    version: string | null,
    checkedAt: string,
    detail: string | null,
    metadata?: ProviderHealth["metadata"],
  ): ProviderHealth {
    return {
      provider: this.id,
      source: this.source,
      status,
      version,
      checkedAt,
      detail,
      ...(metadata ? { metadata } : {}),
    };
  }

  private buildMetadata(auth: CodexAuthInfo, checkedAt: string): ProviderHealth["metadata"] {
    const refreshRequired = isIsoAtOrBefore(auth.accessTokenExpiresAt, checkedAt)
      || isIsoAtOrBefore(auth.idTokenExpiresAt, checkedAt);
    return {
      accessTokenExpiresAt: auth.accessTokenExpiresAt,
      idTokenExpiresAt: auth.idTokenExpiresAt,
      lastRefresh: auth.lastRefresh,
      hasRefreshToken: !!auth.refreshToken,
      refreshRequired,
    };
  }
}

function isIsoAtOrBefore(value: string | null, referenceIso: string): boolean {
  if (!value) return false;
  const valueMs = Date.parse(value);
  const referenceMs = Date.parse(referenceIso);
  return Number.isFinite(valueMs) && Number.isFinite(referenceMs) && valueMs <= referenceMs;
}

interface PendingRequest {
  resolve: (value: Record<string, unknown>) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

class CodexRpcClient {
  private proc: ReturnType<typeof spawn>;
  private nextId = 1;
  private buffer = "";
  private stderr = "";
  private pending = new Map<number, PendingRequest>();

  constructor(env: NodeJS.ProcessEnv) {
    this.proc = spawnCodexProcess(env);

    const stdout = this.proc.stdout!;
    const stderr = this.proc.stderr!;
    stdout.setEncoding("utf8");
    stderr.setEncoding("utf8");

    stdout.on("data", (chunk: string) => {
      this.buffer += chunk;
      while (true) {
        const newlineIndex = this.buffer.indexOf("\n");
        if (newlineIndex < 0) break;
        const line = this.buffer.slice(0, newlineIndex).trim();
        this.buffer = this.buffer.slice(newlineIndex + 1);
        if (!line) continue;

        let parsed: Record<string, unknown>;
        try {
          parsed = JSON.parse(line) as Record<string, unknown>;
        } catch {
          continue;
        }

        const id = typeof parsed.id === "number" ? parsed.id : null;
        if (id == null) continue;
        const request = this.pending.get(id);
        if (!request) continue;
        this.pending.delete(id);
        clearTimeout(request.timer);
        const rpcError = extractRpcErrorMessage(parsed.error);
        if (rpcError) {
          request.reject(new Error(rpcError));
          continue;
        }
        request.resolve(parsed);
      }
    });

    stderr.on("data", (chunk: string) => {
      this.stderr += chunk;
    });

    const rejectPending = (fallback: string) => {
      for (const request of Array.from(this.pending.values())) {
        clearTimeout(request.timer);
        request.reject(new Error(this.stderr.trim() || fallback));
      }
      this.pending.clear();
    };

    this.proc.on("exit", () => rejectPending("codex app-server closed unexpectedly"));
    this.proc.on("error", (error) => rejectPending(error.message));
  }

  private request(method: string, params: Record<string, unknown> = {}, timeoutMs = 6_000): Promise<Record<string, unknown>> {
    const id = this.nextId++;
    const payload = JSON.stringify({ id, method, params }) + "\n";

    return new Promise<Record<string, unknown>>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`codex app-server timed out on ${method}`));
      }, timeoutMs);

      this.pending.set(id, { resolve, reject, timer });
      this.proc.stdin!.write(payload);
    });
  }

  private notify(method: string, params: Record<string, unknown> = {}): void {
    this.proc.stdin!.write(JSON.stringify({ method, params }) + "\n");
  }

  async initialize(): Promise<void> {
    await this.request("initialize", {
      clientInfo: {
        name: "arena-authd",
        version: "0.0.0",
      },
    });
    this.notify("initialized", {});
  }

  async fetchRateLimits(): Promise<CodexRpcRateLimitsResult> {
    const message = await this.request("account/rateLimits/read");
    return (message.result as CodexRpcRateLimitsResult | undefined) ?? {};
  }

  shutdown(): void {
    this.proc.kill("SIGTERM");
  }
}

function extractRpcErrorMessage(error: unknown): string | null {
  if (!error || typeof error !== "object") return null;
  const message = (error as { message?: unknown }).message;
  return typeof message === "string" && message.trim().length > 0 ? message.trim() : null;
}

function spawnCodexProcess(env: NodeJS.ProcessEnv) {
  return spawn(
    "sh",
    [
      "-lc",
      "if command -v codex >/dev/null 2>&1; then exec codex -s read-only -a untrusted app-server; else exec npm exec --yes @openai/codex -- -s read-only -a untrusted app-server; fi",
    ],
    { stdio: ["pipe", "pipe", "pipe"], env },
  );
}

async function withCodexAuthHome<T>(authJson: string, task: (env: NodeJS.ProcessEnv) => Promise<T>): Promise<T> {
  const tempHome = await mkdtemp(path.join(os.tmpdir(), "arena-codex-quota-"));
  const codexHome = path.join(tempHome, ".codex");
  await mkdir(codexHome, { recursive: true });
  await writeFileAsync(path.join(codexHome, "auth.json"), authJson, { mode: 0o600 });

  try {
    return await task({
      ...process.env,
      HOME: tempHome,
      CODEX_HOME: codexHome,
    });
  } finally {
    await rm(tempHome, { recursive: true, force: true });
  }
}

async function fetchCodexQuotaWindows(authJson: string): Promise<QuotaWindow[]> {
  return withCodexAuthHome(authJson, async (env) => {
    const client = new CodexRpcClient(env);
    try {
      await client.initialize();
      return mapCodexRpcQuota(await client.fetchRateLimits());
    } finally {
      client.shutdown();
    }
  });
}
