import type {
  ProviderHealth,
  ProviderPostMortem,
  ProviderPostMortemDiagnosis,
  ProviderPostMortemInput,
  ProviderQuotaResult,
  QuotaWindow,
} from "./types.js";

interface ClaudeUsageWindow {
  utilization?: number | null;
  resets_at?: string | null;
}

interface ClaudeExtraUsage {
  is_enabled?: boolean | null;
  monthly_limit?: number | null;
  used_credits?: number | null;
  utilization?: number | null;
  currency?: string | null;
}

export interface ClaudeUsageResponse {
  five_hour?: ClaudeUsageWindow | null;
  seven_day?: ClaudeUsageWindow | null;
  seven_day_sonnet?: ClaudeUsageWindow | null;
  seven_day_opus?: ClaudeUsageWindow | null;
  extra_usage?: ClaudeExtraUsage | null;
}

export interface CodexRpcWindow {
  usedPercent?: number | null;
  resetsAt?: number | null;
}

export interface CodexRpcCredits {
  unlimited?: boolean | null;
  balance?: string | number | null;
}

export interface CodexRpcLimit {
  limitId?: string | null;
  limitName?: string | null;
  primary?: CodexRpcWindow | null;
  secondary?: CodexRpcWindow | null;
  credits?: CodexRpcCredits | null;
}

export interface CodexRpcRateLimitsResult {
  rateLimits?: CodexRpcLimit | null;
  rateLimitsByLimitId?: Record<string, CodexRpcLimit> | null;
}

export function mapClaudeQuotaResponse(body: ClaudeUsageResponse): QuotaWindow[] {
  const windows: QuotaWindow[] = [];

  if (body.five_hour != null) {
    windows.push({
      label: "Current session",
      usedPercent: toPercent(body.five_hour.utilization),
      resetsAt: body.five_hour.resets_at ?? null,
      valueLabel: null,
      detail: null,
    });
  }

  if (body.seven_day != null) {
    windows.push({
      label: "Current week (all models)",
      usedPercent: toPercent(body.seven_day.utilization),
      resetsAt: body.seven_day.resets_at ?? null,
      valueLabel: null,
      detail: null,
    });
  }

  if (body.seven_day_sonnet != null) {
    windows.push({
      label: "Current week (Sonnet only)",
      usedPercent: toPercent(body.seven_day_sonnet.utilization),
      resetsAt: body.seven_day_sonnet.resets_at ?? null,
      valueLabel: null,
      detail: null,
    });
  }

  if (body.seven_day_opus != null) {
    windows.push({
      label: "Current week (Opus only)",
      usedPercent: toPercent(body.seven_day_opus.utilization),
      resetsAt: body.seven_day_opus.resets_at ?? null,
      valueLabel: null,
      detail: null,
    });
  }

  if (body.extra_usage != null) {
    windows.push({
      label: "Extra usage",
      usedPercent: body.extra_usage.is_enabled === false ? null : toPercent(body.extra_usage.utilization),
      resetsAt: null,
      valueLabel:
        body.extra_usage.is_enabled === false
          ? "Not enabled"
          : formatExtraUsageLabel(body.extra_usage),
      detail:
        body.extra_usage.is_enabled === false
          ? "Extra usage not enabled"
          : "Monthly extra usage pool",
    });
  }

  return windows;
}

export function mapCodexRpcQuota(result: CodexRpcRateLimitsResult): QuotaWindow[] {
  const windows: QuotaWindow[] = [];
  const limitOrder = ["codex"];
  const limitsById = result.rateLimitsByLimitId ?? {};
  for (const key of Object.keys(limitsById)) {
    if (!limitOrder.includes(key)) limitOrder.push(key);
  }

  const rootLimit = result.rateLimits ?? null;
  const allLimits = new Map<string, CodexRpcLimit>();
  if (rootLimit?.limitId) allLimits.set(rootLimit.limitId, rootLimit);
  for (const [key, value] of Object.entries(limitsById)) {
    allLimits.set(key, value);
  }
  if (!allLimits.has("codex") && rootLimit) allLimits.set("codex", rootLimit);

  for (const limitId of limitOrder) {
    const limit = allLimits.get(limitId);
    if (!limit) continue;

    const prefix = limitId === "codex" ? "" : `${limit.limitName ?? limitId} · `;
    const primary = buildCodexRpcWindow(`${prefix}5h limit`, limit.primary);
    if (primary) windows.push(primary);
    const secondary = buildCodexRpcWindow(`${prefix}Weekly limit`, limit.secondary);
    if (secondary) windows.push(secondary);

    if (limitId === "codex" && limit.credits && limit.credits.unlimited !== true) {
      windows.push({
        label: "Credits",
        usedPercent: null,
        resetsAt: null,
        valueLabel: parseCreditBalance(limit.credits.balance) ?? "N/A",
        detail: null,
      });
    }
  }

  return windows;
}

