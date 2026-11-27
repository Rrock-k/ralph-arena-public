import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "fs";
import os from "os";
import path from "path";
import { ClaudeOAuthProvider, parseClaudeCredentials } from "../providers/claude.js";

function makeTempDir(): string {
  return mkdtempSync(path.join(os.tmpdir(), "authd-claude-test-"));
}

function makeCredentials(overrides?: Record<string, unknown>): string {
  return JSON.stringify({
    claudeAiOauth: {
      accessToken: "claude-access-token",
      refreshToken: "claude-refresh-token",
      expiresAt: "2026-03-29T00:00:00.000Z",
      scopes: ["org:create_api_key"],
      subscriptionType: "max",
      rateLimitTier: "default_claude_max_5x",
      ...overrides,
    },
  });
}

describe("parseClaudeCredentials", () => {
  it("extracts claudeAiOauth fields from native credentials JSON", () => {
    expect(parseClaudeCredentials(makeCredentials())).toEqual({
      rawCredentials: makeCredentials(),
      detail: null,
      state: {
        accessToken: "claude-access-token",
        refreshToken: "claude-refresh-token",
        expiresAt: "2026-03-29T00:00:00.000Z",
        scopes: ["org:create_api_key"],
        subscriptionType: "max",
        rateLimitTier: "default_claude_max_5x",
      },
    });
  });
});

