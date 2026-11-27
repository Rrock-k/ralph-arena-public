import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    project: { findUnique: vi.fn() },
    proposal: { findUnique: vi.fn() },
    user: { findUnique: vi.fn() },
  },
}));

import { prisma } from "@/lib/prisma";
import { resolveRecipient } from "./recipients";

describe("resolveRecipient()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("project events", () => {
    it("resolves owner from Project.ownerScopeId", async () => {
      vi.mocked((prisma as any).project.findUnique).mockResolvedValue({
        ownerScopeId: "user-1",
        proposal: null,
      });
      vi.mocked((prisma as any).user.findUnique).mockResolvedValue({
        id: "user-1",
        email: "owner@example.com",
        emailVerified: new Date(),
      });

      const result = await resolveRecipient({
        type: "project.deployed",
        projectId: "proj-1",
        projectName: "Test",
      });

      expect(result).toEqual({ userId: "user-1", email: "owner@example.com" });
    });

    it("falls back to proposal creator when no ownerScopeId", async () => {
      vi.mocked((prisma as any).project.findUnique).mockResolvedValue({
        ownerScopeId: null,
        proposal: { createdById: "user-2" },
      });
      vi.mocked((prisma as any).user.findUnique).mockResolvedValue({
        id: "user-2",
        email: "creator@example.com",
        emailVerified: null,
      });

      const result = await resolveRecipient({
        type: "project.failed",
        projectId: "proj-1",
        projectName: "Test",
      });

      expect(result).toEqual({ userId: "user-2", email: "creator@example.com" });
    });

    it("returns null when project not found", async () => {
      vi.mocked((prisma as any).project.findUnique).mockResolvedValue(null);

      const result = await resolveRecipient({
        type: "project.deployed",
        projectId: "missing",
        projectName: "Test",
      });

      expect(result).toBeNull();
    });

    it("returns null when no owner and no proposal creator", async () => {
      vi.mocked((prisma as any).project.findUnique).mockResolvedValue({
        ownerScopeId: null,
        proposal: null,
      });

      const result = await resolveRecipient({
        type: "project.deployed",
        projectId: "proj-1",
        projectName: "Test",
      });

      expect(result).toBeNull();
    });

    it("returns null when user has no email", async () => {
      vi.mocked((prisma as any).project.findUnique).mockResolvedValue({
        ownerScopeId: "user-1",
        proposal: null,
      });
      vi.mocked((prisma as any).user.findUnique).mockResolvedValue({
        id: "user-1",
        email: null,
        emailVerified: null,
      });

      const result = await resolveRecipient({
        type: "project.deployed",
        projectId: "proj-1",
        projectName: "Test",
      });

      expect(result).toBeNull();
    });
  });

  describe("proposal events", () => {
    it("resolves proposal creator", async () => {
      vi.mocked((prisma as any).proposal.findUnique).mockResolvedValue({
        createdById: "user-3",
      });
      vi.mocked((prisma as any).user.findUnique).mockResolvedValue({
        id: "user-3",
        email: "proposer@example.com",
        emailVerified: new Date(),
      });

      const result = await resolveRecipient({
        type: "proposal.approved",
        proposalId: "prop-1",
        proposalTitle: "My Idea",
      });

      expect(result).toEqual({ userId: "user-3", email: "proposer@example.com" });
    });

    it("returns null when proposal has no creator", async () => {
      vi.mocked((prisma as any).proposal.findUnique).mockResolvedValue({
        createdById: null,
      });

      const result = await resolveRecipient({
        type: "proposal.approved",
        proposalId: "prop-1",
        proposalTitle: "My Idea",
      });

      expect(result).toBeNull();
    });
  });
});
