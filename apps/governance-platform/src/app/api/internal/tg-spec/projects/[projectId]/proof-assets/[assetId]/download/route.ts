import { NextResponse } from "next/server";
import { isTgSpecInternalAuthorized } from "@/lib/internal-auth";
import { getProjectAssetForDownload, readProjectAssetBytes } from "@/lib/project-assets";

const PROOF_ASSET_PATH_PREFIX = "assets/proof/";
const PROOF_IMAGE_CONTENT_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

type RouteContext = {
  params: Promise<{ projectId: string; assetId: string }>;
};

function normalizedImageContentType(value: string | null | undefined): string | null {
  const normalized = value?.split(";")[0]?.trim().toLowerCase() || null;
  return normalized && PROOF_IMAGE_CONTENT_TYPES.has(normalized) ? normalized : null;
}

function proofAssetNotFound() {
  return NextResponse.json({ error: "Proof asset not found" }, { status: 404 });
}

export async function GET(request: Request, context: RouteContext) {
  if (!isTgSpecInternalAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { projectId, assetId } = await context.params;
  const asset = await getProjectAssetForDownload(projectId, assetId);
  if (!asset || !asset.path.startsWith(PROOF_ASSET_PATH_PREFIX)) {
    return proofAssetNotFound();
  }

  const contentType = normalizedImageContentType(asset.contentType);
  if (!contentType) {
    return proofAssetNotFound();
  }

  const bytes = await readProjectAssetBytes(asset);
  return new NextResponse(new Blob([new Uint8Array(bytes)], { type: contentType }), {
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": contentType,
      "Content-Length": String(bytes.byteLength),
      "Content-Disposition": `inline; filename="${encodeURIComponent(asset.originalName)}"`,
      "X-Asset-Path": asset.path,
      "X-Asset-Sha256": asset.sha256,
    },
  });
}
