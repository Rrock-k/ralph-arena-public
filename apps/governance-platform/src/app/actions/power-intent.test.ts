import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    project: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    runtimeIntent: {
      deleteMany: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/project-state-effects", () => ({
  applyStateChange: vi.fn(),
  requirePrimaryComponentRow: vi.fn(),
  updateComponentMetadata: vi.fn(),
}));

vi.mock("@/lib/project-access", () => ({
  requireProjectCapability: vi.fn(),
}));

vi.mock("@/lib/platform-access", () => ({
  resolvePlatformAccess: vi.fn().mockResolvedValue({
    hasCapability: vi.fn(() => false),
  }),
}));

vi.mock("@/lib/user-launch-policy", () => ({
  enforceUserLaunchPolicy: vi.fn().mockResolvedValue({ allowed: true }),
  getUserByokAuthModeUpdate: vi.fn((agent: string) => (
    agent === "codex"
      ? { claudeAuthMode: null, codexAuthMode: "api_key" }
      : agent === "claude-code"
        ? { claudeAuthMode: "api_key", codexAuthMode: null }
        : {}
  )),
}));

vi.mock("@/lib/project-budget", () => ({
  enforceRequiredProjectBudget: vi.fn().mockResolvedValue({ allowed: true }),
}));

vi.mock("@/lib/progress-bus", () => ({
  notifyProjectChanged: vi.fn(),
  notifyProjectEvent: vi.fn(),
}));

import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { applyStateChange, requirePrimaryComponentRow, updateComponentMetadata } from "@/lib/project-state-effects";
import { requireProjectCapability } from "@/lib/project-access";
import { notifyProjectChanged, notifyProjectEvent } from "@/lib/progress-bus";
import { INTERNAL_ACTION_TOKEN } from "@/lib/internal-action-token";
import { setPowerIntent, setPowerIntentInternal } from "./power-intent";

function buildRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
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
    containerName: "preview-project-1",
    previewUrl: "https://preview.example.com",
    workerHost: "local",
    vpsHostId: null,
    lastHeartbeat: null,
    retryCount: 0,
    archivedAt: null,
    tgSpecLastImportedVersion: 1,
    sourceConfig: null,
    ...overrides,
  };
}

