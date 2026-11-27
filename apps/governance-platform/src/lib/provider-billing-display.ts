type ProviderBillingMode = "byok" | "platform_credits" | "platform_credentials";

type ProviderBillingDisplayInput = {
  agent?: string | null;
  providerBillingMode?: string | null;
  claudeAuthMode?: string | null;
  codexAuthMode?: string | null;
};

function normalizeProviderBillingMode(value: string | null | undefined): ProviderBillingMode {
  if (value === "platform_credits" || value === "platform_credentials") {
    return value;
  }
  return "byok";
}

function formatAuthMode(agent: string | null | undefined, input: ProviderBillingDisplayInput): string {
  if (agent === "claude-code") {
    return input.claudeAuthMode === "api_key" ? "API key" : "OAuth";
  }
  if (agent === "codex") {
    return input.codexAuthMode === "api_key" ? "API key" : "Subscription";
  }
  return "n/a";
}

export function formatProviderBillingDisplay(input: ProviderBillingDisplayInput): string {
  const billingMode = normalizeProviderBillingMode(input.providerBillingMode);

  if (billingMode === "platform_credits") {
    return "Platform Credits";
  }

  if (billingMode === "platform_credentials") {
    return `Platform credentials / ${formatAuthMode(input.agent, input)}`;
  }

  return "BYOK / API key";
}
