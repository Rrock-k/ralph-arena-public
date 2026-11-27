import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: vi.fn((callback: (tx: unknown) => unknown) => callback({
      projectUpdateDeliveryTarget: {
        upsert: vi.fn(),
        findFirst: vi.fn(),
        update: vi.fn(),
        updateMany: vi.fn(),
      },
    })),
    projectUpdateDeliveryTarget: {
      upsert: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
  },
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/project-access", () => ({
  requireProjectCapability: vi.fn(),
}));

vi.mock("@/lib/tg-spec-manager-bindings", () => ({
  findTgSpecManagerBindingCandidate: vi.fn((lookup, sourceTargetId) => (
    lookup.candidates.find((candidate: any) => candidate.sourceTargetId === sourceTargetId) ?? null
  )),
  listTgSpecManagerBindingCandidates: vi.fn(),
  syncTgSpecManagerDeliveryTarget: vi.fn(),
}));

import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { requireProjectCapability } from "@/lib/project-access";
import {
  listTgSpecManagerBindingCandidates,
  syncTgSpecManagerDeliveryTarget,
} from "@/lib/tg-spec-manager-bindings";
import {
  activateProjectUpdateDeliveryTargetFromTgSpecBinding,
  revokeProjectUpdateDeliveryTarget,
} from "./project-update-delivery-targets";

