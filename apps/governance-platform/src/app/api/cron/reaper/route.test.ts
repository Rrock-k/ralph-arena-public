import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

vi.mock("@/lib/prisma", () => {
  const prisma: any = {
    project: { findMany: vi.fn(), update: vi.fn() },
    runLog: { create: vi.fn() },
  };
  prisma.$transaction = vi.fn((args: unknown) =>
    Array.isArray(args) ? Promise.all(args) : (args as Function)(prisma),
  );
  return { prisma };
});

vi.mock("@/lib/progress-bus", () => ({
  notifyProjectChanged: vi.fn(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/internal-auth", () => ({
  isCronAuthorized: () => true,
}));

vi.mock("@/lib/project-state-effects", () => ({
  requirePrimaryComponentRow: vi.fn(),
  applyStateChange: vi.fn(),
  updateComponentMetadata: vi.fn(),
}));

import { prisma } from "@/lib/prisma";
import { notifyProjectChanged } from "@/lib/progress-bus";
import { applyStateChange, requirePrimaryComponentRow } from "@/lib/project-state-effects";

describe("POST /api/cron/reaper", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does nothing when no stale projects", async () => {
    vi.mocked(prisma.project.findMany as any)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const req = new Request("http://localhost/api/cron/reaper", { method: "POST" });
    const res = await POST(req);
    const body = await res.json();

    expect(body.reaped).toBe(0);
    expect(prisma.project.update).not.toHaveBeenCalled();
  });

  it("only targets stale zombies with launch evidence", async () => {
    vi.mocked(prisma.project.findMany as any)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const req = new Request("http://localhost/api/cron/reaper", { method: "POST" });
    const res = await POST(req);

    expect(res.status).toBe(200);

    const zombieQuery = vi.mocked(prisma.project.findMany as any).mock.calls[1][0];
    expect(zombieQuery.where.OR[0].components.some).toMatchObject({
      kind: "app",
      powerIntent: "ON",
      runtimeState: "ABSENT",
      blockers: { isEmpty: true },
      provisionedAt: { not: null },
      workerHost: { not: null },
    });
    expect(zombieQuery.where.OR[1].components.some).toMatchObject({
      kind: "app",
      powerIntent: "ON",
      runtimeState: "ABSENT",
      blockers: { isEmpty: true },
      workerHost: { not: null },
      lastHeartbeat: null,
    });
    expect(zombieQuery.where.OR[1].components.some.provisionedAt).toEqual({ lt: expect.any(Date) });
  });

  it("uses component provisioning time instead of Project.startedAt for stale running rows without heartbeat", async () => {
    vi.mocked(prisma.project.findMany as any)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const req = new Request("http://localhost/api/cron/reaper", { method: "POST" });
    const res = await POST(req);

    expect(res.status).toBe(200);

    const runningQuery = vi.mocked(prisma.project.findMany as any).mock.calls[0][0];
    expect(runningQuery.where.OR[0].components.some).toMatchObject({
      kind: "app",
      powerIntent: "ON",
      runtimeState: "RUNNING",
      lastHeartbeat: { lt: expect.any(Date) },
    });
    expect(runningQuery.where.OR[1].components.some).toMatchObject({
      kind: "app",
      powerIntent: "ON",
      runtimeState: "RUNNING",
      lastHeartbeat: null,
    });
    expect(runningQuery.where.OR[1].components.some.provisionedAt).toEqual({ lt: expect.any(Date) });
    expect(runningQuery.where.OR[1].startedAt).toBeUndefined();
  });

  it("marks stale running projects as paused and asks reconciler to stop runtime", async () => {
    vi.mocked(prisma.project.findMany as any)
      .mockResolvedValueOnce([{ id: "proj-1" }])
      .mockResolvedValueOnce([]);
    vi.mocked(prisma.project.update as any).mockResolvedValue({});
    vi.mocked(prisma.runLog.create as any).mockResolvedValue({});
    vi.mocked(requirePrimaryComponentRow as any).mockResolvedValue({
      projectId: "proj-1",
      componentId: "component-1",
      powerIntent: "ON",
      runtimeState: "RUNNING",
      agentState: "RUNNING",
      blockers: [],
      lastOutcome: null,
      lastOutcomeAt: null,
      retryAt: null,
      previewHealth: "HEALTHY",
      previewCheckedAt: new Date("2026-04-10T00:00:00Z"),
      provisionedAt: null,
      containerName: "preview-proj-1",
      previewUrl: "https://preview.example.com",
      workerHost: "local",
      vpsHostId: null,
      lastHeartbeat: new Date("2026-04-10T00:00:00Z"),
      retryCount: 0,
      archivedAt: null,
    });
    vi.mocked(applyStateChange as any).mockResolvedValue({});

    const req = new Request("http://localhost/api/cron/reaper", { method: "POST" });
    const res = await POST(req);
    const body = await res.json();

    expect(body.reaped).toBe(1);
    expect(prisma.project.update).not.toHaveBeenCalled();
    expect(applyStateChange).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      "proj-1",
      { type: "agentTransition", state: "IDLE" },
      expect.objectContaining({
        trigger: "reaper_timeout",
      }),
    );
    expect(applyStateChange).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      "proj-1",
      { type: "addBlocker", blocker: "INFRA" },
      expect.objectContaining({
        source: "cron",
        trigger: "reaper_timeout",
      }),
    );
    expect(notifyProjectChanged).toHaveBeenCalledWith("proj-1");
  });

  it("pauses stale zombies into INFRA instead of requeueing them directly", async () => {
    vi.mocked(prisma.project.findMany as any)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: "proj-zombie",
          components: [{ retryCount: 1 }],
        },
      ]);
    vi.mocked(prisma.project.update as any).mockResolvedValue({});
    vi.mocked(prisma.runLog.create as any).mockResolvedValue({});
    vi.mocked(requirePrimaryComponentRow as any).mockResolvedValue({
      projectId: "proj-zombie",
      componentId: "component-zombie",
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
      containerName: "preview-zombie",
      previewUrl: "https://preview-zombie.example.com",
      workerHost: "local",
      vpsHostId: null,
      lastHeartbeat: new Date("2026-04-10T00:00:00Z"),
      retryCount: 3,
      archivedAt: null,
    });
    vi.mocked(applyStateChange as any).mockResolvedValue({});

    const req = new Request("http://localhost/api/cron/reaper", { method: "POST" });
    const res = await POST(req);
    const body = await res.json();

    expect(body.reaped).toBe(1);
    expect(body.requeued).toBe(0);
    expect(prisma.project.update).not.toHaveBeenCalled();
    expect(applyStateChange).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      "proj-zombie",
      { type: "addBlocker", blocker: "INFRA" },
      expect.objectContaining({ trigger: "zombie_recovery_timeout" }),
    );
  });
});