export function buildProviderPostMortem(input: {
  provider: ProviderPostMortem["provider"];
  health: ProviderHealth;
  quota: ProviderQuotaResult;
  postMortemInput?: ProviderPostMortemInput;
}): ProviderPostMortem {
  const diagnosis = diagnoseProvider(input.health, input.quota);
  return {
    provider: input.provider,
    checkedAt: new Date().toISOString(),
    health: input.health,
    quota: input.quota,
    diagnosis,
    detail: buildDiagnosisDetail(diagnosis, input.health, input.quota),
    input: sanitizePostMortemInput(input.postMortemInput),
  };
}

function diagnoseProvider(health: ProviderHealth, quota: ProviderQuotaResult): ProviderPostMortemDiagnosis {
  if (health.status === "missing") return "auth_missing";
  if (health.status === "invalid") return "auth_invalid";
  if (!quota.ok && isQuotaLimitedError(quota.error)) return "quota_limited";
  if (!quota.ok) return "quota_unavailable";
  if (quota.windows.some((window) => window.usedPercent != null && window.usedPercent >= 100)) {
    return "quota_saturated";
  }
  if (health.status === "ready") return "provider_ready";
  return "provider_unknown";
}

function buildDiagnosisDetail(
  diagnosis: ProviderPostMortemDiagnosis,
  health: ProviderHealth,
  quota: ProviderQuotaResult,
): string | null {
  if (diagnosis === "auth_missing" || diagnosis === "auth_invalid") {
    return health.detail ?? `Provider health is ${health.status}.`;
  }
  if (diagnosis === "quota_unavailable") {
    return quota.error ?? "Provider quota snapshot is unavailable.";
  }
  if (diagnosis === "quota_limited") {
    return quota.error ?? "Provider quota is currently limited.";
  }
  if (diagnosis === "quota_saturated") {
    const saturated = quota.windows.find((window) => window.usedPercent != null && window.usedPercent >= 100);
    return saturated ? `${saturated.label} is saturated.` : "Provider quota is saturated.";
  }
  return null;
}

function isQuotaLimitedError(error: string | undefined): boolean {
  if (!error) return false;
  return /\b429\b|quota is currently limited|quota limit|rate.?limit|too many requests/i.test(error);
}

function sanitizePostMortemInput(input: ProviderPostMortemInput | undefined): ProviderPostMortemInput {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  return {
    ...(input.failureType ? { failureType: input.failureType } : {}),
    ...(typeof input.message === "string" ? { message: input.message.slice(0, 500) } : {}),
    ...(typeof input.occurredAt === "string" ? { occurredAt: input.occurredAt } : {}),
  };
}

function buildCodexRpcWindow(label: string, window: CodexRpcWindow | null | undefined): QuotaWindow | null {
  if (!window) return null;
  return {
    label,
    usedPercent: toPercent(window.usedPercent),
    resetsAt: unixSecondsToIso(window.resetsAt),
    valueLabel: null,
    detail: null,
  };
}

function toPercent(value: number | null | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.min(100, Math.round(value <= 1 ? value * 100 : value));
}

function unixSecondsToIso(value: number | null | undefined): string | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return new Date(value * 1000).toISOString();
}

function formatCurrencyAmount(value: number, currency: string | null | undefined): string {
  const code = typeof currency === "string" && currency.trim().length > 0 ? currency.trim().toUpperCase() : "USD";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: code,
    maximumFractionDigits: 2,
  }).format(value);
}

function formatExtraUsageLabel(extraUsage: ClaudeExtraUsage): string | null {
  const monthlyLimit = extraUsage.monthly_limit;
  const usedCredits = extraUsage.used_credits;
  if (
    typeof monthlyLimit !== "number" ||
    !Number.isFinite(monthlyLimit) ||
    typeof usedCredits !== "number" ||
    !Number.isFinite(usedCredits)
  ) {
    return null;
  }
  return `${formatCurrencyAmount(usedCredits, extraUsage.currency)} / ${formatCurrencyAmount(monthlyLimit, extraUsage.currency)}`;
}

function parseCreditBalance(value: string | number | null | undefined): string | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return `$${value.toFixed(2)} remaining`;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return `$${parsed.toFixed(2)} remaining`;
    }
    return value.trim();
  }
  return null;
}
