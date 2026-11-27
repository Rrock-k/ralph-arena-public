import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/platform-access", () => ({
  requirePlatformCapability: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    agentLoop: {
      create: vi.fn(),
      update: vi.fn(),
    },
    agentLoopVersion: {
      create: vi.fn(),
      update: vi.fn(),
      count: vi.fn(),
      deleteMany: vi.fn(),
    },
    project: {
      count: vi.fn(),
    },
    tool: {
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      count: vi.fn(),
    },
  },
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/loop-compliance", () => ({
  runLoopCompliance: vi.fn(),
}));

import { prisma } from "@/lib/prisma";
import { requirePlatformCapability } from "@/lib/platform-access";
import { runLoopCompliance } from "@/lib/loop-compliance";
import { createAgentLoop, createAgentLoopVersion } from "./registry";

const adminAccess = {
  authorized: true,
  session: { user: { id: "admin-1" } },
  hasBypass: false,
  effectiveCapabilities: ["platform.registry.manage"],
  effectiveCapabilityEntries: [],
  sources: [],
  hasCapability: () => true,
  hasAnyCapability: () => true,
};

const compliancePass = {
  passed: true,
  checks: [
    {
      name: "result-json-exists",
      passed: true,
      message: "ok",
      severity: "error",
    },
  ],
  detectedCapabilities: ["preview"],
  runner: {
    command: "node loop.js",
    runnerRoot: "/repo/services/arena-runner",
    exitCode: 0,
    signal: null,
    timedOut: false,
    stdout: "{\"passed\":true}",
    stderr: "",
    parseError: null,
  },
};

const complianceFail = {
  passed: false,
  checks: [
    {
      name: "bootstrap-script-exists",
      passed: false,
      message: "arena-start.sh missing",
      severity: "error",
    },
  ],
  detectedCapabilities: [],
  runner: {
    command: "node loop.js",
    runnerRoot: "/repo/services/arena-runner",
    exitCode: 1,
    signal: null,
    timedOut: false,
    stdout: "{\"passed\":false}",
    stderr: "",
    parseError: null,
  },
};

describe("registry compliance gating", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requirePlatformCapability).mockResolvedValue(adminAccess as any);
    vi.mocked((prisma as any).agentLoop.create).mockResolvedValue({ id: "loop-1" });
    vi.mocked((prisma as any).agentLoopVersion.create).mockResolvedValue({ id: "version-1" });
    vi.mocked((prisma as any).agentLoopVersion.update).mockResolvedValue({ id: "version-1" });
    vi.mocked((prisma as any).agentLoop.update).mockResolvedValue({ id: "loop-1" });
  });

  it("persists verified compliance and promotes the version", async () => {
    vi.mocked(runLoopCompliance).mockResolvedValue(compliancePass as any);

    const result = await createAgentLoopVersion("loop-1", {
      version: "1.0.0",
      commandTemplate: "node loop.js --work-dir {workdir}",
      capabilities: ["preview"],
      supportTier: "supported",
      changelog: null,
      setAsCurrent: true,
    });

    expect(result.success).toBe(true);
    expect((prisma as any).agentLoopVersion.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        agentLoopId: "loop-1",
        version: "1.0.0",
        supportTier: "supported",
        complianceStatus: "pending",
      }),
    });
    expect((prisma as any).agentLoopVersion.update).toHaveBeenCalledWith({
      where: { id: "version-1" },
      data: expect.objectContaining({
        complianceStatus: "verified",
        complianceCheckedAt: expect.any(Date),
        complianceResult: expect.objectContaining({
          passed: true,
          status: "verified",
        }),
      }),
    });
    expect((prisma as any).agentLoop.update).toHaveBeenCalledWith({
      where: { id: "loop-1" },
      data: { currentVersionId: "version-1" },
    });
  });

  it("persists failed compliance and keeps the version off current", async () => {
    vi.mocked(runLoopCompliance).mockResolvedValue(complianceFail as any);

    const result = await createAgentLoopVersion("loop-1", {
      version: "1.0.1",
      commandTemplate: "node loop.js --work-dir {workdir}",
      capabilities: ["preview"],
      supportTier: "unsupported",
      changelog: null,
      setAsCurrent: true,
    });

    expect(result.success).toBe(true);
    expect(result.complianceStatus).toBe("failed");
    expect((prisma as any).agentLoop.update).not.toHaveBeenCalled();
    expect((prisma as any).agentLoopVersion.update).toHaveBeenCalledWith({
      where: { id: "version-1" },
      data: expect.objectContaining({
        complianceStatus: "failed",
        complianceResult: expect.objectContaining({
          passed: false,
          status: "failed",
        }),
      }),
    });
  });

  it("routes initial versions through compliance during loop creation", async () => {
    vi.mocked(runLoopCompliance).mockResolvedValue(compliancePass as any);

    const result = await createAgentLoop({
      name: "dummy",
      description: null,
      isActive: true,
      visibility: "public",
      sourceUrl: null,
      installCommand: null,
      initialVersion: {
        version: "1.0.0",
        commandTemplate: "node loop.js --work-dir {workdir}",
        capabilities: ["preview"],
        supportTier: "supported",
      },
    });

    expect(result.success).toBe(true);
    expect((prisma as any).agentLoopVersion.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        agentLoopId: "loop-1",
        supportTier: "supported",
        complianceStatus: "pending",
      }),
    });
    expect((prisma as any).agentLoop.update).toHaveBeenCalledWith({
      where: { id: "loop-1" },
      data: { currentVersionId: "version-1" },
    });
  });
});
