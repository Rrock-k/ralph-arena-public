import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PrimaryComponentRow } from "@/lib/project-state-effects";
import { POST } from "./route";

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/prisma", () => {
  const prisma: any = {
    $transaction: vi.fn(),
    runtimeIntent: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    project: {
      update: vi.fn(),
    },
  };
  return { prisma };
});

vi.mock("@/lib/internal-auth", () => ({
  isWorkerAuthorized: vi.fn(),
}));

vi.mock("@/lib/log-writer", () => ({
  appendLifecycle: vi.fn(),
}));

vi.mock("@/lib/progress-bus", () => ({
  notifyProjectChanged: vi.fn(),
}));

vi.mock("@/lib/project-state-effects", () => ({
  requirePrimaryComponentRow: vi.fn(),
  applyStateChange: vi.fn(),
  updateComponentMetadata: vi.fn(),
}));

import { prisma } from "@/lib/prisma";
import { isWorkerAuthorized } from "@/lib/internal-auth";
import { appendLifecycle } from "@/lib/log-writer";
import { revalidatePath } from "next/cache";
import { notifyProjectChanged } from "@/lib/progress-bus";
import { applyStateChange, requirePrimaryComponentRow, updateComponentMetadata } from "@/lib/project-state-effects";

function makeRow(overrides: Partial<PrimaryComponentRow> = {}): PrimaryComponentRow {
  return {
    projectId: "project-1",
    componentId: "component-1",
    powerIntent: "ON",
    agentIntent: "ON",
    runtimeState: "ABSENT",
    agentState: "IDLE",
    blockers: [],
    lastOutcome: "COMPLETED",
    lastOutcomeAt: null,
    retryAt: null,
    previewHealth: "UNKNOWN",
    previewCheckedAt: null,
    provisionedAt: null,
    containerName: "preview-ant-dream-hea20y",
    previewUrl: null,
    workerHost: "local",
    vpsHostId: null,
    lastHeartbeat: null,
    retryCount: 0,
    archivedAt: null,
    ...overrides,
  };
}

