import { describe, expect, it } from "vitest";
import {
  evaluatePreviewWorkspace,
  isRalphManagedGitignoreOnlyChange,
  isRunnerManagedReplayableDirtyEntry,
  isRunnerManagedReplayablePath,
  parseGitPorcelainStatusEntries,
  RALPH_GITIGNORE_MANAGED_SECTION_END,
  RALPH_GITIGNORE_MANAGED_SECTION_START,
  resolvePreviewRestoreBranches,
} from "../preview-workspace.js";

describe("preview workspace helpers", () => {
  it("prefers project branch before base branch", () => {
    expect(resolvePreviewRestoreBranches({
      repoBranch: "main",
      projectBranch: "arena/project-proj-1",
    })).toEqual(["arena/project-proj-1", "main"]);
  });

  it("evaluates matching workspaces without caller-specific fallback logic", () => {
    expect(evaluatePreviewWorkspace(
      {
        exists: true,
        isGitRepo: true,
        originUrl: "https://github.com/example/repo.git",
        branch: "main",
        commitSha: null,
      },
      {
        repoUrl: "https://github.com/example/repo",
        repoBranch: "main",
        projectBranch: null,
        commitSha: null,
      },
    )).toEqual({
      reuseExistingWorkspace: true,
      reasonCode: "workspace_matches_repo",
      reasonMessage: "workspace matches configured repo snapshot",
    });
  });

  it("keeps runner-managed dirty path policy in one exported helper", () => {
    expect(isRunnerManagedReplayablePath("CLAUDE.md")).toBe(true);
    expect(isRunnerManagedReplayablePath(".arena/platform.md")).toBe(true);
    expect(isRunnerManagedReplayablePath(".ralph/logs/run.log")).toBe(true);
    expect(isRunnerManagedReplayablePath(".ralph/prompt-trace.jsonl")).toBe(true);
    expect(isRunnerManagedReplayablePath(".ralph/tasks/task-001/plan.md")).toBe(true);
    expect(isRunnerManagedReplayablePath("specs/product.md")).toBe(true);
    expect(isRunnerManagedReplayablePath("generated/visual-responsive-snapshots/mobile.png")).toBe(true);
    expect(isRunnerManagedReplayablePath(".gitignore")).toBe(false);
    expect(isRunnerManagedReplayablePath(".ralph/plan.json")).toBe(false);
    expect(isRunnerManagedReplayablePath("generated/videos/preview.mp4")).toBe(false);
    expect(isRunnerManagedReplayablePath("generated/data/app.json")).toBe(false);
    expect(isRunnerManagedReplayablePath("arena-start.sh")).toBe(false);
    expect(isRunnerManagedReplayablePath("src/App.tsx")).toBe(false);
  });

  it("parses git porcelain status entries once for operator and capture callers", () => {
    expect(parseGitPorcelainStatusEntries([
      " M arena-start.sh",
      "?? .arena/platform.md",
      "R  old.ts -> src/new.ts",
      ' M "src/quoted path.ts"',
    ].join("\n"))).toEqual([
      { code: " M", path: "arena-start.sh" },
      { code: "??", path: ".arena/platform.md" },
      { code: "R ", path: "src/new.ts" },
      { code: " M", path: "src/quoted path.ts" },
    ]);
  });

  it("allows only Ralph-managed gitignore changes through dirty entry policy", () => {
    const managedGitignore = [
      "",
      RALPH_GITIGNORE_MANAGED_SECTION_START,
      "# Detected stack: generic",
      "node_modules/",
      ".arena/*",
      RALPH_GITIGNORE_MANAGED_SECTION_END,
      "",
    ].join("\n");

    expect(isRalphManagedGitignoreOnlyChange("", managedGitignore)).toBe(true);
    expect(isRunnerManagedReplayableDirtyEntry({
      path: ".gitignore",
      headContent: "",
      worktreeContent: managedGitignore,
    })).toBe(true);
    expect(isRunnerManagedReplayableDirtyEntry({
      path: ".gitignore",
      headContent: "*.tmp\n",
      worktreeContent: `*.tmp\n${managedGitignore}`,
    })).toBe(true);
    expect(isRunnerManagedReplayableDirtyEntry({
      path: ".gitignore",
      headContent: "*.tmp\n",
      worktreeContent: `*.tmp\n.env.local\n${managedGitignore}`,
    })).toBe(false);
    expect(isRunnerManagedReplayableDirtyEntry({
      path: "assets/telegram/chat-1/msg-2/reference.png",
    })).toBe(true);
  });

  it("allows arena-start mode-only dirty entries but blocks content edits", () => {
    expect(isRunnerManagedReplayableDirtyEntry({
      path: "arena-start.sh",
      headContent: "#!/usr/bin/env bash\nnode server.mjs\n",
      worktreeContent: "#!/usr/bin/env bash\nnode server.mjs\n",
    })).toBe(true);
    expect(isRunnerManagedReplayableDirtyEntry({
      path: "arena-start.sh",
      headContent: "#!/usr/bin/env bash\nnode server.mjs\n",
      worktreeContent: "#!/usr/bin/env bash\nnpm start\n",
    })).toBe(false);
    expect(isRunnerManagedReplayableDirtyEntry({
      path: "arena-start.sh",
      headContent: null,
      worktreeContent: "#!/usr/bin/env bash\nnode server.mjs\n",
    })).toBe(false);
  });
});
