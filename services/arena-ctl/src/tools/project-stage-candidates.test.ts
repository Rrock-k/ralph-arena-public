import assert from "node:assert/strict";
import test from "node:test";
import {
  buildProjectStageCandidateProject,
  readProjectStageCandidates,
} from "./project-stage-candidates.js";
import type { ArenaCtlContext } from "../tool-context.js";
import type { ProjectStageSnapshot } from "./project-stage-snapshot.js";

test("buildProjectStageCandidateProject returns null when snapshot has no task candidates", () => {
  const snapshot = buildSnapshot([]);
  assert.equal(buildProjectStageCandidateProject(snapshot), null);
});

test("buildProjectStageCandidateProject summarizes candidate executor modes", () => {
  const snapshot = buildSnapshot([
    {
      id: "task-1",
      displayTitle: "New UI task",
      status: "pending",
      statusSource: "explicit",
      attempts: 0,
      lastError: null,
      requiredRolePasses: [],
      visualEvidenceRequired: true,
      feedbackItemRefCount: 1,
      recommendedExecutorMode: "new_task",
    },
    {
      id: "task-2",
      displayTitle: "Interrupted task",
      status: "in_progress",
      statusSource: "explicit",
      attempts: 1,
      lastError: "rate limit",
      requiredRolePasses: [],
      visualEvidenceRequired: null,
      feedbackItemRefCount: 1,
      recommendedExecutorMode: "resume_interrupted",
    },
    {
      id: "task-3",
      displayTitle: "Backend task",
      status: "pending",
      statusSource: "explicit",
      attempts: 0,
      lastError: null,
      requiredRolePasses: [],
      visualEvidenceRequired: false,
      feedbackItemRefCount: 0,
      recommendedExecutorMode: "new_task",
    },
  ]);

  assert.deepEqual(buildProjectStageCandidateProject(snapshot), {
    project: {
      id: "project-1",
      name: "Project One",
      runnerBackend: "local",
    },
    lifecycle: {
      classification: "healthy_agent_run",
      runtimeState: "RUNNING",
      agentState: "IDLE",
      previewHealth: "HEALTHY",
      lastOutcome: null,
    },
    source: {
      commitSha: "abc123",
      gitDirty: false,
      syncWouldBlock: false,
      blockingPathCount: 0,
    },
    acceptedArtifact: {
      classification: "current_v1_artifact",
      runnerReady: true,
      sourceProjectId: "telegram:1",
      sourceVersion: 3,
    },
    visualEvidencePolicy: snapshot.visualEvidencePolicy,
    visualWorkbenchManifestReadiness: snapshot.visualWorkbenchManifestReadiness,
    taskCounts: {
      pending: 2,
      in_progress: 1,
      completed: 0,
      failed: 0,
      skipped: 0,
      unknown: 0,
      total: 3,
    },
    candidateSummary: {
      newTask: 2,
      failedTask: 0,
      resumeInterrupted: 1,
      directExecutorCandidateCount: 2,
      resumeCheckpointRequiredCount: 1,
      visualEvidenceRequiredCount: 1,
      visualEvidenceNotRequiredCount: 1,
      visualEvidenceUnknownCount: 1,
    },
    taskCandidates: snapshot.plan.taskCandidates,
    nextHandoff: [
      "Select a pending or failed task id, rerun project_stage_snapshot with --task-id, then run executor_project_task as an explicit live workspace action.",
      "Select an in-progress task id and rerun project_stage_snapshot with --task-id to verify provider-session checkpoint readiness before resume_interrupted.",
    ],
    commands: {
      snapshot: "services/arena-ctl/cli.sh project_stage_snapshot --project-id project-1",
      selectedSnapshotTemplate: "services/arena-ctl/cli.sh project_stage_snapshot --project-id project-1 --task-id <task-id>",
    },
  });
});

