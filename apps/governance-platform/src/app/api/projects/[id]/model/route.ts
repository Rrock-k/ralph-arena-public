import { NextResponse } from "next/server";
import { z } from "zod";
import { setProjectModelInternal } from "@/app/actions/project-settings";
import { INTERNAL_ACTION_TOKEN } from "@/lib/internal-action-token";
import { projectAccessJsonResponse } from "@/lib/project-access-response";
import { requireProjectRuntimeSurfaceCapability } from "@/lib/project-runtime-surface-access";

export const dynamic = "force-dynamic";

const SetProjectModelSchema = z.object({
  model: z.string().trim().min(1),
}).strict();

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  const { id: projectId } = await context.params;
  const access = await requireProjectRuntimeSurfaceCapability(request, projectId, "project.runtime.manage");
  if (!access.authorized) {
    if ("status" in access && access.status === 400) {
      return NextResponse.json({ error: access.error }, { status: 400 });
    }
    return projectAccessJsonResponse(access.error);
  }

  let body: z.infer<typeof SetProjectModelSchema>;
  try {
    body = SetProjectModelSchema.parse(await request.json());
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid request", details: error.flatten() }, { status: 400 });
    }
    return NextResponse.json({ error: "Invalid JSON request" }, { status: 400 });
  }

  const result = await setProjectModelInternal(projectId, body.model, INTERNAL_ACTION_TOKEN);
  if (!result.success) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  return NextResponse.json({
    ok: true,
    projectId: result.projectId,
    model: result.model,
    modelId: result.modelId,
  });
}
