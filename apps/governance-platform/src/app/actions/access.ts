"use server";

import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { ACCESS_PRESET_DEFINITIONS } from "@/lib/access-control/presets";
import { requirePlatformCapability } from "@/lib/platform-access";
import { requireProjectCapability } from "@/lib/project-access";
import type {
  AccessCapability,
  AccessPresetKey,
  AccessScopeType,
} from "@/lib/access-control/types";

type CreateAccessGrantInput = {
  subjectUserId: string;
  scopeType: AccessScopeType;
  scopeId?: string | null;
  sourcePresetKey?: AccessPresetKey | null;
  customLabel?: string | null;
  capabilities?: AccessCapability[] | null;
  expiresAt?: string | null;
  reason?: string | null;
};

type CreateProjectAccessGrantInput = {
  subjectUserId: string;
  sourcePresetKey: AccessPresetKey;
  expiresAt?: string | null;
  reason?: string | null;
};

type AccessGrantAuthz = {
  actorUserId: string | null;
};

function normalizeCapabilities(capabilities: AccessCapability[]): AccessCapability[] {
  return [...new Set(capabilities)].sort();
}

async function requireAccessAdmin() {
  const access = await requirePlatformCapability("platform.access.manage");
  if (!access.authorized) {
    return { authorized: false as const, error: access.error };
  }

  return {
    authorized: true as const,
    actorUserId: access.session?.user?.id ?? null,
  };
}

function getAccessGrantDelegate() {
  const delegate = (prisma as typeof prisma & {
    accessGrant?: typeof prisma.accessGrant;
  }).accessGrant;
  if (!delegate) {
    return null;
  }
  return delegate;
}

function getAccessAuditLogDelegate() {
  const delegate = (prisma as typeof prisma & {
    accessAuditLog?: typeof prisma.accessAuditLog;
  }).accessAuditLog;
  if (!delegate) {
    return null;
  }
  return delegate;
}

function revalidateAccessPaths(scopeType: AccessScopeType, scopeId: string | null) {
  revalidatePath("/my");
  revalidatePath("/admin");

  if (scopeType === "project" && scopeId) {
    revalidatePath(`/projects/${scopeId}`);
    revalidatePath(`/my/projects/${scopeId}`);
    revalidatePath(`/admin/projects/${scopeId}`);
  }
}

async function createAccessGrantWithAuthz(
  input: CreateAccessGrantInput,
  authz: AccessGrantAuthz,
) {
  const subjectUserId = input.subjectUserId.trim();
  if (!subjectUserId) {
    return { success: false as const, error: "Subject user is required" };
  }

  const scopeType = input.scopeType;
  const scopeId = scopeType === "platform"
    ? null
    : input.scopeId?.trim() || null;
  if (scopeType === "project" && !scopeId) {
    return { success: false as const, error: "Project scope is required" };
  }

  const preset = input.sourcePresetKey
    ? ACCESS_PRESET_DEFINITIONS[input.sourcePresetKey]
    : null;
  if (preset && preset.scopeType !== scopeType) {
    return { success: false as const, error: "Preset does not match scope type" };
  }

  const rawCapabilities = input.capabilities?.length
    ? input.capabilities
    : preset?.capabilities ?? [];
  const capabilities = normalizeCapabilities(rawCapabilities);
  if (capabilities.length === 0) {
    return { success: false as const, error: "Capabilities are required" };
  }

  let expiresAt: Date | null = null;
  if (input.expiresAt) {
    const parsed = new Date(input.expiresAt);
    if (Number.isNaN(parsed.getTime())) {
      return { success: false as const, error: "Invalid expiration date" };
    }
    expiresAt = parsed;
  }

  try {
    const accessGrant = getAccessGrantDelegate();
    const accessAuditLog = getAccessAuditLogDelegate();
    if (!accessGrant || !accessAuditLog) {
      return { success: false as const, error: "Access control schema is not initialized in the current server runtime" };
    }

    const [subjectUser, scopedProject] = await Promise.all([
      prisma.user.findUnique({
        where: { id: subjectUserId },
        select: { id: true },
      }),
      scopeType === "project" && scopeId
        ? prisma.project.findUnique({
          where: { id: scopeId },
          select: { id: true },
        })
        : Promise.resolve(null),
    ]);

    if (!subjectUser) {
      return { success: false as const, error: "Subject user not found" };
    }
    if (scopeType === "project" && scopeId && !scopedProject) {
      return { success: false as const, error: "Project not found" };
    }

    const existingGrant = await accessGrant.findFirst({
      where: {
        subjectUserId,
        scopeType,
        scopeId,
        sourcePresetKey: input.sourcePresetKey ?? null,
        customLabel: input.customLabel?.trim() || null,
        capabilities: { equals: capabilities },
        revokedAt: null,
        OR: [
          { expiresAt: null },
          { expiresAt: { gt: new Date() } },
        ],
      },
      select: { id: true },
    });
    if (existingGrant) {
      return { success: false as const, error: "An identical active grant already exists" };
    }

    const created = await prisma.$transaction(async (tx) => {
      const grant = await tx.accessGrant.create({
        data: {
          subjectUserId,
          scopeType,
          scopeId,
          sourcePresetKey: input.sourcePresetKey ?? null,
          sourceKind: "manual",
          customLabel: input.customLabel?.trim() || null,
          capabilities,
          grantedById: authz.actorUserId,
          reason: input.reason?.trim() || null,
          expiresAt,
        },
        select: {
          id: true,
          scopeType: true,
          scopeId: true,
        },
      });

      await tx.accessAuditLog.create({
        data: {
          action: "grant_created",
          actorUserId: authz.actorUserId,
          subjectUserId,
          scopeType,
          scopeId,
          sourcePresetKey: input.sourcePresetKey ?? null,
          sourceKind: "manual",
          previousCapabilities: [],
          nextCapabilities: capabilities,
          note: input.reason?.trim() || null,
        },
      });

      return grant;
    });

    revalidateAccessPaths(created.scopeType as AccessScopeType, created.scopeId);
    return { success: true as const, grantId: created.id };
  } catch (error) {
    console.error("createAccessGrant error:", error);
    return { success: false as const, error: "Failed to create access grant" };
  }
}

