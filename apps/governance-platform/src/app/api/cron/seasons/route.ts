import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { processOpenToBuildTransition } from "@/lib/season-transition";
import { isCronAuthorized } from "@/lib/internal-auth";
import { notify } from "@/lib/notifications";

async function processSeasonTransitions() {
  const transitions: Array<{ seasonId: string; title: string; from: string; to: string }> = [];
  const now = new Date();

  // DRAFT → ACTIVE: submissionStart has arrived
  const draftsToActivate = await prisma.season.findMany({
    where: {
      status: "DRAFT",
      submissionStart: { lte: now },
    },
  });

  for (const season of draftsToActivate) {
    await prisma.season.update({
      where: { id: season.id },
      data: { status: "ACTIVE" },
    });
    transitions.push({ seasonId: season.id, title: season.title, from: "DRAFT", to: "ACTIVE" });
  }

  // ACTIVE (Open → Build): buildStart arrived, transition not yet processed
  const readyForBuild = await prisma.season.findMany({
    where: {
      status: "ACTIVE",
      buildStart: { lte: now },
      buildTransitionedAt: null,
    },
  });

  for (const season of readyForBuild) {
    try {
      const result = await processOpenToBuildTransition(season.id);
      transitions.push({
        seasonId: season.id,
        title: season.title,
        from: "Open",
        to: `Build (${result.winnersCount} winners, ${result.projectsCreated} projects)`,
      });

      // RA-224: Notify winner proposal creators
      for (const winner of result.winnerProposals) {
        notify({
          type: "proposal.approved",
          proposalId: winner.id,
          proposalTitle: winner.title || "Untitled Proposal",
        }).catch((err) =>
          console.error("[notifications] season winner notify error:", err),
        );
      }
    } catch (err) {
      console.error(`[cron] Open→Build transition failed for season ${season.id}:`, err);
    }
  }

  // ACTIVE → COMPLETED: buildDeadline has passed
  const activeToComplete = await prisma.season.findMany({
    where: {
      status: "ACTIVE",
      buildDeadline: { lte: now },
    },
  });

  for (const season of activeToComplete) {
    await prisma.season.update({
      where: { id: season.id },
      data: { status: "COMPLETED" },
    });
    transitions.push({ seasonId: season.id, title: season.title, from: "ACTIVE", to: "COMPLETED" });
  }

  // Revalidate if any transitions happened
  if (transitions.length > 0) {
    revalidatePath("/");
    revalidatePath("/admin");

  }

  return transitions;
}

export async function POST(request: Request) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const transitions = await processSeasonTransitions();
    return NextResponse.json({
      success: true,
      transitions,
      checkedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Season cron error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function GET(request: Request) {
  return POST(request);
}
