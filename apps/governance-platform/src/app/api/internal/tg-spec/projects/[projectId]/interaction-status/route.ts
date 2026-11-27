import { NextResponse } from "next/server";
import { isTgSpecInternalAuthorized } from "@/lib/internal-auth";
import { getProjectInteractionSnapshotForViewer } from "@/lib/project-interaction";
import {
  buildVisualEvidenceReadiness,
  selectReviewableVisualEvidenceReviews,
} from "@/lib/project-visual-evidence-readiness";

export const dynamic = "force-dynamic";

const JSON_RESPONSE_INIT = {
  headers: {
    "Cache-Control": "no-store",
  },
};

type RouteContext = {
  params: Promise<{ projectId: string }>;
};

export async function GET(
  request: Request,
  context: RouteContext,
) {
  if (!isTgSpecInternalAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { ...JSON_RESPONSE_INIT, status: 401 });
  }

  const { projectId } = await context.params;
  const result = await getProjectInteractionSnapshotForViewer({
    projectId,
    session: null,
    hasBypass: true,
    surface: "telegram",
  });

  switch (result.status) {
    case "ok": {
      const visualEvidenceReviews = selectReviewableVisualEvidenceReviews(result.snapshot);
      return NextResponse.json({
        project: {
          id: result.snapshot.project.id,
          name: result.snapshot.project.name,
          slug: result.snapshot.project.slug,
        },
        statusSummary: result.snapshot.execution.statusSummary,
        activeChangeBatches: result.snapshot.execution.activeChangeBatches,
        latestAcceptedUpdate: result.snapshot.execution.latestAcceptedUpdate,
        visualEvidenceReadiness: buildVisualEvidenceReadiness(result.snapshot),
        proofReviews: result.snapshot.proofReviews,
        visualEvidenceReviews,
      }, JSON_RESPONSE_INIT);
    }
    case "not_found":
      return NextResponse.json({ error: "Project not found" }, { ...JSON_RESPONSE_INIT, status: 404 });
    case "unauthorized":
      return NextResponse.json({ error: "Unauthorized" }, { ...JSON_RESPONSE_INIT, status: 401 });
    case "forbidden":
      return NextResponse.json({ error: "Project access denied" }, { ...JSON_RESPONSE_INIT, status: 403 });
  }
}
