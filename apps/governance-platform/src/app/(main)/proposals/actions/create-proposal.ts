"use server";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { getCurrentPhase } from "@/lib/seasons";

export interface CreateProposalInput {
  title: string;
  description: string;
  spec: string;
}

export interface CreateProposalResult {
  success: boolean;
  error?: string;
  proposalId?: string;
}

export async function createProposal(
  input: CreateProposalInput
): Promise<CreateProposalResult> {
  // Validate user is authenticated
  const session = await auth();
  if (!session?.user?.id) {
    return {
      success: false,
      error: "You must be signed in to create a proposal",
    };
  }

  // Validate input
  const { title, description, spec } = input;

  if (!title?.trim()) {
    return {
      success: false,
      error: "Title is required",
    };
  }

  if (!description?.trim()) {
    return {
      success: false,
      error: "Description is required",
    };
  }

  if (!spec?.trim()) {
    return {
      success: false,
      error: "Spec is required",
    };
  }

  // Ensure user exists in DB (may be missing after DB reset while JWT persists)
  const userExists = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { id: true },
  });

  // Auto-bind to active season in Open phase (RA-005)
  const activeSeasons = await prisma.season.findMany({
    where: { status: "ACTIVE" },
    select: {
      id: true,
      status: true,
      submissionStart: true,
      buildStart: true,
      buildDeadline: true,
    },
  });
  // Only bind if the season is currently in Open phase (accepting ideas + votes)
  const activeSeason = activeSeasons.find((s) => getCurrentPhase(s) === "Open");

  // Create proposal with PROPOSED status
  try {
    const proposal = await prisma.proposal.create({
      data: {
        title: title.trim(),
        description: description.trim(),
        spec: spec.trim(),
        status: "PROPOSED",
        createdById: userExists ? session.user.id : null,
        seasonId: activeSeason?.id ?? null,
      },
    });

    return {
      success: true,
      proposalId: proposal.id,
    };
  } catch (error) {
    console.error("Failed to create proposal:", error);
    return {
      success: false,
      error: "Failed to create proposal. Please try again.",
    };
  }
}

export async function createProposalAndRedirect(
  input: CreateProposalInput
): Promise<void> {
  const result = await createProposal(input);

  if (result.success) {
    redirect("/");
  }
}
