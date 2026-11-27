import { describe, expect, it } from "vitest";

import { getPublicControlPlaneHosts, shouldBlockPublicControlPlaneRequest } from "./control-plane-access";

describe("control plane access guard", () => {
  it("collects public governance hosts from url env vars", () => {
    const hosts = getPublicControlPlaneHosts({
      AUTH_URL: "https://app.arena.example.test",
      NEXTAUTH_URL: "https://app.arena.example.test",
      GOVERNANCE_PUBLIC_URL: "https://ops.example.com",
    } as unknown as NodeJS.ProcessEnv);

    expect(Array.from(hosts).sort()).toEqual(["app.arena.example.test", "ops.example.com"]);
  });

  it("blocks public admin ctl requests", () => {
    expect(shouldBlockPublicControlPlaneRequest({
      pathname: "/api/admin/ctl/system-overview",
      requestHost: "app.arena.example.test",
      env: {
        AUTH_URL: "https://app.arena.example.test",
      } as unknown as NodeJS.ProcessEnv,
    })).toBe(true);
  });

  it("allows internal hosts for admin ctl requests", () => {
    expect(shouldBlockPublicControlPlaneRequest({
      pathname: "/api/admin/ctl/system-overview",
      requestHost: "localhost:3000",
      env: {
        AUTH_URL: "https://app.arena.example.test",
      } as unknown as NodeJS.ProcessEnv,
    })).toBe(false);

    expect(shouldBlockPublicControlPlaneRequest({
      pathname: "/api/admin/ctl/system-overview",
      requestHost: "governance-platform:3000",
      env: {
        AUTH_URL: "https://app.arena.example.test",
      } as unknown as NodeJS.ProcessEnv,
    })).toBe(false);
  });

  it("does not touch unrelated paths", () => {
    expect(shouldBlockPublicControlPlaneRequest({
      pathname: "/api/auth/session",
      requestHost: "app.arena.example.test",
      env: {
        AUTH_URL: "https://app.arena.example.test",
      } as unknown as NodeJS.ProcessEnv,
    })).toBe(false);
  });
});
