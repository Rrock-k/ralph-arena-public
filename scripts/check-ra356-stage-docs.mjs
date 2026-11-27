#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const runtimeDir = path.join(repoRoot, "packages/loops/ralph-runtime");

const stageRunContractPath = path.join(repoRoot, "work/plans/ra-356-manual-experiment-tooling/stage-run-contract.md");
const manualCasesPath = path.join(repoRoot, "work/plans/ra-356-manual-experiment-tooling/manual-experiment-cases.md");
const stageUseCasesPath = path.join(repoRoot, "work/plans/ra-356-manual-experiment-tooling/stage-use-cases.md");
const planPath = path.join(repoRoot, "work/plans/ra-356-manual-experiment-tooling/plan.md");
const actionLogPath = path.join(repoRoot, "work/plans/ra-356-manual-experiment-tooling/action-log.md");
const architecturePath = path.join(repoRoot, "work/plans/ra-356-manual-experiment-tooling/architecture.md");
const sharedProductionBrickMapPath = path.join(repoRoot, "work/plans/ra-356-manual-experiment-tooling/shared-production-brick-map.md");
const userBriefPath = path.join(repoRoot, "work/plans/ra-356-manual-experiment-tooling/user-brief-and-dialogue-notes.md");
const stookProjectLogPath = path.join(repoRoot, "work/plans/ra-356-manual-experiment-tooling/stook-project-log.md");
const ra355PlanPath = path.join(repoRoot, "work/plans/ra-355-visual-first-production-lab/plan.md");
const backlogPath = path.join(repoRoot, "docs/backlog/ralph-arena.md");
const adminLabContractPath = path.join(repoRoot, "docs/ops/admin-laboratory-contract.md");
const governancePackagePath = path.join(repoRoot, "apps/governance-platform/package.json");
const labStorybookVerifierPath = path.join(repoRoot, "apps/governance-platform/scripts/verify-lab-storybook.mjs");
const labTabStoriesPath = path.join(repoRoot, "apps/governance-platform/src/components/admin/ops/LabTab.stories.tsx");
const configTypesPath = path.join(repoRoot, "packages/loops/ralph-runtime/src/config/types.ts");
const loopExecutorPath = path.join(repoRoot, "packages/loops/ralph-runtime/src/loop/executor.ts");
const executorActionPath = path.join(repoRoot, "packages/loops/ralph-runtime/src/loop/executor-action.ts");
const executorActionCorePath = path.join(repoRoot, "packages/loops/ralph-runtime/src/loop/executor-action-core.ts");
const executorPromptPath = path.join(repoRoot, "packages/loops/ralph-runtime/src/loop/executor-prompt.ts");
const executorObserverPath = path.join(repoRoot, "packages/loops/ralph-runtime/src/loop/executor-observer.ts");
const executorSourceCommitPath = path.join(repoRoot, "packages/loops/ralph-runtime/src/loop/executor-source-commit.ts");
const executorContextPath = path.join(repoRoot, "packages/loops/ralph-runtime/src/memory/context.ts");
const gitManagerPath = path.join(repoRoot, "packages/loops/ralph-runtime/src/git/manager.ts");
const providerSessionCheckpointPath = path.join(repoRoot, "packages/loops/ralph-runtime/src/agents/provider-session-checkpoint.ts");
const oldExecutorStageClassifierPath = path.join(repoRoot, "packages/loops/ralph-runtime/src/stage-lab/executor-stage-classifier.ts");
const executorTaskIoPath = path.join(repoRoot, "packages/loops/ralph-runtime/src/stage-lab/executor-task-io.ts");
const executorProjectTaskPath = path.join(repoRoot, "packages/loops/ralph-runtime/src/stage-lab/executor-project-task.ts");
const executorTaskWorkspacePath = path.join(repoRoot, "packages/loops/ralph-runtime/src/stage-lab/executor-task-workspace.ts");
const executorTaskWorkspaceContinuePath = path.join(repoRoot, "packages/loops/ralph-runtime/src/stage-lab/executor-task-workspace-continue.ts");
const executorWorkspaceSourceSnapshotPath = path.join(repoRoot, "packages/loops/ralph-runtime/src/stage-lab/executor-workspace-source-snapshot.ts");
const visualWorkbenchAutomationPath = path.join(repoRoot, "packages/loops/ralph-runtime/src/verification/visual-workbench-automation.ts");
const projectStageSnapshotPath = path.join(repoRoot, "services/arena-ctl/src/tools/project-stage-snapshot.ts");
const stageCatalogPath = path.join(repoRoot, "packages/loops/ralph-runtime/src/stage-lab/catalog.ts");
const adminLabPath = path.join(repoRoot, "apps/governance-platform/src/lib/admin-lab.ts");
const adminLabTestPath = path.join(repoRoot, "apps/governance-platform/src/lib/admin-lab.test.ts");
const adminLabActionsPath = path.join(repoRoot, "apps/governance-platform/src/lib/admin-lab-actions.ts");
const adminLabCommandTemplatePath = path.join(repoRoot, "apps/governance-platform/src/lib/admin-lab-command-template.ts");
const adminLabCommandTemplateTestPath = path.join(repoRoot, "apps/governance-platform/src/lib/admin-lab-command-template.test.ts");
const adminLabSnapshotViewPath = path.join(repoRoot, "apps/governance-platform/src/lib/admin-lab-snapshot-view.ts");
const adminLabSnapshotViewTestPath = path.join(repoRoot, "apps/governance-platform/src/lib/admin-lab-snapshot-view.test.ts");
const adminLabRunRoutePath = path.join(repoRoot, "apps/governance-platform/src/app/api/admin/lab/run/route.ts");
const labTabPath = path.join(repoRoot, "apps/governance-platform/src/components/admin/ops/LabTab.tsx");
const labTabTestPath = path.join(repoRoot, "apps/governance-platform/src/components/admin/ops/LabTab.test.ts");
const candidateScanViewPath = path.join(repoRoot, "apps/governance-platform/src/lib/admin-lab-candidate-scan-view.ts");
const candidateScanViewTestPath = path.join(repoRoot, "apps/governance-platform/src/lib/admin-lab-candidate-scan-view.test.ts");
const arenaCtlGovernanceClientPath = path.join(repoRoot, "services/arena-ctl/src/governance-client.ts");
const arenaCtlGovernanceClientTestPath = path.join(repoRoot, "services/arena-ctl/src/governance-client.test.ts");
const loopExecutorTestPath = path.join(repoRoot, "packages/loops/ralph-runtime/src/loop/executor.test.ts");
const plannerPath = path.join(repoRoot, "packages/loops/ralph-runtime/src/planning/planner.ts");
const plannerSpecMigrationApplyPath = path.join(repoRoot, "packages/loops/ralph-runtime/src/planning/spec-migration-apply.ts");
const plannerSpecMigrationApplyStagePath = path.join(repoRoot, "packages/loops/ralph-runtime/src/stage-lab/planner-spec-migration-apply.ts");
const controllerPath = path.join(repoRoot, "packages/loops/ralph-runtime/src/control/controller.ts");
const plannerProjectDryRunPath = path.join(repoRoot, "packages/loops/ralph-runtime/src/stage-lab/planner-project-dry-run.ts");
const controllerProjectDryRunPath = path.join(repoRoot, "packages/loops/ralph-runtime/src/stage-lab/controller-project-dry-run.ts");
const PRODUCT_ACTION_LABELS = [
  "Get task context",
  "Apply spec diff",
  "Inspect product pass",
  "Inspect UX pass",
  "Run executor on selected task",
  "Continue failed executor fork",
  "Run controller",
  "Copy screenshot command",
  "Run screenshot capture",
  "Collect/check screenshots",
];
const LAB_PRODUCT_ACTION_MAP = [
  { id: "check_project_status", group: "Find work", title: "Check project status", stageId: "project_operator_snapshot" },
  { id: "pause_agent", group: "Find work", title: "Pause agent", stageId: "project_agent_off" },
  { id: "resume_agent", group: "Find work", title: "Resume agent", stageId: "project_agent_on" },
  { id: "find_work", group: "Find work", title: "Find work", stageId: "project_stage_candidates" },
  { id: "get_task_context", group: "Find work", title: "Get task context", stageId: "project_stage_snapshot" },
  { id: "apply_spec_diff", group: "Plan and review", title: "Apply spec diff", stageId: "planner_project_dry_run" },
  { id: "materialize_spec_tasks", group: "Plan and review", title: "Apply spec diff to plan", stageId: "planner_spec_migration_apply" },
  { id: "product_pass", group: "Plan and review", title: "Inspect product pass", stageId: "prompt_contract_replay" },
  { id: "ux_pass", group: "Plan and review", title: "Inspect UX pass", stageId: "prompt_contract_replay" },
  { id: "executor_task", group: "Run task", title: "Run executor on selected task", stageId: "executor_project_task" },
  { id: "continue_executor_fork", group: "Run task", title: "Continue failed executor fork", stageId: "executor_task_workspace_continue" },
  { id: "controller_review", group: "Plan and review", title: "Run controller", stageId: "controller_project_dry_run" },
  { id: "check_visual_stories", group: "Visual evidence", title: "Check visual stories", stageId: "visual_workbench_manifest_readiness" },
  { id: "check_story_selection", group: "Visual evidence", title: "Check story selection", stageId: "visual_workbench_selector_readiness" },
  { id: "check_capture_policy", group: "Visual evidence", title: "Check capture policy", stageId: "visual_workbench_shell_policy" },
  { id: "check_browser", group: "Visual evidence", title: "Check browser", stageId: "visual_workbench_browser_readiness" },
  { id: "make_screenshots", group: "Visual evidence", title: "Copy screenshot command", stageId: "visual_workbench_evidence_automation" },
  { id: "run_screenshot_capture", group: "Visual evidence", title: "Run screenshot capture", stageId: "visual_workbench_evidence_automation_run" },
  { id: "check_screenshot_run", group: "Visual evidence", title: "Check screenshot run", stageId: "visual_workbench_automation_status" },
  { id: "check_evidence_chain", group: "Visual evidence", title: "Check evidence chain", stageId: "visual_workbench_evidence_chain_readiness" },
  { id: "ingest_evidence", group: "Visual evidence", title: "Ingest evidence", stageId: "visual_evidence_ingest" },
  { id: "screenshot_check", group: "Visual evidence", title: "Collect/check screenshots", stageId: "proof_reviews" },
  { id: "check_screenshot_files", group: "Visual evidence", title: "Check screenshot files", stageId: "visual_evidence_artifact_check" },
];
const SHARED_ACTION_EXCLUDED_TAIL_MARKERS = new Map([
  ["apply_spec_diff", ["no plan apply"]],
  ["materialize_spec_tasks", ["no dry-run replay", "no executor/controller/Workbench auto-start"]],
  ["executor_task", ["production still owns task selection", "progress/lifecycle writes and push flow"]],
  ["controller_review", ["no controller report/apply truth"]],
  ["check_visual_stories", ["not capture", "evidence creation or screenshot availability"]],
  ["check_story_selection", ["not capture", "evidence export or screenshot availability"]],
  ["check_capture_policy", ["not shell execution", "browser start", "evidence export or screenshot availability"]],
  ["make_screenshots", ["browser-run promotion remains audited debt"]],
  ["run_screenshot_capture", ["no automatic ingest", "proof review", "Telegram"]],
]);
const PRODUCTION_CONVERGENCE_EVIDENCE_ROWS = [
  {
    actionId: "apply_spec_diff",
    docMarkers: [
      "Shared helper only",
      "Planner.dryRunInitialPlan()",
      "plannerOutput.ownerBoundary",
      "not normal plan apply",
    ],
    codeChecks: [
      ["planning/planner.ts", ["dryRunInitialPlan", "PLANNER_INITIAL_DRY_RUN_OWNER_BOUNDARY"]],
      ["stage-lab/planner-project-dry-run.ts", ["ownerBoundary: dryRunResult.ownerBoundary"]],
    ],
  },
  {
    actionId: "materialize_spec_tasks",
    docMarkers: [
      "normal `ralph run`",
      "applyPendingSpecMigrationsThroughOwner",
      "ralph.planner-spec-migration-apply",
      "stops before executor/controller/Workbench",
    ],
    codeChecks: [
      ["loop/executor.ts", ["applyPendingSpecMigrationsThroughOwner", "hasPendingSpecMigrationsThroughOwner"]],
      ["planning/spec-migration-apply.ts", ["applyPendingSpecMigrations", "ownerBoundary: 'ralph.planner-spec-migration-apply'"]],
    ],
  },
  {
    actionId: "executor_task",
    docMarkers: [
      "normal `LoopExecutor.executeIteration`",
      "runExecutorActionCoreForCurrentTask",
      "runExecutorActionCore",
      "ProviderSessionCheckpointStore.readResumableMatching()",
      "isProviderSessionResumable()",
      "caller-owned tails",
    ],
    codeChecks: [
      ["loop/executor.ts", ["runExecutorActionCoreForCurrentTask", "runExecutorActionCore", "readResumableMatching"]],
      ["agents/provider-session-checkpoint.ts", ["readResumableMatching", "isProviderSessionResumable", "input.outcome === 'error'"]],
      ["stage-lab/executor-project-task.ts", ["isProviderSessionResumable", "providerSessionResume"]],
      ["stage-lab/executor-task-workspace.ts", ["runExecutorActionCore", "executorOutput: coreResult.executorOutput"]],
    ],
  },
  {
    actionId: "controller_review",
    docMarkers: [
      "Shared helper only",
      "Controller.dryRunAudit()",
      "controllerOutput.ownerBoundary",
      "not normal controller apply",
    ],
    codeChecks: [
      ["control/controller.ts", ["dryRunAudit", "CONTROLLER_DRY_RUN_AUDIT_OWNER_BOUNDARY"]],
      ["stage-lab/controller-project-dry-run.ts", ["ownerBoundary: dryRunResult.ownerBoundary"]],
    ],
  },
  {
    actionId: "check_visual_stories",
    docMarkers: [
      "Source-current Workbench diagnostic",
      "visual_workbench_manifest_readiness",
      "not normal loop mutation",
      "not screenshot proof",
    ],
    codeChecks: [
      ["stage-lab/catalog.ts", ["visual_workbench_manifest_readiness", "ra-355.visual-workbench-manifest"]],
    ],
  },
  {
    actionId: "check_story_selection",
    docMarkers: [
      "Source-current Workbench diagnostic",
      "getVisualWorkbenchSelectorReadinessFile",
      "same selector owner",
      "not screenshot proof",
    ],
    codeChecks: [
      ["verification/visual-workbench-automation.ts", ["getVisualWorkbenchSelectorReadinessFile", "selector_not_ready"]],
      ["stage-lab/catalog.ts", ["visual_workbench_selector_readiness", "ralph.visual-workbench-selector-readiness"]],
    ],
  },
  {
    actionId: "check_capture_policy",
    docMarkers: [
      "Source-current Workbench diagnostic",
      "shell policy",
      "automation composes",
      "not command execution",
    ],
    codeChecks: [
      ["verification/visual-workbench-automation.ts", ["shell policy", "platform browser readiness"]],
      ["stage-lab/catalog.ts", ["visual_workbench_shell_policy", "ralph.visual-workbench-shell-policy"]],
    ],
  },
  {
    actionId: "check_browser",
    docMarkers: [
      "Platform preflight",
      "platform.browser-readiness",
      "automation composes",
      "not project capture",
    ],
    codeChecks: [
      ["verification/visual-workbench-automation.ts", ["platform browser readiness"]],
      ["stage-lab/catalog.ts", ["visual_workbench_browser_readiness", "platform.browser-readiness"]],
    ],
  },
  {
    actionId: "make_screenshots",
    docMarkers: [
      "real `LoopExecutor`",
      "runVisualWorkbenchEvidenceAutomation",
      "ralph.visual-workbench-evidence-automation",
      "browser-run promotion remains audited debt",
    ],
    codeChecks: [
      ["loop/executor.ts", ["runVisualWorkbenchEvidenceAutomation"]],
      ["verification/visual-workbench-automation.ts", ["VISUAL_WORKBENCH_AUTOMATION_OWNER_BOUNDARY = 'ralph.visual-workbench-evidence-automation'"]],
    ],
  },
  {
    actionId: "run_screenshot_capture",
    docMarkers: [
      "ralph.visual-workbench-evidence-automation",
      "runVisualWorkbenchEvidenceAutomation",
      "server-derived",
      "explicit operator confirmation",
    ],
    codeChecks: [
      ["loop/executor.ts", ["runVisualWorkbenchEvidenceAutomation"]],
      ["verification/visual-workbench-automation.ts", ["VISUAL_WORKBENCH_AUTOMATION_OWNER_BOUNDARY = 'ralph.visual-workbench-evidence-automation'"]],
      ["admin-lab.ts", ["visual_workbench_evidence_automation_run", "confirmed", "buildVisualWorkbenchEvidenceAutomationRunArgs"]],
    ],
  },
];
const ADMIN_LAB_RALPH_HANDOFF_STAGES = [
  { stageId: "planner_project_dry_run", runSurface: "stage_run_workspace" },
  { stageId: "planner_spec_migration_apply", runSurface: "stage_run_workspace" },
  { stageId: "executor_project_task", runSurface: "stage_run_workspace" },
  { stageId: "executor_task_workspace_continue", runSurface: "stage_run_workspace" },
  { stageId: "executor_workspace_source_snapshot", runSurface: "stage_run_workspace" },
  { stageId: "controller_project_dry_run", runSurface: "stage_run_workspace" },
  { stageId: "visual_workbench_evidence_automation", runSurface: "direct_cli" },
];
const ADMIN_LAB_ARENA_CTL_HANDOFF_STAGES = [
  {
    adminLabStageId: "visual_evidence_ingest",
    catalogStageId: "arena_visual_evidence_ingest",
    runSurface: "direct_cli",
  },
];
const ADMIN_LAB_ARENA_CTL_RUN_STAGES = [
  {
    adminLabStageId: "project_stage_candidates",
    command: "project_stage_candidates",
    ownerBoundary: "arena-ctl.project-stage-candidates",
  },
  {
    adminLabStageId: "project_stage_snapshot",
    command: "project_stage_snapshot",
    ownerBoundary: "arena-ctl.project-stage-snapshot",
  },
];
const ADMIN_LAB_LIFECYCLE_ACTION_RUN_STAGES = [
  {
    stageId: "project_agent_off",
    actionId: "pause_agent",
    title: "Pause agent",
    intent: "OFF",
  },
  {
    stageId: "project_agent_on",
    actionId: "resume_agent",
    title: "Resume agent",
    intent: "ON",
  },
];
const ADMIN_LAB_RUN_STRICT_REQUEST_SCHEMAS = [
  { stageId: "project_operator_snapshot", code: "invalid_project_operator_snapshot_options" },
  { stageId: "project_agent_off", code: "invalid_project_agent_off_options" },
  { stageId: "project_agent_on", code: "invalid_project_agent_on_options" },
  { stageId: "spec_artifact_audit", code: "invalid_spec_artifact_audit_options" },
  { stageId: "runtime_claim_dry_run", code: "invalid_runtime_claim_dry_run_options" },
  { stageId: "runner_init_readiness", code: "invalid_runner_init_readiness_options" },
  { stageId: "proof_reviews", code: "invalid_proof_reviews_options" },
  { stageId: "visual_evidence_artifact_check", code: "invalid_visual_evidence_artifact_check_options" },
  { stageId: "prompt_contract_replay", code: "invalid_prompt_replay_options" },
  { stageId: "project_stage_candidates", code: "invalid_project_stage_candidates_options" },
  { stageId: "project_stage_snapshot", code: "invalid_project_stage_snapshot_options" },
  { stageId: "planner_project_dry_run", code: "invalid_planner_project_dry_run_options" },
  { stageId: "planner_spec_migration_apply", code: "invalid_planner_spec_migration_apply_options" },
  { stageId: "controller_project_dry_run", code: "invalid_controller_project_dry_run_options" },
  { stageId: "executor_project_task", code: "invalid_executor_project_task_options" },
  { stageId: "visual_workbench_manifest_readiness", code: "invalid_visual_workbench_manifest_options" },
  { stageId: "visual_workbench_selector_readiness", code: "invalid_visual_workbench_selector_readiness_options" },
  { stageId: "visual_workbench_shell_policy", code: "invalid_visual_workbench_shell_policy_options" },
  { stageId: "visual_workbench_browser_readiness", code: "invalid_visual_workbench_browser_readiness_options" },
  { stageId: "visual_workbench_automation_status", code: "invalid_visual_workbench_automation_status_options" },
  { stageId: "visual_workbench_evidence_chain_readiness", code: "invalid_visual_workbench_evidence_chain_readiness_options" },
];
const ADMIN_LAB_RUN_DYNAMIC_REQUEST_CODE_STAGES = new Set([
  "project_operator_snapshot",
  "project_agent_off",
  "project_agent_on",
  "spec_artifact_audit",
  "runtime_claim_dry_run",
  "runner_init_readiness",
  "proof_reviews",
  "visual_evidence_artifact_check",
  "visual_workbench_selector_readiness",
  "visual_workbench_shell_policy",
  "visual_workbench_automation_status",
  "visual_workbench_evidence_chain_readiness",
]);
const SIMPLE_INVOCATION_MODEL = "project context/live workspace -> one plain action/function -> explicit argument schema (task/spec/state) -> one owner-backed stage -> observable result/diff/report -> manual next action";