test("readProjectStageCandidates reports truncation and partial scan failures", async () => {
  const calls: Array<{ projectId: string; tail: number | undefined }> = [];
  const candidateTask: ProjectStageSnapshot["plan"]["taskCandidates"][number] = {
    id: "task-candidate",
    displayTitle: "Retry UI bug",
    status: "failed",
    statusSource: "explicit",
    attempts: 2,
    lastError: "assertion failed",
    requiredRolePasses: [],
    visualEvidenceRequired: true,
    feedbackItemRefCount: 1,
    recommendedExecutorMode: "failed_task",
  };
  const ctx = {
    governance: {
      getSystemOverview: async () => ({
        projects: [
          { id: "project-candidate", name: "Candidate" },
          { id: "project-fails", name: "Fails" },
          { id: "project-omitted", name: "Omitted" },
          { id: "project-archived", name: "Archived", archivedAt: "2026-06-13T00:00:00.000Z" },
        ],
      }),
    },
  } as unknown as ArenaCtlContext;

  const result = await readProjectStageCandidates({
    ctx,
    limit: 2,
    tail: 7,
    generatedAt: "2026-06-13T01:00:00.000Z",
    readSnapshot: async ({ projectId, tail }) => {
      calls.push({ projectId, tail });
      if (projectId === "project-fails") throw new Error("snapshot failed");
      return buildSnapshot([candidateTask], {
        projectId,
        projectName: projectId === "project-candidate" ? "Candidate" : "Unknown",
      });
    },
  });

  assert.deepEqual(calls, [
    { projectId: "project-candidate", tail: 7 },
    { projectId: "project-fails", tail: 7 },
  ]);
  assert.deepEqual(result.scan, {
    projectLimit: 2,
    includeArchived: false,
    eligibleProjectCount: 3,
    truncated: true,
    omittedProjectCount: 1,
    scannedProjectCount: 2,
    candidateProjectCount: 1,
    scanFailureCount: 1,
  });
  assert.equal(result.candidateProjects[0]?.project.id, "project-candidate");
  assert.equal(result.candidateProjects[0]?.visualEvidencePolicy.visualEvidenceMode, "new_tasks_only");
  assert.equal(result.candidateProjects[0]?.visualWorkbenchManifestReadiness.canRunWorkbenchCapture, true);
  assert.match(
    result.evidenceNotes.join("\n"),
    /Visual evidence policy and Visual Workbench manifest readiness are copied from Project Stage Snapshot owner reads/,
  );
  assert.deepEqual(result.scanFailures, [
    {
      projectId: "project-fails",
      projectName: "Fails",
      error: "snapshot failed",
    },
  ]);
});

