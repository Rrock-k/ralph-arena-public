import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

import {
  setExploreOrder,
  setProjectModel,
  setProjectRuntimeAuthModes,
  setProjectRuntimeSystem,
  setProjectSourceSnapshotInternal,
  setProjectVisibility,
  setProjectVisualEvidenceMode,
} from "./project-settings";

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: vi.fn((arg: unknown) => (
      typeof arg === "function"
        ? (arg as (tx: unknown) => unknown)({
          project: { update: vi.fn() },
          projectComponent: { update: vi.fn() },
          runLog: { create: vi.fn() },
        })
        : Promise.all(arg as unknown[])
    )),
    project: {
      findUnique: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    agentLoop: {
      findUnique: vi.fn(),
    },
    projectComponent: {
      update: vi.fn(),
    },
    runLog: {
      create: vi.fn(),
    },
  },
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/project-access", () => ({
  requireProjectCapability: vi.fn(),
}));

vi.mock("@/lib/platform-access", () => ({
  requirePlatformCapability: vi.fn(),
  resolvePlatformAccess: vi.fn(),
}));

vi.mock("@/lib/progress-bus", () => ({
  notifyProjectChanged: vi.fn(),
}));

import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { requireProjectCapability } from "@/lib/project-access";
import { requirePlatformCapability, resolvePlatformAccess } from "@/lib/platform-access";
import { INTERNAL_ACTION_TOKEN } from "@/lib/internal-action-token";

describe("setProjectVisibility", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should reject unauthenticated users", async () => {
    vi.mocked(requireProjectCapability).mockResolvedValue({
      authorized: false,
      error: "Unauthorized",
    } as any);
    const result = await setProjectVisibility("project-1", "private");
    expect(result.success).toBe(false);
    expect(result.error).toBe("Unauthorized");
  });

  it("should reject non-owner non-admin users", async () => {
    vi.mocked(requireProjectCapability).mockResolvedValue({
      authorized: false,
      error: "Project access denied",
    } as any);
    const result = await setProjectVisibility("project-1", "private");
    expect(result.success).toBe(false);
    expect(result.error).toBe("Project access denied");
  });

  it("should update visibility for admin users", async () => {
    vi.mocked(requireProjectCapability).mockResolvedValue({
      authorized: true,
      isAdmin: true,
      isPersonalOwner: false,
      canManage: true,
    } as any);
    vi.mocked(requirePlatformCapability).mockResolvedValue({
      authorized: true,
    } as any);
    vi.mocked(prisma.project.update).mockResolvedValue({} as any);

    const result = await setProjectVisibility("project-1", "private");
    expect(result.success).toBe(true);
    expect(prisma.project.update).toHaveBeenCalledWith({
      where: { id: "project-1" },
      data: { visibility: "private" },
    });
    expect(revalidatePath).toHaveBeenCalledWith("/");
    expect(revalidatePath).toHaveBeenCalledWith("/explore");
  });

  it("should update visibility for project owner", async () => {
    vi.mocked(requireProjectCapability).mockResolvedValue({
      authorized: true,
      isAdmin: false,
      isPersonalOwner: true,
      canManage: true,
    } as any);
    vi.mocked(prisma.project.update).mockResolvedValue({} as any);

    const result = await setProjectVisibility("project-1", "public");
    expect(result.success).toBe(true);
    expect(prisma.project.update).toHaveBeenCalledWith({
      where: { id: "project-1" },
      data: { visibility: "public" },
    });
    expect(requirePlatformCapability).not.toHaveBeenCalled();
    expect(revalidatePath).toHaveBeenCalledWith("/");
    expect(revalidatePath).toHaveBeenCalledWith("/explore");
  });

  it("should reject non-admin setting featured visibility", async () => {
    vi.mocked(requireProjectCapability).mockResolvedValue({
      authorized: true,
      isAdmin: false,
      isPersonalOwner: true,
      canManage: true,
    } as any);
    vi.mocked(requirePlatformCapability).mockResolvedValue({
      authorized: false,
      error: "Admin access required to feature projects",
    } as any);

    const result = await setProjectVisibility("project-1", "featured");
    expect(result.success).toBe(false);
    expect(result.error).toBe("Admin access required to feature projects");
  });

  it("should allow admin to set featured visibility", async () => {
    vi.mocked(requireProjectCapability).mockResolvedValue({
      authorized: true,
      isAdmin: true,
      isPersonalOwner: false,
      canManage: true,
    } as any);
    vi.mocked(requirePlatformCapability).mockResolvedValue({
      authorized: true,
    } as any);
    vi.mocked(prisma.project.update).mockResolvedValue({} as any);

    const result = await setProjectVisibility("project-1", "featured");
    expect(result.success).toBe(true);
    expect(prisma.project.update).toHaveBeenCalledWith({
      where: { id: "project-1" },
      data: { visibility: "featured" },
    });
    expect(revalidatePath).toHaveBeenCalledWith("/");
    expect(revalidatePath).toHaveBeenCalledWith("/explore");
  });

  it("should handle database errors gracefully", async () => {
    vi.mocked(requireProjectCapability).mockResolvedValue({
      authorized: true,
      isAdmin: true,
      canManage: true,
    } as any);
    vi.mocked(requirePlatformCapability).mockResolvedValue({
      authorized: true,
    } as any);
    vi.mocked(prisma.project.update).mockRejectedValue(new Error("DB error"));

    const result = await setProjectVisibility("project-1", "public");
    expect(result.success).toBe(false);
    expect(result.error).toBe("Failed to update");
  });
});

