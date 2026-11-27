import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { createProjectFromProposal } from "@/lib/launch-utils";

type TransactionClient = Prisma.TransactionClient;

export type TransitionResult = {
  winnersCount: number;
  projectsCreated: number;
  notSelectedCount: number;
  winnerProposals: { id: string; title: string }[];
};

/**
 * Process the Open → Build transition for a season.
 *
 * Unmoderated: top-N proposals by votes become WINNERs, rest become NOT_SELECTED.
 * Winners × BuildConfigs = auto-launched Projects.
 *
 * Moderated: all proposals move to PENDING_REVIEW for admin triage.
 *
 * Idempotent: guarded by `buildTransitionedAt`.
 */
export async function processOpenToBuildTransition(seasonId: string): Promise<TransitionResult> {
  return prisma.$transaction(async (tx: TransactionClient) => {
    const season = await tx.season.findUnique({
      where: { id: seasonId },
      include: {
        buildConfigs: { orderBy: { order: "asc" } },
        proposals: {
          where: { archivedAt: null, status: "PROPOSED" },
          include: { _count: { select: { votes: true } } },
        },
      },
    });

    if (!season) throw new Error(`Season ${seasonId} not found`);
    if (season.buildTransitionedAt) {
      return { winnersCount: 0, projectsCreated: 0, notSelectedCount: 0, winnerProposals: [] };
    }

    // --- Moderated path: all proposals → PENDING_REVIEW ---
    if (season.requiresModeration) {
      const proposalIds = season.proposals.map((p: any) => p.id);
      if (proposalIds.length > 0) {
        await tx.proposal.updateMany({
          where: { id: { in: proposalIds } },
          data: { status: "PENDING_REVIEW" },
        });
      }
      await tx.season.update({
        where: { id: seasonId },
        data: { buildTransitionedAt: new Date() },
      });
      return { winnersCount: 0, projectsCreated: 0, notSelectedCount: proposalIds.length, winnerProposals: [] };
    }

    // --- Unmoderated path: auto-select winners ---
    // Sort by votes desc, tiebreak by createdAt asc (earlier proposal wins)
    const sorted = [...season.proposals].sort((a: any, b: any) => {
      const diff = b._count.votes - a._count.votes;
      if (diff !== 0) return diff;
      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    });

    const maxWinners = season.maxWinners ?? 3;
    const winners = sorted.slice(0, maxWinners);
    const notSelected = sorted.slice(maxWinners);

    // Mark winners
    if (winners.length > 0) {
      await tx.proposal.updateMany({
        where: { id: { in: winners.map((p: any) => p.id) } },
        data: { status: "WINNER" },
      });
    }

    // Mark not selected
    if (notSelected.length > 0) {
      await tx.proposal.updateMany({
        where: { id: { in: notSelected.map((p: any) => p.id) } },
        data: { status: "NOT_SELECTED" },
      });
    }

    // Auto-launch: winner × buildConfig → Project + Run
    let projectsCreated = 0;
    for (const proposal of winners) {
      for (const bc of season.buildConfigs) {
        await createProjectFromProposal(
          tx,
          { id: proposal.id, title: proposal.title, spec: proposal.spec, createdById: proposal.createdById ?? null },
          { agent: bc.agent, agentImpl: bc.agentImpl, model: bc.model },
        );
        projectsCreated++;
      }
    }

    await tx.season.update({
      where: { id: seasonId },
      data: { buildTransitionedAt: new Date() },
    });

    return {
      winnersCount: winners.length,
      projectsCreated,
      notSelectedCount: notSelected.length,
      winnerProposals: winners.map((p: any) => ({ id: p.id, title: p.title as string })),
    };
  });
}
