import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

vi.mock("@/lib/prisma", () => {
  const prisma: any = {
    $transaction: vi.fn(),
    $executeRawUnsafe: vi.fn(),
    $queryRawUnsafe: vi.fn(),
    project: {
      findUnique: vi.fn(),
    },
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
  buildProjectWorkspaceLabel: vi.fn(() => "fresh-restore-candidate"),
}));

vi.mock("@/lib/agent-run-launch", () => ({
  prepareRuntimeLaunch: vi.fn(),
}));

import { prisma } from "@/lib/prisma";
import { isWorkerAuthorized } from "@/lib/internal-auth";
import { prepareRuntimeLaunch } from "@/lib/agent-run-launch";

describe("POST /api/internal/runtime-intents/claim - start selection window regression", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isWorkerAuthorized).mockReturnValue(true);
    vi.mocked(prisma.$transaction as any).mockImplementation(
      async (callback: (tx: typeof prisma) => Promise<unknown>) => callback(prisma as any),
    );
    vi.mocked(prisma.$executeRawUnsafe as any).mockResolvedValue(0);
    vi.mocked(prisma.runtimeIntent.create as any).mockResolvedValue({ id: "intent-restore-1" });
    vi.mocked(prisma.project.findUnique as any).mockResolvedValue({
      id: "project-restore-1",
      budget: null,
      secrets: [],
      components: [{ agentIntent: "ON", runtimeConfig: {} }],
      proposal: { title: "Fresh Restore Candidate" },
    });
    vi.mocked(prepareRuntimeLaunch).mockResolvedValue({
      ok: true,
      payload: {
        env: {
          ARENA_PROJECT_ID: "project-restore-1",
          ARENA_AGENT: "codex",
        },
        workerImage: "arena-public-worker:local",
        workspaceLabel: "fresh-restore-candidate",
      },
    });
  });

  it("keeps completed preview restores inside the provisioned start window before LIMIT 20", async () => {
    vi.mocked(prisma.$queryRawUnsafe as any).mockImplementation(async (sql: string) => {
      expect(sql).toContain(`pc."powerIntent" = 'OFF'`);
      expect(sql).toContain(`pc."runtimeState" = 'RUNNING'`);
      expect(sql).toMatch(/pc\."runtimeState"\s+IN \('ABSENT', 'STOPPED'\)/);
      expect(sql).toContain(`pc."agentIntent" = 'OFF'`);
      expect(sql).toContain(`pc."provisionedAt" IS NOT NULL`);
      expect(sql).not.toContain(`OR pc."lastOutcome" = 'COMPLETED'`);
      expect(sql).toContain(`LIMIT 20`);

      return [
        {
          projectId: "project-restore-1",
          projectName: "Fresh Restore Candidate",
          projectSlug: "fresh-restore-candidate",
          proposalId: null,
          proposalTitle: null,
          cycleImage: "arena-public-worker:local",
          componentId: "component-restore-1",
          powerIntent: "ON",
          agentIntent: "ON",
          runtimeState: "ABSENT",
          agentState: "IDLE",
          provisionedAt: new Date("2026-04-17T08:00:00.000Z"),
          pendingLoopWork: false,
          allowPreviewOnlyRestore: true,
          blockers: [],
          workerHost: "local",
          containerName: "preview-fresh-restore-candidate",
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

    await expect(res.json()).resolves.toEqual({
      intentId: "intent-restore-1",
      projectId: "project-restore-1",
      action: "ensure_running",
      runnerMode: "preview_only",
      containerName: "preview-fresh-restore-candidate",
      workspaceLabel: "fresh-restore-candidate",
      workerImage: "arena-public-worker:local",
      attempt: 1,
      env: {
        ARENA_PROJECT_ID: "project-restore-1",
        ARENA_AGENT: "codex",
      },
    });
  });

  it("prioritizes interrupted active loop work before retained preview restores inside the LIMIT 20 window", async () => {
    vi.mocked(prisma.$queryRawUnsafe as any).mockImplementation(async (sql: string) => {
      const orderByIndex = sql.indexOf("ORDER BY CASE");
      expect(orderByIndex).toBeGreaterThan(-1);

      const activePriorityIndex = sql.indexOf(`pc."agentIntent" = 'ON'`, orderByIndex);
      const pendingWorkIndex = sql.indexOf(`pc."lastOutcome" IS NULL`, orderByIndex);
      const missingContainerIndex = sql.indexOf(`NOT (pc."containerName" = ANY($3::text[]))`, orderByIndex);
      const limitIndex = sql.indexOf("LIMIT 20", orderByIndex);

      expect(activePriorityIndex).toBeGreaterThan(orderByIndex);
      expect(pendingWorkIndex).toBeGreaterThan(activePriorityIndex);
      expect(missingContainerIndex).toBeGreaterThan(pendingWorkIndex);
      expect(limitIndex).toBeGreaterThan(missingContainerIndex);

      return [
        {
          projectId: "project-active-1",
          projectName: "Interrupted Active",
          projectSlug: "interrupted-active",
          proposalId: null,
          proposalTitle: null,
          componentId: "component-active-1",
          powerIntent: "ON",
          agentIntent: "ON",
          runtimeState: "RUNNING",
          agentState: "RUNNING",
          runtimeMissingFromWorker: true,
          provisionedAt: new Date("2026-06-02T00:00:00.000Z"),
          pendingLoopWork: true,
          allowPreviewOnlyRestore: false,
          blockers: [],
          workerHost: "local",
          containerName: "preview-interrupted-active",
          sourceConfig: null,
          tgSpecLastImportedVersion: 1,
          lastAction: "ensure_running",
          lastState: "SUCCEEDED",
          lastAttempt: 1,
        },
      ];
    });
    vi.mocked(prepareRuntimeLaunch).mockResolvedValue({
      ok: true,
      payload: {
        env: {
          ARENA_PROJECT_ID: "project-active-1",
          ARENA_AGENT: "codex",
        },
        workerImage: "arena-public-worker:local",
        workspaceLabel: "interrupted-active",
      },
    });

    const res = await POST(new Request("http://localhost/api/internal/runtime-intents/claim", {
      method: "POST",
      body: JSON.stringify({
        host: "local",
        activePreviewContainers: ["preview-retained-1", "preview-retained-2"],
      }),
    }));

    await expect(res.json()).resolves.toEqual({
      intentId: "intent-restore-1",
      projectId: "project-active-1",
      action: "ensure_running",
      runnerMode: "agent_run",
      containerName: "preview-interrupted-active",
      workspaceLabel: "interrupted-active",
      workerImage: "arena-public-worker:local",
      attempt: 1,
      env: {
        ARENA_PROJECT_ID: "project-active-1",
        ARENA_AGENT: "codex",
      },
    });
  });
});
