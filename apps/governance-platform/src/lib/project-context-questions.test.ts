import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  askProjectContextQuestion,
  validateProjectContextQuestionInput,
} from "./project-context-questions";

vi.mock("server-only", () => ({}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    project: {
      findUnique: vi.fn(),
    },
    projectEvent: {
      create: vi.fn(),
      findMany: vi.fn(),
    },
  },
}));

vi.mock("@/lib/control-plane", () => ({
  getProjectWorkerInfo: vi.fn(),
  postWorkerJson: vi.fn(),
}));

vi.mock("@/lib/progress-bus", () => ({
  progressBus: {
    notifyChanged: vi.fn(),
  },
}));

vi.mock("@/lib/run-auth", async () => {
  const actual = await vi.importActual<typeof import("@/lib/run-auth")>("@/lib/run-auth");
  return {
    ...actual,
    buildRunAuthEnvFresh: vi.fn(),
  };
});

import { prisma } from "@/lib/prisma";
import { getProjectWorkerInfo, postWorkerJson } from "@/lib/control-plane";
import { buildRunAuthEnvFresh } from "@/lib/run-auth";

const now = new Date("2026-05-29T10:00:00.000Z");

function mockEventCreate() {
  vi.mocked((prisma as any).projectEvent.create).mockImplementation(async ({ data }: any) => ({
    id: data.type === "context_question" ? "question-1" : "answer-1",
    projectId: data.projectId,
    direction: data.direction,
    type: data.type,
    payload: data.payload,
    createdAt: now,
  }));
}

