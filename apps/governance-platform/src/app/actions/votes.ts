"use server";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { fail, userError } from "@/lib/errors";

import type { ToggleVoteResult } from "@/lib/action-types";

export async function toggleVote(proposalId: string): Promise<ToggleVoteResult> {
  const session = await auth();
  if (!session?.user?.id) {
    return fail("E-AUTH-001");
  }

  const userId = session.user.id;

  try {
    // Verify user exists in DB (stale JWT after DB reset → user missing)
    const dbUser = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true },
    });
    if (!dbUser) {
      return fail("E-AUTH-003", { userId });
    }

    const proposal = await (prisma as any).proposal.findUnique({
      where: { id: proposalId },
      select: {
        id: true,
        seasonId: true,
        season: {
          select: {
            status: true,
            buildStart: true,
          },
        },
        projects: {
          where: { status: "DEPLOYED" },
          select: { id: true },
          take: 1,
        },
      },
    });

    if (!proposal) {
      return fail("E-VOTE-001", { proposalId });
    }

    if (proposal.projects?.length > 0) {
      return fail("E-VOTE-002", { proposalId });
    }

    // RA-005: enforce Open phase (voting blocked during Build)
    if (proposal.seasonId && proposal.season) {
      const { season } = proposal;
      if (season.status !== "ACTIVE") {
        return fail("E-VOTE-003", { proposalId, seasonStatus: season.status });
      }
      if (season.buildStart && new Date() >= new Date(season.buildStart)) {
        return fail("E-VOTE-004", { proposalId });
      }
    }

    // Toggle vote
    const existingVote = await prisma.vote.findUnique({
      where: { userId_proposalId: { userId, proposalId } },
    });

    if (existingVote) {
      await prisma.vote.delete({ where: { id: existingVote.id } });
      const voteCount = await prisma.vote.count({ where: { proposalId } });
      return { success: true, hasVoted: false, voteCount };
    } else {
      await prisma.vote.create({ data: { userId, proposalId } });
      const voteCount = await prisma.vote.count({ where: { proposalId } });
      return { success: true, hasVoted: true, voteCount };
    }
  } catch (error) {
    return fail("E-VOTE-005", { userId, proposalId }, error);
  }
}

export async function getVoteStatus(
  proposalId: string
): Promise<{ hasVoted: boolean; voteCount: number } | null> {
  const session = await auth();

  try {
    const voteCount = await prisma.vote.count({ where: { proposalId } });

    let hasVoted = false;
    if (session?.user?.id) {
      const existingVote = await prisma.vote.findUnique({
        where: {
          userId_proposalId: {
            userId: session.user.id,
            proposalId,
          },
        },
      });
      hasVoted = !!existingVote;
    }

    return { hasVoted, voteCount };
  } catch (error) {
    console.error("Failed to get vote status:", error);
    return null;
  }
}
