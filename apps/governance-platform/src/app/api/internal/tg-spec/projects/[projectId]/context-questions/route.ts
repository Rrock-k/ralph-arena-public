import { NextResponse } from "next/server";
import { z } from "zod";
import { isTgSpecInternalAuthorized } from "@/lib/internal-auth";
import { askProjectContextQuestion } from "@/lib/project-context-questions";

export const dynamic = "force-dynamic";

const JSON_RESPONSE_INIT = {
  headers: {
    "Cache-Control": "no-store",
  },
};

const TgSpecContextQuestionSchema = z.object({
  question: z.string().trim().min(1).max(2000),
  model: z.string().trim().min(1).optional(),
  sourceUserId: z.string().trim().min(1).optional(),
  sourceChatId: z.string().trim().min(1).optional(),
  sourceMessageId: z.string().trim().min(1).optional(),
}).strict();

type RouteContext = {
  params: Promise<{ projectId: string }>;
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

export async function POST(
  request: Request,
  context: RouteContext,
) {
  if (!isTgSpecInternalAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { ...JSON_RESPONSE_INIT, status: 401 });
  }

  let body: z.infer<typeof TgSpecContextQuestionSchema>;
  try {
    body = TgSpecContextQuestionSchema.parse(await request.json());
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid request", details: error.flatten() },
        { ...JSON_RESPONSE_INIT, status: 400 },
      );
    }
    return NextResponse.json({ error: "Invalid JSON request" }, { ...JSON_RESPONSE_INIT, status: 400 });
  }

  const { projectId } = await context.params;
  const result = await askProjectContextQuestion({
    projectId,
    question: body.question,
    model: body.model,
    sourceSystem: "tg-spec",
    sourceUserId: body.sourceUserId ?? null,
    sourceChatId: body.sourceChatId ?? null,
    sourceMessageId: body.sourceMessageId ?? null,
  });

  if (!result.success) {
    return NextResponse.json(
      contextQuestionFailureJson(result),
      { ...JSON_RESPONSE_INIT, status: result.status },
    );
  }

  return NextResponse.json({ ok: true, question: result.question }, JSON_RESPONSE_INIT);
}
