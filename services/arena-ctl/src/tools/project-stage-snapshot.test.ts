import assert from "node:assert/strict";
import test from "node:test";
import type { ProjectExperimentPreflight } from "./project-experiment-preflight.js";
import {
  PROJECT_STAGE_SNAPSHOT_SCHEMA_VERSION,
  buildProjectStageSnapshot,
} from "./project-stage-snapshot.js";

test("buildProjectStageSnapshot summarizes selected task and selected provider sessions", () => {
  const snapshot = buildProjectStageSnapshot({
    generatedAt: "2026-06-12T08:00:00.000Z",
    preflight: buildPreflight({ workspacePath: "/tmp/stook" }),
    selectedTaskId: "task-001",
    acceptedArtifactAudit: {
      ok: true,
      value: {
        projectId: "project-1",
        projectName: "STOOK",
        classification: "current_v1_artifact",
        runnerReady: true,
        storageMode: "accepted_artifact_v1",
        latestSpec: {
          specId: "spec-1",
          specVersionId: "version-1",
          version: 3,
          sourceProjectId: "tg-spec-1",
          sourceVersion: 12,
          metadataHash: "hash-1",
        },
        recommendedNextAction: "launch_or_resume",
        allowedActions: ["no_action"],
        why: ["Latest spec metadata is valid."],
        operatorNotes: ["No raw spec content should be exposed."],
        content: "SECRET RAW SPEC BODY",
        acceptedArtifact: { spec: "SECRET ACCEPTED ARTIFACT" },
      },
    },
    planFile: {
      status: "ready",
      path: "/tmp/stook/.ralph/plan.json",
      content: JSON.stringify({
        version: 1,
        specFile: "spec.md",
        specHash: "spec-hash",
        createdAt: "2026-06-12T07:00:00.000Z",
        updatedAt: "2026-06-12T07:30:00.000Z",
        phases: [
          {
            id: "phase-1",
            name: "Build",
            description: "Build the product UI.",
            order: 1,
            tasks: [
              {
                id: "task-001",
                displayTitle: "Build mixer",
                description: "Create the mixer widget.",
                acceptanceCriteria: ["Mixer renders with mocked channels."],
                status: "in_progress",
                attempts: 2,
                requiredRolePasses: ["ux"],
                visualEvidenceRequired: true,
                feedbackItemRefs: [
                  {
                    itemId: "fb-1",
                    diffItemId: "diff-1",
                    workSurface: "frontend",
                    workImpact: "requires_loop_work",
                    summary: "Mixer UI",
                  },
                ],
                verificationEvidence: [
                  { kind: "screenshot", ref: "shot-1", summary: "after", result: "inconclusive" },
                  { kind: "unit_test", ref: "test-1", summary: "unit", result: "pass" },
                ],
              },
              {
                id: "task-002",
                description: "Ship docs",
                acceptanceCriteria: [],
                status: "completed",
              },
            ],
          },
        ],
        judgments: [{ id: "judgment-1" }],
        specMigrations: [{ id: "migration-1" }],
      }),
    },
    providerSessionFile: {
      status: "ready",
      path: "/tmp/stook/.ralph/provider-session-checkpoint.json",
      content: JSON.stringify({
        version: 2,
        sessions: [
          {
            agent: "codex",
            model: "gpt-5.5",
            taskId: "task-001",
            taskFingerprint: "fingerprint-1",
            specHash: "spec-hash",
            sessionId: "session-old",
            reason: "task_attempt",
            outcome: "error",
            errorCategory: "rate_limit",
            updatedAt: "2026-06-12T07:05:00.000Z",
          },
          {
            agent: "codex",
            model: "gpt-5.5",
            taskId: "task-002",
            taskFingerprint: "fingerprint-2",
            specHash: "spec-hash",
            sessionId: "session-other",
            reason: "task_attempt",
            outcome: "success",
            updatedAt: "2026-06-12T07:10:00.000Z",
          },
          {
            agent: "codex",
            model: "gpt-5.5",
            taskId: "task-001",
            taskFingerprint: "fingerprint-1",
            specHash: "spec-hash",
            sessionId: "session-new",
            reason: "task_attempt",
            outcome: "success",
            resumedFrom: "session-old",
            updatedAt: "2026-06-12T07:20:00.000Z",
          },
        ],
      }),
    },
    iterationLogFile: {
      status: "ready",
      path: "/tmp/stook/.ralph/iteration-log.json",
      content: JSON.stringify([
        {
          iteration: 0,
          taskId: "task-002",
          timestamp: "2026-06-12T07:10:00.000Z",
          outcome: "completed",
          visualWorkbenchAutomation: {
            ownerBoundary: "ralph.visual-workbench-evidence-automation",
            taskId: "task-002",
            status: "published",
            sourceRef: "other-sha",
          },
        },
        {
          iteration: 1,
          taskId: "task-001",
          timestamp: "2026-06-12T07:25:00.000Z",
          outcome: "completed",
          visualWorkbenchAutomation: {
            ownerBoundary: "ralph.visual-workbench-evidence-automation",
            taskId: "task-001",
            status: "published",
            sourceRef: "source-sha",
            reportPath: "/private/tmp/visual-workbench-automation-run.json",
            diagnosticReportPath: "/tmp/stook/.ralph/visual-workbench/automation-runs/task-001/latest.json",
            selectorStatus: "ready",
            shellPolicyStatus: "allowed",
            browserReadinessStatus: "ready",
            captureStatus: "captured",
            exportedEvidenceRefs: 1,
            publishedRows: 1,
            blockers: [],
            artifactPath: "SECRET RAW ARTIFACT PATH",
            visualEvidenceReviews: ["must not copy"],
          },
        },
      ]),
    },
  });

  assert.equal(snapshot.schemaVersion, PROJECT_STAGE_SNAPSHOT_SCHEMA_VERSION);
  assert.equal(snapshot.stageBoundary.mode, "read_only");
  assert(snapshot.stageBoundary.forbidden.includes("no_provider_call"));
  assert.deepEqual(snapshot.visualWorkbenchManifestReadiness, {
    available: true,
    status: "ready",
    canRunWorkbenchCapture: true,
    schemaVersion: "ra-355.visual-coverage-manifest.v0",
    projectClass: "ordinary_web",
    blockers: [],
    unknowns: [],
  });
  assert.deepEqual(snapshot.visualEvidencePolicy, {
    owner: "governance.runner-init-readiness.ralphConfig",
    status: "ready",
    visualEvidenceMode: "new_tasks_only",
    blockers: [],
    notes: ["visualEvidenceMode=new_tasks_only"],
  });
  assert(snapshot.ownerReads.some((read) => read.owner === "governance.runner-init-readiness.ralphConfig"));
  assert(snapshot.ownerReads.some((read) => read.owner === "arena-ctl.project_experiment_preflight.visualWorkbenchManifestReadiness"));
  assert(!("stories" in snapshot.visualWorkbenchManifestReadiness));
  assert.equal(snapshot.plan.status, "ready");
  assert.equal(snapshot.plan.selectedTask?.id, "task-001");
  assert.equal(snapshot.plan.selectedTask?.status, "in_progress");
  assert.equal(snapshot.plan.selectedTask?.visualEvidenceRequired, true);
  assert.deepEqual(snapshot.selectedTaskVisualReadback, {
    selectedTaskId: "task-001",
    selectedTaskStatus: "in_progress",
    visualEvidenceRequired: true,
    visualEvidenceMode: "new_tasks_only",
    visualEvidencePolicyStatus: "ready",
    visualWorkbenchManifestStatus: "ready",
    canRunWorkbenchCapture: true,
    visualExpectationSources: ["task.visualEvidenceRequired", "task.requiredRolePasses.ux", "task.feedbackItemRefs.workSurface.frontend"],
    nextProjectActionId: "check_story_selection",
    status: "check_story_selection_ready",
    tone: "good",
    reasonCode: "check_story_selection_ready",
    title: "Story selection can be checked",
    message: "This only selects Check story selection for the same task. It does not capture screenshots or create evidence.",
    canCheckStorySelection: true,
  });
  assert.equal(snapshot.plan.taskCounts.in_progress, 1);
  assert.equal(snapshot.plan.taskCounts.completed, 1);
  assert.deepEqual(snapshot.plan.taskCandidates.map((task) => task.id), ["task-001"]);
  assert.deepEqual(snapshot.plan.taskCandidates[0], {
    id: "task-001",
    displayTitle: "Build mixer",
    status: "in_progress",
    statusSource: "explicit",
    attempts: 2,
    lastError: null,
    requiredRolePasses: ["ux"],
    visualEvidenceRequired: true,
    feedbackItemRefCount: 1,
    recommendedExecutorMode: "resume_interrupted",
  });
  assert.equal(snapshot.plan.judgmentCount, 1);
  assert.equal(snapshot.plan.specMigrationCount, 1);
  assert.equal(snapshot.plan.selectedTask?.verificationEvidence.screenshot, 1);
  assert.equal(snapshot.plan.selectedTask?.verificationEvidence.pass, 1);
  assert.equal(snapshot.providerSessions.status, "ready");
  assert.equal(snapshot.providerSessions.sessionCount, 3);
  assert.equal(snapshot.providerSessions.selectedTaskSessionCount, 2);
  assert.equal(snapshot.providerSessions.selectedTaskResumableSessionCount, 1);
  assert.deepEqual(snapshot.providerSessions.selectedTaskCheckpointReadback, {
    selectedTaskId: "task-001",
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
  });
  assert.deepEqual(
    snapshot.providerSessions.selectedTaskSessions.map((session) => session.sessionId),
    ["session-new", "session-old"],
  );
  assert.deepEqual(snapshot.selectedTaskWorkbenchAutomationReadback, {
    owner: "@arena/ralph-runtime:IterationLog.visualWorkbenchAutomation",
    selectedTaskId: "task-001",
    iterationLogStatus: "ready",
    path: "/tmp/stook/.ralph/iteration-log.json",
    status: "ready",
    tone: "good",
    reasonCode: "selected_task_automation_ready",
    title: "Workbench automation telemetry found",
    message: "Latest production Workbench automation telemetry was found for the selected task. This is not screenshot availability; use Arena screenshot readback for proof review.",
    automation: {
      ownerBoundary: "ralph.visual-workbench-evidence-automation",
      iteration: 1,
      timestamp: "2026-06-12T07:25:00.000Z",
      outcome: "completed",
      status: "published",
      sourceRef: "source-sha",
      reportPath: "/private/tmp/visual-workbench-automation-run.json",
      diagnosticReportPath: "/tmp/stook/.ralph/visual-workbench/automation-runs/task-001/latest.json",
      selectorStatus: "ready",
      shellPolicyStatus: "allowed",
      browserReadinessStatus: "ready",
      captureStatus: "captured",
      exportedEvidenceRefs: 1,
      publishedRows: 1,
      blockers: [],
    },
  });
  assert.equal(snapshot.acceptedArtifactAudit.classification, "current_v1_artifact");
  assert.equal(snapshot.acceptedArtifactAudit.latestSpec.metadataHash, "hash-1");
  assert(!JSON.stringify(snapshot).includes("SECRET RAW SPEC BODY"));
  assert(!JSON.stringify(snapshot).includes("SECRET ACCEPTED ARTIFACT"));
  assert(!JSON.stringify(snapshot).includes("SECRET RAW ARTIFACT PATH"));
  assert(!JSON.stringify(snapshot).includes("visualEvidenceReviews"));
});

