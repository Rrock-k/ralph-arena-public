import { NextResponse } from "next/server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { notifyProjectChanged } from "@/lib/progress-bus";
import { isEvolutionPushAuthorized } from "@/lib/internal-auth";
import { getProjectProposalPath } from "@/lib/project-identity";
import {
  TgSpecAcceptedArtifactImportRequestSchema,
  importTgSpecAcceptedArtifact,
} from "@/lib/tg-spec-import";

type RouteParams = { params: Promise<{ projectId: string }> };

export async function POST(request: Request, { params }: RouteParams) {
  try {
    if (!isEvolutionPushAuthorized(request)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { projectId } = await params;
    const body = TgSpecAcceptedArtifactImportRequestSchema.parse(await request.json());
    const result = await importTgSpecAcceptedArtifact(projectId, body);

    if (result.kind === "not_found") {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    if (result.kind === "source_mismatch") {
      return NextResponse.json({
        error: "Project already bound to a different tg-spec source",
        sourceProjectId: result.sourceProjectId,
      }, { status: 409 });
    }

    if (result.kind === "duplicate") {
      return NextResponse.json({ ok: true, imported: false, duplicate: true });
    }

    if (result.kind === "target_required") {
      return NextResponse.json({
        error: "Project is not configured as a tg-spec target",
      }, { status: 409 });
    }

    revalidatePath(`/projects/${result.projectId}`);
    revalidatePath(`/my/projects/${result.projectId}`);
    const proposalPath = getProjectProposalPath({ proposalId: result.proposalId });
    if (proposalPath) revalidatePath(proposalPath);
    revalidatePath("/my");
    revalidatePath("/admin");
    notifyProjectChanged(result.projectId);

    return NextResponse.json({
      ok: true,
      imported: result.kind === "imported",
      ...(result.kind === "updated" ? { updated: true } : {}),
      duplicate: false,
      mirrorSpecId: result.mirrorSpecId,
      sourceVersion: result.sourceVersion,
      specVersionId: result.specVersionId,
      specVersion: result.specVersion,
      metadataHash: result.metadataHash,
      metadataStatus: result.metadataStatus,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid request", details: error.flatten() }, { status: 400 });
    }
    if (error instanceof Error && /acceptedArtifact|packageSchemaVersion|sourceUrl/.test(error.message)) {
      return NextResponse.json({ error: "Invalid tg-spec metadata", details: error.message }, { status: 400 });
    }

    console.error("[tg-spec-import] Import failed:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
