import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  buildResourceKilledTerminalReport,
  isResourceKilledExit,
  readCgroupMemoryEvents,
} from "./resource-forensics.js";

test("isResourceKilledExit detects exit 137 and SIGKILL", () => {
  assert.equal(isResourceKilledExit({ exitCode: 137, signal: null }), true);
  assert.equal(isResourceKilledExit({ exitCode: 1, signal: "SIGKILL" }), true);
  assert.equal(isResourceKilledExit({ exitCode: 1, signal: "SIGTERM" }), false);
});

test("readCgroupMemoryEvents parses cgroup v2 memory events", () => {
  const dir = mkdtempSync(join(tmpdir(), "arena-runner-cgroup-"));
  try {
    writeFileSync(join(dir, "memory.events"), "low 0\nhigh 2\nmax 3\noom 1\noom_kill 1\n");

    assert.deepEqual(readCgroupMemoryEvents(dir), {
      low: 0,
      high: 2,
      max: 3,
      oom: 1,
      oom_kill: 1,
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("buildResourceKilledTerminalReport produces INFRA pause with bounded forensics", () => {
  const dir = mkdtempSync(join(tmpdir(), "arena-runner-cgroup-"));
  try {
    writeFileSync(join(dir, "memory.events"), "oom 1\noom_kill 1\n");
    writeFileSync(join(dir, "memory.current"), "1000\n");
    writeFileSync(join(dir, "memory.max"), "1000\n");
    writeFileSync(join(dir, "pids.current"), "95\n");
    writeFileSync(join(dir, "pids.max"), "100\n");

    const report = buildResourceKilledTerminalReport({
      exitCode: 137,
      signal: "SIGKILL",
      lastProgressState: "coding",
    }, {
      cgroupRoot: dir,
      capturedAt: "2026-06-06T00:00:00.000Z",
    });

    assert.equal(report?.terminalState, "CANCELED");
    assert.equal(report?.pauseReason, "INFRA");
    assert.equal(report?.reasonCode, "resource_killed");
    assert.equal(
      report?.reasonMessage,
      "Agent loop process was killed by SIGKILL/exit 137 before writing result.json.",
    );
    assert.equal(report?.forensics.exitCode, 137);
    assert.equal(report?.forensics.signal, "SIGKILL");
    assert.equal(report?.forensics.lastProgressState, "coding");
    assert.deepEqual(report?.forensics.cgroupMemoryEvents, {
      oom: 1,
      oom_kill: 1,
    });
    assert.deepEqual(report?.forensics.resourcePressure?.reasons, [
      "cgroup_oom_kill",
      "cgroup_pid_pressure",
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("buildResourceKilledTerminalReport includes interrupted workspace WIP preview", () => {
  const report = buildResourceKilledTerminalReport({
    exitCode: 137,
    signal: "SIGKILL",
    lastProgressState: "coding",
  }, {
    cgroupRoot: "/missing-cgroup-root",
    workspaceStatusPreview: " M .ralph/plan.json;  M server.js",
  });

  assert.equal(
    report?.reasonMessage,
    "Agent loop process was killed by SIGKILL/exit 137 before writing result.json. Workspace has interrupted WIP: M .ralph/plan.json;  M server.js.",
  );
});