test("buildProjectStageSnapshot suppresses stale lastError for completed selected tasks", () => {
  const snapshot = buildProjectStageSnapshot({
    generatedAt: "2026-06-12T08:00:00.000Z",
    preflight: buildPreflight({ workspacePath: "/tmp/stook" }),
    selectedTaskId: "task-001",
    acceptedArtifactAudit: { ok: true, value: null },
    planFile: {
      status: "ready",
      path: "/tmp/stook/.ralph/plan.json",
      content: JSON.stringify({
        specFile: "spec.md",
        createdAt: "2026-06-12T07:00:00.000Z",
        updatedAt: "2026-06-12T07:30:00.000Z",
        phases: [
          {
            id: "phase-1",
            name: "Build",
            description: "Build the product UI.",
            order: 1,
            tasks: [
              {
                id: "task-001",
                description: "Resume after provider limit.",
                acceptanceCriteria: ["Task completes."],
                status: "completed",
                attempts: 0,
                lastError: "You've hit your session limit · resets 5:40pm (UTC)",
              },
            ],
          },
        ],
      }),
    },
    providerSessionFile: {
      status: "ready",
      path: "/tmp/stook/.ralph/provider-session-checkpoint.json",
      content: JSON.stringify({ version: 2, sessions: [] }),
    },
  });

  assert.equal(snapshot.plan.selectedTask?.status, "completed");
  assert.equal(snapshot.plan.selectedTask?.lastError, null);
  assert.deepEqual(snapshot.plan.taskCandidates, []);
});

