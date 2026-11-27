import { getAuthdQuotaSnapshot } from "./authd-client";
export { providerQuotaDisplayName, quotaSourceDisplayName } from "./provider-quota-display";

export type QuotaProvider = "anthropic" | "openai";
export type QuotaSource = "anthropic-oauth" | "codex-rpc";

export interface QuotaWindow {
  label: string;
  usedPercent: number | null;
  resetsAt: string | null;
  valueLabel: string | null;
  detail: string | null;
}

export interface ProviderQuotaResult {
  provider: QuotaProvider;
  source?: QuotaSource;
  ok: boolean;
  error?: string;
  windows: QuotaWindow[];
}

export interface ProviderQuotaResponse {
  generatedAt: string;
  results: ProviderQuotaResult[];
}

export async function fetchProviderQuotaSnapshot(): Promise<ProviderQuotaResponse> {
  return sanitizeProviderQuotaResponse(await getAuthdQuotaSnapshot());
}

function sanitizeProviderQuotaResponse(payload: unknown): ProviderQuotaResponse {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("authd quota snapshot returned invalid payload.");
  }

  const raw = payload as { generatedAt?: unknown; results?: unknown };
  if (!Array.isArray(raw.results)) {
    throw new Error("authd quota snapshot returned invalid results.");
  }

  return {
    generatedAt: typeof raw.generatedAt === "string" && raw.generatedAt.trim()
      ? raw.generatedAt.trim()
      : new Date().toISOString(),
    results: raw.results.map(sanitizeProviderQuotaResult),
  };
}

function sanitizeProviderQuotaResult(value: unknown): ProviderQuotaResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("authd quota snapshot returned invalid provider result.");
  }

  const raw = value as {
    provider?: unknown;
    source?: unknown;
    ok?: unknown;
    error?: unknown;
    windows?: unknown;
  };
  const provider = raw.provider === "anthropic" || raw.provider === "openai" ? raw.provider : null;
  if (!provider) {
    throw new Error("authd quota snapshot returned unknown provider.");
  }

  const source = raw.source === "anthropic-oauth" || raw.source === "codex-rpc" ? raw.source : undefined;
  const windows = Array.isArray(raw.windows) ? raw.windows.map(sanitizeQuotaWindow) : [];

  return {
    provider,
    ...(source ? { source } : {}),
    ok: raw.ok === true,
    ...(typeof raw.error === "string" && raw.error.trim() ? { error: raw.error.trim() } : {}),
    windows,
  };
}

function sanitizeQuotaWindow(value: unknown): QuotaWindow {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("authd quota snapshot returned invalid quota window.");
  }

  const raw = value as {
    label?: unknown;
    usedPercent?: unknown;
    resetsAt?: unknown;
    valueLabel?: unknown;
    detail?: unknown;
  };

  return {
    label: typeof raw.label === "string" && raw.label.trim() ? raw.label.trim() : "Quota window",
    usedPercent: typeof raw.usedPercent === "number" && Number.isFinite(raw.usedPercent) ? raw.usedPercent : null,
    resetsAt: typeof raw.resetsAt === "string" && raw.resetsAt.trim() ? raw.resetsAt.trim() : null,
    valueLabel: typeof raw.valueLabel === "string" && raw.valueLabel.trim() ? raw.valueLabel.trim() : null,
    detail: typeof raw.detail === "string" && raw.detail.trim() ? raw.detail.trim() : null,
  };
}
