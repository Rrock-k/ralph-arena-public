import type { Prisma, PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import type { AccessCapability } from "@/lib/access-control/types";
import {
  PROJECT_PERSONAL_NOTIFICATION_CHANNEL,
  PROJECT_PERSONAL_NOTIFICATION_EVENT_TYPES,
  type ProjectPersonalNotificationEventType,
} from "@/lib/project-personal-notification-types";
import { isTelegramWebAppRawAccount } from "@/lib/telegram-account-identity";
import {
  buildProjectUpdatePayload,
  type ProjectUpdateEventType,
} from "@/lib/project-update-outbox";

type Db = PrismaClient | Prisma.TransactionClient;
type JsonObject = Record<string, unknown>;

export const PROJECT_PERSONAL_NOTIFICATION_STATUSES = [
  "PENDING",
  "DELIVERING",
  "DELIVERED",
  "FAILED",
  "SKIPPED",
] as const;

export type ProjectPersonalNotificationStatus =
  (typeof PROJECT_PERSONAL_NOTIFICATION_STATUSES)[number];

type PersonalNotificationPolicy = {
  audience: "project_managers";
  requiredCapability: AccessCapability;
};

export const PROJECT_PERSONAL_NOTIFICATION_POLICIES:
  Record<ProjectPersonalNotificationEventType, PersonalNotificationPolicy> = {
    "required_secret.missing": {
      audience: "project_managers",
      requiredCapability: "project.secrets.manage",
    },
    "work.completed": {
      audience: "project_managers",
      requiredCapability: "project.secrets.manage",
    },
    "work.failed": {
      audience: "project_managers",
      requiredCapability: "project.secrets.manage",
    },
    "work.needs_evidence": {
      audience: "project_managers",
      requiredCapability: "project.secrets.manage",
    },
  };

type ProjectPersonalNotificationRow = {
  id: string;
  projectId: string;
  recipientUserId: string;
  channel: string;
  telegramUserId: string;
  eventType: string;
  requiredCapability: string;
  dedupeKey: string;
  payload: Prisma.JsonValue;
  status: string;
  attempts: number;
  lockedBy: string | null;
  leaseId: string | null;
  createdAt: Date;
};

type ProjectPersonalNotificationOutboxDelegate = {
  upsert: (args: Record<string, unknown>) => Promise<ProjectPersonalNotificationRow>;
  findMany: (args: Record<string, unknown>) => Promise<ProjectPersonalNotificationRow[]>;
  updateMany: (args: Record<string, unknown>) => Promise<{ count: number }>;
  findUnique: (args: Record<string, unknown>) => Promise<ProjectPersonalNotificationRow | null>;
};

export type ProjectPersonalNotificationRecipient = {
  userId: string;
  telegramUserId: string;
  requiredCapability: AccessCapability;
  preferenceScope: "project" | "global" | "default";
};

function getOutboxDelegate(db: Db): ProjectPersonalNotificationOutboxDelegate {
  const delegate = (db as unknown as {
    projectPersonalNotificationOutbox?: ProjectPersonalNotificationOutboxDelegate;
  }).projectPersonalNotificationOutbox;
  if (!delegate) {
    throw new Error(
      "Prisma projectPersonalNotificationOutbox delegate is unavailable. Regenerate Prisma client before using RA-284 personal notifications.",
    );
  }
  return delegate;
}

function isPersonalNotificationEvent(
  eventType: ProjectUpdateEventType,
): eventType is ProjectPersonalNotificationEventType {
  return PROJECT_PERSONAL_NOTIFICATION_EVENT_TYPES.includes(
    eventType as ProjectPersonalNotificationEventType,
  );
}

function safeText(value: unknown, maxLength = 240): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.replace(/\s+/g, " ").trim();
  if (!text) return undefined;
  return text.length > maxLength ? `${text.slice(0, maxLength - 3)}...` : text;
}

function normalizeLimit(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value)) return 20;
  return Math.min(Math.max(value, 1), 100);
}

