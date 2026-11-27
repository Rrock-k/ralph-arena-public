import { prisma } from "@/lib/prisma";
import { shouldBeAdmin } from "@/lib/auth-utils";
import { ACCESS_PRESET_DEFINITIONS } from "./presets";

const SUPERADMIN_CAPABILITIES = ACCESS_PRESET_DEFINITIONS.superadmin.capabilities;

function getAccessGrantDelegate() {
  return (prisma as typeof prisma & {
    accessGrant?: typeof prisma.accessGrant;
  }).accessGrant ?? null;
}

function getAccessAuditLogDelegate() {
  return (prisma as typeof prisma & {
    accessAuditLog?: typeof prisma.accessAuditLog;
  }).accessAuditLog ?? null;
}

export async function ensureBootstrapSuperadminGrantForUser(
  userId: string,
  note = "Bootstrap superadmin grant from ADMIN_EMAILS",
): Promise<void> {
  const accessGrant = getAccessGrantDelegate();
  const accessAuditLog = getAccessAuditLogDelegate();
  if (!accessGrant || !accessAuditLog) {
    return;
  }

  const existing = await accessGrant.findFirst({
    where: {
      subjectUserId: userId,
      scopeType: "platform",
      sourcePresetKey: "superadmin",
      revokedAt: null,
      OR: [
        { expiresAt: null },
        { expiresAt: { gt: new Date() } },
      ],
    },
    select: { id: true },
  });
  if (existing) {
    return;
  }

  await prisma.$transaction(async (tx) => {
    await tx.accessGrant.create({
      data: {
        subjectUserId: userId,
        scopeType: "platform",
        scopeId: null,
        sourcePresetKey: "superadmin",
        sourceKind: "manual",
        capabilities: SUPERADMIN_CAPABILITIES,
        reason: note,
      },
    });

    await tx.accessAuditLog.create({
      data: {
        action: "grant_created",
        actorUserId: null,
        subjectUserId: userId,
        scopeType: "platform",
        scopeId: null,
        sourcePresetKey: "superadmin",
        sourceKind: "manual",
        previousCapabilities: [],
        nextCapabilities: SUPERADMIN_CAPABILITIES,
        note,
      },
    });
  });
}

export async function ensureBootstrapSuperadminGrantForEmail(email: string): Promise<void> {
  if (!shouldBeAdmin(email)) {
    return;
  }

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true },
  });
  if (!user) {
    return;
  }

  await ensureBootstrapSuperadminGrantForUser(user.id);
}
