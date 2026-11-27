import { afterEach, describe, expect, it, vi } from "vitest";
import { getLocalConfigReadiness } from "./local-config-readiness";

const ORIGINAL_ENV = { ...process.env };

describe("getLocalConfigReadiness", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    process.env = { ...ORIGINAL_ENV };
  });

  it("flags missing critical local config", () => {
    delete process.env.GITHUB_TOKEN;
    delete process.env.SECRETS_ENCRYPTION_KEY;
    delete process.env.ARENA_ADMIN_SECRET;

    const snapshot = getLocalConfigReadiness();

    expect(snapshot.criticalMissing.map((item) => item.key)).toEqual([
      "GITHUB_TOKEN",
      "SECRETS_ENCRYPTION_KEY",
      "ARENA_ADMIN_SECRET",
    ]);
    expect(snapshot.criticalMissing.map((item) => item.location)).toEqual([
      "root .env.local",
      "root .env.local",
      "root .env.local",
    ]);
  });

  it("treats present values as ready", () => {
    process.env.GITHUB_TOKEN = "gh-token";
    process.env.SECRETS_ENCRYPTION_KEY = "a".repeat(64);
    process.env.ARENA_ADMIN_SECRET = "admin-secret";
    process.env.TELEGRAM_OIDC_CLIENT_ID = "telegram-client-id";
    process.env.TELEGRAM_OIDC_CLIENT_SECRET = "telegram-client-secret";
    process.env.TELEGRAM_WEBAPP_BOT_ID = "12345678";
    process.env.RUNNER_WEBHOOK_SECRET = "worker-secret";
    process.env.PREVIEW_DOMAIN = "arena.example.test";

    const snapshot = getLocalConfigReadiness();

    expect(snapshot.criticalMissing).toHaveLength(0);
    expect(snapshot.warningMissing).toHaveLength(0);
  });

  it("flags incomplete Telegram login env as a warning", () => {
    process.env.GITHUB_TOKEN = "gh-token";
    process.env.SECRETS_ENCRYPTION_KEY = "a".repeat(64);
    process.env.ARENA_ADMIN_SECRET = "admin-secret";
    process.env.RUNNER_WEBHOOK_SECRET = "worker-secret";
    process.env.PREVIEW_DOMAIN = "arena.example.test";
    delete process.env.TELEGRAM_OIDC_CLIENT_ID;
    process.env.TELEGRAM_OIDC_CLIENT_SECRET = "telegram-client-secret";

    const snapshot = getLocalConfigReadiness();

    expect(snapshot.criticalMissing).toHaveLength(0);
    expect(snapshot.warningMissing.map((item) => item.key)).toContain(
      "TELEGRAM_OIDC_CLIENT_ID + TELEGRAM_OIDC_CLIENT_SECRET",
    );
  });
});
