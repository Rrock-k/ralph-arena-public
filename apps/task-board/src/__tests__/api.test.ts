import { describe, it, expect, vi, beforeEach } from "vitest";
import { DuplicateTaskIdError, InvalidTaskStatusError } from "@/lib/parser";

// Mock writer
vi.mock("@/lib/writer", () => ({
  updateTask: vi.fn(),
  deleteTask: vi.fn(),
  appendTask: vi.fn(),
  moveTask: vi.fn(),
}));

// Mock backlog
vi.mock("@/lib/backlog", () => ({
  getAllTasks: vi.fn(),
  getTasksByProject: vi.fn(),
}));

import { updateTask, deleteTask, appendTask, moveTask } from "@/lib/writer";
import { getAllTasks, getTasksByProject } from "@/lib/backlog";

const mockUpdateTask = vi.mocked(updateTask);
const mockDeleteTask = vi.mocked(deleteTask);
const mockAppendTask = vi.mocked(appendTask);
const mockMoveTask = vi.mocked(moveTask);
const mockGetAllTasks = vi.mocked(getAllTasks);
const mockGetTasksByProject = vi.mocked(getTasksByProject);

// Helper: import route handlers fresh (after mocks are set up)
async function getTasksRoute() {
  return import("@/app/api/tasks/route");
}
async function getTaskIdRoute() {
  return import("@/app/api/tasks/[id]/route");
}
async function getReorderRoute() {
  return import("@/app/api/tasks/reorder/route");
}

function jsonRequest(body: unknown, method = "POST"): Request {
  return new Request("http://localhost/api/tasks", {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------- GET /api/tasks ----------

describe("GET /api/tasks", () => {
  it("returns all tasks", async () => {
    const { GET } = await getTasksRoute();
    mockGetAllTasks.mockResolvedValue([
      { id: "RA-001", title: "T", status: "IDEA", priority: "P2", dependsOn: [], sessions: [], description: "", acceptanceCriteria: [], sourceFile: "test.md", lineStart: 0, lineEnd: 0 },
    ]);

    const req = new Request("http://localhost/api/tasks");
    const res = await GET(req);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data).toHaveLength(1);
    expect(data[0].id).toBe("RA-001");
  });

  it("filters by project query param", async () => {
    const { GET } = await getTasksRoute();
    mockGetTasksByProject.mockResolvedValue([]);

    const req = new Request("http://localhost/api/tasks?project=ralph-arena");
    await GET(req);

    expect(mockGetTasksByProject).toHaveBeenCalledWith("ralph-arena");
  });

  it("returns structured duplicate backlog errors", async () => {
    const { GET } = await getTasksRoute();
    mockGetTasksByProject.mockRejectedValue(
      new DuplicateTaskIdError([
        "RA-246 at line 306 and line 507 in ralph-arena.md",
      ])
    );

    const req = new Request("http://localhost/api/tasks?project=ralph-arena");
    const res = await GET(req);
    const data = await res.json();

    expect(res.status).toBe(422);
    expect(data).toMatchObject({
      type: "DUPLICATE_TASK_ID",
      title: "Ошибка структуры backlog",
      sourceFile: "ralph-arena.md",
      details: ["RA-246 at line 306 and line 507 in ralph-arena.md"],
    });
  });

  it("returns structured invalid status backlog errors", async () => {
    const { GET } = await getTasksRoute();
    mockGetTasksByProject.mockRejectedValue(
      new InvalidTaskStatusError([
        'RA-280 has unsupported status "IN_PROGRESS" at line 5900 in ralph-arena.md. Allowed statuses: IDEA, PLANNED, IN PROGRESS, REVIEW, VERIFIED, BLOCKED, DONE, ARCHIVED',
      ], "ralph-arena.md")
    );

    const req = new Request("http://localhost/api/tasks?project=ralph-arena");
    const res = await GET(req);
    const data = await res.json();

    expect(res.status).toBe(422);
    expect(data).toMatchObject({
      type: "INVALID_TASK_STATUS",
      title: "Ошибка структуры backlog",
      sourceFile: "ralph-arena.md",
    });
    expect(data.details[0]).toContain("IN_PROGRESS");
  });
});

// ---------- POST /api/tasks ----------

describe("POST /api/tasks", () => {
  it("creates task with IDEA status by default", async () => {
    const { POST } = await getTasksRoute();
    mockAppendTask.mockResolvedValue({
      id: "RA-001", title: "New", status: "IDEA", priority: "P2",
      dependsOn: [], sessions: [], description: "", acceptanceCriteria: [],
      sourceFile: "ralph-arena.md", lineStart: -1, lineEnd: -1,
    });

    const res = await POST(jsonRequest({ title: "New" }));
    expect(res.status).toBe(201);
    expect(mockAppendTask).toHaveBeenCalledWith("New", undefined, "IDEA");
  });

  it("creates task with PLANNED status", async () => {
    const { POST } = await getTasksRoute();
    mockAppendTask.mockResolvedValue({
      id: "RA-001", title: "Planned", status: "PLANNED", priority: "P2",
      dependsOn: [], sessions: [], description: "", acceptanceCriteria: [],
      sourceFile: "ralph-arena.md", lineStart: -1, lineEnd: -1,
    });

    const res = await POST(jsonRequest({ title: "Planned", status: "PLANNED" }));
    expect(res.status).toBe(201);
    expect(mockAppendTask).toHaveBeenCalledWith("Planned", undefined, "PLANNED");
  });

  it("rejects invalid status and defaults to IDEA", async () => {
    const { POST } = await getTasksRoute();
    mockAppendTask.mockResolvedValue({
      id: "RA-001", title: "T", status: "IDEA", priority: "P2",
      dependsOn: [], sessions: [], description: "", acceptanceCriteria: [],
      sourceFile: "ralph-arena.md", lineStart: -1, lineEnd: -1,
    });

    await POST(jsonRequest({ title: "T", status: "BANANA" }));
    expect(mockAppendTask).toHaveBeenCalledWith("T", undefined, "IDEA");
  });

  it("returns 400 for empty title", async () => {
    const { POST } = await getTasksRoute();
    const res = await POST(jsonRequest({ title: "  " }));
    expect(res.status).toBe(400);
  });

  it("returns 400 for missing title", async () => {
    const { POST } = await getTasksRoute();
    const res = await POST(jsonRequest({}));
    expect(res.status).toBe(400);
  });
});

// ---------- PATCH /api/tasks/[id] ----------

describe("PATCH /api/tasks/[id]", () => {
  it("updates task with valid fields", async () => {
    const { PATCH } = await getTaskIdRoute();
    mockUpdateTask.mockResolvedValue(undefined);

    const req = new Request("http://localhost/api/tasks/RA-001", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "DONE", title: "Updated" }),
    }) as any;

    const res = await PATCH(req, { params: { id: "RA-001" } });
    expect(res.status).toBe(200);
    expect(mockUpdateTask).toHaveBeenCalledWith("RA-001", {
      status: "DONE",
      title: "Updated",
    });
  });

  it("returns 400 for invalid status", async () => {
    const { PATCH } = await getTaskIdRoute();
    const req = new Request("http://localhost/api/tasks/RA-001", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "INVALID" }),
    }) as any;

    const res = await PATCH(req, { params: { id: "RA-001" } });
    expect(res.status).toBe(400);
  });

  it("returns 400 for invalid priority", async () => {
    const { PATCH } = await getTaskIdRoute();
    const req = new Request("http://localhost/api/tasks/RA-001", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ priority: "P9" }),
    }) as any;

    const res = await PATCH(req, { params: { id: "RA-001" } });
    expect(res.status).toBe(400);
  });

  it("returns 400 for empty title", async () => {
    const { PATCH } = await getTaskIdRoute();
    const req = new Request("http://localhost/api/tasks/RA-001", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "" }),
    }) as any;

    const res = await PATCH(req, { params: { id: "RA-001" } });
    expect(res.status).toBe(400);
  });

  it("returns 400 for non-array acceptance criteria", async () => {
    const { PATCH } = await getTaskIdRoute();
    const req = new Request("http://localhost/api/tasks/RA-001", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ acceptanceCriteria: "not an array" }),
    }) as any;

    const res = await PATCH(req, { params: { id: "RA-001" } });
    expect(res.status).toBe(400);
  });

  it("returns 500 when writer throws", async () => {
    const { PATCH } = await getTaskIdRoute();
    mockUpdateTask.mockRejectedValue(new Error("disk error"));

    const req = new Request("http://localhost/api/tasks/RA-001", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "X" }),
    }) as any;

    const res = await PATCH(req, { params: { id: "RA-001" } });
    expect(res.status).toBe(500);
  });
});

