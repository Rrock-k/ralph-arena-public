import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

import { launchProposal } from "./launch";
import { fakeProposal } from "@/test/factories";

// Mock dependencies
vi.mock("@/lib/prisma", () => ({
  prisma: {
    proposal: {
      findUnique: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/launch-utils", () => ({
  createProjectFromProposal: vi.fn().mockResolvedValue({
    project: { id: "project-1", proposalId: "proposal-123", status: "PROVISIONING" },
  }),
}));

vi.mock("@/lib/control-plane", () => ({
  resolveLoopAndTool: vi.fn().mockResolvedValue({
    toolId: "tool-1",
    agentLoopVersionId: "loop-version-1",
  }),
}));

vi.mock("@/lib/e2e-auth-bypass", () => ({
  hasE2EAdminBypass: vi.fn().mockResolvedValue(false),
}));

vi.mock("@/lib/progress-bus", () => ({
  progressBus: { notifyChanged: vi.fn() },
}));

vi.mock("@/lib/log-writer", () => ({
  appendLifecycle: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/platform-access", () => ({
  requirePlatformCapability: vi.fn(),
}));

vi.mock("@/lib/user-launch-policy", () => ({
  enforceUserLaunchPolicy: vi.fn().mockResolvedValue({ allowed: true }),
  normalizeProviderBillingMode: vi.fn((value: string | null | undefined) =>
    value === "platform_credits" || value === "platform_credentials" ? value : "byok",
  ),
  parseProviderBillingMode: vi.fn((value: string | null | undefined) =>
    value === "byok" || value === "platform_credits" || value === "platform_credentials" ? value : null,
  ),
  normalizeAuthModesForProviderBilling: vi.fn((agent: string, mode: string | null | undefined, modes: any) => {
    if (mode === "platform_credits") return { claudeAuthMode: null, codexAuthMode: null };
    if (mode === "byok" && agent === "codex") return { claudeAuthMode: null, codexAuthMode: "api_key" };
    if (mode === "byok" && agent === "claude-code") return { claudeAuthMode: "api_key", codexAuthMode: null };
    return {
      claudeAuthMode: modes.claudeAuthMode ?? null,
      codexAuthMode: modes.codexAuthMode ?? null,
    };
  }),
}));

// Import mocked modules
import { prisma } from "@/lib/prisma";
import { requirePlatformCapability } from "@/lib/platform-access";
import { enforceUserLaunchPolicy } from "@/lib/user-launch-policy";

describe("launchProposal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requirePlatformCapability).mockResolvedValue({
      authorized: true,
      error: null,
      session: { user: { id: "admin-1" } },
    } as any);
  });

  it("should return error if user is not authenticated", async () => {
    vi.mocked(requirePlatformCapability).mockResolvedValue({
      authorized: false,
      error: "Unauthorized",
    } as any);

    const result = await launchProposal("proposal-1", { providerBillingMode: "byok" });

    expect(result.success).toBe(false);
    expect(result.error).toBe("Unauthorized");
  });

  it("should return error if user is not an admin", async () => {
    vi.mocked(requirePlatformCapability).mockResolvedValue({
      authorized: false,
      error: "Admin access required",
    } as any);

    const result = await launchProposal("proposal-1", { providerBillingMode: "byok" });

    expect(result.success).toBe(false);
    expect(result.error).toBe("Admin access required");
  });

  it("should return error if proposal is not found", async () => {
    vi.mocked(prisma.proposal.findUnique as any).mockResolvedValue(null);

    const result = await launchProposal("non-existent-proposal");

    expect(result.success).toBe(false);
    expect(result.error).toBe("Proposal not found");
  });

  it("should return error if proposal is not in a launchable status", async () => {
    vi.mocked(prisma.proposal.findUnique as any).mockResolvedValue(
      fakeProposal({ status: "REJECTED" }),
    );

    const result = await launchProposal("proposal-1", { providerBillingMode: "byok" });

    expect(result.success).toBe(false);
    expect(result.error).toContain("Cannot launch proposal with status");
  });

  it("should successfully launch a PROPOSED proposal via transaction", async () => {
    vi.mocked(prisma.proposal.findUnique as any).mockResolvedValue(
      fakeProposal({ id: "proposal-123", status: "PROPOSED" }),
    );

    vi.mocked(prisma.$transaction).mockImplementation(async (cb: any) => cb({}));

    const result = await launchProposal("proposal-123", { providerBillingMode: "byok" });

    expect(result.success).toBe(true);
    expect("projectId" in result && result.projectId).toBe("project-1");
    expect(prisma.$transaction).toHaveBeenCalledOnce();
  });

  it("should handle launch errors gracefully", async () => {
    vi.mocked(prisma.proposal.findUnique as any).mockRejectedValue(
      new Error("Database error"),
    );

    const result = await launchProposal("proposal-1", { providerBillingMode: "byok" });

    expect(result.success).toBe(false);
    expect(result.error).toBe("Failed to launch proposal");
  });

  it("should handle transaction failure gracefully", async () => {
    vi.mocked(prisma.proposal.findUnique as any).mockResolvedValue(
      fakeProposal({ status: "PROPOSED" }),
    );

    vi.mocked(prisma.$transaction).mockRejectedValueOnce(
      new Error("Transaction failed"),
    );

    const result = await launchProposal("proposal-1", { providerBillingMode: "byok" });

    expect(result.success).toBe(false);
    expect(result.error).toBe("Failed to launch proposal");
  });

  it("should reject launch when initial budget is too low", async () => {
    const { createProjectFromProposal } = await import("@/lib/launch-utils");
    vi.mocked(createProjectFromProposal).mockRejectedValueOnce(
      new Error("Initial budget must be greater than $0.10"),
    );

    vi.mocked(prisma.proposal.findUnique as any).mockResolvedValue(
      fakeProposal({ status: "PROPOSED" }),
    );

    vi.mocked(prisma.$transaction).mockImplementation(async (cb: any) => cb({}));

    const result = await launchProposal("proposal-1", { initialBudgetUsd: 0.1, providerBillingMode: "byok" });

    expect(result.success).toBe(false);
    expect(result.error).toBe("Failed to launch proposal");
  });

  it("should reject invalid claudeAuthMode", async () => {
    vi.mocked(prisma.proposal.findUnique as any).mockResolvedValue(
      fakeProposal({ status: "PROPOSED" }),
    );

    const result = await launchProposal("proposal-1", { claudeAuthMode: "auto" as any });

    expect(result.success).toBe(false);
    expect(result.error).toBe("Invalid claudeAuthMode: auto");
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("should reject invalid codexAuthMode", async () => {
    vi.mocked(prisma.proposal.findUnique as any).mockResolvedValue(
      fakeProposal({ status: "PROPOSED" }),
    );

    const result = await launchProposal("proposal-1", { codexAuthMode: "oauth" as any });

    expect(result.success).toBe(false);
    expect(result.error).toBe("Invalid codexAuthMode: oauth");
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("requires explicit provider billing mode for proposal launches", async () => {
    vi.mocked(prisma.proposal.findUnique as any).mockResolvedValue(
      fakeProposal({ status: "PROPOSED" }),
    );

    const result = await launchProposal("proposal-1");

    expect(result.success).toBe(false);
    expect(result.error).toBe("providerBillingMode is required");
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("rejects unsupported provider billing modes instead of falling back to BYOK", async () => {
    vi.mocked(prisma.proposal.findUnique as any).mockResolvedValue(
      fakeProposal({ status: "PROPOSED" }),
    );

    const result = await launchProposal("proposal-1", {
      providerBillingMode: "platform-creditz",
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe("Invalid providerBillingMode: platform-creditz");
    expect(enforceUserLaunchPolicy).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("should pass repoUrl and repoBranch to createProjectFromProposal", async () => {
    const { createProjectFromProposal } = await import("@/lib/launch-utils");

    vi.mocked(prisma.proposal.findUnique as any).mockResolvedValue(
      fakeProposal({ status: "PROPOSED" }),
    );

    vi.mocked(prisma.$transaction).mockImplementation(async (cb: any) => cb({}));

    await launchProposal("proposal-1", {
      providerBillingMode: "byok",
      repoUrl: "https://github.com/user/repo",
      repoBranch: "develop",
    });

    expect(createProjectFromProposal).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({
        repoUrl: "https://github.com/user/repo",
        repoBranch: "develop",
      }),
      expect.anything(),
    );
  });

  it("blocks BYOK proposal launch when owner has no provider key", async () => {
    vi.mocked(enforceUserLaunchPolicy).mockResolvedValueOnce({
      allowed: false,
      error: "OpenAI API key is required in Settings before launch.",
    });
    vi.mocked(prisma.proposal.findUnique as any).mockResolvedValue(
      fakeProposal({ status: "PROPOSED", createdById: "user-2" }),
    );

    const result = await launchProposal("proposal-1", {
      agent: "codex",
      codexAuthMode: "api_key",
      providerBillingMode: "byok",
    });

    expect(result).toEqual({
      success: false,
      error: "OpenAI API key is required in Settings before launch.",
    });
    expect(enforceUserLaunchPolicy).toHaveBeenCalledWith(expect.objectContaining({
      userId: "admin-1",
      privileged: true,
      agent: "codex",
      providerBillingMode: "byok",
    }));
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("uses explicit Platform Credentials for subscription proposal launch", async () => {
    const { createProjectFromProposal } = await import("@/lib/launch-utils");

    vi.mocked(prisma.proposal.findUnique as any).mockResolvedValue(
      fakeProposal({ status: "PROPOSED" }),
    );
    vi.mocked(prisma.$transaction).mockImplementation(async (cb: any) => cb({}));

    await launchProposal("proposal-1", {
      agent: "codex",
      codexAuthMode: "subscription",
      providerBillingMode: "platform_credentials",
    });

    expect(createProjectFromProposal).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({
        providerBillingMode: "platform_credentials",
        codexAuthMode: "subscription",
      }),
      expect.anything(),
    );
  });

  it("should pass vpsServerType when runnerBackend is vps", async () => {
    const { createProjectFromProposal } = await import("@/lib/launch-utils");

    vi.mocked(prisma.proposal.findUnique as any).mockResolvedValue(
      fakeProposal({ status: "PROPOSED" }),
    );

    vi.mocked(prisma.$transaction).mockImplementation(async (cb: any) => cb({}));

    await launchProposal("proposal-1", {
      runnerBackend: "vps",
      vpsServerType: "cpx31",
      providerBillingMode: "byok",
    });

    expect(createProjectFromProposal).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({
        runnerBackend: "vps",
        vpsServerType: "cpx31",
      }),
      expect.anything(),
    );
  });

  it("should pass null vpsServerType when not provided", async () => {
    const { createProjectFromProposal } = await import("@/lib/launch-utils");

    vi.mocked(prisma.proposal.findUnique as any).mockResolvedValue(
      fakeProposal({ status: "PROPOSED" }),
    );

    vi.mocked(prisma.$transaction).mockImplementation(async (cb: any) => cb({}));

    await launchProposal("proposal-1", { runnerBackend: "local", providerBillingMode: "byok" });

    expect(createProjectFromProposal).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({
        runnerBackend: "local",
        vpsServerType: null,
      }),
      expect.anything(),
    );
  });

  it("should reject invalid vpsServerType", async () => {
    vi.mocked(prisma.proposal.findUnique as any).mockResolvedValue(
      fakeProposal({ status: "PROPOSED" }),
    );

    const result = await launchProposal("proposal-1", { vpsServerType: "invalid-type", providerBillingMode: "byok" });

    expect(result.success).toBe(false);
    expect(result.error).toBe("Invalid vpsServerType: invalid-type");
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