const catalog = readStageCatalog();
const stageRunContract = readFileSync(stageRunContractPath, "utf8");
const manualCases = readFileSync(manualCasesPath, "utf8");
const stageUseCases = readFileSync(stageUseCasesPath, "utf8");
const plan = readFileSync(planPath, "utf8");
const actionLog = readFileSync(actionLogPath, "utf8");
const architecture = readFileSync(architecturePath, "utf8");
const sharedProductionBrickMap = readFileSync(sharedProductionBrickMapPath, "utf8");
const userBrief = readFileSync(userBriefPath, "utf8");
const stookProjectLog = readFileSync(stookProjectLogPath, "utf8");
const ra355Plan = readFileSync(ra355PlanPath, "utf8");
const backlog = readFileSync(backlogPath, "utf8");
const adminLabContract = readFileSync(adminLabContractPath, "utf8");
const governancePackage = readFileSync(governancePackagePath, "utf8");
const labStorybookVerifier = readFileSync(labStorybookVerifierPath, "utf8");
const labTabStories = readFileSync(labTabStoriesPath, "utf8");
const configTypes = readFileSync(configTypesPath, "utf8");
const loopExecutor = readFileSync(loopExecutorPath, "utf8");
const executorAction = readFileSync(executorActionPath, "utf8");
const executorActionCore = readFileSync(executorActionCorePath, "utf8");
const executorPrompt = readFileSync(executorPromptPath, "utf8");
const executorObserver = readFileSync(executorObserverPath, "utf8");
const executorSourceCommit = readFileSync(executorSourceCommitPath, "utf8");
const executorContext = readFileSync(executorContextPath, "utf8");
const gitManager = readFileSync(gitManagerPath, "utf8");
const providerSessionCheckpoint = readFileSync(providerSessionCheckpointPath, "utf8");
const executorTaskIo = readFileSync(executorTaskIoPath, "utf8");
const executorProjectTask = readFileSync(executorProjectTaskPath, "utf8");
const executorTaskWorkspace = readFileSync(executorTaskWorkspacePath, "utf8");
const executorTaskWorkspaceContinue = readFileSync(executorTaskWorkspaceContinuePath, "utf8");
const executorWorkspaceSourceSnapshot = readFileSync(executorWorkspaceSourceSnapshotPath, "utf8");
const visualWorkbenchAutomation = readFileSync(visualWorkbenchAutomationPath, "utf8");
const projectStageSnapshot = readFileSync(projectStageSnapshotPath, "utf8");
const stageCatalogSource = readFileSync(stageCatalogPath, "utf8");
const adminLab = readFileSync(adminLabPath, "utf8");
const adminLabTest = readFileSync(adminLabTestPath, "utf8");
const adminLabActions = readFileSync(adminLabActionsPath, "utf8");
const adminLabCommandTemplate = readFileSync(adminLabCommandTemplatePath, "utf8");
const adminLabCommandTemplateTest = readFileSync(adminLabCommandTemplateTestPath, "utf8");
const adminLabSnapshotView = readFileSync(adminLabSnapshotViewPath, "utf8");
const adminLabSnapshotViewTest = readFileSync(adminLabSnapshotViewTestPath, "utf8");
const adminLabRunRoute = readFileSync(adminLabRunRoutePath, "utf8");
const labTab = readFileSync(labTabPath, "utf8");
const labTabTest = readFileSync(labTabTestPath, "utf8");
const candidateScanView = readFileSync(candidateScanViewPath, "utf8");
const candidateScanViewTest = readFileSync(candidateScanViewTestPath, "utf8");
const arenaCtlGovernanceClient = readFileSync(arenaCtlGovernanceClientPath, "utf8");
const arenaCtlGovernanceClientTest = readFileSync(arenaCtlGovernanceClientTestPath, "utf8");
const loopExecutorTest = readFileSync(loopExecutorTestPath, "utf8");
const planner = readFileSync(plannerPath, "utf8");
const plannerSpecMigrationApply = readFileSync(plannerSpecMigrationApplyPath, "utf8");
const plannerSpecMigrationApplyStage = readFileSync(plannerSpecMigrationApplyStagePath, "utf8");
const controller = readFileSync(controllerPath, "utf8");
const plannerProjectDryRun = readFileSync(plannerProjectDryRunPath, "utf8");
const controllerProjectDryRun = readFileSync(controllerProjectDryRunPath, "utf8");
const errors = [];

for (const stage of catalog.stages) {
  const expectedCommand = `ralph stage list --stage ${stage.stageId} --compact`;
  if (!stageRunContract.includes(expectedCommand)) {
    errors.push(`stage-run-contract.md is missing catalog command: ${expectedCommand}`);
  }
}

for (const stage of catalog.stages.filter((entry) => entry.runSurface === "direct_cli" && entry.stageId.startsWith("visual_workbench_"))) {
  if (!manualCases.includes(stage.stageId)) {
    errors.push(`manual-experiment-cases.md is missing Workbench direct CLI stage id: ${stage.stageId}`);
  }
}

for (const stage of arenaVisualEvidenceDirectCliStages(catalog)) {
  for (const [docName, docBody] of [
    ["stage-run-contract.md", stageRunContract],
    ["manual-experiment-cases.md", manualCases],
  ]) {
    if (!docBody.includes(stage.stageId)) {
      errors.push(`${docName} is missing Arena visual evidence stage id: ${stage.stageId}`);
    }
    const commandPrefix = commandPrefixForDocs(stage.currentCommand);
    if (!docBody.includes(commandPrefix)) {
      errors.push(`${docName} is missing Arena visual evidence command: ${commandPrefix}`);
    }
  }
}

for (const [docName, docBody] of [
  ["stage-run-contract.md", stageRunContract],
  ["manual-experiment-cases.md", manualCases],
]) {
  if (!hasArtifactCheckAfterReadbackRule(docBody)) {
    errors.push(`${docName} is missing the artifact-check-after-visualEvidenceReviews handoff rule`);
  }
  if (!docBody.includes("delegatedWorkspaceReportPath")) {
    errors.push(`${docName} is missing the executor_project_task delegatedWorkspaceReportPath source-snapshot handoff rule`);
  }
}

const adminLabHandoffErrors = checkAdminLabRalphHandoffs(catalog, adminLab);
errors.push(...adminLabHandoffErrors);
errors.push(...checkAdminLabArenaCtlHandoffs(catalog, adminLab));
errors.push(...checkAdminLabArenaCtlRunStages(adminLab, stageRunContract));
errors.push(...checkAdminLabLifecycleActionRunStages(adminLab, adminLabRunRoute, adminLabContract));
errors.push(...checkAdminLabRunRouteStrictInputs(adminLabRunRoute));
errors.push(...checkAdminLabPromptContractReplayRun(adminLab, adminLabRunRoute, adminLabContract));
errors.push(...checkAdminLabPlannerProjectDryRun(adminLab, adminLabContract));
errors.push(...checkAdminLabControllerProjectDryRun(adminLab, adminLabContract));
errors.push(...checkAdminLabExecutorProjectTaskRun(adminLab, adminLabContract));
errors.push(...checkAdminLabVisualWorkbenchManifestReadinessRun(adminLab, adminLabRunRoute, adminLabContract));
errors.push(...checkAdminLabVisualWorkbenchSelectorReadinessRun(adminLab, adminLabContract, adminLabTest));
errors.push(...checkAdminLabVisualWorkbenchShellPolicyRun(adminLab, adminLabRunRoute, adminLabContract));
errors.push(...checkAdminLabVisualWorkbenchBrowserReadinessRun(adminLab, adminLabContract));
errors.push(...checkAdminLabVisualWorkbenchAutomationStatusRun(adminLab, adminLabContract));
errors.push(...checkAdminLabVisualWorkbenchEvidenceChainReadinessRun(adminLab, adminLabContract));
errors.push(...checkLabStorybookRenderSmoke());
errors.push(...checkProductActionMap());
errors.push(...checkSimpleInvocationModel());
errors.push(...checkSnapshotFileHandoff());
errors.push(...checkSharedProductionBrickGate());
errors.push(...checkStookV2ApplyBoundaryDocs());

