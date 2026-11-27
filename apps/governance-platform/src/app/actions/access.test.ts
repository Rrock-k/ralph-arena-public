import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requirePlatformCapability: vi.fn(),
  requireProjectCapability: vi.fn(),
  revalidatePath: vi.fn(),
  userFindUnique: vi.fn(),
  projectFindUnique: vi.fn(),
  accessGrantFindFirst: vi.fn(),
  accessGrantFindUnique: vi.fn(),
  accessGrantCreate: vi.fn(),
  accessGrantUpdate: vi.fn(),
  accessAuditLogCreate: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock("server-only", () => ({}));

vi.mock("@/lib/platform-access", () => ({
  requirePlatformCapability: mocks.requirePlatformCapability,
}));

vi.mock("@/lib/project-access", () => ({
  requireProjectCapability: mocks.requireProjectCapability,
}));

vi.mock("next/cache", () => ({
  revalidatePath: mocks.revalidatePath,
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      findUnique: mocks.userFindUnique,
    },
    project: {
      findUnique: mocks.projectFindUnique,
    },
    accessGrant: {
      findFirst: mocks.accessGrantFindFirst,
      findUnique: mocks.accessGrantFindUnique,
      create: mocks.accessGrantCreate,
      update: mocks.accessGrantUpdate,
    },
    accessAuditLog: {
      create: mocks.accessAuditLogCreate,
    },
    $transaction: mocks.transaction,
  },
}));

import {
  createProjectAccessGrant,
  revokeProjectAccessGrant,
} from "./access";

function mockProjectAccess() {
  mocks.requireProjectCapability.mockResolvedValue({
    authorized: true,
    session: { user: { id: "actor-1" } },
  });
}

describe("project-scoped access actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.transaction.mockImplementation(async (callback: any) => {
      if (typeof callback !== "function") return Promise.all(callback);
      return callback({
        accessGrant: {
          create: mocks.accessGrantCreate,
          update: mocks.accessGrantUpdate,
        },
        accessAuditLog: {
          create: mocks.accessAuditLogCreate,
        },
      });
    });
  });

  it("requires project.access.manage instead of platform.access.manage", async () => {
    mocks.requireProjectCapability.mockResolvedValue({
      authorized: false,
      error: "Project access denied",
    });

    const result = await createProjectAccessGrant("project-1", {
      subjectUserId: "user-2",
      sourcePresetKey: "project_viewer",
    });

    expect(result).toEqual({ success: false, error: "Project access denied" });
    expect(mocks.requireProjectCapability).toHaveBeenCalledWith("project-1", "project.access.manage");
    expect(mocks.requirePlatformCapability).not.toHaveBeenCalled();
  });

  it("creates only project-scoped grants for the selected project", async () => {
    mockProjectAccess();
    mocks.userFindUnique.mockResolvedValue({ id: "user-2" });
    mocks.projectFindUnique.mockResolvedValue({ id: "project-1" });
    mocks.accessGrantFindFirst.mockResolvedValue(null);
    mocks.accessGrantCreate.mockResolvedValue({
      id: "grant-1",
      scopeType: "project",
      scopeId: "project-1",
    });

    const result = await createProjectAccessGrant("project-1", {
      subjectUserId: "user-2",
      sourcePresetKey: "project_viewer",
      reason: "join",
    });

    expect(result).toEqual({ success: true, grantId: "grant-1" });
    expect(mocks.accessGrantCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        subjectUserId: "user-2",
        scopeType: "project",
        scopeId: "project-1",
        sourcePresetKey: "project_viewer",
        sourceKind: "manual",
        capabilities: ["project.view"],
        grantedById: "actor-1",
        reason: "join",
      }),
      select: {
        id: true,
        scopeType: true,
        scopeId: true,
      },
    });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/my/projects/project-1");
    expect(mocks.requirePlatformCapability).not.toHaveBeenCalled();
  });

  it("rejects platform presets on the project-scoped grant path", async () => {
    mockProjectAccess();

    const result = await createProjectAccessGrant("project-1", {
      subjectUserId: "user-2",
      sourcePresetKey: "superadmin",
    });

    expect(result).toEqual({
      success: false,
      error: "Only project-scoped presets can be granted here",
    });
    expect(mocks.accessGrantCreate).not.toHaveBeenCalled();
  });

  it("requires project.access.manage before revoking project-scoped grants", async () => {
    mocks.requireProjectCapability.mockResolvedValue({
      authorized: false,
      error: "Project access denied",
    });

    const result = await revokeProjectAccessGrant("project-1", "grant-1");

    expect(result).toEqual({ success: false, error: "Project access denied" });
    expect(mocks.requireProjectCapability).toHaveBeenCalledWith("project-1", "project.access.manage");
    expect(mocks.accessGrantFindUnique).not.toHaveBeenCalled();
    expect(mocks.accessGrantUpdate).not.toHaveBeenCalled();
  });

  it("rejects revoking grants outside the selected project", async () => {
    mockProjectAccess();
    mocks.accessGrantFindUnique.mockResolvedValue({
      id: "grant-1",
      subjectUserId: "user-2",
      scopeType: "project",
      scopeId: "project-2",
      sourcePresetKey: "project_viewer",
      sourceKind: "manual",
      capabilities: ["project.view"],
      revokedAt: null,
    });

    const result = await revokeProjectAccessGrant("project-1", "grant-1");

    expect(result).toEqual({ success: false, error: "Grant is outside this project" });
    expect(mocks.accessGrantUpdate).not.toHaveBeenCalled();
  });

  it("revokes project-scoped grants for the selected project", async () => {
    mockProjectAccess();
    mocks.accessGrantFindUnique.mockResolvedValue({
      id: "grant-1",
      subjectUserId: "user-2",
      scopeType: "project",
      scopeId: "project-1",
      sourcePresetKey: "project_viewer",
      sourceKind: "manual",
      capabilities: ["project.view"],
      revokedAt: null,
    });

    const result = await revokeProjectAccessGrant("project-1", "grant-1");

    expect(result).toEqual({ success: true });
    expect(mocks.accessGrantUpdate).toHaveBeenCalledWith({
      where: { id: "grant-1" },
      data: { revokedAt: expect.any(Date) },
    });
    expect(mocks.accessAuditLogCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "grant_revoked",
        actorUserId: "actor-1",
        subjectUserId: "user-2",
        scopeType: "project",
        scopeId: "project-1",
        sourceKind: "manual",
      }),
    });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/my/projects/project-1");
  });
});
