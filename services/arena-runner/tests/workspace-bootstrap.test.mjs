import test from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { cloneHostRepoIntoWorkspacePreservingBootstrapStartScript } from "../dist/workspace-bootstrap.js";

test("preserves bootstrap arena-start.sh across A2E host-repo workspace clone", () => {
  const root = mkdtempSync(join(tmpdir(), "arena-runner-bootstrap-"));
  const hostRepo = join(root, "host-repo");
  const workspace = join(root, "workspace");

  try {
    mkdirSync(join(hostRepo, "src"), { recursive: true });
    mkdirSync(workspace, { recursive: true });
    writeFileSync(join(hostRepo, "README.md"), "host repo\n");
    writeFileSync(join(workspace, "arena-start.sh"), "#!/bin/sh\necho preserved\n");
    writeFileSync(join(workspace, "stale.txt"), "remove me\n");

    cloneHostRepoIntoWorkspacePreservingBootstrapStartScript(hostRepo, workspace, {
      cloneRepo: (sourcePath, targetPath) => {
        rmSync(targetPath, { recursive: true, force: true });
        cpSync(sourcePath, targetPath, { recursive: true });
      },
    });

    assert.equal(readFileSync(join(workspace, "README.md"), "utf8"), "host repo\n");
    assert.equal(readFileSync(join(workspace, "arena-start.sh"), "utf8"), "#!/bin/sh\necho preserved\n");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
