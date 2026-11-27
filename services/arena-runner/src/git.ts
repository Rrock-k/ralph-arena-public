/**
 * RA-083: Git operations for runner.
 * Runner owns bootstrap sync. Loop/cycle owns normal commit/push delivery.
 * If a previous loop already created a clean local commit but delivery failed,
 * bootstrap may complete that pending source-delivery before syncing.
 */

import { execFileSync, execSync } from "child_process";
import { existsSync, readFileSync, unlinkSync } from "fs";
import { isRunnerManagedReplayableDirtyEntry, normalizeRepoUrl } from "@arena/contracts";

export interface GitSyncOptions {
  restoreRunnerManagedDirtyPaths?: boolean;
  pushLocalAheadBeforeSync?: boolean;
  allowDirtyAgentResume?: boolean;
  initializeMissingRemoteBranch?: boolean;
  expectedRepoUrl?: string | null;
}

interface PorcelainStatusEntry {
  code: string;
  path: string;
}

export class WorkspaceDirtyBeforeSyncError extends Error {
  constructor(public readonly statusPreview: string) {
    super(`Workspace has uncommitted changes before repo sync: ${statusPreview}`);
    this.name = "WorkspaceDirtyBeforeSyncError";
  }
}

export function isWorkspaceDirtyBeforeSyncError(error: unknown): error is WorkspaceDirtyBeforeSyncError {
  return error instanceof WorkspaceDirtyBeforeSyncError
    || (error instanceof Error && error.name === "WorkspaceDirtyBeforeSyncError");
}

export class WorkspaceRescueFailedError extends Error {
  constructor(public readonly detail: string) {
    super(`Refusing to wipe workspace: local work could not be pushed to origin: ${detail}`);
    this.name = "WorkspaceRescueFailedError";
  }
}

export function isWorkspaceRescueFailedError(error: unknown): error is WorkspaceRescueFailedError {
  return error instanceof WorkspaceRescueFailedError
    || (error instanceof Error && error.name === "WorkspaceRescueFailedError");
}

export type WorkspaceRescueResult = {
  pushed: boolean;
  ref: string | null;
  reason: string;
};

/**
 * RA-383: nothing may be wiped that origin does not already have.
 *
 * The preview-only restore path clears the workspace and re-clones whenever it
 * looks stale. That was written for reviving archived projects, where the
 * directory is a leftover nobody writes to (RA-153). Delegated workspaces broke
 * that assumption: an external writer keeps a live working copy there, and the
 * restore can destroy unpushed commits in an existing workspace.
 *
 * This is the precondition, not a new mechanism — origin is the storage, and
 * the push itself is what makes work legitimate regardless of who wrote it.
 * Clean history that fast-forwards goes to the project branch; anything else
 * (diverged, detached, dirty) goes to a rescue branch so the wipe stays
 * lossless. A workspace with nothing ahead is untouched, which is every case
 * RA-153 was built for.
 */
