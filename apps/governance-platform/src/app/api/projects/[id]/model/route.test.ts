import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

vi.mock("server-only", () => ({}));

vi.mock("@/app/actions/project-settings", () => ({
  setProjectModelInternal: vi.fn(),
}));

vi.mock("@/lib/project-access", () => ({
  requireProjectCapability: vi.fn(),
}));

vi.mock("@/lib/telegram-webapp-project-access", () => ({
  requireTelegramWebAppProjectCapability: vi.fn(),
}));

import { setProjectModelInternal } from "@/app/actions/project-settings";
import { requireProjectCapability } from "@/lib/project-access";
import { requireTelegramWebAppProjectCapability } from "@/lib/telegram-webapp-project-access";

function context(id = "project-1") {
  return { params: Promise.resolve({ id }) };
}

function request(body: unknown, url = "http://localhost/api/projects/project-1/model") {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function telegramRequest(body: unknown) {
  return request(
    body,
    "http://localhost/api/projects/project-1/model?surface=telegram",
  );
}

describe("POST /api/projects/:id/model", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireProjectCapability).mockResolvedValue({
      authorized: true,
      session: { user: { id: "manager-1" } },
      hasBypass: false,
      isOwner: false,
      isAdmin: false,
    } as any);
    vi.mocked(requireTelegramWebAppProjectCapability).mockResolvedValue({
      authorized: true,
      session: { user: { id: "manager-1" } },
      hasBypass: false,
      isOwner: false,
      isAdmin: false,
    } as any);
    vi.mocked(setProjectModelInternal).mockResolvedValue({
      success: true,
      projectId: "project-1",
      model: "claude-opus-4-8",
      modelId: "opus",
    } as any);
  });

  it("lets an Arena project runtime manager switch model without owner-only gating", async () => {
    const res = await POST(request({ model: "opus" }), context());

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      ok: true,
      projectId: "project-1",
      model: "claude-opus-4-8",
      modelId: "opus",
    });
    expect(requireProjectCapability).toHaveBeenCalledWith("project-1", "project.runtime.manage");
    expect(setProjectModelInternal).toHaveBeenCalledWith("project-1", "opus", expect.anything());
  });

  it("accepts Telegram WebApp project runtime managers", async () => {
    const req = telegramRequest({ model: "opus" });
    const res = await POST(req, context());

    expect(res.status).toBe(200);
    expect(requireTelegramWebAppProjectCapability).toHaveBeenCalledWith(
      req,
      "project-1",
      "project.runtime.manage",
    );
    expect(setProjectModelInternal).toHaveBeenCalledWith("project-1", "opus", expect.anything());
  });

  it("rejects unsupported interaction surfaces", async () => {
    const res = await POST(
      request({ model: "opus" }, "http://localhost/api/projects/project-1/model?surface=chat"),
      context(),
    );

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: "Unsupported interaction surface" });
    expect(setProjectModelInternal).not.toHaveBeenCalled();
  });

  it("rejects callers without project runtime management access", async () => {
    vi.mocked(requireProjectCapability).mockResolvedValue({
      authorized: false,
      error: "Project access denied",
    } as any);

    const res = await POST(request({ model: "opus" }), context());

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({ error: "Project access denied" });
    expect(setProjectModelInternal).not.toHaveBeenCalled();
  });

  it("rejects invalid model payloads before mutation", async () => {
    const res = await POST(request({ model: "" }), context());

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: "Invalid request" });
    expect(setProjectModelInternal).not.toHaveBeenCalled();
  });

  it("surfaces catalog/action validation errors without lifecycle fallback", async () => {
    vi.mocked(setProjectModelInternal).mockResolvedValue({
      success: false,
      error: "Selected model is not available for this tool and loop.",
    } as any);

    const res = await POST(request({ model: "fake-model" }), context());

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({
      error: "Selected model is not available for this tool and loop.",
    });
  });
});
