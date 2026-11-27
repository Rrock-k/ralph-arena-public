import { prisma } from "@/lib/prisma";
import { FEATURE_FLAG_KEYS, type FeatureFlagKey } from "@/lib/feature-flag-keys";

export type FeatureFlagsSnapshot = {
  budgetVisibility: boolean;
  communityQa: boolean;
  notifications: boolean;
  byokProviderKeys: boolean;
  managedProviderCredits: boolean;
};

const FEATURE_FLAG_DEFAULTS: Record<FeatureFlagKey, boolean> = {
  [FEATURE_FLAG_KEYS.budgetVisibility]: false,
  [FEATURE_FLAG_KEYS.communityQa]: false,
  [FEATURE_FLAG_KEYS.notifications]: false,
  [FEATURE_FLAG_KEYS.byokProviderKeys]: true,
  [FEATURE_FLAG_KEYS.managedProviderCredits]: false,
};

async function getFeatureFlagEnabled(key: FeatureFlagKey): Promise<boolean> {
  const record = await (prisma as any).featureFlag.findUnique({
    where: { key },
    select: { enabled: true },
  });
  return record?.enabled ?? FEATURE_FLAG_DEFAULTS[key];
}

export async function isBudgetVisibilityEnabled(): Promise<boolean> {
  return getFeatureFlagEnabled(FEATURE_FLAG_KEYS.budgetVisibility);
}

export async function isCommunityQaEnabled(): Promise<boolean> {
  return getFeatureFlagEnabled(FEATURE_FLAG_KEYS.communityQa);
}

export async function isNotificationsEnabled(): Promise<boolean> {
  return getFeatureFlagEnabled(FEATURE_FLAG_KEYS.notifications);
}

export async function isByokProviderKeysEnabled(): Promise<boolean> {
  return getFeatureFlagEnabled(FEATURE_FLAG_KEYS.byokProviderKeys);
}

export async function isManagedProviderCreditsEnabled(): Promise<boolean> {
  return getFeatureFlagEnabled(FEATURE_FLAG_KEYS.managedProviderCredits);
}

export async function getFeatureFlagsSnapshot(): Promise<FeatureFlagsSnapshot> {
  const rows = await (prisma as any).featureFlag.findMany({
    where: {
      key: {
        in: Object.values(FEATURE_FLAG_KEYS),
      },
    },
    select: {
      key: true,
      enabled: true,
    },
  });

  const map = new Map<string, boolean>(rows.map((row: any) => [row.key, row.enabled]));
  return {
    budgetVisibility: map.get(FEATURE_FLAG_KEYS.budgetVisibility) ?? FEATURE_FLAG_DEFAULTS[FEATURE_FLAG_KEYS.budgetVisibility],
    communityQa: map.get(FEATURE_FLAG_KEYS.communityQa) ?? FEATURE_FLAG_DEFAULTS[FEATURE_FLAG_KEYS.communityQa],
    notifications: map.get(FEATURE_FLAG_KEYS.notifications) ?? FEATURE_FLAG_DEFAULTS[FEATURE_FLAG_KEYS.notifications],
    byokProviderKeys: map.get(FEATURE_FLAG_KEYS.byokProviderKeys) ?? FEATURE_FLAG_DEFAULTS[FEATURE_FLAG_KEYS.byokProviderKeys],
    managedProviderCredits: map.get(FEATURE_FLAG_KEYS.managedProviderCredits) ?? FEATURE_FLAG_DEFAULTS[FEATURE_FLAG_KEYS.managedProviderCredits],
  };
}

export const __private__ = {
  getFeatureFlagEnabled,
};
