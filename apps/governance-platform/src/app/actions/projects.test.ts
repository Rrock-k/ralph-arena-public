import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  createPersonalAgentProjectInternal,
  createPersonalAgentProject,
  createPersonalRecipeProject,
  createPersonalTgSpecProjectInternal,
  createPersonalTgSpecProject,
} from "./projects";

const { hasPlatformCapability, isByokProviderKeysEnabled } = vi.hoisted(() => ({
  hasPlatformCapability: vi.fn(() => false),
  isByokProviderKeysEnabled: vi.fn(() => true),
}));

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
}));

vi.mock("@/lib/e2e-auth-bypass", () => ({
  hasE2EAdminBypass: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: vi.fn(),
  },
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/progress-bus", () => ({
  progressBus: {
    notifyChanged: vi.fn(),
  },
}));

vi.mock("@/lib/control-plane", () => ({
  resolveLoopAndTool: vi.fn().mockResolvedValue({
    toolId: "tool-1",
    agentLoopVersionId: "loop-version-1",
  }),
}));

vi.mock("@/lib/platform-access", () => ({
  resolvePlatformAccess: vi.fn().mockResolvedValue({
    hasCapability: hasPlatformCapability,
  }),
}));

vi.mock("@/lib/user-launch-policy", () => ({
  enforceUserLaunchPolicy: vi.fn().mockResolvedValue({ allowed: true }),
  normalizeProviderBillingMode: vi.fn((mode: string | null | undefined) => (
    mode === "platform_credits" || mode === "platform_credentials" ? mode : "byok"
  )),
  parseProviderBillingMode: vi.fn((mode: string | null | undefined) => (
    mode === "byok" || mode === "platform_credits" || mode === "platform_credentials" ? mode : null
  )),
  normalizeAuthModesForProviderBilling: vi.fn((agent: string, mode: string | null | undefined, modes: any) => {
    const billingMode = mode === "platform_credits" || mode === "platform_credentials" ? mode : "byok";
    if (billingMode === "platform_credits") {
      return { claudeAuthMode: null, codexAuthMode: null };
    }
    if (billingMode === "byok" && agent === "codex") {
      return { claudeAuthMode: null, codexAuthMode: "api_key" };
    }
    if (billingMode === "byok" && agent === "claude-code") {
      return { claudeAuthMode: "api_key", codexAuthMode: null };
    }
    return {
      claudeAuthMode: modes.claudeAuthMode ?? null,
      codexAuthMode: modes.codexAuthMode ?? null,
    };
  }),
  getUserByokAuthModeUpdate: vi.fn((agent: string) => (
    agent === "codex"
      ? { claudeAuthMode: null, codexAuthMode: "api_key" }
      : agent === "claude-code"
        ? { claudeAuthMode: "api_key", codexAuthMode: null }
        : {}
  )),
}));

vi.mock("@/lib/feature-flags", () => ({
  isByokProviderKeysEnabled,
}));

import { auth } from "@/lib/auth";
import { hasE2EAdminBypass } from "@/lib/e2e-auth-bypass";
import { prisma } from "@/lib/prisma";
import { enforceUserLaunchPolicy } from "@/lib/user-launch-policy";
import { INTERNAL_ACTION_TOKEN } from "@/lib/internal-action-token";

