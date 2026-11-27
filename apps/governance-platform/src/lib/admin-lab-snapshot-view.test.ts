import { describe, expect, it } from "vitest";
import {
  getSnapshotExecutorCheckpointReadback,
  getSnapshotNextHandoff,
  getSnapshotSelectedTaskVisualReadback,
  getSnapshotSelectedTaskWorkbenchAutomationReadback,
  getSnapshotTaskCandidates,
} from "./admin-lab-snapshot-view";

describe("Admin Lab snapshot view helpers", () => {
  it("extracts executor task candidates without selecting one implicitly", () => {
    expect(getSnapshotTaskCandidates({
      selectedTaskId: null,
      plan: {
        taskCandidates: [
          {
            id: "task-055",
            displayTitle: "Fix visible vocabulary error",
            status: "in_progress",
            recommendedExecutorMode: "resume_interrupted",
            attempts: 2,
            lastError: "rate limit",
            visualEvidenceRequired: true,
            feedbackItemRefCount: 1,
          },
          {
            id: "task-099",
            status: "completed",
            recommendedExecutorMode: "new_task",
          },
        ],
      },
    })).toEqual([
      {
        id: "task-055",
        title: "Fix visible vocabulary error",
        status: "in_progress",
        recommendedExecutorMode: "resume_interrupted",
        attempts: 2,
        lastError: "rate limit",
        visualEvidenceRequired: true,
        feedbackItemRefCount: 1,
      },
    ]);
  });

  it("uses task id as title when display title is absent", () => {
    expect(getSnapshotTaskCandidates({
      plan: {
        taskCandidates: [{
          id: "task-1",
          status: "pending",
          recommendedExecutorMode: "new_task",
        }],
      },
    })).toEqual([
      {
        id: "task-1",
        title: "task-1",
        status: "pending",
        recommendedExecutorMode: "new_task",
        attempts: null,
        lastError: null,
        visualEvidenceRequired: null,
        feedbackItemRefCount: 0,
      },
    ]);
  });

  it("extracts next handoff strings only", () => {
    expect(getSnapshotNextHandoff({
      nextHandoff: [
        "Select one plan.taskCandidates[].id as --task-id before executor/controller task experiments.",
        "",
        42,
      ],
    })).toEqual([
      "Select one plan.taskCandidates[].id as --task-id before executor/controller task experiments.",
    ]);
  });

  it("reads interrupted-task checkpoint readiness from owner-backed snapshot readback", () => {
    expect(getSnapshotExecutorCheckpointReadback({
      providerSessions: {
        selectedTaskCheckpointReadback: checkpointReadback({
          selectedTaskSessionCount: 2,
          selectedTaskResumableSessionCount: 1,
          status: "checkpoint_ready",
          reasonCode: "failed_error_checkpoint_ready",
          title: "Checkpoint readback is ready",
          message: "Snapshot found a failed/error provider-session checkpoint for this interrupted task. Executor will still validate agent, model and task fingerprint before resume.",
          canPrepareExecutor: true,
        }),
      },
    })).toMatchObject({
      selectedTaskId: "task-055",
      recommendedExecutorMode: "resume_interrupted",
      providerSessionStatus: "ready",
      selectedTaskSessionCount: 2,
      selectedTaskResumableSessionCount: 1,
      nextProjectActionId: null,
      status: "checkpoint_ready",
      canPrepareExecutor: true,
    });
  });

  it("blocks interrupted executor preparation from owner-backed missing checkpoint readback", () => {
    expect(getSnapshotExecutorCheckpointReadback({
      providerSessions: {
        selectedTaskCheckpointReadback: checkpointReadback({
          providerSessionStatus: "missing",
          selectedTaskSessionCount: null,
          selectedTaskResumableSessionCount: null,
          status: "checkpoint_blocked",
          reasonCode: "checkpoint_unavailable",
          title: "Checkpoint required before resume",
          message: "Provider-session checkpoint is missing. Resume will block before provider creation.",
          canPrepareExecutor: false,
        }),
      },
    })).toMatchObject({
      selectedTaskId: "task-055",
      recommendedExecutorMode: "resume_interrupted",
      providerSessionStatus: "missing",
      status: "checkpoint_blocked",
      canPrepareExecutor: false,
    });
  });

  it("blocks interrupted executor preparation when owner readback has no selected-task sessions", () => {
    expect(getSnapshotExecutorCheckpointReadback({
      providerSessions: {
        selectedTaskCheckpointReadback: checkpointReadback({
          selectedTaskSessionCount: 0,
          selectedTaskResumableSessionCount: 0,
          status: "checkpoint_blocked",
          reasonCode: "no_selected_task_session",
          title: "Checkpoint required before resume",
          message: "Snapshot found no provider-session history for this interrupted task. Resume will block before provider creation.",
          canPrepareExecutor: false,
        }),
      },
    })).toMatchObject({
      selectedTaskId: "task-055",
      recommendedExecutorMode: "resume_interrupted",
      providerSessionStatus: "ready",
      selectedTaskSessionCount: 0,
      selectedTaskResumableSessionCount: 0,
      nextProjectActionId: null,
      status: "checkpoint_blocked",
      canPrepareExecutor: false,
    });
  });

  it("routes success-only checkpoint history to the normal Resume agent owner", () => {
    expect(getSnapshotExecutorCheckpointReadback({
      providerSessions: {
        selectedTaskCheckpointReadback: checkpointReadback({
          selectedTaskSessionCount: 1,
          selectedTaskResumableSessionCount: 0,
          nextProjectActionId: "resume_agent",
          status: "checkpoint_blocked",
          reasonCode: "success_checkpoint_not_resumable",
          title: "Use Resume agent, not checkpoint resume",
          message: "Snapshot found provider-session history, but no failed/error checkpoint for this interrupted task. A successful checkpoint is evidence, not resumable work. Select Resume agent to continue through the normal Ralph claim path.",
          canPrepareExecutor: false,
        }),
      },
    })).toMatchObject({
      selectedTaskId: "task-055",
      recommendedExecutorMode: "resume_interrupted",
      providerSessionStatus: "ready",
      selectedTaskSessionCount: 1,
      selectedTaskResumableSessionCount: 0,
      nextProjectActionId: "resume_agent",
      status: "checkpoint_blocked",
      canPrepareExecutor: false,
      title: "Use Resume agent, not checkpoint resume",
      message: "Snapshot found provider-session history, but no failed/error checkpoint for this interrupted task. A successful checkpoint is evidence, not resumable work. Select Resume agent to continue through the normal Ralph claim path.",
    });
  });

  it("does not infer Resume agent handoff from raw provider-session counts", () => {
    expect(getSnapshotExecutorCheckpointReadback({
      providerSessions: {
        status: "ready",
        selectedTaskSessionCount: 1,
        selectedTaskResumableSessionCount: 0,
      },
    })).toBeNull();
  });

  it("does not checkpoint-gate pending and failed executor candidates", () => {
    expect(getSnapshotExecutorCheckpointReadback({
      providerSessions: {
        selectedTaskCheckpointReadback: checkpointReadback({
          selectedTaskId: "task-1",
          selectedTaskStatus: "pending",
          recommendedExecutorMode: "new_task",
          selectedTaskSessionCount: 0,
          selectedTaskResumableSessionCount: 0,
          status: "not_checkpoint_gated",
          reasonCode: "not_checkpoint_gated",
          title: "Executor input can be prepared",
          message: "Pending and failed tasks are not checkpoint-gated. Executor will still create a fresh snapshot before running.",
          canPrepareExecutor: true,
        }),
      },
    })).toMatchObject({
      recommendedExecutorMode: "new_task",
      status: "not_checkpoint_gated",
      canPrepareExecutor: true,
    });
  });

  it("does not prepare executor input before a task is selected", () => {
    expect(getSnapshotExecutorCheckpointReadback({
      providerSessions: {
        selectedTaskCheckpointReadback: checkpointReadback({
          selectedTaskId: null,
          selectedTaskStatus: null,
          recommendedExecutorMode: null,
          selectedTaskSessionCount: null,
          selectedTaskResumableSessionCount: null,
          status: "not_selected",
          tone: "neutral",
          reasonCode: "task_id_not_selected",
          title: "No task selected",
          message: "Snapshot must be rerun with one task id before executor input can be prepared.",
          canPrepareExecutor: false,
        }),
      },
    })).toMatchObject({
      selectedTaskId: null,
      status: "not_selected",
      canPrepareExecutor: false,
    });
  });

  it("does not prepare executor input for a selected non-candidate task", () => {
    expect(getSnapshotExecutorCheckpointReadback({
      providerSessions: {
        selectedTaskCheckpointReadback: checkpointReadback({
          selectedTaskId: "task-done",
          selectedTaskStatus: "completed",
          recommendedExecutorMode: null,
          selectedTaskSessionCount: 1,
          selectedTaskResumableSessionCount: 1,
          status: "not_executor_candidate",
          reasonCode: "not_executor_candidate",
          title: "Task is not executor-ready",
          message: "Selected task status completed is not a pending, failed or interrupted executor candidate.",
          canPrepareExecutor: false,
        }),
      },
    })).toMatchObject({
      selectedTaskId: "task-done",
      recommendedExecutorMode: null,
      status: "not_executor_candidate",
      canPrepareExecutor: false,
    });
  });

  it("reads selected-task visual handoff from owner-backed snapshot readback", () => {
    expect(getSnapshotSelectedTaskVisualReadback({
      selectedTaskVisualReadback: visualReadback({
        nextProjectActionId: "check_story_selection",
        status: "check_story_selection_ready",
        reasonCode: "check_story_selection_ready",
        title: "Story selection can be checked",
        message: "This only selects Check story selection for the same task. It does not capture screenshots or create evidence.",
        canCheckStorySelection: true,
      }),
    })).toMatchObject({
      selectedTaskId: "task-055",
      visualEvidenceRequired: true,
      visualEvidenceMode: "new_tasks_only",
      visualEvidencePolicyStatus: "ready",
      visualWorkbenchManifestStatus: "ready",
      canRunWorkbenchCapture: true,
      visualExpectationSources: ["task.visualEvidenceRequired"],
      nextProjectActionId: "check_story_selection",
      status: "check_story_selection_ready",
      canCheckStorySelection: true,
    });
  });

  it("does not infer selected-task visual handoff from raw visual fields", () => {
    expect(getSnapshotSelectedTaskVisualReadback({
      selectedTaskId: "task-055",
      visualEvidencePolicy: {
        status: "ready",
        visualEvidenceMode: "new_tasks_only",
      },
      visualWorkbenchManifestReadiness: {
        available: true,
        status: "ready",
        canRunWorkbenchCapture: true,
      },
      plan: {
        selectedTask: {
          id: "task-055",
          visualEvidenceRequired: true,
        },
      },
    })).toBeNull();
  });

  it("rejects malformed selected-task visual readback", () => {
    expect(getSnapshotSelectedTaskVisualReadback({
      selectedTaskVisualReadback: {
        selectedTaskId: "task-055",
        status: "check_story_selection_ready",
        tone: "good",
        title: "Story selection can be checked",
        message: "missing boolean fields",
      },
    })).toBeNull();
  });

  it("reads selected-task Workbench automation telemetry from owner-backed snapshot readback", () => {
    expect(getSnapshotSelectedTaskWorkbenchAutomationReadback({
      selectedTaskWorkbenchAutomationReadback: workbenchAutomationReadback(),
    })).toMatchObject({
      selectedTaskId: "task-055",
      iterationLogStatus: "ready",
      status: "ready",
      tone: "good",
      automation: {
        ownerBoundary: "ralph.visual-workbench-evidence-automation",
        iteration: 4,
        timestamp: "2026-06-12T07:25:00.000Z",
        outcome: "completed",
        status: "published",
        sourceRef: "source-sha",
        diagnosticReportPath: "/workspace/.ralph/visual-workbench/automation-runs/task-055/latest.json",
        selectorStatus: "ready",
        shellPolicyStatus: "allowed",
        browserReadinessStatus: "ready",
        captureStatus: "captured",
        exportedEvidenceRefs: 1,
        publishedRows: 1,
        blockers: [],
      },
    });
  });

  it("does not infer selected-task Workbench automation from raw iteration fields", () => {
    expect(getSnapshotSelectedTaskWorkbenchAutomationReadback({
      selectedTaskId: "task-055",
      iterationLog: [{
        taskId: "task-055",
        visualWorkbenchAutomation: workbenchAutomationReadback().automation,
      }],
    })).toBeNull();
  });

  it("rejects malformed selected-task Workbench automation readback", () => {
    expect(getSnapshotSelectedTaskWorkbenchAutomationReadback({
      selectedTaskWorkbenchAutomationReadback: {
        selectedTaskId: "task-055",
        status: "ready",
        tone: "good",
        title: "Workbench automation telemetry found",
        message: "missing automation owner",
        automation: {
          ownerBoundary: "wrong",
          status: "published",
        },
      },
    })?.automation).toBeNull();
  });
});

