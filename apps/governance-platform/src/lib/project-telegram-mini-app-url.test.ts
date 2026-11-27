import { describe, expect, it } from "vitest";
import {
  buildProjectTelegramMainMiniAppUrl,
  buildProjectTelegramMiniAppDirectUrl,
} from "./project-telegram-mini-app-url";

describe("project Telegram Mini App URL", () => {
  it("builds direct links to a project bot main Mini App", () => {
    expect(buildProjectTelegramMiniAppDirectUrl({
      botUsername: "samplebot",
      miniAppShortName: "sampleapp",
      projectId: "cmpcxmtut0h2n5inse8g15ilo",
    })).toBe("https://t.me/samplebot/sampleapp?startapp=cmpcxmtut0h2n5inse8g15ilo");
  });

  it("builds main Mini App links for project bots with BotFather Main App configured", () => {
    expect(buildProjectTelegramMainMiniAppUrl({
      botUsername: "samplebot",
      projectId: "cmpcxmtut0h2n5inse8g15ilo",
    })).toBe("https://t.me/samplebot?startapp=cmpcxmtut0h2n5inse8g15ilo");
  });

  it("rejects unsafe usernames and start params", () => {
    expect(buildProjectTelegramMiniAppDirectUrl({
      botUsername: "bad/username",
      miniAppShortName: "sampleapp",
      projectId: "cmpcxmtut0h2n5inse8g15ilo",
    })).toBeNull();
    expect(buildProjectTelegramMiniAppDirectUrl({
      botUsername: "samplebot",
      miniAppShortName: "bad/name",
      projectId: "cmpcxmtut0h2n5inse8g15ilo",
    })).toBeNull();
    expect(buildProjectTelegramMiniAppDirectUrl({
      botUsername: "samplebot",
      miniAppShortName: "sampleapp",
      projectId: "bad:value",
    })).toBeNull();
    expect(buildProjectTelegramMainMiniAppUrl({
      botUsername: "bad/username",
      projectId: "cmpcxmtut0h2n5inse8g15ilo",
    })).toBeNull();
    expect(buildProjectTelegramMainMiniAppUrl({
      botUsername: "samplebot",
      projectId: "bad:value",
    })).toBeNull();
  });
});