describe("createPersonalAgentProject", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SECRETS_ENCRYPTION_KEY = "0".repeat(64);
    hasPlatformCapability.mockReturnValue(false);
    isByokProviderKeysEnabled.mockResolvedValue(true);
    vi.mocked(hasE2EAdminBypass).mockResolvedValue(false);
  });

  it("blocks direct internal create actions without trusted server token", async () => {
    const agentResult = await createPersonalAgentProjectInternal({
      name: "Bypass",
      spec: "Build something",
      agent: "codex",
      agentImpl: "direct",
      runnerBackend: "vps",
      codexAuthMode: "subscription",
    });
    const targetResult = await createPersonalTgSpecProjectInternal({
      name: "Bypass target",
      agent: "codex",
      agentImpl: "direct",
      runnerBackend: "vps",
      codexAuthMode: "subscription",
    });

    expect(agentResult).toEqual({
      success: false,
      error: "Internal action is not callable directly.",
    });
    expect(targetResult).toEqual({
      success: false,
      error: "Internal action is not callable directly.",
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("requires authentication", async () => {
    vi.mocked(auth as any).mockResolvedValue(null);

    const result = await createPersonalAgentProject({
      name: "Personal Project",
      spec: "Build something useful",
      initialBudgetUsd: 20,
      agent: "codex",
      agentImpl: "direct",
    });

    expect(result.success).toBe(false);
    if (result.success) {
      throw new Error("Expected createPersonalAgentProject to fail without auth");
    }
    expect(result.error).toBe("You must be signed in to create a project");
  });

  it("creates a personal project with budget, spec, and main component", async () => {
    vi.mocked(auth as any).mockResolvedValue({
      user: { id: "user-1", email: "user@example.com", role: "USER" },
      expires: new Date().toISOString(),
    });

    vi.mocked(prisma.$transaction).mockImplementation(async (callback: any) => {
      const tx = {
        project: {
          create: vi.fn().mockResolvedValue({ id: "project-1" }),
          update: vi.fn().mockResolvedValue({ id: "project-1" }),
        },
        runLog: {
          create: vi.fn().mockResolvedValue({ id: "log-1" }),
        },
      };

      const result = await callback(tx);

      expect(tx.project.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          name: "Personal Project",
          mode: "personal",
          ownerScopeType: "user",
          ownerScopeId: "user-1",
          agent: "codex",
          agentImpl: "direct",
          visibility: "private",
          runnerBackend: "local",
          specSnapshot: "Build something useful",
          specs: {
            create: expect.objectContaining({
              title: "Initial Spec",
              content: "Build something useful",
              orderIndex: 0,
              versions: {
                create: {
                  version: 1,
                  content: "Build something useful",
                  message: "Initial version",
                },
              },
            }),
          },
          components: {
            create: expect.objectContaining({
              name: "main",
              kind: "app",
              powerIntent: "ON",
              runtimeState: "ABSENT",
              agentState: "IDLE",
              sourceType: "managed",
              sourceConfig: expect.objectContaining({
                recipe: "agent_project",
                repoBranch: "main",
                agent: "codex",
                agentImpl: "direct",
                toolId: "tool-1",
                agentLoopVersionId: "loop-version-1",
              }),
              runtimeConfig: expect.objectContaining({
                runnerBackend: "local",
                toolId: "tool-1",
                agentLoopVersionId: "loop-version-1",
                useRepoHead: true,
              }),
            }),
          },
          budget: {
            create: {
              isEnabled: true,
              totalCreditsUsd: 20,
              usedCreditsUsd: 0,
            },
          },
        }),
        select: { id: true },
      });

      expect(tx.project.update).toHaveBeenCalledWith({
        where: { id: "project-1" },
        data: { slug: expect.any(String) },
      });

      expect(tx.runLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          projectId: "project-1",
          event: "LAUNCHED",
        }),
      });

      return result;
    });

    const result = await createPersonalAgentProject({
      name: "Personal Project",
      spec: "Build something useful",
      initialBudgetUsd: 20,
      agent: "codex",
      agentImpl: "direct",
      toolId: "tool-1",
    });

    expect(result).toEqual({ success: true, projectId: "project-1" });
  });

  it("requires blocking add-on secrets before creating the project", async () => {
    vi.mocked(auth as any).mockResolvedValue({
      user: { id: "user-1", email: "user@example.com", role: "USER" },
      expires: new Date().toISOString(),
    });

    const result = await createPersonalAgentProject({
      name: "Telegram Addon Project",
      spec: "Build a useful app",
      agent: "codex",
      agentImpl: "direct",
      toolId: "tool-1",
      addonIds: ["telegram_mini_app"],
      addonSecretValues: {},
    });

    expect(result).toEqual({
      success: false,
      error: "Missing required add-on secret: TELEGRAM_BOT_TOKEN",
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("creates add-on specs, required secrets, and encrypted project secrets at launch", async () => {
    vi.mocked(auth as any).mockResolvedValue({
      user: { id: "user-1", email: "user@example.com", role: "USER" },
      expires: new Date().toISOString(),
    });

    vi.mocked(prisma.$transaction).mockImplementation(async (callback: any) => {
      const tx = {
        project: {
          create: vi.fn().mockResolvedValue({ id: "project-telegram-addon" }),
          update: vi.fn().mockResolvedValue({ id: "project-telegram-addon" }),
        },
        projectSecret: {
          create: vi.fn().mockResolvedValue({ id: "secret-telegram" }),
        },
        runLog: {
          create: vi.fn().mockResolvedValue({ id: "log-telegram-addon" }),
        },
      };

      const result = await callback(tx);
      const createArgs = vi.mocked(tx.project.create).mock.calls[0]?.[0];
      const requiredSecrets = JSON.parse(createArgs.data.requiredSecrets);

      expect(requiredSecrets).toEqual([
        expect.objectContaining({
          key: "TELEGRAM_BOT_TOKEN",
          blocking: true,
        }),
      ]);
      expect(createArgs.data.specs.create).toEqual([
        expect.objectContaining({
          title: "Initial Spec",
          content: "Build a useful app",
          orderIndex: 0,
        }),
        expect.objectContaining({
          title: "Addon: Telegram Mini App",
          content: expect.stringContaining("setChatMenuButton"),
          orderIndex: 1,
        }),
      ]);
      expect(createArgs.data.specs.create[1].content).toContain("ARENA_TELEGRAM_PREVIEW_URL");
      expect(createArgs.data.specs.create[1].content).toContain("raw `ARENA_PREVIEW_URL`");
      expect(createArgs.data.specs.create[1].versions.create.acceptedArtifact).toEqual(expect.objectContaining({
        artifactSchemaVersion: "ra-287.accepted-spec-artifact.v1",
        acceptedDiff: expect.objectContaining({
          items: [
            expect.objectContaining({
              targetType: "spec",
              workImpact: "requires_loop_work",
              summary: expect.stringContaining("TELEGRAM_BOT_TOKEN"),
            }),
          ],
        }),
        secretRequirements: [
          expect.objectContaining({
            key: "TELEGRAM_BOT_TOKEN",
            required: true,
            blocking: true,
          }),
        ],
      }));
      expect(createArgs.data.specs.create[1].versions.create.externalMetadataHash).toMatch(/^sha256:[a-f0-9]{64}$/);
      expect(JSON.stringify(createArgs.data.specs.create[1].versions.create.acceptedArtifact)).not.toContain("123456:token");
      expect(tx.projectSecret.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          projectId: "project-telegram-addon",
          key: "TELEGRAM_BOT_TOKEN",
          encryptedValue: expect.any(String),
          iv: expect.any(String),
          authTag: expect.any(String),
          description: expect.stringContaining("Telegram bot token"),
        }),
      });
      expect(tx.projectSecret.create.mock.calls[0]?.[0].data.encryptedValue).not.toContain("123456:token");
      expect(tx.runLog.create.mock.calls[0]?.[0].data.detail).toContain("telegram_mini_app");
      expect(tx.runLog.create.mock.calls[0]?.[0].data.detail).not.toContain("123456:token");

      return result;
    });

    const result = await createPersonalAgentProject({
      name: "Telegram Addon Project",
      spec: "Build a useful app",
      agent: "codex",
      agentImpl: "direct",
      toolId: "tool-1",
      addonIds: ["telegram_mini_app"],
      addonSecretValues: {
        TELEGRAM_BOT_TOKEN: "123456:token",
      },
    });

    expect(result).toEqual({ success: true, projectId: "project-telegram-addon" });
  });

  it("does not create a budget limit unless one is explicitly requested", async () => {
    vi.mocked(auth as any).mockResolvedValue({
      user: { id: "user-1", email: "user@example.com", role: "USER" },
      expires: new Date().toISOString(),
    });

    vi.mocked(prisma.$transaction).mockImplementation(async (callback: any) => {
      const tx = {
        project: {
          create: vi.fn().mockResolvedValue({ id: "project-unlimited" }),
          update: vi.fn().mockResolvedValue({ id: "project-unlimited" }),
        },
        runLog: {
          create: vi.fn().mockResolvedValue({ id: "log-unlimited" }),
        },
      };

      const result = await callback(tx);
      const createArgs = vi.mocked(tx.project.create).mock.calls[0]?.[0];

      expect(createArgs.data).not.toHaveProperty("budget");

      return result;
    });

    const result = await createPersonalAgentProject({
      name: "Unlimited Project",
      spec: "Build without a budget limit",
      agent: "codex",
      agentImpl: "direct",
      toolId: "tool-1",
    });

    expect(result).toEqual({ success: true, projectId: "project-unlimited" });
  });

  it("stores an explicit source seed profile on agent project source config", async () => {
    vi.mocked(prisma.$transaction).mockImplementation(async (callback: any) => {
      const tx = {
        project: {
          create: vi.fn().mockResolvedValue({ id: "project-workbench-seed" }),
          update: vi.fn().mockResolvedValue({ id: "project-workbench-seed" }),
        },
        runLog: {
          create: vi.fn().mockResolvedValue({ id: "log-workbench-seed" }),
        },
      };

      const result = await callback(tx);
      const createArgs = vi.mocked(tx.project.create).mock.calls[0]?.[0];

      expect(createArgs.data.components.create.sourceConfig).toEqual(
        expect.objectContaining({
          recipe: "agent_project",
          sourceSeedProfile: "visual_workbench_canary_v0",
        }),
      );

      return result;
    });

    const result = await createPersonalAgentProjectInternal({
      name: "Visual Workbench Seed Project",
      spec: "Build a visible synth UI",
      agent: "codex",
      agentImpl: "direct",
      toolId: "tool-1",
      sourceSeedProfile: "visual_workbench_canary_v0",
    }, { ownerScopeId: "arena-admin-api", internalActionToken: INTERNAL_ACTION_TOKEN });

    expect(result).toEqual({ success: true, projectId: "project-workbench-seed" });
  });

  it("rejects unknown source seed profiles before creating a project", async () => {
    const result = await createPersonalAgentProjectInternal({
      name: "Unknown Seed Project",
      spec: "Build a visible UI",
      agent: "codex",
      agentImpl: "direct",
      toolId: "tool-1",
      sourceSeedProfile: "hidden-template",
    }, { ownerScopeId: "arena-admin-api", internalActionToken: INTERNAL_ACTION_TOKEN });

    expect(result).toEqual({
      success: false,
      error: "Invalid sourceSeedProfile: hidden-template",
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("rejects unsupported provider billing modes during personal project creation", async () => {
    vi.mocked(auth as any).mockResolvedValue({
      user: { id: "user-1", email: "user@example.com", role: "USER" },
      expires: new Date().toISOString(),
    });

    const result = await createPersonalAgentProject({
      name: "Invalid Billing Project",
      spec: "Build something useful",
      agent: "codex",
      agentImpl: "direct",
      toolId: "tool-1",
      providerBillingMode: "platform-creditz",
    });

    expect(result).toEqual({
      success: false,
      error: "Invalid providerBillingMode: platform-creditz",
    });
    expect(enforceUserLaunchPolicy).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("requires an initial budget for Platform Credits launches", async () => {
    vi.mocked(auth as any).mockResolvedValue({
      user: { id: "user-1", email: "user@example.com", role: "USER" },
      expires: new Date().toISOString(),
    });

    const result = await createPersonalAgentProject({
      name: "Managed Credits Project",
      spec: "Build with platform credits",
      agent: "codex",
      agentImpl: "direct",
      toolId: "tool-1",
      providerBillingMode: "platform_credits",
    });

    expect(result).toEqual({
      success: false,
      error: "Platform Credits launches require an initial budget.",
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("reserves Platform Credits into project budget during create", async () => {
    vi.mocked(auth as any).mockResolvedValue({
      user: { id: "user-1", email: "user@example.com", role: "USER" },
      expires: new Date().toISOString(),
    });

    vi.mocked(prisma.$transaction).mockImplementation(async (callback: any) => {
      const tx = {
        project: {
          create: vi.fn().mockResolvedValue({ id: "project-platform-credits" }),
          update: vi.fn().mockResolvedValue({ id: "project-platform-credits" }),
        },
        userCreditBalance: {
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
          findUnique: vi.fn().mockResolvedValue({ credits: 15 }),
        },
        userCreditAdjustment: {
          create: vi.fn().mockResolvedValue({ id: "user-credit-adjustment-1" }),
        },
        projectBudget: {
          upsert: vi.fn().mockResolvedValue({
            totalCreditsUsd: 5,
            usedCreditsUsd: 0,
          }),
        },
        projectBudgetAdjustment: {
          create: vi.fn().mockResolvedValue({ id: "project-budget-adjustment-1" }),
        },
        runLog: {
          create: vi.fn().mockResolvedValue({ id: "log-platform-credits" }),
        },
      };

      const result = await callback(tx);
      const createArgs = vi.mocked(tx.project.create).mock.calls[0]?.[0];

      expect(createArgs.data).toEqual(expect.objectContaining({
        ownerScopeId: "user-1",
        providerBillingMode: "platform_credits",
        claudeAuthMode: null,
        codexAuthMode: null,
      }));
      expect(createArgs.data).not.toHaveProperty("budget");
      expect(tx.userCreditBalance.updateMany).toHaveBeenCalledWith({
        where: {
          userId: "user-1",
          credits: { gte: 5 },
        },
        data: {
          credits: { decrement: 5 },
        },
      });
      expect(tx.userCreditAdjustment.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: "user-1",
          projectId: "project-platform-credits",
          amountUsd: -5,
          kind: "PROJECT_BUDGET_RESERVE",
        }),
      });
      expect(tx.projectBudget.upsert).toHaveBeenCalledWith(expect.objectContaining({
        where: { projectId: "project-platform-credits" },
        create: expect.objectContaining({
          projectId: "project-platform-credits",
          totalCreditsUsd: 5,
          usedCreditsUsd: 0,
        }),
      }));
      return result;
    });

    const result = await createPersonalAgentProject({
      name: "Managed Credits Project",
      spec: "Build with platform credits",
      initialBudgetUsd: 5,
      agent: "codex",
      agentImpl: "direct",
      toolId: "tool-1",
      providerBillingMode: "platform_credits",
    });

    expect(result).toEqual({ success: true, projectId: "project-platform-credits" });
    expect(enforceUserLaunchPolicy).toHaveBeenCalledWith(expect.objectContaining({
      providerBillingMode: "platform_credits",
    }));
  });

  it("allows project creation via e2e admin bypass without a signed-in user", async () => {
    vi.mocked(auth as any).mockResolvedValue(null);
    vi.mocked(hasE2EAdminBypass).mockResolvedValue(true);

    vi.mocked(prisma.$transaction).mockImplementation(async (callback: any) => {
      const tx = {
        project: {
          create: vi.fn().mockResolvedValue({ id: "project-bypass" }),
          update: vi.fn().mockResolvedValue({ id: "project-bypass" }),
        },
        runLog: {
          create: vi.fn().mockResolvedValue({ id: "log-bypass" }),
        },
      };

      const result = await callback(tx);

      expect(tx.project.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          ownerScopeType: "user",
          ownerScopeId: "e2e-admin-bypass",
        }),
        select: { id: true },
      });

      expect(tx.project.update).toHaveBeenCalledWith({
        where: { id: "project-bypass" },
        data: { slug: expect.any(String) },
      });

      return result;
    });

    const result = await createPersonalAgentProject({
      name: "Bypass Project",
      spec: "Build something useful",
      initialBudgetUsd: 20,
      agent: "codex",
      agentImpl: "direct",
    });

    expect(result).toEqual({ success: true, projectId: "project-bypass" });
  });

  it("persists Repo HEAD intent in runtimeConfig for personal agent projects", async () => {
    vi.mocked(auth as any).mockResolvedValue({
      user: { id: "user-1", email: "user@example.com", role: "USER" },
      expires: new Date().toISOString(),
    });

    vi.mocked(prisma.$transaction).mockImplementation(async (callback: any) => {
      const tx = {
        project: {
          create: vi.fn().mockResolvedValue({ id: "project-latest-loop" }),
          update: vi.fn().mockResolvedValue({ id: "project-latest-loop" }),
        },
        runLog: {
          create: vi.fn().mockResolvedValue({ id: "log-latest-loop" }),
        },
      };

      const result = await callback(tx);

      expect(tx.project.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          components: {
            create: expect.objectContaining({
              runtimeConfig: expect.objectContaining({
                useRepoHead: true,
              }),
            }),
          },
        }),
        select: { id: true },
      });

      expect(tx.project.update).toHaveBeenCalledWith({
        where: { id: "project-latest-loop" },
        data: { slug: expect.any(String) },
      });

      return result;
    });

    const result = await createPersonalAgentProject({
      name: "Latest Loop Project",
      spec: "Build from HEAD",
      initialBudgetUsd: 20,
      agent: "codex",
      agentImpl: "direct",
      toolId: "tool-1",
    });

    expect(result).toEqual({ success: true, projectId: "project-latest-loop" });
  });

  it("creates an empty tg-spec target project without seeding a local spec", async () => {
    vi.mocked(auth as any).mockResolvedValue({
      user: { id: "user-1", email: "user@example.com", role: "USER" },
      expires: new Date().toISOString(),
    });

    vi.mocked(prisma.$transaction).mockImplementation(async (callback: any) => {
      const tx = {
        project: {
          create: vi.fn().mockResolvedValue({ id: "project-tg-target" }),
          update: vi.fn().mockResolvedValue({ id: "project-tg-target" }),
        },
        runLog: {
          create: vi.fn().mockResolvedValue({ id: "log-tg-target" }),
        },
      };

      const result = await callback(tx);
      const createArgs = vi.mocked(tx.project.create).mock.calls[0]?.[0];

      expect(createArgs).toEqual({
        data: expect.objectContaining({
          name: "Telegram Execution Target",
          mode: "personal",
          ownerScopeType: "user",
          ownerScopeId: "user-1",
          agent: "codex",
          agentImpl: "direct",
          visibility: "private",
          runnerBackend: "local",
          components: {
            create: expect.objectContaining({
              name: "main",
              kind: "app",
              powerIntent: "OFF",
              agentIntent: "OFF",
              runtimeState: "ABSENT",
              agentState: null,
              sourceType: "managed",
              sourceConfig: expect.objectContaining({
                recipe: "tg_spec_target",
                repoBranch: "main",
                agent: "codex",
                agentImpl: "direct",
                toolId: "tool-1",
                agentLoopVersionId: "loop-version-1",
              }),
              runtimeConfig: expect.objectContaining({
                runnerBackend: "local",
                toolId: "tool-1",
                agentLoopVersionId: "loop-version-1",
                useRepoHead: true,
              }),
            }),
          },
          budget: {
            create: {
              isEnabled: true,
              totalCreditsUsd: 20,
              usedCreditsUsd: 0,
            },
          },
        }),
        select: { id: true },
      });
      expect(createArgs.data).not.toHaveProperty("specSnapshot");
      expect(createArgs.data).not.toHaveProperty("specs");

      expect(tx.project.update).toHaveBeenCalledWith({
        where: { id: "project-tg-target" },
        data: { slug: expect.any(String) },
      });

      expect(tx.runLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          projectId: "project-tg-target",
          event: "CREATED",
        }),
      });

      return result;
    });

    const result = await createPersonalTgSpecProject({
      name: "Telegram Execution Target",
      initialBudgetUsd: 20,
      agent: "codex",
      agentImpl: "direct",
      toolId: "tool-1",
    });

    expect(result).toEqual({ success: true, projectId: "project-tg-target" });
  });

  it("marks tg-spec internal create handoffs as waiting for Arena launch setup", async () => {
    vi.mocked(prisma.$transaction).mockImplementation(async (callback: any) => {
      const tx = {
        project: {
          create: vi.fn().mockResolvedValue({ id: "project-tg-setup" }),
          update: vi.fn().mockResolvedValue({ id: "project-tg-setup" }),
        },
        runLog: {
          create: vi.fn().mockResolvedValue({ id: "log-tg-setup" }),
        },
      };

      const result = await callback(tx);
      const createArgs = vi.mocked(tx.project.create).mock.calls[0]?.[0];

      expect(createArgs.data).toEqual(expect.objectContaining({
        ownerScopeId: "user-1",
        tgSpecSourceProjectId: "tg-project-1",
        components: {
          create: expect.objectContaining({
            powerIntent: "OFF",
            agentIntent: "OFF",
            sourceConfig: expect.objectContaining({
              recipe: "tg_spec_target",
              launchConfiguration: "tg_spec_launch_configuration_required",
            }),
          }),
        },
      }));
      expect(tx.runLog.create.mock.calls[0]?.[0].data.detail).toContain('"awaitingLaunchConfiguration":true');
      return result;
    });

    const result = await createPersonalTgSpecProjectInternal({
      name: "Telegram Setup Target",
      agent: "codex",
      agentImpl: "direct",
      toolId: "tool-1",
    }, {
      ownerScopeId: "user-1",
      tgSpecSourceProjectId: "tg-project-1",
      awaitingLaunchConfiguration: true,
      internalActionToken: INTERNAL_ACTION_TOKEN,
    });

    expect(result).toEqual({ success: true, projectId: "project-tg-setup" });
  });

  it("stores an explicit source seed profile on tg-spec target source config", async () => {
    vi.mocked(prisma.$transaction).mockImplementation(async (callback: any) => {
      const tx = {
        project: {
          create: vi.fn().mockResolvedValue({ id: "project-tg-workbench-seed" }),
          update: vi.fn().mockResolvedValue({ id: "project-tg-workbench-seed" }),
        },
        runLog: {
          create: vi.fn().mockResolvedValue({ id: "log-tg-workbench-seed" }),
        },
      };

      const result = await callback(tx);
      const createArgs = vi.mocked(tx.project.create).mock.calls[0]?.[0];

      expect(createArgs.data.components.create.sourceConfig).toEqual(
        expect.objectContaining({
          recipe: "tg_spec_target",
          launchConfiguration: "tg_spec_launch_configuration_required",
          sourceSeedProfile: "visual_workbench_canary_v0",
        }),
      );
      expect(createArgs.data).not.toHaveProperty("specSnapshot");

      return result;
    });

    const result = await createPersonalTgSpecProjectInternal({
      name: "Telegram Workbench Target",
      agent: "codex",
      agentImpl: "direct",
      toolId: "tool-1",
      sourceSeedProfile: "visual_workbench_canary_v0",
    }, {
      ownerScopeId: "arena-admin-api",
      tgSpecSourceProjectId: "tg-project-workbench",
      awaitingLaunchConfiguration: true,
      internalActionToken: INTERNAL_ACTION_TOKEN,
    });

    expect(result).toEqual({ success: true, projectId: "project-tg-workbench-seed" });
  });

  it("allows internal tg-spec create to attach blocking add-ons without secret values", async () => {
    vi.mocked(prisma.$transaction).mockImplementation(async (callback: any) => {
      const tx = {
        project: {
          create: vi.fn().mockResolvedValue({ id: "project-tg-addon-missing-secret" }),
          update: vi.fn().mockResolvedValue({ id: "project-tg-addon-missing-secret" }),
        },
        projectSecret: {
          create: vi.fn().mockResolvedValue({ id: "secret-should-not-be-created" }),
        },
        runLog: {
          create: vi.fn().mockResolvedValue({ id: "log-tg-addon-missing-secret" }),
        },
      };

      const result = await callback(tx);
      const createArgs = vi.mocked(tx.project.create).mock.calls[0]?.[0];

      expect(JSON.parse(createArgs.data.requiredSecrets)).toEqual([
        expect.objectContaining({
          key: "TELEGRAM_BOT_TOKEN",
          blocking: true,
        }),
      ]);
      expect(createArgs.data.components.create).toEqual(expect.objectContaining({
        blockers: ["SECRETS"],
        powerIntent: "OFF",
        agentIntent: "OFF",
      }));
      expect(createArgs.data.specs.create).toEqual([
        expect.objectContaining({
          title: "Addon: Telegram Mini App",
          content: expect.stringContaining("TELEGRAM_BOT_TOKEN"),
          versions: {
            create: expect.objectContaining({
              acceptedArtifact: expect.objectContaining({
                acceptedDiff: expect.objectContaining({
                  items: [
                    expect.objectContaining({
                      workImpact: "requires_loop_work",
                    }),
                  ],
                }),
              }),
              externalMetadataHash: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
            }),
          },
        }),
      ]);
      expect(tx.projectSecret.create).not.toHaveBeenCalled();
      expect(tx.runLog.create.mock.calls[0]?.[0].data.detail).toContain("missingRequiredSecrets");
      expect(tx.runLog.create.mock.calls[1]?.[0].data).toEqual(expect.objectContaining({
        projectId: "project-tg-addon-missing-secret",
        event: "SECRETS_BLOCKED",
        detail: expect.stringContaining("TELEGRAM_BOT_TOKEN"),
      }));

      return result;
    });

    const result = await createPersonalTgSpecProjectInternal({
      name: "Telegram Setup Target",
      agent: "codex",
      agentImpl: "direct",
      toolId: "tool-1",
      addonIds: ["telegram_mini_app"],
      addonSecretValues: {},
    }, {
      ownerScopeId: "user-1",
      tgSpecSourceProjectId: "tg-project-1",
      awaitingLaunchConfiguration: true,
      allowMissingAddonSecrets: true,
      internalActionToken: INTERNAL_ACTION_TOKEN,
    });

    expect(result).toEqual({ success: true, projectId: "project-tg-addon-missing-secret" });
  });

  it("allows tg-spec targets to start with add-on specs and required secrets while staying dormant", async () => {
    vi.mocked(auth as any).mockResolvedValue({
      user: { id: "user-1", email: "user@example.com", role: "USER" },
      expires: new Date().toISOString(),
    });

    vi.mocked(prisma.$transaction).mockImplementation(async (callback: any) => {
      const tx = {
        project: {
          create: vi.fn().mockResolvedValue({ id: "project-tg-target-addon" }),
          update: vi.fn().mockResolvedValue({ id: "project-tg-target-addon" }),
        },
        projectSecret: {
          create: vi.fn().mockResolvedValue({ id: "secret-telegram-target" }),
        },
        runLog: {
          create: vi.fn().mockResolvedValue({ id: "log-tg-target-addon" }),
        },
      };

      const result = await callback(tx);
      const createArgs = vi.mocked(tx.project.create).mock.calls[0]?.[0];

      expect(createArgs.data).toEqual(expect.objectContaining({
        requiredSecrets: expect.any(String),
        components: {
          create: expect.objectContaining({
            powerIntent: "OFF",
            agentIntent: "OFF",
            sourceConfig: expect.objectContaining({
              recipe: "tg_spec_target",
            }),
          }),
        },
        specs: {
          create: [
            expect.objectContaining({
              title: "Addon: Telegram Mini App",
              content: expect.stringContaining("setChatMenuButton"),
              orderIndex: 0,
              versions: {
                create: expect.objectContaining({
                  acceptedArtifact: expect.objectContaining({
                    secretRequirements: [
                      expect.objectContaining({
                        key: "TELEGRAM_BOT_TOKEN",
                      }),
                    ],
                  }),
                }),
              },
            }),
          ],
        },
      }));
      expect(createArgs.data).not.toHaveProperty("specSnapshot");
      expect(JSON.parse(createArgs.data.requiredSecrets)).toEqual([
        expect.objectContaining({
          key: "TELEGRAM_BOT_TOKEN",
          blocking: true,
        }),
      ]);
      expect(tx.projectSecret.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          projectId: "project-tg-target-addon",
          key: "TELEGRAM_BOT_TOKEN",
          encryptedValue: expect.any(String),
          iv: expect.any(String),
          authTag: expect.any(String),
        }),
      });
      expect(tx.runLog.create.mock.calls[0]?.[0].data.detail).toContain("telegram_mini_app");
      expect(tx.runLog.create.mock.calls[0]?.[0].data.detail).not.toContain("123456:token");

      return result;
    });

    const result = await createPersonalTgSpecProject({
      name: "Telegram Execution Target",
      initialBudgetUsd: 20,
      agent: "codex",
      agentImpl: "direct",
      toolId: "tool-1",
      addonIds: ["telegram_mini_app"],
      addonSecretValues: {
        TELEGRAM_BOT_TOKEN: "123456:token",
      },
    });

    expect(result).toEqual({ success: true, projectId: "project-tg-target-addon" });
  });

  it("creates a simple web recipe project without blocking setup", async () => {
    vi.mocked(auth as any).mockResolvedValue({
      user: { id: "user-1", email: "user@example.com", role: "USER" },
      expires: new Date().toISOString(),
    });

    vi.mocked(prisma.$transaction).mockImplementation(async (callback: any) => {
      const tx = {
        project: {
          create: vi.fn().mockResolvedValue({ id: "project-simple-web" }),
          update: vi.fn().mockResolvedValue({ id: "project-simple-web" }),
        },
        runLog: {
          create: vi.fn().mockResolvedValue({}),
        },
      };

      const result = await callback(tx);

      expect(tx.project.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          name: "Simple Web",
          mode: "personal",
          ownerScopeType: "user",
          ownerScopeId: "user-1",
          agent: "service",
          agentImpl: "simple_web",
          visibility: "private",
          requiredSecrets: null,
          runnerBackend: "local",
          budget: {
            create: {
              isEnabled: true,
              totalCreditsUsd: 20,
              usedCreditsUsd: 0,
            },
          },
          components: {
            create: expect.objectContaining({
              name: "web",
              kind: "app",
              powerIntent: "ON",
              runtimeState: "ABSENT",
              agentState: null,
              blockers: [],
              sourceType: "managed",
              sourceConfig: expect.objectContaining({
                recipeId: "simple_web",
                runtime: "inline_node_http",
              }),
              runtimeConfig: expect.objectContaining({
                recipeId: "simple_web",
                bootstrap: "direct_command",
                commandTemplate: expect.stringContaining("Simple Web Template"),
                runnerBackend: "local",
              }),
            }),
          },
        }),
        select: { id: true },
      });

      expect(tx.project.update).toHaveBeenCalledWith({
        where: { id: "project-simple-web" },
        data: { slug: expect.any(String) },
      });

      expect(tx.runLog.create).toHaveBeenCalledTimes(1);

      return result;
    });

    const result = await createPersonalRecipeProject({
      recipeId: "simple_web",
      name: "Simple Web",
      initialBudgetUsd: 20,
      runnerBackend: "local",
    });

    expect(result).toEqual({ success: true, projectId: "project-simple-web" });
  });

  it("creates an OpenClaw recipe project in paused-secrets state", async () => {
    vi.mocked(auth as any).mockResolvedValue({
      user: { id: "user-1", email: "user@example.com", role: "USER" },
      expires: new Date().toISOString(),
    });

    vi.mocked(prisma.$transaction).mockImplementation(async (callback: any) => {
      const tx = {
        project: {
          create: vi.fn().mockResolvedValue({ id: "project-openclaw" }),
          update: vi.fn().mockResolvedValue({ id: "project-openclaw" }),
        },
        runLog: {
          create: vi.fn().mockResolvedValue({}),
        },
      };

      const result = await callback(tx);

      expect(tx.project.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          name: "My OpenClaw",
          mode: "personal",
          ownerScopeType: "user",
          ownerScopeId: "user-1",
          agent: "openclaw",
          agentImpl: "gateway",
          runnerBackend: "local",
          envOverrides: JSON.stringify({ CI: null, NODE_OPTIONS: "--max-old-space-size=2048" }),
          visibility: "private",
          requiredSecrets: expect.any(String),
          budget: {
            create: {
              isEnabled: true,
              totalCreditsUsd: 20,
              usedCreditsUsd: 0,
            },
          },
          components: {
            create: expect.objectContaining({
              name: "gateway",
              kind: "app",
              powerIntent: "OFF",
              runtimeState: "ABSENT",
              agentState: null,
              blockers: ["SECRETS"],
              sourceType: "package",
              sourceConfig: expect.objectContaining({
                recipeId: "openclaw",
                repositoryUrl: "https://github.com/openclaw/openclaw",
              }),
              runtimeConfig: expect.objectContaining({
                recipeId: "openclaw",
                bootstrap: "direct_command",
                cycleImage: "arena-public-worker-openclaw:local",
                memoryMb: 8192,
                cpuCount: 4,
                commandTemplate: expect.stringContaining("openclaw gateway"),
                runnerBackend: "local",
              }),
            }),
          },
        }),
        select: { id: true },
      });

      expect(tx.project.update).toHaveBeenCalledWith({
        where: { id: "project-openclaw" },
        data: { slug: expect.any(String) },
      });

      expect(tx.runLog.create).toHaveBeenCalledTimes(2);

      return result;
    });

    const result = await createPersonalRecipeProject({
      recipeId: "openclaw",
      name: "My OpenClaw",
      initialBudgetUsd: 20,
      runnerBackend: "local",
    });

    expect(result).toEqual({ success: true, projectId: "project-openclaw" });
  });

  it("blocks OpenClaw recipe when BYOK provider keys are disabled for users", async () => {
    vi.mocked(auth as any).mockResolvedValue({
      user: { id: "user-1", email: "user@example.com", role: "USER" },
      expires: new Date().toISOString(),
    });
    isByokProviderKeysEnabled.mockResolvedValue(false);

    const result = await createPersonalRecipeProject({
      recipeId: "openclaw",
      name: "My OpenClaw",
      initialBudgetUsd: 20,
      runnerBackend: "local",
    });

    expect(result).toEqual({
      success: false,
      error: "User provider API-key launches are disabled.",
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
