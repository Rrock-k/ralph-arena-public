export type AdminLabProjectActionGroup = "Find work" | "Plan and review" | "Run task" | "Visual evidence";

export type AdminLabProjectActionBrickStatus = {
  label: string;
  detail: string;
};

export type AdminLabProjectActionDefinition = {
  id: string;
  group: AdminLabProjectActionGroup;
  title: string;
  buttonLabel?: string;
  primaryVisibility?: "default" | "details";
  stageId: string | null;
  note: string;
  context: string;
  argument: string;
  output: string;
  brickStatus: AdminLabProjectActionBrickStatus;
  plannedReason?: string;
  promptReplayFixture?: "product_skill" | "ux_skill";
  commandInputValues?: Record<string, string>;
};

export type AdminLabProjectActionId = string;

export const ADMIN_LAB_PROJECT_ACTIONS: AdminLabProjectActionDefinition[] = [
  {
    id: "check_project_status",
    group: "Find work",
    title: "Check project status",
    buttonLabel: "Check project status",
    stageId: "project_operator_snapshot",
    note: "Read App, Agent, preview, blockers and runtime support for the selected project.",
    context: "Selected project status readback.",
    argument: "Selected project id only.",
    output: "Project status readback only; no retry, relaunch or repair.",
    brickStatus: {
      label: "Readback only",
      detail: "Current project status owner; not lifecycle mutation, scheduler truth or repair.",
    },
  },
  {
    id: "pause_agent",
    group: "Find work",
    title: "Pause agent",
    buttonLabel: "Pause agent",
    stageId: "project_agent_off",
    note: "Park loop work through the existing Agent OFF lifecycle owner while keeping App/preview intent unchanged.",
    context: "Selected project lifecycle tuple.",
    argument: "Selected project id only.",
    output: "Agent intent OFF result; no retry, relaunch, recreate runtime, task or proof write.",
    brickStatus: {
      label: "Lifecycle owner",
      detail: "Governance Agent OFF owner; not a Lab-only pause state, scheduler or retry path.",
    },
  },
  {
    id: "resume_agent",
    group: "Find work",
    title: "Resume agent",
    buttonLabel: "Resume agent",
    stageId: "project_agent_on",
    note: "Allow loop work again through the existing Agent ON lifecycle owner.",
    context: "Selected project lifecycle tuple and loop-support gate.",
    argument: "Selected project id only.",
    output: "Agent intent ON result; no relaunch, runtime recreate, task patch or proof write.",
    brickStatus: {
      label: "Lifecycle owner",
      detail: "Governance Agent ON owner; normal claim path resumes work, not a hidden relaunch.",
    },
  },
  {
    id: "find_work",
    group: "Find work",
    title: "Find work",
    buttonLabel: "Find work",
    stageId: "project_stage_candidates",
    note: "Find pending, failed or interrupted tasks in current projects.",
    context: "Current active project list through Arena readback.",
    argument: "Candidate limit, log tail and archived-project switch.",
    output: "Task candidates only; no task run.",
    brickStatus: {
      label: "Readback only",
      detail: "arena-ctl task readback; not scheduler, task selection or screenshot availability truth.",
    },
  },
  {
    id: "get_task_context",
    group: "Find work",
    title: "Get task context",
    buttonLabel: "Get task context",
    stageId: "project_stage_snapshot",
    note: "Read one project/task context before the next isolated action.",
    context: "Selected project state, source workspace and optional selected task.",
    argument: "Task id when the next action is task-scoped, plus optional log tail.",
    output: "Disposable task context and handoff values; no planner, executor or screenshot run.",
    brickStatus: {
      label: "Readback only",
      detail: "arena-ctl task-context readback; disposable context, not task or lifecycle truth.",
    },
  },
  {
    id: "apply_spec_diff",
    group: "Plan and review",
    title: "Apply spec diff",
    buttonLabel: "Apply spec diff",
    stageId: "planner_project_dry_run",
    note: "Run planner dry-run from fresh task context.",
    context: "Fresh task context plus a temp source fork.",
    argument: "Selected project visual evidence mode, log tail and explicit provider settings.",
    output: "Plan diff report, no plan apply.",
    brickStatus: {
      label: "Shared dry-run",
      detail: "Calls the real planner dry-run helper; Lab does not apply .ralph/plan.json.",
    },
  },
  {
    id: "materialize_spec_tasks",
    group: "Plan and review",
    title: "Apply spec diff to plan",
    buttonLabel: "Apply to plan",
    stageId: "planner_spec_migration_apply",
    note: "Materialize accepted spec changes into the existing Ralph plan.",
    context: "Fresh project task context and the selected live project workspace from that context.",
    argument: "Explicit provider settings and optional log tail.",
    output: "Updated .ralph plan/judgment/prompt-trace files and an apply report; no executor auto-start.",
    brickStatus: {
      label: "Shared apply",
      detail: "Calls the same planner spec migration owner used by real Ralph startup; Governance does not patch .ralph/plan.json.",
    },
  },
  {
    id: "product_pass",
    group: "Plan and review",
    title: "Inspect product pass",
    buttonLabel: "Inspect product pass",
    stageId: "prompt_contract_replay",
    note: "Preview the repository-owned product role guidance.",
    context: "Fixed repository-owned product prompt fixture.",
    argument: "The product_skill fixture only.",
    output: "Prompt replay only; no model call.",
    brickStatus: {
      label: "Migration debt",
      detail: "Prompt inspection until a standalone product judgment owner exists.",
    },
    promptReplayFixture: "product_skill",
  },
  {
    id: "ux_pass",
    group: "Plan and review",
    title: "Inspect UX pass",
    buttonLabel: "Inspect UX pass",
    stageId: "prompt_contract_replay",
    note: "Preview the repository-owned UX role guidance.",
    context: "Fixed repository-owned UX prompt fixture.",
    argument: "The ux_skill fixture only.",
    output: "Prompt replay only; no model call.",
    brickStatus: {
      label: "Migration debt",
      detail: "Prompt inspection until a standalone UX/visual-quality owner exists.",
    },
    promptReplayFixture: "ux_skill",
  },
  {
    id: "executor_task",
    group: "Run task",
    title: "Run executor on selected task",
    buttonLabel: "Run executor",
    stageId: "executor_project_task",
    note: "Run one chosen task in the explicit live project workspace.",
    context: "Selected live project workspace and visual policy from task context.",
    argument: "Task id, executor mode, completion promise and provider settings.",
    output: "Changed files, executor report and local project commit when accepted.",
    brickStatus: {
      label: "Shared + debt",
      detail: "Uses shared executor helpers and visual policy gating; production still owns task, lifecycle, deploy and push flow.",
    },
  },
  {
    id: "continue_executor_fork",
    group: "Run task",
    title: "Continue failed executor fork",
    buttonLabel: "Copy continuation handoff",
    stageId: "executor_task_workspace_continue",
    note: "Continue a prior failed manual executor run in the same dirty fork.",
    context: "Prior dirty fork from a failed manual executor report.",
    argument: "Copied CLI handoff values from that failed run.",
    output: "New continuation report; no live task write.",
    brickStatus: {
      label: "Manual handoff",
      detail: "Dirty-fork continuation; not production retry, resume or lifecycle truth.",
    },
  },
  {
    id: "controller_review",
    group: "Plan and review",
    title: "Run controller",
    buttonLabel: "Run controller",
    stageId: "controller_project_dry_run",
    note: "Review selected project state without applying controller truth.",
    context: "Fresh task context plus a temp source fork.",
    argument: "Trigger, selected project visual evidence mode, log tail and explicit provider settings.",
    output: "Controller dry-run report.",
    brickStatus: {
      label: "Shared dry-run",
      detail: "Calls the real controller dry-run helper; Lab does not apply controller truth.",
    },
  },
  {
    id: "check_visual_stories",
    group: "Visual evidence",
    title: "Check visual stories",
    buttonLabel: "Check visual stories",
    stageId: "visual_workbench_manifest_readiness",
    note: "Check whether source-owned Visual Workbench stories are structurally ready.",
    context: "Selected project source workspace and commit from task context.",
    argument: "Optional log lines only.",
    output: "Manifest readiness report; no screenshots or evidence.",
    brickStatus: {
      label: "Shared check",
      detail: "Ralph Workbench manifest owner; readiness only, not screenshot proof.",
    },
  },
  {
    id: "check_story_selection",
    group: "Visual evidence",
    title: "Check story selection",
    buttonLabel: "Check story selection",
    primaryVisibility: "details",
    stageId: "visual_workbench_selector_readiness",
    note: "Check whether the selected task has explicit story and viewport choices.",
    context: "Selected project source workspace and task from task context.",
    argument: "Selected task id and optional log lines.",
    output: "Selector readiness report; no screenshots or evidence.",
    brickStatus: {
      label: "Shared check",
      detail: "Ralph selector owner; checks explicit task/story mapping only.",
    },
  },
  {
    id: "check_capture_policy",
    group: "Visual evidence",
    title: "Check capture policy",
    buttonLabel: "Check capture policy",
    primaryVisibility: "details",
    stageId: "visual_workbench_shell_policy",
    note: "Check whether Ralph may start the source-owned Workbench command.",
    context: "Selected project source workspace, selected task and first-party Ralph config.",
    argument: "Selected task id and optional log lines.",
    output: "Shell policy report; no command execution, screenshots or evidence.",
    brickStatus: {
      label: "Shared check",
      detail: "Ralph shell-policy owner; gates later automation without running it.",
    },
  },
  {
    id: "check_browser",
    group: "Visual evidence",
    title: "Check browser",
    buttonLabel: "Check browser",
    primaryVisibility: "details",
    stageId: "visual_workbench_browser_readiness",
    note: "Check platform Chromium before screenshot capture.",
    context: "Platform Ralph runtime Playwright/Chromium environment.",
    argument: "No project or task inputs.",
    output: "Browser readiness report; no screenshots or evidence.",
    brickStatus: {
      label: "Platform check",
      detail: "Shared browser probe; owns platform readiness only, not project capture inputs.",
    },
  },
  {
    id: "make_screenshots",
    group: "Visual evidence",
    title: "Copy screenshot command",
    buttonLabel: "Copy screenshot command",
    primaryVisibility: "details",
    stageId: "visual_workbench_evidence_automation",
    note: "Prepare the explicit Workbench command that captures and publishes task-linked screenshots when run manually.",
    context: "Project source workspace with source-owned Workbench manifest, selected task, source commit, base URL and Ralph config.",
    argument: "Terminal command values for workspace, task, commit, base URL, output directory and config.",
    output: "CLI handoff only; screenshots are created only when the copied command is run manually.",
    brickStatus: {
      label: "Shared CLI handoff",
      detail: "Same automation helper as real Ralph; browser-run promotion remains audited debt.",
    },
  },
  {
    id: "run_screenshot_capture",
    group: "Visual evidence",
    title: "Run screenshot capture",
    buttonLabel: "Run screenshot capture",
    primaryVisibility: "details",
    stageId: "visual_workbench_evidence_automation_run",
    note: "Run the Workbench evidence automation owner once for the selected task after explicit confirmation.",
    context: "Selected project source workspace, selected task, source commit, server-allocated localhost base URL and Ralph config from fresh task context.",
    argument: "Selected task id, optional log lines and explicit operator confirmation only.",
    output: "Workbench automation report, capture output outside the workspace and task-linked visual evidence rows; no ingest or proof review.",
    brickStatus: {
      label: "Shared run",
      detail: "Calls the same Workbench automation helper as real Ralph; Governance derives inputs and does not own capture logic.",
    },
  },
  {
    id: "check_screenshot_run",
    group: "Visual evidence",
    title: "Check screenshot run",
    buttonLabel: "Check screenshot run",
    primaryVisibility: "details",
    stageId: "visual_workbench_automation_status",
    note: "Read the latest Workbench screenshot run diagnostic for the selected task.",
    context: "Selected project source workspace and task from task context.",
    argument: "Selected task id and optional log lines.",
    output: "Automation status report; no screenshot capture or evidence creation.",
    brickStatus: {
      label: "Readback only",
      detail: "Ralph diagnostic readback over a prior automation attempt.",
    },
  },
  {
    id: "check_evidence_chain",
    group: "Visual evidence",
    title: "Check evidence chain",
    buttonLabel: "Check evidence chain",
    primaryVisibility: "details",
    stageId: "visual_workbench_evidence_chain_readiness",
    note: "Check which explicit Workbench/Arena evidence handoff is ready or blocked.",
    context: "Selected project source workspace, task and Arena project id from task context.",
    argument: "Selected task id and optional log lines.",
    output: "Evidence-chain readiness and manual handoff commands only; no automatic next step.",
    brickStatus: {
      label: "Readback only",
      detail: "Ralph evidence-chain diagnostic; nextCommands stay manual handoffs.",
    },
  },
  {
    id: "ingest_evidence",
    group: "Visual evidence",
    title: "Ingest evidence",
    buttonLabel: "Copy ingest handoff",
    primaryVisibility: "details",
    stageId: "visual_evidence_ingest",
    note: "Copy the explicit Arena command that imports one Workbench evidence row.",
    context: "Arena project id plus one Workbench evidence ref, progress JSON and artifact file.",
    argument: "Terminal command values for project, task, evidence ref, progress JSON and artifact file.",
    output: "CLI handoff only; evidence is ingested only when the copied command is run manually.",
    brickStatus: {
      label: "Arena CLI handoff",
      detail: "Governance ingest owner; explicit mutation, not raw scan or proof shortcut.",
    },
  },
  {
    id: "screenshot_check",
    group: "Visual evidence",
    title: "Collect/check screenshots",
    buttonLabel: "Check screenshots",
    stageId: "proof_reviews",
    note: "Read existing Arena screenshot review status for this project.",
    context: "Arena screenshot review readback.",
    argument: "Selected project id only.",
    output: "Review links/readiness only; no screenshot capture or evidence creation.",
    brickStatus: {
      label: "Arena readback",
      detail: "Arena screenshot status owner; not a screenshot producer.",
    },
  },
  {
    id: "check_screenshot_files",
    group: "Visual evidence",
    title: "Check screenshot files",
    buttonLabel: "Check screenshot files",
    primaryVisibility: "details",
    stageId: "visual_evidence_artifact_check",
    note: "Check whether existing Arena screenshot review files are downloadable.",
    context: "Arena visual evidence review rows for the selected project.",
    argument: "Selected project id only.",
    output: "Artifact downloadability report; no raw storage paths or evidence creation.",
    brickStatus: {
      label: "Arena readback",
      detail: "Artifact downloadability only; no raw bytes, storage paths or evidence creation.",
    },
  },
];

const ADMIN_LAB_PROJECT_ACTION_BY_ID = new Map(
  ADMIN_LAB_PROJECT_ACTIONS.map((action) => [action.id, action]),
);

export function isAdminLabProjectActionId(value: unknown): value is AdminLabProjectActionId {
  return typeof value === "string" && ADMIN_LAB_PROJECT_ACTION_BY_ID.has(value);
}

export function getAdminLabProjectActionDefinition(
  actionId: string | null | undefined,
): AdminLabProjectActionDefinition | null {
  if (!actionId) return null;
  return ADMIN_LAB_PROJECT_ACTION_BY_ID.get(actionId) ?? null;
}
