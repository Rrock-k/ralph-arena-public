import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/telegram-webapp-auth", () => ({
  TELEGRAM_WEBAPP_INIT_DATA_HEADER: "x-telegram-webapp-init-data",
}));

import { GET } from "./route";

describe("GET /api/auth/telegram-preview-entry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders a Telegram bootstrap page that exchanges project init data for a preview handoff", async () => {
    const response = await GET(new NextRequest(
      "http://localhost/api/auth/telegram-preview-entry?projectId=project-1",
    ));
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const csp = response.headers.get("Content-Security-Policy") ?? "";
    expect(csp).toContain("frame-ancestors 'self' https://telegram.org https://*.telegram.org");
    expect(csp).not.toContain("frame-ancestors 'none'");
    expect(html).toContain("https://telegram.org/js/telegram-web-app.js");
    expect(html).toContain("\"/api/auth/handoff\"");
    expect(html).toContain("const initialProjectId = \"project-1\";");
    expect(html).toContain("tgWebAppStartParam");
    expect(html).toContain("initDataUnsafe.start_param");
    expect(html).toContain("telegramBotScope: \"project\"");
    expect(html).toContain("includePreviewRedirectUrl: true");
    expect(html).toContain("x-telegram-webapp-init-data");
    expect(html).toContain("payload.redirectUrl");
    expect(html).toContain("requestFullscreen");
    expect(html).toContain("disableVerticalSwipes");
    expect(html).toContain("enableClosingConfirmation");
    expect(html).toContain("fullscreenFailed");
    expect(html).not.toContain("arena_embed");
    expect(html).not.toContain("https://preview-project-1.arena.example.test");
    expect(html).not.toContain("TELEGRAM_BOT_TOKEN");
  });

  it("uses Telegram startapp GET parameter as the project id for Main Mini App links", async () => {
    const response = await GET(new NextRequest(
      "http://localhost/api/auth/telegram-preview-entry?tgWebAppStartParam=project-1",
    ));
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain("const initialProjectId = \"project-1\";");
  });

  it("renders a bootstrap page without a project id so Telegram initData can provide start_param", async () => {
    const response = await GET(new NextRequest(
      "http://localhost/api/auth/telegram-preview-entry",
    ));
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain("const initialProjectId = null;");
    expect(html).toContain("This Telegram preview link is missing a project id.");
  });
});
