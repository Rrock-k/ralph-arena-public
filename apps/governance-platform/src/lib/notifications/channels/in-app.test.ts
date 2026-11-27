import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    inAppNotification: {
      findFirst: vi.fn(),
      create: vi.fn(),
    },
  },
}));

vi.mock("@/lib/progress-bus", () => ({
  progressBus: {
    notifyChanged: vi.fn(),
  },
}));

import { prisma } from "@/lib/prisma";
import { progressBus } from "@/lib/progress-bus";
import { inAppChannel } from "./in-app";

describe("inAppChannel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked((prisma as any).inAppNotification.findFirst).mockResolvedValue(null);
    vi.mocked((prisma as any).inAppNotification.create).mockResolvedValue({ id: "notif-1" });
  });

  it("creates a new project.failed notification when no unread sticky notification exists", async () => {
    const result = await inAppChannel.send(
      { userId: "user-1", email: "user@example.com" },
      {
        type: "project.failed",
        projectId: "project-1",
        projectName: "Ant Dream",
        error: "Build failed",
      },
      { unsubscribeUrl: "https://example.com/unsub" },
    );

    expect((prisma as any).inAppNotification.findFirst).toHaveBeenCalledWith({
      where: {
        userId: "user-1",
        eventType: "project.failed",
        projectId: "project-1",
        read: false,
      },
      select: { id: true },
      orderBy: { createdAt: "desc" },
    });
    expect((prisma as any).inAppNotification.create).toHaveBeenCalled();
    expect(progressBus.notifyChanged).toHaveBeenCalledWith({
      type: "in_app_notification",
    });
    expect(result).toEqual({ externalId: "notif-1" });
  });

  it("reuses existing unread sticky project.failed notifications instead of duplicating them", async () => {
    vi.mocked((prisma as any).inAppNotification.findFirst).mockResolvedValue({ id: "notif-existing" });

    const result = await inAppChannel.send(
      { userId: "user-1", email: "user@example.com" },
      {
        type: "project.failed",
        projectId: "project-1",
        projectName: "Ant Dream",
        error: "Build failed",
      },
      { unsubscribeUrl: "https://example.com/unsub" },
    );

    expect((prisma as any).inAppNotification.create).not.toHaveBeenCalled();
    expect(progressBus.notifyChanged).not.toHaveBeenCalled();
    expect(result).toEqual({ externalId: "notif-existing" });
  });

  it("reuses existing unread sticky project.deployed notifications instead of duplicating reboot noise", async () => {
    vi.mocked((prisma as any).inAppNotification.findFirst).mockResolvedValue({ id: "notif-existing" });

    const result = await inAppChannel.send(
      { userId: "user-1", email: "user@example.com" },
      {
        type: "project.deployed",
        projectId: "project-1",
        projectName: "Ant Dream",
        previewUrl: "https://preview.example.com",
      },
      { unsubscribeUrl: "https://example.com/unsub" },
    );

    expect((prisma as any).inAppNotification.findFirst).toHaveBeenCalledWith({
      where: {
        userId: "user-1",
        eventType: "project.deployed",
        projectId: "project-1",
        read: false,
      },
      select: { id: true },
      orderBy: { createdAt: "desc" },
    });
    expect((prisma as any).inAppNotification.create).not.toHaveBeenCalled();
    expect(progressBus.notifyChanged).not.toHaveBeenCalled();
    expect(result).toEqual({ externalId: "notif-existing" });
  });

  it("does not dedupe non-sticky events", async () => {
    const result = await inAppChannel.send(
      { userId: "user-1", email: "user@example.com" },
      {
        type: "proposal.approved",
        proposalId: "proposal-1",
        proposalTitle: "Arena",
      },
      { unsubscribeUrl: "https://example.com/unsub" },
    );

    expect((prisma as any).inAppNotification.findFirst).not.toHaveBeenCalled();
    expect((prisma as any).inAppNotification.create).toHaveBeenCalled();
    expect(result).toEqual({ externalId: "notif-1" });
  });
});
