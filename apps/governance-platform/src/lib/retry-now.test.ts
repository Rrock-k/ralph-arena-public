import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: vi.fn(),
  },
}));

vi.mock("@/lib/project-state-effects", () => ({
  applyStateChange: vi.fn(),
  requirePrimaryComponentRow: vi.fn(),
  updateComponentMetadata: vi.fn(),
}));

vi.mock("@/lib/progress-bus", () => ({
  notifyProjectChanged: vi.fn(),
  notifyProjectEvent: vi.fn(),
}));

import { retryProjectNowInternal } from "./retry-now";
import { prisma } from "@/lib/prisma";
import {
  applyStateChange,
  requirePrimaryComponentRow,
  updateComponentMetadata,
} from "@/lib/project-state-effects";

describe("retryProjectNowInternal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.$transaction).mockImplementation(async (cb: any) => cb({}));
    vi.mocked(applyStateChange).mockResolvedValue({} as any);
    vi.mocked(updateComponentMetadata).mockResolvedValue({} as any);
  });

  it("clears a retryable blocker without changing runtime or agent intent", async () => {
    vi.mocked(requirePrimaryComponentRow).mockResolvedValue({
      projectId: "project-1",
      componentId: "component-1",
      powerIntent: "ON",
      agentIntent: "ON",
      runtimeState: "RUNNING",
      agentState: "IDLE",
      blockers: ["RATE_LIMIT"],
      lastOutcome: null,
      lastOutcomeAt: null,
      retryAt: new Date("2026-05-27T17:52:33.919Z"),
      previewHealth: "HEALTHY",
      previewCheckedAt: null,
      provisionedAt: new Date("2026-05-20T22:00:00.000Z"),
      containerName: "preview-project-1",
      previewUrl: "https://preview.example.com",
      workerHost: "local",
      vpsHostId: null,
      lastHeartbeat: new Date("2026-05-20T22:19:00.000Z"),
      retryCount: 1,
      archivedAt: null,
      tgSpecLastImportedVersion: null,
      sourceConfig: {},
    });

    const result = await retryProjectNowInternal("project-1");

    expect(result).toEqual({
      success: true,
      projectId: "project-1",
      blocker: "RATE_LIMIT",
      remainingBlockers: [],
      resumePath: "supervisor",
    });
    expect(applyStateChange).toHaveBeenCalledWith(
      expect.anything(),
      "project-1",
      { type: "removeBlocker", blocker: "RATE_LIMIT" },
      expect.objectContaining({ source: "admin", trigger: "retry_now" }),
    );
    expect(updateComponentMetadata).toHaveBeenCalledWith(
      expect.anything(),
      "project-1",
      { retryCount: 2, retryAt: null },
      expect.objectContaining({ reason: "operator_retry_now_supervisor_resume" }),
    );
  });

  it("clears a manual blocker as an explicit operator retry", async () => {
    vi.mocked(requirePrimaryComponentRow).mockResolvedValue({
      projectId: "project-1",
      componentId: "component-1",
      powerIntent: "ON",
      agentIntent: "ON",
      runtimeState: "RUNNING",
      agentState: "IDLE",
      blockers: ["MANUAL"],
      lastOutcome: null,
      lastOutcomeAt: null,
      retryAt: null,
      previewHealth: "HEALTHY",
      previewCheckedAt: null,
      provisionedAt: null,
      containerName: "preview-project-1",
      previewUrl: "https://preview.example.com",
      workerHost: "local",
      vpsHostId: null,
      lastHeartbeat: null,
      retryCount: 0,
      archivedAt: null,
      tgSpecLastImportedVersion: null,
      sourceConfig: {},
    });

    const result = await retryProjectNowInternal("project-1");

    expect(result).toEqual({
      success: true,
      projectId: "project-1",
      blocker: "MANUAL",
      remainingBlockers: [],
      resumePath: "supervisor",
    });
    expect(applyStateChange).toHaveBeenCalledWith(
      expect.anything(),
      "project-1",
      { type: "removeBlocker", blocker: "MANUAL" },
      expect.objectContaining({ source: "admin", trigger: "retry_now" }),
    );
    expect(updateComponentMetadata).toHaveBeenCalledWith(
      expect.anything(),
      "project-1",
      { retryCount: 1, retryAt: null },
      expect.objectContaining({ reason: "operator_retry_now_supervisor_resume" }),
    );
  });

  it("clears a manual blocker while Agent is OFF without enabling agent work", async () => {
    vi.mocked(requirePrimaryComponentRow).mockResolvedValue({
      projectId: "project-1",
      componentId: "component-1",
      powerIntent: "ON",
      agentIntent: "OFF",
      runtimeState: "ABSENT",
      agentState: "IDLE",
      blockers: ["MANUAL"],
      lastOutcome: null,
      lastOutcomeAt: null,
      retryAt: null,
      previewHealth: "UNKNOWN",
      previewCheckedAt: null,
      provisionedAt: null,
      containerName: null,
      previewUrl: null,
      workerHost: null,
      vpsHostId: null,
      lastHeartbeat: null,
      retryCount: 0,
      archivedAt: null,
      tgSpecLastImportedVersion: null,
      sourceConfig: {},
    });

    const result = await retryProjectNowInternal("project-1");

    expect(result).toEqual({
      success: true,
      projectId: "project-1",
      blocker: "MANUAL",
      remainingBlockers: [],
      resumePath: "claim",
    });
    expect(applyStateChange).toHaveBeenCalledWith(
      expect.anything(),
      "project-1",
      { type: "removeBlocker", blocker: "MANUAL" },
      expect.objectContaining({ source: "admin", trigger: "retry_now" }),
    );
    expect(applyStateChange).not.toHaveBeenCalledWith(
      expect.anything(),
      "project-1",
      expect.objectContaining({ type: "agentIntent" }),
      expect.anything(),
    );
    expect(updateComponentMetadata).toHaveBeenCalledWith(
      expect.anything(),
      "project-1",
      { retryCount: 1, retryAt: null },
      expect.objectContaining({ reason: "operator_retry_now_resume_claimable" }),
    );
  });

  it("does not clear retryable model blockers while Agent is OFF", async () => {
    vi.mocked(requirePrimaryComponentRow).mockResolvedValue({
      projectId: "project-1",
      componentId: "component-1",
      powerIntent: "ON",
      agentIntent: "OFF",
      runtimeState: "RUNNING",
      agentState: "IDLE",
      blockers: ["RATE_LIMIT"],
      lastOutcome: null,
      lastOutcomeAt: null,
      retryAt: null,
      previewHealth: "HEALTHY",
      previewCheckedAt: null,
      provisionedAt: null,
      containerName: "preview-project-1",
      previewUrl: "https://preview.example.com",
      workerHost: "local",
      vpsHostId: null,
      lastHeartbeat: null,
      retryCount: 0,
      archivedAt: null,
      tgSpecLastImportedVersion: null,
      sourceConfig: {},
    });

    const result = await retryProjectNowInternal("project-1");

    expect(result).toEqual({
      success: false,
      error: "Project agent is OFF; turn Agent ON before retrying loop work.",
    });
    expect(applyStateChange).not.toHaveBeenCalled();
    expect(updateComponentMetadata).not.toHaveBeenCalled();
  });

  it("does not clear non-retryable non-manual blockers", async () => {
    vi.mocked(requirePrimaryComponentRow).mockResolvedValue({
      projectId: "project-1",
      componentId: "component-1",
      powerIntent: "ON",
      agentIntent: "ON",
      runtimeState: "RUNNING",
      agentState: "IDLE",
      blockers: ["BUDGET"],
      lastOutcome: null,
      lastOutcomeAt: null,
      retryAt: null,
      previewHealth: "HEALTHY",
      previewCheckedAt: null,
      provisionedAt: null,
      containerName: null,
      previewUrl: null,
      workerHost: null,
      vpsHostId: null,
      lastHeartbeat: null,
      retryCount: 0,
      archivedAt: null,
      tgSpecLastImportedVersion: null,
      sourceConfig: {},
    });

    const result = await retryProjectNowInternal("project-1");

    expect(result).toEqual({
      success: false,
      error: "No retryable or manual blocker is present. Current blockers: BUDGET.",
    });
    expect(applyStateChange).not.toHaveBeenCalled();
    expect(updateComponentMetadata).not.toHaveBeenCalled();
  });
});
