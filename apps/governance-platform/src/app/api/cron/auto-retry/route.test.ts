import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    project: { findMany: vi.fn(), update: vi.fn() },
    projectComponent: { updateMany: vi.fn() },
    runLog: { create: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/internal-auth", () => ({
  isCronAuthorized: vi.fn(),
}));

vi.mock("@/lib/project-state-effects", () => ({
  applyStateChange: vi.fn().mockResolvedValue({}),
  requirePrimaryComponentRow: vi.fn(),
  updateComponentMetadata: vi.fn(),
}));

vi.mock("@/lib/provider-quotas", () => ({
  fetchProviderQuotaSnapshot: vi.fn(),
}));

import { prisma } from "@/lib/prisma";
import { isCronAuthorized } from "@/lib/internal-auth";
import { applyStateChange, requirePrimaryComponentRow, updateComponentMetadata } from "@/lib/project-state-effects";
import { fetchProviderQuotaSnapshot } from "@/lib/provider-quotas";

describe("POST /api/cron/auto-retry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isCronAuthorized).mockReturnValue(true);
    vi.mocked((prisma as any).$transaction).mockImplementation(async (cb: any) => {
      const tx = {
        project: {
          update: prisma.project.update,
        },
        runLog: {
          create: prisma.runLog.create,
        },
      };
      return cb(tx);
    });
  });

  it("rejects unauthorized requests", async () => {
    vi.mocked(isCronAuthorized).mockReturnValue(false);

    const res = await POST(new Request("http://localhost/api/cron/auto-retry", { method: "POST" }));

    expect(res.status).toBe(401);
  });

  it("clears stale claim metadata before retrying paused api runs", async () => {
    vi.mocked(prisma.project.findMany as any).mockResolvedValue([
      {
        id: "proj-1",
        retryCount: 1,
        components: [{ kind: "app", blockers: ["API"], retryAt: new Date(Date.now() - 5 * 60_000), retryCount: 1 }],
      },
    ]);
    vi.mocked(prisma.runLog.create as any).mockResolvedValue({});
    vi.mocked(requirePrimaryComponentRow as any).mockResolvedValue({
      projectId: "proj-1",
      componentId: "cmp-1",
      powerIntent: "ON",
      runtimeState: "ABSENT",
      agentState: "IDLE",
      blockers: ["API"],
      lastOutcome: null,
      lastOutcomeAt: null,
      retryAt: null,
      previewHealth: "UNKNOWN",
      previewCheckedAt: null,
      provisionedAt: null,
      containerName: null,
      previewUrl: null,
      workerHost: null,
      vpsHostId: null,
      lastHeartbeat: null,
      retryCount: 1,
      archivedAt: null,
    });
    vi.mocked(applyStateChange as any).mockResolvedValue({});

    const res = await POST(new Request("http://localhost/api/cron/auto-retry", { method: "POST" }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ retried: 1 });
    expect(prisma.project.update).not.toHaveBeenCalled();
    expect(applyStateChange).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      "proj-1",
      { type: "removeBlocker", blocker: "API" },
      expect.objectContaining({ source: "cron", reason: "auto_retry" }),
    );
    expect(applyStateChange).toHaveBeenCalledTimes(1);
    expect(updateComponentMetadata).toHaveBeenCalledWith(
      expect.anything(),
      "proj-1",
      { retryCount: 2, retryAt: null },
      expect.objectContaining({ reason: "auto_retry_resume_claimable" }),
    );
  });

  it("treats a live blocked runner as a supervisor resume, not a requeue reset", async () => {
    vi.mocked(prisma.project.findMany as any).mockResolvedValue([
      {
        id: "proj-1",
        components: [{ kind: "app", blockers: ["RATE_LIMIT"], retryAt: new Date(Date.now() - 5 * 60_000), retryCount: 1 }],
      },
    ]);
    vi.mocked(requirePrimaryComponentRow as any).mockResolvedValue({
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
      previewCheckedAt: null,
      provisionedAt: new Date(),
      containerName: "preview-proj-1",
      previewUrl: "https://preview.example.com",
      workerHost: "local",
      vpsHostId: null,
      lastHeartbeat: new Date(),
      retryCount: 1,
      archivedAt: null,
    });
    const res = await POST(new Request("http://localhost/api/cron/auto-retry", { method: "POST" }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ retried: 1 });
    expect(applyStateChange).toHaveBeenCalledTimes(1);
    expect(applyStateChange).toHaveBeenCalledWith(
      expect.anything(),
      "proj-1",
      { type: "removeBlocker", blocker: "RATE_LIMIT" },
      expect.objectContaining({ reason: "auto_retry" }),
    );
    expect(updateComponentMetadata).toHaveBeenCalledWith(
      expect.anything(),
      "proj-1",
      { retryCount: 2, retryAt: null },
      expect.objectContaining({ reason: "auto_retry_supervisor_resume" }),
    );
    expect(prisma.project.update).not.toHaveBeenCalled();
  });

  it("clears RATE_LIMIT for agent-off projects without turning the agent on", async () => {
    vi.mocked(prisma.project.findMany as any).mockResolvedValue([
      {
        id: "proj-agent-off",
        components: [{ kind: "app", blockers: ["RATE_LIMIT"], retryAt: new Date(Date.now() - 5 * 60_000), retryCount: 1 }],
      },
    ]);
    vi.mocked(requirePrimaryComponentRow as any).mockResolvedValue({
      projectId: "proj-agent-off",
      componentId: "cmp-1",
      powerIntent: "ON",
      agentIntent: "OFF",
      runtimeState: "RUNNING",
      agentState: "IDLE",
      blockers: ["RATE_LIMIT"],
      lastOutcome: null,
      lastOutcomeAt: null,
      retryAt: null,
      previewHealth: "HEALTHY",
      previewCheckedAt: null,
      provisionedAt: new Date(),
      containerName: "preview-proj-agent-off",
      previewUrl: "https://preview.example.com",
      workerHost: "local",
      vpsHostId: null,
      lastHeartbeat: new Date(),
      retryCount: 1,
      archivedAt: null,
    });

    const res = await POST(new Request("http://localhost/api/cron/auto-retry", { method: "POST" }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ retried: 1 });
    expect((prisma.project.findMany as any).mock.calls[0][0].where.components.some).not.toHaveProperty("agentIntent");
    expect(vi.mocked(applyStateChange as any).mock.calls.map((call) => call[2])).toEqual([
      { type: "removeBlocker", blocker: "RATE_LIMIT" },
    ]);
    expect(updateComponentMetadata).toHaveBeenCalledWith(
      expect.anything(),
      "proj-agent-off",
      { retryCount: 2, retryAt: null },
      expect.objectContaining({ reason: "auto_retry_supervisor_resume" }),
    );
    expect(prisma.project.update).not.toHaveBeenCalled();
  });

  it("keeps RATE_LIMIT auto-retry resumable even after many prior pauses", async () => {
    vi.mocked(prisma.project.findMany as any).mockResolvedValue([
      {
        id: "proj-1",
        components: [{ kind: "app", blockers: ["RATE_LIMIT"], retryAt: new Date(Date.now() - 5 * 60_000), retryCount: 6 }],
      },
    ]);
    vi.mocked(requirePrimaryComponentRow as any).mockResolvedValue({
      projectId: "proj-1",
      componentId: "cmp-1",
      powerIntent: "ON",
      agentIntent: "ON",
      runtimeState: "RUNNING",
      agentState: "IDLE",
      blockers: ["RATE_LIMIT"],
      lastOutcome: null,
      lastOutcomeAt: null,
      retryAt: new Date(Date.now() - 5 * 60_000),
      previewHealth: "HEALTHY",
      previewCheckedAt: null,
      provisionedAt: new Date(),
      containerName: "preview-proj-1",
      previewUrl: "https://preview.example.com",
      workerHost: "local",
      vpsHostId: null,
      lastHeartbeat: new Date(),
      retryCount: 6,
      archivedAt: null,
    });

    const res = await POST(new Request("http://localhost/api/cron/auto-retry", { method: "POST" }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ retried: 1 });
    expect(applyStateChange).toHaveBeenCalledWith(
      expect.anything(),
      "proj-1",
      { type: "removeBlocker", blocker: "RATE_LIMIT" },
      expect.objectContaining({ reason: "auto_retry" }),
    );
    expect(updateComponentMetadata).toHaveBeenCalledWith(
      expect.anything(),
      "proj-1",
      { retryCount: 7, retryAt: null },
      expect.objectContaining({ reason: "auto_retry_supervisor_resume" }),
    );
  });

  it("does not depend on generic lifecycle selector baggage for the already-narrow app tuple", async () => {
    vi.mocked(prisma.project.findMany as any).mockResolvedValue([
      {
        id: "proj-1",
        components: [{ blockers: ["RATE_LIMIT"], retryAt: new Date(Date.now() - 5 * 60_000), retryCount: 1 }],
      },
    ]);
    vi.mocked(requirePrimaryComponentRow as any).mockResolvedValue({
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
      previewCheckedAt: null,
      provisionedAt: new Date(),
      containerName: "preview-proj-1",
      previewUrl: "https://preview.example.com",
      workerHost: "local",
      vpsHostId: null,
      lastHeartbeat: new Date(),
      retryCount: 1,
      archivedAt: null,
    });

    const res = await POST(new Request("http://localhost/api/cron/auto-retry", { method: "POST" }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ retried: 1 });
    expect(applyStateChange).toHaveBeenCalledWith(
      expect.anything(),
      "proj-1",
      { type: "removeBlocker", blocker: "RATE_LIMIT" },
      expect.objectContaining({ reason: "auto_retry" }),
    );
  });

  it("preserves launch evidence when retrying blocked absent rows", async () => {
    const provisionedAt = new Date("2026-04-18T00:00:00.000Z");
    vi.mocked(prisma.project.findMany as any).mockResolvedValue([
      {
        id: "proj-1",
        components: [{ kind: "app", blockers: ["INFRA"], retryAt: new Date(Date.now() - 5 * 60_000), retryCount: 2 }],
      },
    ]);
    vi.mocked(requirePrimaryComponentRow as any).mockResolvedValue({
      projectId: "proj-1",
      componentId: "cmp-1",
      powerIntent: "ON",
      agentIntent: "ON",
      runtimeState: "ABSENT",
      agentState: "IDLE",
      blockers: ["INFRA"],
      lastOutcome: null,
      lastOutcomeAt: null,
      retryAt: null,
      previewHealth: "UNKNOWN",
      previewCheckedAt: null,
      provisionedAt,
      containerName: null,
      previewUrl: null,
      workerHost: "local",
      vpsHostId: null,
      lastHeartbeat: null,
      retryCount: 2,
      archivedAt: null,
    });

    const res = await POST(new Request("http://localhost/api/cron/auto-retry", { method: "POST" }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ retried: 1 });
    expect(updateComponentMetadata).toHaveBeenCalledWith(
      expect.anything(),
      "proj-1",
      { retryCount: 3, retryAt: null },
      expect.objectContaining({ reason: "auto_retry_resume_claimable" }),
    );
    expect(applyStateChange).toHaveBeenCalledTimes(1);
    expect(prisma.project.update).not.toHaveBeenCalled();
  });

  // RA-382: `retryAt` for RATE_LIMIT comes from the provider's error text. When
  // the provider releases the window early, live quota truth must win over it.
  describe("RA-382: early unpark on live provider quota", () => {
    const futureRetryAt = () => new Date(Date.now() + 3 * 24 * 60 * 60_000);

    const codexSubscriptionRow = (id = "proj-quota") => ({
      id,
      agent: "codex",
      providerBillingMode: "platform_credentials",
      claudeAuthMode: null,
      codexAuthMode: "subscription",
      components: [{ kind: "app", blockers: ["RATE_LIMIT"], retryAt: futureRetryAt(), retryCount: 1 }],
    });

    const snapshotWithOpenAiUsage = (usedPercent: number | null) => ({
      generatedAt: new Date().toISOString(),
      results: [
        {
          provider: "openai" as const,
          source: "codex-rpc" as const,
          ok: true,
          windows: [
            { label: "5h limit", usedPercent, resetsAt: null, valueLabel: null, detail: null },
            // Informational row: never evidence either way.
            { label: "Credits", usedPercent: null, resetsAt: null, valueLabel: "$0.00 remaining", detail: null },
          ],
        },
      ],
    });

    beforeEach(() => {
      vi.mocked(requirePrimaryComponentRow as any).mockResolvedValue({
        projectId: "proj-quota",
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
        previewCheckedAt: null,
        provisionedAt: new Date(),
        containerName: "preview-proj-quota",
        previewUrl: "https://preview.example.com",
        workerHost: "local",
        vpsHostId: null,
        lastHeartbeat: new Date(),
        retryCount: 1,
        archivedAt: null,
      });
    });

    it("unparks before retryAt when the provider window reports headroom", async () => {
      vi.mocked(prisma.project.findMany as any).mockResolvedValue([codexSubscriptionRow()]);
      vi.mocked(fetchProviderQuotaSnapshot as any).mockResolvedValue(snapshotWithOpenAiUsage(7));

      const res = await POST(new Request("http://localhost/api/cron/auto-retry", { method: "POST" }));
      const body = await res.json();

      expect(body).toEqual({ retried: 1 });
      expect(applyStateChange).toHaveBeenCalledWith(
        expect.anything(),
        "proj-quota",
        { type: "removeBlocker", blocker: "RATE_LIMIT" },
        expect.objectContaining({ reason: "auto_retry_quota_window_free" }),
      );
    });

    it("keeps waiting while the provider window is still exhausted", async () => {
      vi.mocked(prisma.project.findMany as any).mockResolvedValue([codexSubscriptionRow()]);
      vi.mocked(fetchProviderQuotaSnapshot as any).mockResolvedValue(snapshotWithOpenAiUsage(100));

      const res = await POST(new Request("http://localhost/api/cron/auto-retry", { method: "POST" }));
      const body = await res.json();

      expect(body).toEqual({ retried: 0 });
      expect(applyStateChange).not.toHaveBeenCalled();
    });

    it("keeps waiting when the quota probe is unavailable", async () => {
      vi.mocked(prisma.project.findMany as any).mockResolvedValue([codexSubscriptionRow()]);
      vi.mocked(fetchProviderQuotaSnapshot as any).mockRejectedValue(new Error("authd unreachable"));

      const res = await POST(new Request("http://localhost/api/cron/auto-retry", { method: "POST" }));
      const body = await res.json();

      expect(body).toEqual({ retried: 0 });
      expect(applyStateChange).not.toHaveBeenCalled();
    });

    it("keeps waiting when the provider reports no measurable window", async () => {
      vi.mocked(prisma.project.findMany as any).mockResolvedValue([codexSubscriptionRow()]);
      vi.mocked(fetchProviderQuotaSnapshot as any).mockResolvedValue(snapshotWithOpenAiUsage(null));

      const res = await POST(new Request("http://localhost/api/cron/auto-retry", { method: "POST" }));
      const body = await res.json();

      expect(body).toEqual({ retried: 0 });
      expect(applyStateChange).not.toHaveBeenCalled();
    });

    it("never probes quota for rows that do not run on the shared platform subscription", async () => {
      vi.mocked(prisma.project.findMany as any).mockResolvedValue([
        { ...codexSubscriptionRow("proj-byok"), providerBillingMode: "byok", codexAuthMode: "api_key" },
      ]);

      const res = await POST(new Request("http://localhost/api/cron/auto-retry", { method: "POST" }));
      const body = await res.json();

      expect(body).toEqual({ retried: 0 });
      expect(fetchProviderQuotaSnapshot).not.toHaveBeenCalled();
    });

    it("does not extend early unpark to non-RATE_LIMIT blockers", async () => {
      vi.mocked(prisma.project.findMany as any).mockResolvedValue([
        {
          ...codexSubscriptionRow("proj-infra"),
          components: [{ kind: "app", blockers: ["INFRA"], retryAt: futureRetryAt(), retryCount: 1 }],
        },
      ]);
      vi.mocked(fetchProviderQuotaSnapshot as any).mockResolvedValue(snapshotWithOpenAiUsage(7));

      const res = await POST(new Request("http://localhost/api/cron/auto-retry", { method: "POST" }));
      const body = await res.json();

      expect(body).toEqual({ retried: 0 });
      expect(fetchProviderQuotaSnapshot).not.toHaveBeenCalled();
    });

    it("probes the provider once per pass and unparks the whole cohort", async () => {
      vi.mocked(prisma.project.findMany as any).mockResolvedValue([
        codexSubscriptionRow("proj-a"),
        codexSubscriptionRow("proj-b"),
        codexSubscriptionRow("proj-c"),
      ]);
      vi.mocked(fetchProviderQuotaSnapshot as any).mockResolvedValue(snapshotWithOpenAiUsage(7));

      const res = await POST(new Request("http://localhost/api/cron/auto-retry", { method: "POST" }));
      const body = await res.json();

      expect(body).toEqual({ retried: 3 });
      expect(fetchProviderQuotaSnapshot).toHaveBeenCalledTimes(1);
    });
  });
});
