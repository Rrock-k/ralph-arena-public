import { describe, expect, it } from "vitest";
import type { ProviderQuotaResponse } from "./provider-quotas";
import {
  platformSubscriptionQuotaProvider,
  providerQuotaAvailability,
} from "./provider-quota-unpark";

describe("platformSubscriptionQuotaProvider", () => {
  const base = {
    agent: "codex",
    providerBillingMode: "platform_credentials",
    claudeAuthMode: null,
    codexAuthMode: "subscription",
  };

  it("resolves codex on platform credentials to the openai subscription", () => {
    expect(platformSubscriptionQuotaProvider(base)).toBe("openai");
  });

  it("resolves claude-code on platform credentials to the anthropic subscription", () => {
    expect(platformSubscriptionQuotaProvider({
      ...base,
      agent: "claude-code",
      codexAuthMode: null,
      claudeAuthMode: "oauth",
    })).toBe("anthropic");
  });

  it("treats an unset claudeAuthMode as oauth, matching run-auth", () => {
    expect(platformSubscriptionQuotaProvider({
      ...base,
      agent: "claude-code",
      codexAuthMode: null,
      claudeAuthMode: null,
    })).toBe("anthropic");
  });

  it("excludes api-key runs — they do not burn the shared subscription", () => {
    expect(platformSubscriptionQuotaProvider({ ...base, codexAuthMode: "api_key" })).toBeNull();
    expect(platformSubscriptionQuotaProvider({
      ...base,
      agent: "claude-code",
      codexAuthMode: null,
      claudeAuthMode: "api_key",
    })).toBeNull();
  });

  it("excludes byok and platform-credits billing", () => {
    expect(platformSubscriptionQuotaProvider({ ...base, providerBillingMode: "byok" })).toBeNull();
    expect(platformSubscriptionQuotaProvider({ ...base, providerBillingMode: "platform_credits" })).toBeNull();
    expect(platformSubscriptionQuotaProvider({ ...base, providerBillingMode: null })).toBeNull();
  });

  it("excludes agents with no quota-reported provider", () => {
    expect(platformSubscriptionQuotaProvider({ ...base, agent: "opencode" })).toBeNull();
    expect(platformSubscriptionQuotaProvider({ ...base, agent: "antigravity" })).toBeNull();
  });
});

describe("providerQuotaAvailability", () => {
  const snapshot = (results: ProviderQuotaResponse["results"]): ProviderQuotaResponse => ({
    generatedAt: "2026-08-02T09:39:33.079Z",
    results,
  });

  const window = (label: string, usedPercent: number | null) => ({
    label,
    usedPercent,
    resetsAt: null,
    valueLabel: null,
    detail: null,
  });

  it("reports free when every measured window has headroom", () => {
    expect(providerQuotaAvailability(
      snapshot([{ provider: "openai", ok: true, windows: [window("5h limit", 7)] }]),
      "openai",
    )).toBe("free");
  });

  it("reports exhausted when any measured window is at the cap", () => {
    expect(providerQuotaAvailability(
      snapshot([{
        provider: "anthropic",
        ok: true,
        windows: [window("Current session", 12), window("Current week (all models)", 100)],
      }]),
      "anthropic",
    )).toBe("exhausted");
  });

  it("ignores informational windows that carry no usedPercent", () => {
    expect(providerQuotaAvailability(
      snapshot([{
        provider: "openai",
        ok: true,
        windows: [window("5h limit", 7), window("Credits", null)],
      }]),
      "openai",
    )).toBe("free");
  });

  it("reports unknown when no window is measurable", () => {
    expect(providerQuotaAvailability(
      snapshot([{ provider: "openai", ok: true, windows: [window("Credits", null)] }]),
      "openai",
    )).toBe("unknown");
  });

  it("reports unknown for a failed or absent provider result", () => {
    expect(providerQuotaAvailability(
      snapshot([{ provider: "openai", ok: false, error: "codex rpc failed", windows: [] }]),
      "openai",
    )).toBe("unknown");
    expect(providerQuotaAvailability(
      snapshot([{ provider: "openai", ok: true, windows: [window("5h limit", 7)] }]),
      "anthropic",
    )).toBe("unknown");
  });
});
