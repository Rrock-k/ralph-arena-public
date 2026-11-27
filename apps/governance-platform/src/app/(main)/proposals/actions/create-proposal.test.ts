import { describe, it, expect, vi, beforeEach } from "vitest";
import { createProposal } from "./create-proposal";
import type { CreateProposalInput } from "./create-proposal";
import { fakeProposal } from "@/test/factories";

// Mock dependencies
vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    proposal: {
      create: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
    },
    season: {
      findMany: vi.fn(),
    },
  },
}));

// Import mocked modules
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

describe("createProposal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: user exists in DB
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ id: "user-1" } as any);
    vi.mocked(prisma.season.findMany).mockResolvedValue([] as any);
  });

  it("should return error if user is not authenticated", async () => {
    vi.mocked(auth as any).mockResolvedValue(null);

    const input: CreateProposalInput = {
      title: "Test Proposal",
      description: "Test Description",
      spec: "Test Spec",
    };

    const result = await createProposal(input);

    expect(result.success).toBe(false);
    expect(result.error).toBe("You must be signed in to create a proposal");
  });

  it("should return error if title is empty", async () => {
    vi.mocked(auth as any).mockResolvedValue({
      user: { id: "user-1", email: "test@example.com", role: "USER" },
      expires: new Date().toISOString(),
    });

    const input: CreateProposalInput = {
      title: "",
      description: "Test Description",
      spec: "Test Spec",
    };

    const result = await createProposal(input);

    expect(result.success).toBe(false);
    expect(result.error).toBe("Title is required");
  });

  it("should return error if description is empty", async () => {
    vi.mocked(auth as any).mockResolvedValue({
      user: { id: "user-1", email: "test@example.com", role: "USER" },
      expires: new Date().toISOString(),
    });

    const input: CreateProposalInput = {
      title: "Test Title",
      description: "",
      spec: "Test Spec",
    };

    const result = await createProposal(input);

    expect(result.success).toBe(false);
    expect(result.error).toBe("Description is required");
  });

  it("should return error if spec is empty", async () => {
    vi.mocked(auth as any).mockResolvedValue({
      user: { id: "user-1", email: "test@example.com", role: "USER" },
      expires: new Date().toISOString(),
    });

    const input: CreateProposalInput = {
      title: "Test Title",
      description: "Test Description",
      spec: "",
    };

    const result = await createProposal(input);

    expect(result.success).toBe(false);
    expect(result.error).toBe("Spec is required");
  });

  it("should create proposal successfully with valid input", async () => {
    vi.mocked(auth as any).mockResolvedValue({
      user: { id: "user-1", email: "test@example.com", role: "USER" },
      expires: new Date().toISOString(),
    });

    vi.mocked(prisma.proposal.create).mockResolvedValue(
      fakeProposal({ id: "proposal-1" }),
    );

    const input: CreateProposalInput = {
      title: "Test Proposal",
      description: "Test Description",
      spec: "Test Spec",
    };

    const result = await createProposal(input);

    expect(result.success).toBe(true);
    expect(result.proposalId).toBe("proposal-1");
    expect(prisma.proposal.create).toHaveBeenCalledWith({
      data: {
        title: "Test Proposal",
        description: "Test Description",
        spec: "Test Spec",
        status: "PROPOSED",
        createdById: "user-1",
        seasonId: null,
      },
    });
  });

  it("should trim whitespace from input fields", async () => {
    vi.mocked(auth as any).mockResolvedValue({
      user: { id: "user-1", email: "test@example.com", role: "USER" },
      expires: new Date().toISOString(),
    });

    vi.mocked(prisma.proposal.create).mockResolvedValue(
      fakeProposal({ id: "proposal-1" }),
    );

    const input: CreateProposalInput = {
      title: "  Test Proposal  ",
      description: "  Test Description  ",
      spec: "  Test Spec  ",
    };

    const result = await createProposal(input);

    expect(result.success).toBe(true);
    expect(prisma.proposal.create).toHaveBeenCalledWith({
      data: {
        title: "Test Proposal",
        description: "Test Description",
        spec: "Test Spec",
        status: "PROPOSED",
        createdById: "user-1",
        seasonId: null,
      },
    });
  });

  it("should handle database errors gracefully", async () => {
    vi.mocked(auth as any).mockResolvedValue({
      user: { id: "user-1", email: "test@example.com", role: "USER" },
      expires: new Date().toISOString(),
    });

    vi.mocked(prisma.proposal.create).mockRejectedValue(
      new Error("Database error")
    );

    const input: CreateProposalInput = {
      title: "Test Proposal",
      description: "Test Description",
      spec: "Test Spec",
    };

    const result = await createProposal(input);

    expect(result.success).toBe(false);
    expect(result.error).toBe("Failed to create proposal. Please try again.");
  });
});
