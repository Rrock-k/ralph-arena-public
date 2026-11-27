import { NextResponse } from "next/server";
import { isRunnerAuthorized } from "@/lib/internal-auth";
import {
  ingestProjectVisualEvidence,
  ProjectVisualEvidenceIngestError,
} from "@/lib/project-visual-evidence-ingest";

interface RouteContext {
  params: Promise<{ id: string }>;
}

type RequiredStringResult =
  | { ok: true; value: string }
  | { ok: false; error: string };

function readRequiredString(value: unknown, name: string): RequiredStringResult {
  if (typeof value !== "string" || value.trim().length === 0) {
    return { ok: false, error: `${name} is required` };
  }
  return { ok: true, value };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

export async function POST(request: Request, context: RouteContext) {
  const { id } = await context.params;
  if (!isRunnerAuthorized(request, { projectId: id })) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON body is required" }, { status: 400 });
  }
  if (!isRecord(body)) {
    return NextResponse.json({ error: "JSON body object is required" }, { status: 400 });
  }

  const taskId = readRequiredString(body.taskId, "taskId");
  if (!taskId.ok) return NextResponse.json({ error: taskId.error }, { status: 400 });
  const sourceEvidenceRef = readRequiredString(body.sourceEvidenceRef, "sourceEvidenceRef");
  if (!sourceEvidenceRef.ok) return NextResponse.json({ error: sourceEvidenceRef.error }, { status: 400 });
  const progressJson = readRequiredString(body.progressJson, "progressJson");
  if (!progressJson.ok) return NextResponse.json({ error: progressJson.error }, { status: 400 });
  const artifactFilename = readRequiredString(body.artifactFilename, "artifactFilename");
  if (!artifactFilename.ok) return NextResponse.json({ error: artifactFilename.error }, { status: 400 });
  const artifactContentType = readRequiredString(body.artifactContentType, "artifactContentType");
  if (!artifactContentType.ok) return NextResponse.json({ error: artifactContentType.error }, { status: 400 });
  const artifactContentBase64 = readRequiredString(body.artifactContentBase64, "artifactContentBase64");
  if (!artifactContentBase64.ok) return NextResponse.json({ error: artifactContentBase64.error }, { status: 400 });

  try {
    return NextResponse.json(await ingestProjectVisualEvidence({
      projectId: id,
      taskId: taskId.value,
      sourceEvidenceRef: sourceEvidenceRef.value,
      progressJson: progressJson.value,
      artifactFilename: artifactFilename.value,
      artifactContentType: artifactContentType.value,
      artifactContentBase64: artifactContentBase64.value,
      uploadedById: "arena-runner",
    }));
  } catch (error) {
    if (error instanceof ProjectVisualEvidenceIngestError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    throw error;
  }
}
