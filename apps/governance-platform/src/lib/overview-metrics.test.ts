import { describe, expect, it } from "vitest";

import { computeOverviewMetrics } from "./overview-metrics";

describe("computeOverviewMetrics", () => {
  it("does not count completed retained previews as active runs", () => {
    const metrics = computeOverviewMetrics([{
      estimatedCostUsd: 12.5,
      app: {
        kind: "app",
        powerIntent: "ON",
        agentIntent: "ON",
        runtimeState: "RUNNING",
        agentState: "IDLE",
        blockers: [],
        lastOutcome: "COMPLETED",
        previewHealth: "HEALTHY",
        previewUrl: "https://preview-desk-garden.arena.example.test",
        containerName: "preview-desk-garden",
      },
    }]);

    expect(metrics).toEqual({
      totalProjects: 1,
      activeRuns: 0,
      deployedCount: 1,
      failedCount: 0,
      totalCostUsd: 12.5,
    });
  });

  it("counts genuinely running loops as active runs", () => {
    const metrics = computeOverviewMetrics([{
      estimatedCostUsd: 7,
      app: {
        kind: "app",
        powerIntent: "ON",
        agentIntent: "ON",
        runtimeState: "RUNNING",
        agentState: "RUNNING",
        blockers: [],
        lastOutcome: null,
        previewHealth: "HEALTHY",
        previewUrl: "https://preview-busy-project.arena.example.test",
        containerName: "preview-busy-project",
      },
    }]);

    expect(metrics).toEqual({
      totalProjects: 1,
      activeRuns: 1,
      deployedCount: 0,
      failedCount: 0,
      totalCostUsd: 7,
    });
  });

  it("preserves failed retained previews in failedCount without reviving them as active runs", () => {
    const metrics = computeOverviewMetrics([{
      estimatedCostUsd: 5.75,
      app: {
        kind: "app",
        powerIntent: "ON",
        agentIntent: "OFF",
        runtimeState: "RUNNING",
        agentState: "IDLE",
        blockers: [],
        lastOutcome: "FAILED",
        previewHealth: "HEALTHY",
        previewUrl: "https://preview-ant-dream.arena.example.test",
        containerName: "preview-ant-dream",
      },
    }]);

    expect(metrics).toEqual({
      totalProjects: 1,
      activeRuns: 0,
      deployedCount: 1,
      failedCount: 1,
      totalCostUsd: 5.75,
    });
  });

  it("does not count parked failed residue as live failed metric debt", () => {
    const metrics = computeOverviewMetrics([{
      estimatedCostUsd: 3,
      app: {
        kind: "app",
        powerIntent: "OFF",
        agentIntent: "OFF",
        runtimeState: "ABSENT",
        agentState: "IDLE",
        blockers: [],
        lastOutcome: "FAILED",
        previewHealth: "UNKNOWN",
        previewUrl: null,
        containerName: null,
      },
    }]);

    expect(metrics).toEqual({
      totalProjects: 1,
      activeRuns: 0,
      deployedCount: 0,
      failedCount: 0,
      totalCostUsd: 3,
    });
  });

  it("does not count archived failed residue as live failed metric debt", () => {
    const metrics = computeOverviewMetrics([{
      archivedAt: "2026-04-17T19:24:32.120Z",
      estimatedCostUsd: 2.5,
      app: {
        kind: "app",
        powerIntent: "OFF",
        agentIntent: "OFF",
        runtimeState: "ABSENT",
        agentState: "IDLE",
        blockers: ["MANUAL"],
        lastOutcome: "FAILED",
        previewHealth: "HEALTHY",
        previewUrl: "https://preview-catan.arena.example.test",
        containerName: "preview-catan",
      },
    }]);

    expect(metrics).toEqual({
      totalProjects: 1,
      activeRuns: 0,
      deployedCount: 0,
      failedCount: 0,
      totalCostUsd: 2.5,
    });
  });
});