describe("setProjectModel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked((prisma as any).$transaction).mockImplementation(async (callbackOrOperations: any) => {
      if (typeof callbackOrOperations !== "function") {
        return Promise.all(callbackOrOperations);
      }
      return callbackOrOperations({
        project: { update: vi.fn() },
        projectComponent: { update: vi.fn() },
        runLog: { create: vi.fn() },
      });
    });
    vi.mocked((prisma as any).project.findUnique).mockResolvedValue({
      id: "project-1",
      archivedAt: null,
      agent: "claude-code",
      agentImpl: "ralph",
      model: "claude-sonnet-4-5",
      envOverrides: null,
      toolId: "tool-claude",
      components: [{
        id: "component-1",
        agentState: "IDLE",
        runtimeConfig: { model: "claude-sonnet-4-5", runnerBackend: "local" },
      }],
    });
    vi.mocked((prisma as any).agentLoop.findUnique).mockResolvedValue({
      isActive: true,
      loopTools: [{
        toolId: "tool-claude",
        models: null,
        tool: {
          id: "tool-claude",
          name: "claude-code",
          defaultModelId: "opus-4-8",
          isActive: true,
          models: JSON.stringify([
            { id: "sonnet-4-5", label: "Sonnet 4.5", model: "claude-sonnet-4-5" },
            {
              id: "opus-4-8",
              label: "Opus 4.8",
              model: "claude-opus-4-8",
              envOverrides: { ANTHROPIC_MODEL_FAMILY: "opus" },
            },
          ]),
        },
      }],
    });
  });

  it("rejects callers without runtime management access", async () => {
    vi.mocked(requireProjectCapability).mockResolvedValue({
      authorized: false,
      error: "Project access denied",
    } as any);

    const result = await setProjectModel("project-1", "claude-opus-4-8");

    expect(result.success).toBe(false);
    expect(result.error).toBe("Project access denied");
    expect((prisma as any).project.findUnique).not.toHaveBeenCalled();
  });

  it("updates project model and primary runtime config without lifecycle mutation", async () => {
    vi.mocked(requireProjectCapability).mockResolvedValue({
      authorized: true,
    } as any);
    const projectUpdate = vi.fn();
    const componentUpdate = vi.fn();
    const runLogCreate = vi.fn();
    vi.mocked((prisma as any).$transaction).mockImplementation(async (callback: any) =>
      callback({
        project: { update: projectUpdate },
        projectComponent: { update: componentUpdate },
        runLog: { create: runLogCreate },
      }),
    );

    const result = await setProjectModel("project-1", "opus-4-8");

    expect(result).toEqual({
      success: true,
      projectId: "project-1",
      model: "claude-opus-4-8",
      modelId: "opus-4-8",
    });
    expect(projectUpdate).toHaveBeenCalledWith({
      where: { id: "project-1" },
      data: {
        model: "claude-opus-4-8",
        envOverrides: JSON.stringify({ ANTHROPIC_MODEL_FAMILY: "opus" }),
      },
    });
    expect(componentUpdate).toHaveBeenCalledWith({
      where: { id: "component-1" },
      data: {
        runtimeConfig: {
          model: "claude-opus-4-8",
          runnerBackend: "local",
          envOverrides: JSON.stringify({ ANTHROPIC_MODEL_FAMILY: "opus" }),
        },
      },
    });
    expect(runLogCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        projectId: "project-1",
        event: "MODEL_UPDATED",
      }),
    });
  });

  it("rejects models outside the current loop/tool registry", async () => {
    vi.mocked(requireProjectCapability).mockResolvedValue({
      authorized: true,
    } as any);

    const result = await setProjectModel("project-1", "claude-fake-999");

    expect(result.success).toBe(false);
    expect(result.error).toBe("Selected model is not available for this tool and loop.");
  });

  it("does not pretend to hot-switch active in-flight agent work", async () => {
    vi.mocked(requireProjectCapability).mockResolvedValue({
      authorized: true,
    } as any);
    vi.mocked((prisma as any).project.findUnique).mockResolvedValue({
      id: "project-1",
      archivedAt: null,
      agent: "claude-code",
      agentImpl: "ralph",
      model: "claude-sonnet-4-5",
      envOverrides: null,
      toolId: "tool-claude",
      components: [{
        id: "component-1",
        agentState: "RUNNING",
        runtimeConfig: { model: "claude-sonnet-4-5" },
      }],
    });

    const result = await setProjectModel("project-1", "claude-opus-4-8");

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Cannot switch model while agent work is running/);
    expect((prisma as any).$transaction).not.toHaveBeenCalled();
  });
});

