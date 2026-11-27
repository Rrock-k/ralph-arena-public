#!/usr/bin/env node
import assert from "node:assert/strict";
import test from "node:test";

import {
  buildRa268ProofCarrierGateReport,
  classifyCandidateTask,
} from "./ra268-proof-carrier-gate.mjs";

test("passes when a resume candidate has a failed auth or infra checkpoint", () => {
  const candidateScan = buildCandidateScan([
    buildCandidateProject({
      projectId: "project-auth",
      taskId: "task-1",
      mode: "resume_interrupted",
    }),
  ]);
  const report = buildRa268ProofCarrierGateReport({
    generatedAt: "2026-06-26T00:00:00.000Z",
    candidateScan,
    selectedSnapshots: [
      buildSelectedSnapshot({
        projectId: "project-auth",
        taskId: "task-1",
        checkpointReasonCode: "failed_error_checkpoint_ready",
        canPrepareExecutor: true,
        sessions: [
          { outcome: "error", errorCategory: "infra", reason: "task_attempt" },
        ],
      }),
    ],
  });

  assert.equal(report.decision, "candidate_available");
  assert.equal(report.eligibleCarrierCount, 1);
  assert.deepEqual(report.blockedReasons, []);
  assert.equal(report.candidateDecisions[0].verdict, "eligible");
  assert.equal(report.candidateDecisions[0].proofClass, "stale_runtime_auth_probe_carrier");
});

test("blocks ordinary new work and unsafe resume candidates", () => {
  const candidateScan = buildCandidateScan([
    buildCandidateProject({
      projectId: "project-new",
      taskId: "task-new",
      mode: "new_task",
    }),
    buildCandidateProject({
      projectId: "project-parked",
      taskId: "task-parked",
      lifecycleClassification: "parked",
      mode: "resume_interrupted",
    }),
    buildCandidateProject({
      projectId: "project-sync",
      taskId: "task-sync",
      mode: "resume_interrupted",
      syncWouldBlock: true,
    }),
    buildCandidateProject({
      projectId: "project-markdown",
      taskId: "task-markdown",
      mode: "resume_interrupted",
      acceptedArtifactClassification: "markdown_only_spec",
      runnerReady: false,
    }),
    buildCandidateProject({
      projectId: "project-success",
      taskId: "task-success",
      mode: "resume_interrupted",
    }),
  ]);
  const report = buildRa268ProofCarrierGateReport({
    generatedAt: "2026-06-26T00:00:00.000Z",
    candidateScan,
    selectedSnapshots: [
      buildSelectedSnapshot({
        projectId: "project-success",
        taskId: "task-success",
        checkpointReasonCode: "success_checkpoint_not_resumable",
        canPrepareExecutor: false,
        sessions: [
          { outcome: "success", errorCategory: null, reason: "task_attempt" },
        ],
      }),
      buildSelectedSnapshot({
        projectId: "project-parked",
        taskId: "task-parked",
        checkpointReasonCode: "failed_error_checkpoint_ready",
        canPrepareExecutor: true,
        sessions: [
          { outcome: "error", errorCategory: "infra", reason: "task_attempt" },
        ],
      }),
      buildSelectedSnapshot({
        projectId: "project-sync",
        taskId: "task-sync",
        checkpointReasonCode: "failed_error_checkpoint_ready",
        canPrepareExecutor: true,
        syncWouldBlock: true,
        sessions: [
          { outcome: "error", errorCategory: "infra", reason: "task_attempt" },
        ],
      }),
      buildSelectedSnapshot({
        projectId: "project-markdown",
        taskId: "task-markdown",
        checkpointReasonCode: "failed_error_checkpoint_ready",
        canPrepareExecutor: true,
        acceptedArtifactClassification: "markdown_only_spec",
        runnerReady: false,
        sessions: [
          { outcome: "error", errorCategory: "infra", reason: "task_attempt" },
        ],
      }),
    ],
  });

  assert.equal(report.decision, "block");
  assert.equal(report.eligibleCarrierCount, 0);
  assert.ok(report.blockedReasons.some((reason) => reason.startsWith("safe-proof-carrier:")));
  assert.deepEqual(report.candidateDecisions.map((decision) => decision.verdict), [
    "reject",
    "reject",
    "reject",
    "reject",
    "reject",
  ]);
  assert.ok(report.candidateDecisions[0].blockers.includes("executor_mode_new_task_does_not_probe_stale_runtime_auth"));
  assert.ok(report.candidateDecisions[1].blockers.includes("project_is_parked_requires_app_on"));
  assert.ok(report.candidateDecisions[2].blockers.includes("source_sync_would_block"));
  assert.ok(report.candidateDecisions[3].blockers.includes("accepted_artifact_markdown_only_spec"));
  assert.ok(report.candidateDecisions[4].blockers.includes("provider_checkpoint_success_checkpoint_not_resumable"));
  assert.ok(report.candidateDecisions[4].blockers.includes("no_auth_or_infra_error_checkpoint"));
});

test("requires selected snapshots for resume candidates", () => {
  const decision = classifyCandidateTask({
    candidateProject: buildCandidateProject({
      projectId: "project-needs-snapshot",
      taskId: "task-1",
      mode: "resume_interrupted",
    }),
    task: buildTask({ taskId: "task-1", mode: "resume_interrupted" }),
    selectedSnapshot: null,
  });

  assert.equal(decision.verdict, "needs_selected_snapshot");
  assert.ok(decision.blockers.includes("selected_snapshot_missing"));
});

