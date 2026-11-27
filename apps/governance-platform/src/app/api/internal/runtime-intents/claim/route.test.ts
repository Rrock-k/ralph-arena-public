import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

vi.mock("@/lib/prisma", () => {
  const prisma: any = {
    $transaction: vi.fn(),
    $executeRawUnsafe: vi.fn(),
    $queryRawUnsafe: vi.fn(),
    project: {
      findUnique: vi.fn(),
    },
    runtimeIntent: {
      create: vi.fn(),
    },
  };
  return { prisma };
});

vi.mock("@/lib/internal-auth", () => ({
  isWorkerAuthorized: vi.fn(),
}));

vi.mock("@/lib/project-identity", () => ({
  buildProjectWorkspaceLabel: vi.fn(() => "ant-dream-hea20y"),
}));

vi.mock("@/lib/agent-run-launch", () => ({
  prepareRuntimeLaunch: vi.fn(),
}));

vi.mock("@/lib/claim-blockers", () => ({
  parkAuthUnavailable: vi.fn(),
  parkBudgetBlocked: vi.fn(),
}));

import { prisma } from "@/lib/prisma";
import { isWorkerAuthorized } from "@/lib/internal-auth";
import { prepareRuntimeLaunch } from "@/lib/agent-run-launch";
import { parkAuthUnavailable, parkBudgetBlocked } from "@/lib/claim-blockers";

