import { NextResponse } from "next/server";
import { projectAccessJsonResponse } from "@/lib/project-access-response";
import { requireProjectCapability } from "@/lib/project-access";
import { retryProjectNowInternal } from "@/lib/retry-now";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(_request: Request, context: RouteContext) {
  const { id: projectId } = await context.params;
  const access = await requireProjectCapability(projectId, "project.runtime.manage");
  if (!access.authorized) {
    return projectAccessJsonResponse(access.error);
  }

  const result = await retryProjectNowInternal(projectId);
  return NextResponse.json(result, { status: result.success ? 200 : 400 });
}
