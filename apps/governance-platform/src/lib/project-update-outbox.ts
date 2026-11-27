import type { Prisma, PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";

export const PROJECT_UPDATE_EVENT_TYPES = [
  "spec.imported",
  "planning.started",
  "plan.ready",
  "work.started",
  "task.completed",
  "progress.updated",
  "preview.ready",
  "change_batch.completed",
  "action.required",
  "required_secret.missing",
  "required_secret.provided",
  "work.completed",
  "work.failed",
  "work.needs_evidence",
] as const;

export type ProjectUpdateEventType = (typeof PROJECT_UPDATE_EVENT_TYPES)[number];

export const PROJECT_UPDATE_AUDIENCES = [
  "project_contributors",
  "project_managers",
  "public_featured",
] as const;

export type ProjectUpdateAudience = (typeof PROJECT_UPDATE_AUDIENCES)[number];

export const PROJECT_UPDATE_DELIVERY_STATUSES = [
  "PENDING",
  "DELIVERING",
  "DELIVERED",
  "FAILED",
  "SKIPPED",
] as const;

export type ProjectUpdateDeliveryStatus = (typeof PROJECT_UPDATE_DELIVERY_STATUSES)[number];

export const PROJECT_UPDATE_DELIVERY_TARGET_STATUSES = [
  "ACTIVE",
  "PAUSED",
  "REVOKED",
] as const;

export type ProjectUpdateDeliveryTargetStatus = (typeof PROJECT_UPDATE_DELIVERY_TARGET_STATUSES)[number];

export const PROJECT_MANAGER_UPDATE_REQUIRED_CAPABILITY = "project.secrets.manage";
export const PROJECT_UPDATE_DELIVERY_TARGET_SOURCE_SYSTEM = "tg-spec";
export const PROJECT_UPDATE_DELIVERY_TARGET_KIND = "telegram_chat_topic";

type Db = PrismaClient | Prisma.TransactionClient;
type JsonObject = Record<string, unknown>;

type EventDefinition = {
  audience: ProjectUpdateAudience;
  requiredCapability: string | null;
};

export const PROJECT_UPDATE_EVENT_DEFINITIONS: Record<ProjectUpdateEventType, EventDefinition> = {
  "spec.imported": {
    audience: "project_contributors",
    requiredCapability: "project.view",
  },
  "planning.started": {
    audience: "project_contributors",
    requiredCapability: "project.view",
  },
  "plan.ready": {
    audience: "project_contributors",
    requiredCapability: "project.view",
  },
  "work.started": {
    audience: "project_contributors",
    requiredCapability: "project.view",
  },
  "task.completed": {
    audience: "project_contributors",
    requiredCapability: "project.view",
  },
  "progress.updated": {
    audience: "project_contributors",
    requiredCapability: "project.view",
  },
  "preview.ready": {
    audience: "project_contributors",
    requiredCapability: "project.view",
  },
  "change_batch.completed": {
    audience: "project_contributors",
    requiredCapability: "project.view",
  },
  "action.required": {
    audience: "project_contributors",
    requiredCapability: "project.view",
  },
  "required_secret.missing": {
    audience: "project_managers",
    requiredCapability: "project.secrets.manage",
  },
  "required_secret.provided": {
    audience: "project_managers",
    requiredCapability: "project.secrets.manage",
  },
  "work.completed": {
    audience: "project_contributors",
    requiredCapability: "project.view",
  },
  "work.failed": {
    audience: "project_contributors",
    requiredCapability: "project.view",
  },
  "work.needs_evidence": {
    audience: "project_contributors",
    requiredCapability: "project.view",
  },
};

const SAFE_REASON_CODES = new Set([
  "API",
  "ASSUMPTION",
  "BUDGET",
  "CANCELED",
  "FAILED",
  "INFRA",
  "MANUAL",
  "RATE_LIMIT",
  "SECRETS",
  "UNKNOWN",
]);

function asRecord(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonObject
    : {};
}

function safeText(value: unknown, maxLength = 240): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.replace(/\s+/g, " ").trim();
  if (!text) return undefined;
  return text.length > maxLength ? `${text.slice(0, maxLength - 3)}...` : text;
}

function safeFullText(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.replace(/\s+/g, " ").trim();
  return text || undefined;
}

function safeTaskCompletionStatus(value: unknown): string | undefined {
  return value === "completed" || value === "skipped" ? value : undefined;
}

function safePositiveInt(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) return undefined;
  return value;
}

function safeNonNegativeInt(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) return undefined;
  return value;
}

