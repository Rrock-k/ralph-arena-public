// Mock server actions for Storybook

export async function toggleVote(_proposalId: string) {
  return { success: true, voteCount: 1, hasVoted: true };
}

export async function launchProposal(
  _proposalId: string,
  _opts?: { agent?: string; agentImpl?: string }
) {
  return { success: true };
}

export async function archiveProposal(_proposalId: string) {
  return { success: true };
}

export async function unarchiveProposal(_proposalId: string) {
  return { success: true };
}

export async function cancelRun(_runId: string) {
  return { success: true };
}
