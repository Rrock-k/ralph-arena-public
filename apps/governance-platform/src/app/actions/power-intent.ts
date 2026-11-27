"use server";

import { prisma } from "@/lib/prisma";
import { enforceRequiredProjectBudget } from "@/lib/project-budget";
import { revalidatePath } from "next/cache";
import {
  applyStateChange,
  requirePrimaryComponentRow,
  updateComponentMetadata,
} from "@/lib/project-state-effects";
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
 * RA-247: Set powerIntent on a project's primary component.
 * ON = container should exist (worker claims / starts).
 * OFF = container should stop (worker tears down).
 *
 * Replaces legacy sleepProject (OFF) and wakeProject (ON).
 */
export async function setPowerIntentInternal(
  projectId: string,
  intent: "ON" | "OFF",
  internalActionToken?: unknown,
): Promise<ActionResult> {
  const internalGuard = requireInternalActionToken(internalActionToken);
  if (internalGuard) return internalGuard;

  try {
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true, archivedAt: true, commitSha: true },
    });
    if (!project) return { success: false, error: "Project not found" };
    if (project.archivedAt) return { success: false, error: "Project is archived" };

    const row = await requirePrimaryComponentRow(prisma, projectId);
    if (intent === "ON") {
      if (isAwaitingFirstTgSpecImport(row.sourceConfig, row.tgSpecLastImportedVersion)) {
        return { success: false, error: TG_SPEC_TARGET_AWAITING_FIRST_IMPORT_MESSAGE };
      }

      const loopSupport = await getProjectLoopSupport(prisma as any, projectId);
      const blockMessage = loopSupport ? getLoopActionBlockMessage(loopSupport, "power_on") : null;
      if (blockMessage) {
        return { success: false, error: blockMessage };
      }
    }

    const shouldNormalizeAgentOff = intent === "OFF" && row.agentIntent !== "OFF";
    const shouldChangePower = row.powerIntent !== intent;
    const shouldClearStaleInfraOnPowerOn =
      intent === "ON"
      && row.runtimeState !== "RUNNING"
      && row.blockers.includes("INFRA");
    const shouldReopenStartClaimOnPowerOn =
      intent === "ON"
      && row.powerIntent === "ON"
      && row.runtimeState !== "RUNNING"
      && (row.blockers.length === 0 || (row.blockers.length === 1 && row.blockers[0] === "INFRA"))
      && (row.agentState == null || row.agentState === "IDLE");
    const shouldNormalizeParkedAbsentOnPowerOff =
      intent === "OFF"
      && row.agentIntent === "OFF"
      && row.runtimeState === "ABSENT"
      && (
        (row.agentState != null && row.agentState !== "IDLE")
        || row.blockers.length > 0
        || row.retryAt != null
        || row.retryCount !== 0
        || row.previewHealth !== "UNKNOWN"
        || row.previewCheckedAt != null
        || row.provisionedAt != null
        || row.containerName != null
        || row.previewUrl != null
        || row.workerHost != null
        || row.lastHeartbeat != null
      );
    const shouldClearPreviewCommitPinOnPowerOn =
      intent === "ON"
      && row.agentIntent === "OFF"
      && row.runtimeState !== "RUNNING"
      && project.commitSha != null
      && (shouldChangePower || shouldClearStaleInfraOnPowerOn || shouldReopenStartClaimOnPowerOn);

    // Noop only if both power and the implied agent contract already match,
    // and there is no stale recoverable baggage or explicit restart trigger to reopen.
    if (
      !shouldChangePower
      && !shouldNormalizeAgentOff
      && !shouldClearStaleInfraOnPowerOn
      && !shouldReopenStartClaimOnPowerOn
      && !shouldNormalizeParkedAbsentOnPowerOff
      && !shouldClearPreviewCommitPinOnPowerOn
    ) {
      return { success: true };
    }

    const powerCtx = {
      source: "admin" as const,
      trigger: intent === "ON" ? "power_on" : "power_off",
      reason: `user set powerIntent=${intent}`,
    };
    const forcedAgentOffCtx = {
      source: "admin" as const,
      trigger: "power_off_agent_intent",
      reason: "power off forces agentIntent=OFF",
    };
    const clearRecoverableInfraCtx = {
      source: "admin" as const,
      trigger: "power_on_clear_stale_infra",
      reason: "explicit power on clears stale INFRA baggage before restart",
    };
    const reopenStartClaimCtx = {
      source: "admin" as const,
      trigger: "power_on_reopen_start_claim",
      reason: "explicit power on reopens preview/bootstrap start claim for absent idle runtime",
    };
    const normalizeParkedAbsentCtx = {
      source: "system" as const,
      trigger: "power_off_normalize_parked_absent",
      reason: "explicit power off normalizes already-absent parked rows back to IDLE",
    };
    const clearPreviewCommitPinCtx = {
      source: "admin" as const,
      trigger: "power_on_clear_preview_commit_pin",
      reason: "explicit power on refreshes preview-only rows from branch head instead of archived snapshot",
    };

    await prisma.$transaction(async (tx) => {
      if (shouldClearPreviewCommitPinOnPowerOn) {
        await tx.project.update({
          where: { id: projectId },
          data: { commitSha: null },
        });
      }
      if (shouldClearStaleInfraOnPowerOn) {
        await applyStateChange(tx, projectId, { type: "removeBlocker", blocker: "INFRA" }, clearRecoverableInfraCtx);
        await updateComponentMetadata(tx, projectId, {
          retryAt: null,
          retryCount: 0,
          previewHealth: "UNKNOWN",
          previewCheckedAt: null,
        }, clearRecoverableInfraCtx);
      }
      if (shouldReopenStartClaimOnPowerOn && "runtimeIntent" in tx && tx.runtimeIntent) {
        await tx.runtimeIntent.deleteMany({
          where: {
            componentId: row.componentId,
            action: "ensure_running",
            state: { in: ["FAILED", "ABANDONED"] },
          },
        });
        await updateComponentMetadata(tx, projectId, {
          retryAt: null,
          retryCount: 0,
          previewHealth: "UNKNOWN",
          previewCheckedAt: null,
        }, shouldClearPreviewCommitPinOnPowerOn ? clearPreviewCommitPinCtx : reopenStartClaimCtx);
      }
      if (shouldNormalizeAgentOff) {
        await applyStateChange(tx, projectId, { type: "agentIntent", intent: "OFF" }, forcedAgentOffCtx);
      }
      if (shouldChangePower) {
        await applyStateChange(tx, projectId, { type: "power", intent }, powerCtx);
      }
      if (shouldNormalizeParkedAbsentOnPowerOff) {
        for (const blocker of row.blockers) {
          await applyStateChange(tx, projectId, { type: "removeBlocker", blocker }, normalizeParkedAbsentCtx);
        }
        if (row.agentState != null && row.agentState !== "IDLE") {
          await applyStateChange(tx, projectId, { type: "runtimeObserved", state: "ABSENT" }, normalizeParkedAbsentCtx);
        }
        await updateComponentMetadata(tx, projectId, {
          provisionedAt: null,
          retryAt: null,
          retryCount: 0,
          previewHealth: "UNKNOWN",
          previewCheckedAt: null,
          containerName: null,
          previewUrl: null,
          workerHost: null,
          lastHeartbeat: null,
        }, normalizeParkedAbsentCtx);
      } else if (intent === "OFF" && shouldChangePower) {
        await updateComponentMetadata(tx, projectId, {
          previewHealth: "UNKNOWN",
          previewCheckedAt: null,
        }, powerCtx);
      }
    });

    revalidateRuntimeControlSurfaces(projectId);
    notifyProjectChanged(projectId);
    notifyProjectEvent(projectId, {
      type: "project_event",
      status: intent === "ON" ? "POWER_ON" : "POWER_OFF",
    });
    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Unknown error" };
  }
}

export async function setPowerIntent(
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
      const platformAccess = await resolvePlatformAccess(access.session, access.hasBypass);
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

  return setPowerIntentInternal(projectId, intent, INTERNAL_ACTION_TOKEN);
}
