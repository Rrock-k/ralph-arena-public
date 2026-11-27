export type PreviewWorkspaceSnapshot = {
  exists: boolean;
  isGitRepo: boolean;
  originUrl?: string | null;
  branch?: string | null;
  commitSha?: string | null;
};

export type PreviewWorkspaceExpectation = {
  repoUrl?: string | null;
  repoBranch?: string | null;
  projectBranch?: string | null;
  commitSha?: string | null;
};

export type PreviewWorkspaceDecision = {
  reuseExistingWorkspace: boolean;
  reasonCode:
    | "workspace_missing"
    | "no_repo_configured"
    | "workspace_not_git_repo"
    | "origin_mismatch"
    | "branch_mismatch"
    | "commit_mismatch"
    | "workspace_matches_repo";
  reasonMessage: string;
};

export function evaluatePreviewWorkspace(
  snapshot: PreviewWorkspaceSnapshot,
  expected: PreviewWorkspaceExpectation,
): PreviewWorkspaceDecision {
  if (!snapshot.exists) {
    return {
      reuseExistingWorkspace: false,
      reasonCode: "workspace_missing",
      reasonMessage: "workspace is missing or empty",
    };
  }

  if (!expected.repoUrl) {
    return {
      reuseExistingWorkspace: true,
      reasonCode: "no_repo_configured",
      reasonMessage: "no repo configured, keeping existing workspace",
    };
  }

  if (!snapshot.isGitRepo) {
    return {
      reuseExistingWorkspace: false,
      reasonCode: "workspace_not_git_repo",
      reasonMessage: "workspace exists but is not a git repository",
    };
  }

  const currentOrigin = normalizeRepoUrl(snapshot.originUrl);
  const expectedOrigin = normalizeRepoUrl(expected.repoUrl);
  if (!currentOrigin || currentOrigin !== expectedOrigin) {
    return {
      reuseExistingWorkspace: false,
      reasonCode: "origin_mismatch",
      reasonMessage: "workspace origin does not match configured repo",
    };
  }

  if (expected.commitSha) {
    if (snapshot.commitSha !== expected.commitSha) {
      return {
        reuseExistingWorkspace: false,
        reasonCode: "commit_mismatch",
        reasonMessage: "workspace commit does not match archived snapshot",
      };
    }
  } else {
    const preferredBranch = resolvePreviewRestoreBranches(expected)[0] ?? null;
    if (preferredBranch && snapshot.branch !== preferredBranch) {
      return {
        reuseExistingWorkspace: false,
        reasonCode: "branch_mismatch",
        reasonMessage: "workspace branch does not match configured repo branch",
      };
    }
  }

  return {
    reuseExistingWorkspace: true,
    reasonCode: "workspace_matches_repo",
    reasonMessage: "workspace matches configured repo snapshot",
  };
}

export function resolvePreviewRestoreBranches(
  expected: Pick<PreviewWorkspaceExpectation, "repoBranch" | "projectBranch">,
): string[] {
  const candidates = [expected.projectBranch, expected.repoBranch]
    .flatMap((branch) => typeof branch === "string" ? [branch.trim()] : [])
    .filter((branch) => branch.length > 0);

  return [...new Set(candidates)];
}

export function normalizeRepoUrl(repoUrl?: string | null): string | null {
  if (!repoUrl) return null;
  const trimmed = repoUrl.trim();
  if (!trimmed) return null;

  try {
    const url = new URL(trimmed);
    url.username = "";
    url.password = "";
    const pathname = url.pathname.replace(/\/+$/, "").replace(/\.git$/, "");
    return `${url.protocol}//${url.host}${pathname}`;
  } catch {
    return trimmed.replace(/\/+$/, "").replace(/\.git$/, "");
  }
}

const RUNNER_MANAGED_REPLAYABLE_PATHS = new Set([
  "CLAUDE.md",
  "spec.md",
  ".ralph/decisions-log.json",
  ".ralph/iteration-log.json",
  ".ralph/prompt-trace.jsonl",
  ".ralph/provider-session-checkpoint.json",
  ".ralph/ralph-progress.json",
]);

const RUNNER_MANAGED_REPLAYABLE_PREFIXES = [
  ".ralph/agent-logs/",
  ".ralph/controller-reports/",
  ".ralph/logs/",
  ".ralph/task-skills/",
  ".ralph/tasks/",
  "assets/proof/",
  "assets/telegram/",
  "generated/visual-responsive-snapshots/",
];