function safeRequiredSecretKeys(value: unknown): string[] {
  const list = Array.isArray(value) ? value : [];
  const seen = new Set<string>();
  const keys: string[] = [];
  for (const raw of list) {
    if (typeof raw !== "string") continue;
    const key = raw.trim().toUpperCase();
    if (!/^[A-Z_][A-Z0-9_]*$/.test(key)) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    keys.push(key);
  }
  return keys;
}

function safeStringList(value: unknown, maxItems: number, maxLength = 80): string[] {
  const list = Array.isArray(value) ? value : [];
  const seen = new Set<string>();
  const items: string[] = [];
  for (const raw of list) {
    if (typeof raw !== "string") continue;
    const text = raw.replace(/\s+/g, " ").trim();
    if (!text || text.length > maxLength || seen.has(text)) continue;
    seen.add(text);
    items.push(text);
    if (items.length >= maxItems) break;
  }
  return items;
}

function safeUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return undefined;
    const host = url.hostname.toLowerCase();
    if (
      host === "localhost"
      || host === "127.0.0.1"
      || host === "::1"
      || host.endsWith(".localhost")
      || host.endsWith(".local")
      || host.endsWith(".internal")
      || !host.includes(".")
      || isPrivateIpv4Host(host)
    ) return undefined;
    return url.toString();
  } catch {
    return undefined;
  }
}

function safeTelegramMiniAppUrl(value: unknown): string | undefined {
  const safe = safeUrl(value);
  if (!safe) return undefined;

  try {
    const url = new URL(safe);
    const host = url.hostname.toLowerCase();
    if (host !== "t.me" && host !== "telegram.me") return undefined;
    const pathSegments = url.pathname.split("/").filter(Boolean);
    if (pathSegments.length < 1 || pathSegments.length > 2) return undefined;
    if (!/^[A-Za-z0-9_]{5,32}$/.test(pathSegments[0] ?? "")) return undefined;
    if (pathSegments[1] && !/^[A-Za-z0-9_]{1,64}$/.test(pathSegments[1])) return undefined;
    const startApp = url.searchParams.get("startapp");
    if (!startApp || !/^[A-Za-z0-9_-]{1,512}$/.test(startApp)) return undefined;
    return url.toString();
  } catch {
    return undefined;
  }
}

function isPrivateIpv4Host(host: string): boolean {
  const parts = host.split(".");
  if (parts.length !== 4) return false;
  const nums = parts.map((part) => Number(part));
  if (nums.some((num) => !Number.isInteger(num) || num < 0 || num > 255)) return false;
  const [a, b] = nums;
  return (
    a === 10
    || a === 127
    || a === 0
    || a === 169 && b === 254
    || a === 172 && b >= 16 && b <= 31
    || a === 192 && b === 168
    || a === 100 && b >= 64 && b <= 127
  );
}

function safeReasonCode(value: unknown): string {
  if (typeof value !== "string") return "UNKNOWN";
  const code = value.trim().toUpperCase().replace(/[^A-Z0-9_]/g, "_");
  return SAFE_REASON_CODES.has(code) ? code : "UNKNOWN";
}

function safeMetadataStatus(value: unknown): string | undefined {
  if (value === "present" || value === "legacy_missing") return value;
  return undefined;
}

function safeArtifactId(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const id = value.trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9_:-]{1,119}$/.test(id)) return undefined;
  if (id.startsWith("JUDGMENT-")) return undefined;
  return id;
}

function safeVersionLabel(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const label = value.replace(/\s+/g, " ").trim();
  if (!/^v?[0-9][0-9A-Za-z._-]{0,39}$/.test(label)) return undefined;
  return label.startsWith("v") || label.startsWith("V") ? `v${label.slice(1)}` : `v${label}`;
}

function safeCompletedChangeItems(value: unknown): JsonObject[] {
  const list = Array.isArray(value) ? value : [];
  const items: JsonObject[] = [];
  const seen = new Set<string>();

  for (const raw of list) {
    const item = asRecord(raw);
    const diffItemId = safeArtifactId(item.diffItemId ?? item.id);
    const feedbackItemId = safeArtifactId(item.feedbackItemId ?? item.itemId);
    const title = safeText(item.title, 120);
    if (!diffItemId || !title || seen.has(diffItemId)) continue;
    seen.add(diffItemId);
    items.push(compactObject({
      diffItemId,
      feedbackItemId,
      title,
      verification: safeText(item.verification, 500),
      coveredSummary: safeFullText(item.coveredSummary),
      versionLabel: safeVersionLabel(item.versionLabel),
    }));
    if (items.length >= 5) break;
  }

  return items;
}