export function pushWorkspaceAheadBeforeWipe(
  dir: string,
  opts: { projectBranch: string | null; rescueBranch: string },
): WorkspaceRescueResult {
  if (!isGitRepo(dir)) return { pushed: false, ref: null, reason: "workspace is not a git repository" };

  // A repo without a single commit has nothing to lose, and every git command
  // below would fail on the missing HEAD. Blocking the restore here would be a
  // false positive: refusing to wipe something that does not exist.
  if (!getCommitSha(dir)) return { pushed: false, ref: null, reason: "workspace has no commits" };

  try {
    const dirty = gitStatusPorcelain(dir).length > 0;
    const targetBranch = opts.projectBranch?.trim() || null;
    let remoteHasBranch = false;

    if (targetBranch) {
      try {
        execSync(`git fetch origin ${quote(targetBranch)}`, { cwd: dir, stdio: "pipe", timeout: 120_000 });
        remoteHasBranch = true;
      } catch {
        // Branch missing on origin is not an error here: everything local is
        // then ahead by definition and still needs rescuing.
        remoteHasBranch = false;
      }
    }

    const ahead = remoteHasBranch
      ? getAheadBehind(dir, "FETCH_HEAD").ahead
      : Number.POSITIVE_INFINITY;
    const behind = remoteHasBranch ? getAheadBehind(dir, "FETCH_HEAD").behind : 0;

    if (!dirty && ahead === 0) {
      return { pushed: false, ref: null, reason: "workspace has nothing origin is missing" };
    }

    // A dirty tree cannot be pushed as-is, and its rescue commit must never
    // land on the project branch — it is unreviewed salvage, not project work.
    if (dirty) {
      ensureLocalGitIdentity(dir);
      execSync("git add -A", { cwd: dir, stdio: "pipe", timeout: 60_000 });
      execSync(
        `git commit -m ${quote("arena: rescue uncommitted workspace state before restore")}`,
        { cwd: dir, stdio: "pipe", timeout: 60_000 },
      );
    }

    const useProjectBranch = Boolean(targetBranch) && !dirty && behind === 0;
    const ref = useProjectBranch ? targetBranch! : opts.rescueBranch;

    console.log(`[runner] Rescuing workspace before restore → origin/${ref}`);
    execSync(`git push origin ${quote(`HEAD:refs/heads/${ref}`)}`, {
      cwd: dir,
      stdio: "inherit",
      timeout: 120_000,
    });

    return {
      pushed: true,
      ref,
      reason: useProjectBranch
        ? "local commits fast-forward the project branch"
        : dirty
          ? "workspace had uncommitted changes"
          : "workspace history diverged from the project branch",
    };
  } catch (error) {
    throw new WorkspaceRescueFailedError(error instanceof Error ? error.message : String(error));
  }
}

export function gitClone(repoUrl: string, branch: string, targetDir: string): void {
  console.log(`[runner] git clone → ${targetDir} (branch: ${branch})`);
  execSync(
    `git clone --depth 50 --branch ${quote(branch)} ${quote(repoUrl)} ${quote(targetDir)}`,
    { stdio: "inherit", timeout: 120_000 }
  );
}

export function gitCheckoutNewBranch(dir: string, branchName: string): void {
  // Clean up stale lock from interrupted git operations (e.g. container kill)
  removeStaleIndexLock(dir);
  execSync(`git checkout -B ${quote(branchName)}`, {
    cwd: dir,
    stdio: "inherit",
  });
}

export function gitConfigUser(dir: string): void {
  execSync('git config user.email "arena-runner@arena.example.test"', { cwd: dir, stdio: "inherit" });
  execSync('git config user.name "Arena Runner"', { cwd: dir, stdio: "inherit" });
}

export function ensureLocalGitIdentity(dir: string): void {
  if (!isGitRepo(dir)) return;
  gitConfigUser(dir);
}

export function getCommitSha(dir: string): string | null {
  try {
    return execSync("git rev-parse HEAD", { cwd: dir, stdio: "pipe" }).toString().trim() || null;
  } catch {
    return null;
  }
}

export function getCurrentBranch(dir: string): string | null {
  try {
    const branch = execSync("git rev-parse --abbrev-ref HEAD", { cwd: dir, stdio: "pipe" }).toString().trim();
    return branch && branch !== "HEAD" ? branch : null;
  } catch {
    return null;
  }
}

export function getOriginUrl(dir: string): string | null {
  try {
    return execSync("git remote get-url origin", { cwd: dir, stdio: "pipe" }).toString().trim() || null;
  } catch {
    return null;
  }
}

