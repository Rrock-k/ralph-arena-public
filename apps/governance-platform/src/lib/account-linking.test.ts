import { describe, expect, it, vi } from "vitest";

vi.mock("./prisma", () => ({ prisma: {} }));

import {
  isReclaimableEmptyProviderShell,
  profileUpdateFromProvider,
  type AccountShellSnapshot,
} from "./account-linking";

function shell(
  overrides: Partial<AccountShellSnapshot> = {},
): AccountShellSnapshot {
  return {
    id: "user-shell",
    email: null,
    accounts: [{ provider: "telegram", providerAccountId: "tg-1" }],
    counts: {
      votes: 0,
      proposals: 0,
      projectsOwned: 0,
    },
    ...overrides,
  };
}

describe("account linking", () => {
  it("allows reclaiming a provider-only user shell with no Arena data", () => {
    expect(isReclaimableEmptyProviderShell(shell(), "telegram", "tg-1")).toBe(true);
  });

  it("does not reclaim shells with additional linked accounts", () => {
    expect(
      isReclaimableEmptyProviderShell(
        shell({
          accounts: [
            { provider: "telegram", providerAccountId: "tg-1" },
            { provider: "google", providerAccountId: "google-1" },
          ],
        }),
        "telegram",
        "tg-1",
      ),
    ).toBe(false);
  });

  it("does not reclaim shells that already own Arena data", () => {
    expect(
      isReclaimableEmptyProviderShell(
        shell({ counts: { votes: 1, proposals: 0, projectsOwned: 0 } }),
        "telegram",
        "tg-1",
      ),
    ).toBe(false);
  });

  it("does not reclaim a different provider identity", () => {
    expect(isReclaimableEmptyProviderShell(shell(), "telegram", "other")).toBe(false);
    expect(isReclaimableEmptyProviderShell(shell(), "github", "tg-1")).toBe(false);
  });

  it("normalizes profile data from Google without overwriting ownership semantics", () => {
    expect(
      profileUpdateFromProvider("google", {
        email: " Alex@Example.COM ",
        email_verified: true,
        name: "Alex",
        picture: "https://cdn.example/google.jpg",
      }),
    ).toMatchObject({
      email: "alex@example.com",
      name: "Alex",
      image: "https://cdn.example/google.jpg",
    });
  });

  it("normalizes Telegram display names from username fallback", () => {
    expect(
      profileUpdateFromProvider("telegram", {
        preferred_username: "@alex",
        picture: "https://cdn.example/telegram.jpg",
      }),
    ).toEqual({
      name: "@alex",
      image: "https://cdn.example/telegram.jpg",
    });
  });
});
