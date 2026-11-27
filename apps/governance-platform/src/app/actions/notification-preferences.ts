"use server";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import {
  NOTIFICATION_EVENTS,
  NOTIFICATION_CHANNELS,
  NOTIFICATION_PREFERENCE_GLOBAL_SCOPE,
} from "@/lib/notifications/types";
import {
  PROJECT_PERSONAL_NOTIFICATION_CHANNEL,
  PROJECT_PERSONAL_NOTIFICATION_EVENT_DESCRIPTIONS,
  PROJECT_PERSONAL_NOTIFICATION_EVENT_LABELS,
  PROJECT_PERSONAL_NOTIFICATION_EVENT_TYPES,
  type ProjectPersonalNotificationEventType,
} from "@/lib/project-personal-notification-types";
import {
  isTelegramWebAppRawAccount,
  type TelegramAccountIdentityRow,
} from "@/lib/telegram-account-identity";

const VALID_EVENTS = new Set<string>(NOTIFICATION_EVENTS);
const VALID_CHANNELS = new Set<string>(NOTIFICATION_CHANNELS);
const VALID_PERSONAL_PROJECT_EVENTS = new Set<string>(PROJECT_PERSONAL_NOTIFICATION_EVENT_TYPES);
const PROJECT_PERSONAL_REQUIRED_CAPABILITY = "project.secrets.manage";

type ProjectPersonalPreferenceSource = "project" | "global" | "default";
type TelegramPrivateAccountStatus = "ready" | "missing" | "ambiguous";

export type ProjectPersonalNotificationPreferenceEvent = {
  eventType: ProjectPersonalNotificationEventType;
  label: string;
  description: string;
  enabled: boolean;
  source: ProjectPersonalPreferenceSource;
};

export type ProjectPersonalNotificationPreferenceProject = {
  projectId: string;
  projectName: string;
  updatedAt: string;
  events: ProjectPersonalNotificationPreferenceEvent[];
};

export type ProjectPersonalNotificationPreferencesResult =
  | {
      success: true;
      telegramAccountStatus: TelegramPrivateAccountStatus;
      telegramAccountMessage: string;
      projects: ProjectPersonalNotificationPreferenceProject[];
    }
  | { success: false; error: string };

function activeAccessGrantWhere(now = new Date()) {
  return [
    { revokedAt: null },
    {
      OR: [
        { expiresAt: null },
        { expiresAt: { gt: now } },
      ],
    },
  ];
}

function projectScope(projectId: string) {
  return {
    scopeType: "project",
    scopeId: projectId,
  } as const;
}

function normalizeProjectId(projectId: string): string | null {
  const normalized = projectId.trim();
  return normalized ? normalized : null;
}

function normalizePersonalProjectEvent(
  eventType: string,
): ProjectPersonalNotificationEventType | null {
  return VALID_PERSONAL_PROJECT_EVENTS.has(eventType)
    ? eventType as ProjectPersonalNotificationEventType
    : null;
}

function readTelegramPrivateAccountStatus(
  accounts: TelegramAccountIdentityRow[],
): { status: TelegramPrivateAccountStatus; message: string } {
  const rawIds = new Set(
    accounts
      .filter(isTelegramWebAppRawAccount)
      .map((account) => account.providerAccountId),
  );

  if (rawIds.size === 1) {
    return {
      status: "ready",
      message: "Telegram is linked and can receive private project notifications.",
    };
  }

  if (rawIds.size > 1) {
    return {
      status: "ambiguous",
      message: "More than one raw Telegram account is linked. Relink Telegram before private delivery can work.",
    };
  }

  return {
    status: "missing",
    message: "Link Telegram from Arena or the Mini App before private delivery can work.",
  };
}

