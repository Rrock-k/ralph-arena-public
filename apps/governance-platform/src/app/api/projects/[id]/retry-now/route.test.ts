import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

vi.mock("server-only", () => ({}));

vi.mock("@/lib/project-access", () => ({
  requireProjectCapability: vi.fn(),
}));

vi.mock("@/lib/retry-now", () => ({
  retryProjectNowInternal: vi.fn(),
}));

import { requireProjectCapability } from "@/lib/project-access";
import { retryProjectNowInternal } from "@/lib/retry-now";

function context(id = "project-1") {
  return { params: Promise.resolve({ id }) };
}

function request() {
  return new Request("http://localhost/api/projects/project-1/retry-now", {
    method: "POST",
  });
}

describe("POST /api/projects/:id/retry-now", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireProjectCapability).mockResolvedValue({ authorized: true } as any);
    vi.mocked(retryProjectNowInternal).mockResolvedValue({
      success: true,
      projectId: "project-1",
      blocker: "RATE_LIMIT",
      remainingBlockers: [],
      resumePath: "supervisor",
    } as any);
  });

  it("reuses project runtime capability and lifecycle owner", async () => {
    const response = await POST(request(), context());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      success: true,
      projectId: "project-1",
      blocker: "RATE_LIMIT",
      remainingBlockers: [],
      resumePath: "supervisor",
    });
    expect(requireProjectCapability).toHaveBeenCalledWith("project-1", "project.runtime.manage");
    expect(retryProjectNowInternal).toHaveBeenCalledWith("project-1");
  });

  it("rejects callers without runtime management access before mutation", async () => {
    vi.mocked(requireProjectCapability).mockResolvedValue({
      authorized: false,
      error: "Project access denied",
    } as any);

    const response = await POST(request(), context());

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "Project access denied" });
    expect(retryProjectNowInternal).not.toHaveBeenCalled();
  });

  it("surfaces lifecycle refusal without fallback relaunch or recreate", async () => {
    vi.mocked(retryProjectNowInternal).mockResolvedValue({
      success: false,
      error: "No blockers are present.",
    } as any);

    const response = await POST(request(), context());

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      success: false,
      error: "No blockers are present.",
    });
  });
});