describe("POST /api/internal/runtime-intents/:id/complete", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isWorkerAuthorized).mockReturnValue(true);
    vi.mocked(prisma.$transaction as any).mockImplementation(
      async (callback: (tx: typeof prisma) => Promise<unknown>) => callback(prisma as any),
    );
    vi.mocked(prisma.runtimeIntent.findUnique as any).mockResolvedValue({
      id: "intent-1",
      projectId: "project-1",
      componentId: "component-1",
      host: "local",
      action: "ensure_running",
      runnerMode: "preview_only",
      state: "CLAIMED",
      attempt: 1,
    });
    vi.mocked(prisma.runtimeIntent.update as any).mockResolvedValue({});
    vi.mocked(prisma.project.update as any).mockResolvedValue({});
    vi.mocked(requirePrimaryComponentRow as any).mockResolvedValue(makeRow());
    vi.mocked(applyStateChange as any).mockResolvedValue({});
    vi.mocked(updateComponentMetadata as any).mockResolvedValue({});
    vi.mocked(appendLifecycle as any).mockResolvedValue(undefined);
    vi.mocked(revalidatePath).mockReset();
    vi.mocked(notifyProjectChanged).mockReset();
  });

  it("rejects unauthorized workers", async () => {
    vi.mocked(isWorkerAuthorized).mockReturnValue(false);

    const res = await POST(
      new Request("http://localhost/api/internal/runtime-intents/intent-1/complete", {
        method: "POST",
        body: JSON.stringify({ ok: true, actualRuntime: "RUNNING" }),
      }),
      { params: Promise.resolve({ id: "intent-1" }) },
    );

    expect(res.status).toBe(401);
  });

  it("marks runtime running on success", async () => {
    vi.mocked(requirePrimaryComponentRow as any)
      .mockResolvedValueOnce(makeRow({ runtimeState: "ABSENT", agentIntent: "ON" }))
      .mockResolvedValueOnce(makeRow({ runtimeState: "RUNNING", agentIntent: "ON" }));

    const res = await POST(
      new Request("http://localhost/api/internal/runtime-intents/intent-1/complete", {
        method: "POST",
        body: JSON.stringify({
          ok: true,
          actualRuntime: "RUNNING",
          containerName: "preview-ant-dream-hea20y",
          previewUrl: "https://preview.test",
        }),
      }),
      { params: Promise.resolve({ id: "intent-1" }) },
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true });
    expect(applyStateChange).toHaveBeenCalledTimes(1);
    expect(applyStateChange).toHaveBeenCalledWith(
      prisma,
      "project-1",
      { type: "runtimeObserved", state: "RUNNING" },
      { source: "worker", trigger: "runtime_intent_running" },
    );
    expect(updateComponentMetadata).toHaveBeenCalledWith(
      prisma,
      "project-1",
      expect.objectContaining({
        previewHealth: "HEALTHY",
        containerName: "preview-ant-dream-hea20y",
        previewUrl: "https://preview.test",
        workerHost: "local",
      }),
      { source: "worker", trigger: "runtime_intent_running" },
    );
    expect(prisma.project.update).not.toHaveBeenCalled();
    expect(prisma.runtimeIntent.update).toHaveBeenCalledWith({
      where: { id: "intent-1" },
      data: {
        state: "SUCCEEDED",
        lockedUntil: null,
        error: null,
      },
    });
    expect(revalidatePath).toHaveBeenCalledWith("/admin");
    expect(notifyProjectChanged).toHaveBeenCalledWith("project-1");
    expect(appendLifecycle).toHaveBeenCalledWith("project-1", "RUNTIME_RECONCILED");
  });

  it("normalizes stale RUNNING agent state to IDLE on preview-only restore", async () => {
    vi.mocked(requirePrimaryComponentRow as any)
      .mockResolvedValueOnce(makeRow({
        runtimeState: "RUNNING",
        agentState: "RUNNING",
        agentIntent: "ON",
        lastOutcome: "FAILED",
      }))
      .mockResolvedValueOnce(makeRow({
        runtimeState: "RUNNING",
        agentState: "RUNNING",
        agentIntent: "ON",
        lastOutcome: "FAILED",
      }));

    const res = await POST(
      new Request("http://localhost/api/internal/runtime-intents/intent-1/complete", {
        method: "POST",
        body: JSON.stringify({
          ok: true,
          actualRuntime: "RUNNING",
          containerName: "preview-ant-dream-hea20y",
          previewUrl: "https://preview.test",
        }),
      }),
      { params: Promise.resolve({ id: "intent-1" }) },
    );

    expect(res.status).toBe(200);
    expect(applyStateChange).toHaveBeenCalledTimes(1);
    expect(applyStateChange).toHaveBeenCalledWith(
      prisma,
      "project-1",
      { type: "agentTransition", state: "IDLE" },
      { source: "worker", trigger: "runtime_intent_running" },
    );
    expect(updateComponentMetadata).toHaveBeenCalledWith(
      prisma,
      "project-1",
      expect.objectContaining({
        previewHealth: "HEALTHY",
        containerName: "preview-ant-dream-hea20y",
        previewUrl: "https://preview.test",
      }),
      { source: "worker", trigger: "runtime_intent_running" },
    );
  });

  it("keeps preview health unknown for agent_run starts until the runner serves the app", async () => {
    vi.mocked(prisma.runtimeIntent.findUnique as any).mockResolvedValue({
      id: "intent-1",
      projectId: "project-1",
      componentId: "component-1",
      host: "local",
      action: "ensure_running",
      runnerMode: "agent_run",
      state: "CLAIMED",
      attempt: 1,
    });
    vi.mocked(requirePrimaryComponentRow as any)
      .mockResolvedValueOnce(makeRow({ runtimeState: "ABSENT", agentIntent: "ON" }))
      .mockResolvedValueOnce(makeRow({ runtimeState: "RUNNING", agentIntent: "ON" }))
      .mockResolvedValueOnce(makeRow({ runtimeState: "RUNNING", agentIntent: "ON" }));

    const res = await POST(
      new Request("http://localhost/api/internal/runtime-intents/intent-1/complete", {
        method: "POST",
        body: JSON.stringify({
          ok: true,
          actualRuntime: "RUNNING",
          containerName: "preview-ant-dream-hea20y",
          previewUrl: "https://preview.test",
        }),
      }),
      { params: Promise.resolve({ id: "intent-1" }) },
    );

    expect(res.status).toBe(200);
    expect(updateComponentMetadata).toHaveBeenCalledWith(
      prisma,
      "project-1",
      expect.objectContaining({
        previewHealth: "UNKNOWN",
        previewCheckedAt: null,
        containerName: "preview-ant-dream-hea20y",
        previewUrl: "https://preview.test",
      }),
      { source: "worker", trigger: "runtime_intent_running" },
    );
  });

  it("clears stale completed outcome before agent_run startup", async () => {
    vi.mocked(prisma.runtimeIntent.findUnique as any).mockResolvedValue({
      id: "intent-1",
      projectId: "project-1",
      componentId: "component-1",
      host: "local",
      action: "ensure_running",
      runnerMode: "agent_run",
      state: "CLAIMED",
      attempt: 1,
    });
    vi.mocked(requirePrimaryComponentRow as any)
      .mockResolvedValueOnce(makeRow({
        runtimeState: "ABSENT",
        lastOutcome: "COMPLETED",
        lastOutcomeAt: new Date("2026-04-17T10:00:00.000Z"),
      }))
      .mockResolvedValueOnce(makeRow({
        runtimeState: "ABSENT",
        lastOutcome: null,
        lastOutcomeAt: null,
      }))
      .mockResolvedValueOnce(makeRow({
        runtimeState: "RUNNING",
        lastOutcome: null,
        lastOutcomeAt: null,
      }));

    const res = await POST(
      new Request("http://localhost/api/internal/runtime-intents/intent-1/complete", {
        method: "POST",
        body: JSON.stringify({
          ok: true,
          actualRuntime: "RUNNING",
          containerName: "preview-ant-dream-hea20y",
          previewUrl: "https://preview.test",
        }),
      }),
      { params: Promise.resolve({ id: "intent-1" }) },
    );

    expect(res.status).toBe(200);
    expect(applyStateChange).toHaveBeenNthCalledWith(
      1,
      prisma,
      "project-1",
      { type: "resetOutcome" },
      { source: "system", trigger: "runtime_intent_agent_run_reset_outcome" },
    );
    expect(applyStateChange).toHaveBeenNthCalledWith(
      2,
      prisma,
      "project-1",
      { type: "runtimeObserved", state: "RUNNING" },
      { source: "worker", trigger: "runtime_intent_running" },
    );
    expect(applyStateChange).toHaveBeenNthCalledWith(
      3,
      prisma,
      "project-1",
      { type: "agentTransition", state: "RUNNING" },
      { source: "worker", trigger: "runtime_intent_running_agent_run" },
    );
    expect(prisma.project.update).not.toHaveBeenCalled();
  });

  it("clears stale INFRA after successful preview-only restore", async () => {
    vi.mocked(requirePrimaryComponentRow as any)
      .mockResolvedValueOnce(makeRow({
        runtimeState: "ABSENT",
        agentIntent: "OFF",
        blockers: ["INFRA"],
        retryCount: 3,
        retryAt: new Date("2026-04-17T10:00:00.000Z"),
      }))
      .mockResolvedValueOnce(makeRow({
        runtimeState: "RUNNING",
        agentIntent: "OFF",
        blockers: ["INFRA"],
        retryCount: 3,
        retryAt: new Date("2026-04-17T10:00:00.000Z"),
      }))
      .mockResolvedValueOnce(makeRow({
        runtimeState: "RUNNING",
        agentIntent: "OFF",
        blockers: [],
        retryCount: 3,
        retryAt: new Date("2026-04-17T10:00:00.000Z"),
      }));

    const res = await POST(
      new Request("http://localhost/api/internal/runtime-intents/intent-1/complete", {
        method: "POST",
        body: JSON.stringify({
          ok: true,
          actualRuntime: "RUNNING",
          containerName: "preview-ant-dream-hea20y",
          previewUrl: "https://preview.test",
        }),
      }),
      { params: Promise.resolve({ id: "intent-1" }) },
    );

    expect(res.status).toBe(200);
    expect(applyStateChange).toHaveBeenNthCalledWith(
      1,
      prisma,
      "project-1",
      { type: "runtimeObserved", state: "RUNNING" },
      { source: "worker", trigger: "runtime_intent_running" },
    );
    expect(applyStateChange).toHaveBeenNthCalledWith(
      2,
      prisma,
      "project-1",
      { type: "removeBlocker", blocker: "INFRA" },
      { source: "system", trigger: "runtime_intent_running_clear_infra" },
    );
    expect(updateComponentMetadata).toHaveBeenCalledWith(
      prisma,
      "project-1",
      expect.objectContaining({
        previewHealth: "HEALTHY",
        retryAt: null,
        retryCount: 0,
      }),
      { source: "worker", trigger: "runtime_intent_running" },
    );
  });

  it("preserves retry schedule for remaining RATE_LIMIT when preview restore clears stale INFRA", async () => {
    const retryAt = new Date("2026-04-17T22:00:00.000Z");
    vi.mocked(requirePrimaryComponentRow as any)
      .mockResolvedValueOnce(makeRow({
        runtimeState: "ABSENT",
        agentIntent: "OFF",
        blockers: ["RATE_LIMIT", "INFRA"],
        retryCount: 3,
        retryAt,
      }))
      .mockResolvedValueOnce(makeRow({
        runtimeState: "RUNNING",
        agentIntent: "OFF",
        blockers: ["RATE_LIMIT", "INFRA"],
        retryCount: 3,
        retryAt,
      }))
      .mockResolvedValueOnce(makeRow({
        runtimeState: "RUNNING",
        agentIntent: "OFF",
        blockers: ["RATE_LIMIT"],
        retryCount: 3,
        retryAt,
      }));

    const res = await POST(
      new Request("http://localhost/api/internal/runtime-intents/intent-1/complete", {
        method: "POST",
        body: JSON.stringify({
          ok: true,
          actualRuntime: "RUNNING",
          containerName: "preview-ant-dream-hea20y",
          previewUrl: "https://preview.test",
        }),
      }),
      { params: Promise.resolve({ id: "intent-1" }) },
    );

    expect(res.status).toBe(200);
    expect(applyStateChange).toHaveBeenNthCalledWith(
      1,
      prisma,
      "project-1",
      { type: "runtimeObserved", state: "RUNNING" },
      { source: "worker", trigger: "runtime_intent_running" },
    );
    expect(applyStateChange).toHaveBeenNthCalledWith(
      2,
      prisma,
      "project-1",
      { type: "removeBlocker", blocker: "INFRA" },
      { source: "system", trigger: "runtime_intent_running_clear_infra" },
    );
    const metadata = vi.mocked(updateComponentMetadata).mock.calls.at(-1)?.[2] as Record<string, unknown>;
    expect(metadata).toEqual(expect.objectContaining({
      previewHealth: "HEALTHY",
      containerName: "preview-ant-dream-hea20y",
      previewUrl: "https://preview.test",
      workerHost: "local",
    }));
    expect(metadata).not.toHaveProperty("retryAt");
    expect(metadata).not.toHaveProperty("retryCount");
  });

  it("clears stale INFRA on preview-only restore without a second pause plane", async () => {
    vi.mocked(requirePrimaryComponentRow as any)
      .mockResolvedValueOnce(makeRow({
        runtimeState: "ABSENT",
        agentIntent: "OFF",
        agentState: "IDLE",
        blockers: ["INFRA"],
      }))
      .mockResolvedValueOnce(makeRow({
        runtimeState: "RUNNING",
        agentIntent: "OFF",
        agentState: "IDLE",
        blockers: ["INFRA"],
      }))
      .mockResolvedValueOnce(makeRow({
        runtimeState: "RUNNING",
        agentIntent: "OFF",
        agentState: "IDLE",
        blockers: [],
      }));

    const res = await POST(
      new Request("http://localhost/api/internal/runtime-intents/intent-1/complete", {
        method: "POST",
        body: JSON.stringify({
          ok: true,
          actualRuntime: "RUNNING",
          containerName: "preview-ant-dream-hea20y",
          previewUrl: "https://preview.test",
        }),
      }),
      { params: Promise.resolve({ id: "intent-1" }) },
    );

    expect(res.status).toBe(200);
    expect(applyStateChange).toHaveBeenNthCalledWith(
      1,
      prisma,
      "project-1",
      { type: "runtimeObserved", state: "RUNNING" },
      { source: "worker", trigger: "runtime_intent_running" },
    );
    expect(applyStateChange).toHaveBeenNthCalledWith(
      2,
      prisma,
      "project-1",
      { type: "removeBlocker", blocker: "INFRA" },
      { source: "system", trigger: "runtime_intent_running_clear_infra" },
    );
  });

  it("does not invent extra preview-only idle normalization once INFRA is already clear", async () => {
    vi.mocked(requirePrimaryComponentRow as any)
      .mockReset()
      .mockResolvedValueOnce(makeRow({
        runtimeState: "ABSENT",
        agentIntent: "OFF",
        agentState: "IDLE",
        blockers: [],
        lastOutcome: "FAILED",
      }))
      .mockResolvedValueOnce(makeRow({
        runtimeState: "RUNNING",
        agentIntent: "OFF",
        agentState: "IDLE",
        blockers: [],
        lastOutcome: "FAILED",
      }));

    const res = await POST(
      new Request("http://localhost/api/internal/runtime-intents/intent-1/complete", {
        method: "POST",
        body: JSON.stringify({
          ok: true,
          actualRuntime: "RUNNING",
          containerName: "preview-ant-dream-hea20y",
          previewUrl: "https://preview.test",
        }),
      }),
      { params: Promise.resolve({ id: "intent-1" }) },
    );

    expect(res.status).toBe(200);
    expect(applyStateChange).toHaveBeenCalledTimes(1);
    expect(applyStateChange).toHaveBeenNthCalledWith(
      1,
      prisma,
      "project-1",
      { type: "runtimeObserved", state: "RUNNING" },
      { source: "worker", trigger: "runtime_intent_running" },
    );
  });

  it("normalizes blocked agent-run restore back to running once stale INFRA is cleared", async () => {
    vi.mocked(prisma.runtimeIntent.findUnique as any).mockResolvedValue({
      id: "intent-1",
      projectId: "project-1",
      componentId: "component-1",
      host: "local",
      action: "ensure_running",
      runnerMode: "agent_run",
      state: "CLAIMED",
      attempt: 1,
    });
    vi.mocked(requirePrimaryComponentRow as any)
      .mockReset()
      .mockResolvedValueOnce(makeRow({
        runtimeState: "ABSENT",
        agentIntent: "ON",
        agentState: "IDLE",
        blockers: ["INFRA"],
        lastOutcome: null,
      }))
      .mockResolvedValueOnce(makeRow({
        runtimeState: "RUNNING",
        agentIntent: "ON",
        agentState: "IDLE",
        blockers: ["INFRA"],
        lastOutcome: null,
      }))
      .mockResolvedValueOnce(makeRow({
        runtimeState: "RUNNING",
        agentIntent: "ON",
        agentState: "IDLE",
        blockers: [],
        lastOutcome: null,
      }))
      .mockResolvedValueOnce(makeRow({
        runtimeState: "RUNNING",
        agentIntent: "ON",
        agentState: "IDLE",
        blockers: [],
        lastOutcome: null,
      }));

    const res = await POST(
      new Request("http://localhost/api/internal/runtime-intents/intent-1/complete", {
        method: "POST",
        body: JSON.stringify({
          ok: true,
          actualRuntime: "RUNNING",
          containerName: "preview-ant-dream-hea20y",
          previewUrl: "https://preview.test",
        }),
      }),
      { params: Promise.resolve({ id: "intent-1" }) },
    );

    expect(res.status).toBe(200);
    expect(applyStateChange).toHaveBeenNthCalledWith(
      1,
      prisma,
      "project-1",
      { type: "runtimeObserved", state: "RUNNING" },
      { source: "worker", trigger: "runtime_intent_running" },
    );
    expect(applyStateChange).toHaveBeenNthCalledWith(
      2,
      prisma,
      "project-1",
      { type: "removeBlocker", blocker: "INFRA" },
      { source: "system", trigger: "runtime_intent_running_clear_infra" },
    );
    expect(applyStateChange).toHaveBeenNthCalledWith(
      3,
      prisma,
      "project-1",
      { type: "agentTransition", state: "RUNNING" },
      { source: "worker", trigger: "runtime_intent_running_agent_run" },
    );
  });

  it("records retryable failure with backoff", async () => {
    vi.mocked(requirePrimaryComponentRow as any).mockResolvedValue(makeRow({ runtimeState: "RUNNING" }));

    const res = await POST(
      new Request("http://localhost/api/internal/runtime-intents/intent-1/complete", {
        method: "POST",
        body: JSON.stringify({
          ok: false,
          error: "docker unavailable",
        }),
      }),
      { params: Promise.resolve({ id: "intent-1" }) },
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true, retryScheduled: true });
    expect(applyStateChange).toHaveBeenNthCalledWith(
      1,
      prisma,
      "project-1",
      { type: "runtimeObserved", state: "ABSENT" },
      { source: "worker", trigger: "runtime_intent_error", reason: "docker unavailable" },
    );
    expect(applyStateChange).toHaveBeenNthCalledWith(
      2,
      prisma,
      "project-1",
      { type: "addBlocker", blocker: "INFRA" },
      { source: "system", trigger: "runtime_intent_infra_blocked", reason: "docker unavailable" },
    );
    expect(prisma.runtimeIntent.update).toHaveBeenCalledWith({
      where: { id: "intent-1" },
      data: {
        state: "FAILED",
        lockedUntil: null,
        error: "docker unavailable",
      },
    });
    expect(updateComponentMetadata).toHaveBeenNthCalledWith(
      1,
      prisma,
      "project-1",
      {
        previewHealth: "UNHEALTHY",
        previewCheckedAt: expect.any(Date),
      },
      { source: "worker", trigger: "runtime_intent_error" },
    );
    expect(updateComponentMetadata).toHaveBeenNthCalledWith(
      2,
      prisma,
      "project-1",
      {
        retryCount: 1,
        retryAt: expect.any(Date),
      },
      { source: "system", trigger: "runtime_intent_infra_blocked", reason: "docker unavailable" },
    );
    expect(prisma.project.update).not.toHaveBeenCalled();
    expect(appendLifecycle).toHaveBeenCalledWith("project-1", "RUNTIME_RECONCILE_FAILED");
  });

  it("parks non-retryable ensure_running failures without scheduling a retry", async () => {
    vi.mocked(requirePrimaryComponentRow as any).mockResolvedValue(makeRow({ runtimeState: "RUNNING" }));

    const res = await POST(
      new Request("http://localhost/api/internal/runtime-intents/intent-1/complete", {
        method: "POST",
        body: JSON.stringify({
          ok: false,
          error: "image missing",
          retryable: false,
        }),
      }),
      { params: Promise.resolve({ id: "intent-1" }) },
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true, retryScheduled: false });
    expect(prisma.runtimeIntent.update).toHaveBeenCalledWith({
      where: { id: "intent-1" },
      data: {
        state: "ABANDONED",
        lockedUntil: null,
        error: "image missing",
      },
    });
    expect(updateComponentMetadata).toHaveBeenNthCalledWith(
      2,
      prisma,
      "project-1",
      {
        retryCount: 1,
        retryAt: null,
      },
      { source: "system", trigger: "runtime_intent_infra_blocked", reason: "image missing" },
    );
    expect(revalidatePath).toHaveBeenCalledWith("/admin");
    expect(notifyProjectChanged).toHaveBeenCalledWith("project-1");
  });

  it("treats ensure_running failures as superseded once the row is already powered off", async () => {
    vi.mocked(requirePrimaryComponentRow as any).mockResolvedValue(makeRow({
      powerIntent: "OFF",
      agentIntent: "OFF",
      runtimeState: "ABSENT",
      agentState: "IDLE",
      blockers: [],
      previewHealth: "UNHEALTHY",
      retryCount: 1,
      retryAt: new Date("2026-04-23T10:25:41.005Z"),
    }));

    const res = await POST(
      new Request("http://localhost/api/internal/runtime-intents/intent-1/complete", {
        method: "POST",
        body: JSON.stringify({
          ok: false,
          error: "Preview health check failed for preview-project-p9oa9p: fetch failed",
        }),
      }),
      { params: Promise.resolve({ id: "intent-1" }) },
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true, superseded: true });
    expect(applyStateChange).not.toHaveBeenCalledWith(
      prisma,
      "project-1",
      { type: "addBlocker", blocker: "INFRA" },
      expect.anything(),
    );
    expect(updateComponentMetadata).toHaveBeenNthCalledWith(
      1,
      prisma,
      "project-1",
      {
        previewHealth: "UNKNOWN",
        previewCheckedAt: null,
        containerName: null,
        previewUrl: null,
        workerHost: null,
        lastHeartbeat: null,
      },
      { source: "worker", trigger: "runtime_intent_superseded" },
    );
    expect(updateComponentMetadata).toHaveBeenNthCalledWith(
      2,
      prisma,
      "project-1",
      {
        retryAt: null,
        retryCount: 0,
      },
      {
        source: "system",
        trigger: "runtime_intent_superseded_clear_retry",
        reason: "Preview health check failed for preview-project-p9oa9p: fetch failed",
      },
    );
    expect(prisma.runtimeIntent.update).toHaveBeenCalledWith({
      where: { id: "intent-1" },
      data: {
        state: "ABANDONED",
        lockedUntil: null,
        error: "Preview health check failed for preview-project-p9oa9p: fetch failed",
      },
    });
    expect(appendLifecycle).toHaveBeenCalledWith("project-1", "RUNTIME_RECONCILED");
  });

  it("marks runtime stopped on ensure_stopped success", async () => {
    vi.mocked(prisma.runtimeIntent.findUnique as any).mockResolvedValue({
      id: "intent-1",
      projectId: "project-1",
      componentId: "component-1",
      host: "local",
      action: "ensure_stopped",
      runnerMode: "preview_only",
      state: "CLAIMED",
      attempt: 1,
    });
    vi.mocked(requirePrimaryComponentRow as any)
      .mockResolvedValueOnce(makeRow({
        powerIntent: "OFF",
        runtimeState: "RUNNING",
        previewHealth: "HEALTHY",
      }))
      .mockResolvedValueOnce(makeRow({
        powerIntent: "OFF",
        runtimeState: "STOPPED",
        previewHealth: "HEALTHY",
      }));

    const res = await POST(
      new Request("http://localhost/api/internal/runtime-intents/intent-1/complete", {
        method: "POST",
        body: JSON.stringify({ ok: true, actualRuntime: "ABSENT" }),
      }),
      { params: Promise.resolve({ id: "intent-1" }) },
    );

    expect(res.status).toBe(200);
    expect(applyStateChange).toHaveBeenNthCalledWith(
      1,
      prisma,
      "project-1",
      { type: "runtimeObserved", state: "STOPPED" },
      { source: "worker", trigger: "runtime_intent_stopped" },
    );
    expect(applyStateChange).toHaveBeenNthCalledWith(
      2,
      prisma,
      "project-1",
      { type: "runtimeObserved", state: "ABSENT" },
      { source: "worker", trigger: "runtime_intent_stopped" },
    );
    expect(updateComponentMetadata).toHaveBeenCalledWith(
      prisma,
      "project-1",
      {
        previewHealth: "UNKNOWN",
        previewCheckedAt: null,
        containerName: null,
        previewUrl: null,
        workerHost: null,
        lastHeartbeat: null,
      },
      { source: "worker", trigger: "runtime_intent_stopped" },
    );
    expect(prisma.project.update).not.toHaveBeenCalled();
  });

  it("treats idempotent already-stopped ensure_stopped failures as reconciled for older workers", async () => {
    vi.mocked(prisma.runtimeIntent.findUnique as any).mockResolvedValue({
      id: "intent-1",
      projectId: "project-1",
      componentId: "component-1",
      host: "local",
      action: "ensure_stopped",
      runnerMode: "preview_only",
      state: "CLAIMED",
      attempt: 1,
    });
    vi.mocked(requirePrimaryComponentRow as any)
      .mockResolvedValueOnce(makeRow({
        powerIntent: "OFF",
        runtimeState: "RUNNING",
        previewHealth: "HEALTHY",
      }))
      .mockResolvedValueOnce(makeRow({
        powerIntent: "OFF",
        runtimeState: "STOPPED",
        previewHealth: "HEALTHY",
      }));

    const res = await POST(
      new Request("http://localhost/api/internal/runtime-intents/intent-1/complete", {
        method: "POST",
        body: JSON.stringify({
          ok: false,
          error: "(HTTP code 304) container already stopped -  ",
        }),
      }),
      { params: Promise.resolve({ id: "intent-1" }) },
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true });
    expect(applyStateChange).toHaveBeenNthCalledWith(
      1,
      prisma,
      "project-1",
      { type: "runtimeObserved", state: "STOPPED" },
      { source: "worker", trigger: "runtime_intent_stopped" },
    );
    expect(applyStateChange).toHaveBeenNthCalledWith(
      2,
      prisma,
      "project-1",
      { type: "runtimeObserved", state: "ABSENT" },
      { source: "worker", trigger: "runtime_intent_stopped" },
    );
    expect(updateComponentMetadata).toHaveBeenCalledWith(
      prisma,
      "project-1",
      {
        previewHealth: "UNKNOWN",
        previewCheckedAt: null,
        containerName: null,
        previewUrl: null,
        workerHost: null,
        lastHeartbeat: null,
      },
      { source: "worker", trigger: "runtime_intent_stopped" },
    );
    expect(prisma.runtimeIntent.update).toHaveBeenCalledWith({
      where: { id: "intent-1" },
      data: {
        state: "SUCCEEDED",
        lockedUntil: null,
        error: null,
      },
    });
    expect(appendLifecycle).toHaveBeenCalledWith("project-1", "RUNTIME_RECONCILED");
  });

  it("marks runtime removed on ensure_removed success and clears live identity", async () => {
    vi.mocked(prisma.runtimeIntent.findUnique as any).mockResolvedValue({
      id: "intent-1",
      projectId: "project-1",
      componentId: "component-1",
      host: "local",
      action: "ensure_removed",
      runnerMode: "preview_only",
      state: "CLAIMED",
      attempt: 1,
    });
    vi.mocked(requirePrimaryComponentRow as any)
      .mockResolvedValueOnce(makeRow({
        powerIntent: "OFF",
        runtimeState: "RUNNING",
        agentState: null,
        previewUrl: "https://preview.test",
        lastHeartbeat: new Date("2026-04-10T12:00:00.000Z"),
      }))
      .mockResolvedValueOnce(makeRow({
        powerIntent: "OFF",
        runtimeState: "STOPPED",
        agentState: null,
        previewUrl: "https://preview.test",
        lastHeartbeat: new Date("2026-04-10T12:00:00.000Z"),
      }));

    const res = await POST(
      new Request("http://localhost/api/internal/runtime-intents/intent-1/complete", {
        method: "POST",
        body: JSON.stringify({ ok: true, actualRuntime: "ABSENT" }),
      }),
      { params: Promise.resolve({ id: "intent-1" }) },
    );

    expect(res.status).toBe(200);
    expect(applyStateChange).toHaveBeenNthCalledWith(
      1,
      prisma,
      "project-1",
      { type: "runtimeObserved", state: "STOPPED" },
      { source: "worker", trigger: "runtime_intent_removed" },
    );
    expect(applyStateChange).toHaveBeenNthCalledWith(
      2,
      prisma,
      "project-1",
      { type: "runtimeObserved", state: "ABSENT" },
      { source: "worker", trigger: "runtime_intent_removed" },
    );
    expect(updateComponentMetadata).toHaveBeenCalledWith(
      prisma,
      "project-1",
      {
        previewHealth: "UNKNOWN",
        previewCheckedAt: null,
        containerName: null,
        previewUrl: null,
        workerHost: null,
        lastHeartbeat: null,
      },
      { source: "worker", trigger: "runtime_intent_removed" },
    );
    expect(prisma.project.update).not.toHaveBeenCalled();
  });
});