async function listProjectsWithPersonalNotificationAccess(userId: string) {
  const now = new Date();
  const grantRows = await prisma.accessGrant.findMany({
    where: {
      AND: [
        { subjectUserId: userId },
        ...activeAccessGrantWhere(now),
        { capabilities: { has: PROJECT_PERSONAL_REQUIRED_CAPABILITY } },
        {
          OR: [
            { scopeType: "platform" },
            { scopeType: "project" },
          ],
        },
      ],
    },
    select: {
      scopeType: true,
      scopeId: true,
    },
  });

  const hasPlatformManagerGrant = grantRows.some((grant) => grant.scopeType === "platform");
  const grantedProjectIds = [
    ...new Set(
      grantRows
        .filter((grant) => grant.scopeType === "project" && grant.scopeId)
        .map((grant) => grant.scopeId as string),
    ),
  ];

  return prisma.project.findMany({
    where: {
      archivedAt: null,
      tgSpecSourceProjectId: { not: null },
      ...(hasPlatformManagerGrant
        ? {}
        : {
            OR: [
              { ownerScopeType: "user", ownerScopeId: userId },
              ...(grantedProjectIds.length > 0 ? [{ id: { in: grantedProjectIds } }] : []),
            ],
          }),
    },
    select: {
      id: true,
      name: true,
      updatedAt: true,
    },
    orderBy: [
      { updatedAt: "desc" },
      { name: "asc" },
    ],
  });
}

async function canManagePersonalProjectNotifications(
  userId: string,
  projectId: string,
): Promise<boolean> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      id: true,
      archivedAt: true,
      tgSpecSourceProjectId: true,
      ownerScopeType: true,
      ownerScopeId: true,
    },
  });

  if (!project?.tgSpecSourceProjectId || project.archivedAt) return false;
  if (project.ownerScopeType === "user" && project.ownerScopeId === userId) return true;

  const now = new Date();
  const grant = await prisma.accessGrant.findFirst({
    where: {
      AND: [
        { subjectUserId: userId },
        ...activeAccessGrantWhere(now),
        { capabilities: { has: PROJECT_PERSONAL_REQUIRED_CAPABILITY } },
        {
          OR: [
            { scopeType: "platform" },
            { scopeType: "project", scopeId: project.id },
          ],
        },
      ],
    },
    select: { id: true },
  });

  return !!grant;
}

export async function getNotificationPreferences() {
  const session = await auth();
  if (!session?.user?.id) return { success: false as const, error: "Not authenticated" };

  const prefs = await prisma.notificationPreference.findMany({
    where: { userId: session.user.id, ...NOTIFICATION_PREFERENCE_GLOBAL_SCOPE },
    select: { eventType: true, channel: true, enabled: true },
  });

  // Build map: { "project.deployed:email": true, "project.deployed:in_app": true, ... }
  // All default to true (opted in), override with DB records
  const map: Record<string, boolean> = {};
  for (const event of NOTIFICATION_EVENTS) {
    for (const channel of NOTIFICATION_CHANNELS) {
      map[`${event}:${channel}`] = true;
    }
  }
  for (const pref of prefs) {
    map[`${pref.eventType}:${pref.channel}`] = pref.enabled;
  }

  return { success: true as const, preferences: map };
}

