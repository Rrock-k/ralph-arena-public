import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

import { createSpec, updateSpec, updateSpecInternal, deleteSpec } from "./specs";
import { INTERNAL_ACTION_TOKEN } from "@/lib/internal-action-token";

// Mock dependencies
vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    project: {
      findUnique: vi.fn(),
    },
    spec: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      delete: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/progress-bus", () => ({
  notifyProjectChanged: vi.fn(),
}));

vi.mock("@/lib/project-access", () => {
  const requireProjectManageAccess = vi.fn();
  const requireProjectCapability = vi.fn((...args) => requireProjectManageAccess(...args));
  return {
    requireProjectCapability,
    requireProjectManageAccess,
  };
});

vi.mock("./relaunch", () => ({
  relaunchProject: vi.fn().mockResolvedValue({ success: true }),
  relaunchProjectInternal: vi.fn().mockResolvedValue({ success: true }),
}));

// Import mocked modules
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { notifyProjectChanged } from "@/lib/progress-bus";
import { requireProjectManageAccess } from "@/lib/project-access";
import { relaunchProjectInternal } from "./relaunch";

const adminSession = {
  user: { id: "admin-1", email: "admin@example.com", role: "ADMIN" },
  expires: new Date().toISOString(),
};

const userSession = {
  user: { id: "user-1", email: "user@example.com", role: "USER" },
  expires: new Date().toISOString(),
};

describe("createSpec", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireProjectManageAccess).mockResolvedValue({
      authorized: true,
      project: { id: "project-1", mode: "personal", ownerScopeType: "user", ownerScopeId: "user-1" },
    } as any);
  });

  it("should return error if user is not authenticated", async () => {
    vi.mocked(requireProjectManageAccess).mockResolvedValue({ authorized: false, error: "Unauthorized" } as any);

    const result = await createSpec("project-1", { content: "Test" });

    expect(result.success).toBe(false);
    expect(result.error).toBe("Unauthorized");
  });

  it("should return error if user is not admin", async () => {
    vi.mocked(requireProjectManageAccess).mockResolvedValue({ authorized: false, error: "Project access denied" } as any);

    const result = await createSpec("project-1", { content: "Test" });

    expect(result.success).toBe(false);
    expect(result.error).toBe("Project access denied");
  });

  it("should return error if project is not found", async () => {
    vi.mocked(auth as any).mockResolvedValue(adminSession);
    vi.mocked((prisma as any).project.findUnique).mockResolvedValue(null);

    const result = await createSpec("non-existent", { content: "Test" });

    expect(result.success).toBe(false);
    expect(result.error).toBe("Project not found");
  });

  it("should return error if content is empty", async () => {
    vi.mocked(auth as any).mockResolvedValue(adminSession);
    vi.mocked(requireProjectManageAccess).mockResolvedValue({
      authorized: true,
      project: { id: "project-1", mode: "personal", ownerScopeType: "user", ownerScopeId: "user-1" },
    } as any);
    vi.mocked((prisma as any).project.findUnique).mockResolvedValue({
      id: "project-1",
      proposalId: "proposal-1",
    });

    const result = await createSpec("project-1", { content: "   " });

    expect(result.success).toBe(false);
    expect(result.error).toBe("Content is required");
  });

  it("should successfully create a spec with version", async () => {
    vi.mocked(auth as any).mockResolvedValue(adminSession);
    vi.mocked((prisma as any).project.findUnique).mockResolvedValue({
      id: "project-1",
      proposalId: "proposal-1",
    });
    vi.mocked((prisma as any).spec.findFirst).mockResolvedValue({
      orderIndex: 2,
    });

    vi.mocked(prisma.$transaction).mockImplementation(async (cb: any) => {
      const tx = {
        spec: {
          create: vi.fn().mockResolvedValue({ id: "spec-1" }),
        },
        specVersion: {
          create: vi.fn().mockResolvedValue({ id: "sv-1" }),
        },
      };
      const result = await cb(tx);
      // Verify spec.create was called with correct data
      expect(tx.spec.create).toHaveBeenCalledWith({
        data: {
          projectId: "project-1",
          title: "My Spec",
          content: "Test content",
          orderIndex: 3,
        },
      });
      // Verify version was created
      expect(tx.specVersion.create).toHaveBeenCalledWith({
        data: {
          specId: "spec-1",
          version: 1,
          content: "Test content",
          message: "Initial version",
        },
      });
      return result;
    });

    const result = await createSpec("project-1", {
      title: "My Spec",
      content: "Test content",
    });

    expect(result.success).toBe(true);
    expect(result.specId).toBe("spec-1");
    expect(notifyProjectChanged).toHaveBeenCalledWith("project-1");
  });

  it("should use orderIndex 0 when no existing specs", async () => {
    vi.mocked(auth as any).mockResolvedValue(adminSession);
    vi.mocked((prisma as any).project.findUnique).mockResolvedValue({
      id: "project-1",
      proposalId: "proposal-1",
    });
    vi.mocked((prisma as any).spec.findFirst).mockResolvedValue(null);

    vi.mocked(prisma.$transaction).mockImplementation(async (cb: any) => {
      const tx = {
        spec: {
          create: vi.fn().mockResolvedValue({ id: "spec-1" }),
        },
        specVersion: {
          create: vi.fn().mockResolvedValue({ id: "sv-1" }),
        },
      };
      const result = await cb(tx);
      expect(tx.spec.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ orderIndex: 0 }),
        })
      );
      return result;
    });

    const result = await createSpec("project-1", { content: "First spec" });

    expect(result.success).toBe(true);
  });

  it("should handle database errors gracefully", async () => {
    vi.mocked(auth as any).mockResolvedValue(adminSession);
    vi.mocked((prisma as any).project.findUnique).mockRejectedValue(
      new Error("Database error")
    );

    const result = await createSpec("project-1", { content: "Test" });

    expect(result.success).toBe(false);
    expect(result.error).toBe("Failed to create spec");
  });
});