const RUNTIME_DATA_SIDECAR_SUFFIXES = [
  ".sqlite-journal",
  ".sqlite-wal",
  ".sqlite-shm",
  ".sqlite3-journal",
  ".sqlite3-wal",
  ".sqlite3-shm",
  ".db-journal",
  ".db-wal",
  ".db-shm",
];

export const RALPH_GITIGNORE_MANAGED_SECTION_START = "# ── ralph: auto-managed (do not edit below) ──";
export const RALPH_GITIGNORE_MANAGED_SECTION_END = "# ── ralph: end auto-managed ──";

export type RunnerManagedDirtyEntryInput = {
  path: string;
  headContent?: string | null;
  indexContent?: string | null;
  worktreeContent?: string | null;
};

export type GitPorcelainStatusEntry = {
  code: string;
  path: string;
};

export function parseGitPorcelainStatusEntries(status: string): GitPorcelainStatusEntry[] {
  return status
    .split("\n")
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .map(parseGitPorcelainStatusEntry)
    .filter((entry) => entry.path.length > 0);
}

export function normalizeGitPorcelainStatusCode(code: string): string {
  if (code === "??") return "??";
  return code.padEnd(2, " ").slice(0, 2);
}

export function isRunnerManagedReplayablePath(filePath: string): boolean {
  return (
    RUNNER_MANAGED_REPLAYABLE_PATHS.has(filePath) ||
    RUNNER_MANAGED_REPLAYABLE_PREFIXES.some((prefix) => filePath.startsWith(prefix)) ||
    RUNTIME_DATA_SIDECAR_SUFFIXES.some((suffix) => filePath.endsWith(suffix)) ||
    filePath.startsWith(".arena/") ||
    /^specs\/[^/]+\.md$/.test(filePath)
  );
}

export function isRunnerManagedReplayableDirtyEntry(input: RunnerManagedDirtyEntryInput): boolean {
  if (isRunnerManagedReplayablePath(input.path)) return true;

  const candidates = [
    input.indexContent,
    input.worktreeContent,
  ].filter((content): content is string | null => content !== undefined);
  if (candidates.length === 0) return false;

  if (input.path === ".gitignore") {
    return candidates.every((content) => {
      if (content == null) return false;
      return isRalphManagedGitignoreOnlyChange(input.headContent ?? "", content);
    });
  }

  if (input.path === "arena-start.sh") {
    if (input.headContent == null) return false;
    return candidates.every((content) => content === input.headContent);
  }

  return false;
}

export function isRalphManagedGitignoreOnlyChange(
  baselineContent: string,
  candidateContent: string,
): boolean {
  if (!candidateContent.includes(RALPH_GITIGNORE_MANAGED_SECTION_START)) {
    return false;
  }
  return normalizeGitignoreUserContent(candidateContent) === normalizeGitignoreUserContent(baselineContent);
}

export function stripRalphManagedGitignoreSection(content: string): { content: string; removed: boolean } {
  const startIdx = content.indexOf(RALPH_GITIGNORE_MANAGED_SECTION_START);
  const endIdx = content.indexOf(RALPH_GITIGNORE_MANAGED_SECTION_END);
  if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) {
    return { content, removed: false };
  }

  return {
    content: content.slice(0, startIdx) + content.slice(endIdx + RALPH_GITIGNORE_MANAGED_SECTION_END.length),
    removed: true,
  };
}

function normalizeGitignoreUserContent(content: string): string {
  return stripRalphManagedGitignoreSection(content).content.replace(/\r\n/g, "\n").trim();
}

function parseGitPorcelainStatusEntry(line: string): GitPorcelainStatusEntry {
  if (line.length >= 3 && line[2] === " ") {
    return {
      code: normalizeGitPorcelainStatusCode(line.slice(0, 2)),
      path: parseGitPorcelainPath(line.slice(3)),
    };
  }

  const compactMatch = line.match(/^[ MADRCU?!]{1,2}\s+(.+)$/);
  if (compactMatch?.[1]) {
    const rawCode = line.slice(0, line.length - compactMatch[1].length).trimEnd();
    return {
      code: normalizeGitPorcelainStatusCode(rawCode),
      path: parseGitPorcelainPath(compactMatch[1]),
    };
  }

  return {
    code: "??",
    path: parseGitPorcelainPath(line),
  };
}

function parseGitPorcelainPath(rawPath: string): string {
  const parts = rawPath.split(" -> ");
  const filePath = parts.length > 1 ? parts[parts.length - 1] : rawPath;
  if (filePath.startsWith('"') && filePath.endsWith('"')) {
    try {
      return JSON.parse(filePath) as string;
    } catch {
      return filePath.slice(1, -1);
    }
  }
  return filePath;
}
