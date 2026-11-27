import { NextResponse } from "next/server";
import { getProjectVisualEvidenceArtifactForDownload } from "@/lib/project-interaction";
import { requireProjectCapability } from "@/lib/project-access";
import { projectAccessJsonResponse } from "@/lib/project-access-response";

export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string; reviewId: string }>;
}

export async function GET(_request: Request, context: RouteContext) {
  const { id: projectId, reviewId: rawReviewId } = await context.params;
  const reviewId = decodeReviewId(rawReviewId);
  if (!reviewId) {
    return NextResponse.json({ error: "Invalid visual evidence review id" }, { status: 400 });
  }

  const access = await requireProjectCapability(projectId, "project.view");
  if (!access.authorized) {
    return projectAccessJsonResponse(access.error);
  }

  const artifact = await getProjectVisualEvidenceArtifactForDownload({
    projectId,
    reviewId,
  });
  if (!artifact) {
    return NextResponse.json({ error: "Visual evidence artifact not found" }, { status: 404 });
  }

  return new NextResponse(new Blob([new Uint8Array(artifact.bytes)], { type: artifact.contentType }), {
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": artifact.contentType,
      "Content-Length": String(artifact.bytes.byteLength),
      "Content-Disposition": "inline",
      "X-Visual-Evidence-Sha256": artifact.sha256,
    },
  });
}

function decodeReviewId(value: string): string | null {
  try {
    const decoded = decodeURIComponent(value).trim();
    return /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(decoded) ? decoded : null;
  } catch {
    return null;
  }
}