test("buildProjectStageSnapshot reports missing plan and checkpoint without inventing truth", () => {
  const snapshot = buildProjectStageSnapshot({
    generatedAt: "2026-06-12T08:00:00.000Z",
    preflight: buildPreflight({ workspacePath: "/tmp/stook" }),
    acceptedArtifactAudit: { ok: false, error: "governance unavailable" },
    planFile: {
      status: "missing",
      path: "/tmp/stook/.ralph/plan.json",
      reason: ".ralph/plan.json is not present in the current workspace.",
    },
    providerSessionFile: {
      status: "missing",
      path: "/tmp/stook/.ralph/provider-session-checkpoint.json",
      reason: ".ralph/provider-session-checkpoint.json is not present in the current workspace.",
    },
  });

  assert.equal(snapshot.plan.status, "missing");
  assert.equal(snapshot.plan.reasonCode, "plan_missing");
  assert.deepEqual(snapshot.plan.taskCounts, {
    pending: 0,
    in_progress: 0,
    completed: 0,
    failed: 0,
    skipped: 0,
    unknown: 0,
    total: 0,
  });
  assert.deepEqual(snapshot.plan.taskCandidates, []);
  assert.equal(snapshot.providerSessions.status, "missing");
  assert.equal(snapshot.providerSessions.reasonCode, "checkpoint_missing");
  assert.equal(snapshot.providerSessions.selectedTaskCheckpointReadback.status, "not_selected");
  assert.equal(snapshot.providerSessions.selectedTaskCheckpointReadback.reasonCode, "task_id_not_selected");
  assert.equal(snapshot.selectedTaskVisualReadback.status, "not_selected");
  assert.equal(snapshot.selectedTaskVisualReadback.reasonCode, "task_id_not_selected");
  assert.equal(snapshot.acceptedArtifactAudit.available, false);
  assert(snapshot.nextHandoff.includes("Select --task-id before executor/controller task experiments."));
  assert(snapshot.ownerReads.some((read) => read.owner === "@arena/ralph-runtime:PlanSchema" && read.status === "missing"));
});

