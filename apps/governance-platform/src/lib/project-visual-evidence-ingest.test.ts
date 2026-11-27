import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

vi.mock("@/lib/project-interaction", () => ({
  getProjectVisualEvidenceReadbackForProgressJson: vi.fn(),
  visualEvidenceReviewIdForSourceEvidenceRef: vi.fn(() => "visual:review-1"),
}));

vi.mock("@/lib/project-assets", () => ({
  listProjectAssets: vi.fn(),
  upsertProjectAsset: vi.fn(),
  visualEvidenceAssetPathPrefixForReviewId: vi.fn((reviewId: string) => `assets/system/visual-evidence/${reviewId}/`),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    project: {
      update: vi.fn(),
    },
  },
}));

vi.mock("@/lib/progress-bus", () => ({
  notifyProjectChanged: vi.fn(),
}));

import {
  getProjectVisualEvidenceReadbackForProgressJson,
  visualEvidenceReviewIdForSourceEvidenceRef,
} from "@/lib/project-interaction";
import { listProjectAssets, upsertProjectAsset } from "@/lib/project-assets";
import { prisma } from "@/lib/prisma";
import { notifyProjectChanged } from "@/lib/progress-bus";
import {
  ProjectVisualEvidenceIngestError,
  ingestProjectVisualEvidence,
} from "./project-visual-evidence-ingest";

const SOURCE_REF = "visual-workbench-capture:stook-shell.task-001:desktop:21dfd80dbcec";
const ARTIFACT_BYTES = Buffer.from("visual-workbench-capture-png");
const ARTIFACT_SHA256 = createHash("sha256").update(ARTIFACT_BYTES).digest("hex");

