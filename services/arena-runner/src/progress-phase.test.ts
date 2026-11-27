import { describe, expect, it } from "vitest";

import {
  buildTerminalResultArtifact,
  isVerificationLikeProgressState,
  resolveTimeoutTerminalResolution,
  shouldPersistTerminalResultArtifact,
} from "./progress-phase.js";

describe("isVerificationLikeProgressState", () => {
  it("treats public testing state as verification-phase activity", () => {
    expect(isVerificationLikeProgressState("testing")).toBe(true);
  });

  it("keeps legacy internal verification state compatible", () => {
    expect(isVerificationLikeProgressState("verification")).toBe(true);
  });

  it("does not classify unrelated states as verification", () => {
    expect(isVerificationLikeProgressState("coding")).toBe(false);
    expect(isVerificationLikeProgressState("deploying")).toBe(false);
    expect(isVerificationLikeProgressState("idle")).toBe(false);
    expect(isVerificationLikeProgressState(null)).toBe(false);
  });
});

describe("resolveTimeoutTerminalResolution", () => {
  it("treats verification timeout as failed iteration truth", () => {
    expect(resolveTimeoutTerminalResolution({
      verificationTimedOut: true,
      generalIdleTimedOut: false,
      verificationIdleTimeoutMs: 10 * 60 * 1000,
      generalIdleTimeoutMs: 30 * 60 * 1000,
    })).toEqual({
      terminalState: "FAILED",
      reasonCode: "verification_timeout",
      reasonMessage: "Verification timed out after 10 minutes",
    });
  });

  it("keeps general idle timeout as infra pause", () => {
    expect(resolveTimeoutTerminalResolution({
      verificationTimedOut: false,
      generalIdleTimedOut: true,
      verificationIdleTimeoutMs: 10 * 60 * 1000,
      generalIdleTimeoutMs: 30 * 60 * 1000,
    })).toEqual({
      terminalState: "CANCELED",
      pauseReason: "INFRA",
      reasonCode: "general_idle_timeout",
      reasonMessage: "No activity for 30 minutes",
    });
  });

  it("gives verification timeout priority when both flags are set", () => {
    expect(resolveTimeoutTerminalResolution({
      verificationTimedOut: true,
      generalIdleTimedOut: true,
      verificationIdleTimeoutMs: 10 * 60 * 1000,
      generalIdleTimeoutMs: 30 * 60 * 1000,
    })?.terminalState).toBe("FAILED");
  });
});

describe("buildTerminalResultArtifact", () => {
  it("builds a failed artifact for verification timeout truth", () => {
    expect(buildTerminalResultArtifact({
      terminalState: "FAILED",
      reasonMessage: "Verification timed out after 10 minutes",
    })).toEqual({
      status: "FAILED",
      reason: "Verification timed out after 10 minutes",
    });
  });

  it("keeps pauseReason when runner derives a paused terminal result", () => {
    expect(buildTerminalResultArtifact({
      terminalState: "CANCELED",
      pauseReason: "INFRA",
      reasonMessage: "No activity for 30 minutes",
    })).toEqual({
      status: "CANCELED",
      pauseReason: "INFRA",
      reason: "No activity for 30 minutes",
    });
  });
});

describe("shouldPersistTerminalResultArtifact", () => {
  it("persists when no artifact exists yet", () => {
    expect(shouldPersistTerminalResultArtifact(null, {
      status: "FAILED",
      reason: "Verification timed out after 10 minutes",
    })).toBe(true);
  });

  it("persists when stale deployed truth must be replaced", () => {
    expect(shouldPersistTerminalResultArtifact(
      { status: "DEPLOYED", reason: "Done" },
      { status: "FAILED", reason: "Verification timed out after 10 minutes" },
    )).toBe(true);
  });

  it("does not rewrite an already matching artifact", () => {
    expect(shouldPersistTerminalResultArtifact(
      { status: "CANCELED", pauseReason: "INFRA", reason: "No activity for 30 minutes" },
      { status: "CANCELED", pauseReason: "INFRA", reason: "No activity for 30 minutes" },
    )).toBe(false);
  });
}
);
