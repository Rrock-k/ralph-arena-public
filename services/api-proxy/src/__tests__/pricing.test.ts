import { describe, expect, it } from "vitest";
import { calculateCostUsd } from "../pricing.js";

describe("pricing", () => {
  it("calculates cost for known model", () => {
    const cost = calculateCostUsd(1_000_000, 1_000_000, "gpt-5-codex");
    expect(cost).toBeCloseTo(11.25, 6);
  });

  it("calculates cost for GPT-5.5", () => {
    const cost = calculateCostUsd(1_000_000, 1_000_000, "gpt-5.5");
    expect(cost).toBeCloseTo(35, 6);
  });

  it("calculates cost for Claude Opus 4.8", () => {
    const cost = calculateCostUsd(1_000_000, 1_000_000, "claude-opus-4-8");
    expect(cost).toBeCloseTo(30, 6);
  });

  it("uses default pricing for unknown model", () => {
    const cost = calculateCostUsd(1_000_000, 1_000_000, "unknown-model");
    expect(cost).toBeCloseTo(18, 6);
  });

  it("returns zero cost for glm free-tier models", () => {
    const cost = calculateCostUsd(1_000_000, 1_000_000, "glm-4.7-flash");
    expect(cost).toBe(0);
  });
});
