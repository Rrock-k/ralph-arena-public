import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { POST } from "./route";

vi.mock("@/app/actions/runtime-maintenance", () => ({
  requestProjectPreviewRefreshInternal: vi.fn(),
  requestProjectRuntimeRecreateInternal: vi.fn(),
}));

vi.mock("@/lib/internal-auth", () => ({
  isCronAuthorized: vi.fn(() => true),
}));

vi.mock("@/lib/control-plane", () => ({
  getWorkerSnapshot: vi.fn(),
}));

vi.mock("@/lib/prisma", () => {
  const prisma: any = {
    project: { findMany: vi.fn() },
    projectEvent: { findMany: vi.fn() },
  };
  return { prisma };
});

import { requestProjectPreviewRefreshInternal } from "@/app/actions/runtime-maintenance";
import { requestProjectRuntimeRecreateInternal } from "@/app/actions/runtime-maintenance";
import { getWorkerSnapshot } from "@/lib/control-plane";
import { isCronAuthorized } from "@/lib/internal-auth";
import { INTERNAL_ACTION_TOKEN } from "@/lib/internal-action-token";
import { prisma } from "@/lib/prisma";

describe("POST /api/cron/blocked-maintenance", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isCronAuthorized).mockReturnValue(true);
    vi.mocked((prisma as any).projectEvent.findMany).mockResolvedValue([]);
    vi.mocked(getWorkerSnapshot as any).mockResolvedValue({
      runtimeGeneration: {
        status: "clean",
        reasons: [],
      },
    });
  });

  it("returns 401 when cron auth fails", async () => {
    vi.mocked(isCronAuthorized).mockReturnValue(false);

    const req = new Request("http://localhost/api/cron/blocked-maintenance", {
      method: "POST",
    });
    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body).toEqual({ error: "Unauthorized" });
  });

  it("reports eligible blocked rows in dry-run mode without mutating them", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-23T10:15:00.000Z"));

    vi.mocked(prisma.project.findMany as any).mockResolvedValue([
      {
        id: "kitties",
        name: "Sushi Kitties",
        components: [
          {
            kind: "app",
            powerIntent: "ON",
            agentIntent: "ON",
            runtimeState: "RUNNING",
            agentState: "IDLE",
            blockers: ["RATE_LIMIT"],
            previewHealth: "HEALTHY",
            previewCheckedAt: "2026-04-23T10:00:00.000Z",
            lastHeartbeat: "2026-04-23T09:30:00.000Z",
          },
        ],
      },
      {
        id: "sd",
        name: "SD Downhill",
        components: [
          {
            kind: "app",
            powerIntent: "ON",
            agentIntent: "OFF",
            runtimeState: "RUNNING",
            agentState: "IDLE",
            blockers: ["RATE_LIMIT"],
            previewHealth: "HEALTHY",
            previewCheckedAt: "2026-04-23T10:02:00.000Z",
            lastHeartbeat: "2026-04-23T10:02:00.000Z",
          },
        ],
      },
      {
        id: "desk",
        name: "Desk Garden",
        components: [
          {
            kind: "app",
            powerIntent: "ON",
            agentIntent: "ON",
            runtimeState: "RUNNING",
            agentState: "IDLE",
            blockers: [],
            previewHealth: "HEALTHY",
            previewCheckedAt: "2026-04-23T10:03:00.000Z",
            lastHeartbeat: "2026-04-23T10:03:00.000Z",
          },
        ],
      },
    ]);

    const req = new Request("http://localhost/api/cron/blocked-maintenance", {
      method: "POST",
      body: JSON.stringify({ dryRun: true }),
    });
    const res = await POST(req);
    const body = await res.json();

    expect(body).toEqual({
      dryRun: true,
      selected: 1,
      requested: 0,
      failed: 0,
      candidates: [
        {
          projectId: "kitties",
          projectName: "Sushi Kitties",
          cohort: "blocked_waiting_preview",
          blockers: ["RATE_LIMIT"],
          action: "preview_refresh",
          maintenanceReason: "preview_serving_stale",
          previewHealth: "HEALTHY",
          runtimeGenerationReasons: [],
        },
      ],
      requestedProjectIds: [],
      failedProjects: [],
      skippedProjects: [],
    });
    expect(requestProjectPreviewRefreshInternal).not.toHaveBeenCalled();

    vi.useRealTimers();
  });

  it("executes preview refresh for eligible blocked rows", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-23T10:15:00.000Z"));

    vi.mocked(prisma.project.findMany as any).mockResolvedValue([
      {
        id: "kitties",
        name: "Sushi Kitties",
        components: [
          {
            kind: "app",
            powerIntent: "ON",
            agentIntent: "ON",
            runtimeState: "RUNNING",
            agentState: "IDLE",
            blockers: ["RATE_LIMIT"],
            previewHealth: "HEALTHY",
            previewCheckedAt: "2026-04-23T10:00:00.000Z",
            lastHeartbeat: "2026-04-23T09:30:00.000Z",
          },
        ],
      },
      {
        id: "words",
        name: "Телеграм бот для изучения слов",
        components: [
          {
            kind: "app",
            powerIntent: "ON",
            agentIntent: "ON",
            runtimeState: "RUNNING",
            agentState: "IDLE",
            blockers: ["BUDGET"],
            previewHealth: "HEALTHY",
            previewCheckedAt: "2026-04-23T10:01:00.000Z",
            lastHeartbeat: null,
          },
        ],
      },
    ]);
    vi.mocked(requestProjectPreviewRefreshInternal as any)
      .mockResolvedValueOnce({ success: true, details: "Preview refresh requested" })
      .mockResolvedValueOnce({ success: true, details: "Preview refresh requested" });

    const req = new Request("http://localhost/api/cron/blocked-maintenance", {
      method: "POST",
      body: JSON.stringify({ projectIds: ["kitties", "words"] }),
    });
    const res = await POST(req);
    const body = await res.json();

    expect(body.selected).toBe(2);
    expect(body.requested).toBe(2);
    expect(body.failed).toBe(0);
    expect(body.requestedProjectIds).toEqual(["kitties", "words"]);
    expect(body.skippedProjects).toEqual([]);
    expect(requestProjectPreviewRefreshInternal).toHaveBeenCalledTimes(2);
    expect(requestProjectPreviewRefreshInternal).toHaveBeenCalledWith("kitties", {
      source: "cron",
      reason: "resident_runtime_auto_maintenance",
      maintenanceReason: "preview_serving_stale",
      internalActionToken: INTERNAL_ACTION_TOKEN,
    });
    expect(requestProjectPreviewRefreshInternal).toHaveBeenCalledWith("words", {
      source: "cron",
      reason: "resident_runtime_auto_maintenance",
      maintenanceReason: "preview_serving_stale",
      internalActionToken: INTERNAL_ACTION_TOKEN,
    });

    vi.useRealTimers();
  });

  it("returns failed projects when preview refresh cannot be requested", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-23T10:15:00.000Z"));

    vi.mocked(prisma.project.findMany as any).mockResolvedValue([
      {
        id: "kitties",
        name: "Sushi Kitties",
        components: [
          {
            kind: "app",
            powerIntent: "ON",
            agentIntent: "ON",
            runtimeState: "RUNNING",
            agentState: "IDLE",
            blockers: ["RATE_LIMIT"],
            previewHealth: "HEALTHY",
            previewCheckedAt: "2026-04-23T10:00:00.000Z",
            lastHeartbeat: "2026-04-23T09:30:00.000Z",
          },
        ],
      },
    ]);
    vi.mocked(requestProjectPreviewRefreshInternal as any).mockResolvedValue({
      success: false,
      error: "Preview refresh requires a running project runtime",
    });

    const req = new Request("http://localhost/api/cron/blocked-maintenance", {
      method: "POST",
    });
    const res = await POST(req);
    const body = await res.json();

    expect(body.requested).toBe(0);
    expect(body.failed).toBe(1);
    expect(body.failedProjects).toEqual([
      {
        projectId: "kitties",
        error: "Preview refresh requires a running project runtime",
      },
    ]);
    expect(body.skippedProjects).toEqual([]);
    expect(requestProjectRuntimeRecreateInternal).not.toHaveBeenCalled();

    vi.useRealTimers();
  });

  it("excludes mixed-blocker rows from the scheduler-safe lane", async () => {
    vi.mocked(prisma.project.findMany as any).mockResolvedValue([
      {
        id: "mixed",
        name: "Mixed Row",
        components: [
          {
            kind: "app",
            powerIntent: "ON",
            agentIntent: "ON",
            runtimeState: "RUNNING",
            agentState: "IDLE",
            blockers: ["RATE_LIMIT", "INFRA"],
            previewHealth: "HEALTHY",
            previewCheckedAt: "2026-04-23T10:00:00.000Z",
            lastHeartbeat: "2026-04-23T09:30:00.000Z",
          },
        ],
      },
    ]);

    const req = new Request("http://localhost/api/cron/blocked-maintenance", {
      method: "POST",
      body: JSON.stringify({ dryRun: true }),
    });
    const res = await POST(req);
    const body = await res.json();

    expect(body.selected).toBe(0);
    expect(body.candidates).toEqual([]);
    expect(body.skippedProjects).toEqual([]);
    expect(requestProjectPreviewRefreshInternal).not.toHaveBeenCalled();
    expect(requestProjectRuntimeRecreateInternal).not.toHaveBeenCalled();
  });

  it("skips healthy blocked rows whose preview heartbeat is still fresh", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-23T10:15:00.000Z"));

    vi.mocked(prisma.project.findMany as any).mockResolvedValue([
      {
        id: "kitties",
        name: "Sushi Kitties",
        components: [
          {
            kind: "app",
            powerIntent: "ON",
            agentIntent: "ON",
            runtimeState: "RUNNING",
            agentState: "IDLE",
            blockers: ["RATE_LIMIT"],
            previewHealth: "HEALTHY",
            previewCheckedAt: "2026-04-23T10:00:00.000Z",
            lastHeartbeat: "2026-04-23T10:10:00.000Z",
          },
        ],
      },
    ]);

    const req = new Request("http://localhost/api/cron/blocked-maintenance", {
      method: "POST",
      body: JSON.stringify({ dryRun: true }),
    });
    const res = await POST(req);
    const body = await res.json();

    expect(body.selected).toBe(0);
    expect(body.requested).toBe(0);
    expect(body.failed).toBe(0);
    expect(body.candidates).toEqual([]);
    expect(body.skippedProjects).toEqual([
      {
        projectId: "kitties",
        reason: "preview_fresh",
      },
    ]);
    expect(requestProjectPreviewRefreshInternal).not.toHaveBeenCalled();
    expect(requestProjectRuntimeRecreateInternal).not.toHaveBeenCalled();

    vi.useRealTimers();
  });

  it("dedupes rows with a recent blocked maintenance request in cooldown window", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-23T10:20:00.000Z"));
    vi.mocked(prisma.project.findMany as any).mockResolvedValue([
      {
        id: "kitties",
        name: "Sushi Kitties",
        components: [
          {
            kind: "app",
            powerIntent: "ON",
            agentIntent: "ON",
            runtimeState: "RUNNING",
            agentState: "IDLE",
            blockers: ["RATE_LIMIT"],
            previewHealth: "HEALTHY",
            previewCheckedAt: "2026-04-23T10:00:00.000Z",
            lastHeartbeat: "2026-04-23T09:30:00.000Z",
          },
        ],
      },
    ]);
    vi.mocked((prisma as any).projectEvent.findMany).mockResolvedValue([
      {
        projectId: "kitties",
        payload: { source: "cron", reason: "resident_runtime_auto_maintenance" },
        createdAt: new Date("2026-04-23T10:10:30.000Z"),
      },
    ]);

    const req = new Request("http://localhost/api/cron/blocked-maintenance", {
      method: "POST",
    });
    const res = await POST(req);
    const body = await res.json();

    expect(body.selected).toBe(0);
    expect(body.requested).toBe(0);
    expect(body.skippedProjects).toEqual([
      {
        projectId: "kitties",
        reason: "cooldown_active",
      },
    ]);
    expect(requestProjectPreviewRefreshInternal).not.toHaveBeenCalled();
    expect(requestProjectRuntimeRecreateInternal).not.toHaveBeenCalled();

    vi.useRealTimers();
  });

  it("selects retained completed previews with stale runtime generation for recreate_runtime", async () => {
    vi.mocked(prisma.project.findMany as any).mockResolvedValue([
      {
        id: "space",
        name: "Space Invaders",
        components: [
          {
            kind: "app",
            powerIntent: "ON",
            agentIntent: "ON",
            runtimeState: "RUNNING",
            agentState: "IDLE",
            blockers: [],
            lastOutcome: "COMPLETED",
            previewHealth: "HEALTHY",
            previewCheckedAt: "2026-04-23T10:00:00.000Z",
            lastHeartbeat: "2026-04-23T10:10:00.000Z",
          },
        ],
      },
    ]);
    vi.mocked(getWorkerSnapshot as any).mockResolvedValue({
      runtimeGeneration: {
        status: "mismatch",
        reasons: ["runtime_runner_version_mismatch:671fac8a7691"],
      },
    });

    const req = new Request("http://localhost/api/cron/blocked-maintenance", {
      method: "POST",
      body: JSON.stringify({ dryRun: true }),
    });
    const res = await POST(req);
    const body = await res.json();

    expect(body.selected).toBe(1);
    expect(body.candidates).toEqual([
      {
        projectId: "space",
        projectName: "Space Invaders",
        cohort: "retained_completed_preview",
        blockers: [],
        action: "recreate_runtime",
        maintenanceReason: "runtime_generation_stale",
        previewHealth: "HEALTHY",
        runtimeGenerationReasons: ["runtime_runner_version_mismatch:671fac8a7691"],
      },
    ]);
    expect(requestProjectPreviewRefreshInternal).not.toHaveBeenCalled();
  });

  it("executes recreate_runtime for stale retained previews", async () => {
    vi.mocked(prisma.project.findMany as any).mockResolvedValue([
      {
        id: "space",
        name: "Space Invaders",
        components: [
          {
            kind: "app",
            powerIntent: "ON",
            agentIntent: "ON",
            runtimeState: "RUNNING",
            agentState: "IDLE",
            blockers: [],
            lastOutcome: "COMPLETED",
            previewHealth: "HEALTHY",
            previewCheckedAt: "2026-04-23T10:00:00.000Z",
            lastHeartbeat: "2026-04-23T10:10:00.000Z",
          },
        ],
      },
    ]);
    vi.mocked(getWorkerSnapshot as any).mockResolvedValue({
      runtimeGeneration: {
        status: "mismatch",
        reasons: ["runtime_runner_version_mismatch:671fac8a7691"],
      },
    });
    vi.mocked(requestProjectRuntimeRecreateInternal as any).mockResolvedValue({
      success: true,
      details: "Runtime recreate requested",
    });

    const req = new Request("http://localhost/api/cron/blocked-maintenance", {
      method: "POST",
    });
    const res = await POST(req);
    const body = await res.json();

    expect(body.selected).toBe(1);
    expect(body.requestedProjectIds).toEqual(["space"]);
    expect(requestProjectRuntimeRecreateInternal).toHaveBeenCalledWith("space", {
      source: "cron",
      reason: "resident_runtime_auto_maintenance",
      maintenanceReason: "runtime_generation_stale",
      internalActionToken: INTERNAL_ACTION_TOKEN,
    });
    expect(requestProjectPreviewRefreshInternal).not.toHaveBeenCalled();
  });

  it("excludes agent-off retained previews from the shipped scheduler lane", async () => {
    vi.mocked(prisma.project.findMany as any).mockResolvedValue([
      {
        id: "sd",
        name: "SD Downhill",
        components: [
          {
            kind: "app",
            powerIntent: "ON",
            agentIntent: "OFF",
            runtimeState: "RUNNING",
            agentState: "IDLE",
            blockers: [],
            lastOutcome: null,
            previewHealth: "HEALTHY",
            previewCheckedAt: "2026-04-23T10:00:00.000Z",
            lastHeartbeat: "2026-04-23T10:10:00.000Z",
          },
        ],
      },
    ]);

    const req = new Request("http://localhost/api/cron/blocked-maintenance", {
      method: "POST",
      body: JSON.stringify({ dryRun: true }),
    });
    const res = await POST(req);
    const body = await res.json();

    expect(body.selected).toBe(0);
    expect(body.candidates).toEqual([]);
    expect(requestProjectPreviewRefreshInternal).not.toHaveBeenCalled();
    expect(requestProjectRuntimeRecreateInternal).not.toHaveBeenCalled();
  });

  it("skips rows when runtime generation truth is incomplete but not actionable", async () => {
    vi.mocked(prisma.project.findMany as any).mockResolvedValue([
      {
        id: "space",
        name: "Space Invaders",
        components: [
          {
            kind: "app",
            powerIntent: "ON",
            agentIntent: "ON",
            runtimeState: "RUNNING",
            agentState: "IDLE",
            blockers: [],
            lastOutcome: "COMPLETED",
            previewHealth: "HEALTHY",
            previewCheckedAt: "2026-04-23T10:00:00.000Z",
            lastHeartbeat: "2026-04-23T10:10:00.000Z",
          },
        ],
      },
    ]);
    vi.mocked(getWorkerSnapshot as any).mockResolvedValue({
      runtimeGeneration: {
        status: "mismatch",
        reasons: ["runtime_runner_version_missing"],
      },
    });

    const req = new Request("http://localhost/api/cron/blocked-maintenance", {
      method: "POST",
      body: JSON.stringify({ dryRun: true }),
    });
    const res = await POST(req);
    const body = await res.json();

    expect(body.selected).toBe(0);
    expect(body.skippedProjects).toEqual([
      {
        projectId: "space",
        reason: "runtime_generation_truth_incomplete",
      },
    ]);
  });

  it("rejects invalid JSON body", async () => {
    const req = new Request("http://localhost/api/cron/blocked-maintenance", {
      method: "POST",
      body: "{",
    });
    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBeTruthy();
  });
});