function requiredSecretSetKey(payload: JsonObject): string | null {
  const requiredSecretKeys = Array.isArray(payload.requiredSecretKeys)
    ? payload.requiredSecretKeys
      .filter((value): value is string => typeof value === "string")
      .map((value) => value.trim().toUpperCase())
      .filter(Boolean)
      .sort()
    : [];
  return requiredSecretKeys.length > 0
    ? `missing-secrets:${requiredSecretKeys.join(",")}`
    : null;
}

function isoDayFromDedupeKey(dedupeKey: string): string | null {
  const match = dedupeKey.match(/(\d{4}-\d{2}-\d{2})T\d{2}:\d{2}:\d{2}/);
  return match?.[1] ?? null;
}

function terminalCommitFromDedupeKey(dedupeKey: string): string | null {
  const match = dedupeKey.match(/^terminal-deployed:(.+):\d{4}-\d{2}-\d{2}T/);
  const commit = match?.[1]?.trim();
  return commit && commit !== "no-commit" ? commit : null;
}

function terminalFailureKeyFromDedupeKey(dedupeKey: string): string | null {
  const match = dedupeKey.match(/^terminal-failed:([^:]+):([^:]+):(.+)$/);
  if (!match) return null;
  return `terminal-failed:${match[1]}:${match[2]}:${match[3]}`;
}

function coalescedPersonalNotificationKey(
  eventType: ProjectPersonalNotificationEventType,
  dedupeKey: string,
  payload: JsonObject,
): string {
  switch (eventType) {
    case "required_secret.missing":
      return requiredSecretSetKey(payload) ?? dedupeKey;
    case "work.completed": {
      const commit = terminalCommitFromDedupeKey(dedupeKey);
      if (commit) return `terminal-deployed:${commit}`;
      return `work-completed:${isoDayFromDedupeKey(dedupeKey) ?? dedupeKey}`;
    }
    case "work.failed":
      return terminalFailureKeyFromDedupeKey(dedupeKey) ?? `work-failed:${isoDayFromDedupeKey(dedupeKey) ?? dedupeKey}`;
    case "work.needs_evidence":
      return `work-needs-evidence:${isoDayFromDedupeKey(dedupeKey) ?? dedupeKey}`;
  }
}

function normalizePersonalNotificationDedupeKey(
  eventType: ProjectPersonalNotificationEventType,
  dedupeKey: string,
  payload: JsonObject,
): string {
  const normalized = dedupeKey.replace(/\s+/g, " ").trim();
  if (!normalized) {
    throw new Error(`Personal project notification dedupe key is required for ${eventType}`);
  }
  return `${eventType}:${coalescedPersonalNotificationKey(eventType, normalized, payload)}`;
}

function preferenceScopeKey(scopeType: string, scopeId: string): "project" | "global" | null {
  if (scopeType === "project") return "project";
  if (scopeType === "global" && scopeId === "global") return "global";
  return null;
}

function getPreferenceDecision(
  preferences: Array<{
    userId: string;
    scopeType: string;
    scopeId: string;
    enabled: boolean;
  }>,
  userId: string,
  projectId: string,
): { enabled: boolean; scope: ProjectPersonalNotificationRecipient["preferenceScope"] } {
  const projectPreference = preferences.find((preference) => (
    preference.userId === userId
    && preference.scopeType === "project"
    && preference.scopeId === projectId
  ));
  if (projectPreference) {
    return { enabled: projectPreference.enabled, scope: "project" };
  }

  const globalPreference = preferences.find((preference) => (
    preference.userId === userId
    && preference.scopeType === "global"
    && preference.scopeId === "global"
  ));
  if (globalPreference) {
    return { enabled: globalPreference.enabled, scope: "global" };
  }

  return { enabled: true, scope: "default" };
}

async function loadProjectForPersonalNotifications(db: Db, projectId: string) {
  return db.project.findUnique({
    where: { id: projectId },
    select: {
      id: true,
      tgSpecSourceProjectId: true,
      ownerScopeType: true,
      ownerScopeId: true,
    },
  });
}

