import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    project: {
      findUnique: vi.fn(),
    },
    projectAsset: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock("@/lib/asset-storage", () => ({
  saveAssetBytes: vi.fn(),
  readAssetBytes: vi.fn(),
  deleteAssetBytes: vi.fn(),
}));

import { prisma } from "@/lib/prisma";
import { saveAssetBytes } from "@/lib/asset-storage";
import {
  getProjectAssetManifest,
  normalizeAssetPath,
  resolveVisualEvidenceArtifactAsset,
  upsertProjectAsset,
  visualEvidenceAssetPathPrefixForReviewId,
} from "./project-assets";

describe("project-assets", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.project.findUnique).mockResolvedValue({ id: "proj-1" } as any);
  });

  it("keeps the browser path strict by default", () => {
    expect(() => normalizeAssetPath("assets/telegram/msg-1/brief.pdf", "brief.pdf")).toThrow(
      "Unsupported asset file extension: .pdf",
    );
  });

  it("allows arbitrary extensions only when explicitly requested", () => {
    expect(
      normalizeAssetPath("assets/telegram/msg-1/brief.pdf", "brief.pdf", { allowAnyExtension: true }),
    ).toBe("assets/telegram/msg-1/brief.pdf");
  });

  it("keeps proof and visual evidence system assets out of the runner workspace asset manifest", async () => {
    const visualDigest = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    vi.mocked((prisma as any).projectAsset.findMany).mockResolvedValue([
      {
        id: "asset-input",
        projectId: "proj-1",
        path: "assets/input/reference.png",
        originalName: "reference.png",
        contentType: "image/png",
        sizeBytes: 3,
        sha256: "input-sha",
        storageKey: "asset-input/reference.png",
        uploadedById: "tg-spec",
        deletedAt: null,
        createdAt: new Date("2026-04-23T10:00:00.000Z"),
        updatedAt: new Date("2026-04-23T10:00:00.000Z"),
      },
      {
        id: "asset-proof",
        projectId: "proj-1",
        path: "assets/proof/task-1/before.png",
        originalName: "before.png",
        contentType: "image/png",
        sizeBytes: 3,
        sha256: "proof-sha",
        storageKey: "asset-proof/before.png",
        uploadedById: "runner",
        deletedAt: null,
        createdAt: new Date("2026-04-23T10:00:00.000Z"),
        updatedAt: new Date("2026-04-23T10:00:00.000Z"),
      },
      {
        id: "asset-visual",
        projectId: "proj-1",
        path: `${visualEvidenceAssetPathPrefixForReviewId("visual:abc123")}capture.png`,
        originalName: "capture.png",
        contentType: "image/png",
        sizeBytes: 3,
        sha256: visualDigest,
        storageKey: "asset-visual/capture.png",
        uploadedById: "system",
        deletedAt: null,
        createdAt: new Date("2026-04-23T10:00:00.000Z"),
        updatedAt: new Date("2026-04-23T10:00:00.000Z"),
      },
    ]);

    const manifest = await getProjectAssetManifest("proj-1");

    expect(manifest.assets).toEqual([{
      id: "asset-input",
      path: "assets/input/reference.png",
      sha256: "input-sha",
      sizeBytes: 3,
      contentType: "image/png",
    }]);
    expect(manifest.hash).not.toContain("proof-sha");
    expect(manifest.hash).not.toContain(visualDigest);
  });

  it("resolves visual evidence artifacts only by review namespace and digest", () => {
    const digest = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const reviewId = "visual:abc123";
    const artifact = {
      id: "asset-visual",
      path: `${visualEvidenceAssetPathPrefixForReviewId(reviewId)}capture.png`,
      contentType: "image/png",
      sha256: digest,
    };

    expect(resolveVisualEvidenceArtifactAsset({
      reviewId,
      expectedSha256: `sha256:${digest}`,
      assets: [artifact],
    })).toEqual({
      availability: "available",
      asset: artifact,
      unavailableReason: null,
    });

    expect(resolveVisualEvidenceArtifactAsset({
      reviewId,
      expectedSha256: `sha256:${"b".repeat(64)}`,
      assets: [artifact],
    })).toEqual({
      availability: "unavailable",
      asset: null,
      unavailableReason: "digest_mismatch",
    });

    expect(resolveVisualEvidenceArtifactAsset({
      reviewId,
      expectedSha256: `sha256:${digest}`,
      assets: [{
        ...artifact,
        path: "assets/input/reference.png",
      }],
    })).toEqual({
      availability: "unavailable",
      asset: null,
      unavailableReason: "missing_artifact",
    });
  });

  it("upserts an existing asset by deterministic path for the tg-spec lane", async () => {
    vi.mocked((prisma as any).projectAsset.findFirst).mockResolvedValue({
      id: "asset-1",
      projectId: "proj-1",
      path: "assets/telegram/msg-1/brief.pdf",
      originalName: "brief.pdf",
      contentType: "application/pdf",
      sizeBytes: 5,
      sha256: "old-hash",
      storageKey: "asset-1/brief.pdf",
      uploadedById: "tg-spec",
      deletedAt: null,
      createdAt: new Date("2026-04-23T10:00:00.000Z"),
      updatedAt: new Date("2026-04-23T10:00:00.000Z"),
    });
    vi.mocked(saveAssetBytes).mockResolvedValue("asset-1/brief.pdf");
    vi.mocked((prisma as any).projectAsset.update).mockResolvedValue({
      id: "asset-1",
      projectId: "proj-1",
      path: "assets/telegram/msg-1/brief.pdf",
      originalName: "brief.pdf",
      contentType: "application/pdf",
      sizeBytes: 3,
      sha256: "new-hash",
      storageKey: "asset-1/brief.pdf",
      uploadedById: "tg-spec",
      deletedAt: null,
      createdAt: new Date("2026-04-23T10:00:00.000Z"),
      updatedAt: new Date("2026-04-23T10:05:00.000Z"),
    } as any);

    const result = await upsertProjectAsset({
      projectId: "proj-1",
      originalName: "brief.pdf",
      contentType: "application/pdf",
      buffer: Buffer.from("pdf"),
      assetPath: "assets/telegram/msg-1/brief.pdf",
      uploadedById: "tg-spec",
      allowAnyExtension: true,
    });

    expect(saveAssetBytes).toHaveBeenCalledWith("asset-1", "brief.pdf", Buffer.from("pdf"));
    expect((prisma as any).projectAsset.update).toHaveBeenCalledWith({
      where: { id: "asset-1" },
      data: expect.objectContaining({
        originalName: "brief.pdf",
        contentType: "application/pdf",
        sizeBytes: 3,
        storageKey: "asset-1/brief.pdf",
        uploadedById: "tg-spec",
      }),
    });
    expect(result.path).toBe("assets/telegram/msg-1/brief.pdf");
  });
});
