import { beforeEach, describe, expect, it, vi } from "vitest";
import { DELETE, GET } from "./route";

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
  listProjectAssets: vi.fn(),
  deleteProjectAsset: vi.fn(),
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
import { deleteProjectAsset, listProjectAssets } from "@/lib/project-assets";
import { prisma } from "@/lib/prisma";

describe("tg-spec asset maintenance route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isEvolutionPushAuthorized).mockReturnValue(true);
    vi.mocked(prisma.project.findUnique).mockResolvedValue({ proposalId: "proposal-1" } as any);
  });

  it("lists active project assets for tg-spec reconciliation", async () => {
    vi.mocked(listProjectAssets).mockResolvedValue([
      {
        id: "asset-1",
        path: "assets/telegram/msg-1/brief.pdf",
      },
      {
        id: "asset-2",
        path: "assets/manual/logo.png",
      },
    ] as any);

    const response = await GET(
      new Request("http://localhost/api/internal/tg-spec/projects/proj-1/assets"),
      { params: Promise.resolve({ projectId: "proj-1" }) },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      assets: [
        { id: "asset-1", path: "assets/telegram/msg-1/brief.pdf" },
        { id: "asset-2", path: "assets/manual/logo.png" },
      ],
    });
  });

  it("deletes an existing asset by deterministic path", async () => {
    vi.mocked(listProjectAssets).mockResolvedValue([
      {
        id: "asset-1",
        path: "assets/telegram/msg-1/brief.pdf",
      },
    ] as any);
    vi.mocked(deleteProjectAsset).mockResolvedValue({ id: "asset-1" } as any);

    const response = await DELETE(
      new Request("http://localhost/api/internal/tg-spec/projects/proj-1/assets?path=assets/telegram/msg-1/brief.pdf", {
        method: "DELETE",
      }),
      { params: Promise.resolve({ projectId: "proj-1" }) },
    );

    expect(response.status).toBe(200);
    expect(deleteProjectAsset).toHaveBeenCalledWith("proj-1", "asset-1");
    await expect(response.json()).resolves.toEqual({
      ok: true,
      deleted: true,
      path: "assets/telegram/msg-1/brief.pdf",
      assetId: "asset-1",
    });
    expect(revalidatePath).toHaveBeenCalledWith("/projects/proj-1");
    expect(revalidatePath).toHaveBeenCalledWith("/my/projects/proj-1");
    expect(revalidatePath).toHaveBeenCalledWith("/proposals/proposal-1");
    expect(notifyProjectChanged).toHaveBeenCalledWith("proj-1");
  });

  it("returns a noop when the path is already absent", async () => {
    vi.mocked(listProjectAssets).mockResolvedValue([] as any);

    const response = await DELETE(
      new Request("http://localhost/api/internal/tg-spec/projects/proj-1/assets?path=assets/telegram/msg-1/brief.pdf", {
        method: "DELETE",
      }),
      { params: Promise.resolve({ projectId: "proj-1" }) },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      deleted: false,
      path: "assets/telegram/msg-1/brief.pdf",
    });
    expect(deleteProjectAsset).not.toHaveBeenCalled();
  });
});