function checkpointReadback(overrides: Record<string, unknown> = {}) {
  return {
    selectedTaskId: "task-055",
    selectedTaskStatus: "in_progress",
    recommendedExecutorMode: "resume_interrupted",
    providerSessionStatus: "ready",
    selectedTaskSessionCount: 2,
    selectedTaskResumableSessionCount: 1,
    nextProjectActionId: null,
    status: "checkpoint_ready",
    tone: "good",
    reasonCode: "failed_error_checkpoint_ready",
    title: "Checkpoint readback is ready",
    message: "Snapshot found a failed/error provider-session checkpoint for this interrupted task. Executor will still validate agent, model and task fingerprint before resume.",
    canPrepareExecutor: true,
    ...overrides,
  };
}

function visualReadback(overrides: Record<string, unknown> = {}) {
  return {
    selectedTaskId: "task-055",
    selectedTaskStatus: "pending",
    visualEvidenceRequired: true,
    visualEvidenceMode: "new_tasks_only",
    visualEvidencePolicyStatus: "ready",
    visualWorkbenchManifestStatus: "ready",
    canRunWorkbenchCapture: true,
    visualExpectationSources: ["task.visualEvidenceRequired"],
    nextProjectActionId: null,
    status: "not_applicable",
    tone: "neutral",
    reasonCode: "visual_evidence_not_required_for_task",
    title: "Story selection not expected",
    message: "The selected task is not marked as visual work under the current project visual evidence policy.",
    canCheckStorySelection: false,
    ...overrides,
  };
}

