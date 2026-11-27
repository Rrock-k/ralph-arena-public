import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/app/actions/container-ops", () => ({
  inspectContainerInternal: vi.fn(),
}));

vi.mock("@/lib/internal-action-token", () => ({
  INTERNAL_ACTION_TOKEN: Symbol("internal-action-token"),
}));

vi.mock("@/lib/project-access", () => ({
  requireProjectCapability: vi.fn(),
}));

import { inspectContainerInternal } from "@/app/actions/container-ops";
import { INTERNAL_ACTION_TOKEN } from "@/lib/internal-action-token";
import { requireProjectCapability } from "@/lib/project-access";
import { GET } from "./route";

describe("GET /api/admin/projects/:id/container", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns unauthorized project access errors", async () => {
    vi.mocked(requireProjectCapability).mockResolvedValue({
      authorized: false,
      error: "Unauthorized",
    } as any);

    const res = await GET(new Request("http://localhost/api/admin/projects/project-1/container"), {
      params: Promise.resolve({ id: "project-1" }),
    });
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body).toEqual({ status: "error", error: "Unauthorized" });
    expect(inspectContainerInternal).not.toHaveBeenCalled();
  });

  it("delegates to trusted internal inspect after project.view access passes", async () => {
    vi.mocked(requireProjectCapability).mockResolvedValue({
      authorized: true,
    } as any);
    vi.mocked(inspectContainerInternal).mockResolvedValue({
      status: "running",
      id: "container-1",
    } as any);

    const res = await GET(new Request("http://localhost/api/admin/projects/project-1/container"), {
      params: { id: "project-1" },
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(requireProjectCapability).toHaveBeenCalledWith("project-1", "project.view");
    expect(inspectContainerInternal).toHaveBeenCalledWith("project-1", INTERNAL_ACTION_TOKEN);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(body).toEqual({ status: "running", id: "container-1" });
  });
});
