export const VISUAL_WORKBENCH_CANARY_SOURCE_SEED_PROFILE = "visual_workbench_canary_v0" as const;

export type SourceSeedProfile = typeof VISUAL_WORKBENCH_CANARY_SOURCE_SEED_PROFILE;

const SOURCE_SEED_PROFILES = new Set<string>([
  VISUAL_WORKBENCH_CANARY_SOURCE_SEED_PROFILE,
]);

export function parseSourceSeedProfile(value: unknown): SourceSeedProfile | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return SOURCE_SEED_PROFILES.has(trimmed) ? trimmed as SourceSeedProfile : null;
}

export function getSourceSeedProfile(sourceConfig: unknown): SourceSeedProfile | null {
  if (!sourceConfig || typeof sourceConfig !== "object" || Array.isArray(sourceConfig)) {
    return null;
  }
  return parseSourceSeedProfile((sourceConfig as Record<string, unknown>).sourceSeedProfile);
}
