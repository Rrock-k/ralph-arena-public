import test from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  RALPH_GITIGNORE_MANAGED_SECTION_END,
  RALPH_GITIGNORE_MANAGED_SECTION_START,
} from "@arena/contracts";

import { WorkspaceDirtyBeforeSyncError, ensureLocalGitIdentity, gitSyncBranchToRemoteHead } from "../dist/git.js";

function readGitConfig(dir, key) {
  return execSync(`git config --local --get ${key}`, {
    cwd: dir,
    stdio: "pipe",
    encoding: "utf8",
  }).trim();
}

test("ensures a stable local git identity for runner workspaces", () => {
  const dir = mkdtempSync(join(tmpdir(), "arena-runner-git-"));

  try {
    execSync("git init", { cwd: dir, stdio: "ignore" });

    ensureLocalGitIdentity(dir);

    assert.equal(readGitConfig(dir, "user.email"), "arena-runner@arena.example.test");
    assert.equal(readGitConfig(dir, "user.name"), "Arena Runner");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("skips non-git workspaces without creating repo state", () => {
  const dir = mkdtempSync(join(tmpdir(), "arena-runner-non-git-"));

  try {
    assert.doesNotThrow(() => ensureLocalGitIdentity(dir));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("fast-forwards an existing workspace to the remote project branch head", () => {
  const root = mkdtempSync(join(tmpdir(), "arena-runner-git-sync-"));
  const branch = "arena/project-test";

  try {
    const { remote, seed } = createRemoteWithSeed(root, branch);
    const workspace = join(root, "workspace");
    run(root, `git clone --branch ${q(branch)} ${q(remote)} ${q(workspace)}`);

    writeFileSync(join(seed, "app.txt"), "v2\n");
    run(seed, "git add app.txt");
    run(seed, "git commit -m update");
    run(seed, `git push origin ${q(branch)}`);
    const remoteHead = run(seed, "git rev-parse HEAD");

    gitSyncBranchToRemoteHead(workspace, branch);

    assert.equal(run(workspace, "git rev-parse HEAD"), remoteHead);
    assert.equal(run(workspace, `git rev-list --left-right --count HEAD...origin/${branch}`), "0\t0");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("materializes missing remote tracking ref before syncing local project branch", () => {
  const root = mkdtempSync(join(tmpdir(), "arena-runner-git-sync-missing-remote-ref-"));
  const branch = "arena/project-test";

  try {
    const { remote, seed } = createRemoteWithSeed(root, branch);
    const workspace = join(root, "workspace");
    run(root, `git clone --branch ${q(branch)} ${q(remote)} ${q(workspace)}`);
    run(workspace, `git update-ref -d refs/remotes/origin/${branch}`);

    writeFileSync(join(seed, "app.txt"), "v2\n");
    run(seed, "git add app.txt");
    run(seed, "git commit -m update");
    run(seed, `git push origin ${q(branch)}`);
    const remoteHead = run(seed, "git rev-parse HEAD");

    gitSyncBranchToRemoteHead(workspace, branch);

    assert.equal(run(workspace, "git rev-parse HEAD"), remoteHead);
    assert.equal(run(workspace, `git rev-list --left-right --count HEAD...origin/${branch}`), "0\t0");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("rejects dirty workspaces before syncing to remote head", () => {
  const root = mkdtempSync(join(tmpdir(), "arena-runner-git-sync-dirty-"));
  const branch = "arena/project-test";

  try {
    const { remote } = createRemoteWithSeed(root, branch);
    const workspace = join(root, "workspace");
    run(root, `git clone --branch ${q(branch)} ${q(remote)} ${q(workspace)}`);
    writeFileSync(join(workspace, "app.txt"), "dirty\n");

    assert.throws(
      () => gitSyncBranchToRemoteHead(workspace, branch),
      /uncommitted changes before repo sync/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("restores runner-managed replayable files before syncing when explicitly allowed", () => {
  const root = mkdtempSync(join(tmpdir(), "arena-runner-git-sync-replayable-"));
  const branch = "arena/project-test";

  try {
    const { remote, seed } = createRemoteWithSeed(root, branch);
    addRunnerManagedFiles(seed, branch);
    const workspace = join(root, "workspace");
    run(root, `git clone --branch ${q(branch)} ${q(remote)} ${q(workspace)}`);

    writeFileSync(join(workspace, "spec.md"), "dirty spec\n");
    writeFileSync(join(workspace, "specs/001-evolution.md"), "dirty spec file\n");
    writeFileSync(join(workspace, "CLAUDE.md"), "dirty platform stamp\n");
    writeFileSync(join(workspace, ".ralph/iteration-log.json"), "{\"dirty\":true}\n");
    writeFileSync(join(workspace, ".ralph/ralph-progress.json"), "{\"currentState\":\"paused\"}\n");
    writeFileSync(join(workspace, ".ralph/prompt-trace.jsonl"), "{\"owner\":\"planner\"}\n");
    writeFileSync(join(workspace, ".ralph/provider-session-checkpoint.json"), "{\"sessionId\":\"ephemeral\"}\n");
    writeFileSync(join(workspace, ".ralph/decisions-log.json"), "[]\n");
    mkdirSync(join(workspace, ".ralph/logs"), { recursive: true });
    mkdirSync(join(workspace, ".ralph/tasks/task-001"), { recursive: true });
    writeFileSync(join(workspace, ".ralph/logs/run.log"), "debug log\n");
    writeFileSync(join(workspace, ".ralph/tasks/task-001/plan.md"), "private task note\n");

    writeFileSync(join(seed, "app.txt"), "v2\n");
    run(seed, "git add app.txt");
    run(seed, "git commit -m update");
    run(seed, `git push origin ${q(branch)}`);
    const remoteHead = run(seed, "git rev-parse HEAD");

    gitSyncBranchToRemoteHead(workspace, branch, { restoreRunnerManagedDirtyPaths: true });

    assert.equal(run(workspace, "git rev-parse HEAD"), remoteHead);
    assert.equal(run(workspace, "git status --porcelain"), "");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("restores runner-owned .arena contract files before syncing when explicitly allowed", () => {
  const root = mkdtempSync(join(tmpdir(), "arena-runner-git-sync-arena-contract-"));
  const branch = "arena/project-test";

  try {
    const { remote, seed } = createRemoteWithSeed(root, branch);
    mkdirSync(join(seed, ".arena"), { recursive: true });
    writeFileSync(join(seed, ".arena/auth.json"), "{\"auth\":{}}\n");
    writeFileSync(join(seed, ".arena/platform.md"), "old platform\n");
    writeFileSync(join(seed, ".arena/combined-spec.md"), "legacy hidden spec\n");
    writeFileSync(join(seed, ".arena/decisions-log.json"), "[]\n");
    writeFileSync(join(seed, ".arena/plan.json"), "{\"items\":[]}\n");
    run(seed, "git add .arena/auth.json .arena/platform.md .arena/combined-spec.md .arena/decisions-log.json .arena/plan.json");
    run(seed, "git commit -m add-arena-contract-files");
    run(seed, `git push origin ${q(branch)}`);

    const workspace = join(root, "workspace");
    run(root, `git clone --branch ${q(branch)} ${q(remote)} ${q(workspace)}`);
    run(workspace, "git rm .arena/auth.json .arena/combined-spec.md .arena/decisions-log.json .arena/plan.json");
    writeFileSync(join(workspace, ".arena/platform.md"), "runtime platform\n");

    writeFileSync(join(seed, "app.txt"), "v2\n");
    run(seed, "git add app.txt");
    run(seed, "git commit -m update");
    run(seed, `git push origin ${q(branch)}`);
    const remoteHead = run(seed, "git rev-parse HEAD");

    gitSyncBranchToRemoteHead(workspace, branch, { restoreRunnerManagedDirtyPaths: true });

    assert.equal(run(workspace, "git rev-parse HEAD"), remoteHead);
    assert.equal(run(workspace, "git status --porcelain"), "");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("restores runner-owned proof and runtime database sidecars before syncing when explicitly allowed", () => {
  const root = mkdtempSync(join(tmpdir(), "arena-runner-git-sync-runtime-sidecars-"));
  const branch = "arena/project-test";

  try {
    const { remote, seed } = createRemoteWithSeed(root, branch);
    mkdirSync(join(seed, "assets/proof/task-001"), { recursive: true });
    writeFileSync(join(seed, "assets/proof/task-001/before.png"), "proof-v1\n");
    writeFileSync(join(seed, "data.sqlite-wal"), "wal-v1\n");
    writeFileSync(join(seed, "data.sqlite-shm"), "shm-v1\n");
    run(seed, "git add assets/proof/task-001/before.png data.sqlite-wal data.sqlite-shm");
    run(seed, "git commit -m add-runner-proof-and-db-sidecars");
    run(seed, `git push origin ${q(branch)}`);

    const workspace = join(root, "workspace");
    run(root, `git clone --branch ${q(branch)} ${q(remote)} ${q(workspace)}`);
    run(workspace, "git rm assets/proof/task-001/before.png");
    writeFileSync(join(workspace, "data.sqlite-wal"), "wal-runtime-dirty\n");
    writeFileSync(join(workspace, "data.sqlite-shm"), "shm-runtime-dirty\n");
    mkdirSync(join(workspace, "assets/proof/task-999"), { recursive: true });
    writeFileSync(join(workspace, "assets/proof/task-999/after.png"), "untracked proof\n");
    writeFileSync(join(workspace, "local.sqlite-wal"), "untracked wal\n");

    writeFileSync(join(seed, "app.txt"), "v2\n");
    run(seed, "git add app.txt");
    run(seed, "git commit -m update");
    run(seed, `git push origin ${q(branch)}`);
    const remoteHead = run(seed, "git rev-parse HEAD");

    gitSyncBranchToRemoteHead(workspace, branch, { restoreRunnerManagedDirtyPaths: true });

    assert.equal(run(workspace, "git rev-parse HEAD"), remoteHead);
    assert.equal(run(workspace, "git status --porcelain"), "");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("restores Ralph-managed gitignore changes before syncing when explicitly allowed", () => {
  const root = mkdtempSync(join(tmpdir(), "arena-runner-git-sync-managed-gitignore-"));
  const branch = "arena/project-test";

  try {
    const { remote, seed } = createRemoteWithSeed(root, branch);
    const workspace = join(root, "workspace");
    run(root, `git clone --branch ${q(branch)} ${q(remote)} ${q(workspace)}`);
    writeFileSync(join(workspace, ".gitignore"), managedGitignore());
    run(workspace, "git add .gitignore");

    writeFileSync(join(seed, "app.txt"), "v2\n");
    run(seed, "git add app.txt");
    run(seed, "git commit -m update");
    run(seed, `git push origin ${q(branch)}`);
    const remoteHead = run(seed, "git rev-parse HEAD");

    gitSyncBranchToRemoteHead(workspace, branch, { restoreRunnerManagedDirtyPaths: true });

    assert.equal(run(workspace, "git rev-parse HEAD"), remoteHead);
    assert.equal(run(workspace, "git status --porcelain"), "");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("rejects user-owned gitignore edits before syncing", () => {
  const root = mkdtempSync(join(tmpdir(), "arena-runner-git-sync-user-gitignore-"));
  const branch = "arena/project-test";

  try {
    const { remote } = createRemoteWithSeed(root, branch);
    const workspace = join(root, "workspace");
    run(root, `git clone --branch ${q(branch)} ${q(remote)} ${q(workspace)}`);
    writeFileSync(join(workspace, ".gitignore"), "*.tmp\n.env.local\n");
    run(workspace, "git add .gitignore");

    assert.throws(
      () => gitSyncBranchToRemoteHead(workspace, branch, { restoreRunnerManagedDirtyPaths: true }),
      WorkspaceDirtyBeforeSyncError,
    );
    assert.match(run(workspace, "git status --porcelain"), /A  .gitignore/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("restores arena-start mode-only changes before syncing when explicitly allowed", () => {
  const root = mkdtempSync(join(tmpdir(), "arena-runner-git-sync-arena-start-mode-"));
  const branch = "arena/project-test";

  try {
    const { remote, seed } = createRemoteWithSeed(root, branch);
    writeFileSync(join(seed, "arena-start.sh"), "#!/usr/bin/env bash\nnode server.mjs\n");
    run(seed, "git add arena-start.sh");
    run(seed, "git commit -m add-start-script");
    run(seed, `git push origin ${q(branch)}`);

    const workspace = join(root, "workspace");
    run(root, `git clone --branch ${q(branch)} ${q(remote)} ${q(workspace)}`);
    run(workspace, "git update-index --chmod=+x arena-start.sh");

    writeFileSync(join(seed, "app.txt"), "v2\n");
    run(seed, "git add app.txt");
    run(seed, "git commit -m update");
    run(seed, `git push origin ${q(branch)}`);
    const remoteHead = run(seed, "git rev-parse HEAD");

    gitSyncBranchToRemoteHead(workspace, branch, { restoreRunnerManagedDirtyPaths: true });

    assert.equal(run(workspace, "git rev-parse HEAD"), remoteHead);
    assert.equal(run(workspace, "git status --porcelain"), "");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("rejects arena-start content edits before syncing", () => {
  const root = mkdtempSync(join(tmpdir(), "arena-runner-git-sync-arena-start-content-"));
  const branch = "arena/project-test";

  try {
    const { remote, seed } = createRemoteWithSeed(root, branch);
    writeFileSync(join(seed, "arena-start.sh"), "#!/usr/bin/env bash\nnode server.mjs\n");
    run(seed, "git add arena-start.sh");
    run(seed, "git commit -m add-start-script");
    run(seed, `git push origin ${q(branch)}`);

    const workspace = join(root, "workspace");
    run(root, `git clone --branch ${q(branch)} ${q(remote)} ${q(workspace)}`);
    writeFileSync(join(workspace, "arena-start.sh"), "#!/usr/bin/env bash\nnpm start\n");

    assert.throws(
      () => gitSyncBranchToRemoteHead(workspace, branch, { restoreRunnerManagedDirtyPaths: true }),
      WorkspaceDirtyBeforeSyncError,
    );
    assert.match(run(workspace, "git status --porcelain"), /arena-start\.sh/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("rejects dirty tracked database files before syncing instead of hiding source-path runtime data", () => {
  const root = mkdtempSync(join(tmpdir(), "arena-runner-git-sync-db-file-dirty-"));
  const branch = "arena/project-test";

  try {
    const { remote, seed } = createRemoteWithSeed(root, branch);
    writeFileSync(join(seed, "data.sqlite"), "db-v1\n");
    run(seed, "git add data.sqlite");
    run(seed, "git commit -m add-db-file");
    run(seed, `git push origin ${q(branch)}`);

    const workspace = join(root, "workspace");
    run(root, `git clone --branch ${q(branch)} ${q(remote)} ${q(workspace)}`);
    writeFileSync(join(workspace, "data.sqlite"), "runtime-dirty-db\n");

    assert.throws(
      () => gitSyncBranchToRemoteHead(workspace, branch, { restoreRunnerManagedDirtyPaths: true }),
      WorkspaceDirtyBeforeSyncError,
    );
    assert.equal(run(workspace, "git status --porcelain"), "M data.sqlite");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("rejects generated videos before syncing instead of deleting app runtime data", () => {
  const root = mkdtempSync(join(tmpdir(), "arena-runner-git-sync-generated-video-dirty-"));
  const branch = "arena/project-test";

  try {
    const { remote } = createRemoteWithSeed(root, branch);
    const workspace = join(root, "workspace");
    run(root, `git clone --branch ${q(branch)} ${q(remote)} ${q(workspace)}`);
    mkdirSync(join(workspace, "generated/videos"), { recursive: true });
    writeFileSync(join(workspace, "generated/videos/preview.mp4"), "app runtime video\n");

    assert.throws(
      () => gitSyncBranchToRemoteHead(workspace, branch, { restoreRunnerManagedDirtyPaths: true }),
      WorkspaceDirtyBeforeSyncError,
    );
    assert.equal(run(workspace, "git status --porcelain"), "?? generated/");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("restores verifier-generated visual snapshots before syncing", () => {
  const root = mkdtempSync(join(tmpdir(), "arena-runner-git-sync-visual-snapshots-"));
  const branch = "arena/project-test";

  try {
    const { remote, seed } = createRemoteWithSeed(root, branch);
    mkdirSync(join(seed, "generated/visual-responsive-snapshots"), { recursive: true });
    writeFileSync(join(seed, "generated/visual-responsive-snapshots/mobile.png"), "snapshot-v1\n");
    run(seed, "git add generated/visual-responsive-snapshots/mobile.png");
    run(seed, "git commit -m add-visual-snapshot");
    run(seed, `git push origin ${q(branch)}`);

    const workspace = join(root, "workspace");
    run(root, `git clone --branch ${q(branch)} ${q(remote)} ${q(workspace)}`);
    writeFileSync(join(workspace, "generated/visual-responsive-snapshots/mobile.png"), "snapshot-v2\n");
    writeFileSync(join(workspace, "generated/visual-responsive-snapshots/new-mobile.png"), "snapshot-new\n");

    gitSyncBranchToRemoteHead(workspace, branch, { restoreRunnerManagedDirtyPaths: true });

    assert.equal(run(workspace, "git status --porcelain -uall"), "");
    assert.equal(run(workspace, "cat generated/visual-responsive-snapshots/mobile.png"), "snapshot-v1");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("still rejects app code changes when replayable restore is allowed", () => {
  const root = mkdtempSync(join(tmpdir(), "arena-runner-git-sync-replayable-app-dirty-"));
  const branch = "arena/project-test";

  try {
    const { remote } = createRemoteWithSeed(root, branch);
    const workspace = join(root, "workspace");
    run(root, `git clone --branch ${q(branch)} ${q(remote)} ${q(workspace)}`);
    writeFileSync(join(workspace, "app.txt"), "dirty\n");

    assert.throws(
      () => gitSyncBranchToRemoteHead(workspace, branch, { restoreRunnerManagedDirtyPaths: true }),
      /uncommitted changes before repo sync/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("still rejects non-video generated files when replayable restore is allowed", () => {
  const root = mkdtempSync(join(tmpdir(), "arena-runner-git-sync-replayable-generated-dirty-"));
  const branch = "arena/project-test";

  try {
    const { remote } = createRemoteWithSeed(root, branch);
    const workspace = join(root, "workspace");
    run(root, `git clone --branch ${q(branch)} ${q(remote)} ${q(workspace)}`);
    mkdirSync(join(workspace, "generated/data"), { recursive: true });
    writeFileSync(join(workspace, "generated/data/app.json"), "{}\n");

    assert.throws(
      () => gitSyncBranchToRemoteHead(workspace, branch, { restoreRunnerManagedDirtyPaths: true }),
      /uncommitted changes before repo sync/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("still rejects plan truth changes when replayable restore is allowed", () => {
  const root = mkdtempSync(join(tmpdir(), "arena-runner-git-sync-replayable-plan-dirty-"));
  const branch = "arena/project-test";

  try {
    const { remote, seed } = createRemoteWithSeed(root, branch);
    addRunnerManagedFiles(seed, branch);
    writeFileSync(join(seed, ".ralph/plan.json"), "{\"items\":[]}\n");
    run(seed, "git add .ralph/plan.json");
    run(seed, "git commit -m add-plan");
    run(seed, `git push origin ${q(branch)}`);

    const workspace = join(root, "workspace");
    run(root, `git clone --branch ${q(branch)} ${q(remote)} ${q(workspace)}`);
    writeFileSync(join(workspace, ".ralph/plan.json"), "{\"dirty\":true}\n");

    assert.throws(
      () => gitSyncBranchToRemoteHead(workspace, branch, { restoreRunnerManagedDirtyPaths: true }),
      /uncommitted changes before repo sync/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("allows dirty agent resume when local head still matches remote head", () => {
  const root = mkdtempSync(join(tmpdir(), "arena-runner-git-sync-dirty-agent-resume-"));
  const branch = "arena/project-test";

  try {
    const { remote } = createRemoteWithSeed(root, branch);
    const workspace = join(root, "workspace");
    run(root, `git clone --branch ${q(branch)} ${q(remote)} ${q(workspace)}`);
    const head = run(workspace, "git rev-parse HEAD");
    writeFileSync(join(workspace, "app.txt"), "dirty wip\n");

    gitSyncBranchToRemoteHead(workspace, branch, {
      restoreRunnerManagedDirtyPaths: true,
      pushLocalAheadBeforeSync: true,
      allowDirtyAgentResume: true,
      expectedRepoUrl: remote,
    });

    assert.equal(run(workspace, "git rev-parse HEAD"), head);
    assert.equal(run(workspace, `git rev-list --left-right --count HEAD...origin/${branch}`), "0\t0");
    assert.equal(run(workspace, "git status --porcelain"), "M app.txt");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("rejects dirty agent resume when workspace is on a different branch", () => {
  const root = mkdtempSync(join(tmpdir(), "arena-runner-git-sync-dirty-agent-wrong-branch-"));
  const branch = "arena/project-test";

  try {
    const { remote } = createRemoteWithSeed(root, branch);
    const workspace = join(root, "workspace");
    run(root, `git clone --branch ${q(branch)} ${q(remote)} ${q(workspace)}`);
    run(workspace, "git checkout -b other-work");
    writeFileSync(join(workspace, "app.txt"), "dirty wip\n");

    assert.throws(
      () => gitSyncBranchToRemoteHead(workspace, branch, { allowDirtyAgentResume: true }),
      WorkspaceDirtyBeforeSyncError,
    );
    assert.equal(run(workspace, "git branch --show-current"), "other-work");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("rejects dirty agent resume when remote advanced", () => {
  const root = mkdtempSync(join(tmpdir(), "arena-runner-git-sync-dirty-agent-remote-ahead-"));
  const branch = "arena/project-test";

  try {
    const { remote, seed } = createRemoteWithSeed(root, branch);
    const workspace = join(root, "workspace");
    run(root, `git clone --branch ${q(branch)} ${q(remote)} ${q(workspace)}`);
    writeFileSync(join(workspace, "app.txt"), "dirty wip\n");

    writeFileSync(join(seed, "app.txt"), "remote v2\n");
    run(seed, "git add app.txt");
    run(seed, "git commit -m remote-update");
    run(seed, `git push origin ${q(branch)}`);

    assert.throws(
      () => gitSyncBranchToRemoteHead(workspace, branch, { allowDirtyAgentResume: true }),
      WorkspaceDirtyBeforeSyncError,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("rejects dirty agent resume when workspace origin does not match configured repo", () => {
  const root = mkdtempSync(join(tmpdir(), "arena-runner-git-sync-dirty-agent-wrong-origin-"));
  const branch = "arena/project-test";

  try {
    mkdirSync(join(root, "expected"));
    mkdirSync(join(root, "other"));
    const { remote } = createRemoteWithSeed(join(root, "expected"), branch);
    const { remote: otherRemote } = createRemoteWithSeed(join(root, "other"), branch);
    const workspace = join(root, "workspace");
    run(root, `git clone --branch ${q(branch)} ${q(remote)} ${q(workspace)}`);
    run(workspace, `git remote set-url origin ${q(otherRemote)}`);
    writeFileSync(join(workspace, "app.txt"), "dirty wip\n");

    assert.throws(
      () => gitSyncBranchToRemoteHead(workspace, branch, {
        allowDirtyAgentResume: true,
        expectedRepoUrl: remote,
      }),
      /Workspace origin does not match configured repo/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("rejects clean sync when workspace origin does not match configured repo", () => {
  const root = mkdtempSync(join(tmpdir(), "arena-runner-git-sync-clean-wrong-origin-"));
  const branch = "arena/project-test";

  try {
    mkdirSync(join(root, "expected"));
    mkdirSync(join(root, "other"));
    const { remote } = createRemoteWithSeed(join(root, "expected"), branch);
    const { remote: otherRemote } = createRemoteWithSeed(join(root, "other"), branch);
    const workspace = join(root, "workspace");
    run(root, `git clone --branch ${q(branch)} ${q(remote)} ${q(workspace)}`);
    run(workspace, `git remote set-url origin ${q(otherRemote)}`);

    assert.throws(
      () => gitSyncBranchToRemoteHead(workspace, branch, { expectedRepoUrl: remote }),
      /Workspace origin does not match configured repo/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("preview-style sync still rejects dirty source work when remote is unchanged", () => {
  const root = mkdtempSync(join(tmpdir(), "arena-runner-git-sync-preview-dirty-boundary-"));
  const branch = "arena/project-test";

  try {
    const { remote } = createRemoteWithSeed(root, branch);
    const workspace = join(root, "workspace");
    run(root, `git clone --branch ${q(branch)} ${q(remote)} ${q(workspace)}`);
    writeFileSync(join(workspace, "app.txt"), "dirty source work\n");

    assert.throws(
      () => gitSyncBranchToRemoteHead(workspace, branch, {
        restoreRunnerManagedDirtyPaths: true,
        pushLocalAheadBeforeSync: true,
        expectedRepoUrl: remote,
      }),
      WorkspaceDirtyBeforeSyncError,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("rejects local-only commits before syncing to remote head", () => {
  const root = mkdtempSync(join(tmpdir(), "arena-runner-git-sync-ahead-"));
  const branch = "arena/project-test";

  try {
    const { remote } = createRemoteWithSeed(root, branch);
    const workspace = join(root, "workspace");
    run(root, `git clone --branch ${q(branch)} ${q(remote)} ${q(workspace)}`);
    ensureLocalGitIdentity(workspace);
    writeFileSync(join(workspace, "local.txt"), "local\n");
    run(workspace, "git add local.txt");
    run(workspace, "git commit -m local-only");

    assert.throws(
      () => gitSyncBranchToRemoteHead(workspace, branch),
      /local commit\(s\) not on origin\/arena\/project-test/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("pushes clean local-only commits before syncing when source delivery recovery is enabled", () => {
  const root = mkdtempSync(join(tmpdir(), "arena-runner-git-sync-ahead-push-"));
  const branch = "arena/project-test";

  try {
    const { remote } = createRemoteWithSeed(root, branch);
    const workspace = join(root, "workspace");
    run(root, `git clone --branch ${q(branch)} ${q(remote)} ${q(workspace)}`);
    ensureLocalGitIdentity(workspace);
    writeFileSync(join(workspace, "local.txt"), "local\n");
    run(workspace, "git add local.txt");
    run(workspace, "git commit -m local-only");

    gitSyncBranchToRemoteHead(workspace, branch, { pushLocalAheadBeforeSync: true });

    assert.equal(run(workspace, `git rev-list --left-right --count HEAD...origin/${q(branch)}`), "0\t0");
    assert.equal(run(workspace, "git show origin/arena/project-test:local.txt"), "local");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

function createRemoteWithSeed(root, branch) {
  const remote = join(root, "remote.git");
  const seed = join(root, "seed");
  run(root, `git init --bare ${q(remote)}`);
  run(root, `git init ${q(seed)}`);
  ensureLocalGitIdentity(seed);
  run(seed, `git checkout -b ${q(branch)}`);
  writeFileSync(join(seed, "app.txt"), "v1\n");
  run(seed, "git add app.txt");
  run(seed, "git commit -m initial");
  run(seed, `git remote add origin ${q(remote)}`);
  run(seed, `git push -u origin ${q(branch)}`);
  return { remote, seed };
}

function addRunnerManagedFiles(seed, branch) {
  mkdirSync(join(seed, "specs"), { recursive: true });
  mkdirSync(join(seed, ".ralph"), { recursive: true });
  writeFileSync(join(seed, "spec.md"), "tracked spec\n");
  writeFileSync(join(seed, "specs/001-evolution.md"), "tracked spec file\n");
  writeFileSync(join(seed, "CLAUDE.md"), "tracked platform stamp\n");
  writeFileSync(join(seed, ".ralph/iteration-log.json"), "[]\n");
  writeFileSync(join(seed, ".ralph/ralph-progress.json"), "{\"currentState\":\"completed\"}\n");
  run(seed, "git add spec.md specs/001-evolution.md CLAUDE.md .ralph/iteration-log.json .ralph/ralph-progress.json");
  run(seed, "git commit -m add-runner-managed-files");
  run(seed, `git push origin ${q(branch)}`);
}

function managedGitignore() {
  return [
    "",
    RALPH_GITIGNORE_MANAGED_SECTION_START,
    "# Detected stack: generic",
    "node_modules/",
    ".arena/*",
    RALPH_GITIGNORE_MANAGED_SECTION_END,
    "",
  ].join("\n");
}

function run(cwd, cmd) {
  return execSync(cmd, {
    cwd,
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf8",
  }).trim();
}

function q(value) {
  return `'${value.replace(/'/g, "'\\''")}'`;
}
