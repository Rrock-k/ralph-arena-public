import { NextResponse } from "next/server";
import {
  getProjectReleaseArtifactForDownload,
  readProjectReleaseArtifactBytes,
} from "@/lib/project-release-artifacts";
import { requireProjectCapability } from "@/lib/project-access";
import { projectAccessJsonResponse } from "@/lib/project-access-response";

export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string; artifactId: string }>;
}

export async function GET(_request: Request, context: RouteContext) {
  const { id: projectId, artifactId: rawArtifactId } = await context.params;
  const artifactId = decodeArtifactId(rawArtifactId);
  if (!artifactId) {
    return NextResponse.json({ error: "Invalid release artifact id" }, { status: 400 });
  }

  const access = await requireProjectCapability(projectId, "project.view");
  if (!access.authorized) {
    return projectAccessJsonResponse(access.error);
  }

  const artifact = await getProjectReleaseArtifactForDownload(projectId, artifactId);
  if (!artifact || !artifact.filename || !artifact.contentType || !artifact.sha256) {
    return NextResponse.json({ error: "Release artifact not found" }, { status: 404 });
  }

  const bytes = await readProjectReleaseArtifactBytes(artifact);
  return new NextResponse(new Blob([new Uint8Array(bytes)], { type: artifact.contentType }), {
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": artifact.contentType,
      "Content-Length": String(bytes.byteLength),
      "Content-Disposition": `attachment; filename="${contentDispositionFilename(artifact.filename)}"`,
      "X-Project-Release-Sha256": artifact.sha256,
    },
  });
}

function decodeArtifactId(value: string): string | null {
  try {
    const decoded = decodeURIComponent(value).trim();
    return /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(decoded) ? decoded : null;
  } catch {
    return null;
  }
}

function contentDispositionFilename(filename: string): string {
  return filename.replace(/["\\\r\n]/g, "_");
}
