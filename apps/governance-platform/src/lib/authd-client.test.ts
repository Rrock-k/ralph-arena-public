import { beforeEach, describe, expect, it, vi } from "vitest";

describe("authd client", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    delete process.env.AUTHD_URL;
    delete process.env.AUTHD_SECRET;
    delete process.env.AUTHD_TIMEOUT_MS;
  });

  it("refreshes providers and mints auth with the shared secret header", async () => {
    process.env.AUTHD_URL = "http://authd:4311/";
    process.env.AUTHD_SECRET = "top-secret";

    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          version: "authv_1",
          auth: {
            CLAUDE_CODE_OAUTH_TOKEN: "claude-token",
            CODEX_AUTH_JSON: "{\"accessToken\":\"codex-token\"}",
          },
          providers: {
            claude: { status: "ready" },
            codex: { status: "ready" },
          },
        }),
      });
    vi.stubGlobal("fetch", fetchMock);

    const { mintRunAuthFromAuthd } = await import("./authd-client");
    const auth = await mintRunAuthFromAuthd(
      { claudeAuthMode: "oauth", codexAuthMode: "subscription" },
      { fresh: true },
    );

    expect(auth).toEqual({
      CLAUDE_CODE_OAUTH_TOKEN: "claude-token",
      CODEX_AUTH_JSON: "{\"accessToken\":\"codex-token\"}",
    });
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "http://authd:4311/providers/claude/refresh",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "x-authd-secret": "top-secret",
        }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "http://authd:4311/providers/codex/refresh",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "x-authd-secret": "top-secret",
        }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      "http://authd:4311/mint-run-auth",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "Content-Type": "application/json",
          "x-authd-secret": "top-secret",
        }),
        body: JSON.stringify({ claudeAuthMode: "oauth", codexAuthMode: "subscription" }),
      }),
    );
  });

  it("throws when authd omits required auth keys for requested modes", async () => {
    process.env.AUTHD_URL = "http://authd:4311";

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        version: "authv_2",
        auth: {},
        providers: {
          claude: { status: "missing" },
        },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const { mintRunAuthFromAuthd } = await import("./authd-client");

    await expect(
      mintRunAuthFromAuthd({ claudeAuthMode: "oauth", codexAuthMode: "api_key" }),
    ).rejects.toThrow("CLAUDE_CODE_OAUTH_TOKEN");
  });

  it("reads sanitized authd health without exposing auth values", async () => {
    process.env.AUTHD_URL = "http://authd:4311";

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        providers: {
          codex: {
            provider: "codex",
            source: "codex-auth-json",
            status: "missing",
            version: null,
            checkedAt: "2026-06-11T01:26:52.188Z",
            detail: "Codex auth.json is missing or empty.",
            metadata: {
              accessTokenExpiresAt: "2026-06-21T04:02:17.000Z",
              lastRefresh: "2026-06-11T04:02:17.206Z",
              hasRefreshToken: true,
              refreshRequired: false,
              unsafeNumber: 123,
            },
            CODEX_AUTH_JSON: "{\"accessToken\":\"secret\"}",
          },
        },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const { getAuthdHealthSnapshot } = await import("./authd-client");
    const snapshot = await getAuthdHealthSnapshot();

    expect(snapshot).toEqual({
      configured: true,
      available: true,
      ok: true,
      error: null,
      providers: {
        codex: {
          provider: "codex",
          source: "codex-auth-json",
          status: "missing",
          version: null,
          checkedAt: "2026-06-11T01:26:52.188Z",
          detail: "Codex auth.json is missing or empty.",
          metadata: {
            accessTokenExpiresAt: "2026-06-21T04:02:17.000Z",
            lastRefresh: "2026-06-11T04:02:17.206Z",
            hasRefreshToken: true,
            refreshRequired: false,
          },
        },
      },
    });
    expect(JSON.stringify(snapshot)).not.toContain("secret");
    expect(fetchMock).toHaveBeenCalledWith(
      "http://authd:4311/health",
      expect.objectContaining({ headers: {} }),
    );
  });

  it("reads authd quota snapshots through the same authd boundary", async () => {
    process.env.AUTHD_URL = "http://authd:4311";
    process.env.AUTHD_SECRET = "quota-secret";

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        generatedAt: "2026-06-25T00:00:00.000Z",
        results: [
          {
            provider: "openai",
            source: "codex-rpc",
            ok: true,
            windows: [],
          },
        ],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const { getAuthdQuotaSnapshot } = await import("./authd-client");

    await expect(getAuthdQuotaSnapshot()).resolves.toEqual({
      generatedAt: "2026-06-25T00:00:00.000Z",
      results: [
        {
          provider: "openai",
          source: "codex-rpc",
          ok: true,
          windows: [],
        },
      ],
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "http://authd:4311/quota-windows",
      expect.objectContaining({
        cache: "no-store",
        headers: { "x-authd-secret": "quota-secret" },
      }),
    );
  });

  it("throws when authd refresh returns invalid provider health", async () => {
    process.env.AUTHD_URL = "http://authd:4311";

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        provider: "codex",
        status: "invalid",
        detail: "Codex OAuth refresh failed with 401.",
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const { mintRunAuthFromAuthd } = await import("./authd-client");

    await expect(
      mintRunAuthFromAuthd({ claudeAuthMode: "api_key", codexAuthMode: "subscription" }, { fresh: true }),
    ).rejects.toThrow("authd refresh codex returned invalid: Codex OAuth refresh failed with 401.");
  });
});
