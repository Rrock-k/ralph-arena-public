import { describe, expect, it, vi } from "vitest";
import { AuthService } from "../service.js";
import type { AuthProvider, ProviderHealth, ProviderPostMortem, ProviderQuotaResult } from "../types.js";

function makeHealth(provider: "claude" | "codex", version: string): ProviderHealth {
  return {
    provider,
    source: `${provider}-test`,
    status: "ready",
    version,
    checkedAt: "2026-03-28T00:00:00.000Z",
    detail: null,
  };
}

function makeProvider(
  provider: "claude" | "codex",
  authFactory: () => Record<string, string>,
): AuthProvider {
  const quotaProvider = provider === "claude" ? "anthropic" : "openai";
  const quotaSource = provider === "claude" ? "anthropic-oauth" : "codex-rpc";
  const quota: ProviderQuotaResult = {
    provider: quotaProvider,
    source: quotaSource,
    ok: true,
    windows: [],
  };
  const postMortem: ProviderPostMortem = {
    provider,
    checkedAt: "2026-03-28T00:00:00.000Z",
    health: makeHealth(provider, "v1"),
    quota,
    diagnosis: "provider_ready",
    detail: null,
    input: {},
  };
  return {
    id: provider,
    health: vi.fn().mockResolvedValue(makeHealth(provider, "v1")),
    refresh: vi.fn().mockResolvedValue(makeHealth(provider, "v1")),
    quota: vi.fn().mockResolvedValue(quota),
    postMortem: vi.fn().mockResolvedValue(postMortem),
    mintRunAuth: vi.fn().mockImplementation(async () => ({
      auth: authFactory(),
      health: makeHealth(provider, "v1"),
    })),
  };
}

describe("AuthService", () => {
  it("respects auth modes when minting a run snapshot", async () => {
    const service = new AuthService({
      claude: makeProvider("claude", () => ({
        CLAUDE_CODE_OAUTH_TOKEN: "claude-token",
      })),
      codex: makeProvider("codex", () => ({
        CODEX_AUTH_JSON: "{\"accessToken\":\"codex-token\"}",
      })),
    });

    const oauthSnapshot = await service.mintRunAuth({
      claudeAuthMode: "oauth",
      codexAuthMode: "subscription",
    });
    expect(oauthSnapshot.auth).toEqual({
      CLAUDE_CODE_OAUTH_TOKEN: "claude-token",
      CODEX_AUTH_JSON: "{\"accessToken\":\"codex-token\"}",
    });

    const skippedSnapshot = await service.mintRunAuth({
      claudeAuthMode: "api_key",
      codexAuthMode: "api_key",
    });
    expect(skippedSnapshot.auth).toEqual({});
  });

  it("changes the snapshot version when auth payload changes", async () => {
    let currentToken = "claude-a";
    const service = new AuthService({
      claude: makeProvider("claude", () => ({
        CLAUDE_CODE_OAUTH_TOKEN: currentToken,
      })),
    });

    const first = await service.mintRunAuth({ claudeAuthMode: "oauth" });
    currentToken = "claude-b";
    const second = await service.mintRunAuth({ claudeAuthMode: "oauth" });

    expect(first.version).not.toBe(second.version);
  });

  it("returns an authd-owned quota snapshot from provider adapters", async () => {
    const service = new AuthService({
      claude: makeProvider("claude", () => ({})),
      codex: makeProvider("codex", () => ({})),
    });

    const snapshot = await service.quotaSnapshot();

    expect(snapshot.generatedAt).toEqual(expect.any(String));
    expect(snapshot.results).toEqual([
      expect.objectContaining({ provider: "anthropic", source: "anthropic-oauth", ok: true }),
      expect.objectContaining({ provider: "openai", source: "codex-rpc", ok: true }),
    ]);
  });
});
