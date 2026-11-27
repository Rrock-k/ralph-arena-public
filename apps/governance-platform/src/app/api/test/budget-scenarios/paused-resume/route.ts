import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isTestModeEnabledForRequest } from "@/lib/test-mode";

export async function POST(request: Request) {
  if (!isTestModeEnabledForRequest(request)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  try {
    const title = `[e2e-paused-resume] ${Date.now()}`;
    const proposal = await prisma.proposal.create({
      data: {
        title,
        description: "E2E paused-budget resume scenario",
        spec: "Initial e2e spec",
        status: "PROPOSED",
      },
      select: { id: true },
    });

    const project = await (prisma as any).project.create({
      data: {
        name: title,
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
            content: "Build feature Y",
            orderIndex: 0,
          },
        },
        budget: {
          create: {
            isEnabled: true,
            totalCreditsUsd: 10,
            usedCreditsUsd: 9.95,
            note: "e2e paused budget",
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

    return NextResponse.json({
      projectId: project.id,
      expectedInitialRunStatus: "PAUSED",
    });
  } catch (error) {
    console.error("[e2e-budget] paused-resume setup failed:", error);
    return NextResponse.json(
      { error: "Failed to setup paused-resume scenario", details: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
