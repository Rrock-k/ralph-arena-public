import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Mocks ───────────────────────────────────────────────────────

vi.mock("@/lib/prisma", () => ({
  prisma: {
    notificationPreference: {
      findUnique: vi.fn(),
    },
    notificationLog: {
      create: vi.fn(),
    },
  },
}));

vi.mock("@/lib/feature-flags", () => ({
  isNotificationsEnabled: vi.fn(),
}));

vi.mock("./recipients", () => ({
  resolveRecipient: vi.fn(),
}));

vi.mock("./channels/email", () => ({
  emailChannel: {
    channel: "email" as const,
    send: vi.fn(),
  },
}));

vi.mock("./channels/in-app", () => ({
  inAppChannel: {
    channel: "in_app" as const,
    send: vi.fn(),
  },
}));

import { prisma } from "@/lib/prisma";
import { isNotificationsEnabled } from "@/lib/feature-flags";
import { resolveRecipient } from "./recipients";
import { emailChannel } from "./channels/email";
import { inAppChannel } from "./channels/in-app";
import { notify } from "./service";

describe("notify()", () => {
  const event = {
    type: "project.deployed" as const,
    projectId: "proj-1",
    projectName: "Test Project",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.AUTH_SECRET = "test-auth-secret-with-enough-length";
    // Default: notifications enabled, recipient found, no opt-out
    vi.mocked(isNotificationsEnabled).mockResolvedValue(true);
    vi.mocked(resolveRecipient).mockResolvedValue({
      userId: "user-1",
      email: "user@example.com",
    });
    vi.mocked((prisma as any).notificationPreference.findUnique).mockResolvedValue(null);
    vi.mocked(emailChannel.send).mockResolvedValue({ externalId: "resend-123" });
    vi.mocked(inAppChannel.send).mockResolvedValue({ externalId: "in-app-123" });
    vi.mocked((prisma as any).notificationLog.create).mockResolvedValue({ id: "log-1" });
  });

  it("sends email and logs SENT when everything works", async () => {
    await notify(event);

    expect(emailChannel.send).toHaveBeenCalledWith(
      { userId: "user-1", email: "user@example.com" },
      event,
      expect.objectContaining({ unsubscribeUrl: expect.stringContaining("/api/notifications/unsubscribe") }),
    );
    const emailSendOptions = vi.mocked(emailChannel.send).mock.calls[0]?.[2];
    expect(emailSendOptions).toBeDefined();
    const unsubscribeUrl = new URL(emailSendOptions!.unsubscribeUrl);
    expect(unsubscribeUrl.searchParams.get("unsubscribeToken")).toMatch(/^nu1\./);
    expect(unsubscribeUrl.searchParams.has("userId")).toBe(false);
    expect(unsubscribeUrl.searchParams.has("eventType")).toBe(false);
    expect(unsubscribeUrl.searchParams.has("channel")).toBe(false);

    expect((prisma as any).notificationLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: "user-1",
        eventType: "project.deployed",
        channel: "email",
        recipientEmail: "user@example.com",
        status: "SENT",
        resendEmailId: "resend-123",
      }),
    });
  });

  it("returns early when feature flag is off", async () => {
    vi.mocked(isNotificationsEnabled).mockResolvedValue(false);

    await notify(event);

    expect(resolveRecipient).not.toHaveBeenCalled();
    expect(emailChannel.send).not.toHaveBeenCalled();
  });

  it("returns early when no recipient found", async () => {
    vi.mocked(resolveRecipient).mockResolvedValue(null);

    await notify(event);

    expect(emailChannel.send).not.toHaveBeenCalled();
  });

  it("logs SKIPPED when user has opted out", async () => {
    vi.mocked((prisma as any).notificationPreference.findUnique).mockResolvedValue({
      enabled: false,
    });

    await notify(event);

    expect(emailChannel.send).not.toHaveBeenCalled();
    expect((prisma as any).notificationLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        status: "SKIPPED",
      }),
    });
  });

  it("logs FAILED when channel send throws", async () => {
    vi.mocked(emailChannel.send).mockRejectedValue(new Error("Resend API error: rate limit"));

    await notify(event);

    expect((prisma as any).notificationLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        status: "FAILED",
        error: "Resend API error: rate limit",
      }),
    });
  });

  it("does not throw when log creation fails", async () => {
    vi.mocked((prisma as any).notificationLog.create).mockRejectedValue(new Error("DB error"));

    // Should not throw
    await expect(notify(event)).resolves.toBeUndefined();
  });

  it("includes projectId in log for project events", async () => {
    await notify(event);

    expect((prisma as any).notificationLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        projectId: "proj-1",
      }),
    });
  });

  it("handles proposal.approved events", async () => {
    const proposalEvent = {
      type: "proposal.approved" as const,
      proposalId: "prop-1",
      proposalTitle: "My Proposal",
    };

    await notify(proposalEvent);

    expect(emailChannel.send).toHaveBeenCalledWith(
      { userId: "user-1", email: "user@example.com" },
      proposalEvent,
      expect.any(Object),
    );

    expect((prisma as any).notificationLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        eventType: "proposal.approved",
        projectId: undefined,
      }),
    });
  });
});
