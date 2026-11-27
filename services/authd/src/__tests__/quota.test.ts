import { describe, expect, it } from "vitest";
import { buildProviderPostMortem, mapClaudeQuotaResponse, mapCodexRpcQuota } from "../quota.js";
import type { ProviderHealth } from "../types.js";

function makeHealth(status: ProviderHealth["status"]): ProviderHealth {
  return {
    provider: "codex",
    source: "codex-auth-json",
    status,
    version: "v1",
    checkedAt: "2026-06-25T00:00:00.000Z",
    detail: status === "invalid" ? "token expired" : null,
  };
}

describe("authd quota mapping", () => {
  it("maps Claude OAuth quota windows into the shared contract", () => {
    expect(mapClaudeQuotaResponse({
      five_hour: { utilization: 1, resets_at: "2026-03-20T08:00:00.000Z" },
      seven_day: { utilization: 0.42, resets_at: "2026-03-23T00:00:00.000Z" },
      extra_usage: {
        is_enabled: true,
        monthly_limit: 100,
        used_credits: 12.5,
        utilization: 0.125,
        currency: "usd",
      },
    })).toEqual([
      {
        label: "Current session",
        usedPercent: 100,
        resetsAt: "2026-03-20T08:00:00.000Z",
        valueLabel: null,
        detail: null,
      },
      {
        label: "Current week (all models)",
        usedPercent: 42,
        resetsAt: "2026-03-23T00:00:00.000Z",
        valueLabel: null,
        detail: null,
      },
      {
        label: "Extra usage",
        usedPercent: 13,
        resetsAt: null,
        valueLabel: "$12.50 / $100.00",
        detail: "Monthly extra usage pool",
      },
    ]);
  });

  it("maps Codex RPC quota windows into the shared contract", () => {
    expect(mapCodexRpcQuota({
      rateLimits: {
        limitId: "codex",
        primary: { usedPercent: 100, resetsAt: 1_773_993_600 },
        secondary: { usedPercent: 27, resetsAt: 1_774_252_800 },
        credits: { unlimited: false, balance: "4.2" },
      },
      rateLimitsByLimitId: {
        "gpt-5": {
          limitId: "gpt-5",
          limitName: "GPT-5",
          primary: { usedPercent: 8, resetsAt: 1_773_996_000 },
          secondary: { usedPercent: 20, resetsAt: 1_774_339_200 },
        },
      },
    })).toEqual([
      {
        label: "5h limit",
        usedPercent: 100,
        resetsAt: "2026-03-20T08:00:00.000Z",
        valueLabel: null,
        detail: null,
      },
      {
        label: "Weekly limit",
        usedPercent: 27,
        resetsAt: "2026-03-23T08:00:00.000Z",
        valueLabel: null,
        detail: null,
      },
      {
        label: "Credits",
        usedPercent: null,
        resetsAt: null,
        valueLabel: "$4.20 remaining",
        detail: null,
      },
      {
        label: "GPT-5 · 5h limit",
        usedPercent: 8,
        resetsAt: "2026-03-20T08:40:00.000Z",
        valueLabel: null,
        detail: null,
      },
      {
        label: "GPT-5 · Weekly limit",
        usedPercent: 20,
        resetsAt: "2026-03-24T08:00:00.000Z",
        valueLabel: null,
        detail: null,
      },
    ]);
  });

  it("classifies post-mortem diagnosis from health and quota truth", () => {
    const postMortem = buildProviderPostMortem({
      provider: "codex",
      health: makeHealth("invalid"),
      quota: {
        provider: "openai",
        source: "codex-rpc",
        ok: false,
        error: "quota unavailable",
        windows: [],
      },
      postMortemInput: { failureType: "auth", message: "secret text".repeat(100) },
    });

    expect(postMortem.diagnosis).toBe("auth_invalid");
    expect(postMortem.detail).toBe("token expired");
    expect(postMortem.input.message?.length).toBe(500);
  });

  it("classifies provider 429 as quota-limited rather than unavailable", () => {
    const postMortem = buildProviderPostMortem({
      provider: "claude",
      health: {
        provider: "claude",
        source: "claude-oauth-credentials",
        status: "ready",
        version: "v1",
        checkedAt: "2026-06-25T00:00:00.000Z",
        detail: "Claude OAuth credentials are usable but quota is currently limited.",
      },
      quota: {
        provider: "anthropic",
        source: "anthropic-oauth",
        ok: false,
        error: "Anthropic OAuth usage API returned 429; quota is currently limited.",
        windows: [],
      },
    });

    expect(postMortem.diagnosis).toBe("quota_limited");
    expect(postMortem.detail).toBe("Anthropic OAuth usage API returned 429; quota is currently limited.");
  });
});
