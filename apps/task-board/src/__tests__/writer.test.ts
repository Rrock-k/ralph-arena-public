import { describe, it, expect, vi, beforeEach } from "vitest";
import type { BacklogTask } from "@/lib/types";

// Mock fs
vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  appendFile: vi.fn(),
}));

// Mock backlog
vi.mock("@/lib/backlog", () => ({
  getAllTasks: vi.fn(),
  getBacklogDir: vi.fn(() => "/mock/backlog"),
}));

import { readFile, writeFile, appendFile } from "node:fs/promises";
import { getAllTasks } from "@/lib/backlog";
import {
  moveTask,
  updateTaskStatus,
  updateTask,
  deleteTask,
  appendTask,
} from "@/lib/writer";

const mockReadFile = vi.mocked(readFile);
const mockWriteFile = vi.mocked(writeFile);
const mockAppendFile = vi.mocked(appendFile);
const mockGetAllTasks = vi.mocked(getAllTasks);

function makeTasks(...defs: Array<Partial<BacklogTask> & { id: string }>): BacklogTask[] {
  return defs.map((d) => ({
    title: d.title ?? d.id,
    status: d.status ?? "IDEA",
    priority: d.priority ?? "P2",
    dependsOn: d.dependsOn ?? [],
    sessions: d.sessions ?? [],
    description: d.description ?? "",
    acceptanceCriteria: d.acceptanceCriteria ?? [],
    sourceFile: d.sourceFile ?? "test.md",
    lineStart: d.lineStart ?? 0,
    lineEnd: d.lineEnd ?? 0,
    ...d,
  }));
}

beforeEach(() => {
  vi.clearAllMocks();
  mockWriteFile.mockResolvedValue(undefined);
  mockAppendFile.mockResolvedValue(undefined);
});

// ---------- updateTaskStatus ----------

describe("updateTaskStatus", () => {
  it("updates status in the heading line", async () => {
    const md = [
      "### [IDEA] RA-001: My task",
      "> Priority: P2",
    ].join("\n");

    mockGetAllTasks.mockResolvedValue(
      makeTasks({ id: "RA-001", lineStart: 0, lineEnd: 1 })
    );
    mockReadFile.mockResolvedValue(md);

    await updateTaskStatus("RA-001", "DONE");

    const written = mockWriteFile.mock.calls[0][1] as string;
    expect(written).toContain("### [DONE] RA-001: My task");
    expect(written).toContain("> Priority: P2");
  });

  it("throws on invalid status", async () => {
    await expect(
      updateTaskStatus("RA-001", "BANANA" as any)
    ).rejects.toThrow("Invalid status");
  });

  it("throws when task not found", async () => {
    mockGetAllTasks.mockResolvedValue([]);
    await expect(updateTaskStatus("RA-999", "DONE")).rejects.toThrow("not found");
  });

  it("throws when heading doesn't match on disk", async () => {
    mockGetAllTasks.mockResolvedValue(
      makeTasks({ id: "RA-001", lineStart: 0, lineEnd: 0 })
    );
    mockReadFile.mockResolvedValue("Some random line");

    await expect(updateTaskStatus("RA-001", "DONE")).rejects.toThrow(
      "heading not found"
    );
  });
});

// ---------- updateTask ----------

describe("updateTask", () => {
  const baseMd = [
    "### [IDEA] RA-001: Original title",
    "> Priority: P2",
    "",
    "Original description",
  ].join("\n");

  beforeEach(() => {
    mockGetAllTasks.mockResolvedValue(
      makeTasks({
        id: "RA-001",
        title: "Original title",
        description: "Original description",
        lineStart: 0,
        lineEnd: 3,
      })
    );
    mockReadFile.mockResolvedValue(baseMd);
  });

  it("updates title", async () => {
    await updateTask("RA-001", { title: "New title" });

    const written = mockWriteFile.mock.calls[0][1] as string;
    expect(written).toContain("### [IDEA] RA-001: New title");
  });

  it("updates status", async () => {
    await updateTask("RA-001", { status: "PLANNED" });

    const written = mockWriteFile.mock.calls[0][1] as string;
    expect(written).toContain("### [PLANNED] RA-001:");
  });

  it("updates priority", async () => {
    await updateTask("RA-001", { priority: "P0" });

    const written = mockWriteFile.mock.calls[0][1] as string;
    expect(written).toContain("> Priority: P0");
  });

  it("updates description", async () => {
    await updateTask("RA-001", { description: "New desc" });

    const written = mockWriteFile.mock.calls[0][1] as string;
    expect(written).toContain("New desc");
    expect(written).not.toContain("Original description");
  });

  it("updates acceptance criteria", async () => {
    await updateTask("RA-001", {
      acceptanceCriteria: [
        { text: "Done thing", checked: true },
        { text: "Pending thing", checked: false },
      ],
    });

    const written = mockWriteFile.mock.calls[0][1] as string;
    expect(written).toContain("**Acceptance criteria:**");
    expect(written).toContain("- [x] Done thing");
    expect(written).toContain("- [ ] Pending thing");
  });

  it("preserves dependencies in reconstructed block", async () => {
    mockGetAllTasks.mockResolvedValue(
      makeTasks({
        id: "RA-001",
        dependsOn: ["RA-000"],
        lineStart: 0,
        lineEnd: 3,
      })
    );

    await updateTask("RA-001", { title: "Updated" });

    const written = mockWriteFile.mock.calls[0][1] as string;
    expect(written).toContain("> Depends on: RA-000");
  });

  it("sets color in reconstructed block", async () => {
    await updateTask("RA-001", { color: "blue" });

    const written = mockWriteFile.mock.calls[0][1] as string;
    expect(written).toContain("> Color: blue");
  });

  it("removes color when set to null", async () => {
    mockGetAllTasks.mockResolvedValue(
      makeTasks({
        id: "RA-001",
        title: "Original title",
        description: "Original description",
        color: "red",
        lineStart: 0,
        lineEnd: 3,
      })
    );

    await updateTask("RA-001", { color: null });

    const written = mockWriteFile.mock.calls[0][1] as string;
    expect(written).not.toContain("> Color:");
  });

  it("preserves existing color when not updating it", async () => {
    mockGetAllTasks.mockResolvedValue(
      makeTasks({
        id: "RA-001",
        title: "Original title",
        description: "Original description",
        color: "green",
        lineStart: 0,
        lineEnd: 3,
      })
    );

    await updateTask("RA-001", { title: "New title" });

    const written = mockWriteFile.mock.calls[0][1] as string;
    expect(written).toContain("> Color: green");
  });

  it("throws when task not found", async () => {
    mockGetAllTasks.mockResolvedValue([]);
    await expect(updateTask("RA-999", { title: "X" })).rejects.toThrow("not found");
  });
});

