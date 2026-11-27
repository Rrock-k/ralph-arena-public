import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isCronAuthorized } from "@/lib/internal-auth";
import { getPrimaryLifecycleComponent } from "@/lib/project-lifecycle";
import { applyStateChange, requirePrimaryComponentRow } from "@/lib/project-state-effects";
import { tryAutoResumePausedRun } from "@/lib/budget-resume";
import { BUDGET_THRESHOLD_USD } from "@/lib/project-budget";
import { notify } from "@/lib/notifications";

/**
 * POST /api/cron/budget
 *
 * Budget guard background job.
 * - Checks RUNNING projects for budget exhaustion → adds BUDGET blocker
 * - Checks blocked-on-BUDGET projects for budget replenishment → removes blocker
 */
export async function POST(request: Request) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const paused: string[] = [];
  const resumed: string[] = [];

  const cronCtx = { source: "cron" as const, trigger: "budget-guard" };

  // 1. Check RUNNING projects for budget exhaustion
  const runningProjects = await prisma.project.findMany({
    where: {
      archivedAt: null,
      components: {
        some: {
          kind: "app",
          powerIntent: "ON",
          runtimeState: "RUNNING",
          OR: [
            { agentState: "RUNNING" },
            { agentState: null },
          ],
        },
      },
    },
    select: {
      id: true,
      name: true,
      budget: {
        select: { isEnabled: true, totalCreditsUsd: true, usedCreditsUsd: true },
      },
    },
  });

  for (const project of runningProjects) {
    const budget = project.budget;
    if (!budget?.isEnabled || budget.totalCreditsUsd <= 0) continue;

    const remainingUsd = budget.totalCreditsUsd - budget.usedCreditsUsd;
    if (remainingUsd <= BUDGET_THRESHOLD_USD) {
      const didPause = await prisma.$transaction(async (tx) => {
        const row = await requirePrimaryComponentRow(tx, project.id);
        if (row.blockers.includes("BUDGET")) return false;

        await applyStateChange(tx, project.id, { type: "addBlocker", blocker: "BUDGET" }, { ...cronCtx, reason: "budget_threshold_reached" });
        return true;
      });
      if (!didPause) continue;

      paused.push(project.id);

      // RA-224: Notify project owner about budget pause
      notify({
        type: "project.paused_budget",
        projectId: project.id,
        projectName: project.name,
      }).catch((err) =>
        console.error("[notifications] budget pause notify error:", err),
      );
    }
  }

  // 2. Check BUDGET-blocked projects for budget replenishment
  const blockedProjects = await prisma.project.findMany({
    where: {
      archivedAt: null,
      components: {
        some: {
          kind: "app",
          blockers: { has: "BUDGET" },
        },
      },
    },
    select: {
      id: true,
      budget: {
        select: { isEnabled: true, totalCreditsUsd: true, usedCreditsUsd: true },
      },
      components: {
        orderBy: { createdAt: "asc" as const },
        take: 1,
        select: { kind: true, blockers: true },
      },
    },
  });

  for (const project of blockedProjects) {
    const primaryComponent = getPrimaryLifecycleComponent(project);
    const blockers = primaryComponent?.blockers ?? [];
    if (!blockers.includes("BUDGET")) continue;

    const budget = project.budget;
    if (!budget?.isEnabled) continue;
    if (budget.totalCreditsUsd <= 0) continue;

    const remainingUsd = budget.totalCreditsUsd - budget.usedCreditsUsd;
    if (remainingUsd > BUDGET_THRESHOLD_USD) {
      const resumedProjectId = await prisma.$transaction(async (tx) => (
        tryAutoResumePausedRun(tx as any, project.id, remainingUsd)
      ));
      if (resumedProjectId) {
        resumed.push(project.id);
      }
    }
  }

  if (paused.length) console.log(`[budget-guard] Paused projects: ${paused.join(", ")}`);
  if (resumed.length) console.log(`[budget-guard] Resumed projects: ${resumed.join(", ")}`);

  return NextResponse.json({ paused: paused.length, resumed: resumed.length });
}