function workbenchAutomationReadback(overrides: Record<string, unknown> = {}) {
  return {
    owner: "@arena/ralph-runtime:IterationLog.visualWorkbenchAutomation",
    selectedTaskId: "task-055",
    iterationLogStatus: "ready",
    path: "/workspace/.ralph/iteration-log.json",
    status: "ready",
    tone: "good",
    reasonCode: "selected_task_automation_ready",
    title: "Workbench automation telemetry found",
    message: "Latest production Workbench automation telemetry was found for the selected task. This is not screenshot availability; use Arena screenshot readback for proof review.",
    automation: {
      ownerBoundary: "ralph.visual-workbench-evidence-automation",
      iteration: 4,
      timestamp: "2026-06-12T07:25:00.000Z",
      outcome: "completed",
      status: "published",
      sourceRef: "source-sha",
      reportPath: "/private/tmp/visual-workbench-automation-run.json",
      diagnosticReportPath: "/workspace/.ralph/visual-workbench/automation-runs/task-055/latest.json",
      selectorStatus: "ready",
      shellPolicyStatus: "allowed",
      browserReadinessStatus: "ready",
      captureStatus: "captured",
      exportedEvidenceRefs: 1,
      publishedRows: 1,
      blockers: [],
    },
    ...overrides,
  };
}
