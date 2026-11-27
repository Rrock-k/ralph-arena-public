"use server";

import { auth } from "@/lib/auth";
import {
  deleteUserProviderCredential,
  isUserProviderId,
  providerDisplayName,
  upsertUserProviderCredential,
  type UserProviderId,
} from "@/lib/user-provider-credentials";
import { isByokProviderKeysEnabled } from "@/lib/feature-flags";
import { revalidatePath } from "next/cache";

async function requireSettingsUser() {
  const session = await auth();
  if (!session?.user?.id) {
    return { success: false as const, error: "You must be signed in" };
  }
  return { success: true as const, userId: session.user.id };
}

async function requireProviderCredentialsFeature() {
  const enabled = await isByokProviderKeysEnabled();
  if (!enabled) {
    return { success: false as const, error: "User provider API keys are disabled." };
  }
  return { success: true as const };
}

export async function saveUserProviderCredential(
  provider: UserProviderId,
  value: string,
) {
  const user = await requireSettingsUser();
  if (!user.success) return user;
  const feature = await requireProviderCredentialsFeature();
  if (!feature.success) return feature;
  if (!isUserProviderId(provider)) {
    return { success: false as const, error: "Unsupported provider" };
  }

  const result = await upsertUserProviderCredential(user.userId, provider, value);
  if (!result.success) return result;

  revalidatePath("/settings");
  return { success: true as const, message: `${providerDisplayName(provider)} key saved` };
}

export async function removeUserProviderCredential(provider: UserProviderId) {
  const user = await requireSettingsUser();
  if (!user.success) return user;
  const feature = await requireProviderCredentialsFeature();
  if (!feature.success) return feature;
  if (!isUserProviderId(provider)) {
    return { success: false as const, error: "Unsupported provider" };
  }

  await deleteUserProviderCredential(user.userId, provider);
  revalidatePath("/settings");
  return { success: true as const, message: `${providerDisplayName(provider)} key removed` };
}
