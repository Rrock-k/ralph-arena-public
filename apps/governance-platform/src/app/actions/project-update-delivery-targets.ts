"use server";

import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { requireProjectCapability } from "@/lib/project-access";
import {
  PROJECT_MANAGER_UPDATE_REQUIRED_CAPABILITY,
  PROJECT_UPDATE_DELIVERY_TARGET_KIND,
  PROJECT_UPDATE_DELIVERY_TARGET_SOURCE_SYSTEM,
} from "@/lib/project-update-outbox";
import {
  findTgSpecManagerBindingCandidate,
  listTgSpecManagerBindingCandidates,
  syncTgSpecManagerDeliveryTarget,
} from "@/lib/tg-spec-manager-bindings";

const MANAGER_AUDIENCE = "project_managers";
const MAX_SOURCE_TARGET_ID_LENGTH = 200;
const MAX_TARGET_LABEL_LENGTH = 120;

const SUPPORTED_SOURCE_SYSTEMS = new Set([PROJECT_UPDATE_DELIVERY_TARGET_SOURCE_SYSTEM]);
const SUPPORTED_TARGET_KINDS = new Set([PROJECT_UPDATE_DELIVERY_TARGET_KIND]);

type ActivateProjectUpdateDeliveryTargetInput = {
  sourceSystem?: string | null;
  sourceTargetId?: string | null;
  targetKind?: string | null;
  label?: string | null;
};

function trimOptional(value: string | null | undefined, maxLength: number) {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  return trimmed.slice(0, maxLength);
}

function revalidateProjectDeliveryTargetPaths(projectId: string) {
  revalidatePath(`/projects/${projectId}`);
  revalidatePath(`/my/projects/${projectId}`);
  revalidatePath(`/admin/projects/${projectId}`);
}

async function activateProjectUpdateDeliveryTarget(
  projectId: string,
  input: ActivateProjectUpdateDeliveryTargetInput,
  access: Awaited<ReturnType<typeof requireProjectCapability>>,
) {
  const sourceSystem = trimOptional(input.sourceSystem, 80) ?? PROJECT_UPDATE_DELIVERY_TARGET_SOURCE_SYSTEM;
  if (!SUPPORTED_SOURCE_SYSTEMS.has(sourceSystem)) {
    return { success: false as const, error: "Unsupported delivery source system" };
  }

  const sourceTargetId = trimOptional(input.sourceTargetId, MAX_SOURCE_TARGET_ID_LENGTH);
  if (!sourceTargetId) {
    return { success: false as const, error: "Delivery target reference is required" };
  }

  const targetKind = trimOptional(input.targetKind, 80) ?? PROJECT_UPDATE_DELIVERY_TARGET_KIND;
  if (!SUPPORTED_TARGET_KINDS.has(targetKind)) {
    return { success: false as const, error: "Unsupported delivery target kind" };
  }

  const label = trimOptional(input.label, MAX_TARGET_LABEL_LENGTH);
  const actorUserId = access.session?.user?.id ?? null;
  const now = new Date();

  try {
    const target = await prisma.$transaction(async (tx) => {
      await tx.projectUpdateDeliveryTarget.updateMany({
        where: {
          projectId,
          sourceSystem,
          audience: MANAGER_AUDIENCE,
          status: "ACTIVE",
          sourceTargetId: { not: sourceTargetId },
        },
        data: {
          status: "REVOKED",
          revokedAt: now,
          revokedByUserId: actorUserId,
        },
      });

      return tx.projectUpdateDeliveryTarget.upsert({
        where: {
          projectId_sourceSystem_sourceTargetId_audience: {
            projectId,
            sourceSystem,
            sourceTargetId,
            audience: MANAGER_AUDIENCE,
          },
        },
        create: {
          projectId,
          sourceSystem,
          sourceTargetId,
          targetKind,
          audience: MANAGER_AUDIENCE,
          requiredCapability: PROJECT_MANAGER_UPDATE_REQUIRED_CAPABILITY,
          status: "ACTIVE",
          label,
          createdByUserId: actorUserId,
          activatedByUserId: actorUserId,
          activatedAt: now,
        },
        update: {
          targetKind,
          requiredCapability: PROJECT_MANAGER_UPDATE_REQUIRED_CAPABILITY,
          status: "ACTIVE",
          label,
          activatedByUserId: actorUserId,
          activatedAt: now,
          revokedAt: null,
          revokedByUserId: null,
        },
        select: {
          id: true,
        },
      });
    });

    revalidateProjectDeliveryTargetPaths(projectId);
    return { success: true as const, targetId: target.id };
  } catch (error) {
    console.error("activateProjectUpdateDeliveryTarget error:", error);
    return { success: false as const, error: "Failed to activate delivery target" };
  }
}

