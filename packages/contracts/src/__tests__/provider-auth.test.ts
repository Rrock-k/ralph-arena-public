import { describe, expect, it } from "vitest";

import {
  ANTHROPIC_VERSION_HEADER,
  buildAnthropicAuthHeaders,
  interpretRefreshTokensScriptOutput,
} from "../provider-auth.js";

describe("provider auth helpers", () => {
  it("builds Anthropic probe headers with x-api-key for OAuth and API keys", () => {
    expect(buildAnthropicAuthHeaders("token-123")).toEqual({
      "x-api-key": "token-123",
      "anthropic-version": ANTHROPIC_VERSION_HEADER,
    });
  });

  it("treats missing macOS Keychain as a failed refresh result", () => {
    expect(
      interpretRefreshTokensScriptOutput("[refresh-tokens] Skipped (not macOS / no Keychain)."),
    ).toEqual({ ok: false, reason: "keychain_unavailable" });
  });

  it("treats missing Claude Keychain entry as a failed refresh result", () => {
    expect(
      interpretRefreshTokensScriptOutput(
        "[refresh-tokens] No Keychain entry for 'Claude Code-credentials' — skipped.",
      ),
    ).toEqual({ ok: false, reason: "keychain_entry_missing" });
  });

  it("keeps successful refresh output as ok", () => {
    expect(
      interpretRefreshTokensScriptOutput("[refresh-tokens] Tokens read from Keychain OK"),
    ).toEqual({ ok: true, reason: null });
  });
});
