import { describe, expect, it } from "vitest";

import { getLoopActionBlockMessage, resolveLoopSupport, runtimeConfigUsesRepoHead } from "./loop-support";

describe("resolveLoopSupport", () => {
  it("treats pinned rows as upgrade-required", () => {
    const support = resolveLoopSupport({
      agentImpl: "ralph",
      loopName: "ralph",
      loopVersion: "1.5.0",
      supportTier: "supported",
      useRepoHead: false,
      hasLoopVersion: true,
    });

    expect(support.loopIdentity).toBe("ralph Pinned v1.5.0");
    expect(support.supportStatus).toBe("upgrade-required");
    expect(support.supportLabel).toBe("upgrade required");
    expect(support.appStartAllowed).toBe(true);
    expect(support.agentStartAllowed).toBe(false);
    expect(support.relaunchAllowed).toBe(false);
  });

  it("treats bundled-default rows as the only supported runtime mode", () => {
    const support = resolveLoopSupport({
      agentImpl: "ralph",
      loopName: "ralph",
      loopVersion: "1.5.0",
      supportTier: "supported",
      useRepoHead: true,
      hasLoopVersion: true,
    });

    expect(support.loopIdentity).toBe("ralph Bundled default");
    expect(support.baseSupportTier).toBe("supported");
    expect(support.supportStatus).toBe("supported");
    expect(support.supportHint).toContain("Bundled default");
    expect(support.agentStartAllowed).toBe(true);
  });

  it("allows App ON for pinned rows but still blocks agent actions with an upgrade-required message", () => {
    const support = resolveLoopSupport({
      agentImpl: "ralph",
      loopName: "ralph",
      loopVersion: "1.4.0",
      supportTier: "unsupported",
      useRepoHead: false,
      hasLoopVersion: true,
    });

    expect(support.appStartAllowed).toBe(true);
    expect(support.agentStartAllowed).toBe(false);
    expect(getLoopActionBlockMessage(support, "power_on")).toBeNull();
    expect(getLoopActionBlockMessage(support, "agent_on")).toContain("bundled default runtime");
    expect(getLoopActionBlockMessage(support, "launch")).toContain("Upgrade this project");
  });

  it("treats agentImpl/loop mismatch as unsupported", () => {
    const support = resolveLoopSupport({
      agentImpl: "direct",
      loopName: "ralph",
      loopVersion: "1.5.0",
      supportTier: "supported",
      useRepoHead: false,
      hasLoopVersion: true,
    });

    expect(support.supportStatus).toBe("unsupported");
    expect(support.mismatchReason).toContain('agentImpl "direct"');
    expect(support.agentStartAllowed).toBe(false);
  });
});

describe("runtimeConfigUsesRepoHead", () => {
  it("reads repo-head mode from persisted runtimeConfig storage", () => {
    expect(runtimeConfigUsesRepoHead({ useRepoHead: true })).toBe(true);
  });

  it("rejects missing or false runtimeConfig markers", () => {
    expect(runtimeConfigUsesRepoHead(null)).toBe(false);
    expect(runtimeConfigUsesRepoHead({})).toBe(false);
    expect(runtimeConfigUsesRepoHead({ useRepoHead: false })).toBe(false);
  });
});
