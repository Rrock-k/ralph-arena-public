import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

function makeFakeCodex(binDir) {
  const path = join(binDir, "codex");
  writeFileSync(path, `#!/usr/bin/env bash
echo call >> "$FAKE_CODEX_CALLS"
echo "ERROR: Quota exceeded. Check your plan and billing details." >&2
exit 1
`);
  chmodSync(path, 0o755);
  return path;
}

function runDirectCycle(version) {
  const root = mkdtempSync(join(tmpdir(), `arena-direct-${version}-`));
  const binDir = join(root, "bin");
  const workDir = join(root, "workspace");
  const specDir = join(workDir, "specs");
  const callsFile = join(root, "codex-calls.txt");
  mkdirSync(binDir, { recursive: true });
  mkdirSync(specDir, { recursive: true });
  makeFakeCodex(binDir);
  writeFileSync(join(specDir, "spec.md"), "# Spec\n\nBuild a small web app.");

  const script = join(process.cwd(), "dist", "cycles", "direct", `${version}.js`);
  const result = spawnSync(process.execPath, [
    script,
    "--agent",
    "codex",
    "--spec-dir",
    specDir,
    "--work-dir",
    workDir,
  ], {
    cwd: workDir,
    env: {
      ...process.env,
      PATH: `${binDir}:${process.env.PATH ?? ""}`,
      FAKE_CODEX_CALLS: callsFile,
      DIRECT_MAX_ITERATIONS: "3",
      ARENA_PROJECT_ID: `direct-${version}`,
    },
    encoding: "utf8",
  });

  const terminal = JSON.parse(readFileSync(join(workDir, ".arena", "result.json"), "utf8"));
  const progress = JSON.parse(readFileSync(join(workDir, ".arena", "progress.json"), "utf8"));
  const callCount = readFileSync(callsFile, "utf8").trim().split("\n").filter(Boolean).length;
  return { result, terminal, progress, callCount };
}

for (const version of ["v1.0.0", "v1.1.0"]) {
  test(`direct ${version} parks provider quota output before max iterations`, () => {
    const { result, terminal, progress, callCount } = runDirectCycle(version);

    assert.equal(result.status, 0, `${result.stderr}\n${result.stdout}`);
    assert.equal(callCount, 1);
    assert.deepEqual(terminal, {
      status: "CANCELED",
      reason: "Agent hit provider rate limit. Retry scheduled by governance.",
      pauseReason: "RATE_LIMIT",
    });
    assert.equal(progress.state, "paused_rate_limit");
    assert.equal(progress.iteration, 1);
    assert.doesNotMatch(terminal.reason, /Max iterations/);
  });
}