test("blocks incomplete candidate scans when no carrier is available", () => {
  const report = buildRa268ProofCarrierGateReport({
    candidateScan: buildCandidateScan([], {
      scanFailureCount: 1,
      scanFailures: [
        { projectId: "project-failed", projectName: "Failed", error: "snapshot failed" },
      ],
    }),
    selectedSnapshots: [],
  });

  assert.equal(report.decision, "block");
  assert.ok(report.blockedReasons.some((reason) => reason.startsWith("candidate-scan-failures:")));
  assert.ok(report.blockedReasons.some((reason) => reason.startsWith("safe-proof-carrier:")));
});

function buildCandidateScan(candidateProjects, options = {}) {
  return {
    schemaVersion: "ra-356.project-stage-candidates.v1",
    generatedAt: "2026-06-26T00:00:00.000Z",
    ownerBoundary: "arena-ctl.project-stage-candidates",
    mode: "read_only",
    allowed: ["none"],
    forbidden: [],
    scan: {
      projectLimit: 80,
      includeArchived: false,
      eligibleProjectCount: candidateProjects.length,
      truncated: Boolean(options.truncated),
      omittedProjectCount: 0,
      scannedProjectCount: candidateProjects.length,
      candidateProjectCount: candidateProjects.length,
      scanFailureCount: options.scanFailureCount ?? 0,
    },
    candidateProjects,
    scanFailures: options.scanFailures ?? [],
    evidenceNotes: [],
  };
}

function buildCandidateProject(options = {}) {
  const projectId = options.projectId ?? "project-1";
  const taskId = options.taskId ?? "task-1";
  const mode = options.mode ?? "resume_interrupted";
  return {
    project: {
      id: projectId,
      name: options.projectName ?? "Project",
      runnerBackend: "local",
    },
    lifecycle: {
      classification: options.lifecycleClassification ?? "waiting_by_blocker",
      runtimeState: "RUNNING",
      agentState: "IDLE",
      previewHealth: "HEALTHY",
      lastOutcome: null,
    },
    source: {
      commitSha: "abc123",
      gitDirty: Boolean(options.syncWouldBlock),
      syncWouldBlock: Boolean(options.syncWouldBlock),
      blockingPathCount: options.syncWouldBlock ? 1 : 0,
    },
    acceptedArtifact: {
      classification: options.acceptedArtifactClassification ?? "current_v1_artifact",
      runnerReady: options.runnerReady ?? true,
      sourceProjectId: "source-1",
      sourceVersion: 1,
    },
    visualEvidencePolicy: {},
    visualWorkbenchManifestReadiness: {},
    taskCounts: {},
    candidateSummary: {},
    taskCandidates: [
      buildTask({ taskId, mode }),
    ],
    nextHandoff: [],
    commands: {},
  };
}

function buildTask(options = {}) {
  return {
    id: options.taskId ?? "task-1",
    displayTitle: "Task",
    status: options.mode === "new_task" ? "pending" : "in_progress",
    statusSource: "explicit",
    attempts: 0,
    lastError: null,
    requiredRolePasses: [],
    visualEvidenceRequired: false,
    feedbackItemRefCount: 1,
    recommendedExecutorMode: options.mode ?? "resume_interrupted",
  };
}

function buildSelectedSnapshot(options = {}) {
  const projectId = options.projectId ?? "project-1";
  const taskId = options.taskId ?? "task-1";
  return {
    schemaVersion: "ra-356.project-stage-snapshot.v1",
    generatedAt: "2026-06-26T00:00:00.000Z",
    projectId,
    selectedTaskId: taskId,
    lifecycleContext: {
      classification: options.lifecycleClassification ?? "waiting_by_blocker",
      recommendedNextAction: options.recommendedNextAction ?? "no_action",
    },
    source: {
      gitSyncRisk: {
        wouldBlockSync: Boolean(options.syncWouldBlock),
      },
    },
    acceptedArtifactAudit: {
      classification: options.acceptedArtifactClassification ?? "current_v1_artifact",
      runnerReady: options.runnerReady ?? true,
    },
    providerSessions: {
      selectedTaskCheckpointReadback: {
        selectedTaskId: taskId,
        selectedTaskStatus: "in_progress",
        recommendedExecutorMode: "resume_interrupted",
        providerSessionStatus: "ready",
        selectedTaskSessionCount: 1,
        selectedTaskResumableSessionCount: options.canPrepareExecutor ? 1 : 0,
        nextProjectActionId: null,
        status: options.canPrepareExecutor ? "checkpoint_ready" : "checkpoint_blocked",
        tone: options.canPrepareExecutor ? "good" : "warn",
        reasonCode: options.checkpointReasonCode ?? "failed_error_checkpoint_ready",
        title: "Checkpoint",
        message: "Checkpoint readback.",
        canPrepareExecutor: Boolean(options.canPrepareExecutor),
      },
      selectedTaskSessions: (options.sessions ?? []).map((session, index) => ({
        agent: "codex",
        model: "gpt-5.5",
        taskId,
        taskFingerprint: `fingerprint-${index}`,
        specHash: "spec",
        sessionId: `session-${index}`,
        reason: session.reason,
        outcome: session.outcome,
        errorCategory: session.errorCategory,
        resumedFrom: null,
        resumeFallbackReason: null,
        updatedAt: "2026-06-26T00:00:00.000Z",
      })),
    },
  };
}
