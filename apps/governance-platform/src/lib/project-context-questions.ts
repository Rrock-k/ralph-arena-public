import "server-only";

import { prisma } from "@/lib/prisma";
import { getProjectWorkerInfo, postWorkerJson } from "@/lib/control-plane";
import { progressBus } from "@/lib/progress-bus";
import {
  buildRunAuthEnvFresh,
  narrowRunAuthModesForAgent,
  resolveRunAuthModesForBuild,
  RuntimeAuthUnavailableError,
} from "@/lib/run-auth";
import { userProviderCredentialOwnerId } from "@/lib/user-provider-credentials";
import {
  buildProviderProxyAuthEnv,
  resolveApiProxyUrlForBackend,
} from "@/lib/provider-proxy-auth";

export const PROJECT_CONTEXT_QUESTION_MODELS = [
  "claude-sonnet-4-6",
  "gpt-5.6-sol",
  "gpt-5.6-terra",
  "gpt-5.6-luna",
  "gpt-5.5",
  "gpt-5.4",
  "gpt-5.4-mini",
] as const;

const DEFAULT_CLAUDE_CONTEXT_QUESTION_MODEL = "claude-sonnet-4-6";
const DEFAULT_CODEX_CONTEXT_QUESTION_MODEL = "gpt-5.6-sol";
const CONTEXT_QUESTION_EVENT_VERSION = "ra-332.context-question.v1";
const CONTEXT_ANSWER_EVENT_VERSION = "ra-332.context-answer.v1";
const MAX_CONTEXT_QUESTION_LENGTH = 2000;
const MAX_CONTEXT_ANSWER_LENGTH = 6000;
const WORKER_CONTEXT_QUESTION_TIMEOUT_MS = 120_000;
const WORKER_CONTEXT_QUESTION_FETCH_RETRY_DELAY_MS = 1_000;

export type ProjectContextQuestionSourceSystem = "arena" | "tg-spec";

export type ProjectContextQuestionThread = {
  id: string;
  projectId: string;
  question: string;
  model: string;
  sourceSystem: string | null;
  status: "answered" | "failed" | "pending";
  answer: string | null;
  error: string | null;
  askedAt: string;
  answeredAt: string | null;
};

type ContextQuestionEventRow = {
  id: string;
  projectId: string;
  direction: string;
  type: string;
  payload: unknown;
  createdAt: Date;
};

type AskProjectContextQuestionInput = {
  projectId: string;
  question: string;
  model?: string | null;
  sourceSystem: ProjectContextQuestionSourceSystem;
  actorUserId?: string | null;
  sourceUserId?: string | null;
  sourceChatId?: string | null;
  sourceMessageId?: string | null;
};

type AskProjectContextQuestionResult =
  | {
      success: true;
      question: ProjectContextQuestionThread;
    }
  | {
      success: false;
      status: number;
      error: string;
      questionId?: string;
      details?: ContextQuestionFailureDetails;
    };

type ContextQuestionFailureKind =
  | "rate_limit"
  | "auth"
  | "runtime_unavailable"
  | "timeout"
  | "worker";

type ContextQuestionFailureDetails = {
  code: string;
  kind: ContextQuestionFailureKind;
  retryable: boolean;
  executionMode?: string | null;
  parameters?: {
    retry_after?: number;
  };
  retryAfterSeconds?: number;
  retryAt?: string;
};

type ContextQuestionProject = {
  id: string;
  agent: string | null;
  model: string | null;
  ownerScopeType: string | null;
  ownerScopeId: string | null;
  runnerBackend: string | null;
  providerBillingMode: string | null;
  claudeAuthMode: string | null;
  codexAuthMode: string | null;
};

type ContextQuestionExecution = {
  model: string;
  requestedModel: string | null;
  providerBillingMode: string;
  claudeAuthMode: string | null;
  codexAuthMode: string | null;
};

type ContextQuestionAuthPlan = {
  authEnv: Record<string, string>;
  claudeAuthMode: string | null;
  codexAuthMode: string | null;
};