// ---------- DELETE /api/tasks/[id] ----------

describe("DELETE /api/tasks/[id]", () => {
  it("deletes task and returns ok", async () => {
    const { DELETE } = await getTaskIdRoute();
    mockDeleteTask.mockResolvedValue(undefined);

    const req = new Request("http://localhost/api/tasks/RA-001", {
      method: "DELETE",
    }) as any;

    const res = await DELETE(req, { params: { id: "RA-001" } });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(mockDeleteTask).toHaveBeenCalledWith("RA-001");
  });

  it("returns 500 when delete fails", async () => {
    const { DELETE } = await getTaskIdRoute();
    mockDeleteTask.mockRejectedValue(new Error("not found"));

    const req = new Request("http://localhost/api/tasks/RA-001", {
      method: "DELETE",
    }) as any;

    const res = await DELETE(req, { params: { id: "RA-001" } });
    expect(res.status).toBe(500);
  });
});

// ---------- POST /api/tasks/reorder ----------

describe("POST /api/tasks/reorder", () => {
  it("calls moveTask with afterTaskId", async () => {
    const { POST } = await getReorderRoute();
    mockMoveTask.mockResolvedValue(undefined);

    const res = await POST(
      jsonRequest({ taskId: "RA-002", afterTaskId: "RA-001" })
    );

    expect(res.status).toBe(200);
    expect(mockMoveTask).toHaveBeenCalledWith("RA-002", {
      afterTaskId: "RA-001",
      beforeTaskId: undefined,
    });
  });

  it("calls moveTask with beforeTaskId", async () => {
    const { POST } = await getReorderRoute();
    mockMoveTask.mockResolvedValue(undefined);

    const res = await POST(
      jsonRequest({ taskId: "RA-003", beforeTaskId: "RA-001" })
    );

    expect(res.status).toBe(200);
    expect(mockMoveTask).toHaveBeenCalledWith("RA-003", {
      afterTaskId: undefined,
      beforeTaskId: "RA-001",
    });
  });

  it("returns 400 when taskId is missing", async () => {
    const { POST } = await getReorderRoute();
    const res = await POST(jsonRequest({ afterTaskId: "RA-001" }));
    expect(res.status).toBe(400);
  });

  it("returns 400 when neither afterTaskId nor beforeTaskId provided", async () => {
    const { POST } = await getReorderRoute();
    const res = await POST(jsonRequest({ taskId: "RA-001" }));
    expect(res.status).toBe(400);
  });

  it("returns 500 when moveTask throws", async () => {
    const { POST } = await getReorderRoute();
    mockMoveTask.mockRejectedValue(new Error("fail"));

    const res = await POST(
      jsonRequest({ taskId: "RA-001", afterTaskId: "RA-002" })
    );
    expect(res.status).toBe(500);
  });
});
