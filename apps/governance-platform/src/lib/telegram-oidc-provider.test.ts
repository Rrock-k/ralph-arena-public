import { describe, expect, it } from "vitest";
import {
  TelegramOidcProvider,
  isTelegramOidcConfigured,
  mapTelegramOidcProfile,
  readTelegramOidcRawUserId,
  readTelegramOidcSubject,
} from "./telegram-oidc-provider";

describe("telegram oidc provider", () => {
  it("maps Telegram OIDC profile into an Arena user without synthetic email", () => {
    expect(
      mapTelegramOidcProfile({
        sub: "subject-12345",
        id: 12345,
        name: "Alex",
        preferred_username: "alex",
        picture: "https://cdn.example/avatar.jpg",
      }),
    ).toEqual({
      id: "12345",
      name: "Alex",
      email: null,
      image: "https://cdn.example/avatar.jpg",
    });
  });

  it("falls back to the OIDC subject only when Telegram does not expose a raw user id", () => {
    expect(mapTelegramOidcProfile({ sub: "subject-12345", preferred_username: "alex" })).toMatchObject({
      id: "subject-12345",
      name: "@alex",
    });
  });

  it("falls back to Telegram username or stable id for display name", () => {
    expect(mapTelegramOidcProfile({ sub: "subject-12345", id: "12345", preferred_username: "alex" }).name).toBe("@alex");
    expect(mapTelegramOidcProfile({ sub: "subject-67890", id: 67890 }).name).toBe("Telegram 67890");
  });

  it("rejects profiles without Telegram subject", () => {
    expect(() => mapTelegramOidcProfile({ id: 12345, name: "No Subject" })).toThrow(
      "Telegram OIDC profile is missing sub",
    );
  });

  it("reads OIDC subject and raw Telegram user id separately", () => {
    const profile = { sub: "subject-12345", id: " 12345 " };

    expect(readTelegramOidcSubject(profile)).toBe("subject-12345");
    expect(readTelegramOidcRawUserId(profile)).toBe("12345");
    expect(readTelegramOidcRawUserId({ sub: "subject", id: "not-a-number" })).toBeNull();
  });

  it("requires both OIDC client credentials", () => {
    expect(
      isTelegramOidcConfigured({
        TELEGRAM_OIDC_CLIENT_ID: "client-id",
        TELEGRAM_OIDC_CLIENT_SECRET: "secret",
      } as NodeJS.ProcessEnv),
    ).toBe(true);
    expect(
      isTelegramOidcConfigured({
        TELEGRAM_OIDC_CLIENT_ID: "client-id",
      } as NodeJS.ProcessEnv),
    ).toBe(false);
  });

  it("omits Auth.js state because Telegram rejects encrypted state JWTs", () => {
    const previousClientId = process.env.TELEGRAM_OIDC_CLIENT_ID;
    const previousClientSecret = process.env.TELEGRAM_OIDC_CLIENT_SECRET;
    process.env.TELEGRAM_OIDC_CLIENT_ID = "client-id";
    process.env.TELEGRAM_OIDC_CLIENT_SECRET = "secret";

    try {
      expect(TelegramOidcProvider().checks).toEqual(["pkce", "nonce"]);
    } finally {
      if (previousClientId === undefined) {
        delete process.env.TELEGRAM_OIDC_CLIENT_ID;
      } else {
        process.env.TELEGRAM_OIDC_CLIENT_ID = previousClientId;
      }
      if (previousClientSecret === undefined) {
        delete process.env.TELEGRAM_OIDC_CLIENT_SECRET;
      } else {
        process.env.TELEGRAM_OIDC_CLIENT_SECRET = previousClientSecret;
      }
    }
  });
});