describe("updateSpec", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireProjectManageAccess).mockResolvedValue({
      authorized: true,
      project: { id: "project-1", mode: "personal", ownerScopeType: "user", ownerScopeId: "user-1" },
    } as any);
  });

  it("should return error if user is not authenticated", async () => {
    vi.mocked((prisma as any).spec.findUnique).mockResolvedValue({
      id: "spec-1",
      projectId: "project-1",
      title: null,
      content: "Old content",
      project: { proposalId: "proposal-1" },
    });
    vi.mocked(requireProjectManageAccess).mockResolvedValue({ authorized: false, error: "Unauthorized" } as any);

    const result = await updateSpec("spec-1", { content: "Updated" });

    expect(result.success).toBe(false);
    expect(result.error).toBe("Unauthorized");
  });

  it("should return error if user is not admin", async () => {
    vi.mocked((prisma as any).spec.findUnique).mockResolvedValue({
      id: "spec-1",
      projectId: "project-1",
      title: null,
      content: "Old content",
      project: { proposalId: "proposal-1" },
    });
    vi.mocked(requireProjectManageAccess).mockResolvedValue({ authorized: false, error: "Project access denied" } as any);

    const result = await updateSpec("spec-1", { content: "Updated" });

    expect(result.success).toBe(false);
    expect(result.error).toBe("Project access denied");
  });

  it("should return error if spec is not found", async () => {
    vi.mocked(auth as any).mockResolvedValue(adminSession);
    vi.mocked((prisma as any).spec.findUnique).mockResolvedValue(null);

    const result = await updateSpec("non-existent", { content: "Updated" });

    expect(result.success).toBe(false);
    expect(result.error).toBe("Spec not found");
  });

  it("should return error if content is empty", async () => {
    vi.mocked(auth as any).mockResolvedValue(adminSession);
    vi.mocked((prisma as any).spec.findUnique).mockResolvedValue({
      id: "spec-1",
      projectId: "project-1",
      content: "Old content",
      project: { proposalId: "proposal-1" },
    });

    const result = await updateSpec("spec-1", { content: "" });

    expect(result.success).toBe(false);
    expect(result.error).toBe("Content is required");
  });

  it("should skip update if nothing changed", async () => {
    vi.mocked(auth as any).mockResolvedValue(adminSession);
    vi.mocked((prisma as any).spec.findUnique).mockResolvedValue({
      id: "spec-1",
      projectId: "project-1",
      content: "Same content",
      title: null,
      project: { proposalId: "proposal-1" },
    });

    const result = await updateSpec("spec-1", { content: "Same content" });

    expect(result.success).toBe(true);
    expect(result.specId).toBe("spec-1");
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("should successfully update spec and create version", async () => {
    vi.mocked(auth as any).mockResolvedValue(adminSession);
    vi.mocked((prisma as any).spec.findUnique).mockResolvedValue({
      id: "spec-1",
      projectId: "project-1",
      content: "Old content",
      title: null,
      project: { proposalId: "proposal-1" },
    });

    vi.mocked(prisma.$transaction).mockImplementation(async (cb: any) => {
      const tx = {
        spec: {
          update: vi.fn().mockResolvedValue({ id: "spec-1" }),
        },
        specVersion: {
          findFirst: vi.fn().mockResolvedValue({ version: 2 }),
          create: vi.fn().mockResolvedValue({ id: "sv-3" }),
        },
      };
      await cb(tx);
      expect(tx.spec.update).toHaveBeenCalledWith({
        where: { id: "spec-1" },
        data: { title: "New Title", content: "New content" },
      });
      expect(tx.specVersion.create).toHaveBeenCalledWith({
        data: {
          specId: "spec-1",
          version: 3,
          content: "New content",
          message: null,
        },
      });
    });

    const result = await updateSpec("spec-1", {
      title: "New Title",
      content: "New content",
    });

    expect(result.success).toBe(true);
    expect(result.specId).toBe("spec-1");
    expect(notifyProjectChanged).toHaveBeenCalledWith("project-1");
  });

  it("should reject edits to the Evolution mirror spec", async () => {
    vi.mocked(auth as any).mockResolvedValue(adminSession);
    vi.mocked((prisma as any).spec.findUnique).mockResolvedValue({
      id: "spec-1",
      projectId: "project-1",
      content: "Old content",
      title: null,
      project: { proposalId: "proposal-1", tgSpecMirrorSpecId: "spec-1" },
    });

    const result = await updateSpecInternal("spec-1", { content: "New content" }, INTERNAL_ACTION_TOKEN);

    expect(result.success).toBe(false);
    expect(result.error).toBe("Evolution mirror spec is read-only");
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("should handle database errors gracefully", async () => {
    vi.mocked(auth as any).mockResolvedValue(adminSession);
    // First call (in updateSpec outer scope) succeeds, second call (in updateSpecInternal) fails
    vi.mocked((prisma as any).spec.findUnique)
      .mockResolvedValueOnce({ id: "spec-1", projectId: "project-1" })
      .mockRejectedValueOnce(new Error("Database error"));

    const result = await updateSpec("spec-1", { content: "Updated" });

    expect(result.success).toBe(false);
    expect(result.error).toBe("Failed to update spec");
  });
});

describe("auto relaunch on spec changes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(auth as any).mockResolvedValue(adminSession);
    vi.mocked((prisma as any).spec.findUnique).mockResolvedValue({
      id: "spec-1",
      projectId: "project-1",
      title: null,
      content: "Old content",
      project: { proposalId: "proposal-1" },
    });
    vi.mocked(prisma.$transaction).mockImplementation(async (cb: any) => {
      const tx = {
        spec: {
          update: vi.fn().mockResolvedValue({ id: "spec-1" }),
        },
        specVersion: {
          findFirst: vi.fn().mockResolvedValue({ version: 1 }),
          create: vi.fn().mockResolvedValue({ id: "sv-2" }),
        },
      };
      return cb(tx);
    });
  });

  it("keeps live completed idle previews on the runner poll path after a spec update", async () => {
    vi.mocked((prisma as any).project.findUnique).mockResolvedValue({
      archivedAt: null,
      components: [
        {
          powerIntent: "ON",
          agentIntent: "ON",
          runtimeState: "RUNNING",
          agentState: "IDLE",
          lastOutcome: "COMPLETED",
        },
      ],
    });

    const result = await updateSpecInternal("spec-1", { content: "New content" }, INTERNAL_ACTION_TOKEN);
    await new Promise((resolve) => setImmediate(resolve));

    expect(result.success).toBe(true);
    expect(vi.mocked(relaunchProjectInternal)).not.toHaveBeenCalled();
  });

  it("does not relaunch completed previews when no live runtime is present", async () => {
    vi.mocked((prisma as any).project.findUnique).mockResolvedValue({
      archivedAt: null,
      components: [
        {
          powerIntent: "ON",
          agentIntent: "ON",
          runtimeState: "ABSENT",
          agentState: "IDLE",
          lastOutcome: "COMPLETED",
        },
      ],
    });

    const result = await updateSpecInternal("spec-1", { content: "New content" }, INTERNAL_ACTION_TOKEN);
    await new Promise((resolve) => setImmediate(resolve));

    expect(result.success).toBe(true);
    expect(vi.mocked(relaunchProjectInternal)).not.toHaveBeenCalled();
  });

  it("keeps active running projects on the poll-only path", async () => {
    vi.mocked((prisma as any).project.findUnique).mockResolvedValue({
      archivedAt: null,
      components: [
        {
          powerIntent: "ON",
          agentIntent: "ON",
          runtimeState: "RUNNING",
          agentState: "RUNNING",
          lastOutcome: "FAILED",
        },
      ],
    });

    const result = await updateSpecInternal("spec-1", { content: "New content" }, INTERNAL_ACTION_TOKEN);
    await new Promise((resolve) => setImmediate(resolve));

    expect(result.success).toBe(true);
    expect(vi.mocked(relaunchProjectInternal)).not.toHaveBeenCalled();
  });

  it("does not relaunch when agent intent is OFF, even for completed preview rows", async () => {
    vi.mocked((prisma as any).project.findUnique).mockResolvedValue({
      archivedAt: null,
      components: [
        {
          powerIntent: "ON",
          agentIntent: "OFF",
          runtimeState: "RUNNING",
          agentState: "IDLE",
          lastOutcome: "COMPLETED",
        },
      ],
    });

    const result = await updateSpecInternal("spec-1", { content: "New content" }, INTERNAL_ACTION_TOKEN);
    await new Promise((resolve) => setImmediate(resolve));

    expect(result.success).toBe(true);
    expect(vi.mocked(relaunchProjectInternal)).not.toHaveBeenCalled();
  });
});