function compactObject(value: JsonObject): JsonObject {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => (
      entry !== undefined
      && !(Array.isArray(entry) && entry.length === 0)
    )),
  );
}

export function buildProjectUpdatePayload(
  eventType: ProjectUpdateEventType,
  rawPayload: unknown,
): JsonObject {
  const payload = asRecord(rawPayload);

  switch (eventType) {
    case "spec.imported":
      return compactObject({
        sourceSystem: "tg-spec",
        sourceProjectId: safeText(payload.sourceProjectId, 120),
        sourceVersion: safePositiveInt(payload.sourceVersion),
        sourceUrl: safeUrl(payload.sourceUrl),
        changeSummary: safeText(payload.changeSummary, 280),
        specId: safeText(payload.specId, 120),
        specVersionId: safeText(payload.specVersionId, 120),
        specVersion: safePositiveInt(payload.specVersion),
        acceptedAt: safeText(payload.acceptedAt, 80),
        importedAt: safeText(payload.importedAt, 80),
        diffItemCount: safeNonNegativeInt(payload.diffItemCount),
        diffItemIds: safeStringList(payload.diffItemIds, 25),
        workItemCount: safeNonNegativeInt(payload.workItemCount),
        workItemIds: safeStringList(payload.workItemIds, 25),
        reopenedItemIds: safeStringList(payload.reopenedItemIds, 25),
        metadataHash: safeText(payload.metadataHash, 120),
        metadataStatus: safeMetadataStatus(payload.metadataStatus),
      });
    case "planning.started":
      return { phase: "planning" };
    case "plan.ready":
      return compactObject({
        sourceVersion: safePositiveInt(payload.sourceVersion),
        targetSpecVersion: safePositiveInt(payload.targetSpecVersion),
        workItemCount: safeNonNegativeInt(payload.workItemCount),
      });
    case "work.started":
      return { phase: "work_started" };
    case "task.completed":
      return compactObject({
        taskId: safeText(payload.taskId, 120),
        title: safeText(payload.title, 160),
        status: safeTaskCompletionStatus(payload.status),
        diffItemId: safeArtifactId(payload.diffItemId),
        feedbackItemId: safeArtifactId(payload.feedbackItemId),
        coveredSummary: safeFullText(payload.coveredSummary),
      });
    case "progress.updated":
      return compactObject({
        currentTask: safeText(payload.currentTask, 140),
        sourceVersion: safePositiveInt(payload.sourceVersion),
        targetSpecVersion: safePositiveInt(payload.targetSpecVersion),
        workItemCount: safeNonNegativeInt(payload.workItemCount),
      });
    case "preview.ready":
      return compactObject({
        previewUrl: safeUrl(payload.previewUrl),
        telegramMiniAppUrl: safeTelegramMiniAppUrl(payload.telegramMiniAppUrl),
      });
    case "change_batch.completed":
      return compactObject({
        outcome: "completed",
        sourceVersion: safePositiveInt(payload.sourceVersion),
        targetSpecVersion: safePositiveInt(payload.targetSpecVersion),
        diffId: safeArtifactId(payload.diffId),
        summary: safeText(payload.summary, 180),
        workItemCount: safeNonNegativeInt(payload.workItemCount),
        remainingBatchCount: safeNonNegativeInt(payload.remainingBatchCount),
        nextSourceVersion: safePositiveInt(payload.nextSourceVersion),
        nextTargetSpecVersion: safePositiveInt(payload.nextTargetSpecVersion),
        versionLabel: safeVersionLabel(payload.versionLabel),
        completedItems: safeCompletedChangeItems(payload.completedItems),
        previewUrl: safeUrl(payload.previewUrl),
        telegramMiniAppUrl: safeTelegramMiniAppUrl(payload.telegramMiniAppUrl),
      });
    case "action.required":
      return compactObject({
        reasonCode: safeReasonCode(payload.reasonCode),
        summary: safeText(payload.summary, 220),
        actionHref: safeUrl(payload.actionHref),
        assumptionId: safeArtifactId(payload.assumptionId),
        assumptionTitle: safeText(payload.assumptionTitle, 120),
      });
    case "required_secret.missing": {
      const requiredSecretKeys = safeRequiredSecretKeys(payload.requiredSecretKeys);
      return compactObject({
        requiredSecretKeys,
        count: requiredSecretKeys.length,
        actionHref: safeText(payload.actionHref, 240),
      });
    }
    case "required_secret.provided": {
      const requiredSecretKeys = safeRequiredSecretKeys(payload.requiredSecretKeys);
      return compactObject({
        requiredSecretKeys,
        count: requiredSecretKeys.length,
      });
    }
    case "work.completed":
      return compactObject({
        outcome: "completed",
        previewUrl: safeUrl(payload.previewUrl),
        telegramMiniAppUrl: safeTelegramMiniAppUrl(payload.telegramMiniAppUrl),
      });
    case "work.failed":
      return compactObject({
        outcome: "failed",
        reasonCode: safeReasonCode(payload.reasonCode),
      });
    case "work.needs_evidence":
      return compactObject({
        outcome: "needs_evidence",
        reasonCode: safeReasonCode(payload.reasonCode),
        summary: safeText(payload.summary, 280),
      });
  }
}