if (errors.length > 0) {
  console.error("RA-356 stage docs check failed:");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

if (process.argv.includes("--verbose")) {
  console.log(
    `RA-356 stage docs OK: ${catalog.stages.length} stage catalog entries checked; `
    + `${workbenchDirectCliStages(catalog).length} Workbench direct CLI stage ids checked in manual cases; `
    + `${arenaVisualEvidenceDirectCliStages(catalog).length} Arena visual evidence stages checked; `
    + `${ADMIN_LAB_RALPH_HANDOFF_STAGES.length} Admin Lab Ralph handoffs checked; `
    + `${ADMIN_LAB_ARENA_CTL_HANDOFF_STAGES.length} Admin Lab arena-ctl handoffs checked; `
    + `${ADMIN_LAB_ARENA_CTL_RUN_STAGES.length} Admin Lab arena-ctl UI-run stages checked; `
    + `${ADMIN_LAB_LIFECYCLE_ACTION_RUN_STAGES.length} Admin Lab lifecycle action stages checked; `
    + `prompt_contract_replay, planner_project_dry_run, controller_project_dry_run, executor_project_task, visual_workbench_manifest_readiness, visual_workbench_selector_readiness, visual_workbench_shell_policy, visual_workbench_browser_readiness, visual_workbench_automation_status and visual_workbench_evidence_chain_readiness UI-runs checked; `
    + `Admin Lab Storybook render smoke contract checked; `
    + `${PRODUCT_ACTION_LABELS.length} broad Lab product action labels checked; `
    + `${LAB_PRODUCT_ACTION_MAP.length} primary action mappings checked; `
    + `snapshot file handoff checked; shared production brick map and gate checked.`
  );
}

function checkLabStorybookRenderSmoke() {
  const result = [];
  for (const expected of [
    "Admin Lab Storybook render smoke",
    "UI states only",
    "fresh temp Storybook build -> verify:storybook:lab -> browser-visible Lab states",
    "explicit `STORYBOOK_DIR`",
    "stale checked-out or local `storybook-static` output is not accepted as proof",
    "not a Lab action runner, not Visual Workbench evidence and not an Arena proof path",
    "does not run Lab actions",
    "must not run `/api/admin/lab/run`, create evidence, ingest proof rows, scan raw artifacts",
    "write/commit `storybook-static`",
    "temporary render diagnostics only",
    "not Arena visual evidence",
    "not proof truth",
    "not screenshot-review availability",
    "npm --prefix apps/governance-platform run build-storybook -- --output-dir /private/tmp/ra356-labtab-verified-storybook-current",
    "STORYBOOK_DIR=/private/tmp/ra356-labtab-verified-storybook-current npm --prefix apps/governance-platform run verify:storybook:lab",
  ]) {
    if (!contractIncludes(adminLabContract, expected)) {
      result.push(`admin-laboratory-contract.md is missing Storybook render smoke marker: ${expected}`);
    }
  }
  if (!governancePackage.includes('"verify:storybook:lab": "node scripts/verify-lab-storybook.mjs"')) {
    result.push("governance-platform package.json must keep verify:storybook:lab mapped to the bounded Lab Storybook verifier");
  }
  for (const expected of [
    "LAB_STORIES",
    "STORYBOOK_DIR is required",
    "admin-ops-laboratory--candidate-scan-visual-readback-result",
    "admin-ops-laboratory--candidate-scan-no-visual-marked-result",
    "ra-356.lab-storybook-render-smoke.v1",
    "Render smoke verifies Admin Lab Storybook UI states only.",
    "It does not run /api/admin/lab/run, create evidence, ingest proof rows, scan raw artifacts or write storybook-static.",
    "verifyStoryInteractions",
    "Pinned by selected action. Change the action, not this fixture.",
    "Fill capture policy",
    "Use ingest handoff",
    "assertNoVisibleExactText",
  ]) {
    if (!labStorybookVerifier.includes(expected)) {
      result.push(`verify-lab-storybook.mjs is missing bounded smoke marker: ${expected}`);
    }
  }
  for (const expected of [
    "bounded clicks inside source-owned Storybook fixtures",
    "result handoffs staying on primary actions",
    "UI-state verification only",
  ]) {
    if (!contractIncludes(adminLabContract, expected)) {
      result.push(`admin-laboratory-contract.md is missing Storybook interaction smoke marker: ${expected}`);
    }
  }
  for (const expected of [
    "CandidateScanVisualReadbackResult",
    "CANDIDATE_SCAN_VISUAL_READBACK_RESULT",
    "Visual policy/story-readiness readback is copied from Project Stage Snapshot owner reads.",
    "CandidateScanNoVisualMarkedResult",
    "CANDIDATE_SCAN_NO_VISUAL_MARKED_RESULT",
    "No-visual notice is readback over task candidateSummary fields.",
  ]) {
    if (!labTabStories.includes(expected)) {
      result.push(`LabTab.stories.tsx is missing candidate visual-readback Storybook marker: ${expected}`);
    }
  }
  return result;
}

function readStageCatalog() {
  const source = [
    "import('./src/stage-lab/catalog.ts')",
    ".then((module) => process.stdout.write(JSON.stringify(module.getStageCatalogResult())))",
  ].join("");
  const output = execFileSync(process.execPath, ["--import", "tsx", "-e", source], {
    cwd: runtimeDir,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return JSON.parse(output);
}

function workbenchDirectCliStages(catalogResult) {
  return catalogResult.stages.filter((entry) => entry.runSurface === "direct_cli" && entry.stageId.startsWith("visual_workbench_"));
}

function arenaVisualEvidenceDirectCliStages(catalogResult) {
  return catalogResult.stages.filter((entry) => entry.runSurface === "direct_cli" && entry.stageId.startsWith("arena_visual_evidence_"));
}

function commandPrefixForDocs(command) {
  return String(command ?? "").replace(/\s*<[^>]+>/g, "").trim();
}

function hasArtifactCheckAfterReadbackRule(docBody) {
  const normalized = docBody.replace(/\s+/g, " ");
  return /project_visual_evidence_artifact_check.{0,320}after.{0,320}project_proof_reviews.{0,320}visualEvidenceReviews/i.test(normalized)
    || /project_proof_reviews.{0,320}visualEvidenceReviews.{0,320}project_visual_evidence_artifact_check/i.test(normalized);
}

function checkAdminLabRalphHandoffs(catalogResult, adminLabSource) {
  const result = [];
  const prefixMatch = /const RALPH_RUNTIME_REPO_ROOT_COMMAND = "([^"]+)";/.exec(adminLabSource);
  if (!prefixMatch) {
    return ["admin-lab.ts is missing RALPH_RUNTIME_REPO_ROOT_COMMAND"];
  }

  const repoRootPrefix = prefixMatch[1];
  for (const { stageId, runSurface } of ADMIN_LAB_RALPH_HANDOFF_STAGES) {
    const catalogStage = catalogResult.stages.find((stage) => stage.stageId === stageId);
    if (!catalogStage) {
      result.push(`Ralph stage catalog is missing Admin Lab handoff stage: ${stageId}`);
      continue;
    }
    if (catalogStage.runSurface !== runSurface) {
      result.push(`Ralph stage ${stageId} must remain ${runSurface} for Admin Lab direct CLI handoff; got ${catalogStage.runSurface}`);
    }

    const adminCommand = extractAdminLabCurrentCommand(adminLabSource, stageId);
    if (!adminCommand) {
      result.push(`admin-lab.ts is missing currentCommand for ${stageId}`);
      continue;
    }
    const expectedCommand = `${repoRootPrefix} ${stripRalphBinary(catalogStage.currentCommand)}`;
    if (adminCommand !== expectedCommand) {
      result.push(`admin-lab.ts currentCommand for ${stageId} drifted from Ralph catalog. Expected: ${expectedCommand}. Got: ${adminCommand}`);
    }
    if (!manualCases.includes(stageId)) {
      result.push(`manual-experiment-cases.md is missing Admin Lab Ralph handoff stage id: ${stageId}`);
    }
  }

  return result;
}

function checkAdminLabArenaCtlHandoffs(catalogResult, adminLabSource) {
  const result = [];
  for (const { adminLabStageId, catalogStageId, runSurface } of ADMIN_LAB_ARENA_CTL_HANDOFF_STAGES) {
    const catalogStage = catalogResult.stages.find((stage) => stage.stageId === catalogStageId);
    if (!catalogStage) {
      result.push(`Ralph stage catalog is missing Admin Lab arena-ctl handoff stage: ${catalogStageId}`);
      continue;
    }
    if (catalogStage.runSurface !== runSurface) {
      result.push(`Ralph stage ${catalogStageId} must remain ${runSurface} for Admin Lab direct CLI handoff; got ${catalogStage.runSurface}`);
    }

    const adminCommand = extractAdminLabCurrentCommand(adminLabSource, adminLabStageId);
    if (!adminCommand) {
      result.push(`admin-lab.ts is missing currentCommand for ${adminLabStageId}`);
      continue;
    }
    if (adminCommand !== catalogStage.currentCommand) {
      result.push(`admin-lab.ts currentCommand for ${adminLabStageId} drifted from Ralph catalog. Expected: ${catalogStage.currentCommand}. Got: ${adminCommand}`);
    }
  }

  return result;
}

function checkAdminLabArenaCtlRunStages(adminLabSource, stageRunContractBody) {
  const result = [];
  for (const { adminLabStageId, command, ownerBoundary } of ADMIN_LAB_ARENA_CTL_RUN_STAGES) {
    const stageBlock = extractAdminLabStageBlock(adminLabSource, adminLabStageId);
    if (!stageBlock) {
      result.push(`admin-lab.ts is missing Admin Lab arena-ctl UI-run stage: ${adminLabStageId}`);
      continue;
    }
    if (!stageBlock.includes('runSurface: "admin_lab_run"')) {
      result.push(`admin-lab.ts must keep ${adminLabStageId} as admin_lab_run`);
    }
    if (!stageBlock.includes('mode: "read_only"')) {
      result.push(`admin-lab.ts must keep ${adminLabStageId} read_only`);
    }
    if (!stageBlock.includes(`ownerBoundary: "${ownerBoundary}"`)) {
      result.push(`admin-lab.ts ownerBoundary for ${adminLabStageId} must be ${ownerBoundary}`);
    }
    if (!stageBlock.includes("currentCommand: null")) {
      result.push(`admin-lab.ts must not expose a copyable currentCommand for UI-run ${adminLabStageId}`);
    }
    if (!stageRunContractBody.includes(`services/arena-ctl/cli.sh ${command}`)) {
      result.push(`stage-run-contract.md is missing Admin Lab arena-ctl command ${command}`);
    }
  }
  return result;
}

function checkAdminLabLifecycleActionRunStages(adminLabSource, routeSource, adminLabContractBody) {
  const result = [];
  for (const { stageId, actionId, title, intent } of ADMIN_LAB_LIFECYCLE_ACTION_RUN_STAGES) {
    const stageBlock = extractAdminLabStageBlock(adminLabSource, stageId);
    if (!stageBlock) {
      result.push(`admin-lab.ts is missing lifecycle action stage: ${stageId}`);
      continue;
    }
    for (const expected of [
      'runSurface: "admin_lab_run"',
      'mode: "operator_mutation"',
      'ownerBoundary: "governance.project-agent-intent"',
      "currentCommand: null",
    ]) {
      if (!stageBlock.includes(expected)) {
        result.push(`admin-lab.ts lifecycle stage ${stageId} is missing ${expected}`);
      }
    }
    const actionBlock = extractObjectBlockById(adminLabActions, actionId);
    if (!actionBlock) {
      result.push(`Admin Lab action definitions are missing lifecycle action ${actionId}`);
      continue;
    }
    for (const expected of [
      `title: "${title}"`,
      `stageId: "${stageId}"`,
      'group: "Find work"',
      "Lifecycle owner",
      intent === "OFF" ? "Agent OFF owner" : "Agent ON owner",
    ]) {
      if (!actionBlock.includes(expected)) {
        result.push(`Admin Lab lifecycle action ${actionId} is missing ${expected}`);
      }
    }
    if (!routeSource.includes(`stageId === "${stageId}"`)) {
      result.push(`route.ts lifecycle action input contract is missing stage ${stageId}`);
    }
  }
  for (const expected of [
    "setProjectAgentIntentForLab",
    "setAgentIntentInternal(projectId, intent, INTERNAL_ACTION_TOKEN)",
    "ra-356.project-agent-intent-result.v1",
    "This is the same Agent OFF/ON owner used by arena-ctl and operator actions",
    "does not relaunch, retry, recreate runtime, patch task truth or create proof/evidence",
  ]) {
    if (!adminLabSource.includes(expected)) {
      result.push(`admin-lab.ts lifecycle action path is missing ${expected}`);
    }
  }
  for (const expected of [
    "Pause agent",
    "Resume agent",
    "existing governance Agent lifecycle owner",
    "must not be implemented as a Lab-only pause state",
    "must not relaunch, retry, recreate runtime, patch task truth or create proof/evidence",
  ]) {
    if (!contractIncludes(adminLabContractBody, expected)) {
      result.push(`admin-laboratory-contract.md is missing lifecycle action marker: ${expected}`);
    }
  }
  return result;
}

function checkAdminLabRunRouteStrictInputs(routeSource) {
  const result = [];
  if (!routeSource.includes("assertAdminLabRunRequestKeys")) {
    result.push("route.ts Admin Lab browser runs must use the shared fail-closed request-key guard");
  }
  for (const { stageId, code } of ADMIN_LAB_RUN_STRICT_REQUEST_SCHEMAS) {
    if (!routeSource.includes(`"${stageId}"`)) {
      result.push(`route.ts Admin Lab browser-run input contract is missing stage ${stageId}`);
    }
    if (!routeSource.includes(code)
      && !(ADMIN_LAB_RUN_DYNAMIC_REQUEST_CODE_STAGES.has(stageId) && routeSource.includes("`invalid_${stageId}_options`"))) {
      result.push(`route.ts Admin Lab browser-run input contract is missing ${code}`);
    }
  }
  for (const forbidden of [
    "assertPromptReplayRequestKeys",
    "assertVisualWorkbenchManifestRequestKeys",
  ]) {
    if (routeSource.includes(forbidden)) {
      result.push(`route.ts must not keep stage-specific request-key helper ${forbidden}; use the shared fail-closed guard`);
    }
  }
  return result;
}

function checkAdminLabPromptContractReplayRun(adminLabSource, routeSource, adminLabContractBody) {
  const result = [];
  const stageBlock = extractAdminLabStageBlock(adminLabSource, "prompt_contract_replay");
  if (!stageBlock) {
    result.push("admin-lab.ts is missing prompt_contract_replay stage block");
    return result;
  }
  for (const expected of [
    'runSurface: "admin_lab_run"',
    'mode: "fixture"',
    'ownerBoundary: "ralph.prompt-repository"',
    "currentCommand: null",
  ]) {
    if (!stageBlock.includes(expected)) {
      result.push(`admin-lab.ts prompt_contract_replay block is missing ${expected}`);
    }
  }
  for (const expected of [
    "PROMPT_REPLAY_FIXTURES",
    "product_skill",
    "ux_skill",
    "executor-product-skill.json",
    "executor-ux-skill.json",
    "normalizePromptContractReplayOptions",
    "runPromptContractReplayHelper",
    "buildPromptContractReplayArgs",
    '"prompts"',
    '"replay"',
    '"--fixture"',
    '"--out"',
    "validatePromptReplayResult",
    "PROMPT_CONTRACT_REPLAY_RESULT_SCHEMA_VERSION",
    "PROMPT_CONTRACT_REPLAY_SHA256_PATTERN",
    "prompt_replay_invalid_output",
    "prompt_replay_prompt_id_mismatch",
    "Governance did not render prompt bodies itself",
  ]) {
    if (!adminLabSource.includes(expected)) {
      result.push(`admin-lab.ts prompt_contract_replay UI-run path is missing ${expected}`);
    }
  }
  for (const expected of [
    'stageId === "prompt_contract_replay"',
    "assertAdminLabRunRequestKeys",
    '[...baseKeys, "promptReplayFixture"]',
    "invalid_prompt_replay_options",
    'promptReplayFixture as AdminLabRunOptions["promptReplayFixture"]',
  ]) {
    if (!routeSource.includes(expected)) {
      result.push(`route.ts prompt_contract_replay input contract is missing ${expected}`);
    }
  }
  if (!adminLabContractBody.includes("prompt_contract_replay")
    || !contractIncludes(adminLabContractBody, "fixed product/UX role-skill fixture")) {
    result.push("admin-laboratory-contract.md must document the bounded prompt_contract_replay browser runner boundary");
  }
  return result;
}

function checkAdminLabPlannerProjectDryRun(adminLabSource, adminLabContractBody) {
  const result = [];
  const stageBlock = extractAdminLabStageBlock(adminLabSource, "planner_project_dry_run");
  if (!stageBlock) {
    result.push("admin-lab.ts is missing planner_project_dry_run stage block");
    return result;
  }
  for (const expected of [
    'runSurface: "admin_lab_run"',
    'mode: "workspace_dry_run"',
    'ownerBoundary: "ralph.planner.dry-run-adapter"',
  ]) {
    if (!stageBlock.includes(expected)) {
      result.push(`admin-lab.ts planner_project_dry_run block is missing ${expected}`);
    }
  }
  for (const expected of [
    "runPlannerProjectDryRunHelper",
    "runProjectStageSnapshotHelper",
    "cloneSnapshotSourceToTempFork",
    "buildPlannerProjectDryRunArgs",
    '"planner_project_dry_run"',
    '"--visual-evidence-mode"',
    "readPlannerSnapshotSource",
    "validatePlannerProjectDryRunResult",
    "planner_project_dry_run_invalid_output",
  ]) {
    if (!adminLabSource.includes(expected)) {
      result.push(`admin-lab.ts planner_project_dry_run UI-run path is missing ${expected}`);
    }
  }
  if (!adminLabContractBody.includes("planner_project_dry_run")
    || !adminLabContractBody.includes("does not render planner prompts")
    || !adminLabContractBody.includes("validates only the returned Ralph stage envelope")) {
    result.push("admin-laboratory-contract.md must document the bounded planner_project_dry_run browser runner boundary");
  }
  return result;
}

function checkAdminLabControllerProjectDryRun(adminLabSource, adminLabContractBody) {
  const result = [];
  const stageBlock = extractAdminLabStageBlock(adminLabSource, "controller_project_dry_run");
  if (!stageBlock) {
    result.push("admin-lab.ts is missing controller_project_dry_run stage block");
    return result;
  }
  for (const expected of [
    'runSurface: "admin_lab_run"',
    'mode: "workspace_dry_run"',
    'ownerBoundary: "ralph.controller.dry-run-adapter"',
  ]) {
    if (!stageBlock.includes(expected)) {
      result.push(`admin-lab.ts controller_project_dry_run block is missing ${expected}`);
    }
  }
  for (const expected of [
    "runControllerProjectDryRunHelper",
    "runProjectStageSnapshotHelper",
    "cloneSnapshotSourceToTempFork",
    "buildControllerProjectDryRunArgs",
    '"controller_project_dry_run"',
    '"--trigger"',
    '"--visual-evidence-mode"',
    "readPlannerSnapshotSource",
    "validateControllerProjectDryRunResult",
    "controller_project_dry_run_invalid_output",
  ]) {
    if (!adminLabSource.includes(expected)) {
      result.push(`admin-lab.ts controller_project_dry_run UI-run path is missing ${expected}`);
    }
  }
  if (!adminLabContractBody.includes("controller_project_dry_run")
    || !contractIncludes(adminLabContractBody, "Governance does not render controller prompts")
    || !adminLabContractBody.includes("validates only the returned Ralph stage envelope")) {
    result.push("admin-laboratory-contract.md must document the bounded controller_project_dry_run browser runner boundary");
  }
  return result;
}

function checkAdminLabExecutorProjectTaskRun(adminLabSource, adminLabContractBody) {
  const result = [];
  const stageBlock = extractAdminLabStageBlock(adminLabSource, "executor_project_task");
  if (!stageBlock) {
    result.push("admin-lab.ts is missing executor_project_task stage block");
    return result;
  }
  for (const expected of [
    'runSurface: "admin_lab_run"',
    'mode: "workspace_mutation"',
    'ownerBoundary: "ralph.executor-project-task-adapter"',
  ]) {
    if (!stageBlock.includes(expected)) {
      result.push(`admin-lab.ts executor_project_task block is missing ${expected}`);
    }
  }
  for (const expected of [
    "runExecutorProjectTaskHelper",
    "runProjectStageSnapshotHelper",
    "buildExecutorProjectTaskArgs",
    '"executor_project_task"',
    '"--workspace-mode"',
    '"live_workspace_action"',
    "validateExecutorProjectTaskResult",
    "executor_project_task_invalid_output",
  ]) {
    if (!adminLabSource.includes(expected)) {
      result.push(`admin-lab.ts executor_project_task UI-run path is missing ${expected}`);
    }
  }
  if (!adminLabContractBody.includes("executor_project_task")
    || !adminLabContractBody.includes("does not render executor prompts")
    || !adminLabContractBody.includes("validates only the returned Ralph stage envelope")) {
    result.push("admin-laboratory-contract.md must document the bounded executor_project_task browser runner boundary");
  }
  return result;
}

function checkAdminLabVisualWorkbenchManifestReadinessRun(adminLabSource, routeSource, adminLabContractBody) {
  const result = [];
  const stageBlock = extractAdminLabStageBlock(adminLabSource, "visual_workbench_manifest_readiness");
  if (!stageBlock) {
    result.push("admin-lab.ts is missing visual_workbench_manifest_readiness stage block");
    return result;
  }
  for (const expected of [
    'runSurface: "admin_lab_run"',
    'mode: "read_only"',
    'ownerBoundary: "ra-355.visual-workbench-manifest"',
    "currentCommand: null",
  ]) {
    if (!stageBlock.includes(expected)) {
      result.push(`admin-lab.ts visual_workbench_manifest_readiness block is missing ${expected}`);
    }
  }
  for (const expected of [
    "runVisualWorkbenchManifestReadinessHelper",
    "runProjectStageSnapshotHelper",
    "buildVisualWorkbenchManifestReadinessArgs",
    "readVisualWorkbenchSnapshotSource",
    '"visual-workbench"',
    '"inspect"',
    '"--source-ref"',
    "Governance did not accept client workDir",
  ]) {
    if (!adminLabSource.includes(expected)) {
      result.push(`admin-lab.ts visual_workbench_manifest_readiness UI-run path is missing ${expected}`);
    }
  }
  for (const expected of [
    'stageId === "visual_workbench_manifest_readiness"',
    "assertAdminLabRunRequestKeys",
    '[...baseKeys, "tail"]',
    "invalid_visual_workbench_manifest_options",
  ]) {
    if (!routeSource.includes(expected)) {
      result.push(`route.ts visual_workbench_manifest_readiness input contract is missing ${expected}`);
    }
  }
  if (!adminLabContractBody.includes("visual_workbench_manifest_readiness")
    || !contractIncludes(adminLabContractBody, "ready manifest result only means")) {
    result.push("admin-laboratory-contract.md must document the bounded visual_workbench_manifest_readiness browser runner boundary");
  }
  return result;
}

function checkAdminLabVisualWorkbenchSelectorReadinessRun(adminLabSource, adminLabContractBody, adminLabTestSource) {
  const result = [];
  const stageBlock = extractAdminLabStageBlock(adminLabSource, "visual_workbench_selector_readiness");
  if (!stageBlock) {
    result.push("admin-lab.ts is missing visual_workbench_selector_readiness stage block");
    return result;
  }
  for (const expected of [
    'runSurface: "admin_lab_run"',
    'mode: "read_only"',
    'ownerBoundary: "ralph.visual-workbench-selector-readiness"',
    "currentCommand: null",
  ]) {
    if (!stageBlock.includes(expected)) {
      result.push(`admin-lab.ts visual_workbench_selector_readiness block is missing ${expected}`);
    }
  }
  for (const expected of [
    "runVisualWorkbenchSelectorReadinessHelper",
    "runProjectStageSnapshotHelper",
    "assertVisualWorkbenchSelectorHandoffReady",
    "buildVisualWorkbenchSelectorReadinessArgs",
    "readVisualWorkbenchTaskSnapshotSource",
    "selector_visual_handoff_blocked",
    "selectedTaskVisualReadback",
    "canCheckStorySelection",
    '"visual-workbench"',
    '"selector-readiness"',
    '"--task"',
  ]) {
    if (!adminLabSource.includes(expected)) {
      result.push(`admin-lab.ts visual_workbench_selector_readiness UI-run path is missing ${expected}`);
    }
  }
  if (!adminLabContractBody.includes("visual_workbench_selector_readiness")
    || !adminLabContractBody.includes("ready selector result only means")) {
    result.push("admin-laboratory-contract.md must document the bounded visual_workbench_selector_readiness browser runner boundary");
  }
  if (!contractIncludes(adminLabContractBody, "Project Stage Snapshot.selectedTaskVisualReadback")
    || !contractIncludes(adminLabContractBody, "canCheckStorySelection=true")
    || !contractIncludes(adminLabContractBody, "nextProjectActionId=check_story_selection")
    || !contractIncludes(adminLabContractBody, "must not call the selector-readiness owner")
    || !contractIncludes(adminLabContractBody, "must not reconstruct a different answer from raw task, policy or manifest fields")) {
    result.push("admin-laboratory-contract.md must document the selected-task visual readback gate before selector readiness");
  }
  if (!adminLabTestSource.includes("blocks visual_workbench_selector_readiness when snapshot visual readback is not ready")
    || !adminLabTestSource.includes("selector_visual_handoff_blocked")
    || !adminLabTestSource.includes("toHaveBeenCalledTimes(1)")) {
    result.push("admin-lab.test.ts must cover blocked selector readiness without calling the Ralph selector owner");
  }
  return result;
}

function checkAdminLabVisualWorkbenchShellPolicyRun(adminLabSource, routeSource, adminLabContractBody) {
  const result = [];
  const stageBlock = extractAdminLabStageBlock(adminLabSource, "visual_workbench_shell_policy");
  if (!stageBlock) {
    result.push("admin-lab.ts is missing visual_workbench_shell_policy stage block");
    return result;
  }
  for (const expected of [
    'runSurface: "admin_lab_run"',
    'mode: "read_only"',
    'ownerBoundary: "ralph.visual-workbench-shell-policy"',
    "currentCommand: null",
  ]) {
    if (!stageBlock.includes(expected)) {
      result.push(`admin-lab.ts visual_workbench_shell_policy block is missing ${expected}`);
    }
  }
  for (const expected of [
    "runVisualWorkbenchShellPolicyHelper",
    "runProjectStageSnapshotHelper",
    "buildVisualWorkbenchShellPolicyArgs",
    "readVisualWorkbenchTaskSnapshotSource",
    '"visual-workbench"',
    '"shell-policy"',
    '"--config"',
    '".arena"',
    '"ralph.config.json"',
    "runner-owned .arena/ralph.config.json",
    "Governance did not accept client workDir",
    "does not execute the Workbench serve command",
  ]) {
    if (!adminLabSource.includes(expected)) {
      result.push(`admin-lab.ts visual_workbench_shell_policy UI-run path is missing ${expected}`);
    }
  }
  for (const expected of [
    'stageId === "visual_workbench_shell_policy"',
  ]) {
    if (!routeSource.includes(expected)) {
      result.push(`route.ts visual_workbench_shell_policy input contract is missing ${expected}`);
    }
  }
  if (!adminLabContractBody.includes("visual_workbench_shell_policy")
    || !contractIncludes(adminLabContractBody, "does not execute the Workbench serve command")
    || !contractIncludes(adminLabContractBody, "must not accept client config, manifest, baseUrl or outDir")) {
    result.push("admin-laboratory-contract.md must document the bounded visual_workbench_shell_policy browser runner boundary");
  }
  return result;
}

function checkAdminLabVisualWorkbenchBrowserReadinessRun(adminLabSource, adminLabContractBody) {
  const result = [];
  const stageBlock = extractAdminLabStageBlock(adminLabSource, "visual_workbench_browser_readiness");
  if (!stageBlock) {
    result.push("admin-lab.ts is missing visual_workbench_browser_readiness stage block");
    return result;
  }
  for (const expected of [
    'runSurface: "admin_lab_run"',
    'mode: "read_only"',
    'ownerBoundary: "platform.browser-readiness"',
    "currentCommand: null",
  ]) {
    if (!stageBlock.includes(expected)) {
      result.push(`admin-lab.ts visual_workbench_browser_readiness block is missing ${expected}`);
    }
  }
  for (const expected of [
    "runVisualWorkbenchBrowserReadinessHelper",
    "buildVisualWorkbenchBrowserReadinessArgs",
    '"visual-workbench"',
    '"browser-readiness"',
    '"--compact"',
    "Governance did not accept project workDir",
  ]) {
    if (!adminLabSource.includes(expected)) {
      result.push(`admin-lab.ts visual_workbench_browser_readiness UI-run path is missing ${expected}`);
    }
  }
  if (!adminLabContractBody.includes("visual_workbench_browser_readiness")
    || !adminLabContractBody.includes("does not accept project workspace")) {
    result.push("admin-laboratory-contract.md must document the bounded visual_workbench_browser_readiness browser runner boundary");
  }
  return result;
}

function checkAdminLabVisualWorkbenchAutomationStatusRun(adminLabSource, adminLabContractBody) {
  const result = [];
  const stageBlock = extractAdminLabStageBlock(adminLabSource, "visual_workbench_automation_status");
  if (!stageBlock) {
    result.push("admin-lab.ts is missing visual_workbench_automation_status stage block");
    return result;
  }
  for (const expected of [
    'runSurface: "admin_lab_run"',
    'mode: "read_only"',
    'ownerBoundary: "ralph.visual-workbench-automation-diagnostic-readback"',
    "currentCommand: null",
  ]) {
    if (!stageBlock.includes(expected)) {
      result.push(`admin-lab.ts visual_workbench_automation_status block is missing ${expected}`);
    }
  }
  for (const expected of [
    "runVisualWorkbenchAutomationStatusHelper",
    "runProjectStageSnapshotHelper",
    "buildVisualWorkbenchAutomationStatusArgs",
    "readVisualWorkbenchTaskSnapshotSource",
    '"visual-workbench"',
    '"automation-status"',
    '"--task"',
    "Governance did not accept project workDir",
  ]) {
    if (!adminLabSource.includes(expected)) {
      result.push(`admin-lab.ts visual_workbench_automation_status UI-run path is missing ${expected}`);
    }
  }
  if (!adminLabContractBody.includes("visual_workbench_automation_status")
    || !adminLabContractBody.includes("diagnostic readback only")) {
    result.push("admin-laboratory-contract.md must document the bounded visual_workbench_automation_status browser runner boundary");
  }
  return result;
}

function checkAdminLabVisualWorkbenchEvidenceChainReadinessRun(adminLabSource, adminLabContractBody) {
  const result = [];
  const stageBlock = extractAdminLabStageBlock(adminLabSource, "visual_workbench_evidence_chain_readiness");
  if (!stageBlock) {
    result.push("admin-lab.ts is missing visual_workbench_evidence_chain_readiness stage block");
    return result;
  }
  for (const expected of [
    'runSurface: "admin_lab_run"',
    'mode: "read_only"',
    'ownerBoundary: "ralph.visual-evidence-chain-readiness"',
    "currentCommand: null",
  ]) {
    if (!stageBlock.includes(expected)) {
      result.push(`admin-lab.ts visual_workbench_evidence_chain_readiness block is missing ${expected}`);
    }
  }
  for (const expected of [
    "runVisualWorkbenchEvidenceChainReadinessHelper",
    "runProjectStageSnapshotHelper",
    "buildVisualWorkbenchEvidenceChainReadinessArgs",
    "readVisualWorkbenchTaskSnapshotSource",
    '"visual-workbench"',
    '"evidence-chain-readiness"',
    '"--task"',
    '"--project-id"',
    "Governance did not accept project workDir",
  ]) {
    if (!adminLabSource.includes(expected)) {
      result.push(`admin-lab.ts visual_workbench_evidence_chain_readiness UI-run path is missing ${expected}`);
    }
  }
  if (!adminLabContractBody.includes("visual_workbench_evidence_chain_readiness")
    || !contractIncludes(adminLabContractBody, "nextCommands are manual handoffs")) {
    result.push("admin-laboratory-contract.md must document the bounded visual_workbench_evidence_chain_readiness browser runner boundary");
  }
  if (!contractIncludes(adminLabContractBody, "captureViewer.viewerPath")
    || !contractIncludes(adminLabContractBody, "report.capture.viewerPath")
    || !contractIncludes(adminLabContractBody, "copy-only screenshot catalog handle")
    || !contractIncludes(adminLabContractBody, "copy a `file://` URL")
    || !contractIncludes(adminLabContractBody, "must not open, proxy, read, render or validate the local file")
    || !contractIncludes(adminLabContractBody, "must not open, proxy, scan or render that file from governance")
    || !contractIncludes(adminLabContractBody, "not raw artifact scanning, screenshot evidence, proof truth, progress publish or Telegram screenshot-review availability")) {
    result.push("admin-laboratory-contract.md must keep captureViewer scoped to a copy-only screenshot catalog readback");
  }
  return result;
}

function extractAdminLabCurrentCommand(adminLabSource, stageId) {
  const stageBlock = extractAdminLabStageBlock(adminLabSource, stageId);
  if (!stageBlock) return null;
  const commandMarker = "currentCommand: `${RALPH_RUNTIME_REPO_ROOT_COMMAND} ";
  const commandStart = stageBlock.indexOf(commandMarker);
  if (commandStart !== -1) {
    const commandBodyStart = commandStart + commandMarker.length;
    const commandEnd = stageBlock.indexOf("`", commandBodyStart);
    if (commandEnd === -1) return null;
    return `${readAdminLabPrefix(adminLabSource)} ${stageBlock.slice(commandBodyStart, commandEnd)}`;
  }

  const stringCommandMatch = /currentCommand: "([^"]+)"/.exec(stageBlock);
  return stringCommandMatch?.[1] ?? null;
}

