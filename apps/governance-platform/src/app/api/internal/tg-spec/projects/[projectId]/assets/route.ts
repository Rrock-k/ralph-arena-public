import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { notifyProjectChanged } from "@/lib/progress-bus";
import { isEvolutionPushAuthorized } from "@/lib/internal-auth";
import { prisma } from "@/lib/prisma";
import { getProjectProposalPath } from "@/lib/project-identity";
import { deleteProjectAsset, listProjectAssets } from "@/lib/project-assets";

type RouteParams = { params: Promise<{ projectId: string }> };

function readRequiredSearchParam(url: URL, name: string): string {
  const value = url.searchParams.get(name)?.trim();
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

async function revalidateProjectAssetPaths(projectId: string) {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { proposalId: true },
  });

  revalidatePath(`/projects/${projectId}`);
  revalidatePath(`/my/projects/${projectId}`);
  revalidatePath("/my");
  revalidatePath("/admin");
  const proposalPath = getProjectProposalPath({ proposalId: project?.proposalId ?? null });
  if (proposalPath) revalidatePath(proposalPath);
  notifyProjectChanged(projectId);
}

export async function GET(request: Request, { params }: RouteParams) {
  if (!isEvolutionPushAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { projectId } = await params;
  const assets = await listProjectAssets(projectId);
  return NextResponse.json({
    ok: true,
    assets: assets.map((asset) => ({
      id: asset.id,
      path: asset.path,
    })),
  });
}

export async function DELETE(request: Request, { params }: RouteParams) {
  try {
    if (!isEvolutionPushAuthorized(request)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { projectId } = await params;
    const url = new URL(request.url);
    const assetPath = readRequiredSearchParam(url, "path");
    const existing = (await listProjectAssets(projectId)).find((asset) => asset.path === assetPath) || null;
    if (!existing) {
      return NextResponse.json({ ok: true, deleted: false, path: assetPath });
    }

    await deleteProjectAsset(projectId, existing.id);
    await revalidateProjectAssetPaths(projectId);

    return NextResponse.json({
      ok: true,
      deleted: true,
      path: assetPath,
      assetId: existing.id,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to delete project asset";
    const status = message === "Project not found" ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
