import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
}));

vi.mock("@/lib/e2e-auth-bypass", () => ({
  hasE2EAdminBypass: vi.fn(),
}));

vi.mock("@/lib/access-control/server", () => ({
  listRelevantGrantRowsForUser: vi.fn().mockResolvedValue([]),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    project: {
      findUnique: vi.fn(),
    },
  },
}));

import { resolveProjectAccess } from "./project-access";

const guestSession = null;
const userSession = {
  user: {
    id: "user-1",
    role: "USER",
  },
} as any;
describe("resolveProjectAccess", () => {
  it("allows guests to view featured community projects", async () => {
    const access = await resolveProjectAccess(
      {
        id: "project-1",
        mode: "community",
        visibility: "featured",
        ownerScopeType: "user",
        ownerScopeId: "user-1",
      },
      guestSession,
    );

    expect(access.canView).toBe(true);
    expect(access.canManage).toBe(false);
  });

  it("blocks guests from viewing public projects", async () => {
    const access = await resolveProjectAccess(
      {
        id: "project-1",
        mode: "community",
        visibility: "public",
        ownerScopeType: "user",
        ownerScopeId: "user-1",
      },
      guestSession,
    );

    expect(access.canView).toBe(false);
  });

  it("allows authenticated users to view public personal projects", async () => {
    const access = await resolveProjectAccess(
      {
        id: "project-1",
        mode: "personal",
        visibility: "public",
        ownerScopeType: "user",
        ownerScopeId: "user-2",
      },
      userSession,
    );

    expect(access.canView).toBe(true);
    expect(access.canManage).toBe(false);
  });

  it("blocks guests from viewing private community projects", async () => {
    const access = await resolveProjectAccess(
      {
        id: "project-1",
        mode: "community",
        visibility: "private",
        ownerScopeType: "user",
        ownerScopeId: "user-1",
      },
      guestSession,
    );

    expect(access.canView).toBe(false);
    expect(access.canAccessPrivate).toBe(false);
  });

  it("allows the owner to view and manage private community projects", async () => {
    const access = await resolveProjectAccess(
      {
        id: "project-1",
        mode: "community",
        visibility: "private",
        ownerScopeType: "user",
        ownerScopeId: "user-1",
      },
      userSession,
    );

    expect(access.canView).toBe(true);
    expect(access.canAccessPrivate).toBe(true);
    expect(access.canManage).toBe(true);
  });

  it("allows guests to view featured personal projects", async () => {
    const access = await resolveProjectAccess(
      {
        id: "project-1",
        mode: "personal",
        visibility: "featured",
        ownerScopeType: "user",
        ownerScopeId: "user-1",
      },
      guestSession,
    );

    expect(access.canView).toBe(true);
  });

  it("allows the owner to manage personal projects", async () => {
    const access = await resolveProjectAccess(
      {
        id: "project-1",
        mode: "personal",
        visibility: "private",
        ownerScopeType: "user",
        ownerScopeId: "user-1",
      },
      userSession,
    );

    expect(access.canView).toBe(true);
    expect(access.canManage).toBe(true);
  });

  it("allows e2e bypass to view and manage any project", async () => {
    const access = await resolveProjectAccess(
      {
        id: "project-1",
        mode: "personal",
        visibility: "private",
        ownerScopeType: "user",
        ownerScopeId: "user-1",
      },
      guestSession,
      true,
    );

    expect(access.canView).toBe(true);
    expect(access.canAccessPrivate).toBe(true);
    expect(access.canManage).toBe(true);
  });
});
