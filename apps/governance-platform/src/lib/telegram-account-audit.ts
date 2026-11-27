import "server-only";

import { prisma } from "@/lib/prisma";
import { isTelegramWebAppRawAccount } from "@/lib/telegram-account-identity";
import { TELEGRAM_AUTH_PROVIDER_ID } from "@/lib/telegram-oidc-provider";
import type {
  TelegramAccountAuditBucket,
  TelegramAccountAuditBucketCode,
  TelegramAccountAuditExample,
  TelegramAccountAuditSeverity,
  TelegramAccountAuditSnapshot,
} from "@/lib/telegram-account-audit-types";

type TelegramAccountAuditRow = {
  userId: string;
  providerAccountId: string;
  scope?: string | null;
  access_token?: string | null;
  id_token?: string | null;
  user: {
    id: string;
    name: string | null;
    email: string | null;
  } | null;
};

type UserTelegramAccounts = {
  userId: string;
  userName: string | null;
  userEmail: string | null;
  rawIds: Set<string>;
  legacyIds: Set<string>;
};

function sortValues(values: Iterable<string>): string[] {
  return Array.from(values).sort((left, right) => left.localeCompare(right));
}

function toExample(user: UserTelegramAccounts): TelegramAccountAuditExample {
  return {
    userId: user.userId,
    userName: user.userName,
    userEmail: user.userEmail,
    rawIds: sortValues(user.rawIds),
    legacyIds: sortValues(user.legacyIds),
  };
}

function bucket(input: {
  code: TelegramAccountAuditBucketCode;
  severity: TelegramAccountAuditSeverity;
  title: string;
  effect: string;
  action: string;
  users: UserTelegramAccounts[];
  limitExamples: number;
}): TelegramAccountAuditBucket {
  return {
    code: input.code,
    severity: input.severity,
    title: input.title,
    effect: input.effect,
    action: input.action,
    count: input.users.length,
    examples: input.users.slice(0, input.limitExamples).map(toExample),
  };
}

export function buildTelegramAccountAudit(
  rows: TelegramAccountAuditRow[],
  options: { generatedAt?: Date; limitExamples?: number } = {},
): TelegramAccountAuditSnapshot {
  const limitExamples = options.limitExamples ?? 5;
  const byUser = new Map<string, UserTelegramAccounts>();
  let rawIdAccountCount = 0;
  let legacyAccountCount = 0;

  for (const row of rows) {
    const providerAccountId = row.providerAccountId.trim();
    const userId = row.user?.id ?? row.userId;
    const current = byUser.get(userId) ?? {
      userId,
      userName: row.user?.name ?? null,
      userEmail: row.user?.email ?? null,
      rawIds: new Set<string>(),
      legacyIds: new Set<string>(),
    };

    if (isTelegramWebAppRawAccount(row)) {
      current.rawIds.add(providerAccountId);
      rawIdAccountCount += 1;
    } else {
      current.legacyIds.add(providerAccountId);
      legacyAccountCount += 1;
    }

    byUser.set(userId, current);
  }

  const users = Array.from(byUser.values()).sort((left, right) => left.userId.localeCompare(right.userId));
  const subjectOnlyUsers = users.filter((user) => user.legacyIds.size > 0 && user.rawIds.size === 0);
  const compatibilityAliasUsers = users.filter((user) => user.legacyIds.size > 0 && user.rawIds.size > 0);
  const multipleRawIdUsers = users.filter((user) => user.rawIds.size > 1);

  const buckets: TelegramAccountAuditBucket[] = [
    bucket({
      code: "subject_only",
      severity: "warning",
      title: "Legacy OIDC-only Telegram accounts",
      effect: "Mini App handoff cannot match these users by raw Telegram user.id until they repair or relink Telegram in Arena.",
      action: "Ask the user to open the Mini App repair link or relink Telegram through Arena Settings.",
      users: subjectOnlyUsers,
      limitExamples,
    }),
    bucket({
      code: "compatibility_alias",
      severity: "info",
      title: "Raw-id compatibility aliases",
      effect: "These users have both a legacy OIDC subject and a raw Telegram user.id account row.",
      action: "No automatic action; keep visible until old subject-only rows are intentionally cleaned up.",
      users: compatibilityAliasUsers,
      limitExamples,
    }),
    bucket({
      code: "multiple_raw_ids",
      severity: "warning",
      title: "Multiple raw Telegram ids on one Arena user",
      effect: "One Arena user appears linked to more than one Telegram numeric identity.",
      action: "Investigate before relying on Telegram-derived project access for that user.",
      users: multipleRawIdUsers,
      limitExamples,
    }),
  ];

  return {
    generatedAt: (options.generatedAt ?? new Date()).toISOString(),
    totalTelegramAccounts: rows.length,
    totalTelegramUsers: users.length,
    rawIdAccountCount,
    legacyAccountCount,
    warningCount: subjectOnlyUsers.length + multipleRawIdUsers.length,
    buckets,
  };
}

export async function getTelegramAccountAudit(): Promise<TelegramAccountAuditSnapshot> {
  const rows = await prisma.account.findMany({
    where: { provider: TELEGRAM_AUTH_PROVIDER_ID },
    orderBy: [
      { userId: "asc" },
      { providerAccountId: "asc" },
    ],
    select: {
      userId: true,
      providerAccountId: true,
      scope: true,
      access_token: true,
      id_token: true,
      user: {
        select: {
          id: true,
          name: true,
          email: true,
        },
      },
    },
  });

  return buildTelegramAccountAudit(rows);
}
