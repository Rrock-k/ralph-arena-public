import { describe, expect, it } from "vitest";

import {
  extractBypassHost,
  isLocalBypassHost,
  shouldAllowE2EAdminBypass,
} from "./e2e-auth-bypass";

describe("e2e auth bypass", () => {
  it("extracts hostnames from forwarded values", () => {
    expect(extractBypassHost("https://app.arena.example.test/admin")).toBe("app.arena.example.test");
    expect(extractBypassHost("preview-app.localhost:8080")).toBe("preview-app.localhost");
    expect(extractBypassHost("127.0.0.1:3000")).toBe("127.0.0.1");
  });

  it("allows only local bypass hosts", () => {
    expect(isLocalBypassHost("localhost")).toBe(true);
    expect(isLocalBypassHost("preview-app.localhost")).toBe(true);
    expect(isLocalBypassHost("127.0.0.1")).toBe(true);
    expect(isLocalBypassHost("governance-platform")).toBe(true);
    expect(isLocalBypassHost("app.arena.example.test")).toBe(false);
  });

  it("requires explicit cookie even in playwright mode", () => {
    expect(shouldAllowE2EAdminBypass({
      playwrightTest: "1",
      requestHost: "localhost",
      bypassCookie: null,
    })).toBe(false);
  });

  it("rejects public hosts even if cookie is present", () => {
    expect(shouldAllowE2EAdminBypass({
      playwrightTest: "1",
      requestHost: "app.arena.example.test",
      bypassCookie: "1",
    })).toBe(false);
  });

  it("allows local playwright bypass only with cookie", () => {
    expect(shouldAllowE2EAdminBypass({
      playwrightTest: "1",
      requestHost: "localhost",
      bypassCookie: "1",
    })).toBe(true);
  });
});
