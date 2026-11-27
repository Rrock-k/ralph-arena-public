import { describe, expect, it } from "vitest";
import { loadConfig } from "../config.js";

describe("loadConfig", () => {
  it("does not force a shell refresh command when none is configured", () => {
    const config = loadConfig({
      HOME: "/home/node",
    });

    expect(config.claudeRefreshCommand).toBeUndefined();
  });
});
