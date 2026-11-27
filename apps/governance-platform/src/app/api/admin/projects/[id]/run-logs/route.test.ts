import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/platform-access", () => ({
  requireAnyPlatformCapability: vi.fn(),
}));

vi.mock("@/lib/project-access", () => ({
  requireAnyProjectCapability: vi.fn(),
}));

vi.mock("@/lib/run-log-activity.server", () => {
  return {
    getProjectRunLogActivity: vi.fn(),
    parseRunLogActivityLimit: (value: string | null) => {
      if (!value) return undefined;
      const parsed = Number.parseInt(value, 10);
      return Number.isFinite(parsed) ? parsed : undefined;
    },
  };
});

import { requireAnyPlatformCapability } from "@/lib/platform-access";
import { requireAnyProjectCapability } from "@/lib/project-access";
import { getProjectRunLogActivity } from "@/lib/run-log-activity.server";
import { GET } from "./route";

function context(id = "project-1") {
  return { params: Promise.resolve({ id }) };
}

describe("GET /api/admin/projects/:id/run-logs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireAnyPlatformCapability).mockResolvedValue({ authorized: true } as any);
    vi.mocked(requireAnyProjectCapability).mockResolvedValue({ authorized: false, error: "Project access denied" } as any);
    vi.mocked(getProjectRunLogActivity).mockResolvedValue({
      groups: [],
      fetchedEventCount: 0,
      visibleEventCount: 0,
      visibleGroupCount: 0,
      windowLimit: 160,
      hasMore: false,
    });
  });

  it("returns grouped run log activity for platform operators", async () => {
    const response = await GET(
      new Request("http://localhost/api/admin/projects/project-1/run-logs?limit=240&groups=18"),
      context(),
    );

    expect(response.status).toBe(200);
    expect(requireAnyPlatformCapability).toHaveBeenCalledWith([
      "platform.ops.view",
      "platform.projects.view",
      "platform.projects.manage",
      "platform.runtime.manage",
    ]);
    expect(requireAnyProjectCapability).not.toHaveBeenCalled();
    expect(getProjectRunLogActivity).toHaveBeenCalledWith("project-1", {
      windowLimit: 240,
      maxGroups: 18,
    });
    await expect(response.json()).resolves.toEqual({
      activity: expect.objectContaining({ groups: [] }),
    });
  });

  it("allows project-scoped viewers when platform access is absent", async () => {
    vi.mocked(requireAnyPlatformCapability).mockResolvedValue({
      authorized: false,
      error: "Platform access denied",
    } as any);
    vi.mocked(requireAnyProjectCapability).mockResolvedValue({ authorized: true } as any);

    const response = await GET(
      new Request("http://localhost/api/admin/projects/project-1/run-logs"),
      context(),
    );

    expect(response.status).toBe(200);
    expect(requireAnyProjectCapability).toHaveBeenCalledWith("project-1", [
      "project.view",
      "project.runtime.manage",
    ]);
  });

  it("returns 404 when the project does not exist", async () => {
    vi.mocked(getProjectRunLogActivity).mockResolvedValue(null);

    const response = await GET(
      new Request("http://localhost/api/admin/projects/missing/run-logs"),
      context("missing"),
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "Project not found" });
  });
});
