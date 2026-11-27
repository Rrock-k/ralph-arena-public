import { FEATURE_FLAG_KEYS } from "@/lib/feature-flag-keys";
import { getFeatureFlagsSnapshot } from "@/lib/feature-flags";

/**
 * RA-243: Capability → feature flag gate.
 *
 * Capabilities listed here are only active when the corresponding
 * feature flag is ON. Capabilities without a mapping always pass through.
 */
const CAPABILITY_FLAG_GATE: Record<string, keyof Awaited<ReturnType<typeof getFeatureFlagsSnapshot>>> = {
  [FEATURE_FLAG_KEYS.communityQa]: "communityQa",
};

/**
 * Filter loop capabilities by platform feature flags.
 * effective caps = raw caps ∩ enabled flags (for gated caps).
 */
export async function filterCapabilitiesByFlags(raw: string[]): Promise<string[]> {
  const gatedCaps = raw.filter((cap) => cap in CAPABILITY_FLAG_GATE);
  if (gatedCaps.length === 0) return raw;

  const flags = await getFeatureFlagsSnapshot();
  return raw.filter((cap) => {
    const snapshotKey = CAPABILITY_FLAG_GATE[cap];
    if (!snapshotKey) return true;
    return flags[snapshotKey];
  });
}
