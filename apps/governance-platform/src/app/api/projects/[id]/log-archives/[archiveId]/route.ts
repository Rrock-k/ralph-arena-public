import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireProjectCapability } from "@/lib/project-access";
import { projectAccessJsonResponse } from "@/lib/project-access-response";

/**
 * GET /api/projects/:id/log-archives/:archiveId
 *
 * RA-108: Fetch a single log archive with full log body.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string; archiveId: string }> },
) {
  const { id: projectId, archiveId } = await context.params;
  const access = await requireProjectCapability(projectId, "project.runtime.manage");
  if (!access.authorized) {
    return projectAccessJsonResponse(access.error);
  }

  const archive = await prisma.logArchive.findFirst({
    where: { id: archiveId, projectId },
  });

  if (!archive) {
    return NextResponse.json({ error: "Archive not found" }, { status: 404 });
  }

  return NextResponse.json({ archive });
}
