import { NextResponse } from "next/server";
import { isRunnerAuthorized } from "@/lib/internal-auth";
import { getProjectAssetForDownload, readProjectAssetBytes } from "@/lib/project-assets";

interface RouteContext {
  params: Promise<{ id: string; assetId: string }>;
}

/**
 * GET /api/internal/projects/:id/assets/:assetId/download
 *
 * RA-222: Byte download endpoint used by runner asset sync.
 */
export async function GET(request: Request, context: RouteContext) {
  const { id, assetId } = await context.params;
  if (!isRunnerAuthorized(request, { projectId: id })) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const asset = await getProjectAssetForDownload(id, assetId);
  if (!asset) {
    return NextResponse.json({ error: "Asset not found" }, { status: 404 });
  }

  const bytes = await readProjectAssetBytes(asset);
  const contentType = asset.contentType || "application/octet-stream";
  return new NextResponse(new Blob([new Uint8Array(bytes)], { type: contentType }), {
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(bytes.byteLength),
      "Content-Disposition": `attachment; filename="${encodeURIComponent(asset.originalName)}"`,
      "X-Asset-Path": asset.path,
      "X-Asset-Sha256": asset.sha256,
    },
  });
}
