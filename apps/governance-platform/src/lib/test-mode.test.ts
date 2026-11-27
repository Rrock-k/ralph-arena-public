import { describe, expect, it } from "vitest";

import { getRequestHost, isTestModeEnabledForRequest } from "./test-mode";

describe("test mode request guard", () => {
  it("extracts host from request headers", () => {
    const request = new Request("http://example.invalid/api/test/a2e", {
      headers: {
        host: "preview-app.localhost:3000",
      },
    });

    expect(getRequestHost(request)).toBe("preview-app.localhost");
  });

  it("rejects public hosts even when playwright flag is enabled", () => {
    process.env.PLAYWRIGHT_TEST = "1";
    const request = new Request("https://app.arena.example.test/api/test/a2e", {
      headers: {
        host: "app.arena.example.test",
      },
    });

    expect(isTestModeEnabledForRequest(request)).toBe(false);
  });

  it("does not trust spoofed forwarded host on public requests", () => {
    process.env.PLAYWRIGHT_TEST = "1";
    const request = new Request("https://app.arena.example.test/api/test/a2e", {
      headers: {
        host: "app.arena.example.test",
        "x-forwarded-host": "localhost:3000",
      },
    });

    expect(isTestModeEnabledForRequest(request)).toBe(false);
  });

  it("allows local hosts in explicit test mode", () => {
    process.env.PLAYWRIGHT_TEST = "1";
    const request = new Request("http://localhost:3000/api/test/a2e", {
      headers: {
        host: "localhost:3000",
      },
    });

    expect(isTestModeEnabledForRequest(request)).toBe(true);
  });
});
