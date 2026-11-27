import { beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspaceEventTypeSchema } from "@arena/contracts";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    projectEvent: {
      findMany: vi.fn(),
      create: vi.fn(),
    },
  },
}));

vi.mock("@/lib/progress-bus", () => ({
  progressBus: {
    notifyChanged: vi.fn(),
  },
}));

vi.mock("@/lib/internal-auth", () => ({
  isRunnerAuthorized: vi.fn(),
}));

import { prisma } from "@/lib/prisma";
import { isRunnerAuthorized } from "@/lib/internal-auth";
import { GET } from "./route";

function context(id = "project-1") {
  return { params: Promise.resolve({ id }) };
}

describe("GET /api/internal/projects/:id/events", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isRunnerAuthorized).mockReturnValue(true);
    vi.mocked((prisma as any).projectEvent.findMany).mockResolvedValue([]);
  });

  it("filters untyped polling to contract-supported incoming event types", async () => {
    const response = await GET(
      new Request("http://localhost/api/internal/projects/project-1/events"),
      context(),
    );

    expect(response.status).toBe(200);
    expect((prisma as any).projectEvent.findMany).toHaveBeenCalledWith({
      where: {
        projectId: "project-1",
        direction: "in",
        type: { in: WorkspaceEventTypeSchema.options },
      },
      orderBy: { createdAt: "asc" },
    });
  });

  it("keeps a supported explicit event type narrow", async () => {
    const response = await GET(
      new Request("http://localhost/api/internal/projects/project-1/events?type=preview_refresh_requested"),
      context(),
    );

    expect(response.status).toBe(200);
    expect((prisma as any).projectEvent.findMany).toHaveBeenCalledWith({
      where: {
        projectId: "project-1",
        direction: "in",
        type: "preview_refresh_requested",
      },
      orderBy: { createdAt: "asc" },
    });
  });

  it("returns an empty batch for an unsupported requested type", async () => {
    const response = await GET(
      new Request("http://localhost/api/internal/projects/project-1/events?type=context_question"),
      context(),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ events: [] });
    expect((prisma as any).projectEvent.findMany).not.toHaveBeenCalled();
  });
});
