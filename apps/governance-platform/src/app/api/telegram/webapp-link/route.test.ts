import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    account: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
  },
}));

vi.mock("@/lib/telegram-webapp-link-token", () => ({
  verifyTelegramWebAppLinkToken: vi.fn(),
}));

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { verifyTelegramWebAppLinkToken } from "@/lib/telegram-webapp-link-token";
import { dynamic, GET } from "./route";

describe("GET /api/telegram/webapp-link", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.AUTH_URL;
    delete process.env.NEXTAUTH_URL;
    vi.mocked(verifyTelegramWebAppLinkToken).mockReturnValue({
      ok: true,
      payload: {
        telegramUserId: "777",
        iat: 1,
        exp: 601,
      },
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
    vi.mocked(prisma.account.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.account.create).mockResolvedValue({} as any);
  });

  it("is dynamic because it links the current authenticated Arena user", () => {
    expect(dynamic).toBe("force-dynamic");
  });

  it("redirects invalid link tokens to profile with an error", async () => {
    vi.mocked(verifyTelegramWebAppLinkToken).mockReturnValue({
      ok: false,
      reason: "expired",
    });

    const response = await GET(new Request("http://localhost/api/telegram/webapp-link?token=bad"));

    expect(response.status).toBe(307);
    expect(response.headers.get("Location")).toBe(
      "http://localhost/settings?authError=TelegramWebAppLinkInvalid#profile",
    );
    expect(auth).not.toHaveBeenCalled();
  });

  it("requires an Arena session before linking the Telegram Mini App identity", async () => {
    vi.mocked(auth).mockResolvedValue(null);

    const response = await GET(new Request("http://localhost/api/telegram/webapp-link?token=good"));

    expect(response.status).toBe(307);
    expect(response.headers.get("Location")).toBe(
      "http://localhost/auth/signin?callbackUrl=http%3A%2F%2Flocalhost%2Fapi%2Ftelegram%2Fwebapp-link%3Ftoken%3Dgood",
    );
    expect(prisma.account.create).not.toHaveBeenCalled();
  });

  it("creates the raw Telegram account alias for the signed-in Arena user", async () => {
    const response = await GET(new Request("http://localhost/api/telegram/webapp-link?token=good"));

    expect(response.status).toBe(307);
    expect(prisma.account.create).toHaveBeenCalledWith({
      data: {
        userId: "user-1",
        type: "oidc",
        provider: "telegram",
        providerAccountId: "777",
      },
    });
    expect(response.headers.get("Location")).toBe(
      "http://localhost/settings?connected=telegram-webapp#profile",
    );
  });

  it("does not re-link a Telegram Mini App identity owned by another user", async () => {
    vi.mocked(prisma.account.findUnique).mockResolvedValue({ userId: "other-user" } as any);

    const response = await GET(new Request("http://localhost/api/telegram/webapp-link?token=good"));

    expect(response.status).toBe(307);
    expect(prisma.account.create).not.toHaveBeenCalled();
    expect(response.headers.get("Location")).toBe(
      "http://localhost/settings?authError=TelegramWebAppLinkConflict#profile",
    );
  });

  it("is idempotent when the Telegram Mini App identity is already linked to the same user", async () => {
    vi.mocked(prisma.account.findUnique).mockResolvedValue({ userId: "user-1" } as any);

    const response = await GET(new Request("http://localhost/api/telegram/webapp-link?token=good"));

    expect(response.status).toBe(307);
    expect(prisma.account.create).not.toHaveBeenCalled();
    expect(response.headers.get("Location")).toBe(
      "http://localhost/settings?connected=telegram-webapp#profile",
    );
  });
});
