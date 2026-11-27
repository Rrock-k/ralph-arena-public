import { describe, expect, it, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  projectFindUnique: vi.fn(),
  projectFindMany: vi.fn(),
  userFindMany: vi.fn(),
  accessGrantFindMany: vi.fn(),
  accessAuditLogFindMany: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    project: {
      findUnique: mocks.projectFindUnique,
      findMany: mocks.projectFindMany,
    },
    user: {
      findMany: mocks.userFindMany,
    },
    accessGrant: {
      findMany: mocks.accessGrantFindMany,
    },
    accessAuditLog: {
      findMany: mocks.accessAuditLogFindMany,
    },
  },
}));

import {
  listProjectAccessPanelStates,
  listProjectAccessSubjects,
} from "./server";

const now = new Date("2026-05-10T10:00:00.000Z");
const syncTime = new Date("2026-05-10T10:05:00.000Z");

function grantRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "grant-1",
    subjectUserId: "user-manager",
    scopeType: "project",
    scopeId: "project-1",
    sourcePresetKey: "project_manager",
    sourceKind: "manual",
    sourceSyncedAt: null,
    customLabel: null,
    capabilities: ["project.view"],
    grantedById: "user-owner",
    reason: null,
    expiresAt: null,
    revokedAt: null,
    createdAt: now,
    updatedAt: now,
    subjectUser: {
      id: "user-manager",
      email: "person4@example.com",
      name: "Manager",
      image: null,
      role: "USER",
    },
    grantedBy: {
      id: "user-owner",
      email: "person3@example.com",
      name: "Owner",
    },
    ...overrides,
  };
}

describe("access-control server project-scoped views", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("lists only project-known subjects for project-scoped access grants", async () => {
    mocks.projectFindUnique.mockResolvedValueOnce({
      ownerScopeType: "user",
      ownerScopeId: "user-owner",
    });
    mocks.accessGrantFindMany.mockResolvedValueOnce([grantRow()]);
    mocks.userFindMany.mockResolvedValueOnce([
      {
        id: "user-owner",
        email: "person3@example.com",
        name: "Owner",
        image: null,
        role: "USER",
      },
      {
        id: "user-manager",
        email: "person4@example.com",
        name: "Manager",
        image: null,
        role: "USER",
      },
    ]);

    await expect(listProjectAccessSubjects("project-1")).resolves.toEqual([
      {
        id: "user-owner",
        email: "person3@example.com",
        name: "Owner",
        imageUrl: null,
      },
      {
        id: "user-manager",
        email: "person4@example.com",
        name: "Manager",
        imageUrl: null,
      },
    ]);
    expect(mocks.userFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: { in: ["user-owner", "user-manager"] } },
    }));
  });

  it("omits inherited platform grants by default for a project-scoped panel", async () => {
    mocks.projectFindMany.mockResolvedValueOnce([{
      id: "project-1",
      name: "Project One",
      ownerScopeType: null,
      ownerScopeId: null,
      proposal: null,
    }]);
    mocks.accessGrantFindMany.mockResolvedValueOnce([grantRow()]);

    const states = await listProjectAccessPanelStates(["project-1"]);

    expect(states["project-1"].inheritedSources).toEqual([]);
    expect(states["project-1"].directGrants).toHaveLength(1);
    expect(states["project-1"].directGrants[0]).toMatchObject({
      sourceKind: "manual",
      lastSyncedAt: null,
    });
    expect(mocks.accessGrantFindMany).toHaveBeenCalledTimes(1);
    expect(mocks.accessGrantFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        scopeType: "project",
        scopeId: { in: ["project-1"] },
      },
    }));
  });

  it("includes project owner and Telegram sync metadata in project-scoped panel state", async () => {
    mocks.projectFindMany.mockResolvedValueOnce([{
      id: "project-1",
      name: "Project One",
      ownerScopeType: "user",
      ownerScopeId: "user-owner",
      proposal: null,
    }]);
    mocks.accessGrantFindMany.mockResolvedValueOnce([
      grantRow({
        id: "grant-telegram",
        sourceKind: "telegram_admin_sync",
        sourceSyncedAt: syncTime,
        reason: "Auto-synced from tg-spec Telegram curator role (tg-project-1, Telegram 777)",
      }),
    ]);
    mocks.userFindMany.mockResolvedValueOnce([
      {
        id: "user-owner",
        email: "person3@example.com",
        name: "Owner",
        image: null,
        role: "USER",
      },
    ]);

    const states = await listProjectAccessPanelStates(["project-1"]);

    expect(states["project-1"].owner).toEqual({
      id: "user-owner",
      email: "person3@example.com",
      name: "Owner",
      imageUrl: null,
    });
    expect(states["project-1"].directGrants[0]).toMatchObject({
      id: "grant-telegram",
      sourceKind: "telegram_admin_sync",
      lastSyncedAt: syncTime.toISOString(),
    });
    expect(mocks.userFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: { in: ["user-owner"] } },
    }));
  });

  it("includes inherited platform grants only when explicitly requested", async () => {
    mocks.projectFindMany.mockResolvedValueOnce([{
      id: "project-1",
      name: "Project One",
      ownerScopeType: null,
      ownerScopeId: null,
      proposal: null,
    }]);
    mocks.accessGrantFindMany
      .mockResolvedValueOnce([grantRow()])
      .mockResolvedValueOnce([
        grantRow({
          id: "grant-platform",
          scopeType: "platform",
          scopeId: null,
          sourcePresetKey: "ops_admin",
          capabilities: ["project.view"],
        }),
      ]);

    const states = await listProjectAccessPanelStates(["project-1"], {
      includeInheritedSources: true,
    });

    expect(states["project-1"].inheritedSources).toHaveLength(1);
    expect(states["project-1"].inheritedSources[0]).toMatchObject({
      kind: "inherited",
      scope: { type: "platform", label: "Platform" },
      capabilities: ["project.view"],
    });
    expect(mocks.accessGrantFindMany).toHaveBeenCalledTimes(2);
  });
});
