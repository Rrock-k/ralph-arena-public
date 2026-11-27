import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  projectFindUnique: vi.fn(),
  runLogFindMany: vi.fn(),
}));

vi.mock("server-only", () => ({}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    project: { findUnique: prismaMock.projectFindUnique },
    runLog: { findMany: prismaMock.runLogFindMany },
  },
}));

import { getProjectRunLogActivity } from "./run-log-activity.server";

describe("getProjectRunLogActivity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.projectFindUnique.mockResolvedValue({ id: "project-1" });
  });

  it("loads a bounded raw window and groups it on the read side", async () => {
    prismaMock.runLogFindMany.mockResolvedValue([
      log("auto-2", "AUTO-RETRY", "2026-06-27T01:36:07.000Z"),
      log("auto-1", "AUTO-RETRY", "2026-06-27T01:35:37.000Z"),
      log("running", "RUNNING", "2026-06-27T01:35:00.000Z"),
      log("older", "PAUSED", "2026-06-27T01:34:00.000Z"),
    ]);

    const activity = await getProjectRunLogActivity("project-1", {
      windowLimit: 3,
      maxGroups: 4,
    });

    expect(prismaMock.runLogFindMany).toHaveBeenCalledWith({
      where: { projectId: "project-1" },
      orderBy: { createdAt: "desc" },
      take: 4,
      select: {
        id: true,
        event: true,
        detail: true,
        createdAt: true,
      },
    });
    expect(activity).toEqual(expect.objectContaining({
      fetchedEventCount: 3,
      visibleEventCount: 3,
      hasMore: true,
    }));
    expect(activity?.groups).toEqual([
      expect.objectContaining({ event: "AUTO-RETRY", count: 2 }),
      expect.objectContaining({ event: "RUNNING", count: 1 }),
    ]);
  });

  it("returns null for missing projects", async () => {
    prismaMock.projectFindUnique.mockResolvedValue(null);

    await expect(getProjectRunLogActivity("missing")).resolves.toBeNull();
    expect(prismaMock.runLogFindMany).not.toHaveBeenCalled();
  });
});

function log(id: string, event: string, createdAt: string) {
  return { id, event, detail: null, createdAt: new Date(createdAt) };
}
