import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

import { renameProposal, deleteProposal, purgeProposalInternal } from "./proposal-manage";
import { INTERNAL_ACTION_TOKEN } from "@/lib/internal-action-token";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    proposal: {
      update: vi.fn(),
      delete: vi.fn(),
    },
  },
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/progress-bus", () => ({
  progressBus: { notifyChanged: vi.fn() },
}));

vi.mock("@/lib/platform-access", () => ({
  requirePlatformCapability: vi.fn(),
}));

import { prisma } from "@/lib/prisma";
import { requirePlatformCapability } from "@/lib/platform-access";
import { revalidatePath } from "next/cache";

const adminSession = {
  user: { id: "admin-1", email: "admin@example.com", role: "ADMIN" },
  expires: new Date().toISOString(),
};

describe("renameProposal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requirePlatformCapability).mockResolvedValue({
      authorized: true,
      session: adminSession,
    } as any);
  });

  it("should return error if not authenticated", async () => {
    vi.mocked(requirePlatformCapability).mockResolvedValue({
      authorized: false,
      error: "Unauthorized",
    } as any);

    const result = await renameProposal("proposal-1", "New Title");

    expect(result.success).toBe(false);
    expect(result.error).toBe("Unauthorized");
    expect(prisma.proposal.update).not.toHaveBeenCalled();
  });

  it("should return error if not admin", async () => {
    vi.mocked(requirePlatformCapability).mockResolvedValue({
      authorized: false,
      error: "Platform access denied",
    } as any);

    const result = await renameProposal("proposal-1", "New Title");

    expect(result.success).toBe(false);
    expect(result.error).toBe("Platform access denied");
    expect(prisma.proposal.update).not.toHaveBeenCalled();
  });

  it("should return error if title is empty", async () => {
    const result = await renameProposal("proposal-1", "   ");

    expect(result.success).toBe(false);
    expect(result.error).toBe("Title cannot be empty");
    expect(prisma.proposal.update).not.toHaveBeenCalled();
  });

  it("should return error if title exceeds 200 characters", async () => {
    const result = await renameProposal("proposal-1", "a".repeat(201));

    expect(result.success).toBe(false);
    expect(result.error).toBe("Title must be 200 characters or fewer");
    expect(prisma.proposal.update).not.toHaveBeenCalled();
  });

  it("should rename proposal successfully", async () => {
    vi.mocked(prisma.proposal.update).mockResolvedValue({} as any);

    const result = await renameProposal("proposal-1", "  New Title  ");

    expect(result.success).toBe(true);
    expect(prisma.proposal.update).toHaveBeenCalledWith({
      where: { id: "proposal-1" },
      data: { title: "New Title" },
    });
    expect(revalidatePath).toHaveBeenCalledWith("/");
    expect(revalidatePath).toHaveBeenCalledWith("/admin");
    expect(revalidatePath).toHaveBeenCalledWith("/proposals/proposal-1");
  });

  it("should handle database error gracefully", async () => {
    vi.mocked(prisma.proposal.update).mockRejectedValue(new Error("DB error"));

    const result = await renameProposal("proposal-1", "New Title");

    expect(result.success).toBe(false);
    expect(result.error).toBe("Failed to rename proposal");
  });
});

describe("deleteProposal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requirePlatformCapability).mockResolvedValue({
      authorized: true,
      session: adminSession,
    } as any);
  });

  it("should return error if not authenticated", async () => {
    vi.mocked(requirePlatformCapability).mockResolvedValue({
      authorized: false,
      error: "Unauthorized",
    } as any);

    const result = await deleteProposal("proposal-1");

    expect(result.success).toBe(false);
    expect(result.error).toBe("Unauthorized");
    expect(prisma.proposal.update).not.toHaveBeenCalled();
  });

  it("should return error if not admin", async () => {
    vi.mocked(requirePlatformCapability).mockResolvedValue({
      authorized: false,
      error: "Platform access denied",
    } as any);

    const result = await deleteProposal("proposal-1");

    expect(result.success).toBe(false);
    expect(result.error).toBe("Platform access denied");
    expect(prisma.proposal.update).not.toHaveBeenCalled();
  });

  it("should archive proposal by setting archivedAt", async () => {
    vi.mocked(prisma.proposal.update).mockResolvedValue({} as any);

    const result = await deleteProposal("proposal-1");

    expect(result.success).toBe(true);
    expect(prisma.proposal.update).toHaveBeenCalledWith({
      where: { id: "proposal-1" },
      data: { archivedAt: expect.any(Date) },
    });
    expect(revalidatePath).toHaveBeenCalledWith("/");
    expect(revalidatePath).toHaveBeenCalledWith("/admin");
  });

  it("should handle database error gracefully", async () => {
    vi.mocked(prisma.proposal.update).mockRejectedValue(new Error("DB error"));

    const result = await deleteProposal("proposal-1");

    expect(result.success).toBe(false);
    expect(result.error).toBe("Failed to delete proposal");
  });
});

describe("purgeProposalInternal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should hard-delete proposal", async () => {
    vi.mocked(prisma.proposal.delete as any).mockResolvedValue({} as any);

    const result = await purgeProposalInternal("proposal-1", INTERNAL_ACTION_TOKEN);

    expect(result.success).toBe(true);
    expect(prisma.proposal.delete).toHaveBeenCalledWith({
      where: { id: "proposal-1" },
    });
    expect(revalidatePath).toHaveBeenCalledWith("/");
    expect(revalidatePath).toHaveBeenCalledWith("/admin");
    expect(revalidatePath).toHaveBeenCalledWith("/admin");
    expect(revalidatePath).toHaveBeenCalledWith("/proposals/proposal-1");
  });

  it("should handle database error gracefully", async () => {
    vi.mocked(prisma.proposal.delete as any).mockRejectedValue(new Error("DB error"));

    const result = await purgeProposalInternal("proposal-1", INTERNAL_ACTION_TOKEN);

    expect(result.success).toBe(false);
    expect(result.error).toBe("Failed to purge proposal");
  });
});