test("buildProjectStageSnapshot blocks selected task handoff when task is absent", () => {
  const snapshot = buildProjectStageSnapshot({
    generatedAt: "2026-06-12T08:00:00.000Z",
    preflight: buildPreflight({ workspacePath: "/tmp/stook" }),
    selectedTaskId: "task-missing",
    acceptedArtifactAudit: { ok: true, value: null },
    planFile: {
      status: "ready",
      path: "/tmp/stook/.ralph/plan.json",
      content: JSON.stringify({
        specFile: "spec.md",
        createdAt: "2026-06-12T07:00:00.000Z",
        updatedAt: "2026-06-12T07:30:00.000Z",
        phases: [
          {
            id: "phase-1",
            name: "Build",
            description: "Build the product UI.",
            order: 1,
            tasks: [
              {
                id: "task-001",
                description: "Create UI.",
                acceptanceCriteria: [],
              },
            ],
          },
        ],
      }),
    },
    providerSessionFile: {
      status: "ready",
      path: "/tmp/stook/.ralph/provider-session-checkpoint.json",
      content: JSON.stringify({ version: 2, sessions: [] }),
    },
  });

  assert.equal(snapshot.plan.status, "ready");
  assert.equal(snapshot.plan.reasonCode, "selected_task_not_found");
  assert.deepEqual(snapshot.plan.blockers, ["selected_task_not_found"]);
  assert.equal(snapshot.plan.taskCounts.pending, 1);
  assert.deepEqual(snapshot.plan.taskCandidates.map((task) => ({
    id: task.id,
    status: task.status,
    statusSource: task.statusSource,
    recommendedExecutorMode: task.recommendedExecutorMode,
  })), [{
    id: "task-001",
    status: "pending",
    statusSource: "plan_schema_default",
    recommendedExecutorMode: "new_task",
  }]);
  assert.match(snapshot.plan.warnings.join("\n"), /PlanSchema default pending/);
  assert.equal(snapshot.providerSessions.selectedTaskSessionCount, 0);
  assert.equal(snapshot.providerSessions.selectedTaskCheckpointReadback.status, "not_executor_candidate");
  assert.equal(snapshot.providerSessions.selectedTaskCheckpointReadback.reasonCode, "not_executor_candidate");
  assert.equal(snapshot.selectedTaskVisualReadback.status, "check_story_selection_blocked");
  assert.equal(snapshot.selectedTaskVisualReadback.reasonCode, "selected_task_not_found");
  assert(snapshot.nextHandoff.includes("No provider session was found for the selected task; failed/resume experiments may need a new-task mode."));
});

test("buildProjectStageSnapshot preserves invalid visual policy readback", () => {
  const snapshot = buildProjectStageSnapshot({
    generatedAt: "2026-06-12T08:00:00.000Z",
    preflight: buildPreflight({
      workspacePath: "/tmp/stook",
      visualEvidenceMode: null,
      visualEvidenceModeError: "Invalid visualWorkbenchEvidenceAutomation runtimeConfig.",
    }),
    selectedTaskId: "task-001",
    acceptedArtifactAudit: { ok: true, value: null },
    planFile: {
      status: "ready",
      path: "/tmp/stook/.ralph/plan.json",
      content: JSON.stringify({
        specFile: "spec.md",
        createdAt: "2026-06-12T07:00:00.000Z",
        updatedAt: "2026-06-12T07:30:00.000Z",
        phases: [{
          id: "phase-1",
          name: "Build",
          description: "Build the product UI.",
          order: 1,
          tasks: [{
            id: "task-001",
            description: "Create UI.",
            acceptanceCriteria: [],
            status: "pending",
            visualEvidenceRequired: true,
          }],
        }],
      }),
    },
    providerSessionFile: {
      status: "ready",
      path: "/tmp/stook/.ralph/provider-session-checkpoint.json",
      content: JSON.stringify({ version: 2, sessions: [] }),
    },
  });

  assert.deepEqual(snapshot.visualEvidencePolicy, {
    owner: "governance.runner-init-readiness.ralphConfig",
    status: "invalid",
    visualEvidenceMode: null,
    blockers: ["runner_init_visual_evidence_mode_invalid"],
    notes: [
      "visualEvidenceMode=missing",
      "visualEvidenceModeError=Invalid visualWorkbenchEvidenceAutomation runtimeConfig.",
    ],
  });
  assert.equal(snapshot.selectedTaskVisualReadback.reasonCode, "visual_policy_invalid");
  assert.equal(snapshot.selectedTaskVisualReadback.canCheckStorySelection, false);
});

