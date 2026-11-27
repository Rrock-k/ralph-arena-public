export type ProviderId = "claude" | "codex";

export type ProviderStatus = "ready" | "missing" | "invalid" | "unknown";

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
  source: QuotaSource;
  ok: boolean;
  error?: string;
  windows: QuotaWindow[];
}

export interface ProviderQuotaSnapshot {
  generatedAt: string;
  results: ProviderQuotaResult[];
}

export interface ProviderPostMortemInput {
  failureType?: "auth" | "rate_limit" | "quota" | "config" | "unknown";
  message?: string | null;
  occurredAt?: string | null;
}

export type ProviderPostMortemDiagnosis =
  | "provider_ready"
  | "auth_missing"
  | "auth_invalid"
  | "quota_limited"
  | "quota_saturated"
  | "quota_unavailable"
  | "provider_unknown";

export interface ProviderPostMortem {
  provider: ProviderId;
  checkedAt: string;
  health: ProviderHealth;
  quota: ProviderQuotaResult;
  diagnosis: ProviderPostMortemDiagnosis;
  detail: string | null;
  input: ProviderPostMortemInput;
}

export interface ProviderHealth {
  provider: ProviderId;
  source: string;
  status: ProviderStatus;
  version: string | null;
  checkedAt: string;
  detail: string | null;
  metadata?: Record<string, string | boolean | null>;
}

export interface MintedProviderAuth {
  auth: Record<string, string>;
  health: ProviderHealth;
}

export interface AuthProvider {
  readonly id: ProviderId;
  health(): Promise<ProviderHealth>;
  mintRunAuth(): Promise<MintedProviderAuth>;
  refresh(): Promise<ProviderHealth>;
  quota(): Promise<ProviderQuotaResult>;
  postMortem(input?: ProviderPostMortemInput): Promise<ProviderPostMortem>;
}

export interface MintRunAuthModes {
  claudeAuthMode?: string | null;
  codexAuthMode?: string | null;
}

export interface MintRunAuthResult {
  version: string;
  auth: Record<string, string>;
  providers: Partial<Record<ProviderId, ProviderHealth>>;
}
