import { generateKeyPairSync, sign } from "node:crypto";
import type { KeyObject } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  accountFindUnique: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    account: {
      findUnique: mocks.accountFindUnique,
    },
  },
}));

import {
  buildTelegramWebAppSignatureDataCheckString,
  resolveTelegramWebAppSessionFromInitData,
  verifyTelegramWebAppInitData,
} from "./telegram-webapp-auth";

const BOT_ID = "12345678";
const NOW_SECONDS = 1_800_000_000;

function publicKeyHex(publicKey: KeyObject): string {
  return Buffer.from(publicKey.export({ format: "der", type: "spki" })).subarray(-32).toString("hex");
}

function signedInitData(input: {
  botId?: string;
  authDate?: number;
  user?: Record<string, unknown>;
  startParam?: string;
}) {
  const keyPair = generateKeyPairSync("ed25519");
  const params = new URLSearchParams({
    auth_date: String(input.authDate ?? NOW_SECONDS),
    query_id: "query-1",
    user: JSON.stringify(input.user ?? {
      id: 987654321,
      first_name: "Alex",
      username: "alex",
    }),
    hash: "ignored-by-third-party-validation",
  });
  if (input.startParam) {
    params.set("start_param", input.startParam);
  }
  const dataCheckString = buildTelegramWebAppSignatureDataCheckString(
    params,
    input.botId ?? BOT_ID,
  );
  params.set(
    "signature",
    sign(null, Buffer.from(dataCheckString, "utf8"), keyPair.privateKey).toString("base64url"),
  );

  return {
    initData: params.toString(),
    publicKeyHex: publicKeyHex(keyPair.publicKey),
  };
}

describe("telegram webapp auth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.accountFindUnique.mockReset();
  });

  it("verifies Telegram Mini App init data and reads the Telegram user id", () => {
    const fixture = signedInitData({});

    expect(
      verifyTelegramWebAppInitData(fixture.initData, {
        botId: BOT_ID,
        nowSeconds: NOW_SECONDS,
        publicKeyHex: fixture.publicKeyHex,
      }),
    ).toEqual({
      ok: true,
      telegramUserId: "987654321",
      authDate: NOW_SECONDS,
      user: {
        id: "987654321",
        firstName: "Alex",
        username: "alex",
      },
    });
  });

  it("rejects init data signed for a different bot id", () => {
    const fixture = signedInitData({ botId: "11111111" });

    expect(
      verifyTelegramWebAppInitData(fixture.initData, {
        botId: BOT_ID,
        nowSeconds: NOW_SECONDS,
        publicKeyHex: fixture.publicKeyHex,
      }),
    ).toEqual({ ok: false, reason: "invalid_signature" });
  });

  it("reads signed Mini App start_param from verified init data", () => {
    const fixture = signedInitData({ startParam: "project-1" });

    expect(
      verifyTelegramWebAppInitData(fixture.initData, {
        botId: BOT_ID,
        nowSeconds: NOW_SECONDS,
        publicKeyHex: fixture.publicKeyHex,
      }),
    ).toMatchObject({
      ok: true,
      telegramUserId: "987654321",
      startParam: "project-1",
    });
  });

  it("rejects outdated init data", () => {
    const fixture = signedInitData({ authDate: NOW_SECONDS - 90_000 });

    expect(
      verifyTelegramWebAppInitData(fixture.initData, {
        botId: BOT_ID,
        nowSeconds: NOW_SECONDS,
        publicKeyHex: fixture.publicKeyHex,
      }),
    ).toEqual({ ok: false, reason: "expired" });
  });

  it("resolves a verified Telegram account into an Arena session", async () => {
    const fixture = signedInitData({});
    vi.spyOn(Date, "now").mockReturnValue(NOW_SECONDS * 1000);
    mocks.accountFindUnique.mockResolvedValue({
      user: {
        id: "arena-user-1",
        email: null,
        name: "Alex",
        image: "https://cdn.example/avatar.jpg",
        role: "USER",
      },
    });

    try {
      await expect(
        resolveTelegramWebAppSessionFromInitData(fixture.initData, {
          botId: BOT_ID,
          nowSeconds: NOW_SECONDS,
          publicKeyHex: fixture.publicKeyHex,
        }),
      ).resolves.toEqual({
        status: "ok",
        telegramUserId: "987654321",
        session: {
          user: {
            id: "arena-user-1",
            email: null,
            name: "Alex",
            image: "https://cdn.example/avatar.jpg",
            role: "USER",
          },
          expires: new Date((NOW_SECONDS + 86_400) * 1000).toISOString(),
        },
      });
      expect(mocks.accountFindUnique).toHaveBeenCalledWith({
        where: {
          provider_providerAccountId: {
            provider: "telegram",
            providerAccountId: "987654321",
          },
        },
        select: {
          user: {
            select: {
              id: true,
              email: true,
              name: true,
              image: true,
              role: true,
            },
          },
        },
      });
    } finally {
      vi.restoreAllMocks();
    }
  });

  it("carries signed Mini App start_param into the resolved session", async () => {
    const fixture = signedInitData({ startParam: "project-1" });
    vi.spyOn(Date, "now").mockReturnValue(NOW_SECONDS * 1000);
    mocks.accountFindUnique.mockResolvedValue({
      user: {
        id: "arena-user-1",
        email: null,
        name: "Alex",
        image: "https://cdn.example/avatar.jpg",
        role: "USER",
      },
    });

    try {
      await expect(
        resolveTelegramWebAppSessionFromInitData(fixture.initData, {
          botId: BOT_ID,
          nowSeconds: NOW_SECONDS,
          publicKeyHex: fixture.publicKeyHex,
        }),
      ).resolves.toMatchObject({
        status: "ok",
        telegramUserId: "987654321",
        startParam: "project-1",
      });
    } finally {
      vi.restoreAllMocks();
    }
  });

  it("does not create Arena users for unlinked Telegram accounts", async () => {
    const fixture = signedInitData({});
    mocks.accountFindUnique.mockResolvedValue(null);

    await expect(
      resolveTelegramWebAppSessionFromInitData(fixture.initData, {
        botId: BOT_ID,
        nowSeconds: NOW_SECONDS,
        publicKeyHex: fixture.publicKeyHex,
      }),
    ).resolves.toEqual({
      status: "unlinked",
      telegramUserId: "987654321",
    });
  });
});
