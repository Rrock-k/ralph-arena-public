export function providerQuotaDisplayName(provider: string): string {
  return provider === "anthropic" ? "Claude" : "Codex";
}

export function quotaSourceDisplayName(source: string | undefined): string {
  if (source === "anthropic-oauth") return "Anthropic OAuth";
  if (source === "codex-rpc") return "Codex app server";
  return source ?? "Unknown";
}