describe("setProjectRuntimeSystem", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireProjectCapability).mockResolvedValue({
      authorized: true,
      session: { user: { id: "manager-1" } },
      hasBypass: false,
    } as any);
    vi.mocked(resolvePlatformAccess).mockResolvedValue({
      hasCapability: (capability: string) => capability === "platform.runtime.manage",
    } as any);
    vi.mocked((prisma as any).project.findUnique).mockResolvedValue({
      id: "project-1",
      archivedAt: null,
      agent: "claude-code",
      agentImpl: "ralph",
      model: "claude-sonnet-4-6",
      envOverrides: null,
      toolId: "tool-claude",
      agentLoopVersionId: "ralph-v1",
      claudeAuthMode: "oauth",
      codexAuthMode: null,
      providerBillingMode: "platform_credentials",
      components: [{
        id: "component-1",
        agentState: "IDLE",
        runtimeConfig: {
          runnerBackend: "local",
          visualEvidenceMode: "required",
          agent: "claude-code",
          agentImpl: "ralph",
          model: "claude-sonnet-4-6",
          toolId: "tool-claude",
          agentLoopVersionId: "ralph-v1",
        },
      }],
    });
    vi.mocked((prisma as any).agentLoop.findUnique).mockResolvedValue({
      isActive: true,
      currentVersionId: "ralph-v2",
      loopTools: [{
        toolId: "tool-codex",
        models: JSON.stringify([
          { id: "gpt-55", label: "GPT-5.5", model: "gpt-5.5" },
          { id: "gpt-54", label: "GPT-5.4", model: "gpt-5.4" },
        ]),
        tool: {
          id: "tool-codex",
          name: "codex",
          defaultModelId: "gpt-55",
          isActive: true,
          models: null,
        },
      }],
    });
    vi.mocked((prisma as any).$transaction).mockImplementation(async (callback: any) =>
      callback({
        project: { update: vi.fn() },
        projectComponent: { update: vi.fn() },
        runLog: { create: vi.fn() },
      }),
    );
  });

  it("rejects callers without runtime management access", async () => {
    vi.mocked(requireProjectCapability).mockResolvedValue({
      authorized: false,
      error: "Project access denied",
    } as any);

    const result = await setProjectRuntimeSystem("project-1", {
      agent: "codex",
      agentImpl: "ralph",
      model: "gpt-5.5",
      providerBillingMode: "byok",
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe("Project access denied");
    expect((prisma as any).project.findUnique).not.toHaveBeenCalled();
  });

  it("updates runtime system for future claims without lifecycle mutation", async () => {
    const projectUpdate = vi.fn();
    const componentUpdate = vi.fn();
    const runLogCreate = vi.fn();
    vi.mocked((prisma as any).$transaction).mockImplementation(async (callback: any) =>
      callback({
        project: { update: projectUpdate },
        projectComponent: { update: componentUpdate },
        runLog: { create: runLogCreate },
      }),
    );

    const result = await setProjectRuntimeSystem("project-1", {
      agent: "codex",
      agentImpl: "ralph",
      model: "gpt-5.5",
      toolId: "tool-codex",
      providerBillingMode: "platform_credentials",
      codexAuthMode: "subscription",
    });

    expect(result).toEqual({
      success: true,
      projectId: "project-1",
      agent: "codex",
      agentImpl: "ralph",
      model: "gpt-5.5",
      modelId: "gpt-55",
      toolId: "tool-codex",
      agentLoopVersionId: "ralph-v2",
      claudeAuthMode: null,
      codexAuthMode: "subscription",
      providerBillingMode: "platform_credentials",
    });
    expect(projectUpdate).toHaveBeenCalledWith({
      where: { id: "project-1" },
      data: {
        agent: "codex",
        agentImpl: "ralph",
        model: "gpt-5.5",
        envOverrides: null,
        claudeAuthMode: null,
        codexAuthMode: "subscription",
        providerBillingMode: "platform_credentials",
        tool: { connect: { id: "tool-codex" } },
        agentLoopVersion: { connect: { id: "ralph-v2" } },
      },
    });
    expect(componentUpdate).toHaveBeenCalledWith({
      where: { id: "component-1" },
      data: {
        runtimeConfig: {
          runnerBackend: "local",
          visualEvidenceMode: "required",
          agent: "codex",
          agentImpl: "ralph",
          model: "gpt-5.5",
          envOverrides: null,
          claudeAuthMode: null,
          codexAuthMode: "subscription",
          providerBillingMode: "platform_credentials",
          toolId: "tool-codex",
          agentLoopVersionId: "ralph-v2",
        },
      },
    });
    expect(runLogCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        projectId: "project-1",
        event: "RUNTIME_SYSTEM_UPDATED",
      }),
    });
  });

  it("blocks platform credentials for project managers without platform runtime access", async () => {
    vi.mocked(resolvePlatformAccess).mockResolvedValue({
      hasCapability: () => false,
    } as any);

    const result = await setProjectRuntimeSystem("project-1", {
      agent: "codex",
      agentImpl: "ralph",
      model: "gpt-5.5",
      providerBillingMode: "platform_credentials",
      codexAuthMode: "subscription",
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe("Platform provider credentials require platform runtime access.");
    expect((prisma as any).project.findUnique).not.toHaveBeenCalled();
  });

  it("accepts OpenCode only through the registry-backed tool and model path", async () => {
    const projectUpdate = vi.fn();
    const componentUpdate = vi.fn();
    vi.mocked((prisma as any).agentLoop.findUnique).mockResolvedValue({
      isActive: true,
      currentVersionId: "ralph-v2",
      loopTools: [{
        toolId: "tool-opencode",
        models: JSON.stringify([
          { id: "minimax-m3-free", label: "MiniMax M3 Free", model: "opencode/minimax-m3-free" },
        ]),
        tool: {
          id: "tool-opencode",
          name: "opencode",
          defaultModelId: "minimax-m3-free",
          isActive: true,
          models: null,
        },
      }],
    });
    vi.mocked((prisma as any).$transaction).mockImplementation(async (callback: any) =>
      callback({
        project: { update: projectUpdate },
        projectComponent: { update: componentUpdate },
        runLog: { create: vi.fn() },
      }),
    );

    const result = await setProjectRuntimeSystem("project-1", {
      agent: "opencode",
      agentImpl: "ralph",
      model: "opencode/minimax-m3-free",
      toolId: "tool-opencode",
      providerBillingMode: "byok",
    });

    expect(result).toMatchObject({
      success: true,
      agent: "opencode",
      model: "opencode/minimax-m3-free",
      toolId: "tool-opencode",
      claudeAuthMode: null,
      codexAuthMode: null,
      providerBillingMode: "byok",
    });
    expect(projectUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        agent: "opencode",
        model: "opencode/minimax-m3-free",
        claudeAuthMode: null,
        codexAuthMode: null,
        providerBillingMode: "byok",
      }),
    }));
    expect(componentUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: {
        runtimeConfig: expect.objectContaining({
          agent: "opencode",
          model: "opencode/minimax-m3-free",
          claudeAuthMode: null,
          codexAuthMode: null,
        }),
      },
    }));
  });

  it("rejects unrelated auth mode fields instead of preserving stale provider auth", async () => {
    const result = await setProjectRuntimeSystem("project-1", {
      agent: "codex",
      agentImpl: "ralph",
      model: "gpt-5.5",
      providerBillingMode: "platform_credentials",
      claudeAuthMode: "oauth",
      codexAuthMode: "subscription",
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe("claudeAuthMode is only valid for Claude Code runtime.");
    expect((prisma as any).project.findUnique).not.toHaveBeenCalled();
  });

  it("does not pretend to hot-switch active in-flight agent work", async () => {
    vi.mocked((prisma as any).project.findUnique).mockResolvedValue({
      id: "project-1",
      archivedAt: null,
      agent: "claude-code",
      agentImpl: "ralph",
      model: "claude-sonnet-4-6",
      envOverrides: null,
      toolId: "tool-claude",
      agentLoopVersionId: "ralph-v1",
      claudeAuthMode: "oauth",
      codexAuthMode: null,
      providerBillingMode: "platform_credentials",
      components: [{
        id: "component-1",
        agentState: "RUNNING",
        runtimeConfig: { model: "claude-sonnet-4-6" },
      }],
    });

    const result = await setProjectRuntimeSystem("project-1", {
      agent: "codex",
      agentImpl: "ralph",
      model: "gpt-5.5",
      providerBillingMode: "platform_credentials",
      codexAuthMode: "subscription",
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Cannot switch runtime system while agent work is running/);
    expect((prisma as any).$transaction).not.toHaveBeenCalled();
  });
});

describe("setProjectSourceSnapshotInternal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("updates only the project source commit pointer and records an operator log", async () => {
    const txProjectUpdate = vi.fn();
    const txRunLogCreate = vi.fn();
    const commitSha = "298adb82e6f8b2dcc0df7026c011a90d514373d8";

    vi.mocked(prisma.project.findUnique).mockResolvedValue({
      id: "project-1",
      archivedAt: null,
      repoUrl: "https://github.com/example/project",
      repoBranch: "arena/project-project-1",
      commitSha: "38f10717374c27cafdae5a4cb42ff82608a38399",
    } as any);
    vi.mocked(prisma.$transaction).mockImplementation(async (callbackOrOperations: any) => {
      if (typeof callbackOrOperations !== "function") {
        return Promise.all(callbackOrOperations);
      }
      return callbackOrOperations({
        project: { update: txProjectUpdate },
        runLog: { create: txRunLogCreate },
      });
    });

    const result = await setProjectSourceSnapshotInternal("project-1", commitSha, INTERNAL_ACTION_TOKEN);

    expect(result).toMatchObject({
      success: true,
      projectId: "project-1",
      previousCommitSha: "38f10717374c27cafdae5a4cb42ff82608a38399",
      commitSha,
      repoBranch: "arena/project-project-1",
    });
    expect(txProjectUpdate).toHaveBeenCalledWith({
      where: { id: "project-1" },
      data: { commitSha },
    });
    expect(txRunLogCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        projectId: "project-1",
        event: "SOURCE_SNAPSHOT_UPDATED",
      }),
    });
    expect(revalidatePath).toHaveBeenCalledWith("/admin");
    expect(revalidatePath).toHaveBeenCalledWith("/projects/project-1");
  });

  it("rejects non-SHA values", async () => {
    const result = await setProjectSourceSnapshotInternal("project-1", "298adb8", INTERNAL_ACTION_TOKEN);

    expect(result).toEqual({ success: false, error: "commitSha must be a 40 character git SHA" });
    expect(prisma.project.findUnique).not.toHaveBeenCalled();
  });
});

