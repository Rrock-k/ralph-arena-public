import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
}));

vi.mock("@/lib/crypto", () => ({
  decryptSecret: vi.fn(),
  getEncryptionKey: vi.fn(() => "encryption-key"),
}));

vi.mock("@/lib/e2e-auth-bypass", () => ({
  hasE2EAdminBypass: vi.fn(),
}));

vi.mock("@/lib/handoff-tokens", () => ({
  createHandoffCode: vi.fn(() => "handoff-code"),
  exchangeHandoffCode: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    project: {
      findUnique: vi.fn(),
    },
  },
}));

vi.mock("@/lib/project-access", () => ({
  resolveProjectAccess: vi.fn(),
}));

vi.mock("@/lib/telegram-webapp-auth", () => ({
  TELEGRAM_WEBAPP_INIT_DATA_HEADER: "X-Telegram-WebApp-Init-Data",
  resolveTelegramWebAppSessionFromInitData: vi.fn(),
}));

vi.mock("@/lib/tg-spec-project-access", () => ({
  syncTgSpecProjectAccessForTelegramViewer: vi.fn(),
}));

import { auth } from "@/lib/auth";
import { decryptSecret } from "@/lib/crypto";
import { hasE2EAdminBypass } from "@/lib/e2e-auth-bypass";
import { createHandoffCode } from "@/lib/handoff-tokens";
import { prisma } from "@/lib/prisma";
import { resolveProjectAccess } from "@/lib/project-access";
import { resolveTelegramWebAppSessionFromInitData } from "@/lib/telegram-webapp-auth";
import { syncTgSpecProjectAccessForTelegramViewer } from "@/lib/tg-spec-project-access";
import { POST } from "./route";

function buildHashOnlyInitData() {
  const params = new URLSearchParams();
  params.set("auth_date", String(Math.floor(Date.now() / 1000)));
  params.set("query_id", "query-1");
  params.set("user", JSON.stringify({ id: "777", first_name: "Test" }));
  params.set("hash", "legacy-hmac-hash");
  return params.toString();
}

