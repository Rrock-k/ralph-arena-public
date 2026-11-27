import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

vi.mock("@/lib/maintenance-jobs", () => ({
  runMaintenanceItemNow: vi.fn(),
}));

import { POST } from "./route";
import { runMaintenanceItemNow } from "@/lib/maintenance-jobs";

const ORIGINAL_ADMIN_SECRET = process.env.ARENA_ADMIN_SECRET;

function request(body: unknown, headers: Record<string, string> = {}) {
  return new Request("http://localhost/api/admin/maintenance-jobs/run-now", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...headers,
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

async function responseJson(response: Response) {
  return response.json() as Promise<Record<string, unknown>>;
}

describe("POST /api/admin/maintenance-jobs/run-now", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ARENA_ADMIN_SECRET = "admin-secret";
    vi.mocked(runMaintenanceItemNow).mockResolvedValue({
      success: true,
      run: {
        id: "run-1",
        status: "SUCCEEDED",
        summary: "done",
        result: { deletedRows: 10 },
        startedAt: new Date("2026-06-05T16:00:00.000Z"),
        finishedAt: new Date("2026-06-05T16:00:01.000Z"),
        durationMs: 1000,
      },
    } as any);
  });

  afterEach(() => {
    if (ORIGINAL_ADMIN_SECRET === undefined) {
      delete process.env.ARENA_ADMIN_SECRET;
    } else {
      process.env.ARENA_ADMIN_SECRET = ORIGINAL_ADMIN_SECRET;
    }
  });

  it("requires the admin API secret and does not accept cron auth", async () => {
    const response = await POST(request(
      { key: "maintenance:runlog-heartbeat-compaction" },
      { "x-cron-secret": "admin-secret" },
    ));

    expect(response.status).toBe(401);
    expect(await responseJson(response)).toEqual({
      success: false,
      error: "Unauthorized",
    });
    expect(runMaintenanceItemNow).not.toHaveBeenCalled();
  });

  it("returns 503 when the admin API secret is not configured", async () => {
    delete process.env.ARENA_ADMIN_SECRET;

    const response = await POST(request(
      { key: "maintenance:runlog-heartbeat-compaction" },
      { "x-arena-admin-secret": "admin-secret" },
    ));

    expect(response.status).toBe(503);
    expect(await responseJson(response)).toEqual({
      success: false,
      error: "Admin API not configured",
    });
    expect(runMaintenanceItemNow).not.toHaveBeenCalled();
  });

  it("rejects malformed JSON", async () => {
    const response = await POST(request("{", { "x-arena-admin-secret": "admin-secret" }));

    expect(response.status).toBe(400);
    expect(await responseJson(response)).toEqual({
      success: false,
      error: "Invalid JSON body",
    });
    expect(runMaintenanceItemNow).not.toHaveBeenCalled();
  });

  it("rejects non-maintenance item keys", async () => {
    const response = await POST(request(
      { key: "runlog-heartbeat-compaction" },
      { "x-arena-admin-secret": "admin-secret" },
    ));

    expect(response.status).toBe(400);
    expect(await responseJson(response)).toEqual({
      success: false,
      error: "Expected MaintenanceItem key",
    });
    expect(runMaintenanceItemNow).not.toHaveBeenCalled();
  });

  it("runs a MaintenanceItem through the manual run-now executor", async () => {
    const response = await POST(request(
      { key: "maintenance:runlog-heartbeat-compaction" },
      { "x-arena-admin-secret": "admin-secret" },
    ));

    expect(response.status).toBe(200);
    expect(runMaintenanceItemNow).toHaveBeenCalledWith(
      "maintenance:runlog-heartbeat-compaction",
      {
        actorType: "system",
        actorId: "arena-admin-api",
        actorCapability: "platform.runtime.manage",
      },
    );
    expect(await responseJson(response)).toEqual({
      success: true,
      error: null,
      run: {
        id: "run-1",
        status: "SUCCEEDED",
        summary: "done",
        result: { deletedRows: 10 },
        startedAt: "2026-06-05T16:00:00.000Z",
        finishedAt: "2026-06-05T16:00:01.000Z",
        durationMs: 1000,
      },
      activeRun: null,
    });
  });

  it("returns active run evidence when manual run-now is already running", async () => {
    vi.mocked(runMaintenanceItemNow).mockResolvedValue({
      success: false,
      error: "Maintenance item already has a STARTED run: maintenance:runlog-heartbeat-compaction",
      activeRun: {
        id: "active-run",
        startedAt: new Date("2026-06-05T16:01:00.000Z"),
        trigger: "manual",
        actorType: "system",
        actorId: "arena-admin-api",
      },
    } as any);

    const response = await POST(request(
      { key: "maintenance:runlog-heartbeat-compaction" },
      { "x-arena-admin-secret": "admin-secret" },
    ));

    expect(response.status).toBe(200);
    expect(await responseJson(response)).toEqual({
      success: false,
      error: "Maintenance item already has a STARTED run: maintenance:runlog-heartbeat-compaction",
      run: null,
      activeRun: {
        id: "active-run",
        startedAt: "2026-06-05T16:01:00.000Z",
        trigger: "manual",
        actorType: "system",
        actorId: "arena-admin-api",
      },
    });
  });
});
