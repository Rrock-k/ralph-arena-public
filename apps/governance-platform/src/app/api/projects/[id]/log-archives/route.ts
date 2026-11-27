import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireProjectCapability } from "@/lib/project-access";
import { projectAccessJsonResponse } from "@/lib/project-access-response";

/**
 * GET /api/projects/:id/log-archives
 *
 * RA-108: List log archives for a project (metadata only, no log body).
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id: projectId } = await context.params;
  const access = await requireProjectCapability(projectId, "project.runtime.manage");
  if (!access.authorized) {
    return projectAccessJsonResponse(access.error);
  }

  const archives = await prisma.logArchive.findMany({
    where: { projectId },
    select: {
      id: true,
      agent: true,
      agentImpl: true,
      model: true,
      terminalState: true,
      inputTokens: true,
      outputTokens: true,
      estimatedCostUsd: true,
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ archives });
}
