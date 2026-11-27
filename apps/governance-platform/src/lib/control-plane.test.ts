import path from "node:path";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";

import { getWorkspaceBackupRoot, getWorkspaceRoot } from "./control-plane";

const ORIGINAL_ARENA_WORKSPACE_ROOT = process.env.ARENA_PROJECT_WORKSPACES_ROOT;
const ORIGINAL_ARENA_BACKUP_ROOT = process.env.ARENA_WORKSPACE_BACKUP_ROOT;
const ORIGINAL_ARENA_HOME_PATH = process.env.ARENA_HOME_PATH;

describe("control-plane workspace roots", () => {
  afterEach(() => {
    if (ORIGINAL_ARENA_WORKSPACE_ROOT === undefined) delete process.env.ARENA_PROJECT_WORKSPACES_ROOT;
    else process.env.ARENA_PROJECT_WORKSPACES_ROOT = ORIGINAL_ARENA_WORKSPACE_ROOT;

    if (ORIGINAL_ARENA_BACKUP_ROOT === undefined) delete process.env.ARENA_WORKSPACE_BACKUP_ROOT;
    else process.env.ARENA_WORKSPACE_BACKUP_ROOT = ORIGINAL_ARENA_BACKUP_ROOT;

    if (ORIGINAL_ARENA_HOME_PATH === undefined) delete process.env.ARENA_HOME_PATH;
    else process.env.ARENA_HOME_PATH = ORIGINAL_ARENA_HOME_PATH;
  });

  it("prefers configured workspace root", () => {
    process.env.ARENA_PROJECT_WORKSPACES_ROOT = "/tmp/custom-workspaces";

    expect(getWorkspaceRoot()).toBe("/tmp/custom-workspaces");
  });

  it("defaults local workspace root outside the repo", () => {
    delete process.env.ARENA_PROJECT_WORKSPACES_ROOT;
    delete process.env.ARENA_WORKSPACE_BACKUP_ROOT;
    process.env.ARENA_HOME_PATH = "/tmp/arena-home";

    expect(getWorkspaceRoot()).toBe("/tmp/arena-home/.arena-runtime/project-workspaces");
    expect(getWorkspaceBackupRoot()).toBe("/tmp/arena-home/runtime-backup-pre-ra-237");
  });
});

describe("getExpectedRunnerVersion", () => {
  it("returns incomplete truth from a nested app cwd when path-scoped git history is unavailable", async () => {
    const originalCwd = process.cwd();

    try {
      process.chdir(path.join(originalCwd, "src"));
      vi.resetModules();
      vi.doMock("node:child_process", () => ({
        execFileSync: vi.fn(() => {
          throw new Error("git unavailable");
        }),
      }));

      const controlPlane = await import("./control-plane");
      expect(controlPlane.getExpectedRunnerVersion()).toBeNull();
    } finally {
      vi.doUnmock("node:child_process");
      vi.resetModules();
      process.chdir(originalCwd);
    }
  });

  it("prefers the latest worker-service-affecting sha over unrelated repo head drift", async () => {
    vi.resetModules();
    const execFileSync = vi.fn((_: string, args?: string[]) => {
      if (Array.isArray(args) && args[0] === "log") {
        return "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\n";
      }
      if (Array.isArray(args) && args[0] === "rev-parse") {
        return "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\n";
      }
      throw new Error(`unexpected git args: ${String(args)}`);
    });

    try {
      vi.doMock("node:child_process", () => ({ execFileSync }));
      const controlPlane = await import("./control-plane");
      expect(controlPlane.getExpectedRunnerVersion()).toBe("bbbbbbbbbbbb");
    } finally {
      vi.doUnmock("node:child_process");
      vi.resetModules();
    }
  });

  it("returns incomplete truth instead of raw repo head when path-scoped worker history is unavailable", async () => {
    vi.resetModules();

    try {
      vi.doMock("node:child_process", () => ({
        execFileSync: vi.fn(() => {
          throw new Error("git unavailable");
        }),
      }));

      const controlPlane = await import("./control-plane");
      expect(controlPlane.getExpectedRunnerVersion()).toBeNull();
    } finally {
      vi.doUnmock("node:child_process");
      vi.resetModules();
    }
  });

  it("re-reads expected runner version instead of freezing startup sha", async () => {
    const originalCwd = process.cwd();
    const tmpCwd = mkdtempSync(path.join(tmpdir(), "control-plane-expected-sha-"));
    let currentSha = "aaaaaaaaaaaa";

    try {
      process.chdir(tmpCwd);
      vi.resetModules();
      vi.doMock("node:child_process", () => ({
        execFileSync: vi.fn(() => `${currentSha}\n`),
      }));

      const controlPlane = await import("./control-plane");
      expect(controlPlane.getExpectedRunnerVersion()).toBe("aaaaaaaaaaaa");

      currentSha = "bbbbbbbbbbbb";
      expect(controlPlane.getExpectedRunnerVersion()).toBe("bbbbbbbbbbbb");
    } finally {
      vi.doUnmock("node:child_process");
      vi.resetModules();
      process.chdir(originalCwd);
    }
  });
});
