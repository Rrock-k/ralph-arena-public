import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "./route";
import { createTransactionalUnsubscribeToken } from "@/lib/notifications/unsubscribe-token";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    notificationPreference: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
    newsletterSubscriber: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}));

import { prisma } from "@/lib/prisma";

describe("/api/notifications/unsubscribe", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.AUTH_SECRET = "test-auth-secret-with-enough-length";
  });

  it("rejects raw transactional params without a signed token", async () => {
    const response = await POST(new Request(
      "http://localhost/api/notifications/unsubscribe?userId=user-1&eventType=project.deployed&channel=email",
      { method: "POST" },
    ));

    expect(response.status).toBe(400);
    expect(prisma.notificationPreference.upsert).not.toHaveBeenCalled();
  });

  it("mutates transactional preferences with a valid signed token", async () => {
    const unsubscribeToken = createTransactionalUnsubscribeToken({
      userId: "user-1",
      eventType: "project.deployed",
      channel: "email",
    });

    const response = await POST(new Request(
      `http://localhost/api/notifications/unsubscribe?unsubscribeToken=${encodeURIComponent(unsubscribeToken)}`,
      { method: "POST" },
    ));

    expect(response.status).toBe(200);
    expect(prisma.notificationPreference.upsert).toHaveBeenCalledWith({
      where: {
        userId_eventType_channel_scopeType_scopeId: {
          userId: "user-1",
          eventType: "project.deployed",
          channel: "email",
          scopeType: "global",
          scopeId: "global",
        },
      },
      create: {
        userId: "user-1",
        eventType: "project.deployed",
        channel: "email",
        scopeType: "global",
        scopeId: "global",
        enabled: false,
      },
      update: { enabled: false },
    });
  });

  it("shows an invalid page for browser clicks without a signed token", async () => {
    const response = await GET(new Request(
      "http://localhost/api/notifications/unsubscribe?userId=user-1&eventType=project.deployed&channel=email",
    ));

    expect(response.status).toBe(400);
    expect(await response.text()).toContain("Invalid unsubscribe link.");
    expect(prisma.notificationPreference.upsert).not.toHaveBeenCalled();
  });

  it("keeps existing newsletter token unsubscribe behavior", async () => {
    vi.mocked(prisma.newsletterSubscriber.findUnique).mockResolvedValue({
      email: "reader@example.com",
      status: "SUBSCRIBED",
    } as any);

    const response = await GET(new Request(
      "http://localhost/api/notifications/unsubscribe?token=newsletter-token",
    ));

    expect(response.status).toBe(200);
    expect(prisma.newsletterSubscriber.update).toHaveBeenCalledWith({
      where: { unsubscribeToken: "newsletter-token" },
      data: { status: "UNSUBSCRIBED", unsubscribedAt: expect.any(Date) },
    });
  });
});
