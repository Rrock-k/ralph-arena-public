import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const labTabSource = readFileSync(fileURLToPath(new URL("./LabTab.tsx", import.meta.url)), "utf8");
const adminLabActionsSource = readFileSync(
  fileURLToPath(new URL("../../../lib/admin-lab-actions.ts", import.meta.url)),
  "utf8",
);
const labTabStorySource = readFileSync(fileURLToPath(new URL("./LabTab.stories.tsx", import.meta.url)), "utf8");
const labStorybookVerifierSource = readFileSync(
  fileURLToPath(new URL("../../../../scripts/verify-lab-storybook.mjs", import.meta.url)),
  "utf8",
);

function sourceBetween(start: string, end: string): string {
  const startIndex = labTabSource.indexOf(start);
  const endIndex = labTabSource.indexOf(end, startIndex);
  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);
  return labTabSource.slice(startIndex, endIndex);
}

describe("LabTab presentation copy", () => {
  it("keeps the Storybook Lab fixture source-only and non-executing", () => {
    expect(labTabStorySource).toContain('title: "Admin/Ops/Laboratory"');
    expect(labTabStorySource).toContain("LAB_STAGE_FIXTURES");
    expect(labTabStorySource).toContain("LAB_PROJECTS");
    expect(labTabStorySource).toContain("useRef");
    expect(labTabStorySource).toContain("originalFetchRef");
    expect(labTabStorySource).toContain("project_agent_off");
    expect(labTabStorySource).toContain("project_agent_on");
    expect(labTabStorySource).toContain("DefaultStatusAction");
    expect(labTabStorySource).toContain("VisualEvidenceProject");
    expect(labTabStorySource).toContain("ManifestReadyResult");
    expect(labTabStorySource).toContain("ManifestBlockedResult");
    expect(labTabStorySource).toContain("SelectorReadyResult");
    expect(labTabStorySource).toContain("SelectorBlockedResult");
    expect(labTabStorySource).toContain("TaskContextSuccessCheckpointResult");
    expect(labTabStorySource).toContain("CandidateScanVisualReadbackResult");
    expect(labTabStorySource).toContain("CandidateScanNoVisualMarkedResult");
    expect(labTabStorySource).toContain("EvidenceChainHandoffResult");
    expect(labTabStorySource).toContain("AutomationCatalogResult");
    expect(labTabStorySource).toContain("ScreenshotReadbackEmptyResult");
    expect(labTabStorySource).toContain("ScreenshotReadbackAvailableResult");
    expect(labTabStorySource).toContain('visualEvidenceMode: "new_tasks_only"');
    expect(labTabStorySource).toContain("/api/admin/lab/stages");
    expect(labTabStorySource).toContain("Storybook fixture: source-owned Lab UX mock.");
    expect(labTabStorySource).toContain("Storybook result fixture only. It does not run Lab actions.");
    expect(labTabStorySource).toContain("visualEvidenceReviews");
    expect(labTabStorySource).toContain("CANDIDATE_SCAN_VISUAL_READBACK_RESULT");
    expect(labTabStorySource).toContain("CANDIDATE_SCAN_NO_VISUAL_MARKED_RESULT");
    expect(labTabStorySource).toContain("TASK_CONTEXT_SUCCESS_CHECKPOINT_RESULT");
    expect(labTabStorySource).toContain("selectedTaskResumableSessionCount: 0");
    expect(labTabStorySource).toContain("selectedTaskCheckpointReadback");
    expect(labTabStorySource).toContain("selectedTaskVisualReadback");
    expect(labTabStorySource).toContain("success_checkpoint_not_resumable");
    expect(labTabStorySource).toContain("Select Resume agent to continue through the normal Ralph claim path.");
    expect(labTabStorySource).toContain("Story selection can be checked");
    expect(labTabStorySource).toContain("Visual policy/story-readiness readback");
    expect(labTabStorySource).toContain("No-visual notice is readback over task candidateSummary fields.");
    expect(labTabStorySource).toContain("captureViewer");
    expect(labTabStorySource).toContain("automationStatus");
    expect(labTabStorySource).toContain("No screenshot reviews are recorded yet.");
    expect(labTabStorySource).toContain("Check screenshots");
    expect(labTabStorySource).not.toContain("/api/admin/lab/run");
    expect(labTabStorySource).not.toContain("getMockRunResult");
    expect(labTabStorySource).not.toContain("rawArtifactPath");
    expect(labTabStorySource).not.toContain("storagePath");
    expect(labTabStorySource).not.toContain("storybook-static");
    expect(labStorybookVerifierSource).toContain("admin-ops-laboratory--task-context-success-checkpoint-result");
    expect(labStorybookVerifierSource).toContain("Use Resume agent, not checkpoint resume");
    expect(labStorybookVerifierSource).toContain("Select Resume agent");
    expect(labStorybookVerifierSource).toContain("Visual task readback");
    expect(labStorybookVerifierSource).toContain("Select Check stories");
    expect(labStorybookVerifierSource).toContain("0 resumable");
  });

  it("keeps Storybook result injection as an explicit fixture, not a second runner", () => {
    expect(labTabSource).toContain("export type LabTabStoryFixture");
    expect(labTabSource).toContain("storyFixture?: LabTabStoryFixture");
    expect(labTabSource).toContain("storyFixture?.initialRunResult");
    expect(labTabSource).toContain("selectedDebugStageId?: string");
    expect(labTabStorySource).toContain("selectedDebugStageId: stageId");
    expect(labTabSource).toContain('if (!storyFixture) return;');
    expect(labTabSource).not.toContain("runStoryFixture");
    expect(labTabSource).not.toContain("storyFixtureFetch");
  });

  it("shows structured errors when Lab APIs return HTML instead of JSON", () => {
    expect(labTabSource).toContain("async function readJsonResponse");
    expect(labTabSource).toContain("formatResponseSnippet");
    expect(labTabSource).toContain("formatLabActionError");
    expect(labTabSource).toContain("instead of JSON");
    expect(labTabSource).toContain("Lab API returned a server/session page instead of JSON");
    expect(labTabSource).toContain("/api/admin/lab/run");
    expect(labTabSource).toContain("reload or re-login if needed");
    expect(labTabSource).toContain("Governance admin API is not reachable from Admin Lab");
    expect(labTabSource).toContain("Check the governance server, session and admin URL/tunnel");
    expect(labTabSource).toContain('readJsonResponse<StageCatalogResponse>(response, "Lab catalog")');
    expect(labTabSource).toContain("readJsonResponse<LabRunResponse>(response, selectedProjectAction?.title ?? selectedStage.label)");
    expect(labTabSource).toContain("setRunResult({ ...payload, error: message })");
    expect(labTabSource).not.toContain("response.json()) as StageCatalogResponse");
    expect(labTabSource).not.toContain("response.json()) as LabRunResponse");
  });

  it("keeps the Lab Storybook render verifier temp-scoped and non-evidence-producing", () => {
    expect(labStorybookVerifierSource).toContain("ra-356.lab-storybook-render-smoke.v1");
    expect(labStorybookVerifierSource).toContain("STORYBOOK_DIR is required");
    expect(labStorybookVerifierSource).toContain("Build Storybook into /private/tmp");
    expect(labStorybookVerifierSource).toContain("LAB_STORIES");
    expect(labStorybookVerifierSource).toContain("admin-ops-laboratory--manifest-ready-result");
    expect(labStorybookVerifierSource).toContain("admin-ops-laboratory--candidate-scan-visual-readback-result");
    expect(labStorybookVerifierSource).toContain("admin-ops-laboratory--candidate-scan-no-visual-marked-result");
    expect(labStorybookVerifierSource).toContain("admin-ops-laboratory--screenshot-readback-available-result");
    expect(labStorybookVerifierSource).toContain("verifyStoryInteractions");
    expect(labStorybookVerifierSource).toContain("Pinned by selected action. Change the action, not this fixture.");
    expect(labStorybookVerifierSource).toContain("Fill capture policy");
    expect(labStorybookVerifierSource).toContain("Use ingest handoff");
    expect(labStorybookVerifierSource).toContain('absentExactTexts: ["Debug stage"]');
    expect(labStorybookVerifierSource).toContain("waitForVisibleText");
    expect(labStorybookVerifierSource).toContain("waitForVisibleExactText");
    expect(labStorybookVerifierSource).toContain("assertNoVisibleExactText");
    expect(labStorybookVerifierSource).toContain("It does not run /api/admin/lab/run, create evidence, ingest proof rows, scan raw artifacts or write storybook-static.");
    expect(labStorybookVerifierSource).not.toContain('"/api/admin/lab/run"');
    expect(labStorybookVerifierSource).not.toContain("rawArtifactPath");
    expect(labStorybookVerifierSource).not.toContain("storagePath");
  });

  it("keeps raw stage contract fields out of the primary stage card", () => {
    expect(labTabSource).not.toContain("Technical boundary");
    expect(labTabSource).not.toContain("Allowed mutations");
    expect(labTabSource).not.toContain("Forbidden mutations");
    expect(labTabSource).not.toContain("selectedStage.ownerBoundary");
  });

  it("does not render a standalone ordered workflow beside primary actions", () => {
    expect(labTabSource).not.toContain("Usual path");
    expect(labTabSource).not.toContain("LAB_WORKFLOW_STEPS");
    expect(labTabSource).not.toContain("visibleWorkflowSteps");
    expect(labTabSource).not.toContain("stage: workflowStage");
    expect(labTabSource).not.toContain("one step at a time");
    expect(labTabSource).not.toContain("Freeze input");
    expect(labTabSource).toContain("Project actions");
    expect(labTabSource).toContain("Selected action");
    expect(labTabSource).toContain("Visual Workbench handoff");
    expect(labTabSource).toContain("Manual evidence handoffs");
  });

  it("shows plain project actions before technical stage details", () => {
    expect(labTabSource).toContain("ADMIN_LAB_PROJECT_ACTIONS");
    expect(labTabSource).toContain("@/lib/admin-lab-actions");
    expect(labTabSource).toContain("Project state");
    expect(labTabSource).toContain("Choose the repository/project state first.");
    expect(labTabSource).toContain('useState("project_operator_snapshot")');
    expect(labTabSource).toContain('useState<string | null>("check_project_status")');
    expect(labTabSource).not.toContain('useState("project_stage_candidates")');
    expect(labTabSource).not.toContain('useState<string | null>("find_work")');
    expect(labTabSource).toContain("Pick one project, choose one action, inspect one result.");
    expect(labTabSource).toContain("one project -&gt; one action -&gt; one result");
    expect(labTabSource).not.toContain("{uiStages.length} run here / {cliStages.length} CLI / {targetStages.length} planned");
    expect(labTabSource).toContain("Project actions");
    expect(labTabSource).toContain("Start from the selected project state");
    expect(labTabSource).toContain("one action only");
    expect(labTabSource).toContain("projectActionGroups");
    expect(labTabSource).toContain("firstScreenProjectActions");
    expect(labTabSource).toContain("group.actions.map");
    expect(labTabSource).toContain("{group.label}");
    expect(adminLabActionsSource).toContain('group: "Find work"');
    expect(adminLabActionsSource).toContain('group: "Plan and review"');
    expect(adminLabActionsSource).toContain('group: "Run task"');
    expect(adminLabActionsSource).toContain('group: "Visual evidence"');
    expect(labTabSource).toContain("Checks in UI");
    expect(labTabSource).toContain("Runs in UI");
    expect(labTabSource).toContain("Copy CLI");
    expect(labTabSource).toContain("Copies a source-current command; run it manually in the operator shell.");
    expect(labTabSource).toContain("No automatic next step.");
    expect(labTabSource).toContain("outputLabel");
    expect(labTabSource).toContain("Handoff");
    expect(labTabSource).toContain("Selected action");
    expect(labTabSource).toContain("Debug stage");
    expect(labTabSource).toContain("selectedActionPanelLabel");
    expect(labTabSource).toContain("const invocationInput = selectedProjectAction");
    expect(labTabSource).toContain("actionId: selectedProjectAction.id");
    expect(labTabSource).toContain("stageId: selectedStage.id");
    expect(labTabSource).toContain("const [selectedDebugStageId, setSelectedDebugStageId]");
    expect(labTabSource).toContain("const selectedStage = selectedProjectAction ? selectedProjectAction.stage : selectedDebugStage");
    expect(labTabSource).not.toContain("setSelectedStageId");
    expect(labTabSource).toContain("Click does");
    expect(labTabSource).toContain("selectedActionClickDoes");
    expect(adminLabActionsSource).toContain("buttonLabel?: string");
    expect(labTabSource).toContain("function getPrimaryButtonLabel");
    expect(labTabSource).toContain("action?.buttonLabel");
    expect(labTabSource).toContain("primaryButtonLabel");
    expect(labTabSource).not.toContain("ACTION_BUTTON_LABELS");
    expect(labTabSource).not.toContain("buttonLabelsByAction");
    expect(adminLabActionsSource).toContain('primaryVisibility?: "default" | "details"');
    expect(adminLabActionsSource).toContain('primaryVisibility: "details"');
    expect(labTabSource).toContain("showVisualEvidenceDetails");
    expect(labTabSource).toContain("isProjectActionVisibleOnFirstScreen");
    expect(labTabSource).toContain("visualEvidenceDetailActionCount");
    expect(labTabSource).toContain("hiddenVisualEvidenceActionCount");
    expect(labTabSource).toContain("More visual actions");
    expect(labTabSource).toContain("Fewer");
    expect(labTabSource).not.toContain("VISUAL_ACTIONS");
    expect(labTabSource).not.toContain("visualActionCatalog");
    expect(labTabSource).toContain('Uses raw debug stage "${stage.id}"');
    expect(labTabSource).toContain('Copies "${action.title}" as an explicit terminal handoff.');
    expect(labTabSource).toContain('Runs "${action.title}" once for the selected project and stops.');
    expect(labTabSource).toContain('Checks "${action.title}" once for the selected project and stops.');
    expect(labTabSource).toContain("Brick status");
    expect(labTabSource).toContain("selectedActionBrickStatus");
    expect(adminLabActionsSource).toContain("Readback only");
    expect(adminLabActionsSource).toContain("Migration debt");
    expect(adminLabActionsSource).toContain("Shared + debt");
    expect(adminLabActionsSource).toContain("Shared CLI handoff");
    expect(adminLabActionsSource).toContain("Arena readback");
    expect(adminLabActionsSource).toContain("browser-run promotion remains audited debt");
    expect(labTabSource).toContain("Raw stage selection; normal work should start from Project actions.");
    expect(labTabSource).toContain("Uses");
    expect(labTabSource).toContain("You provide");
    expect(labTabSource).toContain("You get");
    expect(labTabSource).toContain("Stops after");
    expect(labTabSource).toContain("selectedActionContext");
    expect(labTabSource).toContain("selectedActionArgument");
    expect(labTabSource).toContain("Action readiness");
    expect(labTabSource).toContain("Action contract details");
    expect(labTabSource).toContain("Audit notes");
    expect(labTabSource).toContain("Ready to check");
    expect(labTabSource).toContain("Ready to run");
    expect(labTabSource).toContain("Ready to copy");
    expect(labTabSource).toContain("Template ready");
    expect(labTabSource).toContain("Needs input");
    expect(labTabSource).toContain("All required inputs for this one action are filled.");
    expect(labTabSource).toContain("Fill only the fields below. Nothing starts automatically.");
    expect(labTabSource).toContain('selectedActionReadiness.needsLabel ?? "Needs"');
    expect(labTabSource).toContain("Terminal values");
    expect(labTabSource).toContain("renderTerminalCommandPanel");
    expect(labTabSource).toContain("Terminal handoff");
    expect(labTabSource).toContain("Fill terminal values here or copy the template. This browser button does not execute CLI stages.");
    expect(labTabSource).toContain('selectedStage?.runSurface === "direct_cli" && renderTerminalCommandPanel("primary")');
    expect(labTabSource).toContain('selectedStage.runSurface !== "direct_cli" && renderTerminalCommandPanel("advanced")');
    expect(labTabSource).toContain("commandInputPlaceholdersWithSnapshotHints");
    expect(labTabSource).toContain("Current task context can fill");
    expect(labTabSource).toContain("Use context values");
    expect(labTabSource).toContain("handleApplySnapshotCommandHints");
    expect(labTabSource).toContain("Debug: stage catalog");
    expect(labTabSource).toContain("Normal work starts from Project actions above.");
    expect(labTabSource).toContain("Open this only to inspect raw stage ids");
    expect(labTabSource).toContain("Raw stage");
    expect(adminLabActionsSource).toContain("Apply spec diff");
    expect(adminLabActionsSource).toContain('id: "check_project_status"');
    expect(adminLabActionsSource).toContain("Check project status");
    expect(adminLabActionsSource).toContain('buttonLabel: "Check project status"');
    expect(adminLabActionsSource).toContain("Read App, Agent, preview, blockers and runtime support for the selected project.");
    expect(adminLabActionsSource).toContain("Selected project status readback.");
    expect(adminLabActionsSource).toContain("Project status readback only; no retry, relaunch or repair.");
    expect(adminLabActionsSource).toContain("Current project status owner; not lifecycle mutation, scheduler truth or repair.");
    expect(adminLabActionsSource).toContain('id: "pause_agent"');
    expect(adminLabActionsSource).toContain("Pause agent");
    expect(adminLabActionsSource).toContain('stageId: "project_agent_off"');
    expect(adminLabActionsSource).toContain("Park loop work through the existing Agent OFF lifecycle owner while keeping App/preview intent unchanged.");
    expect(adminLabActionsSource).toContain("Agent intent OFF result; no retry, relaunch, recreate runtime, task or proof write.");
    expect(adminLabActionsSource).toContain("Governance Agent OFF owner; not a Lab-only pause state, scheduler or retry path.");
    expect(adminLabActionsSource).toContain('id: "resume_agent"');
    expect(adminLabActionsSource).toContain("Resume agent");
    expect(adminLabActionsSource).toContain('stageId: "project_agent_on"');
    expect(adminLabActionsSource).toContain("Allow loop work again through the existing Agent ON lifecycle owner.");
    expect(adminLabActionsSource).toContain("Agent intent ON result; no relaunch, runtime recreate, task patch or proof write.");
    expect(adminLabActionsSource).toContain("Governance Agent ON owner; normal claim path resumes work, not a hidden relaunch.");
    expect(labTabSource).toContain('project_agent_off: {');
    expect(labTabSource).toContain("Stops loop work for this project while keeping App/preview intent unchanged.");
    expect(labTabSource).toContain("Agent intent was set to OFF through the lifecycle owner.");
    expect(labTabSource).toContain('project_agent_on: {');
    expect(labTabSource).toContain("Allows loop work again through the existing Agent lifecycle owner.");
    expect(labTabSource).toContain("Agent intent was set to ON through the lifecycle owner.");
    expect(adminLabActionsSource).toContain('id: "find_work"');
    expect(adminLabActionsSource).toContain('buttonLabel: "Find work"');
    expect(adminLabActionsSource).toContain("Find pending, failed or interrupted tasks in current projects.");
    expect(adminLabActionsSource).toContain("Current active project list through Arena readback.");
    expect(adminLabActionsSource).toContain("Candidate limit, log tail and archived-project switch.");
    expect(adminLabActionsSource).toContain("Task candidates only; no task run.");
    expect(adminLabActionsSource).toContain('id: "get_task_context"');
    expect(adminLabActionsSource).toContain("Get task context");
    expect(adminLabActionsSource).toContain("Read one project/task context before the next isolated action.");
    expect(adminLabActionsSource).toContain("Selected project state, source workspace and optional selected task.");
    expect(adminLabActionsSource).toContain("Task id when the next action is task-scoped, plus optional log tail.");
    expect(adminLabActionsSource).toContain("Disposable task context and handoff values; no planner, executor or screenshot run.");
    expect(adminLabActionsSource).toContain("arena-ctl task-context readback; disposable context, not task or lifecycle truth.");
    expect(adminLabActionsSource).toContain("Inspect product pass");
    expect(adminLabActionsSource).toContain("Inspect UX pass");
    expect(adminLabActionsSource).toContain("Run executor on selected task");
    expect(adminLabActionsSource).toContain('buttonLabel: "Run executor"');
    expect(adminLabActionsSource).toContain("Run one chosen task in the explicit live project workspace.");
    expect(adminLabActionsSource).toContain("Selected live project workspace and visual policy from task context.");
    expect(adminLabActionsSource).toContain("Task id, executor mode, completion promise and provider settings.");
    expect(adminLabActionsSource).toContain("Changed files, executor report and local project commit when accepted.");
    expect(adminLabActionsSource).toContain("Uses shared executor helpers and visual policy gating");
    expect(adminLabActionsSource).toContain("Continue failed executor fork");
    expect(adminLabActionsSource).toContain("New continuation report; no live task write.");
    expect(adminLabActionsSource).toContain("Run controller");
    expect(adminLabActionsSource).toContain('id: "check_visual_stories"');
    expect(adminLabActionsSource).toContain("Check visual stories");
    expect(adminLabActionsSource).toContain("Check whether source-owned Visual Workbench stories are structurally ready.");
    expect(adminLabActionsSource).toContain("Selected project source workspace and commit from task context.");
    expect(adminLabActionsSource).toContain("Optional log lines only.");
    expect(adminLabActionsSource).toContain("Manifest readiness report; no screenshots or evidence.");
    expect(adminLabActionsSource).toContain('id: "check_story_selection"');
    expect(adminLabActionsSource).toContain("Check story selection");
    expect(adminLabActionsSource).toContain("Check whether the selected task has explicit story and viewport choices.");
    expect(adminLabActionsSource).toContain("Selected project source workspace and task from task context.");
    expect(adminLabActionsSource).toContain("Selected task id and optional log lines.");
    expect(adminLabActionsSource).toContain("Selector readiness report; no screenshots or evidence.");
    expect(adminLabActionsSource).toContain('id: "check_capture_policy"');
    expect(adminLabActionsSource).toContain("Check capture policy");
    expect(adminLabActionsSource).toContain('stageId: "visual_workbench_shell_policy"');
    expect(labTabSource).toContain('title: "Workbench capture policy"');
    expect(adminLabActionsSource).toContain("Check whether Ralph may start the source-owned Workbench command.");
    expect(adminLabActionsSource).toContain("Selected project source workspace, selected task and first-party Ralph config.");
    expect(adminLabActionsSource).toContain("Shell policy report; no command execution, screenshots or evidence.");
    expect(adminLabActionsSource).toContain('id: "check_browser"');
    expect(adminLabActionsSource).toContain("Check browser");
    expect(adminLabActionsSource).toContain("Check platform Chromium before screenshot capture.");
    expect(adminLabActionsSource).toContain("Platform Ralph runtime Playwright/Chromium environment.");
    expect(adminLabActionsSource).toContain("No project or task inputs.");
    expect(adminLabActionsSource).toContain("Browser readiness report; no screenshots or evidence.");
    expect(adminLabActionsSource).toContain('id: "make_screenshots"');
    expect(adminLabActionsSource).toContain("Copy screenshot command");
    expect(adminLabActionsSource).toContain('buttonLabel: "Copy screenshot command"');
    expect(adminLabActionsSource).toContain("Prepare the explicit Workbench command that captures and publishes task-linked screenshots when run manually.");
    expect(adminLabActionsSource).toContain("Project source workspace with source-owned Workbench manifest, selected task, source commit, base URL and Ralph config.");
    expect(adminLabActionsSource).toContain("Terminal command values for workspace, task, commit, base URL, output directory and config.");
    expect(adminLabActionsSource).toContain("CLI handoff only; screenshots are created only when the copied command is run manually.");
    expect(adminLabActionsSource).toContain('id: "run_screenshot_capture"');
    expect(adminLabActionsSource).toContain("Run screenshot capture");
    expect(adminLabActionsSource).toContain('stageId: "visual_workbench_evidence_automation_run"');
    expect(adminLabActionsSource).toContain("Run the Workbench evidence automation owner once for the selected task after explicit confirmation.");
    expect(adminLabActionsSource).toContain("Selected task id, optional log lines and explicit operator confirmation only.");
    expect(adminLabActionsSource).toContain("Workbench automation report, capture output outside the workspace and task-linked visual evidence rows; no ingest or proof review.");
    expect(adminLabActionsSource).toContain("Calls the same Workbench automation helper as real Ralph; Governance derives inputs and does not own capture logic.");
    expect(adminLabActionsSource).toContain('id: "check_screenshot_run"');
    expect(adminLabActionsSource).toContain("Check screenshot run");
    expect(adminLabActionsSource).toContain("Read the latest Workbench screenshot run diagnostic for the selected task.");
    expect(adminLabActionsSource).toContain("Selected project source workspace and task from task context.");
    expect(adminLabActionsSource).toContain("Automation status report; no screenshot capture or evidence creation.");
    expect(adminLabActionsSource).toContain('id: "check_evidence_chain"');
    expect(adminLabActionsSource).toContain("Check evidence chain");
    expect(adminLabActionsSource).toContain("Check which explicit Workbench/Arena evidence handoff is ready or blocked.");
    expect(adminLabActionsSource).toContain("Selected project source workspace, task and Arena project id from task context.");
    expect(adminLabActionsSource).toContain("Evidence-chain readiness and manual handoff commands only; no automatic next step.");
    expect(adminLabActionsSource).toContain('id: "ingest_evidence"');
    expect(adminLabActionsSource).toContain('buttonLabel: "Copy ingest handoff"');
    expect(adminLabActionsSource).toContain("Copy the explicit Arena command that imports one Workbench evidence row.");
    expect(adminLabActionsSource).toContain("Arena project id plus one Workbench evidence ref, progress JSON and artifact file.");
    expect(adminLabActionsSource).toContain("Terminal command values for project, task, evidence ref, progress JSON and artifact file.");
    expect(adminLabActionsSource).toContain("CLI handoff only; evidence is ingested only when the copied command is run manually.");
    expect(adminLabActionsSource).toContain("Collect/check screenshots");
    expect(adminLabActionsSource).toContain("Read existing Arena screenshot review status for this project.");
    expect(adminLabActionsSource).toContain("Arena screenshot review readback.");
    expect(adminLabActionsSource).toContain("Selected project id only.");
    expect(adminLabActionsSource).toContain("Review links/readiness only; no screenshot capture or evidence creation.");
    expect(adminLabActionsSource).toContain('id: "check_screenshot_files"');
    expect(adminLabActionsSource).toContain("Check whether existing Arena screenshot review files are downloadable.");
    expect(adminLabActionsSource).toContain("Arena visual evidence review rows for the selected project.");
    expect(adminLabActionsSource).toContain("Artifact downloadability report; no raw storage paths or evidence creation.");
    expect(labTabSource).toContain("It will not capture screenshots, create evidence, scan raw folders or send Telegram messages.");
    expect(labTabSource).toContain("promptReplayFixture");
    expect(labTabSource).toContain("selectedPromptReplayFixture");
    expect(labTabSource).toContain("promptReplayFixturePinnedByAction");
    expect(labTabSource).toContain("formatPromptReplayFixtureLabel");
    expect(labTabSource).toContain("Pinned by selected action. Change the action, not this fixture.");
    expect(labTabSource).toContain("promptReplayFixture: selectedPromptReplayFixture");
    expect(adminLabActionsSource).toContain('promptReplayFixture: "product_skill"');
    expect(adminLabActionsSource).toContain('promptReplayFixture: "ux_skill"');
    expect(labTabSource).toContain("Prompt fixture");
    expect(labTabSource).toContain("Product role guidance");
    expect(labTabSource).toContain("UX role guidance");
    expect(labTabSource).toContain("Fixed Prompt Lab replay only.");
    expect(labTabSource).toContain("Prompt replay finished.");
    expect(labTabSource).toContain("UI ready: wraps Prompt Lab replay for one fixed product or UX role-skill fixture.");
    expect(labTabSource).toContain("promptReplay");
    expect(labTabSource).toContain("Rendered text");
    expect(labTabSource).toContain("Hash");
    expect(labTabSource).toContain("plannerVisualEvidenceMode");
    expect(labTabSource).toContain("Planner dry-run finished.");
    expect(labTabSource).toContain("UI ready: runs one planner pass from fresh task context and a temp fork.");
    expect(labTabSource).toContain("visualEvidenceMode: plannerVisualEvidenceMode");
    expect(labTabSource).toContain("Planner apply finished.");
    expect(labTabSource).toContain("UI ready: materializes accepted spec changes into the existing Ralph plan.");
    expect(labTabSource).toContain("Planner apply status");
    expect(labTabSource).toContain("Spec migrations");
    expect(labTabSource).toContain("Allowed .ralph files");
    expect(labTabSource).toContain("Plan tasks were materialized");
    expect(labTabSource).toContain("No new plan tasks");
    expect(labTabSource).toContain("Planner apply needs attention");
    expect(labTabSource).toContain("This only selects the next action; it does not run Find work or executor automatically.");
    expect(labTabSource).toContain("This is a manual bridge to the next shared Ralph brick.");
    expect(labTabSource).toContain("handleUsePlannerApplyFindWorkHandoff");
    expect(labTabSource).toContain("handleUsePlannerApplyTaskContextHandoff");
    expect(labTabSource).toContain("useState<OpsVisualEvidenceMode>(\"off\")");
    expect(labTabSource).toContain("selectedProjectVisualEvidenceMode");
    expect(adminLabActionsSource).toContain("Selected project visual evidence mode, log tail and explicit provider settings.");
    expect(adminLabActionsSource).toContain("Trigger, selected project visual evidence mode, log tail and explicit provider settings.");
    expect(labTabSource).toContain("Screenshots are not required by project policy.");
    expect(labTabSource).toContain("Only newly planned frontend tasks get the visual evidence flag.");
    expect(labTabSource).toContain("Planner and controller dry-runs start from this visible project policy");
    expect(labTabSource).toContain("Defaults to the selected project&apos;s visible policy.");
    expect(labTabSource).toContain("isProjectVisualEvidenceModeUnavailable");
    expect(labTabSource).toContain("project visual evidence mode");
    expect(labTabSource).toContain("Project visual evidence policy must be readable before this dry-run.");
    expect(labTabSource).toContain("selectedProjectVisualEvidenceModeError");
    expect(labTabSource).toContain("Project policy readback is invalid:");
    expect(labTabSource).toContain("Workbench manifest readiness finished.");
    expect(labTabSource).toContain("UI ready: checks whether source-owned stories exist for the selected project source.");
    expect(labTabSource).toContain("If ready, check selector, capture policy and browser readiness before manual screenshot handoff.");
    expect(labTabSource).toContain('selectedStage?.id === "visual_workbench_manifest_readiness"');
    expect(labTabSource).toContain("manifestReadiness");
    expect(labTabSource).toContain("Manifest status");
    expect(labTabSource).toContain("Task context source only.");
    expect(labTabSource).toContain("Workbench selector readiness finished.");
    expect(labTabSource).toContain("UI ready: checks which story/viewports are explicitly linked to one selected task.");
    expect(labTabSource).toContain("Fix task/story links if blocked, or continue to capture policy before browser readiness and evidence automation.");
    expect(labTabSource).toContain('selectedStage.id === "visual_workbench_selector_readiness"');
    expect(labTabSource).toContain("selectorReadiness");
    expect(labTabSource).toContain("Selector status");
    expect(labTabSource).toContain("Workbench capture policy finished.");
    expect(labTabSource).toContain("UI ready: checks whether Ralph may start the source-owned Workbench command.");
    expect(labTabSource).toContain('selectedStage?.id === "visual_workbench_shell_policy"');
    expect(labTabSource).toContain("isShellPolicyStage");
    expect(labTabSource).toContain("isShellPolicyTaskIdInvalid");
    expect(labTabSource).toContain('selectedStage.id === "visual_workbench_shell_policy"');
    expect(labTabSource).toContain("visual_workbench_shell_policy\" || selectedStage?.id === \"visual_workbench_automation_status");
    expect(labTabSource).toContain("Browser readiness finished.");
    expect(labTabSource).toContain("UI ready: checks platform Chromium readiness before screenshot capture.");
    expect(labTabSource).toContain('"visual_workbench_browser_readiness"');
    expect(labTabSource).toContain("browserReadiness");
    expect(labTabSource).toContain("Browser status");
    expect(labTabSource).toContain("Automation status readback finished.");
    expect(labTabSource).toContain("UI ready: reads the latest Workbench automation diagnostic for one selected task.");
    expect(labTabSource).toContain('"visual_workbench_automation_status"');
    expect(labTabSource).toContain("automationStatus");
    expect(labTabSource).toContain("Automation status");
    expect(labTabSource).toContain("Controller dry-run finished.");
    expect(labTabSource).toContain("UI ready: runs one controller review from fresh task context and a temp fork.");
    expect(labTabSource).toContain('selectedStage?.id === "controller_project_dry_run"');
    expect(labTabSource).toContain("controllerTrigger");
    expect(labTabSource).toContain("Controller run status");
    expect(labTabSource).toContain("controllerResult");
    expect(labTabSource).toContain("Evidence chain readiness finished.");
    expect(labTabSource).toContain("UI ready: checks which explicit Workbench/Arena evidence boundary is ready or blocked for one selected task.");
    expect(labTabSource).toContain('"visual_workbench_evidence_chain_readiness"');
    expect(labTabSource).toContain("evidenceChainReadiness");
    expect(labTabSource).toContain("Chain status");
    expect(labTabSource).toContain("Manual evidence handoffs");
    expect(labTabSource).toContain("Copy one command, then run it manually from the operator shell.");
    expect(labTabSource).toContain("These commands come from Ralph evidence-chain readiness.");
    expect(labTabSource).toContain("The Lab does not run the next stage, create screenshots or infer Telegram availability.");
    expect(labTabSource).toContain("handleCopyEvidenceChainCommand");
    expect(labTabSource).toContain("Manual handoff command copied");
    expect(labTabSource).toContain("Nothing starts automatically from this result");
    expect(labTabSource).toContain("capture, export, assessment, progress publish and Arena readback stay separate explicit actions.");
    expect(adminLabActionsSource).toContain("Prompt replay only; no model call.");
    expect(labTabSource).toContain("selectedProjectActionId");
    expect(labTabSource).toContain("Project provider settings");
    expect(labTabSource).toContain("Use project settings");
    expect(labTabSource).toContain("Selected project has no Lab-compatible agent and model to copy.");
    expect(labTabSource).toContain("normalizeLabExecutorAgent");
    expect(labTabSource).toContain("handleUseProjectProviderSettings");
    expect(labTabSource).toContain("setExecutorAgent(selectedProjectLabAgent)");
    expect(labTabSource).toContain("setExecutorModel(selectedProjectModel)");
    expect(labTabSource).toContain('setExecutorModel("");');
    expect(labTabSource.indexOf("Project state")).toBeLessThan(labTabSource.indexOf("Project actions"));
    expect(labTabSource.indexOf("Project actions")).toBeLessThan(labTabSource.indexOf("Selected action"));
    expect(labTabSource.indexOf("Project actions")).toBeLessThan(labTabSource.indexOf("Debug: stage catalog"));
    expect(labTabSource.indexOf("Action readiness")).toBeLessThan(labTabSource.indexOf("Action contract details"));
    expect(labTabSource.indexOf("Action contract details")).toBeLessThan(labTabSource.indexOf("Brick status"));
  });

  it("labels mutating results as runs instead of checks", () => {
    expect(labTabSource).toContain("function getRunResultHeading");
    expect(labTabSource).toContain("function getRunResultOriginLabel");
    expect(labTabSource).toContain("matchingActions.length === 1");
    expect(labTabSource).toContain("matchingActions.length === 0");
    expect(labTabSource).toContain('stageId === "prompt_contract_replay"');
    expect(labTabSource).toContain('const fixtureId = readString(fixture?.id)');
    expect(labTabSource).toContain("matchingActions.find((action) => action.promptReplayFixture === fixtureId)");
    expect(labTabSource).toContain("Result for ${matchingActions[0].title}");
    expect(labTabSource).toContain("Debug stage result: ${getStageCopy(runResult.stage).title}");
    expect(labTabSource).toContain("{resultOriginLabel}");
    expect(labTabSource).toContain('stage?.mode === "workspace_mutation" || stage?.mode === "operator_mutation"');
    expect(labTabSource).toContain('isMutatingLabStage(runResult.stage) ? "Run failed" : "Check failed"');
    expect(labTabSource).toContain('isMutatingLabStage(runResult.stage) ? "Run finished" : "Check finished"');
    expect(labTabSource).toContain("{getRunResultHeading(runResult)}");
    expect(labTabSource).not.toContain('runResult.error ? "Check failed" : "Check finished"');
  });

  it("summarizes project status only from ProjectOperatorSnapshot results", () => {
    const statusStart = labTabSource.indexOf('runResult.stage?.id === "project_operator_snapshot"');
    const statusEnd = labTabSource.indexOf('runResult.stage?.id === "project_stage_candidates"', statusStart);
    const statusSource = labTabSource.slice(statusStart, statusEnd);

    expect(statusSource).toContain('readRecordField(result, "app")');
    expect(statusSource).toContain('readArray(app?.blockers)');
    expect(statusSource).toContain('readString(result.loopSupportStatus)');
    expect(statusSource).toContain('label: "App"');
    expect(statusSource).toContain('label: "Agent"');
    expect(statusSource).toContain('label: "Preview"');
    expect(statusSource).toContain('label: "Blockers"');
    expect(statusSource).toContain('label: "Loop support"');
    expect(statusSource).not.toContain("selectedProject");
    expect(statusSource).not.toContain("fetch(");
    expect(statusSource).not.toContain("setRunResult");
  });

  it("keeps executor run inputs visible as explicit operator choices", () => {
    expect(labTabSource).toContain('selectedStage?.id === "executor_project_task"');
    expect(labTabSource).toContain("Task id");
    expect(labTabSource).toContain("Mode");
    expect(labTabSource).toContain("Timeout");
    expect(labTabSource).toContain("Agent");
    expect(labTabSource).toContain("Model");
    expect(labTabSource).toContain("Completion promise");
    expect(labTabSource).toContain("executorMode");
    expect(labTabSource).toContain("executorCompletionPromise");
    expect(labTabSource).toContain("executorModel");
    expect(labTabSource).toContain("Run now");
  });

  it("keeps Find work scan inputs visible as primary operator choices", () => {
    const selectedActionStart = labTabSource.indexOf('selectedStage?.runSurface === "direct_cli" && renderTerminalCommandPanel("primary")');
    const primarySnapshotInputStart = labTabSource.indexOf('selectedStage?.id === "project_stage_snapshot"', selectedActionStart);
    const primaryFindWorkInputSource = labTabSource.slice(selectedActionStart, primarySnapshotInputStart);
    const debugStart = labTabSource.indexOf("Debug: stage catalog");
    const debugSource = labTabSource.slice(debugStart);

    expect(primaryFindWorkInputSource).toContain('selectedStage?.id === "project_stage_candidates"');
    expect(primaryFindWorkInputSource).toContain("Limit");
    expect(primaryFindWorkInputSource).toContain("Log tail");
    expect(primaryFindWorkInputSource).toContain("Include archived projects");
    expect(primaryFindWorkInputSource).toContain("Candidate scan reads current task candidates only.");
    expect(primaryFindWorkInputSource).toContain("It does not select, run or repair work.");
    expect(debugSource).not.toContain('selectedStage.id === "project_stage_candidates"');
  });

  it("keeps planner and controller log-tail inputs visible as primary operator choices", () => {
    const plannerStart = labTabSource.indexOf('{selectedStage?.id === "planner_project_dry_run" && (');
    const controllerStart = labTabSource.indexOf('{selectedStage?.id === "controller_project_dry_run" && (', plannerStart);
    const visualSelectorStart = labTabSource.indexOf('{(selectedStage?.id === "visual_workbench_selector_readiness"', controllerStart);
    const plannerSource = labTabSource.slice(plannerStart, controllerStart);
    const controllerSource = labTabSource.slice(controllerStart, visualSelectorStart);

    expect(plannerSource).toContain("Visual evidence mode");
    expect(plannerSource).toContain("Agent");
    expect(plannerSource).toContain("Model");
    expect(plannerSource).toContain("Timeout");
    expect(plannerSource).toContain("Log lines");
    expect(plannerSource).toContain("value={snapshotTail}");
    expect(plannerSource).toContain("setSnapshotTail");
    expect(controllerSource).toContain("Trigger");
    expect(controllerSource).toContain("Visual evidence mode");
    expect(controllerSource).toContain("Agent");
    expect(controllerSource).toContain("Model");
    expect(controllerSource).toContain("Timeout");
    expect(controllerSource).toContain("Log lines");
    expect(controllerSource).toContain("value={snapshotTail}");
    expect(controllerSource).toContain("setSnapshotTail");
  });

  it("keeps project stage snapshot usable as a primary readback action", () => {
    const selectedActionStart = labTabSource.indexOf('selectedStage?.runSurface === "direct_cli" && renderTerminalCommandPanel("primary")');
    const promptReplayStart = labTabSource.indexOf("{isPromptReplayStage && (", selectedActionStart);
    const primarySnapshotInputSource = labTabSource.slice(selectedActionStart, promptReplayStart);

    expect(adminLabActionsSource).toContain('id: "get_task_context"');
    expect(adminLabActionsSource).toContain('stageId: "project_stage_snapshot"');
    expect(labTabSource).toContain('useState("project_operator_snapshot")');
    expect(labTabSource).toContain('useState<string | null>("check_project_status")');
    expect(labTabSource).not.toContain('useState("project_stage_candidates")');
    expect(labTabSource).not.toContain('useState<string | null>("find_work")');
    expect(labTabSource).toContain('stage.id === "project_stage_candidates"');
    expect(labTabSource).toContain("Run Get task context for this task.");
    expect(primarySnapshotInputSource).toContain('selectedStage?.id === "project_stage_snapshot"');
    expect(primarySnapshotInputSource).toContain("Task id");
    expect(primarySnapshotInputSource).toContain("Log lines");
    expect(primarySnapshotInputSource).toContain("Task context is disposable readback for the next action.");
    expect(primarySnapshotInputSource).toContain("It does not run planner, executor, Workbench, screenshot capture or lifecycle repair.");
    expect(primarySnapshotInputSource).not.toContain("handlePrimaryAction()");
    expect(primarySnapshotInputSource).not.toContain('setSelectedStageId("visual_workbench_evidence_automation")');
  });

  it("keeps Workbench manifest highlight readback single-sourced", () => {
    expect(labTabSource.match(/runResult\.stage\?\.id === "visual_workbench_manifest_readiness"/g) ?? []).toHaveLength(1);
    expect(labTabSource).toContain('const snapshot = readRecordField(result, "snapshot")');
    expect(labTabSource).not.toContain('readRecordField(readiness, "source")');
  });

  it("derives selected action readiness only from visible input gates", () => {
    const readinessStart = labTabSource.indexOf("const selectedActionNeeds = [");
    const readinessEnd = labTabSource.indexOf("const resultStageCopy = getStageCopy");
    const readinessSource = labTabSource.slice(readinessStart, readinessEnd);

    expect(readinessSource).toContain("canRun");
    expect(readinessSource).toContain("canCopyCommand");
    expect(readinessSource).toContain("isExecutorTaskIdInvalid");
    expect(readinessSource).toContain("isProviderModelInvalid");
    expect(readinessSource).toContain("isProviderTimeoutInvalid");
    expect(readinessSource).toContain("isExecutorCompletionPromiseInvalid");
    expect(readinessSource).toContain('!renderedCommand ? "command" : null');
    expect(readinessSource).toContain("renderedCommandPlaceholders.map(formatCommandPlaceholderLabel)");
    expect(readinessSource).toContain("Fill the command/project values before copying this handoff.");
    expect(readinessSource).toContain("Terminal values");
    expect(readinessSource).not.toContain("runResult");
    expect(readinessSource).not.toContain("fetch(");
    expect(readinessSource).not.toContain("setRunResult");
    expect(readinessSource).not.toContain("handlePrimaryAction");
    expect(readinessSource).not.toContain("Task completed");
    expect(readinessSource).not.toContain("Proof passed");
    expect(readinessSource).not.toContain("Lifecycle updated");
  });

  it("lets candidate rows prepare executor action without auto-running it", () => {
    expect(labTabSource).toContain("getCandidateScanOperatorNotice");
    expect(labTabSource).toContain("candidateScanNotice");
    expect(labTabSource).toContain("candidateScanNotice.title");
    expect(labTabSource).toContain("candidateScanNotice.body");
    expect(labTabSource).toContain("Use for executor");
    expect(labTabSource).toContain("prepare the executor action. Nothing starts automatically.");
    expect(labTabSource).toContain("executor-ready");
    expect(labTabSource).toContain("need checkpoint");
    expect(labTabSource).toContain("visualEvidenceRequiredCount");
    expect(labTabSource).toContain("visualEvidenceNotRequiredCount");
    expect(labTabSource).toContain("visualEvidenceUnknownCount");
    expect(labTabSource).toContain("formatCandidateProjectVisualPolicy");
    expect(labTabSource).toContain("formatCandidateProjectStoriesReadiness");
    expect(labTabSource).toContain("candidateProjectStoriesClasses");
    expect(labTabSource).toContain("Visual policy:");
    expect(labTabSource).toContain("Stories: ready");
    expect(labTabSource).toContain("Class:");
    expect(labTabSource).toContain("policy blocker");
    expect(labTabSource).toContain("story blocker");
    expect(labTabSource).toContain("story unknown");
    expect(labTabSource).toContain("visual-marked");
    expect(labTabSource).toContain("visual-off");
    expect(labTabSource).toContain("visual-unmarked");
    expect(labTabSource).toContain("visual evidence required");
    expect(labTabSource).toContain("visual evidence not required");
    expect(labTabSource).toContain("visual evidence not marked");
    expect(labTabSource).toContain("Resume needs Get task context with a matching provider-session checkpoint before executor can run.");
    expect(labTabSource).toContain('candidate.recommendedExecutorMode === "resume_interrupted"');
    expect(labTabSource).toContain("Get context first");
    expect(labTabSource).toContain("Run Get task context first. Resume needs checkpoint readback before executor input is prepared.");
    expect(labTabSource).toContain("getSnapshotExecutorCheckpointReadback");
    expect(labTabSource).toContain("snapshotExecutorCheckpointReadback");
    expect(labTabSource).toContain("Executor checkpoint readback");
    expect(labTabSource).toContain("canPrepareExecutorFromSnapshotReadback");
    expect(labTabSource).toContain("canSelectResumeAgentFromSnapshotReadback");
    expect(labTabSource).toContain('nextProjectActionId === "resume_agent"');
    expect(labTabSource).toContain("Select Resume agent");
    expect(labTabSource).toContain("handleUseCheckpointResumeAgentHandoff");
    expect(labTabSource).toContain('setSelectedProjectActionId("resume_agent")');
    expect(labTabSource).toContain("Resume agent selected. Run it manually to continue through normal Ralph claim.");
    expect(labTabSource).toContain("Checkpoint first");
    expect(labTabSource).toContain("snapshotExecutorCheckpointReadback.message");
    expect(labTabSource).toContain("handleUseExecutorTaskCandidate");
    expect(labTabSource).toContain("handleUseCandidateScanExecutorTask");
    expect(labTabSource).toContain('setSelectedProjectActionId("get_task_context")');
    expect(labTabSource).toContain('setSelectedProjectActionId("executor_task")');
    expect(labTabSource).not.toContain('setSelectedStageId("executor_project_task")');
    expect(labTabSource).toContain("setSnapshotTaskId(taskId)");
    expect(labTabSource).toContain("if (mode) setExecutorMode(mode)");
    expect(labTabSource).toContain("Executor action selected. Review inputs, then run it manually.");
    expect(labTabSource).toContain("setSelectedProjectId(projectId)");
    expect(labTabSource).toContain("actionId: selectedProjectAction.id");
    expect(labTabSource).toContain("runResult.actionInvocation?.title");
    expect(labTabSource).not.toContain("handleUseExecutorTaskCandidate(taskId, mode);\\n    void handlePrimaryAction");
    const executorTaskHandlerSource = sourceBetween(
      "function handleUseExecutorTaskCandidate",
      "function handleUseSelectedTaskVisualReadback",
    );
    const candidateExecutorHandlerSource = sourceBetween(
      "function handleUseCandidateScanExecutorTask",
      "function handleUseCandidateScanVisualTaskContext",
    );
    expect(executorTaskHandlerSource).not.toContain('setSelectedStageId("visual_workbench_evidence_automation")');
    expect(candidateExecutorHandlerSource).not.toContain('setSelectedStageId("visual_workbench_evidence_automation")');
  });

  it("routes visual-marked candidate scan rows through snapshot readback before story selection", () => {
    expect(labTabSource).toContain('candidate.visualEvidenceRequired === true');
    expect(labTabSource).toContain("Visual task readback");
    expect(labTabSource).toContain("getSnapshotSelectedTaskVisualReadback");
    expect(labTabSource).toContain("canCheckStorySelectionFromSnapshotReadback");
    expect(labTabSource).toContain("handleUseSelectedTaskVisualReadback");
    expect(labTabSource).toContain("handleUseCandidateScanVisualTaskContext");
    expect(labTabSource).toContain('setSelectedProjectActionId("check_story_selection")');
    expect(labTabSource).toContain('setSelectedProjectActionId("get_task_context")');
    expect(labTabSource).not.toContain('setSelectedStageId("visual_workbench_selector_readiness")');
    expect(labTabSource).toContain("Story selection check selected. Review task id, then run it manually.");
    expect(labTabSource).toContain("Project and task filled. Run Get task context to read visual handoff readiness.");
    expect(labTabSource).toContain("setSelectedProjectId(projectId)");
    expect(labTabSource).not.toContain("handleUseCandidateScanVisualTaskContext(project.projectId, candidate.id);\\n    void handlePrimaryAction");
    const visualStoryHandlerSource = sourceBetween(
      "function handleUseSelectedTaskVisualReadback",
      "function handleUseSelectorCapturePolicyHandoff",
    );
    const candidateVisualStoryHandlerSource = sourceBetween(
      "function handleUseCandidateScanVisualTaskContext",
      "async function handleCopyRunResult",
    );
    expect(visualStoryHandlerSource).not.toContain('setSelectedStageId("visual_workbench_evidence_automation")');
    expect(visualStoryHandlerSource).not.toContain('setSelectedStageId("visual_workbench_evidence_chain_readiness")');
    expect(visualStoryHandlerSource).toContain('readback.nextProjectActionId !== "check_story_selection"');
    expect(visualStoryHandlerSource).toContain("readback.canCheckStorySelection");
    expect(candidateVisualStoryHandlerSource).not.toContain('setSelectedStageId("visual_workbench_evidence_automation")');
    expect(candidateVisualStoryHandlerSource).not.toContain('setSelectedStageId("visual_workbench_evidence_chain_readiness")');
    expect(candidateVisualStoryHandlerSource).not.toContain('setSelectedProjectActionId("check_story_selection")');
  });

  it("lets ready selector results prepare capture-policy checks only", () => {
    expect(labTabSource).toContain("getSelectorCapturePolicyHandoff");
    expect(labTabSource).toContain('runResult.stage?.id !== "visual_workbench_selector_readiness"');
    expect(labTabSource).toContain('readString(selector.status) !== "ready"');
    expect(labTabSource).toContain("Capture policy can run next");
    expect(labTabSource).toContain("This only fills the capture-policy check for the same task. It does not start Workbench or capture screenshots.");
    expect(labTabSource).toContain("handleUseSelectorCapturePolicyHandoff");
    expect(labTabSource).toContain('setSelectedProjectActionId("check_capture_policy")');
    expect(labTabSource).not.toContain('setSelectedStageId("visual_workbench_shell_policy")');
    expect(labTabSource).toContain("Capture policy check selected. Review task id, then run it manually.");
    expect(labTabSource).toContain("Fill capture policy");
    expect(labTabSource).not.toContain("handleUseSelectorCapturePolicyHandoff(selectorCapturePolicyHandoff);\\n    void handlePrimaryAction");
    const selectorCapturePolicyHandlerSource = sourceBetween(
      "function handleUseSelectorCapturePolicyHandoff",
      "function handleUseShellPolicyBrowserReadinessHandoff",
    );
    expect(selectorCapturePolicyHandlerSource).not.toContain('setSelectedStageId("visual_workbench_evidence_automation")');
  });

  it("lets allowed capture-policy results prepare browser checks only", () => {
    expect(labTabSource).toContain("getShellPolicyBrowserReadinessHandoff");
    expect(labTabSource).toContain('runResult.stage?.id !== "visual_workbench_shell_policy"');
    expect(labTabSource).toContain('readString(shellPolicy.status) !== "allowed"');
    expect(labTabSource).toContain("Browser readiness can run next");
    expect(labTabSource).toContain("This only selects the platform browser readiness check. It does not start Workbench or capture screenshots.");
    expect(labTabSource).toContain("handleUseShellPolicyBrowserReadinessHandoff");
    expect(labTabSource).toContain('setSelectedProjectActionId("check_browser")');
    expect(labTabSource).not.toContain('setSelectedStageId("visual_workbench_browser_readiness")');
    expect(labTabSource).toContain("Browser readiness check selected. Run it manually before screenshot capture.");
    expect(labTabSource).toContain("Fill browser check");
    expect(labTabSource).not.toContain("handleUseShellPolicyBrowserReadinessHandoff(shellPolicyBrowserReadinessHandoff);\\n    void handlePrimaryAction");
    const shellPolicyBrowserHandlerSource = sourceBetween(
      "function handleUseShellPolicyBrowserReadinessHandoff",
      "function handleUseBrowserReadinessScreenshotHandoff",
    );
    expect(shellPolicyBrowserHandlerSource).not.toContain('setSelectedStageId("visual_workbench_evidence_automation")');
  });

  it("lets ready browser checks prepare screenshot CLI handoffs only", () => {
    expect(labTabSource).toContain("getBrowserReadinessScreenshotHandoff");
    expect(labTabSource).toContain('runResult.stage?.id !== "visual_workbench_browser_readiness"');
    expect(labTabSource).toContain('readString(browserReadiness.status) !== "ready"');
    expect(labTabSource).toContain("Screenshot handoff can be prepared");
    expect(labTabSource).toContain("This only selects the copy-only screenshot command. Terminal values remain explicit or context-filled; it does not start Workbench or capture screenshots.");
    expect(labTabSource).toContain("handleUseBrowserReadinessScreenshotHandoff");
    expect(labTabSource).toContain('setSelectedProjectActionId("make_screenshots")');
    expect(labTabSource).not.toContain('setSelectedStageId("visual_workbench_evidence_automation")');
    expect(labTabSource).toContain("Screenshot handoff selected. Fill terminal values, then copy the command manually.");
    expect(labTabSource).toContain("Fill screenshot handoff");
    expect(labTabSource).not.toContain("handleUseBrowserReadinessScreenshotHandoff(browserReadinessScreenshotHandoff);\\n    void handlePrimaryAction");
  });

  it("runs screenshot capture only through the separate confirmed Workbench automation action", () => {
    expect(labTabSource).toContain("visual_workbench_evidence_automation_run");
    expect(labTabSource).toContain("Run screenshot capture");
    expect(labTabSource).toContain("server-derived Ralph config, localhost base URL and output directory");
    expect(labTabSource).toContain("window.confirm(`Run Workbench screenshot capture for ${taskId}?");
    expect(labTabSource).toContain("confirmed: true");
    expect(labTabSource).toContain('selectedStage.id === "visual_workbench_evidence_automation_run"');
    expect(labTabSource).not.toContain("workDir: commandInputValues");
    expect(labTabSource).not.toContain("baseUrl: commandInputValues");
    expect(labTabSource).not.toContain("outDir: commandInputValues");
    expect(labTabSource).not.toContain("config: commandInputValues");
  });

  it("shows evidence-chain next commands as manual copy-only handoffs", () => {
    const copyHandlerStart = labTabSource.indexOf("async function handleCopyEvidenceChainCommand");
    const copyHandlerEnd = labTabSource.indexOf("async function handleCopySnapshotPath");
    const copyHandlerSource = labTabSource.slice(copyHandlerStart, copyHandlerEnd);

    expect(labTabSource).toContain("getEvidenceChainManualHandoff");
    expect(labTabSource).toContain('runResult.stage?.id !== "visual_workbench_evidence_chain_readiness"');
    expect(labTabSource).toContain("readStringArray(readiness.nextCommands)");
    expect(labTabSource).toContain("Manual evidence handoffs");
    expect(labTabSource).toContain("labelEvidenceChainCommand");
    expect(labTabSource).toContain("Render screenshot catalog");
    expect(labTabSource).toContain("Export task evidence");
    expect(labTabSource).toContain("Assess screenshot evidence");
    expect(labTabSource).toContain("Publish Arena readback");
    expect(labTabSource).toContain("Read screenshot status");
    expect(labTabSource).toContain("Check screenshot files");
    expect(labTabSource).toContain("Copy command");
    expect(labTabSource).toContain("handleCopyEvidenceChainCommand(handoff.command)");
    expect(labTabSource).toContain("No next command is ready from this chain result.");
    expect(labTabSource).toContain("Nothing starts automatically from this result");
    expect(labTabSource).toContain("getEvidenceChainCaptureViewerHandoff");
    expect(labTabSource).toContain("getAutomationStatusCaptureViewerHandoff");
    expect(labTabSource).toContain("getScreenshotCatalogReadback");
    expect(labTabSource).toContain("captureViewer");
    expect(labTabSource).toContain('runResult.stage?.id !== "visual_workbench_automation_status"');
    expect(labTabSource).toContain('readRecordField(report, "capture")');
    expect(labTabSource).toContain("readString(capture?.viewerPath)");
    expect(labTabSource).toContain("Screenshot catalog");
    expect(labTabSource).toContain("Static viewer is already recorded.");
    expect(labTabSource).toContain("Static viewer can be rendered from the capture report.");
    expect(labTabSource).toContain("Static viewer path was recorded by the automation diagnostic.");
    expect(labTabSource).toContain("This handle comes from Ralph captureViewer or automation-status readiness.");
    expect(labTabSource).toContain("convenience catalog over capture artifacts, not evidence proof or Telegram screenshot availability.");
    expect(labTabSource).toContain("function getLocalFileUrl");
    expect(labTabSource).toContain("return `file://${encodedPath}`");
    expect(labTabSource).toContain("Copy path");
    expect(labTabSource).toContain("Copy file URL");
    expect(labTabSource).toContain("Copy render command");
    expect(labTabSource).toContain("Screenshot catalog path copied");
    expect(labTabSource).toContain("Screenshot catalog file URL copied");
    expect(labTabSource).toContain("Opening this catalog is manual: paste the file URL into a local browser.");
    expect(labTabSource).toContain("The Lab does not read raw files, render the viewer, capture screenshots, export evidence or mark screenshot review ready.");
    expect(labTabSource).toContain("handleCopyEvidenceChainViewerPath");
    expect(labTabSource).toContain("handleCopyEvidenceChainViewerUrl");
    expect(copyHandlerSource).toContain("navigator.clipboard.writeText(command)");
    expect(copyHandlerSource).toContain("navigator.clipboard.writeText(viewerPath)");
    expect(copyHandlerSource).toContain("navigator.clipboard.writeText(viewerUrl)");
    expect(copyHandlerSource).not.toContain("fetch(");
    expect(copyHandlerSource).not.toContain("handlePrimaryAction");
    expect(copyHandlerSource).not.toContain("setSelectedStageId");
    expect(labTabSource).not.toContain("handleUseEvidenceChainCommand");
    expect(labTabSource).not.toContain('setSelectedStageId("proof_reviews")');
    expect(labTabSource).not.toContain("setSelectedStageId(command");
    expect(labTabSource).not.toContain("runEvidenceChainNextCommand");
  });

  it("shows executor results as local source evidence without task or proof claims", () => {
    expect(labTabSource).toContain("getExecutorResultSummary");
    expect(labTabSource).toContain("getExecutorObserverReadback");
    expect(labTabSource).toContain('readRecordField(workspaceResult, "executorOutput")');
    expect(labTabSource).toContain('readString(executorOutput?.ownerBoundary) !== "ralph.executor-observer"');
    expect(labTabSource).toContain("readString(executorOutput?.visualEvidenceMode) ?? readString(task?.visualEvidenceMode)");
    expect(labTabSource).toContain("Executor result");
    expect(labTabSource).toContain("Local source result from the executor stage.");
    expect(labTabSource).toContain("This is not task/proof/lifecycle truth.");
    expect(labTabSource).toContain("Shared executor observer");
    expect(labTabSource).toContain("Owner-backed readback from ralph.executor-observer.");
    expect(labTabSource).toContain("Telemetry only; not task/proof/lifecycle truth.");
    expect(labTabSource).toContain("Visual policy");
    expect(labTabSource).toContain("Visual coverage");
    expect(labTabSource).toContain("Expected stories");
    expect(labTabSource).toContain("Observer warning");
    expect(labTabSource).toContain("Executor run status");
    expect(labTabSource).toContain("Workspace diff");
    expect(labTabSource).toContain("Before commit");
    expect(labTabSource).toContain("Local project commit");
    expect(labTabSource).toContain("Executor report");
    expect(labTabSource).toContain("Workspace report");
    expect(labTabSource).toContain("Executor error");
    expect(labTabSource).toContain('readRecordField(workspaceResult, "agent")');
    expect(labTabSource).toContain("agentOutputPreview");
    expect(labTabSource).toContain("outputPreviewTruncated");
    expect(labTabSource).toContain("Agent output");
    expect(labTabSource).toContain('status === "agent_failed"');
    expect(labTabSource).toContain('status === "forbidden_mutation"');
    expect(labTabSource).not.toContain("Task completed");
    expect(labTabSource).not.toContain("Proof passed");
    expect(labTabSource).not.toContain("Published");
    expect(labTabSource).not.toContain("Controller approved");
    expect(labTabSource).not.toContain("Lifecycle updated");
  });

  it("shows visual Workbench handoff from executor output without auto-running screenshots", () => {
    expect(labTabSource).toContain("getExecutorVisualWorkbenchHandoff");
    expect(labTabSource).toContain('readRecordField(executorResult, "visualWorkbenchHandoffGate")');
    expect(labTabSource).toContain("Visual Workbench handoff");
    expect(labTabSource).toContain("Fill selector readiness");
    expect(labTabSource).not.toContain("setSelectedStageId(handoff.nextStageId)");
    expect(labTabSource).toContain("if (handoff.taskId) setSnapshotTaskId(handoff.taskId)");
    expect(labTabSource).toContain("Selector readiness selected. Check it before any screenshot capture.");
    expect(labTabSource).toContain('"visual_workbench_selector_readiness"');
    expect(labTabSource).toContain("This only fills the selector-readiness handoff. It does not run screenshots automatically.");
    expect(labTabSource).toContain("Capture, export, output directory and config stay explicit next-stage choices.");
    expect(labTabSource).not.toContain("runVisualWorkbenchEvidenceAutomation(");
    const executorVisualHandoffHandlerSource = sourceBetween(
      "function handleUseExecutorVisualWorkbenchHandoff",
      "function handleUseVisualEvidenceIngestHandoff",
    );
    expect(executorVisualHandoffHandlerSource).toContain('setSelectedProjectActionId("check_story_selection")');
    expect(executorVisualHandoffHandlerSource).not.toContain("setSelectedProjectActionId(null)");
    expect(executorVisualHandoffHandlerSource).not.toContain('setSelectedStageId("visual_workbench_evidence_automation")');
    expect(labTabSource).not.toContain("visualSignalPresent");
    expect(labTabSource).not.toContain("changedVisualWorkbenchFiles.length > 0");
    expect(labTabSource).not.toContain("scan raw Workbench folders");
  });

  it("routes planner apply results into manual next actions without auto-running them", () => {
    const plannerApplyFindWorkHandlerSource = sourceBetween(
      "function handleUsePlannerApplyFindWorkHandoff",
      "function handleUsePlannerApplyTaskContextHandoff",
    );
    const plannerApplyTaskContextHandlerSource = sourceBetween(
      "function handleUsePlannerApplyTaskContextHandoff",
      "function handleUseExecutorVisualWorkbenchHandoff",
    );
    expect(plannerApplyFindWorkHandlerSource).toContain('setSelectedProjectActionId("find_work")');
    expect(plannerApplyTaskContextHandlerSource).toContain('setSelectedProjectActionId("get_task_context")');
    expect(plannerApplyFindWorkHandlerSource).not.toContain("handlePrimaryAction");
    expect(plannerApplyTaskContextHandlerSource).not.toContain("handlePrimaryAction");
    expect(plannerApplyFindWorkHandlerSource).not.toContain("fetch(");
    expect(plannerApplyTaskContextHandlerSource).not.toContain("fetch(");
    expect(labTabSource).toContain("The Lab does not start planner, executor, controller or screenshot stages from this result.");
    expect(labTabSource).toContain("Run it manually to read current task candidates.");
    expect(labTabSource).toContain("Run it manually before executor or visual checks.");
  });

  it("makes snapshot-to-CLI handoff explicit without claiming the browser wrote a file", () => {
    expect(labTabSource).toContain("Suggested CLI task context file");
    expect(labTabSource).toContain("Lab does not write this file.");
    expect(labTabSource).toContain("\"<project-stage-snapshot.json>\": snapshotSuggestedFilePath");
    expect(labTabSource).toContain("getSnapshotSuggestedFilePath");
  });

  it("renders screenshot review actions only from Arena readback output", () => {
    expect(labTabSource).toContain("Screenshot reviews");
    expect(labTabSource).toContain("These links come from Arena visualEvidenceReviews.");
    expect(labTabSource).toContain("const href = readInternalProjectHref(action?.href)");
    expect(labTabSource).toContain('href?.startsWith("/my/projects/")');
    expect(labTabSource).not.toContain("buildProjectVisualEvidenceFocusHref");
  });

  it("explains an empty screenshot readback without inventing evidence", () => {
    expect(labTabSource).toContain("getScreenshotReadbackGap");
    expect(labTabSource).toContain("Screenshot review gap");
    expect(labTabSource).toContain("No screenshot reviews are recorded yet.");
    expect(labTabSource).toContain("Create or ingest task-linked Workbench evidence");
    expect(labTabSource).toContain("screenshotReadbackGap.recordedRows > 0");
    expect(labTabSource).toContain("Use file check");
    expect(labTabSource).toContain("handleUseVisualEvidenceArtifactCheck");
    expect(labTabSource).toContain('setSelectedProjectActionId("check_screenshot_files")');
    expect(labTabSource).not.toContain('setSelectedStageId("visual_evidence_artifact_check")');
    expect(labTabSource).toContain("Screenshot file check selected. Run it to read downloadability through Arena's artifact owner.");
    expect(labTabSource).toContain("Use ingest handoff");
    expect(labTabSource).toContain("handleUseVisualEvidenceIngestHandoff");
    expect(labTabSource).toContain('setSelectedProjectActionId("ingest_evidence")');
    expect(labTabSource).not.toContain('setSelectedStageId("visual_evidence_ingest")');
    expect(labTabSource).toContain("Visual evidence ingest handoff selected. Fill the explicit command values, then copy it manually.");
    expect(labTabSource).toContain("No Telegram screenshot button is expected until Arena exposes reviewable visualEvidenceReviews.");
    expect(labTabSource).toContain("visualEvidenceReadiness");
    expect(labTabSource).toContain("visualEvidenceReviews");
    expect(labTabSource).not.toContain("scan raw screenshot folders");
    expect(labTabSource).not.toContain("screenshotProof shortcut");
  });

  it("summarizes screenshot artifact checks without exposing raw storage details", () => {
    expect(labTabSource).toContain("Screenshot file checks");
    expect(labTabSource).toContain("Downloadability is checked through Arena&apos;s artifact owner.");
    expect(labTabSource).toContain("Raw bytes and storage paths are not shown.");
    expect(labTabSource).toContain("getVisualEvidenceArtifactCheckRows");
    expect(labTabSource).not.toContain("storagePath");
    expect(labTabSource).not.toContain("rawBytes");
    expect(labTabSource).not.toContain("download.bytes");
  });
});
