import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    project: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
}));

vi.mock("@/lib/e2e-auth-bypass", () => ({
  hasE2EAdminBypass: vi.fn().mockResolvedValue(false),
}));

vi.mock("@/lib/platform-access", () => ({
  resolvePlatformAccess: vi.fn().mockResolvedValue({
    hasCapability: vi.fn(() => false),
  }),
}));

vi.mock("@/lib/user-launch-policy", () => ({
  enforceUserLaunchPolicy: vi.fn().mockResolvedValue({ allowed: true }),
  getUserByokAuthModeUpdate: vi.fn((agent: string) => (
    agent === "codex"
      ? { claudeAuthMode: null, codexAuthMode: "api_key" }
      : agent === "claude-code"
        ? { claudeAuthMode: "api_key", codexAuthMode: null }
        : {}
  )),
}));

vi.mock("@/lib/project-budget", () => ({
  enforceRequiredProjectBudget: vi.fn().mockResolvedValue({ allowed: true }),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/project-state-effects", () => ({
  applyStateChange: vi.fn(),
  requirePrimaryComponentRow: vi.fn(),
}));

vi.mock("@/lib/project-access", () => ({
  requireProjectCapability: vi.fn(),
}));

vi.mock("@/lib/progress-bus", () => ({
  notifyProjectChanged: vi.fn(),
  notifyProjectEvent: vi.fn(),
}));

import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { applyStateChange, requirePrimaryComponentRow } from "@/lib/project-state-effects";
import { requireProjectCapability } from "@/lib/project-access";
import { notifyProjectChanged, notifyProjectEvent } from "@/lib/progress-bus";
import { INTERNAL_ACTION_TOKEN } from "@/lib/internal-action-token";
import { setAgentIntent, setAgentIntentInternal } from "./agent-intent";

function buildRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    projectId: "project-1",
    componentId: "cmp-1",
    powerIntent: "ON",
    agentIntent: "ON",
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
    tgSpecLastImportedVersion: 1,
    sourceConfig: null,
    ...overrides,
  };
}

