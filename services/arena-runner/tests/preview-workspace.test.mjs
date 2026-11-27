import test from "node:test";
import assert from "node:assert/strict";

import { evaluatePreviewWorkspace, normalizeRepoUrl } from "../dist/preview-workspace.js";

test("normalizes authenticated https remotes before comparison", () => {
  assert.equal(
    normalizeRepoUrl("https://x-access-token:placeholder-token@github.com/example-owner/ralph-sql-trainer-o946zo.git"),
    "https://github.com/example-owner/ralph-sql-trainer-o946zo",
  );
});

test("refreshes preview workspace when repo origin differs", () => {
  const decision = evaluatePreviewWorkspace(
    {
      exists: true,
      isGitRepo: true,
      originUrl: "https://github.com/example-owner/arena-sql-trainer-iner",
      branch: "main",
      commitSha: "abc123",
    },
    {
      repoUrl: "https://x-access-token:placeholder-token@github.com/example-owner/ralph-sql-trainer-o946zo",
      repoBranch: "ralph-run-cmm0ttq5700042gn4mqo946zo",
      commitSha: "c9caffa",
    },
  );

  assert.equal(decision.reuseExistingWorkspace, false);
  assert.equal(decision.reasonCode, "origin_mismatch");
});

test("refreshes preview workspace when archived commit does not match", () => {
  const decision = evaluatePreviewWorkspace(
    {
      exists: true,
      isGitRepo: true,
      originUrl: "https://github.com/example-owner/ralph-sql-trainer-o946zo",
      branch: "ralph-run-cmm0ttq5700042gn4mqo946zo",
      commitSha: "oldsha",
    },
    {
      repoUrl: "https://github.com/example-owner/ralph-sql-trainer-o946zo",
      repoBranch: "ralph-run-cmm0ttq5700042gn4mqo946zo",
      commitSha: "newsha",
    },
  );

  assert.equal(decision.reuseExistingWorkspace, false);
  assert.equal(decision.reasonCode, "commit_mismatch");
});

test("reuses preview workspace when repo snapshot matches", () => {
  const decision = evaluatePreviewWorkspace(
    {
      exists: true,
      isGitRepo: true,
      originUrl: "https://x-access-token:placeholder-token@github.com/example-owner/ralph-sql-trainer-o946zo",
      branch: "ralph-run-cmm0ttq5700042gn4mqo946zo",
      commitSha: "c9caffa",
    },
    {
      repoUrl: "https://github.com/example-owner/ralph-sql-trainer-o946zo",
      repoBranch: "ralph-run-cmm0ttq5700042gn4mqo946zo",
      commitSha: "c9caffa",
    },
  );

  assert.equal(decision.reuseExistingWorkspace, true);
  assert.equal(decision.reasonCode, "workspace_matches_repo");
});
