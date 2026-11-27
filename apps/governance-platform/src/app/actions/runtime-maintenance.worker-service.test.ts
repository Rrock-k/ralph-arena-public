import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    project: {
      findMany: vi.fn(),
    },
  },
}));

vi.mock("@/lib/platform-access", () => ({
  requirePlatformCapability: vi.fn(),
}));

vi.mock("@/lib/project-access", () => ({
  requireProjectCapability: vi.fn(),
}));

vi.mock("@/lib/agent-loop-activity", () => ({
  hasWorkingAgentLoop: vi.fn(),
}));

vi.mock("@/lib/worker-url", () => ({
  resolveWorkerUrl: vi.fn(),
}));

vi.mock("@/lib/control-plane", () => ({
  getWorkspaceRoot: vi.fn(() => "/tmp/project-workspaces"),
}));

vi.mock("@/lib/project-identity", () => ({
  buildProjectWorkspaceLabel: vi.fn(() => "project-1"),
  getProjectProposalPath: vi.fn(() => null),
}));

vi.mock("@/lib/vps/hetzner", () => ({
  deleteDnsRecords: vi.fn(),
  deleteSshKey: vi.fn(),
  destroyVps: vi.fn(),
  listServers: vi.fn(),
  listSshKeys: vi.fn(),
  rebootServer: vi.fn(),
}));

vi.mock("@/lib/project-lifecycle", () => ({
  getPrimaryLifecycleComponent: vi.fn(() => null),
  getPublicDisplayStatus: vi.fn(() => "LIVE"),
}));

vi.mock("@/lib/preview-state", () => ({
  isRetainedPreviewRow: vi.fn(() => false),
}));

vi.mock("@/lib/project-state-effects", () => ({
  prepareRuntimeForFreshClaim: vi.fn(),
}));

vi.mock("@/lib/progress-bus", () => ({
  notifyProjectChanged: vi.fn(),
  progressBus: {
    notifyChanged: vi.fn(),
  },
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

import { prisma } from "@/lib/prisma";
import { requirePlatformCapability } from "@/lib/platform-access";
import { hasWorkingAgentLoop } from "@/lib/agent-loop-activity";
import { resolveWorkerUrl } from "@/lib/worker-url";
import { progressBus } from "@/lib/progress-bus";
import { restartWorkerServiceInternal } from "./runtime-maintenance";
import { INTERNAL_ACTION_TOKEN } from "@/lib/internal-action-token";

describe("restartWorkerServiceInternal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      status: 202,
      text: vi.fn().mockResolvedValue("{\"ok\":true}"),
    }));
    vi.mocked(requirePlatformCapability).mockResolvedValue({ authorized: true } as any);
    vi.mocked((prisma as any).project.findMany).mockResolvedValue([]);
    vi.mocked(resolveWorkerUrl).mockReturnValue("http://worker.local");
    vi.mocked(hasWorkingAgentLoop).mockReturnValue(false);
  });

  it("schedules a worker self-restart when the host has no active runs", async () => {
    const result = await restartWorkerServiceInternal("local", {
      internalActionToken: INTERNAL_ACTION_TOKEN,
    });

    expect(result).toEqual({
      success: true,
      details: "Worker service restart scheduled for local",
    });
    expect(fetch).toHaveBeenCalledWith(
      "http://worker.local/maintenance/restart-self",
      expect.objectContaining({
        method: "POST",
      }),
    );
    expect(requirePlatformCapability).not.toHaveBeenCalled();
    expect(progressBus.notifyChanged).toHaveBeenCalled();
  });

  it("blocks worker restart when the host still has active agent runs", async () => {
    vi.mocked((prisma as any).project.findMany).mockResolvedValue([
      {
        id: "project-1",
        name: "Desk Garden",
        components: [{}],
      },
    ]);
    vi.mocked(hasWorkingAgentLoop).mockReturnValue(true);

    const result = await restartWorkerServiceInternal("local", {
      internalActionToken: INTERNAL_ACTION_TOKEN,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("safe window");
    expect(result.error).toContain("Desk Garden (project-1)");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("requires vpsIp when a non-local worker URL cannot be resolved", async () => {
    vi.mocked(resolveWorkerUrl).mockReturnValue(null);

    const result = await restartWorkerServiceInternal("worker-1", {
      internalActionToken: INTERNAL_ACTION_TOKEN,
    });

    expect(result).toEqual({
      success: false,
      error: "Cannot resolve worker URL for host worker-1; provide vpsIp for non-local workers",
    });
    expect(fetch).not.toHaveBeenCalled();
  });
});
