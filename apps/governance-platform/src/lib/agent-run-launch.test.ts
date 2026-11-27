import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  prepareRuntimeLaunch,
  prepareRuntimeLaunchDryRun,
  type AgentRunLaunchProject,
} from "./agent-run-launch";

vi.mock("server-only", () => ({}));

vi.mock("@/lib/crypto", () => ({
  decryptSecret: vi.fn(),
  getEncryptionKey: vi.fn(),
}));

vi.mock("@/lib/project-identity", () => ({
  buildProjectWorkspaceLabel: vi.fn(() => "ant-dream-hea20y"),
}));

  vi.mock("@/lib/project-budget", () => ({
    BUDGET_THRESHOLD_USD: 0.5,
    PLATFORM_CREDITS_BUDGET_REQUIRED_MESSAGE: "Platform Credits project requires a funded budget.",
    formatBudgetBlockedMessage: vi.fn(() => "budget blocked"),
  }));

vi.mock("@/lib/run-auth", () => ({
  buildRunAuthEnvFresh: vi.fn(),
  narrowRunAuthModesForAgent: vi.fn(() => ({
    claudeAuthMode: "oauth",
    codexAuthMode: "chatgpt",
  })),
  resolveRunAuthModesForBuild: vi.fn((modes) => modes),
  RuntimeAuthUnavailableError: class RuntimeAuthUnavailableError extends Error {
    statusCode: number;

    constructor(message: string, statusCode: number) {
      super(message);
      this.statusCode = statusCode;
    }
  },
}));

function buildProject(overrides: Partial<AgentRunLaunchProject> = {}): AgentRunLaunchProject {
  return {
    id: "project-1",
    name: "Ant Dream",
    slug: "ant-dream",
    proposalId: null,
    proposal: { title: "Ant Dream" },
    ownerScopeType: "user",
    ownerScopeId: "user-1",
    providerBillingMode: "byok",
    cycleImage: "arena-public-worker:local",
    envOverrides: null,
    agent: "codex",
    agentImpl: "ralph",
    model: "gpt-5.4",
    claudeAuthMode: null,
    codexAuthMode: "chatgpt",
    budget: null,
    secrets: [],
    components: [{
      kind: "app",
      agentIntent: "ON",
      runtimeConfig: {},
    }],
    ...overrides,
  } as AgentRunLaunchProject;
}