test("buildProjectStageSnapshot enables story-selection readback for required-mode structured visual tasks", () => {
  const snapshot = buildProjectStageSnapshot({
    generatedAt: "2026-06-12T08:00:00.000Z",
    preflight: buildPreflight({ workspacePath: "/tmp/stook", visualEvidenceMode: "required" }),
    selectedTaskId: "task-001",
    acceptedArtifactAudit: { ok: true, value: null },
    planFile: {
      status: "ready",
      path: "/tmp/stook/.ralph/plan.json",
      content: JSON.stringify({
        specFile: "spec.md",
        createdAt: "2026-06-12T07:00:00.000Z",
        updatedAt: "2026-06-12T07:30:00.000Z",
        phases: [
          {
            id: "phase-1",
            name: "Build",
            description: "Build the product UI.",
            order: 1,
            tasks: [
              {
                id: "task-001",
                description: "Create UI.",
                acceptanceCriteria: [],
                status: "pending",
                visualEvidenceRequired: false,
                requiredRolePasses: ["ux"],
              },
            ],
          },
        ],
      }),
    },
    providerSessionFile: {
      status: "ready",
      path: "/tmp/stook/.ralph/provider-session-checkpoint.json",
      content: JSON.stringify({ version: 2, sessions: [] }),
    },
  });

  assert.equal(snapshot.selectedTaskVisualReadback.canCheckStorySelection, true);
  assert.equal(snapshot.selectedTaskVisualReadback.nextProjectActionId, "check_story_selection");
  assert.deepEqual(snapshot.selectedTaskVisualReadback.visualExpectationSources, ["task.requiredRolePasses.ux"]);
});

test("buildProjectStageSnapshot blocks story-selection readback when visual policy is off", () => {
  const snapshot = buildProjectStageSnapshot({
    generatedAt: "2026-06-12T08:00:00.000Z",
    preflight: buildPreflight({ workspacePath: "/tmp/stook", visualEvidenceMode: "off" }),
    selectedTaskId: "task-001",
    acceptedArtifactAudit: { ok: true, value: null },
    planFile: visualTaskPlanFile(),
    providerSessionFile: {
      status: "ready",
      path: "/tmp/stook/.ralph/provider-session-checkpoint.json",
      content: JSON.stringify({ version: 2, sessions: [] }),
    },
  });

  assert.equal(snapshot.selectedTaskVisualReadback.status, "not_applicable");
  assert.equal(snapshot.selectedTaskVisualReadback.reasonCode, "visual_evidence_mode_off");
  assert.equal(snapshot.selectedTaskVisualReadback.canCheckStorySelection, false);
});

test("buildProjectStageSnapshot blocks story-selection readback when manifest is not ready", () => {
  const snapshot = buildProjectStageSnapshot({
    generatedAt: "2026-06-12T08:00:00.000Z",
    preflight: buildPreflight({
      workspacePath: "/tmp/stook",
      visualWorkbenchManifestStatus: "blocked",
      canRunWorkbenchCapture: false,
    }),
    selectedTaskId: "task-001",
    acceptedArtifactAudit: { ok: true, value: null },
    planFile: visualTaskPlanFile(),
    providerSessionFile: {
      status: "ready",
      path: "/tmp/stook/.ralph/provider-session-checkpoint.json",
      content: JSON.stringify({ version: 2, sessions: [] }),
    },
  });

  assert.equal(snapshot.selectedTaskVisualReadback.status, "check_story_selection_blocked");
  assert.equal(snapshot.selectedTaskVisualReadback.reasonCode, "visual_manifest_not_ready");
  assert.equal(snapshot.selectedTaskVisualReadback.canCheckStorySelection, false);
});

test("buildProjectStageSnapshot warns when interrupted task resume lacks provider checkpoint", () => {
  const snapshot = buildProjectStageSnapshot({
    generatedAt: "2026-06-12T08:00:00.000Z",
    preflight: buildPreflight({ workspacePath: "/tmp/stook" }),
    selectedTaskId: "task-001",
    acceptedArtifactAudit: { ok: true, value: null },
    planFile: {
      status: "ready",
      path: "/tmp/stook/.ralph/plan.json",
      content: JSON.stringify({
        specFile: "spec.md",
        createdAt: "2026-06-12T07:00:00.000Z",
        updatedAt: "2026-06-12T07:30:00.000Z",
        phases: [
          {
            id: "phase-1",
            name: "Build",
            description: "Build the product UI.",
            order: 1,
            tasks: [
              {
                id: "task-001",
                description: "Create UI.",
                acceptanceCriteria: [],
                status: "in_progress",
              },
            ],
          },
        ],
      }),
    },
    providerSessionFile: {
      status: "missing",
      path: "/tmp/stook/.ralph/provider-session-checkpoint.json",
      reason: ".ralph/provider-session-checkpoint.json is not present in the current workspace.",
    },
  });

  assert.equal(snapshot.plan.selectedTask?.status, "in_progress");
  assert.equal(snapshot.providerSessions.status, "missing");
  assert.deepEqual(snapshot.providerSessions.selectedTaskCheckpointReadback, {
    selectedTaskId: "task-001",
    selectedTaskStatus: "in_progress",
    recommendedExecutorMode: "resume_interrupted",
    providerSessionStatus: "missing",
    selectedTaskSessionCount: null,
    selectedTaskResumableSessionCount: null,
    nextProjectActionId: null,
    status: "checkpoint_blocked",
    tone: "warn",
    reasonCode: "checkpoint_unavailable",
    title: "Checkpoint required before resume",
    message: "Provider-session checkpoint is missing. Resume will block before provider creation.",
    canPrepareExecutor: false,
  });
  assert(snapshot.nextHandoff.includes("Provider session checkpoint is missing; resume_interrupted will block before provider creation."));
});

