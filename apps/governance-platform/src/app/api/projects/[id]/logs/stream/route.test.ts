import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    project: { findUnique: vi.fn() },
  },
}));

vi.mock("@/lib/progress-bus", () => ({
  progressBus: {
    onDataChanged: vi.fn(),
  },
}));

vi.mock("@/lib/project-access", () => ({
  requireProjectCapability: vi.fn(),
}));

import { prisma } from "@/lib/prisma";
import { requireProjectCapability } from "@/lib/project-access";
import { GET } from "./route";

function context(id = "project-1") {
  return { params: Promise.resolve({ id }) };
}

describe("GET /api/projects/:id/logs/stream", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireProjectCapability).mockResolvedValue({ authorized: true } as any);
    vi.mocked(prisma.project.findUnique as any).mockResolvedValue({ log: "" });
  });

  it("requires project runtime capability before exposing raw logs", async () => {
    vi.mocked(requireProjectCapability).mockResolvedValue({
      authorized: false,
      error: "Project access denied",
    } as any);

    const response = await GET(
      new Request("http://localhost/api/projects/project-1/logs/stream"),
      context(),
    );

    expect(response.status).toBe(403);
    expect(await response.text()).toBe("Project access denied");
    expect(requireProjectCapability).toHaveBeenCalledWith("project-1", "project.runtime.manage");
    expect(prisma.project.findUnique).not.toHaveBeenCalled();
  });
});
