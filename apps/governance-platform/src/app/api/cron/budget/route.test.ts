import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    project: { findMany: vi.fn(), update: vi.fn() },
    runLog: { create: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock("@/lib/internal-auth", () => ({
  isCronAuthorized: vi.fn(() => true),
}));

vi.mock("@/lib/project-state-effects", () => ({
  applyStateChange: vi.fn(),
  requirePrimaryComponentRow: vi.fn(),
}));

vi.mock("@/lib/budget-resume", () => ({
  tryAutoResumePausedRun: vi.fn(),
}));

vi.mock("@/lib/notifications", () => ({
  notify: vi.fn().mockResolvedValue(undefined),
}));

import { prisma } from "@/lib/prisma";
import { applyStateChange, requirePrimaryComponentRow } from "@/lib/project-state-effects";
import { tryAutoResumePausedRun } from "@/lib/budget-resume";
import { notify } from "@/lib/notifications";
import { BUDGET_THRESHOLD_USD } from "@/lib/project-budget";

describe("POST /api/cron/budget", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.$transaction as any).mockImplementation(async (callback: (tx: typeof prisma) => Promise<unknown>) => callback(prisma as any));
  });

  it("does nothing when no projects need action", async () => {
    vi.mocked(prisma.project.findMany as any).mockResolvedValue([]);

    const req = new Request("http://localhost/api/cron/budget", { method: "POST" });
    const res = await POST(req);
    const body = await res.json();

    expect(body.paused).toBe(0);
    expect(body.resumed).toBe(0);
  });

  it("pauses RUNNING projects once remaining budget falls below the absolute threshold", async () => {
    vi.mocked(prisma.project.findMany as any)
      // First call: RUNNING projects
      .mockResolvedValueOnce([
        {
          id: "proj-1",
          name: "Project 1",
          budget: { isEnabled: true, totalCreditsUsd: 1.0, usedCreditsUsd: 1.0 - BUDGET_THRESHOLD_USD + 0.01 },
        },
      ])
      // Second call: BUDGET-blocked projects
      .mockResolvedValueOnce([]);

    vi.mocked(prisma.project.update as any).mockResolvedValue({});
    vi.mocked(requirePrimaryComponentRow as any).mockResolvedValue({
      projectId: "proj-1",
      componentId: "cmp-1",
      powerIntent: "ON",
      runtimeState: "RUNNING",
      agentState: "RUNNING",
      blockers: [],
      lastOutcome: null,
      lastOutcomeAt: null,
      retryAt: null,
      previewHealth: "UNKNOWN",
      previewCheckedAt: null,
      provisionedAt: null,
      containerName: "arena-proj-1",
      previewUrl: null,
      workerHost: "local",
      vpsHostId: null,
      lastHeartbeat: null,
      retryCount: 0,
      archivedAt: null,
    });
    vi.mocked(applyStateChange as any).mockResolvedValue({});

    const req = new Request("http://localhost/api/cron/budget", { method: "POST" });
    const res = await POST(req);
    const body = await res.json();

    expect(body.paused).toBe(1);
    expect(notify).toHaveBeenCalledWith({
      type: "project.paused_budget",
      projectId: "proj-1",
      projectName: "Project 1",
    });
    expect(prisma.project.findMany).toHaveBeenNthCalledWith(1, {
      where: {
        archivedAt: null,
        components: {
          some: {
            kind: "app",
            powerIntent: "ON",
            runtimeState: "RUNNING",
            OR: [
              { agentState: "RUNNING" },
              { agentState: null },
            ],
          },
        },
      },
      select: {
        id: true,
        name: true,
        budget: {
          select: { isEnabled: true, totalCreditsUsd: true, usedCreditsUsd: true },
        },
      },
    });
    expect(prisma.project.update).not.toHaveBeenCalled();
    expect(applyStateChange).toHaveBeenCalled();
  });

  it("resumes BUDGET-blocked projects when remaining budget is above the absolute threshold", async () => {
    vi.mocked(prisma.project.findMany as any)
      .mockResolvedValueOnce([]) // no RUNNING projects to pause
      .mockResolvedValueOnce([
        {
          id: "proj-paused",
          components: [{ kind: "app", blockers: ["BUDGET"] }],
          budget: { isEnabled: true, totalCreditsUsd: 10.0, usedCreditsUsd: 9.5 }, // $0.50 remaining > threshold
        },
      ]);

    vi.mocked(tryAutoResumePausedRun as any).mockResolvedValue("proj-paused");

    const req = new Request("http://localhost/api/cron/budget", { method: "POST" });
    const res = await POST(req);
    const body = await res.json();

    expect(body.resumed).toBe(1);
    expect(prisma.project.findMany).toHaveBeenNthCalledWith(2, {
      where: {
        archivedAt: null,
        components: {
          some: {
            kind: "app",
            blockers: { has: "BUDGET" },
          },
        },
      },
      select: {
        id: true,
        budget: {
          select: { isEnabled: true, totalCreditsUsd: true, usedCreditsUsd: true },
        },
        components: {
          orderBy: { createdAt: "asc" },
          take: 1,
          select: { kind: true, blockers: true },
        },
      },
    });
    expect(tryAutoResumePausedRun).toHaveBeenCalledWith(
      expect.anything(),
      "proj-paused",
      0.5,
    );
  });

  it("can resume a live retained preview that is blocked on budget", async () => {
    vi.mocked(prisma.project.findMany as any)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: "proj-live-paused",
          components: [{ kind: "app", blockers: ["BUDGET"] }],
          budget: { isEnabled: true, totalCreditsUsd: 300.0, usedCreditsUsd: 287.7 },
        },
      ]);

    vi.mocked(tryAutoResumePausedRun as any).mockResolvedValue("proj-live-paused");

    const req = new Request("http://localhost/api/cron/budget", { method: "POST" });
    const res = await POST(req);
    const body = await res.json();

    expect(body.resumed).toBe(1);
    const [, , remainingUsd] = vi.mocked(tryAutoResumePausedRun as any).mock.calls[0];
    expect(remainingUsd).toBeCloseTo(12.3, 5);
  });

  it("skips projects with disabled budget", async () => {
    vi.mocked(prisma.project.findMany as any)
      .mockResolvedValueOnce([
        {
          id: "proj-1",
          budget: { isEnabled: false, totalCreditsUsd: 0, usedCreditsUsd: 0 },
        },
      ])
      .mockResolvedValueOnce([]);

    const req = new Request("http://localhost/api/cron/budget", { method: "POST" });
    const res = await POST(req);
    const body = await res.json();

    expect(body.paused).toBe(0);
    expect(prisma.project.update).not.toHaveBeenCalled();
  });

  it("does not notify again when the project is already blocked on budget", async () => {
    vi.mocked(prisma.project.findMany as any)
      .mockResolvedValueOnce([
        {
          id: "proj-1",
          name: "Project 1",
          budget: { isEnabled: true, totalCreditsUsd: 1.0, usedCreditsUsd: 0.96 },
        },
      ])
      .mockResolvedValueOnce([]);

    vi.mocked(requirePrimaryComponentRow as any).mockResolvedValue({
      projectId: "proj-1",
      componentId: "cmp-1",
      powerIntent: "ON",
      runtimeState: "RUNNING",
      agentState: "RUNNING",
      blockers: ["BUDGET"],
      lastOutcome: null,
      lastOutcomeAt: null,
      retryAt: null,
      previewHealth: "UNKNOWN",
      previewCheckedAt: null,
      provisionedAt: null,
      containerName: "arena-proj-1",
      previewUrl: null,
      workerHost: "local",
      vpsHostId: null,
      lastHeartbeat: null,
      retryCount: 0,
      archivedAt: null,
    });

    const req = new Request("http://localhost/api/cron/budget", { method: "POST" });
    const res = await POST(req);
    const body = await res.json();

    expect(body.paused).toBe(0);
    expect(applyStateChange).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });
});
