import type { ProviderQuotaResponse, QuotaProvider } from "./provider-quotas";
import { normalizeProviderBillingMode } from "./user-launch-policy";
import { providerForAgent } from "./user-provider-credentials";

/**
 * RA-382: `RATE_LIMIT` pauses record `retryAt` from the provider's own error
 * text ("try again at Aug 5th"). When the provider releases the window early
 * that timestamp becomes a lie and the project stays parked for days. These
 * helpers resolve the live quota truth that lets `auto-retry` unpark sooner.
 */

export type QuotaAvailability = "free" | "exhausted" | "unknown";

export type QuotaSubscriptionProject = {
  agent: string;
  providerBillingMode: string | null;
  claudeAuthMode: string | null;
  codexAuthMode: string | null;
};

/**
 * Which shared platform subscription this project burns, if any.
 *
 * The quota snapshot describes authd's own accounts, so it is only evidence
 * for runs that authenticate through them: platform credentials plus the
 * provider's subscription/oauth mode. BYOK and platform-credits runs bill
 * elsewhere and stay on the `retryAt` path.
 */
export function platformSubscriptionQuotaProvider(
  project: QuotaSubscriptionProject,
): QuotaProvider | null {
  if (normalizeProviderBillingMode(project.providerBillingMode) !== "platform_credentials") {
    return null;
  }

  const provider = providerForAgent(project.agent);
  if (provider === "openai") {
    return project.codexAuthMode === "subscription" ? "openai" : null;
  }
  if (provider === "anthropic") {
    return (project.claudeAuthMode ?? "oauth") === "oauth" ? "anthropic" : null;
  }
  return null;
}

/**
 * Read one provider's headroom out of a quota snapshot.
 *
 * Only windows that report a numeric `usedPercent` are evidence. Informational
 * rows (Codex "Credits", Anthropic "Extra usage") carry `usedPercent: null` and
 * neither prove nor disprove headroom. With no numeric window at all the answer
 * is `unknown` — callers must keep waiting rather than guess.
 */
export function providerQuotaAvailability(
  snapshot: ProviderQuotaResponse,
  provider: QuotaProvider,
): QuotaAvailability {
  const result = snapshot.results.find((entry) => entry.provider === provider);
  if (!result || !result.ok) return "unknown";

  const measured = result.windows
    .map((window) => window.usedPercent)
    .filter((usedPercent): usedPercent is number => typeof usedPercent === "number");

  if (measured.length === 0) return "unknown";
  return measured.every((usedPercent) => usedPercent < 100) ? "free" : "exhausted";
}
