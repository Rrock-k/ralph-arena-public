import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: vi.fn(),
    project: { findUnique: vi.fn(), updateMany: vi.fn(), update: vi.fn() },
    projectAsset: { findMany: vi.fn() },
    projectBudget: { updateMany: vi.fn() },
    projectComponent: { update: vi.fn() },
    runLog: { create: vi.fn() },
  },
}));

vi.mock("@/lib/progress-bus", () => ({
  notifyProjectEvent: vi.fn(),
}));

vi.mock("@/lib/internal-auth", () => ({
  isRunnerAuthorized: vi.fn(),
}));

vi.mock("@/lib/project-state-effects", () => ({
  requirePrimaryComponentRow: vi.fn(),
  applyStateChange: vi.fn(),
  updateComponentMetadata: vi.fn(),
}));

vi.mock("@/lib/project-identity", () => ({
  getProjectProposalPath: vi.fn(() => null),
}));

vi.mock("@/lib/notifications", () => ({
  notify: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/project-update-outbox", () => ({
  enqueueProjectUpdate: vi.fn(),
}));

vi.mock("@/lib/project-telegram-mini-app-url", () => ({
  resolveProjectTelegramMiniAppEntryUrl: vi.fn().mockResolvedValue(null),
}));

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { notifyProjectEvent } from "@/lib/progress-bus";
import { isRunnerAuthorized } from "@/lib/internal-auth";
import { notify } from "@/lib/notifications";
import { applyStateChange, updateComponentMetadata, requirePrimaryComponentRow } from "@/lib/project-state-effects";
import { enqueueProjectUpdate } from "@/lib/project-update-outbox";
import { resolveProjectTelegramMiniAppEntryUrl } from "@/lib/project-telegram-mini-app-url";

