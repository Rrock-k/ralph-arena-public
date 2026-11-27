import { beforeEach, describe, expect, it } from "vitest";
import {
  createTransactionalUnsubscribeToken,
  verifyTransactionalUnsubscribeToken,
} from "./unsubscribe-token";

describe("transactional unsubscribe tokens", () => {
  beforeEach(() => {
    process.env.AUTH_SECRET = "test-auth-secret-with-enough-length";
    delete process.env.NEXTAUTH_SECRET;
  });

  it("verifies a signed token payload", () => {
    const now = new Date("2026-05-13T10:00:00.000Z");
    const token = createTransactionalUnsubscribeToken({
      userId: "user-1",
      eventType: "project.deployed",
      channel: "email",
      expiresInSeconds: 60,
    }, now);

    expect(verifyTransactionalUnsubscribeToken(token, now)).toEqual({
      ok: true,
      userId: "user-1",
      eventType: "project.deployed",
      channel: "email",
      exp: Math.floor(now.getTime() / 1000) + 60,
    });
  });

  it("rejects tampered tokens", () => {
    const token = createTransactionalUnsubscribeToken({
      userId: "user-1",
      eventType: "project.deployed",
      channel: "email",
    });
    const [version, payload] = token.split(".");

    expect(verifyTransactionalUnsubscribeToken(`${version}.${payload}.bad-signature`)).toEqual({
      ok: false,
      error: "invalid",
    });
  });

  it("rejects expired tokens", () => {
    const now = new Date("2026-05-13T10:00:00.000Z");
    const token = createTransactionalUnsubscribeToken({
      userId: "user-1",
      eventType: "project.deployed",
      channel: "email",
      expiresInSeconds: 1,
    }, now);

    expect(verifyTransactionalUnsubscribeToken(token, new Date("2026-05-13T10:00:02.000Z"))).toEqual({
      ok: false,
      error: "expired",
    });
  });
});
