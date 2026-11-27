import { describe, expect, it } from "vitest";
import {
  MODEL_PRICING,
  calculateCostUsd,
} from "@arena/contracts";

const MODELS_TO_COMPARE = [
  "haiku",
  "claude-sonnet-4-6",
  "claude-opus-5",
  "claude-opus-4-8",
  "claude-fable-5",
  "gpt-5-codex",
  "gpt-5.5",
  "gpt-5.3-codex-mini",
  "glm-4.7-flash",
] as const;

describe("pricing from @arena/contracts", () => {
  it("includes all key models", () => {
    for (const model of MODELS_TO_COMPARE) {
      expect(MODEL_PRICING[model]).toBeDefined();
    }
  });

  it("calculates costs correctly", () => {
    const vectors = [
      { input: 12_345, output: 67_890, model: "gpt-5-codex", expected: (12_345 * 1.25 + 67_890 * 10.00) / 1_000_000 },
      { input: 1_000_000, output: 1_000_000, model: "gpt-5.5", expected: 35.00 },
      { input: 1_000_000, output: 1_000_000, model: "claude-opus-4-8", expected: 30.00 },
      { input: 1_000_000, output: 1_000_000, model: "claude-opus-5", expected: 30.00 },
      { input: 1_000_000, output: 1_000_000, model: "claude-fable-5", expected: 60.00 },
      { input: 500_000, output: 100_000, model: "glm-4.7-flash", expected: 0 },
    ] as const;

    for (const v of vectors) {
      expect(calculateCostUsd(v.input, v.output, v.model)).toBeCloseTo(v.expected, 12);
    }
  });

  it("falls back to default pricing for unknown models", () => {
    const cost = calculateCostUsd(1_000_000, 1_000_000, "unknown-model");
    // Default: 3.00 input + 15.00 output = 18.00
    expect(cost).toBeCloseTo(18.00, 12);
  });
});
