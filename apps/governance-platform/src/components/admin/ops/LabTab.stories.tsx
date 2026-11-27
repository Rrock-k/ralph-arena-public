import { useEffect, useRef, type ReactNode } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs";
import { LabTab, type LabTabStoryFixture } from "./LabTab";
import type { OpsProject } from "./OpsDashboard";

type LabStageFixture = {
  id: string;
  label: string;
  status: "supported_now" | "target_shape";
  runSurface: "admin_lab_run" | "direct_cli" | "target_shape";
  mode: "read_only" | "fixture" | "workspace_dry_run" | "workspace_mutation" | "operator_mutation" | "target_shape";
  ownerBoundary: string;
  description: string;
  currentCommand: string | null;
  allowedMutations: string[];
  forbiddenMutations: string[];
  nextHandoff: string[];
};

function stage(
  id: string,
  label: string,
  runSurface: LabStageFixture["runSurface"],
  mode: LabStageFixture["mode"],
  ownerBoundary: string,
  currentCommand: string | null = null,
): LabStageFixture {
  return {
    id,
    label,
    status: "supported_now",
    runSurface,
    mode,
    ownerBoundary,
    description: `${label} Storybook fixture.`,
    currentCommand,
    allowedMutations: mode === "read_only" || mode === "fixture" || mode === "workspace_dry_run" ? [] : ["explicit stage output"],
    forbiddenMutations: ["lifecycle truth", "task truth", "proof truth", "hidden next stage"],
    nextHandoff: [],
  };
}

const LAB_STAGE_FIXTURES: LabStageFixture[] = [
  stage("project_operator_snapshot", "Project status", "admin_lab_run", "read_only", "ProjectOperatorSnapshot"),
  stage("project_agent_off", "Pause agent", "admin_lab_run", "operator_mutation", "governance.project-agent-intent"),
  stage("project_agent_on", "Resume agent", "admin_lab_run", "operator_mutation", "governance.project-agent-intent"),
  stage("project_stage_candidates", "Find work", "admin_lab_run", "read_only", "arena-ctl.project_stage_candidates"),
  stage("project_stage_snapshot", "Task context", "admin_lab_run", "read_only", "arena-ctl.project_stage_snapshot"),
  stage("planner_project_dry_run", "Planner dry-run", "admin_lab_run", "workspace_dry_run", "ralph.planner.initial-dry-run"),
  stage("prompt_contract_replay", "Prompt contract", "admin_lab_run", "fixture", "ralph.prompt-contract-replay"),
  stage("executor_project_task", "Executor on one task", "admin_lab_run", "workspace_mutation", "ralph.executor-project-task"),
  stage(
    "executor_task_workspace_continue",
    "Continue failed executor fork",
    "direct_cli",
    "workspace_mutation",
    "ralph.executor-workspace-continue",
    "ralph stage run executor_task_workspace_continue --fixture <failed-report.json>",
  ),
  stage("controller_project_dry_run", "Controller dry-run", "admin_lab_run", "workspace_dry_run", "ralph.controller.audit-dry-run"),
  stage("visual_workbench_manifest_readiness", "Workbench manifest", "admin_lab_run", "read_only", "ralph.visual-workbench-manifest-readiness"),
  stage("visual_workbench_selector_readiness", "Workbench selector", "admin_lab_run", "read_only", "ralph.visual-workbench-selector-readiness"),
  stage("visual_workbench_shell_policy", "Workbench capture policy", "admin_lab_run", "read_only", "ralph.visual-workbench-shell-policy"),
  stage("visual_workbench_browser_readiness", "Browser readiness", "admin_lab_run", "read_only", "ralph.platform-browser-readiness"),
  stage(
    "visual_workbench_evidence_automation",
    "Workbench evidence",
    "direct_cli",
    "workspace_mutation",
    "ralph.visual-workbench-evidence-automation",
    "ralph visual-workbench automate-evidence --task <task-id> --source-ref <git-commit> --base-url <http://127.0.0.1:port> --out-dir <out-dir>",
  ),
  stage("visual_workbench_automation_status", "Automation status", "admin_lab_run", "read_only", "ralph.visual-workbench-automation-status"),
  stage("visual_workbench_evidence_chain_readiness", "Evidence chain readiness", "admin_lab_run", "read_only", "ralph.visual-workbench-evidence-chain-readiness"),
  stage(
    "visual_evidence_ingest",
    "Screenshot ingest",
    "direct_cli",
    "operator_mutation",
    "arena.visual-evidence-ingest",
    "arena-ctl visual_evidence_ingest --project <project-id> --task <task-id> --evidence <evidence-ref>",
  ),
  stage("proof_reviews", "Screenshot status", "admin_lab_run", "read_only", "ArenaProjectInteractionSnapshot"),
  stage("visual_evidence_artifact_check", "Screenshot files", "admin_lab_run", "read_only", "ArenaVisualEvidenceArtifactCheck"),
];