export function normalizeProjectUpdateDedupeKey(
  eventType: ProjectUpdateEventType,
  dedupeKey: string,
): string {
  const normalized = dedupeKey.replace(/\s+/g, " ").trim();
  if (!normalized) {
    throw new Error(`Project update dedupe key is required for ${eventType}`);
  }
  return `${eventType}:${normalized}`;
}

async function isProjectEligibleForTelegramUpdates(
  db: Db,
  projectId: string,
): Promise<boolean> {
  const project = await db.project.findUnique({
    where: { id: projectId },
    select: {
      tgSpecSourceProjectId: true,
    },
  });

  if (!project) return false;
  return Boolean(project.tgSpecSourceProjectId);
}

export async function enqueueProjectUpdate(
  db: Db,
  input: {
    projectId: string;
    eventType: ProjectUpdateEventType;
    dedupeKey: string;
    payload?: unknown;
  },
) {
  if (!await isProjectEligibleForTelegramUpdates(db, input.projectId)) {
    return null;
  }

  const definition = PROJECT_UPDATE_EVENT_DEFINITIONS[input.eventType];
  const payload = buildProjectUpdatePayload(input.eventType, input.payload ?? {});
  const dedupeKey = normalizeProjectUpdateDedupeKey(input.eventType, input.dedupeKey);

  const update = await db.projectUpdateOutbox.upsert({
    where: {
      projectId_dedupeKey: {
        projectId: input.projectId,
        dedupeKey,
      },
    },
    update: {},
    create: {
      projectId: input.projectId,
      eventType: input.eventType,
      audience: definition.audience,
      requiredCapability: definition.requiredCapability,
      dedupeKey,
      payload: payload as Prisma.InputJsonValue,
    },
  });

  const { enqueuePersonalProjectNotifications } = await import("@/lib/project-personal-notifications");
  await enqueuePersonalProjectNotifications(db, input);

  return update;
}

function normalizeAudiences(
  values: unknown,
  allowedAudiences: ProjectUpdateAudience[] = ["project_contributors"],
): ProjectUpdateAudience[] {
  const requested = Array.isArray(values) ? values : ["project_contributors"];
  const allowed = new Set<ProjectUpdateAudience>(PROJECT_UPDATE_AUDIENCES);
  const deliveryAllowed = new Set<ProjectUpdateAudience>(allowedAudiences);
  const audiences = requested.filter((value): value is ProjectUpdateAudience => (
    typeof value === "string"
    && allowed.has(value as ProjectUpdateAudience)
    && deliveryAllowed.has(value as ProjectUpdateAudience)
  ));
  return [...new Set(audiences)];
}

function normalizeLimit(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value)) return 20;
  return Math.min(Math.max(value, 1), 100);
}

export async function findActiveProjectUpdateDeliveryTarget(
  db: Db,
  input: {
    targetId?: unknown;
    audience: ProjectUpdateAudience;
    requiredCapability?: string | null;
    sourceSystem?: string | null;
    targetKind?: string | null;
  },
) {
  const targetId = safeText(input.targetId, 120);
  if (!targetId) return null;

  return db.projectUpdateDeliveryTarget.findFirst({
    where: {
      id: targetId,
      status: "ACTIVE",
      audience: input.audience,
      ...(input.sourceSystem ? { sourceSystem: input.sourceSystem } : {}),
      ...(input.targetKind ? { targetKind: input.targetKind } : {}),
      ...(input.requiredCapability !== undefined
        ? { requiredCapability: input.requiredCapability }
        : {}),
    },
    select: {
      id: true,
      projectId: true,
      sourceSystem: true,
      sourceTargetId: true,
      targetKind: true,
      audience: true,
      requiredCapability: true,
      status: true,
    },
  });
}

