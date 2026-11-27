import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    proposal: {
      update: vi.fn(),
    },
    project: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/progress-bus", () => ({
  notifyProjectChanged: vi.fn(),
  progressBus: {
    notifyChanged: vi.fn(),
  },
}));

vi.mock("@/lib/platform-access", () => ({
  requirePlatformCapability: vi.fn(),
}));

vi.mock("@/lib/project-access", () => ({
  requireProjectCapability: vi.fn(),
}));

vi.mock("@/lib/project-identity", () => ({
  getProjectProposalPath: vi.fn(() => "/proposals/proposal-1"),
}));

vi.mock("@/lib/project-state-effects", () => ({
  applyStateChange: vi.fn(),
  requirePrimaryComponentRow: vi.fn(),
}));

import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { notifyProjectChanged, progressBus } from "@/lib/progress-bus";
import { requirePlatformCapability } from "@/lib/platform-access";
import { requireProjectCapability } from "@/lib/project-access";
import { applyStateChange, requirePrimaryComponentRow } from "@/lib/project-state-effects";
import { INTERNAL_ACTION_TOKEN } from "@/lib/internal-action-token";
import {
  archiveProposal,
  archiveProject,
  archiveProjectInternal,
  unarchiveProject,
  unarchiveProjectInternal,
  unarchiveProposal,
} from "./archive";

describe("archive proposal actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requirePlatformCapability).mockResolvedValue({ authorized: true } as any);
  });

  it("archives proposal through platform capability gate", async () => {
    vi.mocked(prisma.proposal.update as any).mockResolvedValue({} as any);

    const result = await archiveProposal("proposal-1");

    expect(result).toEqual({ success: true });
    expect(prisma.proposal.update).toHaveBeenCalledWith({
      where: { id: "proposal-1" },
      data: { archivedAt: expect.any(Date) },
    });
    expect(revalidatePath).toHaveBeenCalledWith("/");
    expect(revalidatePath).toHaveBeenCalledWith("/admin");
    expect(revalidatePath).toHaveBeenCalledWith("/proposals/proposal-1");
    expect(notifyProjectChanged).not.toHaveBeenCalled();
    expect(progressBus.notifyChanged).toHaveBeenCalled();
  });

  it("rejects archive proposal when platform capability is missing", async () => {
    vi.mocked(requirePlatformCapability).mockResolvedValue({ authorized: false, error: "Forbidden" } as any);

    const result = await archiveProposal("proposal-1");

    expect(result).toEqual({ success: false, error: "Forbidden" });
    expect(prisma.proposal.update).not.toHaveBeenCalled();
  });

  it("unarchives proposal through platform capability gate", async () => {
    vi.mocked(prisma.proposal.update as any).mockResolvedValue({} as any);

    const result = await unarchiveProposal("proposal-1");

    expect(result).toEqual({ success: true });
    expect(prisma.proposal.update).toHaveBeenCalledWith({
      where: { id: "proposal-1" },
      data: { archivedAt: null },
    });
    expect(notifyProjectChanged).not.toHaveBeenCalled();
    expect(progressBus.notifyChanged).toHaveBeenCalled();
  });
});