describe("setProjectRuntimeAuthModes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requirePlatformCapability).mockResolvedValue({
      authorized: true,
    } as any);
    vi.mocked((prisma as any).$transaction).mockImplementation(async (callback: any) =>
      callback({
        project: { update: vi.fn() },
        projectComponent: { update: vi.fn() },
        runLog: { create: vi.fn() },
      }),
    );
    vi.mocked((prisma as any).project.findUnique).mockResolvedValue({
      id: "project-1",
      archivedAt: null,
      agent: "codex",
      claudeAuthMode: null,
      codexAuthMode: "api_key",
      providerBillingMode: "platform_credentials",
      components: [{
        id: "component-1",
        agentState: "IDLE",
        runtimeConfig: {
          codexAuthMode: "api_key",
          providerBillingMode: "platform_credentials",
          runnerBackend: "local",
        },
      }],
    });
  });

  it("rejects callers without platform runtime management access", async () => {
    vi.mocked(requirePlatformCapability).mockResolvedValue({
      authorized: false,
      error: "Platform access denied",
    } as any);

    const result = await setProjectRuntimeAuthModes("project-1", {
      codexAuthMode: "subscription",
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe("Platform access denied");
    expect((prisma as any).project.findUnique).not.toHaveBeenCalled();
  });

  it("rejects invalid runtime auth modes", async () => {
    const result = await setProjectRuntimeAuthModes("project-1", {
      codexAuthMode: "oauth",
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe("Invalid codexAuthMode: oauth");
    expect((prisma as any).project.findUnique).not.toHaveBeenCalled();
  });

  it("updates future runtime auth modes without lifecycle mutation", async () => {
    const projectUpdate = vi.fn();
    const componentUpdate = vi.fn();
    const runLogCreate = vi.fn();
    vi.mocked((prisma as any).$transaction).mockImplementation(async (callback: any) =>
      callback({
        project: { update: projectUpdate },
        projectComponent: { update: componentUpdate },
        runLog: { create: runLogCreate },
      }),
    );

    const result = await setProjectRuntimeAuthModes("project-1", {
      codexAuthMode: "subscription",
    });

    expect(result).toEqual({
      success: true,
      projectId: "project-1",
      claudeAuthMode: null,
      codexAuthMode: "subscription",
      providerBillingMode: "platform_credentials",
    });
    expect(projectUpdate).toHaveBeenCalledWith({
      where: { id: "project-1" },
      data: {
        claudeAuthMode: null,
        codexAuthMode: "subscription",
      },
    });
    expect(componentUpdate).toHaveBeenCalledWith({
      where: { id: "component-1" },
      data: {
        runtimeConfig: {
          codexAuthMode: "subscription",
          providerBillingMode: "platform_credentials",
          runnerBackend: "local",
          claudeAuthMode: null,
        },
      },
    });
    expect(runLogCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        projectId: "project-1",
        event: "RUNTIME_AUTH_MODES_UPDATED",
      }),
    });
  });

  it("does not pretend to hot-switch active in-flight agent work", async () => {
    vi.mocked((prisma as any).project.findUnique).mockResolvedValue({
      id: "project-1",
      archivedAt: null,
      agent: "codex",
      claudeAuthMode: null,
      codexAuthMode: "api_key",
      providerBillingMode: "platform_credentials",
      components: [{
        id: "component-1",
        agentState: "RUNNING",
        runtimeConfig: { codexAuthMode: "api_key" },
      }],
    });

    const result = await setProjectRuntimeAuthModes("project-1", {
      codexAuthMode: "subscription",
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Cannot switch runtime auth modes while agent work is running/);
    expect((prisma as any).$transaction).not.toHaveBeenCalled();
  });
});

