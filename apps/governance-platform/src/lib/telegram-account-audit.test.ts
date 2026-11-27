import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { buildTelegramAccountAudit } from "./telegram-account-audit";

function row(
  userId: string,
  providerAccountId: string,
  userName = "User",
  overrides: Record<string, unknown> = {},
) {
  return {
    userId,
    providerAccountId,
    user: {
      id: userId,
      name: userName,
      email: `${userId}@example.com`,
    },
    ...overrides,
  };
}

describe("buildTelegramAccountAudit", () => {
  it("treats raw numeric Telegram ids as ready", () => {
    const audit = buildTelegramAccountAudit(
      [row("user-1", "777")],
      { generatedAt: new Date("2026-05-11T00:00:00.000Z") },
    );

    expect(audit).toMatchObject({
      generatedAt: "2026-05-11T00:00:00.000Z",
      totalTelegramAccounts: 1,
      totalTelegramUsers: 1,
      rawIdAccountCount: 1,
      legacyAccountCount: 0,
      warningCount: 0,
    });
    expect(audit.buckets.map((bucket) => [bucket.code, bucket.count])).toEqual([
      ["subject_only", 0],
      ["compatibility_alias", 0],
      ["multiple_raw_ids", 0],
    ]);
  });

  it("flags legacy subject-only Telegram accounts", () => {
    const audit = buildTelegramAccountAudit([row("user-1", "subject-777")]);
    const subjectOnly = audit.buckets.find((bucket) => bucket.code === "subject_only");

    expect(audit.warningCount).toBe(1);
    expect(audit.legacyAccountCount).toBe(1);
    expect(subjectOnly?.count).toBe(1);
    expect(subjectOnly?.examples).toEqual([
      {
        userId: "user-1",
        userName: "User",
        userEmail: "user-1@example.com",
        rawIds: [],
        legacyIds: ["subject-777"],
      },
    ]);
  });

  it("treats numeric OIDC subjects as legacy, not WebApp raw ids", () => {
    const audit = buildTelegramAccountAudit([
      row("user-1", "999999999999999999", "User", {
        scope: "openid profile",
        access_token: "oidc-token",
        id_token: "oidc-id-token",
      }),
    ]);
    const subjectOnly = audit.buckets.find((bucket) => bucket.code === "subject_only");

    expect(audit.warningCount).toBe(1);
    expect(audit.rawIdAccountCount).toBe(0);
    expect(audit.legacyAccountCount).toBe(1);
    expect(subjectOnly?.examples[0]).toMatchObject({
      rawIds: [],
      legacyIds: ["999999999999999999"],
    });
  });

  it("keeps raw-id compatibility aliases visible without counting them as warnings", () => {
    const audit = buildTelegramAccountAudit([
      row("user-1", "777"),
      row("user-1", "999999999999999999", "User", {
        scope: "openid profile",
        access_token: "oidc-token",
        id_token: "oidc-id-token",
      }),
    ]);
    const compatibility = audit.buckets.find((bucket) => bucket.code === "compatibility_alias");

    expect(audit.warningCount).toBe(0);
    expect(compatibility?.severity).toBe("info");
    expect(compatibility?.count).toBe(1);
    expect(compatibility?.examples[0]).toMatchObject({
      userId: "user-1",
      rawIds: ["777"],
      legacyIds: ["999999999999999999"],
    });
  });

  it("flags multiple raw Telegram ids on one Arena user", () => {
    const audit = buildTelegramAccountAudit([
      row("user-1", "777"),
      row("user-1", "888"),
      row("user-2", "999"),
    ]);
    const multipleRawIds = audit.buckets.find((bucket) => bucket.code === "multiple_raw_ids");

    expect(audit.warningCount).toBe(1);
    expect(multipleRawIds?.count).toBe(1);
    expect(multipleRawIds?.examples[0]).toMatchObject({
      userId: "user-1",
      rawIds: ["777", "888"],
      legacyIds: [],
    });
  });
});
