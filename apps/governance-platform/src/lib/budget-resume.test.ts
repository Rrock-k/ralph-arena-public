import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/project-budget", () => ({
  BUDGET_THRESHOLD_USD: 0.5,
}));

vi.mock("@/lib/project-state-effects", () => ({
  requirePrimaryComponentRow: vi.fn(),
  applyStateChange: vi.fn(),
  resetComponentForFreshStart: vi.fn(),
  updateComponentMetadata: vi.fn(),
}));

import { tryAutoResumePausedRun } from "./budget-resume";
import {
  applyStateChange,
  requirePrimaryComponentRow,
  resetComponentForFreshStart,
} from "@/lib/project-state-effects";

function createTx() {
  return {
    project: {
      findUnique: vi.fn().mockResolvedValue({ runnerBackend: "local" }),
      update: vi.fn().mockResolvedValue({}),
    },
    runLog: {
      create: vi.fn().mockResolvedValue({}),
    },
  };
}

describe("tryAutoResumePausedRun", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("re-queues a budget-paused run into a claimable tuple when no blockers remain", async () => {
    const tx = createTx();
    vi.mocked(requirePrimaryComponentRow as any).mockResolvedValue({
      projectId: "project-1",
      componentId: "cmp-1",
      powerIntent: "ON",
      runtimeState: "RUNNING",
      agentState: "RUNNING",
      blockers: ["BUDGET"],
      lastOutcome: null,
      lastOutcomeAt: null,
      retryAt: null,
      previewHealth: "HEALTHY",
      previewCheckedAt: new Date("2026-03-30T00:00:00.000Z"),
      provisionedAt: new Date("2026-03-30T00:00:00.000Z"),
      containerName: "preview-project-1",
      previewUrl: "https://preview.example.com",
      workerHost: "local",
      vpsHostId: null,
      lastHeartbeat: new Date("2026-03-30T00:00:00.000Z"),
      retryCount: 2,
      archivedAt: null,
    });

    const resumedProjectId = await tryAutoResumePausedRun(tx as any, "project-1", 4);

    expect(resumedProjectId).toBe("project-1");
    expect(tx.project.update).not.toHaveBeenCalled();
    expect(applyStateChange).toHaveBeenNthCalledWith(
      1,
      tx,
      "project-1",
      { type: "removeBlocker", blocker: "BUDGET" },
      expect.objectContaining({ trigger: "budget_resume" }),
    );
    expect(resetComponentForFreshStart).toHaveBeenCalledWith(
      tx,
      "project-1",
      expect.objectContaining({ trigger: "budget_resume" }),
    );
    expect(tx.runLog.create).toHaveBeenCalledWith({
      data: {
        projectId: "project-1",
        event: "PROVISIONING",
        detail: JSON.stringify({ trigger: "budget_resume" }),
      },
    });
  });

  it("keeps the project paused when another blocker still remains", async () => {
    const tx = createTx();
    vi.mocked(requirePrimaryComponentRow as any).mockResolvedValue({
      projectId: "project-1",
      componentId: "cmp-1",
      powerIntent: "ON",
      runtimeState: "RUNNING",
      agentState: "RUNNING",
      blockers: ["BUDGET", "INFRA"],
      lastOutcome: null,
      lastOutcomeAt: null,
      retryAt: null,
      previewHealth: "HEALTHY",
      previewCheckedAt: new Date("2026-03-30T00:00:00.000Z"),
      provisionedAt: new Date("2026-03-30T00:00:00.000Z"),
      containerName: "preview-project-1",
      previewUrl: "https://preview.example.com",
      workerHost: "local",
      vpsHostId: null,
      lastHeartbeat: new Date("2026-03-30T00:00:00.000Z"),
      retryCount: 2,
      archivedAt: null,
    });

    const resumedProjectId = await tryAutoResumePausedRun(tx as any, "project-1", 4);

    expect(resumedProjectId).toBeNull();
    expect(tx.project.update).not.toHaveBeenCalled();
    expect(applyStateChange).toHaveBeenNthCalledWith(
      1,
      tx,
      "project-1",
      { type: "removeBlocker", blocker: "BUDGET" },
      expect.any(Object),
    );
    expect(resetComponentForFreshStart).toHaveBeenCalledWith(
      tx,
      "project-1",
      expect.any(Object),
    );
    expect(tx.runLog.create).not.toHaveBeenCalled();
  });

  it("turns power back on when a pre-run budget pause becomes claimable", async () => {
    const tx = createTx();
    vi.mocked(requirePrimaryComponentRow as any).mockResolvedValue({
      projectId: "project-1",
      componentId: "cmp-1",
      powerIntent: "OFF",
      runtimeState: "STOPPED",
      agentState: "IDLE",
      blockers: ["BUDGET"],
      lastOutcome: null,
      lastOutcomeAt: null,
      retryAt: null,
      previewHealth: "UNKNOWN",
      previewCheckedAt: null,
      provisionedAt: new Date("2026-03-30T00:00:00.000Z"),
      containerName: null,
      previewUrl: null,
      workerHost: null,
      vpsHostId: null,
      lastHeartbeat: null,
      retryCount: 0,
      archivedAt: null,
    });

    const resumedProjectId = await tryAutoResumePausedRun(tx as any, "project-1", 4);

    expect(resumedProjectId).toBe("project-1");
    expect(tx.project.update).not.toHaveBeenCalled();
    expect(applyStateChange).toHaveBeenNthCalledWith(
      2,
      tx,
      "project-1",
      { type: "power", intent: "ON" },
      expect.objectContaining({ trigger: "budget_resume" }),
    );
  });

  it("does not auto-resume when user provider resume is not allowed", async () => {
    const tx = createTx();
    vi.mocked(requirePrimaryComponentRow as any).mockResolvedValue({
      projectId: "project-1",
      componentId: "cmp-1",
      powerIntent: "ON",
      runtimeState: "RUNNING",
      agentState: "RUNNING",
      blockers: ["BUDGET"],
      lastOutcome: null,
      lastOutcomeAt: null,
      retryAt: null,
      previewHealth: "HEALTHY",
      previewCheckedAt: new Date("2026-03-30T00:00:00.000Z"),
      provisionedAt: new Date("2026-03-30T00:00:00.000Z"),
      containerName: "preview-project-1",
      previewUrl: "https://preview.example.com",
      workerHost: "local",
      vpsHostId: null,
      lastHeartbeat: new Date("2026-03-30T00:00:00.000Z"),
      retryCount: 2,
      archivedAt: null,
    });

    const resumedProjectId = await tryAutoResumePausedRun(tx as any, "project-1", 4, {
      allowUserProviderRunResume: false,
    });

    expect(resumedProjectId).toBeNull();
    expect(applyStateChange).not.toHaveBeenCalled();
    expect(resetComponentForFreshStart).not.toHaveBeenCalled();
  });
});