async function listRecipientCandidateIds(
  db: Db,
  input: {
    projectId: string;
    ownerScopeType: string | null;
    ownerScopeId: string | null;
    requiredCapability: AccessCapability;
  },
): Promise<string[]> {
  const candidateIds = new Set<string>();
  if (input.ownerScopeType === "user" && input.ownerScopeId) {
    candidateIds.add(input.ownerScopeId);
  }

  const grants = await db.accessGrant.findMany({
    where: {
      AND: [
        { revokedAt: null },
        {
          OR: [
            { expiresAt: null },
            { expiresAt: { gt: new Date() } },
          ],
        },
        {
          OR: [
            { scopeType: "platform" },
            { scopeType: "project", scopeId: input.projectId },
          ],
        },
        { capabilities: { has: input.requiredCapability } },
      ],
    },
    select: { subjectUserId: true },
  });

  for (const grant of grants) {
    candidateIds.add(grant.subjectUserId);
  }

  return [...candidateIds];
}

async function loadSingleRawTelegramAccountByUserId(
  db: Db,
  userIds: string[],
): Promise<Map<string, string>> {
  if (userIds.length === 0) return new Map();

  const accounts = await db.account.findMany({
    where: {
      userId: { in: userIds },
      provider: "telegram",
    },
    select: {
      userId: true,
      providerAccountId: true,
      scope: true,
      access_token: true,
      id_token: true,
    },
  });

  const rawIdsByUserId = new Map<string, Set<string>>();
  for (const account of accounts) {
    if (!isTelegramWebAppRawAccount(account)) continue;
    const ids = rawIdsByUserId.get(account.userId) ?? new Set<string>();
    ids.add(account.providerAccountId);
    rawIdsByUserId.set(account.userId, ids);
  }

  return new Map(
    [...rawIdsByUserId.entries()]
      .filter(([, telegramIds]) => telegramIds.size === 1)
      .map(([userId, telegramIds]) => [userId, [...telegramIds][0]]),
  );
}

async function loadPreferenceRows(
  db: Db,
  input: {
    userIds: string[];
    eventType: ProjectPersonalNotificationEventType;
    projectId: string;
  },
) {
  if (input.userIds.length === 0) return [];

  const preferences = await db.notificationPreference.findMany({
    where: {
      userId: { in: input.userIds },
      eventType: input.eventType,
      channel: PROJECT_PERSONAL_NOTIFICATION_CHANNEL,
      OR: [
        { scopeType: "global", scopeId: "global" },
        { scopeType: "project", scopeId: input.projectId },
      ],
    },
    select: {
      userId: true,
      scopeType: true,
      scopeId: true,
      enabled: true,
    },
  });

  return preferences.filter((preference) => (
    preferenceScopeKey(preference.scopeType, preference.scopeId) !== null
  ));
}

export async function resolvePersonalProjectNotificationRecipients(
  db: Db,
  input: {
    projectId: string;
    eventType: ProjectUpdateEventType;
  },
): Promise<ProjectPersonalNotificationRecipient[]> {
  if (!isPersonalNotificationEvent(input.eventType)) return [];

  const policy = PROJECT_PERSONAL_NOTIFICATION_POLICIES[input.eventType];
  const project = await loadProjectForPersonalNotifications(db, input.projectId);
  if (!project?.tgSpecSourceProjectId) return [];

  const candidateUserIds = await listRecipientCandidateIds(db, {
    projectId: project.id,
    ownerScopeType: project.ownerScopeType,
    ownerScopeId: project.ownerScopeId,
    requiredCapability: policy.requiredCapability,
  });
  const telegramUserIdsByUserId = await loadSingleRawTelegramAccountByUserId(db, candidateUserIds);
  const preferences = await loadPreferenceRows(db, {
    userIds: candidateUserIds,
    eventType: input.eventType,
    projectId: project.id,
  });

  return candidateUserIds
    .map((userId) => {
      const telegramUserId = telegramUserIdsByUserId.get(userId);
      if (!telegramUserId) return null;

      const preference = getPreferenceDecision(preferences, userId, project.id);
      if (!preference.enabled) return null;

      return {
        userId,
        telegramUserId,
        requiredCapability: policy.requiredCapability,
        preferenceScope: preference.scope,
      } satisfies ProjectPersonalNotificationRecipient;
    })
    .filter((recipient): recipient is ProjectPersonalNotificationRecipient => !!recipient);
}

