import { describe, expect, it } from "vitest";
import {
  getBacklogErrorStatus,
  normalizeBacklogError,
  parseBacklogErrorPayload,
  toBacklogErrorResponse,
} from "@/lib/backlog-errors";
import { DuplicateTaskIdError, InvalidTaskStatusError } from "@/lib/parser";

describe("backlog error normalization", () => {
  it("normalizes duplicate task ID errors with source file details", () => {
    const error = new DuplicateTaskIdError([
      "RA-246 at line 306 and line 507 in ralph-arena.md",
    ]);

    const normalized = normalizeBacklogError(error);

    expect(normalized).toMatchObject({
      kind: "DUPLICATE_TASK_ID",
      title: "Ошибка структуры backlog",
      sourceFile: "ralph-arena.md",
    });
    expect(normalized.summary).toContain("ralph-arena.md");
    expect(normalized.details).toEqual([
      "RA-246 at line 306 and line 507 in ralph-arena.md",
    ]);
    expect(getBacklogErrorStatus(normalized)).toBe(422);
  });

  it("round-trips normalized errors through API payload shape", () => {
    const normalized = normalizeBacklogError(
      new Error("disk exploded"),
      "task-manager.md"
    );

    const payload = toBacklogErrorResponse(normalized);

    expect(parseBacklogErrorPayload(payload)).toEqual(normalized);
  });

  it("normalizes invalid task status errors as structure errors", () => {
    const error = new InvalidTaskStatusError([
      'RA-280 has unsupported status "IN_PROGRESS" at line 5900 in ralph-arena.md. Allowed statuses: IDEA, PLANNED, IN PROGRESS, REVIEW, VERIFIED, BLOCKED, DONE, ARCHIVED',
    ], "ralph-arena.md");

    const normalized = normalizeBacklogError(error);

    expect(normalized).toMatchObject({
      kind: "INVALID_TASK_STATUS",
      title: "Ошибка структуры backlog",
      sourceFile: "ralph-arena.md",
    });
    expect(normalized.summary).toContain("неподдерживаемым статусом");
    expect(getBacklogErrorStatus(normalized)).toBe(422);
  });
});