describe("project archive actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireProjectCapability).mockResolvedValue({ authorized: true } as any);
    vi.mocked(prisma.$transaction as any).mockImplementation(async (callback: (tx: typeof prisma) => Promise<unknown>) => callback(prisma as any));
    vi.mocked(prisma.project.findUnique as any).mockResolvedValue({
      proposalId: "proposal-1",
      proposal: { id: "proposal-1" },
    });
    vi.mocked(requirePrimaryComponentRow as any).mockResolvedValue({
      projectId: "project-1",
      componentId: "cmp-1",
      powerIntent: "ON",
      agentIntent: "ON",
      runtimeState: "RUNNING",
      agentState: "RUNNING",
      blockers: [],
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
    });
    vi.mocked(applyStateChange as any).mockResolvedValue({});
    vi.mocked(prisma.project.update as any).mockResolvedValue({} as any);
  });

  it("archives project via explicit project-level primitive", async () => {
    const result = await archiveProjectInternal("project-1", INTERNAL_ACTION_TOKEN);

    expect(result).toEqual({ success: true });
    expect(prisma.project.update).toHaveBeenCalledWith({
      where: { id: "project-1" },
      data: {
        archivedAt: expect.any(Date),
      },
    });
    expect(applyStateChange).toHaveBeenCalledWith(
      expect.anything(),
      "project-1",
      { type: "agentIntent", intent: "OFF" },
      { source: "admin", trigger: "archive", reason: "user archive" },
    );
    expect(applyStateChange).toHaveBeenCalledWith(
      expect.anything(),
      "project-1",
      { type: "power", intent: "OFF", force: true },
      { source: "admin", trigger: "archive", reason: "user archive" },
    );
    expect(revalidatePath).toHaveBeenCalledWith("/");
    expect(revalidatePath).toHaveBeenCalledWith("/explore");
    expect(revalidatePath).toHaveBeenCalledWith("/my");
    expect(revalidatePath).toHaveBeenCalledWith("/admin");
    expect(revalidatePath).toHaveBeenCalledWith("/proposals/proposal-1");
    expect(notifyProjectChanged).toHaveBeenCalledWith("project-1");
    expect(progressBus.notifyChanged).not.toHaveBeenCalled();
  });

  it("re-normalizes archived project rows that still have agent intent ON", async () => {
    vi.mocked(requirePrimaryComponentRow as any).mockResolvedValue({
      projectId: "project-1",
      componentId: "cmp-1",
      powerIntent: "OFF",
      agentIntent: "ON",
      runtimeState: "ABSENT",
      agentState: "IDLE",
      blockers: [],
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
      archivedAt: new Date("2026-04-21T00:00:00.000Z"),
    });

    const result = await archiveProjectInternal("project-1", INTERNAL_ACTION_TOKEN);

    expect(result).toEqual({ success: true });
    expect(prisma.project.update).not.toHaveBeenCalled();
    expect(applyStateChange).toHaveBeenCalledTimes(1);
    expect(applyStateChange).toHaveBeenCalledWith(
      expect.anything(),
      "project-1",
      { type: "agentIntent", intent: "OFF" },
      { source: "admin", trigger: "archive", reason: "user archive" },
    );
    expect(notifyProjectChanged).toHaveBeenCalledWith("project-1");
    expect(progressBus.notifyChanged).not.toHaveBeenCalled();
  });

  it("treats already archived fully-off rows as a noop success", async () => {
    vi.mocked(requirePrimaryComponentRow as any).mockResolvedValue({
      projectId: "project-1",
      componentId: "cmp-1",
      powerIntent: "OFF",
      agentIntent: "OFF",
      runtimeState: "ABSENT",
      agentState: "IDLE",
      blockers: [],
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
      archivedAt: new Date("2026-04-21T00:00:00.000Z"),
    });

    const result = await archiveProjectInternal("project-1", INTERNAL_ACTION_TOKEN);

    expect(result).toEqual({ success: true });
    expect(prisma.project.update).not.toHaveBeenCalled();
    expect(applyStateChange).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
    expect(notifyProjectChanged).not.toHaveBeenCalled();
  });

  it("rejects archiveProject when project capability is missing", async () => {
    vi.mocked(requireProjectCapability).mockResolvedValue({ authorized: false, error: "Denied" } as any);

    const result = await archiveProject("project-1");

    expect(result).toEqual({ success: false, error: "Denied" });
    expect(prisma.project.update).not.toHaveBeenCalled();
  });

  it("unarchives project via project-scoped refresh signal", async () => {
    const result = await unarchiveProjectInternal("project-1", INTERNAL_ACTION_TOKEN);

    expect(result).toEqual({ success: true });
    expect(prisma.project.update).toHaveBeenCalledWith({
      where: { id: "project-1" },
      data: {
        archivedAt: null,
      },
    });
    expect(notifyProjectChanged).toHaveBeenCalledWith("project-1");
    expect(progressBus.notifyChanged).not.toHaveBeenCalled();
  });

  it("unarchives project without auto-powering on", async () => {
    const result = await unarchiveProjectInternal("project-1", INTERNAL_ACTION_TOKEN);

    expect(result).toEqual({ success: true });
    expect(prisma.project.update).toHaveBeenCalledWith({
      where: { id: "project-1" },
      data: {
        archivedAt: null,
      },
    });
    expect(applyStateChange).not.toHaveBeenCalled();
    expect(revalidatePath).toHaveBeenCalledWith("/");
    expect(revalidatePath).toHaveBeenCalledWith("/explore");
  });

  it("rejects unarchiveProject when project capability is missing", async () => {
    vi.mocked(requireProjectCapability).mockResolvedValue({ authorized: false, error: "Denied" } as any);

    const result = await unarchiveProject("project-1");

    expect(result).toEqual({ success: false, error: "Denied" });
  });
});
