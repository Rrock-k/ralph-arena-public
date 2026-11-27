import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

vi.mock("server-only", () => ({}));

const { hasPlatformCapability } = vi.hoisted(() => ({
  hasPlatformCapability: vi.fn(() => false),
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

vi.mock("@/lib/feature-flags", () => ({
  isByokProviderKeysEnabled: vi.fn(),
  isManagedProviderCreditsEnabled: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    project: { findUnique: vi.fn() },
    tool: { findMany: vi.fn() },
    agentLoop: { findMany: vi.fn() },
    userCreditBalance: { findUnique: vi.fn() },
  },
}));

import {
  isByokProviderKeysEnabled,
  isManagedProviderCreditsEnabled,
} from "@/lib/feature-flags";
import { resolvePlatformAccess } from "@/lib/platform-access";
import { prisma } from "@/lib/prisma";
import { requireProjectCapability } from "@/lib/project-access";
import { requireTelegramWebAppProjectCapability } from "@/lib/telegram-webapp-project-access";

function context(id = "project-1") {
  return { params: Promise.resolve({ id }) };
}

function projectConfig(overrides: Record<string, unknown> = {}) {
  return {
    id: "project-1",
    agent: "codex",
    agentImpl: "direct",
    model: "gpt-5.5",
    claudeAuthMode: null,
    codexAuthMode: "api_key",
    runnerBackend: "local",
    providerBillingMode: "byok",
    tgSpecLastImportedVersion: null,
    components: [{
      sourceConfig: {
        recipe: "tg_spec_target",
        launchConfiguration: "tg_spec_launch_configuration_required",
      },
    }],
    ...overrides,
  };
}

describe("GET /api/projects/:id/launch/options", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hasPlatformCapability.mockReturnValue(false);
    vi.mocked(requireProjectCapability).mockResolvedValue({
      authorized: true,
      session: { user: { id: "actor-1" } },
      hasBypass: false,
      isOwner: true,
      isAdmin: false,
    } as any);
    vi.mocked(requireTelegramWebAppProjectCapability).mockResolvedValue({
      authorized: true,
      session: { user: { id: "telegram-actor-1" } },
      hasBypass: false,
      isOwner: true,
      isAdmin: false,
    } as any);
    vi.mocked(resolvePlatformAccess).mockResolvedValue({ hasCapability: hasPlatformCapability } as any);
    vi.mocked(isByokProviderKeysEnabled).mockResolvedValue(true);
    vi.mocked(isManagedProviderCreditsEnabled).mockResolvedValue(true);
    vi.mocked(prisma.project.findUnique as any).mockResolvedValue(projectConfig());
    vi.mocked(prisma.tool.findMany as any).mockResolvedValue([{ id: "tool-codex", name: "codex", isActive: true }]);
    vi.mocked(prisma.agentLoop.findMany as any).mockResolvedValue([{ id: "loop-direct", name: "direct", isActive: true }]);
    vi.mocked(prisma.userCreditBalance.findUnique as any).mockResolvedValue({ credits: 7.5 });
  });

  it("returns no-store Arena-owned launch setup options", async () => {
    const response = await GET(
      new Request("http://localhost/api/projects/project-1/launch/options"),
      context(),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(requireProjectCapability).toHaveBeenCalledWith("project-1", "project.runtime.manage");
    expect(body).toMatchObject({
      projectId: "project-1",
      hasAcceptedSpec: false,
      launchConfigurationState: "required",
      current: {
        agent: "codex",
        agentImpl: "direct",
        model: "gpt-5.5",
        providerBillingMode: "byok",
        addonIds: [],
      },
      addons: [
        expect.objectContaining({
          id: "telegram_mini_app",
          label: "Telegram Mini App",
        }),
        expect.objectContaining({
          id: "mac_electron_app",
          label: "Mac Electron App",
        }),
      ],
      policy: {
        allowPlatformCredentials: false,
        allowManagedVps: false,
        userProviderCredentialsEnabled: true,
        managedProviderCreditsEnabled: true,
        userCreditBalance: 7.5,
      },
    });
  });

  it("returns selected add-ons from launch source config", async () => {
    vi.mocked(prisma.project.findUnique as any).mockResolvedValue(projectConfig({
      components: [{
        sourceConfig: {
          recipe: "tg_spec_target",
          launchConfiguration: "tg_spec_launch_configuration_required",
          addonIds: ["telegram_mini_app"],
        },
      }],
    }));

    const response = await GET(
      new Request("http://localhost/api/projects/project-1/launch/options"),
      context(),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.current.addonIds).toEqual(["telegram_mini_app"]);
  });

  it("uses Telegram WebApp access for Telegram surface options", async () => {
    const request = new Request("http://localhost/api/projects/project-1/launch/options?surface=telegram", {
      headers: { "x-telegram-webapp-init-data": "auth_date=1&signature=sig" },
    });

    const response = await GET(request, context());

    expect(response.status).toBe(200);
    expect(requireTelegramWebAppProjectCapability).toHaveBeenCalledWith(
      request,
      "project-1",
      "project.runtime.manage",
    );
    expect(resolvePlatformAccess).toHaveBeenCalledWith(
      { user: { id: "telegram-actor-1" } },
      false,
    );
  });

  it("rejects unknown option surfaces", async () => {
    const response = await GET(
      new Request("http://localhost/api/projects/project-1/launch/options?surface=chat"),
      context(),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Unsupported interaction surface" });
    expect(prisma.project.findUnique).not.toHaveBeenCalled();
  });
});
