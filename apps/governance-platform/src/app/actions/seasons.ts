"use server";

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { requirePlatformCapability } from "@/lib/platform-access";

type TransactionClient = Prisma.TransactionClient;

type SeasonData = {
  title: string;
  description?: string | null;
  submissionStart?: string | null;
  buildStart?: string | null;
  buildDeadline?: string | null;
  maxWinners?: number;
  requiresModeration?: boolean;
  buildConfigs?: BuildConfigInput[];
};

type BuildConfigInput = {
  id?: string; // existing record id (for update); absent = create new
  agent: string;
  agentImpl: string;
  model?: string | null;
  order: number;
};

function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d;
}

export async function createSeason(data: SeasonData) {
  const access = await requirePlatformCapability("platform.governance.manage");
  if (!access.authorized) {
    return { success: false, error: access.error };
  }

  try {
    const season = await prisma.season.create({
      data: {
        title: data.title.trim(),
        description: data.description?.trim() || null,
        status: "DRAFT",
        submissionStart: parseDate(data.submissionStart),
        buildStart: parseDate(data.buildStart),
        buildDeadline: parseDate(data.buildDeadline),
        maxWinners: data.maxWinners ?? 3,
        requiresModeration: data.requiresModeration ?? false,
        buildConfigs: data.buildConfigs?.length
          ? {
              create: data.buildConfigs.map((bc) => ({
                agent: bc.agent,
                agentImpl: bc.agentImpl,
                model: bc.model ?? null,
                order: bc.order,
              })),
            }
          : undefined,
      },
    });

    revalidatePath("/admin");

    return { success: true, seasonId: season.id };
  } catch (error) {
    console.error("Create season error:", error);
    return { success: false, error: "Failed to create season" };
  }
}

export async function updateSeason(id: string, data: SeasonData) {
  const access = await requirePlatformCapability("platform.governance.manage");
  if (!access.authorized) {
    return { success: false, error: access.error };
  }

  try {
    const season = await prisma.season.findUnique({
      where: { id },
      include: { buildConfigs: { select: { id: true } } },
    });
    if (!season) return { success: false, error: "Season not found" };

    await prisma.$transaction(async (tx: TransactionClient) => {
      await tx.season.update({
        where: { id },
        data: {
          title: data.title.trim(),
          description: data.description?.trim() || null,
          submissionStart: parseDate(data.submissionStart),
          buildStart: parseDate(data.buildStart),
          buildDeadline: parseDate(data.buildDeadline),
          maxWinners: data.maxWinners ?? 3,
          requiresModeration: data.requiresModeration ?? false,
        },
      });

      // Sync build configs: delete removed, upsert rest
      if (data.buildConfigs !== undefined) {
        const incomingIds = new Set(data.buildConfigs.filter((bc) => bc.id).map((bc) => bc.id));
        const toDelete = season.buildConfigs.filter((bc) => !incomingIds.has(bc.id));
        if (toDelete.length > 0) {
          await tx.buildConfig.deleteMany({
            where: { id: { in: toDelete.map((bc) => bc.id) } },
          });
        }

        for (const bc of data.buildConfigs) {
          if (bc.id) {
            await tx.buildConfig.update({
              where: { id: bc.id },
              data: { agent: bc.agent, agentImpl: bc.agentImpl, model: bc.model ?? null, order: bc.order },
            });
          } else {
            await tx.buildConfig.create({
              data: { seasonId: id, agent: bc.agent, agentImpl: bc.agentImpl, model: bc.model ?? null, order: bc.order },
            });
          }
        }
      }
    });

    revalidatePath("/admin");

    return { success: true };
  } catch (error) {
    console.error("Update season error:", error);
    return { success: false, error: "Failed to update season" };
  }
}

export async function updateSeasonStatus(id: string, status: string) {
  const access = await requirePlatformCapability("platform.governance.manage");
  if (!access.authorized) {
    return { success: false, error: access.error };
  }

  const validTransitions: Record<string, string[]> = {
    DRAFT: ["ACTIVE"],
    ACTIVE: ["COMPLETED"],
    COMPLETED: ["ARCHIVED"],
    ARCHIVED: [],
  };

  try {
    const season = await prisma.season.findUnique({ where: { id } });
    if (!season) return { success: false, error: "Season not found" };

    const allowed = validTransitions[season.status] || [];
    if (!allowed.includes(status)) {
      return { success: false, error: `Cannot transition from ${season.status} to ${status}` };
    }

    await prisma.season.update({
      where: { id },
      data: { status },
    });

    revalidatePath("/admin");

    revalidatePath("/");
    return { success: true };
  } catch (error) {
    console.error("Update season status error:", error);
    return { success: false, error: "Failed to update season status" };
  }
}

export async function deleteSeason(id: string) {
  const access = await requirePlatformCapability("platform.governance.manage");
  if (!access.authorized) {
    return { success: false, error: access.error };
  }

  try {
    const season = await prisma.season.findUnique({
      where: { id },
      include: { _count: { select: { proposals: true } } },
    });

    if (!season) return { success: false, error: "Season not found" };

    if (season.status !== "DRAFT") {
      return { success: false, error: "Only DRAFT seasons can be deleted" };
    }

    if (season._count.proposals > 0) {
      return { success: false, error: "Cannot delete season with proposals" };
    }

    await prisma.season.delete({ where: { id } });

    revalidatePath("/admin");

    return { success: true };
  } catch (error) {
    console.error("Delete season error:", error);
    return { success: false, error: "Failed to delete season" };
  }
}
