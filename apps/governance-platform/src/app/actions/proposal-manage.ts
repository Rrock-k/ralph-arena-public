"use server";

import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { progressBus } from "@/lib/progress-bus";
import { requirePlatformCapability } from "@/lib/platform-access";
import { INTERNAL_ACTION_TOKEN, requireInternalActionToken } from "@/lib/internal-action-token";

export async function renameProposal(proposalId: string, newTitle: string) {
  const access = await requirePlatformCapability("platform.governance.manage");
  if (!access.authorized) {
    return { success: false, error: access.error };
  }

  const trimmed = newTitle.trim();
  if (!trimmed) {
    return { success: false, error: "Title cannot be empty" };
  }
  if (trimmed.length > 200) {
    return { success: false, error: "Title must be 200 characters or fewer" };
  }

  try {
    await prisma.proposal.update({
      where: { id: proposalId },
      data: { title: trimmed },
    });

    revalidatePath("/");
    revalidatePath("/admin");

    revalidatePath(`/proposals/${proposalId}`);
    progressBus.notifyChanged();
    return { success: true };
  } catch (error) {
    console.error("Rename proposal error:", error);
    return { success: false, error: "Failed to rename proposal" };
  }
}

const VALID_STATUSES = ["PROPOSED", "PENDING_REVIEW", "APPROVED", "REJECTED", "WINNER", "NOT_SELECTED"];

export async function updateProposal(
  proposalId: string,
  data: {
    title: string;
    description: string;
    spec: string;
    status: string;
    seasonId: string | null;
  },
) {
  const access = await requirePlatformCapability("platform.governance.manage");
  if (!access.authorized) {
    return { success: false, error: access.error };
  }

  const title = data.title.trim();
  if (!title) {
    return { success: false, error: "Title cannot be empty" };
  }
  if (title.length > 200) {
    return { success: false, error: "Title must be 200 characters or fewer" };
  }
  if (!VALID_STATUSES.includes(data.status)) {
    return { success: false, error: `Invalid status: ${data.status}` };
  }

  try {
    // Verify season exists if provided
    if (data.seasonId) {
      const season = await prisma.season.findUnique({ where: { id: data.seasonId } });
      if (!season) {
        return { success: false, error: "Referenced season not found" };
      }
    }

    await prisma.proposal.update({
      where: { id: proposalId },
      data: {
        title,
        description: data.description,
        spec: data.spec,
        status: data.status,
        seasonId: data.seasonId,
      },
    });

    revalidatePath("/");
    revalidatePath("/admin");

    revalidatePath(`/proposals/${proposalId}`);
    progressBus.notifyChanged();
    return { success: true };
  } catch (error) {
    console.error("Update proposal error:", error);
    return { success: false, error: "Failed to update proposal" };
  }
}

export async function deleteProposal(proposalId: string) {
  const access = await requirePlatformCapability("platform.governance.manage");
  if (!access.authorized) {
    return { success: false, error: access.error };
  }

  return deleteProposalInternal(proposalId, INTERNAL_ACTION_TOKEN);
}

export async function deleteProposalInternal(proposalId: string, internalActionToken?: unknown) {
  const internalGuard = requireInternalActionToken(internalActionToken);
  if (internalGuard) return internalGuard;

  try {
    await prisma.proposal.update({
      where: { id: proposalId },
      data: { archivedAt: new Date() },
    });

    revalidatePath("/");
    revalidatePath("/admin");

    progressBus.notifyChanged();
    return { success: true };
  } catch (error) {
    console.error("Delete proposal error:", error);
    return { success: false, error: "Failed to delete proposal" };
  }
}

export async function purgeProposalInternal(proposalId: string, internalActionToken?: unknown) {
  const internalGuard = requireInternalActionToken(internalActionToken);
  if (internalGuard) return internalGuard;

  try {
    await prisma.proposal.delete({
      where: { id: proposalId },
    });

    revalidatePath("/");
    revalidatePath("/admin");

    revalidatePath(`/proposals/${proposalId}`);
    progressBus.notifyChanged();
    return { success: true };
  } catch (error) {
    console.error("Purge proposal error:", error);
    return { success: false, error: "Failed to purge proposal" };
  }
}
