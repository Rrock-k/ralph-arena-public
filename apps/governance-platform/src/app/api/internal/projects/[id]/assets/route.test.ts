import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

vi.mock("@/lib/internal-auth", () => ({
  isRunnerAuthorized: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    project: { findUnique: vi.fn() },
  },
}));

vi.mock("@/lib/progress-bus", () => ({
  notifyProjectChanged: vi.fn(),
}));

vi.mock("@/lib/project-assets", () => ({
  getProjectAssetManifest: vi.fn(),
  upsertProjectAsset: vi.fn(),
}));

import { isRunnerAuthorized } from "@/lib/internal-auth";
import { prisma } from "@/lib/prisma";
import { notifyProjectChanged } from "@/lib/progress-bus";
import { upsertProjectAsset } from "@/lib/project-assets";

function routeContext(projectId = "proj-1") {
  return { params: Promise.resolve({ id: projectId }) };
}

describe("POST /api/internal/projects/:id/assets", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isRunnerAuthorized).mockReturnValue(true);
    vi.mocked(prisma.project.findUnique as any).mockResolvedValue({ id: "proj-1" });
    vi.mocked(upsertProjectAsset as any).mockResolvedValue({
      id: "asset-1",
      path: "assets/proof/task-1/before.png",
      sha256: "abc123",
    });
  });

  it("rejects unauthorized runner uploads", async () => {
    vi.mocked(isRunnerAuthorized).mockReturnValue(false);

    const res = await POST(new Request("http://localhost/api/internal/projects/proj-1/assets?path=assets/proof/task-1/before.png&filename=before.png", {
      method: "POST",
      body: new Uint8Array([1, 2, 3]),
      headers: { "content-type": "image/png" },
    }), routeContext());

    expect(res.status).toBe(401);
    expect(upsertProjectAsset).not.toHaveBeenCalled();
  });

  it("upserts a runner screenshot asset and notifies project refresh", async () => {
    const res = await POST(new Request("http://localhost/api/internal/projects/proj-1/assets?path=assets/proof/task-1/before.png&filename=before.png", {
      method: "POST",
      body: new Uint8Array([1, 2, 3]),
      headers: { "content-type": "image/png" },
    }), routeContext());

    expect(res.status).toBe(200);
    expect(upsertProjectAsset).toHaveBeenCalledWith({
      projectId: "proj-1",
      originalName: "before.png",
      contentType: "image/png",
      buffer: Buffer.from([1, 2, 3]),
      assetPath: "assets/proof/task-1/before.png",
      uploadedById: "runner",
    });
    expect(notifyProjectChanged).toHaveBeenCalledWith("proj-1");
    await expect(res.json()).resolves.toEqual({
      ok: true,
      uploaded: true,
      assetId: "asset-1",
      path: "assets/proof/task-1/before.png",
      sha256: "abc123",
    });
  });
});