const LAB_PROJECTS: OpsProject[] = [
  {
    id: "cmq8w34ki01n74no5zqgpjxaj",
    status: "running",
    slug: "stook",
    loopSupportStatus: "supported",
    loopSupportLabel: "Ralph current",
    loopSupportHint: "Storybook fixture for Lab UX.",
    visualEvidenceMode: "new_tasks_only",
    appStartAllowed: true,
    agentStartAllowed: true,
    relaunchAllowed: true,
    agent: "codex",
    agentImpl: "codex",
    model: "gpt-5.5",
    providerBillingMode: "subscription",
    runnerBackend: "local",
    createdAt: "2026-06-15T00:00:00.000Z",
    updatedAt: "2026-06-15T00:15:00.000Z",
    commitSha: "abc1234",
    requiredSecrets: [],
    secrets: [],
    runLogs: [],
    specs: [
      {
        id: "spec-visual-lab",
        title: "Visual Lab UX",
        content: "Dogfood the Admin Lab visual workflow.",
        orderIndex: 0,
      },
    ],
    assets: [],
    name: "STOOK",
    proposal: {
      id: "proposal-stook",
      title: "STOOK visual lab",
      description: "Manual stage lab dogfooding fixture.",
    },
  },
  {
    id: "cmq2fnpjc00wp4ns3uuhka6qm",
    status: "paused",
    slug: "mini-jam-synths-lab",
    loopSupportStatus: "supported",
    visualEvidenceMode: "required",
    appStartAllowed: true,
    agentStartAllowed: false,
    relaunchAllowed: true,
    agent: "codex",
    agentImpl: "codex",
    model: "gpt-5.5",
    providerBillingMode: "subscription",
    runnerBackend: "local",
    createdAt: "2026-06-14T00:00:00.000Z",
    updatedAt: "2026-06-14T00:25:00.000Z",
    requiredSecrets: [],
    secrets: [],
    runLogs: [],
    specs: [],
    assets: [],
    name: "Mini Jam Synths Lab",
  },
];

const STOOK_PROJECT_ID = "cmq8w34ki01n74no5zqgpjxaj";
const STOOK_TASK_ID = "TASK-REQ-STOOK-VISUAL-CATALOG";
const STOOK_SOURCE_REF = "6e32e0484088efaa17c1793d4b950dd942c64eed";
const STOOK_CAPTURE_VIEWER = "/private/tmp/ra356-stook-capture/index.html";
const STORY_EXECUTED_AT = "2026-06-15T01:00:00.000Z";

function stageById(stageId: string): LabStageFixture {
  const found = LAB_STAGE_FIXTURES.find((fixture) => fixture.id === stageId);
  if (!found) throw new Error(`Missing Lab stage fixture: ${stageId}`);
  return found;
}

function resultStoryFixture(
  stageId: string,
  selectedProjectActionId: string | null,
  result: unknown,
  selectedTaskId = "",
): LabTabStoryFixture {
  return {
    selectedDebugStageId: stageId,
    selectedProjectActionId,
    selectedTaskId,
    initialRunResult: {
      projectId: STOOK_PROJECT_ID,
      stage: stageById(stageId),
      result,
      evidenceNotes: ["Storybook result fixture only. It does not run Lab actions."],
      executedAt: STORY_EXECUTED_AT,
    },
  };
}

function snapshotSource(selectedTaskId = STOOK_TASK_ID) {
  return {
    projectId: STOOK_PROJECT_ID,
    selectedTaskId,
    source: {
      workspace: {
        commitSha: STOOK_SOURCE_REF,
        path: "/path/to/user/.arena-runtime/project-workspaces/stook-gpjxaj",
      },
    },
    plan: {
      selectedTask: {
        id: selectedTaskId,
        title: "Build source-owned visual story catalog",
      },
    },
  };
}

