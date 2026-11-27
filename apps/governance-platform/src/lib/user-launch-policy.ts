import {
  hasUserProviderCredential,
  providerDisplayName,
  providerForAgent,
} from "@/lib/user-provider-credentials";
import {
  isByokProviderKeysEnabled,
  isManagedProviderCreditsEnabled,
} from "@/lib/feature-flags";
import {
  ANTIGRAVITY_LOCAL_RALPH_REASON,
  ANTIGRAVITY_OPERATOR_ONLY_REASON,
  ANTIGRAVITY_PLATFORM_CREDENTIALS_REASON,
  isAntigravityRuntimeAgent,
  isOpenCodeRuntimeAgent,
} from "@/lib/agent-runtime-support";

export const PROVIDER_BILLING_MODES = ["byok", "platform_credits", "platform_credentials"] as const;
export type ProviderBillingMode = (typeof PROVIDER_BILLING_MODES)[number];

export type UserLaunchPolicyInput = {
  userId: string | null | undefined;
  privileged: boolean;
  agent: string;
  agentImpl?: string | null | undefined;
  runnerBackend: string | null | undefined;
  providerBillingMode?: string | null | undefined;
};

export function getUserByokAuthModeUpdate(agent: string): {
  claudeAuthMode?: "api_key" | null;
  codexAuthMode?: "api_key" | null;
} {
  if (agent === "codex") {
    return {
      claudeAuthMode: null,
      codexAuthMode: "api_key",
    };
  }
  if (agent === "claude-code") {
    return {
      claudeAuthMode: "api_key",
      codexAuthMode: null,
    };
  }
  if (isOpenCodeRuntimeAgent(agent)) {
    return {
      claudeAuthMode: null,
      codexAuthMode: null,
    };
  }
  return {};
}

export function normalizeAuthModesForProviderBilling(
  agent: string,
  providerBillingMode: string | null | undefined,
  modes: {
    claudeAuthMode?: string | null;
    codexAuthMode?: string | null;
  },
): {
  claudeAuthMode: string | null;
  codexAuthMode: string | null;
} {
  const billingMode = normalizeProviderBillingMode(providerBillingMode);
  if (isOpenCodeRuntimeAgent(agent)) {
    return {
      claudeAuthMode: null,
      codexAuthMode: null,
    };
  }
  if (billingMode === "platform_credits") {
    return {
      claudeAuthMode: null,
      codexAuthMode: null,
    };
  }
  if (billingMode === "byok") {
    return {
      claudeAuthMode: modes.claudeAuthMode ?? null,
      codexAuthMode: modes.codexAuthMode ?? null,
      ...getUserByokAuthModeUpdate(agent),
    };
  }
  return {
    claudeAuthMode: modes.claudeAuthMode ?? null,
    codexAuthMode: modes.codexAuthMode ?? null,
  };
}

export async function enforceUserLaunchPolicy({
  userId,
  privileged,
  agent,
  agentImpl,
  runnerBackend,
  providerBillingMode,
}: UserLaunchPolicyInput): Promise<{ allowed: true } | { allowed: false; error: string }> {
  const billingMode = normalizeProviderBillingMode(providerBillingMode);
  if (isAntigravityRuntimeAgent(agent)) {
    if (!privileged) {
      return {
        allowed: false,
        error: ANTIGRAVITY_OPERATOR_ONLY_REASON,
      };
    }
    if (billingMode !== "platform_credentials") {
      return {
        allowed: false,
        error: ANTIGRAVITY_PLATFORM_CREDENTIALS_REASON,
      };
    }
    if ((runnerBackend || "local") !== "local" || agentImpl !== "ralph") {
      return {
        allowed: false,
        error: ANTIGRAVITY_LOCAL_RALPH_REASON,
      };
    }
    return { allowed: true };
  }

  if (billingMode === "platform_credentials" && !privileged) {
    return {
      allowed: false,
      error: "Platform provider credentials are only available to platform operators.",
    };
  }

  if (!privileged && (runnerBackend || "local") === "vps") {
    return {
      allowed: false,
      error: "Managed VPS launches are not available for user projects yet.",
    };
  }

  const provider = providerForAgent(agent);
  if (!provider) return { allowed: true };
  if (billingMode === "platform_credentials") {
    return { allowed: true };
  }
  if (billingMode === "platform_credits") {
    if (!providerSupportsPlatformCredits(provider)) {
      return {
        allowed: false,
        error: provider === "opencode"
          ? "Platform Credits are not available for OpenCode launches because OpenCode Zen is not routed through api-proxy. Use OpenCode free models outside Platform Credits."
          : `Platform Credits are not available for ${providerDisplayName(provider)} launches yet. Use BYOK credentials.`,
      };
    }
    const platformCreditsEnabled = await isManagedProviderCreditsEnabled();
    if (!platformCreditsEnabled) {
      return {
        allowed: false,
        error: "Platform Credits provider runs are disabled.",
      };
    }
    if (!userId) {
      return {
        allowed: false,
        error: "A signed-in user is required for Platform Credits provider runs.",
      };
    }
    return { allowed: true };
  }

  if (provider === "opencode") {
    return { allowed: true };
  }

  const byokEnabled = privileged ? true : await isByokProviderKeysEnabled();
  if (!byokEnabled) {
    return {
      allowed: false,
      error: "User provider API-key launches are disabled.",
    };
  }
  if (!userId) {
    return {
      allowed: false,
      error: `${providerDisplayName(provider)} API key is required in Settings before launch.`,
    };
  }

  const hasKey = await hasUserProviderCredential(userId, provider);
  if (!hasKey) {
    return {
      allowed: false,
      error: `${providerDisplayName(provider)} API key is required in Settings before launch.`,
    };
  }

  return { allowed: true };
}

function providerSupportsPlatformCredits(provider: string): boolean {
  return provider === "openai" || provider === "anthropic";
}

export function normalizeProviderBillingMode(value: string | null | undefined): ProviderBillingMode {
  if (value === "platform_credits" || value === "platform_credentials") {
    return value;
  }
  return "byok";
}

export function parseProviderBillingMode(value: string | null | undefined): ProviderBillingMode | null {
  if (value === "byok" || value === "platform_credits" || value === "platform_credentials") {
    return value;
  }
  return null;
}