describe("project context questions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked((prisma as any).project.findUnique).mockResolvedValue({
      id: "project-1",
      agent: null,
      model: null,
      ownerScopeType: null,
      ownerScopeId: null,
      runnerBackend: "local",
      providerBillingMode: "byok",
      claudeAuthMode: null,
      codexAuthMode: null,
    });
    vi.mocked(getProjectWorkerInfo).mockResolvedValue({
      projectId: "project-1",
      workerUrl: "http://worker.local",
      containerName: "preview-project-1",
    });
    vi.mocked(postWorkerJson).mockResolvedValue({
      ok: true,
      body: { ok: true, answer: "The app is a Vite project.", executionMode: "codex_prompt_only" },
    });
    vi.mocked(buildRunAuthEnvFresh).mockResolvedValue({});
    mockEventCreate();
  });

  it("defaults missing models and rejects unsupported models explicitly", () => {
    expect(validateProjectContextQuestionInput({
      question: "What is this?",
      model: "claude-sonnet-4-6",
    })).toEqual({
      success: true,
      question: "What is this?",
      model: "claude-sonnet-4-6",
    });
    expect(validateProjectContextQuestionInput({
      question: "What is this?",
      model: "",
    })).toEqual({
      success: true,
      question: "What is this?",
      model: "claude-sonnet-4-6",
    });
    expect(validateProjectContextQuestionInput({
      question: "What is this?",
    })).toEqual({
      success: true,
      question: "What is this?",
      model: "claude-sonnet-4-6",
    });
    expect(validateProjectContextQuestionInput({
      question: "What is this?",
      model: "expensive-model",
    })).toEqual({
      success: false,
      status: 400,
      error: "context_question_model_unsupported",
    });
  });

  it("logs a question and answer without lifecycle mutation", async () => {
    const result = await askProjectContextQuestion({
      projectId: "project-1",
      question: "What stack does this use?",
      model: "gpt-5.6-sol",
      sourceSystem: "arena",
      actorUserId: "user-1",
    });

    expect(result.success).toBe(true);
    expect(postWorkerJson).toHaveBeenCalledWith(
      "http://worker.local/containers/preview-project-1/context-question",
      {
        question: "What stack does this use?",
        model: "gpt-5.6-sol",
        providerBillingMode: "byok",
        claudeAuthMode: "api_key",
        codexAuthMode: null,
      },
      { timeoutMs: 130000 },
    );
    expect((prisma as any).projectEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        projectId: "project-1",
        direction: "in",
        type: "context_question",
        userId: "user-1",
      }),
    });
    expect((prisma as any).projectEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        projectId: "project-1",
        direction: "out",
        type: "context_answer",
        userId: "user-1",
        payload: expect.objectContaining({
          status: "answered",
          questionEventId: "question-1",
          answer: "The app is a Vite project.",
          executionMode: "codex_prompt_only",
        }),
      }),
    });
  });

  it("retries a transient worker fetch failure once", async () => {
    vi.mocked(postWorkerJson)
      .mockResolvedValueOnce({ ok: false, error: "fetch failed" })
      .mockResolvedValueOnce({
        ok: true,
        body: { ok: true, answer: "Retry reached the workspace." },
      });

    const result = await askProjectContextQuestion({
      projectId: "project-1",
      question: "What stack does this use?",
      model: "claude-sonnet-4-6",
      sourceSystem: "tg-spec",
    });

    expect(result.success).toBe(true);
    expect(postWorkerJson).toHaveBeenCalledTimes(2);
    expect((prisma as any).projectEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        direction: "out",
        type: "context_answer",
        payload: expect.objectContaining({
          status: "answered",
          answer: "Retry reached the workspace.",
        }),
      }),
    });
  });

  it("keeps /ask on the project Claude OAuth lane when tg-spec requests a Codex model", async () => {
    vi.mocked(buildRunAuthEnvFresh).mockResolvedValue({
      CLAUDE_CODE_OAUTH_TOKEN: "claude-token",
    });
    vi.mocked((prisma as any).project.findUnique).mockResolvedValue({
      id: "project-1",
      agent: "claude-code",
      model: "claude-opus-4-8",
      ownerScopeType: null,
      ownerScopeId: null,
      runnerBackend: "local",
      providerBillingMode: "platform_credentials",
      claudeAuthMode: "oauth",
      codexAuthMode: "subscription",
    });

    const result = await askProjectContextQuestion({
      projectId: "project-1",
      question: "What is the current status?",
      model: "gpt-5.6-sol",
      sourceSystem: "tg-spec",
    });

    expect(result.success).toBe(true);
    expect(postWorkerJson).toHaveBeenCalledWith(
      "http://worker.local/containers/preview-project-1/context-question",
      {
        question: "What is the current status?",
        model: "claude-sonnet-4-6",
        providerBillingMode: "platform_credentials",
        claudeAuthMode: "oauth",
        codexAuthMode: "api_key",
        authEnv: {
          CLAUDE_CODE_OAUTH_TOKEN: "claude-token",
        },
      },
      { timeoutMs: 130000 },
    );
    expect(buildRunAuthEnvFresh).toHaveBeenCalledWith(
      {
        claudeAuthMode: "oauth",
        codexAuthMode: "api_key",
      },
      {
        agent: "claude-code",
        userId: null,
      },
    );
    expect((prisma as any).projectEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        direction: "in",
        type: "context_question",
        payload: expect.objectContaining({
          model: "claude-sonnet-4-6",
          requestedModel: "gpt-5.6-sol",
          claudeAuthMode: "oauth",
        }),
      }),
    });
  });

  it("passes Codex subscription auth to the worker for Codex subscription projects", async () => {
    vi.mocked(buildRunAuthEnvFresh).mockResolvedValue({
      CODEX_AUTH_JSON: "{\"accessToken\":\"codex-token\"}",
    });
    vi.mocked((prisma as any).project.findUnique).mockResolvedValue({
      id: "project-1",
      agent: "codex",
      model: "gpt-5.4-mini",
      ownerScopeType: null,
      ownerScopeId: null,
      runnerBackend: "local",
      providerBillingMode: "platform_credentials",
      claudeAuthMode: "oauth",
      codexAuthMode: "subscription",
    });

    const result = await askProjectContextQuestion({
      projectId: "project-1",
      question: "What is the current status?",
      model: "claude-sonnet-4-6",
      sourceSystem: "arena",
    });

    expect(result.success).toBe(true);
    expect(postWorkerJson).toHaveBeenCalledWith(
      "http://worker.local/containers/preview-project-1/context-question",
      {
        question: "What is the current status?",
        model: "gpt-5.4-mini",
        providerBillingMode: "platform_credentials",
        claudeAuthMode: "api_key",
        codexAuthMode: "subscription",
        authEnv: {
          CODEX_AUTH_JSON: "{\"accessToken\":\"codex-token\"}",
        },
      },
      { timeoutMs: 130000 },
    );
    expect(buildRunAuthEnvFresh).toHaveBeenCalledWith(
      {
        claudeAuthMode: "api_key",
        codexAuthMode: "subscription",
      },
      {
        agent: "codex",
        userId: null,
      },
    );
  });

  it("uses the current project model for Codex subscription when tg-spec sends the generic mini default", async () => {
    vi.mocked(buildRunAuthEnvFresh).mockResolvedValue({
      CODEX_AUTH_JSON: "{\"accessToken\":\"codex-token\"}",
    });
    vi.mocked((prisma as any).project.findUnique).mockResolvedValue({
      id: "project-1",
      agent: "codex",
      model: "gpt-5.5",
      ownerScopeType: null,
      ownerScopeId: null,
      runnerBackend: "local",
      providerBillingMode: "platform_credentials",
      claudeAuthMode: null,
      codexAuthMode: "subscription",
    });

    const result = await askProjectContextQuestion({
      projectId: "project-1",
      question: "How is superadmin decided?",
      model: "gpt-5.6-sol",
      sourceSystem: "tg-spec",
    });

    expect(result.success).toBe(true);
    expect(postWorkerJson).toHaveBeenCalledWith(
      "http://worker.local/containers/preview-project-1/context-question",
      {
        question: "How is superadmin decided?",
        model: "gpt-5.5",
        providerBillingMode: "platform_credentials",
        claudeAuthMode: "api_key",
        codexAuthMode: "subscription",
        authEnv: {
          CODEX_AUTH_JSON: "{\"accessToken\":\"codex-token\"}",
        },
      },
      { timeoutMs: 130000 },
    );
    expect((prisma as any).projectEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        direction: "in",
        type: "context_question",
        payload: expect.objectContaining({
          model: "gpt-5.5",
          requestedModel: "gpt-5.6-sol",
          codexAuthMode: "subscription",
        }),
      }),
    });
  });

  it("uses the user BYOK owner credential lane for Claude /ask", async () => {
    vi.mocked(buildRunAuthEnvFresh).mockResolvedValue({
      ANTHROPIC_API_KEY: "user-anthropic-key",
    });
    vi.mocked((prisma as any).project.findUnique).mockResolvedValue({
      id: "project-1",
      agent: "claude-code",
      model: "claude-sonnet-4-6",
      ownerScopeType: "user",
      ownerScopeId: "user-42",
      runnerBackend: "local",
      providerBillingMode: "byok",
      claudeAuthMode: "api_key",
      codexAuthMode: null,
    });

    const result = await askProjectContextQuestion({
      projectId: "project-1",
      question: "What is the current status?",
      model: "claude-sonnet-4-6",
      sourceSystem: "arena",
    });

    expect(result.success).toBe(true);
    expect(buildRunAuthEnvFresh).toHaveBeenCalledWith(
      {
        claudeAuthMode: "api_key",
        codexAuthMode: "api_key",
      },
      {
        agent: "claude-code",
        userId: "user-42",
      },
    );
    expect(postWorkerJson).toHaveBeenCalledWith(
      "http://worker.local/containers/preview-project-1/context-question",
      expect.objectContaining({
        claudeAuthMode: "api_key",
        codexAuthMode: "api_key",
        authEnv: {
          ANTHROPIC_API_KEY: "user-anthropic-key",
        },
      }),
      { timeoutMs: 130000 },
    );
  });

  it("uses the platform credits proxy lane for Claude /ask", async () => {
    vi.mocked((prisma as any).project.findUnique).mockResolvedValue({
      id: "project-1",
      agent: "claude-code",
      model: "claude-sonnet-4-6",
      ownerScopeType: null,
      ownerScopeId: null,
      runnerBackend: "local",
      providerBillingMode: "platform_credits",
      claudeAuthMode: null,
      codexAuthMode: null,
    });

    const result = await askProjectContextQuestion({
      projectId: "project-1",
      question: "What is the current status?",
      model: "claude-sonnet-4-6",
      sourceSystem: "arena",
    });

    expect(result.success).toBe(true);
    expect(buildRunAuthEnvFresh).not.toHaveBeenCalled();
    expect(postWorkerJson).toHaveBeenCalledWith(
      "http://worker.local/containers/preview-project-1/context-question",
      expect.objectContaining({
        providerBillingMode: "platform_credits",
        claudeAuthMode: "api_key",
        codexAuthMode: null,
        authEnv: {
          ANTHROPIC_API_KEY: "arena-proxy",
          ANTHROPIC_BASE_URL: "http://api-proxy:4100/anthropic/project/project-1",
          ANTHROPIC_API_URL: "http://api-proxy:4100/anthropic/project/project-1",
        },
      }),
      { timeoutMs: 130000 },
    );
  });

  it("records explicit failure when the runtime is unavailable", async () => {
    vi.mocked(getProjectWorkerInfo).mockResolvedValue({
      projectId: "project-1",
      workerUrl: null,
      containerName: null,
    });

    const result = await askProjectContextQuestion({
      projectId: "project-1",
      question: "What is deployed?",
      model: "gpt-5.6-sol",
      sourceSystem: "tg-spec",
      sourceUserId: "telegram-1",
    });

    expect(result).toMatchObject({
      success: false,
      status: 409,
      error: "context_question_runtime_unavailable",
      questionId: "question-1",
    });
    expect(postWorkerJson).not.toHaveBeenCalled();
    expect((prisma as any).projectEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        direction: "out",
        type: "context_answer",
        payload: expect.objectContaining({
          status: "failed",
          error: "context_question_runtime_unavailable",
        }),
      }),
    });
  });

  it("preserves structured provider rate-limit failures for tg-spec retry policy", async () => {
    vi.mocked(postWorkerJson).mockResolvedValue({
      ok: false,
      status: 429,
      body: {
        error: "You've hit your session limit · resets 8:10pm (UTC)",
        code: "context_question_provider_rate_limit",
        kind: "rate_limit",
        retryable: true,
        executionMode: "claude_tool_allowlist",
        parameters: { retry_after: 120 },
      },
    });

    const result = await askProjectContextQuestion({
      projectId: "project-1",
      question: "What is deployed?",
      model: "claude-sonnet-4-6",
      sourceSystem: "tg-spec",
      sourceUserId: "telegram-1",
    });

    expect(result).toEqual({
      success: false,
      status: 429,
      error: "You've hit your session limit · resets 8:10pm (UTC)",
      questionId: "question-1",
      details: {
        code: "context_question_provider_rate_limit",
        kind: "rate_limit",
        retryable: true,
        executionMode: "claude_tool_allowlist",
        parameters: { retry_after: 120 },
        retryAfterSeconds: 120,
      },
    });
    expect((prisma as any).projectEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        direction: "out",
        type: "context_answer",
        payload: expect.objectContaining({
          status: "failed",
          error: "You've hit your session limit · resets 8:10pm (UTC)",
          executionMode: "claude_tool_allowlist",
          errorDetails: expect.objectContaining({
            code: "context_question_provider_rate_limit",
            kind: "rate_limit",
            parameters: { retry_after: 120 },
          }),
        }),
      }),
    });
  });
});
