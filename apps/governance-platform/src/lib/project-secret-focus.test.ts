import { describe, expect, it } from "vitest";
import { getMissingFocusedRequiredSecretKey } from "./project-secret-focus";

describe("project secret focus", () => {
  it("returns null when no valid required secret key is focused", () => {
    expect(getMissingFocusedRequiredSecretKey(null, [])).toBeNull();
    expect(getMissingFocusedRequiredSecretKey("not a key", [])).toBeNull();
  });

  it("returns null when the focused key exists on the project", () => {
    expect(getMissingFocusedRequiredSecretKey("telegram_bot_token", [
      { key: "TELEGRAM_BOT_TOKEN", blocking: true },
    ])).toBeNull();
  });

  it("returns the normalized key when the focused key is not configured", () => {
    expect(getMissingFocusedRequiredSecretKey("telegram_bot_token", [])).toBe("TELEGRAM_BOT_TOKEN");
  });
});
