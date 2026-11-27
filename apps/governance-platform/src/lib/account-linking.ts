import type { Account } from "next-auth";
import { prisma } from "./prisma";

const RECLAIMABLE_PROVIDERS = new Set(["google", "telegram"]);
const ACCOUNT_LINKING_DB_DELEGATES = [
  "user",
  "account",
  "vote",
  "proposal",
  "project",
  "projectBudgetAdjustment",
  "featureFlag",
  "agentLoop",
  "projectEvent",
  "userCreditBalance",
  "creditPurchase",
  "userCreditAdjustment",
  "accessGrant",
  "accessAuditLog",
  "notificationPreference",
  "notificationLog",
  "inAppNotification",
  "userProviderCredential",
] as const;

type AccountLinkingDb = Pick<typeof prisma, (typeof ACCOUNT_LINKING_DB_DELEGATES)[number]>;

export type AccountShellSnapshot = {
  id: string;
  email: string | null;
  accounts: Array<{ provider: string; providerAccountId: string }>;
  counts: Record<string, number>;
};

type ProviderProfileUpdate = {
  email?: string;
  emailVerified?: Date;
  name?: string;
  image?: string;
};

function readString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function normalizeEmail(value: unknown): string | undefined {
  const email = readString(value)?.toLowerCase();
  return email && email.includes("@") ? email : undefined;
}

export function profileUpdateFromProvider(
  provider: string,
  profile: unknown,
): ProviderProfileUpdate {
  if (!profile || typeof profile !== "object") return {};
  const record = profile as Record<string, unknown>;

  if (provider === "google") {
    const email = normalizeEmail(record.email);
    return {
      email,
      emailVerified: email && record.email_verified !== false ? new Date() : undefined,
      name: readString(record.name),
      image: readString(record.picture),
    };
  }

  if (provider === "telegram") {
    const name = readString(record.name);
    const username = readString(record.preferred_username);
    const displayName = name ?? (username ? `@${username.replace(/^@+/, "")}` : undefined);
    return {
      name: displayName,
      image: readString(record.picture),
    };
  }

  return {};
}

export function isReclaimableEmptyProviderShell(
  snapshot: AccountShellSnapshot,
  provider: string,
  providerAccountId: string,
): boolean {
  if (!RECLAIMABLE_PROVIDERS.has(provider)) return false;
  if (snapshot.accounts.length !== 1) return false;
  const [account] = snapshot.accounts;
  if (!account) return false;
  if (account.provider !== provider || account.providerAccountId !== providerAccountId) {
    return false;
  }

  return Object.values(snapshot.counts).every((count) => count === 0);
}

async function buildAccountShellSnapshot(
  db: AccountLinkingDb,
  userId: string,
): Promise<AccountShellSnapshot | null> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      accounts: { select: { provider: true, providerAccountId: true } },
    },
  });
  if (!user) return null;

  const [
    votes,
    proposals,
    projectsOwned,
    budgetAdjustments,
    featureFlagUpdates,
    agentLoops,
    projectEvents,
    creditBalances,
    creditPurchases,
    creditAdjustments,
    accessGrantsAsSubject,
    accessGrantsGrantedBy,
    accessAuditLogs,
    notificationPreferences,
    notificationLogs,
    inAppNotifications,
    providerCredentials,
  ] = await Promise.all([
    db.vote.count({ where: { userId } }),
    db.proposal.count({ where: { createdById: userId } }),
    db.project.count({ where: { ownerScopeType: "user", ownerScopeId: userId } }),
    db.projectBudgetAdjustment.count({ where: { createdById: userId } }),
    db.featureFlag.count({ where: { updatedById: userId } }),
    db.agentLoop.count({ where: { ownerId: userId } }),
    db.projectEvent.count({ where: { userId } }),
    db.userCreditBalance.count({ where: { userId } }),
    db.creditPurchase.count({ where: { userId } }),
    db.userCreditAdjustment.count({ where: { userId } }),
    db.accessGrant.count({ where: { subjectUserId: userId } }),
    db.accessGrant.count({ where: { grantedById: userId } }),
    db.accessAuditLog.count({
      where: { OR: [{ actorUserId: userId }, { subjectUserId: userId }] },
    }),
    db.notificationPreference.count({ where: { userId } }),
    db.notificationLog.count({ where: { userId } }),
    db.inAppNotification.count({ where: { userId } }),
    db.userProviderCredential.count({ where: { userId } }),
  ]);

  return {
    id: user.id,
    email: user.email,
    accounts: user.accounts,
    counts: {
      votes,
      proposals,
      projectsOwned,
      budgetAdjustments,
      featureFlagUpdates,
      agentLoops,
      projectEvents,
      creditBalances,
      creditPurchases,
      creditAdjustments,
      accessGrantsAsSubject,
      accessGrantsGrantedBy,
      accessAuditLogs,
      notificationPreferences,
      notificationLogs,
      inAppNotifications,
      providerCredentials,
    },
  };
}

async function syncLinkedProviderProfile(
  db: AccountLinkingDb,
  userId: string,
  provider: string,
  profile: unknown,
): Promise<void> {
  const update = profileUpdateFromProvider(provider, profile);
  if (!update.email && !update.name && !update.image) return;

  const user = await db.user.findUnique({
    where: { id: userId },
    select: { email: true, emailVerified: true, name: true, image: true },
  });
  if (!user) return;

  const data: {
    email?: string;
    emailVerified?: Date;
    name?: string;
    image?: string;
  } = {};

  if (!user.email && update.email) {
    const emailOwner = await db.user.findUnique({
      where: { email: update.email },
      select: { id: true },
    });
    if (!emailOwner || emailOwner.id === userId) {
      data.email = update.email;
      if (!user.emailVerified && update.emailVerified) {
        data.emailVerified = update.emailVerified;
      }
    }
  }
  if (!user.name && update.name) data.name = update.name;
  if (!user.image && update.image) data.image = update.image;

  if (Object.keys(data).length === 0) return;
  await db.user.update({ where: { id: userId }, data });
}

export async function syncLinkedProviderProfileForUser(
  userId: string,
  provider: string,
  profile: unknown,
): Promise<void> {
  await syncLinkedProviderProfile(prisma, userId, provider, profile);
}

export async function reclaimEmptyProviderAccountForSignedInUser({
  currentUserId,
  account,
  profile,
}: {
  currentUserId: string;
  account: Account;
  profile: unknown;
}): Promise<boolean> {
  const provider = account.provider;
  const providerAccountId = account.providerAccountId;
  if (!provider || !providerAccountId || !RECLAIMABLE_PROVIDERS.has(provider)) {
    return false;
  }

  const existingAccount = await prisma.account.findUnique({
    where: {
      provider_providerAccountId: {
        provider,
        providerAccountId,
      },
    },
    select: { userId: true },
  });
  if (!existingAccount || existingAccount.userId === currentUserId) {
    return false;
  }

  return prisma.$transaction(async (tx) => {
    const snapshot = await buildAccountShellSnapshot(tx, existingAccount.userId);
    if (
      !snapshot ||
      !isReclaimableEmptyProviderShell(snapshot, provider, providerAccountId)
    ) {
      return false;
    }

    await tx.account.update({
      where: {
        provider_providerAccountId: {
          provider,
          providerAccountId,
        },
      },
      data: { userId: currentUserId },
    });
    await tx.user.delete({ where: { id: existingAccount.userId } });
    await syncLinkedProviderProfile(tx, currentUserId, provider, profile);
    return true;
  });
}
