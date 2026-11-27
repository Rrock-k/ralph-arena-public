import { mkdtempSync, readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const ORIGINAL_ENV = { ...process.env };
const TEST_AUTH_KEYS = [
  "CLAUDE_CODE_OAUTH_TOKEN",
  "CLAUDE_CODE_OAUTH_REFRESH_TOKEN",
  "ANTHROPIC_API_KEY",
  "CODEX_AUTH_JSON",
  "OPENAI_API_KEY",
  "OPENAI_BASE_URL",
  "OPENAI_API_BASE",
  "OPENCODE_API_KEY",
  "ANTIGRAVITY_AUTH_JSON",
] as const;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
  process.env = { ...ORIGINAL_ENV };
});

async function importAuthWithTempDirs() {
  const workDir = mkdtempSync(path.join(tmpdir(), "arena-runner-auth-work-"));
  const homeDir = mkdtempSync(path.join(tmpdir(), "arena-runner-auth-home-"));
  process.env.ARENA_WORKSPACE_DIR = workDir;
  process.env.HOME = homeDir;
  for (const key of TEST_AUTH_KEYS) {
    delete process.env[key];
  }
  vi.resetModules();
  const mod = await import("./auth.js");
  return { mod, workDir, homeDir };
}

describe("runner auth", () => {
  it("preserves OpenAI proxy auth without logging the sentinel key into Codex", async () => {
    const { mod, workDir, homeDir } = await importAuthWithTempDirs();
    const codexDir = path.join(homeDir, ".codex");
    const codexAuthPath = path.join(codexDir, "auth.json");
    mkdirSync(codexDir, { recursive: true });
    writeFileSync(codexAuthPath, JSON.stringify({ stale: true }));

    mod.applyRunnerAuth({
      OPENAI_API_KEY: "arena-proxy",
      OPENAI_BASE_URL: "http://api-proxy:4100/openai/project/project-1",
      OPENAI_API_BASE: "http://api-proxy:4100/openai/project/project-1",
    }, "proxy-v1");

    const snapshot = JSON.parse(readFileSync(path.join(workDir, ".arena", "auth.json"), "utf8"));
    expect(snapshot.auth).toMatchObject({
      OPENAI_API_KEY: "arena-proxy",
      OPENAI_BASE_URL: "http://api-proxy:4100/openai/project/project-1",
      OPENAI_API_BASE: "http://api-proxy:4100/openai/project/project-1",
    });
    expect(process.env.OPENAI_BASE_URL).toBe("http://api-proxy:4100/openai/project/project-1");
    expect(existsSync(codexAuthPath)).toBe(false);
  });

  it("probes OpenAI API-key auth through OPENAI_BASE_URL when present", async () => {
    const { mod } = await importAuthWithTempDirs();
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 503 }));
    vi.stubGlobal("fetch", fetchMock);
    process.env.OPENAI_API_KEY = "arena-proxy";
    process.env.OPENAI_BASE_URL = "http://api-proxy:4100/openai/project/project-1";

    await expect(mod.isTokenAlive("codex")).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://api-proxy:4100/openai/project/project-1/models",
      expect.objectContaining({
        headers: { Authorization: "Bearer arena-proxy" },
      }),
    );
  });

  it("does not reject Claude Code OAuth by probing it as an Anthropic API key", async () => {
    const { mod } = await importAuthWithTempDirs();
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 401 }));
    vi.stubGlobal("fetch", fetchMock);
    process.env.CLAUDE_CODE_OAUTH_TOKEN = "claude-code-oauth-token";

    await expect(mod.isTokenAlive("claude-code")).resolves.toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("still probes Anthropic API-key auth through the public models API", async () => {
    const { mod } = await importAuthWithTempDirs();
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 401 }));
    vi.stubGlobal("fetch", fetchMock);
    process.env.ANTHROPIC_API_KEY = "anthropic-api-key";

    await expect(mod.isTokenAlive("claude-code")).resolves.toBe(false);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.anthropic.com/v1/models",
      expect.objectContaining({
        headers: expect.objectContaining({
          "x-api-key": "anthropic-api-key",
        }),
      }),
    );
  });

  it("clears stale auth keys that are absent from the latest auth snapshot", async () => {
    const { mod } = await importAuthWithTempDirs();

    mod.applyRunnerAuth({
      CODEX_AUTH_JSON: JSON.stringify({ accessToken: "stale" }),
      OPENAI_API_KEY: "old-key",
    }, "authd-v1");
    mod.applyRunnerAuth({
      OPENAI_API_KEY: "arena-proxy",
      OPENAI_BASE_URL: "http://api-proxy:4100/openai/project/project-1",
    }, "proxy-v1");

    expect(process.env.CODEX_AUTH_JSON).toBeUndefined();
    expect(process.env.OPENAI_API_KEY).toBe("arena-proxy");
    expect(process.env.OPENAI_BASE_URL).toBe("http://api-proxy:4100/openai/project/project-1");
  });

  it("drops legacy Claude refresh tokens from runtime env and auth snapshots", async () => {
    const { mod, workDir } = await importAuthWithTempDirs();

    process.env.CLAUDE_CODE_OAUTH_TOKEN = "claude-access";
    process.env.CLAUDE_CODE_OAUTH_REFRESH_TOKEN = "claude-refresh";
    mod.applyRunnerAuth();

    let snapshot = JSON.parse(readFileSync(path.join(workDir, ".arena", "auth.json"), "utf8"));
    expect(snapshot.auth).toEqual({
      CLAUDE_CODE_OAUTH_TOKEN: "claude-access",
    });
    expect(process.env.CLAUDE_CODE_OAUTH_TOKEN).toBe("claude-access");
    expect(process.env.CLAUDE_CODE_OAUTH_REFRESH_TOKEN).toBeUndefined();

    writeFileSync(path.join(workDir, ".arena", "auth.json"), JSON.stringify({
      auth: {
        CLAUDE_CODE_OAUTH_TOKEN: "persisted-access",
        CLAUDE_CODE_OAUTH_REFRESH_TOKEN: "persisted-refresh",
      },
    }));

    snapshot = mod.readAuthSnapshot();
    expect(snapshot.auth).toEqual({
      CLAUDE_CODE_OAUTH_TOKEN: "persisted-access",
    });
  });

  it("keeps project secrets below runner auth when building child env", async () => {
    const { mod } = await importAuthWithTempDirs();

    const merged = mod.mergeProjectSecretsBelowRunnerEnv(
      {
        CLAUDE_CODE_OAUTH_TOKEN: "authd-claude-access",
        OPENAI_API_KEY: "arena-proxy",
        OPENAI_BASE_URL: "http://api-proxy:4100/openai/project/project-1",
        ARENA_PROJECT_ID: "project-1",
        UNSET_PLATFORM_VALUE: undefined,
      },
      {
        CLAUDE_CODE_OAUTH_TOKEN: "project-claude-access",
        OPENAI_API_KEY: "project-openai-key",
        OPENAI_BASE_URL: "https://project-openai.example/v1",
        ANTHROPIC_API_KEY: "project-anthropic-key",
        OPENCODE_API_KEY: "project-opencode-key",
        ARENA_PROJECT_ID: "project-secret",
        APP_PRIVATE_TOKEN: "app-private-token",
      },
    );

    expect(merged).toEqual({
      CLAUDE_CODE_OAUTH_TOKEN: "authd-claude-access",
      OPENAI_API_KEY: "arena-proxy",
      OPENAI_BASE_URL: "http://api-proxy:4100/openai/project/project-1",
      ARENA_PROJECT_ID: "project-1",
      APP_PRIVATE_TOKEN: "app-private-token",
    });
    expect(merged.UNSET_PLATFORM_VALUE).toBeUndefined();
    expect(merged.ANTHROPIC_API_KEY).toBeUndefined();
    expect(merged.OPENCODE_API_KEY).toBeUndefined();
  });

  it("removes stale Codex disk auth when the next snapshot has no OpenAI auth", async () => {
    const { mod, homeDir } = await importAuthWithTempDirs();
    const codexDir = path.join(homeDir, ".codex");
    const codexAuthPath = path.join(codexDir, "auth.json");
    mkdirSync(codexDir, { recursive: true });

    mod.applyRunnerAuth({
      CODEX_AUTH_JSON: JSON.stringify({ accessToken: "stale" }),
    }, "codex-v1");
    expect(existsSync(codexAuthPath)).toBe(true);

    mod.applyRunnerAuth({
      ANTHROPIC_API_KEY: "anthropic-key",
    }, "anthropic-v1");

    expect(process.env.CODEX_AUTH_JSON).toBeUndefined();
    expect(process.env.OPENAI_API_KEY).toBeUndefined();
    expect(process.env.ANTHROPIC_API_KEY).toBe("anthropic-key");
    expect(existsSync(codexAuthPath)).toBe(false);
  });

  it("treats Antigravity as a separate auth boundary", async () => {
    const { mod } = await importAuthWithTempDirs();

    expect(mod.hasRelevantAuth("antigravity", {})).toBe(false);
    await expect(mod.isTokenAlive("antigravity")).resolves.toBe(false);

    mod.applyRunnerAuth({
      ANTIGRAVITY_AUTH_JSON: JSON.stringify({ session: "agy" }),
    }, "agy-v1");

    expect(process.env.ANTIGRAVITY_AUTH_JSON).toBe(JSON.stringify({ session: "agy" }));
    expect(mod.hasRelevantAuth("antigravity", mod.readAuthSnapshot().auth)).toBe(false);
    await expect(mod.isTokenAlive("antigravity")).resolves.toBe(false);
  });

  it("treats OpenCode Zen free mode as credentialless with an optional API key", async () => {
    const { mod } = await importAuthWithTempDirs();
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    expect(mod.hasRelevantAuth("opencode", {})).toBe(true);
    await expect(mod.isTokenAlive("opencode")).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://opencode.ai/zen/v1/models",
      expect.objectContaining({
        headers: {},
      }),
    );

    process.env.OPENCODE_API_KEY = "opencode-key";
    expect(mod.hasRelevantAuth("opencode", { OPENCODE_API_KEY: "opencode-key" })).toBe(true);
    await expect(mod.isTokenAlive("opencode")).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://opencode.ai/zen/v1/models",
      expect.objectContaining({
        headers: { Authorization: "Bearer opencode-key" },
      }),
    );
  });
});
