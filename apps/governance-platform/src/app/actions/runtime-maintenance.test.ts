import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";

vi.mock("server-only", () => ({}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    project: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    projectEvent: {
      create: vi.fn(),
    },
    runLog: {
      create: vi.fn(),
    },
    vpsHost: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      delete: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

vi.mock("@/lib/platform-access", () => ({
  requirePlatformCapability: vi.fn(),
}));

vi.mock("@/lib/project-access", () => ({
  requireProjectCapability: vi.fn(),
}));

vi.mock("@/lib/control-plane", () => ({
  getWorkspaceRoot: vi.fn(() => process.env.TEST_WORKSPACE_ROOT ?? "/tmp/project-workspaces"),
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
import { requireProjectCapability } from "@/lib/project-access";
import { notifyProjectChanged, progressBus } from "@/lib/progress-bus";
import { destroyVps, listServers } from "@/lib/vps/hetzner";
import { prepareRuntimeForFreshClaim } from "@/lib/project-state-effects";
import { INTERNAL_ACTION_TOKEN } from "@/lib/internal-action-token";
import {
  cleanupProjectRuntimeArtifacts,
  destroyProjectVpsHost,
  getVpsFleet,
  requestProjectPreviewRefresh,
  requestProjectRuntimeRecreateInternal,
  requestProjectRuntimeRecreate,
} from "./runtime-maintenance";

describe("runtime-maintenance", () => {
  const originalHetznerToken = process.env.HETZNER_API_TOKEN;
  const originalTestWorkspaceRoot = process.env.TEST_WORKSPACE_ROOT;
  let testWorkspaceRoot: string;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: vi.fn().mockResolvedValue(""),
    }));
    vi.mocked(requirePlatformCapability).mockResolvedValue({ authorized: true } as any);
    vi.mocked(requireProjectCapability).mockResolvedValue({ authorized: true } as any);
    process.env.HETZNER_API_TOKEN = "token";
    delete process.env.HETZNER_DNS_TOKEN;
    delete process.env.HETZNER_DNS_ZONE_ID;
    delete process.env.PREVIEW_DOMAIN;
    testWorkspaceRoot = mkdtempSync(path.join(os.tmpdir(), "runtime-maintenance-workspaces-"));
    process.env.TEST_WORKSPACE_ROOT = testWorkspaceRoot;
    vi.mocked((prisma as any).$transaction).mockImplementation(async (fn: (tx: unknown) => unknown) => fn(prisma as any));
  });

  afterAll(() => {
    process.env.HETZNER_API_TOKEN = originalHetznerToken;
    if (originalTestWorkspaceRoot === undefined) delete process.env.TEST_WORKSPACE_ROOT;
    else process.env.TEST_WORKSPACE_ROOT = originalTestWorkspaceRoot;
  });

  it("allows cleanup for parked preview-only rows and preserves workspace", async () => {
    vi.mocked((prisma as any).project.findUnique).mockResolvedValue({
      id: "project-1",
      name: "Project 1",
      archivedAt: null,
      proposal: { title: "Proposal 1" },
      components: [
        {
          kind: "app",
          powerIntent: "ON",
          agentIntent: "OFF",
          runtimeState: "RUNNING",
          agentState: "IDLE",
          lastOutcome: null,
        },
      ],
    });

    const result = await cleanupProjectRuntimeArtifacts("project-1");

    expect(result).toEqual(expect.objectContaining({
      success: true,
      details: expect.stringContaining("workspace preserved"),
    }));
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("/containers/preview-project-1"),
      expect.objectContaining({ method: "DELETE" }),
    );
    expect(notifyProjectChanged).toHaveBeenCalledWith("project-1");
    expect(progressBus.notifyChanged).not.toHaveBeenCalled();
  });

  it("queues preview refresh as an incoming project event for running runtimes", async () => {
    vi.mocked((prisma as any).project.findUnique).mockResolvedValue({
      id: "project-1",
      components: [
        {
          kind: "app",
          powerIntent: "ON",
          agentIntent: "ON",
          runtimeState: "RUNNING",
          agentState: "RUNNING",
          lastOutcome: null,
        },
      ],
    });
    vi.mocked((prisma as any).projectEvent.create).mockResolvedValue({ id: "evt-1" });

    const result = await requestProjectPreviewRefresh("project-1");

    expect(result).toEqual(expect.objectContaining({
      success: true,
      details: "Preview refresh requested",
    }));
    expect((prisma as any).projectEvent.create).toHaveBeenCalledWith({
      data: {
        projectId: "project-1",
        direction: "in",
        type: "preview_refresh_requested",
        payload: {
          source: "admin",
          reason: "manual_refresh",
          maintenanceReason: null,
        },
      },
    });
    expect(progressBus.notifyChanged).toHaveBeenCalledWith({
      type: "project_event",
      projectId: "project-1",
    });
    expect(notifyProjectChanged).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("blocks preview refresh when runtime is not running", async () => {
    vi.mocked((prisma as any).project.findUnique).mockResolvedValue({
      id: "project-1",
      components: [
        {
          kind: "app",
          powerIntent: "OFF",
          agentIntent: "OFF",
          runtimeState: "ABSENT",
          agentState: "IDLE",
          lastOutcome: null,
        },
      ],
    });

    const result = await requestProjectPreviewRefresh("project-1");

    expect(result).toEqual({
      success: false,
      error: "Preview refresh requires a running project runtime",
    });
    expect((prisma as any).projectEvent.create).not.toHaveBeenCalled();
  });

  it("recreates runtime for powered-on idle rows without mutating operator truth", async () => {
    vi.mocked((prisma as any).project.findUnique).mockResolvedValue({
      id: "project-1",
      proposalId: null,
      archivedAt: null,
      components: [
        {
          kind: "app",
          powerIntent: "ON",
          agentIntent: "ON",
          runtimeState: "RUNNING",
          agentState: "IDLE",
          blockers: ["RATE_LIMIT"],
          lastOutcome: null,
          provisionedAt: "2026-04-22T00:00:00.000Z",
          previewUrl: "https://preview.example.com",
          containerName: "preview-project-1",
          workerHost: "local",
          retryAt: "2026-04-23T00:00:00.000Z",
        },
      ],
    });
    vi.mocked(prepareRuntimeForFreshClaim).mockResolvedValue({
      row: {},
      clearedStartIntentHistory: false,
      clearedInfraBlocker: false,
    } as any);

    const result = await requestProjectRuntimeRecreate("project-1");

    expect(result).toEqual({
      success: true,
      details: "Runtime recreate requested",
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(
      expect.stringMatching(/\/containers\/preview-project-1$/),
      expect.objectContaining({ method: "DELETE" }),
    );
    expect(prepareRuntimeForFreshClaim).toHaveBeenCalledWith(
      expect.anything(),
      "project-1",
      {
        source: "system",
        trigger: "recreate_runtime",
        reason: "manual_runtime_recreate",
      },
      {
        provisionedAt: null,
        clearInfraBlocker: true,
        preserveOutcome: true,
      },
    );
    expect((prisma as any).runLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        projectId: "project-1",
        event: "RUNTIME_RECREATE",
      }),
    });
    expect((prisma as any).projectEvent.create).toHaveBeenCalledWith({
      data: {
        projectId: "project-1",
        direction: "in",
        type: "runtime_recreate_requested",
        payload: {
          source: "admin",
          reason: "manual_runtime_recreate",
          maintenanceReason: null,
        },
      },
    });
    expect(vi.mocked(prepareRuntimeForFreshClaim).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(fetch).mock.invocationCallOrder[0]!,
    );
    expect(notifyProjectChanged).toHaveBeenCalledWith("project-1");
  });

  it("preserves cron recreate attribution in the fresh-claim helper context", async () => {
    vi.mocked((prisma as any).project.findUnique).mockResolvedValue({
      id: "project-1",
      proposalId: null,
      archivedAt: null,
      components: [
        {
          kind: "app",
          powerIntent: "ON",
          agentIntent: "ON",
          runtimeState: "RUNNING",
          agentState: "IDLE",
          blockers: [],
          lastOutcome: "COMPLETED",
          provisionedAt: "2026-04-22T00:00:00.000Z",
          previewUrl: "https://preview.example.com",
          containerName: "preview-project-1",
          workerHost: "local",
          retryAt: null,
        },
      ],
    });
    vi.mocked(prepareRuntimeForFreshClaim).mockResolvedValue({
      row: {},
      clearedStartIntentHistory: false,
      clearedInfraBlocker: false,
    } as any);

    const result = await requestProjectRuntimeRecreateInternal("project-1", {
      source: "cron",
      reason: "resident_runtime_auto_maintenance",
      maintenanceReason: "runtime_generation_stale",
      internalActionToken: INTERNAL_ACTION_TOKEN,
    });

    expect(result).toEqual({
      success: true,
      details: "Runtime recreate requested",
    });
    expect(prepareRuntimeForFreshClaim).toHaveBeenCalledWith(
      expect.anything(),
      "project-1",
      {
        source: "system",
        trigger: "recreate_runtime",
        reason: "resident_runtime_auto_maintenance",
      },
      expect.objectContaining({
        provisionedAt: null,
        clearInfraBlocker: true,
        preserveOutcome: true,
      }),
    );
  });

  it("does not delete the worker container before durable recreate state converges", async () => {
    vi.mocked((prisma as any).project.findUnique).mockResolvedValue({
      id: "project-1",
      proposalId: null,
      archivedAt: null,
      components: [
        {
          kind: "app",
          powerIntent: "ON",
          agentIntent: "ON",
          runtimeState: "RUNNING",
          agentState: "IDLE",
          blockers: [],
          lastOutcome: "COMPLETED",
          provisionedAt: "2026-04-22T00:00:00.000Z",
          previewUrl: "https://preview.example.com",
          containerName: "preview-project-1",
          workerHost: "local",
          retryAt: null,
        },
      ],
    });
    vi.mocked(prepareRuntimeForFreshClaim).mockRejectedValue(new Error("db write failed"));

    const result = await requestProjectRuntimeRecreateInternal("project-1", {
      source: "cron",
      reason: "resident_runtime_auto_maintenance",
      maintenanceReason: "runtime_generation_stale",
      internalActionToken: INTERNAL_ACTION_TOKEN,
    }).catch((error) => error);

    expect(String(result)).toContain("db write failed");
    expect(fetch).not.toHaveBeenCalled();
    expect((prisma as any).projectEvent.create).not.toHaveBeenCalled();
  });

  it("treats delete-in-progress during runtime recreate as a benign post-transaction outcome", async () => {
    vi.mocked((prisma as any).project.findUnique).mockResolvedValue({
      id: "project-1",
      proposalId: null,
      archivedAt: null,
      components: [
        {
          kind: "app",
          powerIntent: "ON",
          agentIntent: "ON",
          runtimeState: "RUNNING",
          agentState: "IDLE",
          blockers: [],
          lastOutcome: "COMPLETED",
          provisionedAt: "2026-04-22T00:00:00.000Z",
          previewUrl: "https://preview.example.com",
          containerName: "preview-project-1",
          workerHost: "local",
          retryAt: null,
        },
      ],
    });
    vi.mocked(prepareRuntimeForFreshClaim).mockResolvedValue({
      row: {},
      clearedStartIntentHistory: false,
      clearedInfraBlocker: false,
    } as any);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      text: vi.fn().mockResolvedValue("{\"error\":\"(HTTP code 409) unexpected - removal of container preview-project-1 is already in progress \"}"),
    }));

    const result = await requestProjectRuntimeRecreateInternal("project-1", {
      source: "cron",
      reason: "resident_runtime_auto_maintenance",
      maintenanceReason: "runtime_generation_stale",
      internalActionToken: INTERNAL_ACTION_TOKEN,
    });

    expect(result).toEqual({
      success: true,
      details: "Runtime recreate requested",
    });
    expect(prepareRuntimeForFreshClaim).toHaveBeenCalled();
    expect((prisma as any).projectEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        projectId: "project-1",
        type: "runtime_recreate_requested",
      }),
    });
  });

  it("blocks runtime recreate while the agent is actively running", async () => {
    vi.mocked((prisma as any).project.findUnique).mockResolvedValue({
      id: "project-1",
      proposalId: null,
      archivedAt: null,
      components: [
        {
          kind: "app",
          powerIntent: "ON",
          agentIntent: "ON",
          runtimeState: "RUNNING",
          agentState: "RUNNING",
          blockers: [],
          lastOutcome: null,
          provisionedAt: null,
          previewUrl: "https://preview.example.com",
          containerName: "preview-project-1",
          workerHost: "local",
          retryAt: null,
        },
      ],
    });

    const result = await requestProjectRuntimeRecreate("project-1");

    expect(result).toEqual({
      success: false,
      error: "Runtime recreate requires the agent to be idle or off",
    });
    expect(prepareRuntimeForFreshClaim).not.toHaveBeenCalled();
  });

  it("projects parked preview-only rows as LIVE in VPS fleet and requests the needed facts", async () => {
    vi.mocked(listServers).mockResolvedValue([
      {
        id: "srv-1",
        name: "arena-test",
        status: "running",
        ip: "1.2.3.4",
        serverType: "cx22",
        location: "fsn1",
        created: "2026-04-17T00:00:00.000Z",
      },
    ] as any);
    const findMany = vi.mocked((prisma as any).vpsHost.findMany);
    findMany.mockResolvedValue([
      {
        id: "host-1",
        providerServerId: "srv-1",
        status: "ACTIVE",
        region: "fsn1",
        serverType: "cx22",
        previewDomain: "preview.arena.example.test",
        projectId: "project-1",
        project: {
          name: "Project 1",
          archivedAt: null,
          proposal: { title: "Proposal 1" },
          components: [
            {
              kind: "app",
              powerIntent: "ON",
              agentIntent: "OFF",
              runtimeState: "RUNNING",
              agentState: "IDLE",
              blockers: [],
              lastOutcome: null,
              previewUrl: null,
              previewHealth: "UNKNOWN",
              containerName: "preview-project-1",
              provisionedAt: null,
            },
          ],
        },
      },
    ]);

    const result = await getVpsFleet();

    expect(result.entries[0]?.dbRecord?.projectStatus).toBe("LIVE");
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      select: expect.objectContaining({
        project: expect.objectContaining({
          select: expect.objectContaining({
            components: expect.objectContaining({
              select: expect.objectContaining({
                agentIntent: true,
                previewUrl: true,
                previewHealth: true,
                containerName: true,
              }),
            }),
          }),
        }),
      }),
    }));
  });

  it("does not block VPS destroy for parked preview-only rows", async () => {
    vi.mocked((prisma as any).project.findUnique).mockResolvedValue({
      id: "project-1",
      proposalId: "proposal-1",
      previewUrl: null,
      components: [
        {
          kind: "app",
          powerIntent: "ON",
          agentIntent: "OFF",
          agentState: "IDLE",
          lastOutcome: null,
        },
      ],
      vpsHost: {
        id: "host-1",
        providerServerId: "srv-1",
        providerKeyId: "key-1",
        previewDomain: "preview.arena.example.test",
      },
    });
    vi.mocked(destroyVps).mockResolvedValue(undefined as never);
    vi.mocked((prisma as any).vpsHost.delete).mockResolvedValue({ id: "host-1" });
    vi.mocked((prisma as any).project.update).mockResolvedValue({ id: "project-1" });
    vi.mocked((prisma as any).$transaction).mockResolvedValue([]);

    const result = await destroyProjectVpsHost("project-1");

    expect(result).toEqual(expect.objectContaining({ success: true }));
    expect(destroyVps).toHaveBeenCalledWith("token", "srv-1", "key-1");
    expect(notifyProjectChanged).toHaveBeenCalledWith("project-1");
    expect(progressBus.notifyChanged).not.toHaveBeenCalled();
  });
});