describe("prepareRuntimeLaunch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.RUNNER_WEBHOOK_SECRET = "runner-secret";
    process.env.API_PROXY_SECRET = "api-proxy-secret";
    process.env.GOVERNANCE_INTERNAL_URL = "http://governance-platform:3000";
    delete process.env.GOVERNANCE_PUBLIC_URL;
    delete process.env.AUTH_URL;
    delete process.env.NEXTAUTH_URL;
    process.env.API_PROXY_URL = "http://api-proxy:4100";
    delete process.env.LANGFUSE_BASE_URL;
    delete process.env.LANGFUSE_PUBLIC_KEY;
    delete process.env.LANGFUSE_SECRET_KEY;
  });

  it("stamps runtime intent runner mode into the runner env for preview boots", async () => {
    process.env.GOVERNANCE_PUBLIC_URL = "https://app.arena.example.test/";
    const result = await prepareRuntimeLaunch(buildProject(), "local", "preview_only");

    expect(result).toEqual({
      ok: true,
      payload: expect.objectContaining({
        workspaceLabel: "ant-dream-hea20y",
        env: expect.objectContaining({
          ARENA_RUNTIME_INTENT_RUNNER_MODE: "preview_only",
          ARENA_GOVERNANCE_URL: "http://governance-platform:3000",
          ARENA_GOVERNANCE_PUBLIC_URL: "https://app.arena.example.test",
        }),
      }),
    });
  });

  it("omits Telegram preview public origin when only internal governance URL is configured", async () => {
    const result = await prepareRuntimeLaunch(buildProject(), "local", "preview_only");

    expect(result).toEqual({
      ok: true,
      payload: expect.objectContaining({
        env: expect.not.objectContaining({
          ARENA_GOVERNANCE_PUBLIC_URL: expect.any(String),
        }),
      }),
    });
  });

  it("does not infer Telegram preview public origin from auth callback URLs", async () => {
    process.env.AUTH_URL = "https://auth.arena.example.test";
    process.env.NEXTAUTH_URL = "https://nextauth.arena.example.test";

    const result = await prepareRuntimeLaunch(buildProject(), "local", "preview_only");

    expect(result).toEqual({
      ok: true,
      payload: expect.objectContaining({
        env: expect.not.objectContaining({
          ARENA_GOVERNANCE_PUBLIC_URL: expect.any(String),
        }),
      }),
    });
  });

  it("stamps runtime intent runner mode into the runner env for agent runs", async () => {
    const result = await prepareRuntimeLaunch(buildProject(), "local", "agent_run");

    const { buildRunAuthEnvFresh } = await import("@/lib/run-auth");
    expect(buildRunAuthEnvFresh).toHaveBeenCalledWith(
      { claudeAuthMode: "oauth", codexAuthMode: "chatgpt" },
      { agent: "codex", userId: "user-1" },
    );

    expect(result).toEqual({
      ok: true,
      payload: expect.objectContaining({
        workspaceLabel: "ant-dream-hea20y",
        env: expect.objectContaining({
          ARENA_RUNTIME_INTENT_RUNNER_MODE: "agent_run",
          ARENA_PROVIDER_BILLING_MODE: "byok",
        }),
      }),
    });
  });

  it("uses proxy-only auth for user-owned Platform Credits runs", async () => {
    const result = await prepareRuntimeLaunch(buildProject({
      providerBillingMode: "platform_credits",
      budget: { isEnabled: true, totalCreditsUsd: 5, usedCreditsUsd: 1 },
    }), "local", "agent_run");

    const { buildRunAuthEnvFresh } = await import("@/lib/run-auth");
    expect(buildRunAuthEnvFresh).not.toHaveBeenCalled();
    expect(result).toEqual({
      ok: true,
      payload: expect.objectContaining({
        env: expect.objectContaining({
          ARENA_PROVIDER_BILLING_MODE: "platform_credits",
          OPENAI_API_KEY: "arena-proxy",
          OPENAI_BASE_URL: "http://api-proxy:4100/openai/project/project-1",
        }),
      }),
    });
  });

  it("blocks Platform Credits agent runs when the required budget is missing", async () => {
    const result = await prepareRuntimeLaunch(buildProject({
      providerBillingMode: "platform_credits",
      budget: null,
    }), "local", "agent_run");

    expect(result).toEqual({
      ok: false,
      kind: "budget_blocked",
      message: "Platform Credits project requires a funded budget.",
    });
  });

  it("blocks Platform Credits agent runs when an enabled budget is exhausted", async () => {
    const result = await prepareRuntimeLaunch(buildProject({
      providerBillingMode: "platform_credits",
      budget: { isEnabled: true, totalCreditsUsd: 5, usedCreditsUsd: 4.8 },
    }), "local", "agent_run");

    expect(result).toEqual({
      ok: false,
      kind: "budget_blocked",
      message: "budget blocked",
    });
  });

  it("does not let legacy budgets block Platform Credentials agent runs", async () => {
    const result = await prepareRuntimeLaunch(buildProject({
      providerBillingMode: "platform_credentials",
      budget: { isEnabled: true, totalCreditsUsd: 10, usedCreditsUsd: 10 },
    }), "local", "agent_run");

    expect(result).toEqual({
      ok: true,
      payload: expect.objectContaining({
        env: expect.objectContaining({
          ARENA_PROVIDER_BILLING_MODE: "platform_credentials",
        }),
      }),
    });
  });

  it("blocks Platform Credentials API-key agent runs when shared runtime auth is unavailable", async () => {
    const { buildRunAuthEnvFresh, RuntimeAuthUnavailableError } = await import("@/lib/run-auth");
    vi.mocked(buildRunAuthEnvFresh).mockRejectedValueOnce(
      new RuntimeAuthUnavailableError("Shared OpenAI API key is required for this run but is not configured.", 503),
    );

    const result = await prepareRuntimeLaunch(buildProject({
      providerBillingMode: "platform_credentials",
      codexAuthMode: "api_key",
    }), "local", "agent_run");

    expect(result).toEqual({
      ok: false,
      kind: "auth_unavailable",
      message: "Shared OpenAI API key is required for this run but is not configured.",
      statusCode: 503,
    });
  });

  it("passes complete Langfuse env into runtime launches", async () => {
    process.env.LANGFUSE_BASE_URL = " https://cloud.langfuse.com/ ";
    process.env.LANGFUSE_PUBLIC_KEY = " pk-lf-test ";
    process.env.LANGFUSE_SECRET_KEY = " sk-lf-test ";

    const result = await prepareRuntimeLaunch(buildProject(), "local", "agent_run");

    expect(result).toEqual({
      ok: true,
      payload: expect.objectContaining({
        env: expect.objectContaining({
          LANGFUSE_BASE_URL: "https://cloud.langfuse.com/",
          LANGFUSE_PUBLIC_KEY: "pk-lf-test",
          LANGFUSE_SECRET_KEY: "sk-lf-test",
        }),
      }),
    });
  });

  it("keeps Langfuse runtime env platform-owned", async () => {
    process.env.LANGFUSE_BASE_URL = "https://cloud.langfuse.com";
    process.env.LANGFUSE_PUBLIC_KEY = "pk-lf-platform";
    process.env.LANGFUSE_SECRET_KEY = "sk-lf-platform";

    const result = await prepareRuntimeLaunch(buildProject({
      envOverrides: JSON.stringify({
        LANGFUSE_BASE_URL: "https://evil.example",
        LANGFUSE_PUBLIC_KEY: "pk-lf-project",
        LANGFUSE_SECRET_KEY: "sk-lf-project",
        CI: "custom",
      }),
    }), "local", "agent_run");

    expect(result).toEqual({
      ok: true,
      payload: expect.objectContaining({
        env: expect.objectContaining({
          LANGFUSE_BASE_URL: "https://cloud.langfuse.com",
          LANGFUSE_PUBLIC_KEY: "pk-lf-platform",
          LANGFUSE_SECRET_KEY: "sk-lf-platform",
          CI: "custom",
        }),
      }),
    });
  });

  it("keeps provider auth refresh material platform-owned", async () => {
    const { buildRunAuthEnvFresh } = await import("@/lib/run-auth");
    vi.mocked(buildRunAuthEnvFresh).mockResolvedValueOnce({
      CLAUDE_CODE_OAUTH_TOKEN: "authd-claude-access",
      CODEX_AUTH_JSON: JSON.stringify({ accessToken: "authd-codex-access" }),
    });

    const result = await prepareRuntimeLaunch(buildProject({
      envOverrides: JSON.stringify({
        CLAUDE_CODE_OAUTH_TOKEN: "project-claude-access",
        CLAUDE_CODE_OAUTH_REFRESH_TOKEN: "project-claude-refresh",
        CODEX_AUTH_JSON: JSON.stringify({ refreshToken: "project-codex-refresh" }),
        OPENAI_API_KEY: "project-openai-key",
        OPENAI_BASE_URL: "https://project-openai.example/v1",
        OPENAI_API_BASE: "https://project-openai-api-base.example/v1",
        ANTHROPIC_API_KEY: "project-anthropic-key",
        ANTHROPIC_BASE_URL: "https://project-anthropic.example",
        ANTHROPIC_API_URL: "https://project-anthropic-api.example",
        OPENCODE_API_KEY: "project-opencode-key",
        ANTIGRAVITY_AUTH_JSON: JSON.stringify({ session: "project-antigravity" }),
        CI: "custom",
      }),
    }), "local", "agent_run");

    expect(result).toEqual({
      ok: true,
      payload: expect.objectContaining({
        env: expect.objectContaining({
          CLAUDE_CODE_OAUTH_TOKEN: "authd-claude-access",
          CODEX_AUTH_JSON: JSON.stringify({ accessToken: "authd-codex-access" }),
          CI: "custom",
        }),
      }),
    });
    if (!result.ok) throw new Error("expected launch success");
    expect(result.payload.env.CLAUDE_CODE_OAUTH_REFRESH_TOKEN).toBeUndefined();
    expect(result.payload.env.OPENAI_API_KEY).toBeUndefined();
    expect(result.payload.env.OPENAI_BASE_URL).toBeUndefined();
    expect(result.payload.env.OPENAI_API_BASE).toBeUndefined();
    expect(result.payload.env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(result.payload.env.ANTHROPIC_BASE_URL).toBeUndefined();
    expect(result.payload.env.ANTHROPIC_API_URL).toBeUndefined();
    expect(result.payload.env.OPENCODE_API_KEY).toBeUndefined();
    expect(result.payload.env.ANTIGRAVITY_AUTH_JSON).toBeUndefined();
  });

  it("keeps provider auth material out of project secrets in launch env", async () => {
    const { buildRunAuthEnvFresh } = await import("@/lib/run-auth");
    vi.mocked(buildRunAuthEnvFresh).mockResolvedValueOnce({
      CLAUDE_CODE_OAUTH_TOKEN: "authd-claude-access",
      CODEX_AUTH_JSON: JSON.stringify({ accessToken: "authd-codex-access" }),
    });
    const { decryptSecret } = await import("@/lib/crypto");
    vi.mocked(decryptSecret).mockImplementation(({ ciphertext }) => `secret-${ciphertext}`);

    const result = await prepareRuntimeLaunch(buildProject({
      secrets: [
        {
          key: "CLAUDE_CODE_OAUTH_TOKEN",
          encryptedValue: "project-claude-access",
          iv: "iv",
          authTag: "tag",
        },
        {
          key: "OPENAI_API_KEY",
          encryptedValue: "project-openai-key",
          iv: "iv",
          authTag: "tag",
        },
        {
          key: "OPENAI_BASE_URL",
          encryptedValue: "project-openai-base-url",
          iv: "iv",
          authTag: "tag",
        },
        {
          key: "APP_PRIVATE_TOKEN",
          encryptedValue: "project-private-token",
          iv: "iv",
          authTag: "tag",
        },
      ],
    }), "local", "agent_run");

    expect(result).toEqual({
      ok: true,
      payload: expect.objectContaining({
        env: expect.objectContaining({
          CLAUDE_CODE_OAUTH_TOKEN: "authd-claude-access",
          CODEX_AUTH_JSON: JSON.stringify({ accessToken: "authd-codex-access" }),
          APP_PRIVATE_TOKEN: "secret-project-private-token",
        }),
      }),
    });
    if (!result.ok) throw new Error("expected launch success");
    expect(result.payload.env.OPENAI_API_KEY).toBeUndefined();
    expect(result.payload.env.OPENAI_BASE_URL).toBeUndefined();
    expect(decryptSecret).toHaveBeenCalledTimes(1);
  });

  it("dry-runs launch shape without exposing env values or touching auth/secrets", async () => {
    const result = prepareRuntimeLaunchDryRun(buildProject({
      envOverrides: JSON.stringify({ CI: "custom", OPENAI_API_KEY: "blocked" }),
      secrets: [{
        key: "PRIVATE_TOKEN",
        encryptedValue: "ciphertext",
        iv: "iv",
        authTag: "tag",
      }],
      components: [{
        kind: "app",
        agentIntent: "ON",
        runtimeConfig: { memoryMb: 1536, cpuCount: 1.25, cycleImage: "arena-worker:dry-run" },
      }],
    }), "local", "agent_run");

    const { buildRunAuthEnvFresh } = await import("@/lib/run-auth");
    const { decryptSecret } = await import("@/lib/crypto");

    expect(buildRunAuthEnvFresh).not.toHaveBeenCalled();
    expect(decryptSecret).not.toHaveBeenCalled();
    expect(result).toEqual({
      ok: true,
      payload: {
        workspaceLabel: "ant-dream-hea20y",
        workerImage: "arena-worker:dry-run",
        resources: { memoryMb: 1536, cpuCount: 1.25 },
        envSummary: {
          exposesValues: false,
          categories: expect.arrayContaining([
            "arena_core",
            "governance_url",
            "api_proxy",
            "agent_identity",
            "project_env_overrides",
            "project_secrets",
          ]),
          projectEnvOverrideCount: 1,
          projectSecretCount: 1,
          auth: "not_checked",
        },
      },
    });
    expect(JSON.stringify(result)).not.toContain("custom");
    expect(JSON.stringify(result)).not.toContain("ciphertext");
    expect(JSON.stringify(result)).not.toContain("PRIVATE_TOKEN");
  });

  it("dry-runs Platform Credits budget blocks without building provider proxy env", () => {
    const result = prepareRuntimeLaunchDryRun(buildProject({
      providerBillingMode: "platform_credits",
      budget: null,
    }), "local", "agent_run");

    expect(result).toEqual({
      ok: false,
      kind: "budget_blocked",
      message: "Platform Credits project requires a funded budget.",
    });
  });
});
