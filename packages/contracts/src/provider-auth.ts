export const ANTHROPIC_VERSION_HEADER = "2023-06-01";

export type RefreshTokensScriptReason =
  | "keychain_unavailable"
  | "keychain_entry_missing";

export function buildAnthropicAuthHeaders(token: string): Record<string, string> {
  return {
    "x-api-key": token,
    "anthropic-version": ANTHROPIC_VERSION_HEADER,
  };
}

export function interpretRefreshTokensScriptOutput(output: string): {
  ok: boolean;
  reason: RefreshTokensScriptReason | null;
} {
  if (/\[refresh-tokens\]\s+Skipped\b/i.test(output)) {
    return { ok: false, reason: "keychain_unavailable" };
  }

  if (/\[refresh-tokens\]\s+No Keychain entry\b/i.test(output)) {
    return { ok: false, reason: "keychain_entry_missing" };
  }

  return { ok: true, reason: null };
}
