import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { pruneArenaContractBallast } from "../dist/arena-contract.js";

test("removes legacy loop-internal files and directories from .arena", () => {
  const workspace = mkdtempSync(join(tmpdir(), "arena-contract-"));
  const arenaDir = join(workspace, ".arena");

  try {
    mkdirSync(arenaDir, { recursive: true });
    writeFileSync(join(arenaDir, "plan.json"), "{}");
    writeFileSync(join(arenaDir, "ralph-progress.json"), "{}");
    writeFileSync(join(arenaDir, "progress.json"), "{}");
    writeFileSync(join(arenaDir, "ralph.config.json"), JSON.stringify({ visualWorkbench: {} }));
    writeFileSync(join(arenaDir, "result.json"), "{}");
    mkdirSync(join(arenaDir, "controller-reports"), { recursive: true });
    writeFileSync(join(arenaDir, "controller-reports", "report.md"), "legacy");

    const removed = pruneArenaContractBallast(workspace);

    assert.deepEqual(removed, [
      "controller-reports",
      "plan.json",
      "ralph-progress.json",
    ]);
    assert.equal(existsSync(join(arenaDir, "progress.json")), true);
    assert.equal(existsSync(join(arenaDir, "ralph.config.json")), true);
    assert.equal(existsSync(join(arenaDir, "result.json")), true);
    assert.equal(existsSync(join(arenaDir, "plan.json")), false);
    assert.equal(existsSync(join(arenaDir, "ralph-progress.json")), false);
    assert.equal(existsSync(join(arenaDir, "controller-reports")), false);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("does nothing when .arena does not exist yet", () => {
  const workspace = mkdtempSync(join(tmpdir(), "arena-contract-empty-"));

  try {
    assert.deepEqual(pruneArenaContractBallast(workspace), []);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});
