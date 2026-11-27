import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { getCurrentBranch, gitClone, gitSyncBranchToRemoteHead, pushWorkspaceAheadBeforeWipe } from "./git.js";

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function createOriginWithMain(): { root: string; origin: string } {
  const root = mkdtempSync(path.join(tmpdir(), "arena-runner-git-"));
  const origin = path.join(root, "origin.git");
  const seed = path.join(root, "seed");

  execFileSync("git", ["init", "--bare", origin], { stdio: "ignore" });
  execFileSync("git", ["init", "-b", "main", seed], { stdio: "ignore" });
  git(seed, ["config", "user.email", "test@example.com"]);
  git(seed, ["config", "user.name", "Test"]);
  writeFileSync(path.join(seed, "README.md"), "# Seed\n", "utf8");
  git(seed, ["add", "README.md"]);
  git(seed, ["commit", "-m", "seed"]);
  git(seed, ["remote", "add", "origin", origin]);
  git(seed, ["push", "origin", "main"]);

  return { root, origin };
}

describe("gitSyncBranchToRemoteHead", () => {
  it("initializes a missing project branch from current HEAD only when requested", () => {
    const { root, origin } = createOriginWithMain();
    const workspace = path.join(root, "workspace");

    try {
      gitClone(origin, "main", workspace);
      expect(() => gitSyncBranchToRemoteHead(workspace, "arena/project-proj-1")).toThrow();

      gitSyncBranchToRemoteHead(workspace, "arena/project-proj-1", {
        initializeMissingRemoteBranch: true,
      });

      expect(getCurrentBranch(workspace)).toBe("arena/project-proj-1");
      expect(git(workspace, ["rev-parse", "HEAD"])).toBe(git(workspace, ["rev-parse", "main"]));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

// RA-383: the preview-only restore wipes the workspace. Nothing may be wiped
// that origin does not already have.
describe("pushWorkspaceAheadBeforeWipe", () => {
  const PROJECT_BRANCH = "arena/project-proj-1";
  const RESCUE = "arena/rescue/proj-1/stamp";

  function remoteSha(origin: string, branch: string): string | null {
    try {
      return git(origin, ["rev-parse", branch]);
    } catch {
      return null;
    }
  }

  function commitFile(workspace: string, name: string, body: string): void {
    writeFileSync(path.join(workspace, name), body, "utf8");
    git(workspace, ["add", name]);
    git(workspace, ["commit", "-m", `add ${name}`]);
  }

  it("leaves an already-published workspace untouched", () => {
    const { root, origin } = createOriginWithMain();
    const workspace = path.join(root, "workspace");
    try {
      gitClone(origin, "main", workspace);
      const before = git(workspace, ["rev-parse", "HEAD"]);

      const result = pushWorkspaceAheadBeforeWipe(workspace, {
        projectBranch: "main",
        rescueBranch: RESCUE,
      });

      expect(result.pushed).toBe(false);
      expect(git(workspace, ["rev-parse", "HEAD"])).toBe(before);
      expect(remoteSha(origin, RESCUE)).toBeNull();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("pushes fast-forward commits to the project branch", () => {
    const { root, origin } = createOriginWithMain();
    const workspace = path.join(root, "workspace");
    try {
      gitClone(origin, "main", workspace);
      git(workspace, ["push", "origin", `HEAD:refs/heads/${PROJECT_BRANCH}`]);
      git(workspace, ["config", "user.email", "test@example.com"]);
      git(workspace, ["config", "user.name", "Test"]);
      commitFile(workspace, "external.txt", "written by someone else\n");
      const local = git(workspace, ["rev-parse", "HEAD"]);

      const result = pushWorkspaceAheadBeforeWipe(workspace, {
        projectBranch: PROJECT_BRANCH,
        rescueBranch: RESCUE,
      });

      expect(result).toEqual(expect.objectContaining({ pushed: true, ref: PROJECT_BRANCH }));
      expect(remoteSha(origin, PROJECT_BRANCH)).toBe(local);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("sends diverged history to a rescue branch instead of the project branch", () => {
    const { root, origin } = createOriginWithMain();
    const workspace = path.join(root, "workspace");
    const other = path.join(root, "other");
    try {
      gitClone(origin, "main", workspace);
      git(workspace, ["push", "origin", `HEAD:refs/heads/${PROJECT_BRANCH}`]);

      // someone else advances the project branch on origin
      gitClone(origin, PROJECT_BRANCH, other);
      git(other, ["config", "user.email", "test@example.com"]);
      git(other, ["config", "user.name", "Test"]);
      commitFile(other, "remote.txt", "remote work\n");
      git(other, ["push", "origin", PROJECT_BRANCH]);
      const remoteHead = git(other, ["rev-parse", "HEAD"]);

      git(workspace, ["config", "user.email", "test@example.com"]);
      git(workspace, ["config", "user.name", "Test"]);
      commitFile(workspace, "local.txt", "local work\n");
      const local = git(workspace, ["rev-parse", "HEAD"]);

      const result = pushWorkspaceAheadBeforeWipe(workspace, {
        projectBranch: PROJECT_BRANCH,
        rescueBranch: RESCUE,
      });

      expect(result).toEqual(expect.objectContaining({ pushed: true, ref: RESCUE }));
      expect(remoteSha(origin, RESCUE)).toBe(local);
      expect(remoteSha(origin, PROJECT_BRANCH)).toBe(remoteHead);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("commits a dirty tree and rescues it without touching the project branch", () => {
    const { root, origin } = createOriginWithMain();
    const workspace = path.join(root, "workspace");
    try {
      gitClone(origin, "main", workspace);
      git(workspace, ["push", "origin", `HEAD:refs/heads/${PROJECT_BRANCH}`]);
      const projectHead = remoteSha(origin, PROJECT_BRANCH);
      writeFileSync(path.join(workspace, "uncommitted.txt"), "in flight\n", "utf8");

      const result = pushWorkspaceAheadBeforeWipe(workspace, {
        projectBranch: PROJECT_BRANCH,
        rescueBranch: RESCUE,
      });

      expect(result).toEqual(expect.objectContaining({ pushed: true, ref: RESCUE }));
      expect(remoteSha(origin, PROJECT_BRANCH)).toBe(projectHead);
      expect(git(origin, ["show", `${RESCUE}:uncommitted.txt`])).toContain("in flight");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rescues detached HEAD, which is exactly what pin-based restore leaves behind", () => {
    const { root, origin } = createOriginWithMain();
    const workspace = path.join(root, "workspace");
    try {
      gitClone(origin, "main", workspace);
      git(workspace, ["config", "user.email", "test@example.com"]);
      git(workspace, ["config", "user.name", "Test"]);
      commitFile(workspace, "external.txt", "external work\n");
      const local = git(workspace, ["rev-parse", "HEAD"]);
      git(workspace, ["checkout", "--detach", local]);
      expect(getCurrentBranch(workspace)).toBeNull();

      const result = pushWorkspaceAheadBeforeWipe(workspace, {
        projectBranch: PROJECT_BRANCH,
        rescueBranch: RESCUE,
      });

      expect(result.pushed).toBe(true);
      expect(remoteSha(origin, result.ref!)).toBe(local);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("refuses to report success when the push cannot happen", () => {
    const { root, origin } = createOriginWithMain();
    const workspace = path.join(root, "workspace");
    try {
      gitClone(origin, "main", workspace);
      git(workspace, ["config", "user.email", "test@example.com"]);
      git(workspace, ["config", "user.name", "Test"]);
      commitFile(workspace, "external.txt", "external work\n");
      git(workspace, ["remote", "set-url", "origin", path.join(root, "missing-origin.git")]);

      expect(() => pushWorkspaceAheadBeforeWipe(workspace, {
        projectBranch: PROJECT_BRANCH,
        rescueBranch: RESCUE,
      })).toThrow(/could not be pushed to origin/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("works on the shallow clone the restore path actually produces", () => {
    const { root, origin } = createOriginWithMain();
    const workspace = path.join(root, "workspace");
    try {
      // `gitClone` uses --depth 50, and a local path clone silently ignores
      // depth — only a real transport produces the shallow repo we ship.
      execFileSync("git", ["clone", "--depth", "1", "--branch", "main", `file://${origin}`, workspace], { stdio: "ignore" });
      expect(git(workspace, ["rev-parse", "--is-shallow-repository"])).toBe("true");
      git(workspace, ["config", "user.email", "test@example.com"]);
      git(workspace, ["config", "user.name", "Test"]);
      commitFile(workspace, "external.txt", "external work\n");
      const local = git(workspace, ["rev-parse", "HEAD"]);

      const result = pushWorkspaceAheadBeforeWipe(workspace, {
        projectBranch: "main",
        rescueBranch: RESCUE,
      });

      expect(result.pushed).toBe(true);
      expect(remoteSha(origin, "main")).toBe(local);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("treats a repository without commits as nothing to lose", () => {
    const root = mkdtempSync(path.join(tmpdir(), "arena-runner-git-empty-"));
    try {
      execFileSync("git", ["init", "-b", "main", root], { stdio: "ignore" });

      expect(pushWorkspaceAheadBeforeWipe(root, {
        projectBranch: "main",
        rescueBranch: RESCUE,
      })).toEqual(expect.objectContaining({ pushed: false }));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("refuses to wipe a workspace whose commits have nowhere to go", () => {
    const root = mkdtempSync(path.join(tmpdir(), "arena-runner-git-noremote-"));
    try {
      execFileSync("git", ["init", "-b", "main", root], { stdio: "ignore" });
      git(root, ["config", "user.email", "test@example.com"]);
      git(root, ["config", "user.name", "Test"]);
      commitFile(root, "orphan.txt", "no remote to push to\n");

      expect(() => pushWorkspaceAheadBeforeWipe(root, {
        projectBranch: "main",
        rescueBranch: RESCUE,
      })).toThrow(/could not be pushed to origin/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
