import * as z from "zod/v4";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { jsonResult, errorResult, toErrorMessage } from "../result.js";
import type { ArenaCtlContext } from "../tool-context.js";
import {
  readProjectStageSnapshot,
  type ProjectStageSnapshot,
} from "./project-stage-snapshot.js";

export const PROJECT_STAGE_CANDIDATES_SCHEMA_VERSION = "ra-356.project-stage-candidates.v1";

const DEFAULT_PROJECT_SCAN_LIMIT = 25;
const MAX_PROJECT_SCAN_LIMIT = 100;
const DEFAULT_TAIL = 5;
const MAX_TAIL = 5000;

type SystemOverview = {
  projects?: Array<{
    id?: string;
    name?: string | null;
    archivedAt?: string | null;
    app?: {
      powerIntent?: string | null;
      agentIntent?: string | null;
      runtimeState?: string | null;
      agentState?: string | null;
      previewHealth?: string | null;
      lastOutcome?: string | null;
    } | null;
  }>;
};

type StageCandidateTask = ProjectStageSnapshot["plan"]["taskCandidates"][number];

export type ProjectStageCandidateScan = {
  schemaVersion: typeof PROJECT_STAGE_CANDIDATES_SCHEMA_VERSION;
  generatedAt: string;
  ownerBoundary: "arena-ctl.project-stage-candidates";
  mode: "read_only";
  allowed: ["none"];
  forbidden: string[];
  scan: {
    projectLimit: number;
    includeArchived: boolean;
    eligibleProjectCount: number;
    truncated: boolean;
    omittedProjectCount: number;
    scannedProjectCount: number;
    candidateProjectCount: number;
    scanFailureCount: number;
  };
  candidateProjects: Array<{
    project: {
      id: string;
      name: string | null;
      runnerBackend: string | null;
    };
    lifecycle: {
      classification: string | null;
      runtimeState: string | null;
      agentState: string | null;
      previewHealth: string | null;
      lastOutcome: string | null;
    };
    source: {
      commitSha: string | null;
      gitDirty: boolean | null;
      syncWouldBlock: boolean | null;
      blockingPathCount: number;
    };
    acceptedArtifact: {
      classification: string | null;
      runnerReady: boolean | null;
      sourceProjectId: string | null;
      sourceVersion: number | null;
    };
    visualEvidencePolicy: ProjectStageSnapshot["visualEvidencePolicy"];
    visualWorkbenchManifestReadiness: ProjectStageSnapshot["visualWorkbenchManifestReadiness"];
    taskCounts: ProjectStageSnapshot["plan"]["taskCounts"];
    candidateSummary: {
      newTask: number;
      failedTask: number;
      resumeInterrupted: number;
      directExecutorCandidateCount: number;
      resumeCheckpointRequiredCount: number;
      visualEvidenceRequiredCount: number;
      visualEvidenceNotRequiredCount: number;
      visualEvidenceUnknownCount: number;
    };
    taskCandidates: StageCandidateTask[];
    nextHandoff: string[];
    commands: {
      snapshot: string;
      selectedSnapshotTemplate: string;
    };
  }>;
  scanFailures: Array<{
    projectId: string;
    projectName: string | null;
    error: string;
  }>;
  evidenceNotes: string[];
};

export function registerProjectStageCandidatesTool(server: McpServer, ctx: ArenaCtlContext) {
  server.registerTool("project_stage_candidates", {
    description:
      "Read-only RA-356 scan for projects with pending, failed or in-progress executor task candidates. " +
      "It reuses project_stage_snapshot per project and does not mutate lifecycle, runtime, source, tasks, evidence or provider state.",
    inputSchema: {
      limit: z.number().int().min(1).max(MAX_PROJECT_SCAN_LIMIT).optional(),
      includeArchived: z.boolean().optional(),
      tail: z.number().int().min(1).max(MAX_TAIL).optional(),
    },
  }, async ({ limit, includeArchived, tail }) => {
    try {
      return jsonResult(await readProjectStageCandidates({
        ctx,
        limit,
        includeArchived,
        tail,
      }));
    } catch (error) {
      return errorResult("Failed to scan project stage candidates", toErrorMessage(error));
    }
  });
}

