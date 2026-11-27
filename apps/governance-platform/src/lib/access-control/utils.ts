import { ACCESS_PRESET_DEFINITIONS } from "./presets";
import type {
  AccessCapability,
  AccessGrantRecord,
  AccessGrantVisualState,
  EffectiveAccessCapabilityEntry,
  EffectiveAccessSource,
} from "./types";

export function getAccessGrantVisualState(
  grant: Pick<AccessGrantRecord, "expiresAt" | "revokedAt">,
): AccessGrantVisualState {
  if (grant.revokedAt) return "revoked";
  if (grant.expiresAt && new Date(grant.expiresAt).getTime() < Date.now()) {
    return "expired";
  }
  return "active";
}

export function isAccessGrantActive(
  grant: Pick<AccessGrantRecord, "expiresAt" | "revokedAt">,
): boolean {
  return getAccessGrantVisualState(grant) === "active";
}

export function getAccessGrantLabel(
  grant: Pick<AccessGrantRecord, "customLabel" | "sourcePresetKey" | "capabilities">,
): string {
  if (grant.customLabel) return grant.customLabel;
  if (grant.sourcePresetKey) {
    return ACCESS_PRESET_DEFINITIONS[grant.sourcePresetKey].label;
  }
  return `Custom (${grant.capabilities.length} capabilities)`;
}

export function buildEffectiveCapabilityEntries(
  sources: EffectiveAccessSource[],
): EffectiveAccessCapabilityEntry[] {
  const byCapability = new Map<AccessCapability, string[]>();

  for (const source of sources) {
    for (const capability of source.capabilities) {
      const current = byCapability.get(capability) ?? [];
      current.push(source.label);
      byCapability.set(capability, current);
    }
  }

  return [...byCapability.entries()]
    .map(([capability, grantedVia]) => ({ capability, grantedVia }))
    .sort((a, b) => a.capability.localeCompare(b.capability));
}

export function getEffectiveCapabilities(
  sources: EffectiveAccessSource[],
): AccessCapability[] {
  return buildEffectiveCapabilityEntries(sources).map((entry) => entry.capability);
}
