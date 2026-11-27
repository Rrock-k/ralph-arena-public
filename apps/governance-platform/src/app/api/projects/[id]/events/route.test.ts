import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    projectEvent: {
      findMany: vi.fn(),
    },
  },
}));

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
}));

vi.mock("@/lib/progress-bus", () => ({
  progressBus: {
    notifyChanged: vi.fn(),
  },
}));

vi.mock("@/lib/feature-flags", () => ({
  isCommunityQaEnabled: vi.fn(),
}));

vi.mock("@/lib/project-access", () => ({
  requireProjectCapability: vi.fn(),
}));

import { prisma } from "@/lib/prisma";
import { isCommunityQaEnabled } from "@/lib/feature-flags";
import { requireProjectCapability } from "@/lib/project-access";
import { GET } from "./route";

function context(id = "project-1") {
  return { params: Promise.resolve({ id }) };
}

describe("GET /api/projects/:id/events", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isCommunityQaEnabled).mockResolvedValue(true);
    vi.mocked(requireProjectCapability).mockResolvedValue({ authorized: true } as any);
    vi.mocked(prisma.projectEvent.findMany as any).mockResolvedValue([]);
  });

  it("requires project runtime capability before exposing raw events", async () => {
    vi.mocked(requireProjectCapability).mockResolvedValue({
      authorized: false,
      error: "Project access denied",
    } as any);

    const response = await GET(
      new Request("http://localhost/api/projects/project-1/events"),
      context(),
    );
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toEqual({ error: "Project access denied" });
    expect(requireProjectCapability).toHaveBeenCalledWith("project-1", "project.runtime.manage");
    expect(prisma.projectEvent.findMany).not.toHaveBeenCalled();
  });
});