export async function readProjectStageCandidates(input: {
  ctx: ArenaCtlContext;
  limit?: number;
  includeArchived?: boolean;
  tail?: number;
  generatedAt?: string;
  readSnapshot?: typeof readProjectStageSnapshot;
}): Promise<ProjectStageCandidateScan> {
  const projectLimit = normalizeProjectLimit(input.limit);
  const includeArchived = input.includeArchived ?? false;
  const tail = normalizeTail(input.tail);
  const readSnapshot = input.readSnapshot ?? readProjectStageSnapshot;
  const overview = await input.ctx.governance.getSystemOverview() as SystemOverview;
  const eligibleProjects = readCandidateScanProjects(overview, includeArchived);
  const projects = eligibleProjects.slice(0, projectLimit);
  const candidateProjects: ProjectStageCandidateScan["candidateProjects"] = [];
  const scanFailures: ProjectStageCandidateScan["scanFailures"] = [];

  for (const project of projects) {
    try {
      const snapshot = await readSnapshot({
        ctx: input.ctx,
        projectId: project.id,
        tail,
      });
      const candidateProject = buildProjectStageCandidateProject(snapshot);
      if (candidateProject) candidateProjects.push(candidateProject);
    } catch (error) {
      scanFailures.push({
        projectId: project.id,
        projectName: project.name,
        error: toErrorMessage(error),
      });
    }
  }

  return {
    schemaVersion: PROJECT_STAGE_CANDIDATES_SCHEMA_VERSION,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    ownerBoundary: "arena-ctl.project-stage-candidates",
    mode: "read_only",
    allowed: ["none"],
    forbidden: [
      "no_lifecycle_write",
      "no_runtime_intent_write",
      "no_source_write",
      "no_plan_or_task_write",
      "no_evidence_or_progress_write",
      "no_provider_call",
      "no_hidden_retry_relaunch_recreate_or_unblock",
      "no_implicit_task_selection",
    ],
    scan: {
      projectLimit,
      includeArchived,
      eligibleProjectCount: eligibleProjects.length,
      truncated: eligibleProjects.length > projects.length,
      omittedProjectCount: Math.max(eligibleProjects.length - projects.length, 0),
      scannedProjectCount: projects.length,
      candidateProjectCount: candidateProjects.length,
      scanFailureCount: scanFailures.length,
    },
    candidateProjects,
    scanFailures,
    evidenceNotes: [
      "Project Stage Candidate scan is read-only and uses Project Stage Snapshot as its per-project owner read.",
      "The scan reports candidate tasks for operator selection; it does not select a task or run planner/executor/controller.",
      "In-progress candidates still require a selected-task snapshot to verify provider session checkpoint readiness before resume_interrupted.",
      "Visual evidence policy and Visual Workbench manifest readiness are copied from Project Stage Snapshot owner reads; they do not imply task selection, selector readiness, screenshot proof or review availability.",
      "Project scan order follows governance system overview order and is capped by projectLimit; use scan.truncated and scan.omittedProjectCount before treating zero candidates as a fleet-wide result.",
    ],
  };
}

export function buildProjectStageCandidateProject(snapshot: ProjectStageSnapshot): ProjectStageCandidateScan["candidateProjects"][number] | null {
  const taskCandidates = snapshot.plan.taskCandidates;
  if (taskCandidates.length === 0) return null;
  const candidateSummary = summarizeCandidateModes(taskCandidates);
  return {
    project: {
      id: snapshot.project.id,
      name: snapshot.project.name ?? null,
      runnerBackend: snapshot.project.runnerBackend ?? null,
    },
    lifecycle: {
      classification: snapshot.lifecycleContext.classification ?? null,
      runtimeState: snapshot.lifecycleContext.tuple.runtimeState ?? null,
      agentState: snapshot.lifecycleContext.tuple.agentState ?? null,
      previewHealth: snapshot.lifecycleContext.tuple.previewHealth ?? null,
      lastOutcome: snapshot.lifecycleContext.tuple.lastOutcome ?? null,
    },
    source: {
      commitSha: snapshot.source.workspace.commitSha ?? null,
      gitDirty: snapshot.source.gitSyncRisk.available ? snapshot.source.gitSyncRisk.dirty : null,
      syncWouldBlock: snapshot.source.gitSyncRisk.available ? snapshot.source.gitSyncRisk.wouldBlockSync : null,
      blockingPathCount: snapshot.source.gitSyncRisk.available ? snapshot.source.gitSyncRisk.blockingPaths.length : 0,
    },
    acceptedArtifact: {
      classification: snapshot.acceptedArtifactAudit.classification,
      runnerReady: snapshot.acceptedArtifactAudit.runnerReady,
      sourceProjectId: snapshot.acceptedArtifactAudit.latestSpec.sourceProjectId,
      sourceVersion: snapshot.acceptedArtifactAudit.latestSpec.sourceVersion,
    },
    visualEvidencePolicy: snapshot.visualEvidencePolicy,
    visualWorkbenchManifestReadiness: snapshot.visualWorkbenchManifestReadiness,
    taskCounts: snapshot.plan.taskCounts,
    candidateSummary,
    taskCandidates,
    nextHandoff: buildCandidateProjectHandoff(candidateSummary),
    commands: {
      snapshot: `services/arena-ctl/cli.sh project_stage_snapshot --project-id ${snapshot.projectId}`,
      selectedSnapshotTemplate: `services/arena-ctl/cli.sh project_stage_snapshot --project-id ${snapshot.projectId} --task-id <task-id>`,
    },
  };
}

