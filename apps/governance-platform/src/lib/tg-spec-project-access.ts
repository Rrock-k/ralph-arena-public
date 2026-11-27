import "server-only";

import { prisma } from "@/lib/prisma";
import {
  ACCESS_PRESET_DEFINITIONS,
  PROJECT_MANAGER_CAPABILITIES,
  PROJECT_VIEWER_CAPABILITIES,
} from "@/lib/access-control/presets";
import {
  TG_SPEC_AUTO_SYNC_REASON_PREFIX,
  type AccessCapability,
  type AccessPresetKey,
} from "@/lib/access-control/types";

const TG_SPEC_ACCESS_REQUEST_TIMEOUT_MS = 5_000;
const TG_SPEC_ROLE_GRANT_TTL_MS = 30 * 60 * 1000;

type TgSpecProjectMembershipRole = "curator" | "contributor" | "viewer";

export type TgSpecProjectAccessSyncResult =
  | { status: "not_applicable" }
  | { status: "bridge_unconfigured" }
  | { status: "no_membership" }
  | { status: "already_granted"; role: TgSpecProjectMembershipRole; presetKey: AccessPresetKey }
  | { status: "granted"; role: TgSpecProjectMembershipRole; presetKey: AccessPresetKey; grantId: string }
  | { status: "error"; error: string };

type TgSpecRequestResult =
  | { ok: true; payload: any }
  | { ok: false; error: string; status: number | null };

function trimToNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function tgSpecConfig() {
  const baseUrl = trimToNull(process.env.TG_SPEC_INTERNAL_BASE_URL)?.replace(/\/+$/g, "") ?? null;
  const secret = trimToNull(process.env.ARENA_PUSH_SECRET);
  return {
    baseUrl,
    secret,
    configured: Boolean(baseUrl && secret),
  };
}

