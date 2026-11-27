import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/control-plane", () => ({
  fetchWorkerJson: vi.fn(),
  getProjectWorkerInfo: vi.fn(),
}));

import { fetchWorkerJson, getProjectWorkerInfo } from "@/lib/control-plane";
import { readProjectPreviewGeneration } from "./preview-status";

describe("readProjectPreviewGeneration", () => {
  beforeEach(() => vi.clearAllMocks());

  it("reads generation through the resolved worker and container", async () => {
    vi.mocked(getProjectWorkerInfo).mockResolvedValue({
      projectId: "project-1",
      workerUrl: "http://worker-agent:4200",
      containerName: "preview-project-1",
    });
    vi.mocked(fetchWorkerJson).mockResolvedValue({ ok: true, body: { generation: "source:refresh-8" } });
    await expect(readProjectPreviewGeneration("project-1")).resolves.toEqual({
      ok: true,
      generation: "source:refresh-8",
    });
    expect(fetchWorkerJson).toHaveBeenCalledWith(
      "http://worker-agent:4200/containers/preview-project-1/preview-generation",
      { timeoutMs: 5_000 },
    );
  });

  it("does not call the worker when runtime identity is absent", async () => {
    vi.mocked(getProjectWorkerInfo).mockResolvedValue({
      projectId: "project-1",
      workerUrl: null,
      containerName: null,
    });
    await expect(readProjectPreviewGeneration("project-1")).resolves.toEqual({
      ok: false,
      error: "Project preview runtime is not running",
    });
    expect(fetchWorkerJson).not.toHaveBeenCalled();
  });

  it("rejects worker failures and malformed bodies", async () => {
    vi.mocked(getProjectWorkerInfo).mockResolvedValue({
      projectId: "project-1",
      workerUrl: "http://worker-agent:4200",
      containerName: "preview-project-1",
    });
    vi.mocked(fetchWorkerJson).mockResolvedValueOnce({ ok: false, status: 503, body: "unavailable" });
    await expect(readProjectPreviewGeneration("project-1")).resolves.toEqual({
      ok: false,
      error: "Preview generation could not be read",
    });
    vi.mocked(fetchWorkerJson).mockResolvedValueOnce({ ok: true, body: { generation: null } });
    await expect(readProjectPreviewGeneration("project-1")).resolves.toEqual({
      ok: false,
      error: "Preview generation response is invalid",
    });
  });
});
