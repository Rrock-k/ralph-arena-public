import { describe, expect, it } from "vitest";
import { calculateCostUsd, shouldTrackCliBudgetUsage } from "./usage.js";

describe("shouldTrackCliBudgetUsage", () => {
  it("does not track CLI budget usage for Platform Credits runs because api-proxy owns debit", () => {
    expect(shouldTrackCliBudgetUsage(
      "codex",
      { ARENA_CODEX_AUTH_MODE: "api_key" } as NodeJS.ProcessEnv,
      "platform_credits",
    )).toBe(false);
  });

  it("does not track ordinary BYOK API-key usage", () => {
    expect(shouldTrackCliBudgetUsage(
      "codex",
      { ARENA_CODEX_AUTH_MODE: "api_key" } as NodeJS.ProcessEnv,
      "byok",
    )).toBe(false);
  });

  it("preserves subscription usage tracking", () => {
    expect(shouldTrackCliBudgetUsage(
      "codex",
      { ARENA_CODEX_AUTH_MODE: "subscription" } as NodeJS.ProcessEnv,
      "byok",
    )).toBe(true);
  });

  it("does not parse subscription usage for Antigravity until a usage contract exists", () => {
    expect(shouldTrackCliBudgetUsage(
      "antigravity",
      {} as NodeJS.ProcessEnv,
      "byok",
    )).toBe(false);
  });

  it("does not parse subscription usage for OpenCode until a usage contract exists", () => {
    expect(shouldTrackCliBudgetUsage(
      "opencode",
      {} as NodeJS.ProcessEnv,
      "byok",
    )).toBe(false);
  });

  it("keeps OpenCode MiniMax M3 free in local runner cost estimates", () => {
    expect(calculateCostUsd(1_000_000, 1_000_000, "opencode/minimax-m3-free")).toBe(0);
  });
});