export async function claimProjectUpdates(
  db: PrismaClient,
  input: {
    audiences?: unknown;
    allowedAudiences?: ProjectUpdateAudience[];
    limit?: unknown;
    consumerId?: unknown;
    targetId?: unknown;
    leaseSeconds?: number;
  },
) {
  const audiences = normalizeAudiences(input.audiences, input.allowedAudiences);
  const wantsManagerAudience = audiences.includes("project_managers");
  const targetId = safeText(input.targetId, 120);
  if (wantsManagerAudience && audiences.length !== 1) {
    throw new Error("Manager project updates must be claimed separately from contributor updates");
  }
  if (wantsManagerAudience && !targetId) {
    throw new Error("Manager project updates require an active Arena delivery target");
  }
  const limit = normalizeLimit(input.limit);
  const now = new Date();
  const leaseId = randomUUID();
  const lockedUntil = new Date(now.getTime() + Math.max(input.leaseSeconds ?? 90, 15) * 1000);
  const lockedBy = safeText(input.consumerId, 120) ?? "tg-spec";

  return db.$transaction(async (tx) => {
    const managerDeliveryTarget = wantsManagerAudience
      ? await findActiveProjectUpdateDeliveryTarget(tx, {
        targetId,
        audience: "project_managers",
        requiredCapability: PROJECT_MANAGER_UPDATE_REQUIRED_CAPABILITY,
        sourceSystem: PROJECT_UPDATE_DELIVERY_TARGET_SOURCE_SYSTEM,
        targetKind: PROJECT_UPDATE_DELIVERY_TARGET_KIND,
      })
      : null;
    if (wantsManagerAudience && !managerDeliveryTarget) return [];

    const claimableWhere: Prisma.ProjectUpdateOutboxWhereInput = {
      audience: { in: audiences },
      ...(managerDeliveryTarget
        ? {
          projectId: managerDeliveryTarget.projectId,
          requiredCapability: managerDeliveryTarget.requiredCapability,
        }
        : {}),
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
    };

    const rows = await tx.projectUpdateOutbox.findMany({
      where: claimableWhere,
      orderBy: { createdAt: "asc" },
      take: limit,
    });
    const ids = rows.map((row) => row.id);
    if (ids.length === 0) return [];

    await tx.projectUpdateOutbox.updateMany({
      where: {
        id: { in: ids },
        ...claimableWhere,
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

    return tx.projectUpdateOutbox.findMany({
      where: { id: { in: ids }, status: "DELIVERING", lockedBy, leaseId },
      orderBy: { createdAt: "asc" },
    });
  });
}

function nextAttemptAt(attempts: number, now = new Date()): Date {
  const delaySeconds = Math.min(Math.max(attempts, 1) * 30, 10 * 60);
  return new Date(now.getTime() + delaySeconds * 1000);
}

export async function ackProjectUpdateDelivery(
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
  const lockedBy = safeText(input.consumerId, 120);
  const leaseWhere = {
    id: input.id,
    leaseId: input.leaseId,
    status: "DELIVERING",
    ...(lockedBy ? { lockedBy } : {}),
  };
  const current = await db.projectUpdateOutbox.findFirst({
    where: leaseWhere,
    select: { id: true, attempts: true },
  });
  if (!current) return null;

  if (input.status === "FAILED") {
    await db.projectUpdateOutbox.updateMany({
      where: leaseWhere,
      data: {
        status: "FAILED",
        lockedBy: null,
        leaseId: null,
        lockedUntil: null,
        nextAttemptAt: nextAttemptAt(current.attempts),
        lastError: safeText(input.error, 500) ?? "Delivery failed",
      },
    });
    return db.projectUpdateOutbox.findUnique({ where: { id: input.id } });
  }

  const skippedError = input.status === "SKIPPED"
    ? safeText(input.error, 500) ?? "Delivery skipped"
    : null;

  await db.projectUpdateOutbox.updateMany({
    where: leaseWhere,
    data: {
      status: input.status,
      lockedBy: null,
      leaseId: null,
      lockedUntil: null,
      nextAttemptAt: null,
      deliveredAt: new Date(),
      externalMessageId: safeText(input.externalMessageId, 120),
      lastError: skippedError,
    },
  });
  return db.projectUpdateOutbox.findUnique({ where: { id: input.id } });
}

export function serializeProjectUpdate(row: {
  id: string;
  projectId: string;
  eventType: string;
  audience: string;
  requiredCapability: string | null;
  dedupeKey: string;
  leaseId: string | null;
  payload: Prisma.JsonValue;
  attempts: number;
  createdAt: Date;
}) {
  return {
    id: row.id,
    projectId: row.projectId,
    eventType: row.eventType,
    audience: row.audience,
    requiredCapability: row.requiredCapability,
    dedupeKey: row.dedupeKey,
    leaseId: row.leaseId,
    payload: row.payload,
    attempts: row.attempts,
    createdAt: row.createdAt.toISOString(),
  };
}
