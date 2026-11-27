import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/telegram-webapp-auth", () => ({
  TELEGRAM_WEBAPP_INIT_DATA_HEADER: "x-telegram-webapp-init-data",
  resolveTelegramWebAppSessionFromInitData: vi.fn(),
}));

vi.mock("@/lib/telegram-webapp-link-token", () => ({
  createTelegramWebAppLinkToken: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    account: {
      count: vi.fn(),
    },
  },
}));

import { resolveTelegramWebAppSessionFromInitData } from "@/lib/telegram-webapp-auth";
import { createTelegramWebAppLinkToken } from "@/lib/telegram-webapp-link-token";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { dynamic, GET } from "./route";

describe("GET /api/telegram/webapp-session", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.AUTH_URL;
    delete process.env.NEXTAUTH_URL;
    vi.mocked(resolveTelegramWebAppSessionFromInitData).mockResolvedValue({ status: "missing_init_data" });
    vi.mocked(createTelegramWebAppLinkToken).mockReturnValue("link-token");
    vi.mocked(auth).mockResolvedValue(null);
    vi.mocked(prisma.account.count).mockResolvedValue(0);
  });

  it("is dynamic because it returns private account-linking state", () => {
    expect(dynamic).toBe("force-dynamic");
  });

  it("returns linked account status for a verified Telegram WebApp user", async () => {
    vi.mocked(resolveTelegramWebAppSessionFromInitData).mockResolvedValue({
      status: "ok",
      telegramUserId: "777",
      session: {
        user: {
          id: "user-1",
          email: null,
          name: "Nika",
          image: null,
          role: "USER",
        },
        expires: "2030-01-01T00:00:00.000Z",
      },
    } as any);

    const response = await GET(
      new Request("http://localhost/api/telegram/webapp-session", {
        headers: { "x-telegram-webapp-init-data": "auth_date=1&signature=sig" },
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({
      status: "linked",
      telegramUserId: "777",
      user: {
        id: "user-1",
        email: null,
        name: "Nika",
        image: null,
        role: "USER",
      },
    });
    expect(resolveTelegramWebAppSessionFromInitData).toHaveBeenCalledWith("auth_date=1&signature=sig");
  });

  it("returns unlinked status without creating an Arena user", async () => {
    vi.mocked(resolveTelegramWebAppSessionFromInitData).mockResolvedValue({
      status: "unlinked",
      telegramUserId: "777",
    });

    const response = await GET(
      new Request("http://localhost/api/telegram/webapp-session", {
        headers: { "x-telegram-webapp-init-data": "auth_date=1&signature=sig" },
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: "unlinked",
      reason: "telegram_account_required",
      telegramUserId: "777",
      linkHref: "http://localhost/api/telegram/webapp-link?token=link-token",
    });
    expect(createTelegramWebAppLinkToken).toHaveBeenCalledWith("777");
  });

  it("distinguishes signed-in Telegram users that only need raw id repair", async () => {
    vi.mocked(resolveTelegramWebAppSessionFromInitData).mockResolvedValue({
      status: "unlinked",
      telegramUserId: "777",
    });
    vi.mocked(auth).mockResolvedValue({
      user: {
        id: "user-1",
        email: null,
        name: "Nika",
        image: null,
        role: "USER",
      },
      expires: "2030-01-01T00:00:00.000Z",
    });
    vi.mocked(prisma.account.count).mockResolvedValue(1);

    const response = await GET(
      new Request("http://localhost/api/telegram/webapp-session", {
        headers: { "x-telegram-webapp-init-data": "auth_date=1&signature=sig" },
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: "unlinked",
      reason: "raw_id_repair_required",
      telegramUserId: "777",
      linkHref: "http://localhost/api/telegram/webapp-link?token=link-token",
    });
    expect(prisma.account.count).toHaveBeenCalledWith({
      where: {
        userId: "user-1",
        provider: "telegram",
      },
    });
  });

  it("rejects invalid Telegram handoff data", async () => {
    vi.mocked(resolveTelegramWebAppSessionFromInitData).mockResolvedValue({
      status: "invalid_signature",
    });

    const response = await GET(new Request("http://localhost/api/telegram/webapp-session"));

    expect(response.status).toBe(401);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({
      status: "invalid_signature",
      error: "Telegram WebApp handoff rejected",
    });
  });
});