// ---------- deleteTask ----------

describe("deleteTask", () => {
  it("removes task block from file", async () => {
    const md = [
      "# Title",             // 0
      "",                     // 1
      "### [IDEA] RA-001: First",  // 2
      "> Priority: P2",      // 3
      "",                     // 4
      "### [DONE] RA-002: Second", // 5
      "> Priority: P1",      // 6
    ].join("\n");

    mockGetAllTasks.mockResolvedValue(
      makeTasks(
        { id: "RA-001", lineStart: 2, lineEnd: 4 },
        { id: "RA-002", lineStart: 5, lineEnd: 6 }
      )
    );
    mockReadFile.mockResolvedValue(md);

    await deleteTask("RA-001");

    const written = mockWriteFile.mock.calls[0][1] as string;
    expect(written).not.toContain("RA-001");
    expect(written).toContain("### [DONE] RA-002: Second");
  });

  it("removes trailing blank line after block", async () => {
    const md = [
      "### [IDEA] RA-001: Task",  // 0
      "> Priority: P2",           // 1
      "",                          // 2 (trailing blank)
      "### [DONE] RA-002: Other", // 3
    ].join("\n");

    mockGetAllTasks.mockResolvedValue(
      makeTasks(
        { id: "RA-001", lineStart: 0, lineEnd: 1 },
        { id: "RA-002", lineStart: 3, lineEnd: 3 }
      )
    );
    mockReadFile.mockResolvedValue(md);

    await deleteTask("RA-001");

    const written = mockWriteFile.mock.calls[0][1] as string;
    // Should not start with a blank line
    expect(written.startsWith("### [DONE]")).toBe(true);
  });

  it("throws when task not found", async () => {
    mockGetAllTasks.mockResolvedValue([]);
    await expect(deleteTask("RA-999")).rejects.toThrow("not found");
  });
});

// ---------- appendTask ----------

describe("appendTask", () => {
  beforeEach(() => {
    mockGetAllTasks.mockResolvedValue(
      makeTasks(
        { id: "RA-001", sourceFile: "ralph-arena.md" },
        { id: "RA-002", sourceFile: "ralph-arena.md" }
      )
    );
  });

  it("generates next sequential ID", async () => {
    const result = await appendTask("New task", "ralph-arena.md");
    expect(result.id).toBe("RA-003");
  });

  it("appends markdown block to file", async () => {
    await appendTask("New task", "ralph-arena.md");

    const appended = mockAppendFile.mock.calls[0][1] as string;
    expect(appended).toContain("### [IDEA] RA-003: New task");
    expect(appended).toContain("> Priority: P2");
  });

  it("uses correct prefix for task-manager.md", async () => {
    mockGetAllTasks.mockResolvedValue(
      makeTasks({ id: "TM-005", sourceFile: "task-manager.md" })
    );

    const result = await appendTask("TM task", "task-manager.md");
    expect(result.id).toBe("TM-006");
  });

  it("creates with PLANNED status when specified", async () => {
    const result = await appendTask("Planned task", "ralph-arena.md", "PLANNED");

    expect(result.status).toBe("PLANNED");
    const appended = mockAppendFile.mock.calls[0][1] as string;
    expect(appended).toContain("### [PLANNED]");
  });

  it("defaults to IDEA status", async () => {
    const result = await appendTask("Idea task");
    expect(result.status).toBe("IDEA");
  });

  it("defaults to ralph-arena.md source file", async () => {
    const result = await appendTask("Default file");
    expect(result.sourceFile).toBe("ralph-arena.md");
  });

  it("returns task with default fields", async () => {
    const result = await appendTask("Test", "ralph-arena.md");
    expect(result).toMatchObject({
      title: "Test",
      priority: "P2",
      dependsOn: [],
      description: "",
      acceptanceCriteria: [],
    });
  });

  it("starts at 001 when no existing tasks", async () => {
    mockGetAllTasks.mockResolvedValue([]);
    const result = await appendTask("First task");
    expect(result.id).toBe("RA-001");
  });

  it("falls back to RA prefix for unknown files", async () => {
    mockGetAllTasks.mockResolvedValue([]);
    const result = await appendTask("Task", "unknown.md");
    expect(result.id).toBe("RA-001");
  });
});

