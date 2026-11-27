"use server";

import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { notifyProjectChanged, progressBus } from "@/lib/progress-bus";
import { getProjectProposalPath } from "@/lib/project-identity";
import { requireProjectCapability } from "@/lib/project-access";
import { requirePlatformCapability } from "@/lib/platform-access";
import { applyStateChange, requirePrimaryComponentRow } from "@/lib/project-state-effects";
import { INTERNAL_ACTION_TOKEN, requireInternalActionToken } from "@/lib/internal-action-token";

type ActionResult = { success: boolean; error?: string };

function revalidateProjectSurface(
  projectId: string,
  project: { proposalId?: string | null; proposal?: { id: string } | null } | null,
) {
  revalidatePath("/");
  revalidatePath("/explore");
  revalidatePath("/my");
  revalidatePath("/admin");

  if (project) {
    const proposalPath = getProjectProposalPath(project);
    if (proposalPath) revalidatePath(proposalPath);
  }
  notifyProjectChanged(projectId);
}

export async function archiveProposal(proposalId: string) {
  const access = await requirePlatformCapability("platform.governance.manage");
  if (!access.authorized) {
    return { success: false, error: access.error };
  }

  try {
    await prisma.proposal.update({
      where: { id: proposalId },
      data: { archivedAt: new Date() },
    });

    revalidatePath("/");
    revalidatePath("/admin");
    revalidatePath(`/proposals/${proposalId}`);
    progressBus.notifyChanged();
    return { success: true };
  } catch (error) {
    console.error("Archive error:", error);
    return { success: false, error: "Failed to archive proposal" };
  }
}

/**
 * RA-247: Archive project. Project-level lifecycle only.
 * Archive forces app power OFF and agent intent OFF.
 */
export async function archiveProjectInternal(projectId: string, internalActionToken?: unknown): Promise<ActionResult> {
  const internalGuard = requireInternalActionToken(internalActionToken);
  if (internalGuard) return internalGuard;

  try {
    const row = await requirePrimaryComponentRow(prisma, projectId);
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { proposalId: true, proposal: { select: { id: true } } },
    });

    const ctx = { source: "admin" as const, trigger: "archive", reason: "user archive" };
    const shouldArchiveProject = row.archivedAt == null;
    const shouldForceAgentOff = row.agentIntent !== "OFF";
    const shouldForcePowerOff = row.powerIntent !== "OFF";

    if (!shouldArchiveProject && !shouldForceAgentOff && !shouldForcePowerOff) {
      return { success: true };
    }

    await prisma.$transaction(async (tx) => {
      if (shouldArchiveProject) {
        await tx.project.update({
          where: { id: projectId },
          data: {
            archivedAt: new Date(),
          },
        });
      }

      if (shouldForceAgentOff) {
        await applyStateChange(tx, projectId, { type: "agentIntent", intent: "OFF" }, ctx);
      }

      if (shouldForcePowerOff) {
        await applyStateChange(tx, projectId, { type: "power", intent: "OFF", force: true }, ctx);
      }
    });

    revalidateProjectSurface(projectId, project);
    return { success: true };
  } catch (error) {
    console.error("Archive project error:", error);
    return { success: false, error: "Failed to archive project" };
  }
}

export async function archiveProject(projectId: string): Promise<ActionResult> {
  const access = await requireProjectCapability(projectId, "project.runtime.manage");
  if (!access.authorized) return { success: false, error: access.error };

  return archiveProjectInternal(projectId, INTERNAL_ACTION_TOKEN);
}

/**
 * RA-237: Unarchive project. Sets archivedAt=null.
 * Does NOT auto-turn-on — user must explicitly turn the app ON after unarchive.
 */
export async function unarchiveProjectInternal(projectId: string, internalActionToken?: unknown): Promise<ActionResult> {
  const internalGuard = requireInternalActionToken(internalActionToken);
  if (internalGuard) return internalGuard;

  try {
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { proposalId: true, proposal: { select: { id: true } } },
    });
    if (!project) {
      return { success: false, error: "Project not found" };
    }

    await prisma.project.update({
      where: { id: projectId },
      data: {
        archivedAt: null,
      },
    });

    revalidateProjectSurface(projectId, project);
    return { success: true };
  } catch (error) {
    console.error("Unarchive project error:", error);
    return { success: false, error: "Failed to unarchive project" };
  }
}

export async function unarchiveProject(projectId: string): Promise<ActionResult> {
  const access = await requireProjectCapability(projectId, "project.runtime.manage");
  if (!access.authorized) return { success: false, error: access.error };

  return unarchiveProjectInternal(projectId, INTERNAL_ACTION_TOKEN);
}

export async function unarchiveProposal(proposalId: string) {
  const access = await requirePlatformCapability("platform.governance.manage");
  if (!access.authorized) {
    return { success: false, error: access.error };
  }

  try {
    await prisma.proposal.update({
      where: { id: proposalId },
      data: { archivedAt: null },
    });

    revalidatePath("/");
    revalidatePath("/admin");
    revalidatePath(`/proposals/${proposalId}`);
    progressBus.notifyChanged();
    return { success: true };
  } catch (error) {
    console.error("Unarchive error:", error);
    return { success: false, error: "Failed to unarchive proposal" };
  }
}
