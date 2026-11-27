import { beforeEach, describe, expect, it, vi } from "vitest";
import { requireProjectRuntimeActionAccess } from "./runtime-action-access";

vi.mock("@/lib/platform-access", () => ({
  requirePlatformCapability: vi.fn(),
  resolvePlatformAccess: vi.fn(),
}));

vi.mock("@/lib/project-access", () => ({
  requireProjectCapability: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    project: {
      findUnique: vi.fn(),
    },
  },
}));

vi.mock("@/lib/user-launch-policy", () => ({
  enforceUserLaunchPolicy: vi.fn(),
}));

vi.mock("@/lib/project-budget", () => ({
  enforceRequiredProjectBudget: vi.fn(),
}));

import { requirePlatformCapability, resolvePlatformAccess } from "@/lib/platform-access";
import { requireProjectCapability } from "@/lib/project-access";
import { prisma } from "@/lib/prisma";
import { enforceUserLaunchPolicy } from "@/lib/user-launch-policy";
import { enforceRequiredProjectBudget } from "@/lib/project-budget";

describe("requireProjectRuntimeActionAccess", () => {
  const session = { user: { id: "user-1", email: "user@example.com", role: "USER" } };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requirePlatformCapability).mockResolvedValue({ authorized: false, error: "Platform denied" } as any);
    vi.mocked(requireProjectCapability).mockResolvedValue({
      authorized: true,
      session,
      hasBypass: false,
    } as any);
    vi.mocked(resolvePlatformAccess).mockResolvedValue({
      hasCapability: vi.fn(() => false),
    } as any);
    vi.mocked(prisma.project.findUnique).mockResolvedValue({
      runnerBackend: "local",
      ownerScopeType: "user",
      ownerScopeId: "user-1",
      agent: "codex",
      providerBillingMode: "byok",
      components: [{ vpsHostId: null }],
    } as any);
    vi.mocked(enforceUserLaunchPolicy).mockResolvedValue({ allowed: true } as any);
    vi.mocked(enforceRequiredProjectBudget).mockResolvedValue({ allowed: true } as any);
  });

  it("allows platform runtime managers without project policy checks", async () => {
    vi.mocked(requirePlatformCapability).mockResolvedValue({ authorized: true } as any);

    const result = await requireProjectRuntimeActionAccess("project-1");

    expect(result).toBeNull();
    expect(prisma.project.findUnique).not.toHaveBeenCalled();
    expect(enforceUserLaunchPolicy).not.toHaveBeenCalled();
  });

  it("rejects callers without project runtime access", async () => {
    vi.mocked(requireProjectCapability).mockResolvedValue({ authorized: false, error: "Project denied" } as any);

    const result = await requireProjectRuntimeActionAccess("project-1");

    expect(result).toEqual({ success: false, error: "Project denied" });
    expect(prisma.project.findUnique).not.toHaveBeenCalled();
  });

  it("rejects managed VPS runtime actions for non-platform callers", async () => {
    vi.mocked(prisma.project.findUnique).mockResolvedValue({
      runnerBackend: "vps",
      ownerScopeType: "user",
      ownerScopeId: "user-1",
      agent: "codex",
      providerBillingMode: "byok",
      components: [{ vpsHostId: "host-1" }],
    } as any);

    const result = await requireProjectRuntimeActionAccess("project-1");

    expect(result).toEqual({
      success: false,
      error: "Managed VPS runtime actions require platform runtime access.",
    });
    expect(enforceUserLaunchPolicy).not.toHaveBeenCalled();
  });

  it("applies normal user launch policy to user-owned projects", async () => {
    vi.mocked(enforceUserLaunchPolicy).mockResolvedValue({
      allowed: false,
      error: "OpenAI API key is required.",
    });

    const result = await requireProjectRuntimeActionAccess("project-1");

    expect(result).toEqual({ success: false, error: "OpenAI API key is required." });
    expect(enforceUserLaunchPolicy).toHaveBeenCalledWith(expect.objectContaining({
      userId: "user-1",
      privileged: false,
      agent: "codex",
      runnerBackend: "local",
      providerBillingMode: "byok",
    }));
  });

  it("blocks user-owned Platform Credits runtime actions when an enabled budget is exhausted", async () => {
    vi.mocked(prisma.project.findUnique).mockResolvedValue({
      runnerBackend: "local",
      ownerScopeType: "user",
      ownerScopeId: "user-1",
      agent: "codex",
      providerBillingMode: "platform_credits",
      components: [{ vpsHostId: null }],
    } as any);
    vi.mocked(enforceRequiredProjectBudget).mockResolvedValue({
      allowed: false,
      error: "Insufficient budget ($0.00 remaining)",
    });

    const result = await requireProjectRuntimeActionAccess("project-1");

    expect(result).toEqual({
      success: false,
      error: "Insufficient budget ($0.00 remaining)",
    });
    expect(enforceRequiredProjectBudget).toHaveBeenCalledWith("project-1");
  });
});
