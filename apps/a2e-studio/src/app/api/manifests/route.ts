import { NextResponse } from "next/server";
import { buildManifest, createManifestId, getPrepData, listManifests, writeManifestFiles } from "@/lib/a2e-ops";
import type { ManifestDraft } from "@/lib/schema";

export async function GET() {
  try {
    return NextResponse.json(listManifests());
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to list manifests" },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const draft = (await request.json()) as ManifestDraft;
    if (!draft.batchLabel?.trim()) {
      return NextResponse.json({ error: "Batch label is required" }, { status: 400 });
    }
    if (!draft.selectedCommitShas?.length) {
      return NextResponse.json({ error: "Select at least one commit" }, { status: 400 });
    }
    if (!draft.selectedScenarioIds?.length) {
      return NextResponse.json({ error: "Select at least one scenario" }, { status: 400 });
    }

    const prep = getPrepData();
    const manifest = buildManifest(draft, prep, createManifestId(draft.batchLabel));
    const files = await writeManifestFiles(manifest);

    return NextResponse.json({
      success: true,
      manifestId: manifest.manifestId,
      manifestPath: files.manifestPath,
      promptPath: files.promptPath,
      promptText: files.promptText,
      summary: [
        `Batch: ${manifest.batchLabel}`,
        `Commit scope: ${manifest.commitScope.selectedCommits.length} commits across ${manifest.commitScope.selectedBlocks.length} block${manifest.commitScope.selectedBlocks.length === 1 ? "" : "s"}`,
        `Scenarios: ${manifest.scenarios.selected.length}`,
        `Review targets: ${manifest.reviewTargets.selected.join(", ") || "none"}`,
      ],
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Manifest generation failed" },
      { status: 500 },
    );
  }
}
