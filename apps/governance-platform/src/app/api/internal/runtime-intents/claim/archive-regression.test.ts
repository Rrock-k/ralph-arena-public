import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

vi.mock("@/lib/prisma", () => {
  const prisma: any = {
    $transaction: vi.fn(),
    $executeRawUnsafe: vi.fn(),
    $queryRawUnsafe: vi.fn(),
    runtimeIntent: {
      create: vi.fn(),
    },
  };
  return { prisma };
});

vi.mock("@/lib/internal-auth", () => ({
  isWorkerAuthorized: vi.fn(),
}));

vi.mock("@/lib/project-identity", () => ({
  buildProjectWorkspaceLabel: vi.fn(() => "ant-dream-hea20y"),
}));

import { prisma } from "@/lib/prisma";
import { isWorkerAuthorized } from "@/lib/internal-auth";

describe("POST /api/internal/runtime-intents/claim - archive regression", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isWorkerAuthorized).mockReturnValue(true);
    vi.mocked(prisma.$transaction as any).mockImplementation(async (callback: (tx: typeof prisma) => Promise<unknown>) => callback(prisma as any));
    vi.mocked(prisma.$executeRawUnsafe as any).mockResolvedValue(0);
    vi.mocked(prisma.runtimeIntent.create as any).mockResolvedValue({ id: "intent-1" });
  });

  it("claims ensure_stopped for archived projects that still have a running runtime", async () => {
    vi.mocked(prisma.$queryRawUnsafe as any).mockImplementation(async (sql: string) => {
      expect(sql).toContain(`pc."powerIntent" = 'OFF'`);
      expect(sql).toContain(`pc."runtimeState" = 'RUNNING'`);
      expect(sql).toContain(`p."archivedAt" IS NULL`);
      expect(sql).toContain(`pc."powerIntent" = 'ON'`);
      expect(sql).toContain(`pc."runtimeState" IN ('ABSENT', 'STOPPED')`);
      expect(sql).toContain(`pc."agentIntent" = 'OFF'`);
      expect(sql).toContain(`pc."provisionedAt" IS NOT NULL`);
      expect(sql).not.toContain(`OR pc."lastOutcome" = 'COMPLETED'`);

      return [
        {
          projectId: "project-1",
          projectName: "Ant Dream",
          proposalId: null,
          proposalTitle: null,
          cycleImage: "arena-public-worker:local",
          componentId: "component-1",
          powerIntent: "OFF",
          agentIntent: "ON",
          runtimeState: "RUNNING",
          agentState: "IDLE",
          lastOutcome: "COMPLETED",
          workerHost: "local",
          containerName: "preview-ant-dream-hea20y",
          runtimeConfig: {},
          lastState: null,
          lastAttempt: null,
          lastNextAttemptAt: null,
        },
      ];
    });

    const res = await POST(new Request("http://localhost/api/internal/runtime-intents/claim", {
      method: "POST",
      body: JSON.stringify({ host: "local" }),
    }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(prisma.runtimeIntent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        projectId: "project-1",
        componentId: "component-1",
        host: "local",
        action: "ensure_stopped",
        runnerMode: "preview_only",
        state: "CLAIMED",
        attempt: 1,
        lockedUntil: expect.any(Date),
      }),
      select: { id: true },
    });
    expect(body).toEqual({
      intentId: "intent-1",
      projectId: "project-1",
      action: "ensure_stopped",
      runnerMode: "preview_only",
      containerName: "preview-ant-dream-hea20y",
      workspaceLabel: "ant-dream-hea20y",
      workerImage: null,
      attempt: 1,
    });
  });
});
