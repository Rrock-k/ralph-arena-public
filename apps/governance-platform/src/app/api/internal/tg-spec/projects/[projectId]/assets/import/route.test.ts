import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/progress-bus", () => ({
  notifyProjectChanged: vi.fn(),
}));

vi.mock("@/lib/internal-auth", () => ({
  isEvolutionPushAuthorized: vi.fn(),
}));

vi.mock("@/lib/project-assets", () => ({
  upsertProjectAsset: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    project: {
      findUnique: vi.fn(),
    },
  },
}));

import { revalidatePath } from "next/cache";
import { notifyProjectChanged } from "@/lib/progress-bus";
import { isEvolutionPushAuthorized } from "@/lib/internal-auth";
import { upsertProjectAsset } from "@/lib/project-assets";
import { prisma } from "@/lib/prisma";

describe("POST /api/internal/tg-spec/projects/[projectId]/assets/import", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isEvolutionPushAuthorized).mockReturnValue(true);
    vi.mocked(prisma.project.findUnique).mockResolvedValue({ proposalId: "proposal-1" } as any);
  });

  it("rejects unauthorized requests", async () => {
    vi.mocked(isEvolutionPushAuthorized).mockReturnValue(false);

    const response = await POST(
      new Request("http://localhost/api/internal/tg-spec/projects/proj-1/assets/import?path=assets/telegram/msg-1/brief.pdf&filename=brief.pdf", {
        method: "POST",
        body: Buffer.from("pdf"),
      }),
      { params: Promise.resolve({ projectId: "proj-1" }) },
    );

    expect(response.status).toBe(401);
  });

  it("upserts a project asset through the internal tg-spec lane", async () => {
    vi.mocked(upsertProjectAsset).mockResolvedValue({
      id: "asset-1",
      projectId: "proj-1",
      path: "assets/telegram/msg-1/brief.pdf",
      originalName: "brief.pdf",
      contentType: "application/pdf",
      sizeBytes: 3,
      sha256: "hash",
      storageKey: "asset-1/brief.pdf",
      uploadedById: "tg-spec",
      deletedAt: null,
      createdAt: new Date("2026-04-23T10:00:00.000Z"),
      updatedAt: new Date("2026-04-23T10:00:00.000Z"),
    });

    const response = await POST(
      new Request("http://localhost/api/internal/tg-spec/projects/proj-1/assets/import?path=assets/telegram/msg-1/brief.pdf&filename=brief.pdf", {
        method: "POST",
        headers: {
          "content-type": "application/pdf",
        },
        body: Buffer.from("pdf"),
      }),
      { params: Promise.resolve({ projectId: "proj-1" }) },
    );

    expect(response.status).toBe(200);
    expect(upsertProjectAsset).toHaveBeenCalledWith({
      projectId: "proj-1",
      originalName: "brief.pdf",
      contentType: "application/pdf",
      buffer: Buffer.from("pdf"),
      assetPath: "assets/telegram/msg-1/brief.pdf",
      uploadedById: "tg-spec",
      allowAnyExtension: true,
    });
    await expect(response.json()).resolves.toEqual({
      ok: true,
      imported: true,
      assetId: "asset-1",
      path: "assets/telegram/msg-1/brief.pdf",
    });
    expect(revalidatePath).toHaveBeenCalledWith("/projects/proj-1");
    expect(revalidatePath).toHaveBeenCalledWith("/my/projects/proj-1");
    expect(revalidatePath).toHaveBeenCalledWith("/proposals/proposal-1");
    expect(notifyProjectChanged).toHaveBeenCalledWith("proj-1");
  });

  it("returns 404 when the project does not exist", async () => {
    vi.mocked(upsertProjectAsset).mockRejectedValue(new Error("Project not found"));

    const response = await POST(
      new Request("http://localhost/api/internal/tg-spec/projects/proj-404/assets/import?path=assets/telegram/msg-1/brief.pdf&filename=brief.pdf", {
        method: "POST",
        headers: {
          "content-type": "application/pdf",
        },
        body: Buffer.from("pdf"),
      }),
      { params: Promise.resolve({ projectId: "proj-404" }) },
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: "Project not found",
    });
  });

  it("rejects requests without required asset metadata", async () => {
    const response = await POST(
      new Request("http://localhost/api/internal/tg-spec/projects/proj-1/assets/import?filename=brief.pdf", {
        method: "POST",
        body: Buffer.from("pdf"),
      }),
      { params: Promise.resolve({ projectId: "proj-1" }) },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "path is required",
    });
    expect(upsertProjectAsset).not.toHaveBeenCalled();
  });
});
