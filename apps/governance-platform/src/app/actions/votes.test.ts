import { describe, it, expect, vi, beforeEach } from "vitest";
import { toggleVote, getVoteStatus } from "./votes";
import { userError } from "@/lib/errors";

// Mock dependencies
vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
    },
    proposal: {
      findUnique: vi.fn(),
    },
    vote: {
      findUnique: vi.fn(),
      create: vi.fn(),
      delete: vi.fn(),
      count: vi.fn(),
    },
  },
}));

// Import mocked modules
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

describe("toggleVote", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ id: "user-1" } as never);
    // Default: proposal exists with no deployed projects
    vi.mocked((prisma as any).proposal.findUnique).mockResolvedValue({
      id: "proposal-1",
      projects: [],
    } as never);
  });

  it("should return error if user is not authenticated", async () => {
    vi.mocked(auth as any).mockResolvedValue(null);

    const result = await toggleVote("proposal-1");

    expect(result.success).toBe(false);
    expect(result.error).toBe(userError("E-AUTH-001"));
  });

  it("should create vote if user has not voted yet", async () => {
    vi.mocked(auth as any).mockResolvedValue({
      user: { id: "user-1", email: "test@example.com", role: "USER" },
      expires: new Date().toISOString(),
    });

    // No existing vote
    vi.mocked(prisma.vote.findUnique).mockResolvedValue(null);

    // Mock vote creation
    vi.mocked(prisma.vote.create).mockResolvedValue({
      id: "vote-1",
      userId: "user-1",
      proposalId: "proposal-1",
    });

    // Mock vote count
    vi.mocked(prisma.vote.count).mockResolvedValue(1);

    const result = await toggleVote("proposal-1");

    expect(result.success).toBe(true);
    expect(result.hasVoted).toBe(true);
    expect(result.voteCount).toBe(1);
    expect(prisma.vote.create).toHaveBeenCalledWith({
      data: {
        userId: "user-1",
        proposalId: "proposal-1",
      },
    });
  });

  it("should return error if proposal is not found", async () => {
    vi.mocked(auth as any).mockResolvedValue({
      user: { id: "user-1", email: "test@example.com", role: "USER" },
      expires: new Date().toISOString(),
    });

    vi.mocked((prisma as any).proposal.findUnique).mockResolvedValue(null);

    const result = await toggleVote("proposal-1");

    expect(result.success).toBe(false);
    expect(result.error).toBe(userError("E-VOTE-001"));
  });

  it("should return error if voting is closed for live proposals", async () => {
    vi.mocked(auth as any).mockResolvedValue({
      user: { id: "user-1", email: "test@example.com", role: "USER" },
      expires: new Date().toISOString(),
    });

    // Proposal has a deployed project
    vi.mocked((prisma as any).proposal.findUnique).mockResolvedValue({
      id: "proposal-1",
      projects: [{ id: "proj-1" }],
    } as never);

    const result = await toggleVote("proposal-1");

    expect(result.success).toBe(false);
    expect(result.error).toBe(userError("E-VOTE-002"));
    expect(prisma.vote.findUnique).not.toHaveBeenCalled();
  });

  it("should delete vote if user has already voted", async () => {
    vi.mocked(auth as any).mockResolvedValue({
      user: { id: "user-1", email: "test@example.com", role: "USER" },
      expires: new Date().toISOString(),
    });

    // Existing vote
    const existingVote = {
      id: "vote-1",
      userId: "user-1",
      proposalId: "proposal-1",
    };
    vi.mocked(prisma.vote.findUnique).mockResolvedValue(existingVote);

    // Mock vote deletion
    vi.mocked(prisma.vote.delete).mockResolvedValue(existingVote);

    // Mock vote count (after deletion)
    vi.mocked(prisma.vote.count).mockResolvedValue(0);

    const result = await toggleVote("proposal-1");

    expect(result.success).toBe(true);
    expect(result.hasVoted).toBe(false);
    expect(result.voteCount).toBe(0);
    expect(prisma.vote.delete).toHaveBeenCalledWith({
      where: {
        id: "vote-1",
      },
    });
  });

  it("should handle database errors gracefully", async () => {
    vi.mocked(auth as any).mockResolvedValue({
      user: { id: "user-1", email: "test@example.com", role: "USER" },
      expires: new Date().toISOString(),
    });

    vi.mocked(prisma.vote.findUnique).mockRejectedValue(
      new Error("Database error")
    );

    const result = await toggleVote("proposal-1");

    expect(result.success).toBe(false);
    expect(result.error).toBe(userError("E-VOTE-005"));
  });

  it("should enforce unique constraint for userId and proposalId", async () => {
    vi.mocked(auth as any).mockResolvedValue({
      user: { id: "user-1", email: "test@example.com", role: "USER" },
      expires: new Date().toISOString(),
    });

    // No existing vote
    vi.mocked(prisma.vote.findUnique).mockResolvedValue(null);

    // Mock unique constraint error
    const uniqueError = new Error("Unique constraint failed");
    vi.mocked(prisma.vote.create).mockRejectedValue(uniqueError);

    const result = await toggleVote("proposal-1");

    expect(result.success).toBe(false);
    expect(result.error).toBe(userError("E-VOTE-005"));
  });
});

describe("getVoteStatus", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return vote status for authenticated user who has voted", async () => {
    vi.mocked(auth as any).mockResolvedValue({
      user: { id: "user-1", email: "test@example.com", role: "USER" },
      expires: new Date().toISOString(),
    });

    // User has voted
    vi.mocked(prisma.vote.findUnique).mockResolvedValue({
      id: "vote-1",
      userId: "user-1",
      proposalId: "proposal-1",
    });

    // Mock vote count
    vi.mocked(prisma.vote.count).mockResolvedValue(5);

    const result = await getVoteStatus("proposal-1");

    expect(result).toEqual({
      hasVoted: true,
      voteCount: 5,
    });
  });

  it("should return vote status for authenticated user who has not voted", async () => {
    vi.mocked(auth as any).mockResolvedValue({
      user: { id: "user-1", email: "test@example.com", role: "USER" },
      expires: new Date().toISOString(),
    });

    // User has not voted
    vi.mocked(prisma.vote.findUnique).mockResolvedValue(null);

    // Mock vote count
    vi.mocked(prisma.vote.count).mockResolvedValue(5);

    const result = await getVoteStatus("proposal-1");

    expect(result).toEqual({
      hasVoted: false,
      voteCount: 5,
    });
  });

  it("should return vote status for unauthenticated user", async () => {
    vi.mocked(auth as any).mockResolvedValue(null);

    // Mock vote count
    vi.mocked(prisma.vote.count).mockResolvedValue(3);

    const result = await getVoteStatus("proposal-1");

    expect(result).toEqual({
      hasVoted: false,
      voteCount: 3,
    });
  });

  it("should handle database errors gracefully", async () => {
    vi.mocked(auth as any).mockResolvedValue({
      user: { id: "user-1", email: "test@example.com", role: "USER" },
      expires: new Date().toISOString(),
    });

    vi.mocked(prisma.vote.count).mockRejectedValue(
      new Error("Database error")
    );

    const result = await getVoteStatus("proposal-1");

    expect(result).toBeNull();
  });
});
