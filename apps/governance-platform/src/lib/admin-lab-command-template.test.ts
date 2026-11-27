import { describe, expect, it } from "vitest";
import {
  applyCommandPlaceholderValues,
  formatCommandPlaceholderLabel,
  getCommandPlaceholderCompletion,
  getCommandPlaceholders,
  getSnapshotCommandInputHints,
  shellQuoteCommandValue,
} from "./admin-lab-command-template";

describe("Admin Lab command templates", () => {
  it("lists placeholders once in command order", () => {
    expect(getCommandPlaceholders("run --snapshot <snapshot.json> --again <snapshot.json> --model <model>")).toEqual([
      "<snapshot.json>",
      "<model>",
    ]);
  });

  it("formats placeholder labels without changing the command token itself", () => {
    expect(formatCommandPlaceholderLabel("<project-stage-snapshot.json>")).toBe("project stage snapshot.json");
    expect(formatCommandPlaceholderLabel("<off|required|new_tasks_only>")).toBe("off / required / new tasks only");
  });

  it("leaves empty placeholder values unresolved", () => {
    expect(applyCommandPlaceholderValues("run --snapshot <snapshot.json> --model <model>", {
      "<snapshot.json>": "/tmp/snapshot.json",
      "<model>": "  ",
    })).toBe("run --snapshot /tmp/snapshot.json --model <model>");
  });

  it("shell-quotes explicit operator values that contain shell metacharacters", () => {
    expect(shellQuoteCommandValue("gpt-5.5")).toBe("gpt-5.5");
    expect(shellQuoteCommandValue("/tmp/my snapshot.json")).toBe("'/tmp/my snapshot.json'");
    expect(shellQuoteCommandValue("can't-run")).toBe("'can'\\''t-run'");
  });

  it("substitutes repeated placeholders with the same shell-quoted value", () => {
    expect(applyCommandPlaceholderValues("run <file> --copy <file>", {
      "<file>": "/tmp/my snapshot.json",
    })).toBe("run '/tmp/my snapshot.json' --copy '/tmp/my snapshot.json'");
  });

  it("summarizes filled and missing command placeholders", () => {
    expect(getCommandPlaceholderCompletion("run <file> --model <model> --copy <file>", {
      "<file>": "/tmp/project snapshot.json",
      "<model>": "  ",
    })).toEqual({
      filled: ["<file>"],
      missing: ["<model>"],
    });
  });

  it("does not require optional command placeholders", () => {
    expect(getCommandPlaceholderCompletion("run --work-dir <dir> [--task <taskId>]", {
      "<dir>": "/tmp/source",
    })).toEqual({
      filled: ["<dir>"],
      missing: [],
    });
  });

  it("removes optional command segments until their values are filled", () => {
    expect(applyCommandPlaceholderValues("run --work-dir <dir> [--task <taskId>]", {
      "<dir>": "/tmp/source",
    })).toBe("run --work-dir /tmp/source");

    expect(applyCommandPlaceholderValues("run --work-dir <dir> [--task <taskId>]", {
      "<dir>": "/tmp/source",
      "<taskId>": "task-1",
    })).toBe("run --work-dir /tmp/source --task task-1");
  });

  it("keeps auto-filled optional segments without copying square brackets", () => {
    expect(applyCommandPlaceholderValues("run [--project-id project-1] --work-dir <dir>", {
      "<dir>": "/tmp/source",
    })).toBe("run --project-id project-1 --work-dir /tmp/source");
  });

  it("extracts only safe visible command hints from a Project Stage Snapshot", () => {
    expect(getSnapshotCommandInputHints({
      source: {
        workspace: {
          commitSha: "abc123",
          path: "/live/workspace",
        },
      },
      plan: {
        specFile: "spec.md",
      },
      selectedTaskId: "task-1",
    })).toEqual({
      "<project-source-workspace>": "/live/workspace",
      "<project-workdir>": "/live/workspace",
      "<snapshot-workspace>": "/live/workspace",
      "<ralph.config.json>": "/live/workspace/.arena/ralph.config.json",
      "<workspace/.arena/progress.json>": "/live/workspace/.arena/progress.json",
      "<project-workdir/.arena/progress.json>": "/live/workspace/.arena/progress.json",
      "<snapshot-git-commit>": "abc123",
      "<executor-before-git-commit>": "abc123",
      "<git-commit>": "abc123",
      "<workDir-relative-spec>": "spec.md",
      "<taskId>": "task-1",
      "<task-id>": "task-1",
    });
  });

  it("does not invent command hints when snapshot fields are missing", () => {
    expect(getSnapshotCommandInputHints({
      source: {
        workspace: {
          commitSha: null,
          path: null,
        },
      },
      plan: {
        specFile: "",
      },
    })).toEqual({});
  });

  it("extracts selected executor mode from owner-backed checkpoint readback", () => {
    expect(getSnapshotCommandInputHints({
      selectedTaskId: "task-055",
      providerSessions: {
        selectedTaskCheckpointReadback: {
          recommendedExecutorMode: "resume_interrupted",
          canPrepareExecutor: true,
        },
      },
    })).toEqual({
      "<taskId>": "task-055",
      "<task-id>": "task-055",
      "<new_task|failed_task|resume_interrupted>": "resume_interrupted",
    });
  });

  it("does not fill resume_interrupted mode from success-only checkpoint readback", () => {
    expect(getSnapshotCommandInputHints({
      selectedTaskId: "task-055",
      plan: {
        taskCandidates: [
          {
            id: "task-055",
            status: "in_progress",
            recommendedExecutorMode: "resume_interrupted",
          },
        ],
      },
      providerSessions: {
        selectedTaskSessionCount: 1,
        selectedTaskResumableSessionCount: 0,
        selectedTaskCheckpointReadback: {
          recommendedExecutorMode: "resume_interrupted",
          canPrepareExecutor: false,
        },
      },
    })).toEqual({
      "<taskId>": "task-055",
      "<task-id>": "task-055",
    });
  });

  it("does not fill resume_interrupted mode from raw resumable counts alone", () => {
    expect(getSnapshotCommandInputHints({
      selectedTaskId: "task-055",
      plan: {
        taskCandidates: [
          {
            id: "task-055",
            status: "in_progress",
            recommendedExecutorMode: "resume_interrupted",
          },
        ],
      },
      providerSessions: {
        selectedTaskResumableSessionCount: 1,
      },
    })).toEqual({
      "<taskId>": "task-055",
      "<task-id>": "task-055",
    });
  });

  it("fills Workbench automation command values only from snapshot-owned source fields", () => {
    const hints = getSnapshotCommandInputHints({
      selectedTaskId: "task-001",
      source: {
        workspace: {
          commitSha: "6e32e0484088efaa17c1793d4b950dd942c64eed",
          path: "/path/to/user/.arena-runtime/project-workspaces/stook-gpjxaj",
        },
      },
    });
    const command = [
      "ralph visual-workbench automate-evidence",
      "--work-dir <project-source-workspace>",
      "--task <taskId>",
      "--source-ref <git-commit>",
      "--base-url <http://127.0.0.1:port>",
      "--out-dir <capture-output-dir-outside-work-dir>",
      "--config <ralph.config.json>",
    ].join(" ");

    expect(getCommandPlaceholderCompletion(command, hints)).toEqual({
      filled: [
        "<project-source-workspace>",
        "<taskId>",
        "<git-commit>",
        "<ralph.config.json>",
      ],
      missing: [
        "<http://127.0.0.1:port>",
        "<capture-output-dir-outside-work-dir>",
      ],
    });
    expect(applyCommandPlaceholderValues(command, hints)).toContain("--config /path/to/user/.arena-runtime/project-workspaces/stook-gpjxaj/.arena/ralph.config.json");
    expect(applyCommandPlaceholderValues(command, hints)).toContain("--base-url <http://127.0.0.1:port>");
  });

  it("does not fall back to selected task status when checkpoint readback is absent", () => {
    expect(getSnapshotCommandInputHints({
      selectedTaskId: "task-2",
      plan: {
        selectedTask: {
          id: "task-2",
          status: "failed",
        },
      },
    })).toEqual({
      "<taskId>": "task-2",
      "<task-id>": "task-2",
    });
  });

  it("does not fill executor mode before a task is explicitly selected", () => {
    expect(getSnapshotCommandInputHints({
      plan: {
        taskCandidates: [
          {
            id: "task-1",
            status: "pending",
            recommendedExecutorMode: "new_task",
          },
        ],
      },
    })).toEqual({});
  });
});
