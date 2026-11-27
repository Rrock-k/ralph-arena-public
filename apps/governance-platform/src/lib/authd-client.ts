interface RunAuthModesLike {
  claudeAuthMode?: string | null;
  codexAuthMode?: string | null;
}

interface AuthdProviderHealth {
  provider?: string;
  source?: string;
  status?: string;
  version?: string | null;
  checkedAt?: string;
  detail?: string;
  metadata?: unknown;
}

interface AuthdMintRunAuthResponse {
  version?: string;
  auth?: Record<string, unknown>;
  providers?: Record<string, AuthdProviderHealth | undefined>;
}

export interface AuthdHealthSnapshot {
  configured: boolean;
  available: boolean;
  ok: boolean;
  error: string | null;
  providers: Record<string, {
    provider: string;
    source: string | null;
    status: string;
    version: string | null;
    checkedAt: string | null;
    detail: string | null;
    metadata: Record<string, string | boolean | null>;
  }>;
}

const AUTHD_TIMEOUT_MS = Number(process.env.AUTHD_TIMEOUT_MS || "10000");

function readAuthdBaseUrl(): string | null {
  const raw = process.env.AUTHD_URL?.trim();
  if (!raw) return null;
  return raw.replace(/\/+$/, "");
}

function buildExpectedAuthKeys(modes: RunAuthModesLike): string[] {
  const keys: string[] = [];
  if ((modes.claudeAuthMode ?? "oauth") === "oauth") {
    keys.push("CLAUDE_CODE_OAUTH_TOKEN");
  }
  if (modes.codexAuthMode === "subscription") {
    keys.push("CODEX_AUTH_JSON");
  }
  return keys;
}

function buildHeaders(contentType?: string): Record<string, string> {
  const headers: Record<string, string> = {};
  if (contentType) {
    headers["Content-Type"] = contentType;
  }

  const secret = process.env.AUTHD_SECRET?.trim();
  if (secret) {
    headers["x-authd-secret"] = secret;
  }

  return headers;
}

async function authdRequest(path: string, init?: RequestInit): Promise<Response> {
  const baseUrl = readAuthdBaseUrl();
  if (!baseUrl) {
    throw new Error("AUTHD_URL is not configured.");
  }

  return fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      ...buildHeaders(),
      ...(init?.headers as Record<string, string> | undefined),
    },
    signal: AbortSignal.timeout(AUTHD_TIMEOUT_MS),
  });
}

function normalizeAuth(payload: AuthdMintRunAuthResponse): Record<string, string> {
  const auth = payload.auth;
  if (!auth || typeof auth !== "object" || Array.isArray(auth)) {
    throw new Error("authd mint-run-auth returned invalid auth payload.");
  }

  return Object.fromEntries(
    Object.entries(auth).flatMap(([key, value]) => (
      typeof value === "string" && value.length > 0 ? [[key, value]] : []
    )),
  );
}

function assertExpectedAuthPresent(
  modes: RunAuthModesLike,
  auth: Record<string, string>,
  providers?: Record<string, AuthdProviderHealth | undefined>,
): void {
  const missing = buildExpectedAuthKeys(modes).filter((key) => !auth[key]);
  if (missing.length === 0) return;

  const providerSummary = providers
    ? Object.entries(providers)
        .map(([provider, health]) => `${provider}:${health?.status ?? "unknown"}`)
        .join(", ")
    : "none";

  throw new Error(`authd mint-run-auth missing ${missing.join(", ")} (providers=${providerSummary}).`);
}

async function refreshProvider(provider: "claude" | "codex"): Promise<void> {
  const response = await authdRequest(`/providers/${provider}/refresh`, {
    method: "POST",
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`authd refresh ${provider} failed with ${response.status}${text ? `: ${text}` : ""}`);
  }

  const payload = await response.json().catch(() => null) as AuthdProviderHealth | null;
  if (payload?.status === "invalid") {
    throw new Error(`authd refresh ${provider} returned invalid${payload.detail ? `: ${payload.detail}` : ""}`);
  }
}

export function isAuthdConfigured(): boolean {
  return !!readAuthdBaseUrl();
}

export async function getAuthdHealthSnapshot(): Promise<AuthdHealthSnapshot> {
  if (!isAuthdConfigured()) {
    return {
      configured: false,
      available: false,
      ok: false,
      error: "AUTHD_URL is not configured.",
      providers: {},
    };
  }

  try {
    const response = await authdRequest("/health");
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      return {
        configured: true,
        available: false,
        ok: false,
        error: `authd health failed with ${response.status}${text ? `: ${text}` : ""}`,
        providers: {},
      };
    }

    const payload = await response.json() as {
      ok?: unknown;
      providers?: Record<string, AuthdProviderHealth | undefined>;
    };
    return {
      configured: true,
      available: true,
      ok: payload.ok === true,
      error: null,
      providers: sanitizeAuthdProviders(payload.providers),
    };
  } catch (error) {
    return {
      configured: true,
      available: false,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      providers: {},
    };
  }
}

export async function getAuthdQuotaSnapshot(): Promise<unknown> {
  const response = await authdRequest("/quota-windows", {
    cache: "no-store",
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`authd quota snapshot failed with ${response.status}${text ? `: ${text}` : ""}`);
  }

  return await response.json();
}

export async function mintRunAuthFromAuthd(
  modes: RunAuthModesLike,
  opts?: { fresh?: boolean },
): Promise<Record<string, string>> {
  if (opts?.fresh) {
    const refreshes: Promise<void>[] = [];
    if ((modes.claudeAuthMode ?? "oauth") === "oauth") {
      refreshes.push(refreshProvider("claude"));
    }
    if (modes.codexAuthMode === "subscription") {
      refreshes.push(refreshProvider("codex"));
    }
    await Promise.all(refreshes);
  }

  const response = await authdRequest("/mint-run-auth", {
    method: "POST",
    headers: buildHeaders("application/json"),
    body: JSON.stringify(modes),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`authd mint-run-auth failed with ${response.status}${text ? `: ${text}` : ""}`);
  }

  const payload = await response.json() as AuthdMintRunAuthResponse;
  const auth = normalizeAuth(payload);
  assertExpectedAuthPresent(modes, auth, payload.providers);
  return auth;
}

function sanitizeAuthdProviders(
  providers: Record<string, AuthdProviderHealth | undefined> | undefined,
): AuthdHealthSnapshot["providers"] {
  if (!providers || typeof providers !== "object") return {};

  return Object.fromEntries(
    Object.entries(providers).flatMap(([key, value]) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) return [];
      const provider = typeof value.provider === "string" && value.provider.trim()
        ? value.provider.trim()
        : key;
      return [[key, {
        provider,
        source: typeof value.source === "string" && value.source.trim() ? value.source.trim() : null,
        status: typeof value.status === "string" && value.status.trim() ? value.status.trim() : "unknown",
        version: typeof value.version === "string" && value.version.trim() ? value.version.trim() : null,
        checkedAt: typeof value.checkedAt === "string" && value.checkedAt.trim() ? value.checkedAt.trim() : null,
        detail: typeof value.detail === "string" && value.detail.trim() ? value.detail.trim() : null,
        metadata: sanitizeAuthdProviderMetadata(value.metadata),
      }]];
    }),
  );
}

function sanitizeAuthdProviderMetadata(metadata: unknown): Record<string, string | boolean | null> {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return {};

  const sanitized: Record<string, string | boolean | null> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (typeof value === "string" || typeof value === "boolean" || value === null) {
      sanitized[key] = value;
    }
  }
  return sanitized;
}
