import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    project: {
      findMany: vi.fn(),
    },
    cronJob: {
      findMany: vi.fn(),
    },
  },
}));

vi.mock("@/lib/token-manager", () => ({
  getTokenManager: vi.fn(() => ({
    getStatus: vi.fn(() => ({
      lastReadAt: null,
      lastRefreshAt: null,
      refreshInFlight: false,
      envFilePaths: [],
      providers: {
        "claude-api": null,
        "claude-sub": null,
        "openai-api": null,
        "openai-sub": null,
        "opencode-api": null,
        github: null,
      },
    })),
  })),
}));

vi.mock("@/lib/control-plane", () => ({
  getExpectedRunnerVersion: vi.fn(() => "expected-sha"),
}));

import { prisma } from "@/lib/prisma";
import { getSystemOverview } from "./system-overview";

describe("system overview runtime identity ownership", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.cronJob.findMany as any).mockResolvedValue([]);
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => ({
        worker: { gitSha: "expected-sha-local", image: "arena-public-worker:local" },
        runner: { gitSha: "expected-sha-local" },
      }),
      text: async () => "",
    })));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("does not flatten component runtime identity back onto the project snapshot", async () => {
    vi.mocked(prisma.project.findMany as any).mockResolvedValue([{
      id: "project-1",
      name: "Demo",
      mode: "proposal",
      visibility: "private",
      archivedAt: null,
      runnerBackend: "local",
      progressJson: null,
      createdAt: new Date("2026-04-19T00:00:00.000Z"),
      updatedAt: new Date("2026-04-19T00:00:00.000Z"),
      estimatedCostUsd: 0,
      inputTokens: 0,
      outputTokens: 0,
      components: [{
        kind: "app",
        powerIntent: "OFF",
        agentIntent: "OFF",
        runtimeState: "ABSENT",
        agentState: "IDLE",
        blockers: [],
        lastOutcome: "COMPLETED",
        previewHealth: "UNKNOWN",
        provisionedAt: null,
        containerName: null,
        previewUrl: null,
        workerHost: null,
      }],
      budget: null,
      vpsHost: null,
    }]);

    const overview = await getSystemOverview();
    const project = overview.projects[0];

    expect(project?.app).toEqual({
      powerIntent: "OFF",
      agentIntent: "OFF",
      runtimeState: "ABSENT",
      agentState: "IDLE",
      blockers: [],
      lastOutcome: "COMPLETED",
      previewHealth: "UNKNOWN",
      provisionedAt: null,
      containerName: null,
      previewUrl: null,
      workerHost: null,
      lastHeartbeat: null,
    });
    expect(project?.containerName).toBeNull();
    expect(project?.previewUrl).toBeNull();
    expect(project?.workerHost).toBeNull();
    expect("startedAt" in (project ?? {})).toBe(false);
    expect("finishedAt" in (project ?? {})).toBe(false);
    expect("lastError" in (project ?? {})).toBe(false);
  });

  it("does not flag stale activity for completed retained previews with fresh heartbeats", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-23T07:20:00.000Z"));

    vi.mocked(prisma.project.findMany as any).mockResolvedValue([{
      id: "project-1",
      name: "Desk Garden",
      mode: "personal",
      visibility: "private",
      archivedAt: null,
      runnerBackend: "local",
      progressJson: null,
      createdAt: new Date("2026-04-23T01:00:00.000Z"),
      updatedAt: new Date("2026-04-23T02:31:54.803Z"),
      estimatedCostUsd: 0,
      inputTokens: 0,
      outputTokens: 0,
      components: [{
        kind: "app",
        powerIntent: "ON",
        agentIntent: "ON",
        runtimeState: "RUNNING",
        agentState: "IDLE",
        blockers: [],
        lastOutcome: "COMPLETED",
        previewHealth: "HEALTHY",
        provisionedAt: new Date("2026-04-23T02:30:51.047Z"),
        containerName: "preview-desk-garden",
        previewUrl: "https://preview-desk-garden.arena.example.test",
        workerHost: "local",
        lastHeartbeat: new Date("2026-04-23T07:19:39.886Z"),
      }],
      budget: null,
      vpsHost: null,
    }]);

    const overview = await getSystemOverview();

    expect(overview.attentionItems).not.toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: "stale_activity",
        projectId: "project-1",
      }),
    ]));
  });

  it("still flags stale activity for genuinely running loops with no state updates", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-23T07:20:00.000Z"));

    vi.mocked(prisma.project.findMany as any).mockResolvedValue([{
      id: "project-1",
      name: "Busy Project",
      mode: "personal",
      visibility: "private",
      archivedAt: null,
      runnerBackend: "local",
      progressJson: null,
      createdAt: new Date("2026-04-23T01:00:00.000Z"),
      updatedAt: new Date("2026-04-23T06:50:00.000Z"),
      estimatedCostUsd: 0,
      inputTokens: 0,
      outputTokens: 0,
      components: [{
        kind: "app",
        powerIntent: "ON",
        agentIntent: "ON",
        runtimeState: "RUNNING",
        agentState: "RUNNING",
        blockers: [],
        lastOutcome: null,
        previewHealth: "HEALTHY",
        provisionedAt: new Date("2026-04-23T06:30:00.000Z"),
        containerName: "preview-busy-project",
        previewUrl: "https://preview-busy-project.arena.example.test",
        workerHost: "local",
        lastHeartbeat: new Date("2026-04-23T07:19:40.000Z"),
      }],
      budget: null,
      vpsHost: null,
    }]);

    const overview = await getSystemOverview();

    expect(overview.attentionItems).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: "stale_activity",
        projectId: "project-1",
      }),
    ]));
  });

  it("does not count completed retained previews as active runs", async () => {
    vi.mocked(prisma.project.findMany as any).mockResolvedValue([{
      id: "project-1",
      name: "Desk Garden",
      mode: "personal",
      visibility: "private",
      archivedAt: null,
      runnerBackend: "local",
      progressJson: null,
      createdAt: new Date("2026-04-23T01:00:00.000Z"),
      updatedAt: new Date("2026-04-23T02:31:54.803Z"),
      estimatedCostUsd: 0,
      inputTokens: 0,
      outputTokens: 0,
      components: [{
        kind: "app",
        powerIntent: "ON",
        agentIntent: "ON",
        runtimeState: "RUNNING",
        agentState: "IDLE",
        blockers: [],
        lastOutcome: "COMPLETED",
        previewHealth: "HEALTHY",
        provisionedAt: new Date("2026-04-23T02:30:51.047Z"),
        containerName: "preview-desk-garden",
        previewUrl: "https://preview-desk-garden.arena.example.test",
        workerHost: "local",
        lastHeartbeat: new Date("2026-04-23T07:19:39.886Z"),
      }],
      budget: null,
      vpsHost: null,
    }]);

    const overview = await getSystemOverview();

    expect(overview.metrics.activeRuns).toBe(0);
    expect(overview.workers).toEqual([
      expect.objectContaining({
        host: "local",
        activeProjectCount: 0,
      }),
    ]);
  });

  it("counts genuinely running loops as active runs", async () => {
    vi.mocked(prisma.project.findMany as any).mockResolvedValue([{
      id: "project-1",
      name: "Busy Project",
      mode: "personal",
      visibility: "private",
      archivedAt: null,
      runnerBackend: "local",
      progressJson: null,
      createdAt: new Date("2026-04-23T01:00:00.000Z"),
      updatedAt: new Date("2026-04-23T07:00:00.000Z"),
      estimatedCostUsd: 0,
      inputTokens: 0,
      outputTokens: 0,
      components: [{
        kind: "app",
        powerIntent: "ON",
        agentIntent: "ON",
        runtimeState: "RUNNING",
        agentState: "RUNNING",
        blockers: [],
        lastOutcome: null,
        previewHealth: "HEALTHY",
        provisionedAt: new Date("2026-04-23T06:30:00.000Z"),
        containerName: "preview-busy-project",
        previewUrl: "https://preview-busy-project.arena.example.test",
        workerHost: "local",
        lastHeartbeat: new Date("2026-04-23T07:19:40.000Z"),
      }],
      budget: null,
      vpsHost: null,
    }]);

    const overview = await getSystemOverview();

    expect(overview.metrics.activeRuns).toBe(1);
    expect(overview.workers).toEqual([
      expect.objectContaining({
        host: "local",
        activeProjectCount: 1,
      }),
    ]);
  });

  it("surfaces worker-service generation drift per worker bucket", async () => {
    vi.mocked(global.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({
        worker: { gitSha: "stale-worker-sha", image: "arena-public-worker:local" },
        runner: { gitSha: "stale-runner-sha" },
      }),
      text: async () => "",
    });

    vi.mocked(prisma.project.findMany as any).mockResolvedValue([{
      id: "project-1",
      name: "Desk Garden",
      mode: "personal",
      visibility: "private",
      archivedAt: null,
      runnerBackend: "local",
      progressJson: null,
      createdAt: new Date("2026-04-23T01:00:00.000Z"),
      updatedAt: new Date("2026-04-23T07:00:00.000Z"),
      estimatedCostUsd: 0,
      inputTokens: 0,
      outputTokens: 0,
      components: [{
        kind: "app",
        powerIntent: "ON",
        agentIntent: "ON",
        runtimeState: "RUNNING",
        agentState: "IDLE",
        blockers: [],
        lastOutcome: "COMPLETED",
        previewHealth: "HEALTHY",
        provisionedAt: new Date("2026-04-23T06:30:00.000Z"),
        containerName: "preview-desk-garden",
        previewUrl: "https://preview-desk-garden.arena.example.test",
        workerHost: "local",
        lastHeartbeat: new Date("2026-04-23T07:19:40.000Z"),
      }],
      budget: null,
      vpsHost: null,
    }]);

    const overview = await getSystemOverview();

    expect(overview.workers).toEqual([
      expect.objectContaining({
        host: "local",
        parityStatus: "mismatch",
        actionableParityReasons: [
          "worker_sha_mismatch:stale-worker-sha",
          "runner_sha_mismatch:stale-runner-sha",
        ],
      }),
    ]);
    expect(overview.attentionItems).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: "worker_service_generation_drift",
        projectId: null,
        workerHost: "local",
      }),
    ]));
  });
});
