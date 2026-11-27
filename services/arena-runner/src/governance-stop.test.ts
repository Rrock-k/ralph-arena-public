import { describe, expect, it } from "vitest";

import { buildStopRequestArtifact, resolveGovernanceStop } from "./governance-stop.js";

describe("resolveGovernanceStop", () => {
  it("treats agent_off as a preview-preserving interrupted stop, not deployed completion", () => {
    expect(resolveGovernanceStop("agent_off")).toEqual({
      terminalState: "CANCELED",
      reasonCode: "agent_off",
      keepPreviewAlive: true,
    });
  });

  it("maps budget exhaustion to paused budget truth", () => {
    expect(resolveGovernanceStop("budget_exhausted")).toEqual({
      terminalState: "CANCELED",
      pauseReason: "BUDGET",
      reasonCode: "budget_exhausted",
    });
  });

  it("maps rate-limit blocker stops to paused rate-limit truth", () => {
    expect(resolveGovernanceStop("status_paused_rate_limit")).toEqual({
      terminalState: "CANCELED",
      pauseReason: "RATE_LIMIT",
      reasonCode: "status_paused_rate_limit",
    });
  });

  it("maps manual evidence blockers to paused manual truth", () => {
    expect(resolveGovernanceStop("paused_manual")).toEqual({
      terminalState: "CANCELED",
      pauseReason: "MANUAL",
      reasonCode: "paused_manual",
    });
  });
});

describe("buildStopRequestArtifact", () => {
  it("builds manual interruption hints for agent_off and pause artifacts for blocked stops", () => {
    expect(buildStopRequestArtifact("agent_off")).toEqual({
      reason: "agent_off",
      interruption: "manual",
    });
    expect(buildStopRequestArtifact("budget_exhausted")).toEqual({
      reason: "budget_exhausted",
      pauseReason: "BUDGET",
    });
    expect(buildStopRequestArtifact("paused_manual")).toEqual({
      reason: "paused_manual",
      pauseReason: "MANUAL",
    });
  });
});