async function resolveStillEligibleRecipient(
  db: Db,
  row: ProjectPersonalNotificationRow,
): Promise<ProjectPersonalNotificationRecipient | null> {
  if (!isPersonalNotificationEvent(row.eventType as ProjectUpdateEventType)) return null;
  const recipients = await resolvePersonalProjectNotificationRecipients(db, {
    projectId: row.projectId,
    eventType: row.eventType as ProjectUpdateEventType,
  });
  return recipients.find((recipient) => (
    recipient.userId === row.recipientUserId
    && recipient.telegramUserId === row.telegramUserId
  )) ?? null;
}

export async function enqueuePersonalProjectNotifications(
  db: Db,
  input: {
    projectId: string;
    eventType: ProjectUpdateEventType;
    dedupeKey: string;
    payload?: unknown;
  },
) {
  if (!isPersonalNotificationEvent(input.eventType)) return [];

  const recipients = await resolvePersonalProjectNotificationRecipients(db, {
    projectId: input.projectId,
    eventType: input.eventType,
  });
  if (recipients.length === 0) return [];

  const outbox = getOutboxDelegate(db);
  const payload = buildProjectUpdatePayload(input.eventType, input.payload ?? {});
  const dedupeKey = normalizePersonalNotificationDedupeKey(input.eventType, input.dedupeKey, payload);

  const rows: ProjectPersonalNotificationRow[] = [];
  for (const recipient of recipients) {
    rows.push(await outbox.upsert({
      where: {
        projectId_recipientUserId_channel_dedupeKey: {
          projectId: input.projectId,
          recipientUserId: recipient.userId,
          channel: PROJECT_PERSONAL_NOTIFICATION_CHANNEL,
          dedupeKey,
        },
      },
      update: {},
      create: {
        projectId: input.projectId,
        recipientUserId: recipient.userId,
        channel: PROJECT_PERSONAL_NOTIFICATION_CHANNEL,
        telegramUserId: recipient.telegramUserId,
        eventType: input.eventType,
        requiredCapability: recipient.requiredCapability,
        dedupeKey,
        payload: payload as Prisma.InputJsonValue,
      },
    }));
  }

  return rows;
}

