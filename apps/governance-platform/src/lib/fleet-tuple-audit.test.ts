import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    project: {
      findMany: vi.fn(),
    },
  },
}));

import { prisma } from "@/lib/prisma";
import { getFleetTupleAudit } from "./fleet-tuple-audit";

describe("fleet tuple audit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("recommends explicit coarse recovery actions for broken tuple classes", async () => {
    vi.mocked((prisma as any).project.findMany).mockResolvedValue([
      {
        id: "project-1",
        name: "Project 1",
        archivedAt: null,
        previewUrl: null,
        workerHost: null,
        updatedAt: new Date("2026-04-17T00:00:00.000Z"),
        components: [
          {
            kind: "app",
            powerIntent: "OFF",
            agentIntent: "ON",
            runtimeState: "ABSENT",
            agentState: "IDLE",
            blockers: ["INFRA"],
            lastOutcome: null,
            previewHealth: "UNKNOWN",
            previewUrl: null,
            retryAt: null,
            retryCount: 0,
            workerHost: null,
            containerName: null,
            lastHeartbeat: null,
          },
        ],
      },
      {
        id: "project-2",
        name: "Project 2",
        archivedAt: null,
        previewUrl: null,
        workerHost: "local",
        updatedAt: new Date("2026-04-17T00:00:00.000Z"),
        components: [
          {
            kind: "app",
            powerIntent: "ON",
            agentIntent: "OFF",
            runtimeState: "RUNNING",
            agentState: "RUNNING",
            blockers: [],
            lastOutcome: "COMPLETED",
            previewHealth: "HEALTHY",
            previewUrl: "https://preview.example.com",
            retryAt: null,
            retryCount: 0,
            workerHost: "local",
            containerName: "preview-project-2",
            lastHeartbeat: null,
          },
        ],
      },
    ]);

    const result = await getFleetTupleAudit();

    expect(result.classes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: "ghost_baggage_parked",
        recommendedAction: "power_off",
        recommendedTool: null,
      }),
      expect.objectContaining({
        code: "completed_preview_drift",
        recommendedAction: "recreate_runtime",
        recommendedTool: "project_recovery_attempt",
      }),
    ]));
  });

  it("does not fall back to stale project runtime mirrors in audit examples", async () => {
    vi.mocked((prisma as any).project.findMany).mockResolvedValue([
      {
        id: "project-1",
        name: "Project 1",
        archivedAt: null,
        previewUrl: "https://stale-project-mirror.example.com",
        workerHost: "stale-worker",
        updatedAt: new Date("2026-04-17T00:00:00.000Z"),
        components: [
          {
            kind: "app",
            powerIntent: "OFF",
            agentIntent: "ON",
            runtimeState: "ABSENT",
            agentState: "IDLE",
            blockers: ["INFRA"],
            lastOutcome: null,
            previewHealth: "UNKNOWN",
            previewUrl: null,
            retryAt: null,
            retryCount: 0,
            workerHost: null,
            containerName: null,
            lastHeartbeat: null,
          },
        ],
      },
    ]);

    const result = await getFleetTupleAudit();

    expect(result.classes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: "ghost_baggage_parked",
        examples: [
          expect.objectContaining({
            previewUrl: null,
            workerHost: null,
          }),
        ],
      }),
    ]));
  });

  it("flags parked rows that only carry retry-count baggage", async () => {
    vi.mocked((prisma as any).project.findMany).mockResolvedValue([
      {
        id: "project-1",
        name: "Project 1",
        archivedAt: null,
        updatedAt: new Date("2026-04-17T00:00:00.000Z"),
        components: [
          {
            kind: "app",
            powerIntent: "OFF",
            agentIntent: "OFF",
            runtimeState: "ABSENT",
            agentState: "IDLE",
            blockers: [],
            lastOutcome: "FAILED",
            previewHealth: "UNKNOWN",
            previewUrl: null,
            retryAt: null,
            retryCount: 2,
            workerHost: null,
            containerName: null,
            lastHeartbeat: null,
          },
        ],
      },
    ]);

    const result = await getFleetTupleAudit();

    expect(result.classes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: "ghost_baggage_parked",
        count: 1,
      }),
    ]));
  });
});
