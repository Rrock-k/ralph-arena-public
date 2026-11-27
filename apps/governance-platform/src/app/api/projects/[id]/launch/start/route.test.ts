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
    $transaction: vi.fn(),
  },
}));

vi.mock("@/lib/user-launch-policy", () => ({
  enforceUserLaunchPolicy: vi.fn(),
}));

vi.mock("@/lib/project-budget", () => ({
  enforceRequiredProjectBudget: vi.fn(),
  formatBudgetBlockedMessage: vi.fn((remainingUsd: number) => `Insufficient budget ($${remainingUsd.toFixed(2)} remaining)`),
}));

vi.mock("@/lib/loop-support", () => ({
  getProjectLoopSupport: vi.fn(),
  getLoopActionBlockMessage: vi.fn(),
}));

vi.mock("@/lib/project-audit", () => ({
  preLaunchCheck: vi.fn(),
}));

vi.mock("@/lib/project-state-effects", () => ({
  applyStateChange: vi.fn(),
  prepareRuntimeForFreshClaim: vi.fn(),
}));

vi.mock("@/lib/progress-bus", () => ({
  notifyProjectChanged: vi.fn(),
  notifyProjectEvent: vi.fn(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

import { enforceRequiredProjectBudget } from "@/lib/project-budget";
import { preLaunchCheck } from "@/lib/project-audit";
import { applyStateChange, prepareRuntimeForFreshClaim } from "@/lib/project-state-effects";
import { getProjectLoopSupport, getLoopActionBlockMessage } from "@/lib/loop-support";
import { resolvePlatformAccess } from "@/lib/platform-access";
import { prisma } from "@/lib/prisma";
import { requireProjectCapability } from "@/lib/project-access";
import { requireTelegramWebAppProjectCapability } from "@/lib/telegram-webapp-project-access";
import { enforceUserLaunchPolicy } from "@/lib/user-launch-policy";

function context(id = "project-1") {
  return { params: Promise.resolve({ id }) };
}

function request() {
  return new Request("http://localhost/api/projects/project-1/launch/start", {
    method: "POST",
  });
}

function telegramRequest() {
  return new Request("http://localhost/api/projects/project-1/launch/start?surface=telegram", {
    method: "POST",
    headers: { "x-telegram-webapp-init-data": "auth_date=1&signature=sig" },
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
    model: "gpt-5.5",
    providerBillingMode: "byok",
    runnerBackend: "local",
    tgSpecLastImportedVersion: 1,
    repoUrl: null,
    repoBranch: "main",
    components: [{
      id: "component-1",
      sourceConfig: {
        recipe: "tg_spec_target",
        launchConfiguration: "tg_spec_launch_configuration_configured",
        agent: "codex",
        agentImpl: "direct",
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
    projectComponent: {
      update: vi.fn().mockResolvedValue({}),
    },
    runLog: {
      create: vi.fn().mockResolvedValue({}),
    },
  };
}

describe("POST /api/projects/:id/launch/start", () => {
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
    vi.mocked(enforceRequiredProjectBudget).mockResolvedValue({ allowed: true, remainingUsd: 5 });
    vi.mocked(preLaunchCheck).mockResolvedValue([]);
    vi.mocked(getProjectLoopSupport).mockResolvedValue({ launchAllowed: true } as any);
    vi.mocked(getLoopActionBlockMessage).mockReturnValue(null);
    vi.mocked(prepareRuntimeForFreshClaim).mockResolvedValue(undefined as any);
    vi.mocked(applyStateChange).mockResolvedValue({} as any);
    vi.mocked(prisma.project.findUnique as any).mockResolvedValue(project());
    tx = createTx();
    vi.mocked(prisma.$transaction as any).mockImplementation(async (callback: any) => callback(tx));
  });

  it("clears launch setup and starts the tg-spec project explicitly", async () => {
    const res = await POST(request(), context());

    expect(res.status).toBe(200);
    expect(requireProjectCapability).toHaveBeenCalledWith("project-1", "project.runtime.manage");
    expect(enforceUserLaunchPolicy).toHaveBeenCalledWith(expect.objectContaining({
      userId: "owner-1",
      privileged: false,
      agent: "codex",
      runnerBackend: "local",
      providerBillingMode: "byok",
    }));
    expect(tx.projectComponent.update).toHaveBeenCalledWith({
      where: { id: "component-1" },
      data: {
        sourceConfig: expect.not.objectContaining({
          launchConfiguration: expect.any(String),
        }),
      },
    });
    expect(prepareRuntimeForFreshClaim).toHaveBeenCalledWith(
      tx,
      "project-1",
      expect.objectContaining({ trigger: "tg_spec_launch_start_reset" }),
      expect.objectContaining({ clearInfraBlocker: true }),
    );
    expect(applyStateChange).toHaveBeenNthCalledWith(
      1,
      tx,
      "project-1",
      { type: "agentIntent", intent: "ON" },
      expect.objectContaining({ trigger: "tg_spec_launch_start_agent_on" }),
    );
    expect(applyStateChange).toHaveBeenNthCalledWith(
      2,
      tx,
      "project-1",
      { type: "power", intent: "ON" },
      expect.objectContaining({ trigger: "tg_spec_launch_start_power_on" }),
    );
  });

  it("accepts Telegram WebApp project owners without a separate Arena page session", async () => {
    const req = telegramRequest();
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

  it("starts through premature gated INFRA runtime drift from a failed preview claim", async () => {
    vi.mocked(prisma.project.findUnique as any).mockResolvedValue(project({
      components: [{
        ...project().components[0],
        runtimeState: "RUNNING",
        agentState: "IDLE",
        blockers: ["INFRA"],
      }],
    }));

    const res = await POST(request(), context());

    expect(res.status).toBe(200);
    expect(prepareRuntimeForFreshClaim).toHaveBeenCalledWith(
      tx,
      "project-1",
      expect.objectContaining({ trigger: "tg_spec_launch_start_reset" }),
      expect.objectContaining({ clearInfraBlocker: true }),
    );
    expect(applyStateChange).toHaveBeenNthCalledWith(
      1,
      tx,
      "project-1",
      { type: "agentIntent", intent: "ON" },
      expect.objectContaining({ trigger: "tg_spec_launch_start_agent_on" }),
    );
  });

  it("does not start over a healthy active launch runtime", async () => {
    vi.mocked(prisma.project.findUnique as any).mockResolvedValue(project({
      components: [{
        ...project().components[0],
        runtimeState: "RUNNING",
        agentState: "IDLE",
        blockers: [],
      }],
    }));

    const res = await POST(request(), context());

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: "Project runtime is already active" });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("requires the project owner or platform admin for start", async () => {
    vi.mocked(requireProjectCapability).mockResolvedValue({
      authorized: true,
      session: { user: { id: "runtime-manager-1" } },
      hasBypass: false,
      isOwner: false,
      isAdmin: false,
    } as any);

    const res = await POST(request(), context());

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toMatchObject({ error: "Project access denied" });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("rejects unsupported launch surfaces", async () => {
    const res = await POST(
      new Request("http://localhost/api/projects/project-1/launch/start?surface=chat", {
        method: "POST",
      }),
      context(),
    );

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: "Unsupported interaction surface" });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("requires launch configuration before start", async () => {
    vi.mocked(prisma.project.findUnique as any).mockResolvedValue(project({
      components: [{
        ...project().components[0],
        sourceConfig: {
          recipe: "tg_spec_target",
          launchConfiguration: "tg_spec_launch_configuration_required",
        },
      }],
    }));

    const res = await POST(request(), context());

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      error: "Launch configuration is required before start.",
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("requires an accepted tg-spec import before start", async () => {
    vi.mocked(prisma.project.findUnique as any).mockResolvedValue(project({
      tgSpecLastImportedVersion: null,
    }));

    const res = await POST(request(), context());

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      error: "First accepted tg-spec import is required before start.",
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("enforces funded Arena Credits budget before start", async () => {
    vi.mocked(prisma.project.findUnique as any).mockResolvedValue(project({
      providerBillingMode: "platform_credits",
    }));
    vi.mocked(enforceRequiredProjectBudget).mockResolvedValue({
      allowed: false,
      remainingUsd: 0,
      error: "Platform Credits project requires a funded budget.",
    });

    const res = await POST(request(), context());

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      error: "Platform Credits project requires a funded budget.",
    });
    expect(enforceRequiredProjectBudget).toHaveBeenCalledWith("project-1");
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
