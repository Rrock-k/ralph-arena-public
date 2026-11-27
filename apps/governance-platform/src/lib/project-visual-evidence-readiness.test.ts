import { describe, expect, it } from "vitest";
import type { ProjectInteractionSnapshot } from "@arena/contracts";
import { buildVisualEvidenceReadiness } from "./project-visual-evidence-readiness";

function snapshotFixture(
  overrides: Partial<ProjectInteractionSnapshot> = {},
): ProjectInteractionSnapshot {
  const base = {
    project: {
      id: "project-1",
      name: "Visual Demo",
      slug: "visual-demo",
    },
    app: {
      blockers: [],
    },
    execution: {
      statusSummary: {
        stage: "completed",
        title: "Готово",
        summary: "Работа завершена.",
      },
      latestAcceptedUpdate: {
        sourceVersion: 3,
        targetSpecVersion: 3,
        artifactId: "artifact-3",
        diffId: "diff-3",
        summary: "Add visual widget",
        diffItemCount: 1,
        workItemCount: 1,
        acceptedAt: "2026-06-11T08:00:00.000Z",
      },
      activeChangeBatches: [],
    },
    tasks: [{
      id: "task-001",
      label: "Build visual widget",
      status: "completed",
      orderIndex: 0,
      source: null,
    }],
    proofReviews: [],
    visualEvidenceReviews: [],
  };

  return {
    ...base,
    ...overrides,
    app: {
      ...base.app,
      ...overrides.app,
    },
    execution: {
      ...base.execution,
      ...overrides.execution,
      statusSummary: {
        ...base.execution.statusSummary,
        ...overrides.execution?.statusSummary,
      },
    },
  } as ProjectInteractionSnapshot;
}

describe("buildVisualEvidenceReadiness", () => {
  it("reports available only from artifact-backed visualEvidenceReviews", () => {
    const readiness = buildVisualEvidenceReadiness(snapshotFixture({
      visualEvidenceReviews: [{
        id: "visual:task-001:desktop",
        taskId: "task-001",
        taskLabel: "Build visual widget",
        status: "unassessed",
        action: {
          kind: "review_visual_evidence",
          label: "Проверить скриншоты",
          href: "/my/projects/project-1?focus=visualEvidence",
        },
        sourceEvidenceRef: "visual-workbench-capture:widget.default:desktop:sha",
        feedbackItemIds: ["BUG-001"],
        diffItemIds: ["DIFF-003-BUG-001"],
        sourceKind: "visual_workbench",
        target: {
          route: "/visual-workbench/widget.default",
          viewport: { width: 1280, height: 800 },
          claim: "Widget default state renders",
          state: null,
          interaction: null,
        },
        observedAt: "2026-06-11T08:10:00.000Z",
        summary: "Visual Workbench story captured.",
        artifactSha256: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        artifact: {
          availability: "available",
          url: "/api/projects/project-1/visual-evidence/visual:task-001:desktop/artifact",
          contentType: "image/png",
          sha256: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          unavailableReason: null,
        },
        assessments: [],
      }],
    }));

    expect(readiness).toMatchObject({
      status: "available",
      reasonCode: "visual_evidence_reviews_available",
      counts: {
        visualEvidenceReviewCount: 1,
        reviewableVisualEvidenceReviewCount: 1,
        unavailableVisualEvidenceArtifactCount: 0,
        taskCount: 1,
        taskStatusCounts: {
          completed: 1,
        },
      },
      blockers: [],
    });
  });

  it("does not report available when visual evidence metadata has no artifact", () => {
    const readiness = buildVisualEvidenceReadiness(snapshotFixture({
      visualEvidenceReviews: [{
        id: "visual:task-001:desktop",
        taskId: "task-001",
        taskLabel: "Build visual widget",
        status: "unassessed",
        action: {
          kind: "review_visual_evidence",
          label: "Проверить скриншоты",
          href: "/my/projects/project-1?focus=visualEvidence",
        },
        sourceEvidenceRef: "visual-workbench-capture:widget.default:desktop:sha",
        feedbackItemIds: ["BUG-001"],
        diffItemIds: ["DIFF-003-BUG-001"],
        sourceKind: "visual_workbench",
        target: {
          route: "/visual-workbench/widget.default",
          viewport: { width: 1280, height: 800 },
          claim: "Widget default state renders",
          state: null,
          interaction: null,
        },
        observedAt: "2026-06-11T08:10:00.000Z",
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
    }));

    expect(readiness).toMatchObject({
      status: "not_available",
      reasonCode: "visual_evidence_artifacts_missing",
      counts: {
        visualEvidenceReviewCount: 1,
        reviewableVisualEvidenceReviewCount: 0,
        unavailableVisualEvidenceArtifactCount: 1,
      },
    });
  });

  it("explains lifecycle blockers without manufacturing a screenshot action", () => {
    const readiness = buildVisualEvidenceReadiness(snapshotFixture({
      app: {
        blockers: ["RATE_LIMIT"],
      },
      execution: {
        statusSummary: {
          stage: "waiting",
          title: "Ждём окно модели",
          summary: "Работа ждёт внешнего лимита.",
        },
        latestAcceptedUpdate: {
          sourceVersion: 4,
          targetSpecVersion: 4,
          artifactId: "artifact-4",
          diffId: "diff-4",
          summary: "Add frontend visual state",
          diffItemCount: 2,
          workItemCount: 2,
          acceptedAt: "2026-06-11T08:30:00.000Z",
        },
        activeChangeBatches: [{
          id: "batch-4",
          sourceVersion: 4,
          targetSpecVersion: 4,
          artifactId: "artifact-4",
          diffId: "diff-4",
          summary: "Add frontend visual state",
          acceptedAt: "2026-06-11T08:30:00.000Z",
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
        label: "Build visual widget",
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
    }));

    expect(readiness).toMatchObject({
      status: "not_available",
      reasonCode: "work_waiting_for_blocker",
      statusSummaryStage: "waiting",
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
    expect(JSON.stringify(readiness)).not.toContain("review_visual_evidence");
  });

  it("keeps completed work without visual evidence as not available", () => {
    const readiness = buildVisualEvidenceReadiness(snapshotFixture());

    expect(readiness).toMatchObject({
      status: "not_available",
      reasonCode: "completed_without_visual_evidence",
      counts: {
        visualEvidenceReviewCount: 0,
        taskStatusCounts: {
          completed: 1,
        },
      },
    });
  });

  it("reports absence of accepted work before task or evidence guesses", () => {
    const readiness = buildVisualEvidenceReadiness(snapshotFixture({
      execution: {
        statusSummary: {
          stage: "idle",
          title: "Нет принятой работы",
          summary: "Проект ждёт принятую спеку.",
        },
        latestAcceptedUpdate: null,
        activeChangeBatches: [],
      },
      tasks: [],
    }));

    expect(readiness).toMatchObject({
      status: "not_available",
      reasonCode: "no_current_accepted_update",
      counts: {
        taskCount: 0,
        visualEvidenceReviewCount: 0,
      },
    });
  });
});
