import { beforeEach, describe, expect, it, vi } from "vitest";

describe("provider quotas", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    delete process.env.AUTHD_URL;
    delete process.env.AUTHD_SECRET;
  });

  it("reads provider quota windows from authd", async () => {
    process.env.AUTHD_URL = "http://authd:4311";
    process.env.AUTHD_SECRET = "quota-secret";

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        generatedAt: "2026-06-25T00:00:00.000Z",
        results: [
          {
            provider: "anthropic",
            source: "anthropic-oauth",
            ok: true,
            windows: [
              {
                label: "Current session",
                usedPercent: 100,
                resetsAt: "2026-06-25T05:00:00.000Z",
                valueLabel: null,
                detail: null,
              },
            ],
          },
          {
            provider: "openai",
            source: "codex-rpc",
            ok: false,
            error: "codex app-server timed out",
            windows: [],
          },
        ],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const { fetchProviderQuotaSnapshot } = await import("./provider-quotas");
    const snapshot = await fetchProviderQuotaSnapshot();

    expect(snapshot).toEqual({
      generatedAt: "2026-06-25T00:00:00.000Z",
      results: [
        {
          provider: "anthropic",
          source: "anthropic-oauth",
          ok: true,
          windows: [
            {
              label: "Current session",
              usedPercent: 100,
              resetsAt: "2026-06-25T05:00:00.000Z",
              valueLabel: null,
              detail: null,
            },
          ],
        },
        {
          provider: "openai",
          source: "codex-rpc",
          ok: false,
          error: "codex app-server timed out",
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

  it("does not fall back to local TokenManager subscription tokens when authd is not configured", async () => {
    const { fetchProviderQuotaSnapshot } = await import("./provider-quotas");

    await expect(fetchProviderQuotaSnapshot()).rejects.toThrow("AUTHD_URL is not configured.");
  });

  it("formats quota source labels for ops display", async () => {
    const { quotaSourceDisplayName } = await import("./provider-quotas");

    expect(quotaSourceDisplayName("anthropic-oauth")).toBe("Anthropic OAuth");
    expect(quotaSourceDisplayName("codex-rpc")).toBe("Codex app server");
  });
});