describe("project update delivery target actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.$transaction as any).mockImplementation((callback: (tx: unknown) => unknown) => callback(prisma));
    vi.mocked(requireProjectCapability).mockResolvedValue({
      authorized: true,
      session: {
        user: {
          id: "user-1",
        },
      },
    } as any);
    vi.mocked(listTgSpecManagerBindingCandidates).mockResolvedValue({
      configured: true,
      candidates: [],
      error: null,
    });
    vi.mocked(syncTgSpecManagerDeliveryTarget).mockResolvedValue({
      success: true,
      binding: null,
    });
  });

  describe("activateProjectUpdateDeliveryTargetFromTgSpecBinding", () => {
    it("requires project access management capability", async () => {
      vi.mocked(requireProjectCapability).mockResolvedValue({
        authorized: false,
        error: "Project access denied",
      } as any);

      const result = await activateProjectUpdateDeliveryTargetFromTgSpecBinding(
        "project-1",
        "telegram:chat-1:topic-2",
      );

      expect(result).toEqual({ success: false, error: "Project access denied" });
      expect(requireProjectCapability).toHaveBeenCalledWith("project-1", "project.access.manage");
      expect(listTgSpecManagerBindingCandidates).not.toHaveBeenCalled();
      expect(prisma.projectUpdateDeliveryTarget.upsert).not.toHaveBeenCalled();
    });

    it("activates and syncs an Arena-issued target id back to the tg-spec binding", async () => {
      vi.mocked(listTgSpecManagerBindingCandidates).mockResolvedValue({
        configured: true,
        candidates: [
          {
            sourceTargetId: "telegram:chat-1:topic-2",
            targetKind: "telegram_chat_topic",
            label: "Maintainers",
            channelId: "telegram:chat-1:topic-2",
            chatId: "chat-1",
            messageThreadId: "2",
            topicTitle: "Managers",
            channelTitle: "Team Chat",
            channelType: "supergroup",
            projectId: "tg-project-1",
            projectSlug: "tg-project",
            projectTitle: "Telegram Project",
            state: "bound",
            boundAt: null,
            updatedAt: null,
            arenaManagerDeliveryTargetId: null,
          },
        ],
        error: null,
      });
      vi.mocked(prisma.projectUpdateDeliveryTarget.upsert).mockResolvedValue({
        id: "target-1",
      } as any);

      const result = await activateProjectUpdateDeliveryTargetFromTgSpecBinding(
        "project-1",
        "telegram:chat-1:topic-2",
      );

      expect(result).toEqual({ success: true, targetId: "target-1" });
      expect(requireProjectCapability).toHaveBeenCalledTimes(1);
      expect(prisma.projectUpdateDeliveryTarget.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            projectId_sourceSystem_sourceTargetId_audience: {
              projectId: "project-1",
              sourceSystem: "tg-spec",
              sourceTargetId: "telegram:chat-1:topic-2",
              audience: "project_managers",
            },
          },
          create: expect.objectContaining({
            sourceTargetId: "telegram:chat-1:topic-2",
            label: "Maintainers",
            requiredCapability: "project.secrets.manage",
            createdByUserId: "user-1",
            activatedByUserId: "user-1",
          }),
        }),
      );
      expect(prisma.projectUpdateDeliveryTarget.updateMany).toHaveBeenCalledWith({
        where: {
          projectId: "project-1",
          sourceSystem: "tg-spec",
          audience: "project_managers",
          status: "ACTIVE",
          sourceTargetId: { not: "telegram:chat-1:topic-2" },
        },
        data: {
          status: "REVOKED",
          revokedAt: expect.any(Date),
          revokedByUserId: "user-1",
        },
      });
      expect(syncTgSpecManagerDeliveryTarget).toHaveBeenCalledWith(
        "project-1",
        "telegram:chat-1:topic-2",
        "target-1",
      );
      expect(revalidatePath).toHaveBeenCalledWith("/projects/project-1");
      expect(revalidatePath).toHaveBeenCalledWith("/my/projects/project-1");
      expect(revalidatePath).toHaveBeenCalledWith("/admin/projects/project-1");
    });

    it("rejects unknown tg-spec bindings before mutating Arena target state", async () => {
      vi.mocked(listTgSpecManagerBindingCandidates).mockResolvedValue({
        configured: true,
        candidates: [],
        error: null,
      });

      const result = await activateProjectUpdateDeliveryTargetFromTgSpecBinding(
        "project-1",
        "telegram:missing",
      );

      expect(result).toEqual({
        success: false,
        error: "Telegram binding is not bound to this Arena project",
      });
      expect(prisma.projectUpdateDeliveryTarget.upsert).not.toHaveBeenCalled();
      expect(syncTgSpecManagerDeliveryTarget).not.toHaveBeenCalled();
    });

    it("surfaces tg-spec sync failures after target activation", async () => {
      vi.mocked(listTgSpecManagerBindingCandidates).mockResolvedValue({
        configured: true,
        candidates: [
          {
            sourceTargetId: "telegram:chat-1",
            targetKind: "telegram_chat_topic",
            label: "Team Chat",
            channelId: "telegram:chat-1",
            chatId: "chat-1",
            messageThreadId: null,
            topicTitle: null,
            channelTitle: "Team Chat",
            channelType: "group",
            projectId: "tg-project-1",
            projectSlug: "tg-project",
            projectTitle: "Telegram Project",
            state: "bound",
            boundAt: null,
            updatedAt: null,
            arenaManagerDeliveryTargetId: null,
          },
        ],
        error: null,
      });
      vi.mocked(prisma.projectUpdateDeliveryTarget.upsert).mockResolvedValue({
        id: "target-1",
      } as any);
      vi.mocked(syncTgSpecManagerDeliveryTarget).mockResolvedValue({
        success: false,
        error: "tg-spec unavailable",
      });

      const result = await activateProjectUpdateDeliveryTargetFromTgSpecBinding(
        "project-1",
        "telegram:chat-1",
      );

      expect(result).toEqual({
        success: false,
        error: "Telegram binding sync failed: tg-spec unavailable",
      });
    });
  });

  describe("revokeProjectUpdateDeliveryTarget", () => {
    it("requires project access management capability", async () => {
      vi.mocked(requireProjectCapability).mockResolvedValue({
        authorized: false,
        error: "Project access denied",
      } as any);

      const result = await revokeProjectUpdateDeliveryTarget("project-1", "target-1");

      expect(result).toEqual({ success: false, error: "Project access denied" });
      expect(requireProjectCapability).toHaveBeenCalledWith("project-1", "project.access.manage");
      expect(prisma.projectUpdateDeliveryTarget.update).not.toHaveBeenCalled();
    });

    it("revokes only a target that belongs to the project", async () => {
      vi.mocked(prisma.projectUpdateDeliveryTarget.findFirst).mockResolvedValue({
        id: "target-1",
      } as any);
      vi.mocked(prisma.projectUpdateDeliveryTarget.update).mockResolvedValue({} as any);

      const result = await revokeProjectUpdateDeliveryTarget("project-1", " target-1 ");

      expect(result).toEqual({ success: true });
      expect(prisma.projectUpdateDeliveryTarget.findFirst).toHaveBeenCalledWith({
        where: {
          id: "target-1",
          projectId: "project-1",
        },
        select: {
          id: true,
          sourceSystem: true,
          sourceTargetId: true,
          audience: true,
        },
      });
      expect(prisma.projectUpdateDeliveryTarget.update).toHaveBeenCalledWith({
        where: {
          id: "target-1",
        },
        data: {
          status: "REVOKED",
          revokedAt: expect.any(Date),
          revokedByUserId: "user-1",
        },
      });
      expect(revalidatePath).toHaveBeenCalledWith("/projects/project-1");
      expect(revalidatePath).toHaveBeenCalledWith("/my/projects/project-1");
      expect(revalidatePath).toHaveBeenCalledWith("/admin/projects/project-1");
    });

    it("rejects unknown targets", async () => {
      vi.mocked(prisma.projectUpdateDeliveryTarget.findFirst).mockResolvedValue(null);

      const result = await revokeProjectUpdateDeliveryTarget("project-1", "target-1");

      expect(result).toEqual({
        success: false,
        error: "Delivery target not found",
      });
      expect(prisma.projectUpdateDeliveryTarget.update).not.toHaveBeenCalled();
    });
  });
});