describe("ingestProjectVisualEvidence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(visualEvidenceReviewIdForSourceEvidenceRef).mockReturnValue("visual:review-1");
    vi.mocked(getProjectVisualEvidenceReadbackForProgressJson).mockImplementation(async ({ progressJson }) => ({
      currentProgressJson: null,
      tasks: [{
        id: "TASK-REQ-STOOK-VISUAL-CATALOG",
        source: {
          diffItemIds: ["DIFF-STOOK-VISUAL-CATALOG"],
          feedbackId: null,
        },
      }],
      reviews: [{
        id: "visual:review-1",
        taskId: "TASK-REQ-STOOK-VISUAL-CATALOG",
        sourceEvidenceRef: SOURCE_REF,
        sourceKind: "visual_workbench",
        feedbackItemIds: ["DIFF-STOOK-VISUAL-CATALOG"],
        diffItemIds: ["DIFF-STOOK-VISUAL-CATALOG"],
        artifactSha256: `sha256:${ARTIFACT_SHA256}`,
      } as any],
      progressJson,
    } as any));
    vi.mocked(listProjectAssets).mockResolvedValue([]);
    vi.mocked(upsertProjectAsset).mockResolvedValue({
      id: "asset-1",
      projectId: "project-1",
      path: "assets/system/visual-evidence/visual:review-1/capture.png",
      originalName: "capture.png",
      contentType: "image/png",
      sizeBytes: ARTIFACT_BYTES.byteLength,
      sha256: ARTIFACT_SHA256,
      storageKey: "asset-1/capture.png",
      uploadedById: "operator-1",
      deletedAt: null,
      createdAt: new Date("2026-06-12T08:00:00.000Z"),
      updatedAt: new Date("2026-06-12T08:00:00.000Z"),
    } as any);
    vi.mocked(prisma.project.update).mockResolvedValue({ id: "project-1" } as any);
  });

  it("imports explicit progressJson and matching visual evidence asset", async () => {
    const progressJson = progressFixture(ARTIFACT_SHA256);

    const result = await ingestProjectVisualEvidence({
      projectId: "project-1",
      taskId: "task-001",
      sourceEvidenceRef: SOURCE_REF,
      progressJson,
      artifactFilename: "capture.png",
      artifactContentType: "image/png",
      artifactContentBase64: ARTIFACT_BYTES.toString("base64"),
      uploadedById: "operator-1",
    });

    expect(getProjectVisualEvidenceReadbackForProgressJson).toHaveBeenCalledWith({
      projectId: "project-1",
      progressJson: expect.stringContaining("\"visualEvidence\""),
    });
    expect(upsertProjectAsset).toHaveBeenCalledWith({
      projectId: "project-1",
      originalName: "capture.png",
      contentType: "image/png",
      buffer: ARTIFACT_BYTES,
      assetPath: "assets/system/visual-evidence/visual:review-1/capture.png",
      uploadedById: "operator-1",
    });
    const projectUpdate = vi.mocked(prisma.project.update).mock.calls[0]?.[0] as any;
    expect(projectUpdate.where).toEqual({ id: "project-1" });
    expect(JSON.parse(projectUpdate.data.progressJson)).toEqual({
      schemaVersion: "ra-356.visual-evidence-ingest-progress.v1",
      state: "idle",
      message: "Visual evidence readback refreshed",
      steps: [{
        id: "task-001",
        feedbackItemRefs: [{ diffItemId: "DIFF-STOOK-VISUAL-CATALOG" }],
        visualEvidence: [{
          sourceEvidenceRef: SOURCE_REF,
          sourceKind: "visual_workbench",
          feedbackItemIds: ["DIFF-STOOK-VISUAL-CATALOG"],
          diffItemIds: ["DIFF-STOOK-VISUAL-CATALOG"],
          artifactSha256: `sha256:${ARTIFACT_SHA256}`,
          target: {
            route: "/__visual/stook-shell.task-001",
            viewport: { width: 1280, height: 720 },
            claim: "The STOOK shell is visible.",
            state: null,
            interaction: null,
          },
          summary: "Workbench capture for the STOOK shell.",
        }],
      }],
    });
    expect(notifyProjectChanged).toHaveBeenCalledWith("project-1");
    expect(result).toMatchObject({
      schemaVersion: "ra-356.project-visual-evidence-ingest.v1",
      status: "ingested",
      reviewId: "visual:review-1",
      asset: {
        assetId: "asset-1",
        path: "assets/system/visual-evidence/visual:review-1/capture.png",
        sha256: ARTIFACT_SHA256,
      },
    });
    expect(JSON.stringify(result)).not.toContain("artifactContentBase64");
  });

  it("rejects progress that does not resolve to an accepted visual evidence review", async () => {
    vi.mocked(getProjectVisualEvidenceReadbackForProgressJson).mockResolvedValue({
      currentProgressJson: null,
      tasks: [],
      reviews: [],
    } as any);

    await expect(ingestProjectVisualEvidence(validInput())).rejects.toMatchObject({
      code: "visual_evidence_review_missing",
    });

    expect(upsertProjectAsset).not.toHaveBeenCalled();
    expect(prisma.project.update).not.toHaveBeenCalled();
  });

  it("rejects artifact digest mismatches before any governance writes", async () => {
    await expect(ingestProjectVisualEvidence({
      ...validInput(),
      progressJson: progressFixture("b".repeat(64)),
    })).rejects.toMatchObject({
      code: "artifact_digest_mismatch",
    });

    expect(getProjectVisualEvidenceReadbackForProgressJson).not.toHaveBeenCalled();
    expect(upsertProjectAsset).not.toHaveBeenCalled();
    expect(prisma.project.update).not.toHaveBeenCalled();
  });

  it("rejects raw artifactPath fields in progressJson", async () => {
    await expect(ingestProjectVisualEvidence({
      ...validInput(),
      progressJson: progressFixture(ARTIFACT_SHA256, { artifactPath: "/tmp/.ralph/raw.png" }),
    })).rejects.toMatchObject({
      code: "forbidden_progress_field",
    });

    expect(getProjectVisualEvidenceReadbackForProgressJson).not.toHaveBeenCalled();
    expect(upsertProjectAsset).not.toHaveBeenCalled();
    expect(prisma.project.update).not.toHaveBeenCalled();
  });

  it("rejects legacy proof fields in submitted progressJson", async () => {
    await expect(ingestProjectVisualEvidence({
      ...validInput(),
      progressJson: progressFixture(ARTIFACT_SHA256, {}, { proofReviews: [] }),
    })).rejects.toMatchObject({
      code: "forbidden_progress_field",
    });

    expect(getProjectVisualEvidenceReadbackForProgressJson).not.toHaveBeenCalled();
    expect(upsertProjectAsset).not.toHaveBeenCalled();
    expect(prisma.project.update).not.toHaveBeenCalled();
  });

  it("rejects non-image artifacts before any governance writes", async () => {
    await expect(ingestProjectVisualEvidence({
      ...validInput(),
      artifactContentType: "application/json",
    })).rejects.toMatchObject({
      code: "artifact_content_type_invalid",
    });

    expect(getProjectVisualEvidenceReadbackForProgressJson).not.toHaveBeenCalled();
    expect(upsertProjectAsset).not.toHaveBeenCalled();
    expect(prisma.project.update).not.toHaveBeenCalled();
  });

  it("returns a typed 404 when the project does not exist", async () => {
    vi.mocked(getProjectVisualEvidenceReadbackForProgressJson).mockResolvedValue(null);

    try {
      await ingestProjectVisualEvidence(validInput());
      throw new Error("expected ingest to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(ProjectVisualEvidenceIngestError);
      expect(error).toMatchObject({
        code: "project_not_found",
        status: 404,
      });
    }
  });

  it("merges only the selected visual evidence row into existing progressJson", async () => {
    const existingProgress = JSON.stringify({
      state: "working",
      message: "Keep this existing progress",
      steps: [{
        id: "existing-task",
        status: "completed",
      }, {
        id: "task-001",
        status: "completed",
        visualEvidence: [{
          sourceEvidenceRef: "visual-workbench-capture:other",
          sourceKind: "visual_workbench",
          artifactSha256: `sha256:${"c".repeat(64)}`,
        }],
      }],
    });
    vi.mocked(getProjectVisualEvidenceReadbackForProgressJson).mockImplementation(async ({ progressJson }) => ({
      currentProgressJson: existingProgress,
      tasks: [{
        id: "TASK-REQ-STOOK-VISUAL-CATALOG",
        source: {
          diffItemIds: ["DIFF-STOOK-VISUAL-CATALOG"],
          feedbackId: null,
        },
      }],
      reviews: [{
        id: "visual:review-1",
        taskId: "TASK-REQ-STOOK-VISUAL-CATALOG",
        sourceEvidenceRef: SOURCE_REF,
        sourceKind: "visual_workbench",
        feedbackItemIds: ["DIFF-STOOK-VISUAL-CATALOG"],
        diffItemIds: ["DIFF-STOOK-VISUAL-CATALOG"],
        artifactSha256: `sha256:${ARTIFACT_SHA256}`,
      } as any],
    } as any));

    await ingestProjectVisualEvidence(validInput());

    const projectUpdate = vi.mocked(prisma.project.update).mock.calls[0]?.[0] as any;
    const saved = JSON.parse(projectUpdate.data.progressJson);
    expect(saved.state).toBe("working");
    expect(saved.message).toBe("Keep this existing progress");
    expect(saved.steps).toHaveLength(2);
    expect(saved.steps[0]).toEqual({ id: "existing-task", status: "completed" });
    expect(saved.steps[1].visualEvidence.map((row: any) => row.sourceEvidenceRef)).toEqual([
      "visual-workbench-capture:other",
      SOURCE_REF,
    ]);
  });

  it("is idempotent when the same visual evidence asset already exists", async () => {
    vi.mocked(listProjectAssets).mockResolvedValue([{
      id: "asset-existing",
      projectId: "project-1",
      path: "assets/system/visual-evidence/visual:review-1/capture.png",
      originalName: "capture.png",
      contentType: "image/png",
      sizeBytes: ARTIFACT_BYTES.byteLength,
      sha256: ARTIFACT_SHA256,
      storageKey: "asset-existing/capture.png",
      uploadedById: "operator-1",
      deletedAt: null,
      createdAt: new Date("2026-06-12T08:00:00.000Z"),
      updatedAt: new Date("2026-06-12T08:00:00.000Z"),
    } as any]);

    const result = await ingestProjectVisualEvidence(validInput());

    expect(upsertProjectAsset).not.toHaveBeenCalled();
    expect(result.asset.assetId).toBe("asset-existing");
  });

  it("rejects existing visual evidence asset path with different bytes", async () => {
    vi.mocked(listProjectAssets).mockResolvedValue([{
      id: "asset-existing",
      projectId: "project-1",
      path: "assets/system/visual-evidence/visual:review-1/capture.png",
      originalName: "capture.png",
      contentType: "image/png",
      sizeBytes: ARTIFACT_BYTES.byteLength,
      sha256: "b".repeat(64),
      storageKey: "asset-existing/capture.png",
      uploadedById: "operator-1",
      deletedAt: null,
      createdAt: new Date("2026-06-12T08:00:00.000Z"),
      updatedAt: new Date("2026-06-12T08:00:00.000Z"),
    } as any]);

    await expect(ingestProjectVisualEvidence(validInput())).rejects.toMatchObject({
      code: "visual_evidence_asset_conflict",
      status: 409,
    });

    expect(upsertProjectAsset).not.toHaveBeenCalled();
    expect(prisma.project.update).not.toHaveBeenCalled();
  });

  it("rejects broad visual evidence rows with multiple diff ids", async () => {
    await expect(ingestProjectVisualEvidence({
      ...validInput(),
      progressJson: progressFixture(ARTIFACT_SHA256, {
        diffItemIds: ["DIFF-STOOK-VISUAL-CATALOG", "DIFF-OTHER"],
      }),
    })).rejects.toMatchObject({
      code: "diff_items_not_single",
    });

    expect(upsertProjectAsset).not.toHaveBeenCalled();
    expect(prisma.project.update).not.toHaveBeenCalled();
  });
});

