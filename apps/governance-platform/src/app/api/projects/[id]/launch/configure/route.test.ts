import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

vi.mock("server-only", () => ({}));

const { hasPlatformCapability } = vi.hoisted(() => ({
  hasPlatformCapability: vi.fn(() => false),
}));

vi.mock("@/lib/project-access", () => ({
  requireProjectCapability: vi.fn(),
}));

vi.mock("@/lib/telegram-webapp-project-access", () => ({
  requireTelegramWebAppProjectCapability: vi.fn(),
}));

vi.mock("@/lib/platform-access", () => ({
  resolvePlatformAccess: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    project: {
      findUnique: vi.fn(),
    },
    agentLoop: {
      findUnique: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

vi.mock("@/lib/user-launch-policy", () => ({
  enforceUserLaunchPolicy: vi.fn(),
  parseProviderBillingMode: vi.fn((value: string | null | undefined) => (
    value === "byok" || value === "platform_credits" || value === "platform_credentials" ? value : null
  )),
  normalizeAuthModesForProviderBilling: vi.fn((agent: string, mode: string, modes: any) => {
    if (mode === "platform_credits") return { claudeAuthMode: null, codexAuthMode: null };
    if (mode === "byok" && agent === "codex") return { claudeAuthMode: null, codexAuthMode: "api_key" };
    if (mode === "byok" && agent === "claude-code") return { claudeAuthMode: "api_key", codexAuthMode: null };
    return {
      claudeAuthMode: modes.claudeAuthMode ?? null,
      codexAuthMode: modes.codexAuthMode ?? null,
    };
  }),
}));

vi.mock("@/app/actions/credits", () => ({
  reserveUserCreditsForProjectBudget: vi.fn(),
}));

vi.mock("@/lib/progress-bus", () => ({
  notifyProjectChanged: vi.fn(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

import { reserveUserCreditsForProjectBudget } from "@/app/actions/credits";
import { resolvePlatformAccess } from "@/lib/platform-access";
import { prisma } from "@/lib/prisma";
import { requireProjectCapability } from "@/lib/project-access";
import { requireTelegramWebAppProjectCapability } from "@/lib/telegram-webapp-project-access";
import { enforceUserLaunchPolicy } from "@/lib/user-launch-policy";

function context(id = "project-1") {
  return { params: Promise.resolve({ id }) };
}

function request(body: unknown) {
  return new Request("http://localhost/api/projects/project-1/launch/configure", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function telegramRequest(body: unknown) {
  return new Request("http://localhost/api/projects/project-1/launch/configure?surface=telegram", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-telegram-webapp-init-data": "auth_date=1&signature=sig",
    },
    body: JSON.stringify(body),
  });
}

function project(overrides: Record<string, unknown> = {}) {
  return {
    id: "project-1",
    archivedAt: null,
    ownerScopeType: "user",
    ownerScopeId: "owner-1",
    agent: "codex",
    agentImpl: "direct",
    model: null,
    providerBillingMode: "byok",
    runnerBackend: "local",
    tgSpecLastImportedVersion: null,
    repoUrl: null,
    repoBranch: "main",
    components: [{
      id: "component-1",
      sourceConfig: {
        recipe: "tg_spec_target",
        launchConfiguration: "tg_spec_launch_configuration_required",
      },
      runtimeConfig: {},
      powerIntent: "OFF",
      agentIntent: "OFF",
      runtimeState: "ABSENT",
      agentState: null,
      blockers: [],
    }],
    ...overrides,
  };
}

function createTx() {
  return {
    project: {
      update: vi.fn().mockResolvedValue({}),
    },
    projectComponent: {
      update: vi.fn().mockResolvedValue({}),
    },
    spec: {
      findMany: vi.fn().mockResolvedValue([]),
      aggregate: vi.fn().mockResolvedValue({ _max: { orderIndex: null } }),
      create: vi.fn().mockResolvedValue({}),
      delete: vi.fn().mockResolvedValue({}),
    },
    projectBudget: {
      findUnique: vi.fn().mockResolvedValue(null),
      update: vi.fn().mockResolvedValue({}),
      upsert: vi.fn().mockResolvedValue({}),
    },
    projectBudgetAdjustment: {
      create: vi.fn().mockResolvedValue({}),
    },
    runLog: {
      create: vi.fn().mockResolvedValue({}),
    },
  };
}

function agentLoop() {
  return {
    isActive: true,
    currentVersionId: "loop-version-1",
    loopTools: [{
      toolId: "tool-codex",
      models: JSON.stringify([
        { id: "default", label: "Default", model: "gpt-5.1-codex-mini" },
        { id: "gpt-55", label: "GPT-5.5", model: "gpt-5.5" },
      ]),
      tool: {
        id: "tool-codex",
        name: "codex",
        models: null,
        defaultModelId: "default",
        isActive: true,
      },
    }],
  };
}

describe("POST /api/projects/:id/launch/configure", () => {
  let tx: ReturnType<typeof createTx>;

  beforeEach(() => {
    vi.clearAllMocks();
    hasPlatformCapability.mockReturnValue(false);
    vi.mocked(requireProjectCapability).mockResolvedValue({
      authorized: true,
      session: { user: { id: "owner-1" } },
      hasBypass: false,
      isOwner: true,
      isAdmin: false,
    } as any);
    vi.mocked(requireTelegramWebAppProjectCapability).mockResolvedValue({
      authorized: true,
      session: { user: { id: "owner-1" } },
      hasBypass: false,
      isOwner: true,
      isAdmin: false,
    } as any);
    vi.mocked(resolvePlatformAccess).mockResolvedValue({ hasCapability: hasPlatformCapability } as any);
    vi.mocked(enforceUserLaunchPolicy).mockResolvedValue({ allowed: true });
    vi.mocked(prisma.project.findUnique as any).mockResolvedValue(project());
    vi.mocked(prisma.agentLoop.findUnique as any).mockResolvedValue(agentLoop());
    tx = createTx();
    vi.mocked(prisma.$transaction as any).mockImplementation(async (callback: any) => callback(tx));
  });

  it("configures BYOK launch through Arena policy", async () => {
    const res = await POST(request({
      agent: "codex",
      agentImpl: "direct",
      model: "gpt-5.5",
      providerBillingMode: "byok",
      runnerBackend: "local",
      visualWorkbenchEvidenceAutomation: true,
    }), context());

    expect(res.status).toBe(200);
    expect(requireProjectCapability).toHaveBeenCalledWith("project-1", "project.runtime.manage");
    expect(enforceUserLaunchPolicy).toHaveBeenCalledWith(expect.objectContaining({
      userId: "owner-1",
      privileged: false,
      agent: "codex",
      runnerBackend: "local",
      providerBillingMode: "byok",
    }));
    expect(tx.project.update).toHaveBeenCalledWith({
      where: { id: "project-1" },
      data: expect.objectContaining({
        agent: "codex",
        agentImpl: "direct",
        model: "gpt-5.5",
        providerBillingMode: "byok",
        runnerBackend: "local",
        codexAuthMode: "api_key",
      }),
    });
    expect(tx.projectComponent.update).toHaveBeenCalledWith({
      where: { id: "component-1" },
      data: expect.objectContaining({
        sourceConfig: expect.objectContaining({
          recipe: "tg_spec_target",
          launchConfiguration: "tg_spec_launch_configuration_configured",
          toolId: "tool-codex",
          agentLoopVersionId: "loop-version-1",
        }),
        runtimeConfig: expect.objectContaining({
          providerBillingMode: "byok",
          runnerBackend: "local",
          model: "gpt-5.5",
          useRepoHead: true,
          visualEvidenceMode: "required",
          visualWorkbenchEvidenceAutomation: {
            enabled: true,
            allowedServeCommands: ["npm run visual-workbench"],
            allowedBaseUrlEnv: ["VISUAL_WORKBENCH_BASE_URL"],
          },
        }),
      }),
    });
  });

  it("accepts Telegram WebApp project owners without a separate Arena page session", async () => {
    const req = telegramRequest({
      agent: "codex",
      agentImpl: "direct",
      model: "gpt-5.5",
      providerBillingMode: "byok",
      runnerBackend: "local",
    });
    const res = await POST(req, context());

    expect(res.status).toBe(200);
    expect(requireTelegramWebAppProjectCapability).toHaveBeenCalledWith(
      req,
      "project-1",
      "project.runtime.manage",
    );
    expect(resolvePlatformAccess).toHaveBeenCalledWith(
      { user: { id: "owner-1" } },
      false,
    );
  });

  it("rejects client-supplied envOverrides that are not from the selected registry model", async () => {
    const res = await POST(request({
      agent: "codex",
      agentImpl: "direct",
      model: "gpt-5.5",
      envOverrides: { ARENA_API_PROXY_SECRET: "override" },
      providerBillingMode: "byok",
      runnerBackend: "local",
    }), context());

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      error: "envOverrides must match the selected Arena model preset.",
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("rejects null Workbench automation toggle instead of preserving runtime config with false-looking logs", async () => {
    const res = await POST(request({
      agent: "codex",
      agentImpl: "direct",
      model: "gpt-5.5",
      providerBillingMode: "byok",
      runnerBackend: "local",
      visualWorkbenchEvidenceAutomation: null,
    }), context());

    expect(res.status).toBe(400);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("requires the project owner or platform admin for launch configuration", async () => {
    vi.mocked(requireProjectCapability).mockResolvedValue({
      authorized: true,
      session: { user: { id: "runtime-manager-1" } },
      hasBypass: false,
      isOwner: false,
      isAdmin: false,
    } as any);

    const res = await POST(request({
      agent: "codex",
      agentImpl: "direct",
      providerBillingMode: "byok",
      runnerBackend: "local",
    }), context());

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toMatchObject({ error: "Project access denied" });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("rejects unsupported launch surfaces", async () => {
    const res = await POST(
      new Request("http://localhost/api/projects/project-1/launch/configure?surface=chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          agent: "codex",
          agentImpl: "direct",
          providerBillingMode: "byok",
          runnerBackend: "local",
        }),
      }),
      context(),
    );

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: "Unsupported interaction surface" });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("applies selected project add-ons during launch configure", async () => {
    const res = await POST(request({
      agent: "codex",
      agentImpl: "direct",
      model: "gpt-5.5",
      providerBillingMode: "byok",
      runnerBackend: "local",
      addonIds: ["telegram_mini_app"],
    }), context());

    expect(res.status).toBe(200);
    expect(tx.project.update).toHaveBeenCalledWith({
      where: { id: "project-1" },
      data: expect.objectContaining({
        requiredSecrets: expect.stringContaining("TELEGRAM_BOT_TOKEN"),
      }),
    });
    expect(tx.spec.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        projectId: "project-1",
        title: "Addon: Telegram Mini App",
        versions: expect.objectContaining({
          create: expect.objectContaining({
            externalSourceSystem: "arena",
            message: "Project add-on: Telegram Mini App",
          }),
        }),
      }),
    });
    expect(tx.projectComponent.update).toHaveBeenCalledWith({
      where: { id: "component-1" },
      data: expect.objectContaining({
        blockers: ["SECRETS"],
        sourceConfig: expect.objectContaining({
          addonIds: ["telegram_mini_app"],
        }),
        runtimeConfig: expect.objectContaining({
          addonIds: ["telegram_mini_app"],
        }),
      }),
    });
  });

  it("preserves existing project add-ons when launch configure omits addonIds", async () => {
    vi.mocked(prisma.project.findUnique as any).mockResolvedValue(project({
      requiredSecrets: null,
      secrets: [{ key: "TELEGRAM_BOT_TOKEN" }],
      specs: [{
        title: "Addon: Telegram Mini App",
        versions: [{ externalSourceSystem: "arena" }],
      }],
    }));
    tx.spec.findMany.mockResolvedValue([{
      id: "addon-spec-1",
      title: "Addon: Telegram Mini App",
      versions: [{ externalSourceSystem: "arena" }],
    }]);

    const res = await POST(request({
      agent: "codex",
      agentImpl: "direct",
      model: "gpt-5.5",
      providerBillingMode: "byok",
      runnerBackend: "local",
    }), context());

    expect(res.status).toBe(200);
    expect(tx.project.update).toHaveBeenCalledWith({
      where: { id: "project-1" },
      data: expect.objectContaining({
        requiredSecrets: expect.stringContaining("TELEGRAM_BOT_TOKEN"),
      }),
    });
    expect(tx.spec.delete).not.toHaveBeenCalled();
    expect(tx.spec.create).not.toHaveBeenCalled();
    expect(tx.projectComponent.update).toHaveBeenCalledWith({
      where: { id: "component-1" },
      data: expect.objectContaining({
        blockers: [],
        sourceConfig: expect.objectContaining({
          addonIds: ["telegram_mini_app"],
        }),
        runtimeConfig: expect.objectContaining({
          addonIds: ["telegram_mini_app"],
        }),
      }),
    });
  });

  it("removes existing project add-ons when launch configure explicitly sends an empty addonIds list", async () => {
    vi.mocked(prisma.project.findUnique as any).mockResolvedValue(project({
      requiredSecrets: JSON.stringify([{
        key: "TELEGRAM_BOT_TOKEN",
        description: "Project-owned Telegram bot token used to expose the Arena preview as a Telegram Mini App.",
        blocking: true,
      }]),
      secrets: [{ key: "TELEGRAM_BOT_TOKEN" }],
      components: [{
        id: "component-1",
        sourceConfig: {
          recipe: "tg_spec_target",
          launchConfiguration: "tg_spec_launch_configuration_required",
          addonIds: ["telegram_mini_app"],
        },
        runtimeConfig: { addonIds: ["telegram_mini_app"] },
        powerIntent: "OFF",
        agentIntent: "OFF",
        runtimeState: "ABSENT",
        agentState: null,
        blockers: [],
      }],
      specs: [{
        title: "Addon: Telegram Mini App",
        versions: [{ externalSourceSystem: "arena" }],
      }],
    }));
    tx.spec.findMany.mockResolvedValue([{
      id: "addon-spec-1",
      title: "Addon: Telegram Mini App",
      versions: [{ externalSourceSystem: "arena" }],
    }]);

    const res = await POST(request({
      agent: "codex",
      agentImpl: "direct",
      model: "gpt-5.5",
      providerBillingMode: "byok",
      runnerBackend: "local",
      addonIds: [],
    }), context());

    expect(res.status).toBe(200);
    expect(tx.project.update).toHaveBeenCalledWith({
      where: { id: "project-1" },
      data: expect.objectContaining({
        requiredSecrets: null,
      }),
    });
    expect(tx.spec.delete).toHaveBeenCalledWith({ where: { id: "addon-spec-1" } });
    expect(tx.spec.create).not.toHaveBeenCalled();
    expect(tx.projectComponent.update).toHaveBeenCalledWith({
      where: { id: "component-1" },
      data: expect.objectContaining({
        blockers: [],
        sourceConfig: expect.objectContaining({
          addonIds: [],
        }),
        runtimeConfig: expect.objectContaining({
          addonIds: [],
        }),
      }),
    });
  });

  it("reserves Arena Credits budget during configure", async () => {
    const res = await POST(request({
      agent: "codex",
      agentImpl: "direct",
      providerBillingMode: "platform_credits",
      initialBudgetUsd: 5,
      runnerBackend: "local",
    }), context());

    expect(res.status).toBe(200);
    expect(reserveUserCreditsForProjectBudget).toHaveBeenCalledWith(tx, {
      userId: "owner-1",
      projectId: "project-1",
      amountUsd: 5,
      note: "Initial tg-spec Platform Credits budget",
    });
    expect(tx.project.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        providerBillingMode: "platform_credits",
        codexAuthMode: null,
        claudeAuthMode: null,
      }),
    }));
  });

  it("requires an Arena Credits budget", async () => {
    const res = await POST(request({
      agent: "codex",
      agentImpl: "direct",
      providerBillingMode: "platform_credits",
      runnerBackend: "local",
    }), context());

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      error: "Platform Credits launches require an initial budget.",
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("surfaces missing BYOK provider credentials before persisting config", async () => {
    vi.mocked(enforceUserLaunchPolicy).mockResolvedValue({
      allowed: false,
      error: "OpenAI API key is required in Settings before launch.",
    });

    const res = await POST(request({
      agent: "codex",
      agentImpl: "direct",
      providerBillingMode: "byok",
      runnerBackend: "local",
    }), context());

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      error: "OpenAI API key is required in Settings before launch.",
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("blocks platform credentials for non-privileged callers", async () => {
    vi.mocked(enforceUserLaunchPolicy).mockResolvedValue({
      allowed: false,
      error: "Platform provider credentials are only available to platform operators.",
    });

    const res = await POST(request({
      agent: "codex",
      agentImpl: "direct",
      providerBillingMode: "platform_credentials",
      runnerBackend: "local",
    }), context());

    expect(res.status).toBe(400);
    expect(enforceUserLaunchPolicy).toHaveBeenCalledWith(expect.objectContaining({
      privileged: false,
      providerBillingMode: "platform_credentials",
    }));
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("allows platform credentials for privileged callers", async () => {
    hasPlatformCapability.mockImplementation((capability: string) => capability === "platform.projects.manage");

    const res = await POST(request({
      agent: "codex",
      agentImpl: "direct",
      providerBillingMode: "platform_credentials",
      runnerBackend: "local",
      codexAuthMode: "subscription",
    }), context());

    expect(res.status).toBe(200);
    expect(enforceUserLaunchPolicy).toHaveBeenCalledWith(expect.objectContaining({
      privileged: true,
      providerBillingMode: "platform_credentials",
    }));
    expect(tx.project.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        providerBillingMode: "platform_credentials",
        codexAuthMode: "subscription",
      }),
    }));
  });
});
