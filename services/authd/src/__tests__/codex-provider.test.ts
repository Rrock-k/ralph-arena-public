import { describe, expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from "fs";
import os from "os";
import path from "path";
import { CodexSubscriptionProvider, buildCodexRunAuthJson, parseCodexAuthInfo, parseJwtExpiresAt } from "../providers/codex.js";

function makeTempDir(): string {
  return mkdtempSync(path.join(os.tmpdir(), "authd-codex-test-"));
}

function makeJwt(payload: Record<string, unknown>): string {
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `header.${encoded}.signature`;
}

describe("parseCodexAuthInfo", () => {
  it("supports both top-level and nested token formats", () => {
    expect(parseCodexAuthInfo(JSON.stringify({
      accessToken: "top-level-token",
      idToken: "top-level-id-token",
      accountId: "acct-top",
      refreshToken: "refresh-top",
      lastRefresh: "2026-06-01T00:00:00.000Z",
    }))).toEqual({
      accessToken: "top-level-token",
      idToken: "top-level-id-token",
      accountId: "acct-top",
      refreshToken: "refresh-top",
      lastRefresh: "2026-06-01T00:00:00.000Z",
      accessTokenExpiresAt: null,
      idTokenExpiresAt: null,
    });

    expect(parseCodexAuthInfo(JSON.stringify({
      tokens: {
        access_token: "nested-token",
        id_token: "nested-id-token",
        account_id: "acct-nested",
        refresh_token: "refresh-nested",
      },
      last_refresh: "2026-06-02T00:00:00.000Z",
    }))).toEqual({
      accessToken: "nested-token",
      idToken: "nested-id-token",
      accountId: "acct-nested",
      refreshToken: "refresh-nested",
      lastRefresh: "2026-06-02T00:00:00.000Z",
      accessTokenExpiresAt: null,
      idTokenExpiresAt: null,
    });
  });

  it("extracts access token expiry from JWT payload", () => {
    expect(parseJwtExpiresAt(makeJwt({ exp: 1_800_000_000 }))).toBe("2027-01-15T08:00:00.000Z");
    expect(parseJwtExpiresAt("not-a-jwt")).toBeNull();
  });
});

describe("buildCodexRunAuthJson", () => {
  it("strips refresh-token fields from runtime auth material", () => {
    const runAuth = buildCodexRunAuthJson(JSON.stringify({
      refreshToken: "top-refresh",
      tokens: {
        access_token: "access-token",
        id_token: "id-token",
        refresh_token: "nested-refresh",
        account_id: "acct-123",
      },
      last_refresh: "2026-06-01T00:00:00.000Z",
    }));

    expect(JSON.parse(runAuth!)).toEqual({
      tokens: {
        access_token: "access-token",
        id_token: "id-token",
        refresh_token: "",
        account_id: "acct-123",
      },
      last_refresh: "2026-06-01T00:00:00.000Z",
    });
  });
});

describe("CodexSubscriptionProvider", () => {
  it("marks malformed auth.json as invalid", async () => {
    const dir = makeTempDir();
    try {
      const authJsonPath = path.join(dir, "codex", "auth.json");
      mkdirSync(path.dirname(authJsonPath), { recursive: true });
      writeFileSync(authJsonPath, "{not json");

      const provider = new CodexSubscriptionProvider({ authJsonPath });
      const minted = await provider.mintRunAuth();

      expect(minted.health.status).toBe("invalid");
      expect(minted.auth).toEqual({});
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns sanitized CODEX_AUTH_JSON from local Codex auth without probing WHAM", async () => {
    const dir = makeTempDir();
    try {
      const authJsonPath = path.join(dir, "codex", "auth.json");
      mkdirSync(path.dirname(authJsonPath), { recursive: true });
      const raw = JSON.stringify({
        tokens: {
          access_token: makeJwt({ exp: 1_800_000_000 }),
          id_token: makeJwt({ exp: 1_800_000_000 }),
          refresh_token: "refresh-token",
          account_id: "acct-123",
        },
        last_refresh: "2026-06-01T00:00:00.000Z",
      });
      writeFileSync(authJsonPath, raw);

      const fetchMock = vi.fn();
      const provider = new CodexSubscriptionProvider({
        authJsonPath,
        fetchImpl: fetchMock,
      });

      const minted = await provider.mintRunAuth();

      expect(minted.health.status).toBe("ready");
      expect(minted.health.metadata).toEqual({
        accessTokenExpiresAt: "2027-01-15T08:00:00.000Z",
        idTokenExpiresAt: "2027-01-15T08:00:00.000Z",
        lastRefresh: "2026-06-01T00:00:00.000Z",
        hasRefreshToken: true,
        refreshRequired: false,
      });
      const mintedAuthJson = JSON.parse(minted.auth.CODEX_AUTH_JSON!);
      expect(mintedAuthJson).toEqual({
        tokens: {
          access_token: makeJwt({ exp: 1_800_000_000 }),
          id_token: makeJwt({ exp: 1_800_000_000 }),
          refresh_token: "",
          account_id: "acct-123",
        },
        last_refresh: "2026-06-01T00:00:00.000Z",
      });
      expect(JSON.stringify(mintedAuthJson)).not.toContain("refresh-token");
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns Codex quota windows from the authd-owned auth snapshot", async () => {
    const dir = makeTempDir();
    try {
      const authJsonPath = path.join(dir, "codex", "auth.json");
      mkdirSync(path.dirname(authJsonPath), { recursive: true });
      const raw = JSON.stringify({
        tokens: {
          access_token: makeJwt({ exp: 1_800_000_000 }),
          id_token: makeJwt({ exp: 1_800_000_000 }),
          refresh_token: "refresh-token",
          account_id: "acct-123",
        },
      });
      writeFileSync(authJsonPath, raw);

      const quotaWindowsImpl = vi.fn().mockResolvedValue([
        {
          label: "5h limit",
          usedPercent: 19,
          resetsAt: "2026-06-25T05:00:00.000Z",
          valueLabel: null,
          detail: null,
        },
      ]);
      const provider = new CodexSubscriptionProvider({
        authJsonPath,
        quotaWindowsImpl,
      });

      const quota = await provider.quota();

      expect(quota).toEqual({
        provider: "openai",
        source: "codex-rpc",
        ok: true,
        windows: [
          {
            label: "5h limit",
            usedPercent: 19,
            resetsAt: "2026-06-25T05:00:00.000Z",
            valueLabel: null,
            detail: null,
          },
        ],
      });
      expect(quotaWindowsImpl).toHaveBeenCalledWith(raw);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("does not mint auth when the local access token is expired", async () => {
    const dir = makeTempDir();
    try {
      const authJsonPath = path.join(dir, "codex", "auth.json");
      mkdirSync(path.dirname(authJsonPath), { recursive: true });
      writeFileSync(authJsonPath, JSON.stringify({
        tokens: {
          access_token: makeJwt({ exp: 1 }),
          id_token: makeJwt({ exp: 1_800_000_000 }),
          refresh_token: "refresh-token",
        },
      }));

      const provider = new CodexSubscriptionProvider({
        authJsonPath,
      });

      const minted = await provider.mintRunAuth();

      expect(minted.health.status).toBe("invalid");
      expect(minted.health.detail).toBe("Codex access token is expired; refresh required.");
      expect(minted.auth).toEqual({});
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("post-mortem classifies expired Codex auth before quota probing", async () => {
    const dir = makeTempDir();
    try {
      const authJsonPath = path.join(dir, "codex", "auth.json");
      mkdirSync(path.dirname(authJsonPath), { recursive: true });
      writeFileSync(authJsonPath, JSON.stringify({
        tokens: {
          access_token: makeJwt({ exp: 1 }),
          id_token: makeJwt({ exp: 1_800_000_000 }),
          refresh_token: "refresh-token",
        },
      }));

      const quotaWindowsImpl = vi.fn();
      const provider = new CodexSubscriptionProvider({
        authJsonPath,
        quotaWindowsImpl,
      });

      const postMortem = await provider.postMortem({ failureType: "auth", message: "token expired" });

      expect(postMortem.diagnosis).toBe("auth_invalid");
      expect(postMortem.health.status).toBe("invalid");
      expect(postMortem.quota).toEqual({
        provider: "openai",
        source: "codex-rpc",
        ok: false,
        error: "Codex access token is expired; refresh required.",
        windows: [],
      });
      expect(quotaWindowsImpl).not.toHaveBeenCalled();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("refreshes tokens via OAuth2 when no refreshCommand is set", async () => {
    const dir = makeTempDir();
    try {
      const authJsonPath = path.join(dir, "codex", "auth.json");
      mkdirSync(path.dirname(authJsonPath), { recursive: true });
      const originalAuth = {
        auth_mode: "chatgpt",
        tokens: {
          access_token: "old-access",
          refresh_token: "old-refresh",
          id_token: "old-id",
          account_id: "acct-123",
        },
        last_refresh: "2026-01-01T00:00:00Z",
      };
      writeFileSync(authJsonPath, JSON.stringify(originalAuth));

      const oauthResponse = {
        access_token: "new-access",
        refresh_token: "new-refresh",
        id_token: "new-id",
        expires_in: 864000,
      };

      const fetchMock = vi.fn().mockImplementation((url: string) => {
        if (url.includes("auth.openai.com")) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve(oauthResponse),
          });
        }
        return Promise.resolve({ status: 200 });
      });

      const provider = new CodexSubscriptionProvider({
        authJsonPath,
        fetchImpl: fetchMock,
      });

      const health = await provider.refresh();
      expect(health.status).toBe("ready");

      // Verify OAuth2 refresh was called with correct params
      const oauthCall = fetchMock.mock.calls.find((c: any[]) => c[0].includes("auth.openai.com"));
      expect(oauthCall).toBeDefined();
      const body = JSON.parse(oauthCall![1].body);
      expect(body.grant_type).toBe("refresh_token");
      expect(body.refresh_token).toBe("old-refresh");

      // Verify auth.json was updated
      const updated = JSON.parse(readFileSync(authJsonPath, "utf8"));
      expect(updated.tokens.access_token).toBe("new-access");
      expect(updated.tokens.refresh_token).toBe("new-refresh");
      expect(updated.tokens.id_token).toBe("new-id");
      expect(updated.tokens.account_id).toBe("acct-123"); // preserved
      expect(updated.auth_mode).toBe("chatgpt"); // preserved
      expect(updated.last_refresh).not.toBe("2026-01-01T00:00:00Z"); // updated
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns local health without OAuth refresh when no refresh_token is present", async () => {
    const dir = makeTempDir();
    try {
      const authJsonPath = path.join(dir, "codex", "auth.json");
      mkdirSync(path.dirname(authJsonPath), { recursive: true });
      writeFileSync(authJsonPath, JSON.stringify({
        accessToken: makeJwt({ exp: 1_800_000_000 }),
        idToken: makeJwt({ exp: 1_800_000_000 }),
      }));

      const fetchMock = vi.fn();
      const provider = new CodexSubscriptionProvider({
        authJsonPath,
        fetchImpl: fetchMock,
      });

      const health = await provider.refresh();
      expect(health.status).toBe("ready");
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("keeps current Codex auth usable when OAuth refresh fails but access token is still valid", async () => {
    const dir = makeTempDir();
    try {
      const authJsonPath = path.join(dir, "codex", "auth.json");
      mkdirSync(path.dirname(authJsonPath), { recursive: true });
      const accessToken = makeJwt({ exp: 1_800_000_000 });
      const idToken = makeJwt({ exp: 1_800_000_000 });
      writeFileSync(authJsonPath, JSON.stringify({
        tokens: {
          access_token: accessToken,
          id_token: idToken,
          refresh_token: "revoked-refresh",
          account_id: "acct-123",
        },
      }));

      const provider = new CodexSubscriptionProvider({
        authJsonPath,
        fetchImpl: vi.fn()
          .mockResolvedValueOnce({
            ok: false,
            status: 401,
            text: async () => "{\"error\":\"refresh_token_invalidated\"}",
          })
          .mockResolvedValueOnce({
            ok: true,
            status: 200,
            text: async () => "{}",
          }),
      });

      const health = await provider.refresh();
      const after = await provider.health();
      const minted = await provider.mintRunAuth();

      expect(health.status).toBe("ready");
      expect(health.detail).toBe("Codex OAuth refresh failed with 401; using current access token until expiry.");
      expect(health.metadata).toMatchObject({
        refreshStatus: "failed_current_access_valid",
        refreshFailure: "Codex OAuth refresh failed with 401.",
      });
      expect(after.status).toBe("ready");
      expect(minted.auth).toEqual({
        CODEX_AUTH_JSON: JSON.stringify({
          tokens: {
            access_token: accessToken,
            id_token: idToken,
            refresh_token: "",
            account_id: "acct-123",
          },
        }),
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("marks OAuth refresh failures as invalid when Codex rejects the current access token", async () => {
    const dir = makeTempDir();
    try {
      const authJsonPath = path.join(dir, "codex", "auth.json");
      mkdirSync(path.dirname(authJsonPath), { recursive: true });
      writeFileSync(authJsonPath, JSON.stringify({
        tokens: {
          access_token: makeJwt({ exp: 1_800_000_000 }),
          id_token: makeJwt({ exp: 1_800_000_000 }),
          refresh_token: "revoked-refresh",
          account_id: "acct-123",
        },
      }));

      const provider = new CodexSubscriptionProvider({
        authJsonPath,
        fetchImpl: vi.fn()
          .mockResolvedValueOnce({
            ok: false,
            status: 401,
            text: async () => "{\"error\":\"refresh_token_invalidated\"}",
          })
          .mockResolvedValueOnce({
            ok: false,
            status: 401,
            text: async () => "{\"error\":\"refresh_token_invalidated\"}",
          }),
      });

      const health = await provider.refresh();
      const after = await provider.health();
      const minted = await provider.mintRunAuth();

      expect(health.status).toBe("invalid");
      expect(health.detail).toBe("Codex OAuth refresh failed with 401; current access token was rejected by Codex.");
      expect(after.status).toBe("invalid");
      expect(minted.auth).toEqual({});
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("marks OAuth refresh failures as invalid when local access token is expired", async () => {
    const dir = makeTempDir();
    try {
      const authJsonPath = path.join(dir, "codex", "auth.json");
      mkdirSync(path.dirname(authJsonPath), { recursive: true });
      writeFileSync(authJsonPath, JSON.stringify({
        tokens: {
          access_token: makeJwt({ exp: 1 }),
          id_token: makeJwt({ exp: 1_800_000_000 }),
          refresh_token: "revoked-refresh",
        },
      }));

      const provider = new CodexSubscriptionProvider({
        authJsonPath,
        fetchImpl: vi.fn().mockResolvedValue({
          ok: false,
          status: 401,
          text: async () => "{\"error\":\"refresh_token_invalidated\"}",
        }),
      });

      const health = await provider.refresh();
      const after = await provider.health();
      const minted = await provider.mintRunAuth();

      expect(health.status).toBe("invalid");
      expect(health.detail).toBe("Codex OAuth refresh failed with 401.");
      expect(after.status).toBe("invalid");
      expect(after.detail).toBe("Codex access token is expired; refresh required.");
      expect(minted.auth).toEqual({});
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("runs refresh command and picks up a new auth.json", async () => {
    const dir = makeTempDir();
    try {
      const authJsonPath = path.join(dir, "codex", "auth.json");
      mkdirSync(path.dirname(authJsonPath), { recursive: true });
      writeFileSync(authJsonPath, JSON.stringify({
        accessToken: makeJwt({ exp: 1 }),
        idToken: makeJwt({ exp: 1_800_000_000 }),
      }));
      const freshToken = makeJwt({ exp: 1_800_000_000 });
      const freshIdToken = makeJwt({ exp: 1_800_000_000 });

      const provider = new CodexSubscriptionProvider({
        authJsonPath,
        refreshCommand: `printf '%s' '${JSON.stringify({ accessToken: freshToken, idToken: freshIdToken })}' > ${JSON.stringify(authJsonPath)}`,
      });

      const before = await provider.health();
      const after = await provider.refresh();
      const minted = await provider.mintRunAuth();

      expect(before.status).toBe("invalid");
      expect(after.status).toBe("ready");
      expect(minted.auth).toEqual({
        CODEX_AUTH_JSON: JSON.stringify({
          accessToken: freshToken,
          idToken: freshIdToken,
          tokens: {
            access_token: freshToken,
            id_token: freshIdToken,
            refresh_token: "",
          },
        }),
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