export function isGitRepo(dir: string): boolean {
  try {
    execSync("git rev-parse --git-dir", { cwd: dir, stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

export function gitPull(dir: string): void {
  execSync("git pull --ff-only", { cwd: dir, stdio: "inherit", timeout: 60_000 });
}

export function gitSyncBranchToRemoteHead(dir: string, branchName: string, options: GitSyncOptions = {}): void {
  removeStaleIndexLock(dir);
  assertExpectedOriginMatches(dir, options.expectedRepoUrl);

  let status = gitStatusPorcelain(dir);
  if (status && options.restoreRunnerManagedDirtyPaths) {
    const restored = restoreRunnerManagedDirtyPathsBeforeSync(dir, parsePorcelainStatus(status));
    if (restored) {
      status = gitStatusPorcelain(dir);
    }
  }

  const remoteRef = `origin/${branchName}`;
  const remoteTrackingRef = `refs/remotes/${remoteRef}`;

  if (status && options.allowDirtyAgentResume) {
    const preview = status.split("\n").slice(0, 5).join("; ");
    if (canResumeDirtyWorkspaceWithoutSync(dir, branchName, remoteRef, remoteTrackingRef)) {
      console.log(
        `[runner] Preserving dirty workspace for agent_run resume; ${remoteRef} matches HEAD: ${preview}`,
      );
      return;
    }
  }

  if (status) {
    const preview = status.split("\n").slice(0, 5).join("; ");
    throw new WorkspaceDirtyBeforeSyncError(preview);
  }

  const remoteBranchPresent = remoteBranchExists(dir, branchName);
  if (!remoteBranchPresent) {
    if (!options.initializeMissingRemoteBranch) {
      throw new Error(`Remote branch ${branchName} does not exist`);
    }
    console.log(
      `[runner] Remote branch ${branchName} is missing; initializing local project branch from current HEAD`,
    );
    execSync(`git checkout -B ${quote(branchName)}`, {
      cwd: dir,
      stdio: "inherit",
      timeout: 60_000,
    });
    return;
  }

  execSync(`git fetch origin ${quote(`refs/heads/${branchName}:${remoteTrackingRef}`)}`, {
    cwd: dir,
    stdio: "inherit",
    timeout: 120_000,
  });

  const hasLocalBranch = (() => {
    try {
      execSync(`git show-ref --verify --quiet ${quote(`refs/heads/${branchName}`)}`, {
        cwd: dir,
        stdio: "ignore",
        timeout: 60_000,
      });
      return true;
    } catch {
      return false;
    }
  })();

  if (!hasLocalBranch) {
    execSync(`git checkout -B ${quote(branchName)} ${quote(remoteRef)}`, {
      cwd: dir,
      stdio: "inherit",
      timeout: 60_000,
    });
    return;
  }

  if (getCurrentBranch(dir) !== branchName) {
    execSync(`git checkout ${quote(branchName)}`, {
      cwd: dir,
      stdio: "inherit",
      timeout: 60_000,
    });
  }

  let { ahead, behind } = getAheadBehind(dir, remoteRef);

  if (ahead > 0) {
    if (options.pushLocalAheadBeforeSync && behind === 0) {
      console.log(
        `[runner] Workspace branch ${branchName} has ${ahead} local commit(s) not on ${remoteRef}; completing pending source delivery before sync`,
      );
      execSync(`git push origin ${quote(`HEAD:refs/heads/${branchName}`)}`, {
        cwd: dir,
        stdio: "inherit",
        timeout: 120_000,
      });
      execSync(`git fetch origin ${quote(`refs/heads/${branchName}:${remoteTrackingRef}`)}`, {
        cwd: dir,
        stdio: "inherit",
        timeout: 120_000,
      });
      ({ ahead, behind } = getAheadBehind(dir, remoteRef));
    }
  }

  if (ahead > 0) {
    throw new Error(
      `Workspace branch ${branchName} has ${ahead} local commit(s) not on ${remoteRef}; refusing split-brain repo state`,
    );
  }

  if (behind > 0) {
    execSync(`git merge --ff-only ${quote(remoteRef)}`, {
      cwd: dir,
      stdio: "inherit",
      timeout: 60_000,
    });
  }
}

function assertExpectedOriginMatches(dir: string, expectedRepoUrl?: string | null): void {
  const expected = normalizeRepoUrl(expectedRepoUrl);
  if (!expected) return;

  const current = normalizeRepoUrl(getOriginUrl(dir));
  if (current === expected) return;

  throw new Error(
    `Workspace origin does not match configured repo; expected ${expected}, got ${current ?? "missing origin"}`,
  );
}

function remoteBranchExists(dir: string, branchName: string): boolean {
  try {
    execFileSync("git", ["ls-remote", "--exit-code", "--heads", "origin", branchName], {
      cwd: dir,
      stdio: "ignore",
      timeout: 120_000,
    });
    return true;
  } catch (error) {
    if (getChildProcessExitStatus(error) === 2) {
      return false;
    }
    throw error;
  }
}

function getChildProcessExitStatus(error: unknown): number | null {
  if (typeof error !== "object" || error === null || !("status" in error)) {
    return null;
  }
  const status = (error as { status?: unknown }).status;
  return typeof status === "number" ? status : null;
}

function canResumeDirtyWorkspaceWithoutSync(
  dir: string,
  branchName: string,
  remoteRef: string,
  remoteTrackingRef: string,
): boolean {
  if (getCurrentBranch(dir) !== branchName) return false;

  try {
    execSync(`git fetch origin ${quote(`refs/heads/${branchName}:${remoteTrackingRef}`)}`, {
      cwd: dir,
      stdio: "inherit",
      timeout: 120_000,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[runner] Dirty agent_run resume could not fetch ${remoteRef}: ${message}`);
    return false;
  }

  const { ahead, behind } = getAheadBehind(dir, remoteRef);
  return ahead === 0 && behind === 0;
}

function getAheadBehind(dir: string, remoteRef: string): { ahead: number; behind: number } {
  const [aheadRaw, behindRaw] = execSync(`git rev-list --left-right --count HEAD...${quote(remoteRef)}`, {
    cwd: dir,
    stdio: "pipe",
    timeout: 60_000,
  }).toString().trim().split(/\s+/);

  return {
    ahead: Number(aheadRaw ?? 0),
    behind: Number(behindRaw ?? 0),
  };
}

function gitStatusPorcelain(dir: string): string {
  return execSync("git status --porcelain -uall", {
    cwd: dir,
    stdio: "pipe",
    timeout: 60_000,
  }).toString().trimEnd();
}

export function getWorkspaceDirtyStatusPreview(dir: string, maxLines = 5): string | null {
  try {
    const status = gitStatusPorcelain(dir);
    if (!status) return null;
    return status.split("\n").slice(0, maxLines).join("; ");
  } catch {
    return null;
  }
}

function restoreRunnerManagedDirtyPathsBeforeSync(dir: string, entries: PorcelainStatusEntry[]): boolean {
  if (entries.length === 0) return false;
  if (!entries.every((entry) => isReplayableDirtyEntry(dir, entry))) return false;

  const addedPaths = entries.filter((entry) => isAddedWithoutHead(dir, entry)).map((entry) => entry.path);
  const trackedPaths = entries
    .filter((entry) => entry.code !== "??" && !isAddedWithoutHead(dir, entry))
    .map((entry) => entry.path);
  const untrackedPaths = entries.filter((entry) => entry.code === "??").map((entry) => entry.path);

  if (addedPaths.length > 0) {
    execSync(`git rm -f --cached -- ${addedPaths.map(quote).join(" ")}`, {
      cwd: dir,
      stdio: "inherit",
      timeout: 60_000,
    });
    execSync(`git clean -fd -- ${addedPaths.map(quote).join(" ")}`, {
      cwd: dir,
      stdio: "inherit",
      timeout: 60_000,
    });
  }
  if (trackedPaths.length > 0) {
    execSync(`git restore --staged --worktree -- ${trackedPaths.map(quote).join(" ")}`, {
      cwd: dir,
      stdio: "inherit",
      timeout: 60_000,
    });
  }
  if (untrackedPaths.length > 0) {
    execSync(`git clean -fd -- ${untrackedPaths.map(quote).join(" ")}`, {
      cwd: dir,
      stdio: "inherit",
      timeout: 60_000,
    });
  }

  console.log(
    `[runner] Restored runner-managed replayable files before repo sync: ${entries
      .map((entry) => entry.path)
      .join(", ")}`,
  );
  return true;
}

function isAddedWithoutHead(dir: string, entry: PorcelainStatusEntry): boolean {
  const code = normalizePorcelainCode(entry.code);
  return code[0] === "A" && gitShowOrNull(dir, `HEAD:${entry.path}`) == null;
}

function parsePorcelainStatus(status: string): PorcelainStatusEntry[] {
  return status
    .split("\n")
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .map((line) => {
      const { code, rawPath } = splitPorcelainStatusLine(line);
      return {
        code: normalizePorcelainCode(code),
        path: parsePorcelainPath(rawPath),
      };
    });
}

function splitPorcelainStatusLine(line: string): { code: string; rawPath: string } {
  if (line.length >= 3 && line[2] === " ") {
    return {
      code: line.slice(0, 2),
      rawPath: line.slice(3),
    };
  }

  const compactMatch = line.match(/^[ MADRCU?!]{1,2}\s+(.+)$/);
  if (compactMatch?.[1]) {
    return {
      code: line.slice(0, line.length - compactMatch[1].length).trimEnd(),
      rawPath: compactMatch[1],
    };
  }

  return {
    code: "??",
    rawPath: line,
  };
}

function isReplayableDirtyEntry(dir: string, entry: PorcelainStatusEntry): boolean {
  if (isRunnerManagedReplayableDirtyEntry({ path: entry.path })) return true;
  if (entry.path !== ".gitignore" && entry.path !== "arena-start.sh") return false;

  const contents = readDirtyEntryContents(dir, entry);
  return isRunnerManagedReplayableDirtyEntry({
    path: entry.path,
    headContent: contents.headContent,
    indexContent: contents.indexContent,
    worktreeContent: contents.worktreeContent,
  });
}

function readDirtyEntryContents(dir: string, entry: PorcelainStatusEntry): {
  headContent: string | null;
  indexContent?: string | null;
  worktreeContent?: string | null;
} {
  const code = normalizePorcelainCode(entry.code);
  return {
    headContent: gitShowOrNull(dir, `HEAD:${entry.path}`),
    indexContent: touchesIndex(code) ? gitShowOrNull(dir, `:${entry.path}`) : undefined,
    worktreeContent: touchesWorktree(code) ? readFileOrNull(`${dir}/${entry.path}`) : undefined,
  };
}

function normalizePorcelainCode(code: string): string {
  if (code === "??") return "??";
  return code.padEnd(2, " ").slice(0, 2);
}

function touchesIndex(code: string): boolean {
  return code !== "??" && code[0] !== " ";
}

function touchesWorktree(code: string): boolean {
  return code === "??" || code[1] !== " ";
}

function gitShowOrNull(dir: string, revisionPath: string): string | null {
  try {
    return execSync(`git show ${quote(revisionPath)}`, {
      cwd: dir,
      stdio: "pipe",
      timeout: 60_000,
    }).toString();
  } catch {
    return null;
  }
}

function readFileOrNull(filePath: string): string | null {
  try {
    return readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
}

function parsePorcelainPath(rawPath: string): string {
  const parts = rawPath.split(" -> ");
  const path = parts.length > 1 ? parts[parts.length - 1] : rawPath;
  if (path.startsWith('"') && path.endsWith('"')) {
    try {
      return JSON.parse(path) as string;
    } catch {
      return path.slice(1, -1);
    }
  }
  return path;
}

export function gitCheckoutCommit(dir: string, commitSha: string): void {
  try {
    execSync(`git checkout --detach ${quote(commitSha)}`, {
      cwd: dir,
      stdio: "inherit",
      timeout: 60_000,
    });
  } catch {
    execSync(`git fetch --depth 1 origin ${quote(commitSha)}`, {
      cwd: dir,
      stdio: "inherit",
      timeout: 120_000,
    });
    execSync(`git checkout --detach ${quote(commitSha)}`, {
      cwd: dir,
      stdio: "inherit",
      timeout: 60_000,
    });
  }
}

function quote(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}

function removeStaleIndexLock(dir: string): void {
  const lockFile = `${dir}/.git/index.lock`;
  if (existsSync(lockFile)) {
    console.log("[runner] Removing stale .git/index.lock");
    unlinkSync(lockFile);
  }
}
