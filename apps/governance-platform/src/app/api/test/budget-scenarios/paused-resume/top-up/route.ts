import { NextResponse } from "next/server";
import { setProjectBudgetLimitInternal } from "@/app/actions/budget";
import { prisma } from "@/lib/prisma";
import { getPrimaryLifecycleComponent } from "@/lib/project-lifecycle";
import { isTestModeEnabledForRequest } from "@/lib/test-mode";
import { INTERNAL_ACTION_TOKEN } from "@/lib/internal-action-token";

type TopUpBody = {
  projectId?: string;
  totalCreditsUsd?: number;
};

export async function POST(req: Request) {
  if (!isTestModeEnabledForRequest(req)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  try {
    const body = (await req.json().catch(() => ({}))) as TopUpBody;
    const projectId = body.projectId?.trim();
    const totalCreditsUsd = body.totalCreditsUsd ?? 15;

    if (!projectId) {
      return NextResponse.json({ error: "projectId is required" }, { status: 400 });
    }

    const result = await setProjectBudgetLimitInternal(projectId, totalCreditsUsd, true, "e2e top-up", {
      internalActionToken: INTERNAL_ACTION_TOKEN,
    });
    if (!result.success) {
      return NextResponse.json({ error: result.error ?? "Top-up failed" }, { status: 400 });
    }

    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: {
        archivedAt: true,
        components: {
          orderBy: { createdAt: "asc" as const },
          take: 1,
          select: { agentState: true, blockers: true },
        },
        runLogs: {
          where: {
            event: {
              in: ["RESUMED", "PROVISIONING"],
            },
          },
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            event: true,
            detail: true,
            createdAt: true,
          },
        },
      },
    });

    return NextResponse.json({
      success: true,
      projectId,
      totalCreditsUsd: result.totalCreditsUsd,
      remainingUsd: result.remainingUsd,
      resumedProjectId: result.resumedProjectId ?? null,
      projectStatus: project
        ? getPrimaryLifecycleComponent(project)?.agentState ?? (project.archivedAt ? "ARCHIVED" : null)
        : null,
      runLogs: project?.runLogs ?? [],
    });
  } catch (error) {
    console.error("[e2e-budget] paused-resume top-up failed:", error);
    return NextResponse.json(
      { error: "Failed to top-up paused-resume scenario", details: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