test("buildProjectStageSnapshot reports success-only in-progress checkpoints as non-resumable", () => {
  const snapshot = buildProjectStageSnapshot({
    generatedAt: "2026-06-12T08:00:00.000Z",
    preflight: buildPreflight({ workspacePath: "/tmp/stook" }),
    selectedTaskId: "task-001",
    acceptedArtifactAudit: { ok: true, value: null },
    planFile: {
      status: "ready",
      path: "/tmp/stook/.ralph/plan.json",
      content: JSON.stringify({
        specFile: "spec.md",
        createdAt: "2026-06-12T07:00:00.000Z",
        updatedAt: "2026-06-12T07:30:00.000Z",
        phases: [
          {
            id: "phase-1",
            name: "Build",
            description: "Build the product UI.",
            order: 1,
            tasks: [
              {
                id: "task-001",
                description: "Create UI.",
                acceptanceCriteria: [],
                status: "in_progress",
              },
            ],
          },
        ],
      }),
    },
    providerSessionFile: {
      status: "ready",
      path: "/tmp/stook/.ralph/provider-session-checkpoint.json",
      content: JSON.stringify({
        version: 2,
        sessions: [
          {
            agent: "codex",
            model: "gpt-5.5",
            taskId: "task-001",
            taskFingerprint: "fingerprint-1",
            specHash: "spec-hash",
            sessionId: "session-success",
            reason: "task_attempt",
            outcome: "success",
            updatedAt: "2026-06-12T07:20:00.000Z",
          },
        ],
      }),
    },
  });

  assert.equal(snapshot.providerSessions.status, "ready");
  assert.equal(snapshot.providerSessions.selectedTaskSessionCount, 1);
  assert.equal(snapshot.providerSessions.selectedTaskResumableSessionCount, 0);
  assert.deepEqual(snapshot.providerSessions.selectedTaskCheckpointReadback, {
    selectedTaskId: "task-001",
    selectedTaskStatus: "in_progress",
    recommendedExecutorMode: "resume_interrupted",
    providerSessionStatus: "ready",
    selectedTaskSessionCount: 1,
    selectedTaskResumableSessionCount: 0,
    nextProjectActionId: "resume_agent",
    status: "checkpoint_blocked",
    tone: "warn",
    reasonCode: "success_checkpoint_not_resumable",
    title: "Use Resume agent, not checkpoint resume",
    message: "Snapshot found provider-session history, but no failed/error checkpoint for this interrupted task. A successful checkpoint is evidence, not resumable work. Select Resume agent to continue through the normal Ralph claim path.",
    canPrepareExecutor: false,
  });
  assert(snapshot.nextHandoff.includes("Snapshot found provider-session history, but no failed/error checkpoint for this interrupted task. A successful checkpoint is evidence, not resumable work. Select Resume agent to continue through the normal Ralph claim path."));
});

test("buildProjectStageSnapshot rejects plan shape that omits owner-required phase fields", () => {
  const snapshot = buildProjectStageSnapshot({
    generatedAt: "2026-06-12T08:00:00.000Z",
    preflight: buildPreflight({ workspacePath: "/tmp/stook" }),
    selectedTaskId: "task-001",
    acceptedArtifactAudit: { ok: true, value: null },
    planFile: {
      status: "ready",
      path: "/tmp/stook/.ralph/plan.json",
      content: JSON.stringify({
        specFile: "spec.md",
        createdAt: "2026-06-12T07:00:00.000Z",
        updatedAt: "2026-06-12T07:30:00.000Z",
        phases: [
          {
            id: "phase-1",
            name: "Build",
            tasks: [
              {
                id: "task-001",
                description: "Create UI.",
                acceptanceCriteria: [],
              },
            ],
          },
        ],
      }),
    },
    providerSessionFile: {
      status: "ready",
      path: "/tmp/stook/.ralph/provider-session-checkpoint.json",
      content: JSON.stringify({ version: 2, sessions: [] }),
    },
  });

  assert.equal(snapshot.plan.status, "invalid");
  assert.equal(snapshot.plan.reasonCode, "plan_invalid");
  assert.match(snapshot.plan.blockers.join("\n"), /requires description string/);
  assert.match(snapshot.plan.blockers.join("\n"), /requires numeric order/);
});

