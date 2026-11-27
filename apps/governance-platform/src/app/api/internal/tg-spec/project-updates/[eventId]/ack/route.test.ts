import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

vi.mock("@/lib/internal-auth", () => ({
  isTgSpecInternalAuthorized: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {},
}));

vi.mock("@/lib/project-update-outbox", () => ({
  ackProjectUpdateDelivery: vi.fn(),
}));

import { isTgSpecInternalAuthorized } from "@/lib/internal-auth";
import { ackProjectUpdateDelivery } from "@/lib/project-update-outbox";

describe("POST /api/internal/tg-spec/project-updates/[eventId]/ack", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isTgSpecInternalAuthorized).mockReturnValue(true);
  });

  it("rejects unauthorized requests", async () => {
    vi.mocked(isTgSpecInternalAuthorized).mockReturnValue(false);

    const res = await POST(
      new Request("http://localhost/api/internal/tg-spec/project-updates/event-1/ack", {
        method: "POST",
        body: JSON.stringify({ status: "DELIVERED", leaseId: "lease-1" }),
      }),
      { params: Promise.resolve({ eventId: "event-1" }) },
    );

    expect(res.status).toBe(401);
  });

  it("acks delivered update events", async () => {
    vi.mocked(ackProjectUpdateDelivery as any).mockResolvedValue({
      id: "event-1",
      status: "DELIVERED",
    });

    const res = await POST(
      new Request("http://localhost/api/internal/tg-spec/project-updates/event-1/ack", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          status: "DELIVERED",
          leaseId: "lease-1",
          externalMessageId: "telegram:42:100",
        }),
      }),
      { params: Promise.resolve({ eventId: "event-1" }) },
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      ok: true,
      status: "DELIVERED",
    });
    expect(ackProjectUpdateDelivery).toHaveBeenCalledWith(expect.any(Object), {
      id: "event-1",
      leaseId: "lease-1",
      status: "DELIVERED",
      consumerId: undefined,
      externalMessageId: "telegram:42:100",
      error: undefined,
    });
  });

  it("returns 404 when the event does not exist", async () => {
    vi.mocked(ackProjectUpdateDelivery as any).mockResolvedValue(null);

    const res = await POST(
      new Request("http://localhost/api/internal/tg-spec/project-updates/missing/ack", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: "FAILED", leaseId: "lease-missing", error: "missing" }),
      }),
      { params: Promise.resolve({ eventId: "missing" }) },
    );

    expect(res.status).toBe(409);
  });
});
