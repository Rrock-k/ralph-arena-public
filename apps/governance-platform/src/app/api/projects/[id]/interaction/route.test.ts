import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
}));

vi.mock("@/lib/e2e-auth-bypass", () => ({
  hasE2EAdminBypass: vi.fn(),
}));

vi.mock("@/lib/project-interaction", () => ({
  getProjectInteractionSnapshotForViewer: vi.fn(),
}));

vi.mock("@/lib/telegram-webapp-auth", () => ({
  TELEGRAM_WEBAPP_INIT_DATA_HEADER: "x-telegram-webapp-init-data",
  resolveTelegramWebAppSessionFromInitData: vi.fn(),
}));

vi.mock("@/lib/tg-spec-project-access", () => ({
  syncTgSpecProjectAccessForTelegramViewer: vi.fn(),
}));

import { auth } from "@/lib/auth";
import { hasE2EAdminBypass } from "@/lib/e2e-auth-bypass";
import { getProjectInteractionSnapshotForViewer } from "@/lib/project-interaction";
import { resolveTelegramWebAppSessionFromInitData } from "@/lib/telegram-webapp-auth";
import { syncTgSpecProjectAccessForTelegramViewer } from "@/lib/tg-spec-project-access";
import { dynamic, GET } from "./route";

function request(url = "http://localhost/api/projects/project-1/interaction") {
  return new Request(url);
}

function context(id = "project-1") {
  return { params: Promise.resolve({ id }) };
}

describe("GET /api/projects/:id/interaction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(auth).mockResolvedValue({ user: { id: "user-1" } } as any);
    vi.mocked(hasE2EAdminBypass).mockResolvedValue(false);
    vi.mocked(resolveTelegramWebAppSessionFromInitData).mockResolvedValue({ status: "missing_init_data" });
    vi.mocked(syncTgSpecProjectAccessForTelegramViewer).mockResolvedValue({ status: "not_applicable" });
  });

  it("is intentionally dynamic because it returns private manager truth", () => {
    expect(dynamic).toBe("force-dynamic");
  });

  it("returns a no-store manager snapshot for authorized viewers", async () => {
    vi.mocked(getProjectInteractionSnapshotForViewer).mockResolvedValue({
      status: "ok",
      snapshot: { version: "ra-287.project-interaction.v2", project: { id: "project-1" } },
    } as any);

    const response = await GET(request(), context());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(body).toEqual({ version: "ra-287.project-interaction.v2", project: { id: "project-1" } });
    expect(getProjectInteractionSnapshotForViewer).toHaveBeenCalledWith({
      projectId: "project-1",
      session: { user: { id: "user-1" } },
      hasBypass: false,
      surface: "arena",
    });
  });

  it("passes the explicit Telegram surface to the snapshot builder", async () => {
    vi.mocked(getProjectInteractionSnapshotForViewer).mockResolvedValue({
      status: "ok",
      snapshot: {
        version: "ra-287.project-interaction.v2",
        viewer: { surface: "telegram" },
      },
    } as any);

    const response = await GET(
      request("http://localhost/api/projects/project-1/interaction?surface=telegram"),
      context(),
    );

    expect(response.status).toBe(200);
    expect(getProjectInteractionSnapshotForViewer).toHaveBeenCalledWith({
      projectId: "project-1",
      session: { user: { id: "user-1" } },
      hasBypass: false,
      surface: "telegram",
    });
    expect(resolveTelegramWebAppSessionFromInitData).not.toHaveBeenCalled();
    expect(syncTgSpecProjectAccessForTelegramViewer).not.toHaveBeenCalled();
  });

  it("uses verified Telegram WebApp init data as the session candidate for Telegram surface", async () => {
    vi.mocked(auth).mockResolvedValue(null);
    const telegramSession = {
      user: {
        id: "arena-user-from-telegram",
        email: null,
        role: "USER",
      },
      expires: "2030-01-01T00:00:00.000Z",
    };
    vi.mocked(resolveTelegramWebAppSessionFromInitData).mockResolvedValue({
      status: "ok",
      telegramUserId: "12345",
      session: telegramSession as any,
    });
    vi.mocked(getProjectInteractionSnapshotForViewer).mockResolvedValue({
      status: "ok",
      snapshot: {
        version: "ra-287.project-interaction.v2",
        viewer: { surface: "telegram" },
      },
    } as any);

    const response = await GET(
      new Request("http://localhost/api/projects/project-1/interaction?surface=telegram", {
        headers: { "x-telegram-webapp-init-data": "auth_date=1&signature=sig" },
      }),
      context(),
    );

    expect(response.status).toBe(200);
    expect(resolveTelegramWebAppSessionFromInitData).toHaveBeenCalledWith("auth_date=1&signature=sig");
    expect(syncTgSpecProjectAccessForTelegramViewer).toHaveBeenCalledWith({
      projectId: "project-1",
      arenaUserId: "arena-user-from-telegram",
      telegramUserId: "12345",
    });
    expect(getProjectInteractionSnapshotForViewer).toHaveBeenCalledWith({
      projectId: "project-1",
      session: telegramSession,
      hasBypass: false,
      surface: "telegram",
    });
  });

  it("does not treat Telegram init data as auth for the Arena surface", async () => {
    vi.mocked(auth).mockResolvedValue(null);
    vi.mocked(getProjectInteractionSnapshotForViewer).mockResolvedValue({ status: "unauthorized" } as any);

    const response = await GET(
      new Request("http://localhost/api/projects/project-1/interaction", {
        headers: { "x-telegram-webapp-init-data": "auth_date=1&signature=sig" },
      }),
      context(),
    );

    expect(response.status).toBe(401);
    expect(resolveTelegramWebAppSessionFromInitData).not.toHaveBeenCalled();
    expect(syncTgSpecProjectAccessForTelegramViewer).not.toHaveBeenCalled();
    expect(getProjectInteractionSnapshotForViewer).toHaveBeenCalledWith({
      projectId: "project-1",
      session: null,
      hasBypass: false,
      surface: "arena",
    });
  });

  it("rejects unknown interaction surfaces", async () => {
    const response = await GET(
      request("http://localhost/api/projects/project-1/interaction?surface=telegram-admin"),
      context(),
    );

    expect(response.status).toBe(400);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({ error: "Unsupported interaction surface" });
    expect(getProjectInteractionSnapshotForViewer).not.toHaveBeenCalled();
  });

  it("passes e2e bypass through without requiring a signed-in session", async () => {
    vi.mocked(auth).mockResolvedValue(null);
    vi.mocked(hasE2EAdminBypass).mockResolvedValue(true);
    vi.mocked(getProjectInteractionSnapshotForViewer).mockResolvedValue({
      status: "ok",
      snapshot: { version: "ra-287.project-interaction.v2" },
    } as any);

    const response = await GET(request(), context("project-bypass"));

    expect(response.status).toBe(200);
    expect(getProjectInteractionSnapshotForViewer).toHaveBeenCalledWith({
      projectId: "project-bypass",
      session: null,
      hasBypass: true,
      surface: "arena",
    });
  });

  it.each([
    ["unauthorized", 401, { error: "Unauthorized" }],
    ["forbidden", 403, { error: "Project access denied" }],
    ["not_found", 404, { error: "Project not found" }],
  ] as const)("maps %s result to HTTP %i", async (status, expectedStatus, expectedBody) => {
    vi.mocked(getProjectInteractionSnapshotForViewer).mockResolvedValue({ status } as any);

    const response = await GET(request(), context());

    expect(response.status).toBe(expectedStatus);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual(expectedBody);
  });
});