test("buildProjectStageSnapshot parses legacy provider checkpoint as selected task session evidence", () => {
  const snapshot = buildProjectStageSnapshot({
    generatedAt: "2026-06-12T08:00:00.000Z",
    preflight: buildPreflight({ workspacePath: "/tmp/stook" }),
    selectedTaskId: "task-001",
    acceptedArtifactAudit: { ok: true, value: null },
    planFile: {
      status: "ready",
      path: "/tmp/stook/.ralph/plan.json",
      content: JSON.stringify({
        specFile: "spec.md",
        createdAt: "2026-06-12T07:00:00.000Z",
        updatedAt: "2026-06-12T07:30:00.000Z",
        phases: [
          {
            id: "phase-1",
            name: "Build",
            description: "Build the product UI.",
            order: 1,
            tasks: [
              {
                id: "task-001",
                description: "Create UI.",
                acceptanceCriteria: [],
                status: "failed",
              },
            ],
          },
        ],
      }),
    },
    providerSessionFile: {
      status: "ready",
      path: "/tmp/stook/.ralph/provider-session-checkpoint.json",
      content: JSON.stringify({
        version: 1,
        agent: "codex",
        model: null,
        taskId: "task-001",
        taskFingerprint: "fingerprint-1",
        specHash: null,
        sessionId: "legacy-session",
        reason: "rate_limit",
        updatedAt: "2026-06-12T07:20:00.000Z",
      }),
    },
  });

  assert.equal(snapshot.providerSessions.status, "ready");
  assert.equal(snapshot.providerSessions.sessionCount, 1);
  assert.equal(snapshot.providerSessions.selectedTaskSessions[0]?.sessionId, "legacy-session");
  assert.equal(snapshot.providerSessions.selectedTaskSessions[0]?.reason, "rate_limit");
  assert.equal(snapshot.providerSessions.selectedTaskSessions[0]?.outcome, "error");
});

test("buildProjectStageSnapshot marks unsupported task status as invalid owner shape", () => {
  const snapshot = buildProjectStageSnapshot({
    generatedAt: "2026-06-12T08:00:00.000Z",
    preflight: buildPreflight({ workspacePath: "/tmp/stook" }),
    selectedTaskId: "task-001",
    acceptedArtifactAudit: { ok: true, value: null },
    planFile: {
      status: "ready",
      path: "/tmp/stook/.ralph/plan.json",
      content: JSON.stringify({
        specFile: "spec.md",
        createdAt: "2026-06-12T07:00:00.000Z",
        updatedAt: "2026-06-12T07:30:00.000Z",
        phases: [
          {
            id: "phase-1",
            name: "Build",
            description: "Build the product UI.",
            order: 1,
            tasks: [
              {
                id: "task-001",
                description: "Create UI.",
                acceptanceCriteria: [],
                status: "repair",
              },
            ],
          },
        ],
      }),
    },
    providerSessionFile: {
      status: "ready",
      path: "/tmp/stook/.ralph/provider-session-checkpoint.json",
      content: JSON.stringify({ version: 2, sessions: [] }),
    },
  });

  assert.equal(snapshot.plan.status, "invalid");
  assert.equal(snapshot.plan.reasonCode, "plan_invalid");
  assert.equal(snapshot.plan.selectedTask, null);
  assert.equal(snapshot.plan.taskCounts.total, 0);
  assert.match(snapshot.plan.blockers.join("\n"), /unsupported status repair/);
});

function visualTaskPlanFile() {
  return {
    status: "ready" as const,
    path: "/tmp/stook/.ralph/plan.json",
    content: JSON.stringify({
      specFile: "spec.md",
      createdAt: "2026-06-12T07:00:00.000Z",
      updatedAt: "2026-06-12T07:30:00.000Z",
      phases: [
        {
          id: "phase-1",
          name: "Build",
          description: "Build the product UI.",
          order: 1,
          tasks: [
            {
              id: "task-001",
              description: "Create UI.",
              acceptanceCriteria: [],
              status: "pending",
              visualEvidenceRequired: true,
            },
          ],
        },
      ],
    }),
  };
}

