"use server";

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { notifyProjectChanged } from "@/lib/progress-bus";
import { hasLegacyAgentProjectRecipe } from "@/lib/tg-spec-target";
import { requireInternalActionToken } from "@/lib/internal-action-token";

type NormalizeSourceConfigResult =
  | { success: true; normalized: true; projectId: string; message: string }
  | { success: true; normalized: false; projectId: string; message: string }
  | { success: false; error: string };

export async function normalizeLegacySourceConfigRecipeInternal(
  projectId: string,
  internalActionToken?: unknown,
): Promise<NormalizeSourceConfigResult> {
  const internalGuard = requireInternalActionToken(internalActionToken);
  if (internalGuard) return internalGuard;

  try {
    const [project, component] = await Promise.all([
      prisma.project.findUnique({
        where: { id: projectId },
        select: { id: true },
      }),
      prisma.projectComponent.findFirst({
        where: {
          projectId,
          kind: "app",
        },
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          sourceConfig: true,
        },
      }),
    ]);

    if (!project) {
      return { success: false, error: "Project not found" };
    }

    if (!component) {
      return { success: false, error: "Project has no primary component" };
    }

    const sourceConfig = component.sourceConfig;
    if (!sourceConfig || typeof sourceConfig !== "object" || Array.isArray(sourceConfig)) {
      return { success: false, error: "Primary component sourceConfig is not an object" };
    }

    const current = sourceConfig as Record<string, unknown>;
    if (!Object.prototype.hasOwnProperty.call(current, "recipe")) {
      return {
        success: true,
        normalized: false,
        projectId,
        message: "Primary component sourceConfig already uses the non-legacy shape",
      };
    }

    if (!hasLegacyAgentProjectRecipe(current)) {
      return {
        success: true,
        normalized: false,
        projectId,
        message: "Primary component sourceConfig recipe is a live contract and must be preserved",
      };
    }

    const normalized = { ...current };
    delete normalized.recipe;

    await prisma.projectComponent.update({
      where: { id: component.id },
      data: { sourceConfig: normalized as Prisma.InputJsonValue },
    });

    await prisma.runLog.create({
      data: {
        projectId,
        event: "SOURCE_CONFIG_NORMALIZED",
        detail: JSON.stringify({
          source: "admin",
          trigger: "normalize_legacy_source_config_recipe",
          reason: "Remove only the legacy recipe key from the primary component sourceConfig",
          componentId: component.id,
          removedKey: "recipe",
          removedValue: current.recipe ?? null,
          beforeKeys: Object.keys(current),
          afterKeys: Object.keys(normalized),
          error: null,
        }),
      },
    });

    revalidatePath("/admin");
    revalidatePath(`/projects/${projectId}`);
    revalidatePath(`/my/projects/${projectId}`);
    notifyProjectChanged(projectId);

    return {
      success: true,
      normalized: true,
      projectId,
      message: "Removed legacy recipe from primary component sourceConfig",
    };
  } catch (error) {
    console.error("Normalize legacy sourceConfig.recipe error:", error);
    return { success: false, error: "Failed to normalize legacy sourceConfig.recipe" };
  }
}