export async function activateProjectUpdateDeliveryTargetFromTgSpecBinding(
  projectId: string,
  sourceTargetId: string,
) {
  const access = await requireProjectCapability(projectId, "project.access.manage");
  if (!access.authorized) {
    return { success: false as const, error: access.error };
  }

  const lookup = await listTgSpecManagerBindingCandidates(projectId);
  if (!lookup.configured) {
    return { success: false as const, error: "tg-spec internal bridge is not configured" };
  }
  if (lookup.error) {
    return { success: false as const, error: lookup.error };
  }

  const candidate = findTgSpecManagerBindingCandidate(lookup, sourceTargetId);
  if (!candidate) {
    return { success: false as const, error: "Telegram binding is not bound to this Arena project" };
  }

  const result = await activateProjectUpdateDeliveryTarget(projectId, {
    sourceSystem: PROJECT_UPDATE_DELIVERY_TARGET_SOURCE_SYSTEM,
    sourceTargetId: candidate.sourceTargetId,
    targetKind: candidate.targetKind,
    label: candidate.label,
  }, access);
  if (!result.success) {
    return result;
  }

  const syncResult = await syncTgSpecManagerDeliveryTarget(
    projectId,
    candidate.sourceTargetId,
    result.targetId,
  );
  if (!syncResult.success) {
    return {
      success: false as const,
      error: `Telegram binding sync failed: ${syncResult.error}`,
    };
  }

  return result;
}

export async function revokeProjectUpdateDeliveryTarget(projectId: string, targetId: string) {
  const access = await requireProjectCapability(projectId, "project.access.manage");
  if (!access.authorized) {
    return { success: false as const, error: access.error };
  }

  const normalizedTargetId = targetId.trim();
  if (!normalizedTargetId) {
    return { success: false as const, error: "Delivery target id is required" };
  }

  try {
    const target = await prisma.projectUpdateDeliveryTarget.findFirst({
      where: {
        id: normalizedTargetId,
        projectId,
      },
      select: {
        id: true,
        sourceSystem: true,
        sourceTargetId: true,
        audience: true,
      },
    });

    if (!target) {
      return { success: false as const, error: "Delivery target not found" };
    }

    await prisma.projectUpdateDeliveryTarget.update({
      where: {
        id: target.id,
      },
      data: {
        status: "REVOKED",
        revokedAt: new Date(),
        revokedByUserId: access.session?.user?.id ?? null,
      },
    });

    if (
      target.sourceSystem === PROJECT_UPDATE_DELIVERY_TARGET_SOURCE_SYSTEM &&
      target.audience === MANAGER_AUDIENCE
    ) {
      const syncResult = await syncTgSpecManagerDeliveryTarget(projectId, target.sourceTargetId, null);
      if (!syncResult.success) {
        console.warn("revokeProjectUpdateDeliveryTarget tg-spec sync failed:", syncResult.error);
      }
    }

    revalidateProjectDeliveryTargetPaths(projectId);
    return { success: true as const };
  } catch (error) {
    console.error("revokeProjectUpdateDeliveryTarget error:", error);
    return { success: false as const, error: "Failed to revoke delivery target" };
  }
}
