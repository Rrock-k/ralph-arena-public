export function mapVoteErrorForPublic(error?: string): string {
  if (!error) return "Failed to update vote. Please try again.";

  if (error.includes("E-AUTH-001")) return "Sign in to vote.";
  if (error.includes("E-VOTE-001")) return "This proposal is no longer available.";
  if (error.includes("E-VOTE-002")) return "Voting is closed for this proposal.";
  if (error.includes("E-VOTE-003") || error.includes("E-VOTE-004")) {
    return "Voting is currently closed for this season.";
  }

  return "Failed to update vote. Please try again.";
}

export function mapCreateProposalErrorForPublic(error?: string): string {
  if (!error) return "Could not submit your idea. Please try again.";

  if (
    error === "Title is required" ||
    error === "Description is required" ||
    error === "Spec is required" ||
    error === "You must be signed in to create a proposal"
  ) {
    return error;
  }

  return "Could not submit your idea. Please try again.";
}
