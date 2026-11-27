import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: vi.fn(),
    project: { update: vi.fn(), findUnique: vi.fn() },
    projectAsset: { findMany: vi.fn() },
    projectBudget: { updateMany: vi.fn() },
    projectComponent: { update: vi.fn() },
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

vi.mock("@/lib/project-update-outbox", () => ({
  enqueueProjectUpdate: vi.fn(),
}));

vi.mock("@/lib/project-telegram-mini-app-url", () => ({
  resolveProjectTelegramMiniAppEntryUrl: vi.fn().mockResolvedValue(null),
}));

import { prisma } from "@/lib/prisma";
import { notifyProjectEvent } from "@/lib/progress-bus";
import { isRunnerAuthorized } from "@/lib/internal-auth";
import { applyStateChange, updateComponentMetadata, requirePrimaryComponentRow } from "@/lib/project-state-effects";
import { enqueueProjectUpdate } from "@/lib/project-update-outbox";
import { resolveProjectTelegramMiniAppEntryUrl } from "@/lib/project-telegram-mini-app-url";

function acceptedArtifact(sourceVersion: number, itemId: string) {
  const suffix = String(sourceVersion).padStart(3, "0");
  return {
    artifactSchemaVersion: "ra-287.accepted-spec-artifact.v1",
    artifactId: `SPEC-${suffix}`,
    acceptedAt: `2026-05-16T12:0${sourceVersion}:00.000Z`,
    source: {
      id: `SRC-${suffix}`,
      sourceSystem: "tg-spec",
      sourceProjectId: "tg-project-1",
      sourceVersion,
      sourceRefType: "accepted_spec",
      sourceId: `tg-spec-version-${sourceVersion}`,
    },
    acceptedSpec: {
      id: `SPEC-${suffix}`,
      version: sourceVersion,
      document: {
        specSchemaVersion: "ra-287.spec-document.v1",
        title: "Telegram Shop",
        sections: [],
        requirements: [],
        extensionBlocks: [{
          id: `SPEC-${suffix}-MARKDOWN`,
          title: "Rendered spec",
          body: "Build the product",
          reason: "Test fixture.",
          sourceRefs: [`SRC-${suffix}`],
        }],
      },
      renderedMarkdown: "Build the product",
      contentHash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      sourceRefs: [`SRC-${suffix}`],
    },
    acceptedDiff: {
      id: `DIFF-${suffix}`,
      targetSpecVersion: sourceVersion,
      summary: `Spec update v${sourceVersion}`,
      items: [{
        id: itemId,
        targetType: "spec",
        targetId: `SPEC-${suffix}`,
        changeType: "updated",
        workImpact: "requires_loop_work",
        summary: `Spec work for v${sourceVersion}`,
        sourceRefs: [`SRC-${suffix}`],
      }],
    },
    feedback: [],
    assumptions: [],
    secretRequirements: [],
    assets: [],
  };
}

const screenshotReviewTarget = {
  route: "/?tab=feed",
  viewport: { width: 430, height: 844 },
  claim: "Practice modal is fullscreen on wide mobile",
};

