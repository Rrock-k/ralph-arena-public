import { describe, expect, it } from "vitest";
import { formatProviderBillingDisplay } from "@/lib/provider-billing-display";

describe("formatProviderBillingDisplay", () => {
  it("shows Platform Credits before auth-mode defaults", () => {
    expect(formatProviderBillingDisplay({
      agent: "codex",
      providerBillingMode: "platform_credits",
      codexAuthMode: null,
    })).toBe("Platform Credits");
  });

  it("shows platform subscription credentials explicitly", () => {
    expect(formatProviderBillingDisplay({
      agent: "codex",
      providerBillingMode: "platform_credentials",
      codexAuthMode: "subscription",
    })).toBe("Platform credentials / Subscription");
  });

  it("shows BYOK as API-key billing even when legacy auth mode is empty", () => {
    expect(formatProviderBillingDisplay({
      agent: "codex",
      providerBillingMode: "byok",
      codexAuthMode: null,
    })).toBe("BYOK / API key");
  });
});
