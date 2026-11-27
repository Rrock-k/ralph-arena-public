import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "./route";

vi.mock("server-only", () => ({}));

vi.mock("@/lib/project-runtime-surface-access", () => ({
  requireProjectRuntimeSurfaceCapability: vi.fn(),
}));

vi.mock("@/lib/project-context-questions", () => ({
  askProjectContextQuestion: vi.fn(),
  listProjectContextQuestionThreads: vi.fn(),
}));

import { requireProjectRuntimeSurfaceCapability } from "@/lib/project-runtime-surface-access";
import {
  askProjectContextQuestion,
  listProjectContextQuestionThreads,
} from "@/lib/project-context-questions";

function context(id = "project-1") {
  return { params: Promise.resolve({ id }) };
}

function request(body?: unknown, url = "http://localhost/api/projects/project-1/context-questions") {
  return new Request(url, {
    method: body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe("/api/projects/:id/context-questions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireProjectRuntimeSurfaceCapability).mockResolvedValue({
      authorized: true,
      session: { user: { id: "user-1" } },
    } as any);
    vi.mocked(listProjectContextQuestionThreads).mockResolvedValue([]);
    vi.mocked(askProjectContextQuestion).mockResolvedValue({
      success: true,
      question: {
        id: "question-1",
        projectId: "project-1",
        question: "What stack?",
        model: "gpt-5.6-sol",
        sourceSystem: "arena",
        status: "answered",
        answer: "Vite",
        error: null,
        askedAt: "2026-05-29T10:00:00.000Z",
        answeredAt: "2026-05-29T10:00:05.000Z",
      },
    });
  });

  it("lists recent questions for project managers", async () => {
    const res = await GET(request(), context());

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ questions: [] });
    expect(requireProjectRuntimeSurfaceCapability).toHaveBeenCalledWith(
      expect.any(Request),
      "project-1",
      "project.runtime.manage",
    );
  });

  it("asks a question as a project manager", async () => {
    const res = await POST(request({
      question: "What stack?",
      model: "gpt-5.6-sol",
    }), context());

    expect(res.status).toBe(200);
    expect(askProjectContextQuestion).toHaveBeenCalledWith({
      projectId: "project-1",
      question: "What stack?",
      model: "gpt-5.6-sol",
      sourceSystem: "arena",
      actorUserId: "user-1",
    });
  });

  it("rejects callers without project runtime access", async () => {
    vi.mocked(requireProjectRuntimeSurfaceCapability).mockResolvedValue({
      authorized: false,
      error: "Project access denied",
    } as any);

    const res = await POST(request({
      question: "What stack?",
      model: "gpt-5.6-sol",
    }), context());

    expect(res.status).toBe(403);
    expect(askProjectContextQuestion).not.toHaveBeenCalled();
  });

  it("surfaces explicit context-question failures", async () => {
    vi.mocked(askProjectContextQuestion).mockResolvedValue({
      success: false,
      status: 409,
      error: "context_question_runtime_unavailable",
      questionId: "question-1",
    });

    const res = await POST(request({
      question: "What stack?",
      model: "gpt-5.6-sol",
    }), context());

    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toEqual({
      error: "context_question_runtime_unavailable",
      questionId: "question-1",
    });
  });

  it("surfaces structured retry details for provider rate limits", async () => {
    vi.mocked(askProjectContextQuestion).mockResolvedValue({
      success: false,
      status: 429,
      error: "You've hit your session limit",
      questionId: "question-1",
      details: {
        code: "context_question_provider_rate_limit",
        kind: "rate_limit",
        retryable: true,
        executionMode: "claude_tool_allowlist",
        parameters: { retry_after: 120 },
        retryAfterSeconds: 120,
      },
    } as any);

    const res = await POST(request({
      question: "What stack?",
      model: "claude-sonnet-4-6",
    }), context());

    expect(res.status).toBe(429);
    await expect(res.json()).resolves.toEqual({
      error: "You've hit your session limit",
      questionId: "question-1",
      details: {
        code: "context_question_provider_rate_limit",
        kind: "rate_limit",
        retryable: true,
        executionMode: "claude_tool_allowlist",
        parameters: { retry_after: 120 },
        retryAfterSeconds: 120,
      },
      parameters: { retry_after: 120 },
    });
  });
});
