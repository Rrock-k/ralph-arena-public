import { describe, expect, it } from "vitest";
import {
  buildProjectSecretsFocusHref,
  buildProjectVisualEvidenceFocusHref,
  getProjectRequiredSecretAnchorId,
  parseProjectInteractionFocus,
} from "./project-interaction-deeplink";

describe("project interaction deeplinks", () => {
  it("parses the secrets focus target and normalizes required secret keys", () => {
    expect(parseProjectInteractionFocus({
      focus: "secrets",
      requiredSecret: " telegram_bot_token ",
    })).toEqual({
      section: "secrets",
      requiredSecretKey: "TELEGRAM_BOT_TOKEN",
      provideSecretKey: null,
    });
  });

  it("ignores invalid focus sections and invalid required secret keys", () => {
    expect(parseProjectInteractionFocus({ focus: "status" })).toBeNull();
    expect(parseProjectInteractionFocus({
      focus: "secrets",
      requiredSecret: "not a secret value",
    })).toEqual({
      section: "secrets",
      requiredSecretKey: null,
      provideSecretKey: null,
    });
  });

  it("parses the provide-secret action target without accepting unsafe values", () => {
    expect(parseProjectInteractionFocus({
      focus: "secrets",
      requiredSecret: "telegram_bot_token",
      provideSecret: " telegram_bot_token ",
    })).toEqual({
      section: "secrets",
      requiredSecretKey: "TELEGRAM_BOT_TOKEN",
      provideSecretKey: "TELEGRAM_BOT_TOKEN",
    });
    expect(parseProjectInteractionFocus({
      focus: "secrets",
      provideSecret: "token=value",
    })).toEqual({
      section: "secrets",
      requiredSecretKey: null,
      provideSecretKey: null,
    });
  });

  it("parses visual evidence focus targets and rejects unsafe review ids", () => {
    expect(parseProjectInteractionFocus({
      focus: "visualEvidence",
      review: " visual:abc-123 ",
    })).toEqual({
      section: "visualEvidence",
      reviewId: "visual:abc-123",
    });
    expect(parseProjectInteractionFocus({
      focus: "visualEvidence",
      review: "../raw-path",
    })).toEqual({
      section: "visualEvidence",
      reviewId: null,
    });
  });

  it("builds stable manager secrets hrefs without secret values", () => {
    expect(buildProjectSecretsFocusHref("project-1", "telegram_bot_token")).toBe(
      "/my/projects/project-1?focus=secrets&requiredSecret=TELEGRAM_BOT_TOKEN#project-secrets",
    );
    expect(buildProjectSecretsFocusHref("project-1", "not a key")).toBe(
      "/my/projects/project-1?focus=secrets#project-secrets",
    );
    expect(buildProjectSecretsFocusHref("project-1", "telegram_bot_token", { action: "provide" })).toBe(
      "/my/projects/project-1?focus=secrets&requiredSecret=TELEGRAM_BOT_TOKEN&provideSecret=TELEGRAM_BOT_TOKEN#project-secrets",
    );
  });

  it("builds stable visual evidence focus hrefs without raw artifact paths", () => {
    expect(buildProjectVisualEvidenceFocusHref("project-1", "visual:abc-123")).toBe(
      "/my/projects/project-1?focus=visualEvidence&review=visual%3Aabc-123#project-visual-evidence",
    );
    expect(buildProjectVisualEvidenceFocusHref("project-1", "../raw-path")).toBe(
      "/my/projects/project-1?focus=visualEvidence#project-visual-evidence",
    );
  });

  it("builds stable required-secret anchor ids from key names", () => {
    expect(getProjectRequiredSecretAnchorId("TELEGRAM_BOT_TOKEN")).toBe(
      "required-secret-telegram-bot-token",
    );
  });
});
