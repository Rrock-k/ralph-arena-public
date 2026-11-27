import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { relaunchProject, relaunchProjectInternal, relaunchProjectWithOverrides } from "./relaunch";
import { fakeProject } from "@/test/factories";

const { hasPlatformCapability } = vi.hoisted(() => ({
  hasPlatformCapability: vi.fn(() => false),
}));

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    project: {
      findUnique: vi.fn(),
    },
    agentLoop: {
      findUnique: vi.fn(),
    },
    agentLoopVersion: {
      findUnique: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

vi.mock("@/lib/run-status", () => ({
  isActiveStatus: vi.fn((s: string) => ["RUNNING", "PROVISIONING", "QUEUED", "PAUSING"].includes(s)),
}));

vi.mock("@/lib/project-budget", () => ({
  enforceRequiredProjectBudget: vi.fn(),
  formatBudgetBlockedMessage: vi.fn((remaining: number) => `Insufficient budget ($${remaining.toFixed(2)} remaining)`),
}));

vi.mock("@/lib/project-audit", () => ({
  preLaunchCheck: vi.fn(),
}));

vi.mock("@/lib/control-plane", () => ({
  resolveLoopAndTool: vi.fn().mockResolvedValue({
    toolId: "tool-1",
    agentLoopVersionId: "loop-version-1",
  }),
}));

vi.mock("@/lib/e2e-auth-bypass", () => ({
  hasE2EAdminBypass: vi.fn().mockResolvedValue(false),
}));

vi.mock("@/lib/platform-access", () => ({
  resolvePlatformAccess: vi.fn().mockResolvedValue({
    hasCapability: hasPlatformCapability,
  }),
}));

vi.mock("@/lib/user-launch-policy", () => ({
  enforceUserLaunchPolicy: vi.fn().mockResolvedValue({ allowed: true }),
  normalizeProviderBillingMode: vi.fn((value: string | null | undefined) =>
    value === "platform_credits" || value === "platform_credentials" ? value : "byok",
  ),
  parseProviderBillingMode: vi.fn((value: string | null | undefined) =>
    value === "byok" || value === "platform_credits" || value === "platform_credentials" ? value : null,
  ),
  normalizeAuthModesForProviderBilling: vi.fn((agent: string, mode: string | null | undefined, modes: any) => {
    const billingMode = mode === "platform_credits" || mode === "platform_credentials" ? mode : "byok";
    if (billingMode === "platform_credits") {
      return { claudeAuthMode: null, codexAuthMode: null };
    }
    if (agent === "codex") {
      return { claudeAuthMode: null, codexAuthMode: "api_key" };
    }
    if (agent === "claude-code") {
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

vi.mock("@/lib/progress-bus", () => ({
  notifyProjectChanged: vi.fn(),
  progressBus: {
    notifyChanged: vi.fn(),
  },
}));

vi.mock("@/lib/log-writer", () => ({
  appendLifecycle: vi.fn(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/project-access", () => ({
  requireProjectCapability: vi.fn(),
}));

vi.mock("@/app/actions/container-ops", () => ({
  removeContainerInternal: vi.fn(),
}));

vi.mock("@/lib/project-state-effects", () => ({
  applyStateChange: vi.fn().mockResolvedValue({}),
  prepareRuntimeForFreshClaim: vi.fn().mockResolvedValue({ row: {}, clearedStartIntentHistory: false, clearedInfraBlocker: false }),
  resetComponentForFreshStart: vi.fn().mockResolvedValue({}),
  updateComponentMetadata: vi.fn().mockResolvedValue({}),
  requirePrimaryComponentRow: vi.fn(),
}));

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { enforceRequiredProjectBudget } from "@/lib/project-budget";
import { preLaunchCheck } from "@/lib/project-audit";
import { notifyProjectChanged, progressBus } from "@/lib/progress-bus";
import { appendLifecycle } from "@/lib/log-writer";
import { revalidatePath } from "next/cache";
import { requireProjectCapability } from "@/lib/project-access";
import { removeContainerInternal } from "@/app/actions/container-ops";
import { requirePrimaryComponentRow, applyStateChange, prepareRuntimeForFreshClaim } from "@/lib/project-state-effects";
import { getClaimableRuntimeIntent } from "@/lib/runtime-intents";
import { resolveLoopAndTool } from "@/lib/control-plane";
import { INTERNAL_ACTION_TOKEN } from "@/lib/internal-action-token";

const adminSession = {
  user: { id: "admin-1", email: "admin@example.com", role: "ADMIN" },
  expires: new Date().toISOString(),
};

describe("relaunchProject", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hasPlatformCapability.mockReturnValue(false);
    vi.stubGlobal("fetch", vi.fn());
    vi.mocked(preLaunchCheck).mockResolvedValue([]);
    vi.mocked(enforceRequiredProjectBudget).mockResolvedValue({ allowed: true, remainingUsd: Number.POSITIVE_INFINITY });
    vi.mocked((prisma as any).agentLoop.findUnique).mockResolvedValue({ currentVersionId: null });
    vi.mocked((prisma as any).agentLoopVersion.findUnique).mockResolvedValue({
      version: "1.0.0",
      supportTier: "supported",
      agentLoop: { name: "direct" },
    });
    vi.mocked(requireProjectCapability).mockResolvedValue({
      authorized: true,
      project: { id: "project-1", mode: "personal", ownerScopeType: "user", ownerScopeId: "user-1" },
    } as any);
    vi.mocked(removeContainerInternal).mockResolvedValue({ success: true });
    vi.mocked(requirePrimaryComponentRow as any).mockResolvedValue({
      projectId: "project-1",
      componentId: "component-1",
      powerIntent: "ON",
      runtimeState: "ABSENT",
      agentState: "IDLE",
      blockers: [],
      lastOutcome: null,
      lastOutcomeAt: null,
      retryAt: null,
      previewHealth: "UNKNOWN",
      previewCheckedAt: null,
      provisionedAt: null,
      containerName: null,
      previewUrl: null,
      workerHost: null,
      vpsHostId: null,
      lastHeartbeat: null,
      retryCount: 0,
      archivedAt: null,
    });
  });

  it("blocks direct internal relaunch without trusted server token", async () => {
    const result = await relaunchProjectInternal("project-1");

    expect(result).toEqual({
      success: false,
      error: "Internal action is not callable directly.",
    });
    expect(prisma.project.findUnique).not.toHaveBeenCalled();
  });

  it("returns Unauthorized for anonymous user", async () => {
    vi.mocked(requireProjectCapability).mockResolvedValue({ authorized: false, error: "Unauthorized" } as any);

    const result = await relaunchProject("project-1");

    expect(result.success).toBe(false);
    expect(result.error).toBe("Unauthorized");
  });

  it("does not let legacy budget guard block BYOK relaunch", async () => {
    vi.mocked(auth as any).mockResolvedValue(adminSession as any);
    vi.mocked(prisma.project.findUnique).mockResolvedValue({
      ...fakeProject(),
      specs: [{ content: "spec" }],
    } as any);
    vi.mocked(enforceRequiredProjectBudget).mockResolvedValue({ allowed: false, remainingUsd: 0.05 });

    const result = await relaunchProject("project-1");

    expect(result.success).toBe(true);
    expect(enforceRequiredProjectBudget).not.toHaveBeenCalled();
  });

  it("allows Platform Credits relaunch when required budget guard passes", async () => {
    vi.mocked(auth as any).mockResolvedValue(adminSession as any);
    vi.mocked(prisma.project.findUnique).mockResolvedValue({
      ...fakeProject({
        providerBillingMode: "platform_credits",
      }),
      specs: [{ content: "spec" }],
    } as any);

    const result = await relaunchProject("project-1");

    expect(result.success).toBe(true);
    expect(enforceRequiredProjectBudget).toHaveBeenCalledWith("project-1");
  });

  it("blocks relaunch when pre-launch audit gate reports violations", async () => {
    vi.mocked(auth as any).mockResolvedValue(adminSession as any);
    vi.mocked(preLaunchCheck).mockResolvedValue(["previewUrl missing"]);
    vi.mocked(prisma.project.findUnique).mockResolvedValue({
      ...fakeProject(),
      specs: [{ content: "spec" }],
    } as any);

    const result = await relaunchProject("project-1");

    expect(result.success).toBe(false);
    expect(result.error).toBe("Pre-launch check failed:\npreviewUrl missing");
    expect(enforceRequiredProjectBudget).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("returns error when project is already active", async () => {
    vi.mocked(auth as any).mockResolvedValue(adminSession as any);
    vi.mocked(prisma.project.findUnique).mockResolvedValue({
      ...fakeProject(),
      specs: [{ content: "spec" }],
      components: [{ kind: "app", powerIntent: "ON", runtimeState: "RUNNING", agentState: "RUNNING" }],
    } as any);

    const result = await relaunchProject("project-1");

    expect(result.success).toBe(false);
    expect(result.error).toBe("Project is already active");
  });

  it("allows relaunch for failed preview-bearing rows instead of treating them as active", async () => {
    vi.mocked(auth as any).mockResolvedValue(adminSession as any);
    vi.mocked(prisma.project.findUnique).mockResolvedValue({
      ...fakeProject({
        containerName: "preview-project-1",
        previewUrl: "https://preview.example.com",
        workerHost: "local",
      }),
      specs: [{ content: "spec" }],
      vpsHost: null,
      components: [{
        id: "component-1",
        kind: "app",
        powerIntent: "ON",
        runtimeState: "RUNNING",
        agentState: "FAILED",
        lastOutcome: "FAILED",
        blockers: [],
        previewUrl: "https://preview.example.com",
        containerName: "preview-project-1",
        workerHost: "local",
        runtimeConfig: {},
      }],
    } as any);
    vi.mocked(enforceRequiredProjectBudget).mockResolvedValue({ allowed: true, remainingUsd: 12 });
    vi.mocked(prisma.$transaction).mockImplementation(async (cb: any) => {
      const tx = {
        project: {
          update: vi.fn().mockResolvedValue({ id: "project-1" }),
        },
        projectComponent: {
          update: vi.fn().mockResolvedValue({ id: "component-1" }),
        },
        runLog: {
          create: vi.fn().mockResolvedValue({}),
        },
        logArchive: {
          create: vi.fn().mockResolvedValue({}),
        },
      };
      return cb(tx);
    });

    const result = await relaunchProject("project-1");

    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();
    expect(removeContainerInternal).toHaveBeenCalledWith("project-1", INTERNAL_ACTION_TOKEN);
  });

  it("does not tear down stale project-level runtime mirrors when component identity is already gone", async () => {
    vi.mocked(auth as any).mockResolvedValue(adminSession as any);
    vi.mocked(prisma.project.findUnique).mockResolvedValue({
      ...fakeProject({
        containerName: "preview-stale-project-mirror",
        previewUrl: "https://stale-project-mirror.example.com",
        workerHost: "local",
      }),
      specs: [{ content: "spec" }],
      vpsHost: null,
      components: [{
        id: "component-1",
        kind: "app",
        powerIntent: "ON",
        runtimeState: "ABSENT",
        agentState: "IDLE",
        lastOutcome: "FAILED",
        blockers: [],
        previewUrl: null,
        containerName: null,
        workerHost: null,
        runtimeConfig: {},
      }],
    } as any);
    vi.mocked(enforceRequiredProjectBudget).mockResolvedValue({ allowed: true, remainingUsd: 12 });

    vi.mocked(prisma.$transaction).mockImplementation(async (cb: any) => {
      const tx = {
        project: {
          update: vi.fn().mockResolvedValue({ id: "project-1" }),
        },
        projectComponent: {
          update: vi.fn().mockResolvedValue({ id: "component-1" }),
        },
        runLog: {
          create: vi.fn().mockResolvedValue({}),
        },
      };
      return cb(tx);
    });

    const result = await relaunchProject("project-1");

    expect(result.success).toBe(true);
    expect(removeContainerInternal).not.toHaveBeenCalled();
  });

  it("blocks relaunch for archived state", async () => {
    vi.mocked(auth as any).mockResolvedValue(adminSession as any);
    vi.mocked(prisma.project.findUnique).mockResolvedValue({
      ...fakeProject({ archivedAt: new Date("2026-04-01") }),
      specs: [{ content: "spec" }],
      components: [{ kind: "app", powerIntent: "OFF" }],
    } as any);

    const result = await relaunchProject("project-1");

    expect(result.success).toBe(false);
    expect(result.error).toBe("Project is archived. Unarchive it before relaunch.");
  });

  it("blocks plain relaunch for pinned loop rows until an explicit upgrade path is used", async () => {
    vi.mocked(auth as any).mockResolvedValue(adminSession as any);
    vi.mocked((prisma as any).agentLoop.findUnique).mockResolvedValue({ currentVersionId: "ralph-v150" });
    vi.mocked((prisma as any).agentLoopVersion.findUnique).mockResolvedValue({
      version: "1.5.0",
      supportTier: "supported",
      agentLoop: { name: "ralph" },
    });
    vi.mocked(prisma.project.findUnique).mockResolvedValue({
      ...fakeProject({
        agentImpl: "ralph",
        agentLoopVersionId: "ralph-v1.4.0",
      }),
      specs: [{ content: "spec" }],
      components: [{ kind: "app", powerIntent: "OFF", runtimeState: "ABSENT", agentState: "IDLE", blockers: [], lastOutcome: "COMPLETED", runtimeConfig: {} }],
    } as any);

    const result = await relaunchProject("project-1");

    expect(result.success).toBe(false);
    expect(result.error).toContain("Upgrade this project before relaunching it");
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("keeps explicit override relaunch as the migration path onto Repo HEAD", async () => {
    vi.mocked(auth as any).mockResolvedValue(adminSession as any);
    vi.mocked((prisma as any).agentLoop.findUnique).mockResolvedValue({ currentVersionId: "ralph-v150" });
    vi.mocked((prisma as any).agentLoopVersion.findUnique).mockResolvedValue({
      version: "1.5.0",
      supportTier: "supported",
      agentLoop: { name: "ralph" },
    });
    vi.mocked(prisma.project.findUnique).mockResolvedValue({
      ...fakeProject({
        agentImpl: "ralph",
        agentLoopVersionId: "ralph-v1.4.0",
        toolId: "claude-code",
        model: "haiku",
        claudeAuthMode: "oauth",
      }),
      specs: [{ content: "spec" }],
      components: [{
        id: "component-1",
        kind: "app",
        powerIntent: "OFF",
        runtimeState: "ABSENT",
        agentState: "IDLE",
        blockers: [],
        lastOutcome: "COMPLETED",
        runtimeConfig: { model: "haiku", toolId: "claude-code", agentLoopVersionId: "ralph-v1.4.0" },
        sourceConfig: { recipe: "agent_project", repoBranch: "main", agent: "claude-code", agentImpl: "ralph" },
      }],
    } as any);
    const projectUpdate = vi.fn().mockResolvedValue({ id: "project-1" });
    const componentUpdate = vi.fn().mockResolvedValue({ id: "component-1" });
    vi.mocked(prisma.$transaction).mockImplementation(async (cb: any) => {
      const tx = {
        project: {
          update: projectUpdate,
        },
        projectComponent: {
          update: componentUpdate,
        },
        runLog: {
          create: vi.fn().mockResolvedValue({}),
        },
      };
      return cb(tx);
    });

    const result = await relaunchProjectWithOverrides("project-1", { model: "gpt-5.4" });

    expect(result.success).toBe(true);
    expect(projectUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        agent: "codex",
        agentImpl: "ralph",
        model: "gpt-5.4",
        tool: { connect: { id: "tool-1" } },
        agentLoopVersion: { connect: { id: "ralph-v150" } },
        claudeAuthMode: null,
        codexAuthMode: "api_key",
      }),
    }));
    expect(componentUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        sourceConfig: expect.objectContaining({
          agent: "codex",
          agentImpl: "ralph",
          toolId: "tool-1",
          agentLoopVersionId: "ralph-v150",
        }),
        runtimeConfig: expect.objectContaining({
          model: "gpt-5.4",
          toolId: "tool-1",
          agentLoopVersionId: "ralph-v150",
          useRepoHead: true,
          claudeAuthMode: null,
          codexAuthMode: "api_key",
        }),
      }),
    }));
  });

  it("rejects nonprivileged billing-mode changes on override relaunch", async () => {
    vi.mocked(auth as any).mockResolvedValue(adminSession as any);
    vi.mocked(prisma.project.findUnique).mockResolvedValue({
      ...fakeProject({
        providerBillingMode: "byok",
        agent: "codex",
        agentImpl: "ralph",
      }),
      specs: [{ content: "spec" }],
      components: [{
        id: "component-1",
        kind: "app",
        powerIntent: "OFF",
        runtimeState: "ABSENT",
        agentState: "IDLE",
        blockers: [],
        lastOutcome: "COMPLETED",
        runtimeConfig: {},
        sourceConfig: {},
      }],
    } as any);

    const result = await relaunchProjectWithOverrides("project-1", {
      providerBillingMode: "platform_credits",
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe("Provider billing mode cannot be changed on relaunch.");
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("rejects unsupported provider billing modes on override relaunch", async () => {
    vi.mocked(auth as any).mockResolvedValue(adminSession as any);
    vi.mocked(prisma.project.findUnique).mockResolvedValue({
      ...fakeProject({
        providerBillingMode: "byok",
        agent: "codex",
        agentImpl: "ralph",
      }),
      specs: [{ content: "spec" }],
      components: [{
        id: "component-1",
        kind: "app",
        powerIntent: "OFF",
        runtimeState: "ABSENT",
        agentState: "IDLE",
        blockers: [],
        lastOutcome: "COMPLETED",
        runtimeConfig: {},
        sourceConfig: {},
      }],
    } as any);

    const result = await relaunchProjectWithOverrides("project-1", {
      providerBillingMode: "platform-creditz",
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe("Invalid providerBillingMode: platform-creditz");
    expect(resolveLoopAndTool).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("keeps plain relaunch on persisted config without touching override resolution", async () => {
    vi.mocked(auth as any).mockResolvedValue(adminSession as any);
    vi.mocked(prisma.project.findUnique).mockResolvedValue({
      ...fakeProject({
        agent: "codex",
        agentImpl: "direct",
        toolId: "tool-existing",
        agentLoopVersionId: null,
        model: "gpt-5.4",
      }),
      specs: [{ content: "spec" }],
      components: [{
        id: "component-1",
        kind: "app",
        powerIntent: "OFF",
        runtimeState: "ABSENT",
        agentState: "IDLE",
        blockers: [],
        lastOutcome: "COMPLETED",
        runtimeConfig: { model: "gpt-5.4" },
        sourceConfig: { recipe: "agent_project", agent: "codex", agentImpl: "direct" },
      }],
    } as any);
    const projectUpdate = vi.fn().mockResolvedValue({ id: "project-1" });
    const componentUpdate = vi.fn().mockResolvedValue({ id: "component-1" });
    vi.mocked(prisma.$transaction).mockImplementation(async (cb: any) => {
      const tx = {
        project: {
          update: projectUpdate,
        },
        projectComponent: {
          update: componentUpdate,
        },
        runLog: {
          create: vi.fn().mockResolvedValue({}),
        },
      };
      return cb(tx);
    });

    const result = await relaunchProject("project-1");

    expect(result.success).toBe(true);
    expect(resolveLoopAndTool).not.toHaveBeenCalled();
    expect((prisma as any).agentLoop.findUnique).not.toHaveBeenCalled();
    expect(componentUpdate).not.toHaveBeenCalled();
    expect(projectUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.not.objectContaining({
        agent: expect.anything(),
        agentImpl: expect.anything(),
        tool: expect.anything(),
        agentLoopVersion: expect.anything(),
      }),
    }));
  });

  it("does not use plain relaunch as hidden Platform Credits auth repair", async () => {
    vi.mocked(auth as any).mockResolvedValue(adminSession as any);
    vi.mocked(prisma.project.findUnique).mockResolvedValue({
      ...fakeProject({
        agent: "codex",
        providerBillingMode: "platform_credits",
        claudeAuthMode: null,
        codexAuthMode: "api_key",
      }),
      specs: [{ content: "spec" }],
      components: [{
        id: "component-1",
        kind: "app",
        powerIntent: "OFF",
        runtimeState: "ABSENT",
        agentState: "IDLE",
        blockers: [],
        lastOutcome: "COMPLETED",
        runtimeConfig: {
          persisted: "value",
          providerBillingMode: "byok",
          codexAuthMode: "api_key",
        },
        sourceConfig: { recipe: "agent_project", agent: "codex", agentImpl: "direct" },
      }],
    } as any);
    const projectUpdate = vi.fn().mockResolvedValue({ id: "project-1" });
    const componentUpdate = vi.fn().mockResolvedValue({ id: "component-1" });
    vi.mocked(prisma.$transaction).mockImplementation(async (cb: any) => {
      const tx = {
        project: {
          update: projectUpdate,
        },
        projectComponent: {
          update: componentUpdate,
        },
        runLog: {
          create: vi.fn().mockResolvedValue({}),
        },
      };
      return cb(tx);
    });

    const result = await relaunchProject("project-1");

    expect(result.success).toBe(true);
    expect(projectUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.not.objectContaining({
        claudeAuthMode: expect.anything(),
        codexAuthMode: expect.anything(),
      }),
    }));
    expect(componentUpdate).not.toHaveBeenCalled();
  });

  it("blocks relaunch for unsupported loop identity mismatches", async () => {
    vi.mocked(auth as any).mockResolvedValue(adminSession as any);
    vi.mocked((prisma as any).agentLoopVersion.findUnique).mockResolvedValue({
      version: "1.5.0",
      supportTier: "supported",
      agentLoop: { name: "ralph" },
    });
    vi.mocked(prisma.project.findUnique).mockResolvedValue({
      ...fakeProject({
        agentImpl: "direct",
        agentLoopVersionId: "ralph-v150",
      }),
      specs: [{ content: "spec" }],
      components: [{ kind: "app", powerIntent: "OFF", runtimeState: "ABSENT", agentState: "IDLE", blockers: [], lastOutcome: null, runtimeConfig: {} }],
    } as any);

    const result = await relaunchProject("project-1");

    expect(result.success).toBe(false);
    expect(result.error).toContain("unsupported");
    expect(enforceRequiredProjectBudget).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("queues relaunch when budget allows", async () => {
    vi.mocked(auth as any).mockResolvedValue(adminSession as any);
    vi.mocked(prisma.project.findUnique).mockResolvedValue({
      ...fakeProject({ retryCount: 4 }),
      specs: [{ content: "spec A" }, { content: "spec B" }],
    } as any);
    vi.mocked(enforceRequiredProjectBudget).mockResolvedValue({ allowed: true, remainingUsd: 12 });
    const update = vi.fn().mockResolvedValue({ id: "project-1" });

    vi.mocked(prisma.$transaction).mockImplementation(async (cb: any) => {
      const tx = {
        project: {
          update,
        },
        runLog: {
          create: vi.fn().mockResolvedValue({}),
        },
      };
      return cb(tx);
    });

    const result = await relaunchProject("project-1");

    expect(result.success).toBe(true);
    expect((result as any).projectId).toBe("project-1");
    expect(update).toHaveBeenCalled();
    expect(revalidatePath).toHaveBeenCalledWith("/admin");
    expect(revalidatePath).toHaveBeenCalledWith("/");
    expect(notifyProjectChanged).toHaveBeenCalledWith("project-1");
    expect(progressBus.notifyChanged).not.toHaveBeenCalled();
  });

  it("returns project not found when relaunch races with deletion", async () => {
    vi.mocked(prisma.project.findUnique).mockResolvedValue({
      ...fakeProject(),
      specs: [{ content: "spec A" }],
    } as any);
    vi.mocked(enforceRequiredProjectBudget).mockResolvedValue({ allowed: true, remainingUsd: 12 });

    vi.mocked(prisma.$transaction).mockImplementation(async (cb: any) => {
      const tx = {
        project: {
          update: vi.fn().mockRejectedValue(Object.assign(new Error("missing"), { code: "P2025" })),
        },
        projectComponent: {
          update: vi.fn().mockResolvedValue({}),
        },
        runLog: {
          create: vi.fn().mockResolvedValue({}),
        },
        logArchive: {
          create: vi.fn().mockResolvedValue({}),
        },
      };
      return cb(tx);
    });

    const result = await relaunchProject("project-1");

    expect(result.success).toBe(false);
    expect(result.error).toBe("Project not found");
  });

  it("does not snapshot previous raw log history into LogArchive during relaunch", async () => {
    vi.mocked(prisma.project.findUnique).mockResolvedValue({
      ...fakeProject({ log: "previous log output" }),
      specs: [{ content: "spec A" }],
      vpsHost: null,
      components: [
        {
          id: "component-1",
          kind: "app",
          powerIntent: "OFF",
          agentIntent: "OFF",
          runtimeState: "ABSENT",
          agentState: "IDLE",
          blockers: [],
          lastOutcome: null,
          runtimeConfig: {},
        },
      ],
    } as any);
    vi.mocked(enforceRequiredProjectBudget).mockResolvedValue({ allowed: true, remainingUsd: 12 });
    const logArchiveCreate = vi.fn().mockResolvedValue({});
    const projectUpdate = vi.fn().mockResolvedValue({ id: "project-1" });

    vi.mocked(prisma.$transaction).mockImplementation(async (cb: any) => {
      const tx = {
        project: {
          update: projectUpdate,
        },
        projectComponent: {
          update: vi.fn().mockResolvedValue({ id: "component-1" }),
        },
        runLog: {
          create: vi.fn().mockResolvedValue({}),
        },
        logArchive: {
          create: logArchiveCreate,
        },
      };
      return cb(tx);
    });

    const result = await relaunchProject("project-1");

    expect(result.success).toBe(true);
    expect(projectUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        log: null,
      }),
    }));
    expect(logArchiveCreate).not.toHaveBeenCalled();
  });

  it("tears down retained runtime before relaunch and clears legacy runtime identity", async () => {
    // RA-237: mock returns RUNNING so relaunch must write runtimeObserved(ABSENT)
    vi.mocked(requirePrimaryComponentRow as any).mockResolvedValue({
      projectId: "project-1",
      componentId: "component-1",
      powerIntent: "ON",
      runtimeState: "RUNNING",
      agentState: "IDLE",
      blockers: [],
      lastOutcome: "COMPLETED",
      lastOutcomeAt: null,
      retryAt: null,
      previewHealth: "HEALTHY",
      previewCheckedAt: null,
      provisionedAt: null,
      containerName: "preview-project-1",
      previewUrl: "https://preview.example.com",
      workerHost: "local",
      vpsHostId: null,
      lastHeartbeat: null,
      retryCount: 0,
      archivedAt: null,
    });
    vi.mocked(prisma.project.findUnique).mockResolvedValue({
      ...fakeProject({
        containerName: "preview-project-1",
        previewUrl: "https://preview.example.com",
        workerHost: "local",
      }),
      specs: [{ content: "spec A" }],
      vpsHost: null,
      components: [
        {
          id: "component-1",
          kind: "app",
          powerIntent: "ON",
          runtimeState: "ABSENT",
          agentState: "IDLE",
          lastOutcome: null,
          containerName: "preview-project-1",
          workerHost: "local",
          runtimeConfig: {},
        },
      ],
    } as any);
    vi.mocked(enforceRequiredProjectBudget).mockResolvedValue({ allowed: true, remainingUsd: 12 });
    const projectUpdate = vi.fn().mockResolvedValue({ id: "project-1" });

    vi.mocked(prisma.$transaction).mockImplementation(async (cb: any) => {
      const tx = {
        project: {
          update: projectUpdate,
        },
        projectComponent: {
          update: vi.fn().mockResolvedValue({ id: "component-1" }),
        },
        runLog: {
          create: vi.fn().mockResolvedValue({}),
        },
        logArchive: {
          create: vi.fn().mockResolvedValue({}),
        },
      };
      return cb(tx);
    });

    const result = await relaunchProject("project-1");

    expect(result.success).toBe(true);
    expect(removeContainerInternal).toHaveBeenCalledWith("project-1", INTERNAL_ACTION_TOKEN);
    expect(projectUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        commitSha: null,
        log: null,
      }),
    }));
    // RA-257: relaunch now normalizes teardown through the shared fresh-start helper
    expect(prepareRuntimeForFreshClaim).toHaveBeenCalledWith(
      expect.anything(),
      "project-1",
      expect.objectContaining({ source: "system", trigger: "relaunch_reset" }),
      expect.objectContaining({ clearInfraBlocker: true }),
    );
  });

  it("fails relaunch when stale runtime teardown fails", async () => {
    vi.mocked(prisma.project.findUnique).mockResolvedValue({
      ...fakeProject({
        containerName: "preview-project-1",
        workerHost: "local",
      }),
      specs: [{ content: "spec A" }],
      vpsHost: null,
      components: [
        {
          id: "component-1",
          kind: "app",
          powerIntent: "ON",
          runtimeState: "ABSENT",
          agentState: "IDLE",
          lastOutcome: null,
          containerName: "preview-project-1",
          workerHost: "local",
          runtimeConfig: {},
        },
      ],
    } as any);
    vi.mocked(enforceRequiredProjectBudget).mockResolvedValue({ allowed: true, remainingUsd: 12 });
    vi.mocked(removeContainerInternal).mockResolvedValue({
      success: false,
      error: "Remove failed (500): boom",
    });

    const result = await relaunchProject("project-1");

    expect(result.success).toBe(false);
    expect(result.error).toContain("Failed to tear down stale runtime preview-project-1");
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("does not fabricate LAUNCHED or QUEUED history during plain relaunch", async () => {
    vi.mocked(auth as any).mockResolvedValue(adminSession as any);
    const runLogCreate = vi.fn().mockResolvedValue({});
    vi.mocked(prisma.project.findUnique).mockResolvedValue({
      ...fakeProject({
        repoUrl: "https://github.com/acme/project-1.git",
        runnerBackend: "local",
      }),
      specs: [{ content: "spec A" }],
      components: [
        {
          id: "component-1",
          kind: "app",
          powerIntent: "OFF",
          runtimeState: "ABSENT",
          agentState: "IDLE",
          blockers: [],
          lastOutcome: "COMPLETED",
          runtimeConfig: {},
        },
      ],
    } as any);
    vi.mocked(enforceRequiredProjectBudget).mockResolvedValue({ allowed: true, remainingUsd: 12 });

    vi.mocked(prisma.$transaction).mockImplementation(async (cb: any) => {
      const tx = {
        project: {
          update: vi.fn().mockResolvedValue({ id: "project-1" }),
        },
        projectComponent: {
          update: vi.fn().mockResolvedValue({ id: "component-1" }),
        },
        runLog: {
          create: runLogCreate,
        },
      };
      return cb(tx);
    });

    const result = await relaunchProject("project-1");

    expect(result.success).toBe(true);
    expect(runLogCreate).not.toHaveBeenCalled();
    expect(appendLifecycle).not.toHaveBeenCalled();
  });

  it("does not rewrite component runtimeConfig during plain relaunch", async () => {
    vi.mocked(auth as any).mockResolvedValue(adminSession as any);
    vi.mocked(prisma.project.findUnique).mockResolvedValue({
      ...fakeProject(),
      specs: [{ content: "spec A" }],
      components: [
        {
          id: "component-1",
          kind: "app",
          powerIntent: "OFF",
          runtimeState: "ABSENT",
          agentState: "IDLE",
          blockers: [],
          lastOutcome: null,
          runtimeConfig: {
            commandTemplate: "node {loopdir}/dist/index.js run",
            persisted: "value",
          },
        },
      ],
    } as any);
    vi.mocked(enforceRequiredProjectBudget).mockResolvedValue({ allowed: true, remainingUsd: 12 });
    const componentUpdate = vi.fn().mockResolvedValue({ id: "component-1" });

    vi.mocked(prisma.$transaction).mockImplementation(async (cb: any) => {
      const tx = {
        project: {
          update: vi.fn().mockResolvedValue({ id: "project-1" }),
        },
        projectComponent: {
          update: componentUpdate,
        },
        runLog: {
          create: vi.fn().mockResolvedValue({}),
        },
      };
      return cb(tx);
    });

    const result = await relaunchProject("project-1");

    expect(result.success).toBe(true);
    expect(componentUpdate).not.toHaveBeenCalled();
  });

  it("does not rewrite specSnapshot during relaunch", async () => {
    vi.mocked(auth as any).mockResolvedValue(adminSession as any);
    const projectUpdate = vi.fn().mockResolvedValue({ id: "project-1" });
    vi.mocked(prisma.project.findUnique).mockResolvedValue({
      ...fakeProject({
        specSnapshot: "old stale snapshot",
      }),
      specs: [{ content: "spec A" }],
      components: [
        {
          id: "component-1",
          kind: "app",
          powerIntent: "OFF",
          runtimeState: "ABSENT",
          agentState: "IDLE",
          blockers: [],
          lastOutcome: null,
          runtimeConfig: {},
        },
      ],
    } as any);
    vi.mocked(enforceRequiredProjectBudget).mockResolvedValue({ allowed: true, remainingUsd: 12 });
    vi.mocked(prisma.$transaction).mockImplementation(async (cb: any) => {
      const tx = {
        project: {
          update: projectUpdate,
        },
        projectComponent: {
          update: vi.fn().mockResolvedValue({ id: "component-1" }),
        },
        runLog: {
          create: vi.fn().mockResolvedValue({}),
        },
      };
      return cb(tx);
    });

    const result = await relaunchProject("project-1");

    expect(result.success).toBe(true);
    expect(projectUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.not.objectContaining({
        specSnapshot: expect.anything(),
      }),
    }));
  });

  it("leaves existing Repo HEAD runtimeConfig untouched during plain relaunch", async () => {
    vi.mocked(auth as any).mockResolvedValue(adminSession as any);
    const componentUpdate = vi.fn().mockResolvedValue({ id: "component-1" });
    vi.mocked(prisma.project.findUnique).mockResolvedValue({
      ...fakeProject(),
      specs: [{ content: "spec A" }],
      components: [
        {
          id: "component-1",
          kind: "app",
          powerIntent: "OFF",
          runtimeState: "ABSENT",
          agentState: "IDLE",
          blockers: [],
          lastOutcome: null,
          runtimeConfig: {
            commandTemplate: "node {loopdir}/dist/index.js run",
            useRepoHead: true,
            persisted: "value",
          },
        },
      ],
    } as any);
    vi.mocked(enforceRequiredProjectBudget).mockResolvedValue({ allowed: true, remainingUsd: 12 });

    vi.mocked(prisma.$transaction).mockImplementation(async (cb: any) => {
      const tx = {
        project: {
          update: vi.fn().mockResolvedValue({ id: "project-1" }),
        },
        projectComponent: {
          update: componentUpdate,
        },
        runLog: {
          create: vi.fn().mockResolvedValue({}),
        },
      };
      return cb(tx);
    });

    const result = await relaunchProject("project-1");

    expect(result.success).toBe(true);
    expect(componentUpdate).not.toHaveBeenCalled();
  });

  it("does not silently rewrite loop-version metadata during plain relaunch", async () => {
    vi.mocked(auth as any).mockResolvedValue(adminSession as any);
    vi.mocked((prisma as any).agentLoop.findUnique).mockResolvedValue({ currentVersionId: "ralph-v150" });
    vi.mocked((prisma as any).agentLoopVersion.findUnique).mockResolvedValue({
      version: "1.5.0",
      supportTier: "supported",
      agentLoop: { name: "ralph" },
    });
    vi.mocked(prisma.project.findUnique).mockResolvedValue({
      ...fakeProject({
        agentImpl: "ralph",
        agentLoopVersionId: null,
      }),
      specs: [{ content: "spec A" }],
      components: [{
        id: "component-1",
        kind: "app",
        powerIntent: "OFF",
        runtimeState: "ABSENT",
        agentState: "IDLE",
        blockers: [],
        lastOutcome: null,
        runtimeConfig: { useRepoHead: true, agentLoopVersionId: "ralph-v1.4.0" },
      }],
    } as any);
    vi.mocked(enforceRequiredProjectBudget).mockResolvedValue({ allowed: true, remainingUsd: 12 });
    const projectUpdate = vi.fn().mockResolvedValue({ id: "project-1" });

    vi.mocked(prisma.$transaction).mockImplementation(async (cb: any) => {
      const tx = {
        project: {
          update: projectUpdate,
        },
        projectComponent: {
          update: vi.fn().mockResolvedValue({ id: "component-1" }),
        },
        runLog: {
          create: vi.fn().mockResolvedValue({}),
        },
      };
      return cb(tx);
    });

    const result = await relaunchProject("project-1");

    expect(result.success).toBe(true);
    expect(projectUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.not.objectContaining({
        agentLoopVersionId: "ralph-v150",
      }),
    }));
    expect((prisma as any).agentLoop.findUnique).not.toHaveBeenCalled();
  });

  it("resets FAILED agent state to IDLE during relaunch so claim can pick it up", async () => {
    vi.mocked(auth as any).mockResolvedValue(adminSession as any);
    vi.mocked(prisma.project.findUnique).mockResolvedValue({
      ...fakeProject(),
      specs: [{ content: "spec A" }],
      components: [
        {
          id: "component-1",
          kind: "app",
          powerIntent: "ON",
          runtimeState: "ABSENT",
          agentState: "FAILED",
          blockers: [],
          lastOutcome: "FAILED",
        },
      ],
    } as any);
    vi.mocked(enforceRequiredProjectBudget).mockResolvedValue({ allowed: true, remainingUsd: 12 });

    vi.mocked(prisma.$transaction).mockImplementation(async (cb: any) => {
      const tx = {
        project: {
          update: vi.fn().mockResolvedValue({ id: "project-1" }),
        },
        projectComponent: {
          update: vi.fn().mockResolvedValue({}),
        },
        runLog: {
          create: vi.fn().mockResolvedValue({}),
        },
      };
      return cb(tx);
    });

    const result = await relaunchProject("project-1");

    expect(result.success).toBe(true);
    expect(prepareRuntimeForFreshClaim).toHaveBeenCalledWith(
      expect.anything(),
      "project-1",
      expect.objectContaining({ source: "system", trigger: "relaunch_reset" }),
      expect.objectContaining({ provisionedAt: null }),
    );
  });

  it("rejects relaunch while a recoverable INFRA blocker is present", async () => {
    vi.mocked(auth as any).mockResolvedValue(adminSession as any);
    vi.mocked(prisma.project.findUnique).mockResolvedValue({
      ...fakeProject({
        agentImpl: "ralph",
        retryAt: new Date("2026-04-17T18:00:00.000Z"),
      }),
      specs: [{ content: "spec A" }],
      components: [
        {
          id: "component-1",
          kind: "app",
          powerIntent: "OFF",
          agentIntent: "ON",
          runtimeState: "ABSENT",
          agentState: "IDLE",
          blockers: ["INFRA"],
          lastOutcome: null,
          runtimeConfig: {},
        },
      ],
    } as any);
    vi.mocked(enforceRequiredProjectBudget).mockResolvedValue({ allowed: true, remainingUsd: 12 });

    vi.mocked(prisma.$transaction).mockImplementation(async (cb: any) => {
      const tx = {
        project: {
          update: vi.fn().mockResolvedValue({ id: "project-1" }),
        },
        projectComponent: {
          update: vi.fn().mockResolvedValue({ id: "component-1" }),
        },
        runLog: {
          create: vi.fn().mockResolvedValue({}),
        },
      };
      return cb(tx);
    });

    const blockedCandidate = {
      powerIntent: "ON",
      agentIntent: "ON",
      runtimeState: "ABSENT",
      agentState: "IDLE",
      provisionedAt: new Date("2026-04-17T18:00:00.000Z"),
      pendingLoopWork: true,
      allowPreviewOnlyRestore: false,
      blockers: ["INFRA"],
      containerName: null,
      workerHost: null,
      lastState: null,
      lastAttempt: null,
    } as const;
    expect(getClaimableRuntimeIntent(blockedCandidate, { host: "local", maxAttempts: 3 })).toEqual({
      action: "ensure_running",
      runnerMode: "preview_only",
    });

    const result = await relaunchProject("project-1");

    expect(result.success).toBe(false);
    expect(result.error).toContain("INFRA");
    expect(result.error).toContain("Recreate Runtime");
    expect(preLaunchCheck).not.toHaveBeenCalled();
    expect(prepareRuntimeForFreshClaim).not.toHaveBeenCalled();
    expect(removeContainerInternal).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("rejects relaunch while non-recoverable blockers are present", async () => {
    vi.mocked(auth as any).mockResolvedValue(adminSession as any);
    vi.mocked(prisma.project.findUnique).mockResolvedValue({
      ...fakeProject(),
      specs: [{ content: "spec A" }],
      components: [
        {
          id: "component-1",
          kind: "app",
          powerIntent: "OFF",
          runtimeState: "ABSENT",
          agentState: "IDLE",
          agentIntent: "ON",
          blockers: ["BUDGET"],
          lastOutcome: null,
          runtimeConfig: {},
        },
      ],
    } as any);
    vi.mocked(enforceRequiredProjectBudget).mockResolvedValue({ allowed: true, remainingUsd: 12 });

    vi.mocked(prisma.$transaction).mockImplementation(async (cb: any) => {
      const tx = {
        project: {
          update: vi.fn().mockResolvedValue({ id: "project-1" }),
        },
        projectComponent: {
          update: vi.fn().mockResolvedValue({ id: "component-1" }),
        },
        runLog: {
          create: vi.fn().mockResolvedValue({}),
        },
      };
      return cb(tx);
    });

    const result = await relaunchProject("project-1");

    expect(result.success).toBe(false);
    expect(result.error).toContain("BUDGET");
    expect(preLaunchCheck).not.toHaveBeenCalled();
    expect(applyStateChange).not.toHaveBeenCalled();
    expect(prepareRuntimeForFreshClaim).not.toHaveBeenCalled();
    expect(removeContainerInternal).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("rejects invalid claudeAuthMode", async () => {
    vi.mocked(auth as any).mockResolvedValue(adminSession as any);
    vi.mocked(prisma.project.findUnique).mockResolvedValue({
      ...fakeProject(),
      specs: [{ content: "spec A" }],
    } as any);
    vi.mocked(enforceRequiredProjectBudget).mockResolvedValue({ allowed: true, remainingUsd: 12 });

    const result = await relaunchProjectWithOverrides("project-1", { claudeAuthMode: "auto" as any });

    expect(result.success).toBe(false);
    expect(result.error).toBe("Invalid claudeAuthMode: auto");
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("rejects invalid codexAuthMode", async () => {
    vi.mocked(auth as any).mockResolvedValue(adminSession as any);
    vi.mocked(prisma.project.findUnique).mockResolvedValue({
      ...fakeProject(),
      specs: [{ content: "spec A" }],
    } as any);
    vi.mocked(enforceRequiredProjectBudget).mockResolvedValue({ allowed: true, remainingUsd: 12 });

    const result = await relaunchProjectWithOverrides("project-1", { codexAuthMode: "oauth" as any });

    expect(result.success).toBe(false);
    expect(result.error).toBe("Invalid codexAuthMode: oauth");
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("allows relaunch for direct-command recipe projects without specs", async () => {
    vi.mocked(auth as any).mockResolvedValue(adminSession as any);
    vi.mocked(prisma.project.findUnique).mockResolvedValue({
      ...fakeProject({ agent: "openclaw", agentImpl: "gateway" }),
      specs: [],
      components: [
        {
          kind: "app",
          runtimeConfig: {
            commandTemplate: "openclaw gateway --port 3000",
          },
        },
      ],
    } as any);
    vi.mocked(enforceRequiredProjectBudget).mockResolvedValue({ allowed: true, remainingUsd: 12 });

    vi.mocked(prisma.$transaction).mockImplementation(async (cb: any) => {
      const tx = {
        project: {
          update: vi.fn().mockResolvedValue({ id: "project-1" }),
        },
        runLog: {
          create: vi.fn().mockResolvedValue({}),
        },
      };
      return cb(tx);
    });

    const result = await relaunchProject("project-1");

    expect(result.success).toBe(true);
    expect((result as any).projectId).toBe("project-1");
  });
});
