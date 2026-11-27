"use server";

import { auth } from "@/lib/auth";
import { hasE2EAdminBypass } from "@/lib/e2e-auth-bypass";
import { prisma } from "@/lib/prisma";
import { enforceRequiredProjectBudget } from "@/lib/project-budget";
import { revalidatePath } from "next/cache";
import { applyStateChange, requirePrimaryComponentRow } from "@/lib/project-state-effects";
import { requireProjectCapability } from "@/lib/project-access";
import { notifyProjectChanged, notifyProjectEvent } from "@/lib/progress-bus";
import { getLoopActionBlockMessage, getProjectLoopSupport } from "@/lib/loop-support";
import {
  TG_SPEC_TARGET_AWAITING_FIRST_IMPORT_MESSAGE,
  isAwaitingFirstTgSpecImport,
} from "@/lib/tg-spec-target";
import { resolvePlatformAccess } from "@/lib/platform-access";
import { enforceUserLaunchPolicy } from "@/lib/user-launch-policy";
import { INTERNAL_ACTION_TOKEN, requireInternalActionToken } from "@/lib/internal-action-token";

type ActionResult = { success: boolean; error?: string };

function revalidateRuntimeControlSurfaces(projectId: string): void {
  revalidatePath("/admin");
  revalidatePath("/my");
  revalidatePath(`/my/projects/${projectId}`);
  revalidatePath(`/projects/${projectId}`);
}

/**
 * RA-247: Set agentIntent on a project's primary component.
 * ON = agent loop runs. OFF = agent loop stops (preview stays).
 *
 * Goes through applyStateChange for full audit trail + ownership validation.
 */
export async function setAgentIntentInternal(
  projectId: string,
  intent: "ON" | "OFF",
  internalActionToken?: unknown,
): Promise<ActionResult> {
  const internalGuard = requireInternalActionToken(internalActionToken);
  if (internalGuard) return internalGuard;

  try {
    const row = await requirePrimaryComponentRow(prisma, projectId);

    if (intent === "ON") {
      if (isAwaitingFirstTgSpecImport(row.sourceConfig, row.tgSpecLastImportedVersion)) {
        return { success: false, error: TG_SPEC_TARGET_AWAITING_FIRST_IMPORT_MESSAGE };
      }

      const loopSupport = await getProjectLoopSupport(prisma as any, projectId);
      const blockMessage = loopSupport ? getLoopActionBlockMessage(loopSupport, "agent_on") : null;
      if (blockMessage) {
        return { success: false, error: blockMessage };
      }
    }

    // Noop if already at desired intent
    if (row.agentIntent === intent) {
      return { success: true };
    }

    const ctx = {
      source: "admin" as const,
      trigger: intent === "ON" ? "agent_on" : "agent_off",
      reason: `user set agentIntent=${intent}`,
    };

    if (intent === "ON") {
      await prisma.$transaction(async (tx) => {
        await tx.project.update({
          where: { id: projectId },
          data: {
            progressJson: null,
          },
        });

        await applyStateChange(tx, projectId, { type: "agentIntent", intent }, ctx);
      });
    } else {
      await applyStateChange(prisma, projectId, { type: "agentIntent", intent }, ctx);
    }

    revalidateRuntimeControlSurfaces(projectId);
    notifyProjectChanged(projectId);
    notifyProjectEvent(projectId, {
      type: "project_event",
      status: intent === "ON" ? "AGENT_ON" : "AGENT_OFF",
    });
    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Unknown error" };
  }
}

export async function setAgentIntent(
  projectId: string,
  intent: "ON" | "OFF",
): Promise<ActionResult> {
  const access = await requireProjectCapability(projectId, "project.runtime.manage");
  if (!access.authorized) return { success: false, error: access.error };

  if (intent === "ON") {
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: {
        ownerScopeType: true,
        ownerScopeId: true,
        agent: true,
        agentImpl: true,
        runnerBackend: true,
        providerBillingMode: true,
      },
    });
    if (project?.ownerScopeType === "user") {
      const [session, hasBypass] = await Promise.all([auth(), hasE2EAdminBypass()]);
      const platformAccess = await resolvePlatformAccess(session, hasBypass);
      const privileged =
        platformAccess.hasCapability("platform.projects.manage")
        || platformAccess.hasCapability("platform.runtime.manage");
      const policy = await enforceUserLaunchPolicy({
        userId: project.ownerScopeId,
        privileged,
        agent: project.agent,
        agentImpl: project.agentImpl,
        runnerBackend: project.runnerBackend,
        providerBillingMode: project.providerBillingMode,
      });
      if (!policy.allowed) {
        return { success: false, error: policy.error };
      }
      if (project.providerBillingMode === "platform_credits") {
        const budgetGuard = await enforceRequiredProjectBudget(projectId);
        if (!budgetGuard.allowed) {
          return { success: false, error: budgetGuard.error ?? "Insufficient project budget." };
        }
      }
    }
  }

  return setAgentIntentInternal(projectId, intent, INTERNAL_ACTION_TOKEN);
}