function normalizeNonEmptyString(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function isSupportedContextQuestionModel(model: string | null): model is typeof PROJECT_CONTEXT_QUESTION_MODELS[number] {
  return Boolean(model && PROJECT_CONTEXT_QUESTION_MODELS.includes(model as typeof PROJECT_CONTEXT_QUESTION_MODELS[number]));
}

function isClaudeContextQuestionModel(model: string): boolean {
  return model.startsWith("claude-");
}

function isCodexContextQuestionModel(model: string): boolean {
  return model.startsWith("gpt-");
}

function normalizeProviderBillingMode(value: string | null | undefined): string {
  return value === "platform_credits" || value === "platform_credentials" ? value : "byok";
}

function normalizeClaudeAuthMode(value: string | null | undefined): string | null {
  return value === "oauth" || value === "api_key" ? value : null;
}

function normalizeCodexAuthMode(value: string | null | undefined): string | null {
  return value === "subscription" || value === "api_key" ? value : null;
}

function defaultContextQuestionModelForProject(project: ContextQuestionProject, provider: "claude" | "codex"): string {
  const projectModel = normalizeNonEmptyString(project.model);
  if (isSupportedContextQuestionModel(projectModel)) {
    if (provider === "claude" && isClaudeContextQuestionModel(projectModel)) return projectModel;
    if (provider === "codex" && isCodexContextQuestionModel(projectModel)) return projectModel;
  }
  return provider === "claude"
    ? DEFAULT_CLAUDE_CONTEXT_QUESTION_MODEL
    : DEFAULT_CODEX_CONTEXT_QUESTION_MODEL;
}

function shouldUseProjectCodexSubscriptionModel(
  project: ContextQuestionProject,
  providerBillingMode: string,
  requestedModel: string,
): boolean {
  if (providerBillingMode !== "platform_credentials") return false;
  if (normalizeCodexAuthMode(project.codexAuthMode) !== "subscription") return false;
  if (requestedModel !== DEFAULT_CODEX_CONTEXT_QUESTION_MODEL) return false;

  const projectModel = normalizeNonEmptyString(project.model);
  return Boolean(
    projectModel
      && projectModel !== requestedModel
      && isSupportedContextQuestionModel(projectModel)
      && isCodexContextQuestionModel(projectModel),
  );
}

function projectPrimaryProvider(project: ContextQuestionProject): "claude" | "codex" | null {
  const projectModel = normalizeNonEmptyString(project.model);
  if (project.agent === "claude-code" || (projectModel && projectModel.startsWith("claude-"))) return "claude";
  if (project.agent === "codex" || (projectModel && projectModel.startsWith("gpt-"))) return "codex";
  return null;
}

function resolveProjectContextQuestionExecution(
  project: ContextQuestionProject,
  requestedModel: string,
): ContextQuestionExecution {
  const providerBillingMode = normalizeProviderBillingMode(project.providerBillingMode);
  const primaryProvider = projectPrimaryProvider(project);
  let model = requestedModel;

  if (primaryProvider === "claude" && !isClaudeContextQuestionModel(requestedModel)) {
    model = defaultContextQuestionModelForProject(project, "claude");
  }
  if (
    primaryProvider === "codex"
    && (
      !isCodexContextQuestionModel(requestedModel)
      || shouldUseProjectCodexSubscriptionModel(project, providerBillingMode, requestedModel)
    )
  ) {
    model = defaultContextQuestionModelForProject(project, "codex");
  }

  const claudeAuthMode = normalizeClaudeAuthMode(project.claudeAuthMode)
    ?? (primaryProvider === "claude" ? "oauth" : null);
  const codexAuthMode = normalizeCodexAuthMode(project.codexAuthMode)
    ?? (primaryProvider === "codex"
      ? (providerBillingMode === "platform_credentials" ? "subscription" : "api_key")
      : null);

  return {
    model,
    requestedModel: model === requestedModel ? null : requestedModel,
    providerBillingMode,
    claudeAuthMode,
    codexAuthMode,
  };
}

export function validateProjectContextQuestionInput(input: {
  question?: string | null;
  model?: string | null;
}): { success: true; question: string; model: string } | { success: false; status: number; error: string } {
  const question = normalizeNonEmptyString(input.question);
  if (!question) {
    return { success: false, status: 400, error: "context_question_required" };
  }
  if (question.length > MAX_CONTEXT_QUESTION_LENGTH) {
    return { success: false, status: 400, error: "context_question_too_long" };
  }

  const model = normalizeNonEmptyString(input.model) ?? DEFAULT_CLAUDE_CONTEXT_QUESTION_MODEL;
  if (!PROJECT_CONTEXT_QUESTION_MODELS.includes(model as typeof PROJECT_CONTEXT_QUESTION_MODELS[number])) {
    return { success: false, status: 400, error: "context_question_model_unsupported" };
  }

  return { success: true, question, model };
}

function readPayloadObject(payload: unknown): Record<string, unknown> {
  return payload && typeof payload === "object" && !Array.isArray(payload)
    ? payload as Record<string, unknown>
    : {};
}

function readNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" && !value.trim()) return null;
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function parseWorkerBody(body: unknown): Record<string, unknown> {
  if (!body) return {};
  if (typeof body === "object" && !Array.isArray(body)) return body as Record<string, unknown>;
  if (typeof body !== "string") return {};
  try {
    return readPayloadObject(JSON.parse(body));
  } catch {
    return {};
  }
}

function inferContextQuestionFailureKind(
  status: number | undefined,
  code: string | null,
): ContextQuestionFailureKind {
  if (status === 429) return "rate_limit";
  if (status === 401 || code?.includes("_auth_") || code?.endsWith("_auth_missing")) return "auth";
  if (status === 409 || code === "context_question_runtime_unavailable") return "runtime_unavailable";
  if (status === 504 || code === "context_question_timeout") return "timeout";
  return "worker";
}

function defaultContextQuestionFailureCode(kind: ContextQuestionFailureKind): string {
  switch (kind) {
    case "rate_limit":
      return "context_question_provider_rate_limit";
    case "auth":
      return "context_question_auth_unavailable";
    case "runtime_unavailable":
      return "context_question_runtime_unavailable";
    case "timeout":
      return "context_question_timeout";
    case "worker":
      return "context_question_worker_error";
  }
}

function normalizeRetryAfterSeconds(value: unknown): number | null {
  const number = readNumber(value);
  if (number === null || number < 0) return null;
  return Math.ceil(number);
}

function buildContextQuestionFailureDetails(input: {
  status?: number;
  error?: string | null;
  body?: Record<string, unknown>;
  code?: string | null;
  executionMode?: string | null;
}): ContextQuestionFailureDetails {
  const body = input.body ?? {};
  const nestedDetails = readPayloadObject(body.details);
  const nestedParameters = readPayloadObject(nestedDetails.parameters);
  const topLevelParameters = readPayloadObject(body.parameters);
  const code = input.code
    ?? readString(body.code)
    ?? readString(body.errorCode)
    ?? readString(nestedDetails.code);
  const kindRaw = readString(body.kind)
    ?? readString(body.errorKind)
    ?? readString(nestedDetails.kind);
  const kind = (
    kindRaw === "rate_limit"
    || kindRaw === "auth"
    || kindRaw === "runtime_unavailable"
    || kindRaw === "timeout"
    || kindRaw === "worker"
  )
    ? kindRaw
    : inferContextQuestionFailureKind(input.status, code);
  const retryAfterSeconds = normalizeRetryAfterSeconds(
    body.retryAfterSeconds
    ?? body.retryAfter
    ?? topLevelParameters.retry_after
    ?? nestedDetails.retryAfterSeconds
    ?? nestedDetails.retryAfter
    ?? nestedParameters.retry_after,
  );
  const retryAt = readString(body.retryAt) ?? readString(nestedDetails.retryAt);
  const executionMode = input.executionMode
    ?? readString(body.executionMode)
    ?? readString(nestedDetails.executionMode);

  return {
    code: code ?? defaultContextQuestionFailureCode(kind),
    kind,
    retryable: kind === "rate_limit",
    ...(executionMode ? { executionMode } : {}),
    ...(retryAfterSeconds !== null
      ? {
          parameters: { retry_after: retryAfterSeconds },
          retryAfterSeconds,
        }
      : {}),
    ...(retryAt ? { retryAt } : {}),
  };
}

function parseWorkerFailure(result: { status?: number; body?: unknown; error?: string }): {
  error: string;
  details: ContextQuestionFailureDetails;
} {
  const body = parseWorkerBody(result.body);
  const error = result.error
    ?? readString(body.error)
    ?? readString(readPayloadObject(body.details).error)
    ?? (typeof result.body === "string" && result.body.trim() ? result.body.slice(0, 500) : null)
    ?? "context_question_worker_error";

  return {
    error,
    details: buildContextQuestionFailureDetails({
      status: result.status,
      error,
      body,
      code: readString(body.code) ?? null,
    }),
  };
}

function capPersistedText(value: string, max = MAX_CONTEXT_ANSWER_LENGTH): string {
  const normalized = value.trim();
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, max)}\n\n[context question answer truncated]`;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function pickContextQuestionAuthEnv(authEnv: Record<string, string>): Record<string, string> {
  const picked: Record<string, string> = {};
  for (const key of [
    "ANTHROPIC_API_KEY",
    "ANTHROPIC_BASE_URL",
    "ANTHROPIC_API_URL",
    "CLAUDE_CODE_OAUTH_TOKEN",
    "OPENAI_API_KEY",
    "OPENAI_BASE_URL",
    "OPENAI_API_BASE",
    "CODEX_AUTH_JSON",
  ]) {
    const value = authEnv[key]?.trim();
    if (value) picked[key] = value;
  }
  return picked;
}

function contextQuestionAgent(project: ContextQuestionProject, execution: ContextQuestionExecution): string | null {
  const agent = normalizeNonEmptyString(project.agent);
  if (agent) return agent;
  if (isClaudeContextQuestionModel(execution.model)) return "claude-code";
  if (isCodexContextQuestionModel(execution.model)) return "codex";
  return null;
}

async function buildContextQuestionAuthPlan(
  project: ContextQuestionProject,
  execution: ContextQuestionExecution,
): Promise<ContextQuestionAuthPlan> {
  const agent = contextQuestionAgent(project, execution);
  if (!agent) {
    return {
      authEnv: {},
      claudeAuthMode: execution.claudeAuthMode,
      codexAuthMode: execution.codexAuthMode,
    };
  }

  if (execution.providerBillingMode === "platform_credits") {
    const authEnv = buildProviderProxyAuthEnv({
      projectId: project.id,
      agent,
      apiProxyUrl: resolveApiProxyUrlForBackend(project.runnerBackend),
    });

    return {
      authEnv: pickContextQuestionAuthEnv(authEnv),
      claudeAuthMode: agent === "claude-code" ? "api_key" : null,
      codexAuthMode: agent === "codex" ? "api_key" : null,
    };
  }

  const userId = execution.providerBillingMode === "byok"
    ? userProviderCredentialOwnerId(project.ownerScopeType, project.ownerScopeId)
    : null;
  const rawAuthModes = narrowRunAuthModesForAgent(agent, {
    claudeAuthMode: execution.claudeAuthMode,
    codexAuthMode: execution.codexAuthMode,
  });
  const authModes = resolveRunAuthModesForBuild(rawAuthModes, {
    agent,
    userId,
  });
  const authEnv = await buildRunAuthEnvFresh(
    {
      claudeAuthMode: authModes.claudeAuthMode,
      codexAuthMode: authModes.codexAuthMode,
    },
    {
      agent,
      userId,
    },
  );

  return {
    authEnv: pickContextQuestionAuthEnv(authEnv),
    claudeAuthMode: authModes.claudeAuthMode ?? null,
    codexAuthMode: authModes.codexAuthMode ?? null,
  };
}

async function postContextQuestionWorkerJson(
  url: string,
  body: unknown,
): Promise<Awaited<ReturnType<typeof postWorkerJson>>> {
  const requestOptions = { timeoutMs: WORKER_CONTEXT_QUESTION_TIMEOUT_MS + 10_000 };
  const first = await postWorkerJson(url, body, requestOptions);
  if (first.ok || !first.error) return first;

  await sleep(WORKER_CONTEXT_QUESTION_FETCH_RETRY_DELAY_MS);
  return postWorkerJson(url, body, requestOptions);
}

function toThread(input: {
  questionEvent: {
    id: string;
    projectId: string;
    payload: unknown;
    createdAt: Date;
  };
  answerEvent?: {
    payload: unknown;
    createdAt: Date;
  } | null;
}): ProjectContextQuestionThread {
  const questionPayload = readPayloadObject(input.questionEvent.payload);
  const answerPayload = input.answerEvent ? readPayloadObject(input.answerEvent.payload) : {};
  const answerStatus = readString(answerPayload.status);
  const status = answerStatus === "failed"
    ? "failed"
    : answerStatus === "answered"
      ? "answered"
      : "pending";

  return {
    id: input.questionEvent.id,
    projectId: input.questionEvent.projectId,
    question: readString(questionPayload.question) ?? "",
    model: readString(questionPayload.model) ?? "",
    sourceSystem: readString(questionPayload.sourceSystem),
    status,
    answer: readString(answerPayload.answer),
    error: readString(answerPayload.error),
    askedAt: input.questionEvent.createdAt.toISOString(),
    answeredAt: input.answerEvent?.createdAt.toISOString() ?? null,
  };
}

export async function listProjectContextQuestionThreads(
  projectId: string,
  limit = 6,
): Promise<ProjectContextQuestionThread[]> {
  const events = await (prisma as any).projectEvent.findMany({
    where: {
      projectId,
      type: { in: ["context_question", "context_answer"] },
    },
    orderBy: { createdAt: "desc" },
    take: Math.max(1, Math.min(limit, 20)) * 4,
    select: {
      id: true,
      projectId: true,
      direction: true,
      type: true,
      payload: true,
      createdAt: true,
    },
  }) as ContextQuestionEventRow[];

  const answersByQuestionId = new Map<string, ContextQuestionEventRow>();
  const questionEvents: ContextQuestionEventRow[] = [];
  for (const event of events) {
    if (event.type === "context_answer") {
      const payload = readPayloadObject(event.payload);
      const questionEventId = readString(payload.questionEventId);
      if (questionEventId && !answersByQuestionId.has(questionEventId)) {
        answersByQuestionId.set(questionEventId, event);
      }
      continue;
    }
    if (event.type === "context_question") {
      questionEvents.push(event);
    }
  }

  return questionEvents
    .slice(0, Math.max(1, Math.min(limit, 20)))
    .map((questionEvent) => toThread({
      questionEvent,
      answerEvent: answersByQuestionId.get(questionEvent.id) ?? null,
    }));
}

export async function askProjectContextQuestion(
  input: AskProjectContextQuestionInput,
): Promise<AskProjectContextQuestionResult> {
  const valid = validateProjectContextQuestionInput(input);
  if (!valid.success) return valid;

  const project = await prisma.project.findUnique({
    where: { id: input.projectId },
    select: {
      id: true,
      agent: true,
      model: true,
      ownerScopeType: true,
      ownerScopeId: true,
      runnerBackend: true,
      providerBillingMode: true,
      claudeAuthMode: true,
      codexAuthMode: true,
    },
  });
  if (!project) {
    return { success: false, status: 404, error: "Project not found" };
  }
  const execution = resolveProjectContextQuestionExecution(project, valid.model);

  const questionEvent = await (prisma as any).projectEvent.create({
    data: {
      projectId: input.projectId,
      // RA-386: the question travels to the runtime over HTTP, not through the
      // runner's event inbox. This row exists for the admin sidebar, so it is
      // governance's own record — `internal`, not `in`.
      direction: "internal",
      type: "context_question",
      payload: {
        version: CONTEXT_QUESTION_EVENT_VERSION,
        question: valid.question,
        model: execution.model,
        requestedModel: execution.requestedModel,
        providerBillingMode: execution.providerBillingMode,
        claudeAuthMode: execution.claudeAuthMode,
        codexAuthMode: execution.codexAuthMode,
        sourceSystem: input.sourceSystem,
        sourceUserId: normalizeNonEmptyString(input.sourceUserId),
        sourceChatId: normalizeNonEmptyString(input.sourceChatId),
        sourceMessageId: normalizeNonEmptyString(input.sourceMessageId),
      },
      userId: normalizeNonEmptyString(input.actorUserId),
    },
  });
  progressBus.notifyChanged({ type: "project_event", projectId: input.projectId });

  const worker = await getProjectWorkerInfo(input.projectId);
  if (!worker?.workerUrl || !worker.containerName) {
    await recordContextAnswerFailure({
      projectId: input.projectId,
      questionEventId: questionEvent.id,
      model: execution.model,
      error: "context_question_runtime_unavailable",
      details: buildContextQuestionFailureDetails({
        status: 409,
        code: "context_question_runtime_unavailable",
      }),
    });
    return {
      success: false,
      status: 409,
      error: "context_question_runtime_unavailable",
      questionId: questionEvent.id,
      details: buildContextQuestionFailureDetails({
        status: 409,
        code: "context_question_runtime_unavailable",
      }),
    };
  }

  const startedAt = Date.now();
  let authPlan: ContextQuestionAuthPlan;
  try {
    authPlan = await buildContextQuestionAuthPlan(project, execution);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await recordContextAnswerFailure({
      projectId: input.projectId,
      questionEventId: questionEvent.id,
      model: execution.model,
      error: message || "context_question_auth_unavailable",
      containerName: worker.containerName,
      durationMs: Date.now() - startedAt,
      details: buildContextQuestionFailureDetails({
        status: error instanceof RuntimeAuthUnavailableError ? error.statusCode : 503,
        error: message,
        code: "context_question_auth_unavailable",
      }),
    });
    return {
      success: false,
      status: error instanceof RuntimeAuthUnavailableError ? error.statusCode : 503,
      error: message || "context_question_auth_unavailable",
      questionId: questionEvent.id,
      details: buildContextQuestionFailureDetails({
        status: error instanceof RuntimeAuthUnavailableError ? error.statusCode : 503,
        error: message,
        code: "context_question_auth_unavailable",
      }),
    };
  }

  const workerResult = await postContextQuestionWorkerJson(
    `${worker.workerUrl}/containers/${encodeURIComponent(worker.containerName)}/context-question`,
    {
      question: valid.question,
      model: execution.model,
      providerBillingMode: execution.providerBillingMode,
      claudeAuthMode: authPlan.claudeAuthMode,
      codexAuthMode: authPlan.codexAuthMode,
      ...(Object.keys(authPlan.authEnv).length > 0 ? { authEnv: authPlan.authEnv } : {}),
    },
  );

  if (!workerResult.ok) {
    const failure = parseWorkerFailure(workerResult);
    await recordContextAnswerFailure({
      projectId: input.projectId,
      questionEventId: questionEvent.id,
      model: execution.model,
      error: failure.error,
      containerName: worker.containerName,
      durationMs: Date.now() - startedAt,
      details: failure.details,
    });
    return {
      success: false,
      status: workerResult.status && workerResult.status >= 400 ? workerResult.status : 502,
      error: failure.error,
      questionId: questionEvent.id,
      details: failure.details,
    };
  }

  const body = readPayloadObject(workerResult.body);
  const answer = readString(body.answer);
  if (!answer) {
    await recordContextAnswerFailure({
      projectId: input.projectId,
      questionEventId: questionEvent.id,
      model: execution.model,
      error: "context_question_empty_answer",
      containerName: worker.containerName,
      durationMs: Date.now() - startedAt,
      details: buildContextQuestionFailureDetails({
        status: 502,
        code: "context_question_empty_answer",
      }),
    });
    return {
      success: false,
      status: 502,
      error: "context_question_empty_answer",
      questionId: questionEvent.id,
      details: buildContextQuestionFailureDetails({
        status: 502,
        code: "context_question_empty_answer",
      }),
    };
  }

  const answerEvent = await (prisma as any).projectEvent.create({
    data: {
      projectId: input.projectId,
      direction: "out",
      type: "context_answer",
      payload: {
        version: CONTEXT_ANSWER_EVENT_VERSION,
        status: "answered",
        questionEventId: questionEvent.id,
        answer: capPersistedText(answer),
        model: execution.model,
        executionMode: readString(body.executionMode),
        containerName: worker.containerName,
        durationMs: Date.now() - startedAt,
      },
      userId: normalizeNonEmptyString(input.actorUserId),
    },
  });
  progressBus.notifyChanged({ type: "project_event", projectId: input.projectId });

  return {
    success: true,
    question: toThread({ questionEvent, answerEvent }),
  };
}

async function recordContextAnswerFailure(input: {
  projectId: string;
  questionEventId: string;
  model: string;
  error: string;
  containerName?: string | null;
  durationMs?: number | null;
  details?: ContextQuestionFailureDetails | null;
}) {
  const answerEvent = await (prisma as any).projectEvent.create({
    data: {
      projectId: input.projectId,
      direction: "out",
      type: "context_answer",
      payload: {
        version: CONTEXT_ANSWER_EVENT_VERSION,
        status: "failed",
        questionEventId: input.questionEventId,
        error: input.error.slice(0, 1000),
        model: input.model,
        containerName: input.containerName ?? null,
        durationMs: input.durationMs ?? null,
        ...(input.details ? { errorDetails: input.details } : {}),
        ...(input.details?.executionMode ? { executionMode: input.details.executionMode } : {}),
      },
    },
  });
  progressBus.notifyChanged({ type: "project_event", projectId: input.projectId });
  return answerEvent;
}
