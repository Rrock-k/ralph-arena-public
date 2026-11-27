import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

vi.mock("@/lib/internal-auth", () => ({
  isTgSpecInternalAuthorized: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {},
}));

vi.mock("@/lib/project-personal-notifications", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/project-personal-notifications")>();
  return {
    ...actual,
    claimPersonalProjectNotifications: vi.fn(),
  };
});

import { isTgSpecInternalAuthorized } from "@/lib/internal-auth";
import { claimPersonalProjectNotifications } from "@/lib/project-personal-notifications";

describe("POST /api/internal/tg-spec/personal-notifications/claim", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isTgSpecInternalAuthorized).mockReturnValue(true);
  });

  it("rejects unauthorized requests", async () => {
    vi.mocked(isTgSpecInternalAuthorized).mockReturnValue(false);

    const res = await POST(new Request("http://localhost/api/internal/tg-spec/personal-notifications/claim", {
      method: "POST",
      body: JSON.stringify({}),
    }));

    expect(res.status).toBe(401);
  });

  it("claims personal notifications and exposes only the Arena-approved target contract", async () => {
    vi.mocked(claimPersonalProjectNotifications as any).mockResolvedValue([{
      id: "notification-1",
      projectId: "project-1",
      recipientUserId: "manager-1",
      channel: "telegram_private",
      telegramUserId: "777",
      eventType: "required_secret.missing",
      audience: "project_managers",
      requiredCapability: "project.secrets.manage",
      dedupeKey: "required_secret.missing:run-1",
      leaseId: "lease-1",
      payload: { requiredSecretKeys: ["TELEGRAM_BOT_TOKEN"], count: 1 },
      attempts: 1,
      lockedBy: "tg-spec-test",
      status: "DELIVERING",
      createdAt: new Date("2026-05-13T10:00:00.000Z"),
    }]);

    const res = await POST(new Request("http://localhost/api/internal/tg-spec/personal-notifications/claim", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ consumerId: "tg-spec-test", limit: 5 }),
    }));

    expect(res.status).toBe(200);
    expect(claimPersonalProjectNotifications).toHaveBeenCalledWith(expect.anything(), {
      limit: 5,
      consumerId: "tg-spec-test",
    });
    await expect(res.json()).resolves.toEqual({
      notifications: [{
        id: "notification-1",
        projectId: "project-1",
        eventType: "required_secret.missing",
        audience: "project_managers",
        requiredCapability: "project.secrets.manage",
        channel: "telegram_private",
        telegramUserId: "777",
        dedupeKey: "required_secret.missing:run-1",
        leaseId: "lease-1",
        payload: { requiredSecretKeys: ["TELEGRAM_BOT_TOKEN"], count: 1 },
        attempts: 1,
        createdAt: "2026-05-13T10:00:00.000Z",
      }],
    });
  });

  it("rejects invalid claim limits", async () => {
    const res = await POST(new Request("http://localhost/api/internal/tg-spec/personal-notifications/claim", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ limit: 500 }),
    }));

    expect(res.status).toBe(400);
    expect(claimPersonalProjectNotifications).not.toHaveBeenCalled();
  });
});