function buildSnapshot(
  taskCandidates: ProjectStageSnapshot["plan"]["taskCandidates"],
  options?: {
    projectId?: string;
    projectName?: string;
  },
): ProjectStageSnapshot {
  const projectId = options?.projectId ?? "project-1";
  const projectName = options?.projectName ?? "Project One";
  return {
    schemaVersion: "ra-356.project-stage-snapshot.v1",
    generatedAt: "2026-06-13T00:00:00.000Z",
    projectId,
    selectedTaskId: null,
    stageBoundary: {
      ownerBoundary: "arena-ctl.project-stage-snapshot",
      mode: "read_only",
      allowed: ["none"],
      forbidden: [],
    },
    ownerReads: [],
    project: {
      id: projectId,
      name: projectName,
      runnerBackend: "local",
    },
    lifecycleContext: {
      classification: "healthy_agent_run",
      tgSpecLaunchConfiguration: null,
      tuple: {
        powerIntent: "ON",
        agentIntent: "ON",
        runtimeState: "RUNNING",
        agentState: "IDLE",
        blockers: [],
        lastOutcome: null,
        provisionedAt: null,
        previewHealth: "HEALTHY",
        previewUrl: "https://example.test",
      },
      allowedActions: [],
      recommendedNextAction: "no_action",
    },
    source: {
      runnerExpectation: {
        repoUrl: "https://example.test/repo.git",
        baseBranch: "main",
        projectBranch: null,
        commitSha: "abc123",
        runnerModeSource: "governance_runtime_claim_dry_run",
        claimDryRunAvailable: true,
      },
      workspace: {
        available: true,
        unavailableReason: null,
        path: "/tmp/project",
        exists: true,
        isGitRepo: true,
        originUrl: "https://example.test/repo.git",
        branch: "main",
        commitSha: "abc123",
      },
      workspaceDecision: {
        reuseExistingWorkspace: true,
        reasonCode: "workspace_matches_repo",
        reasonMessage: "workspace matches configured repo snapshot",
      },
      gitSyncRisk: {
        available: true,
        dirty: false,
        statusPreview: [],
        replayableOnly: true,
        wouldBlockSync: false,
        blockingPaths: [],
        policySource: "@arena/contracts:isRunnerManagedReplayableDirtyEntry",
      },
      remoteFreshnessChecked: false,
    },
    acceptedArtifactAudit: {
      available: true,
      projectId,
      projectName,
      classification: "current_v1_artifact",
      runnerReady: true,
      storageMode: "accepted_artifact_v1",
      latestSpec: {
        specId: "spec-1",
        specVersionId: "spec-version-1",
        version: 1,
        sourceProjectId: "telegram:1",
        sourceVersion: 3,
        metadataHash: "sha256:abc",
      },
      recommendedNextAction: "no_action",
      allowedActions: [],
      why: [],
      operatorNotes: [],
      error: null,
    },
    visualWorkbenchManifestReadiness: {
      available: true,
      status: "ready",
      canRunWorkbenchCapture: true,
      schemaVersion: "ra-355.visual-coverage-manifest.v0",
      projectClass: "ordinary_web",
      blockers: [],
      unknowns: [],
    },
    visualEvidencePolicy: {
      owner: "governance.runner-init-readiness.ralphConfig",
      status: "ready",
      visualEvidenceMode: "new_tasks_only",
      blockers: [],
      notes: ["visualEvidenceMode=new_tasks_only"],
    },
    selectedTaskVisualReadback: {
      selectedTaskId: null,
      selectedTaskStatus: null,
      visualEvidenceRequired: null,
      visualEvidenceMode: "new_tasks_only",
      visualEvidencePolicyStatus: "ready",
      visualWorkbenchManifestStatus: "ready",
      canRunWorkbenchCapture: true,
      visualExpectationSources: [],
      nextProjectActionId: null,
      status: "not_selected",
      tone: "neutral",
      reasonCode: "task_id_not_selected",
      title: "No task selected",
      message: "Run Get task context with one task id before checking story selection.",
      canCheckStorySelection: false,
    },
    selectedTaskWorkbenchAutomationReadback: {
      owner: "@arena/ralph-runtime:IterationLog.visualWorkbenchAutomation",
      selectedTaskId: null,
      iterationLogStatus: "unavailable",
      path: null,
      status: "not_selected",
      tone: "neutral",
      reasonCode: "task_id_not_selected",
      title: "No task selected",
      message: "Snapshot must be rerun with one task id before Workbench automation telemetry can be read.",
      automation: null,
    },
    plan: {
      owner: "@arena/ralph-runtime:PlanSchema",
      path: "/tmp/project/.ralph/plan.json",
      status: "ready",
      reasonCode: "task_id_not_selected",
      schemaOwner: "@arena/ralph-runtime",
      version: 1,
      specFile: "spec.md",
      specHash: "hash",
      createdAt: "2026-06-13T00:00:00.000Z",
      updatedAt: "2026-06-13T00:00:00.000Z",
      phaseCount: 1,
      judgmentCount: 0,
      specMigrationCount: 0,
      taskCounts: {
        pending: taskCandidates.filter((candidate) => candidate.status === "pending").length,
        in_progress: taskCandidates.filter((candidate) => candidate.status === "in_progress").length,
        completed: 0,
        failed: taskCandidates.filter((candidate) => candidate.status === "failed").length,
        skipped: 0,
        unknown: 0,
        total: taskCandidates.length,
      },
      taskCandidates,
      selectedTask: null,
      blockers: ["task_id_not_selected"],
      warnings: [],
    },
    providerSessions: {
      owner: "@arena/ralph-runtime:ProviderSessionCheckpointStore",
      path: null,
      status: "missing",
      reasonCode: "checkpoint_missing",
      sessionCount: null,
      selectedTaskSessionCount: null,
      selectedTaskResumableSessionCount: null,
      selectedTaskSessions: [],
      selectedTaskCheckpointReadback: {
        selectedTaskId: null,
        selectedTaskStatus: null,
        recommendedExecutorMode: null,
        providerSessionStatus: "missing",
        selectedTaskSessionCount: null,
        selectedTaskResumableSessionCount: null,
        nextProjectActionId: null,
        status: "not_selected",
        tone: "neutral",
        reasonCode: "task_id_not_selected",
        title: "No task selected",
        message: "Snapshot must be rerun with one task id before executor input can be prepared.",
        canPrepareExecutor: false,
      },
      blockers: [],
      warnings: [],
    },
    nextHandoff: [],
    evidenceNotes: [],
  };
}
