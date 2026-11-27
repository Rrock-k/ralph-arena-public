import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

vi.mock("server-only", () => ({}));

vi.mock("@/lib/internal-auth", () => ({
  isTgSpecInternalAuthorized: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    account: {
      findUnique: vi.fn(),
    },
    project: {
      findUnique: vi.fn(),
    },
    runLog: {
      create: vi.fn(),
    },
  },
}));

vi.mock("@/app/actions/projects", () => ({
  createPersonalTgSpecProjectInternal: vi.fn(),
}));

import { createPersonalTgSpecProjectInternal } from "@/app/actions/projects";
import { isTgSpecInternalAuthorized } from "@/lib/internal-auth";
import { prisma } from "@/lib/prisma";

function request(body: unknown) {
  return new Request("http://localhost/api/internal/tg-spec/projects", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/internal/tg-spec/projects", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isTgSpecInternalAuthorized).mockReturnValue(true);
    vi.mocked(prisma.account.findUnique as any).mockResolvedValue({ userId: "user-1" });
    vi.mocked(prisma.project.findUnique as any).mockResolvedValue(null);
    vi.mocked(prisma.runLog.create as any).mockResolvedValue({});
    vi.mocked(createPersonalTgSpecProjectInternal as any).mockResolvedValue({
      success: true,
      projectId: "arena-project-1",
    });
  });

  it("rejects unauthorized requests", async () => {
    vi.mocked(isTgSpecInternalAuthorized).mockReturnValue(false);

    const res = await POST(request({}));

    expect(res.status).toBe(401);
    expect(createPersonalTgSpecProjectInternal).not.toHaveBeenCalled();
  });

  it("requires a linked Arena user for the Telegram creator", async () => {
    vi.mocked(prisma.account.findUnique as any).mockResolvedValue(null);

    const res = await POST(request({
      sourceProjectId: "tg-project-1",
      title: "Sushi Kitties",
      creatorTelegramUserId: "777",
      creatorRole: "curator",
    }));

    expect(res.status).toBe(403);
    expect(createPersonalTgSpecProjectInternal).not.toHaveBeenCalled();
  });

  it("rejects creator roles that are not allowed to create projects", async () => {
    const res = await POST(request({
      sourceProjectId: "tg-project-1",
      title: "Sushi Kitties",
      creatorTelegramUserId: "777",
      creatorRole: "viewer",
    }));

    expect(res.status).toBe(400);
    expect(createPersonalTgSpecProjectInternal).not.toHaveBeenCalled();
  });

  it("returns an existing project for an idempotent retry by the same owner", async () => {
    vi.mocked(prisma.project.findUnique as any).mockResolvedValue({
      id: "arena-project-existing",
      ownerScopeType: "user",
      ownerScopeId: "user-1",
    });

    const res = await POST(request({
      sourceProjectId: "tg-project-1",
      title: "Sushi Kitties",
      creatorTelegramUserId: "777",
      creatorRole: "curator",
    }));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      ok: true,
      created: false,
      duplicate: true,
      projectId: "arena-project-existing",
      sourceProjectId: "tg-project-1",
    });
    expect(createPersonalTgSpecProjectInternal).not.toHaveBeenCalled();
  });

  it("rejects a source project already linked to another Arena owner", async () => {
    vi.mocked(prisma.project.findUnique as any).mockResolvedValue({
      id: "arena-project-existing",
      ownerScopeType: "user",
      ownerScopeId: "other-user",
    });

    const res = await POST(request({
      sourceProjectId: "tg-project-1",
      title: "Sushi Kitties",
      creatorTelegramUserId: "777",
      creatorRole: "curator",
    }));

    expect(res.status).toBe(409);
    expect(createPersonalTgSpecProjectInternal).not.toHaveBeenCalled();
  });

  it("creates a dormant tg-spec target owned by the linked Telegram user", async () => {
    const res = await POST(request({
      sourceProjectId: "tg-project-1",
      title: "Sushi Kitties",
      creatorTelegramUserId: "777",
      creatorRole: "chat_admin",
      sourceChatId: "-100123",
      sourceMessageThreadId: 77,
      sourceTopicTitle: "Launch topic",
      sourceBotAdminCheckedAt: "2026-05-19T12:00:00.000Z",
      sourceActorAdminCheckedAt: "2026-05-19T12:00:01.000Z",
    }));

    expect(res.status).toBe(201);
    expect(prisma.account.findUnique).toHaveBeenCalledWith({
      where: {
        provider_providerAccountId: {
          provider: "telegram",
          providerAccountId: "777",
        },
      },
      select: { userId: true },
    });
    expect(createPersonalTgSpecProjectInternal).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Sushi Kitties",
        agent: "codex",
        agentImpl: "direct",
        runnerBackend: "local",
        providerBillingMode: "byok",
        addonIds: null,
      }),
      expect.objectContaining({
        ownerScopeId: "user-1",
        tgSpecSourceProjectId: "tg-project-1",
        awaitingLaunchConfiguration: true,
        allowMissingAddonSecrets: true,
      }),
    );
    expect(prisma.runLog.create).toHaveBeenCalledWith({
      data: {
        projectId: "arena-project-1",
        event: "TG_SPEC_CREATE_EVIDENCE",
        detail: JSON.stringify({
          sourceProjectId: "tg-project-1",
          creatorTelegramUserId: "777",
          creatorRole: "chat_admin",
          sourceChatId: "-100123",
          sourceMessageThreadId: 77,
          sourceTopicTitle: "Launch topic",
          sourceBotAdminCheckedAt: "2026-05-19T12:00:00.000Z",
          sourceActorAdminCheckedAt: "2026-05-19T12:00:01.000Z",
        }),
      },
    });
    await expect(res.json()).resolves.toEqual({
      ok: true,
      created: true,
      duplicate: false,
      projectId: "arena-project-1",
      sourceProjectId: "tg-project-1",
      requiresLaunchConfiguration: true,
      addonIds: [],
      requiredSecrets: [],
      requiresSecretConfiguration: false,
      missingRequiredSecrets: [],
    });
  });

  it("creates a Telegram Mini App add-on target without requiring secret values in the handoff", async () => {
    const res = await POST(request({
      sourceProjectId: "tg-project-1",
      title: "Sushi Kitties",
      creatorTelegramUserId: "777",
      creatorRole: "curator",
      addonIds: ["telegram_mini_app"],
    }));

    expect(res.status).toBe(201);
    expect(createPersonalTgSpecProjectInternal).toHaveBeenCalledWith(
      expect.objectContaining({
        addonIds: ["telegram_mini_app"],
      }),
      expect.objectContaining({
        allowMissingAddonSecrets: true,
      }),
    );
    await expect(res.json()).resolves.toEqual(expect.objectContaining({
      ok: true,
      created: true,
      projectId: "arena-project-1",
      addonIds: ["telegram_mini_app"],
      requiresSecretConfiguration: true,
      missingRequiredSecrets: ["TELEGRAM_BOT_TOKEN"],
      requiredSecrets: [
        expect.objectContaining({
          key: "TELEGRAM_BOT_TOKEN",
          blocking: true,
        }),
      ],
    }));
  });

  it("rejects chat_admin handoff without verified Telegram evidence", async () => {
    const res = await POST(request({
      sourceProjectId: "tg-project-1",
      title: "Sushi Kitties",
      creatorTelegramUserId: "777",
      creatorRole: "chat_admin",
    }));

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      error: "chat_admin handoff requires verified Telegram chat and bot-admin evidence",
    });
    expect(createPersonalTgSpecProjectInternal).not.toHaveBeenCalled();
  });

  it("keeps the tg-spec create handoff evidence-only", async () => {
    const res = await POST(request({
      sourceProjectId: "tg-project-1",
      title: "Sushi Kitties",
      creatorTelegramUserId: "777",
      creatorRole: "chat_admin",
      providerBillingMode: "platform_credentials",
    }));

    expect(res.status).toBe(400);
    expect(createPersonalTgSpecProjectInternal).not.toHaveBeenCalled();
  });
});
