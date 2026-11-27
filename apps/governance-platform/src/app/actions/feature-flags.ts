"use server";

import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { FEATURE_FLAG_KEYS, type FeatureFlagKey } from "@/lib/feature-flag-keys";
import { requirePlatformCapability } from "@/lib/platform-access";

type FeatureFlagActionResult = {
  success: boolean;
  error?: string;
  key?: FeatureFlagKey;
  enabled?: boolean;
};

const ALLOWED_FLAG_KEYS = new Set<FeatureFlagKey>(Object.values(FEATURE_FLAG_KEYS));

export async function setFeatureFlag(
  key: FeatureFlagKey,
  enabled: boolean,
): Promise<FeatureFlagActionResult> {
  const access = await requirePlatformCapability("platform.flags.manage");
  if (!access.authorized) {
    return { success: false, error: access.error };
  }

  if (!ALLOWED_FLAG_KEYS.has(key)) {
    return { success: false, error: "Unknown feature flag" };
  }

  try {
    await (prisma as any).featureFlag.upsert({
      where: { key },
      create: {
        key,
        enabled,
        updatedById: access.session?.user?.id ?? null,
      },
      update: {
        enabled,
        updatedById: access.session?.user?.id ?? null,
      },
    });

    revalidatePath("/admin");


    return {
      success: true,
      key,
      enabled,
    };
  } catch (error) {
    console.error("Set feature flag error:", error);
    return { success: false, error: "Failed to update feature flag" };
  }
}
