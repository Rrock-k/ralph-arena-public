import type { RequiredSecretEntry } from "@/lib/required-secrets";
import { normalizeProjectInteractionRequiredSecretKey } from "@/lib/project-interaction-deeplink";

export function getMissingFocusedRequiredSecretKey(
  focusRequiredSecretKey: string | null | undefined,
  requiredSecrets: RequiredSecretEntry[],
): string | null {
  const normalizedFocusKey = normalizeProjectInteractionRequiredSecretKey(focusRequiredSecretKey);
  if (!normalizedFocusKey) return null;

  const hasRequiredSecret = requiredSecrets.some((entry) =>
    normalizeProjectInteractionRequiredSecretKey(entry.key) === normalizedFocusKey,
  );
  return hasRequiredSecret ? null : normalizedFocusKey;
}
