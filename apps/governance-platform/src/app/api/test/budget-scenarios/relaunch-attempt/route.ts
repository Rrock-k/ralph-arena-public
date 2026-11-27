import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getPrimaryLifecycleComponent } from "@/lib/project-lifecycle";
import { isTestModeEnabledForRequest } from "@/lib/test-mode";

export async function POST(request: Request) {
  if (!isTestModeEnabledForRequest(request)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  try {
    const proposal = await prisma.proposal.create({
      data: {
        title: `[e2e-relaunch-budget] ${Date.now()}`,
        description: "E2E relaunch budget block scenario",
        spec: "Initial spec",
        status: "PROPOSED",
      },
      select: { id: true },
    });

    const project = await (prisma as any).project.create({
      data: {
        name: `[e2e-relaunch-project] ${Date.now()}`,
        mode: "community",
        ownerScopeType: "user",
        ownerScopeId: null,
        proposal: { connect: { id: proposal.id } },
        agent: "codex",
        agentImpl: "direct",
        repoBranch: "main",
        specs: {
          create: {
            title: "Spec #1",
            content: "Build feature X",
            orderIndex: 0,
          },
        },
        budget: {
          create: {
            isEnabled: true,
            totalCreditsUsd: 10,
            usedCreditsUsd: 9.95,
            note: "e2e exhausted relaunch",
          },
        },
        components: {
          create: {
            name: "main",
            kind: "app",
            powerIntent: "OFF",
            runtimeState: "STOPPED",
            agentState: "IDLE",
            blockers: ["BUDGET"],
            sourceType: "managed",
            sourceConfig: {},
            runtimeConfig: {},
          },
        },
      },
      select: { id: true },
    });

    const projectState = await prisma.project.findUnique({
      where: { id: project.id },
      select: {
        archivedAt: true,
        components: {
          orderBy: { createdAt: "asc" as const },
          take: 1,
          select: { agentState: true, blockers: true },
        },
        runLogs: {
          orderBy: { createdAt: "desc" },
          take: 10,
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
      projectId: project.id,
      projectStatus: projectState
        ? getPrimaryLifecycleComponent(projectState)?.agentState ?? (projectState.archivedAt ? "ARCHIVED" : null)
        : null,
      runLogs: projectState?.runLogs ?? [],
    });
  } catch (error) {
    console.error("[e2e-budget] relaunch attempt failed:", error);
    return NextResponse.json(
      { error: "Failed to execute relaunch attempt", details: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
