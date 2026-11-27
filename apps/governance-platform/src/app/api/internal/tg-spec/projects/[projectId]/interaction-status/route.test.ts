import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

vi.mock("server-only", () => ({}));

vi.mock("@/lib/internal-auth", () => ({
  isTgSpecInternalAuthorized: vi.fn(),
}));

vi.mock("@/lib/project-interaction", () => ({
  getProjectInteractionSnapshotForViewer: vi.fn(),
}));

import { isTgSpecInternalAuthorized } from "@/lib/internal-auth";
import { getProjectInteractionSnapshotForViewer } from "@/lib/project-interaction";

function request() {
  return new Request("http://localhost/api/internal/tg-spec/projects/project-1/interaction-status");
}

function context(projectId = "project-1") {
  return {
    params: Promise.resolve({ projectId }),
  };
}

describe("GET /api/internal/tg-spec/projects/:projectId/interaction-status", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isTgSpecInternalAuthorized).mockReturnValue(true);
    vi.mocked(getProjectInteractionSnapshotForViewer).mockResolvedValue({
      status: "ok",
      snapshot: {
        project: {
          id: "project-1",
          name: "Sushi Kitties",
          slug: "sushi-kitties",
        },
        app: {
          blockers: [],
        },
        execution: {
          latestAcceptedUpdate: null,
          activeChangeBatches: [],
          statusSummary: {
            stage: "working",
            title: "Ralph работает",
            summary: "Сейчас: Add checkout",
            lines: ["Сейчас: Add checkout", "Часть активных изменений готова; Ralph продолжает работу."],
            currentTaskLabel: "Add checkout",
            activeBatchCount: 0,
            activeWorkItemCount: 0,
            completedWorkItemCount: null,
            action: {
              kind: "open_work",
              label: "Ход работы",
            },
          },
        },
        tasks: [{
          id: "task-1",
          label: "Fix synth pad",
          status: "completed",
          orderIndex: 0,
          source: null,
        }],
        proofReviews: [{
          id: "proof:TASK-BUG-006",
          taskId: "TASK-BUG-006",
          taskLabel: "Fix checkout",
          status: "ready",
          action: {
            kind: "review_screenshots",
            label: "Проверить скриншоты",
          },
          source: null,
          before: {
            role: "before",
            kind: "screenshot",
            availability: "available",
            url: "/api/internal/projects/project-1/assets/asset-before/download",
            assetId: "asset-before",
            contentType: "image/png",
            sha256: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            capturedAt: "2026-05-16T12:01:00.000Z",
            unavailableReason: null,
          },
          after: {
            role: "after",
            kind: "screenshot",
            availability: "available",
            url: "/api/internal/projects/project-1/assets/asset-after/download",
            assetId: "asset-after",
            contentType: "image/png",
            sha256: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
            capturedAt: "2026-05-16T12:02:00.000Z",
            unavailableReason: null,
          },
        }],
        visualEvidenceReviews: [{
          id: "visual:abc123",
          taskId: "task-1",
          taskLabel: "Fix synth pad",
          status: "unassessed",
          action: {
            kind: "review_visual_evidence",
            label: "Проверить скриншоты",
            href: "/my/projects/project-1?focus=visualEvidence&review=visual%3Aabc123#project-visual-evidence",
          },
          sourceEvidenceRef: "visual-workbench-capture:synth-pad.playing.desktop:desktop:aaaaaaaaaaaa",
          feedbackItemIds: ["BUG-006"],
          diffItemIds: ["DIFF-003-BUG-006"],
          sourceKind: "visual_workbench",
          target: {
            route: "/visual-workbench/synth-pad.playing.desktop",
            viewport: { width: 1280, height: 800 },
            claim: "synth pad shows the active playing state",
            state: "playing",
            interaction: null,
          },
          observedAt: "2026-06-07T09:00:00.000Z",
          summary: "Visual Workbench story captured.",
          artifactSha256: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          artifact: {
            availability: "available",
            url: "/api/projects/project-1/visual-evidence/visual:abc123/artifact",
            contentType: "image/png",
            sha256: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            unavailableReason: null,
          },
          assessments: [],
        }],
      },
    } as any);
  });

  it("rejects unauthorized requests", async () => {
    vi.mocked(isTgSpecInternalAuthorized).mockReturnValue(false);

    const res = await GET(request(), context());

    expect(res.status).toBe(401);
    expect(getProjectInteractionSnapshotForViewer).not.toHaveBeenCalled();
  });

  it("returns a chat-safe Arena interaction status projection", async () => {
    const res = await GET(request(), context("arena-project-1"));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      project: {
        id: "project-1",
        name: "Sushi Kitties",
        slug: "sushi-kitties",
      },
      statusSummary: {
        stage: "working",
        title: "Ralph работает",
        summary: "Сейчас: Add checkout",
        lines: ["Сейчас: Add checkout", "Часть активных изменений готова; Ralph продолжает работу."],
        currentTaskLabel: "Add checkout",
        activeBatchCount: 0,
        activeWorkItemCount: 0,
        completedWorkItemCount: null,
        action: {
          kind: "open_work",
          label: "Ход работы",
        },
      },
      activeChangeBatches: [],
      latestAcceptedUpdate: null,
      visualEvidenceReadiness: {
        status: "available",
        reasonCode: "visual_evidence_reviews_available",
        message: "Arena has current visual evidence reviews with available screenshot artifacts for this project.",
        counts: {
          proofReviewCount: 1,
          visualEvidenceReviewCount: 1,
          reviewableVisualEvidenceReviewCount: 1,
          unavailableVisualEvidenceArtifactCount: 0,
          taskCount: 1,
          activeBatchCount: 0,
          activeWorkItemCount: 0,
          completedActiveWorkItemCount: 0,
          taskStatusCounts: {
            pending: 0,
            inProgress: 0,
            completed: 1,
            failed: 0,
            skipped: 0,
          },
        },
        statusSummaryStage: "working",
        blockers: [],
        evidenceNotes: [
          "This is read-side diagnostics over ProjectInteractionSnapshot; it does not scan raw Workbench folders, outbox rows or legacy proof assets.",
          "Telegram screenshot review availability comes only from artifact-backed visualEvidenceReviews.",
        ],
      },
      proofReviews: [{
        id: "proof:TASK-BUG-006",
        taskId: "TASK-BUG-006",
        taskLabel: "Fix checkout",
        status: "ready",
        action: {
          kind: "review_screenshots",
          label: "Проверить скриншоты",
        },
        source: null,
        before: {
          role: "before",
          kind: "screenshot",
          availability: "available",
          url: "/api/internal/projects/project-1/assets/asset-before/download",
          assetId: "asset-before",
          contentType: "image/png",
          sha256: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          capturedAt: "2026-05-16T12:01:00.000Z",
          unavailableReason: null,
        },
        after: {
          role: "after",
          kind: "screenshot",
          availability: "available",
          url: "/api/internal/projects/project-1/assets/asset-after/download",
          assetId: "asset-after",
          contentType: "image/png",
          sha256: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          capturedAt: "2026-05-16T12:02:00.000Z",
          unavailableReason: null,
        },
      }],
      visualEvidenceReviews: [{
        id: "visual:abc123",
        taskId: "task-1",
        taskLabel: "Fix synth pad",
        status: "unassessed",
        action: {
          kind: "review_visual_evidence",
          label: "Проверить скриншоты",
          href: "/my/projects/project-1?focus=visualEvidence&review=visual%3Aabc123#project-visual-evidence",
        },
        sourceEvidenceRef: "visual-workbench-capture:synth-pad.playing.desktop:desktop:aaaaaaaaaaaa",
        feedbackItemIds: ["BUG-006"],
        diffItemIds: ["DIFF-003-BUG-006"],
        sourceKind: "visual_workbench",
        target: {
          route: "/visual-workbench/synth-pad.playing.desktop",
          viewport: { width: 1280, height: 800 },
          claim: "synth pad shows the active playing state",
          state: "playing",
          interaction: null,
        },
        observedAt: "2026-06-07T09:00:00.000Z",
        summary: "Visual Workbench story captured.",
        artifactSha256: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        artifact: {
          availability: "available",
          url: "/api/projects/project-1/visual-evidence/visual:abc123/artifact",
          contentType: "image/png",
          sha256: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          unavailableReason: null,
        },
        assessments: [],
      }],
    });
    expect(getProjectInteractionSnapshotForViewer).toHaveBeenCalledWith({
      projectId: "arena-project-1",
      session: null,
      hasBypass: true,
      surface: "telegram",
    });
  });

  it("does not expose a Telegram screenshot action for visual evidence without an artifact", async () => {
    vi.mocked(getProjectInteractionSnapshotForViewer).mockResolvedValueOnce({
      status: "ok",
      snapshot: {
        project: {
          id: "project-1",
          name: "Sushi Kitties",
          slug: "sushi-kitties",
        },
        app: {
          blockers: [],
        },
        execution: {
          latestAcceptedUpdate: {
            sourceVersion: 1,
            targetSpecVersion: 1,
            artifactId: "artifact-1",
            diffId: "diff-1",
            summary: "Fix synth pad",
            diffItemCount: 1,
            workItemCount: 1,
            acceptedAt: "2026-06-07T08:55:00.000Z",
          },
          activeChangeBatches: [],
          statusSummary: {
            stage: "completed",
            title: "Готово",
            summary: "Работа завершена.",
            lines: ["Работа завершена."],
            currentTaskLabel: null,
            activeBatchCount: 0,
            activeWorkItemCount: 0,
            completedWorkItemCount: 1,
            action: null,
          },
        },
        tasks: [{
          id: "task-1",
          label: "Fix synth pad",
          status: "completed",
          orderIndex: 0,
          source: null,
        }],
        proofReviews: [],
        visualEvidenceReviews: [{
          id: "visual:abc123",
          taskId: "task-1",
          taskLabel: "Fix synth pad",
          status: "unassessed",
          action: {
            kind: "review_visual_evidence",
            label: "Проверить скриншоты",
            href: "/my/projects/project-1?focus=visualEvidence&review=visual%3Aabc123#project-visual-evidence",
          },
          sourceEvidenceRef: "visual-workbench-capture:synth-pad.playing.desktop:desktop:aaaaaaaaaaaa",
          feedbackItemIds: ["BUG-006"],
          diffItemIds: ["DIFF-003-BUG-006"],
          sourceKind: "visual_workbench",
          target: {
            route: "/visual-workbench/synth-pad.playing.desktop",
            viewport: { width: 1280, height: 800 },
            claim: "synth pad shows the active playing state",
            state: "playing",
            interaction: null,
          },
          observedAt: "2026-06-07T09:00:00.000Z",
          summary: "Visual Workbench story captured.",
          artifactSha256: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          artifact: {
            availability: "unavailable",
            url: null,
            contentType: null,
            sha256: null,
            unavailableReason: "missing_artifact",
          },
          assessments: [],
        }],
      },
    } as any);

    const res = await GET(request(), context("arena-project-1"));
    const payload = await res.json();

    expect(res.status).toBe(200);
    expect(payload.visualEvidenceReadiness).toMatchObject({
      status: "not_available",
      reasonCode: "visual_evidence_artifacts_missing",
      counts: {
        visualEvidenceReviewCount: 1,
        reviewableVisualEvidenceReviewCount: 0,
        unavailableVisualEvidenceArtifactCount: 1,
      },
    });
    expect(payload.visualEvidenceReviews).toEqual([]);
    expect(JSON.stringify(payload)).not.toContain("review_visual_evidence");
  });

  it("returns Arena-owned visual evidence empty-state diagnostics without a screenshot action", async () => {
    vi.mocked(getProjectInteractionSnapshotForViewer).mockResolvedValueOnce({
      status: "ok",
      snapshot: {
        project: {
          id: "project-waiting",
          name: "Waiting Demo",
          slug: "waiting-demo",
        },
        app: {
          blockers: ["RATE_LIMIT"],
        },
        execution: {
          statusSummary: {
            stage: "waiting",
            title: "Ждём окно модели",
            summary: "Рабочие задачи: 0 из 2.",
            lines: ["Рабочие задачи: 0 из 2."],
            currentTaskLabel: null,
            activeBatchCount: 1,
            activeWorkItemCount: 2,
            completedWorkItemCount: 0,
            action: {
              kind: "wait",
              label: "Ждать",
            },
          },
          latestAcceptedUpdate: {
            sourceVersion: 1,
            targetSpecVersion: 1,
            artifactId: "artifact-1",
            diffId: "diff-1",
            summary: "Create ordinary-web UI",
            diffItemCount: 2,
            workItemCount: 2,
            acceptedAt: "2026-06-11T08:00:00.000Z",
          },
          activeChangeBatches: [{
            id: "batch-1",
            sourceVersion: 1,
            targetSpecVersion: 1,
            artifactId: "artifact-1",
            diffId: "diff-1",
            summary: "Create ordinary-web UI",
            acceptedAt: "2026-06-11T08:00:00.000Z",
            status: "pending",
            workItemCount: 2,
            completedItemCount: 0,
            pendingItemCount: 2,
            changeCounts: {
              total: 2,
              add: 2,
              modify: 0,
              remove: 0,
              fix: 0,
              question: 0,
              superseded: 0,
              other: 0,
            },
          }],
        },
        tasks: [{
          id: "task-001",
          label: "Build jam room shell",
          status: "pending",
          orderIndex: 0,
          source: null,
        }, {
          id: "task-002",
          label: "Add Workbench state",
          status: "pending",
          orderIndex: 1,
          source: null,
        }],
        proofReviews: [],
        visualEvidenceReviews: [],
      },
    } as any);

    const res = await GET(request(), context("project-waiting"));
    const payload = await res.json();

    expect(res.status).toBe(200);
    expect(payload.visualEvidenceReadiness).toMatchObject({
      status: "not_available",
      reasonCode: "work_waiting_for_blocker",
      blockers: ["RATE_LIMIT"],
      counts: {
        visualEvidenceReviewCount: 0,
        activeWorkItemCount: 2,
        completedActiveWorkItemCount: 0,
        taskStatusCounts: {
          pending: 2,
        },
      },
    });
    expect(payload.visualEvidenceReviews).toEqual([]);
    expect(JSON.stringify(payload)).not.toContain("review_visual_evidence");
  });

  it("preserves not-found as a narrow internal API response", async () => {
    vi.mocked(getProjectInteractionSnapshotForViewer).mockResolvedValue({ status: "not_found" } as any);

    const res = await GET(request(), context("missing-project"));

    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({ error: "Project not found" });
  });
});
