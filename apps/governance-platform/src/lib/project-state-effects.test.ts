import { describe, expect, it, vi } from "vitest";
import {
  applyStateChange,
  prepareRuntimeForFreshClaim,
  resetComponentForFreshStart,
  type PrimaryComponentRow,
} from "./project-state-effects";

function buildRow(overrides: Partial<PrimaryComponentRow> = {}): PrimaryComponentRow {
  return {
    projectId: "project-1",
    componentId: "component-1",
    powerIntent: "ON",
    agentIntent: "ON",
    runtimeState: "RUNNING",
    agentState: "RUNNING",
    blockers: [],
    lastOutcome: null,
    lastOutcomeAt: null,
    retryAt: null,
    previewHealth: "UNKNOWN",
    previewCheckedAt: null,
    provisionedAt: null,
    containerName: "preview-project-1",
    previewUrl: "https://preview.example.com",
    workerHost: "local",
    vpsHostId: null,
    lastHeartbeat: null,
    retryCount: 0,
    archivedAt: null,
    ...overrides,
  };
}

function createDb(row: PrimaryComponentRow) {
  const state = { row };

  const db = {
    project: {
      findUnique: vi.fn(async () => ({
        id: state.row.projectId,
        archivedAt: state.row.archivedAt,
      })),
    },
    projectComponent: {
      findFirst: vi.fn(async () => ({
        id: state.row.componentId,
        powerIntent: state.row.powerIntent,
        agentIntent: state.row.agentIntent,
        runtimeState: state.row.runtimeState,
        agentState: state.row.agentState,
        blockers: state.row.blockers,
        lastOutcome: state.row.lastOutcome,
        lastOutcomeAt: state.row.lastOutcomeAt,
        retryAt: state.row.retryAt,
        previewHealth: state.row.previewHealth,
        previewCheckedAt: state.row.previewCheckedAt,
        provisionedAt: state.row.provisionedAt,
        containerName: state.row.containerName,
        previewUrl: state.row.previewUrl,
        workerHost: state.row.workerHost,
        vpsHostId: state.row.vpsHostId,
        lastHeartbeat: state.row.lastHeartbeat,
        retryCount: state.row.retryCount,
      })),
      update: vi.fn(async ({ data }: { data: Partial<PrimaryComponentRow> }) => {
        state.row = {
          ...state.row,
          ...(data as Partial<PrimaryComponentRow>),
        };
        return {};
      }),
    },
    runLog: {
      create: vi.fn(async () => ({})),
    },
    runtimeIntent: {
      deleteMany: vi.fn(async () => ({ count: 0 })),
    },
  };

  return { db, state };
}

function createDbWithoutAppComponent() {
  return {
    project: {
      findUnique: vi.fn(async () => ({
        id: "project-1",
        archivedAt: null,
      })),
    },
    projectComponent: {
      findFirst: vi.fn(async () => null),
      update: vi.fn(async () => ({})),
    },
    runLog: {
      create: vi.fn(async () => ({})),
    },
  };
}

