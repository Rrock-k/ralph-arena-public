import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/admin-ops-shell", () => ({
  resolveAdminOpsViewer: vi.fn(),
}));

vi.mock("@/lib/progress-bus", () => ({
  progressBus: {
    onDataChanged: vi.fn(),
  },
}));

import { GET } from "./route";
import { resolveAdminOpsViewer } from "@/lib/admin-ops-shell";
import { progressBus } from "@/lib/progress-bus";

describe("GET /api/admin/projects/stream", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns unauthorized viewer errors", async () => {
    vi.mocked(resolveAdminOpsViewer).mockResolvedValue({
      authorized: false,
      status: 401,
      error: "Unauthorized",
    } as any);

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body).toEqual({ error: "Unauthorized" });
    expect(progressBus.onDataChanged).not.toHaveBeenCalled();
  });

  it("emits project-scoped SSE payloads", async () => {
    let listener: ((event: { type: string; at: number; projectId?: string }) => void) | null = null;

    vi.mocked(resolveAdminOpsViewer).mockResolvedValue({
      authorized: true,
      session: { user: { id: "user-1" } },
      hasBypass: false,
      visibleProjectIds: ["project-1"],
    } as any);
    vi.mocked(progressBus.onDataChanged).mockImplementation((cb) => {
      listener = cb as typeof listener;
      return vi.fn();
    });

    const res = await GET();
    const reader = res.body?.getReader();
    expect(reader).toBeTruthy();

    listener?.({ type: "changed", at: Date.now(), projectId: "project-1" });

    const { value } = await reader!.read();
    const text = new TextDecoder().decode(value);

    expect(text).toContain('"scope":"project"');
    expect(text).toContain('"projectId":"project-1"');

    await reader!.cancel();
  });

  it("filters invisible projects and preserves global payloads", async () => {
    let listener: ((event: { type: string; at: number; projectId?: string }) => void) | null = null;

    vi.mocked(resolveAdminOpsViewer).mockResolvedValue({
      authorized: true,
      session: { user: { id: "user-1" } },
      hasBypass: false,
      visibleProjectIds: ["project-1"],
    } as any);
    vi.mocked(progressBus.onDataChanged).mockImplementation((cb) => {
      listener = cb as typeof listener;
      return vi.fn();
    });

    const res = await GET();
    const reader = res.body?.getReader();
    expect(reader).toBeTruthy();

    listener?.({ type: "changed", at: Date.now(), projectId: "project-2" });
    listener?.({ type: "changed", at: Date.now() });

    const { value } = await reader!.read();
    const text = new TextDecoder().decode(value);

    expect(text).toContain('"scope":"all"');
    expect(text).not.toContain("project-2");

    await reader!.cancel();
  });
});
