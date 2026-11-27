import { NextResponse } from "next/server";
import { projectAccessJsonResponse } from "@/lib/project-access-response";
import { resolvePlatformAccess } from "@/lib/platform-access";
import { requireProjectRuntimeSurfaceCapability } from "@/lib/project-runtime-surface-access";
import { startTgSpecProjectLaunch } from "@/lib/tg-spec-project-launch";

export const dynamic = "force-dynamic";

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
  if (!access.isOwner && !access.isAdmin) {
    return projectAccessJsonResponse("Project access denied");
  }

  const platformAccess = await resolvePlatformAccess(access.session as any, access.hasBypass);
  const result = await startTgSpecProjectLaunch(projectId, {
    actorUserId: access.session?.user?.id ?? null,
    privileged:
      platformAccess.hasCapability("platform.projects.manage")
      || platformAccess.hasCapability("platform.runtime.manage"),
  });

  if (!result.success) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  return NextResponse.json({
    ok: true,
    started: true,
    projectId: result.projectId,
  });
}