describe("setProjectVisualEvidenceMode", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requirePlatformCapability).mockResolvedValue({
      authorized: true,
    } as any);
    vi.mocked((prisma as any).$transaction).mockImplementation(async (callback: any) =>
      callback({
        projectComponent: { update: vi.fn() },
        runLog: { create: vi.fn() },
      }),
    );
    vi.mocked((prisma as any).project.findUnique).mockResolvedValue({
      id: "project-1",
      archivedAt: null,
      components: [{
        id: "component-1",
        agentState: "IDLE",
        runtimeConfig: {
          runnerBackend: "local",
          visualEvidenceMode: "off",
        },
      }],
    });
  });

  it("rejects callers without platform runtime management access", async () => {
    vi.mocked(requirePlatformCapability).mockResolvedValue({
      authorized: false,
      error: "Platform access denied",
    } as any);

    const result = await setProjectVisualEvidenceMode("project-1", "new_tasks_only");

    expect(result.success).toBe(false);
    expect(result.error).toBe("Platform access denied");
    expect((prisma as any).project.findUnique).not.toHaveBeenCalled();
  });

  it("updates future visual evidence config without lifecycle mutation", async () => {
    const componentUpdate = vi.fn();
    const runLogCreate = vi.fn();
    vi.mocked((prisma as any).$transaction).mockImplementation(async (callback: any) =>
      callback({
        projectComponent: { update: componentUpdate },
        runLog: { create: runLogCreate },
      }),
    );

    const result = await setProjectVisualEvidenceMode("project-1", "new_tasks_only");

    expect(result).toEqual({
      success: true,
      projectId: "project-1",
      previousVisualEvidenceMode: "off",
      visualEvidenceMode: "new_tasks_only",
      visualWorkbenchEvidenceAutomation: "enabled",
    });
    expect(componentUpdate).toHaveBeenCalledWith({
      where: { id: "component-1" },
      data: {
        runtimeConfig: {
          runnerBackend: "local",
          visualEvidenceMode: "new_tasks_only",
          visualWorkbenchEvidenceAutomation: {
            enabled: true,
            allowedServeCommands: ["npm run visual-workbench"],
            allowedBaseUrlEnv: ["VISUAL_WORKBENCH_BASE_URL"],
          },
        },
      },
    });
    expect(runLogCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        projectId: "project-1",
        event: "VISUAL_EVIDENCE_MODE_UPDATED",
      }),
    });
  });

  it("does not pretend to hot-switch active in-flight agent work", async () => {
    vi.mocked((prisma as any).project.findUnique).mockResolvedValue({
      id: "project-1",
      archivedAt: null,
      components: [{
        id: "component-1",
        agentState: "RUNNING",
        runtimeConfig: { visualEvidenceMode: "off" },
      }],
    });

    const result = await setProjectVisualEvidenceMode("project-1", "required");

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Cannot switch visual evidence mode while agent work is running/);
    expect((prisma as any).$transaction).not.toHaveBeenCalled();
  });
});

