import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/admin-ops-shell", () => ({
  resolveAdminOpsViewer: vi.fn(),
}));

vi.mock("@/lib/admin-ops-projects", () => ({
  getAdminOpsProjectsForViewer: vi.fn(),
}));

import { GET } from "./route";
import { resolveAdminOpsViewer } from "@/lib/admin-ops-shell";
import { getAdminOpsProjectsForViewer } from "@/lib/admin-ops-projects";

describe("GET /api/admin/projects/snapshot", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns unauthorized viewer errors", async () => {
    vi.mocked(resolveAdminOpsViewer).mockResolvedValue({
      authorized: false,
      status: 401,
      error: "Unauthorized",
    } as any);

    const res = await GET(new Request("http://localhost/api/admin/projects/snapshot"));
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body).toEqual({ error: "Unauthorized" });
    expect(getAdminOpsProjectsForViewer).not.toHaveBeenCalled();
  });

  it("filters requested ids through viewer visibility", async () => {
    vi.mocked(resolveAdminOpsViewer).mockResolvedValue({
      authorized: true,
      session: { user: { id: "user-1" } },
      hasBypass: false,
      visibleProjectIds: ["project-1", "project-3"],
    } as any);
    vi.mocked(getAdminOpsProjectsForViewer).mockResolvedValue([{ id: "project-1" }] as any);

    const res = await GET(new Request("http://localhost/api/admin/projects/snapshot?ids=project-1,project-2"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(getAdminOpsProjectsForViewer).toHaveBeenCalledWith({
      projectIds: ["project-1"],
      session: { user: { id: "user-1" } },
      hasBypass: false,
    });
    expect(body).toEqual({ projects: [{ id: "project-1" }] });
  });

  it("returns full visible snapshot when ids are omitted", async () => {
    vi.mocked(resolveAdminOpsViewer).mockResolvedValue({
      authorized: true,
      session: null,
      hasBypass: true,
      visibleProjectIds: undefined,
    } as any);
    vi.mocked(getAdminOpsProjectsForViewer).mockResolvedValue([{ id: "project-1" }, { id: "project-2" }] as any);

    const res = await GET(new Request("http://localhost/api/admin/projects/snapshot"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(getAdminOpsProjectsForViewer).toHaveBeenCalledWith({
      projectIds: undefined,
      session: null,
      hasBypass: true,
    });
    expect(body.projects).toHaveLength(2);
  });
});