export async function createAccessGrant(input: CreateAccessGrantInput) {
  const authz = await requireAccessAdmin();
  if (!authz.authorized) {
    return { success: false as const, error: authz.error };
  }

  return createAccessGrantWithAuthz(input, authz);
}

export async function createProjectAccessGrant(
  projectId: string,
  input: CreateProjectAccessGrantInput,
) {
  const access = await requireProjectCapability(projectId, "project.access.manage");
  if (!access.authorized) {
    return { success: false as const, error: access.error };
  }

  const preset = ACCESS_PRESET_DEFINITIONS[input.sourcePresetKey];
  if (!preset || preset.scopeType !== "project") {
    return { success: false as const, error: "Only project-scoped presets can be granted here" };
  }

  return createAccessGrantWithAuthz({
    subjectUserId: input.subjectUserId,
    scopeType: "project",
    scopeId: projectId,
    sourcePresetKey: input.sourcePresetKey,
    expiresAt: input.expiresAt,
    reason: input.reason,
  }, {
    actorUserId: access.session?.user?.id ?? null,
  });
}

async function revokeAccessGrantWithAuthz(
  grantId: string,
  authz: AccessGrantAuthz,
  note?: string | null,
  expectedScope?: { scopeType: AccessScopeType; scopeId: string | null },
) {
  if (!grantId.trim()) {
    return { success: false as const, error: "Grant id is required" };
  }

  try {
    const accessGrant = getAccessGrantDelegate();
    if (!accessGrant) {
      return { success: false as const, error: "Access control schema is not initialized in the current server runtime" };
    }

    const grant = await accessGrant.findUnique({
      where: { id: grantId },
      select: {
        id: true,
        subjectUserId: true,
        scopeType: true,
        scopeId: true,
        sourcePresetKey: true,
        sourceKind: true,
        capabilities: true,
        revokedAt: true,
      },
    });

    if (!grant) {
      return { success: false as const, error: "Grant not found" };
    }
    if (grant.revokedAt) {
      return { success: false as const, error: "Grant is already revoked" };
    }
    if (
      expectedScope
      && (
        grant.scopeType !== expectedScope.scopeType
        || (grant.scopeId ?? null) !== expectedScope.scopeId
      )
    ) {
      return { success: false as const, error: "Grant is outside this project" };
    }

    await prisma.$transaction(async (tx) => {
      await tx.accessGrant.update({
        where: { id: grantId },
        data: {
          revokedAt: new Date(),
        },
      });

      await tx.accessAuditLog.create({
        data: {
          action: "grant_revoked",
          actorUserId: authz.actorUserId,
          subjectUserId: grant.subjectUserId,
          scopeType: grant.scopeType,
          scopeId: grant.scopeId,
          sourcePresetKey: grant.sourcePresetKey,
          sourceKind: grant.sourceKind,
          previousCapabilities: grant.capabilities,
          nextCapabilities: [],
          note: note?.trim() || null,
        },
      });
    });

    revalidateAccessPaths(grant.scopeType as AccessScopeType, grant.scopeId);
    return { success: true as const };
  } catch (error) {
    console.error("revokeAccessGrant error:", error);
    return { success: false as const, error: "Failed to revoke access grant" };
  }
}

export async function revokeAccessGrant(grantId: string, note?: string | null) {
  const authz = await requireAccessAdmin();
  if (!authz.authorized) {
    return { success: false as const, error: authz.error };
  }

  return revokeAccessGrantWithAuthz(grantId, authz, note);
}

export async function revokeProjectAccessGrant(
  projectId: string,
  grantId: string,
  note?: string | null,
) {
  const access = await requireProjectCapability(projectId, "project.access.manage");
  if (!access.authorized) {
    return { success: false as const, error: access.error };
  }

  return revokeAccessGrantWithAuthz(
    grantId,
    { actorUserId: access.session?.user?.id ?? null },
    note,
    { scopeType: "project", scopeId: projectId },
  );
}