describe("setExploreOrder", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.project.update).mockResolvedValue({} as any);
    vi.mocked(prisma.project.updateMany).mockResolvedValue({ count: 1 } as any);
    vi.mocked((prisma as any).$transaction).mockImplementation((operations: unknown[]) =>
      Promise.all(operations),
    );
  });

  it("rejects non-platform admins", async () => {
    vi.mocked(requirePlatformCapability).mockResolvedValue({
      authorized: false,
      error: "Forbidden",
    } as any);

    const result = await setExploreOrder(["project-1"]);

    expect(result.success).toBe(false);
    expect(result.error).toBe("Forbidden");
    expect(prisma.project.update).not.toHaveBeenCalled();
  });

  it("normalizes project ids into sequential explore ranks", async () => {
    vi.mocked(requirePlatformCapability).mockResolvedValue({
      authorized: true,
    } as any);

    const result = await setExploreOrder(["project-2", "project-1"]);

    expect(result.success).toBe(true);
    expect(prisma.project.updateMany).toHaveBeenCalledWith({
      where: {
        exploreRank: { not: null },
        id: { notIn: ["project-2", "project-1"] },
      },
      data: { exploreRank: null },
    });
    expect(prisma.project.update).toHaveBeenNthCalledWith(1, {
      where: { id: "project-2" },
      data: { exploreRank: 1 },
    });
    expect(prisma.project.update).toHaveBeenNthCalledWith(2, {
      where: { id: "project-1" },
      data: { exploreRank: 2 },
    });
    expect(revalidatePath).toHaveBeenCalledWith("/admin");
    expect(revalidatePath).toHaveBeenCalledWith("/");
    expect(revalidatePath).toHaveBeenCalledWith("/explore");
  });

  it("rejects duplicate project ids", async () => {
    vi.mocked(requirePlatformCapability).mockResolvedValue({
      authorized: true,
    } as any);

    const result = await setExploreOrder(["project-1", "project-1"]);

    expect(result.success).toBe(false);
    expect(result.error).toBe("projectIds must be unique");
    expect(prisma.project.update).not.toHaveBeenCalled();
  });
});