describe("POST /api/internal/projects/:id/terminal", () => {
  const originalPreviewDomain = process.env.PREVIEW_DOMAIN;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isRunnerAuthorized).mockReturnValue(true);
    vi.mocked(resolveProjectTelegramMiniAppEntryUrl).mockResolvedValue(null);
    process.env.PREVIEW_DOMAIN = originalPreviewDomain;
    vi.mocked(prisma.$transaction as any).mockImplementation(async (callback: (tx: typeof prisma) => Promise<unknown>) => callback(prisma as any));
    vi.mocked(prisma.project.findUnique as any)
      .mockResolvedValueOnce({
        id: "proj-1",
        name: "Project 1",
        archivedAt: null,
        previewUrl: null,
        proposalId: null,
        budgetDebitedUsd: 0,
        estimatedCostUsd: null,
        components: [{ agentState: "IDLE" }],
      })
      .mockResolvedValueOnce({ log: null });
    vi.mocked(prisma.project.updateMany as any).mockResolvedValue({ count: 1 });
    vi.mocked(prisma.projectComponent.update as any).mockResolvedValue({});
    vi.mocked(prisma.runLog.create as any).mockResolvedValue({});
    vi.mocked((prisma as any).projectAsset.findMany).mockResolvedValue([]);
    vi.mocked(prisma.projectBudget.updateMany as any).mockResolvedValue({});
    vi.mocked(prisma.project.update as any).mockResolvedValue({});

    const state: Record<string, unknown> = {
      projectId: "proj-1",
      componentId: "cmp-1",
      powerIntent: "ON",
      agentIntent: "ON",
      runtimeState: "ABSENT",
      agentState: "IDLE",
      blockers: [],
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
    };

    vi.mocked(requirePrimaryComponentRow as any).mockImplementation(async () => ({ ...state }));
    vi.mocked(applyStateChange as any).mockResolvedValue({});
    vi.mocked(updateComponentMetadata as any).mockResolvedValue({});
  });

  afterEach(() => {
    process.env.PREVIEW_DOMAIN = originalPreviewDomain;
  });

  it("rejects unauthorized requests", async () => {
    vi.mocked(isRunnerAuthorized).mockReturnValue(false);

    const res = await POST(
      new Request("http://localhost/api/internal/projects/proj-1/terminal", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ terminalState: "FAILED" }),
      }),
      { params: Promise.resolve({ id: "proj-1" }) },
    );

    expect(res.status).toBe(401);
  });

  it("promotes missing callbacks before applying FAILED terminal transition", async () => {
    const res = await POST(
      new Request("http://localhost/api/internal/projects/proj-1/terminal", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          terminalState: "FAILED",
          reasonCode: "agent_crash",
          reasonMessage: "agent crashed",
          containerName: "preview-proj-1",
          previewUrl: "https://preview.test/proj-1",
          previewActual: "SERVING",
          workerHost: "local",
        }),
      }),
      { params: Promise.resolve({ id: "proj-1" }) },
    );

    expect(res.status).toBe(200);
    expect(applyStateChange).toHaveBeenCalled();
    expect(updateComponentMetadata).toHaveBeenCalledWith(
      expect.anything(),
      "proj-1",
      expect.objectContaining({
        containerName: "preview-proj-1",
        previewUrl: "https://preview.test/proj-1",
        workerHost: "local",
      }),
      expect.any(Object),
    );
    expect(notifyProjectEvent).toHaveBeenCalledWith(
      "proj-1",
      expect.objectContaining({
        type: "terminal",
        status: "FAILED",
      }),
    );
    expect(enqueueProjectUpdate).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        projectId: "proj-1",
        eventType: "work.failed",
        dedupeKey: expect.stringMatching(/^terminal-failed:FAILED:agent_crash:\d{4}-\d{2}-\d{2}T/),
      }),
    );
    const updateCall = vi.mocked(prisma.project.updateMany as any).mock.calls[0][0];
    expect(updateCall.data.lastError).toBeUndefined();
    expect(revalidatePath).toHaveBeenCalled();
  });

  it("keeps actual runtime RUNNING for paused terminal states that stay alive", async () => {
    vi.mocked(prisma.project.findUnique as any).mockReset();
    vi.mocked(prisma.project.findUnique as any)
      .mockResolvedValueOnce({
        id: "proj-1",
        name: "Project 1",
        archivedAt: null,
        previewUrl: null,
        proposalId: null,
        budgetDebitedUsd: 0,
        estimatedCostUsd: null,
        components: [{ agentState: "RUNNING" }],
      })
      .mockResolvedValueOnce({ log: null });

    const state: Record<string, unknown> = {
      projectId: "proj-1",
      componentId: "cmp-1",
      powerIntent: "ON",
      agentIntent: "ON",
      runtimeState: "RUNNING",
      agentState: "RUNNING",
      blockers: [],
      lastOutcome: null,
      lastOutcomeAt: null,
      retryAt: null,
      previewHealth: "UNKNOWN",
      previewCheckedAt: null,
      provisionedAt: null,
      containerName: "preview-proj-1",
      previewUrl: "https://preview.example.com",
      workerHost: "local",
      vpsHostId: null,
      lastHeartbeat: null,
      retryCount: 0,
      archivedAt: null,
    };
    vi.mocked(requirePrimaryComponentRow as any).mockImplementation(async () => ({ ...state }));
    vi.mocked(applyStateChange as any).mockResolvedValue({});
    vi.mocked(updateComponentMetadata as any).mockResolvedValue({});

    const res = await POST(
      new Request("http://localhost/api/internal/projects/proj-1/terminal", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          terminalState: "CANCELED",
          pauseReason: "RATE_LIMIT",
          reasonCode: "provider_429",
          reasonMessage: "rate limited",
          retryAt: "2026-04-19T09:00:00.000Z",
        }),
      }),
      { params: Promise.resolve({ id: "proj-1" }) },
    );

    expect(res.status).toBe(200);
    expect(applyStateChange).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      "proj-1",
      { type: "agentTransition", state: "IDLE" },
      expect.objectContaining({ source: "runner", trigger: "terminal_pause" }),
    );
    expect(applyStateChange).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      "proj-1",
      { type: "addBlocker", blocker: "RATE_LIMIT" },
      expect.objectContaining({ source: "system", trigger: "terminal_pause" }),
    );
    expect(updateComponentMetadata).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      "proj-1",
      expect.objectContaining({
        retryCount: 1,
        retryAt: expect.any(Date),
      }),
      expect.objectContaining({ source: "runner", trigger: "terminal_pause" }),
    );
    expect(updateComponentMetadata).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      "proj-1",
      expect.objectContaining({
        retryAt: new Date("2026-04-19T09:00:00.000Z"),
      }),
      expect.objectContaining({ source: "runner", trigger: "terminal_pause_retry_at" }),
    );
    expect(updateComponentMetadata).toHaveBeenNthCalledWith(
      3,
      expect.anything(),
      "proj-1",
      expect.objectContaining({
        lastHeartbeat: expect.any(Date),
      }),
      expect.objectContaining({ trigger: "terminal_metadata" }),
    );
    expect(enqueueProjectUpdate).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        projectId: "proj-1",
        eventType: "action.required",
        payload: expect.objectContaining({
          reasonCode: "RATE_LIMIT",
          summary: "rate limited",
        }),
      }),
    );
    expect(enqueueProjectUpdate).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ eventType: "work.failed" }),
    );
    const updateCall = vi.mocked(prisma.project.updateMany as any).mock.calls[0][0];
    expect(updateCall.data.finishedAt).toBeUndefined();
    expect(updateCall.data.lastError).toBeUndefined();
  });

  it("derives provider retryAt from rate-limit reason text when structured retryAt is omitted", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-11T22:24:34.703Z"));
    try {
      const res = await POST(
        new Request("http://localhost/api/internal/projects/proj-1/terminal", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            terminalState: "CANCELED",
            pauseReason: "RATE_LIMIT",
            reasonCode: "provider_429",
            reasonMessage: "You've hit your session limit · resets 1:20am (UTC)",
          }),
        }),
        { params: Promise.resolve({ id: "proj-1" }) },
      );

      expect(res.status).toBe(200);
      expect(updateComponentMetadata).toHaveBeenCalledWith(
        expect.anything(),
        "proj-1",
        expect.objectContaining({
          retryAt: new Date("2026-06-12T01:20:00.000Z"),
        }),
        expect.objectContaining({ source: "runner", trigger: "terminal_pause_retry_at" }),
      );
      expect(enqueueProjectUpdate).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          projectId: "proj-1",
          eventType: "action.required",
          dedupeKey: "terminal-retryable-pause:RATE_LIMIT:provider_429:2026-06-12T01:20:00.000Z",
          payload: expect.objectContaining({
            reasonCode: "RATE_LIMIT",
            summary: "You've hit your session limit · resets 1:20am (UTC)",
          }),
        }),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("emits action-required instead of completed or failed for auth-stale API pauses", async () => {
    vi.mocked(prisma.project.findUnique as any).mockReset();
    vi.mocked(prisma.project.findUnique as any)
      .mockResolvedValueOnce({
        id: "proj-1",
        name: "Project 1",
        archivedAt: null,
        previewUrl: null,
        proposalId: null,
        budgetDebitedUsd: 0,
        estimatedCostUsd: null,
        components: [{ agentState: "RUNNING" }],
      })
      .mockResolvedValueOnce({ log: null });

    const state: Record<string, unknown> = {
      projectId: "proj-1",
      componentId: "cmp-1",
      powerIntent: "ON",
      agentIntent: "ON",
      runtimeState: "RUNNING",
      agentState: "RUNNING",
      blockers: [],
      lastOutcome: null,
      lastOutcomeAt: null,
      retryAt: null,
      previewHealth: "HEALTHY",
      previewCheckedAt: new Date("2026-06-25T09:00:00.000Z"),
      provisionedAt: null,
      containerName: "preview-proj-1",
      previewUrl: "https://preview.example.com",
      workerHost: "local",
      vpsHostId: null,
      lastHeartbeat: null,
      retryCount: 0,
      archivedAt: null,
    };
    vi.mocked(requirePrimaryComponentRow as any).mockImplementation(async () => ({ ...state }));
    vi.mocked(applyStateChange as any).mockResolvedValue({});
    vi.mocked(updateComponentMetadata as any).mockResolvedValue({});

    const res = await POST(
      new Request("http://localhost/api/internal/projects/proj-1/terminal", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          terminalState: "CANCELED",
          pauseReason: "API",
          reasonCode: "auth_expired",
          reasonMessage: "Auth token expired and no newer auth snapshot is available yet.",
          previewActual: "SERVING",
        }),
      }),
      { params: Promise.resolve({ id: "proj-1" }) },
    );

    expect(res.status).toBe(200);
    expect(applyStateChange).toHaveBeenCalledWith(
      expect.anything(),
      "proj-1",
      { type: "agentTransition", state: "IDLE" },
      expect.objectContaining({ source: "runner", trigger: "terminal_pause" }),
    );
    expect(applyStateChange).toHaveBeenCalledWith(
      expect.anything(),
      "proj-1",
      { type: "addBlocker", blocker: "API" },
      expect.objectContaining({ source: "system", trigger: "terminal_pause" }),
    );
    expect(updateComponentMetadata).toHaveBeenCalledWith(
      expect.anything(),
      "proj-1",
      expect.objectContaining({
        retryCount: 1,
        retryAt: expect.any(Date),
      }),
      expect.objectContaining({ source: "runner", trigger: "terminal_pause" }),
    );
    expect(enqueueProjectUpdate).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        projectId: "proj-1",
        eventType: "action.required",
        dedupeKey: expect.stringMatching(/^terminal-retryable-pause:API:auth_expired:/),
        payload: expect.objectContaining({
          reasonCode: "API",
          summary: "Auth token expired and no newer auth snapshot is available yet.",
        }),
      }),
    );
    expect(enqueueProjectUpdate).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ eventType: "work.completed" }),
    );
    expect(enqueueProjectUpdate).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ eventType: "work.failed" }),
    );
  });

  it("emits action-required instead of completed or failed for Ralph auth-stale INFRA pauses", async () => {
    vi.mocked(prisma.project.findUnique as any).mockReset();
    vi.mocked(prisma.project.findUnique as any)
      .mockResolvedValueOnce({
        id: "proj-1",
        name: "Project 1",
        archivedAt: null,
        previewUrl: null,
        proposalId: null,
        budgetDebitedUsd: 0,
        estimatedCostUsd: null,
        components: [{ agentState: "RUNNING" }],
      })
      .mockResolvedValueOnce({ log: null });

    const state: Record<string, unknown> = {
      projectId: "proj-1",
      componentId: "cmp-1",
      powerIntent: "ON",
      agentIntent: "ON",
      runtimeState: "RUNNING",
      agentState: "RUNNING",
      blockers: [],
      lastOutcome: null,
      lastOutcomeAt: null,
      retryAt: null,
      previewHealth: "HEALTHY",
      previewCheckedAt: new Date("2026-06-25T09:00:00.000Z"),
      provisionedAt: null,
      containerName: "preview-proj-1",
      previewUrl: "https://preview.example.com",
      workerHost: "local",
      vpsHostId: null,
      lastHeartbeat: null,
      retryCount: 0,
      archivedAt: null,
    };
    vi.mocked(requirePrimaryComponentRow as any).mockImplementation(async () => ({ ...state }));
    vi.mocked(applyStateChange as any).mockResolvedValue({});
    vi.mocked(updateComponentMetadata as any).mockResolvedValue({});

    const res = await POST(
      new Request("http://localhost/api/internal/projects/proj-1/terminal", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          terminalState: "CANCELED",
          pauseReason: "INFRA",
          reasonCode: "provider_auth_unavailable",
          reasonMessage: "Provider auth unavailable; refresh credentials before retrying.",
          previewActual: "SERVING",
        }),
      }),
      { params: Promise.resolve({ id: "proj-1" }) },
    );

    expect(res.status).toBe(200);
    expect(applyStateChange).toHaveBeenCalledWith(
      expect.anything(),
      "proj-1",
      { type: "agentTransition", state: "IDLE" },
      expect.objectContaining({ source: "runner", trigger: "terminal_pause" }),
    );
    expect(applyStateChange).toHaveBeenCalledWith(
      expect.anything(),
      "proj-1",
      { type: "addBlocker", blocker: "INFRA" },
      expect.objectContaining({ source: "system", trigger: "terminal_pause" }),
    );
    expect(updateComponentMetadata).toHaveBeenCalledWith(
      expect.anything(),
      "proj-1",
      expect.objectContaining({
        retryCount: 1,
        retryAt: expect.any(Date),
      }),
      expect.objectContaining({ source: "runner", trigger: "terminal_pause" }),
    );
    expect(enqueueProjectUpdate).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        projectId: "proj-1",
        eventType: "action.required",
        dedupeKey: expect.stringMatching(/^terminal-retryable-pause:INFRA:provider_auth_unavailable:/),
        payload: expect.objectContaining({
          reasonCode: "INFRA",
          summary: "Provider auth unavailable; refresh credentials before retrying.",
        }),
      }),
    );
    expect(enqueueProjectUpdate).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ eventType: "work.completed" }),
    );
    expect(enqueueProjectUpdate).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ eventType: "work.failed" }),
    );
  });

  it("gives a second INFRA pause episode on the same day its own notification", async () => {
    // RA-380: the operator recovered from a morning pause and the project worked
    // again; an afternoon pause is new news, not a duplicate of the morning one.
    const runPauseEpisode = async () => {
      vi.mocked(enqueueProjectUpdate).mockClear();
      vi.mocked(prisma.project.findUnique as any).mockReset();
      vi.mocked(prisma.project.findUnique as any)
        .mockResolvedValueOnce({
          id: "proj-1",
          name: "Project 1",
          archivedAt: null,
          previewUrl: null,
          proposalId: null,
          budgetDebitedUsd: 0,
          estimatedCostUsd: null,
          components: [{ agentState: "RUNNING" }],
        })
        .mockResolvedValueOnce({ log: null });

      // Between episodes the blocker was cleared and the agent ran again, so the
      // row arrives unblocked exactly as it did the first time.
      vi.mocked(requirePrimaryComponentRow as any).mockImplementation(async () => ({
        projectId: "proj-1",
        componentId: "cmp-1",
        powerIntent: "ON",
        agentIntent: "ON",
        runtimeState: "RUNNING",
        agentState: "RUNNING",
        blockers: [],
        lastOutcome: null,
        lastOutcomeAt: null,
        retryAt: null,
        previewHealth: "HEALTHY",
        previewCheckedAt: new Date("2026-06-25T09:00:00.000Z"),
        provisionedAt: null,
        containerName: "preview-proj-1",
        previewUrl: "https://preview.example.com",
        workerHost: "local",
        vpsHostId: null,
        lastHeartbeat: null,
        retryCount: 0,
        archivedAt: null,
      }));
      vi.mocked(applyStateChange as any).mockResolvedValue({});
      vi.mocked(updateComponentMetadata as any).mockResolvedValue({});

      const res = await POST(
        new Request("http://localhost/api/internal/projects/proj-1/terminal", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            terminalState: "CANCELED",
            pauseReason: "INFRA",
            reasonCode: "canceled",
            reasonMessage: "Source delivery failed during pre-agent source evidence check.",
            previewActual: "SERVING",
          }),
        }),
        { params: Promise.resolve({ id: "proj-1" }) },
      );
      expect(res.status).toBe(200);

      const call = vi.mocked(enqueueProjectUpdate).mock.calls
        .map(([, update]: any) => update)
        .find((update: any) => update?.eventType === "action.required");
      return call?.dedupeKey as string;
    };

    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-07-30T10:06:32.000Z"));
      const firstKey = await runPauseEpisode();
      vi.setSystemTime(new Date("2026-07-30T14:56:12.000Z"));
      const secondKey = await runPauseEpisode();

      expect(firstKey).toBe("terminal-retryable-pause:INFRA:canceled:2026-07-30T10:06:32.000Z");
      expect(secondKey).toBe("terminal-retryable-pause:INFRA:canceled:2026-07-30T14:56:12.000Z");
    } finally {
      vi.useRealTimers();
    }
  });

  it("parks resource-killed terminal reports as INFRA with forensic diagnostics", async () => {
    vi.mocked(prisma.project.findUnique as any).mockReset();
    vi.mocked(prisma.project.findUnique as any)
      .mockResolvedValueOnce({
        id: "proj-1",
        name: "Project 1",
        archivedAt: null,
        previewUrl: null,
        proposalId: null,
        requiredSecrets: [],
        secrets: [],
        specs: { versions: [] },
        budgetDebitedUsd: 0,
        estimatedCostUsd: null,
        budget: null,
      })
      .mockResolvedValueOnce({ log: null });

    const state: Record<string, unknown> = {
      projectId: "proj-1",
      componentId: "cmp-1",
      powerIntent: "ON",
      agentIntent: "ON",
      runtimeState: "RUNNING",
      agentState: "RUNNING",
      blockers: [],
      lastOutcome: null,
      lastOutcomeAt: null,
      retryAt: null,
      previewHealth: "UNKNOWN",
      previewCheckedAt: null,
      provisionedAt: null,
      containerName: "preview-proj-1",
      previewUrl: "https://preview.example.com",
      workerHost: "local",
      vpsHostId: null,
      lastHeartbeat: null,
      retryCount: 0,
      archivedAt: null,
    };
    vi.mocked(requirePrimaryComponentRow as any).mockImplementation(async () => ({ ...state }));
    vi.mocked(applyStateChange as any).mockResolvedValue({});
    vi.mocked(updateComponentMetadata as any).mockResolvedValue({});

    const forensics = {
      exitCode: 137,
      signal: "SIGKILL",
      lastProgressState: "coding",
      cgroupMemoryEvents: {
        oom: 1,
        oom_kill: 1,
      },
      resourcePressure: {
        constrained: true,
        reasons: ["cgroup_oom_kill"],
      },
    };

    const res = await POST(
      new Request("http://localhost/api/internal/projects/proj-1/terminal", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          terminalState: "CANCELED",
          pauseReason: "INFRA",
          reasonCode: "resource_killed",
          reasonMessage: "Agent loop process was killed by SIGKILL/exit 137 before writing result.json.",
          previewActual: "SERVING",
          forensics,
        }),
      }),
      { params: Promise.resolve({ id: "proj-1" }) },
    );

    expect(res.status).toBe(200);
    expect(applyStateChange).toHaveBeenCalledWith(
      expect.anything(),
      "proj-1",
      { type: "agentTransition", state: "IDLE" },
      expect.objectContaining({
        source: "runner",
        trigger: "terminal_pause",
        diagnostics: {
          terminalForensics: forensics,
        },
      }),
    );
    expect(applyStateChange).toHaveBeenCalledWith(
      expect.anything(),
      "proj-1",
      { type: "addBlocker", blocker: "INFRA" },
      expect.objectContaining({
        source: "system",
        trigger: "terminal_pause",
        diagnostics: {
          terminalForensics: forensics,
        },
      }),
    );
    expect(applyStateChange).not.toHaveBeenCalledWith(
      expect.anything(),
      "proj-1",
      { type: "agentTransition", state: "IDLE", outcome: "FAILED" },
      expect.anything(),
    );
    expect(enqueueProjectUpdate).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        projectId: "proj-1",
        eventType: "action.required",
        payload: expect.objectContaining({
          reasonCode: "INFRA",
          summary: "Agent loop process was killed by SIGKILL/exit 137 before writing result.json.",
        }),
      }),
    );
  });

  it("parks untyped governance stops for active work as retryable INFRA instead of FAILED", async () => {
    vi.mocked(prisma.project.findUnique as any).mockReset();
    vi.mocked(prisma.project.findUnique as any)
      .mockResolvedValueOnce({
        id: "proj-1",
        name: "Project 1",
        archivedAt: null,
        previewUrl: "https://preview.example.com",
        proposalId: null,
        budgetDebitedUsd: 0,
        estimatedCostUsd: null,
        components: [{ agentState: "RUNNING" }],
      })
      .mockResolvedValueOnce({ log: null });

    const state: Record<string, unknown> = {
      projectId: "proj-1",
      componentId: "cmp-1",
      powerIntent: "ON",
      agentIntent: "ON",
      runtimeState: "RUNNING",
      agentState: "RUNNING",
      blockers: [],
      lastOutcome: null,
      lastOutcomeAt: null,
      retryAt: null,
      previewHealth: "HEALTHY",
      previewCheckedAt: new Date("2026-05-30T23:20:00.000Z"),
      provisionedAt: null,
      containerName: "preview-proj-1",
      previewUrl: "https://preview.example.com",
      workerHost: "local",
      vpsHostId: null,
      lastHeartbeat: null,
      retryCount: 2,
      archivedAt: null,
    };
    vi.mocked(requirePrimaryComponentRow as any).mockImplementation(async () => ({ ...state }));
    vi.mocked(applyStateChange as any).mockResolvedValue({});
    vi.mocked(updateComponentMetadata as any).mockResolvedValue({});

    const res = await POST(
      new Request("http://localhost/api/internal/projects/proj-1/terminal", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          terminalState: "CANCELED",
          reasonCode: "stopped_by_governance",
          reasonMessage: "Governance stop: stopped",
          containerName: null,
          workerHost: null,
        }),
      }),
      { params: Promise.resolve({ id: "proj-1" }) },
    );

    expect(res.status).toBe(200);
    expect(applyStateChange).toHaveBeenCalledWith(
      expect.anything(),
      "proj-1",
      { type: "agentTransition", state: "IDLE" },
      expect.objectContaining({ source: "runner", trigger: "terminal_pause" }),
    );
    expect(applyStateChange).toHaveBeenCalledWith(
      expect.anything(),
      "proj-1",
      { type: "addBlocker", blocker: "INFRA" },
      expect.objectContaining({ source: "system", trigger: "terminal_pause" }),
    );
    expect(applyStateChange).toHaveBeenCalledWith(
      expect.anything(),
      "proj-1",
      { type: "runtimeObserved", state: "STOPPED" },
      expect.objectContaining({ source: "runner", trigger: "terminal_stop" }),
    );
    expect(applyStateChange).not.toHaveBeenCalledWith(
      expect.anything(),
      "proj-1",
      { type: "agentTransition", state: "IDLE", outcome: "FAILED" },
      expect.anything(),
    );
    expect(updateComponentMetadata).toHaveBeenCalledWith(
      expect.anything(),
      "proj-1",
      expect.objectContaining({
        retryCount: 3,
        retryAt: expect.any(Date),
      }),
      expect.objectContaining({ source: "runner", trigger: "terminal_pause" }),
    );
    expect(updateComponentMetadata).toHaveBeenCalledWith(
      expect.anything(),
      "proj-1",
      expect.objectContaining({
        previewHealth: "UNKNOWN",
        previewCheckedAt: null,
        previewUrl: null,
        containerName: null,
        workerHost: null,
      }),
      expect.objectContaining({ trigger: "terminal_metadata" }),
    );
    expect(enqueueProjectUpdate).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        projectId: "proj-1",
        eventType: "action.required",
        payload: expect.objectContaining({
          reasonCode: "INFRA",
          summary: "Governance stop: stopped",
        }),
      }),
    );
    expect(notifyProjectEvent).toHaveBeenCalledWith(
      "proj-1",
      expect.objectContaining({
        type: "terminal",
        status: "INFRA",
      }),
    );
  });

  it("parks manual terminal reports as human evidence blockers without retry metadata", async () => {
    const res = await POST(
      new Request("http://localhost/api/internal/projects/proj-1/terminal", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          terminalState: "CANCELED",
          pauseReason: "MANUAL",
          reasonCode: "controller_escalated",
          reasonMessage: "Controller escalation requires production user evidence.",
        }),
      }),
      { params: Promise.resolve({ id: "proj-1" }) },
    );

    expect(res.status).toBe(200);
    expect(applyStateChange).toHaveBeenCalledWith(
      expect.anything(),
      "proj-1",
      { type: "addBlocker", blocker: "MANUAL" },
      expect.objectContaining({ source: "system", trigger: "terminal_pause" }),
    );
    expect(updateComponentMetadata).toHaveBeenCalledWith(
      expect.anything(),
      "proj-1",
      expect.objectContaining({ retryAt: null }),
      expect.objectContaining({ source: "runner", trigger: "terminal_pause" }),
    );
    expect(enqueueProjectUpdate).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        projectId: "proj-1",
        eventType: "work.needs_evidence",
        payload: expect.objectContaining({
          reasonCode: "MANUAL",
          summary: "Controller escalation requires production user evidence.",
        }),
      }),
    );
    expect(enqueueProjectUpdate).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ eventType: "work.failed" }),
    );
  });

  it("surfaces workspace dirty restore blockers as action-required updates", async () => {
    const res = await POST(
      new Request("http://localhost/api/internal/projects/proj-1/terminal", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          terminalState: "CANCELED",
          pauseReason: "MANUAL",
          reasonCode: "workspace_dirty_before_sync",
          reasonMessage: "Workspace has uncommitted changes before repo sync: ?? generated/videos/preview.mp4",
        }),
      }),
      { params: Promise.resolve({ id: "proj-1" }) },
    );

    expect(res.status).toBe(200);
    expect(applyStateChange).toHaveBeenCalledWith(
      expect.anything(),
      "proj-1",
      { type: "addBlocker", blocker: "MANUAL" },
      expect.objectContaining({ source: "system", trigger: "terminal_pause" }),
    );
    expect(enqueueProjectUpdate).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        projectId: "proj-1",
        eventType: "action.required",
        dedupeKey: expect.stringMatching(/^terminal-workspace-dirty-before-sync:\d{4}-\d{2}-\d{2}T[\d:.]+Z$/),
        payload: expect.objectContaining({
          reasonCode: "MANUAL",
          summary: "Workspace has uncommitted changes before repo sync: ?? generated/videos/preview.mp4",
        }),
      }),
    );
    expect(enqueueProjectUpdate).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ eventType: "work.needs_evidence" }),
    );
    expect(enqueueProjectUpdate).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ eventType: "work.failed" }),
    );
  });

  it("does not re-notify an already parked workspace-dirty blocker", async () => {
    const state: Record<string, unknown> = {
      projectId: "proj-1",
      componentId: "cmp-1",
      powerIntent: "ON",
      agentIntent: "ON",
      runtimeState: "RUNNING",
      agentState: "IDLE",
      blockers: ["MANUAL"],
      lastOutcome: null,
      lastOutcomeAt: null,
      retryAt: null,
      previewHealth: "HEALTHY",
      previewCheckedAt: new Date("2026-03-30T00:00:00.000Z"),
      provisionedAt: null,
      containerName: "preview-proj-1",
      previewUrl: "https://preview.example.com",
      workerHost: "local",
      vpsHostId: null,
      lastHeartbeat: null,
      retryCount: 0,
      archivedAt: null,
    };
    vi.mocked(requirePrimaryComponentRow as any).mockImplementation(async () => ({ ...state }));

    const res = await POST(
      new Request("http://localhost/api/internal/projects/proj-1/terminal", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          terminalState: "CANCELED",
          pauseReason: "MANUAL",
          reasonCode: "workspace_dirty_before_sync",
          reasonMessage: "Workspace has uncommitted changes before repo sync: ?? generated/videos/preview.mp4",
        }),
      }),
      { params: Promise.resolve({ id: "proj-1" }) },
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ success: true, noop: true });
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(enqueueProjectUpdate).not.toHaveBeenCalled();
  });

  it("does not turn governance paused_manual stop echoes into fresh evidence requests", async () => {
    const state: Record<string, unknown> = {
      projectId: "proj-1",
      componentId: "cmp-1",
      powerIntent: "ON",
      agentIntent: "ON",
      runtimeState: "RUNNING",
      agentState: "IDLE",
      blockers: ["MANUAL"],
      lastOutcome: null,
      lastOutcomeAt: null,
      retryAt: null,
      previewHealth: "HEALTHY",
      previewCheckedAt: new Date("2026-03-30T00:00:00.000Z"),
      provisionedAt: null,
      containerName: "preview-proj-1",
      previewUrl: "https://preview.example.com",
      workerHost: "local",
      vpsHostId: null,
      lastHeartbeat: null,
      retryCount: 0,
      archivedAt: null,
    };
    vi.mocked(requirePrimaryComponentRow as any).mockImplementation(async () => ({ ...state }));

    const res = await POST(
      new Request("http://localhost/api/internal/projects/proj-1/terminal", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          terminalState: "CANCELED",
          pauseReason: "MANUAL",
          reasonCode: "paused_manual",
          reasonMessage: "Governance stop: paused_manual",
        }),
      }),
      { params: Promise.resolve({ id: "proj-1" }) },
    );

    expect(res.status).toBe(200);
    expect(enqueueProjectUpdate).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ eventType: "work.needs_evidence" }),
    );
    expect(enqueueProjectUpdate).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ eventType: "work.failed" }),
    );
  });

  it("does not re-notify paused_budget when budget blocker already existed before terminal converge", async () => {
    vi.mocked(prisma.project.findUnique as any).mockReset();
    vi.mocked(prisma.project.findUnique as any)
      .mockResolvedValueOnce({
        id: "proj-1",
        name: "Project 1",
        archivedAt: null,
        previewUrl: null,
        proposalId: null,
        budgetDebitedUsd: 0,
        estimatedCostUsd: null,
        components: [{ agentState: "RUNNING" }],
      })
      .mockResolvedValueOnce({ log: null });

    const state: Record<string, unknown> = {
      projectId: "proj-1",
      componentId: "cmp-1",
      powerIntent: "ON",
      agentIntent: "ON",
      runtimeState: "RUNNING",
      agentState: "RUNNING",
      blockers: ["BUDGET"],
      lastOutcome: null,
      lastOutcomeAt: null,
      retryAt: null,
      previewHealth: "HEALTHY",
      previewCheckedAt: new Date("2026-03-30T00:00:00.000Z"),
      provisionedAt: null,
      containerName: "preview-proj-1",
      previewUrl: "https://preview.example.com",
      workerHost: "local",
      vpsHostId: null,
      lastHeartbeat: null,
      retryCount: 0,
      archivedAt: null,
    };
    vi.mocked(requirePrimaryComponentRow as any).mockImplementation(async () => ({ ...state }));

    const res = await POST(
      new Request("http://localhost/api/internal/projects/proj-1/terminal", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          terminalState: "CANCELED",
          pauseReason: "BUDGET",
          reasonCode: "budget_exhausted",
          reasonMessage: "budget exhausted",
        }),
      }),
      { params: Promise.resolve({ id: "proj-1" }) },
    );

    expect(res.status).toBe(200);
    expect(notify).not.toHaveBeenCalledWith(expect.objectContaining({
      type: "project.paused_budget",
      projectId: "proj-1",
    }));
  });

  it("parks final DEPLOYED reports as BUDGET when an enabled budget is exhausted", async () => {
    vi.mocked(prisma.project.findUnique as any).mockReset();
    vi.mocked(prisma.project.findUnique as any).mockResolvedValueOnce({
      id: "proj-1",
      name: "Project 1",
      archivedAt: null,
      previewUrl: null,
      proposalId: null,
      budgetDebitedUsd: 19,
      estimatedCostUsd: null,
      budget: { isEnabled: true, totalCreditsUsd: 20, usedCreditsUsd: 19 },
    });

    const state: Record<string, unknown> = {
      projectId: "proj-1",
      componentId: "cmp-1",
      powerIntent: "ON",
      agentIntent: "ON",
      runtimeState: "RUNNING",
      agentState: "RUNNING",
      blockers: [],
      lastOutcome: null,
      lastOutcomeAt: null,
      retryAt: null,
      previewHealth: "HEALTHY",
      previewCheckedAt: new Date("2026-03-30T00:00:00.000Z"),
      provisionedAt: null,
      containerName: "preview-proj-1",
      previewUrl: "https://preview.example.com",
      workerHost: "local",
      vpsHostId: null,
      lastHeartbeat: null,
      retryCount: 0,
      archivedAt: null,
    };
    vi.mocked(requirePrimaryComponentRow as any).mockImplementation(async () => ({ ...state }));

    const res = await POST(
      new Request("http://localhost/api/internal/projects/proj-1/terminal", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          terminalState: "DEPLOYED",
          estimatedCostUsd: 21,
          previewActual: "SERVING",
        }),
      }),
      { params: Promise.resolve({ id: "proj-1" }) },
    );

    expect(res.status).toBe(200);
    expect(applyStateChange).toHaveBeenCalledWith(
      expect.anything(),
      "proj-1",
      { type: "agentTransition", state: "IDLE" },
      expect.objectContaining({ source: "runner", trigger: "terminal_budget_exhausted" }),
    );
    expect(applyStateChange).toHaveBeenCalledWith(
      expect.anything(),
      "proj-1",
      { type: "addBlocker", blocker: "BUDGET" },
      expect.objectContaining({ source: "system", trigger: "terminal_budget_exhausted" }),
    );
    expect(applyStateChange).not.toHaveBeenCalledWith(
      expect.anything(),
      "proj-1",
      { type: "agentTransition", state: "IDLE", outcome: "COMPLETED" },
      expect.anything(),
    );
    expect(prisma.projectBudget.updateMany).toHaveBeenCalledWith({
      where: { projectId: "proj-1" },
      data: { usedCreditsUsd: { increment: 2 } },
    });
    expect(notifyProjectEvent).toHaveBeenCalledWith(
      "proj-1",
      expect.objectContaining({ type: "terminal", status: "BUDGET" }),
    );
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({
      type: "project.paused_budget",
      projectId: "proj-1",
    }));
  });

  it("parks final DEPLOYED reports as SECRETS when blocking required secrets are missing", async () => {
    vi.mocked(prisma.project.findUnique as any).mockReset();
    vi.mocked(prisma.project.findUnique as any).mockResolvedValueOnce({
      id: "proj-1",
      name: "Project 1",
      archivedAt: null,
      previewUrl: null,
      proposalId: null,
      requiredSecrets: JSON.stringify([
        { key: "TELEGRAM_BOT_TOKEN", blocking: true },
        { key: "OPTIONAL_ANALYTICS_TOKEN", blocking: false },
      ]),
      secrets: [{ key: "OPTIONAL_ANALYTICS_TOKEN" }],
      budgetDebitedUsd: 0,
      estimatedCostUsd: null,
      budget: null,
    });

    const state: Record<string, unknown> = {
      projectId: "proj-1",
      componentId: "cmp-1",
      powerIntent: "ON",
      agentIntent: "ON",
      runtimeState: "RUNNING",
      agentState: "RUNNING",
      blockers: [],
      lastOutcome: null,
      lastOutcomeAt: null,
      retryAt: null,
      previewHealth: "HEALTHY",
      previewCheckedAt: new Date("2026-03-30T00:00:00.000Z"),
      provisionedAt: null,
      containerName: "preview-proj-1",
      previewUrl: "https://preview.example.com",
      workerHost: "local",
      vpsHostId: null,
      lastHeartbeat: null,
      retryCount: 0,
      archivedAt: null,
    };
    vi.mocked(requirePrimaryComponentRow as any).mockImplementation(async () => ({ ...state }));

    const res = await POST(
      new Request("http://localhost/api/internal/projects/proj-1/terminal", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          terminalState: "DEPLOYED",
          previewActual: "SERVING",
        }),
      }),
      { params: Promise.resolve({ id: "proj-1" }) },
    );

    expect(res.status).toBe(200);
    expect(applyStateChange).toHaveBeenCalledWith(
      expect.anything(),
      "proj-1",
      { type: "agentTransition", state: "IDLE" },
      expect.objectContaining({ source: "runner", trigger: "terminal_missing_secrets" }),
    );
    expect(applyStateChange).toHaveBeenCalledWith(
      expect.anything(),
      "proj-1",
      { type: "addBlocker", blocker: "SECRETS" },
      expect.objectContaining({ source: "system", trigger: "terminal_missing_secrets" }),
    );
    expect(applyStateChange).not.toHaveBeenCalledWith(
      expect.anything(),
      "proj-1",
      { type: "agentTransition", state: "IDLE", outcome: "COMPLETED" },
      expect.anything(),
    );
    expect(notifyProjectEvent).toHaveBeenCalledWith(
      "proj-1",
      expect.objectContaining({ type: "terminal", status: "SECRETS" }),
    );
    expect(notify).not.toHaveBeenCalledWith(expect.objectContaining({
      type: "project.deployed",
      projectId: "proj-1",
    }));
  });

  it("accepts a new terminal report after a recoverable blocked idle state and parks it as idle failure history", async () => {
    vi.mocked(prisma.project.findUnique as any).mockReset();
    vi.mocked(prisma.project.findUnique as any)
      .mockResolvedValueOnce({
        id: "proj-1",
        name: "Project 1",
        archivedAt: null,
        previewUrl: null,
        proposalId: null,
        budgetDebitedUsd: 0,
        estimatedCostUsd: null,
        components: [{ agentState: "IDLE" }],
      })
      .mockResolvedValueOnce({ log: null });

    const state: Record<string, unknown> = {
      projectId: "proj-1",
      componentId: "cmp-1",
      powerIntent: "ON",
      agentIntent: "ON",
      runtimeState: "RUNNING",
      agentState: "IDLE",
      blockers: ["RATE_LIMIT"],
      lastOutcome: null,
      lastOutcomeAt: null,
      retryAt: null,
      previewHealth: "HEALTHY",
      previewCheckedAt: new Date("2026-03-30T00:00:00.000Z"),
      provisionedAt: null,
      containerName: "preview-proj-1",
      previewUrl: "https://preview.example.com",
      workerHost: "local",
      vpsHostId: null,
      lastHeartbeat: null,
      retryCount: 2,
      archivedAt: null,
    };
    vi.mocked(requirePrimaryComponentRow as any).mockImplementation(async () => ({ ...state }));
    vi.mocked(applyStateChange as any).mockResolvedValue({});
    vi.mocked(updateComponentMetadata as any).mockResolvedValue({});

    const res = await POST(
      new Request("http://localhost/api/internal/projects/proj-1/terminal", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          terminalState: "FAILED",
          reasonCode: "exit_code_1",
          reasonMessage: "second attempt failed",
        }),
      }),
      { params: Promise.resolve({ id: "proj-1" }) },
    );

    expect(res.status).toBe(200);
    expect(applyStateChange).toHaveBeenCalledWith(
      expect.anything(),
      "proj-1",
      { type: "agentTransition", state: "IDLE", outcome: "FAILED" },
      expect.objectContaining({ trigger: "terminal_failed" }),
    );
  });

  it("parks failed preview-serving iterations as IDLE + FAILED while keeping runtime alive", async () => {
    vi.mocked(prisma.project.findUnique as any).mockReset();
    vi.mocked(prisma.project.findUnique as any)
      .mockResolvedValueOnce({
        id: "proj-1",
        name: "Project 1",
        archivedAt: null,
        previewUrl: null,
        proposalId: null,
        budgetDebitedUsd: 0,
        estimatedCostUsd: null,
        components: [{ agentState: "RUNNING" }],
      })
      .mockResolvedValueOnce({ log: null });

    const state: Record<string, unknown> = {
      projectId: "proj-1",
      componentId: "cmp-1",
      powerIntent: "ON",
      agentIntent: "ON",
      runtimeState: "RUNNING",
      agentState: "RUNNING",
      blockers: [],
      lastOutcome: null,
      lastOutcomeAt: null,
      retryAt: null,
      previewHealth: "HEALTHY",
      previewCheckedAt: new Date("2026-03-30T00:00:00.000Z"),
      provisionedAt: null,
      containerName: "preview-proj-1",
      previewUrl: "https://preview.example.com",
      workerHost: "local",
      vpsHostId: null,
      lastHeartbeat: null,
      retryCount: 0,
      archivedAt: null,
    };
    vi.mocked(requirePrimaryComponentRow as any).mockImplementation(async () => ({ ...state }));
    vi.mocked(applyStateChange as any).mockResolvedValue({});
    vi.mocked(updateComponentMetadata as any).mockResolvedValue({});

    const res = await POST(
      new Request("http://localhost/api/internal/projects/proj-1/terminal", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          terminalState: "FAILED",
          reasonCode: "preview_fallback",
          reasonMessage: "agent failed but preview stayed live",
          previewActual: "SERVING",
        }),
      }),
      { params: Promise.resolve({ id: "proj-1" }) },
    );

    expect(res.status).toBe(200);
    expect(applyStateChange).toHaveBeenCalledWith(
      expect.anything(),
      "proj-1",
      { type: "agentTransition", state: "IDLE", outcome: "FAILED" },
      expect.objectContaining({ trigger: "terminal_failed" }),
    );
    expect(applyStateChange).not.toHaveBeenCalledWith(
      expect.anything(),
      "proj-1",
      { type: "runtimeObserved", state: "STOPPED" },
      expect.anything(),
    );
  });

  it("does not write implState for runtime-only FAILED terminal transitions", async () => {
    vi.mocked(prisma.project.findUnique as any).mockReset();
    vi.mocked(prisma.project.findUnique as any)
      .mockResolvedValueOnce({
        id: "proj-1",
        name: "Project 1",
        archivedAt: null,
        previewUrl: null,
        proposalId: null,
        budgetDebitedUsd: 0,
        estimatedCostUsd: null,
        components: [{ agentState: null }],
      })
      .mockResolvedValueOnce({ log: null });

    const state: Record<string, unknown> = {
      projectId: "proj-1",
      componentId: "cmp-1",
      powerIntent: "ON",
      agentIntent: "ON",
      runtimeState: "RUNNING",
      agentState: null,
      blockers: [],
      lastOutcome: null,
      lastOutcomeAt: null,
      retryAt: null,
      previewHealth: "HEALTHY",
      previewCheckedAt: new Date("2026-03-30T00:00:00.000Z"),
      provisionedAt: null,
      containerName: "preview-proj-1",
      previewUrl: "https://preview.example.com",
      workerHost: "local",
      vpsHostId: null,
      lastHeartbeat: null,
      retryCount: 0,
      archivedAt: null,
    };
    vi.mocked(requirePrimaryComponentRow as any).mockImplementation(async () => ({ ...state }));
    vi.mocked(applyStateChange as any).mockResolvedValue({});
    vi.mocked(updateComponentMetadata as any).mockResolvedValue({});

    const res = await POST(
      new Request("http://localhost/api/internal/projects/proj-1/terminal", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          terminalState: "FAILED",
          reasonCode: "preview_boot_failed",
          reasonMessage: "preview container failed to boot",
        }),
      }),
      { params: Promise.resolve({ id: "proj-1" }) },
    );

    expect(res.status).toBe(200);
    expect(applyStateChange).toHaveBeenCalled();
  });

  it("derives previewUrl from containerName when runner omits it", async () => {
    process.env.PREVIEW_DOMAIN = "arena.example.test";

    const res = await POST(
      new Request("http://localhost/api/internal/projects/proj-1/terminal", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          terminalState: "DEPLOYED",
          containerName: "preview-proj-1",
          previewActual: "SERVING",
        }),
      }),
      { params: Promise.resolve({ id: "proj-1" }) },
    );

    expect(res.status).toBe(200);
    expect(updateComponentMetadata).toHaveBeenCalledWith(
      expect.anything(),
      "proj-1",
      expect.objectContaining({
        previewUrl: "https://preview-proj-1.arena.example.test",
      }),
      expect.any(Object),
    );
  });

  it("uses component preview identity for deployed notifications", async () => {
    vi.mocked(prisma.project.findUnique as any).mockReset();
    vi.mocked(prisma.project.findUnique as any)
      .mockResolvedValueOnce({
        id: "proj-1",
        name: "Project 1",
        archivedAt: null,
        proposalId: null,
        budgetDebitedUsd: 0,
        estimatedCostUsd: null,
      })
      .mockResolvedValueOnce({ log: null });

    const res = await POST(
      new Request("http://localhost/api/internal/projects/proj-1/terminal", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          terminalState: "DEPLOYED",
          previewActual: "SERVING",
          previewUrl: "https://preview-from-component.example.com",
        }),
      }),
      { params: Promise.resolve({ id: "proj-1" }) },
    );

    expect(res.status).toBe(200);
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({
      type: "project.deployed",
      previewUrl: "https://preview-from-component.example.com",
    }));
  });

  it("does not attach legacy screenshot proof metadata to deployed work-completed notifications", async () => {
    vi.mocked(prisma.project.findUnique as any).mockReset();
    vi.mocked(prisma.project.findUnique as any)
      .mockResolvedValueOnce({
        id: "proj-1",
        name: "Project 1",
        archivedAt: null,
        previewUrl: "https://preview.example.com",
        proposalId: null,
        requiredSecrets: null,
        budgetDebitedUsd: 0,
        estimatedCostUsd: null,
        secrets: [],
        budget: null,
      })
      .mockResolvedValueOnce({ log: null });

    const res = await POST(
      new Request("http://localhost/api/internal/projects/proj-1/terminal", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          terminalState: "DEPLOYED",
          previewActual: "SERVING",
          previewUrl: "https://preview.example.com",
          telegramMiniAppUrl: "https://t.me/sample_bot/sampleapp?startapp=done",
        }),
      }),
      { params: Promise.resolve({ id: "proj-1" }) },
    );

    expect(res.status).toBe(200);
    const projectSelect = vi.mocked(prisma.project.findUnique as any).mock.calls[0]?.[0]?.select;
    expect(projectSelect).not.toHaveProperty("progressJson");
    expect(projectSelect).not.toHaveProperty("specs");
    expect(enqueueProjectUpdate).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        projectId: "proj-1",
        eventType: "work.completed",
        payload: expect.objectContaining({
          previewUrl: "https://preview.example.com",
          telegramMiniAppUrl: "https://t.me/sample_bot/sampleapp?startapp=done",
        }),
      }),
    );
    const completedPayloads = vi.mocked(enqueueProjectUpdate).mock.calls
      .map(([, update]) => update)
      .filter((update) => update.projectId === "proj-1" && update.eventType === "work.completed")
      .map((update) => update.payload ?? {});
    expect(completedPayloads).toHaveLength(1);
    for (const payload of completedPayloads) {
      expect(payload).not.toHaveProperty("proofReviewId");
      expect(payload).not.toHaveProperty("proofReviewStatus");
    }
    expect((prisma as any).projectAsset.findMany).not.toHaveBeenCalled();
  });

  it("resolves project-owned Mini App entrypoints for deployed work-completed notifications", async () => {
    vi.mocked(prisma.project.findUnique as any).mockReset();
    vi.mocked(prisma.project.findUnique as any)
      .mockResolvedValueOnce({
        id: "cmpcxmtut0h2n5inse8g15ilo",
        name: "sampleapp",
        archivedAt: null,
        previewUrl: "https://preview-sampleapp-g15ilo.arena.example.test",
        proposalId: null,
        requiredSecrets: null,
        progressJson: null,
        budgetDebitedUsd: 0,
        estimatedCostUsd: null,
        secrets: [],
        specs: [],
        budget: null,
      })
      .mockResolvedValueOnce({ log: null });
    vi.mocked(resolveProjectTelegramMiniAppEntryUrl).mockResolvedValue(
      "https://t.me/samplebot?startapp=cmpcxmtut0h2n5inse8g15ilo",
    );

    const res = await POST(
      new Request("http://localhost/api/internal/projects/cmpcxmtut0h2n5inse8g15ilo/terminal", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          terminalState: "DEPLOYED",
          previewActual: "SERVING",
          previewUrl: "https://preview-sampleapp-g15ilo.arena.example.test",
        }),
      }),
      { params: Promise.resolve({ id: "cmpcxmtut0h2n5inse8g15ilo" }) },
    );

    expect(res.status).toBe(200);
    expect(resolveProjectTelegramMiniAppEntryUrl).toHaveBeenCalledWith(
      prisma,
      "cmpcxmtut0h2n5inse8g15ilo",
    );
    expect(enqueueProjectUpdate).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        projectId: "cmpcxmtut0h2n5inse8g15ilo",
        eventType: "work.completed",
        payload: expect.objectContaining({
          previewUrl: "https://preview-sampleapp-g15ilo.arena.example.test",
          telegramMiniAppUrl: "https://t.me/samplebot?startapp=cmpcxmtut0h2n5inse8g15ilo",
        }),
      }),
    );
  });

  it("converges CANCELED agent_off to OFF + IDLE without writing a fake COMPLETED outcome", async () => {
    vi.mocked(prisma.project.findUnique as any).mockReset();
    vi.mocked(prisma.project.findUnique as any)
      .mockResolvedValueOnce({
        id: "proj-1",
        name: "Project 1",
        archivedAt: null,
        previewUrl: "https://preview.example.com",
        proposalId: null,
        budgetDebitedUsd: 0,
        estimatedCostUsd: null,
        components: [{ agentState: "RUNNING" }],
      })
      .mockResolvedValueOnce({ log: null });

    const state: Record<string, unknown> = {
      projectId: "proj-1",
      componentId: "cmp-1",
      powerIntent: "ON",
      agentIntent: "OFF",
      runtimeState: "RUNNING",
      agentState: "RUNNING",
      blockers: [],
      lastOutcome: null,
      lastOutcomeAt: null,
      retryAt: null,
      previewHealth: "HEALTHY",
      previewCheckedAt: new Date("2026-03-30T00:00:00.000Z"),
      provisionedAt: null,
      containerName: "preview-proj-1",
      previewUrl: "https://preview.example.com",
      workerHost: "local",
      vpsHostId: null,
      lastHeartbeat: null,
      retryCount: 0,
      archivedAt: null,
    };
    vi.mocked(requirePrimaryComponentRow as any).mockImplementation(async () => ({ ...state }));

    const res = await POST(
      new Request("http://localhost/api/internal/projects/proj-1/terminal", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          terminalState: "CANCELED",
          reasonCode: "agent_off",
          reasonMessage: "Agent stopped after OFF intent",
          previewActual: "SERVING",
        }),
      }),
      { params: Promise.resolve({ id: "proj-1" }) },
    );

    expect(res.status).toBe(200);
    expect(applyStateChange).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      "proj-1",
      { type: "agentIntent", intent: "OFF" },
      expect.objectContaining({ trigger: "terminal_agent_off_intent" }),
    );
    expect(applyStateChange).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      "proj-1",
      { type: "agentTransition", state: "IDLE" },
      expect.objectContaining({ trigger: "terminal_agent_off" }),
    );
    expect(enqueueProjectUpdate).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ eventType: "work.failed" }),
    );
  });

  it("converges CANCELED power_off to OFF + IDLE without writing FAILED", async () => {
    vi.mocked(prisma.project.findUnique as any).mockReset();
    vi.mocked(prisma.project.findUnique as any)
      .mockResolvedValueOnce({
        id: "proj-1",
        name: "Project 1",
        archivedAt: null,
        previewUrl: "https://preview.example.com",
        proposalId: null,
        budgetDebitedUsd: 0,
        estimatedCostUsd: null,
        components: [{ agentState: "RUNNING" }],
      })
      .mockResolvedValueOnce({ log: null });

    const state: Record<string, unknown> = {
      projectId: "proj-1",
      componentId: "cmp-1",
      powerIntent: "OFF",
      agentIntent: "OFF",
      runtimeState: "RUNNING",
      agentState: "RUNNING",
      blockers: [],
      lastOutcome: null,
      lastOutcomeAt: null,
      retryAt: null,
      previewHealth: "HEALTHY",
      previewCheckedAt: new Date("2026-03-30T00:00:00.000Z"),
      provisionedAt: null,
      containerName: "preview-proj-1",
      previewUrl: "https://preview.example.com",
      workerHost: "local",
      vpsHostId: null,
      lastHeartbeat: null,
      retryCount: 0,
      archivedAt: null,
    };
    vi.mocked(requirePrimaryComponentRow as any).mockImplementation(async () => ({ ...state }));

    const res = await POST(
      new Request("http://localhost/api/internal/projects/proj-1/terminal", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          terminalState: "CANCELED",
          reasonCode: "power_off",
          reasonMessage: "App stopped after OFF intent",
        }),
      }),
      { params: Promise.resolve({ id: "proj-1" }) },
    );

    expect(res.status).toBe(200);
    expect(applyStateChange).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      "proj-1",
      { type: "agentIntent", intent: "OFF" },
      expect.objectContaining({ trigger: "terminal_power_off_intent" }),
    );
    expect(applyStateChange).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      "proj-1",
      { type: "agentTransition", state: "IDLE" },
      expect.objectContaining({ trigger: "terminal_power_off" }),
    );
    expect(applyStateChange).toHaveBeenNthCalledWith(
      3,
      expect.anything(),
      "proj-1",
      { type: "runtimeObserved", state: "STOPPED" },
      expect.objectContaining({ trigger: "terminal_stop" }),
    );
    expect(prisma.project.updateMany).toHaveBeenCalledWith({
      where: { id: "proj-1" },
      data: expect.not.objectContaining({
        lastError: expect.anything(),
      }),
    });
    const updateCall = vi.mocked(prisma.project.updateMany as any).mock.calls[0][0];
    expect(updateCall.data.finishedAt).toBeUndefined();
    expect(updateCall.data.lastError).toBeUndefined();
    expect(applyStateChange).not.toHaveBeenCalledWith(
      expect.anything(),
      "proj-1",
      { type: "agentTransition", state: "FAILED", outcome: "FAILED" },
      expect.anything(),
    );
  });

  it("converges CANCELED resume_reclaim to STOPPED without inventing RUNNING lift or terminal outcome", async () => {
    vi.mocked(prisma.project.findUnique as any).mockReset();
    vi.mocked(prisma.project.findUnique as any)
      .mockResolvedValueOnce({
        id: "proj-1",
        name: "Project 1",
        archivedAt: null,
        previewUrl: "https://preview.example.com",
        proposalId: null,
        budgetDebitedUsd: 0,
        estimatedCostUsd: null,
        components: [{ agentState: "IDLE" }],
      })
      .mockResolvedValueOnce({ log: null });

    const state: Record<string, unknown> = {
      projectId: "proj-1",
      componentId: "cmp-1",
      powerIntent: "ON",
      agentIntent: "ON",
      runtimeState: "RUNNING",
      agentState: "IDLE",
      blockers: [],
      lastOutcome: null,
      lastOutcomeAt: null,
      retryAt: null,
      previewHealth: "HEALTHY",
      previewCheckedAt: new Date("2026-04-22T09:00:00.000Z"),
      provisionedAt: new Date("2026-04-22T08:00:00.000Z"),
      containerName: "preview-proj-1",
      previewUrl: "https://preview.example.com",
      workerHost: "local",
      vpsHostId: null,
      lastHeartbeat: null,
      retryCount: 0,
      archivedAt: null,
    };
    vi.mocked(requirePrimaryComponentRow as any).mockImplementation(async () => ({ ...state }));

    const res = await POST(
      new Request("http://localhost/api/internal/projects/proj-1/terminal", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          terminalState: "CANCELED",
          reasonCode: "resume_reclaim",
          reasonMessage: "Paused preview is yielding to a fresh claim.",
          containerName: null,
        }),
      }),
      { params: Promise.resolve({ id: "proj-1" }) },
    );

    expect(res.status).toBe(200);
    expect(applyStateChange).toHaveBeenCalledWith(
      expect.anything(),
      "proj-1",
      { type: "agentTransition", state: "IDLE" },
      expect.objectContaining({ trigger: "terminal_shutdown" }),
    );
    expect(applyStateChange).toHaveBeenCalledWith(
      expect.anything(),
      "proj-1",
      { type: "runtimeObserved", state: "STOPPED" },
      expect.objectContaining({ trigger: "terminal_stop" }),
    );
    expect(applyStateChange).not.toHaveBeenCalledWith(
      expect.anything(),
      "proj-1",
      { type: "agentTransition", state: "RUNNING" },
      expect.anything(),
    );
    expect(applyStateChange).not.toHaveBeenCalledWith(
      expect.anything(),
      "proj-1",
      { type: "agentTransition", state: "IDLE", outcome: "FAILED" },
      expect.anything(),
    );
    expect(applyStateChange).not.toHaveBeenCalledWith(
      expect.anything(),
      "proj-1",
      { type: "agentTransition", state: "IDLE", outcome: "COMPLETED" },
      expect.anything(),
    );
    expect(updateComponentMetadata).toHaveBeenCalledWith(
      expect.anything(),
      "proj-1",
      expect.objectContaining({
        previewHealth: "UNKNOWN",
        previewCheckedAt: null,
        previewUrl: null,
        containerName: null,
      }),
      expect.objectContaining({ trigger: "terminal_metadata" }),
    );
    expect(enqueueProjectUpdate).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ eventType: "work.failed" }),
    );
  });

  it("converges paused runtime shutdown to STOPPED and clears stale preview identity", async () => {
    vi.mocked(prisma.project.findUnique as any).mockReset();
    vi.mocked(prisma.project.findUnique as any)
      .mockResolvedValueOnce({
        id: "proj-1",
        name: "Project 1",
        archivedAt: null,
        previewUrl: "https://preview.example.com",
        proposalId: null,
        budgetDebitedUsd: 0,
        estimatedCostUsd: null,
        components: [{ agentState: "IDLE" }],
      })
      .mockResolvedValueOnce({ log: null });

    const state: Record<string, unknown> = {
      projectId: "proj-1",
      componentId: "cmp-1",
      powerIntent: "ON",
      agentIntent: "OFF",
      runtimeState: "RUNNING",
      agentState: "IDLE",
      blockers: ["RATE_LIMIT"],
      lastOutcome: null,
      lastOutcomeAt: null,
      retryAt: new Date("2026-04-24T22:40:00.000Z"),
      previewHealth: "HEALTHY",
      previewCheckedAt: new Date("2026-04-24T18:00:00.000Z"),
      provisionedAt: new Date("2026-04-24T17:40:00.000Z"),
      containerName: "preview-proj-1",
      previewUrl: "https://preview.example.com",
      workerHost: "local",
      vpsHostId: null,
      lastHeartbeat: null,
      retryCount: 1,
      archivedAt: null,
    };
    vi.mocked(requirePrimaryComponentRow as any).mockImplementation(async () => ({ ...state }));

    const res = await POST(
      new Request("http://localhost/api/internal/projects/proj-1/terminal", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          terminalState: "CANCELED",
          reasonCode: "paused_runtime_shutdown",
          reasonMessage: "Paused runtime shut down after governance requested shutdown.",
          containerName: null,
          workerHost: null,
        }),
      }),
      { params: Promise.resolve({ id: "proj-1" }) },
    );

    expect(res.status).toBe(200);
    expect(applyStateChange).toHaveBeenCalledWith(
      expect.anything(),
      "proj-1",
      { type: "agentTransition", state: "IDLE" },
      expect.objectContaining({ trigger: "terminal_shutdown" }),
    );
    expect(applyStateChange).toHaveBeenCalledWith(
      expect.anything(),
      "proj-1",
      { type: "runtimeObserved", state: "STOPPED" },
      expect.objectContaining({ trigger: "terminal_stop" }),
    );
    expect(applyStateChange).not.toHaveBeenCalledWith(
      expect.anything(),
      "proj-1",
      { type: "agentTransition", state: "RUNNING" },
      expect.anything(),
    );
    expect(applyStateChange).not.toHaveBeenCalledWith(
      expect.anything(),
      "proj-1",
      { type: "agentTransition", state: "IDLE", outcome: "FAILED" },
      expect.anything(),
    );
    expect(updateComponentMetadata).toHaveBeenCalledWith(
      expect.anything(),
      "proj-1",
      expect.objectContaining({
        previewHealth: "UNKNOWN",
        previewCheckedAt: null,
        previewUrl: null,
        containerName: null,
        workerHost: null,
      }),
      expect.objectContaining({ trigger: "terminal_metadata" }),
    );
    expect(enqueueProjectUpdate).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ eventType: "work.failed" }),
    );
  });

  it("treats repeated agent_off terminal reports for an already parked serving preview as noop", async () => {
    vi.mocked(prisma.project.findUnique as any).mockReset();
    vi.mocked(prisma.project.findUnique as any).mockResolvedValueOnce({
      id: "proj-1",
      name: "Project 1",
      archivedAt: null,
      previewUrl: "https://preview.example.com",
      proposalId: null,
      budgetDebitedUsd: 0,
      estimatedCostUsd: null,
      components: [{ agentState: "IDLE" }],
    });

    vi.mocked(requirePrimaryComponentRow as any).mockResolvedValue({
      projectId: "proj-1",
      componentId: "cmp-1",
      powerIntent: "ON",
      agentIntent: "OFF",
      runtimeState: "RUNNING",
      agentState: "IDLE",
      blockers: [],
      lastOutcome: null,
      lastOutcomeAt: null,
      retryAt: null,
      previewHealth: "HEALTHY",
      previewCheckedAt: new Date("2026-03-30T00:00:00.000Z"),
      provisionedAt: null,
      containerName: "preview-proj-1",
      previewUrl: "https://preview.example.com",
      workerHost: "local",
      vpsHostId: null,
      lastHeartbeat: null,
      retryCount: 0,
      archivedAt: null,
    });

    const res = await POST(
      new Request("http://localhost/api/internal/projects/proj-1/terminal", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          terminalState: "CANCELED",
          reasonCode: "agent_off",
          reasonMessage: "duplicate agent_off report",
          previewActual: "SERVING",
        }),
      }),
      { params: Promise.resolve({ id: "proj-1" }) },
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, noop: true });
    expect(applyStateChange).not.toHaveBeenCalled();
    expect(updateComponentMetadata).not.toHaveBeenCalled();
  });

  it("does not keep stale RUNNING runtime for an already parked agent_off row when preview is not serving", async () => {
    vi.mocked(prisma.project.findUnique as any).mockReset();
    vi.mocked(prisma.project.findUnique as any)
      .mockResolvedValueOnce({
        id: "proj-1",
        name: "Project 1",
        archivedAt: null,
        previewUrl: "https://preview.example.com",
        proposalId: null,
        budgetDebitedUsd: 0,
        estimatedCostUsd: null,
        components: [{ agentState: "IDLE" }],
      })
      .mockResolvedValueOnce({ log: null });

    vi.mocked(requirePrimaryComponentRow as any).mockResolvedValue({
      projectId: "proj-1",
      componentId: "cmp-1",
      powerIntent: "ON",
      agentIntent: "OFF",
      runtimeState: "RUNNING",
      agentState: "IDLE",
      blockers: [],
      lastOutcome: null,
      lastOutcomeAt: null,
      retryAt: null,
      previewHealth: "HEALTHY",
      previewCheckedAt: new Date("2026-03-30T00:00:00.000Z"),
      provisionedAt: null,
      containerName: "preview-proj-1",
      previewUrl: "https://preview.example.com",
      workerHost: "local",
      vpsHostId: null,
      lastHeartbeat: null,
      retryCount: 0,
      archivedAt: null,
    });

    const res = await POST(
      new Request("http://localhost/api/internal/projects/proj-1/terminal", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          terminalState: "CANCELED",
          reasonCode: "agent_off",
          reasonMessage: "agent_off preview did not survive shutdown",
          previewActual: "ERROR",
          previewLastError: "No arena-start.sh found",
          containerName: "preview-proj-1",
          previewUrl: "https://preview.example.com",
          workerHost: "local",
        }),
      }),
      { params: Promise.resolve({ id: "proj-1" }) },
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ success: true });
    expect(applyStateChange).toHaveBeenCalledWith(
      expect.anything(),
      "proj-1",
      { type: "runtimeObserved", state: "STOPPED" },
      expect.objectContaining({ trigger: "terminal_stop" }),
    );
    expect(updateComponentMetadata).toHaveBeenCalledWith(
      expect.anything(),
      "proj-1",
      expect.objectContaining({
        previewHealth: "UNHEALTHY",
        previewUrl: null,
      }),
      expect.objectContaining({ trigger: "terminal_metadata" }),
    );
  });

  it("accepts resume_reclaim from a completed retained preview so new loop work can fresh-claim", async () => {
    vi.mocked(prisma.project.findUnique as any).mockReset();
    vi.mocked(prisma.project.findUnique as any)
      .mockResolvedValueOnce({
        id: "proj-1",
        name: "Project 1",
        archivedAt: null,
        previewUrl: "https://preview.example.com",
        proposalId: null,
        budgetDebitedUsd: 0,
        estimatedCostUsd: null,
        components: [{ agentState: "IDLE" }],
      })
      .mockResolvedValueOnce({ log: null });

    vi.mocked(requirePrimaryComponentRow as any).mockResolvedValue({
      projectId: "proj-1",
      componentId: "cmp-1",
      powerIntent: "ON",
      agentIntent: "ON",
      runtimeState: "RUNNING",
      agentState: "IDLE",
      blockers: [],
      lastOutcome: "COMPLETED",
      lastOutcomeAt: new Date("2026-04-22T23:00:00.000Z"),
      retryAt: null,
      previewHealth: "HEALTHY",
      previewCheckedAt: new Date("2026-04-22T23:00:00.000Z"),
      provisionedAt: null,
      containerName: "preview-proj-1",
      previewUrl: "https://preview.example.com",
      workerHost: "local",
      vpsHostId: null,
      lastHeartbeat: null,
      retryCount: 0,
      archivedAt: null,
    });

    const res = await POST(
      new Request("http://localhost/api/internal/projects/proj-1/terminal", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          terminalState: "CANCELED",
          reasonCode: "resume_reclaim",
          reasonMessage: "Completed preview yielded so new loop work can resume through a fresh claim.",
          containerName: null,
        }),
      }),
      { params: Promise.resolve({ id: "proj-1" }) },
    );

    expect(res.status).toBe(200);
    expect(applyStateChange).toHaveBeenCalledWith(
      expect.anything(),
      "proj-1",
      { type: "agentTransition", state: "IDLE" },
      expect.objectContaining({ trigger: "terminal_shutdown" }),
    );
    expect(applyStateChange).toHaveBeenCalledWith(
      expect.anything(),
      "proj-1",
      { type: "runtimeObserved", state: "STOPPED" },
      expect.objectContaining({ trigger: "terminal_stop" }),
    );
    expect(updateComponentMetadata).toHaveBeenCalledWith(
      expect.anything(),
      "proj-1",
      expect.objectContaining({
        previewHealth: "UNKNOWN",
        previewCheckedAt: null,
        previewUrl: null,
        containerName: null,
      }),
      expect.objectContaining({ trigger: "terminal_metadata" }),
    );
    expect(enqueueProjectUpdate).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ eventType: "work.failed" }),
    );
  });

  it("accepts resume_reclaim from a failed retained preview so new loop work can fresh-claim", async () => {
    vi.mocked(prisma.project.findUnique as any).mockReset();
    vi.mocked(prisma.project.findUnique as any)
      .mockResolvedValueOnce({
        id: "proj-1",
        name: "Project 1",
        archivedAt: null,
        previewUrl: "https://preview.example.com",
        proposalId: null,
        budgetDebitedUsd: 0,
        estimatedCostUsd: null,
        components: [{ agentState: "IDLE" }],
      })
      .mockResolvedValueOnce({ log: null });

    vi.mocked(requirePrimaryComponentRow as any).mockResolvedValue({
      projectId: "proj-1",
      componentId: "cmp-1",
      powerIntent: "ON",
      agentIntent: "ON",
      runtimeState: "RUNNING",
      agentState: "IDLE",
      blockers: [],
      lastOutcome: "FAILED",
      lastOutcomeAt: new Date("2026-04-22T23:00:00.000Z"),
      retryAt: null,
      previewHealth: "HEALTHY",
      previewCheckedAt: new Date("2026-04-22T23:00:00.000Z"),
      provisionedAt: null,
      containerName: "preview-proj-1",
      previewUrl: "https://preview.example.com",
      workerHost: "local",
      vpsHostId: null,
      lastHeartbeat: null,
      retryCount: 0,
      archivedAt: null,
    });

    const res = await POST(
      new Request("http://localhost/api/internal/projects/proj-1/terminal", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          terminalState: "CANCELED",
          reasonCode: "resume_reclaim",
          reasonMessage: "Failed preview yielded so new loop work can resume through a fresh claim.",
          containerName: null,
        }),
      }),
      { params: Promise.resolve({ id: "proj-1" }) },
    );

    expect(res.status).toBe(200);
    expect(applyStateChange).toHaveBeenCalledWith(
      expect.anything(),
      "proj-1",
      { type: "agentTransition", state: "IDLE" },
      expect.objectContaining({ trigger: "terminal_shutdown" }),
    );
    expect(applyStateChange).toHaveBeenCalledWith(
      expect.anything(),
      "proj-1",
      { type: "runtimeObserved", state: "STOPPED" },
      expect.objectContaining({ trigger: "terminal_stop" }),
    );
    expect(applyStateChange).not.toHaveBeenCalledWith(
      expect.anything(),
      "proj-1",
      { type: "agentTransition", state: "IDLE", outcome: "FAILED" },
      expect.anything(),
    );
    expect(updateComponentMetadata).toHaveBeenCalledWith(
      expect.anything(),
      "proj-1",
      expect.objectContaining({
        previewHealth: "UNKNOWN",
        previewCheckedAt: null,
        previewUrl: null,
        containerName: null,
      }),
      expect.objectContaining({ trigger: "terminal_metadata" }),
    );
    expect(enqueueProjectUpdate).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ eventType: "work.failed" }),
    );
  });

  it("accepts idle_preview_exited from a completed retained preview and clears stale runtime truth", async () => {
    vi.mocked(prisma.project.findUnique as any).mockReset();
    vi.mocked(prisma.project.findUnique as any)
      .mockResolvedValueOnce({
        id: "proj-1",
        name: "Project 1",
        archivedAt: null,
        previewUrl: "https://preview.example.com",
        proposalId: null,
        budgetDebitedUsd: 0,
        estimatedCostUsd: null,
        components: [{ agentState: "IDLE" }],
      })
      .mockResolvedValueOnce({ log: null });

    vi.mocked(requirePrimaryComponentRow as any).mockResolvedValue({
      projectId: "proj-1",
      componentId: "cmp-1",
      powerIntent: "ON",
      agentIntent: "ON",
      runtimeState: "RUNNING",
      agentState: "IDLE",
      blockers: [],
      lastOutcome: "COMPLETED",
      lastOutcomeAt: new Date("2026-04-22T23:00:00.000Z"),
      retryAt: null,
      previewHealth: "HEALTHY",
      previewCheckedAt: new Date("2026-04-22T23:00:00.000Z"),
      provisionedAt: null,
      containerName: "preview-proj-1",
      previewUrl: "https://preview.example.com",
      workerHost: "local",
      vpsHostId: null,
      lastHeartbeat: null,
      retryCount: 0,
      archivedAt: null,
    });

    const res = await POST(
      new Request("http://localhost/api/internal/projects/proj-1/terminal", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          terminalState: "CANCELED",
          reasonCode: "idle_preview_exited",
          reasonMessage: "Completed preview exited unexpectedly; governance should restore preview or resume new loop work through the normal claim path.",
          containerName: null,
        }),
      }),
      { params: Promise.resolve({ id: "proj-1" }) },
    );

    expect(res.status).toBe(200);
    expect(applyStateChange).toHaveBeenCalledWith(
      expect.anything(),
      "proj-1",
      { type: "agentTransition", state: "IDLE" },
      expect.objectContaining({ trigger: "terminal_shutdown" }),
    );
    expect(applyStateChange).toHaveBeenCalledWith(
      expect.anything(),
      "proj-1",
      { type: "runtimeObserved", state: "STOPPED" },
      expect.objectContaining({ trigger: "terminal_stop" }),
    );
    expect(updateComponentMetadata).toHaveBeenCalledWith(
      expect.anything(),
      "proj-1",
      expect.objectContaining({
        previewHealth: "UNKNOWN",
        previewCheckedAt: null,
        previewUrl: null,
        containerName: null,
      }),
      expect.objectContaining({ trigger: "terminal_metadata" }),
    );
    expect(enqueueProjectUpdate).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ eventType: "work.failed" }),
    );
  });

  it("treats repeated failed-preview terminal reports for an already parked failed iteration as noop", async () => {
    vi.mocked(prisma.project.findUnique as any).mockReset();
    vi.mocked(prisma.project.findUnique as any).mockResolvedValueOnce({
      id: "proj-1",
      name: "Project 1",
      archivedAt: null,
      previewUrl: "https://preview.example.com",
      proposalId: null,
      budgetDebitedUsd: 0,
      estimatedCostUsd: null,
      components: [{ agentState: "IDLE" }],
    });

    vi.mocked(requirePrimaryComponentRow as any).mockResolvedValue({
      projectId: "proj-1",
      componentId: "cmp-1",
      powerIntent: "ON",
      agentIntent: "ON",
      runtimeState: "RUNNING",
      agentState: "IDLE",
      blockers: [],
      lastOutcome: "FAILED",
      lastOutcomeAt: new Date("2026-03-30T00:00:00.000Z"),
      retryAt: null,
      previewHealth: "HEALTHY",
      previewCheckedAt: new Date("2026-03-30T00:00:00.000Z"),
      provisionedAt: null,
      containerName: "preview-proj-1",
      previewUrl: "https://preview.example.com",
      workerHost: "local",
      vpsHostId: null,
      lastHeartbeat: null,
      retryCount: 0,
      archivedAt: null,
    });

    const res = await POST(
      new Request("http://localhost/api/internal/projects/proj-1/terminal", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          terminalState: "FAILED",
          reasonCode: "preview_fallback",
          reasonMessage: "duplicate failed-preview report",
          previewActual: "SERVING",
        }),
      }),
      { params: Promise.resolve({ id: "proj-1" }) },
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, noop: true });
    expect(applyStateChange).not.toHaveBeenCalled();
    expect(updateComponentMetadata).not.toHaveBeenCalled();
  });
});