function contractIncludes(docBody, phrase) {
  return normalizeContractText(docBody).includes(normalizeContractText(phrase));
}

function normalizeContractText(value) {
  return String(value).replace(/`/g, "").replace(/\s+/g, " ").trim();
}

function extractAdminLabStageBlock(adminLabSource, stageId) {
  const stageStart = adminLabSource.indexOf(`id: "${stageId}",`);
  if (stageStart === -1) return null;
  const nextStageStart = adminLabSource.indexOf("\n  {\n    id:", stageStart + 1);
  return adminLabSource.slice(stageStart, nextStageStart === -1 ? undefined : nextStageStart);
}

function readAdminLabPrefix(adminLabSource) {
  return /const RALPH_RUNTIME_REPO_ROOT_COMMAND = "([^"]+)";/.exec(adminLabSource)?.[1] ?? "";
}

function stripRalphBinary(command) {
  return String(command ?? "").replace(/^ralph\s+/, "");
}

function checkProductActionMap() {
  const result = [];
  const labUiSource = `${labTab}\n${adminLabActions}`;
  const docs = [
    ["RA-356 plan.md", plan],
    ["RA-356 architecture.md", architecture],
    ["RA-356 shared-production-brick-map.md", sharedProductionBrickMap],
    ["RA-356 stage-use-cases.md", stageUseCases],
    ["RA-356 manual-experiment-cases.md", manualCases],
    ["RA-356 stage-run-contract.md", stageRunContract],
    ["RA-356 user-brief-and-dialogue-notes.md", userBrief],
    ["RA backlog", backlog],
    ["Admin Lab UI action definitions", labUiSource],
    ["Admin Lab UI test", labTabTest],
  ];

  for (const [docName, body] of docs) {
    for (const label of PRODUCT_ACTION_LABELS) {
      if (!includesText(body, label)) {
        result.push(`${docName} is missing Lab product action label: ${label}`);
      }
    }
  }

  if (!stageRunContract.includes("This layer is presentation and workflow guidance only")) {
    result.push("stage-run-contract.md must keep the product-action layer scoped away from a second catalog/scheduler");
  }
  if (!includesText(stageRunContract, "primary UX must start from repository/project state")) {
    result.push("stage-run-contract.md must keep the repository-state-first Lab UX rule");
  }
  if (!architecture.includes("selected RA-356 v1 product direction")) {
    result.push("architecture.md must record the selected RA-356 v1 Lab UX direction");
  }
  if (!plan.includes("Lab UX course lock")) {
    result.push("plan.md must keep the latest Lab UX course lock visible");
  }
  if (!includesText(manualCases, "No card creates lifecycle truth, task truth, proof truth or source truth")) {
    result.push("manual-experiment-cases.md must keep the one-stage/no-second-truth rule");
  }
  if (!includesText(manualCases, "`Check visual stories` / `Check story selection` /")
    || !includesText(manualCases, "`Check capture policy` / `Check browser` / `Copy screenshot command`")) {
    result.push("manual-experiment-cases.md must list Check capture policy in the plain visual action sequence");
  }
  if (!contractIncludes(adminLabContract, "Check visual stories")
    || !contractIncludes(adminLabContract, "read-only manifest readiness")
    || !contractIncludes(adminLabContract, "does not capture screenshots or create evidence")) {
    result.push("admin-laboratory-contract.md must keep Check visual stories scoped to manifest readiness only");
  }
  if (!contractIncludes(adminLabContract, "Check story selection")
    || !contractIncludes(adminLabContract, "read-only selector readiness")
    || !contractIncludes(adminLabContract, "does not capture screenshots, export evidence or infer screenshot availability")) {
    result.push("admin-laboratory-contract.md must keep Check story selection scoped to selector readiness only");
  }
  if (!contractIncludes(adminLabContract, "Check capture policy")
    || !contractIncludes(adminLabContract, "read-only Workbench shell policy")
    || !contractIncludes(adminLabContract, "does not execute the Workbench serve command, capture screenshots, export evidence or infer screenshot availability")) {
    result.push("admin-laboratory-contract.md must keep Check capture policy scoped to shell-policy readback only");
  }
  for (const expected of [
    'id: "check_capture_policy"',
    "Check capture policy",
    'stageId: "visual_workbench_shell_policy"',
    'title: "Workbench capture policy"',
    "isShellPolicyStage",
    "isShellPolicyTaskIdInvalid",
    "If ready, check selector, capture policy and browser readiness before manual screenshot handoff.",
    "Fix task/story links if blocked, or continue to capture policy before browser readiness and evidence automation.",
  ]) {
    if (!labUiSource.includes(expected) || !labTabTest.includes(expected)) {
      result.push(`Admin Lab UI/test is missing Check capture policy marker: ${expected}`);
    }
  }
  if (labTab.includes("LAB_WORKFLOW_STEPS") || labTab.includes("visibleWorkflowSteps") || labTab.includes("Usual path")) {
    result.push("Admin Lab UI must not render a standalone usual-path workflow beside primary actions");
  }
  if (!labTabTest.includes("does not render a standalone ordered workflow beside primary actions")
    || !labTabTest.includes('not.toContain("LAB_WORKFLOW_STEPS")')
    || !labTabTest.includes('not.toContain("Usual path")')) {
    result.push("Admin Lab UI test must guard against standalone usual-path workflow returning");
  }
  if (!contractIncludes(adminLabContract, "Check browser")
    || !contractIncludes(adminLabContract, "read-only platform/browser readiness")
    || !contractIncludes(adminLabContract, "does not capture screenshots, install browsers or mutate project workspace")) {
    result.push("admin-laboratory-contract.md must keep Check browser scoped to platform browser readiness only");
  }
  if (!contractIncludes(adminLabContract, "Check screenshot run")
    || !contractIncludes(adminLabContract, "read-only automation status")
    || !contractIncludes(adminLabContract, "does not capture screenshots, export evidence, publish progress or infer screenshot availability")) {
    result.push("admin-laboratory-contract.md must keep Check screenshot run scoped to automation-status readback only");
  }
  if (!contractIncludes(adminLabContract, "Check evidence chain")
    || !contractIncludes(adminLabContract, "read-only evidence-chain readiness")
    || !contractIncludes(adminLabContract, "nextCommands are manual handoffs, not browser-run continuations")) {
    result.push("admin-laboratory-contract.md must keep Check evidence chain scoped to evidence-chain readback only");
  }
  if (!contractIncludes(adminLabContract, "Ingest evidence")
    || !contractIncludes(adminLabContract, "copy the explicit Arena ingest command")
    || !contractIncludes(adminLabContract, "must not browser-run ingest, infer proof, scan raw folders or mark screenshots reviewable")) {
    result.push("admin-laboratory-contract.md must keep Ingest evidence scoped to direct CLI ingest handoff only");
  }
  if (!contractIncludes(adminLabContract, "Check screenshot files")
    || !contractIncludes(adminLabContract, "read-only artifact downloadability")
    || !contractIncludes(adminLabContract, "must not expose raw storage paths, scan raw folders, create evidence or infer proof")) {
    result.push("admin-laboratory-contract.md must keep Check screenshot files scoped to artifact downloadability readback only");
  }
  if (!contractIncludes(adminLabContract, "If a `Check story selection` result is ready")
    || !contractIncludes(adminLabContract, "fills the same task into `Check capture policy`")
    || !contractIncludes(adminLabContract, "must not run shell policy, start Workbench, capture screenshots, export evidence")
    || !labTab.includes("getSelectorCapturePolicyHandoff")
    || !labTab.includes("Fill capture policy")) {
    result.push("Admin Lab must keep selector-to-capture-policy handoff as explicit input assistance only");
  }
  if (!contractIncludes(adminLabContract, "If a `Check capture policy` result is allowed")
    || !contractIncludes(adminLabContract, "selects `Check browser`")
    || !contractIncludes(adminLabContract, "must not run browser readiness, start Workbench, capture screenshots, export evidence")
    || !labTab.includes("getShellPolicyBrowserReadinessHandoff")
    || !labTab.includes("Fill browser check")) {
    result.push("Admin Lab must keep capture-policy-to-browser handoff as explicit input assistance only");
  }
  if (!contractIncludes(adminLabContract, "If a `Check browser` result is ready")
    || !contractIncludes(adminLabContract, "selects the copy-only `Copy screenshot command` handoff")
    || !contractIncludes(adminLabContract, "Browser readiness is platform-scoped and does not own project")
    || !contractIncludes(adminLabContract, "must not fill missing project/workspace/source")
    || !labTab.includes("getBrowserReadinessScreenshotHandoff")
    || !labTab.includes("Fill screenshot handoff")) {
    result.push("Admin Lab must keep browser-to-screenshot handoff as copy-only input assistance");
  }
  if (!labTab.includes("Debug: stage catalog") || !labTab.includes("Normal work starts from Project actions above.")) {
    result.push("Admin Lab UI must keep raw stage controls behind a clearly marked debug stage catalog");
  }
  if (!contractIncludes(adminLabContract, "For primary `Copy CLI` actions")
    || !contractIncludes(adminLabContract, "the operator must not have to open advanced controls just to see or fill the handoff")) {
    result.push("admin-laboratory-contract.md must keep primary Copy CLI handoffs visible outside advanced controls");
  }
  if (!contractIncludes(adminLabContract, "use context values")
    || !contractIncludes(adminLabContract, "it must not reread project source, rescan tasks, run Workbench or infer missing command values")) {
    result.push("admin-laboratory-contract.md must keep context value fill scoped to disposable snapshot input assistance");
  }
  for (const expected of [
    "Terminal handoff",
    'selectedStage?.runSurface === "direct_cli" && renderTerminalCommandPanel("primary")',
    'selectedStage.runSurface !== "direct_cli" && renderTerminalCommandPanel("advanced")',
    "commandInputPlaceholdersWithSnapshotHints",
    "Use context values",
  ]) {
    if (!labTab.includes(expected)) {
      result.push(`Admin Lab UI is missing primary Copy CLI handoff marker: ${expected}`);
    }
  }
  for (const expected of [
    "Project provider settings",
    "Use project settings",
    "normalizeLabExecutorAgent",
    "handleUseProjectProviderSettings",
    "setExecutorAgent(selectedProjectLabAgent)",
    "setExecutorModel(selectedProjectModel)",
  ]) {
    if (!labTab.includes(expected)) {
      result.push(`Admin Lab UI is missing explicit project-provider settings helper marker: ${expected}`);
    }
  }
  if (!contractIncludes(adminLabContract, "use selected project settings")
    || !contractIncludes(adminLabContract, "the backend must still receive explicit provider settings and must not invent hidden provider/model defaults")) {
    result.push("admin-laboratory-contract.md must keep the project-provider helper scoped away from hidden provider/model defaults");
  }
  if (!contractIncludes(adminLabContract, "cannot reach the governance admin API")
    || !contractIncludes(adminLabContract, "attempted admin boundary and local service/tunnel check")
    || !contractIncludes(adminLabContract, "must not retry, switch URLs, start services, mutate lifecycle or fall back to raw DB/Docker reads")) {
    result.push("admin-laboratory-contract.md must keep arena-ctl governance transport failures as explicit operator blockers only");
  }
  for (const expected of [
    "formatGovernanceTransportError",
    "failed before HTTP response from",
    "GOVERNANCE_ADMIN_URL/GOVERNANCE_URL",
    "timed out after",
  ]) {
    if (!arenaCtlGovernanceClient.includes(expected)) {
      result.push(`arena-ctl governance client is missing transport diagnostic marker: ${expected}`);
    }
    if (!arenaCtlGovernanceClientTest.includes(expected)) {
      result.push(`arena-ctl governance client test is missing transport diagnostic marker: ${expected}`);
    }
  }
  if (!contractIncludes(adminLabContract, "visualEvidenceMode=off|required|new_tasks_only")
    || !contractIncludes(adminLabContract, "changing the field affects the one manual dry-run request")
    || !contractIncludes(adminLabContract, "does not mutate project runtime config, task truth, proof truth, lifecycle truth or screenshot availability")
    || !contractIncludes(adminLabContract, "must stay blocked instead of reusing stale UI-local mode")
    || !contractIncludes(adminLabContract, "not a fallback to off")
    || !contractIncludes(adminLabContract, "backend-enforced for the runnable Lab dry-run owner")) {
    result.push("admin-laboratory-contract.md must keep project visualEvidenceMode readback scoped away from hidden policy mutation");
  }
  if (!contractIncludes(adminLabContract, "Project Stage Snapshot must also expose this policy as a sanitized")
    || !contractIncludes(adminLabContract, "visualEvidencePolicy")
    || !contractIncludes(adminLabContract, "governance.runner-init-readiness.ralphConfig")
    || !contractIncludes(adminLabContract, "shared `ralph.executor-observer` visual-evidence helper")
    || !contractIncludes(adminLabContract, "must not accept a client-supplied executor visual mode")
    || !contractIncludes(adminLabContract, "must not derive required/off locally from only task.visualEvidenceRequired")
    || !labUiSource.includes("Selected live project workspace and visual policy from task context.")
    || !labUiSource.includes("Uses shared executor helpers and visual policy gating")
    || !adminLab.includes("Governance did not accept an executor visual-mode input; Ralph used the snapshot visualEvidencePolicy through the shared executor-observer helper.")) {
    result.push("admin-laboratory-contract.md must keep executor visual policy owned by Project Stage Snapshot and ralph.executor-observer");
  }
  for (const expected of [
    "assertProjectVisualEvidencePolicyReadable",
    "invalid_project_visual_evidence_mode",
    "Project visual evidence policy must be readable before this dry-run",
  ]) {
    if (!adminLab.includes(expected)) {
      result.push(`admin-lab.ts is missing backend visualEvidenceMode readback gate marker: ${expected}`);
    }
  }
  if (!contractIncludes(adminLabContract, "the result belongs directly under the selected action surface")) {
    result.push("admin-laboratory-contract.md must keep Lab results directly under the selected action surface");
  }
  if (!contractIncludes(adminLabContract, "visible labels `Uses`, `You provide` and")
    || !contractIncludes(adminLabContract, "`You get`")
    || !contractIncludes(adminLabContract, "These are presentation fields over existing owners")
    || !contractIncludes(adminLabContract, "must not become a second stage catalog")) {
    result.push("admin-laboratory-contract.md must keep primary-action Uses/You provide/You get scoped to presentation over existing owners");
  }
  if (!contractIncludes(adminLabContract, "Brick status")
    || !contractIncludes(adminLabContract, "same primary action entry")
    || !contractIncludes(adminLabContract, "must not decide readiness, run order, task truth, lifecycle truth or screenshot availability")
    || !labTab.includes("selectedActionBrickStatus")
    || !labTab.includes("Brick status")
    || !labUiSource.includes("Shared + debt")
    || !labUiSource.includes("browser-run promotion remains audited debt")) {
    result.push("Admin Lab must show primary action production relationship without creating a second workflow truth");
  }
  if (!contractIncludes(adminLabContract, "Primary action grouping is presentation only")
    || !contractIncludes(adminLabContract, "same shared `ADMIN_LAB_PROJECT_ACTIONS` entries")
    || !contractIncludes(adminLabContract, "must not introduce a second action catalog, sequence, readiness model or source of truth")) {
    result.push("admin-laboratory-contract.md must keep primary action grouping derived from ADMIN_LAB_PROJECT_ACTIONS");
  }
  if (!contractIncludes(adminLabContract, "Detailed visual-evidence actions may be collapsed")
    || !contractIncludes(adminLabContract, "stored only as UI presentation over `ADMIN_LAB_PROJECT_ACTIONS`")
    || !contractIncludes(adminLabContract, "must not move actions to a second catalog")
    || !contractIncludes(adminLabContract, "change readiness, run/copy behavior, task truth, proof truth or screenshot availability")) {
    result.push("admin-laboratory-contract.md must keep detailed visual actions as presentation-only collapse over ADMIN_LAB_PROJECT_ACTIONS");
  }
  if (!contractIncludes(adminLabContract, "Collect/check screenshots")
    || !contractIncludes(adminLabContract, "readback action")
    || !contractIncludes(adminLabContract, "must not capture screenshots, create evidence, export Workbench rows or ingest Arena assets")) {
    result.push("admin-laboratory-contract.md must keep Collect/check screenshots scoped to Arena readback only");
  }
  if (!contractIncludes(adminLabContract, "Interrupted/in-progress rows must be explained as checkpoint-gated")
    || !contractIncludes(adminLabContract, "failed/error provider-session checkpoint readback")
    || !contractIncludes(adminLabContract, "A successful provider session is not resumable work")
    || !contractIncludes(adminLabContract, "must not show interrupted scan rows with the same executor-ready affordance")
    || !contractIncludes(adminLabContract, "The executor run owner still performs the final agent/model/fingerprint/outcome match")
    || !contractIncludes(adminLabContract, "not a second task selector or retry policy")) {
    result.push("admin-laboratory-contract.md must keep interrupted executor handoff checkpoint-gated");
  }
  if (!contractIncludes(adminLabContract, "providerSessions.selectedTaskCheckpointReadback.canPrepareExecutor=true")
    || !contractIncludes(adminLabContract, "providerSessions.selectedTaskCheckpointReadback.nextProjectActionId")
    || !contractIncludes(adminLabContract, "success_checkpoint_not_resumable")
    || !contractIncludes(adminLabContract, "must not derive this handoff or executor readiness from raw `selectedTaskSessionCount`")
    || !projectStageSnapshot.includes("selectedTaskCheckpointReadback")
    || !projectStageSnapshot.includes("buildProviderSessionSelectedTaskCheckpointReadback")
    || !projectStageSnapshot.includes("success_checkpoint_not_resumable")
    || !projectStageSnapshot.includes("failed_error_checkpoint_ready")
    || !projectStageSnapshot.includes("canPrepareExecutor")
    || !adminLabSnapshotView.includes("providerSessions?.selectedTaskCheckpointReadback")
    || !adminLabSnapshotView.includes("readSnapshotCheckpointReadback")
    || adminLabSnapshotView.includes("hasOnlyNonResumableSelectedTaskHistory")
    || adminLabSnapshotView.includes("selectedTaskSessionCount > 0")
    || adminLabCommandTemplate.includes("selectedTaskResumableSessionCount")
    || !adminLabCommandTemplate.includes("selectedTaskCheckpointReadback")
    || !adminLabCommandTemplate.includes("canPrepareExecutor === true")
    || !adminLabSnapshotViewTest.includes("does not infer Resume agent handoff from raw provider-session counts")
    || !adminLabCommandTemplateTest.includes("does not fill resume_interrupted mode from raw resumable counts alone")
    || !labTabStories.includes("selectedTaskCheckpointReadback")) {
    result.push("Admin Lab checkpoint readiness must come from Project Stage Snapshot selectedTaskCheckpointReadback, not UI-local provider-session count inference");
  }
  if (!contractIncludes(adminLabContract, "`Find work` may also show `visualEvidenceRequired` counts and labels")
    || !contractIncludes(adminLabContract, "must not infer UI work from titles")
    || !contractIncludes(adminLabContract, "decide screenshot availability")
    || !contractIncludes(adminLabContract, "override the selected project `visualEvidenceMode`")) {
    result.push("admin-laboratory-contract.md must keep candidate visual-evidence labels readback-only");
  }
  if (!contractIncludes(adminLabContract, "Project Stage Snapshot.selectedTaskVisualReadback")
    || !contractIncludes(adminLabContract, "canCheckStorySelection=true")
    || !contractIncludes(adminLabContract, "nextProjectActionId=check_story_selection")
    || !contractIncludes(adminLabContract, "must not reconstruct a different answer from raw task, policy or manifest fields")
    || !projectStageSnapshot.includes("selectedTaskVisualReadback")
    || !projectStageSnapshot.includes("buildSelectedTaskVisualReadback")
    || !projectStageSnapshot.includes("selectedTaskNeedsVisualWorkbench")
    || !projectStageSnapshot.includes("check_story_selection_ready")
    || !projectStageSnapshot.includes("visual_evidence_not_required_for_task")
    || !adminLabSnapshotView.includes("getSnapshotSelectedTaskVisualReadback")
    || !adminLabSnapshotView.includes("readSnapshotSelectedTaskVisualReadback")
    || !adminLabSnapshotViewTest.includes("does not infer selected-task visual handoff from raw visual fields")
    || !labTab.includes("Visual task readback")
    || !labTab.includes("canCheckStorySelectionFromSnapshotReadback")
    || !labTab.includes("handleUseSelectedTaskVisualReadback")
    || !labTab.includes("handleUseCandidateScanVisualTaskContext")
    || labTab.includes("handleUseCandidateScanVisualStorySelection")
    || labTab.includes("handleUseVisualStorySelectionTask")
    || !labTabStories.includes("selectedTaskVisualReadback")
    || !labTabTest.includes("routes visual-marked candidate scan rows through snapshot readback before story selection")) {
    result.push("Admin Lab visual task handoff must come from Project Stage Snapshot selectedTaskVisualReadback, not candidate visualEvidenceRequired UI-local readiness");
  }
  if (!contractIncludes(adminLabContract, "visual task counts are known")
    || !contractIncludes(adminLabContract, "for every direct-executor candidate project")
    || !contractIncludes(adminLabContract, "Missing or partial visual count payloads must not be interpreted as zero visual tasks")) {
    result.push("admin-laboratory-contract.md must keep no-visual candidate notice fail-closed");
  }
  for (const expected of [
    "directExecutorCandidateProjects",
    "visualEvidenceCountsKnownForDirectCandidates",
    "No visual-marked executor task in this scan",
    "Use this scan when you do not need a visual-marked task",
  ]) {
    if (!candidateScanView.includes(expected)) {
      result.push(`candidate scan view is missing no-visual notice guard marker: ${expected}`);
    }
  }
  for (const expected of [
    "does not treat mixed known and missing visual counts as zero visual tasks",
    "does not treat partial visual counts as known zero visual tasks",
    "does not show the no-visual notice when a visual-marked candidate is present",
  ]) {
    if (!candidateScanViewTest.includes(expected)) {
      result.push(`candidate scan view test is missing no-visual guard case: ${expected}`);
    }
  }
  for (const expected of [
    "getSnapshotExecutorCheckpointReadback",
    "Executor checkpoint readback",
    "Get context first",
    "Checkpoint first",
    "Run Get task context first. Resume needs checkpoint readback before executor input is prepared.",
    "snapshotExecutorCheckpointReadback.message",
  ]) {
    if (!labTab.includes(expected)) {
      result.push(`Admin Lab UI is missing checkpoint-aware executor handoff marker: ${expected}`);
    }
  }
  if (!contractIncludes(adminLabContract, "visual_workbench_evidence_automation remains an explicit direct_cli workspace-mutation handoff")
    || !contractIncludes(adminLabContract, "must not make this stage browser-runnable by a simple runSurface flip")
    || !contractIncludes(adminLabContract, "The separate browser-runnable evidence automation action is an audited advanced mutation")
    || !contractIncludes(adminLabContract, "accept only selected projectId, selected taskId, optional bounded snapshot tail and an explicit operator confirmation")
    || !contractIncludes(adminLabContract, "must not auto-run artifact check, ingest, controller, retry, relaunch, Telegram delivery or proof review")) {
    result.push("admin-laboratory-contract.md must keep evidence automation split between copy-only CLI handoff and the separate advanced browser mutation");
  }
  if (!contractIncludes(sharedProductionBrickMap, "visual_workbench_evidence_automation must not become browser-runnable by flipping runSurface")
    || !contractIncludes(sharedProductionBrickMap, "visual_workbench_evidence_automation_run")
    || !contractIncludes(sharedProductionBrickMap, "server-derived workspace/source ref/manifest")
    || !contractIncludes(sharedProductionBrickMap, "config/base URL/outDir")
    || !contractIncludes(sharedProductionBrickMap, "no automatic ingest, artifact check, Telegram/proof readback or lifecycle follow-up")) {
    result.push("shared-production-brick-map.md must keep evidence automation browser-run promotion behind an audited advanced mutation boundary");
  }
  if (!contractIncludes(adminLabContract, "if Arena has no visualEvidenceReviews rows, the safe next action is an explicit Workbench evidence or visual_evidence_ingest handoff")
    || !contractIncludes(adminLabContract, "if Arena has rows but no safe review link, the safe next action is visual_evidence_artifact_check")
    || !contractIncludes(adminLabContract, "Both branches only select or point to an explicit next action")
    || !contractIncludes(adminLabContract, "must not auto-run ingest, scan raw artifact folders, create screenshot evidence, infer Telegram delivery failure or mark screenshots reviewable")) {
    result.push("admin-laboratory-contract.md must keep screenshot gap branches explicit and non-automatic");
  }
  if (!contractIncludes(adminLabContract, "If the UI adds plain-language labels to known nextCommands")
    || !contractIncludes(adminLabContract, "display-only")
    || !contractIncludes(adminLabContract, "must not decide readiness, replace the command string, select a stage, run a browser action or become a second command catalog")) {
    result.push("admin-laboratory-contract.md must keep evidence-chain command labels display-only");
  }
  for (const expected of [
    "Review links/readiness only; no screenshot capture or evidence creation.",
    "It will not capture screenshots, create evidence, scan raw folders or send Telegram messages.",
    "Screenshot catalog",
    "getAutomationStatusCaptureViewerHandoff",
    "This handle comes from Ralph captureViewer or automation-status readiness.",
    "Static viewer path was recorded by the automation diagnostic.",
    "Copy file URL",
    "Opening this catalog is manual: paste the file URL into a local browser.",
    "The Lab does not read raw files, render the viewer, capture screenshots, export evidence or mark screenshot review ready.",
    "screenshotReadbackGap.recordedRows > 0",
    "Use file check",
    "Use ingest handoff",
    "setSelectedProjectActionId(\"check_screenshot_files\")",
    "setSelectedProjectActionId(\"ingest_evidence\")",
    "No Telegram screenshot button is expected until Arena exposes reviewable visualEvidenceReviews.",
  ]) {
    if (!labUiSource.includes(expected)) {
      result.push(`Admin Lab UI is missing screenshot-readback scope marker: ${expected}`);
    }
  }
  if (!contractIncludes(adminLabContract, "current action readiness from the same visible inputs that gate the button")
    || !contractIncludes(adminLabContract, "not task truth, source truth, lifecycle truth or proof truth")) {
    result.push("admin-laboratory-contract.md must keep action readiness scoped to visible UI inputs");
  }
  if (!contractIncludes(adminLabContract, "Operator-facing copy should call this action `Get task context`")
    || !contractIncludes(adminLabContract, "technical owner name `Project Stage Snapshot` may appear in debug details")
    || !labTab.includes("Use before Get task context when you need a real project/task candidate.")
    || !labTab.includes("Pick a project/task row, then run Get task context for that exact task.")
    || !labTab.includes('title: "Task context"')
    || !labTab.includes("Task context was created as a disposable read-only artifact.")
    || !labTab.includes("Get context first")
    || !candidateScanView.includes("run Get task context for that task")
    || !candidateScanView.includes("Interrupted resume rows still need Get task context")) {
    result.push("Admin Lab must keep first-screen task-context copy simple while preserving Project Stage Snapshot as technical owner");
  }
  for (const expected of [
    "Action readiness",
    "projectActionGroups",
    "group.actions.map",
    "{group.label}",
    "Visual evidence mode",
    "selectedProjectVisualEvidenceMode",
    "useState<OpsVisualEvidenceMode>(\"off\")",
    "Planner and controller dry-runs start from this visible project policy",
    "Defaults to the selected project&apos;s visible policy.",
    "isProjectVisualEvidenceModeUnavailable",
    "Project visual evidence policy must be readable before this dry-run.",
    "selectedProjectVisualEvidenceModeError",
    "Project policy readback is invalid:",
    "Uses",
    "You provide",
    "You get",
    "selectedActionContext",
    "selectedActionArgument",
    "Ready to check",
    "Ready to run",
    "Needs input",
    "Template ready",
    "All required inputs for this one action are filled.",
  ]) {
    if (!labTab.includes(expected)) {
      result.push(`Admin Lab UI is missing action readiness marker: ${expected}`);
    }
  }
  for (const expected of [
    "visualEvidenceRequiredCount",
    "visualEvidenceNotRequiredCount",
    "visualEvidenceUnknownCount",
    "visual-marked",
    "visual-off",
    "visual-unmarked",
    "visual evidence required",
    "visual evidence not required",
    "visual evidence not marked",
  ]) {
    if (!labTab.includes(expected)) {
      result.push(`Admin Lab UI is missing candidate visual-evidence marker: ${expected}`);
    }
    if (!labTabTest.includes(expected)) {
      result.push(`Admin Lab UI test is missing candidate visual-evidence marker: ${expected}`);
    }
  }
  for (const expected of [
    "projectActionGroups",
    "firstScreenProjectActions",
    "group.actions.map",
    "{group.label}",
    'group: "Find work"',
    'group: "Plan and review"',
    'group: "Run task"',
    'group: "Visual evidence"',
    'primaryVisibility?: "default" | "details"',
    "isProjectActionVisibleOnFirstScreen",
    "More visual actions",
  ]) {
    if (!labTabTest.includes(expected)) {
      result.push(`Admin Lab UI test is missing primary action grouping marker: ${expected}`);
    }
  }
  for (const expected of [
    "labelEvidenceChainCommand",
    "Render screenshot catalog",
    "Export task evidence",
    "Assess screenshot evidence",
    "Publish Arena readback",
    "Read screenshot status",
    "Check screenshot files",
    "handleCopyEvidenceChainCommand(handoff.command)",
  ]) {
    if (!labTab.includes(expected)) {
      result.push(`Admin Lab UI is missing evidence-chain command label marker: ${expected}`);
    }
    if (!labTabTest.includes(expected)) {
      result.push(`Admin Lab UI test is missing evidence-chain command label marker: ${expected}`);
    }
  }
  if (!contractIncludes(adminLabContract, "must not render a standalone usual-path workflow")
    || !contractIncludes(adminLabContract, "Any next-step affordance")
    || !contractIncludes(adminLabContract, "must come from the current action result or an explicit owner handoff")
    || !contractIncludes(adminLabContract, "must not become a second run-surface catalog, readiness model, runnable workflow truth or automatic next-stage chain")
    || !contractIncludes(adminLabContract, "select that primary action identity instead of dropping into raw/debug stage mode")) {
    result.push("admin-laboratory-contract.md must keep next-step affordances result-owned, not a standalone usual-path workflow");
  }
  const actionMapBlock = extractConstArrayBlock(adminLabActions, "ADMIN_LAB_PROJECT_ACTIONS");
  const primaryActionArguments = new Map();
  const primaryActionBrickStatuses = new Map();
  if (!actionMapBlock) {
    result.push("Admin Lab action definitions are missing ADMIN_LAB_PROJECT_ACTIONS");
  } else {
    for (const action of LAB_PRODUCT_ACTION_MAP) {
      const actionBlock = extractObjectBlockById(actionMapBlock, action.id);
      if (!actionBlock) {
        result.push(`Admin Lab shared product action map is missing id: ${action.id}`);
        continue;
      }
      const actionArgument = extractStringProperty(actionBlock, "argument");
      if (!actionArgument) {
        result.push(`Admin Lab shared product action ${action.id} is missing a parseable argument string`);
      } else {
        primaryActionArguments.set(action.id, actionArgument);
      }
      const brickStatus = extractBrickStatus(actionBlock);
      if (!brickStatus) {
        result.push(`Admin Lab shared product action ${action.id} is missing parseable brickStatus label/detail`);
      } else {
        primaryActionBrickStatuses.set(action.id, brickStatus);
      }
      for (const expected of [
        `title: "${action.title}"`,
        `stageId: "${action.stageId}"`,
        `group: "${action.group}"`,
        "context:",
        "argument:",
        "output:",
      ]) {
        if (!actionBlock.includes(expected)) {
          result.push(`Admin Lab shared product action ${action.id} is missing ${expected}`);
        }
      }
    }
  }
  for (const expected of [
    "ADMIN_LAB_PROJECT_ACTIONS",
    "isAdminLabProjectActionId",
    "getAdminLabProjectActionDefinition",
  ]) {
    if (!labTab.includes(expected) && !adminLab.includes(expected) && !adminLabRunRoute.includes(expected)) {
      result.push(`Admin Lab action invocation code is missing ${expected}`);
    }
  }
  if (!contractIncludes(adminLabContract, "Normal primary-action browser requests must send `actionId` only")
    || !contractIncludes(adminLabContract, "Raw `stageId` requests are reserved for the explicit debug stage")
    || !contractIncludes(adminLabContract, "sends both `actionId` and `stageId` is rejected")
    || !contractIncludes(adminLabContract, "normal project-action state is")
    || !contractIncludes(adminLabContract, "`selectedDebugStageId` for the debug catalog")
    || !contractIncludes(adminLabContract, "must not also store or synchronize a raw")) {
    result.push("admin-laboratory-contract.md must keep primary Lab invocation action-first");
  }
  for (const expected of [
    "const requestedStageId = body?.stageId",
    "const stageId = action?.stageId ?? requestedStageId",
    "action_stage_double_truth",
    'readAdminLabRunOptions(stageId, body, action ? "action" : "debug_stage")',
    'invocationKind === "action" ? ["projectId", "actionId"] : ["projectId", "stageId"]',
  ]) {
    if (!adminLabRunRoute.includes(expected)) {
      result.push(`Admin Lab run route is missing action-first invocation marker: ${expected}`);
    }
  }
  for (const expected of [
    "const invocationInput = selectedProjectAction",
    "actionId: selectedProjectAction.id",
    "stageId: selectedStage.id",
    "const [selectedDebugStageId, setSelectedDebugStageId]",
    "const selectedStage = selectedProjectAction ? selectedProjectAction.stage : selectedDebugStage",
    "runResult.actionInvocation?.title",
    "actionInvocation",
    "selectedProjectAction?.promptReplayFixture ?? promptReplayFixture",
    "Pinned by selected action. Change the action, not this fixture.",
    'setSelectedProjectActionId("check_story_selection")',
    'setSelectedProjectActionId("ingest_evidence")',
    'setSelectedProjectActionId("check_screenshot_files")',
  ]) {
    if (!labTab.includes(expected) && !adminLab.includes(expected)) {
      result.push(`Admin Lab action invocation path is missing ${expected}`);
    }
  }
  if (labTab.includes("setSelectedStageId")) {
    result.push("Admin Lab UI must not synchronize primary actions through setSelectedStageId; use selectedProjectActionId or selectedDebugStageId");
  }
  if (!contractIncludes(adminLabContract, "must not expose those pinned action inputs as editable fields")
    || !contractIncludes(adminLabContract, "debug/raw stage selection without a primary action id")) {
    result.push("admin-laboratory-contract.md must keep shared-stage action inputs pinned by the selected primary action");
  }
  for (const action of LAB_PRODUCT_ACTION_MAP) {
    const matrixRow = findMarkdownTableRow(sharedProductionBrickMap, action.id);
    if (!matrixRow) {
      result.push(`shared-production-brick-map.md is missing primary action matrix row for id: ${action.id}`);
      continue;
    }
    for (const expected of [action.title, action.stageId]) {
      if (!matrixRow.includes(expected)) {
        result.push(`shared-production-brick-map.md primary action matrix row for ${action.id} is missing ${expected}`);
      }
    }
    const actionArgument = primaryActionArguments.get(action.id);
    if (actionArgument && !matrixRow.includes(actionArgument)) {
      result.push(`shared-production-brick-map.md primary action matrix row for ${action.id} does not match ADMIN_LAB_PROJECT_ACTIONS.argument: ${actionArgument}`);
    }
    const brickStatus = primaryActionBrickStatuses.get(action.id);
    if (brickStatus) {
      const brickStatusRow = findMarkdownTableRowContaining(
        sharedProductionBrickMap,
        action.id,
        [brickStatus.label, brickStatus.detail],
      );
      if (!brickStatusRow) {
        result.push(`shared-production-brick-map.md is missing brickStatus index row for ${action.id}: ${brickStatus.label} / ${brickStatus.detail}`);
      }
      if (brickStatus.label.includes("Shared")) {
        const stageBlock = extractAdminLabStageBlock(adminLab, action.stageId);
        const ownerBoundary = stageBlock ? extractStringProperty(stageBlock, "ownerBoundary") : null;
        if (!ownerBoundary || !matrixRow.includes(ownerBoundary)) {
          result.push(`shared-production-brick-map.md primary action matrix row for shared action ${action.id} must name exact ownerBoundary ${ownerBoundary ?? "(missing)"}`);
        }
        const excludedTailMarkers = SHARED_ACTION_EXCLUDED_TAIL_MARKERS.get(action.id);
        if (!excludedTailMarkers) {
          result.push(`check-ra356-stage-docs.mjs must declare excluded-tail markers for shared action ${action.id}`);
        } else {
          for (const marker of excludedTailMarkers) {
            if (!contractIncludes(matrixRow, marker)) {
              result.push(`shared-production-brick-map.md primary action matrix row for shared action ${action.id} is missing excluded-tail/debt marker: ${marker}`);
            }
          }
        }
      }
    }
  }
  for (const expected of [
    "Primary Action Invocation Matrix",
    "Primary Action Brick Status Index",
    "Primary action grouping uses the same shared `ADMIN_LAB_PROJECT_ACTIONS` entries",
    "Group labels are presentation-only",
    "Action id",
    "Brick status label",
    "Brick status detail",
    "visual-evidence counts are copied from existing task fields",
    "not scheduler, task selection, visual-task inference, screenshot availability",
    "Context source",
    "Argument schema",
    "Observable result",
    "Production relationship / debt",
  ]) {
    if (!includesText(sharedProductionBrickMap, expected)) {
      result.push(`shared-production-brick-map.md is missing primary action invocation marker: ${expected}`);
    }
  }
  for (const expected of [
    "visualEvidenceRequiredCount",
    "visualEvidenceNotRequiredCount",
    "visualEvidenceUnknownCount",
    "not UI/title inference or screenshot availability",
  ]) {
    if (!stageRunContract.includes(expected)) {
      result.push(`stage-run-contract.md is missing candidate visual-evidence readback marker: ${expected}`);
    }
  }

  return result;
}

function checkSimpleInvocationModel() {
  const result = [];
  for (const [docName, body] of [
    ["admin-laboratory-contract.md", adminLabContract],
    ["RA-356 plan.md", plan],
  ]) {
    if (!contractIncludes(body, SIMPLE_INVOCATION_MODEL)) {
      result.push(`${docName} is missing the RA-356 simple invocation model`);
    }
  }
  return result;
}

function checkStookV2ApplyBoundaryDocs() {
  const result = [];
  for (const [docName, docBody] of [
    ["RA-355 plan.md", ra355Plan],
    ["RA-356 plan.md", plan],
    ["stook-project-log.md", stookProjectLog],
  ]) {
    if (contractIncludes(docBody, "Admin Lab пока не умеет нажать этот apply owner")
      || contractIncludes(docBody, "Fresh executor-created screenshots still require either exposing the new shared planner spec-migration apply owner")
      || contractIncludes(docBody, "Admin Lab still needs an explicit stage/action that invokes it")) {
      result.push(`${docName} still describes planner_spec_migration_apply as not exposed in Admin Lab`);
    }
    if (!contractIncludes(docBody, "Apply spec diff to plan")
      || !contractIncludes(docBody, "accepted spec truth")
      || !contractIncludes(docBody, ".ralph/plan.json")) {
      result.push(`${docName} must describe the current STOOK v2 boundary: accepted import updates accepted spec truth, then Apply spec diff to plan materializes .ralph/plan.json task truth`);
    }
  }
  if (!contractIncludes(stookProjectLog, "Admin Lab now has `Apply spec diff to plan`")
    || !contractIncludes(stookProjectLog, "does not run automatically after import")) {
    result.push("stook-project-log.md must record the current Admin Lab planner apply action and its no-auto-run boundary");
  }
  return result;
}

function includesText(body, expected) {
  return body.includes(expected) || body.replace(/\s+/g, " ").includes(expected);
}

function findMarkdownTableRow(body, expectedCodeValue) {
  const marker = `\`${expectedCodeValue}\``;
  return body
    .split("\n")
    .find((line) => line.trim().startsWith("|") && line.includes(marker))
    ?? null;
}

function findMarkdownTableRowContaining(body, expectedCodeValue, requiredValues) {
  const marker = `\`${expectedCodeValue}\``;
  return body
    .split("\n")
    .find((line) =>
      line.trim().startsWith("|")
      && line.includes(marker)
      && requiredValues.every((value) => includesText(line, value))
    )
    ?? null;
}

function extractBrickStatus(actionBlock) {
  const match = /brickStatus:\s*{\s*label:\s*"([^"]+)",\s*detail:\s*"([^"]+)",\s*}/s.exec(actionBlock);
  if (!match) return null;
  return {
    label: match[1],
    detail: match[2],
  };
}

function checkSnapshotFileHandoff() {
  const result = [];
  const docs = [
    ["stage-run-contract.md", stageRunContract],
    ["manual-experiment-cases.md", manualCases],
    ["RA-356 plan.md", plan],
    ["RA backlog", backlog],
    ["Admin Lab UI", labTab],
    ["Admin Lab UI test", labTabTest],
  ];

  for (const [docName, body] of docs) {
    if (!includesText(body, "Lab does not write")) {
      result.push(`${docName} is missing the explicit snapshot-file non-write rule`);
    }
    if (!body.includes("<project-stage-snapshot.json>")) {
      result.push(`${docName} is missing the snapshot CLI placeholder handoff`);
    }
  }

  if (!labTab.includes("snapshotSuggestedFilePath")) {
    result.push("Admin Lab UI must keep a suggested snapshot file path for CLI handoff");
  }

  return result;
}

function checkSharedProductionBrickGate() {
  const result = [];
  for (const [docName, docBody] of [
    ["stage-run-contract.md", stageRunContract],
    ["architecture.md", architecture],
    ["shared-production-brick-map.md", sharedProductionBrickMap],
    ["plan.md", plan],
    ["user-brief-and-dialogue-notes.md", userBrief],
    ["ralph-arena.md", backlog],
    ["admin-laboratory-contract.md", adminLabContract],
  ]) {
    if (!/same bricks|shared production brick|shared-production-brick|real `ralph run`|real Ralph/i.test(docBody)) {
      result.push(`${docName} is missing the shared production brick / real Ralph convergence rule`);
    }
  }
  for (const expected of [
    "Project Stage Snapshot",
    "target owner",
    "migration debt",
    "planner_project_dry_run",
    "planner-spec-migration-apply",
    "executor_project_task",
    "controller_project_dry_run",
    "visual_workbench_manifest_readiness",
    "visual_workbench_evidence_automation",
    "runExecutorAgentCall",
    "runExecutorActionCore",
    "buildExecutorContextSections",
    "runVisualWorkbenchEvidenceAutomation",
    "Collect/check screenshots",
    "proof_reviews",
  ]) {
    if (!includesText(sharedProductionBrickMap.toLowerCase(), expected.toLowerCase())) {
      result.push(`shared-production-brick-map.md is missing required shared-brick map term: ${expected}`);
    }
  }
  if (!contractIncludes(adminLabContract, "Shared is a gated word")
    || !contractIncludes(adminLabContract, "Production Convergence Evidence")
    || !contractIncludes(adminLabContract, "normal-run caller, shared helper, source-current diagnostic or explicit migration debt")) {
    result.push("admin-laboratory-contract.md must keep Shared labels gated by production-convergence evidence");
  }
  for (const evidence of PRODUCTION_CONVERGENCE_EVIDENCE_ROWS) {
    const evidenceRow = findMarkdownTableRowContaining(
      sharedProductionBrickMap,
      evidence.actionId,
      evidence.docMarkers,
    );
    if (!evidenceRow) {
      result.push(`shared-production-brick-map.md Production Convergence Evidence is missing row for ${evidence.actionId} with markers: ${evidence.docMarkers.join(", ")}`);
    }
    for (const [codeName, markers] of evidence.codeChecks) {
      const source = productionConvergenceCodeSource(codeName);
      if (!source) {
        result.push(`check-ra356-stage-docs.mjs has no code source registered for production convergence check: ${codeName}`);
        continue;
      }
      for (const marker of markers) {
        if (!source.includes(marker)) {
          result.push(`${codeName} is missing production convergence marker for ${evidence.actionId}: ${marker}`);
        }
      }
    }
  }
  for (const [docName, docBody] of [
    ["shared-production-brick-map.md", sharedProductionBrickMap],
    ["plan.md", plan],
  ]) {
    if (contractIncludes(docBody, "manifest readiness and evidence automation remain")) {
      result.push(`${docName} still claims manifest readiness remains grouped with evidence automation as CLI/direct handoff`);
    }
  }
  if (!contractIncludes(sharedProductionBrickMap, "Manifest readiness, selector readiness, shell policy, platform browser readiness, automation status and evidence-chain readiness are browser-runnable read-only checks")) {
    result.push("shared-production-brick-map.md must keep manifest readiness in the narrow browser-runnable read-only Workbench subset");
  }
  if (!contractIncludes(sharedProductionBrickMap, "Empty rows may point to the explicit ingest handoff; rows without safe links may point to artifact check")
    || !contractIncludes(sharedProductionBrickMap, "Workbench automation/ingest produce or import evidence, while artifact check diagnoses existing rows")
    || !contractIncludes(sharedProductionBrickMap, "No auto-run from readback, no Telegram inference, no lifecycle retry, no proof shortcut, no raw folder scan")) {
    result.push("shared-production-brick-map.md must keep screenshot ingest/artifact-check branches separate");
  }
  for (const expected of [
    "Executor Action Core VNext",
    "ralph.executor-action-core",
    "prepared task/context input -> prompt envelope -> provider call -> source evidence -> executor observer classification -> executor report output",
    "must not absorb the surrounding loop tails",
    "Caller-owned after the core",
    "provider-session checkpoint persistence, checkpoint clearing and agent-log persistence",
  ]) {
    if (!contractIncludes(architecture, expected)) {
      result.push(`architecture.md is missing executor action core design marker: ${expected}`);
    }
  }
  if (!contractIncludes(sharedProductionBrickMap, "runExecutorActionCore")
    || !contractIncludes(sharedProductionBrickMap, "Production still owns task selection, verification, deploy, progress/lifecycle writes and push flow separately")) {
    result.push("shared-production-brick-map.md must record the executor action core convergence state and excluded tails");
  }
  if (contractIncludes(sharedProductionBrickMap, "Next convergence target is `ralph.executor-action-core`")
    || contractIncludes(plan, "real `LoopExecutor.executeIteration` remains a later slice")
    || contractIncludes(plan, "[ ] Refactor the next executor slice toward a shared executor-action owner")
    || contractIncludes(plan, "full executor-action owner has not been collapsed into one production brick")
    || contractIncludes(architecture, "selects `ralph.executor-action-core` as the next convergence target")
    || contractIncludes(architecture, "[ ] Continue executor convergence where normal `ralph run` still owns")
    || contractIncludes(architecture, "[ ] Implement `ralph.executor-action-core` only for prompt/provider/source")) {
    result.push("RA-356 docs must not describe executor action core as a future target after production LoopExecutor convergence");
  }
  if (!contractIncludes(architecture, "production action-core convergence closes the bounded prompt/provider/source/observer/report target")
    || !contractIncludes(architecture, "The bounded attempt path now shares `runExecutorActionCore`")
    || !contractIncludes(architecture, "Those tails remain caller-owned by design")) {
    result.push("architecture.md must record executor action core convergence as closed while preserving caller-owned loop tails");
  }
  if (!contractIncludes(plan, "Current architecture-first target closed for the bounded attempt path")
    || !contractIncludes(plan, "ralph.executor-action-core")) {
    result.push("plan.md must record the executor action core convergence slice as closed for the bounded attempt path");
  }
  if (!contractIncludes(plan, "Manifest readiness, selector readiness, shell policy, platform browser readiness, automation status and evidence-chain readiness are now read-only browser actions")) {
    result.push("plan.md must keep manifest readiness in the current Admin Lab Workbench browser-action slice");
  }
  if (contractIncludes(plan, "controller remains a direct CLI dry-run handoff")) {
    result.push("plan.md still claims controller dry-run remains a direct CLI handoff");
  }
  if (!contractIncludes(plan, "Snapshot readback, planner/controller dry-runs and the bounded executor live action are browser actions")) {
    result.push("plan.md must keep controller dry-run in the current Admin Lab browser-action slice");
  }
  if (contractIncludes(plan, "Reconnect optional Visual Workbench handoff only after selected stage output")
    && !plan.includes("[x] Reconnect optional Visual Workbench handoff only after selected stage")) {
    result.push("plan.md must keep the executor -> Workbench selector-readiness handoff marked closed once architecture/code/tests prove the bounded handoff");
  }
  if (contractIncludes(plan, "This remains open because selector readiness output, capture/export/publish and Arena readback are still explicit next stages")) {
    result.push("plan.md must not keep the executor -> Workbench handoff open merely because downstream Workbench/Arena stages stay explicit");
  }
  if (!contractIncludes(plan, "This closes the executor -> Workbench handoff at the safe metadata boundary")
    || !contractIncludes(plan, "Selector readiness, capture, export, publish and Arena readback remain separate explicit stages")) {
    result.push("plan.md must describe the closed executor -> Workbench handoff boundary without hiding downstream stages");
  }
  if (contractIncludes(architecture, "This clears only the provider-call part of the gap")) {
    result.push("architecture.md must not describe executor convergence as provider-call-only after observeExecutorAction landed");
  }
  if (!contractIncludes(architecture, "action-observation, mutation-classification")
    || !contractIncludes(architecture, "completion-contract checks, verification, deploy, progress/lifecycle writes")) {
    result.push("architecture.md must document the current executor helper convergence boundary and remaining higher-risk production gaps");
  }
  for (const [docName, docBody] of [
    ["shared-production-brick-map.md", sharedProductionBrickMap],
    ["architecture.md", architecture],
    ["plan.md", plan],
    ["ralph-arena.md", backlog],
  ]) {
    if (/ownerBoundary[^.\n]{0,120}(still lacks|lacks a single owner boundary)|still lacks[^.\n]{0,120}ownerBoundary/i.test(docBody)) {
      result.push(`${docName} still claims Visual Workbench automation lacks top-level ownerBoundary`);
    }
  }
  for (const [docName, docBody] of [
    ["plan.md", plan],
    ["architecture.md", architecture],
    ["ralph-arena.md", backlog],
  ]) {
    if (!docBody.includes("shared-production-brick-map.md")) {
      result.push(`${docName} must link the shared production brick map`);
    }
  }
  for (const [codeName, codeBody] of [
    ["loop/executor.ts", loopExecutor],
  ]) {
    if (!codeBody.includes("runExecutorActionCore")
      || !codeBody.includes("runExecutorActionCoreForCurrentTask")
      || !codeBody.includes("sourceMode: {")
      || !codeBody.includes("preAgentPolicy: 'allow_current_task_workspace_only'")) {
      result.push(`${codeName} must route production executor attempts through the shared executor action core owner`);
    }
    if (codeBody.includes("runExecutorAgentCall")) {
      result.push(`${codeName} must not call the shared executor agent-call owner directly after action-core convergence`);
    }
    if (codeBody.includes("private async executeAgent(")) {
      result.push(`${codeName} must not keep the old private executeAgent path beside executor action core`);
    }
  }
  for (const [codeName, codeBody] of [
    ["stage-lab/executor-task-workspace.ts", executorTaskWorkspace],
    ["stage-lab/executor-task-workspace-continue.ts", executorTaskWorkspaceContinue],
  ]) {
    if (!codeBody.includes("runExecutorActionCore")) {
      result.push(`${codeName} must call the shared executor action core owner`);
    }
    if (!codeBody.includes("EXECUTOR_ACTION_CORE_OWNER_BOUNDARY")
      || !codeBody.includes("ownerBoundary: EXECUTOR_ACTION_CORE_OWNER_BOUNDARY")) {
      result.push(`${codeName} stage ownerBoundary must be the shared executor action core owner`);
    }
    if (codeBody.includes("ralph.executor.prompt-code-path")) {
      result.push(`${codeName} must not expose the old prompt-code-path ownerBoundary after action-core convergence`);
    }
  }
  if (!stageCatalogSource.includes("ownerBoundary: EXECUTOR_ACTION_CORE_OWNER_BOUNDARY")
    || stageCatalogSource.includes("ownerBoundary: 'ralph.executor.prompt-code-path'")) {
    result.push("stage-lab/catalog.ts must expose executor workspace stages as ralph.executor-action-core, not prompt-code-path");
  }
  if (!adminLab.includes('ownerBoundary: "ralph.executor-action-core"')
    || adminLab.includes('ownerBoundary: "ralph.executor.prompt-code-path"')) {
    result.push("admin-lab.ts must expose executor workspace continuation as ralph.executor-action-core, not prompt-code-path");
  }
  if (existsSync(oldExecutorStageClassifierPath)) {
    result.push("stage-lab/executor-stage-classifier.ts must not reappear as a Lab-owned executor observer");
  }
  if (!executorObserver.includes("observeExecutorOutput") || !executorObserver.includes("parseExecutorGitStatusChangedFiles")) {
    result.push("loop/executor-observer.ts is missing the shared executor observation APIs");
  }
  if (!executorObserver.includes("classifyExecutorMutationOutcome")) {
    result.push("loop/executor-observer.ts must keep the shared executor mutation-outcome helper");
  }
  if (!executorAction.includes("observeExecutorAction")
    || !executorAction.includes("observeExecutorOutput")
    || !executorAction.includes("classifyExecutorMutationOutcome")
    || !executorAction.includes("buildExecutorOutputSummary")
    || !executorAction.includes("buildExecutorActionReportOutput")) {
    result.push("loop/executor-action.ts must compose shared executor observation, mutation outcome, summary and report output");
  }
  if (!executorActionCore.includes("EXECUTOR_ACTION_CORE_OWNER_BOUNDARY = 'ralph.executor-action-core'")
    || !executorActionCore.includes("runExecutorAgentCall")
    || !executorActionCore.includes("readExecutorGitStatusLines")
    || !executorActionCore.includes("buildExecutorSourceChangeEvidence")
    || !executorActionCore.includes("observeExecutorAction")
    || !executorActionCore.includes("buildExecutorActionReportOutput")
    || !executorActionCore.includes("post_call_status")
    || !executorActionCore.includes("caller_validated")) {
    result.push("loop/executor-action-core.ts must own only the shared prompt/provider/source/observer/report attempt path");
  }
  for (const forbidden of [
    "saveAgentLog",
    "updateProviderSessionCheckpoint",
    "clearProviderSessionCheckpoint",
    "commitCurrentExecutorSourceChanges",
    "commitExecutorTaskIterationSourceChanges",
    "runVisualWorkbenchEvidenceAutomation",
    "runController",
  ]) {
    if (executorActionCore.includes(forbidden)) {
      result.push(`loop/executor-action-core.ts must not own caller tail: ${forbidden}`);
    }
  }
  if (!configTypes.includes("ExecutorActionReportOutput")
    || !configTypes.includes("executorOutput?: ExecutorActionReportOutput")) {
    result.push("config/types.ts must expose optional IterationLog.executorOutput for production executor readback");
  }
  if (!executorObserver.includes("EXECUTOR_OBSERVER_OWNER_BOUNDARY = 'ralph.executor-observer'")
    || !executorObserver.includes("ownerBoundary: typeof EXECUTOR_OBSERVER_OWNER_BOUNDARY")
    || !executorObserver.includes("ownerBoundary: EXECUTOR_OBSERVER_OWNER_BOUNDARY")) {
    result.push("loop/executor-observer.ts must expose and write the shared executor observer ownerBoundary");
  }
  if (!executorPrompt.includes("buildExecutorAgentPromptEnvelope")) {
    result.push("loop/executor-prompt.ts is missing the shared executor prompt envelope API");
  }
  if (!executorContext.includes("buildExecutorContextSections") || !executorContext.includes("prepareTaskWorkspace")) {
    result.push("memory/context.ts must keep pure executor context assembly separate from production task workspace preparation");
  }
  if (!executorProjectTask.includes("buildExecutorContextSections") || executorProjectTask.includes("renderExecutorTaskSection")) {
    result.push("stage-lab/executor-project-task.ts must reuse pure executor context assembly instead of rebuilding executor task context locally");
  }
  if (!projectStageSnapshot.includes("visualEvidencePolicy")
    || !projectStageSnapshot.includes("governance.runner-init-readiness.ralphConfig")
    || !projectStageSnapshot.includes("sanitizeVisualEvidencePolicy")) {
    result.push("project-stage-snapshot.ts must expose sanitized visualEvidencePolicy from runner init readiness");
  }
  if (!executorProjectTask.includes("shouldRunVisualWorkbenchEvidenceAutomationForTask")
    || !executorProjectTask.includes("resolveSnapshotVisualEvidenceMode")
    || !executorProjectTask.includes("snapshot.visualEvidencePolicy.visualEvidenceMode")
    || executorProjectTask.includes("task.visualEvidenceRequired === true ? 'required' : 'off'")) {
    result.push("stage-lab/executor-project-task.ts must derive visual evidence mode from snapshot policy through the shared executor observer helper");
  }
  if (!executorSourceCommit.includes("buildExecutorTaskIterationCommitMessage")
    || !executorSourceCommit.includes("buildExecutorProjectTaskLiveWorkspaceCommitMessage")
    || !executorSourceCommit.includes("buildExecutorVisualWorkbenchEvidenceCommitMessage")
    || !executorSourceCommit.includes("commitExecutorTaskIterationSourceChanges")
    || !executorSourceCommit.includes("commitExecutorLiveWorkspaceSourceChanges")) {
    result.push("loop/executor-source-commit.ts is missing the shared executor source commit APIs");
  }
  if (gitManager.includes("createCommitMessage(")) {
    result.push("git/manager.ts must not own executor commit-message semantics; use loop/executor-source-commit.ts");
  }
  if (!loopExecutor.includes("runExecutorActionCore")) {
    result.push("loop/executor.ts must consume the shared executor prompt envelope through executor action core");
  }
  if (!executorProjectTask.includes("buildExecutorAgentPromptEnvelope")) {
    result.push("stage-lab/executor-project-task.ts no longer calls the shared executor prompt envelope");
  }
  if (!executorProjectTask.includes("commitExecutorLiveWorkspaceSourceChanges")) {
    result.push("stage-lab/executor-project-task.ts must call the shared live workspace source commit helper");
  }
  if (!executorProjectTask.includes("'.ralph/tasks/'")) {
    result.push("stage-lab/executor-project-task.ts must expose .ralph/tasks/ as forbidden to match delegated executor_task_workspace");
  }
  if (!executorSourceCommit.includes("buildExecutorProjectTaskLiveWorkspaceCommitMessage")) {
    result.push("loop/executor-source-commit.ts no longer calls the shared executor project-task source commit message builder");
  }
  if (!loopExecutor.includes("commitExecutorTaskIterationSourceChanges")) {
    result.push("loop/executor.ts no longer calls the shared production executor source commit helper");
  }
  if (!loopExecutor.includes("buildExecutorVisualWorkbenchEvidenceCommitMessage")
    || loopExecutor.includes("'chore: visual workbench evidence'")
    || loopExecutor.includes('"chore: visual workbench evidence"')) {
    result.push("loop/executor.ts must commit Workbench evidence through the shared task-scoped executor source commit message builder");
  }
  if (!loopExecutor.includes("commitCurrentExecutorSourceChanges")) {
    result.push("loop/executor.ts must keep one production executor source commit entrypoint");
  }
  if (loopExecutor.includes("commitChanges(")) {
    result.push("loop/executor.ts must not keep the old generic commitChanges executor path");
  }
  if (!executorSourceCommit.includes("new GitManager(input.workDir).commit")) {
    result.push("loop/executor-source-commit.ts must use GitManager for live workspace source commits");
  }
  if (!visualWorkbenchAutomation.includes("VISUAL_WORKBENCH_AUTOMATION_OWNER_BOUNDARY = 'ralph.visual-workbench-evidence-automation'")) {
    result.push("visual-workbench-automation.ts must keep the top-level evidence automation owner boundary constant");
  }
  if (!visualWorkbenchAutomation.includes("ownerBoundary: typeof VISUAL_WORKBENCH_AUTOMATION_OWNER_BOUNDARY")) {
    result.push("VisualWorkbenchEvidenceAutomationResult must expose top-level ownerBoundary");
  }
  if (!visualWorkbenchAutomation.includes("ownerBoundary: VISUAL_WORKBENCH_AUTOMATION_OWNER_BOUNDARY")) {
    result.push("visual-workbench-automation.ts must write ownerBoundary into automation reports");
  }
  if (!configTypes.includes("VisualWorkbenchAutomationIterationReadback")
    || !configTypes.includes("visualWorkbenchAutomation?: VisualWorkbenchAutomationIterationReadback")
    || !loopExecutor.includes("recordVisualWorkbenchAutomationIterationReadback")
    || !loopExecutor.includes("visualWorkbenchAutomation = {")
    || !loopExecutor.includes("exportedEvidenceRefs")
    || !loopExecutor.includes("publishedRows")) {
    result.push("production LoopExecutor must record compact Visual Workbench automation telemetry in IterationLog without relying on Lab readback");
  }
  if (!visualWorkbenchAutomation.includes("automation_report_owner_boundary_unsupported")) {
    result.push("visual-workbench-automation.ts must reject mismatched automation report ownerBoundary values");
  }
  if (!stageCatalogSource.includes("VISUAL_WORKBENCH_AUTOMATION_OWNER_BOUNDARY")
    || !stageCatalogSource.includes("ownerBoundary: VISUAL_WORKBENCH_AUTOMATION_OWNER_BOUNDARY")) {
    result.push("stage-lab/catalog.ts must reuse the Visual Workbench automation owner boundary constant");
  }
  if (!planner.includes("PLANNER_INITIAL_DRY_RUN_OWNER_BOUNDARY = 'ralph.planner.initial-dry-run'")) {
    result.push("planning/planner.ts must keep the production planner initial dry-run owner boundary constant");
  }
  if (!planner.includes("ownerBoundary: typeof PLANNER_INITIAL_DRY_RUN_OWNER_BOUNDARY")
    || !planner.includes("ownerBoundary: PLANNER_INITIAL_DRY_RUN_OWNER_BOUNDARY")) {
    result.push("PlannerInitialDryRunResult must expose and write its production ownerBoundary");
  }
  if (!plannerSpecMigrationApply.includes("ownerBoundary: 'ralph.planner-spec-migration-apply'")
    || !plannerSpecMigrationApply.includes("applySpecMigration")
    || !plannerSpecMigrationApply.includes("recordNoWorkAcceptedArtifactMigrationIfSafe")
    || !plannerSpecMigrationApply.includes("discoverSpecMigrationCandidates")) {
    result.push("planning/spec-migration-apply.ts must own pending spec migration apply/readiness logic for normal Ralph and future Lab apply");
  }
  if (!plannerSpecMigrationApplyStage.includes("runPlannerSpecMigrationApply")
    || !plannerSpecMigrationApplyStage.includes("applyPendingSpecMigrations")
    || !plannerSpecMigrationApplyStage.includes("ownerBoundary: 'ralph.planner-spec-migration-apply'")
    || !plannerSpecMigrationApplyStage.includes("client workDir/spec/visualEvidenceMode truth")) {
    result.push("stage-lab/planner-spec-migration-apply.ts must expose the shared planner migration owner without client workDir/spec/visualEvidenceMode truth");
  }
  if (plannerSpecMigrationApplyStage.includes("runPlannerProjectDryRun")
    || plannerSpecMigrationApplyStage.includes("planner_project_dry_run")) {
    result.push("stage-lab/planner-spec-migration-apply.ts must not apply planner_project_dry_run output");
  }
  if (!loopExecutor.includes("applyPendingSpecMigrationsThroughOwner")
    || !loopExecutor.includes("hasPendingSpecMigrationsThroughOwner")
    || !loopExecutor.includes("shouldRecordLegacySingleSpecBootstrap")) {
    result.push("loop/executor.ts must route pending spec migration apply/readiness through the shared planner spec-migration owner");
  }
  if (loopExecutor.includes("recordNoWorkAcceptedArtifactMigrationIfSafe")
    || loopExecutor.includes("readAcceptedArtifactFeedbackContext")
    || loopExecutor.includes("hasMetadataAwareSpecInput")) {
    result.push("loop/executor.ts must not keep private accepted-artifact/spec-input migration logic beside the shared planner apply owner");
  }
  if (!controller.includes("CONTROLLER_DRY_RUN_AUDIT_OWNER_BOUNDARY = 'ralph.controller.audit-dry-run'")) {
    result.push("control/controller.ts must keep the production controller audit dry-run owner boundary constant");
  }
  if (!controller.includes("ownerBoundary: typeof CONTROLLER_DRY_RUN_AUDIT_OWNER_BOUNDARY")
    || !controller.includes("ownerBoundary: CONTROLLER_DRY_RUN_AUDIT_OWNER_BOUNDARY")) {
    result.push("ControllerDryRunAuditResult must expose and write its production ownerBoundary");
  }
  if (!plannerProjectDryRun.includes("ownerBoundary: 'ralph.planner.dry-run-adapter'")
    || !plannerProjectDryRun.includes("ownerBoundary: dryRunResult.ownerBoundary")) {
    result.push("stage-lab/planner-project-dry-run.ts must keep adapter ownerBoundary separate from production plannerOutput.ownerBoundary");
  }
  if (!controllerProjectDryRun.includes("ownerBoundary: 'ralph.controller.dry-run-adapter'")
    || !controllerProjectDryRun.includes("ownerBoundary: dryRunResult.ownerBoundary")) {
    result.push("stage-lab/controller-project-dry-run.ts must keep adapter ownerBoundary separate from production controllerOutput.ownerBoundary");
  }
  if (!stageRunContract.includes("plannerOutput.ownerBoundary")
    || !stageRunContract.includes("ralph.planner.initial-dry-run")) {
    result.push("stage-run-contract.md must document nested plannerOutput.ownerBoundary production evidence");
  }
  if (!stageRunContract.includes("controllerOutput.ownerBoundary")
    || !stageRunContract.includes("ralph.controller.audit-dry-run")) {
    result.push("stage-run-contract.md must document nested controllerOutput.ownerBoundary production evidence");
  }
  if (/function gitExec\(/.test(executorProjectTask) || executorProjectTask.includes("['add', '-A']")) {
    result.push("stage-lab/executor-project-task.ts must not own raw git add/commit staging policy");
  }
  if (!executorTaskIo.includes("ownerBoundary: observation.ownerBoundary")) {
    result.push("stage-lab/executor-task-io.ts must project executorOutput.ownerBoundary from the shared executor observer");
  }
  for (const [codeName, codeBody] of [
    ["stage-lab/executor-task-workspace.ts", executorTaskWorkspace],
    ["stage-lab/executor-task-workspace-continue.ts", executorTaskWorkspaceContinue],
  ]) {
    if (!codeBody.includes("executorOutput: coreResult.executorOutput")) {
      result.push(`${codeName} must project executorOutput from the shared executor action core result`);
    }
  }
  for (const [codeName, codeBody] of [
    ["stage-lab/executor-task-workspace.ts", executorTaskWorkspace],
    ["stage-lab/executor-task-workspace-continue.ts", executorTaskWorkspaceContinue],
  ]) {
    if (!codeBody.includes("ownerBoundary: null")) {
      result.push(`${codeName} must keep executorOutput.ownerBoundary null before the observer runs`);
    }
  }
  if (!stageRunContract.includes("executorOutput.ownerBoundary")
    || !stageRunContract.includes("ralph.executor-observer")) {
    result.push("stage-run-contract.md must document nested executorOutput.ownerBoundary production observer evidence");
  }
  if (!sharedProductionBrickMap.includes("executorOutput.ownerBoundary")
    || !sharedProductionBrickMap.includes("ralph.executor-observer")) {
    result.push("shared-production-brick-map.md must document executor observer owner evidence in Lab reports");
  }
  if (!stageRunContract.includes("classifyExecutorMutationOutcome")
    || !sharedProductionBrickMap.includes("classifyExecutorMutationOutcome")) {
    result.push("RA-356 docs must document the shared executor mutation outcome helper");
  }
  if (!executorTaskIo.includes("observeExecutorOutput")) {
    result.push("stage-lab/executor-task-io.ts no longer calls the shared executor observer");
  }
  if (!loopExecutor.includes("runExecutorActionCore")
    || !loopExecutor.includes("executorActionCoreResult.actionObservation.observation")) {
    result.push("loop/executor.ts must consume shared executor action observation through executor action core");
  }
  for (const [codeName, codeBody] of [
    ["stage-lab/executor-task-workspace.ts", executorTaskWorkspace],
    ["stage-lab/executor-task-workspace-continue.ts", executorTaskWorkspaceContinue],
  ]) {
    if (!codeBody.includes("runExecutorActionCore")) {
      result.push(`${codeName} must consume shared executor action observation through executor action core`);
    }
  }
  if (!plan.includes("observeExecutorAction")
    || !sharedProductionBrickMap.includes("observeExecutorAction")) {
    result.push("RA-356 docs must document the shared executor action observation helper");
  }
  for (const [codeName, codeBody] of [
    ["stage-lab/executor-task-workspace.ts", executorTaskWorkspace],
    ["stage-lab/executor-task-workspace-continue.ts", executorTaskWorkspaceContinue],
  ]) {
    if (!codeBody.includes("executorOutput: coreResult.executorOutput")) {
      result.push(`${codeName} must use the shared executor action core report output`);
    }
    if (codeBody.includes("ownerBoundary: observation.ownerBoundary")) {
      result.push(`${codeName} must not hand-build post-observer executorOutput reports`);
    }
  }
  if (!plan.includes("buildExecutorActionReportOutput")
    || !sharedProductionBrickMap.includes("buildExecutorActionReportOutput")) {
    result.push("RA-356 docs must document the shared executor action report output helper");
  }
  if (!loopExecutor.includes("const executorOutput = executorActionCoreResult.executorOutput")
    || !loopExecutor.includes("executorOutput?: IterationLog['executorOutput']")
    || !loopExecutor.includes("...(executorOutput ? { executorOutput } : {})")) {
    result.push("loop/executor.ts must write shared executorOutput into production IterationLog as optional readback");
  }
  if (!loopExecutorTest.includes("executeIteration writes shared executorOutput into production iteration log")
    || !loopExecutorTest.includes("executorOutput.ownerBoundary")) {
    result.push("loop/executor.test.ts must cover production IterationLog.executorOutput readback");
  }
  if (!contractIncludes(sharedProductionBrickMap, "Production LoopExecutor also writes the same executorOutput projection")
    || !plan.includes("production executor action readback slice")
    || !actionLog.includes("Production Executor Action Readback")) {
    result.push("RA-356 docs must record the production executor action readback slice");
  }
  const productionForbiddenGuardIndex = loopExecutor.indexOf("executorMutationOutcome.status === 'forbidden_mutation'");
  const productionVerifyIndex = loopExecutor.indexOf("// 5. Verify result");
  const productionCommitIndex = loopExecutor.indexOf("commitCurrentExecutorSourceChanges");
  if (productionForbiddenGuardIndex === -1) {
    result.push("loop/executor.ts must hard-check shared executor forbidden_mutation outcomes");
  } else {
    const productionForbiddenGuardEnd = loopExecutor.indexOf("// 3.5. Handle agent-level failures", productionForbiddenGuardIndex);
    const productionForbiddenGuardBlock = productionForbiddenGuardEnd === -1
      ? loopExecutor.slice(productionForbiddenGuardIndex)
      : loopExecutor.slice(productionForbiddenGuardIndex, productionForbiddenGuardEnd);
    if (productionVerifyIndex === -1 || productionForbiddenGuardIndex > productionVerifyIndex) {
      result.push("loop/executor.ts must check forbidden_mutation before verification");
    }
    if (productionCommitIndex === -1 || productionForbiddenGuardIndex > productionCommitIndex) {
      result.push("loop/executor.ts must check forbidden_mutation before source commit");
    }
    if (!productionForbiddenGuardBlock.includes("this.setState('failed')")) {
      result.push("loop/executor.ts forbidden_mutation guard must fail the production executor instead of warning only");
    }
    for (const forbiddenCall of ["applyAgentFailureToTask", "failCurrentTaskAndMaybeReplan", "runController", "pauseArenaRun"]) {
      if (productionForbiddenGuardBlock.includes(forbiddenCall)) {
        result.push(`loop/executor.ts forbidden_mutation guard must not route through ${forbiddenCall}`);
      }
    }
  }
  if (!loopExecutor.includes("readHeadRef: () => this.resolveCurrentGitHeadRef()")
    || !loopExecutor.includes("const executorMutationOutcome = executorActionCoreResult.mutationOutcome")
    || !executorActionCore.includes("headChanged: headAfter !== headBefore")) {
    result.push("loop/executor.ts must pass production HEAD-change evidence through executor action core before mutation guard handling");
  }
  if (!loopExecutorTest.includes("executeIteration fails before verification when executor changes HEAD")
    || !loopExecutorTest.includes("run writes FAILED terminal result for forbidden executor mutation")) {
    result.push("loop/executor.test.ts must cover production forbidden mutation and HEAD-change hard guards");
  }
  if (!contractIncludes(sharedProductionBrickMap, "fails closed on the shared `forbidden_mutation` outcome before verification/commit")
    || !plan.includes("production executor forbidden-mutation guard slice")
    || !actionLog.includes("Production Executor Forbidden Mutation Guard")) {
    result.push("RA-356 docs must record the production executor forbidden-mutation hard-guard slice");
  }
  for (const [codeName, codeBody] of [
    ["loop/executor-source-commit.ts", executorSourceCommit],
    ["stage-lab/executor-task-workspace-continue.ts", executorTaskWorkspaceContinue],
    ["stage-lab/executor-workspace-source-snapshot.ts", executorWorkspaceSourceSnapshot],
  ]) {
    if (!codeBody.includes("parseExecutorGitStatusChangedFiles")) {
      result.push(`${codeName} no longer uses the shared executor git-status parser`);
    }
  }
  if (!executorActionCore.includes("parseExecutorGitStatusChangedFiles")) {
    result.push("loop/executor-action-core.ts no longer uses the shared executor git-status parser");
  }
  return result;
}

function productionConvergenceCodeSource(codeName) {
  const sources = new Map([
    ["loop/executor.ts", loopExecutor],
    ["planning/planner.ts", planner],
    ["planning/spec-migration-apply.ts", plannerSpecMigrationApply],
    ["control/controller.ts", controller],
    ["agents/provider-session-checkpoint.ts", providerSessionCheckpoint],
    ["stage-lab/planner-project-dry-run.ts", plannerProjectDryRun],
    ["stage-lab/controller-project-dry-run.ts", controllerProjectDryRun],
    ["stage-lab/executor-project-task.ts", executorProjectTask],
    ["stage-lab/executor-task-workspace.ts", executorTaskWorkspace],
    ["stage-lab/catalog.ts", stageCatalogSource],
    ["verification/visual-workbench-automation.ts", visualWorkbenchAutomation],
    ["admin-lab.ts", adminLab],
  ]);
  return sources.get(codeName) ?? null;
}

function extractConstArrayBlock(source, constName) {
  const declarationStart = source.indexOf(`const ${constName}`);
  if (declarationStart === -1) return null;
  const assignmentStart = source.indexOf("=", declarationStart);
  if (assignmentStart === -1) return null;
  const arrayStart = source.indexOf("[", assignmentStart);
  if (arrayStart === -1) return null;
  return sliceBalanced(source, arrayStart, "[", "]");
}

function extractObjectBlockById(source, id) {
  const idStart = source.indexOf(`id: "${id}",`);
  if (idStart === -1) return null;
  const objectStart = source.lastIndexOf("{", idStart);
  if (objectStart === -1) return null;
  return sliceBalanced(source, objectStart, "{", "}");
}

function extractStringProperty(source, propertyName) {
  const escapedProperty = propertyName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = source.match(new RegExp(`${escapedProperty}: "([^"]+)"`));
  return match?.[1] ?? null;
}

function sliceBalanced(source, start, openChar, closeChar) {
  let depth = 0;
  for (let index = start; index < source.length; index += 1) {
    const char = source[index];
    if (char === openChar) depth += 1;
    if (char === closeChar) {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  return null;
}