const MANIFEST_READY_RESULT = {
  snapshot: snapshotSource(),
  manifestReadiness: {
    status: "ready",
    canRunWorkbenchCapture: true,
    manifest: {
      summary: {
        storyCount: 6,
      },
      blockers: [],
    },
  },
};

const MANIFEST_BLOCKED_RESULT = {
  snapshot: snapshotSource(),
  manifestReadiness: {
    status: "blocked",
    canRunWorkbenchCapture: false,
    manifest: {
      summary: {
        storyCount: 0,
      },
      blockers: ["visual-workbench/manifest.json is missing"],
    },
  },
};

const SELECTOR_READY_RESULT = {
  snapshot: snapshotSource(),
  selectorReadiness: {
    status: "ready",
    input: {
      taskId: STOOK_TASK_ID,
    },
    summary: {
      readyTasks: 1,
      blockedTasks: 0,
      selectedViewports: 2,
    },
  },
};

const SELECTOR_BLOCKED_RESULT = {
  snapshot: snapshotSource(),
  selectorReadiness: {
    status: "blocked",
    input: {
      taskId: STOOK_TASK_ID,
    },
    summary: {
      readyTasks: 0,
      blockedTasks: 1,
      selectedViewports: 0,
    },
    blockers: ["Task has no explicit story selection"],
  },
};

const SUCCESS_CHECKPOINT_TASK_ID = "task-047";
const TASK_CONTEXT_SUCCESS_CHECKPOINT_RESULT = {
  schemaVersion: "ra-356.project-stage-snapshot.v1",
  ownerBoundary: "arena-ctl.project-stage-snapshot",
  selectedTaskId: SUCCESS_CHECKPOINT_TASK_ID,
  lifecycleContext: {
    classification: "paused_preview",
    tuple: {
      previewHealth: "HEALTHY",
    },
  },
  source: {
    workspace: {
      commitSha: "2c90380ef4f3a5f2fe5b1783624dee2630021d42",
      path: "/path/to/user/.arena-runtime/project-workspaces/stook-gpjxaj",
    },
  },
  plan: {
    taskCounts: {
      completed: 46,
      pending: 0,
      in_progress: 1,
      failed: 0,
      total: 47,
    },
    selectedTask: {
      id: SUCCESS_CHECKPOINT_TASK_ID,
      title: "Build mixer strip",
      status: "in_progress",
    },
    taskCandidates: [
      {
        id: SUCCESS_CHECKPOINT_TASK_ID,
        displayTitle: "Build mixer strip",
        status: "in_progress",
        recommendedExecutorMode: "resume_interrupted",
        attempts: 1,
        lastError: null,
        visualEvidenceRequired: true,
        feedbackItemRefCount: 2,
      },
    ],
  },
  providerSessions: {
    status: "ready",
    selectedTaskSessionCount: 1,
    selectedTaskResumableSessionCount: 0,
    selectedTaskCheckpointReadback: {
      selectedTaskId: SUCCESS_CHECKPOINT_TASK_ID,
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
    },
  },
  selectedTaskVisualReadback: {
    selectedTaskId: SUCCESS_CHECKPOINT_TASK_ID,
    selectedTaskStatus: "in_progress",
    visualEvidenceRequired: true,
    visualEvidenceMode: "new_tasks_only",
    visualEvidencePolicyStatus: "ready",
    visualWorkbenchManifestStatus: "ready",
    canRunWorkbenchCapture: true,
    visualExpectationSources: ["task.visualEvidenceRequired"],
    nextProjectActionId: "check_story_selection",
    status: "check_story_selection_ready",
    tone: "good",
    reasonCode: "check_story_selection_ready",
    title: "Story selection can be checked",
    message: "This only selects Check story selection for the same task. It does not capture screenshots or create evidence.",
    canCheckStorySelection: true,
  },
  nextHandoff: [
    "Snapshot found provider-session history, but no failed/error checkpoint for this interrupted task. A successful checkpoint is evidence, not resumable work. Select Resume agent to continue through the normal Ralph claim path.",
    "This only selects Check story selection for the same task. It does not capture screenshots or create evidence.",
  ],
};

