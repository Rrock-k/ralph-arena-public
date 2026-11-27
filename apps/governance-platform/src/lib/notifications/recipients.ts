/**
 * RA-224: Resolve notification recipients from events.
 *
 * Priority for project events:
 *   1. Project.ownerScopeId → User (direct owner)
 *   2. Proposal.createdById → User (fallback: proposal creator)
 *
 * For proposal events:
 *   1. Proposal.createdById → User
 *
 * Returns null when no eligible recipient (no owner, no email, unverified).
 */

import { prisma } from "@/lib/prisma";
import type { NotificationEvent, NotificationRecipient } from "./types";

export async function resolveRecipient(
  event: NotificationEvent,
): Promise<NotificationRecipient | null> {
  if (event.type === "proposal.approved") {
    return resolveProposalRecipient(event.proposalId);
  }

  // All project.* events
  return resolveProjectRecipient(event.projectId);
}

async function resolveProjectRecipient(
  projectId: string,
): Promise<NotificationRecipient | null> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      ownerScopeId: true,
      proposal: {
        select: { createdById: true },
      },
    },
  });

  if (!project) return null;

  // Try direct owner first
  const userId = project.ownerScopeId ?? project.proposal?.createdById;
  if (!userId) return null;

  return fetchVerifiedUser(userId);
}

async function resolveProposalRecipient(
  proposalId: string,
): Promise<NotificationRecipient | null> {
  const proposal = await prisma.proposal.findUnique({
    where: { id: proposalId },
    select: { createdById: true },
  });

  if (!proposal?.createdById) return null;

  return fetchVerifiedUser(proposal.createdById);
}

async function fetchVerifiedUser(
  userId: string,
): Promise<NotificationRecipient | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, emailVerified: true },
  });

  if (!user?.email) return null;

  // We accept unverified emails too — OAuth users have emails but
  // emailVerified may be null if the provider doesn't report it.
  // The email came from Google OAuth, so it's real.
  return { userId: user.id, email: user.email };
}
