import { describe, expect, it } from "vitest";
import { getCandidateScanOperatorNotice, getCandidateScanProjects } from "./admin-lab-candidate-scan-view";

describe("getCandidateScanProjects", () => {
  it("extracts candidate projects and filters invalid task rows", () => {
    expect(getCandidateScanProjects({
      candidateProjects: [
        {
          project: {
            id: "project-1",
            name: "Project One",
          },
          lifecycle: {
            classification: "active_broken",
            previewHealth: "HEALTHY",
          },
          visualEvidencePolicy: {
            status: "ready",
            visualEvidenceMode: "new_tasks_only",
            blockers: [],
          },
          visualWorkbenchManifestReadiness: {
            available: true,
            status: "ready",
            canRunWorkbenchCapture: true,
            projectClass: "ordinary_web",
            blockers: [],
            unknowns: [],
          },
          candidateSummary: {
            directExecutorCandidateCount: 1,
            resumeCheckpointRequiredCount: 0,
            visualEvidenceRequiredCount: 1,
            visualEvidenceNotRequiredCount: 0,
            visualEvidenceUnknownCount: 0,
          },
          taskCandidates: [
            {
              id: "task-1",
              displayTitle: "Fix visual bug",
              status: "failed",
              recommendedExecutorMode: "failed_task",
              attempts: 2,
              lastError: "screenshot mismatch",
              visualEvidenceRequired: true,
              feedbackItemRefCount: 1,
            },
            {
              id: "task-ignored",
              status: "completed",
              recommendedExecutorMode: "new_task",
            },
          ],
        },
        {
          project: {
            name: "Missing id",
          },
          taskCandidates: [
            {
              id: "task-2",
              status: "pending",
              recommendedExecutorMode: "new_task",
            },
          ],
        },
      ],
    })).toEqual([
      {
        projectId: "project-1",
        projectName: "Project One",
        classification: "active_broken",
        previewHealth: "HEALTHY",
        visualEvidencePolicyStatus: "ready",
        visualEvidenceMode: "new_tasks_only",
        visualEvidencePolicyBlockers: [],
        visualWorkbenchManifestStatus: "ready",
        visualWorkbenchCanRunCapture: true,
        visualWorkbenchProjectClass: "ordinary_web",
        visualWorkbenchManifestBlockers: [],
        visualWorkbenchManifestUnknowns: [],
        directExecutorCandidateCount: 1,
        resumeCheckpointRequiredCount: 0,
        visualEvidenceRequiredCount: 1,
        visualEvidenceNotRequiredCount: 0,
        visualEvidenceUnknownCount: 0,
        candidates: [
          {
            id: "task-1",
            title: "Fix visual bug",
            status: "failed",
            recommendedExecutorMode: "failed_task",
            attempts: 2,
            lastError: "screenshot mismatch",
            visualEvidenceRequired: true,
            feedbackItemRefCount: 1,
          },
        ],
      },
    ]);
  });

  it("explains an empty truncated scan without turning it into fleet-wide truth", () => {
    expect(getCandidateScanOperatorNotice({
      scan: {
        candidateProjectCount: 0,
        scannedProjectCount: 25,
        eligibleProjectCount: 42,
        omittedProjectCount: 17,
        truncated: true,
      },
      candidateProjects: [],
    })).toEqual({
      tone: "warning",
      title: "No task candidates in this capped scan",
      body: "The scan checked 25 of 42 eligible projects and omitted 17. Raise the limit before treating this as fleet-wide.",
    });
  });

  it("explains resume-only scans as checkpoint-gated instead of executor-ready", () => {
    expect(getCandidateScanOperatorNotice({
      scan: {
        candidateProjectCount: 1,
        scannedProjectCount: 1,
        eligibleProjectCount: 1,
        omittedProjectCount: 0,
        truncated: false,
      },
      candidateProjects: [
        {
          project: { id: "project-1" },
          candidateSummary: {
            directExecutorCandidateCount: 0,
            resumeCheckpointRequiredCount: 2,
          },
        },
      ],
    })).toEqual({
      tone: "warning",
      title: "No executor-ready task yet",
      body: "The scan found only interrupted resume candidates. Pick one and run Get task context for that task; executor resume is safe only after context confirms a matching provider-session checkpoint.",
    });
  });

  it("keeps mixed candidate scans clear about checkpoint-gated rows", () => {
    expect(getCandidateScanOperatorNotice({
      scan: {
        candidateProjectCount: 1,
      },
      candidateProjects: [
        {
          project: { id: "project-1" },
          candidateSummary: {
            directExecutorCandidateCount: 1,
            resumeCheckpointRequiredCount: 1,
          },
        },
      ],
    })).toEqual({
      tone: "info",
      title: "Some rows need a checkpoint",
      body: "Pending and failed tasks are executor-ready. Interrupted resume rows still need Get task context with a matching provider-session checkpoint.",
    });
  });

  it("explains direct candidates without visual-marked tasks as non-visual readback", () => {
    expect(getCandidateScanOperatorNotice({
      scan: {
        candidateProjectCount: 1,
      },
      candidateProjects: [
        {
          project: { id: "project-1" },
          candidateSummary: {
            directExecutorCandidateCount: 2,
            resumeCheckpointRequiredCount: 0,
            visualEvidenceRequiredCount: 0,
            visualEvidenceNotRequiredCount: 2,
            visualEvidenceUnknownCount: 0,
          },
        },
      ],
    })).toEqual({
      tone: "info",
      title: "No visual-marked executor task in this scan",
      body: "Pending and failed tasks exist, but none are marked visual evidence required. Use this scan when you do not need a visual-marked task, or choose another project/work packet for a visual walkthrough.",
    });
  });

  it("keeps checkpoint guidance when mixed candidates have no visual-marked tasks", () => {
    expect(getCandidateScanOperatorNotice({
      scan: {
        candidateProjectCount: 1,
      },
      candidateProjects: [
        {
          project: { id: "project-1" },
          candidateSummary: {
            directExecutorCandidateCount: 1,
            resumeCheckpointRequiredCount: 1,
            visualEvidenceRequiredCount: 0,
            visualEvidenceNotRequiredCount: 1,
            visualEvidenceUnknownCount: 0,
          },
        },
      ],
    })).toEqual({
      tone: "info",
      title: "No visual-marked executor task in this scan",
      body: "Pending and failed tasks exist, but none are marked visual evidence required. Interrupted rows still need Get task context with a matching provider-session checkpoint.",
    });
  });

  it("does not treat mixed known and missing visual counts as zero visual tasks", () => {
    expect(getCandidateScanOperatorNotice({
      scan: {
        candidateProjectCount: 2,
      },
      candidateProjects: [
        {
          project: { id: "project-1" },
          candidateSummary: {
            directExecutorCandidateCount: 1,
            resumeCheckpointRequiredCount: 0,
            visualEvidenceRequiredCount: 0,
            visualEvidenceNotRequiredCount: 1,
            visualEvidenceUnknownCount: 0,
          },
        },
        {
          project: { id: "project-2" },
          candidateSummary: {
            directExecutorCandidateCount: 1,
            resumeCheckpointRequiredCount: 0,
          },
        },
      ],
    })).toBeNull();
  });

  it("does not treat partial visual counts as known zero visual tasks", () => {
    expect(getCandidateScanOperatorNotice({
      scan: {
        candidateProjectCount: 1,
      },
      candidateProjects: [
        {
          project: { id: "project-1" },
          candidateSummary: {
            directExecutorCandidateCount: 1,
            resumeCheckpointRequiredCount: 0,
            visualEvidenceRequiredCount: 0,
          },
        },
      ],
    })).toBeNull();
  });

  it("does not show the no-visual notice when a visual-marked candidate is present", () => {
    expect(getCandidateScanOperatorNotice({
      scan: {
        candidateProjectCount: 1,
      },
      candidateProjects: [
        {
          project: { id: "project-1" },
          candidateSummary: {
            directExecutorCandidateCount: 1,
            resumeCheckpointRequiredCount: 0,
            visualEvidenceRequiredCount: 1,
            visualEvidenceNotRequiredCount: 0,
            visualEvidenceUnknownCount: 0,
          },
        },
      ],
    })).toBeNull();
  });
});