function validInput() {
  return {
    projectId: "project-1",
    taskId: "task-001",
    sourceEvidenceRef: SOURCE_REF,
    progressJson: progressFixture(ARTIFACT_SHA256),
    artifactFilename: "capture.png",
    artifactContentType: "image/png",
    artifactContentBase64: ARTIFACT_BYTES.toString("base64"),
    uploadedById: "operator-1",
  };
}

function progressFixture(
  artifactSha256: string,
  evidenceOverrides: Record<string, unknown> = {},
  progressOverrides: Record<string, unknown> = {},
): string {
  return JSON.stringify({
    schemaVersion: "ra-356.project-progress.v1",
    state: "idle",
    steps: [{
      id: "task-001",
      displayTitle: "Build STOOK shell",
      feedbackItemRefs: [{
        diffItemId: "DIFF-STOOK-VISUAL-CATALOG",
      }],
      visualEvidence: [{
        sourceEvidenceRef: SOURCE_REF,
        sourceKind: "visual_workbench",
        feedbackItemIds: ["DIFF-STOOK-VISUAL-CATALOG"],
        diffItemIds: ["DIFF-STOOK-VISUAL-CATALOG"],
        artifactSha256: `sha256:${artifactSha256}`,
        target: {
          route: "/__visual/stook-shell.task-001",
          viewport: { width: 1280, height: 720 },
          claim: "The STOOK shell is visible.",
        },
        summary: "Workbench capture for the STOOK shell.",
        ...evidenceOverrides,
      }],
    }],
    ...progressOverrides,
  });
}