// ---------- moveTask ----------

describe("moveTask", () => {
  it("moves task after another task", async () => {
    // A (0-1), B (3-4), C (6-7)
    const md = [
      "### [IDEA] RA-001: A",   // 0
      "> Priority: P2",          // 1
      "",                         // 2
      "### [IDEA] RA-002: B",   // 3
      "> Priority: P2",          // 4
      "",                         // 5
      "### [IDEA] RA-003: C",   // 6
      "> Priority: P2",          // 7
    ].join("\n");

    mockGetAllTasks.mockResolvedValue(
      makeTasks(
        { id: "RA-001", lineStart: 0, lineEnd: 2 },
        { id: "RA-002", lineStart: 3, lineEnd: 5 },
        { id: "RA-003", lineStart: 6, lineEnd: 7 }
      )
    );
    mockReadFile.mockResolvedValue(md);

    // Move A after C
    await moveTask("RA-001", { afterTaskId: "RA-003" });

    const written = mockWriteFile.mock.calls[0][1] as string;
    const lines = written.split("\n");

    // B should come before C, and A should come after C
    const bIdx = lines.findIndex((l) => l.includes("RA-002: B"));
    const cIdx = lines.findIndex((l) => l.includes("RA-003: C"));
    const aIdx = lines.findIndex((l) => l.includes("RA-001: A"));

    expect(bIdx).toBeLessThan(cIdx);
    expect(cIdx).toBeLessThan(aIdx);
  });

  it("moves task before another task", async () => {
    const md = [
      "### [IDEA] RA-001: A",   // 0
      "> Priority: P2",          // 1
      "",                         // 2
      "### [IDEA] RA-002: B",   // 3
      "> Priority: P2",          // 4
      "",                         // 5
      "### [IDEA] RA-003: C",   // 6
      "> Priority: P2",          // 7
    ].join("\n");

    mockGetAllTasks.mockResolvedValue(
      makeTasks(
        { id: "RA-001", lineStart: 0, lineEnd: 2 },
        { id: "RA-002", lineStart: 3, lineEnd: 5 },
        { id: "RA-003", lineStart: 6, lineEnd: 7 }
      )
    );
    mockReadFile.mockResolvedValue(md);

    // Move C before A
    await moveTask("RA-003", { beforeTaskId: "RA-001" });

    const written = mockWriteFile.mock.calls[0][1] as string;
    const lines = written.split("\n");

    const cIdx = lines.findIndex((l) => l.includes("RA-003: C"));
    const aIdx = lines.findIndex((l) => l.includes("RA-001: A"));
    const bIdx = lines.findIndex((l) => l.includes("RA-002: B"));

    expect(cIdx).toBeLessThan(aIdx);
    expect(aIdx).toBeLessThan(bIdx);
  });

  it("throws when task not found", async () => {
    mockGetAllTasks.mockResolvedValue([]);
    await expect(moveTask("RA-999", { afterTaskId: "RA-001" })).rejects.toThrow("not found");
  });

  it("throws when reference task not found", async () => {
    mockGetAllTasks.mockResolvedValue(
      makeTasks({ id: "RA-001", lineStart: 0, lineEnd: 0 })
    );
    await expect(moveTask("RA-001", { afterTaskId: "RA-999" })).rejects.toThrow("not found");
  });

  it("throws when tasks are in different files", async () => {
    mockGetAllTasks.mockResolvedValue(
      makeTasks(
        { id: "RA-001", sourceFile: "a.md", lineStart: 0, lineEnd: 0 },
        { id: "TM-001", sourceFile: "b.md", lineStart: 0, lineEnd: 0 }
      )
    );
    await expect(moveTask("RA-001", { afterTaskId: "TM-001" })).rejects.toThrow(
      "different files"
    );
  });

  it("no-ops when moving task relative to itself", async () => {
    mockGetAllTasks.mockResolvedValue(
      makeTasks({ id: "RA-001", lineStart: 0, lineEnd: 1 })
    );

    await moveTask("RA-001", { afterTaskId: "RA-001" });
    expect(mockWriteFile).not.toHaveBeenCalled();
  });

  it("throws when neither afterTaskId nor beforeTaskId provided", async () => {
    await expect(moveTask("RA-001", {})).rejects.toThrow("required");
  });
});
