import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    project: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
    },
  },
}));

vi.mock("@/lib/project-state-effects", () => ({
  applyStateChange: vi.fn(),
  requirePrimaryComponentRow: vi.fn(),
}));

vi.mock("@/lib/worker-url", () => ({
  resolveWorkerUrl: vi.fn(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/platform-access", () => ({
  requirePlatformCapability: vi.fn(),
}));

vi.mock("@/lib/project-access", () => ({
  requireProjectCapability: vi.fn(),
}));

import { prisma } from "@/lib/prisma";
import { resolveWorkerUrl } from "@/lib/worker-url";
import { INTERNAL_ACTION_TOKEN } from "@/lib/internal-action-token";
import {
  inspectContainerInternal,
  removeContainerInternal,
  restartContainerInternal,
  startContainerInternal,
  stopContainerInternal,
} from "./container-ops";

describe("inspectContainerInternal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", vi.fn());
  });

  it("blocks direct internal calls without trusted server token", async () => {
    const result = await inspectContainerInternal("project-1");

    expect(result).toEqual({
      status: "error",
      error: "Internal action is not callable directly.",
    });
    expect(prisma.project.findUnique).not.toHaveBeenCalled();
  });

  it("does not fall back to stale project-level runtime identity", async () => {
    vi.mocked(prisma.project.findUnique as any).mockResolvedValue({
      containerName: "preview-stale-project-mirror",
      workerHost: "local",
      vpsHost: null,
      components: [{
        containerName: null,
        workerHost: null,
      }],
    });

    const result = await inspectContainerInternal("project-1", INTERNAL_ACTION_TOKEN);

    expect(result).toEqual({ status: "not_found" });
    expect(resolveWorkerUrl).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("uses component runtime identity when it exists", async () => {
    vi.mocked(prisma.project.findUnique as any).mockResolvedValue({
      containerName: "preview-stale-project-mirror",
      workerHost: "stale-worker",
      vpsHost: null,
      components: [{
        kind: "app",
        containerName: "preview-demo",
        workerHost: "local",
      }],
    });
    vi.mocked(resolveWorkerUrl).mockReturnValue("http://worker.local");
    vi.mocked(fetch as any).mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ status: "running" }),
    });

    const result = await inspectContainerInternal("project-1", INTERNAL_ACTION_TOKEN);

    expect(resolveWorkerUrl).toHaveBeenCalledWith("local", undefined);
    expect(fetch).toHaveBeenCalledWith(
      "http://worker.local/containers/preview-demo/inspect",
      expect.objectContaining({
        headers: expect.any(Object),
      }),
    );
    expect(result).toEqual({ status: "running" });
  });

  it("requests kind alongside component runtime identity", async () => {
    vi.mocked(prisma.project.findUnique as any).mockResolvedValue({
      vpsHost: null,
      components: [{
        kind: "app",
        containerName: "preview-demo",
        workerHost: "local",
      }],
    });
    vi.mocked(resolveWorkerUrl).mockReturnValue("http://worker.local");
    vi.mocked(fetch as any).mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ status: "running" }),
    });

    await inspectContainerInternal("project-1", INTERNAL_ACTION_TOKEN);

    expect(prisma.project.findUnique).toHaveBeenCalledWith({
      where: { id: "project-1" },
      select: {
        vpsHost: { select: { ip: true } },
        components: {
          where: { kind: "app" },
          orderBy: { createdAt: "asc" },
          take: 1,
          select: { kind: true, containerName: true, workerHost: true },
        },
      },
    });
  });
});

describe("removeContainerInternal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", vi.fn());
  });

  it("treats 404 remove as already converged success", async () => {
    vi.mocked(prisma.project.findUnique as any).mockResolvedValue({
      vpsHost: null,
      components: [{
        kind: "app",
        containerName: "preview-demo",
        workerHost: "local",
      }],
    });
    vi.mocked(resolveWorkerUrl).mockReturnValue("http://worker.local");
    vi.mocked(fetch as any).mockResolvedValue({
      ok: false,
      status: 404,
      text: vi.fn().mockResolvedValue("not found"),
    });

    const result = await removeContainerInternal("project-1", INTERNAL_ACTION_TOKEN);

    expect(fetch).toHaveBeenCalledWith(
      "http://worker.local/containers/preview-demo",
      expect.objectContaining({
        method: "DELETE",
      }),
    );
    expect(result).toEqual({ success: true });
  });
});

describe("container maintenance actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", vi.fn());
    vi.mocked(prisma.project.findUnique as any).mockResolvedValue({
      vpsHost: null,
      components: [{
        kind: "app",
        containerName: "preview-demo",
        workerHost: "local",
      }],
    });
    vi.mocked(resolveWorkerUrl).mockReturnValue("http://worker.local");
  });

  it("starts the runtime via the live worker start endpoint", async () => {
    vi.mocked(fetch as any).mockResolvedValue({
      ok: true,
      status: 200,
      text: vi.fn().mockResolvedValue(""),
    });

    const result = await startContainerInternal("project-1", INTERNAL_ACTION_TOKEN);

    expect(fetch).toHaveBeenCalledWith(
      "http://worker.local/containers/preview-demo/start",
      expect.objectContaining({ method: "POST" }),
    );
    expect(result).toEqual({ success: true });
  });

  it("restarts the runtime via the live worker restart endpoint", async () => {
    vi.mocked(fetch as any).mockResolvedValue({
      ok: true,
      status: 200,
      text: vi.fn().mockResolvedValue(""),
    });

    const result = await restartContainerInternal("project-1", INTERNAL_ACTION_TOKEN);

    expect(fetch).toHaveBeenCalledWith(
      "http://worker.local/containers/preview-demo/restart",
      expect.objectContaining({ method: "POST" }),
    );
    expect(result).toEqual({ success: true });
  });

  it("surfaces worker stop failures without inventing a fallback path", async () => {
    vi.mocked(fetch as any).mockResolvedValue({
      ok: false,
      status: 404,
      text: vi.fn().mockResolvedValue("{\"error\":\"No such container\"}"),
    });

    const result = await stopContainerInternal("project-1", INTERNAL_ACTION_TOKEN);

    expect(fetch).toHaveBeenCalledWith(
      "http://worker.local/containers/preview-demo/stop",
      expect.objectContaining({ method: "POST" }),
    );
    expect(result).toEqual({
      success: false,
      error: "Stop failed (404): {\"error\":\"No such container\"}",
    });
  });
});
