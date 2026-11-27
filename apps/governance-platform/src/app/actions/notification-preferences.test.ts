import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    accessGrant: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
    },
    account: {
      findMany: vi.fn(),
    },
    notificationPreference: {
      findMany: vi.fn(),
      upsert: vi.fn(),
    },
    project: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
    },
  },
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { PROJECT_PERSONAL_NOTIFICATION_CHANNEL } from "@/lib/project-personal-notification-types";
import {
  getNotificationPreferences,
  getProjectPersonalNotificationPreferences,
  updateProjectPersonalNotificationPreference,
} from "./notification-preferences";

describe("notification preference actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(auth).mockResolvedValue({ user: { id: "user-1" } } as any);
    vi.mocked(prisma.accessGrant.findMany).mockResolvedValue([]);
    vi.mocked(prisma.accessGrant.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.account.findMany).mockResolvedValue([]);
    vi.mocked(prisma.notificationPreference.findMany).mockResolvedValue([]);
    vi.mocked(prisma.notificationPreference.upsert).mockResolvedValue({} as any);
    vi.mocked(prisma.project.findMany).mockResolvedValue([]);
    vi.mocked(prisma.project.findUnique).mockResolvedValue(null);
  });

  it("keeps legacy notification settings global scoped", async () => {
    vi.mocked(prisma.notificationPreference.findMany).mockResolvedValueOnce([
      {
        eventType: "project.failed",
        channel: "email",
        enabled: false,
      },
    ] as any);

    const result = await getNotificationPreferences();

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.preferences["project.deployed:email"]).toBe(true);
    expect(result.preferences["project.failed:email"]).toBe(false);
    expect(prisma.notificationPreference.findMany).toHaveBeenCalledWith({
      where: {
        userId: "user-1",
        scopeType: "global",
        scopeId: "global",
      },
      select: { eventType: true, channel: true, enabled: true },
    });
  });

  it("lists tg-spec projects where the user owns or has manager access", async () => {
    vi.mocked(prisma.accessGrant.findMany).mockResolvedValueOnce([
      { scopeType: "project", scopeId: "project-2" },
    ] as any);
    vi.mocked(prisma.project.findMany).mockResolvedValueOnce([
      {
        id: "project-1",
        name: "Owned Project",
        updatedAt: new Date("2026-05-13T10:00:00.000Z"),
      },
      {
        id: "project-2",
        name: "Granted Project",
        updatedAt: new Date("2026-05-13T11:00:00.000Z"),
      },
    ] as any);
    vi.mocked(prisma.account.findMany).mockResolvedValueOnce([
      { providerAccountId: "777" },
      {
        providerAccountId: "999999999999999999",
        scope: "openid profile",
        access_token: "oidc-token",
        id_token: "oidc-id-token",
      },
    ] as any);
    vi.mocked(prisma.notificationPreference.findMany).mockResolvedValueOnce([
      {
        eventType: "work.completed",
        scopeType: "global",
        scopeId: "global",
        enabled: false,
      },
      {
        eventType: "required_secret.missing",
        scopeType: "project",
        scopeId: "project-2",
        enabled: false,
      },
    ] as any);

    const result = await getProjectPersonalNotificationPreferences();

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.telegramAccountStatus).toBe("ready");
    expect(prisma.project.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        archivedAt: null,
        tgSpecSourceProjectId: { not: null },
        OR: expect.arrayContaining([
          { ownerScopeType: "user", ownerScopeId: "user-1" },
          { id: { in: ["project-2"] } },
        ]),
      }),
    }));
    expect(result.projects).toHaveLength(2);
    expect(result.projects[0].events.find((event) => event.eventType === "work.completed"))
      .toMatchObject({ enabled: false, source: "global" });
    expect(result.projects[1].events.find((event) => event.eventType === "required_secret.missing"))
      .toMatchObject({ enabled: false, source: "project" });
  });

  it("marks private Telegram delivery ambiguous only for multiple WebApp raw ids", async () => {
    vi.mocked(prisma.project.findMany).mockResolvedValueOnce([]);
    vi.mocked(prisma.account.findMany).mockResolvedValueOnce([
      { providerAccountId: "777" },
      { providerAccountId: "888" },
      {
        providerAccountId: "999999999999999999",
        scope: "openid profile",
        access_token: "oidc-token",
        id_token: "oidc-id-token",
      },
    ] as any);

    const result = await getProjectPersonalNotificationPreferences();

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.telegramAccountStatus).toBe("ambiguous");
  });

  it("updates project-scoped private Telegram preference for project owners", async () => {
    vi.mocked(prisma.project.findUnique).mockResolvedValueOnce({
      id: "project-1",
      archivedAt: null,
      tgSpecSourceProjectId: "tg-project-1",
      ownerScopeType: "user",
      ownerScopeId: "user-1",
    } as any);

    const result = await updateProjectPersonalNotificationPreference(
      " project-1 ",
      "work.completed",
      false,
    );

    expect(result).toEqual({ success: true });
    expect(prisma.accessGrant.findFirst).not.toHaveBeenCalled();
    expect(prisma.notificationPreference.upsert).toHaveBeenCalledWith({
      where: {
        userId_eventType_channel_scopeType_scopeId: {
          userId: "user-1",
          eventType: "work.completed",
          channel: PROJECT_PERSONAL_NOTIFICATION_CHANNEL,
          scopeType: "project",
          scopeId: "project-1",
        },
      },
      create: {
        userId: "user-1",
        eventType: "work.completed",
        channel: PROJECT_PERSONAL_NOTIFICATION_CHANNEL,
        scopeType: "project",
        scopeId: "project-1",
        enabled: false,
      },
      update: { enabled: false },
    });
    expect(revalidatePath).toHaveBeenCalledWith("/settings");
  });

  it("rejects private Telegram preference updates without current manager access", async () => {
    vi.mocked(prisma.project.findUnique).mockResolvedValueOnce({
      id: "project-1",
      archivedAt: null,
      tgSpecSourceProjectId: "tg-project-1",
      ownerScopeType: "user",
      ownerScopeId: "other-user",
    } as any);
    vi.mocked(prisma.accessGrant.findFirst).mockResolvedValueOnce(null);

    const result = await updateProjectPersonalNotificationPreference(
      "project-1",
      "required_secret.missing",
      false,
    );

    expect(result).toEqual({ success: false, error: "Project access denied" });
    expect(prisma.notificationPreference.upsert).not.toHaveBeenCalled();
  });

  it("rejects private Telegram preferences for non tg-spec projects", async () => {
    vi.mocked(prisma.project.findUnique).mockResolvedValueOnce({
      id: "project-1",
      archivedAt: null,
      tgSpecSourceProjectId: null,
      ownerScopeType: "user",
      ownerScopeId: "user-1",
    } as any);

    const result = await updateProjectPersonalNotificationPreference(
      "project-1",
      "work.failed",
      false,
    );

    expect(result).toEqual({ success: false, error: "Project access denied" });
    expect(prisma.notificationPreference.upsert).not.toHaveBeenCalled();
  });
});
