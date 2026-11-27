import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

vi.mock("server-only", () => ({}));

vi.mock("@/app/actions/project-settings", () => ({
  setProjectRuntimeSystemInternal: vi.fn(),
}));

vi.mock("@/lib/project-access", () => ({
  requireProjectCapability: vi.fn(),
}));

vi.mock("@/lib/telegram-webapp-project-access", () => ({
  requireTelegramWebAppProjectCapability: vi.fn(),
}));

vi.mock("@/lib/platform-access", () => ({
  resolvePlatformAccess: vi.fn(),
}));

import { setProjectRuntimeSystemInternal } from "@/app/actions/project-settings";
import { requireProjectCapability } from "@/lib/project-access";
import { requireTelegramWebAppProjectCapability } from "@/lib/telegram-webapp-project-access";
import { resolvePlatformAccess } from "@/lib/platform-access";

function context(id = "project-1") {
  return { params: Promise.resolve({ id }) };
}

function request(body: unknown, url = "http://localhost/api/projects/project-1/runtime-system") {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function runtimeBody(overrides: Record<string, unknown> = {}) {
  return {
    agent: "codex",
    agentImpl: "ralph",
    model: "gpt-5.5",
    toolId: "tool-codex",
    providerBillingMode: "platform_credentials",
    codexAuthMode: "subscription",
    ...overrides,
  };
}

describe("POST /api/projects/:id/runtime-system", () => {
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
    vi.mocked(resolvePlatformAccess).mockResolvedValue({
      hasCapability: (capability: string) => capability === "platform.runtime.manage",
    } as any);
    vi.mocked(setProjectRuntimeSystemInternal).mockResolvedValue({
      success: true,
      projectId: "project-1",
      agent: "codex",
      agentImpl: "ralph",
      model: "gpt-5.5",
      modelId: "gpt-55",
      toolId: "tool-codex",
      agentLoopVersionId: "ralph-v2",
      claudeAuthMode: null,
      codexAuthMode: "subscription",
      providerBillingMode: "platform_credentials",
    } as any);
  });

  it("lets an Arena runtime manager switch runtime system through the shared mutation", async () => {
    const res = await POST(request(runtimeBody()), context());

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      ok: true,
      projectId: "project-1",
      agent: "codex",
      agentImpl: "ralph",
      model: "gpt-5.5",
      modelId: "gpt-55",
      toolId: "tool-codex",
      agentLoopVersionId: "ralph-v2",
      claudeAuthMode: null,
      codexAuthMode: "subscription",
      providerBillingMode: "platform_credentials",
    });
    expect(requireProjectCapability).toHaveBeenCalledWith("project-1", "project.runtime.manage");
    expect(setProjectRuntimeSystemInternal).toHaveBeenCalledWith("project-1", runtimeBody(), expect.anything());
  });

  it("accepts Telegram WebApp project runtime managers", async () => {
    const req = request(runtimeBody({ providerBillingMode: "byok", codexAuthMode: "api_key" }), "http://localhost/api/projects/project-1/runtime-system?surface=telegram");
    const res = await POST(req, context());

    expect(res.status).toBe(200);
    expect(requireTelegramWebAppProjectCapability).toHaveBeenCalledWith(
      req,
      "project-1",
      "project.runtime.manage",
    );
  });

  it("blocks platform credentials without platform runtime access", async () => {
    vi.mocked(resolvePlatformAccess).mockResolvedValue({
      hasCapability: () => false,
    } as any);

    const res = await POST(request(runtimeBody()), context());

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({
      error: "Platform provider credentials require platform runtime access.",
    });
    expect(setProjectRuntimeSystemInternal).not.toHaveBeenCalled();
  });

  it("rejects invalid payloads before mutation", async () => {
    const res = await POST(request(runtimeBody({ agent: "" })), context());

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: "Invalid request" });
    expect(setProjectRuntimeSystemInternal).not.toHaveBeenCalled();
  });

  it("surfaces catalog/action validation errors without lifecycle fallback", async () => {
    vi.mocked(setProjectRuntimeSystemInternal).mockResolvedValue({
      success: false,
      error: "Selected model is not available for this tool and loop.",
    } as any);

    const res = await POST(request(runtimeBody({ model: "fake-model" })), context());

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({
      error: "Selected model is not available for this tool and loop.",
    });
  });
});