describe("agent intent actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked((prisma as any).project.findUnique).mockResolvedValue({
      agentImpl: "ralph",
      agentLoopVersionId: "ralph-v150",
      agentLoopVersion: {
        version: "1.5.0",
        supportTier: "supported",
        agentLoop: {
          name: "ralph",
        },
      },
      components: [{ kind: "app", runtimeConfig: {} }],
    });
    vi.mocked((prisma as any).$transaction).mockImplementation(async (cb: any) => cb((prisma as any)));
    vi.mocked((prisma as any).project.update).mockResolvedValue({});
    vi.mocked(requirePrimaryComponentRow as any).mockResolvedValue(buildRow());
    vi.mocked(applyStateChange as any).mockResolvedValue({});
    vi.mocked(requireProjectCapability as any).mockResolvedValue({ authorized: true } as any);
  });

  it("blocks direct internal calls without trusted server token", async () => {
    const result = await setAgentIntentInternal("project-1", "ON");

    expect(result).toEqual({
      success: false,
      error: "Internal action is not callable directly.",
    });
    expect(requirePrimaryComponentRow).not.toHaveBeenCalled();
  });

  it("emits a project-scoped refresh event after agent intent change", async () => {
    const result = await setAgentIntentInternal("project-1", "OFF", INTERNAL_ACTION_TOKEN);

    expect(result).toEqual({ success: true });
    expect((prisma as any).$transaction).not.toHaveBeenCalled();
    expect(applyStateChange).toHaveBeenCalledWith(
      prisma,
      "project-1",
      { type: "agentIntent", intent: "OFF" },
      {
        source: "admin",
        trigger: "agent_off",
        reason: "user set agentIntent=OFF",
      },
    );
    expect(revalidatePath).toHaveBeenCalledWith("/admin");
    expect(revalidatePath).toHaveBeenCalledWith("/my");
    expect(revalidatePath).toHaveBeenCalledWith("/my/projects/project-1");
    expect(revalidatePath).toHaveBeenCalledWith("/projects/project-1");
    expect(notifyProjectChanged).toHaveBeenCalledWith("project-1");
    expect(notifyProjectEvent).toHaveBeenCalledWith("project-1", {
      type: "project_event",
      status: "AGENT_OFF",
    });
  });

  it("does not put Agent OFF behind an interactive transaction", async () => {
    vi.mocked((prisma as any).$transaction).mockRejectedValue(new Error("transaction unavailable"));

    const result = await setAgentIntentInternal("project-1", "OFF", INTERNAL_ACTION_TOKEN);

    expect(result).toEqual({ success: true });
    expect((prisma as any).$transaction).not.toHaveBeenCalled();
    expect(applyStateChange).toHaveBeenCalledWith(
      prisma,
      "project-1",
      { type: "agentIntent", intent: "OFF" },
      {
        source: "admin",
        trigger: "agent_off",
        reason: "user set agentIntent=OFF",
      },
    );
  });

  it("clears stale progress snapshot when agent turns back ON", async () => {
    vi.mocked((prisma as any).project.findUnique).mockResolvedValue({
      agentImpl: "ralph",
      agentLoopVersionId: "ralph-v150",
      agentLoopVersion: {
        version: "1.5.0",
        supportTier: "supported",
        agentLoop: {
          name: "ralph",
        },
      },
      components: [{ kind: "app", runtimeConfig: { useRepoHead: true } }],
    });
    vi.mocked(requirePrimaryComponentRow as any).mockResolvedValue(buildRow({
      agentIntent: "OFF",
      agentState: "IDLE",
      lastOutcome: "FAILED",
    }));

    const result = await setAgentIntentInternal("project-1", "ON", INTERNAL_ACTION_TOKEN);

    expect(result).toEqual({ success: true });
    expect((prisma as any).$transaction).toHaveBeenCalledTimes(1);
    expect((prisma as any).project.update).toHaveBeenCalledWith({
      where: { id: "project-1" },
      data: {
        progressJson: null,
      },
    });
    expect(applyStateChange).toHaveBeenCalledWith(
      expect.anything(),
      "project-1",
      { type: "agentIntent", intent: "ON" },
      {
        source: "admin",
        trigger: "agent_on",
        reason: "user set agentIntent=ON",
      },
    );
    expect((prisma as any).project.findUnique).toHaveBeenCalledWith({
      where: { id: "project-1" },
      select: {
        agentImpl: true,
        agentLoopVersionId: true,
        agentLoopVersion: {
          select: {
            version: true,
            supportTier: true,
            agentLoop: {
              select: {
                name: true,
              },
            },
          },
        },
        components: {
          orderBy: { createdAt: "asc" },
          take: 1,
          select: {
            kind: true,
            runtimeConfig: true,
          },
        },
      },
    });
  });

  it("reopens paused-preview rows for resume through normal agent_on flow", async () => {
    vi.mocked((prisma as any).project.findUnique).mockResolvedValue({
      agentImpl: "ralph",
      agentLoopVersionId: "ralph-v150",
      agentLoopVersion: {
        version: "1.5.0",
        supportTier: "supported",
        agentLoop: {
          name: "ralph",
        },
      },
      components: [{ kind: "app", runtimeConfig: { useRepoHead: true } }],
    });
    vi.mocked(requirePrimaryComponentRow as any).mockResolvedValue(buildRow({
      agentIntent: "OFF",
      runtimeState: "RUNNING",
      agentState: "IDLE",
      lastOutcome: null,
      previewHealth: "HEALTHY",
    }));

    const result = await setAgentIntentInternal("project-1", "ON", INTERNAL_ACTION_TOKEN);

    expect(result).toEqual({ success: true });
    expect((prisma as any).$transaction).toHaveBeenCalledTimes(1);
    expect((prisma as any).project.update).toHaveBeenCalledWith({
      where: { id: "project-1" },
      data: {
        progressJson: null,
      },
    });
    expect(applyStateChange).toHaveBeenCalledWith(
      expect.anything(),
      "project-1",
      { type: "agentIntent", intent: "ON" },
      {
        source: "admin",
        trigger: "agent_on",
        reason: "user set agentIntent=ON",
      },
    );
  });

  it("does not emit a project-scoped refresh event for noop changes", async () => {
    vi.mocked(requirePrimaryComponentRow as any).mockResolvedValue(buildRow({
      agentIntent: "OFF",
    }));

    const result = await setAgentIntentInternal("project-1", "OFF", INTERNAL_ACTION_TOKEN);

    expect(result).toEqual({ success: true });
    expect(applyStateChange).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
    expect(notifyProjectChanged).not.toHaveBeenCalled();
    expect(notifyProjectEvent).not.toHaveBeenCalled();
  });

  it("enforces capability gate in public action", async () => {
    vi.mocked(requireProjectCapability as any).mockResolvedValue({
      authorized: false,
      error: "Forbidden",
    } as any);

    const result = await setAgentIntent("project-1", "OFF");

    expect(result).toEqual({ success: false, error: "Forbidden" });
    expect(applyStateChange).not.toHaveBeenCalled();
    expect(notifyProjectChanged).not.toHaveBeenCalled();
    expect(notifyProjectEvent).not.toHaveBeenCalled();
  });

  it("blocks Agent ON for pinned loop rows until upgraded to the bundled default runtime", async () => {
    vi.mocked((prisma as any).project.findUnique).mockResolvedValue({
      agentImpl: "ralph",
      agentLoopVersionId: "ralph-v1.5.0",
      agentLoopVersion: {
        version: "1.5.0",
        supportTier: "supported",
        agentLoop: {
          name: "ralph",
        },
      },
      components: [{ kind: "app", runtimeConfig: {} }],
    });

    const result = await setAgentIntentInternal("project-1", "ON", INTERNAL_ACTION_TOKEN);

    expect(result.success).toBe(false);
    expect(result.error).toContain("bundled default runtime");
    expect(applyStateChange).not.toHaveBeenCalled();
  });

  it("blocks Agent ON while a tg-spec target is still waiting for its first import", async () => {
    vi.mocked(requirePrimaryComponentRow as any).mockResolvedValue(buildRow({
      agentIntent: "OFF",
      sourceConfig: { recipe: "tg_spec_target" },
      tgSpecLastImportedVersion: null,
    }));

    const result = await setAgentIntentInternal("project-1", "ON", INTERNAL_ACTION_TOKEN);

    expect(result).toEqual({
      success: false,
      error: "TG-Spec target is waiting for the first imported spec from Evolution",
    });
    expect((prisma as any).project.findUnique).not.toHaveBeenCalled();
    expect(applyStateChange).not.toHaveBeenCalled();
  });
});
