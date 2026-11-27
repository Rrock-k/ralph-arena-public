import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  projectFindUnique: vi.fn(),
  accessGrantFindMany: vi.fn(),
  accessGrantCreate: vi.fn(),
  accessGrantUpdate: vi.fn(),
  accessAuditLogCreate: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    project: {
      findUnique: mocks.projectFindUnique,
    },
    accessGrant: {
      findMany: mocks.accessGrantFindMany,
      update: mocks.accessGrantUpdate,
    },
    $transaction: mocks.transaction,
  },
}));

import { syncTgSpecProjectAccessForTelegramViewer } from "./tg-spec-project-access";

describe("syncTgSpecProjectAccessForTelegramViewer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    vi.stubEnv("TG_SPEC_INTERNAL_BASE_URL", "http://tg-spec.internal");
    vi.stubEnv("ARENA_PUSH_SECRET", "push-secret");
    mocks.projectFindUnique.mockResolvedValue({
      id: "arena-project-1",
      tgSpecSourceProjectId: "tg-project-1",
    });
    mocks.accessGrantFindMany.mockResolvedValue([]);
    mocks.accessGrantCreate.mockResolvedValue({ id: "grant-1" });
    mocks.accessGrantUpdate.mockResolvedValue({});
    mocks.accessAuditLogCreate.mockResolvedValue({});
    mocks.transaction.mockImplementation(async (callback) => callback({
      accessGrant: {
        create: mocks.accessGrantCreate,
        update: mocks.accessGrantUpdate,
      },
      accessAuditLog: {
        create: mocks.accessAuditLogCreate,
      },
    }));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          project: { id: "tg-project-1" },
          membership: { role: "curator", telegramUserId: "777" },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    ));
  });

  it("does nothing for projects that are not sourced from tg-spec", async () => {
    mocks.projectFindUnique.mockResolvedValue({
      id: "arena-project-1",
      tgSpecSourceProjectId: null,
    });

    await expect(syncTgSpecProjectAccessForTelegramViewer({
      projectId: "arena-project-1",
      arenaUserId: "arena-user-1",
      telegramUserId: "777",
    })).resolves.toEqual({ status: "not_applicable" });

    expect(fetch).not.toHaveBeenCalled();
    expect(mocks.accessGrantCreate).not.toHaveBeenCalled();
  });

  it("creates a project manager grant for a tg-spec Telegram curator", async () => {
    await expect(syncTgSpecProjectAccessForTelegramViewer({
      projectId: "arena-project-1",
      arenaUserId: "arena-user-1",
      telegramUserId: "777",
    })).resolves.toEqual({
      status: "granted",
      role: "curator",
      presetKey: "project_manager",
      grantId: "grant-1",
    });

    expect(fetch).toHaveBeenCalledWith(
      "http://tg-spec.internal/api/internal/arena/projects/arena-project-1/telegram-membership",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "content-type": "application/json",
          "x-evolution-push-secret": "push-secret",
        }),
        body: JSON.stringify({ telegramUserId: "777" }),
      }),
    );
    expect(mocks.accessGrantCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        subjectUserId: "arena-user-1",
        scopeType: "project",
        scopeId: "arena-project-1",
        sourcePresetKey: "project_manager",
        sourceKind: "telegram_admin_sync",
        sourceSyncedAt: expect.any(Date),
        capabilities: ["project.required_secrets.manage", "project.secrets.manage", "project.view"],
        expiresAt: expect.any(Date),
      }),
      select: { id: true },
    });
    expect(mocks.accessAuditLogCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "grant_created",
        subjectUserId: "arena-user-1",
        scopeType: "project",
        scopeId: "arena-project-1",
        sourcePresetKey: "project_manager",
        sourceKind: "telegram_admin_sync",
        nextCapabilities: ["project.required_secrets.manage", "project.secrets.manage", "project.view"],
      }),
    });
    expect(mocks.accessGrantFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        revokedAt: null,
      }),
    }));
  });

  it("creates only a project viewer grant for a tg-spec contributor", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          project: { id: "tg-project-1" },
          membership: { role: "contributor", telegramUserId: "888" },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    await expect(syncTgSpecProjectAccessForTelegramViewer({
      projectId: "arena-project-1",
      arenaUserId: "arena-user-2",
      telegramUserId: "888",
    })).resolves.toMatchObject({
      status: "granted",
      role: "contributor",
      presetKey: "project_viewer",
    });

    expect(mocks.accessGrantCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        sourcePresetKey: "project_viewer",
        sourceKind: "telegram_admin_sync",
        sourceSyncedAt: expect.any(Date),
        capabilities: ["project.view"],
        expiresAt: expect.any(Date),
      }),
      select: { id: true },
    });
  });

  it("creates a short-lived project viewer grant for a current supergroup viewer", async () => {
    vi.useFakeTimers();
    const now = new Date("2026-05-12T10:00:00.000Z");
    vi.setSystemTime(now);
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          project: { id: "tg-project-1" },
          membership: { role: "viewer", telegramUserId: "889" },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    await expect(syncTgSpecProjectAccessForTelegramViewer({
      projectId: "arena-project-1",
      arenaUserId: "arena-user-3",
      telegramUserId: "889",
    })).resolves.toMatchObject({
      status: "granted",
      role: "viewer",
      presetKey: "project_viewer",
    });

    expect(mocks.accessGrantCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        sourcePresetKey: "project_viewer",
        sourceKind: "telegram_admin_sync",
        sourceSyncedAt: now,
        capabilities: ["project.view"],
        expiresAt: new Date("2026-05-12T10:30:00.000Z"),
      }),
      select: { id: true },
    });
    vi.useRealTimers();
  });

  it("does not create a duplicate grant when the user already has the needed capabilities", async () => {
    mocks.accessGrantFindMany.mockResolvedValue([{
      id: "manual-grant",
      capabilities: ["project.view", "project.secrets.manage", "project.required_secrets.manage"],
      expiresAt: null,
      reason: "Manual project manager grant",
      sourceKind: "manual",
      sourcePresetKey: "project_manager",
    }]);

    await expect(syncTgSpecProjectAccessForTelegramViewer({
      projectId: "arena-project-1",
      arenaUserId: "arena-user-1",
      telegramUserId: "777",
    })).resolves.toEqual({
      status: "already_granted",
      role: "curator",
      presetKey: "project_manager",
    });

    expect(mocks.accessGrantCreate).not.toHaveBeenCalled();
    expect(mocks.accessGrantUpdate).not.toHaveBeenCalled();
  });

  it("converts old permanent tg-spec auto-synced grants into expiring grants", async () => {
    vi.useFakeTimers();
    const now = new Date("2026-05-12T11:00:00.000Z");
    vi.setSystemTime(now);
    mocks.accessGrantFindMany.mockResolvedValue([{
      id: "old-auto-grant",
      capabilities: ["project.view", "project.secrets.manage", "project.required_secrets.manage"],
      expiresAt: null,
      reason: "Auto-synced from tg-spec Telegram curator role (tg-project-1, Telegram 777)",
      sourceKind: "telegram_admin_sync",
      sourcePresetKey: "project_manager",
    }]);

    await expect(syncTgSpecProjectAccessForTelegramViewer({
      projectId: "arena-project-1",
      arenaUserId: "arena-user-1",
      telegramUserId: "777",
    })).resolves.toEqual({
      status: "already_granted",
      role: "curator",
      presetKey: "project_manager",
    });

    expect(mocks.accessGrantCreate).not.toHaveBeenCalled();
    expect(mocks.accessGrantUpdate).toHaveBeenCalledWith({
      where: { id: "old-auto-grant" },
      data: {
        expiresAt: new Date("2026-05-12T11:30:00.000Z"),
        sourceKind: "telegram_admin_sync",
        sourceSyncedAt: now,
      },
    });
    vi.useRealTimers();
  });

  it("downscopes an auto-synced curator grant when tg-spec now reports viewer", async () => {
    vi.useFakeTimers();
    const now = new Date("2026-05-12T12:00:00.000Z");
    vi.setSystemTime(now);
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          project: { sourceProjectId: "tg-project-1", id: "project-local-1" },
          membership: { role: "viewer", telegramUserId: "777" },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    mocks.accessGrantFindMany.mockResolvedValue([{
      id: "old-auto-grant",
      capabilities: ["project.view", "project.secrets.manage", "project.required_secrets.manage"],
      expiresAt: new Date("2026-05-12T12:20:00.000Z"),
      reason: "Auto-synced from tg-spec Telegram curator role (tg-project-1, Telegram 777)",
      sourceKind: "telegram_admin_sync",
      sourcePresetKey: "project_manager",
    }]);

    await expect(syncTgSpecProjectAccessForTelegramViewer({
      projectId: "arena-project-1",
      arenaUserId: "arena-user-1",
      telegramUserId: "777",
    })).resolves.toEqual({
      status: "already_granted",
      role: "viewer",
      presetKey: "project_viewer",
    });

    expect(mocks.accessGrantUpdate).toHaveBeenCalledWith({
      where: { id: "old-auto-grant" },
      data: expect.objectContaining({
        capabilities: ["project.view"],
        sourcePresetKey: "project_viewer",
        expiresAt: new Date("2026-05-12T12:30:00.000Z"),
        sourceKind: "telegram_admin_sync",
        sourceSyncedAt: now,
      }),
    });
    vi.useRealTimers();
  });

  it("does not grant access when tg-spec has no membership for that Telegram user", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          project: { id: "tg-project-1" },
          membership: { role: null, telegramUserId: "999" },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    await expect(syncTgSpecProjectAccessForTelegramViewer({
      projectId: "arena-project-1",
      arenaUserId: "arena-user-1",
      telegramUserId: "999",
    })).resolves.toEqual({ status: "no_membership" });

    expect(mocks.accessGrantCreate).not.toHaveBeenCalled();
  });
});
