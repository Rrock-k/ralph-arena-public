export const FEATURE_FLAG_KEYS = {
  budgetVisibility: "budget_visibility",
  communityQa: "community_qa",
  notifications: "notifications_enabled",
  byokProviderKeys: "byok_provider_keys",
  managedProviderCredits: "managed_provider_credits",
} as const;

export type FeatureFlagKey = (typeof FEATURE_FLAG_KEYS)[keyof typeof FEATURE_FLAG_KEYS];