async function requestTgSpecMembership(
  arenaProjectId: string,
  telegramUserId: string,
): Promise<TgSpecRequestResult> {
  const config = tgSpecConfig();
  if (!config.configured || !config.baseUrl || !config.secret) {
    return {
      ok: false,
      status: null,
      error: "tg-spec internal bridge is not configured",
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TG_SPEC_ACCESS_REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(
      `${config.baseUrl}/api/internal/arena/projects/${encodeURIComponent(arenaProjectId)}/telegram-membership`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-evolution-push-secret": config.secret,
        },
        body: JSON.stringify({ telegramUserId }),
        cache: "no-store",
        signal: controller.signal,
      },
    );
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        error: typeof payload?.error === "string"
          ? payload.error
          : `tg-spec request failed with ${response.status}`,
      };
    }
    return { ok: true, payload };
  } catch (error) {
    return {
      ok: false,
      status: null,
      error: error instanceof Error ? error.message : "tg-spec request failed",
    };
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeRole(value: unknown): TgSpecProjectMembershipRole | null {
  return value === "curator" || value === "contributor" || value === "viewer" ? value : null;
}

function accessForRole(role: TgSpecProjectMembershipRole): {
  presetKey: AccessPresetKey;
  capabilities: AccessCapability[];
} {
  if (role === "curator") {
    return {
      presetKey: "project_manager",
      capabilities: [...PROJECT_MANAGER_CAPABILITIES].sort(),
    };
  }

  return {
    presetKey: "project_viewer",
    capabilities: [...PROJECT_VIEWER_CAPABILITIES].sort(),
  };
}

function hasAllCapabilities(source: string[], required: AccessCapability[]) {
  return required.every((capability) => source.includes(capability));
}

function expiresAtForRole(now: Date) {
  return new Date(now.getTime() + TG_SPEC_ROLE_GRANT_TTL_MS);
}

function existingGrantSatisfiesRole(
  grant: { capabilities: string[] },
  capabilities: AccessCapability[],
) {
  return hasAllCapabilities(grant.capabilities, capabilities);
}

function exactCapabilitiesMatch(source: string[], required: AccessCapability[]) {
  return source.length === required.length && hasAllCapabilities(source, required);
}

function isTgSpecAutoSyncedGrant(grant: { sourceKind?: string | null; reason?: string | null }) {
  return grant.sourceKind === "telegram_admin_sync"
    || grant.reason?.startsWith(TG_SPEC_AUTO_SYNC_REASON_PREFIX) === true;
}

export async function syncTgSpecProjectAccessForTelegramViewer(input: {
  projectId: string;
  arenaUserId: string;
  telegramUserId: string;
}): Promise<TgSpecProjectAccessSyncResult> {
  const project = await prisma.project.findUnique({
    where: { id: input.projectId },
    select: {
      id: true,
      tgSpecSourceProjectId: true,
    },
  });
  if (!project?.tgSpecSourceProjectId) {
    return { status: "not_applicable" };
  }

  const result = await requestTgSpecMembership(project.id, input.telegramUserId);
  if (!result.ok) {
    if (result.status === null) return { status: "bridge_unconfigured" };
    if (result.status === 404) return { status: "no_membership" };
    return { status: "error", error: result.error };
  }

  const sourceProjectId = trimToNull(result.payload?.project?.sourceProjectId) ?? trimToNull(result.payload?.project?.id);
  if (sourceProjectId !== project.tgSpecSourceProjectId) {
    return { status: "error", error: "tg-spec membership project mismatch" };
  }

  const role = normalizeRole(result.payload?.membership?.role);
  if (!role) {
    return { status: "no_membership" };
  }

  const { presetKey, capabilities } = accessForRole(role);
  const now = new Date();
  const expiresAt = expiresAtForRole(now);
  const existingGrants = await prisma.accessGrant.findMany({
    where: {
      subjectUserId: input.arenaUserId,
      revokedAt: null,
      OR: [
        { scopeType: "project", scopeId: project.id },
        { scopeType: "platform" },
      ],
      AND: [
        {
          OR: [
            { expiresAt: null },
            { expiresAt: { gt: now } },
          ],
        },
      ],
    },
    select: {
      id: true,
      capabilities: true,
      expiresAt: true,
      reason: true,
      sourceKind: true,
      sourcePresetKey: true,
    },
  });
  const autoSyncedGrant = existingGrants.find((grant) => isTgSpecAutoSyncedGrant(grant));
  if (autoSyncedGrant) {
    if (!exactCapabilitiesMatch(autoSyncedGrant.capabilities, capabilities) || autoSyncedGrant.sourcePresetKey !== presetKey) {
      await prisma.$transaction(async (tx) => {
        await tx.accessGrant.update({
          where: { id: autoSyncedGrant.id },
          data: {
            capabilities,
            sourcePresetKey: presetKey,
            expiresAt,
            sourceKind: "telegram_admin_sync",
            sourceSyncedAt: now,
            reason: `Auto-synced from tg-spec Telegram ${role} role (${project.tgSpecSourceProjectId}, Telegram ${input.telegramUserId})`,
          },
        });
        await tx.accessAuditLog.create({
          data: {
            action: "grant_updated",
            actorUserId: null,
            subjectUserId: input.arenaUserId,
            scopeType: "project",
            scopeId: project.id,
            sourcePresetKey: presetKey,
            sourceKind: "telegram_admin_sync",
            previousCapabilities: autoSyncedGrant.capabilities,
            nextCapabilities: capabilities,
            note: "Auto-synced tg-spec Telegram role changed",
          },
        });
      });
    } else {
      await prisma.accessGrant.update({
        where: { id: autoSyncedGrant.id },
        data: { expiresAt, sourceKind: "telegram_admin_sync", sourceSyncedAt: now },
      });
    }
    return { status: "already_granted", role, presetKey };
  }

  const existingGrant = existingGrants.find((grant) => existingGrantSatisfiesRole(grant, capabilities));
  if (existingGrant) {
    return { status: "already_granted", role, presetKey };
  }

  const reason = `Auto-synced from tg-spec Telegram ${role} role (${project.tgSpecSourceProjectId}, Telegram ${input.telegramUserId})`;
  const created = await prisma.$transaction(async (tx) => {
    const grant = await tx.accessGrant.create({
      data: {
        subjectUserId: input.arenaUserId,
        scopeType: "project",
        scopeId: project.id,
        sourcePresetKey: presetKey,
        sourceKind: "telegram_admin_sync",
        sourceSyncedAt: now,
        customLabel: null,
        capabilities,
        grantedById: null,
        reason,
        expiresAt,
      },
      select: { id: true },
    });

    await tx.accessAuditLog.create({
      data: {
        action: "grant_created",
        actorUserId: null,
        subjectUserId: input.arenaUserId,
        scopeType: "project",
        scopeId: project.id,
        sourcePresetKey: presetKey,
        sourceKind: "telegram_admin_sync",
        previousCapabilities: [],
        nextCapabilities: capabilities,
        note: reason,
      },
    });

    return grant;
  });

  return { status: "granted", role, presetKey, grantId: created.id };
}

export function tgSpecAccessCapabilitiesForRole(role: TgSpecProjectMembershipRole) {
  const { presetKey, capabilities } = accessForRole(role);
  return {
    presetKey,
    capabilities,
    label: ACCESS_PRESET_DEFINITIONS[presetKey].label,
  };
}
