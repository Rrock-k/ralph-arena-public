import { NextResponse } from "next/server";
import { FEATURE_FLAG_KEYS } from "@/lib/feature-flag-keys";
import { prisma } from "@/lib/prisma";
import { isTestModeEnabledForRequest } from "@/lib/test-mode";

type CreateScenarioBody = {
  scenario?: "public_exhausted" | "public_warning";
  budgetVisibilityEnabled?: boolean;
};

export async function POST(req: Request) {
  if (!isTestModeEnabledForRequest(req)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  try {
    const body = (await req.json().catch(() => ({}))) as CreateScenarioBody;
    const budgetVisibilityEnabled = body.budgetVisibilityEnabled ?? true;

    await (prisma as any).featureFlag.upsert({
      where: { key: FEATURE_FLAG_KEYS.budgetVisibility },
      create: { key: FEATURE_FLAG_KEYS.budgetVisibility, enabled: budgetVisibilityEnabled },
      update: { enabled: budgetVisibilityEnabled },
    });
    const scenario = body.scenario ?? "public_exhausted";

    const usedCreditsUsd = scenario === "public_warning" ? 8.5 : 9.95;
    const totalCreditsUsd = 10;
    const now = Date.now();
    const title = `[e2e-budget-${scenario}] ${now}`;

    const proposal = await prisma.proposal.create({
      data: {
        title,
        description: "E2E budget scenario",
        spec: "E2E spec",
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
        budget: {
          create: {
            isEnabled: true,
            totalCreditsUsd,
            usedCreditsUsd,
            note: `e2e scenario: ${scenario}`,
          },
        },
        components: {
          create: {
            name: "main",
            kind: "app",
            powerIntent: "ON",
            runtimeState: "RUNNING",
            agentState: "IDLE",
            blockers: [],
            lastOutcome: "COMPLETED",
            previewHealth: "HEALTHY",
            sourceType: "managed",
            sourceConfig: {},
            runtimeConfig: {},
            previewUrl: "https://example.test/e2e-budget",
          },
        },
      },
      select: { id: true },
    });

    return NextResponse.json({
      projectId: project.id,
      scenario,
      totalCreditsUsd,
      usedCreditsUsd,
      remainingUsd: totalCreditsUsd - usedCreditsUsd,
    });
  } catch (error) {
    console.error("[e2e-budget] setup failed:", error);
    return NextResponse.json(
      { error: "Failed to setup scenario", details: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}

export async function DELETE(req: Request) {
  if (!isTestModeEnabledForRequest(req)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  try {
    await (prisma as any).featureFlag.upsert({
      where: { key: FEATURE_FLAG_KEYS.budgetVisibility },
      create: { key: FEATURE_FLAG_KEYS.budgetVisibility, enabled: false },
      update: { enabled: false },
    });

    const deleted = await prisma.proposal.deleteMany({
      where: {
        title: {
          startsWith: "[e2e-",
        },
      },
    });

    return NextResponse.json({
      success: true,
      deletedProposals: deleted.count,
    });
  } catch (error) {
    console.error("[e2e-budget] cleanup failed:", error);
    return NextResponse.json(
      { error: "Failed to cleanup e2e data", details: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