function buildPreflight(input: {
  workspacePath: string | null;
  visualEvidenceMode?: "off" | "required" | "new_tasks_only" | null;
  visualEvidenceModeError?: string | null;
  visualWorkbenchManifestStatus?: "ready" | "blocked" | "unknown";
  canRunWorkbenchCapture?: boolean;
}): ProjectExperimentPreflight {
  return {
    project: {
      id: "project-1",
      name: "STOOK",
      runnerBackend: "local",
    },
    mode: {
      requested: "agent_run",
      claimDryRunAvailable: true,
      exactClaimPrediction: "would_not_create_lease",
    },
    lifecycleContext: {
      classification: "waiting_by_blocker",
      tgSpecLaunchConfiguration: null,
      tuple: {
        powerIntent: "ON",
        agentIntent: "ON",
        runtimeState: "RUNNING",
        agentState: "IDLE",
        blockers: ["RATE_LIMIT"],
        lastOutcome: null,
        provisionedAt: "2026-06-12T07:00:00.000Z",
        previewHealth: "HEALTHY",
        previewUrl: "https://example.test",
      },
      allowedActions: ["project_retry_now"],
      recommendedNextAction: "none_wait_for_lifecycle_blocker",
    },
    runnerExpectation: {
      repoUrl: "https://github.com/example/stook",
      baseBranch: "main",
      projectBranch: null,
      commitSha: "1234567890abcdef1234567890abcdef12345678",
      runnerModeSource: "governance_runtime_claim_dry_run",
      claimDryRunAvailable: true,
    },
    workerCapacityInput: {
      source: "capacity_diagnostics",
      capacityForDryRun: 0,
      failClosed: false,
      activePreviewContainersSupplied: false,
      activePreviewContainersPreview: [],
      maxConcurrentRuns: 2,
      activePreviewContainerCount: 1,
      availableStartCapacity: 1,
      resourcePressureConstrained: false,
      resourcePressureReasons: [],
      healthError: null,
      notes: [],
    },
    claimDryRun: {},
    initReadiness: {
      ralphConfig: {
        present: input.visualEvidenceMode !== null,
        visualEvidenceMode: input.visualEvidenceMode === null
          ? null
          : input.visualEvidenceMode ?? "new_tasks_only",
        ...(input.visualEvidenceModeError ? { visualEvidenceModeError: input.visualEvidenceModeError } : {}),
        visualWorkbenchExecutorCaptureShell: "allowlisted",
      },
    },
    runtimeAuthReadiness: {
      available: true,
      source: "authd",
      status: "ready",
      requiredProviders: ["codex"],
      providers: {},
      blockers: [],
      unknowns: [],
      evidenceNotes: [],
    },
    executionReadiness: {
      requestedMode: "agent_run",
      status: "blocked",
      proposedOperatorAction: "none_wait_for_lifecycle_blocker",
      expectedConvergence: "supervisor_resume",
      blockers: ["lifecycle_blocker"],
      lifecycleBlockers: ["RATE_LIMIT"],
      claimPolicyRejectionReasons: [],
      unknowns: [],
      requiredHumanEvidence: [],
      reason: "blocked by lifecycle",
      forbiddenImplicitActions: [
        "no_scheduler",
        "no_hidden_relaunch",
        "no_hidden_retry_unblock",
        "no_hidden_lifecycle_mutation",
        "no_raw_env_exposure",
      ],
    },
    workspace: {
      available: Boolean(input.workspacePath),
      unavailableReason: input.workspacePath ? null : "Workspace unavailable.",
      path: input.workspacePath,
      exists: Boolean(input.workspacePath),
      nonEmpty: Boolean(input.workspacePath),
      isGitRepo: Boolean(input.workspacePath),
      originUrl: "https://github.com/example/stook",
      branch: "main",
      commitSha: "1234567890abcdef1234567890abcdef12345678",
    },
    workspaceDecision: null,
    sourceBootstrapReadiness: {} as ProjectExperimentPreflight["sourceBootstrapReadiness"],
    visualScenarioReadiness: {} as ProjectExperimentPreflight["visualScenarioReadiness"],
    visualWorkbenchManifestReadiness: {
      available: true,
      unavailableReason: null,
      evidenceSource: "local_workspace_head_when_workspace_matches_repo",
      status: input.visualWorkbenchManifestStatus ?? "ready",
      canRunWorkbenchCapture: input.canRunWorkbenchCapture ?? true,
      manifestPath: `${input.workspacePath ?? "/tmp/stook"}/visual-workbench/manifest.json`,
      schemaVersion: "ra-355.visual-coverage-manifest.v0",
      projectClass: "ordinary_web",
      serveCommand: "npm run visual-workbench",
      baseUrlEnv: "VISUAL_WORKBENCH_BASE_URL",
      storyRoutePattern: "/__visual/:storyId",
      coveragePolicy: {
        mode: "story_matrix",
        selectionDefault: "task_relevant",
        simplificationRequiresEvidence: true,
      },
      storyCount: 1,
      features: ["jam-room"],
      widgets: ["SynthPad"],
      states: ["playing"],
      viewportNames: ["desktop"],
      stories: [{
        id: "synth-pad-playing",
        title: "Synth pad playing",
        kind: "widget",
        feature: "jam-room",
        widget: "SynthPad",
        state: "playing",
        route: "/__visual/synth-pad-playing",
        mockStateName: "mockSynthPadPlaying",
        viewportNames: ["desktop"],
        taskRelevanceDefaultFor: ["task-001#diff-1"],
      }],
      blockers: [],
      unknowns: [],
      issues: [],
      issueDetails: [],
      recommendedCapture: null,
      evidenceNotes: ["raw stories stay inside preflight only"],
    } as ProjectExperimentPreflight["visualWorkbenchManifestReadiness"],
    gitSyncRisk: {
      available: true,
      dirty: false,
      statusPreview: [],
      replayableOnly: true,
      wouldBlockSync: false,
      blockingPaths: [],
      policySource: "@arena/contracts:isRunnerManagedReplayableDirtyEntry",
    },
    bootstrap: {
      arenaStartExists: true,
      expectedPreviewFailureCode: null,
      expectedPreviewFailure: null,
    },
    helperGaps: [],
    evidenceNotes: [],
  };
}
