"use server";

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { createProjectFromProposal } from "@/lib/launch-utils";
import { progressBus } from "@/lib/progress-bus";
import { requirePlatformCapability } from "@/lib/platform-access";
import { notify } from "@/lib/notifications";

type TransactionClient = Prisma.TransactionClient;

/**
 * Approve a proposal in a moderated season.
 * PENDING_REVIEW → APPROVED.
 * When enough proposals are approved (>= maxWinners), finalize:
 *   all APPROVED → WINNER, remaining PENDING_REVIEW → NOT_SELECTED.
 *   Auto-launch winners × buildConfigs.
 */
export async function approveProposal(proposalId: string) {
  const access = await requirePlatformCapability("platform.governance.manage");
  if (!access.authorized) {
    return { success: false, error: access.error };
  }

  try {
    const result = await prisma.$transaction(async (tx: TransactionClient) => {
      const proposal = await tx.proposal.findUnique({
        where: { id: proposalId },
        include: { season: { include: { buildConfigs: { orderBy: { order: "asc" } } } } },
      });

      if (!proposal) throw new Error("Proposal not found");
      if (proposal.status !== "PENDING_REVIEW") {
        throw new Error(`Cannot approve proposal with status ${proposal.status}`);
      }
      if (!proposal.season) throw new Error("Proposal has no season");

      await tx.proposal.update({
        where: { id: proposalId },
        data: { status: "APPROVED" },
      });

      // Check if we've reached maxWinners approved
      const approvedCount = await tx.proposal.count({
        where: {
          seasonId: proposal.seasonId,
          status: "APPROVED",
          archivedAt: null,
        },
      });

      // +1 because the current update hasn't committed yet in count — actually updateMany already ran
      // approvedCount already includes the one we just updated
      if (approvedCount >= proposal.season.maxWinners) {
        // Finalize: APPROVED → WINNER, remaining PENDING_REVIEW → NOT_SELECTED
        await tx.proposal.updateMany({
          where: { seasonId: proposal.seasonId, status: "APPROVED", archivedAt: null },
          data: { status: "WINNER" },
        });
        await tx.proposal.updateMany({
          where: { seasonId: proposal.seasonId, status: "PENDING_REVIEW", archivedAt: null },
          data: { status: "NOT_SELECTED" },
        });

        // Auto-launch winners × buildConfigs
        const winners = await tx.proposal.findMany({
          where: { seasonId: proposal.seasonId, status: "WINNER", archivedAt: null },
        });

        let projectsCreated = 0;
        for (const winner of winners) {
          for (const bc of proposal.season.buildConfigs) {
            await createProjectFromProposal(
              tx,
              { id: winner.id, spec: winner.spec },
              { agent: bc.agent, agentImpl: bc.agentImpl, model: bc.model },
              { createdById: access.session?.user?.id ?? undefined },
            );
            projectsCreated++;
          }
        }

        return {
          finalized: true,
          projectsCreated,
          winnerProposals: winners.map((w) => ({ id: w.id, title: w.title })),
        };
      }

      return { finalized: false, projectsCreated: 0, winnerProposals: [] as { id: string; title: string }[] };
    });

    revalidatePath("/");
    revalidatePath("/admin");

    if (result.projectsCreated > 0) progressBus.notifyChanged();

    // RA-224: Notify proposal creators about approval
    if (result.finalized) {
      for (const winner of result.winnerProposals) {
        notify({
          type: "proposal.approved",
          proposalId: winner.id,
          proposalTitle: winner.title || "Untitled Proposal",
        }).catch((err) =>
          console.error("[notifications] proposal approved notify error:", err),
        );
      }
    }

    return { success: true, ...result };
  } catch (error: any) {
    console.error("Approve proposal error:", error);
    return { success: false, error: "Failed to approve proposal" };
  }
}

/**
 * Reject a proposal in a moderated season.
 * PENDING_REVIEW → REJECTED.
 */
export async function rejectProposal(proposalId: string) {
  const access = await requirePlatformCapability("platform.governance.manage");
  if (!access.authorized) {
    return { success: false, error: access.error };
  }

  try {
    const proposal = await prisma.proposal.findUnique({
      where: { id: proposalId },
    });

    if (!proposal) return { success: false, error: "Proposal not found" };
    if (proposal.status !== "PENDING_REVIEW") {
      return { success: false, error: `Cannot reject proposal with status ${proposal.status}` };
    }

    await prisma.proposal.update({
      where: { id: proposalId },
      data: { status: "REJECTED" },
    });

    revalidatePath("/");
    revalidatePath("/admin");

    return { success: true };
  } catch (error: any) {
    console.error("Reject proposal error:", error);
    return { success: false, error: "Failed to reject proposal" };
  }
}
