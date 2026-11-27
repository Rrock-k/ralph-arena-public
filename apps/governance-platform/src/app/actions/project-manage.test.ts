import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

import { deleteProject } from "./project-manage";

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    project: {
      findUnique: vi.fn(),
      delete: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock("@/lib/progress-bus", () => ({
  notifyProjectChanged: vi.fn(),
  progressBus: {
    notifyChanged: vi.fn(),
  },
}));

vi.mock("@/lib/vps/hetzner", () => ({
  destroyVps: vi.fn(),
  deleteDnsRecords: vi.fn(),
}));

vi.mock("@/lib/e2e-auth-bypass", () => ({
  hasE2EAdminBypass: vi.fn().mockResolvedValue(false),
}));

vi.mock("@/lib/project-access", () => ({
  requireProjectCapability: vi.fn(),
}));

vi.mock("@/lib/project-identity", () => ({
  buildProjectWorkspaceLabel: vi.fn().mockReturnValue("test-workspace"),
  getProjectProposalPath: vi.fn((project: { proposalId?: string | null }) =>
    project.proposalId ? `/proposals/${project.proposalId}` : null
  ),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("node:fs/promises", () => ({
  rm: vi.fn(),
}));

import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { notifyProjectChanged, progressBus } from "@/lib/progress-bus";
import { destroyVps, deleteDnsRecords } from "@/lib/vps/hetzner";
import { requireProjectCapability } from "@/lib/project-access";
import { rm } from "node:fs/promises";
import { renameProjectInternal } from "./project-manage";
import { INTERNAL_ACTION_TOKEN } from "@/lib/internal-action-token";

describe("deleteProject", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireProjectCapability).mockResolvedValue({
      authorized: true,
      project: { id: "project-1", mode: "personal", ownerScopeType: "user", ownerScopeId: "user-1" },
    } as any);
    vi.mocked(destroyVps).mockResolvedValue(undefined);
    vi.mocked(deleteDnsRecords).mockResolvedValue(undefined);
    delete process.env.HETZNER_API_TOKEN;
    delete process.env.HETZNER_DNS_TOKEN;
    delete process.env.HETZNER_DNS_ZONE_ID;
    delete process.env.PREVIEW_DOMAIN;
  });

  it("should return error if not authenticated", async () => {
    vi.mocked(requireProjectCapability).mockResolvedValue({ authorized: false, error: "Unauthorized" } as any);

    const result = await deleteProject("project-1");

    expect(result.success).toBe(false);
    expect(result.error).toBe("Unauthorized");
    expect(prisma.project.findUnique).not.toHaveBeenCalled();
  });

  it("should return error if project access is denied", async () => {
    vi.mocked(requireProjectCapability).mockResolvedValue({ authorized: false, error: "Project access denied" } as any);

    const result = await deleteProject("project-1");

    expect(result.success).toBe(false);
    expect(result.error).toBe("Project access denied");
    expect(prisma.project.findUnique).not.toHaveBeenCalled();
  });

  it("should return error if project not found", async () => {
    vi.mocked(prisma.project.findUnique).mockResolvedValue(null);

    const result = await deleteProject("project-1");

    expect(result.success).toBe(false);
    expect(result.error).toBe("Project not found");
    expect(prisma.project.delete).not.toHaveBeenCalled();
  });

  it("should delete project successfully", async () => {
    vi.mocked(prisma.project.findUnique).mockResolvedValue({
      id: "project-1",
      proposalId: "proposal-1",
      proposal: { title: "Project Proposal" },
      components: [],
      vpsHost: null,
    } as any);
    vi.mocked(prisma.project.delete).mockResolvedValue({} as any);

    const result = await deleteProject("project-1");

    expect(result.success).toBe(true);
    expect(prisma.project.findUnique).toHaveBeenCalledWith({
      where: { id: "project-1" },
      select: {
        id: true,
        name: true,
        slug: true,
        proposalId: true,
        proposal: { select: { title: true } },
        components: {
          where: { kind: "app" },
          orderBy: { createdAt: "asc" },
          take: 1,
          select: {
            kind: true,
            containerName: true,
            workerHost: true,
          },
        },
        vpsHost: { select: { ip: true, providerServerId: true, providerKeyId: true, previewDomain: true } },
      },
    });
    expect(prisma.project.delete).toHaveBeenCalledWith({
      where: { id: "project-1" },
    });
    expect(revalidatePath).toHaveBeenCalledWith("/");
    expect(revalidatePath).toHaveBeenCalledWith("/admin");
    expect(revalidatePath).toHaveBeenCalledWith("/proposals/proposal-1");
    expect(notifyProjectChanged).not.toHaveBeenCalled();
    expect(progressBus.notifyChanged).toHaveBeenCalled();
  });

  it("should handle database error gracefully", async () => {
    vi.mocked(prisma.project.findUnique).mockResolvedValue({
      id: "project-1",
      proposalId: "proposal-1",
      proposal: { title: "Project Proposal" },
      components: [],
      vpsHost: null,
    } as any);
    vi.mocked(prisma.project.delete).mockRejectedValue(new Error("DB error"));

    const result = await deleteProject("project-1");

    expect(result.success).toBe(false);
    expect(result.error).toBe("Failed to delete project");
  });

  it("should destroy VPS and DNS records when project has provisioned host", async () => {
    process.env.HETZNER_API_TOKEN = "hetzner-token";
    process.env.HETZNER_DNS_TOKEN = "dns-token";
    process.env.HETZNER_DNS_ZONE_ID = "zone-1";
    process.env.PREVIEW_DOMAIN = "arena.example.com";

    vi.mocked(prisma.project.findUnique).mockResolvedValue({
      id: "project-1",
      proposalId: "proposal-1",
      proposal: { title: "Project Proposal" },
      components: [],
      vpsHost: {
        providerServerId: "server-1",
        providerKeyId: "key-1",
        previewDomain: "preview-123.arena.example.com",
      },
    } as any);
    vi.mocked(prisma.project.delete).mockResolvedValue({} as any);

    const result = await deleteProject("project-1");

    expect(result.success).toBe(true);
    expect(destroyVps).toHaveBeenCalledWith("hetzner-token", "server-1", "key-1");
    expect(deleteDnsRecords).toHaveBeenCalledWith("dns-token", "zone-1", "preview-123");
    expect(notifyProjectChanged).not.toHaveBeenCalled();
    expect(progressBus.notifyChanged).toHaveBeenCalled();
  });

  it("removes workspace from shared configured root instead of repo-local fallback", async () => {
    process.env.ARENA_PROJECT_WORKSPACES_ROOT = "/tmp/external-runtime/project-workspaces";

    vi.mocked(prisma.project.findUnique).mockResolvedValue({
      id: "project-1",
      proposalId: "proposal-1",
      proposal: { title: "Project Proposal" },
      components: [],
      vpsHost: null,
    } as any);
    vi.mocked(prisma.project.delete).mockResolvedValue({} as any);

    const result = await deleteProject("project-1", { removeWorkspace: true });

    expect(result.success).toBe(true);
    expect(rm).toHaveBeenCalledWith(
      "/tmp/external-runtime/project-workspaces/test-workspace",
      { recursive: true, force: true },
    );
  });
});

describe("renameProjectInternal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("emits project-scoped update for a successful rename", async () => {
    vi.mocked(prisma.project.update).mockResolvedValue({ id: "project-1" } as any);

    const result = await renameProjectInternal("project-1", "  Renamed Project  ", INTERNAL_ACTION_TOKEN);

    expect(result).toEqual({ success: true });
    expect(prisma.project.update).toHaveBeenCalledWith({
      where: { id: "project-1" },
      data: { name: "Renamed Project" },
    });
    expect(revalidatePath).toHaveBeenCalledWith("/");
    expect(revalidatePath).toHaveBeenCalledWith("/admin");
    expect(notifyProjectChanged).toHaveBeenCalledWith("project-1");
    expect(progressBus.notifyChanged).not.toHaveBeenCalled();
  });
});
