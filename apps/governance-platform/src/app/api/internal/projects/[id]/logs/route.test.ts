import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $executeRawUnsafe: vi.fn(),
  },
}));

vi.mock("@/lib/progress-bus", () => ({
  progressBus: { notifyChanged: vi.fn() },
}));

vi.mock("@/lib/internal-auth", () => ({
  isRunnerAuthorized: vi.fn(),
}));

import { prisma } from "@/lib/prisma";
import { progressBus } from "@/lib/progress-bus";
import { isRunnerAuthorized } from "@/lib/internal-auth";

describe("POST /api/internal/projects/:id/logs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isRunnerAuthorized).mockReturnValue(true);
    vi.mocked(prisma.$executeRawUnsafe as any).mockResolvedValue(1);
  });

  it("rejects unauthorized requests", async () => {
    vi.mocked(isRunnerAuthorized).mockReturnValue(false);

    const res = await POST(
      new Request("http://localhost/api/internal/projects/proj-1/logs", {
        method: "POST",
        body: JSON.stringify({ chunks: [{ ts: Date.now(), stream: "stdout", text: "hello" }] }),
        headers: { "content-type": "application/json" },
      }),
      { params: Promise.resolve({ id: "proj-1" }) },
    );

    expect(res.status).toBe(401);
    expect(prisma.$executeRawUnsafe).not.toHaveBeenCalled();
  });

  it("appends JSONL logs without mutating project-level heartbeat", async () => {
    const ts = Date.now();
    const res = await POST(
      new Request("http://localhost/api/internal/projects/proj-1/logs", {
        method: "POST",
        body: JSON.stringify({
          chunks: [{ ts, stream: "stdout", text: "build line" }],
          lifecycle: [{ ts: ts + 1, event: "DEPLOYED" }],
        }),
        headers: { "content-type": "application/json" },
      }),
      { params: Promise.resolve({ id: "proj-1" }) },
    );

    expect(res.status).toBe(200);
    expect(prisma.$executeRawUnsafe).toHaveBeenCalledWith(
      expect.not.stringContaining("\"lastHeartbeat\""),
      expect.stringContaining("\"text\":\"build line\""),
      "proj-1",
    );
    expect(progressBus.notifyChanged).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "log_chunk",
        projectId: "proj-1",
      }),
    );
  });
});
