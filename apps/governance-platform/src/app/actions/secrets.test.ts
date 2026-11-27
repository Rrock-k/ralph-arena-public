import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  addRequiredSecret,
  createProjectSecret,
  createProjectSecretInternal,
  deleteProjectSecret,
  removeRequiredSecret,
  updateProjectSecret,
} from "./secrets";

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
}));

vi.mock("@/lib/e2e-auth-bypass", () => ({
  hasE2EAdminBypass: vi.fn().mockResolvedValue(false),
}));

vi.mock("@/lib/crypto", () => ({
  getEncryptionKey: vi.fn(() => Buffer.alloc(32)),
  encryptSecret: vi.fn(() => ({ ciphertext: "cipher", iv: "iv", authTag: "tag" })),
  decryptSecret: vi.fn(),
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

vi.mock("@/lib/project-access", () => ({
  requireProjectCapability: vi.fn(),
  requireAnyProjectCapability: vi.fn(),
}));

vi.mock("@/lib/runtime-action-access", () => ({
  requireProjectRuntimeActionAccess: vi.fn(),
}));

vi.mock("@/lib/platform-access", () => ({
  requirePlatformCapability: vi.fn().mockResolvedValue({ authorized: false, error: "Denied" }),
}));

vi.mock("@/lib/project-state-effects", () => ({
  requirePrimaryComponentRow: vi.fn(),
  applyStateChange: vi.fn(),
  resetComponentForFreshStart: vi.fn(),
  updateComponentMetadata: vi.fn(),
}));

vi.mock("@/app/actions/container-ops", () => ({
  restartContainerInternal: vi.fn().mockResolvedValue({ success: true }),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    project: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    $transaction: vi.fn(),
    projectSecret: {
      create: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    runLog: {
      create: vi.fn(),
    },
  },
}));

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { notifyProjectChanged, progressBus } from "@/lib/progress-bus";
import { applyStateChange, requirePrimaryComponentRow, resetComponentForFreshStart, updateComponentMetadata } from "@/lib/project-state-effects";
import { restartContainerInternal } from "@/app/actions/container-ops";
import { revalidatePath } from "next/cache";
import { requireProjectCapability } from "@/lib/project-access";
import { requireProjectRuntimeActionAccess } from "@/lib/runtime-action-access";
import { INTERNAL_ACTION_TOKEN } from "@/lib/internal-action-token";

const adminSession = {
  user: { id: "admin-1", email: "admin@example.com", role: "ADMIN" },
  expires: new Date().toISOString(),
};

describe("secret runtime restarts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(auth as any).mockResolvedValue(adminSession as any);
    vi.mocked(requireProjectCapability).mockResolvedValue({
      authorized: true,
      project: { id: "project-1", mode: "personal", ownerScopeType: "user", ownerScopeId: "user-1" },
    } as any);
    vi.mocked(requireProjectRuntimeActionAccess).mockResolvedValue(null);
    vi.mocked(requirePrimaryComponentRow as any).mockResolvedValue({
      projectId: "project-1",
      componentId: "cmp-1",
      powerIntent: "ON",
      agentIntent: "ON",
      runtimeState: "RUNNING",
      agentState: "IDLE",
      blockers: [],
      lastOutcome: "COMPLETED",
      lastOutcomeAt: null,
      retryAt: null,
      previewHealth: "HEALTHY",
      previewCheckedAt: null,
      provisionedAt: null,
      containerName: "preview-project",
      previewUrl: "https://preview.example.com",
      workerHost: "local",
      vpsHostId: null,
      lastHeartbeat: null,
      retryCount: 0,
      archivedAt: null,
    });
  });

  it("blocks direct internal secret creation without trusted server token", async () => {
    const result = await createProjectSecretInternal("project-1", "OPENAI_API_KEY", "secret-value");

    expect(result).toEqual({
      success: false,
      error: "Internal action is not callable directly.",
    });
    expect((prisma as any).projectSecret.create).not.toHaveBeenCalled();
  });

  it("restarts deployed project app after secret create", async () => {
    vi.mocked((prisma as any).projectSecret.create).mockResolvedValue({ id: "secret-1" });
    vi.mocked((prisma as any).project.findUnique)
      .mockResolvedValueOnce({
        proposalId: "proposal-1",
        requiredSecrets: null,
        secrets: [{ key: "TELEGRAM_BOT_TOKEN" }],
      })
      .mockResolvedValueOnce({
        components: [{
          kind: "app",
          powerIntent: "ON",
          agentIntent: "ON",
          runtimeState: "RUNNING",
          agentState: "IDLE",
          lastOutcome: "COMPLETED",
          previewHealth: "HEALTHY",
          previewUrl: "https://preview.example.com",
          containerName: "preview-project",
        }],
      });

    const result = await createProjectSecret("project-1", "TELEGRAM_BOT_TOKEN", "secret-value");

    expect(result).toEqual({ success: true });
    expect(restartContainerInternal).toHaveBeenCalledWith("project-1", INTERNAL_ACTION_TOKEN);
    expect((prisma as any).runLog.create).toHaveBeenCalledWith({
      data: {
        projectId: "project-1",
        event: "DEPLOYED",
        detail: JSON.stringify({ trigger: "secret_restart" }),
      },
    });
    expect(notifyProjectChanged).toHaveBeenCalledWith("project-1");
    expect(progressBus.notifyChanged).not.toHaveBeenCalled();
    expect(revalidatePath).toHaveBeenCalledWith("/admin");
  });

  it("restarts deployed project app after secret value update", async () => {
    vi.mocked((prisma as any).projectSecret.findUnique).mockResolvedValue({
      id: "secret-1",
      projectId: "project-1",
    });
    vi.mocked((prisma as any).projectSecret.update).mockResolvedValue({ id: "secret-1" });
    vi.mocked((prisma as any).project.findUnique)
      .mockResolvedValueOnce({
        proposalId: "proposal-1",
        requiredSecrets: null,
        secrets: [{ key: "TELEGRAM_BOT_TOKEN" }],
      })
      .mockResolvedValueOnce({
        components: [{
          kind: "app",
          powerIntent: "ON",
          agentIntent: "ON",
          runtimeState: "RUNNING",
          agentState: "IDLE",
          lastOutcome: "COMPLETED",
          previewHealth: "HEALTHY",
          previewUrl: "https://preview.example.com",
          containerName: "preview-project",
        }],
      });

    const result = await updateProjectSecret("secret-1", "new-value");

    expect(result).toEqual({ success: true });
    expect(restartContainerInternal).toHaveBeenCalledWith("project-1", INTERNAL_ACTION_TOKEN);
    expect(notifyProjectChanged).toHaveBeenCalledWith("project-1");
  });

  it("does not restart deployed project app for description-only update", async () => {
    vi.mocked((prisma as any).projectSecret.findUnique).mockResolvedValue({
      id: "secret-1",
      projectId: "project-1",
    });
    vi.mocked((prisma as any).projectSecret.update).mockResolvedValue({ id: "secret-1" });

    const result = await updateProjectSecret("secret-1", undefined, "new description");

    expect(result).toEqual({ success: true });
    expect(restartContainerInternal).not.toHaveBeenCalled();
    expect(notifyProjectChanged).toHaveBeenCalledWith("project-1");
  });

  it("emits project-scoped refresh when secret create only changes stored secret state", async () => {
    vi.mocked((prisma as any).projectSecret.create).mockResolvedValue({ id: "secret-1" });
    vi.mocked((prisma as any).project.findUnique)
      .mockResolvedValueOnce({
        proposalId: "proposal-1",
        requiredSecrets: null,
        secrets: [],
      })
      .mockResolvedValueOnce({
        components: [{
          kind: "app",
          powerIntent: "OFF",
          agentIntent: "OFF",
          runtimeState: "ABSENT",
          agentState: "IDLE",
          lastOutcome: "COMPLETED",
          previewHealth: "UNKNOWN",
          previewUrl: null,
          containerName: null,
        }],
      });

    const result = await createProjectSecret("project-1", "API_KEY", "secret-value");

    expect(result).toEqual({ success: true });
    expect(restartContainerInternal).not.toHaveBeenCalled();
    expect(notifyProjectChanged).toHaveBeenCalledWith("project-1");
  });

  it("emits project-scoped refresh when deleting a project secret", async () => {
    vi.mocked((prisma as any).projectSecret.findUnique).mockResolvedValue({
      id: "secret-1",
      projectId: "project-1",
    });
    vi.mocked((prisma as any).projectSecret.delete).mockResolvedValue({ id: "secret-1" });

    const result = await deleteProjectSecret("secret-1");

    expect(result).toEqual({ success: true });
    expect(notifyProjectChanged).toHaveBeenCalledWith("project-1");
  });

  it("emits project-scoped refresh when adding a required secret", async () => {
    vi.mocked((prisma as any).project.findUnique).mockResolvedValue({
      requiredSecrets: null,
    });
    vi.mocked((prisma as any).project.update).mockResolvedValue({ id: "project-1" });

    const result = await addRequiredSecret("project-1", "OPENAI_API_KEY", "Needed for API access");

    expect(result).toEqual({ success: true });
    expect(notifyProjectChanged).toHaveBeenCalledWith("project-1");
  });

  it("emits project-scoped refresh when removing a required secret", async () => {
    vi.mocked((prisma as any).project.findUnique).mockResolvedValue({
      requiredSecrets: JSON.stringify([{ key: "OPENAI_API_KEY", blocking: true }]),
    });
    vi.mocked((prisma as any).project.update).mockResolvedValue({ id: "project-1" });

    const result = await removeRequiredSecret("project-1", "OPENAI_API_KEY");

    expect(result).toEqual({ success: true });
    expect(notifyProjectChanged).toHaveBeenCalledWith("project-1");
  });

  it("does not restart app from stale project-level runtime mirrors when component identity is gone", async () => {
    vi.mocked((prisma as any).projectSecret.create).mockResolvedValue({ id: "secret-1" });
    vi.mocked((prisma as any).project.findUnique)
      .mockResolvedValueOnce({
        proposalId: "proposal-1",
        requiredSecrets: null,
        secrets: [{ key: "TELEGRAM_BOT_TOKEN" }],
      })
      .mockResolvedValueOnce({
        containerName: "preview-stale-project-mirror",
        components: [{
          kind: "app",
          powerIntent: "ON",
          agentIntent: "ON",
          runtimeState: "RUNNING",
          agentState: "IDLE",
          lastOutcome: "COMPLETED",
          previewHealth: "HEALTHY",
          previewUrl: null,
          containerName: null,
        }],
      });

    const result = await createProjectSecret("project-1", "TELEGRAM_BOT_TOKEN", "secret-value");

    expect(result).toEqual({ success: true });
    expect(restartContainerInternal).not.toHaveBeenCalled();
  });

  it("restarts parked preview-only app after secret create without requiring COMPLETED outcome", async () => {
    vi.mocked((prisma as any).projectSecret.create).mockResolvedValue({ id: "secret-1" });
    vi.mocked((prisma as any).project.findUnique)
      .mockResolvedValueOnce({
        proposalId: "proposal-1",
        requiredSecrets: null,
        secrets: [{ key: "TELEGRAM_BOT_TOKEN" }],
      })
      .mockResolvedValueOnce({
        components: [{
          kind: "app",
          powerIntent: "ON",
          agentIntent: "OFF",
          runtimeState: "RUNNING",
          agentState: "IDLE",
          lastOutcome: null,
          previewHealth: "UNKNOWN",
          previewUrl: null,
          containerName: "preview-project",
        }],
      });

    const result = await createProjectSecret("project-1", "TELEGRAM_BOT_TOKEN", "secret-value");

    expect(result).toEqual({ success: true });
    expect(restartContainerInternal).toHaveBeenCalledWith("project-1", INTERNAL_ACTION_TOKEN);
  });

  it("resets project and component retry metadata when secrets unblock provisioning", async () => {
    vi.mocked((prisma as any).projectSecret.create).mockResolvedValue({ id: "secret-1" });
    vi.mocked((prisma as any).project.findUnique)
      .mockResolvedValueOnce({
        proposalId: "proposal-1",
        requiredSecrets: JSON.stringify([{ key: "TELEGRAM_BOT_TOKEN", blocking: true }]),
        secrets: [{ key: "TELEGRAM_BOT_TOKEN" }],
      })
      .mockResolvedValueOnce({
        proposalId: "proposal-1",
        lastError: "Missing required secret: TELEGRAM_BOT_TOKEN",
      })
      .mockResolvedValueOnce({
        containerName: null,
        status: "PROVISIONING",
        components: [{
          kind: "app",
          powerIntent: "ON",
          runtimeState: "ABSENT",
          agentState: "IDLE",
        }],
      });
    vi.mocked(requirePrimaryComponentRow as any).mockResolvedValue({
      projectId: "project-1",
      componentId: "cmp-1",
      powerIntent: "ON",
      runtimeState: "ABSENT",
      agentState: "IDLE",
      blockers: ["SECRETS"],
      lastOutcome: null,
      lastOutcomeAt: null,
      retryAt: null,
      previewHealth: "UNKNOWN",
      previewCheckedAt: null,
      provisionedAt: null,
      containerName: null,
      previewUrl: null,
      workerHost: "local",
      vpsHostId: null,
      lastHeartbeat: null,
      retryCount: 4,
      archivedAt: null,
    });
    vi.mocked(applyStateChange as any).mockResolvedValue({});

    const projectUpdate = vi.fn().mockResolvedValue({ id: "project-1" });
    vi.mocked((prisma as any).$transaction).mockImplementation(async (cb: any) => {
      const tx = {
        project: {
          findUnique: vi.fn().mockResolvedValue({ tgSpecSourceProjectId: null }),
          update: projectUpdate,
        },
        runLog: {
          create: vi.fn().mockResolvedValue({}),
        },
      };
      return cb(tx);
    });

    const result = await createProjectSecret("project-1", "TELEGRAM_BOT_TOKEN", "secret-value");

    expect(result).toEqual({ success: true });
    expect(projectUpdate).not.toHaveBeenCalled();
    expect(resetComponentForFreshStart).toHaveBeenCalledWith(
      expect.anything(),
      "project-1",
      expect.objectContaining({
        source: "system",
        trigger: "secrets_provided",
      }),
    );
    expect(updateComponentMetadata).not.toHaveBeenCalled();
  });

  it("resets stale running runtime identity to a claimable tuple after secrets are provided", async () => {
    vi.mocked((prisma as any).projectSecret.create).mockResolvedValue({ id: "secret-1" });
    vi.mocked((prisma as any).project.findUnique).mockReset();
    vi.mocked((prisma as any).project.findUnique)
      .mockResolvedValueOnce({
        proposalId: "proposal-1",
        requiredSecrets: JSON.stringify([{ key: "TELEGRAM_BOT_TOKEN", blocking: true }]),
        secrets: [{ key: "TELEGRAM_BOT_TOKEN" }],
      })
      .mockResolvedValueOnce({
        containerName: null,
        components: [{
          kind: "app",
          powerIntent: "ON",
          runtimeState: "ABSENT",
          agentState: "IDLE",
          lastOutcome: null,
        }],
      });
    vi.mocked(requirePrimaryComponentRow as any).mockResolvedValue({
      projectId: "project-1",
      componentId: "cmp-1",
      powerIntent: "ON",
      runtimeState: "RUNNING",
      agentState: "RUNNING",
      blockers: ["SECRETS"],
      lastOutcome: null,
      lastOutcomeAt: null,
      retryAt: new Date("2026-04-16T08:00:00.000Z"),
      previewHealth: "UNKNOWN",
      previewCheckedAt: null,
      provisionedAt: new Date("2026-04-16T07:00:00.000Z"),
      containerName: null,
      previewUrl: null,
      workerHost: null,
      vpsHostId: null,
      lastHeartbeat: null,
      retryCount: 2,
      archivedAt: null,
    });
    vi.mocked(applyStateChange as any).mockResolvedValue({});

    const projectUpdate = vi.fn().mockResolvedValue({ id: "project-1" });
    vi.mocked((prisma as any).$transaction).mockImplementation(async (cb: any) => {
      const tx = {
        project: {
          findUnique: vi.fn().mockResolvedValue({ tgSpecSourceProjectId: null }),
          update: projectUpdate,
        },
        runLog: {
          create: vi.fn().mockResolvedValue({}),
        },
      };
      return cb(tx);
    });

    const result = await createProjectSecret("project-1", "TELEGRAM_BOT_TOKEN", "secret-value");

    expect(result).toEqual({ success: true });
    expect(projectUpdate).not.toHaveBeenCalled();
    expect(applyStateChange).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      "project-1",
      { type: "removeBlocker", blocker: "SECRETS" },
      expect.objectContaining({
        source: "admin",
        trigger: "secrets_provided",
      }),
    );
    expect(resetComponentForFreshStart).toHaveBeenCalledWith(
      expect.anything(),
      "project-1",
      expect.objectContaining({
        source: "system",
        trigger: "secrets_provided",
      }),
    );
  });

  it("skips recovery resets when no primary component row is available", async () => {
    vi.mocked((prisma as any).projectSecret.create).mockResolvedValue({ id: "secret-1" });
    vi.mocked((prisma as any).project.findUnique)
      .mockResolvedValueOnce({
        proposalId: "proposal-1",
        requiredSecrets: JSON.stringify([{ key: "TELEGRAM_BOT_TOKEN", blocking: true }]),
        secrets: [{ key: "TELEGRAM_BOT_TOKEN" }],
      })
      .mockResolvedValueOnce({
        containerName: null,
        components: [],
      });
    vi.mocked(requirePrimaryComponentRow as any).mockResolvedValue(null);

    const result = await createProjectSecret("project-1", "TELEGRAM_BOT_TOKEN", "secret-value");

    expect(result).toEqual({ success: true });
    expect(applyStateChange).not.toHaveBeenCalled();
    expect(resetComponentForFreshStart).not.toHaveBeenCalled();
    expect(updateComponentMetadata).not.toHaveBeenCalled();
  });

  it("does not auto-resume a paused run when runtime guard rejects user-provider resume", async () => {
    vi.mocked(requireProjectRuntimeActionAccess).mockResolvedValue({
      success: false,
      error: "Platform Credits project requires a funded budget.",
    });
    vi.mocked((prisma as any).projectSecret.create).mockResolvedValue({ id: "secret-1" });
    vi.mocked((prisma as any).project.findUnique)
      .mockResolvedValueOnce({
        proposalId: "proposal-1",
        requiredSecrets: JSON.stringify([{ key: "TELEGRAM_BOT_TOKEN", blocking: true }]),
        secrets: [{ key: "TELEGRAM_BOT_TOKEN" }],
      })
      .mockResolvedValueOnce({
        containerName: null,
        components: [{
          kind: "app",
          powerIntent: "ON",
          runtimeState: "ABSENT",
          agentState: "IDLE",
          lastOutcome: null,
        }],
      });
    vi.mocked(requirePrimaryComponentRow as any).mockResolvedValue({
      projectId: "project-1",
      componentId: "cmp-1",
      powerIntent: "ON",
      runtimeState: "ABSENT",
      agentState: "IDLE",
      blockers: ["SECRETS"],
      lastOutcome: null,
      lastOutcomeAt: null,
      retryAt: null,
      previewHealth: "UNKNOWN",
      previewCheckedAt: null,
      provisionedAt: null,
      containerName: null,
      previewUrl: null,
      workerHost: "local",
      vpsHostId: null,
      lastHeartbeat: null,
      retryCount: 0,
      archivedAt: null,
    });

    const result = await createProjectSecret("project-1", "TELEGRAM_BOT_TOKEN", "secret-value");

    expect(result).toEqual({ success: true });
    expect(applyStateChange).not.toHaveBeenCalled();
    expect(resetComponentForFreshStart).not.toHaveBeenCalled();
    expect(restartContainerInternal).not.toHaveBeenCalled();
  });
});
