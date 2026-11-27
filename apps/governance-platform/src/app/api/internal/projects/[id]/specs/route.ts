import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isRunnerAuthorized } from "@/lib/internal-auth";
import { buildRunnerSpecsPayload, RUNNER_SPEC_SELECT } from "@/lib/runner-specs";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/internal/projects/:id/specs
 *
 * RA-098: Runner polls this every 30s to detect spec changes.
 */
export async function GET(request: Request, context: RouteContext) {
  const { id } = await context.params;
  if (!isRunnerAuthorized(request, { projectId: id })) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const project = await prisma.project.findUnique({
    where: { id },
    select: { id: true },
  });

  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const specs = await prisma.spec.findMany({
    where: { projectId: id },
    orderBy: { orderIndex: "asc" },
    select: RUNNER_SPEC_SELECT,
  });

  const { specs: specItems, hash } = buildRunnerSpecsPayload(specs);

  return NextResponse.json({ specs: specItems, hash });
}
