import { describe, expect, it } from "vitest";
import { calculateCostUsd, getModelPricing } from "./pricing";

describe("governance pricing", () => {
  it("returns known pricing for supported model", () => {
    const pricing = getModelPricing("gpt-5-codex");
    expect(pricing.inputPer1M).toBe(1.25);
    expect(pricing.outputPer1M).toBe(10);
  });

  it("returns known pricing for GPT-5.5", () => {
    const pricing = getModelPricing("gpt-5.5");
    expect(pricing.inputPer1M).toBe(5);
    expect(pricing.outputPer1M).toBe(30);
  });

  it("returns known pricing for Claude Opus 4.8", () => {
    const pricing = getModelPricing("claude-opus-4-8");
    expect(pricing.inputPer1M).toBe(5);
    expect(pricing.outputPer1M).toBe(25);
  });

  it("returns zero pricing for OpenCode Zen free models", () => {
    const pricing = getModelPricing("opencode/minimax-m3-free");
    expect(pricing.inputPer1M).toBe(0);
    expect(pricing.outputPer1M).toBe(0);
  });

  it("falls back to default pricing for unknown model", () => {
    const pricing = getModelPricing("unknown-model");
    expect(pricing.inputPer1M).toBe(3);
    expect(pricing.outputPer1M).toBe(15);
  });

  it("calculates expected cost", () => {
    const cost = calculateCostUsd(1_000_000, 1_000_000, "gpt-5-codex");
    expect(cost).toBeCloseTo(11.25, 6);
  });
});
