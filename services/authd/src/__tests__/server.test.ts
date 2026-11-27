import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AddressInfo } from "net";
import type http from "http";
import { createAuthdServer } from "../server.js";
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
  auth: Record<string, string>,
): AuthProvider {
  const quotaProvider = provider === "claude" ? "anthropic" : "openai";
  const quotaSource = provider === "claude" ? "anthropic-oauth" : "codex-rpc";
  const quota: ProviderQuotaResult = {
    provider: quotaProvider,
    source: quotaSource,
    ok: true,
    windows: [
      {
        label: "5h limit",
        usedPercent: 42,
        resetsAt: "2026-03-28T05:00:00.000Z",
        valueLabel: null,
        detail: null,
      },
    ],
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
    health: async () => makeHealth(provider, "v1"),
    refresh: async () => makeHealth(provider, "v2"),
    quota: async () => quota,
    postMortem: async () => postMortem,
    mintRunAuth: async () => ({
      auth,
      health: makeHealth(provider, "v1"),
    }),
  };
}

async function listen(server: http.Server): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}

describe("authd HTTP server", () => {
  let server: http.Server | null = null;

  beforeEach(() => {
    const service = new AuthService({
      claude: makeProvider("claude", {
        CLAUDE_CODE_OAUTH_TOKEN: "claude-token",
      }),
      codex: makeProvider("codex", {
        CODEX_AUTH_JSON: "{\"accessToken\":\"codex-token\"}",
      }),
    });
    server = createAuthdServer({ service, secret: "test-secret" });
  });

  afterEach(async () => {
    if (!server) return;
    await new Promise<void>((resolve, reject) => {
      server!.close((error) => (error ? reject(error) : resolve()));
    });
    server = null;
  });

  it("protects endpoints with x-authd-secret", async () => {
    const baseUrl = await listen(server!);

    const unauthorized = await fetch(`${baseUrl}/health`);
    expect(unauthorized.status).toBe(401);

    const authorized = await fetch(`${baseUrl}/health`, {
      headers: { "x-authd-secret": "test-secret" },
    });
    expect(authorized.status).toBe(200);
  });

  it("returns a minted run-auth snapshot", async () => {
    const baseUrl = await listen(server!);

    const response = await fetch(`${baseUrl}/mint-run-auth`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-authd-secret": "test-secret",
      },
      body: JSON.stringify({
        claudeAuthMode: "oauth",
        codexAuthMode: "subscription",
      }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(
      expect.objectContaining({
        version: expect.any(String),
        auth: {
          CLAUDE_CODE_OAUTH_TOKEN: "claude-token",
          CODEX_AUTH_JSON: "{\"accessToken\":\"codex-token\"}",
        },
      }),
    );
  });

  it("returns 404 for an unknown provider", async () => {
    const baseUrl = await listen(server!);

    const response = await fetch(`${baseUrl}/providers/nope/health`, {
      headers: { "x-authd-secret": "test-secret" },
    });

    expect(response.status).toBe(404);
  });

  it("returns an authd-owned quota snapshot", async () => {
    const baseUrl = await listen(server!);

    const response = await fetch(`${baseUrl}/quota-windows`, {
      headers: { "x-authd-secret": "test-secret" },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      generatedAt: expect.any(String),
      results: [
        expect.objectContaining({ provider: "anthropic", source: "anthropic-oauth", ok: true }),
        expect.objectContaining({ provider: "openai", source: "codex-rpc", ok: true }),
      ],
    });
  });

  it("returns provider quota and post-mortem diagnostics", async () => {
    const baseUrl = await listen(server!);

    const quota = await fetch(`${baseUrl}/providers/claude/quota`, {
      headers: { "x-authd-secret": "test-secret" },
    });
    expect(quota.status).toBe(200);
    expect(await quota.json()).toEqual(
      expect.objectContaining({ provider: "anthropic", source: "anthropic-oauth", ok: true }),
    );

    const postMortem = await fetch(`${baseUrl}/providers/codex/post-mortem`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-authd-secret": "test-secret",
      },
      body: JSON.stringify({ failureType: "rate_limit", message: "quota exhausted" }),
    });
    expect(postMortem.status).toBe(200);
    expect(await postMortem.json()).toEqual(
      expect.objectContaining({ provider: "codex", diagnosis: "provider_ready" }),
    );
  });
});
