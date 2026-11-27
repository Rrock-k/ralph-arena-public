import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { normalizeLegacySourceConfigRecipeInternal } from "./source-config";
import { INTERNAL_ACTION_TOKEN } from "@/lib/internal-action-token";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    project: {
      findUnique: vi.fn(),
    },
    projectComponent: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    runLog: {
      create: vi.fn(),
    },
  },
}));

vi.mock("@/lib/progress-bus", () => ({
  notifyProjectChanged: vi.fn(),
  progressBus: {
    notifyChanged: vi.fn(),
  },
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { notifyProjectChanged, progressBus } from "@/lib/progress-bus";

describe("normalizeLegacySourceConfigRecipeInternal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns a not found error when the project is missing", async () => {
    vi.mocked(prisma.project.findUnique).mockResolvedValue(null);

    const result = await normalizeLegacySourceConfigRecipeInternal("project-1", INTERNAL_ACTION_TOKEN);

    expect(result).toEqual({ success: false, error: "Project not found" });
    expect(prisma.projectComponent.update).not.toHaveBeenCalled();
  });

  it("returns a no-op when sourceConfig is already normalized", async () => {
    vi.mocked(prisma.project.findUnique).mockResolvedValue({
      id: "project-1",
    } as any);
    vi.mocked(prisma.projectComponent.findFirst).mockResolvedValue({
      id: "component-1",
      sourceConfig: {
        agent: "claude-code",
        agentImpl: "ralph",
      },
    } as any);

    const result = await normalizeLegacySourceConfigRecipeInternal("project-1", INTERNAL_ACTION_TOKEN);

    expect(result).toEqual({
      success: true,
      normalized: false,
      projectId: "project-1",
      message: "Primary component sourceConfig already uses the non-legacy shape",
    });
    expect(prisma.projectComponent.update).not.toHaveBeenCalled();
    expect(notifyProjectChanged).not.toHaveBeenCalled();
    expect(progressBus.notifyChanged).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("preserves live sourceConfig recipes such as tg-spec targets", async () => {
    vi.mocked(prisma.project.findUnique).mockResolvedValue({
      id: "project-1",
    } as any);
    vi.mocked(prisma.projectComponent.findFirst).mockResolvedValue({
      id: "component-1",
      sourceConfig: {
        recipe: "tg_spec_target",
        agent: "codex",
        agentImpl: "direct",
      },
    } as any);

    const result = await normalizeLegacySourceConfigRecipeInternal("project-1", INTERNAL_ACTION_TOKEN);

    expect(result).toEqual({
      success: true,
      normalized: false,
      projectId: "project-1",
      message: "Primary component sourceConfig recipe is a live contract and must be preserved",
    });
    expect(prisma.projectComponent.update).not.toHaveBeenCalled();
    expect(prisma.runLog.create).not.toHaveBeenCalled();
  });

  it("removes only the legacy recipe key from the primary component sourceConfig", async () => {
    vi.mocked(prisma.project.findUnique).mockResolvedValue({
      id: "project-1",
    } as any);
    vi.mocked(prisma.projectComponent.findFirst).mockResolvedValue({
      id: "component-1",
      sourceConfig: {
        recipe: "agent_project",
        agent: "claude-code",
        agentImpl: "ralph",
        repoUrl: "https://github.com/example/repo",
      },
    } as any);
    vi.mocked(prisma.projectComponent.update).mockResolvedValue({} as any);
    vi.mocked(prisma.runLog.create).mockResolvedValue({} as any);

    const result = await normalizeLegacySourceConfigRecipeInternal("project-1", INTERNAL_ACTION_TOKEN);

    expect(result).toEqual({
      success: true,
      normalized: true,
      projectId: "project-1",
      message: "Removed legacy recipe from primary component sourceConfig",
    });
    expect(prisma.projectComponent.update).toHaveBeenCalledWith({
      where: { id: "component-1" },
      data: {
        sourceConfig: {
          agent: "claude-code",
          agentImpl: "ralph",
          repoUrl: "https://github.com/example/repo",
        },
      },
    });
    expect(prisma.runLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        projectId: "project-1",
        event: "SOURCE_CONFIG_NORMALIZED",
      }),
    });
    expect(notifyProjectChanged).toHaveBeenCalledWith("project-1");
    expect(progressBus.notifyChanged).not.toHaveBeenCalled();
    expect(revalidatePath).toHaveBeenNthCalledWith(1, "/admin");
    expect(revalidatePath).toHaveBeenNthCalledWith(2, "/projects/project-1");
    expect(revalidatePath).toHaveBeenNthCalledWith(3, "/my/projects/project-1");
  });

  it("returns a no-primary-component error when the app component is missing", async () => {
    vi.mocked(prisma.project.findUnique).mockResolvedValue({
      id: "project-1",
    } as any);
    vi.mocked(prisma.projectComponent.findFirst).mockResolvedValue(null);

    const result = await normalizeLegacySourceConfigRecipeInternal("project-1", INTERNAL_ACTION_TOKEN);

    expect(result).toEqual({ success: false, error: "Project has no primary component" });
    expect(prisma.projectComponent.update).not.toHaveBeenCalled();
  });
});
