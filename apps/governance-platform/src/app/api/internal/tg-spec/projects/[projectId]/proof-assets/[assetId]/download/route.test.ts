import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

vi.mock("server-only", () => ({}));

vi.mock("@/lib/internal-auth", () => ({
  isTgSpecInternalAuthorized: vi.fn(),
}));

vi.mock("@/lib/project-assets", () => ({
  getProjectAssetForDownload: vi.fn(),
  readProjectAssetBytes: vi.fn(),
}));

import { isTgSpecInternalAuthorized } from "@/lib/internal-auth";
import { getProjectAssetForDownload, readProjectAssetBytes } from "@/lib/project-assets";

function request() {
  return new Request("http://localhost/api/internal/tg-spec/projects/project-1/proof-assets/asset-proof/download");
}

function context(projectId = "project-1", assetId = "asset-proof") {
  return {
    params: Promise.resolve({ projectId, assetId }),
  };
}

describe("GET /api/internal/tg-spec/projects/:projectId/proof-assets/:assetId/download", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isTgSpecInternalAuthorized).mockReturnValue(true);
    vi.mocked(getProjectAssetForDownload).mockResolvedValue({
      id: "asset-proof",
      projectId: "project-1",
      path: "assets/proof/TASK-BUG-006/before.png",
      originalName: "before.png",
      contentType: "image/png",
      sizeBytes: 3,
      sha256: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      storageKey: "asset-proof.png",
      uploadedById: "runner",
      deletedAt: null,
      createdAt: new Date("2026-05-16T12:01:00.000Z"),
      updatedAt: new Date("2026-05-16T12:01:00.000Z"),
    });
    vi.mocked(readProjectAssetBytes).mockResolvedValue(Buffer.from([1, 2, 3]));
  });

  it("rejects unauthorized tg-spec requests", async () => {
    vi.mocked(isTgSpecInternalAuthorized).mockReturnValue(false);

    const res = await GET(request(), context());

    expect(res.status).toBe(401);
    expect(getProjectAssetForDownload).not.toHaveBeenCalled();
  });

  it("streams proof screenshot bytes through the tg-spec internal boundary", async () => {
    const res = await GET(request(), context("project-1", "asset-proof"));

    expect(res.status).toBe(200);
    expect(getProjectAssetForDownload).toHaveBeenCalledWith("project-1", "asset-proof");
    expect(readProjectAssetBytes).toHaveBeenCalled();
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(res.headers.get("Content-Type")).toContain("image/png");
    expect(res.headers.get("X-Asset-Path")).toBe("assets/proof/TASK-BUG-006/before.png");
    expect(Buffer.from(await res.arrayBuffer())).toEqual(Buffer.from([1, 2, 3]));
  });

  it("does not expose non-proof project assets", async () => {
    vi.mocked(getProjectAssetForDownload).mockResolvedValue({
      path: "assets/manual/logo.png",
      contentType: "image/png",
    } as any);

    const res = await GET(request(), context());

    expect(res.status).toBe(404);
    expect(readProjectAssetBytes).not.toHaveBeenCalled();
  });

  it("does not expose non-image proof assets", async () => {
    vi.mocked(getProjectAssetForDownload).mockResolvedValue({
      path: "assets/proof/TASK-BUG-006/report.txt",
      contentType: "text/plain",
    } as any);

    const res = await GET(request(), context());

    expect(res.status).toBe(404);
    expect(readProjectAssetBytes).not.toHaveBeenCalled();
  });
});
