import { NextResponse } from "next/server";
import { z } from "zod";
import { projectAccessJsonResponse } from "@/lib/project-access-response";
import { requireProjectRuntimeSurfaceCapability } from "@/lib/project-runtime-surface-access";
import {
  askProjectContextQuestion,
  listProjectContextQuestionThreads,
} from "@/lib/project-context-questions";

export const dynamic = "force-dynamic";

const JSON_RESPONSE_INIT = {
  headers: {
    "Cache-Control": "no-store",
  },
};

const ContextQuestionSchema = z.object({
  question: z.string().trim().min(1).max(2000),
  model: z.string().trim().min(1),
}).strict();

type RouteContext = {
  params: Promise<{ id: string }>;
};

function contextQuestionFailureJson(result: {
  error: string;
  questionId?: string;
  details?: {
    parameters?: {
      retry_after?: number;
    };
  };
}) {
  return {
    error: result.error,
    questionId: result.questionId,
    ...(result.details ? { details: result.details } : {}),
    ...(result.details?.parameters ? { parameters: result.details.parameters } : {}),
  };
}

export async function GET(
  request: Request,
  context: RouteContext,
) {
  const { id: projectId } = await context.params;
  const access = await requireProjectRuntimeSurfaceCapability(request, projectId, "project.runtime.manage");
  if (!access.authorized) {
    if ("status" in access && access.status === 400) {
      return NextResponse.json({ error: access.error }, { ...JSON_RESPONSE_INIT, status: 400 });
    }
    return projectAccessJsonResponse(access.error);
  }

  const questions = await listProjectContextQuestionThreads(projectId);
  return NextResponse.json({ questions }, JSON_RESPONSE_INIT);
}

export async function POST(
  request: Request,
  context: RouteContext,
) {
  const { id: projectId } = await context.params;
  const access = await requireProjectRuntimeSurfaceCapability(request, projectId, "project.runtime.manage");
  if (!access.authorized) {
    if ("status" in access && access.status === 400) {
      return NextResponse.json({ error: access.error }, { ...JSON_RESPONSE_INIT, status: 400 });
    }
    return projectAccessJsonResponse(access.error);
  }

  let body: z.infer<typeof ContextQuestionSchema>;
  try {
    body = ContextQuestionSchema.parse(await request.json());
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid request", details: error.flatten() },
        { ...JSON_RESPONSE_INIT, status: 400 },
      );
    }
    return NextResponse.json({ error: "Invalid JSON request" }, { ...JSON_RESPONSE_INIT, status: 400 });
  }

  const result = await askProjectContextQuestion({
    projectId,
    question: body.question,
    model: body.model,
    sourceSystem: "arena",
    actorUserId: access.session?.user?.id ?? null,
  });

  if (!result.success) {
    return NextResponse.json(
      contextQuestionFailureJson(result),
      { ...JSON_RESPONSE_INIT, status: result.status },
    );
  }

  return NextResponse.json({ ok: true, question: result.question }, JSON_RESPONSE_INIT);
}
