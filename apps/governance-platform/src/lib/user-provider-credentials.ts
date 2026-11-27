import { decryptSecret, encryptSecret, getEncryptionKey } from "@/lib/crypto";
import { prisma } from "@/lib/prisma";

export const USER_PROVIDER_IDS = ["openai", "anthropic", "opencode"] as const;
export type UserProviderId = (typeof USER_PROVIDER_IDS)[number];

export type UserProviderCredentialState = {
  provider: UserProviderId;
  configured: boolean;
  last4: string | null;
  updatedAt: Date | null;
  validationStatus: string | null;
  validatedAt: Date | null;
};
type ProviderCredentialRow = {
  provider: UserProviderId;
  last4: string | null;
  updatedAt: Date;
  validationStatus: string | null;
  validatedAt: Date | null;
};

export function providerForAgent(agent: string): UserProviderId | null {
  if (agent === "codex") return "openai";
  if (agent === "claude-code") return "anthropic";
  if (agent === "opencode") return "opencode";
  return null;
}

export function providerDisplayName(provider: UserProviderId): string {
  if (provider === "openai") return "OpenAI";
  if (provider === "anthropic") return "Anthropic";
  return "OpenCode";
}

export function userProviderCredentialOwnerId(
  ownerScopeType: string | null | undefined,
  ownerScopeId: string | null | undefined,
): string | null {
  if (ownerScopeType !== "user" || !ownerScopeId) return null;
  if (ownerScopeId === "arena-admin-api" || ownerScopeId === "e2e-admin-bypass") return null;
  return ownerScopeId;
}

export function isUserProviderId(value: string): value is UserProviderId {
  return USER_PROVIDER_IDS.includes(value as UserProviderId);
}

function credentialDelegate() {
  return (prisma as any).userProviderCredential;
}

function getLast4(value: string): string {
  return value.slice(-4);
}

function normalizeKey(value: string): string {
  return value.trim();
}

export async function listUserProviderCredentialStates(
  userId: string,
): Promise<Record<UserProviderId, UserProviderCredentialState>> {
  const rows = await credentialDelegate().findMany({
    where: { userId },
    select: {
      provider: true,
      last4: true,
      updatedAt: true,
      validationStatus: true,
      validatedAt: true,
    },
  });
  const byProvider = new Map<UserProviderId, ProviderCredentialRow>(
    rows
      .filter((row: any) => isUserProviderId(row.provider))
      .map((row: any) => [row.provider, row as ProviderCredentialRow]),
  );

  return Object.fromEntries(USER_PROVIDER_IDS.map((provider) => {
    const row = byProvider.get(provider);
    return [provider, {
      provider,
      configured: Boolean(row),
      last4: row?.last4 ?? null,
      updatedAt: row?.updatedAt ?? null,
      validationStatus: row?.validationStatus ?? null,
      validatedAt: row?.validatedAt ?? null,
    }];
  })) as Record<UserProviderId, UserProviderCredentialState>;
}

export async function hasUserProviderCredential(
  userId: string,
  provider: UserProviderId,
): Promise<boolean> {
  const row = await credentialDelegate().findUnique({
    where: { userId_provider: { userId, provider } },
    select: { id: true },
  });
  return Boolean(row);
}

export async function upsertUserProviderCredential(
  userId: string,
  provider: UserProviderId,
  rawValue: string,
): Promise<{ success: true } | { success: false; error: string }> {
  const value = normalizeKey(rawValue);
  if (!value) {
    return { success: false, error: `${providerDisplayName(provider)} API key is required` };
  }

  const encKey = getEncryptionKey();
  const encrypted = encryptSecret(value, encKey);
  await credentialDelegate().upsert({
    where: { userId_provider: { userId, provider } },
    create: {
      userId,
      provider,
      encryptedValue: encrypted.ciphertext,
      iv: encrypted.iv,
      authTag: encrypted.authTag,
      last4: getLast4(value),
      validationStatus: "unchecked",
      validatedAt: null,
    },
    update: {
      encryptedValue: encrypted.ciphertext,
      iv: encrypted.iv,
      authTag: encrypted.authTag,
      last4: getLast4(value),
      validationStatus: "unchecked",
      validatedAt: null,
    },
  });
  return { success: true };
}

export async function deleteUserProviderCredential(
  userId: string,
  provider: UserProviderId,
): Promise<{ success: true }> {
  await credentialDelegate().deleteMany({
    where: { userId, provider },
  });
  return { success: true };
}

export async function getUserProviderAuthEnv(
  userId: string | null | undefined,
  provider: UserProviderId | null,
): Promise<Record<string, string>> {
  if (!userId || !provider) return {};

  const row = await credentialDelegate().findUnique({
    where: { userId_provider: { userId, provider } },
    select: {
      encryptedValue: true,
      iv: true,
      authTag: true,
    },
  });
  if (!row) return {};

  const encKey = getEncryptionKey();
  const value = decryptSecret(
    {
      ciphertext: row.encryptedValue,
      iv: row.iv,
      authTag: row.authTag,
    },
    encKey,
  );

  if (!value) return {};
  if (provider === "openai") return { OPENAI_API_KEY: value };
  if (provider === "anthropic") return { ANTHROPIC_API_KEY: value };
  return { OPENCODE_API_KEY: value };
}
