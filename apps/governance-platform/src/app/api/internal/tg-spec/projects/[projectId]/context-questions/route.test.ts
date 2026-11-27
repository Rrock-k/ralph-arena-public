import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

vi.mock("server-only", () => ({}));

vi.mock("@/lib/internal-auth", () => ({
  isTgSpecInternalAuthorized: vi.fn(),
}));

vi.mock("@/lib/project-context-questions", () => ({
  askProjectContextQuestion: vi.fn(),
}));

import { isTgSpecInternalAuthorized } from "@/lib/internal-auth";
import { askProjectContextQuestion } from "@/lib/project-context-questions";

function context(projectId = "project-1") {
  return { params: Promise.resolve({ projectId }) };
}

function request(body: unknown) {
  return new Request("http://localhost/api/internal/tg-spec/projects/project-1/context-questions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/internal/tg-spec/projects/:projectId/context-questions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isTgSpecInternalAuthorized).mockReturnValue(true);
    vi.mocked(askProjectContextQuestion).mockResolvedValue({
      success: true,
      question: {
        id: "question-1",
        projectId: "project-1",
        question: "What stack?",
        model: "gpt-5.6-sol",
        sourceSystem: "tg-spec",
        status: "answered",
        answer: "Vite",
        error: null,
        askedAt: "2026-05-29T10:00:00.000Z",
        answeredAt: "2026-05-29T10:00:05.000Z",
      },
    });
  });

  it("rejects unauthorized tg-spec calls", async () => {
    vi.mocked(isTgSpecInternalAuthorized).mockReturnValue(false);

    const res = await POST(request({
      question: "What stack?",
      model: "gpt-5.6-sol",
    }), context());

    expect(res.status).toBe(401);
    expect(askProjectContextQuestion).not.toHaveBeenCalled();
  });

  it("asks through the Arena-owned context-question service", async () => {
    const res = await POST(request({
      question: "What stack?",
      model: "gpt-5.6-sol",
      sourceUserId: "telegram-user-1",
      sourceChatId: "chat-1",
      sourceMessageId: "42",
    }), context("arena-project-1"));

    expect(res.status).toBe(200);
    expect(askProjectContextQuestion).toHaveBeenCalledWith({
      projectId: "arena-project-1",
      question: "What stack?",
      model: "gpt-5.6-sol",
      sourceSystem: "tg-spec",
      sourceUserId: "telegram-user-1",
      sourceChatId: "chat-1",
      sourceMessageId: "42",
    });
  });

  it("returns structured retry details for provider rate limits", async () => {
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
    }), context("arena-project-1"));

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