describe("power intent actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.project.findUnique as any).mockResolvedValue({
      id: "project-1",
      archivedAt: null,
      commitSha: null,
    });
    vi.mocked(prisma.project.update as any).mockResolvedValue({ id: "project-1" });
    vi.mocked(requirePrimaryComponentRow as any).mockResolvedValue(buildRow());
    vi.mocked(prisma.$transaction as any).mockImplementation(async (cb: any) => cb(prisma));
    vi.mocked(applyStateChange as any).mockResolvedValue({});
    vi.mocked(updateComponentMetadata as any).mockResolvedValue({});
    vi.mocked(requireProjectCapability as any).mockResolvedValue({ authorized: true } as any);
  });

  it("blocks direct internal calls without trusted server token", async () => {
    const result = await setPowerIntentInternal("project-1", "ON");

    expect(result).toEqual({
      success: false,
      error: "Internal action is not callable directly.",
    });
    expect(requirePrimaryComponentRow).not.toHaveBeenCalled();
  });

  it("turning app OFF also forces agentIntent=OFF", async () => {
    const result = await setPowerIntentInternal("project-1", "OFF", INTERNAL_ACTION_TOKEN);

    expect(result).toEqual({ success: true });
    expect(applyStateChange).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      "project-1",
      { type: "agentIntent", intent: "OFF" },
      {
        source: "admin",
        trigger: "power_off_agent_intent",
        reason: "power off forces agentIntent=OFF",
      },
    );
    expect(applyStateChange).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      "project-1",
      { type: "power", intent: "OFF" },
      {
        source: "admin",
        trigger: "power_off",
        reason: "user set powerIntent=OFF",
      },
    );
    expect(updateComponentMetadata).toHaveBeenCalledWith(
      expect.anything(),
      "project-1",
      {
        previewHealth: "UNKNOWN",
        previewCheckedAt: null,
      },
      expect.objectContaining({
        trigger: "power_off",
      }),
    );
    expect(revalidatePath).toHaveBeenCalledWith("/admin");
    expect(revalidatePath).toHaveBeenCalledWith("/my");
    expect(revalidatePath).toHaveBeenCalledWith("/my/projects/project-1");
    expect(revalidatePath).toHaveBeenCalledWith("/projects/project-1");
    expect(notifyProjectChanged).toHaveBeenCalledWith("project-1");
    expect(notifyProjectEvent).toHaveBeenCalledWith("project-1", {
      type: "project_event",
      status: "POWER_OFF",
    });
  });

  it("normalizes legacy OFF + agentIntent=ON tuple instead of nooping", async () => {
    vi.mocked(requirePrimaryComponentRow as any).mockResolvedValue(buildRow({
      powerIntent: "OFF",
      agentIntent: "ON",
      runtimeState: "ABSENT",
      agentState: "IDLE",
    }));

    const result = await setPowerIntentInternal("project-1", "OFF", INTERNAL_ACTION_TOKEN);

    expect(result).toEqual({ success: true });
    expect(applyStateChange).toHaveBeenCalledTimes(1);
    expect(applyStateChange).toHaveBeenCalledWith(
      expect.anything(),
      "project-1",
      { type: "agentIntent", intent: "OFF" },
      expect.objectContaining({
        trigger: "power_off_agent_intent",
      }),
    );
    expect(updateComponentMetadata).not.toHaveBeenCalled();
    expect(notifyProjectChanged).toHaveBeenCalledWith("project-1");
    expect(notifyProjectEvent).toHaveBeenCalledWith("project-1", {
      type: "project_event",
      status: "POWER_OFF",
    });
  });

  it("allows app OFF while agent is RUNNING and parks via power+agent intents", async () => {
    vi.mocked(requirePrimaryComponentRow as any).mockResolvedValue(buildRow({
      agentState: "RUNNING",
    }));

    const result = await setPowerIntentInternal("project-1", "OFF", INTERNAL_ACTION_TOKEN);

    expect(result).toEqual({ success: true });
    expect(applyStateChange).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      "project-1",
      { type: "agentIntent", intent: "OFF" },
      expect.objectContaining({
        trigger: "power_off_agent_intent",
      }),
    );
    expect(applyStateChange).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      "project-1",
      { type: "power", intent: "OFF" },
      expect.objectContaining({
        trigger: "power_off",
      }),
    );
    expect(notifyProjectChanged).toHaveBeenCalledWith("project-1");
    expect(notifyProjectEvent).toHaveBeenCalledWith("project-1", {
      type: "project_event",
      status: "POWER_OFF",
    });
  });

  it("normalizes already-absent parked rows back to IDLE on explicit App OFF", async () => {
    vi.mocked(requirePrimaryComponentRow as any).mockResolvedValue(buildRow({
      powerIntent: "ON",
      agentIntent: "OFF",
      runtimeState: "ABSENT",
      agentState: "PAUSED",
      blockers: ["INFRA"],
      previewHealth: "UNHEALTHY",
    }));

    const result = await setPowerIntentInternal("project-1", "OFF", INTERNAL_ACTION_TOKEN);

    expect(result).toEqual({ success: true });
    expect(applyStateChange).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      "project-1",
      { type: "power", intent: "OFF" },
      {
        source: "admin",
        trigger: "power_off",
        reason: "user set powerIntent=OFF",
      },
    );
    expect(applyStateChange).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      "project-1",
      { type: "removeBlocker", blocker: "INFRA" },
      {
        source: "system",
        trigger: "power_off_normalize_parked_absent",
        reason: "explicit power off normalizes already-absent parked rows back to IDLE",
      },
    );
    expect(applyStateChange).toHaveBeenNthCalledWith(
      3,
      expect.anything(),
      "project-1",
      { type: "runtimeObserved", state: "ABSENT" },
      {
        source: "system",
        trigger: "power_off_normalize_parked_absent",
        reason: "explicit power off normalizes already-absent parked rows back to IDLE",
      },
    );
    expect(updateComponentMetadata).toHaveBeenCalledWith(
      expect.anything(),
      "project-1",
      {
        provisionedAt: null,
        retryAt: null,
        retryCount: 0,
        previewHealth: "UNKNOWN",
        previewCheckedAt: null,
        containerName: null,
        previewUrl: null,
        workerHost: null,
        lastHeartbeat: null,
      },
      {
        source: "system",
        trigger: "power_off_normalize_parked_absent",
        reason: "explicit power off normalizes already-absent parked rows back to IDLE",
      },
    );
  });

  it("clears stale parked baggage on explicit App OFF without reopening lifecycle work", async () => {
    vi.mocked(requirePrimaryComponentRow as any).mockResolvedValue(buildRow({
      powerIntent: "OFF",
      agentIntent: "OFF",
      runtimeState: "ABSENT",
      agentState: "IDLE",
      blockers: ["INFRA"],
      retryAt: new Date("2026-04-23T10:25:41.005Z"),
      retryCount: 1,
      previewHealth: "UNHEALTHY",
      previewCheckedAt: new Date("2026-04-23T10:23:41.005Z"),
      lastHeartbeat: new Date("2026-04-23T10:23:39.049Z"),
    }));

    const result = await setPowerIntentInternal("project-1", "OFF", INTERNAL_ACTION_TOKEN);

    expect(result).toEqual({ success: true });
    expect(applyStateChange).toHaveBeenCalledTimes(1);
    expect(applyStateChange).toHaveBeenCalledWith(
      expect.anything(),
      "project-1",
      { type: "removeBlocker", blocker: "INFRA" },
      {
        source: "system",
        trigger: "power_off_normalize_parked_absent",
        reason: "explicit power off normalizes already-absent parked rows back to IDLE",
      },
    );
    expect(updateComponentMetadata).toHaveBeenCalledWith(
      expect.anything(),
      "project-1",
      {
        provisionedAt: null,
        retryAt: null,
        retryCount: 0,
        previewHealth: "UNKNOWN",
        previewCheckedAt: null,
        containerName: null,
        previewUrl: null,
        workerHost: null,
        lastHeartbeat: null,
      },
      {
        source: "system",
        trigger: "power_off_normalize_parked_absent",
        reason: "explicit power off normalizes already-absent parked rows back to IDLE",
      },
    );
  });

  it("does not resurrect agentIntent on a later power ON", async () => {
    vi.mocked(requirePrimaryComponentRow as any).mockResolvedValue(buildRow({
      powerIntent: "OFF",
      agentIntent: "OFF",
      runtimeState: "ABSENT",
      agentState: "IDLE",
    }));

    const result = await setPowerIntentInternal("project-1", "ON", INTERNAL_ACTION_TOKEN);

    expect(result).toEqual({ success: true });
    expect(applyStateChange).toHaveBeenCalledTimes(1);
    expect(applyStateChange).toHaveBeenCalledWith(
      expect.anything(),
      "project-1",
      { type: "power", intent: "ON" },
      {
        source: "admin",
        trigger: "power_on",
        reason: "user set powerIntent=ON",
      },
    );
    expect(notifyProjectChanged).toHaveBeenCalledWith("project-1");
    expect(notifyProjectEvent).toHaveBeenCalledWith("project-1", {
      type: "project_event",
      status: "POWER_ON",
    });
  });

  it("restores a parked completed preview without clearing the completed outcome", async () => {
    vi.mocked(requirePrimaryComponentRow as any).mockResolvedValue(buildRow({
      powerIntent: "OFF",
      agentIntent: "OFF",
      runtimeState: "ABSENT",
      agentState: "IDLE",
      lastOutcome: "COMPLETED",
      blockers: [],
      previewHealth: "UNKNOWN",
      previewCheckedAt: new Date("2026-04-19T03:05:00.000Z"),
    }));

    const result = await setPowerIntentInternal("project-1", "ON", INTERNAL_ACTION_TOKEN);

    expect(result).toEqual({ success: true });
    expect(applyStateChange).toHaveBeenCalledTimes(1);
    expect(applyStateChange).toHaveBeenCalledWith(
      expect.anything(),
      "project-1",
      { type: "power", intent: "ON" },
      {
        source: "admin",
        trigger: "power_on",
        reason: "user set powerIntent=ON",
      },
    );
    expect(updateComponentMetadata).not.toHaveBeenCalled();
    expect(prisma.project.update).not.toHaveBeenCalled();
    expect(notifyProjectChanged).toHaveBeenCalledWith("project-1");
    expect(notifyProjectEvent).toHaveBeenCalledWith("project-1", {
      type: "project_event",
      status: "POWER_ON",
    });
  });

  it("allows power ON for failed rows so restart can flow through ordinary intents", async () => {
    vi.mocked(requirePrimaryComponentRow as any).mockResolvedValue(buildRow({
      powerIntent: "OFF",
      runtimeState: "ABSENT",
      agentState: "FAILED",
      lastOutcome: "FAILED",
    }));

    const result = await setPowerIntentInternal("project-1", "ON", INTERNAL_ACTION_TOKEN);

    expect(result).toEqual({ success: true });
    expect(applyStateChange).toHaveBeenCalledTimes(1);
    expect(applyStateChange).toHaveBeenCalledWith(
      expect.anything(),
      "project-1",
      { type: "power", intent: "ON" },
      expect.objectContaining({
        trigger: "power_on",
      }),
    );
    expect(notifyProjectEvent).toHaveBeenCalledWith("project-1", {
      type: "project_event",
      status: "POWER_ON",
    });
  });

  it("clears stale INFRA retry baggage on explicit power ON", async () => {
    vi.mocked(requirePrimaryComponentRow as any).mockResolvedValue(buildRow({
      powerIntent: "OFF",
      runtimeState: "ABSENT",
      agentState: "IDLE",
      blockers: ["INFRA"],
      retryAt: new Date("2026-04-19T02:00:00.000Z"),
      retryCount: 4,
    }));

    const result = await setPowerIntentInternal("project-1", "ON", INTERNAL_ACTION_TOKEN);

    expect(result).toEqual({ success: true });
    expect(applyStateChange).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      "project-1",
      { type: "removeBlocker", blocker: "INFRA" },
      {
        source: "admin",
        trigger: "power_on_clear_stale_infra",
        reason: "explicit power on clears stale INFRA baggage before restart",
      },
    );
    expect(updateComponentMetadata).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      "project-1",
      {
        retryAt: null,
        retryCount: 0,
        previewHealth: "UNKNOWN",
        previewCheckedAt: null,
      },
      {
        source: "admin",
        trigger: "power_on_clear_stale_infra",
        reason: "explicit power on clears stale INFRA baggage before restart",
      },
    );
    expect(applyStateChange).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      "project-1",
      { type: "power", intent: "ON" },
      expect.objectContaining({
        trigger: "power_on",
      }),
    );
  });

  it("allows App ON for pinned loop rows so preview restore can proceed", async () => {
    vi.mocked(prisma.project.findUnique as any)
      .mockResolvedValueOnce({
        id: "project-1",
        archivedAt: null,
      })
      .mockResolvedValueOnce({
        agentImpl: "ralph",
        agentLoopVersionId: "ralph-v150",
        agentLoopVersion: {
          version: "1.5.0",
          supportTier: "supported",
          agentLoop: {
            name: "ralph",
          },
        },
        components: [{ runtimeConfig: {} }],
      });

    const result = await setPowerIntentInternal("project-1", "ON", INTERNAL_ACTION_TOKEN);

    expect(result.success).toBe(true);
    expect(requirePrimaryComponentRow).toHaveBeenCalled();
  });

  it("reopens absent idle preview claim on explicit App ON without requiring recreate_runtime", async () => {
    vi.mocked(prisma.project.findUnique as any).mockResolvedValue({
      id: "project-1",
      archivedAt: null,
      commitSha: "old-commit-sha",
    });
    vi.mocked(requirePrimaryComponentRow as any).mockResolvedValue(buildRow({
      powerIntent: "ON",
      agentIntent: "OFF",
      runtimeState: "ABSENT",
      agentState: "IDLE",
      blockers: [],
      retryAt: new Date("2026-04-19T03:00:00.000Z"),
      retryCount: 2,
      previewHealth: "UNHEALTHY",
      previewCheckedAt: new Date("2026-04-19T03:05:00.000Z"),
    }));

    const result = await setPowerIntentInternal("project-1", "ON", INTERNAL_ACTION_TOKEN);

    expect(result).toEqual({ success: true });
    expect(prisma.project.update).toHaveBeenCalledWith({
      where: { id: "project-1" },
      data: { commitSha: null },
    });
    expect((prisma as any).runtimeIntent.deleteMany).toHaveBeenCalledWith({
      where: {
        componentId: "cmp-1",
        action: "ensure_running",
        state: { in: ["FAILED", "ABANDONED"] },
      },
    });
    expect(updateComponentMetadata).toHaveBeenCalledWith(
      expect.anything(),
      "project-1",
      {
        retryAt: null,
        retryCount: 0,
        previewHealth: "UNKNOWN",
        previewCheckedAt: null,
      },
      {
        source: "admin",
        trigger: "power_on_clear_preview_commit_pin",
        reason: "explicit power on refreshes preview-only rows from branch head instead of archived snapshot",
      },
    );
    expect(applyStateChange).not.toHaveBeenCalled();
    expect(notifyProjectEvent).toHaveBeenCalledWith("project-1", {
      type: "project_event",
      status: "POWER_ON",
    });
  });

  it("reopens paused INFRA preview claim on explicit App ON in one step", async () => {
    vi.mocked(requirePrimaryComponentRow as any).mockResolvedValue(buildRow({
      powerIntent: "ON",
      agentIntent: "OFF",
      runtimeState: "ABSENT",
      agentState: "IDLE",
      blockers: ["INFRA"],
      retryAt: new Date("2026-04-19T03:00:00.000Z"),
      retryCount: 3,
      previewHealth: "UNHEALTHY",
      previewCheckedAt: new Date("2026-04-19T03:05:00.000Z"),
    }));

    const result = await setPowerIntentInternal("project-1", "ON", INTERNAL_ACTION_TOKEN);

    expect(result).toEqual({ success: true });
    expect(applyStateChange).toHaveBeenCalledTimes(1);
    expect(applyStateChange).toHaveBeenCalledWith(
      expect.anything(),
      "project-1",
      { type: "removeBlocker", blocker: "INFRA" },
      {
        source: "admin",
        trigger: "power_on_clear_stale_infra",
        reason: "explicit power on clears stale INFRA baggage before restart",
      },
    );
    expect((prisma as any).runtimeIntent.deleteMany).toHaveBeenCalledWith({
      where: {
        componentId: "cmp-1",
        action: "ensure_running",
        state: { in: ["FAILED", "ABANDONED"] },
      },
    });
    expect(updateComponentMetadata).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      "project-1",
      {
        retryAt: null,
        retryCount: 0,
        previewHealth: "UNKNOWN",
        previewCheckedAt: null,
      },
      {
        source: "admin",
        trigger: "power_on_clear_stale_infra",
        reason: "explicit power on clears stale INFRA baggage before restart",
      },
    );
    expect(updateComponentMetadata).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      "project-1",
      {
        retryAt: null,
        retryCount: 0,
        previewHealth: "UNKNOWN",
        previewCheckedAt: null,
      },
      {
        source: "admin",
        trigger: "power_on_reopen_start_claim",
        reason: "explicit power on reopens preview/bootstrap start claim for absent idle runtime",
      },
    );
    expect(notifyProjectChanged).toHaveBeenCalledWith("project-1");
    expect(notifyProjectEvent).toHaveBeenCalledWith("project-1", {
      type: "project_event",
      status: "POWER_ON",
    });
  });

  it("enforces capability gate in public action", async () => {
    vi.mocked(requireProjectCapability as any).mockResolvedValue({
      authorized: false,
      error: "Forbidden",
    } as any);

    const result = await setPowerIntent("project-1", "OFF");

    expect(result).toEqual({ success: false, error: "Forbidden" });
    expect(applyStateChange).not.toHaveBeenCalled();
  });

  it("blocks App ON while a tg-spec target is still waiting for its first import", async () => {
    vi.mocked(requirePrimaryComponentRow as any).mockResolvedValue(buildRow({
      powerIntent: "OFF",
      agentIntent: "OFF",
      runtimeState: "ABSENT",
      agentState: "IDLE",
      sourceConfig: { recipe: "tg_spec_target" },
      tgSpecLastImportedVersion: null,
    }));

    const result = await setPowerIntentInternal("project-1", "ON", INTERNAL_ACTION_TOKEN);

    expect(result).toEqual({
      success: false,
      error: "TG-Spec target is waiting for the first imported spec from Evolution",
    });
    expect(applyStateChange).not.toHaveBeenCalled();
  });
});