function normalizeProjectLimit(limit: number | undefined): number {
  if (limit === undefined) return DEFAULT_PROJECT_SCAN_LIMIT;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PROJECT_SCAN_LIMIT) {
    throw new Error(`Project scan limit must be an integer from 1 to ${MAX_PROJECT_SCAN_LIMIT}.`);
  }
  return limit;
}

function normalizeTail(tail: number | undefined): number {
  if (tail === undefined) return DEFAULT_TAIL;
  if (!Number.isInteger(tail) || tail < 1 || tail > MAX_TAIL) {
    throw new Error(`Tail must be an integer from 1 to ${MAX_TAIL}.`);
  }
  return tail;
}

function readCandidateScanProjects(overview: SystemOverview, includeArchived: boolean): Array<{ id: string; name: string | null }> {
  const projects = Array.isArray(overview.projects) ? overview.projects : [];
  return projects.flatMap((project) => {
    if (!project.id) return [];
    if (!includeArchived && project.archivedAt != null) return [];
    return [{
      id: project.id,
      name: typeof project.name === "string" && project.name.trim() ? project.name : null,
    }];
  });
}

function summarizeCandidateModes(taskCandidates: StageCandidateTask[]): ProjectStageCandidateScan["candidateProjects"][number]["candidateSummary"] {
  const newTask = taskCandidates.filter((candidate) => candidate.recommendedExecutorMode === "new_task").length;
  const failedTask = taskCandidates.filter((candidate) => candidate.recommendedExecutorMode === "failed_task").length;
  const resumeInterrupted = taskCandidates.filter((candidate) => candidate.recommendedExecutorMode === "resume_interrupted").length;
  const visualEvidenceRequiredCount = taskCandidates.filter((candidate) => candidate.visualEvidenceRequired === true).length;
  const visualEvidenceNotRequiredCount = taskCandidates.filter((candidate) => candidate.visualEvidenceRequired === false).length;
  const visualEvidenceUnknownCount = taskCandidates.filter((candidate) => candidate.visualEvidenceRequired !== true && candidate.visualEvidenceRequired !== false).length;
  return {
    newTask,
    failedTask,
    resumeInterrupted,
    directExecutorCandidateCount: newTask + failedTask,
    resumeCheckpointRequiredCount: resumeInterrupted,
    visualEvidenceRequiredCount,
    visualEvidenceNotRequiredCount,
    visualEvidenceUnknownCount,
  };
}

function buildCandidateProjectHandoff(
  summary: ProjectStageCandidateScan["candidateProjects"][number]["candidateSummary"],
): string[] {
  const handoff: string[] = [];
  if (summary.directExecutorCandidateCount > 0) {
    handoff.push("Select a pending or failed task id, rerun project_stage_snapshot with --task-id, then run executor_project_task as an explicit live workspace action.");
  }
  if (summary.resumeCheckpointRequiredCount > 0) {
    handoff.push("Select an in-progress task id and rerun project_stage_snapshot with --task-id to verify provider-session checkpoint readiness before resume_interrupted.");
  }
  return handoff.length > 0 ? handoff : ["No executor candidate handoff is available."];
}
