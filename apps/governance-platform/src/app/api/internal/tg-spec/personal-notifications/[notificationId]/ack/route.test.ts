import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

vi.mock("@/lib/internal-auth", () => ({
  isTgSpecInternalAuthorized: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {},
}));

vi.mock("@/lib/project-personal-notifications", () => ({
  ackPersonalProjectNotificationDelivery: vi.fn(),
}));

import { isTgSpecInternalAuthorized } from "@/lib/internal-auth";
import { ackPersonalProjectNotificationDelivery } from "@/lib/project-personal-notifications";

describe("POST /api/internal/tg-spec/personal-notifications/[notificationId]/ack", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isTgSpecInternalAuthorized).mockReturnValue(true);
  });

  it("rejects unauthorized requests", async () => {
    vi.mocked(isTgSpecInternalAuthorized).mockReturnValue(false);

    const res = await POST(
      new Request("http://localhost/api/internal/tg-spec/personal-notifications/notification-1/ack", {
        method: "POST",
        body: JSON.stringify({ status: "DELIVERED", leaseId: "lease-1" }),
      }),
      { params: Promise.resolve({ notificationId: "notification-1" }) },
    );

    expect(res.status).toBe(401);
  });

  it("acks the personal notification lease", async () => {
    vi.mocked(ackPersonalProjectNotificationDelivery as any).mockResolvedValue({
      id: "notification-1",
      status: "DELIVERED",
    });

    const res = await POST(
      new Request("http://localhost/api/internal/tg-spec/personal-notifications/notification-1/ack", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          status: "DELIVERED",
          leaseId: "lease-1",
          consumerId: "tg-spec-test",
          externalMessageId: "telegram:777:100",
        }),
      }),
      { params: Promise.resolve({ notificationId: "notification-1" }) },
    );

    expect(res.status).toBe(200);
    expect(ackPersonalProjectNotificationDelivery).toHaveBeenCalledWith(expect.anything(), {
      id: "notification-1",
      leaseId: "lease-1",
      status: "DELIVERED",
      consumerId: "tg-spec-test",
      externalMessageId: "telegram:777:100",
      error: undefined,
    });
    await expect(res.json()).resolves.toEqual({
      ok: true,
      status: "DELIVERED",
    });
  });

  it("returns conflict for stale or unknown leases", async () => {
    vi.mocked(ackPersonalProjectNotificationDelivery as any).mockResolvedValue(null);

    const res = await POST(
      new Request("http://localhost/api/internal/tg-spec/personal-notifications/notification-1/ack", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: "DELIVERED", leaseId: "bad-lease" }),
      }),
      { params: Promise.resolve({ notificationId: "notification-1" }) },
    );

    expect(res.status).toBe(409);
  });
});
