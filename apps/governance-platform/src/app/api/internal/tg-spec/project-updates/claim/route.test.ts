import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

vi.mock("@/lib/internal-auth", () => ({
  isTgSpecInternalAuthorized: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {},
}));

vi.mock("@/lib/project-update-outbox", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/project-update-outbox")>();
  return {
    ...actual,
    claimProjectUpdates: vi.fn(),
    findActiveProjectUpdateDeliveryTarget: vi.fn(),
  };
});

import { isTgSpecInternalAuthorized } from "@/lib/internal-auth";
import { claimProjectUpdates, findActiveProjectUpdateDeliveryTarget } from "@/lib/project-update-outbox";

describe("POST /api/internal/tg-spec/project-updates/claim", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isTgSpecInternalAuthorized).mockReturnValue(true);
  });

  it("rejects unauthorized requests", async () => {
    vi.mocked(isTgSpecInternalAuthorized).mockReturnValue(false);

    const res = await POST(new Request("http://localhost/api/internal/tg-spec/project-updates/claim", {
      method: "POST",
      body: JSON.stringify({}),
    }));

    expect(res.status).toBe(401);
  });

  it("claims updates and serializes safe event rows", async () => {
    vi.mocked(claimProjectUpdates as any).mockResolvedValue([{
      id: "event-1",
      projectId: "project-1",
      eventType: "work.started",
      audience: "project_contributors",
      requiredCapability: "project.view",
      dedupeKey: "work.started:run-1",
      leaseId: "lease-1",
      payload: { phase: "work_started" },
      attempts: 1,
      createdAt: new Date("2026-05-10T08:00:00.000Z"),
    }]);

    const res = await POST(new Request("http://localhost/api/internal/tg-spec/project-updates/claim", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        audiences: ["project_contributors"],
        consumerId: "tg-spec-test",
      }),
    }));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      updates: [{
        id: "event-1",
        projectId: "project-1",
        eventType: "work.started",
        audience: "project_contributors",
        requiredCapability: "project.view",
        dedupeKey: "work.started:run-1",
        leaseId: "lease-1",
        payload: { phase: "work_started" },
        attempts: 1,
        createdAt: "2026-05-10T08:00:00.000Z",
      }],
    });
  });

  it("rejects manager audiences without an active delivery target", async () => {
    const res = await POST(new Request("http://localhost/api/internal/tg-spec/project-updates/claim", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        audiences: ["project_managers"],
      }),
    }));

    expect(res.status).toBe(403);
    expect(claimProjectUpdates).not.toHaveBeenCalled();
  });

  it("claims manager updates with an active Arena-owned delivery target", async () => {
    vi.mocked(findActiveProjectUpdateDeliveryTarget as any).mockResolvedValue({
      id: "target-1",
      projectId: "project-1",
      audience: "project_managers",
      requiredCapability: "project.secrets.manage",
      status: "ACTIVE",
    });
    vi.mocked(claimProjectUpdates as any).mockResolvedValue([{
      id: "event-2",
      projectId: "project-1",
      eventType: "required_secret.missing",
      audience: "project_managers",
      requiredCapability: "project.secrets.manage",
      dedupeKey: "required_secret.missing:test",
      leaseId: "lease-2",
      payload: { requiredSecretKeys: ["TELEGRAM_BOT_TOKEN"], count: 1 },
      attempts: 1,
      createdAt: new Date("2026-05-10T09:00:00.000Z"),
    }]);

    const res = await POST(new Request("http://localhost/api/internal/tg-spec/project-updates/claim", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        audiences: ["project_managers"],
        targetId: "target-1",
        consumerId: "tg-spec-test",
      }),
    }));

    expect(res.status).toBe(200);
    expect(findActiveProjectUpdateDeliveryTarget).toHaveBeenCalledWith(expect.anything(), {
      targetId: "target-1",
      audience: "project_managers",
      requiredCapability: "project.secrets.manage",
      sourceSystem: "tg-spec",
      targetKind: "telegram_chat_topic",
    });
    expect(claimProjectUpdates).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      allowedAudiences: ["project_managers"],
      targetId: "target-1",
    }));
    await expect(res.json()).resolves.toEqual({
      updates: [expect.objectContaining({
        id: "event-2",
        audience: "project_managers",
        requiredCapability: "project.secrets.manage",
        leaseId: "lease-2",
      })],
    });
  });
});
