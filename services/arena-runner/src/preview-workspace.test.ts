import { describe, expect, it } from "vitest";
import {
  evaluatePreviewWorkspace,
  resolvePreviewRestoreBranches,
} from "./preview-workspace.ts";

describe("resolvePreviewRestoreBranches", () => {
  it("prefers the project branch before the configured base branch", () => {
    expect(resolvePreviewRestoreBranches({
      repoBranch: "main",
      projectBranch: "arena/project-proj-1",
    })).toEqual([
      "arena/project-proj-1",
      "main",
    ]);
  });

  it("deduplicates identical branch candidates", () => {
    expect(resolvePreviewRestoreBranches({
      repoBranch: "arena/project-proj-1",
      projectBranch: "arena/project-proj-1",
    })).toEqual([
      "arena/project-proj-1",
    ]);
  });
});

describe("evaluatePreviewWorkspace", () => {
  it("reuses workspaces already checked out on the project branch", () => {
    expect(evaluatePreviewWorkspace(
      {
        exists: true,
        isGitRepo: true,
        originUrl: "https://github.com/example/repo",
        branch: "arena/project-proj-1",
        commitSha: null,
      },
      {
        repoUrl: "https://github.com/example/repo",
        repoBranch: "main",
        projectBranch: "arena/project-proj-1",
        commitSha: null,
      },
    )).toEqual({
      reuseExistingWorkspace: true,
      reasonCode: "workspace_matches_repo",
      reasonMessage: "workspace matches configured repo snapshot",
    });
  });

  it("refreshes base-branch workspaces when preview restore should prefer the project branch", () => {
    expect(evaluatePreviewWorkspace(
      {
        exists: true,
        isGitRepo: true,
        originUrl: "https://github.com/example/repo",
        branch: "main",
        commitSha: null,
      },
      {
        repoUrl: "https://github.com/example/repo",
        repoBranch: "main",
        projectBranch: "arena/project-proj-1",
        commitSha: null,
      },
    )).toEqual({
      reuseExistingWorkspace: false,
      reasonCode: "branch_mismatch",
      reasonMessage: "workspace branch does not match configured repo branch",
    });
  });
});