describe("ClaudeOAuthProvider", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reports missing when the credentials file does not exist", async () => {
    const dir = makeTempDir();
    try {
      const provider = new ClaudeOAuthProvider({
        credentialsPath: path.join(dir, ".claude", ".credentials.json"),
      });

      const health = await provider.health();
      const minted = await provider.mintRunAuth();

      expect(health.status).toBe("missing");
      expect(minted.auth).toEqual({});
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("marks malformed credentials as invalid", async () => {
    const dir = makeTempDir();
    try {
      const credentialsPath = path.join(dir, ".claude", ".credentials.json");
      mkdirSync(path.dirname(credentialsPath), { recursive: true });
      writeFileSync(credentialsPath, JSON.stringify({ oauthAccount: { emailAddress: "x@y.z" } }));

      const provider = new ClaudeOAuthProvider({ credentialsPath });
      const minted = await provider.mintRunAuth();

      expect(minted.health.status).toBe("invalid");
      expect(minted.auth).toEqual({});
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns a Claude env snapshot when the probe succeeds", async () => {
    const dir = makeTempDir();
    try {
      const credentialsPath = path.join(dir, ".claude", ".credentials.json");
      mkdirSync(path.dirname(credentialsPath), { recursive: true });
      writeFileSync(credentialsPath, makeCredentials());

      const fetchMock = vi.fn().mockResolvedValue({ status: 200, ok: true });
      const provider = new ClaudeOAuthProvider({
        credentialsPath,
        fetchImpl: fetchMock,
      });

      const minted = await provider.mintRunAuth();

      expect(minted.health.status).toBe("ready");
      expect(minted.auth).toEqual({
        CLAUDE_CODE_OAUTH_TOKEN: "claude-access-token",
      });
      expect(fetchMock).toHaveBeenCalledWith(
        "https://api.anthropic.com/api/oauth/usage",
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: "Bearer claude-access-token",
            "anthropic-beta": "oauth-2025-04-20",
          }),
        }),
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns Claude quota windows from the authd-owned OAuth snapshot", async () => {
    const dir = makeTempDir();
    try {
      const credentialsPath = path.join(dir, ".claude", ".credentials.json");
      mkdirSync(path.dirname(credentialsPath), { recursive: true });
      writeFileSync(credentialsPath, makeCredentials());

      const fetchMock = vi.fn()
        .mockResolvedValueOnce({ status: 200 })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            five_hour: {
              utilization: 0.75,
              resets_at: "2026-06-25T05:00:00.000Z",
            },
          }),
        });
      const provider = new ClaudeOAuthProvider({
        credentialsPath,
        fetchImpl: fetchMock,
      });

      const quota = await provider.quota();

      expect(quota).toEqual({
        provider: "anthropic",
        source: "anthropic-oauth",
        ok: true,
        windows: [
          {
            label: "Current session",
            usedPercent: 75,
            resetsAt: "2026-06-25T05:00:00.000Z",
            valueLabel: null,
            detail: null,
          },
        ],
      });
      expect(fetchMock).toHaveBeenNthCalledWith(
        2,
        "https://api.anthropic.com/api/oauth/usage",
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: "Bearer claude-access-token",
            "anthropic-beta": "oauth-2025-04-20",
          }),
        }),
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("post-mortem classifies malformed Claude credentials without probing external quota", async () => {
    const dir = makeTempDir();
    try {
      const credentialsPath = path.join(dir, ".claude", ".credentials.json");
      mkdirSync(path.dirname(credentialsPath), { recursive: true });
      writeFileSync(credentialsPath, JSON.stringify({ oauthAccount: { emailAddress: "x@y.z" } }));

      const fetchMock = vi.fn();
      const provider = new ClaudeOAuthProvider({
        credentialsPath,
        fetchImpl: fetchMock,
      });

      const postMortem = await provider.postMortem({ failureType: "auth", message: "401" });

      expect(postMortem.diagnosis).toBe("auth_invalid");
      expect(postMortem.health.status).toBe("invalid");
      expect(postMortem.quota).toEqual({
        provider: "anthropic",
        source: "anthropic-oauth",
        ok: false,
        error: "Claude credentials file is missing claudeAiOauth.",
        windows: [],
      });
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("marks Claude OAuth credentials invalid when the OAuth usage API returns 401", async () => {
    const dir = makeTempDir();
    try {
      const credentialsPath = path.join(dir, ".claude", ".credentials.json");
      mkdirSync(path.dirname(credentialsPath), { recursive: true });
      writeFileSync(credentialsPath, makeCredentials({ accessToken: "claude-code-oauth-token" }));

      const provider = new ClaudeOAuthProvider({
        credentialsPath,
        fetchImpl: vi.fn().mockResolvedValue({ status: 401 }),
      });

      const minted = await provider.mintRunAuth();

      expect(minted.health.status).toBe("invalid");
      expect(minted.health.detail).toContain("Anthropic OAuth usage API returned 401");
      expect(minted.auth).toEqual({});
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("keeps Claude OAuth credentials ready when the OAuth usage API returns quota 429", async () => {
    const dir = makeTempDir();
    try {
      const credentialsPath = path.join(dir, ".claude", ".credentials.json");
      mkdirSync(path.dirname(credentialsPath), { recursive: true });
      writeFileSync(credentialsPath, makeCredentials({ accessToken: "quota-limited-token" }));

      const provider = new ClaudeOAuthProvider({
        credentialsPath,
        fetchImpl: vi.fn().mockResolvedValue({ status: 429, ok: false }),
      });

      const minted = await provider.mintRunAuth();

      expect(minted.health.status).toBe("ready");
      expect(minted.health.detail).toContain("Claude OAuth credentials are usable");
      expect(minted.auth).toEqual({
        CLAUDE_CODE_OAUTH_TOKEN: "quota-limited-token",
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("reports Claude OAuth quota 429 as provider quota-limited truth", async () => {
    const dir = makeTempDir();
    try {
      const credentialsPath = path.join(dir, ".claude", ".credentials.json");
      mkdirSync(path.dirname(credentialsPath), { recursive: true });
      writeFileSync(credentialsPath, makeCredentials({ accessToken: "quota-limited-token" }));

      const provider = new ClaudeOAuthProvider({
        credentialsPath,
        fetchImpl: vi.fn().mockResolvedValue({ status: 429, ok: false }),
      });

      const quota = await provider.quota();
      const postMortem = await provider.postMortem({ failureType: "quota", message: "429" });

      expect(quota).toEqual({
        provider: "anthropic",
        source: "anthropic-oauth",
        ok: false,
        error: "Anthropic OAuth usage API returned 429; quota is currently limited.",
        windows: [],
      });
      expect(postMortem.health.status).toBe("ready");
      expect(postMortem.diagnosis).toBe("quota_limited");
      expect(postMortem.detail).toBe("Anthropic OAuth usage API returned 429; quota is currently limited.");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("keeps minting auth when the probe fails due to network uncertainty", async () => {
    const dir = makeTempDir();
    try {
      const credentialsPath = path.join(dir, ".claude", ".credentials.json");
      mkdirSync(path.dirname(credentialsPath), { recursive: true });
      writeFileSync(credentialsPath, makeCredentials({ accessToken: "maybe-valid" }));

      const provider = new ClaudeOAuthProvider({
        credentialsPath,
        fetchImpl: vi.fn().mockRejectedValue(new Error("network down")),
      });

      const minted = await provider.mintRunAuth();

      expect(minted.health.status).toBe("unknown");
      expect(minted.auth).toEqual({
        CLAUDE_CODE_OAUTH_TOKEN: "maybe-valid",
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("runs refresh command before probing health again", async () => {
    const dir = makeTempDir();
    try {
      const credentialsPath = path.join(dir, ".claude", ".credentials.json");
      mkdirSync(path.dirname(credentialsPath), { recursive: true });
      writeFileSync(credentialsPath, makeCredentials({ accessToken: "stale-token" }));

      const fetchMock = vi.fn()
        .mockResolvedValueOnce({ status: 401 })
        .mockResolvedValue({ status: 200, ok: true });

      const refreshedCredentials = makeCredentials({ accessToken: "fresh-token" });
      const provider = new ClaudeOAuthProvider({
        credentialsPath,
        fetchImpl: fetchMock,
        refreshCommand: `printf '%s' '${refreshedCredentials}' > ${JSON.stringify(credentialsPath)}`,
      });

      const before = await provider.health();
      const after = await provider.refresh();
      const minted = await provider.mintRunAuth();

      expect(before.status).toBe("invalid");
      expect(after.status).toBe("ready");
      expect(minted.auth).toEqual({
        CLAUDE_CODE_OAUTH_TOKEN: "fresh-token",
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("falls back to the existing snapshot when refresh fails but current auth is still usable", async () => {
    const dir = makeTempDir();
    try {
      const credentialsPath = path.join(dir, ".claude", ".credentials.json");
      mkdirSync(path.dirname(credentialsPath), { recursive: true });
      writeFileSync(credentialsPath, makeCredentials({ accessToken: "still-valid-token" }));

      const fetchMock = vi.fn().mockResolvedValue({ status: 200, ok: true });
      const provider = new ClaudeOAuthProvider({
        credentialsPath,
        fetchImpl: fetchMock,
        refreshCommand: "echo \"You've hit your limit · resets 9pm (UTC)\" >&2; exit 1",
      });

      const health = await provider.refresh();
      const minted = await provider.mintRunAuth();

      expect(health.status).toBe("ready");
      expect(health.detail).toContain("Refresh command failed; using existing Claude OAuth snapshot.");
      expect(minted.auth).toEqual({
        CLAUDE_CODE_OAUTH_TOKEN: "still-valid-token",
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("still fails refresh when current credentials are malformed", async () => {
    const dir = makeTempDir();
    try {
      const credentialsPath = path.join(dir, ".claude", ".credentials.json");
      mkdirSync(path.dirname(credentialsPath), { recursive: true });
      writeFileSync(credentialsPath, JSON.stringify({ oauthAccount: { emailAddress: "x@y.z" } }));

      const provider = new ClaudeOAuthProvider({
        credentialsPath,
        refreshCommand: "echo refresh failed >&2; exit 1",
      });

      await expect(provider.refresh()).rejects.toThrow();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
