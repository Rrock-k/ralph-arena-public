import { beforeEach, describe, expect, it, vi } from "vitest";

const triggerRefreshSync = vi.fn();
const triggerRefreshAsync = vi.fn();
const getTokens = vi.fn();
const mintRunAuthFromAuthd = vi.fn();
const isAuthdConfigured = vi.fn(() => false);
const getUserProviderAuthEnv = vi.fn();
const providerForAgent = vi.fn();

vi.mock("./token-manager", () => ({
  getTokenManager: () => ({
    triggerRefreshAsync,
    triggerRefreshSync,
    getTokens,
  }),
}));

vi.mock("./authd-client", () => ({
  mintRunAuthFromAuthd,
  isAuthdConfigured,
}));

vi.mock("@/lib/user-provider-credentials", () => ({
  getUserProviderAuthEnv,
  providerDisplayName: (provider: string) =>
    provider === "openai" ? "OpenAI" : provider === "anthropic" ? "Anthropic" : "OpenCode",
  providerForAgent,
}));

describe("run auth", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    delete process.env.OPENAI_API_KEY;
    isAuthdConfigured.mockReturnValue(false);
    getUserProviderAuthEnv.mockResolvedValue({});
    providerForAgent.mockImplementation((agent: string) => {
      if (agent === "codex") return "openai";
      if (agent === "claude-code") return "anthropic";
      if (agent === "opencode") return "opencode";
      return null;
    });
  });

  it("requires authd for Claude OAuth runtime auth", async () => {
    const { buildRunAuthEnvFresh, RuntimeAuthUnavailableError } = await import("./run-auth");

    await expect(
      buildRunAuthEnvFresh({ claudeAuthMode: "oauth" }),
    ).rejects.toBeInstanceOf(RuntimeAuthUnavailableError);

    expect(triggerRefreshSync).not.toHaveBeenCalled();
  });

  it("returns an empty env snapshot for Antigravity native keyring auth", async () => {
    const { buildRunAuthEnvFresh, buildRunAuthSnapshotFresh, narrowRunAuthModesForAgent } = await import("./run-auth");

    await expect(buildRunAuthEnvFresh(
      { claudeAuthMode: "api_key", codexAuthMode: "api_key" },
      { agent: "antigravity" },
    )).resolves.toEqual({});
    await expect(buildRunAuthSnapshotFresh(
      { claudeAuthMode: "api_key", codexAuthMode: "api_key" },
      { agent: "antigravity" },
    )).resolves.toEqual({ auth: {}, version: undefined });
    expect(narrowRunAuthModesForAgent("antigravity", {
      claudeAuthMode: "oauth",
      codexAuthMode: "subscription",
    })).toEqual({
      claudeAuthMode: null,
      codexAuthMode: null,
    });

    expect(triggerRefreshSync).not.toHaveBeenCalled();
    expect(mintRunAuthFromAuthd).not.toHaveBeenCalled();
  });

  it("narrows OpenCode runtime auth to its separate provider key", async () => {
    const { narrowRunAuthModesForAgent } = await import("./run-auth");

    expect(narrowRunAuthModesForAgent("opencode", {
      claudeAuthMode: "oauth",
      codexAuthMode: "subscription",
    })).toEqual({
      claudeAuthMode: null,
      codexAuthMode: null,
    });
  });

  it("uses authd for fresh OAuth/subscription claim auth when configured", async () => {
    isAuthdConfigured.mockReturnValue(true);
    mintRunAuthFromAuthd.mockResolvedValue({
      CLAUDE_CODE_OAUTH_TOKEN: "authd-claude",
      CODEX_AUTH_JSON: "{\"accessToken\":\"authd-codex\"}",
    });
    getTokens.mockReturnValue({});

    const { buildRunAuthEnvFresh } = await import("./run-auth");
    const authEnv = await buildRunAuthEnvFresh({ claudeAuthMode: "oauth", codexAuthMode: "subscription" });

    expect(mintRunAuthFromAuthd).toHaveBeenCalledWith(
      { claudeAuthMode: "oauth", codexAuthMode: "subscription" },
      { fresh: true },
    );
    expect(triggerRefreshSync).not.toHaveBeenCalled();
    expect(authEnv).toEqual({
      CLAUDE_CODE_OAUTH_TOKEN: "authd-claude",
      CODEX_AUTH_JSON: "{\"accessToken\":\"authd-codex\"}",
    });
  });

  it("merges API-key modes from TokenManager into authd snapshot only when requested", async () => {
    isAuthdConfigured.mockReturnValue(true);
    mintRunAuthFromAuthd.mockResolvedValue({
      CLAUDE_CODE_OAUTH_TOKEN: "authd-claude",
    });
    getTokens.mockImplementation((provider: string) => (
      provider === "openai-api" ? { OPENAI_API_KEY: "shared-openai-key" } : {}
    ));

    const { buildRunAuthEnvFresh } = await import("./run-auth");
    const authEnv = await buildRunAuthEnvFresh({ claudeAuthMode: "oauth", codexAuthMode: "api_key" });

    expect(authEnv).toEqual({
      CLAUDE_CODE_OAUTH_TOKEN: "authd-claude",
      OPENAI_API_KEY: "shared-openai-key",
    });
  });

  it("returns a stable authVersion for authd-backed snapshots", async () => {
    isAuthdConfigured.mockReturnValue(true);
    mintRunAuthFromAuthd.mockResolvedValue({
      CLAUDE_CODE_OAUTH_TOKEN: "authd-claude",
      CODEX_AUTH_JSON: "{\"accessToken\":\"authd-codex\"}",
    });

    const { buildRunAuthSnapshotFresh } = await import("./run-auth");
    const first = await buildRunAuthSnapshotFresh({ claudeAuthMode: "oauth", codexAuthMode: "subscription" });
    const second = await buildRunAuthSnapshotFresh({ claudeAuthMode: "oauth", codexAuthMode: "subscription" });

    expect(first.auth).toEqual(second.auth);
    expect(first.version).toBeDefined();
    expect(first.version).toBe(second.version);
  });

  it("fails fast when authd mint fails for OAuth/subscription runtime auth", async () => {
    isAuthdConfigured.mockReturnValue(true);
    mintRunAuthFromAuthd.mockRejectedValue(new Error("authd unavailable"));

    const { buildRunAuthEnvFresh, RuntimeAuthUnavailableError } = await import("./run-auth");

    await expect(
      buildRunAuthEnvFresh({ claudeAuthMode: "oauth" }),
    ).rejects.toBeInstanceOf(RuntimeAuthUnavailableError);
    await expect(
      buildRunAuthEnvFresh({ claudeAuthMode: "oauth" }),
    ).rejects.toThrow("Runtime auth mint via authd failed: authd unavailable");

    expect(triggerRefreshSync).not.toHaveBeenCalled();
  });

  it("still supports API-key-only snapshots from TokenManager", async () => {
    triggerRefreshAsync.mockReturnValue(undefined);
    getTokens.mockImplementation((provider: string) => {
      if (provider === "claude-api") {
        return { ANTHROPIC_API_KEY: "legacy-claude-key" };
      }
      if (provider === "openai-api") {
        return { OPENAI_API_KEY: "legacy-openai-key" };
      }
      return {};
    });

    const { buildRunAuthSnapshot } = await import("./run-auth");
    const snapshot = await buildRunAuthSnapshot({ claudeAuthMode: "api_key", codexAuthMode: "api_key" });

    expect(snapshot.auth).toEqual({
      ANTHROPIC_API_KEY: "legacy-claude-key",
      OPENAI_API_KEY: "legacy-openai-key",
    });
    expect(snapshot.version).toBeDefined();
    expect(triggerRefreshAsync).toHaveBeenCalledTimes(1);
  });

  it("forces user-owned Codex runs to user OpenAI key instead of authd subscription", async () => {
    getUserProviderAuthEnv.mockResolvedValue({ OPENAI_API_KEY: "user-openai-key" });

    const { buildRunAuthEnvFresh } = await import("./run-auth");
    const authEnv = await buildRunAuthEnvFresh(
      { claudeAuthMode: "api_key", codexAuthMode: "subscription" },
      { agent: "codex", userId: "user-1" },
    );

    expect(mintRunAuthFromAuthd).not.toHaveBeenCalled();
    expect(triggerRefreshSync).not.toHaveBeenCalled();
    expect(getUserProviderAuthEnv).toHaveBeenCalledWith("user-1", "openai");
    expect(authEnv).toEqual({ OPENAI_API_KEY: "user-openai-key" });
  });

  it("uses user-owned OpenCode keys for OpenCode runs", async () => {
    getUserProviderAuthEnv.mockResolvedValue({ OPENCODE_API_KEY: "user-opencode-key" });

    const { buildRunAuthEnvFresh } = await import("./run-auth");
    const authEnv = await buildRunAuthEnvFresh(
      { claudeAuthMode: "oauth", codexAuthMode: "subscription" },
      { agent: "opencode", userId: "user-1" },
    );

    expect(mintRunAuthFromAuthd).not.toHaveBeenCalled();
    expect(triggerRefreshSync).not.toHaveBeenCalled();
    expect(getUserProviderAuthEnv).toHaveBeenCalledWith("user-1", "opencode");
    expect(authEnv).toEqual({ OPENCODE_API_KEY: "user-opencode-key" });
  });

  it("uses shared OpenCode key for platform-credential OpenCode runs", async () => {
    getTokens.mockImplementation((provider: string) => {
      if (provider === "opencode-api") {
        return { OPENCODE_API_KEY: "shared-opencode-key" };
      }
      return {};
    });

    const { buildRunAuthEnvFresh } = await import("./run-auth");
    const authEnv = await buildRunAuthEnvFresh(
      { claudeAuthMode: "oauth", codexAuthMode: "subscription" },
      { agent: "opencode" },
    );

    expect(triggerRefreshSync).toHaveBeenCalledTimes(1);
    expect(mintRunAuthFromAuthd).not.toHaveBeenCalled();
    expect(authEnv).toEqual({ OPENCODE_API_KEY: "shared-opencode-key" });
  });

  it("fails user-owned provider runs when the user key is missing", async () => {
    const { buildRunAuthEnvFresh, RuntimeAuthUnavailableError } = await import("./run-auth");

    await expect(
      buildRunAuthEnvFresh(
        { claudeAuthMode: "oauth", codexAuthMode: "api_key" },
        { agent: "claude-code", userId: "user-1" },
      ),
    ).rejects.toBeInstanceOf(RuntimeAuthUnavailableError);
    await expect(
      buildRunAuthEnvFresh(
        { claudeAuthMode: "oauth", codexAuthMode: "api_key" },
        { agent: "claude-code", userId: "user-1" },
      ),
    ).rejects.toThrow("User anthropic API key is required for this run but is not configured.");

    expect(mintRunAuthFromAuthd).not.toHaveBeenCalled();
  });

  it("allows credentialless OpenCode Zen free runs when the OpenCode key is missing", async () => {
    getUserProviderAuthEnv.mockResolvedValue({});
    const { buildRunAuthEnvFresh } = await import("./run-auth");

    await expect(
      buildRunAuthEnvFresh(
        { claudeAuthMode: "oauth", codexAuthMode: "subscription" },
        { agent: "opencode", userId: "user-1" },
      ),
    ).resolves.toEqual({});

    expect(getUserProviderAuthEnv).toHaveBeenCalledWith("user-1", "opencode");
    expect(mintRunAuthFromAuthd).not.toHaveBeenCalled();
  });

  it("refreshes API-key-only auth synchronously for claim path", async () => {
    triggerRefreshSync.mockResolvedValue(true);
    getTokens.mockImplementation((provider: string) => {
      if (provider === "openai-api") {
        return { OPENAI_API_KEY: "fresh-openai-key" };
      }
      return {};
    });

    const { buildRunAuthEnvFresh } = await import("./run-auth");
    const authEnv = await buildRunAuthEnvFresh({ claudeAuthMode: "api_key", codexAuthMode: "api_key" });

    expect(triggerRefreshSync).toHaveBeenCalledTimes(1);
    expect(authEnv).toEqual({ OPENAI_API_KEY: "fresh-openai-key" });
  });

  it("fails shared Codex API-key runs when the OpenAI key is missing", async () => {
    triggerRefreshSync.mockResolvedValue(true);
    getTokens.mockReturnValue({});

    const { buildRunAuthEnvFresh, RuntimeAuthUnavailableError } = await import("./run-auth");

    await expect(
      buildRunAuthEnvFresh(
        { claudeAuthMode: "api_key", codexAuthMode: "api_key" },
        { agent: "codex" },
      ),
    ).rejects.toBeInstanceOf(RuntimeAuthUnavailableError);
    await expect(
      buildRunAuthEnvFresh(
        { claudeAuthMode: "api_key", codexAuthMode: "api_key" },
        { agent: "codex" },
      ),
    ).rejects.toThrow("Shared OpenAI API key is required for this run but is not configured.");

    expect(triggerRefreshSync).toHaveBeenCalledTimes(2);
  });

  it("narrows codex runtime auth to codex provider only", async () => {
    const { narrowRunAuthModesForAgent } = await import("./run-auth");

    expect(narrowRunAuthModesForAgent("codex", {
      claudeAuthMode: "oauth",
      codexAuthMode: "subscription",
    })).toEqual({
      claudeAuthMode: "api_key",
      codexAuthMode: "subscription",
    });
  });

  it("disables provider auth for non-loop service agents", async () => {
    const { narrowRunAuthModesForAgent } = await import("./run-auth");

    expect(narrowRunAuthModesForAgent("openclaw", {
      claudeAuthMode: null,
      codexAuthMode: null,
    })).toEqual({
      claudeAuthMode: "api_key",
      codexAuthMode: "api_key",
    });
  });
});