const CANDIDATE_SCAN_VISUAL_READBACK_RESULT = {
  schemaVersion: "ra-356.project-stage-candidates.v1",
  ownerBoundary: "arena-ctl.project-stage-candidates",
  mode: "read_only",
  scan: {
    projectLimit: 25,
    includeArchived: false,
    eligibleProjectCount: 12,
    truncated: false,
    omittedProjectCount: 0,
    scannedProjectCount: 12,
    candidateProjectCount: 1,
    scanFailureCount: 0,
  },
  candidateProjects: [
    {
      project: {
        id: "cmq2fnpjc00wp4ns3uuhka6qm",
        name: "Mini Jam Synths Lab",
        runnerBackend: "local",
      },
      lifecycle: {
        classification: "healthy_agent_run",
        runtimeState: "RUNNING",
        agentState: "IDLE",
        previewHealth: "HEALTHY",
        lastOutcome: null,
      },
      visualEvidencePolicy: {
        owner: "governance.runner-init-readiness.ralphConfig",
        status: "ready",
        visualEvidenceMode: "required",
        blockers: [],
        notes: ["visualEvidenceMode=required"],
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
      candidateSummary: {
        directExecutorCandidateCount: 1,
        resumeCheckpointRequiredCount: 0,
        visualEvidenceRequiredCount: 1,
        visualEvidenceNotRequiredCount: 0,
        visualEvidenceUnknownCount: 0,
      },
      taskCandidates: [
        {
          id: "task-visual-001",
          displayTitle: "Add muted state to synth pad",
          status: "pending",
          recommendedExecutorMode: "new_task",
          attempts: 0,
          lastError: null,
          visualEvidenceRequired: true,
          feedbackItemRefCount: 1,
        },
      ],
    },
  ],
  scanFailures: [],
  evidenceNotes: [
    "Storybook fixture only. Visual policy/story-readiness readback is copied from Project Stage Snapshot owner reads.",
  ],
};

const CANDIDATE_SCAN_NO_VISUAL_MARKED_RESULT = {
  schemaVersion: "ra-356.project-stage-candidates.v1",
  ownerBoundary: "arena-ctl.project-stage-candidates",
  mode: "read_only",
  scan: {
    projectLimit: 25,
    includeArchived: false,
    eligibleProjectCount: 12,
    truncated: false,
    omittedProjectCount: 0,
    scannedProjectCount: 12,
    candidateProjectCount: 1,
    scanFailureCount: 0,
  },
  candidateProjects: [
    {
      project: {
        id: "cmq2fnpjc00wp4ns3uuhka6qm",
        name: "Mini Jam Synths Lab",
        runnerBackend: "local",
      },
      lifecycle: {
        classification: "healthy_agent_run",
        runtimeState: "RUNNING",
        agentState: "IDLE",
        previewHealth: "HEALTHY",
        lastOutcome: null,
      },
      visualEvidencePolicy: {
        owner: "governance.runner-init-readiness.ralphConfig",
        status: "ready",
        visualEvidenceMode: "required",
        blockers: [],
        notes: ["visualEvidenceMode=required"],
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
      candidateSummary: {
        directExecutorCandidateCount: 2,
        resumeCheckpointRequiredCount: 0,
        visualEvidenceRequiredCount: 0,
        visualEvidenceNotRequiredCount: 2,
        visualEvidenceUnknownCount: 0,
      },
      taskCandidates: [
        {
          id: "task-non-visual-001",
          displayTitle: "Tighten synth server retry logging",
          status: "pending",
          recommendedExecutorMode: "new_task",
          attempts: 0,
          lastError: null,
          visualEvidenceRequired: false,
          feedbackItemRefCount: 0,
        },
      ],
    },
  ],
  scanFailures: [],
  evidenceNotes: [
    "Storybook fixture only. No-visual notice is readback over task candidateSummary fields.",
  ],
};

const EVIDENCE_CHAIN_HANDOFF_RESULT = {
  snapshot: snapshotSource(),
  evidenceChainReadiness: {
    status: "ready_for_export",
    input: {
      taskId: STOOK_TASK_ID,
    },
    task: {
      taskId: STOOK_TASK_ID,
    },
    checks: [
      { id: "manifest", status: "ready" },
      { id: "selector", status: "ready" },
      { id: "browser", status: "ready" },
    ],
    nextCommands: [
      `ralph visual-workbench render-viewer --run /private/tmp/ra356-stook-capture/visual-workbench-capture-run.json --out ${STOOK_CAPTURE_VIEWER}`,
      "ralph visual-workbench export-evidence --task TASK-REQ-STOOK-VISUAL-CATALOG --run /private/tmp/ra356-stook-capture/visual-workbench-capture-run.json",
      `services/arena-ctl/cli.sh project_proof_reviews --project-id ${STOOK_PROJECT_ID}`,
    ],
    captureViewer: {
      viewerPath: STOOK_CAPTURE_VIEWER,
      exists: false,
      commandHint: `ralph visual-workbench render-viewer --run /private/tmp/ra356-stook-capture/visual-workbench-capture-run.json --out ${STOOK_CAPTURE_VIEWER}`,
    },
  },
};

const AUTOMATION_CATALOG_RESULT = {
  automationStatus: {
    status: "available",
    taskId: STOOK_TASK_ID,
    reportSource: "latest_diagnostic",
    blockers: [],
    sourceFreshness: {
      status: "current",
      reportSourceRef: STOOK_SOURCE_REF,
      resolvedReportSourceRef: STOOK_SOURCE_REF,
    },
    report: {
      status: "published",
      capture: {
        status: "captured",
        viewerPath: STOOK_CAPTURE_VIEWER,
        capturedStories: 3,
        capturedViewports: 6,
      },
    },
  },
};

const SCREENSHOT_READBACK_EMPTY_RESULT = {
  visualEvidenceReadiness: {
    status: "missing",
    reasonCode: "no_visual_evidence_reviews",
    message: "No screenshot reviews are recorded yet.",
    counts: {
      visualEvidenceReviewCount: 0,
      reviewableVisualEvidenceReviewCount: 0,
      unavailableVisualEvidenceArtifactCount: 0,
      proofReviewCount: 0,
    },
  },
  visualEvidenceReviews: [],
  proofReviews: [],
};

const SCREENSHOT_READBACK_AVAILABLE_RESULT = {
  visualEvidenceReadiness: {
    status: "available",
    reasonCode: null,
    message: "Arena has reviewable screenshot rows.",
    counts: {
      visualEvidenceReviewCount: 2,
      reviewableVisualEvidenceReviewCount: 2,
      unavailableVisualEvidenceArtifactCount: 0,
      proofReviewCount: 0,
    },
  },
  visualEvidenceReviews: [
    {
      id: "visual:6ee9b18ad1a12b92",
      taskId: STOOK_TASK_ID,
      taskLabel: "TASK-REQ-STOOK-VISUAL-CATALOG",
      status: "unassessed",
      summary: "Desktop proof for the synth control catalog.",
      target: {
        route: "/__visual/stook-shell.task-001",
        viewport: {
          width: 1280,
          height: 720,
        },
        claim: "The synth shell exposes the shared jam controls.",
        state: "desktop-ready",
      },
      action: {
        kind: "review_visual_evidence",
        label: "Check screenshots",
        href: `/my/projects/${STOOK_PROJECT_ID}/proofs/visual:6ee9b18ad1a12b92`,
      },
      artifact: {
        availability: "available",
        contentType: "image/png",
      },
    },
    {
      id: "visual:4f3cf1f0205e29a9",
      taskId: STOOK_TASK_ID,
      taskLabel: "TASK-REQ-STOOK-VISUAL-CATALOG",
      status: "unassessed",
      summary: "Mobile proof for the synth control catalog.",
      target: {
        route: "/__visual/stook-shell.task-001",
        viewport: {
          width: 390,
          height: 844,
        },
        claim: "The controls stay usable on a phone viewport.",
        state: "mobile-ready",
      },
      action: {
        kind: "review_visual_evidence",
        label: "Check screenshots",
        href: `/my/projects/${STOOK_PROJECT_ID}/proofs/visual:4f3cf1f0205e29a9`,
      },
      artifact: {
        availability: "available",
        contentType: "image/png",
      },
    },
  ],
  proofReviews: [],
};

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function LabStoryApiMock({ children }: { children: ReactNode }) {
  const originalFetchRef = useRef<typeof globalThis.fetch | null | undefined>(undefined);
  if (originalFetchRef.current === undefined) {
    originalFetchRef.current = globalThis.fetch?.bind(globalThis) ?? null;
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
      if (url.includes("/api/admin/lab/stages")) {
        return jsonResponse({
          stages: LAB_STAGE_FIXTURES,
          notes: ["Storybook fixture: source-owned Lab UX mock."],
        });
      }
      if (originalFetchRef.current) return originalFetchRef.current(input, init);
      throw new Error(`Unhandled Storybook fetch: ${url}`);
    };
  }

  useEffect(() => {
    return () => {
      if (originalFetchRef.current) globalThis.fetch = originalFetchRef.current;
      originalFetchRef.current = undefined;
    };
  }, []);

  return <>{children}</>;
}

const meta = {
  title: "Admin/Ops/Laboratory",
  component: LabTab,
  parameters: {
    layout: "fullscreen",
    backgrounds: { default: "arena" },
  },
  decorators: [
    (Story) => (
      <LabStoryApiMock>
        <div className="min-h-screen bg-gray-100 text-gray-900 dark:bg-slate-950 dark:text-slate-100">
          <Story />
        </div>
      </LabStoryApiMock>
    ),
  ],
  args: {
    projects: LAB_PROJECTS,
  },
} satisfies Meta<typeof LabTab>;

export default meta;
type Story = StoryObj<typeof meta>;

export const DefaultStatusAction: Story = {};

export const VisualEvidenceProject: Story = {
  args: {
    projects: LAB_PROJECTS.slice().reverse(),
  },
};

export const ManifestReadyResult: Story = {
  args: {
    storyFixture: resultStoryFixture("visual_workbench_manifest_readiness", "check_visual_stories", MANIFEST_READY_RESULT),
  },
};

export const ManifestBlockedResult: Story = {
  args: {
    storyFixture: resultStoryFixture("visual_workbench_manifest_readiness", "check_visual_stories", MANIFEST_BLOCKED_RESULT),
  },
};

export const SelectorReadyResult: Story = {
  args: {
    storyFixture: resultStoryFixture("visual_workbench_selector_readiness", "check_story_selection", SELECTOR_READY_RESULT, STOOK_TASK_ID),
  },
};

export const SelectorBlockedResult: Story = {
  args: {
    storyFixture: resultStoryFixture("visual_workbench_selector_readiness", "check_story_selection", SELECTOR_BLOCKED_RESULT, STOOK_TASK_ID),
  },
};

export const TaskContextSuccessCheckpointResult: Story = {
  args: {
    storyFixture: resultStoryFixture("project_stage_snapshot", "get_task_context", TASK_CONTEXT_SUCCESS_CHECKPOINT_RESULT, SUCCESS_CHECKPOINT_TASK_ID),
  },
};

export const CandidateScanVisualReadbackResult: Story = {
  args: {
    storyFixture: resultStoryFixture("project_stage_candidates", "find_work", CANDIDATE_SCAN_VISUAL_READBACK_RESULT, "task-visual-001"),
  },
};

export const CandidateScanNoVisualMarkedResult: Story = {
  args: {
    storyFixture: resultStoryFixture("project_stage_candidates", "find_work", CANDIDATE_SCAN_NO_VISUAL_MARKED_RESULT, "task-non-visual-001"),
  },
};

export const EvidenceChainHandoffResult: Story = {
  args: {
    storyFixture: resultStoryFixture("visual_workbench_evidence_chain_readiness", "check_evidence_chain", EVIDENCE_CHAIN_HANDOFF_RESULT, STOOK_TASK_ID),
  },
};

export const AutomationCatalogResult: Story = {
  args: {
    storyFixture: resultStoryFixture("visual_workbench_automation_status", "check_screenshot_run", AUTOMATION_CATALOG_RESULT, STOOK_TASK_ID),
  },
};

export const ScreenshotReadbackEmptyResult: Story = {
  args: {
    storyFixture: resultStoryFixture("proof_reviews", "screenshot_check", SCREENSHOT_READBACK_EMPTY_RESULT),
  },
};

export const ScreenshotReadbackAvailableResult: Story = {
  args: {
    storyFixture: resultStoryFixture("proof_reviews", "screenshot_check", SCREENSHOT_READBACK_AVAILABLE_RESULT),
  },
};