export async function getProjectPersonalNotificationPreferences():
  Promise<ProjectPersonalNotificationPreferencesResult> {
  const session = await auth();
  if (!session?.user?.id) return { success: false, error: "Not authenticated" };

  const [projects, telegramAccounts] = await Promise.all([
    listProjectsWithPersonalNotificationAccess(session.user.id),
    prisma.account.findMany({
      where: {
        userId: session.user.id,
        provider: "telegram",
      },
      select: {
        providerAccountId: true,
        scope: true,
        access_token: true,
        id_token: true,
      },
    }),
  ]);

  const telegramAccount = readTelegramPrivateAccountStatus(telegramAccounts);
  const projectIds = projects.map((project) => project.id);
  const preferenceRows = projectIds.length > 0
    ? await prisma.notificationPreference.findMany({
      where: {
        userId: session.user.id,
        channel: PROJECT_PERSONAL_NOTIFICATION_CHANNEL,
        eventType: { in: [...PROJECT_PERSONAL_NOTIFICATION_EVENT_TYPES] },
        OR: [
          NOTIFICATION_PREFERENCE_GLOBAL_SCOPE,
          { scopeType: "project", scopeId: { in: projectIds } },
        ],
      },
      select: {
        eventType: true,
        scopeType: true,
        scopeId: true,
        enabled: true,
      },
    })
    : [];

  const projectPreferences = new Map<string, boolean>();
  const globalPreferences = new Map<string, boolean>();
  for (const row of preferenceRows) {
    if (!VALID_PERSONAL_PROJECT_EVENTS.has(row.eventType)) continue;
    if (row.scopeType === "project") {
      projectPreferences.set(`${row.scopeId}:${row.eventType}`, row.enabled);
    }
    if (
      row.scopeType === NOTIFICATION_PREFERENCE_GLOBAL_SCOPE.scopeType
      && row.scopeId === NOTIFICATION_PREFERENCE_GLOBAL_SCOPE.scopeId
    ) {
      globalPreferences.set(row.eventType, row.enabled);
    }
  }

  return {
    success: true,
    telegramAccountStatus: telegramAccount.status,
    telegramAccountMessage: telegramAccount.message,
    projects: projects.map((project) => ({
      projectId: project.id,
      projectName: project.name,
      updatedAt: project.updatedAt.toISOString(),
      events: PROJECT_PERSONAL_NOTIFICATION_EVENT_TYPES.map((eventType) => {
        const projectKey = `${project.id}:${eventType}`;
        if (projectPreferences.has(projectKey)) {
          return {
            eventType,
            label: PROJECT_PERSONAL_NOTIFICATION_EVENT_LABELS[eventType],
            description: PROJECT_PERSONAL_NOTIFICATION_EVENT_DESCRIPTIONS[eventType],
            enabled: projectPreferences.get(projectKey) ?? true,
            source: "project",
          };
        }
        if (globalPreferences.has(eventType)) {
          return {
            eventType,
            label: PROJECT_PERSONAL_NOTIFICATION_EVENT_LABELS[eventType],
            description: PROJECT_PERSONAL_NOTIFICATION_EVENT_DESCRIPTIONS[eventType],
            enabled: globalPreferences.get(eventType) ?? true,
            source: "global",
          };
        }
        return {
          eventType,
          label: PROJECT_PERSONAL_NOTIFICATION_EVENT_LABELS[eventType],
          description: PROJECT_PERSONAL_NOTIFICATION_EVENT_DESCRIPTIONS[eventType],
          enabled: true,
          source: "default",
        };
      }),
    })),
  };
}

export async function updateNotificationPreference(
  eventType: string,
  channel: string,
  enabled: boolean,
) {
  const session = await auth();
  if (!session?.user?.id) return { success: false as const, error: "Not authenticated" };

  if (!VALID_EVENTS.has(eventType)) {
    return { success: false as const, error: "Invalid event type" };
  }
  if (!VALID_CHANNELS.has(channel)) {
    return { success: false as const, error: "Invalid channel" };
  }

  await prisma.notificationPreference.upsert({
    where: {
      userId_eventType_channel_scopeType_scopeId: {
        userId: session.user.id,
        eventType,
        channel,
        ...NOTIFICATION_PREFERENCE_GLOBAL_SCOPE,
      },
    },
    create: {
      userId: session.user.id,
      eventType,
      channel,
      ...NOTIFICATION_PREFERENCE_GLOBAL_SCOPE,
      enabled,
    },
    update: { enabled },
  });

  return { success: true as const };
}

export async function updateProjectPersonalNotificationPreference(
  projectId: string,
  eventType: string,
  enabled: boolean,
) {
  const session = await auth();
  if (!session?.user?.id) return { success: false as const, error: "Not authenticated" };

  const normalizedProjectId = normalizeProjectId(projectId);
  if (!normalizedProjectId) {
    return { success: false as const, error: "Project is required" };
  }

  const normalizedEventType = normalizePersonalProjectEvent(eventType);
  if (!normalizedEventType) {
    return { success: false as const, error: "Invalid event type" };
  }

  const authorized = await canManagePersonalProjectNotifications(
    session.user.id,
    normalizedProjectId,
  );
  if (!authorized) {
    return { success: false as const, error: "Project access denied" };
  }

  await prisma.notificationPreference.upsert({
    where: {
      userId_eventType_channel_scopeType_scopeId: {
        userId: session.user.id,
        eventType: normalizedEventType,
        channel: PROJECT_PERSONAL_NOTIFICATION_CHANNEL,
        ...projectScope(normalizedProjectId),
      },
    },
    create: {
      userId: session.user.id,
      eventType: normalizedEventType,
      channel: PROJECT_PERSONAL_NOTIFICATION_CHANNEL,
      ...projectScope(normalizedProjectId),
      enabled,
    },
    update: { enabled },
  });

  revalidatePath("/settings");

  return { success: true as const };
}