describe("POST /api/internal/runtime-intents/claim", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isWorkerAuthorized).mockReturnValue(true);
    vi.mocked(prisma.$transaction as any).mockImplementation(async (callback: (tx: typeof prisma) => Promise<unknown>) => callback(prisma as any));
    vi.mocked(prisma.$executeRawUnsafe as any).mockResolvedValue(0);
    vi.mocked(prisma.$queryRawUnsafe as any).mockResolvedValue([
      {
        projectId: "project-1",
        projectName: "Ant Dream",
        projectSlug: "ant-dream",
        proposalId: null,
        proposalTitle: null,
        cycleImage: "arena-public-worker:local",
        componentId: "component-1",
        powerIntent: "ON",
        agentIntent: "ON",
        runtimeState: "ABSENT",
        agentState: "IDLE",
        provisionedAt: new Date("2026-04-17T08:00:00.000Z"),
        pendingLoopWork: false,
        allowPreviewOnlyRestore: true,
        blockers: [],
        workerHost: "local",
        containerName: "preview-ant-dream-hea20y",
        sourceConfig: null,
        tgSpecLastImportedVersion: 1,
        runtimeConfig: { memoryMb: 2048, cpuCount: 1.5 },
        lastState: null,
        lastAttempt: null,
        lastNextAttemptAt: null,
      },
    ]);
    vi.mocked(prisma.runtimeIntent.create as any).mockResolvedValue({ id: "intent-1" });
    vi.mocked(prisma.project.findUnique as any).mockResolvedValue({
      id: "project-1",
      budget: null,
      secrets: [],
      components: [{ agentIntent: "ON", runtimeConfig: { memoryMb: 2048, cpuCount: 1.5 } }],
      proposal: { title: "Ant Dream" },
    });
    vi.mocked(prepareRuntimeLaunch).mockResolvedValue({
      ok: true,
      payload: {
        env: {
          ARENA_PROJECT_ID: "project-1",
          ARENA_AGENT: "codex",
        },
        workerImage: "arena-public-worker:local",
        workspaceLabel: "ant-dream-hea20y",
        resources: { memoryMb: 2048, cpuCount: 1.5 },
      },
    });
  });

  it("rejects unauthorized workers", async () => {
    vi.mocked(isWorkerAuthorized).mockReturnValue(false);

    const res = await POST(new Request("http://localhost/api/internal/runtime-intents/claim", {
      method: "POST",
      body: JSON.stringify({ host: "local" }),
    }));

    expect(res.status).toBe(401);
  });

  it("uses an explicit transaction budget for slow launch payload preparation", async () => {
    const res = await POST(new Request("http://localhost/api/internal/runtime-intents/claim", {
      method: "POST",
      body: JSON.stringify({ host: "local" }),
    }));

    expect(res.status).toBe(200);
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      maxWait: 15_000,
      timeout: 30_000,
    });
  });

  it("derives spec-drift pending work from accepted diff workImpact", async () => {
    const res = await POST(new Request("http://localhost/api/internal/runtime-intents/claim", {
      method: "POST",
      body: JSON.stringify({ host: "local" }),
    }));

    expect(res.status).toBe(200);
    expect(prisma.$queryRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining(`diff_item->>'workImpact' = 'requires_loop_work'`),
      "local",
      "local",
      null,
      null,
    );
    expect(prisma.$queryRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining(`"hasPendingAcceptedInputWork"`),
      "local",
      "local",
      null,
      null,
    );
    expect(prisma.$queryRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining(`SELECT EXISTS (`),
      "local",
      "local",
      null,
      null,
    );
    expect(prisma.$queryRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining(`SELECT MAX(sv."updatedAt") AS "latestUpdatedAt"`),
      "local",
      "local",
      null,
      null,
    );
    expect(prisma.$queryRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining(`pending_version."updatedAt" > pc."lastOutcomeAt"`),
      "local",
      "local",
      null,
      null,
    );
    expect(prisma.$queryRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining(`pending_version."acceptedArtifact" IS NULL`),
      "local",
      "local",
      null,
      null,
    );
    expect(prisma.$queryRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining(`GREATEST(s."updatedAt", COALESCE(version_clock."latestUpdatedAt", s."updatedAt"))`),
      "local",
      "local",
      null,
      null,
    );
    expect(prisma.$queryRawUnsafe).toHaveBeenCalledWith(
      expect.not.stringContaining(`ORDER BY sv.version DESC`),
      "local",
      "local",
      null,
      null,
    );
  });

  it("claims preview restore intents for completed runtimes", async () => {
    const res = await POST(new Request("http://localhost/api/internal/runtime-intents/claim", {
      method: "POST",
      body: JSON.stringify({ host: "local" }),
    }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(prisma.$executeRawUnsafe).toHaveBeenCalledWith(
      expect.not.stringContaining(`nextAttemptAt`),
    );
    expect(prisma.$queryRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining(`pc."containerName" IS NOT NULL`),
      "local",
      "local",
      null,
      null,
    );
    expect(prisma.$queryRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining(`pc."agentIntent" = 'OFF'`),
      "local",
      "local",
      null,
      null,
    );
    expect(prisma.$queryRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining(`pc."provisionedAt" IS NOT NULL`),
      "local",
      "local",
      null,
      null,
    );
    expect(prisma.$queryRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining(`AS "allowPreviewOnlyRestore"`),
      "local",
      "local",
      null,
      null,
    );
    expect(prisma.$queryRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining(`OR COALESCE(cardinality(pc."blockers"), 0) > 0`),
      "local",
      "local",
      null,
      null,
    );
    expect(prisma.$queryRawUnsafe).toHaveBeenCalledWith(
      expect.not.stringContaining(`last_ri.action IN ('ensure_stopped', 'ensure_removed')`),
      "local",
      "local",
      null,
      null,
    );
    expect(prisma.runtimeIntent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        projectId: "project-1",
        componentId: "component-1",
        host: "local",
        action: "ensure_running",
        runnerMode: "preview_only",
        state: "CLAIMED",
        attempt: 1,
        lockedUntil: expect.any(Date),
      }),
      select: { id: true },
    });
    expect(body).toEqual({
      intentId: "intent-1",
      projectId: "project-1",
      action: "ensure_running",
      runnerMode: "preview_only",
      containerName: "preview-ant-dream-hea20y",
      workspaceLabel: "ant-dream-hea20y",
      workerImage: "arena-public-worker:local",
      attempt: 1,
      resources: { memoryMb: 2048, cpuCount: 1.5 },
      env: {
        ARENA_PROJECT_ID: "project-1",
        ARENA_AGENT: "codex",
      },
    });
    expect(prepareRuntimeLaunch).toHaveBeenCalledWith(expect.anything(), "local", "preview_only");
  });

  it("selects lastOutcomeAt in the component claim shape when spec drift logic uses it", async () => {
    const res = await POST(new Request("http://localhost/api/internal/runtime-intents/claim", {
      method: "POST",
      body: JSON.stringify({ host: "local" }),
    }));

    expect(res.status).toBe(200);
    expect(prisma.$queryRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining(`"lastOutcomeAt"`),
      "local",
      "local",
      null,
      null,
    );
  });

  it("claims preview restore intents for parked preview-only rows without a completed outcome", async () => {
    vi.mocked(prisma.$queryRawUnsafe as any).mockResolvedValue([
      {
        projectId: "project-1",
        projectName: "Ant Dream",
        projectSlug: "ant-dream",
        proposalId: null,
        proposalTitle: null,
        cycleImage: "arena-public-worker:local",
        componentId: "component-1",
        powerIntent: "ON",
        agentIntent: "OFF",
        runtimeState: "ABSENT",
        agentState: "IDLE",
        provisionedAt: null,
        pendingLoopWork: false,
        allowPreviewOnlyRestore: false,
        blockers: [],
        workerHost: "local",
        containerName: "preview-ant-dream-hea20y",
        runtimeConfig: {},
        lastAction: null,
        lastState: null,
        lastAttempt: null,
        lastNextAttemptAt: null,
      },
    ]);

    const res = await POST(new Request("http://localhost/api/internal/runtime-intents/claim", {
      method: "POST",
      body: JSON.stringify({ host: "local" }),
    }));

    await expect(res.json()).resolves.toEqual({
      intentId: "intent-1",
      projectId: "project-1",
      action: "ensure_running",
      runnerMode: "preview_only",
      containerName: "preview-ant-dream-hea20y",
      workspaceLabel: "ant-dream-hea20y",
      workerImage: "arena-public-worker:local",
      attempt: 1,
      resources: { memoryMb: 2048, cpuCount: 1.5 },
      env: {
        ARENA_PROJECT_ID: "project-1",
        ARENA_AGENT: "codex",
      },
    });
  });

  it("keeps failed-history rows parked when no new specs arrived", async () => {
    vi.mocked(prisma.$queryRawUnsafe as any).mockResolvedValue([
      {
        projectId: "project-1",
        projectName: "Ant Dream",
        projectSlug: "ant-dream",
        proposalId: null,
        proposalTitle: null,
        cycleImage: "arena-public-worker:local",
        componentId: "component-1",
        powerIntent: "ON",
        agentIntent: "ON",
        runtimeState: "ABSENT",
        agentState: "IDLE",
        provisionedAt: new Date("2026-04-17T08:00:00.000Z"),
        pendingLoopWork: false,
        allowPreviewOnlyRestore: false,
        blockers: [],
        workerHost: "local",
        containerName: "preview-ant-dream-hea20y",
        sourceConfig: null,
        tgSpecLastImportedVersion: 1,
        runtimeConfig: {},
        lastState: null,
        lastAttempt: null,
        lastNextAttemptAt: null,
      },
    ]);

    const res = await POST(new Request("http://localhost/api/internal/runtime-intents/claim", {
      method: "POST",
      body: JSON.stringify({ host: "local" }),
    }));

    expect(res.status).toBe(200);
    expect(prisma.$queryRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining(`COALESCE(pc."agentState", 'IDLE') = 'IDLE'`),
      "local",
      "local",
      null,
      null,
    );
    await expect(res.json()).resolves.toBeNull();
    expect(prepareRuntimeLaunch).not.toHaveBeenCalled();
  });

  it("keeps empty tg-spec targets parked until the first import arrives", async () => {
    vi.mocked(prisma.$queryRawUnsafe as any).mockResolvedValue([
      {
        projectId: "project-1",
        projectName: "Ant Dream",
        projectSlug: "ant-dream",
        proposalId: null,
        proposalTitle: null,
        cycleImage: "arena-public-worker:local",
        componentId: "component-1",
        powerIntent: "ON",
        agentIntent: "ON",
        runtimeState: "ABSENT",
        agentState: "IDLE",
        provisionedAt: new Date("2026-04-17T08:00:00.000Z"),
        pendingLoopWork: true,
        allowPreviewOnlyRestore: false,
        blockers: [],
        workerHost: "local",
        containerName: "preview-ant-dream-hea20y",
        sourceConfig: { recipe: "tg_spec_target" },
        tgSpecLastImportedVersion: null,
        runtimeConfig: {},
        lastState: null,
        lastAttempt: null,
        lastNextAttemptAt: null,
      },
    ]);

    const res = await POST(new Request("http://localhost/api/internal/runtime-intents/claim", {
      method: "POST",
      body: JSON.stringify({ host: "local" }),
    }));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toBeNull();
    expect(prisma.runtimeIntent.create).not.toHaveBeenCalled();
    expect(prepareRuntimeLaunch).not.toHaveBeenCalled();
  });

  it("claims failed-history rows after spec drift arrives", async () => {
    vi.mocked(prisma.$queryRawUnsafe as any).mockResolvedValue([
      {
        projectId: "project-1",
        projectName: "Ant Dream",
        projectSlug: "ant-dream",
        proposalId: null,
        proposalTitle: null,
        cycleImage: "arena-public-worker:local",
        componentId: "component-1",
        powerIntent: "ON",
        agentIntent: "ON",
        runtimeState: "ABSENT",
        agentState: "IDLE",
        provisionedAt: new Date("2026-04-17T08:00:00.000Z"),
        pendingLoopWork: true,
        allowPreviewOnlyRestore: false,
        blockers: [],
        workerHost: "local",
        containerName: "preview-ant-dream-hea20y",
        runtimeConfig: {},
        lastState: null,
        lastAttempt: null,
        lastNextAttemptAt: null,
      },
    ]);
    vi.mocked(prisma.project.findUnique as any).mockResolvedValue({
      id: "project-1",
      budget: null,
      secrets: [],
      components: [{ agentIntent: "ON", runtimeConfig: {} }],
      proposal: { title: "Ant Dream" },
    });

    const res = await POST(new Request("http://localhost/api/internal/runtime-intents/claim", {
      method: "POST",
      body: JSON.stringify({ host: "local" }),
    }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(prepareRuntimeLaunch).toHaveBeenCalledWith(
      expect.objectContaining({ id: "project-1" }),
      "local",
      "agent_run",
    );
    expect(body).toEqual({
      intentId: "intent-1",
      projectId: "project-1",
      action: "ensure_running",
      runnerMode: "agent_run",
      containerName: "preview-ant-dream-hea20y",
      workspaceLabel: "ant-dream-hea20y",
      workerImage: "arena-public-worker:local",
      attempt: 1,
      resources: { memoryMb: 2048, cpuCount: 1.5 },
      env: {
        ARENA_PROJECT_ID: "project-1",
        ARENA_AGENT: "codex",
      },
    });
  });

  it("does not claim unsupported pinned agent runtimes as agent_run", async () => {
    vi.mocked(prisma.$queryRawUnsafe as any).mockResolvedValue([
      {
        projectId: "project-1",
        projectName: "Ant Dream",
        projectSlug: "ant-dream",
        proposalId: null,
        proposalTitle: null,
        agentImpl: "ralph",
        runtimeConfig: {},
        loopName: "ralph",
        loopVersion: "0.9.0",
        loopSupportTier: "supported",
        componentId: "component-1",
        powerIntent: "ON",
        agentIntent: "ON",
        runtimeState: "ABSENT",
        agentState: "IDLE",
        provisionedAt: new Date("2026-04-17T08:00:00.000Z"),
        pendingLoopWork: true,
        allowPreviewOnlyRestore: false,
        blockers: [],
        workerHost: "local",
        containerName: "preview-ant-dream-hea20y",
        sourceConfig: null,
        tgSpecLastImportedVersion: 1,
        lastAction: null,
        lastState: null,
        lastAttempt: null,
        lastNextAttemptAt: null,
      },
    ]);

    const res = await POST(new Request("http://localhost/api/internal/runtime-intents/claim", {
      method: "POST",
      body: JSON.stringify({ host: "local", capacity: 1 }),
    }));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toBeNull();
    expect(prisma.runtimeIntent.create).not.toHaveBeenCalled();
    expect(prepareRuntimeLaunch).not.toHaveBeenCalled();
  });

  it("returns null when there is no intent", async () => {
    vi.mocked(prisma.$queryRawUnsafe as any).mockResolvedValue([]);

    const res = await POST(new Request("http://localhost/api/internal/runtime-intents/claim", {
      method: "POST",
      body: JSON.stringify({ host: "local" }),
    }));

    await expect(res.json()).resolves.toBeNull();
  });

  it("claims unfinished provisioned rows as agent_run even if a stale preview identity exists", async () => {
    vi.mocked(prisma.$queryRawUnsafe as any).mockResolvedValue([
      {
        projectId: "project-1",
        projectName: "Ant Dream",
        projectSlug: "ant-dream",
        proposalId: null,
        proposalTitle: null,
        cycleImage: "arena-public-worker:local",
        componentId: "component-1",
        powerIntent: "ON",
        agentIntent: "ON",
        runtimeState: "ABSENT",
        agentState: "IDLE",
        provisionedAt: new Date("2026-04-17T08:00:00.000Z"),
        pendingLoopWork: true,
        allowPreviewOnlyRestore: false,
        blockers: [],
        workerHost: "local",
        containerName: "preview-ant-dream-hea20y",
        runtimeConfig: {},
        lastState: "SUCCEEDED",
        lastAttempt: 1,
        lastNextAttemptAt: null,
      },
    ]);

    const res = await POST(new Request("http://localhost/api/internal/runtime-intents/claim", {
      method: "POST",
      body: JSON.stringify({ host: "local" }),
    }));

    await expect(res.json()).resolves.toEqual({
      intentId: "intent-1",
      projectId: "project-1",
      action: "ensure_running",
      runnerMode: "agent_run",
      containerName: "preview-ant-dream-hea20y",
      workspaceLabel: "ant-dream-hea20y",
      workerImage: "arena-public-worker:local",
      attempt: 1,
      resources: { memoryMb: 2048, cpuCount: 1.5 },
      env: {
        ARENA_PROJECT_ID: "project-1",
        ARENA_AGENT: "codex",
      },
    });
    expect(prisma.runtimeIntent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "ensure_running",
        runnerMode: "agent_run",
      }),
      select: { id: true },
    });
  });

  it("does not claim when worker reports zero capacity", async () => {
    const res = await POST(new Request("http://localhost/api/internal/runtime-intents/claim", {
      method: "POST",
      body: JSON.stringify({ host: "local", capacity: 0 }),
    }));

    await expect(res.json()).resolves.toBeNull();
    expect(prisma.runtimeIntent.create).not.toHaveBeenCalled();
  });

  it("claims zero-capacity starts when the worker will replace the same active container", async () => {
    const res = await POST(new Request("http://localhost/api/internal/runtime-intents/claim", {
      method: "POST",
      body: JSON.stringify({
        host: "local",
        capacity: 0,
        activePreviewContainers: ["preview-ant-dream-hea20y"],
      }),
    }));

    await expect(res.json()).resolves.toEqual(expect.objectContaining({
      intentId: "intent-1",
      projectId: "project-1",
      action: "ensure_running",
      runnerMode: "preview_only",
      containerName: "preview-ant-dream-hea20y",
      workspaceLabel: "ant-dream-hea20y",
    }));
    expect(prisma.runtimeIntent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "ensure_running",
        runnerMode: "preview_only",
      }),
      select: { id: true },
    });
  });

  it("claims stop intents even when running capacity is exhausted", async () => {
    vi.mocked(prisma.$queryRawUnsafe as any).mockResolvedValue([
      {
        projectId: "project-1",
        projectName: "Ant Dream",
        projectSlug: "ant-dream",
        proposalId: null,
        proposalTitle: null,
        cycleImage: "arena-public-worker:local",
        componentId: "component-1",
        powerIntent: "OFF",
        agentIntent: "ON",
        runtimeState: "RUNNING",
        agentState: "IDLE",
        provisionedAt: new Date("2026-04-17T08:00:00.000Z"),
        pendingLoopWork: false,
        allowPreviewOnlyRestore: false,
        blockers: [],
        workerHost: "local",
        containerName: "preview-ant-dream-hea20y",
        runtimeConfig: {},
        lastState: null,
        lastAttempt: null,
        lastNextAttemptAt: null,
      },
    ]);

    const res = await POST(new Request("http://localhost/api/internal/runtime-intents/claim", {
      method: "POST",
      body: JSON.stringify({ host: "local" }),
    }));

    await expect(res.json()).resolves.toEqual({
      intentId: "intent-1",
      projectId: "project-1",
      action: "ensure_stopped",
      runnerMode: "preview_only",
      containerName: "preview-ant-dream-hea20y",
      workspaceLabel: "ant-dream-hea20y",
      workerImage: null,
      attempt: 1,
    });
    expect(prisma.runtimeIntent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "ensure_stopped",
        runnerMode: "preview_only",
      }),
      select: { id: true },
    });
  });

  it("retries failed start intents while attempt budget remains", async () => {
    vi.mocked(prisma.$queryRawUnsafe as any).mockResolvedValue([
      {
        projectId: "project-1",
        projectName: "Ant Dream",
        projectSlug: "ant-dream",
        proposalId: null,
        proposalTitle: null,
        cycleImage: "arena-public-worker:local",
        componentId: "component-1",
        powerIntent: "ON",
        agentIntent: "OFF",
        runtimeState: "ABSENT",
        agentState: "IDLE",
        provisionedAt: null,
        pendingLoopWork: false,
        allowPreviewOnlyRestore: false,
        blockers: [],
        workerHost: "local",
        containerName: "preview-ant-dream-hea20y",
        runtimeConfig: {},
        lastAction: "ensure_running",
        lastState: "FAILED",
        lastAttempt: 4,
        lastNextAttemptAt: new Date(Date.now() + 60_000),
      },
    ]);

    const res = await POST(new Request("http://localhost/api/internal/runtime-intents/claim", {
      method: "POST",
      body: JSON.stringify({ host: "local" }),
    }));

    await expect(res.json()).resolves.toEqual(expect.objectContaining({
      intentId: "intent-1",
      projectId: "project-1",
      action: "ensure_running",
      runnerMode: "preview_only",
    }));
    expect(prisma.runtimeIntent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "ensure_running",
        runnerMode: "preview_only",
        attempt: 5,
      }),
      select: { id: true },
    });
  });

  it("retries failed agent_run starts through the fresh-auth launch path", async () => {
    vi.mocked(prisma.$queryRawUnsafe as any).mockResolvedValue([
      {
        projectId: "project-1",
        projectName: "Ant Dream",
        projectSlug: "ant-dream",
        proposalId: null,
        proposalTitle: null,
        cycleImage: "arena-public-worker:local",
        componentId: "component-1",
        powerIntent: "ON",
        agentIntent: "ON",
        runtimeState: "ABSENT",
        agentState: "IDLE",
        provisionedAt: new Date("2026-04-17T08:00:00.000Z"),
        pendingLoopWork: true,
        allowPreviewOnlyRestore: false,
        blockers: [],
        workerHost: "local",
        containerName: "preview-ant-dream-hea20y",
        runtimeConfig: {},
        lastAction: "ensure_running",
        lastState: "FAILED",
        lastAttempt: 2,
      },
    ]);

    const res = await POST(new Request("http://localhost/api/internal/runtime-intents/claim", {
      method: "POST",
      body: JSON.stringify({ host: "local" }),
    }));

    await expect(res.json()).resolves.toEqual(expect.objectContaining({
      intentId: "intent-1",
      projectId: "project-1",
      action: "ensure_running",
      runnerMode: "agent_run",
      attempt: 3,
    }));
    expect(prisma.runtimeIntent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "ensure_running",
        runnerMode: "agent_run",
        attempt: 3,
      }),
      select: { id: true },
    });
    expect(prepareRuntimeLaunch).toHaveBeenCalledWith(
      expect.objectContaining({ id: "project-1" }),
      "local",
      "agent_run",
    );
  });

  it("does not let an exhausted failed start intent starve later candidates", async () => {
    vi.mocked(prisma.$queryRawUnsafe as any).mockResolvedValue([
      {
        projectId: "project-1",
        projectName: "Broken Preview",
        projectSlug: "broken-preview",
        proposalId: null,
        proposalTitle: null,
        cycleImage: "arena-public-worker:local",
        componentId: "component-1",
        powerIntent: "ON",
        agentIntent: "OFF",
        runtimeState: "ABSENT",
        agentState: "IDLE",
        provisionedAt: new Date("2026-04-17T08:00:00.000Z"),
        pendingLoopWork: false,
        allowPreviewOnlyRestore: false,
        blockers: [],
        workerHost: "local",
        containerName: "preview-broken-preview",
        runtimeConfig: {},
        lastAction: "ensure_running",
        lastState: "FAILED",
        lastAttempt: 5,
      },
      {
        projectId: "project-2",
        projectName: "Next Preview",
        projectSlug: "next-preview",
        proposalId: null,
        proposalTitle: null,
        cycleImage: "arena-public-worker:local",
        componentId: "component-2",
        powerIntent: "ON",
        agentIntent: "OFF",
        runtimeState: "ABSENT",
        agentState: "IDLE",
        provisionedAt: new Date("2026-04-17T08:00:00.000Z"),
        pendingLoopWork: false,
        allowPreviewOnlyRestore: false,
        blockers: [],
        workerHost: "local",
        containerName: "preview-next-preview",
        runtimeConfig: {},
        lastAction: null,
        lastState: null,
        lastAttempt: null,
      },
    ]);

    const res = await POST(new Request("http://localhost/api/internal/runtime-intents/claim", {
      method: "POST",
      body: JSON.stringify({ host: "local" }),
    }));

    await expect(res.json()).resolves.toEqual(expect.objectContaining({
      intentId: "intent-1",
      projectId: "project-2",
      action: "ensure_running",
      runnerMode: "preview_only",
    }));
    expect(prisma.runtimeIntent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        projectId: "project-2",
        action: "ensure_running",
        runnerMode: "preview_only",
        attempt: 1,
      }),
      select: { id: true },
    });
  });

  it("claims preview-only restore while retryable blockers are present", async () => {
    vi.mocked(prisma.$queryRawUnsafe as any).mockResolvedValue([
      {
        projectId: "project-1",
        projectName: "Ant Dream",
        projectSlug: "ant-dream",
        proposalId: null,
        proposalTitle: null,
        cycleImage: "arena-public-worker:local",
        componentId: "component-1",
        powerIntent: "ON",
        agentIntent: "OFF",
        runtimeState: "ABSENT",
        agentState: "IDLE",
        provisionedAt: null,
        pendingLoopWork: false,
        allowPreviewOnlyRestore: false,
        blockers: ["INFRA"],
        workerHost: "local",
        containerName: "preview-ant-dream-hea20y",
        runtimeConfig: {},
        lastAction: "ensure_running",
        lastState: "FAILED",
        lastAttempt: 1,
        lastNextAttemptAt: null,
      },
    ]);

    const res = await POST(new Request("http://localhost/api/internal/runtime-intents/claim", {
      method: "POST",
      body: JSON.stringify({ host: "local" }),
    }));

    await expect(res.json()).resolves.toEqual({
      intentId: "intent-1",
      projectId: "project-1",
      action: "ensure_running",
      runnerMode: "preview_only",
      containerName: "preview-ant-dream-hea20y",
      workspaceLabel: "ant-dream-hea20y",
      workerImage: "arena-public-worker:local",
      attempt: 2,
      resources: { memoryMb: 2048, cpuCount: 1.5 },
      env: {
        ARENA_PROJECT_ID: "project-1",
        ARENA_AGENT: "codex",
      },
    });
    expect(prisma.runtimeIntent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "ensure_running",
        runnerMode: "preview_only",
        attempt: 2,
      }),
      select: { id: true },
    });
  });

  it("claims reclaimed STOPPED rows back into agent_run even without provisionedAt", async () => {
    vi.mocked(prisma.$queryRawUnsafe as any).mockResolvedValue([
      {
        projectId: "project-1",
        projectName: "Space Invaders",
        projectSlug: "space-invaders",
        proposalId: null,
        proposalTitle: null,
        componentId: "component-1",
        powerIntent: "ON",
        agentIntent: "ON",
        runtimeState: "STOPPED",
        agentState: "IDLE",
        provisionedAt: null,
        pendingLoopWork: true,
        allowPreviewOnlyRestore: false,
        blockers: [],
        workerHost: "local",
        containerName: null,
        sourceConfig: null,
        tgSpecLastImportedVersion: 1,
        lastAction: "ensure_running",
        lastState: "SUCCEEDED",
        lastAttempt: 1,
      },
    ]);
    vi.mocked(prepareRuntimeLaunch).mockResolvedValue({
      ok: true,
      payload: {
        workerImage: "arena-public-worker:local",
        workspaceLabel: "space-invaders",
        env: {
          ARENA_PROJECT_ID: "project-1",
          ARENA_AGENT: "codex",
        },
      },
    } as any);
    vi.mocked(prisma.runtimeIntent.create).mockResolvedValue({ id: "intent-1" } as any);

    const res = await POST(new Request("http://localhost/api/internal/runtime-intents/claim", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-worker-secret": "test-secret",
      },
      body: JSON.stringify({ host: "local" }),
    }));

    await expect(res.json()).resolves.toEqual({
      intentId: "intent-1",
      projectId: "project-1",
      action: "ensure_running",
      runnerMode: "agent_run",
      containerName: null,
      workspaceLabel: "space-invaders",
      workerImage: "arena-public-worker:local",
      attempt: 1,
      env: {
        ARENA_PROJECT_ID: "project-1",
        ARENA_AGENT: "codex",
      },
    });
    expect(prepareRuntimeLaunch).toHaveBeenCalledWith(
      expect.objectContaining({ id: "project-1" }),
      "local",
      "agent_run",
    );
  });

  it("restores a stale RUNNING row as preview-only when the worker no longer has the container and no loop work is pending", async () => {
    vi.mocked(prisma.$queryRawUnsafe as any).mockResolvedValue([
      {
        projectId: "project-1",
        projectName: "Sampleapp",
        projectSlug: "sampleapp",
        proposalId: null,
        proposalTitle: null,
        componentId: "component-1",
        powerIntent: "ON",
        agentIntent: "ON",
        runtimeState: "RUNNING",
        agentState: "IDLE",
        runtimeMissingFromWorker: true,
        provisionedAt: new Date("2026-05-28T08:00:00.000Z"),
        pendingLoopWork: false,
        allowPreviewOnlyRestore: true,
        blockers: [],
        workerHost: "local",
        containerName: "preview-sampleapp-g15ilo",
        sourceConfig: null,
        tgSpecLastImportedVersion: 1,
        lastAction: "ensure_running",
        lastState: "SUCCEEDED",
        lastAttempt: 1,
      },
    ]);
    vi.mocked(prepareRuntimeLaunch).mockResolvedValue({
      ok: true,
      payload: {
        workerImage: "arena-public-worker:local",
        workspaceLabel: "sampleapp-g15ilo",
        env: {
          ARENA_PROJECT_ID: "project-1",
          ARENA_AGENT: "opencode",
        },
      },
    } as any);

    const res = await POST(new Request("http://localhost/api/internal/runtime-intents/claim", {
      method: "POST",
      body: JSON.stringify({
        host: "local",
        activePreviewContainers: ["preview-other-project"],
      }),
    }));

    expect(prisma.$queryRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining(`AS "runtimeMissingFromWorker"`),
      "local",
      "local",
      ["preview-other-project"],
      null,
    );
    expect(prisma.$queryRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining(`pc."lastOutcome" IN ('COMPLETED', 'FAILED')`),
      "local",
      "local",
      ["preview-other-project"],
      null,
    );
    await expect(res.json()).resolves.toEqual({
      intentId: "intent-1",
      projectId: "project-1",
      action: "ensure_running",
      runnerMode: "preview_only",
      containerName: "preview-sampleapp-g15ilo",
      workspaceLabel: "sampleapp-g15ilo",
      workerImage: "arena-public-worker:local",
      attempt: 1,
      env: {
        ARENA_PROJECT_ID: "project-1",
        ARENA_AGENT: "opencode",
      },
    });
  });

  it("routes stale RUNNING active work to agent_run instead of hiding pending work behind preview restore", async () => {
    vi.mocked(prisma.$queryRawUnsafe as any).mockResolvedValue([
      {
        projectId: "project-1",
        projectName: "Active Work",
        projectSlug: "active-work",
        proposalId: null,
        proposalTitle: null,
        componentId: "component-1",
        powerIntent: "ON",
        agentIntent: "ON",
        runtimeState: "RUNNING",
        agentState: "RUNNING",
        runtimeMissingFromWorker: true,
        provisionedAt: new Date("2026-05-28T08:00:00.000Z"),
        pendingLoopWork: true,
        allowPreviewOnlyRestore: false,
        blockers: [],
        workerHost: "local",
        containerName: "preview-active-work",
        sourceConfig: null,
        tgSpecLastImportedVersion: 1,
        lastAction: "ensure_running",
        lastState: "SUCCEEDED",
        lastAttempt: 1,
      },
    ]);
    vi.mocked(prepareRuntimeLaunch).mockResolvedValue({
      ok: true,
      payload: {
        workerImage: "arena-public-worker:local",
        workspaceLabel: "active-work",
        env: {
          ARENA_PROJECT_ID: "project-1",
          ARENA_AGENT: "codex",
        },
      },
    } as any);

    const res = await POST(new Request("http://localhost/api/internal/runtime-intents/claim", {
      method: "POST",
      body: JSON.stringify({
        host: "local",
        activePreviewContainers: [],
      }),
    }));

    expect(prisma.$queryRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining(`AND pc."runtimeState" = 'RUNNING'`),
      "local",
      "local",
      [],
      null,
    );
    await expect(res.json()).resolves.toEqual({
      intentId: "intent-1",
      projectId: "project-1",
      action: "ensure_running",
      runnerMode: "agent_run",
      containerName: "preview-active-work",
      workspaceLabel: "active-work",
      workerImage: "arena-public-worker:local",
      attempt: 1,
      env: {
        ARENA_PROJECT_ID: "project-1",
        ARENA_AGENT: "codex",
      },
    });
  });

  it("retries failed stop intents immediately while attempt budget remains", async () => {
    vi.mocked(prisma.$queryRawUnsafe as any).mockResolvedValue([
      {
        projectId: "project-1",
        projectName: "Ant Dream",
        projectSlug: "ant-dream",
        proposalId: null,
        proposalTitle: null,
        cycleImage: "arena-public-worker:local",
        componentId: "component-1",
        powerIntent: "OFF",
        agentIntent: "ON",
        runtimeState: "RUNNING",
        agentState: "IDLE",
        provisionedAt: new Date("2026-04-17T08:00:00.000Z"),
        pendingLoopWork: false,
        allowPreviewOnlyRestore: false,
        blockers: [],
        workerHost: "local",
        containerName: "preview-ant-dream-hea20y",
        runtimeConfig: {},
        lastAction: "ensure_stopped",
        lastState: "FAILED",
        lastAttempt: 2,
      },
    ]);

    const res = await POST(new Request("http://localhost/api/internal/runtime-intents/claim", {
      method: "POST",
      body: JSON.stringify({ host: "local" }),
    }));

    await expect(res.json()).resolves.toEqual(expect.objectContaining({
      intentId: "intent-1",
      action: "ensure_stopped",
      runnerMode: "preview_only",
      attempt: 3,
    }));
    expect(prisma.runtimeIntent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "ensure_stopped",
        runnerMode: "preview_only",
        attempt: 3,
      }),
      select: { id: true },
    });
  });

  it("does not let failed start history consume stop-side attempts", async () => {
    vi.mocked(prisma.$queryRawUnsafe as any).mockResolvedValue([
      {
        projectId: "project-1",
        projectName: "Ant Dream",
        projectSlug: "ant-dream",
        proposalId: null,
        proposalTitle: null,
        cycleImage: "arena-public-worker:local",
        componentId: "component-1",
        powerIntent: "OFF",
        agentIntent: "OFF",
        runtimeState: "RUNNING",
        agentState: "IDLE",
        provisionedAt: new Date("2026-04-17T08:00:00.000Z"),
        pendingLoopWork: false,
        allowPreviewOnlyRestore: false,
        blockers: [],
        workerHost: "local",
        containerName: "preview-ant-dream-hea20y",
        runtimeConfig: {},
        lastAction: "ensure_running",
        lastState: "FAILED",
        lastAttempt: 5,
      },
    ]);

    const res = await POST(new Request("http://localhost/api/internal/runtime-intents/claim", {
      method: "POST",
      body: JSON.stringify({ host: "local" }),
    }));

    await expect(res.json()).resolves.toEqual(expect.objectContaining({
      intentId: "intent-1",
      action: "ensure_stopped",
      runnerMode: "preview_only",
      attempt: 1,
    }));
    expect(prisma.$queryRawUnsafe).toHaveBeenCalledWith(
      expect.not.stringContaining(`last_ri.action IN ('ensure_stopped', 'ensure_removed')`),
      "local",
      "local",
      null,
      null,
    );
    expect(prisma.runtimeIntent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "ensure_stopped",
        runnerMode: "preview_only",
        attempt: 1,
      }),
      select: { id: true },
    });
  });

  it("claims agent_run intents for completed projects with pending spec drift", async () => {
    vi.mocked(prisma.$queryRawUnsafe as any).mockResolvedValue([
      {
        projectId: "project-1",
        projectName: "Ant Dream",
        projectSlug: "ant-dream",
        proposalId: null,
        proposalTitle: null,
        cycleImage: "arena-public-worker:local",
        componentId: "component-1",
        powerIntent: "ON",
        agentIntent: "ON",
        runtimeState: "ABSENT",
        agentState: "IDLE",
        provisionedAt: new Date("2026-04-17T08:00:00.000Z"),
        pendingLoopWork: true,
        allowPreviewOnlyRestore: false,
        blockers: [],
        workerHost: "local",
        containerName: "preview-ant-dream-hea20y",
        runtimeConfig: {},
        lastState: null,
        lastAttempt: null,
        lastNextAttemptAt: null,
      },
    ]);
    vi.mocked(prisma.project.findUnique as any).mockResolvedValue({
      id: "project-1",
      budget: null,
      secrets: [],
      components: [{ agentIntent: "ON", runtimeConfig: {} }],
      proposal: { title: "Ant Dream" },
    });

    const res = await POST(new Request("http://localhost/api/internal/runtime-intents/claim", {
      method: "POST",
      body: JSON.stringify({ host: "local" }),
    }));

    await expect(res.json()).resolves.toEqual({
      intentId: "intent-1",
      projectId: "project-1",
      action: "ensure_running",
      runnerMode: "agent_run",
      containerName: "preview-ant-dream-hea20y",
      workspaceLabel: "ant-dream-hea20y",
      workerImage: "arena-public-worker:local",
      attempt: 1,
      resources: { memoryMb: 2048, cpuCount: 1.5 },
      env: {
        ARENA_PROJECT_ID: "project-1",
        ARENA_AGENT: "codex",
      },
    });
    expect(prisma.runtimeIntent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "ensure_running",
        runnerMode: "agent_run",
        attempt: 1,
      }),
      select: { id: true },
    });
    expect(prepareRuntimeLaunch).toHaveBeenCalledWith(
      expect.objectContaining({ id: "project-1" }),
      "local",
      "agent_run",
    );
  });

  it("parks budget-blocked agent_run intents instead of claiming them", async () => {
    vi.mocked(prisma.$queryRawUnsafe as any).mockResolvedValue([
      {
        projectId: "project-1",
        projectName: "Ant Dream",
        projectSlug: "ant-dream",
        proposalId: null,
        proposalTitle: null,
        cycleImage: "arena-public-worker:local",
        componentId: "component-1",
        powerIntent: "ON",
        agentIntent: "ON",
        runtimeState: "ABSENT",
        agentState: "IDLE",
        provisionedAt: new Date("2026-04-17T08:00:00.000Z"),
        pendingLoopWork: true,
        allowPreviewOnlyRestore: false,
        blockers: [],
        workerHost: "local",
        containerName: "preview-ant-dream-hea20y",
        runtimeConfig: {},
        lastState: null,
        lastAttempt: null,
        lastNextAttemptAt: null,
      },
    ]);
    vi.mocked(prisma.project.findUnique as any).mockResolvedValue({
      id: "project-1",
      budget: null,
      secrets: [],
      components: [{ agentIntent: "ON", runtimeConfig: {} }],
      proposal: { title: "Ant Dream" },
    });
    vi.mocked(prepareRuntimeLaunch).mockResolvedValue({
      ok: false,
      kind: "budget_blocked",
      message: "Budget low",
    });

    const res = await POST(new Request("http://localhost/api/internal/runtime-intents/claim", {
      method: "POST",
      body: JSON.stringify({ host: "local" }),
    }));

    await expect(res.json()).resolves.toBeNull();
    expect(prisma.runtimeIntent.create).not.toHaveBeenCalled();
    expect(parkBudgetBlocked).toHaveBeenCalledWith(
      expect.anything(),
      "project-1",
      "Budget low",
      "runtime_intent_budget_blocked",
    );
    expect(parkAuthUnavailable).not.toHaveBeenCalled();
  });

  it("claims unfinished provisioned rows as agent_run", async () => {
    vi.mocked(prisma.$queryRawUnsafe as any).mockResolvedValue([
      {
        projectId: "project-1",
        projectName: "Ant Dream",
        projectSlug: "ant-dream",
        proposalId: null,
        proposalTitle: null,
        cycleImage: "arena-public-worker:local",
        componentId: "component-1",
        powerIntent: "ON",
        agentIntent: "ON",
        runtimeState: "ABSENT",
        agentState: "IDLE",
        provisionedAt: new Date("2026-04-17T08:00:00.000Z"),
        pendingLoopWork: true,
        allowPreviewOnlyRestore: false,
        blockers: [],
        workerHost: "local",
        containerName: null,
        runtimeConfig: {},
        lastState: null,
        lastAttempt: null,
        lastNextAttemptAt: null,
      },
    ]);
    vi.mocked(prisma.project.findUnique as any).mockResolvedValue({
      id: "project-1",
      budget: null,
      secrets: [],
      components: [{ agentIntent: "ON", runtimeConfig: {} }],
      proposal: { title: "Ant Dream" },
    });

    const res = await POST(new Request("http://localhost/api/internal/runtime-intents/claim", {
      method: "POST",
      body: JSON.stringify({ host: "local" }),
    }));

    await expect(res.json()).resolves.toEqual({
      intentId: "intent-1",
      projectId: "project-1",
      action: "ensure_running",
      runnerMode: "agent_run",
      containerName: null,
      workspaceLabel: "ant-dream-hea20y",
      workerImage: "arena-public-worker:local",
      attempt: 1,
      resources: { memoryMb: 2048, cpuCount: 1.5 },
      env: {
        ARENA_PROJECT_ID: "project-1",
        ARENA_AGENT: "codex",
      },
    });
    expect(prepareRuntimeLaunch).toHaveBeenCalledWith(
      expect.objectContaining({ id: "project-1" }),
      "local",
      "agent_run",
    );
  });
});
