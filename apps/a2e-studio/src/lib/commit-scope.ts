export type CommitScopeEntry = {
  sha: string;
  shortSha: string;
};

export type CommitBlock<T extends CommitScopeEntry = CommitScopeEntry> = {
  headSha: string;
  headShortSha: string;
  baseSha: string;
  baseShortSha: string;
  commitCount: number;
  commits: T[];
};

export function buildCommitBlocksFromSelection<T extends CommitScopeEntry>(
  selectedCommitShas: string[],
  recentCommits: T[],
) {
  const selected = new Set(selectedCommitShas);
  const blocks: CommitBlock<T>[] = [];
  let current: T[] = [];

  for (const commit of recentCommits) {
    if (selected.has(commit.sha)) {
      current.push(commit);
      continue;
    }
    if (current.length > 0) {
      blocks.push({
        headSha: current[0].sha,
        headShortSha: current[0].shortSha,
        baseSha: current[current.length - 1].sha,
        baseShortSha: current[current.length - 1].shortSha,
        commitCount: current.length,
        commits: current,
      });
      current = [];
    }
  }

  if (current.length > 0) {
    blocks.push({
      headSha: current[0].sha,
      headShortSha: current[0].shortSha,
      baseSha: current[current.length - 1].sha,
      baseShortSha: current[current.length - 1].shortSha,
      commitCount: current.length,
      commits: current,
    });
  }

  return blocks;
}

export function formatCommitScopeSummary(blocks: Pick<CommitBlock, "baseShortSha" | "headShortSha" | "commitCount">[]) {
  if (blocks.length === 0) return "No commits selected";
  if (blocks.length === 1) {
    const block = blocks[0];
    if (block.commitCount === 1) return `${block.headShortSha} (1 commit)`;
    return `${block.baseShortSha}..${block.headShortSha} (${block.commitCount} commits)`;
  }
  const commitCount = blocks.reduce((total, block) => total + block.commitCount, 0);
  return `${commitCount} commits across ${blocks.length} blocks`;
}
