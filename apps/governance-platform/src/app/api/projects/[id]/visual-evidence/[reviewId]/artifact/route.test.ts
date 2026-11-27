import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/project-interaction", () => ({
  getProjectVisualEvidenceArtifactForDownload: vi.fn(),
}));

vi.mock("@/lib/project-access", () => ({
  requireProjectCapability: vi.fn(),
}));

vi.mock("@/lib/project-access-response", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/project-access-response")>();
  return actual;
});

import { getProjectVisualEvidenceArtifactForDownload } from "@/lib/project-interaction";
import { requireProjectCapability } from "@/lib/project-access";
import { dynamic, GET } from "./route";

function context(projectId = "project-1", reviewId = "visual%3Aabc123") {
  return { params: Promise.resolve({ id: projectId, reviewId }) };
}

describe("GET /api/projects/:id/visual-evidence/:reviewId/artifact", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireProjectCapability).mockResolvedValue({ authorized: true } as any);
  });

  it("is intentionally dynamic because it returns private visual evidence bytes", () => {
    expect(dynamic).toBe("force-dynamic");
  });

  it("requires project.view access", async () => {
    vi.mocked(requireProjectCapability).mockResolvedValue({
      authorized: false,
      error: "Unauthorized",
    } as any);

    const response = await GET(new Request("http://localhost"), context());

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
    expect(requireProjectCapability).toHaveBeenCalledWith("project-1", "project.view");
    expect(getProjectVisualEvidenceArtifactForDownload).not.toHaveBeenCalled();
  });

  it("serves a current visual evidence image inline without raw asset path headers", async () => {
    vi.mocked(getProjectVisualEvidenceArtifactForDownload).mockResolvedValue({
      bytes: Buffer.from("png"),
      contentType: "image/png",
      sha256: `sha256:${"a".repeat(64)}`,
    });

    const response = await GET(new Request("http://localhost"), context());

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("Content-Type")).toBe("image/png");
    expect(response.headers.get("Content-Disposition")).toBe("inline");
    expect(response.headers.get("X-Visual-Evidence-Sha256")).toBe(`sha256:${"a".repeat(64)}`);
    expect(response.headers.get("X-Asset-Path")).toBeNull();
    expect(response.headers.get("X-Asset-Sha256")).toBeNull();
    expect(await response.text()).toBe("png");
    expect(getProjectVisualEvidenceArtifactForDownload).toHaveBeenCalledWith({
      projectId: "project-1",
      reviewId: "visual:abc123",
    });
  });

  it("returns not found when the current progress review has no matching viewable artifact", async () => {
    vi.mocked(getProjectVisualEvidenceArtifactForDownload).mockResolvedValue(null);

    const response = await GET(new Request("http://localhost"), context());

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Visual evidence artifact not found" });
  });

  it("rejects unsafe review ids before resolving artifacts", async () => {
    const response = await GET(new Request("http://localhost"), context("project-1", "..%2Fsecret"));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid visual evidence review id" });
    expect(requireProjectCapability).not.toHaveBeenCalled();
    expect(getProjectVisualEvidenceArtifactForDownload).not.toHaveBeenCalled();
  });
});
