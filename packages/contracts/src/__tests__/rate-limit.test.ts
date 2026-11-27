import { describe, expect, it } from "vitest";

import { detectRateLimitSignal, resolveLoopRateLimitRetryAt } from "../rate-limit.js";

describe("resolveLoopRateLimitRetryAt", () => {
  it("prefers an explicit structured retryAt from the loop terminal artifact", () => {
    expect(resolveLoopRateLimitRetryAt({
      pauseReason: "RATE_LIMIT",
      retryAt: "2026-04-22T19:00:00.000Z",
      reason: "Agent hit provider rate limit.",
    })).toBe("2026-04-22T19:00:00.000Z");
  });

  it("falls back to parsing the loop reason text for old result artifacts", () => {
    expect(resolveLoopRateLimitRetryAt(
      {
        pauseReason: "RATE_LIMIT",
        reason: "You've hit your limit · resets 7pm (UTC)",
      },
      { referenceTime: new Date("2026-04-22T14:54:38.000Z") },
    )).toBe("2026-04-22T19:00:00.000Z");
  });

  it("ignores non-rate-limit pause artifacts", () => {
    expect(resolveLoopRateLimitRetryAt({
      pauseReason: "INFRA",
      retryAt: "2026-04-22T19:00:00.000Z",
      reason: "Provider API unreachable",
    })).toBeUndefined();
  });
});

describe("detectRateLimitSignal", () => {
  it("parses explicit UTC reset phrases", () => {
    const signal = detectRateLimitSignal(
      "You've hit your limit · resets 7pm (UTC)",
      { referenceTime: new Date("2026-04-22T14:54:38.000Z") },
    );
    expect(signal?.retryAt?.toISOString()).toBe("2026-04-22T19:00:00.000Z");
  });

  it("detects Claude session-limit phrasing without a structured event", () => {
    const signal = detectRateLimitSignal(
      "You've hit your session limit · resets 2:40am (UTC)",
      { referenceTime: new Date("2026-06-06T23:52:34.000Z") },
    );

    expect(signal?.source).toBe("claude_limit_text");
    expect(signal?.retryAt?.toISOString()).toBe("2026-06-07T02:40:00.000Z");
  });

  it("does not push a just-expired time-only UTC reset to the next day", () => {
    const signal = detectRateLimitSignal(
      "You've hit your session limit · resets 9:12pm (UTC)",
      { referenceTime: new Date("2026-06-22T21:12:42.000Z") },
    );

    expect(signal?.retryAt?.toISOString()).toBe("2026-06-22T21:12:00.000Z");
  });

  it("detects Codex quota exhausted billing output", () => {
    const signal = detectRateLimitSignal("ERROR: Quota exceeded. Check your plan and billing details.");
    expect(signal?.source).toBe("quota_exceeded");
    expect(signal?.reasonCode).toBe("rate_limit");
  });
});
