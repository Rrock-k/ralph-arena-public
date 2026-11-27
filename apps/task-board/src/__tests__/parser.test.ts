import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { parseMarkdownTasks, DuplicateTaskIdError, InvalidTaskStatusError } from "@/lib/parser";

describe("parseMarkdownTasks", () => {
  it("returns empty array for content with no tasks", () => {
    const result = parseMarkdownTasks("# Just a title\n\nSome text.", "test.md");
    expect(result).toEqual([]);
  });

  it("parses a single minimal task", () => {
    const md = `### [IDEA] RA-001: My task\n> Priority: P2`;
    const tasks = parseMarkdownTasks(md, "test.md");

    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({
      id: "RA-001",
      title: "My task",
      status: "IDEA",
      priority: "P2",
      sourceFile: "test.md",
      lineStart: 0,
    });
  });

  it("defaults priority to P2 when not specified", () => {
    const md = `### [IDEA] RA-001: No priority task`;
    const tasks = parseMarkdownTasks(md, "test.md");

    expect(tasks[0].priority).toBe("P2");
  });

  it("parses all priority levels", () => {
    const md = [
      "### [IDEA] RA-001: P0 task",
      "> Priority: P0",
      "",
      "### [IDEA] RA-002: P1 task",
      "> Priority: P1",
      "",
      "### [IDEA] RA-003: P3 task",
      "> Priority: P3",
    ].join("\n");

    const tasks = parseMarkdownTasks(md, "test.md");
    expect(tasks[0].priority).toBe("P0");
    expect(tasks[1].priority).toBe("P1");
    expect(tasks[2].priority).toBe("P3");
  });

  it("parses all valid statuses", () => {
    const statuses = ["IDEA", "PLANNED", "IN PROGRESS", "REVIEW", "VERIFIED", "BLOCKED", "DONE", "ARCHIVED"];
    const lines = statuses.map((s, i) => `### [${s}] RA-${String(i + 1).padStart(3, "0")}: Task ${s}`);
    const md = lines.join("\n");

    const tasks = parseMarkdownTasks(md, "test.md");
    expect(tasks).toHaveLength(statuses.length);
    statuses.forEach((s, i) => {
      expect(tasks[i].status).toBe(s);
    });
  });

  it("throws InvalidTaskStatusError on unsupported task status", () => {
    const md = [
      "### [IDEA] RA-001: Valid",
      "### [IN_PROGRESS] RA-002: Invalid status",
      "### [DONE] RA-003: Also valid",
    ].join("\n");

    expect(() => parseMarkdownTasks(md, "test.md")).toThrow(InvalidTaskStatusError);
    try {
      parseMarkdownTasks(md, "test.md");
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidTaskStatusError);
      expect((error as InvalidTaskStatusError).invalidStatuses).toEqual([
        'RA-002 has unsupported status "IN_PROGRESS" at line 2 in test.md. Allowed statuses: IDEA, PLANNED, IN PROGRESS, REVIEW, VERIFIED, BLOCKED, DONE, ARCHIVED',
      ]);
    }
  });

  it("parses dependencies", () => {
    const md = [
      "### [PLANNED] RA-002: Dependent task",
      "> Priority: P1",
      "> Depends on: RA-001, RA-003",
    ].join("\n");

    const tasks = parseMarkdownTasks(md, "test.md");
    expect(tasks[0].dependsOn).toEqual(["RA-001", "RA-003"]);
  });

  it("strips # prefix from dependency IDs", () => {
    const md = [
      "### [PLANNED] RA-002: Task",
      "> Depends on: #RA-001",
    ].join("\n");

    const tasks = parseMarkdownTasks(md, "test.md");
    expect(tasks[0].dependsOn).toEqual(["RA-001"]);
  });

  it("parses description text", () => {
    const md = [
      "### [IDEA] RA-001: Task with desc",
      "> Priority: P1",
      "",
      "This is the description.",
      "It spans multiple lines.",
    ].join("\n");

    const tasks = parseMarkdownTasks(md, "test.md");
    expect(tasks[0].description).toBe("This is the description.\nIt spans multiple lines.");
  });

  it("parses acceptance criteria with checked and unchecked items", () => {
    const md = [
      "### [IDEA] RA-001: Task with criteria",
      "> Priority: P2",
      "",
      "**Acceptance criteria:**",
      "- [x] First done",
      "- [ ] Second pending",
      "- [x] Third done",
    ].join("\n");

    const tasks = parseMarkdownTasks(md, "test.md");
    expect(tasks[0].acceptanceCriteria).toEqual([
      { text: "First done", checked: true },
      { text: "Second pending", checked: false },
      { text: "Third done", checked: true },
    ]);
  });

  it("handles case-insensitive acceptance criteria header", () => {
    const md = [
      "### [IDEA] RA-001: Task",
      "**Acceptance Criteria:**",
      "- [ ] Item",
    ].join("\n");

    const tasks = parseMarkdownTasks(md, "test.md");
    expect(tasks[0].acceptanceCriteria).toHaveLength(1);
  });

  it("records correct lineStart and lineEnd", () => {
    const md = [
      "# Title",           // 0
      "",                   // 1
      "",                   // 2
      "### [IDEA] RA-001: First",  // 3
      "> Priority: P0",    // 4
      "",                   // 5
      "### [DONE] RA-002: Second", // 6
      "> Priority: P1",    // 7
    ].join("\n");

    const tasks = parseMarkdownTasks(md, "test.md");
    expect(tasks[0].lineStart).toBe(3);
    expect(tasks[0].lineEnd).toBe(5);
    expect(tasks[1].lineStart).toBe(6);
    expect(tasks[1].lineEnd).toBe(7);
  });

  it("throws DuplicateTaskIdError on duplicate task IDs", () => {
    const md = [
      "### [IDEA] RA-001: First task",
      "> Priority: P1",
      "",
      "### [PLANNED] RA-001: Duplicate ID",
      "> Priority: P2",
    ].join("\n");

    expect(() => parseMarkdownTasks(md, "test.md")).toThrow(DuplicateTaskIdError);
  });

  it("parses multiple tasks in sequence", () => {
    const md = [
      "### [IDEA] RA-001: First",
      "> Priority: P0",
      "",
      "### [PLANNED] RA-002: Second",
      "> Priority: P1",
      "",
      "### [DONE] RA-003: Third",
      "> Priority: P3",
    ].join("\n");

    const tasks = parseMarkdownTasks(md, "test.md");
    expect(tasks).toHaveLength(3);
    expect(tasks.map((t) => t.id)).toEqual(["RA-001", "RA-002", "RA-003"]);
  });

  it("passes sourceFile through to each task", () => {
    const md = `### [IDEA] TM-001: Task`;
    const tasks = parseMarkdownTasks(md, "task-manager.md");
    expect(tasks[0].sourceFile).toBe("task-manager.md");
  });

  it("handles full realistic task block", () => {
    const md = [
      "### [IN PROGRESS] RA-003: Определить сущность Spec",
      "> Priority: P1",
      "> Depends on: RA-001, RA-002",
      "",
      "Spec теперь часть модели.",
      "",
      "**Acceptance criteria:**",
      "- [x] Модель определена",
      "- [ ] Миграция написана",
    ].join("\n");

    const tasks = parseMarkdownTasks(md, "ralph-arena.md");
    expect(tasks).toHaveLength(1);

    const t = tasks[0];
    expect(t.id).toBe("RA-003");
    expect(t.title).toBe("Определить сущность Spec");
    expect(t.status).toBe("IN PROGRESS");
    expect(t.priority).toBe("P1");
    expect(t.dependsOn).toEqual(["RA-001", "RA-002"]);
    expect(t.description).toBe("Spec теперь часть модели.");
    expect(t.acceptanceCriteria).toEqual([
      { text: "Модель определена", checked: true },
      { text: "Миграция написана", checked: false },
    ]);
    expect(t.sourceFile).toBe("ralph-arena.md");
  });

  it("parses task color", () => {
    const md = [
      "### [IDEA] RA-001: Colored task",
      "> Priority: P1",
      "> Color: red",
    ].join("\n");

    const tasks = parseMarkdownTasks(md, "test.md");
    expect(tasks[0].color).toBe("red");
  });

  it("ignores invalid color values", () => {
    const md = [
      "### [IDEA] RA-001: Bad color",
      "> Priority: P2",
      "> Color: rainbow",
    ].join("\n");

    const tasks = parseMarkdownTasks(md, "test.md");
    expect(tasks[0].color).toBeUndefined();
  });

  it("leaves color undefined when not specified", () => {
    const md = [
      "### [IDEA] RA-001: No color",
      "> Priority: P2",
    ].join("\n");

    const tasks = parseMarkdownTasks(md, "test.md");
    expect(tasks[0].color).toBeUndefined();
  });

  it("parses session links", () => {
    const md = [
      "### [IN PROGRESS] TM-008: Session links",
      "> Priority: P1",
      "",
      "> Session: [`5d7006b8-58c`](claude-session://5d7006b8-58c5-4723-9004-21e070b89f6a) — обсуждение фичи",
      "> Session: [`73577783-eb5`](claude-session://73577783-eb57-4e2f-b3ea-59c0cd9bc7fa) — дебаг postgres",
      "",
      "Описание задачи.",
    ].join("\n");

    const tasks = parseMarkdownTasks(md, "task-manager.md");
    expect(tasks).toHaveLength(1);
    expect(tasks[0].sessions).toEqual([
      { shortId: "5d7006b8-58c", fullId: "5d7006b8-58c5-4723-9004-21e070b89f6a", label: "обсуждение фичи" },
      { shortId: "73577783-eb5", fullId: "73577783-eb57-4e2f-b3ea-59c0cd9bc7fa", label: "дебаг postgres" },
    ]);
    expect(tasks[0].description).toBe("Описание задачи.");
  });

  it("parses session link without label", () => {
    const md = [
      "### [IDEA] RA-001: Task",
      "> Session: [`abc12345-678`](claude-session://abc12345-6789-0abc-def1-234567890abc)",
    ].join("\n");

    const tasks = parseMarkdownTasks(md, "test.md");
    expect(tasks[0].sessions).toEqual([
      { shortId: "abc12345-678", fullId: "abc12345-6789-0abc-def1-234567890abc", label: "" },
    ]);
  });

  it("returns empty sessions when none present", () => {
    const md = `### [IDEA] RA-001: No sessions\n> Priority: P2`;
    const tasks = parseMarkdownTasks(md, "test.md");
    expect(tasks[0].sessions).toEqual([]);
  });

  it("handles empty content", () => {
    expect(parseMarkdownTasks("", "test.md")).toEqual([]);
  });

  it("handles content with only headings and no tasks", () => {
    const md = "# Title\n\n## Section\n\nSome text\n";
    expect(parseMarkdownTasks(md, "test.md")).toEqual([]);
  });

  it("parses all repository backlog files without unsupported task statuses", () => {
    const backlogDir = path.resolve(process.cwd(), "../../docs/backlog");
    const files = readdirSync(backlogDir).filter((file) => file.endsWith(".md"));

    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const content = readFileSync(path.join(backlogDir, file), "utf-8");
      expect(() => parseMarkdownTasks(content, file), file).not.toThrow();
    }
  });
});
