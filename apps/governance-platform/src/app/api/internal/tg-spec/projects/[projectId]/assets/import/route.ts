import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { notifyProjectChanged } from "@/lib/progress-bus";
import { isEvolutionPushAuthorized } from "@/lib/internal-auth";
import { prisma } from "@/lib/prisma";
import { getProjectProposalPath } from "@/lib/project-identity";
import { upsertProjectAsset } from "@/lib/project-assets";

type RouteParams = { params: Promise<{ projectId: string }> };

function readRequiredSearchParam(url: URL, name: string): string {
  const value = url.searchParams.get(name)?.trim();
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

export async function POST(request: Request, { params }: RouteParams) {
  try {
    if (!isEvolutionPushAuthorized(request)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { projectId } = await params;
    const url = new URL(request.url);
    const assetPath = readRequiredSearchParam(url, "path");
    const originalName = readRequiredSearchParam(url, "filename");
    const contentType = request.headers.get("content-type")?.trim() || null;
    const buffer = Buffer.from(await request.arrayBuffer());

    const asset = await upsertProjectAsset({
      projectId,
      originalName,
      contentType,
      buffer,
      assetPath,
      uploadedById: "tg-spec",
      allowAnyExtension: true,
    });

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

    return NextResponse.json({
      ok: true,
      imported: true,
      assetId: asset.id,
      path: asset.path,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to import project asset";
    const status = message === "Project not found" ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