export async function claimPersonalProjectNotifications(
  db: PrismaClient,
  input: {
    limit?: unknown;
    consumerId?: unknown;
    leaseSeconds?: number;
  },
) {
  const limit = normalizeLimit(input.limit);
  const now = new Date();
  const leaseId = randomUUID();
  const lockedUntil = new Date(now.getTime() + Math.max(input.leaseSeconds ?? 90, 15) * 1000);
  const lockedBy = safeText(input.consumerId, 120) ?? "tg-spec";

  return db.$transaction(async (tx) => {
    const outbox = getOutboxDelegate(tx);
    const candidates = await outbox.findMany({
      where: {
        channel: PROJECT_PERSONAL_NOTIFICATION_CHANNEL,
        OR: [
          { status: "PENDING" },
          {
            status: "FAILED",
            OR: [
              { nextAttemptAt: null },
              { nextAttemptAt: { lte: now } },
            ],
          },
          {
            status: "DELIVERING",
            lockedUntil: { lt: now },
          },
        ],
      },
      orderBy: { createdAt: "asc" },
      take: Math.min(limit * 2, 200),
    });

    const claimableRows: ProjectPersonalNotificationRow[] = [];
    const staleIds: string[] = [];
    for (const row of candidates) {
      const recipient = await resolveStillEligibleRecipient(tx, row);
      if (!recipient) {
        staleIds.push(row.id);
        continue;
      }
      claimableRows.push(row);
      if (claimableRows.length >= limit) break;
    }

    if (staleIds.length > 0) {
      await outbox.updateMany({
        where: { id: { in: staleIds } },
        data: {
          status: "SKIPPED",
          lockedBy: null,
          leaseId: null,
          lockedUntil: null,
          nextAttemptAt: null,
          deliveredAt: new Date(),
          lastError: "Recipient no longer has current Arena access, preference, or a unique linked Telegram account",
        },
      });
    }

    const claimableIds = claimableRows.map((row) => row.id);
    if (claimableIds.length === 0) return [];

    await outbox.updateMany({
      where: {
        id: { in: claimableIds },
        channel: PROJECT_PERSONAL_NOTIFICATION_CHANNEL,
      },
      data: {
        status: "DELIVERING",
        attempts: { increment: 1 },
        lockedBy,
        leaseId,
        lockedUntil,
        lastError: null,
      },
    });

    return outbox.findMany({
      where: {
        id: { in: claimableIds },
        status: "DELIVERING",
        lockedBy,
        leaseId,
      },
      orderBy: { createdAt: "asc" },
    });
  });
}

function nextAttemptAt(attempts: number, now = new Date()): Date {
  const delaySeconds = Math.min(Math.max(attempts, 1) * 30, 10 * 60);
  return new Date(now.getTime() + delaySeconds * 1000);
}

export async function ackPersonalProjectNotificationDelivery(
  db: PrismaClient,
  input: {
    id: string;
    leaseId: string;
    status: "DELIVERED" | "FAILED" | "SKIPPED";
    error?: unknown;
    externalMessageId?: unknown;
    consumerId?: unknown;
  },
) {
  const outbox = getOutboxDelegate(db);
  const lockedBy = safeText(input.consumerId, 120);
  const leaseWhere = {
    id: input.id,
    leaseId: input.leaseId,
    status: "DELIVERING",
    ...(lockedBy ? { lockedBy } : {}),
  };
  const current = await outbox.findUnique({
    where: { id: input.id },
  });
  if (
    !current
    || current.leaseId !== input.leaseId
    || current.status !== "DELIVERING"
    || (lockedBy && current.lockedBy !== lockedBy)
  ) {
    return null;
  }

  if (input.status === "FAILED") {
    await outbox.updateMany({
      where: leaseWhere,
      data: {
        status: "FAILED",
        lockedBy: null,
        leaseId: null,
        lockedUntil: null,
        nextAttemptAt: nextAttemptAt(current.attempts),
        lastError: safeText(input.error, 500) ?? "Telegram private delivery failed",
      },
    });
    return outbox.findUnique({ where: { id: input.id } });
  }

  await outbox.updateMany({
    where: leaseWhere,
    data: {
      status: input.status,
      lockedBy: null,
      leaseId: null,
      lockedUntil: null,
      nextAttemptAt: null,
      deliveredAt: new Date(),
      externalMessageId: safeText(input.externalMessageId, 120),
      lastError: null,
    },
  });
  return outbox.findUnique({ where: { id: input.id } });
}

export function serializePersonalProjectNotification(row: ProjectPersonalNotificationRow) {
  const payload = row.payload && typeof row.payload === "object" && !Array.isArray(row.payload)
    ? row.payload as JsonObject
    : {};

  return {
    id: row.id,
    projectId: row.projectId,
    eventType: row.eventType,
    audience: "project_managers",
    requiredCapability: row.requiredCapability,
    channel: row.channel,
    telegramUserId: row.telegramUserId,
    dedupeKey: row.dedupeKey,
    leaseId: row.leaseId,
    payload,
    attempts: row.attempts,
    createdAt: row.createdAt.toISOString(),
  };
}
