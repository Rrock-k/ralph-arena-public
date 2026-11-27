import { NextResponse } from "next/server";
import { readManifestJson, readManifestPrompt } from "@/lib/a2e-ops";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const manifest = readManifestJson(id);
  if (!manifest) {
    return NextResponse.json({ error: "Manifest not found" }, { status: 404 });
  }
  const promptText = readManifestPrompt(id) ?? "";
  return NextResponse.json({ manifest, promptText });
}