describe("POST /api/internal/project-progress", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isRunnerAuthorized).mockReturnValue(true);
    vi.mocked(resolveProjectTelegramMiniAppEntryUrl).mockResolvedValue(null);
    vi.mocked(prisma.$transaction as any).mockImplementation(async (callback: (tx: typeof prisma) => Promise<unknown>) => callback(prisma as any));
    vi.mocked(requirePrimaryComponentRow as any).mockResolvedValue({
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
      previewCheckedAt: null,
      provisionedAt: null,
      containerName: "preview-proj-1",
      previewUrl: "https://preview.example.com",
      workerHost: "local",
      vpsHostId: null,
      lastHeartbeat: null,
      retryCount: 0,
      archivedAt: null,
    });
    vi.mocked(applyStateChange as any).mockResolvedValue({});
    vi.mocked(updateComponentMetadata as any).mockResolvedValue({});
    vi.mocked((prisma as any).projectAsset.findMany).mockResolvedValue([]);
    vi.mocked(prisma.project.findUnique as any).mockResolvedValue({ specs: [] });
  });

  it("rejects unauthorized requests", async () => {
    vi.mocked(isRunnerAuthorized).mockReturnValue(false);

    const req = new Request("http://localhost/api/internal/project-progress", {
      method: "POST",
      body: JSON.stringify({ projectId: "proj-1", status: "RUNNING" }),
      headers: { "content-type": "application/json" },
    });

    const res = await POST(req);
    expect(res.status).toBe(401);
    expect(isRunnerAuthorized).toHaveBeenCalledWith(expect.any(Request), { projectId: "proj-1" });
  });

  it("updates project progressJson when projectId is provided", async () => {
    vi.mocked(prisma.project.update as any).mockResolvedValue({});

    const req = new Request("http://localhost/api/internal/project-progress", {
      method: "POST",
      body: JSON.stringify({
        eventType: "project_progress",
        projectId: "proj-1",
        status: "RUNNING",
        progressJson: "{\"state\":\"verification\"}",
      }),
      headers: { "content-type": "application/json" },
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(prisma.project.update).toHaveBeenCalledWith({
      where: { id: "proj-1" },
      data: expect.objectContaining({
        progressJson: "{\"state\":\"verification\"}",
      }),
    });
    expect(applyStateChange).toHaveBeenCalled();
    expect(notifyProjectEvent).toHaveBeenCalledWith(
      "proj-1",
      expect.objectContaining({
        type: "changed",
        status: "RUNNING",
      }),
    );
  });

  it("enqueues compact execution progress updates without raw progress fields", async () => {
    vi.mocked(prisma.project.update as any).mockResolvedValue({});

    const req = new Request("http://localhost/api/internal/project-progress", {
      method: "POST",
      body: JSON.stringify({
        eventType: "project_progress",
        projectId: "proj-1",
        status: "RUNNING",
        progressJson: JSON.stringify({
          state: "working",
          featuresCompleted: 1,
          featuresTotal: 3,
          currentFeature: { displayTitle: "Build checkout", description: "Build checkout preview", debug: "must-not-leak" },
          steps: [
            { id: "task-1", displayTitle: "Build checkout", label: "Build checkout preview", status: "in_progress", debug: "must-not-leak" },
            { id: "task-2", label: "Deploy preview", status: "pending" },
            { id: "task-3", label: "Check result", status: "pending" },
          ],
          rawLog: "must-not-leak",
        }),
      }),
      headers: { "content-type": "application/json" },
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(enqueueProjectUpdate).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        projectId: "proj-1",
        eventType: "progress.updated",
        dedupeKey: expect.stringMatching(/^progress:[a-f0-9]{16}$/),
        payload: {
          currentTask: "Build checkout",
        },
      }),
    );
    expect(JSON.stringify(vi.mocked(enqueueProjectUpdate).mock.calls)).not.toContain("must-not-leak");
  });

  it("enqueues completed task feedback before the next active progress update", async () => {
    vi.mocked(prisma.project.update as any).mockResolvedValue({});
    const previousProgressJson = JSON.stringify({
      state: "working",
      steps: [
        {
          id: "task-1",
          label: "Build checkout preview",
          status: "in_progress",
          feedbackItemRefs: [{
            diffItemId: "DIFF-012-SPEC",
            targetType: "spec",
            targetId: "SPEC-012",
            summary: "Product Spec: checkout must show the payment state.",
          }],
        },
        { id: "task-2", label: "Deploy preview", status: "pending" },
      ],
    });
    vi.mocked(prisma.project.findUnique as any)
      .mockResolvedValueOnce({ progressJson: previousProgressJson })
      .mockResolvedValue({ specs: [] });

    const req = new Request("http://localhost/api/internal/project-progress", {
      method: "POST",
      body: JSON.stringify({
        eventType: "project_progress",
        projectId: "proj-1",
        status: "RUNNING",
        progressJson: JSON.stringify({
          state: "working",
          steps: [
            {
              id: "task-1",
              label: "Build checkout preview",
              status: "completed",
              feedbackItemRefs: [{
                diffItemId: "DIFF-012-SPEC",
                targetType: "spec",
                targetId: "SPEC-012",
                summary: "Product Spec: checkout must show the payment state.",
              }],
            },
            { id: "task-2", label: "Deploy preview", status: "in_progress" },
          ],
        }),
      }),
      headers: { "content-type": "application/json" },
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const updateCalls = vi.mocked(enqueueProjectUpdate).mock.calls
      .map(([, update]) => update);
    const completedIndex = updateCalls.findIndex((update) => update.eventType === "task.completed");
    const progressIndex = updateCalls.findIndex((update) => update.eventType === "progress.updated");
    expect(completedIndex).toBeGreaterThanOrEqual(0);
    expect(progressIndex).toBeGreaterThan(completedIndex);
    expect(updateCalls[completedIndex]).toMatchObject({
      projectId: "proj-1",
      eventType: "task.completed",
      dedupeKey: expect.stringMatching(/^task-completed:[a-f0-9]{16}$/),
      payload: {
        taskId: "task-1",
        title: "Build checkout preview",
        status: "completed",
        diffItemId: "DIFF-012-SPEC",
        coveredSummary: "Product Spec: checkout must show the payment state.",
      },
    });
    expect(updateCalls[progressIndex]).toMatchObject({
      eventType: "progress.updated",
      payload: { currentTask: "Deploy preview" },
    });
  });

  it("enqueues plan-ready as accepted-update delta instead of lifetime task count", async () => {
    vi.mocked(prisma.project.update as any).mockResolvedValue({});

    const req = new Request("http://localhost/api/internal/project-progress", {
      method: "POST",
      body: JSON.stringify({
        eventType: "project_progress",
        projectId: "proj-1",
        status: "RUNNING",
        progressJson: JSON.stringify({
          state: "planning",
          sourceVersion: 12,
          targetSpecVersion: 12,
          workItemCount: 3,
          featuresTotal: 110,
          steps: [
            { id: "task-1", label: "Build checkout preview", status: "pending" },
            { id: "task-2", label: "Deploy preview", status: "pending" },
          ],
        }),
      }),
      headers: { "content-type": "application/json" },
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(enqueueProjectUpdate).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        projectId: "proj-1",
        eventType: "plan.ready",
        payload: {
          sourceVersion: 12,
          targetSpecVersion: 12,
          workItemCount: 3,
          workStage: "planner",
        },
      }),
    );
  });

  it("passes controller workStage as compact progress metadata", async () => {
    vi.mocked(prisma.project.update as any).mockResolvedValue({});

    const req = new Request("http://localhost/api/internal/project-progress", {
      method: "POST",
      body: JSON.stringify({
        eventType: "project_progress",
        projectId: "proj-1",
        status: "RUNNING",
        progressJson: JSON.stringify({
          state: "coding",
          workStage: "controller",
          steps: [
            { id: "task-1", displayTitle: "Review implementation", status: "in_progress" },
          ],
          rawLog: "must-not-leak",
        }),
      }),
      headers: { "content-type": "application/json" },
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(enqueueProjectUpdate).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        projectId: "proj-1",
        eventType: "progress.updated",
        payload: {
          currentTask: "Review implementation",
          workStage: "controller",
        },
      }),
    );
    expect(JSON.stringify(vi.mocked(enqueueProjectUpdate).mock.calls)).not.toContain("must-not-leak");
  });

  it("enqueues a scoped batch-completed milestone when older accepted work finishes and newer work remains", async () => {
    vi.mocked(prisma.project.update as any).mockResolvedValue({});
    vi.mocked(prisma.project.findUnique as any).mockResolvedValue({
      specs: [{
        versions: [
          { version: 4, acceptedArtifact: acceptedArtifact(4, "DIFF-004-SPEC") },
          { version: 3, acceptedArtifact: acceptedArtifact(3, "DIFF-003-SPEC") },
        ],
      }],
    });

    const req = new Request("http://localhost/api/internal/project-progress", {
      method: "POST",
      body: JSON.stringify({
        eventType: "project_progress",
        projectId: "proj-1",
        status: "RUNNING",
        progressJson: JSON.stringify({
          state: "working",
          bundleVersion: "22.32",
          steps: [
            {
              id: "task-1",
              displayTitle: "Finish v3",
              status: "completed",
              feedbackItemRefs: [{ diffItemId: "DIFF-003-SPEC" }],
            },
            {
              id: "task-2",
              displayTitle: "Build v4",
              status: "pending",
              feedbackItemRefs: [{ diffItemId: "DIFF-004-SPEC" }],
            },
          ],
        }),
      }),
      headers: { "content-type": "application/json" },
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(enqueueProjectUpdate).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        projectId: "proj-1",
        eventType: "change_batch.completed",
        dedupeKey: "change-batch-completed:DIFF-003:1",
        payload: expect.objectContaining({
          sourceVersion: 3,
          targetSpecVersion: 3,
          diffId: "DIFF-003",
          workItemCount: 1,
          remainingBatchCount: 1,
          nextSourceVersion: 4,
          nextTargetSpecVersion: 4,
          versionLabel: "v22.32",
          completedItems: [expect.objectContaining({
            diffItemId: "DIFF-003-SPEC",
            title: "Spec work for v3",
            verification: "Spec work for v3",
            coveredSummary: "Spec work for v3",
            versionLabel: "v22.32",
          })],
        }),
      }),
    );
    expect(enqueueProjectUpdate).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        eventType: "change_batch.completed",
        dedupeKey: "change-batch-completed:DIFF-004:1",
      }),
    );
  });

  it("enqueues a scoped batch-completed milestone without legacy screenshot proof metadata", async () => {
    vi.mocked(prisma.project.update as any).mockResolvedValue({});
    vi.mocked((prisma as any).projectAsset.findMany).mockResolvedValue([
      {
        path: "assets/proof/task-1/before.png",
        contentType: "image/png",
        sha256: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      },
      {
        path: "assets/proof/task-1/after.png",
        contentType: "image/png",
        sha256: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      },
    ]);
    vi.mocked(prisma.project.findUnique as any).mockResolvedValue({
      specs: [{
        versions: [
          { version: 3, acceptedArtifact: acceptedArtifact(3, "DIFF-003-SPEC") },
        ],
      }],
    });

    const req = new Request("http://localhost/api/internal/project-progress", {
      method: "POST",
      body: JSON.stringify({
        eventType: "project_progress",
        projectId: "proj-1",
        status: "RUNNING",
        progressJson: JSON.stringify({
          state: "idle",
          steps: [
            {
              id: "task-1",
              displayTitle: "Finish v3",
              status: "completed",
              feedbackItemRefs: [{ diffItemId: "DIFF-003-SPEC" }],
              proofExpectations: [{
                kind: "before_after_screenshot",
                reason: "ordinary_web_ui_ux_task",
                source: "projectConfig.techStack.web+task.requiredRolePasses.ux",
                status: "satisfied",
                evidence: [{
                  kind: "screenshot",
                  role: "before",
                  ref: "proof:before",
                  result: "pass",
                  target: screenshotReviewTarget,
                  artifactPath: "assets/proof/task-1/before.png",
                }, {
                  kind: "screenshot",
                  role: "after",
                  ref: "proof:after",
                  result: "pass",
                  target: screenshotReviewTarget,
                  artifactPath: "assets/proof/task-1/after.png",
                }],
              }],
            },
          ],
        }),
      }),
      headers: { "content-type": "application/json" },
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(enqueueProjectUpdate).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        projectId: "proj-1",
        eventType: "change_batch.completed",
        dedupeKey: "change-batch-completed:DIFF-003:1",
        payload: expect.objectContaining({
          sourceVersion: 3,
          targetSpecVersion: 3,
          diffId: "DIFF-003",
          workItemCount: 1,
          remainingBatchCount: 0,
        }),
      }),
    );
    const completedPayloads = vi.mocked(enqueueProjectUpdate).mock.calls
      .map(([, update]) => update)
      .filter((update) => update.projectId === "proj-1" && update.eventType === "change_batch.completed")
      .map((update) => update.payload ?? {});
    expect(completedPayloads).toHaveLength(1);
    for (const payload of completedPayloads) {
      expect(payload).not.toHaveProperty("proofReviewId");
      expect(payload).not.toHaveProperty("proofReviewStatus");
    }
    expect((prisma as any).projectAsset.findMany).not.toHaveBeenCalled();
  });

  it("enqueues the final batch-completed milestone when linked work items are completed", async () => {
    vi.mocked(prisma.project.update as any).mockResolvedValue({});
    vi.mocked(prisma.project.findUnique as any).mockResolvedValue({
      specs: [{
        versions: [
          { version: 3, acceptedArtifact: acceptedArtifact(3, "DIFF-003-SPEC") },
        ],
      }],
    });

    const req = new Request("http://localhost/api/internal/project-progress", {
      method: "POST",
      body: JSON.stringify({
        eventType: "project_progress",
        projectId: "proj-1",
        status: "RUNNING",
        progressJson: JSON.stringify({
          state: "completed",
          steps: [
            {
              id: "task-1",
              displayTitle: "Finish v3",
              status: "completed",
              feedbackItemRefs: [{ diffItemId: "DIFF-003-SPEC" }],
            },
          ],
        }),
        telegramMiniAppUrl: "https://t.me/sample_bot/sampleapp?startapp=batch",
      }),
      headers: { "content-type": "application/json" },
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(enqueueProjectUpdate).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        projectId: "proj-1",
        eventType: "change_batch.completed",
        dedupeKey: "change-batch-completed:DIFF-003:1",
        payload: expect.objectContaining({
          sourceVersion: 3,
          targetSpecVersion: 3,
          diffId: "DIFF-003",
          workItemCount: 1,
          remainingBatchCount: 0,
          previewUrl: "https://preview.example.com",
          telegramMiniAppUrl: "https://t.me/sample_bot/sampleapp?startapp=batch",
        }),
      }),
    );
  });

  it("does not enqueue a batch-completed milestone for skipped-only accepted work", async () => {
    vi.mocked(prisma.project.update as any).mockResolvedValue({});
    vi.mocked(prisma.project.findUnique as any).mockReset();
    vi.mocked(prisma.project.findUnique as any)
      .mockResolvedValueOnce({ progressJson: null })
      .mockResolvedValueOnce({
        specs: [{
          versions: [
            { version: 3, acceptedArtifact: acceptedArtifact(3, "DIFF-003-SPEC") },
          ],
        }],
      });

    const req = new Request("http://localhost/api/internal/project-progress", {
      method: "POST",
      body: JSON.stringify({
        eventType: "project_progress",
        projectId: "proj-1",
        status: "RUNNING",
        progressJson: JSON.stringify({
          state: "working",
          steps: [
            {
              id: "task-1",
              displayTitle: "Auth-failed implementation attempt",
              status: "skipped",
              feedbackItemRefs: [{ diffItemId: "DIFF-003-SPEC" }],
            },
          ],
        }),
      }),
      headers: { "content-type": "application/json" },
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(enqueueProjectUpdate).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        projectId: "proj-1",
        eventType: "change_batch.completed",
      }),
    );
  });

  it("does not count old unlinked accepted batches as remaining next work", async () => {
    vi.mocked(prisma.project.update as any).mockResolvedValue({});
    vi.mocked(prisma.project.findUnique as any).mockResolvedValue({
      specs: [{
        versions: [
          { version: 5, acceptedArtifact: acceptedArtifact(5, "DIFF-005-SPEC") },
          { version: 2, acceptedArtifact: acceptedArtifact(2, "DIFF-002-SPEC") },
        ],
      }],
    });

    const req = new Request("http://localhost/api/internal/project-progress", {
      method: "POST",
      body: JSON.stringify({
        eventType: "project_progress",
        projectId: "proj-1",
        status: "RUNNING",
        progressJson: JSON.stringify({
          state: "idle",
          steps: [
            {
              id: "task-5",
              displayTitle: "Finish current accepted batch",
              status: "completed",
              feedbackItemRefs: [{ diffItemId: "DIFF-005-SPEC" }],
            },
          ],
        }),
      }),
      headers: { "content-type": "application/json" },
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(enqueueProjectUpdate).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        projectId: "proj-1",
        eventType: "change_batch.completed",
        dedupeKey: "change-batch-completed:DIFF-005:1",
        payload: expect.objectContaining({
          sourceVersion: 5,
          targetSpecVersion: 5,
          diffId: "DIFF-005",
          workItemCount: 1,
          remainingBatchCount: 0,
        }),
      }),
    );
    expect(enqueueProjectUpdate).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        payload: expect.objectContaining({
          nextSourceVersion: 2,
        }),
      }),
    );
  });

  it("does not backfill every old completed batch when no newer work remains", async () => {
    vi.mocked(prisma.project.update as any).mockResolvedValue({});
    vi.mocked(prisma.project.findUnique as any).mockResolvedValue({
      specs: [{
        versions: [
          { version: 4, acceptedArtifact: acceptedArtifact(4, "DIFF-004-SPEC") },
          { version: 3, acceptedArtifact: acceptedArtifact(3, "DIFF-003-SPEC") },
        ],
      }],
    });

    const req = new Request("http://localhost/api/internal/project-progress", {
      method: "POST",
      body: JSON.stringify({
        eventType: "project_progress",
        projectId: "proj-1",
        status: "RUNNING",
        progressJson: JSON.stringify({
          state: "idle",
          steps: [
            {
              id: "task-1",
              displayTitle: "Finish v3",
              status: "completed",
              feedbackItemRefs: [{ diffItemId: "DIFF-003-SPEC" }],
            },
            {
              id: "task-2",
              displayTitle: "Finish v4",
              status: "completed",
              feedbackItemRefs: [{ diffItemId: "DIFF-004-SPEC" }],
            },
          ],
        }),
      }),
      headers: { "content-type": "application/json" },
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(enqueueProjectUpdate).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        projectId: "proj-1",
        eventType: "change_batch.completed",
        dedupeKey: "change-batch-completed:DIFF-004:1",
      }),
    );
    expect(enqueueProjectUpdate).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        eventType: "change_batch.completed",
        dedupeKey: "change-batch-completed:DIFF-003:1",
      }),
    );
  });

  it("enqueues safe spec-gap assumption review actions without raw judgment details", async () => {
    vi.mocked(prisma.project.update as any).mockResolvedValue({});

    const req = new Request("http://localhost/api/internal/project-progress", {
      method: "POST",
      body: JSON.stringify({
        eventType: "project_progress",
        projectId: "proj-1",
        status: "RUNNING",
        progressJson: JSON.stringify({
          state: "working",
          assumptionReviews: [
            {
              id: "ASM-RALPH-PROVIDER",
              title: "Provider choice",
              statement: "The spec does not name a production provider, so Ralph will use the configured provider.",
              judgmentId: "judgment-001",
              options: ["private option"],
              reasoning: "private reasoning",
            },
            {
              id: "ASM-RALPH-BUG-005",
              title: "Needs confirmation for BUG-005",
              statement: "BUG-005 appears implemented, but product evidence has not confirmed it yet.",
            },
            {
              id: "judgment-002",
              title: "Raw private judgment",
              statement: "This must be ignored.",
            },
          ],
        }),
      }),
      headers: { "content-type": "application/json" },
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(enqueueProjectUpdate).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        projectId: "proj-1",
        eventType: "action.required",
        dedupeKey: expect.stringMatching(/^assumption-review:ASM-RALPH-PROVIDER:[a-f0-9]{16}$/),
        payload: {
          reasonCode: "ASSUMPTION",
          assumptionId: "ASM-RALPH-PROVIDER",
          assumptionTitle: "Provider choice",
          summary: "The spec does not name a production provider, so Ralph will use the configured provider.",
        },
      }),
    );
    expect(JSON.stringify(vi.mocked(enqueueProjectUpdate).mock.calls)).not.toContain("judgment-001");
    expect(JSON.stringify(vi.mocked(enqueueProjectUpdate).mock.calls)).not.toContain("private option");
    expect(JSON.stringify(vi.mocked(enqueueProjectUpdate).mock.calls)).not.toContain("private reasoning");
    expect(JSON.stringify(vi.mocked(enqueueProjectUpdate).mock.calls)).not.toContain("judgment-002");
    expect(JSON.stringify(vi.mocked(enqueueProjectUpdate).mock.calls)).not.toContain("Needs confirmation");
  });

  it("does not enqueue plan-ready from unscoped runner task totals", async () => {
    vi.mocked(prisma.project.update as any).mockResolvedValue({});

    const req = new Request("http://localhost/api/internal/project-progress", {
      method: "POST",
      body: JSON.stringify({
        eventType: "project_progress",
        projectId: "proj-1",
        status: "RUNNING",
        progressJson: JSON.stringify({
          state: "planning",
          featuresTotal: 110,
          steps: [
            { id: "task-1", label: "Build checkout preview", status: "pending" },
            { id: "task-2", label: "Deploy preview", status: "pending" },
          ],
        }),
      }),
      headers: { "content-type": "application/json" },
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(enqueueProjectUpdate).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        eventType: "plan.ready",
      }),
    );
  });

  it("clears project progressJson when runner explicitly reports null progress", async () => {
    vi.mocked(prisma.project.update as any).mockResolvedValue({});

    const req = new Request("http://localhost/api/internal/project-progress", {
      method: "POST",
      body: JSON.stringify({
        eventType: "project_progress",
        projectId: "proj-1",
        status: "RUNNING",
        progressJson: null,
      }),
      headers: { "content-type": "application/json" },
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(prisma.project.update).toHaveBeenCalledWith({
      where: { id: "proj-1" },
      data: { progressJson: null },
    });
    expect(applyStateChange).not.toHaveBeenCalled();
  });

  it("preserves blocked work progress when a resident preview reports missing progress", async () => {
    vi.mocked(prisma.project.update as any).mockResolvedValue({});
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
      retryAt: new Date("2026-04-22T19:00:00.000Z"),
      previewHealth: "HEALTHY",
      previewCheckedAt: null,
      provisionedAt: new Date("2026-04-17T09:00:00.000Z"),
      containerName: "preview-proj-1",
      previewUrl: "https://preview.example.com",
      workerHost: "local",
      vpsHostId: null,
      lastHeartbeat: null,
      retryCount: 6,
      archivedAt: null,
    });

    const req = new Request("http://localhost/api/internal/project-progress", {
      method: "POST",
      body: JSON.stringify({
        eventType: "project_progress",
        projectId: "proj-1",
        status: "RUNNING",
        progressJson: null,
        previewActual: "SERVING",
      }),
      headers: { "content-type": "application/json" },
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(prisma.project.update).not.toHaveBeenCalled();
    expect(updateComponentMetadata).toHaveBeenCalledWith(
      expect.anything(),
      "proj-1",
      expect.objectContaining({ lastHeartbeat: expect.any(Date) }),
      expect.objectContaining({ trigger: "progress_heartbeat" }),
    );
    expect(applyStateChange).not.toHaveBeenCalled();
  });

  it("writes component heartbeat before project progressJson to avoid lock-order deadlocks", async () => {
    vi.mocked(prisma.project.update as any).mockResolvedValue({});

    const req = new Request("http://localhost/api/internal/project-progress", {
      method: "POST",
      body: JSON.stringify({
        eventType: "project_progress",
        projectId: "proj-1",
        status: "RUNNING",
        progressJson: "{\"state\":\"working\"}",
      }),
      headers: { "content-type": "application/json" },
    });

    const res = await POST(req);
    expect(res.status).toBe(200);

    const heartbeatOrder = vi.mocked(updateComponentMetadata as any).mock.invocationCallOrder[0];
    const progressUpdateOrder = vi.mocked(prisma.project.update as any).mock.invocationCallOrder[0];

    expect(heartbeatOrder).toBeLessThan(progressUpdateOrder);
  });

  it("ignores progress from stale runners without runtime identity", async () => {
    vi.mocked(requirePrimaryComponentRow as any).mockResolvedValue({
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
      containerName: null,
      previewUrl: null,
      workerHost: null,
      vpsHostId: null,
      lastHeartbeat: null,
      retryCount: 0,
      archivedAt: null,
    });

    const req = new Request("http://localhost/api/internal/project-progress", {
      method: "POST",
      body: JSON.stringify({
        eventType: "project_progress",
        projectId: "proj-1",
        status: "RUNNING",
        progressJson: "{\"state\":\"verification\"}",
      }),
      headers: { "content-type": "application/json" },
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(prisma.project.update).not.toHaveBeenCalled();
    expect(applyStateChange).not.toHaveBeenCalled();
  });

  it("does not reopen RUNNING after agent_off convergence", async () => {
    vi.mocked(prisma.project.update as any).mockResolvedValue({});
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
      previewCheckedAt: null,
      provisionedAt: null,
      containerName: "preview-proj-1",
      previewUrl: "https://preview.example.com",
      workerHost: "local",
      vpsHostId: null,
      lastHeartbeat: null,
      retryCount: 0,
      archivedAt: null,
    });

    const req = new Request("http://localhost/api/internal/project-progress", {
      method: "POST",
      body: JSON.stringify({
        eventType: "project_progress",
        projectId: "proj-1",
        status: "RUNNING",
        progressJson: "{\"state\":\"idle\"}",
      }),
      headers: { "content-type": "application/json" },
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(applyStateChange).not.toHaveBeenCalled();
    expect(notifyProjectEvent).toHaveBeenCalledWith(
      "proj-1",
      expect.objectContaining({
        type: "project_progress",
        status: "RUNNING",
      }),
    );
  });

  it("does not reopen a blocked paused row back into RUNNING", async () => {
    vi.mocked(prisma.project.update as any).mockResolvedValue({});
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
      retryAt: new Date("2026-04-22T19:00:00.000Z"),
      previewHealth: "HEALTHY",
      previewCheckedAt: null,
      provisionedAt: new Date("2026-04-17T09:00:00.000Z"),
      containerName: "preview-proj-1",
      previewUrl: "https://preview.example.com",
      workerHost: "local",
      vpsHostId: null,
      lastHeartbeat: null,
      retryCount: 6,
      archivedAt: null,
    });

    const req = new Request("http://localhost/api/internal/project-progress", {
      method: "POST",
      body: JSON.stringify({
        eventType: "project_progress",
        projectId: "proj-1",
        status: "RUNNING",
        progressJson: "{\"state\":\"paused_rate_limit\"}",
      }),
      headers: { "content-type": "application/json" },
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(applyStateChange).not.toHaveBeenCalled();
    expect(updateComponentMetadata).toHaveBeenCalledWith(
      expect.anything(),
      "proj-1",
      expect.objectContaining({ lastHeartbeat: expect.any(Date) }),
      expect.objectContaining({ trigger: "progress_heartbeat" }),
    );
    expect(notifyProjectEvent).toHaveBeenCalledWith(
      "proj-1",
      expect.objectContaining({
        type: "project_progress",
        status: "RUNNING",
      }),
    );
  });

  it("parks a live running loop into IDLE when progress reports idle", async () => {
    vi.mocked(prisma.project.update as any).mockResolvedValue({});
    vi.mocked(requirePrimaryComponentRow as any).mockResolvedValue({
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
      previewCheckedAt: null,
      provisionedAt: new Date("2026-04-17T09:00:00.000Z"),
      containerName: "preview-proj-1",
      previewUrl: "https://preview.example.com",
      workerHost: "local",
      vpsHostId: null,
      lastHeartbeat: null,
      retryCount: 0,
      archivedAt: null,
    });

    const req = new Request("http://localhost/api/internal/project-progress", {
      method: "POST",
      body: JSON.stringify({
        eventType: "project_progress",
        projectId: "proj-1",
        status: "RUNNING",
        progressJson: "{\"state\":\"idle\"}",
      }),
      headers: { "content-type": "application/json" },
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(applyStateChange).toHaveBeenCalledWith(
      expect.anything(),
      "proj-1",
      { type: "agentTransition", state: "IDLE" },
      { source: "runner", trigger: "progress_idle" },
    );
    expect(prisma.project.update).toHaveBeenCalledWith({
      where: { id: "proj-1" },
      data: expect.objectContaining({
        progressJson: "{\"state\":\"idle\"}",
      }),
    });
    expect(notifyProjectEvent).toHaveBeenCalledWith(
      "proj-1",
      expect.objectContaining({
        type: "changed",
        status: "RUNNING",
      }),
    );
  });

  it("marks preview healthy once active runner progress reports a serving preview", async () => {
    vi.mocked(prisma.project.update as any).mockResolvedValue({});
    vi.mocked(requirePrimaryComponentRow as any).mockResolvedValue({
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
      provisionedAt: new Date("2026-04-17T09:00:00.000Z"),
      containerName: "preview-proj-1",
      previewUrl: "https://preview.example.com",
      workerHost: "local",
      vpsHostId: null,
      lastHeartbeat: null,
      retryCount: 0,
      archivedAt: null,
    });

    const req = new Request("http://localhost/api/internal/project-progress", {
      method: "POST",
      body: JSON.stringify({
        eventType: "project_progress",
        projectId: "proj-1",
        status: "RUNNING",
        progressJson: "{\"state\":\"working\"}",
        previewActual: "SERVING",
      }),
      headers: { "content-type": "application/json" },
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(applyStateChange).not.toHaveBeenCalled();
    expect(updateComponentMetadata).toHaveBeenCalledWith(
      expect.anything(),
      "proj-1",
      expect.objectContaining({
        lastHeartbeat: expect.any(Date),
        previewHealth: "HEALTHY",
        previewCheckedAt: expect.any(Date),
      }),
      expect.objectContaining({ trigger: "progress_heartbeat" }),
    );
    expect(notifyProjectEvent).toHaveBeenCalledWith(
      "proj-1",
      expect.objectContaining({
        type: "changed",
        status: "RUNNING",
      }),
    );
  });

  it("does not fabricate current task from phase message when a running loop recovers preview health", async () => {
    vi.mocked(prisma.project.update as any).mockResolvedValue({});
    vi.mocked(requirePrimaryComponentRow as any).mockResolvedValue({
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
      provisionedAt: new Date("2026-04-17T09:00:00.000Z"),
      containerName: "preview-proj-1",
      previewUrl: "https://preview.example.com",
      workerHost: "local",
      vpsHostId: null,
      lastHeartbeat: null,
      retryCount: 0,
      archivedAt: null,
    });

    const req = new Request("http://localhost/api/internal/project-progress", {
      method: "POST",
      body: JSON.stringify({
        eventType: "project_progress",
        projectId: "proj-1",
        status: "RUNNING",
        progressJson: JSON.stringify({
          state: "coding",
          message: "coding: Build the new turn section",
        }),
        previewActual: "SERVING",
      }),
      headers: { "content-type": "application/json" },
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(enqueueProjectUpdate).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        projectId: "proj-1",
        eventType: "progress.updated",
        payload: expect.objectContaining({
          currentTask: expect.stringContaining("coding:"),
        }),
      }),
    );
    expect(enqueueProjectUpdate).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        eventType: "preview.ready",
      }),
    );
  });

  it("announces active step progress when a running loop recovers preview health", async () => {
    vi.mocked(prisma.project.update as any).mockResolvedValue({});
    vi.mocked(requirePrimaryComponentRow as any).mockResolvedValue({
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
      provisionedAt: new Date("2026-04-17T09:00:00.000Z"),
      containerName: "preview-proj-1",
      previewUrl: "https://preview.example.com",
      workerHost: "local",
      vpsHostId: null,
      lastHeartbeat: null,
      retryCount: 0,
      archivedAt: null,
    });

    const req = new Request("http://localhost/api/internal/project-progress", {
      method: "POST",
      body: JSON.stringify({
        eventType: "project_progress",
        projectId: "proj-1",
        status: "RUNNING",
        progressJson: JSON.stringify({
          state: "coding",
          message: "coding: Build the new turn section",
          steps: [
            { id: "task-1", displayTitle: "Build the new turn section", status: "in_progress" },
          ],
        }),
        previewActual: "SERVING",
      }),
      headers: { "content-type": "application/json" },
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(enqueueProjectUpdate).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        projectId: "proj-1",
        eventType: "progress.updated",
        dedupeKey: expect.stringMatching(/^progress-preview-active:/),
        payload: {
          currentTask: "Build the new turn section",
        },
      }),
    );
    expect(enqueueProjectUpdate).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        eventType: "preview.ready",
      }),
    );
  });

  it("enqueues preview-ready updates with explicit Mini App entrypoints when provided", async () => {
    vi.mocked(prisma.project.update as any).mockResolvedValue({});
    vi.mocked(requirePrimaryComponentRow as any).mockResolvedValue({
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
      previewHealth: "UNKNOWN",
      previewCheckedAt: null,
      provisionedAt: new Date("2026-04-17T09:00:00.000Z"),
      containerName: "preview-proj-1",
      previewUrl: "https://preview.example.com",
      workerHost: "local",
      vpsHostId: null,
      lastHeartbeat: null,
      retryCount: 0,
      archivedAt: null,
    });

    const req = new Request("http://localhost/api/internal/project-progress", {
      method: "POST",
      body: JSON.stringify({
        eventType: "project_progress",
        projectId: "proj-1",
        status: "RUNNING",
        progressJson: JSON.stringify({ state: "idle" }),
        previewActual: "SERVING",
        telegramMiniAppUrl: "https://t.me/sample_bot/sampleapp?startapp=ready",
      }),
      headers: { "content-type": "application/json" },
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(enqueueProjectUpdate).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        projectId: "proj-1",
        eventType: "preview.ready",
        dedupeKey: expect.stringMatching(/^preview-ready:/),
        payload: {
          previewUrl: "https://preview.example.com",
          telegramMiniAppUrl: "https://t.me/sample_bot/sampleapp?startapp=ready",
        },
      }),
    );
  });

  it("resolves project-owned Mini App entrypoints for preview-ready updates", async () => {
    vi.mocked(prisma.project.update as any).mockResolvedValue({});
    vi.mocked(resolveProjectTelegramMiniAppEntryUrl).mockResolvedValue(
      "https://t.me/samplebot?startapp=cmpcxmtut0h2n5inse8g15ilo",
    );
    vi.mocked(requirePrimaryComponentRow as any).mockResolvedValue({
      projectId: "cmpcxmtut0h2n5inse8g15ilo",
      componentId: "cmp-1",
      powerIntent: "ON",
      agentIntent: "ON",
      runtimeState: "RUNNING",
      agentState: "IDLE",
      blockers: [],
      lastOutcome: null,
      lastOutcomeAt: null,
      retryAt: null,
      previewHealth: "UNKNOWN",
      previewCheckedAt: null,
      provisionedAt: new Date("2026-04-17T09:00:00.000Z"),
      containerName: "preview-sampleapp-g15ilo",
      previewUrl: "https://preview-sampleapp-g15ilo.arena.example.test",
      workerHost: "local",
      vpsHostId: null,
      lastHeartbeat: null,
      retryCount: 0,
      archivedAt: null,
    });

    const req = new Request("http://localhost/api/internal/project-progress", {
      method: "POST",
      body: JSON.stringify({
        eventType: "project_progress",
        projectId: "cmpcxmtut0h2n5inse8g15ilo",
        status: "RUNNING",
        progressJson: JSON.stringify({ state: "idle" }),
        previewActual: "SERVING",
      }),
      headers: { "content-type": "application/json" },
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(resolveProjectTelegramMiniAppEntryUrl).toHaveBeenCalledWith(
      prisma,
      "cmpcxmtut0h2n5inse8g15ilo",
    );
    expect(enqueueProjectUpdate).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        projectId: "cmpcxmtut0h2n5inse8g15ilo",
        eventType: "preview.ready",
        payload: {
          previewUrl: "https://preview-sampleapp-g15ilo.arena.example.test",
          telegramMiniAppUrl: "https://t.me/samplebot?startapp=cmpcxmtut0h2n5inse8g15ilo",
        },
      }),
    );
  });

  it("does not emit repeated changed events once the active preview is already healthy", async () => {
    vi.mocked(prisma.project.update as any).mockResolvedValue({});
    vi.mocked(requirePrimaryComponentRow as any).mockResolvedValue({
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
      previewCheckedAt: new Date("2026-04-17T10:00:00.000Z"),
      provisionedAt: new Date("2026-04-17T09:00:00.000Z"),
      containerName: "preview-proj-1",
      previewUrl: "https://preview.example.com",
      workerHost: "local",
      vpsHostId: null,
      lastHeartbeat: null,
      retryCount: 0,
      archivedAt: null,
    });

    const req = new Request("http://localhost/api/internal/project-progress", {
      method: "POST",
      body: JSON.stringify({
        eventType: "project_progress",
        projectId: "proj-1",
        status: "RUNNING",
        progressJson: "{\"state\":\"working\"}",
        previewActual: "SERVING",
      }),
      headers: { "content-type": "application/json" },
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(updateComponentMetadata).toHaveBeenCalledWith(
      expect.anything(),
      "proj-1",
      { lastHeartbeat: expect.any(Date) },
      expect.objectContaining({ trigger: "progress_heartbeat" }),
    );
    expect(notifyProjectEvent).toHaveBeenCalledWith(
      "proj-1",
      expect.objectContaining({
        type: "project_progress",
        status: "RUNNING",
      }),
    );
  });

  it("parks a blocked running row into IDLE when progress reports a paused state", async () => {
    vi.mocked(prisma.project.update as any).mockResolvedValue({});
    vi.mocked(requirePrimaryComponentRow as any).mockResolvedValue({
      projectId: "proj-1",
      componentId: "cmp-1",
      powerIntent: "ON",
      agentIntent: "ON",
      runtimeState: "RUNNING",
      agentState: "RUNNING",
      blockers: ["RATE_LIMIT"],
      lastOutcome: null,
      lastOutcomeAt: null,
      retryAt: new Date("2026-04-22T19:00:00.000Z"),
      previewHealth: "HEALTHY",
      previewCheckedAt: null,
      provisionedAt: new Date("2026-04-17T09:00:00.000Z"),
      containerName: "preview-proj-1",
      previewUrl: "https://preview.example.com",
      workerHost: "local",
      vpsHostId: null,
      lastHeartbeat: null,
      retryCount: 6,
      archivedAt: null,
    });

    const req = new Request("http://localhost/api/internal/project-progress", {
      method: "POST",
      body: JSON.stringify({
        eventType: "project_progress",
        projectId: "proj-1",
        status: "RUNNING",
        progressJson: "{\"state\":\"paused_rate_limit\"}",
      }),
      headers: { "content-type": "application/json" },
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(applyStateChange).toHaveBeenCalledWith(
      expect.anything(),
      "proj-1",
      { type: "agentTransition", state: "IDLE" },
      { source: "runner", trigger: "progress_idle" },
    );
  });

  it("ignores late progress on a completed idle row instead of reopening terminal success", async () => {
    vi.mocked(prisma.project.update as any).mockResolvedValue({});
    vi.mocked(requirePrimaryComponentRow as any).mockResolvedValue({
      projectId: "proj-1",
      componentId: "cmp-1",
      powerIntent: "ON",
      agentIntent: "ON",
      runtimeState: "RUNNING",
      agentState: "IDLE",
      blockers: [],
      lastOutcome: "COMPLETED",
      lastOutcomeAt: new Date("2026-04-17T10:00:00.000Z"),
      retryAt: null,
      previewHealth: "HEALTHY",
      previewCheckedAt: null,
      provisionedAt: new Date("2026-04-17T09:00:00.000Z"),
      containerName: "preview-proj-1",
      previewUrl: "https://preview.example.com",
      workerHost: "local",
      vpsHostId: null,
      lastHeartbeat: null,
      retryCount: 0,
      archivedAt: null,
    });

    const req = new Request("http://localhost/api/internal/project-progress", {
      method: "POST",
      body: JSON.stringify({
        eventType: "project_progress",
        projectId: "proj-1",
        status: "RUNNING",
        progressJson: "{\"state\":\"working\"}",
      }),
      headers: { "content-type": "application/json" },
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true, ignored: true });
    expect(applyStateChange).not.toHaveBeenCalled();
    expect(prisma.project.update).not.toHaveBeenCalled();
    expect(updateComponentMetadata).not.toHaveBeenCalled();
    expect(notifyProjectEvent).not.toHaveBeenCalled();
  });

  it("returns a retryable error when progress persistence fails", async () => {
    vi.mocked(prisma.$transaction as any).mockRejectedValueOnce(new Error("transaction timeout"));

    const req = new Request("http://localhost/api/internal/project-progress", {
      method: "POST",
      body: JSON.stringify({
        eventType: "budget_debit",
        projectId: "proj-1",
        status: "RUNNING",
        budgetDebitedUsd: 1.25,
        estimatedCostUsd: 21.25,
      }),
      headers: { "content-type": "application/json" },
    });

    const res = await POST(req);
    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toEqual({ error: "Project progress state sync failed" });
    expect(notifyProjectEvent).not.toHaveBeenCalled();
  });
});
