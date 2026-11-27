import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

vi.mock("server-only", () => ({}));

vi.mock("@/lib/internal-auth", () => ({
  isRunnerAuthorized: vi.fn(),
}));

vi.mock("@/lib/project-visual-evidence-ingest", () => ({
  ProjectVisualEvidenceIngestError: class ProjectVisualEvidenceIngestError extends Error {
    constructor(
      readonly code: string,
      message: string,
      readonly status = 400,
    ) {
      super(message);
    }
  },
  ingestProjectVisualEvidence: vi.fn(),
}));

import { isRunnerAuthorized } from "@/lib/internal-auth";
import {
  ingestProjectVisualEvidence,
  ProjectVisualEvidenceIngestError,
} from "@/lib/project-visual-evidence-ingest";

function context(projectId = "project-1") {
  return { params: Promise.resolve({ id: projectId }) };
}

function request(body: Record<string, unknown> = validBody()) {
  return new Request("http://localhost/api/internal/projects/project-1/visual-evidence-ingest", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

function rawRequest(body: string) {
  return new Request("http://localhost/api/internal/projects/project-1/visual-evidence-ingest", {
    method: "POST",
    body,
    headers: { "content-type": "application/json" },
  });
}

function validBody() {
  return {
    taskId: "task-1",
    sourceEvidenceRef: "visual-workbench-capture:synth-pad.playing.desktop:desktop:aaaaaaaaaaaa",
    progressJson: JSON.stringify({
      state: "completed",
      steps: [{
        id: "task-1",
        visualEvidence: [{
          sourceEvidenceRef: "visual-workbench-capture:synth-pad.playing.desktop:desktop:aaaaaaaaaaaa",
          sourceKind: "visual_workbench",
          feedbackItemIds: ["BUG-006"],
          diffItemIds: ["DIFF-003-BUG-006"],
          artifactSha256: `sha256:${"a".repeat(64)}`,
          target: {
            route: "/visual-workbench/synth-pad.playing.desktop",
            viewport: { width: 1280, height: 800 },
            claim: "Synth pad renders the playing state",
          },
          summary: "Visual Workbench story captured.",
        }],
      }],
    }),
    artifactFilename: "capture.png",
    artifactContentType: "image/png",
    artifactContentBase64: Buffer.from("png").toString("base64"),
  };
}

describe("POST /api/internal/projects/:id/visual-evidence-ingest", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isRunnerAuthorized).mockReturnValue(true);
    vi.mocked(ingestProjectVisualEvidence).mockResolvedValue({
      schemaVersion: "ra-356.project-visual-evidence-ingest.v1",
      status: "ingested",
      projectId: "project-1",
      taskId: "task-1",
      sourceEvidenceRef: "visual-workbench-capture:synth-pad.playing.desktop:desktop:aaaaaaaaaaaa",
      reviewId: "visual:abc123",
      progress: {
        imported: true,
        visualEvidenceReviewCount: 1,
      },
      asset: {
        assetId: "asset-1",
        path: "assets/system/visual-evidence/visual-abc123/capture.png",
        sha256: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        contentType: "image/png",
        sizeBytes: 3,
      },
      notes: [],
    });
  });

  it("rejects unauthorized runner requests", async () => {
    vi.mocked(isRunnerAuthorized).mockReturnValue(false);

    const res = await POST(request(), context());

    expect(res.status).toBe(401);
    expect(ingestProjectVisualEvidence).not.toHaveBeenCalled();
  });

  it("delegates one explicit visual evidence ingest body to the governance owner", async () => {
    const res = await POST(request(), context("project-1"));

    expect(res.status).toBe(200);
    expect(isRunnerAuthorized).toHaveBeenCalledWith(expect.any(Request), { projectId: "project-1" });
    expect(ingestProjectVisualEvidence).toHaveBeenCalledWith({
      projectId: "project-1",
      ...validBody(),
      uploadedById: "arena-runner",
    });
    await expect(res.json()).resolves.toMatchObject({
      schemaVersion: "ra-356.project-visual-evidence-ingest.v1",
      status: "ingested",
      projectId: "project-1",
      asset: {
        assetId: "asset-1",
      },
    });
  });

  it("rejects missing explicit fields before ingest", async () => {
    const body = validBody();
    delete (body as Partial<typeof body>).artifactContentBase64;

    const res = await POST(request(body), context());

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: "artifactContentBase64 is required" });
    expect(ingestProjectVisualEvidence).not.toHaveBeenCalled();
  });

  it("rejects malformed JSON before ingest", async () => {
    const res = await POST(rawRequest("{"), context());

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: "JSON body is required" });
    expect(ingestProjectVisualEvidence).not.toHaveBeenCalled();
  });

  it("rejects non-object JSON before ingest", async () => {
    const res = await POST(rawRequest("null"), context());

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: "JSON body object is required" });
    expect(ingestProjectVisualEvidence).not.toHaveBeenCalled();
  });

  it("maps typed ingest errors without hiding the reason code", async () => {
    vi.mocked(ingestProjectVisualEvidence).mockRejectedValueOnce(
      new ProjectVisualEvidenceIngestError(
        "artifact_digest_mismatch",
        "artifactContentBase64 sha256 does not match progressJson visualEvidence artifactSha256",
      ),
    );

    const res = await POST(request(), context());

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({
      error: "artifactContentBase64 sha256 does not match progressJson visualEvidence artifactSha256",
      code: "artifact_digest_mismatch",
    });
  });
});