describe("applyStateChange", () => {
  it("allows power OFF after agentIntent is already OFF even if runner is still shutting down", async () => {
    const { db } = createDb(buildRow({ agentIntent: "OFF" }));

    await expect(applyStateChange(
      db as never,
      "project-1",
      { type: "power", intent: "OFF" },
      { source: "admin", trigger: "power_off" },
    )).resolves.toMatchObject({
      powerIntent: "OFF",
      agentIntent: "OFF",
    });
  });

  it("still rejects power OFF while agent is RUNNING and agentIntent remains ON", async () => {
    const { db } = createDb(buildRow({ agentIntent: "ON" }));

    await expect(applyStateChange(
      db as never,
      "project-1",
      { type: "power", intent: "OFF" },
      { source: "admin", trigger: "power_off" },
    )).rejects.toThrow("Cannot turn off project project-1: agent is RUNNING");
  });

  it("clears retry baggage for parked OFF rows when runtime is already ABSENT", async () => {
    const { db } = createDb(buildRow({
      powerIntent: "OFF",
      agentIntent: "OFF",
      runtimeState: "STOPPED",
      agentState: "IDLE",
      blockers: [],
      retryAt: new Date("2026-04-17T10:00:00.000Z"),
      provisionedAt: new Date("2026-04-17T09:00:00.000Z"),
    }));

    await expect(applyStateChange(
      db as never,
      "project-1",
      { type: "runtimeObserved", state: "ABSENT" },
      { source: "worker", trigger: "runtime_absent" },
    )).resolves.toMatchObject({
      powerIntent: "OFF",
      agentIntent: "OFF",
      runtimeState: "ABSENT",
      agentState: "IDLE",
      blockers: [],
      retryAt: null,
      provisionedAt: null,
    });
  });

  it("normalizes powered-off failed rows back to IDLE while preserving failure history", async () => {
    const { db } = createDb(buildRow({
      powerIntent: "OFF",
      agentIntent: "OFF",
      runtimeState: "STOPPED",
      agentState: "FAILED",
      blockers: [],
      lastOutcome: "FAILED",
      lastOutcomeAt: new Date("2026-04-21T10:00:00.000Z"),
    }));

    await expect(applyStateChange(
      db as never,
      "project-1",
      { type: "runtimeObserved", state: "ABSENT" },
      { source: "worker", trigger: "runtime_absent" },
    )).resolves.toMatchObject({
      powerIntent: "OFF",
      agentIntent: "OFF",
      runtimeState: "ABSENT",
      agentState: "IDLE",
      blockers: [],
      lastOutcome: "FAILED",
    });
  });

  it("normalizes legacy powered-off paused rows back to IDLE without clearing blockers", async () => {
    const { db } = createDb(buildRow({
      powerIntent: "OFF",
      agentIntent: "OFF",
      runtimeState: "STOPPED",
      agentState: "PAUSED" as never,
      blockers: ["BUDGET"],
      retryAt: new Date("2026-04-21T10:05:00.000Z"),
      provisionedAt: new Date("2026-04-21T10:06:00.000Z"),
    }));

    await expect(applyStateChange(
      db as never,
      "project-1",
      { type: "runtimeObserved", state: "ABSENT" },
      { source: "worker", trigger: "runtime_absent" },
    )).resolves.toMatchObject({
      powerIntent: "OFF",
      agentIntent: "OFF",
      runtimeState: "ABSENT",
      agentState: "IDLE",
      blockers: ["BUDGET"],
      retryAt: new Date("2026-04-21T10:05:00.000Z"),
      provisionedAt: new Date("2026-04-21T10:06:00.000Z"),
    });
  });

  it("removing the last blocker keeps the row in IDLE without extra pause normalization", async () => {
    const { db } = createDb(buildRow({
      powerIntent: "ON",
      agentIntent: "ON",
      runtimeState: "RUNNING",
      agentState: "IDLE",
      blockers: ["INFRA"],
      retryAt: new Date("2026-04-19T09:00:00.000Z"),
    }));

    await expect(applyStateChange(
      db as never,
      "project-1",
      { type: "removeBlocker", blocker: "INFRA" },
      { source: "system", trigger: "clear_infra" },
    )).resolves.toMatchObject({
      powerIntent: "ON",
      agentIntent: "ON",
      runtimeState: "RUNNING",
      agentState: "IDLE",
      blockers: [],
      retryAt: new Date("2026-04-19T09:00:00.000Z"),
    });
  });

  it("does not fall back to a non-app first component when the app component is missing", async () => {
    const db = createDbWithoutAppComponent();

    await expect(applyStateChange(
      db as never,
      "project-1",
      { type: "power", intent: "OFF" },
      { source: "admin", trigger: "power_off" },
    )).rejects.toThrow("Primary app component not found for project project-1");
  });

  it("records resetOutcome RunLog after state as null instead of the old terminal outcome", async () => {
    const { db } = createDb(buildRow({
      agentState: "IDLE",
      lastOutcome: "COMPLETED",
      lastOutcomeAt: new Date("2026-05-28T11:41:17.000Z"),
    }));

    await expect(applyStateChange(
      db as never,
      "project-1",
      { type: "resetOutcome" },
      { source: "system", trigger: "runtime_intent_agent_run_reset_outcome" },
    )).resolves.toMatchObject({
      lastOutcome: null,
      lastOutcomeAt: null,
    });

    expect(db.runLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        projectId: "project-1",
        event: "RUNTIME_INTENT_AGENT_RUN_RESET_OUTCOME",
      }),
    });
    const detail = JSON.parse(
      vi.mocked(db.runLog.create).mock.calls[0]![0].data.detail,
    );
    expect(detail.before.lastOutcome).toBe("COMPLETED");
    expect(detail.after.lastOutcome).toBeNull();
  });

  it("records optional diagnostics in RunLog detail", async () => {
    const { db } = createDb(buildRow());

    await expect(applyStateChange(
      db as never,
      "project-1",
      { type: "agentTransition", state: "IDLE" },
      {
        source: "runner",
        trigger: "terminal_pause",
        reason: "resource killed",
        diagnostics: {
          terminalForensics: {
            exitCode: 137,
            signal: "SIGKILL",
          },
        },
      },
    )).resolves.toMatchObject({
      agentState: "IDLE",
    });

    const detail = JSON.parse(
      vi.mocked(db.runLog.create).mock.calls[0]![0].data.detail,
    );
    expect(detail.diagnostics).toEqual({
      terminalForensics: {
        exitCode: 137,
        signal: "SIGKILL",
      },
    });
  });

  it("updates runner heartbeat metadata without writing no-op RunLog rows", async () => {
    const heartbeat = new Date("2026-05-23T00:51:08.000Z");
    const { db, state } = createDb(buildRow({
      lastHeartbeat: new Date("2026-05-23T00:51:03.000Z"),
    }));

    await expect(applyStateChange(
      db as never,
      "project-1",
      { type: "metadata", fields: { lastHeartbeat: heartbeat } },
      { source: "runner", trigger: "heartbeat" },
    )).resolves.toMatchObject({
      lastHeartbeat: heartbeat,
    });

    expect(state.row.lastHeartbeat).toEqual(heartbeat);
    expect(db.projectComponent.update).toHaveBeenCalledWith({
      where: { id: "component-1" },
      data: { lastHeartbeat: heartbeat },
    });
    expect(db.runLog.create).not.toHaveBeenCalled();
  });

  it("still writes RunLog for progress heartbeat metadata with semantic preview changes", async () => {
    const heartbeat = new Date("2026-05-23T00:51:08.000Z");
    const checkedAt = new Date("2026-05-23T00:51:08.000Z");
    const { db } = createDb(buildRow({
      previewHealth: "UNKNOWN",
      previewCheckedAt: null,
      lastHeartbeat: new Date("2026-05-23T00:51:03.000Z"),
    }));

    await expect(applyStateChange(
      db as never,
      "project-1",
      {
        type: "metadata",
        fields: {
          lastHeartbeat: heartbeat,
          previewHealth: "HEALTHY",
          previewCheckedAt: checkedAt,
        },
      },
      { source: "runner", trigger: "progress_heartbeat" },
    )).resolves.toMatchObject({
      previewHealth: "HEALTHY",
      previewCheckedAt: checkedAt,
      lastHeartbeat: heartbeat,
    });

    expect(db.runLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        projectId: "project-1",
        event: "PROGRESS_HEARTBEAT",
      }),
    });
  });

  it("normalizes a stale runtime tuple into a fresh-start shape", async () => {
    const { db } = createDb(buildRow({
      runtimeState: "RUNNING",
      agentState: "RUNNING",
      lastOutcome: "FAILED",
      lastOutcomeAt: new Date("2026-04-19T08:00:00.000Z"),
      previewHealth: "HEALTHY",
      previewCheckedAt: new Date("2026-04-19T08:05:00.000Z"),
      containerName: "preview-project-1",
      previewUrl: "https://preview.example.com",
      workerHost: "local",
      lastHeartbeat: new Date("2026-04-19T08:10:00.000Z"),
      retryCount: 4,
      retryAt: new Date("2026-04-19T08:15:00.000Z"),
      provisionedAt: new Date("2026-04-19T08:20:00.000Z"),
    }));

    await expect(resetComponentForFreshStart(
      db as never,
      "project-1",
      { source: "system", trigger: "fresh_start_reset" },
      { metadataOverrides: { provisionedAt: null } },
    )).resolves.toMatchObject({
      runtimeState: "ABSENT",
      agentState: "IDLE",
      lastOutcome: null,
      previewHealth: "UNKNOWN",
      previewCheckedAt: null,
      containerName: null,
      previewUrl: null,
      workerHost: null,
      lastHeartbeat: null,
      retryCount: 0,
      retryAt: null,
      provisionedAt: null,
    });
  });

  it("preserves retry scheduling when a retryable blocker survives fresh-start reset", async () => {
    const retryAt = new Date("2026-04-19T08:15:00.000Z");
    const { db } = createDb(buildRow({
      runtimeState: "RUNNING",
      agentState: "IDLE",
      blockers: ["RATE_LIMIT"],
      retryCount: 3,
      retryAt,
      containerName: "preview-project-1",
      previewUrl: "https://preview.example.com",
      workerHost: "local",
      lastHeartbeat: new Date("2026-04-19T08:10:00.000Z"),
    }));

    await expect(resetComponentForFreshStart(
      db as never,
      "project-1",
      { source: "system", trigger: "fresh_start_reset" },
      { metadataOverrides: { provisionedAt: null } },
    )).resolves.toMatchObject({
      runtimeState: "ABSENT",
      agentState: "IDLE",
      blockers: ["RATE_LIMIT"],
      previewHealth: "UNKNOWN",
      previewCheckedAt: null,
      containerName: null,
      previewUrl: null,
      workerHost: null,
      lastHeartbeat: null,
      retryCount: 3,
      retryAt,
      provisionedAt: null,
    });
  });

  it("prepares runtime for a fresh claim by clearing failed start history and INFRA baggage", async () => {
    const { db } = createDb(buildRow({
      runtimeState: "ABSENT",
      agentState: "IDLE",
      blockers: ["INFRA"],
      lastOutcome: "FAILED",
      lastOutcomeAt: new Date("2026-04-19T08:00:00.000Z"),
      containerName: "preview-project-1",
      previewUrl: "https://preview.example.com",
      workerHost: "local",
      retryCount: 2,
      retryAt: new Date("2026-04-19T08:10:00.000Z"),
      provisionedAt: new Date("2026-04-19T08:20:00.000Z"),
    }));
    vi.mocked(db.runtimeIntent.deleteMany).mockResolvedValue({ count: 1 });

    await expect(prepareRuntimeForFreshClaim(
      db as never,
      "project-1",
      { source: "admin", trigger: "fresh_claim_prepare" },
      { provisionedAt: null },
    )).resolves.toMatchObject({
      clearedStartIntentHistory: true,
      clearedInfraBlocker: true,
      row: {
        runtimeState: "ABSENT",
        agentState: "IDLE",
        blockers: [],
        lastOutcome: null,
        containerName: null,
        previewUrl: null,
        workerHost: null,
        retryCount: 0,
        retryAt: null,
        provisionedAt: null,
      },
    });

    expect(db.runtimeIntent.deleteMany).toHaveBeenCalledWith({
      where: {
        componentId: "component-1",
        action: "ensure_running",
        state: { in: ["FAILED", "ABANDONED"] },
      },
    });
  });

  it("preserves retry timing when preparing a fresh claim for a paused retryable blocker", async () => {
    const retryAt = new Date("2026-04-19T08:10:00.000Z");
    const { db } = createDb(buildRow({
      runtimeState: "ABSENT",
      agentState: "IDLE",
      blockers: ["RATE_LIMIT"],
      lastOutcome: null,
      retryCount: 2,
      retryAt,
      provisionedAt: new Date("2026-04-19T08:20:00.000Z"),
    }));

    await expect(prepareRuntimeForFreshClaim(
      db as never,
      "project-1",
      { source: "admin", trigger: "fresh_claim_prepare" },
      { provisionedAt: null },
    )).resolves.toMatchObject({
      clearedStartIntentHistory: false,
      clearedInfraBlocker: false,
      row: {
        runtimeState: "ABSENT",
        agentState: "IDLE",
        blockers: ["RATE_LIMIT"],
        lastOutcome: null,
        containerName: null,
        previewUrl: null,
        workerHost: null,
        retryCount: 2,
        retryAt,
        provisionedAt: null,
      },
    });
  });

  it("preserves completed outcome when preparing a fresh claim for runtime maintenance", async () => {
    const completedAt = new Date("2026-04-19T08:00:00.000Z");
    const { db } = createDb(buildRow({
      runtimeState: "RUNNING",
      agentState: "IDLE",
      blockers: [],
      lastOutcome: "COMPLETED",
      lastOutcomeAt: completedAt,
      containerName: "preview-project-1",
      previewUrl: "https://preview.example.com",
      workerHost: "local",
      provisionedAt: new Date("2026-04-19T08:20:00.000Z"),
    }));

    await expect(prepareRuntimeForFreshClaim(
      db as never,
      "project-1",
      { source: "system", trigger: "recreate_runtime" },
      { provisionedAt: null, preserveOutcome: true },
    )).resolves.toMatchObject({
      row: {
        runtimeState: "ABSENT",
        agentState: "IDLE",
        blockers: [],
        lastOutcome: "COMPLETED",
        lastOutcomeAt: completedAt,
        containerName: null,
        previewUrl: null,
        workerHost: null,
        provisionedAt: null,
      },
    });
  });
});
