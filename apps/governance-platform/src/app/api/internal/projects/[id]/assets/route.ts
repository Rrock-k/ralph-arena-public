import { NextResponse } from "next/server";
import { isRunnerAuthorized } from "@/lib/internal-auth";
import { prisma } from "@/lib/prisma";
import { notifyProjectChanged } from "@/lib/progress-bus";
import { getProjectAssetManifest, upsertProjectAsset } from "@/lib/project-assets";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/internal/projects/:id/assets
 *
 * RA-222: Runner polls this manifest and downloads changed assets separately.
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

  return NextResponse.json(await getProjectAssetManifest(id));
}

function readRequiredSearchParam(url: URL, name: string): string {
  const value = url.searchParams.get(name)?.trim();
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

export async function POST(request: Request, context: RouteContext) {
  try {
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

    const url = new URL(request.url);
    const assetPath = readRequiredSearchParam(url, "path");
    const originalName = readRequiredSearchParam(url, "filename");
    const contentType = request.headers.get("content-type")?.trim() || null;
    const buffer = Buffer.from(await request.arrayBuffer());

    const asset = await upsertProjectAsset({
      projectId: id,
      originalName,
      contentType,
      buffer,
      assetPath,
      uploadedById: "runner",
    });
    notifyProjectChanged(id);

    return NextResponse.json({
      ok: true,
      uploaded: true,
      assetId: asset.id,
      path: asset.path,
      sha256: asset.sha256,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to upload project asset";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