describe("POST /api/auth/handoff", () => {
  const project = {
    id: "project-1",
    mode: "personal",
    visibility: "private",
    ownerScopeType: "user",
    ownerScopeId: "user-1",
    secrets: [],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(hasE2EAdminBypass).mockResolvedValue(false);
    vi.mocked(prisma.project.findUnique).mockResolvedValue(project);
    vi.mocked(resolveProjectAccess).mockResolvedValue({ canView: true } as any);
    vi.mocked(syncTgSpecProjectAccessForTelegramViewer).mockResolvedValue({ status: "not_applicable" } as any);
  });

  it("requires an authenticated Arena or Telegram WebApp session", async () => {
    vi.mocked(auth).mockResolvedValue(null);

    const response = await POST(new NextRequest("http://localhost/api/auth/handoff", {
      method: "POST",
      body: JSON.stringify({ projectId: "project-1" }),
    }));

    expect(response.status).toBe(401);
    expect(createHandoffCode).not.toHaveBeenCalled();
  });

  it("creates a handoff code only after project access is confirmed", async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: "user-1", email: "user@example.com" } } as any);

    const response = await POST(new NextRequest("http://localhost/api/auth/handoff", {
      method: "POST",
      body: JSON.stringify({ projectId: "project-1" }),
    }));

    await expect(response.json()).resolves.toEqual({ code: "handoff-code" });
    expect(resolveProjectAccess).toHaveBeenCalledWith(
      project,
      expect.objectContaining({ user: expect.objectContaining({ id: "user-1" }) }),
      false,
    );
    expect(createHandoffCode).toHaveBeenCalledWith(
      "project-1",
      expect.objectContaining({ id: "user-1", email: "user@example.com" }),
    );
  });

  it("uses a verified Telegram WebApp session when provided", async () => {
    vi.mocked(auth).mockResolvedValue(null);
    vi.mocked(resolveTelegramWebAppSessionFromInitData).mockResolvedValue({
      status: "ok",
      telegramUserId: "123",
      session: { user: { id: "user-2", email: null } },
    } as any);

    const response = await POST(new NextRequest("http://localhost/api/auth/handoff", {
      method: "POST",
      headers: { "X-Telegram-WebApp-Init-Data": "signed-init-data" },
      body: JSON.stringify({ projectId: "project-1" }),
    }));

    expect(response.status).toBe(200);
    expect(resolveTelegramWebAppSessionFromInitData).toHaveBeenCalledWith("signed-init-data");
    expect(createHandoffCode).toHaveBeenCalledWith(
      "project-1",
      expect.objectContaining({ id: "user-2", email: null }),
    );
    expect(syncTgSpecProjectAccessForTelegramViewer).toHaveBeenCalledWith({
      projectId: "project-1",
      arenaUserId: "user-2",
      telegramUserId: "123",
    });
  });

  it("uses project-owned bot id for signed Telegram Mini App handoff without exposing the bot token", async () => {
    vi.mocked(auth).mockResolvedValue(null);
    vi.mocked(prisma.project.findUnique).mockResolvedValue({
      ...project,
      secrets: [{
        key: "TELEGRAM_BOT_TOKEN",
        encryptedValue: "encrypted-token",
        iv: "iv",
        authTag: "auth-tag",
      }],
    } as any);
    vi.mocked(decryptSecret).mockReturnValue("123456:secret-token");
    vi.mocked(resolveTelegramWebAppSessionFromInitData).mockResolvedValue({
      status: "ok",
      telegramUserId: "777",
      session: { user: { id: "user-2", email: null } },
    } as any);

    const response = await POST(new NextRequest("http://localhost/api/auth/handoff", {
      method: "POST",
      headers: { "X-Telegram-WebApp-Init-Data": "signed-project-init-data" },
      body: JSON.stringify({ projectId: "project-1", telegramBotScope: "project" }),
    }));

    await expect(response.json()).resolves.toEqual({ code: "handoff-code" });
    expect(decryptSecret).toHaveBeenCalledWith({
      ciphertext: "encrypted-token",
      iv: "iv",
      authTag: "auth-tag",
    }, "encryption-key");
    expect(resolveTelegramWebAppSessionFromInitData).toHaveBeenCalledWith(
      "signed-project-init-data",
      { botId: "123456" },
    );
    expect(createHandoffCode).toHaveBeenCalledWith(
      "project-1",
      expect.objectContaining({ id: "user-2", email: null }),
    );
    expect(JSON.stringify(vi.mocked(resolveTelegramWebAppSessionFromInitData).mock.calls)).not.toContain("secret-token");
  });

  it("rejects project-bot handoff when signed start_param points at another project", async () => {
    vi.mocked(auth).mockResolvedValue(null);
    vi.mocked(prisma.project.findUnique).mockResolvedValue({
      ...project,
      secrets: [{
        key: "TELEGRAM_BOT_TOKEN",
        encryptedValue: "encrypted-token",
        iv: "iv",
        authTag: "auth-tag",
      }],
    } as any);
    vi.mocked(decryptSecret).mockReturnValue("123456:secret-token");
    vi.mocked(resolveTelegramWebAppSessionFromInitData).mockResolvedValue({
      status: "ok",
      telegramUserId: "777",
      startParam: "other-project",
      session: { user: { id: "user-2", email: null } },
    } as any);

    const response = await POST(new NextRequest("http://localhost/api/auth/handoff", {
      method: "POST",
      headers: { "X-Telegram-WebApp-Init-Data": "signed-project-init-data" },
      body: JSON.stringify({ projectId: "project-1", telegramBotScope: "project" }),
    }));

    await expect(response.json()).resolves.toEqual({
      error: "Telegram WebApp handoff rejected",
      status: "start_param_project_mismatch",
    });
    expect(response.status).toBe(403);
    expect(createHandoffCode).not.toHaveBeenCalled();
    expect(syncTgSpecProjectAccessForTelegramViewer).not.toHaveBeenCalled();
  });

  it("rejects legacy hash-only project-bot init data instead of using the bot token as an auth secret", async () => {
    vi.mocked(auth).mockResolvedValue(null);
    vi.mocked(prisma.project.findUnique).mockResolvedValue({
      ...project,
      secrets: [{
        key: "TELEGRAM_BOT_TOKEN",
        encryptedValue: "encrypted-token",
        iv: "iv",
        authTag: "auth-tag",
      }],
    } as any);
    vi.mocked(decryptSecret).mockReturnValue("123456:secret-token");
    vi.mocked(resolveTelegramWebAppSessionFromInitData).mockResolvedValue({
      status: "missing_signature",
    } as any);

    const response = await POST(new NextRequest("http://localhost/api/auth/handoff", {
      method: "POST",
      headers: { "X-Telegram-WebApp-Init-Data": buildHashOnlyInitData() },
      body: JSON.stringify({ projectId: "project-1", telegramBotScope: "project" }),
    }));

    await expect(response.json()).resolves.toEqual({
      error: "Telegram WebApp handoff rejected",
      status: "missing_signature",
    });
    expect(response.status).toBe(401);
    expect(resolveTelegramWebAppSessionFromInitData).toHaveBeenCalledWith(
      expect.stringContaining("legacy-hmac-hash"),
      { botId: "123456" },
    );
    expect(createHandoffCode).not.toHaveBeenCalled();
    expect(syncTgSpecProjectAccessForTelegramViewer).not.toHaveBeenCalled();
  });

  it("fails closed for project-bot handoff instead of falling back to a cookie session", async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: "user-1", email: "user@example.com" } } as any);
    vi.mocked(prisma.project.findUnique).mockResolvedValue({
      ...project,
      secrets: [{
        key: "TELEGRAM_BOT_TOKEN",
        encryptedValue: "encrypted-token",
        iv: "iv",
        authTag: "auth-tag",
      }],
    } as any);
    vi.mocked(decryptSecret).mockReturnValue("123456:secret-token");
    vi.mocked(resolveTelegramWebAppSessionFromInitData).mockResolvedValue({
      status: "invalid_signature",
    } as any);

    const response = await POST(new NextRequest("http://localhost/api/auth/handoff", {
      method: "POST",
      headers: { "X-Telegram-WebApp-Init-Data": "bad-init-data" },
      body: JSON.stringify({ projectId: "project-1", telegramBotScope: "project" }),
    }));

    await expect(response.json()).resolves.toEqual({
      error: "Telegram WebApp handoff rejected",
      status: "invalid_signature",
    });
    expect(response.status).toBe(401);
    expect(createHandoffCode).not.toHaveBeenCalled();
  });

  it("rejects project-bot handoff when the project bot secret is unavailable", async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: "user-1", email: "user@example.com" } } as any);
    vi.mocked(prisma.project.findUnique).mockResolvedValue({
      ...project,
      secrets: [],
    } as any);

    const response = await POST(new NextRequest("http://localhost/api/auth/handoff", {
      method: "POST",
      headers: { "X-Telegram-WebApp-Init-Data": "signed-project-init-data" },
      body: JSON.stringify({ projectId: "project-1", telegramBotScope: "project" }),
    }));

    await expect(response.json()).resolves.toEqual({
      error: "Telegram WebApp handoff rejected",
      status: "missing_project_bot",
    });
    expect(response.status).toBe(401);
    expect(resolveTelegramWebAppSessionFromInitData).not.toHaveBeenCalled();
    expect(createHandoffCode).not.toHaveBeenCalled();
  });

  it("rejects project-bot handoff when Telegram identity is valid but unlinked", async () => {
    vi.mocked(auth).mockResolvedValue(null);
    vi.mocked(prisma.project.findUnique).mockResolvedValue({
      ...project,
      secrets: [{
        key: "TELEGRAM_BOT_TOKEN",
        encryptedValue: "encrypted-token",
        iv: "iv",
        authTag: "auth-tag",
      }],
    } as any);
    vi.mocked(decryptSecret).mockReturnValue("123456:secret-token");
    vi.mocked(resolveTelegramWebAppSessionFromInitData).mockResolvedValue({
      status: "unlinked",
      telegramUserId: "777",
    } as any);

    const response = await POST(new NextRequest("http://localhost/api/auth/handoff", {
      method: "POST",
      headers: { "X-Telegram-WebApp-Init-Data": "signed-project-init-data" },
      body: JSON.stringify({ projectId: "project-1", telegramBotScope: "project" }),
    }));

    await expect(response.json()).resolves.toEqual({
      error: "Telegram WebApp handoff rejected",
      status: "unlinked",
    });
    expect(response.status).toBe(401);
    expect(createHandoffCode).not.toHaveBeenCalled();
    expect(syncTgSpecProjectAccessForTelegramViewer).not.toHaveBeenCalled();
  });

  it("denies project-bot preview redirect after valid Telegram identity when project access is missing", async () => {
    vi.mocked(auth).mockResolvedValue(null);
    vi.mocked(prisma.project.findUnique).mockResolvedValue({
      ...project,
      components: [{
        kind: "app",
        previewUrl: "https://preview-project-1.arena.example.test",
        containerName: "preview-project-1",
      }],
      vpsHost: null,
      secrets: [{
        key: "TELEGRAM_BOT_TOKEN",
        encryptedValue: "encrypted-token",
        iv: "iv",
        authTag: "auth-tag",
      }],
    } as any);
    vi.mocked(decryptSecret).mockReturnValue("123456:secret-token");
    vi.mocked(resolveTelegramWebAppSessionFromInitData).mockResolvedValue({
      status: "ok",
      telegramUserId: "777",
      session: { user: { id: "user-2", email: null } },
    } as any);
    vi.mocked(resolveProjectAccess).mockResolvedValue({ canView: false } as any);

    const response = await POST(new NextRequest("http://localhost/api/auth/handoff", {
      method: "POST",
      headers: { "X-Telegram-WebApp-Init-Data": "signed-project-init-data" },
      body: JSON.stringify({
        projectId: "project-1",
        telegramBotScope: "project",
        includePreviewRedirectUrl: true,
      }),
    }));

    expect(response.status).toBe(403);
    expect(createHandoffCode).not.toHaveBeenCalled();
  });

  it("returns a preview redirect URL only after project-bot identity and access are accepted", async () => {
    vi.mocked(auth).mockResolvedValue(null);
    vi.mocked(prisma.project.findUnique).mockResolvedValue({
      ...project,
      components: [{
        kind: "app",
        previewUrl: "https://preview-project-1.arena.example.test/path?existing=1",
        containerName: "preview-project-1",
      }],
      vpsHost: null,
      secrets: [{
        key: "TELEGRAM_BOT_TOKEN",
        encryptedValue: "encrypted-token",
        iv: "iv",
        authTag: "auth-tag",
      }],
    } as any);
    vi.mocked(decryptSecret).mockReturnValue("123456:secret-token");
    vi.mocked(resolveTelegramWebAppSessionFromInitData).mockResolvedValue({
      status: "ok",
      telegramUserId: "777",
      session: { user: { id: "user-2", email: null } },
    } as any);

    const response = await POST(new NextRequest("http://localhost/api/auth/handoff", {
      method: "POST",
      headers: { "X-Telegram-WebApp-Init-Data": "signed-project-init-data" },
      body: JSON.stringify({
        projectId: "project-1",
        telegramBotScope: "project",
        includePreviewRedirectUrl: true,
      }),
    }));

    await expect(response.json()).resolves.toEqual({
      code: "handoff-code",
      redirectUrl: "https://preview-project-1.arena.example.test/path?existing=1&arena_embed=1&arena_token=handoff-code",
    });
    expect(createHandoffCode).toHaveBeenCalledWith(
      "project-1",
      expect.objectContaining({ id: "user-2", email: null }),
    );
  });

  it("does not mint a code when a preview redirect is requested before the app preview exists", async () => {
    vi.mocked(auth).mockResolvedValue(null);
    vi.mocked(prisma.project.findUnique).mockResolvedValue({
      ...project,
      components: [],
      vpsHost: null,
      secrets: [{
        key: "TELEGRAM_BOT_TOKEN",
        encryptedValue: "encrypted-token",
        iv: "iv",
        authTag: "auth-tag",
      }],
    } as any);
    vi.mocked(decryptSecret).mockReturnValue("123456:secret-token");
    vi.mocked(resolveTelegramWebAppSessionFromInitData).mockResolvedValue({
      status: "ok",
      telegramUserId: "777",
      session: { user: { id: "user-2", email: null } },
    } as any);

    const response = await POST(new NextRequest("http://localhost/api/auth/handoff", {
      method: "POST",
      headers: { "X-Telegram-WebApp-Init-Data": "signed-project-init-data" },
      body: JSON.stringify({
        projectId: "project-1",
        telegramBotScope: "project",
        includePreviewRedirectUrl: true,
      }),
    }));

    await expect(response.json()).resolves.toEqual({ error: "Preview not available" });
    expect(response.status).toBe(404);
    expect(createHandoffCode).not.toHaveBeenCalled();
  });

  it("denies handoff when the resolved user cannot view the project", async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: "user-1", email: null } } as any);
    vi.mocked(resolveProjectAccess).mockResolvedValue({ canView: false } as any);

    const response = await POST(new NextRequest("http://localhost/api/auth/handoff", {
      method: "POST",
      body: JSON.stringify({ projectId: "project-1" }),
    }));

    expect(response.status).toBe(403);
    expect(createHandoffCode).not.toHaveBeenCalled();
  });
});
