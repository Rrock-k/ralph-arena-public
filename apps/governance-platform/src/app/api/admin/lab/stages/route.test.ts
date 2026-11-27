import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/platform-access", () => ({
  requirePlatformCapability: vi.fn(),
}));

vi.mock("@/lib/admin-lab", () => ({
  getAdminLabStageCatalog: vi.fn(() => [{
    id: "project_operator_snapshot",
    label: "Project operator snapshot",
    status: "supported_now",
  }]),
}));

import { GET } from "./route";
import { getAdminLabStageCatalog } from "@/lib/admin-lab";
import { requirePlatformCapability } from "@/lib/platform-access";

describe("GET /api/admin/lab/stages", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("requires platform runtime management", async () => {
    vi.mocked(requirePlatformCapability).mockResolvedValueOnce({
      authorized: false,
      error: "Platform access denied",
    } as any);

    const response = await GET();
    const payload = await response.json();

    expect(response.status).toBe(401);
    expect(payload).toEqual({ error: "Platform access denied" });
    expect(getAdminLabStageCatalog).not.toHaveBeenCalled();
  });

  it("returns the lab stage catalog", async () => {
    vi.mocked(requirePlatformCapability).mockResolvedValueOnce({
      authorized: true,
    } as any);

    const response = await GET();
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(getAdminLabStageCatalog).toHaveBeenCalledWith();
    expect(payload).toMatchObject({
      schemaVersion: "ra-356.admin-lab-stage-catalog.v1",
      stages: [{
        id: "project_operator_snapshot",
        status: "supported_now",
      }],
    });
  });
});