describe("deleteSpec", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireProjectManageAccess).mockResolvedValue({
      authorized: true,
      project: { id: "project-1", mode: "personal", ownerScopeType: "user", ownerScopeId: "user-1" },
    } as any);
  });

  it("should return error if user is not authenticated", async () => {
    vi.mocked((prisma as any).spec.findUnique).mockResolvedValue({
      id: "spec-1",
      projectId: "project-1",
      project: { proposalId: "proposal-1" },
    });
    vi.mocked(requireProjectManageAccess).mockResolvedValue({ authorized: false, error: "Unauthorized" } as any);

    const result = await deleteSpec("spec-1");

    expect(result.success).toBe(false);
    expect(result.error).toBe("Unauthorized");
  });

  it("should return error if user is not admin", async () => {
    vi.mocked((prisma as any).spec.findUnique).mockResolvedValue({
      id: "spec-1",
      projectId: "project-1",
      project: { proposalId: "proposal-1" },
    });
    vi.mocked(requireProjectManageAccess).mockResolvedValue({ authorized: false, error: "Project access denied" } as any);

    const result = await deleteSpec("spec-1");

    expect(result.success).toBe(false);
    expect(result.error).toBe("Project access denied");
  });

  it("should return error if spec is not found", async () => {
    vi.mocked(auth as any).mockResolvedValue(adminSession);
    vi.mocked((prisma as any).spec.findUnique).mockResolvedValue(null);

    const result = await deleteSpec("non-existent");

    expect(result.success).toBe(false);
    expect(result.error).toBe("Spec not found");
  });

  it("should successfully delete spec", async () => {
    vi.mocked(auth as any).mockResolvedValue(adminSession);
    vi.mocked((prisma as any).spec.findUnique).mockResolvedValue({
      id: "spec-1",
      projectId: "project-1",
      project: { proposalId: "proposal-1" },
    });
    vi.mocked((prisma as any).spec.delete).mockResolvedValue({ id: "spec-1" });

    const result = await deleteSpec("spec-1");

    expect(result.success).toBe(true);
    expect((prisma as any).spec.delete).toHaveBeenCalledWith({
      where: { id: "spec-1" },
    });
    expect(notifyProjectChanged).toHaveBeenCalledWith("project-1");
  });

  it("should reject deleting the Evolution mirror spec", async () => {
    vi.mocked(auth as any).mockResolvedValue(adminSession);
    vi.mocked((prisma as any).spec.findUnique).mockResolvedValue({
      id: "spec-1",
      projectId: "project-1",
      project: { proposalId: "proposal-1", tgSpecMirrorSpecId: "spec-1" },
    });

    const result = await deleteSpec("spec-1");

    expect(result.success).toBe(false);
    expect(result.error).toBe("Evolution mirror spec is read-only");
    expect((prisma as any).spec.delete).not.toHaveBeenCalled();
  });

  it("should handle database errors gracefully", async () => {
    vi.mocked(auth as any).mockResolvedValue(adminSession);
    vi.mocked((prisma as any).spec.findUnique).mockRejectedValue(
      new Error("Database error")
    );

    const result = await deleteSpec("spec-1");

    expect(result.success).toBe(false);
    expect(result.error).toBe("Failed to delete spec");
  });
});
