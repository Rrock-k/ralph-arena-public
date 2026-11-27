import { describe, expect, it } from "vitest";
import { PROJECT_ADDONS } from "@/lib/project-addons";

describe("PROJECT_ADDONS", () => {
  it("keeps the Telegram Mini App add-on bounded to autonomous completion", () => {
    const telegramAddon = PROJECT_ADDONS.find((addon) => addon.id === "telegram_mini_app");

    expect(telegramAddon?.specContent).toContain("setChatMenuButton");
    expect(telegramAddon?.specContent).toContain("expand()");
    expect(telegramAddon?.specContent).toContain("disableVerticalSwipes()");
    expect(telegramAddon?.specContent).toContain("expanded sheet rather than forcing fullscreen");
    expect(telegramAddon?.specContent).toContain("do not call `requestFullscreen()` by default");
    expect(telegramAddon?.specContent).toContain("do not add Telegram fullscreen/safe-area event loops");
    expect(telegramAddon?.specContent).toContain("normal CSS viewport behavior");
    expect(telegramAddon?.specContent).toContain("env(safe-area-inset-*)");
    expect(telegramAddon?.specContent).toContain("do not drive root, feed, carousel, or tab-shell height");
    expect(telegramAddon?.specContent).toContain("viewportStableHeight");
    expect(telegramAddon?.specContent).toContain("feature-detect every Telegram WebApp method");
    expect(telegramAddon?.specContent).not.toContain('isVersionAtLeast("8.0")');
    expect(telegramAddon?.specContent).not.toContain("enableClosingConfirmation()");
    expect(telegramAddon?.specContent).not.toContain("web_app_request_safe_area");
    expect(telegramAddon?.specContent).toContain("mocked or contract tests");
    expect(telegramAddon?.specContent).toContain(
      "No live verification with a real Telegram user sending messages is needed for autonomous completion.",
    );
    expect(telegramAddon?.specContent).toContain(
      "real incoming Telegram messages are outside this add-on completion contract",
    );
  });

  it("defines Mac Electron as a preview-compatible add-on without project secrets", () => {
    const macAddon = PROJECT_ADDONS.find((addon) => addon.id === "mac_electron_app");

    expect(macAddon?.requiredSecrets).toEqual([]);
    expect(macAddon?.specContent).toContain("Electron desktop app");
    expect(macAddon?.specContent).toContain("normal Arena web preview");
    expect(macAddon?.specContent).toContain("0.0.0.0");
    expect(macAddon?.specContent).toContain("preload bridge");
    expect(macAddon?.specContent).toContain("npm run dist:mac");
    expect(macAddon?.specContent).toContain("published build artifacts with sha256 verification");
    expect(macAddon?.specContent).toContain("Ralph must not claim that a Mac bundle exists");
  });
});
