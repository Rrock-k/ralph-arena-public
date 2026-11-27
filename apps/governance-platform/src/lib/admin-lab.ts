import "server-only";

import { execFile } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import type { Session } from "next-auth";
import { getProjectOperatorSnapshotForViewer } from "@/lib/admin-ops-projects";
import {
  getProjectInteractionSnapshotForViewer,
} from "@/lib/project-interaction";
import { buildVisualEvidenceReadiness } from "@/lib/project-visual-evidence-readiness";
import { getProjectSpecArtifactAudit } from "@/lib/spec-artifact-audit";
import { buildRuntimeIntentClaimDryRun } from "@/lib/runtime-intent-claim-dry-run";
import { buildRunnerInitReadinessSummary } from "@/lib/runner-init-readiness";
import { buildProjectVisualEvidenceArtifactCheck } from "@/lib/project-visual-evidence-artifact-check";
import { getAdminLabProjectActionDefinition } from "@/lib/admin-lab-actions";
import { setAgentIntentInternal } from "@/app/actions/agent-intent";
import { INTERNAL_ACTION_TOKEN } from "@/lib/internal-action-token";

export const ADMIN_LAB_RUN_SCHEMA_VERSION = "ra-356.admin-lab-run.v1" as const;
const PROJECT_STAGE_SNAPSHOT_TASK_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/;
const PROJECT_STAGE_SNAPSHOT_MAX_TAIL = 5000;
const PROJECT_STAGE_SNAPSHOT_TIMEOUT_MS = 30_000;
const PROJECT_STAGE_SNAPSHOT_MAX_BUFFER = 10 * 1024 * 1024;
const PROJECT_STAGE_CANDIDATES_MAX_LIMIT = 100;
const PROJECT_STAGE_CANDIDATES_MAX_TAIL = 5000;
const PROJECT_STAGE_CANDIDATES_TIMEOUT_MS = 60_000;
const PROJECT_STAGE_CANDIDATES_MAX_BUFFER = 10 * 1024 * 1024;
const PLANNER_PROJECT_DRY_RUN_MAX_TIMEOUT_MINUTES = 60;
const PLANNER_PROJECT_DRY_RUN_EXTRA_TIMEOUT_MS = 120_000;
const PLANNER_PROJECT_DRY_RUN_MAX_BUFFER = 25 * 1024 * 1024;
const CONTROLLER_PROJECT_DRY_RUN_MAX_TIMEOUT_MINUTES = 60;
const CONTROLLER_PROJECT_DRY_RUN_EXTRA_TIMEOUT_MS = 120_000;
const CONTROLLER_PROJECT_DRY_RUN_MAX_BUFFER = 25 * 1024 * 1024;
const VISUAL_WORKBENCH_SELECTOR_READINESS_TIMEOUT_MS = 60_000;
const VISUAL_WORKBENCH_SELECTOR_READINESS_MAX_BUFFER = 10 * 1024 * 1024;
const VISUAL_WORKBENCH_SHELL_POLICY_TIMEOUT_MS = 60_000;
const VISUAL_WORKBENCH_SHELL_POLICY_MAX_BUFFER = 10 * 1024 * 1024;
const VISUAL_WORKBENCH_BROWSER_READINESS_TIMEOUT_MS = 60_000;
const VISUAL_WORKBENCH_BROWSER_READINESS_MAX_BUFFER = 10 * 1024 * 1024;
const VISUAL_WORKBENCH_AUTOMATION_STATUS_TIMEOUT_MS = 60_000;
const VISUAL_WORKBENCH_AUTOMATION_STATUS_MAX_BUFFER = 10 * 1024 * 1024;
const VISUAL_WORKBENCH_EVIDENCE_CHAIN_READINESS_TIMEOUT_MS = 60_000;
const VISUAL_WORKBENCH_EVIDENCE_CHAIN_READINESS_MAX_BUFFER = 10 * 1024 * 1024;
const VISUAL_WORKBENCH_EVIDENCE_AUTOMATION_TIMEOUT_MS = 5 * 60_000;
const VISUAL_WORKBENCH_EVIDENCE_AUTOMATION_MAX_BUFFER = 25 * 1024 * 1024;
const VISUAL_WORKBENCH_MANIFEST_READINESS_TIMEOUT_MS = 60_000;
const VISUAL_WORKBENCH_MANIFEST_READINESS_MAX_BUFFER = 10 * 1024 * 1024;
const PROMPT_CONTRACT_REPLAY_TIMEOUT_MS = 30_000;
const PROMPT_CONTRACT_REPLAY_MAX_BUFFER = 10 * 1024 * 1024;
const PROMPT_CONTRACT_REPLAY_RESULT_SCHEMA_VERSION = "ra-356.prompt-replay-result.v1";
const PROMPT_CONTRACT_REPLAY_SHA256_PATTERN = /^[a-f0-9]{64}$/;
const PROJECT_STAGE_SNAPSHOT_SCHEMA_VERSION = "ra-356.project-stage-snapshot.v1";
const PLANNER_PROJECT_DRY_RUN_RESULT_SCHEMA_VERSION = "ra-356.planner-project-dry-run-result.v0";
const PLANNER_SPEC_MIGRATION_APPLY_RESULT_SCHEMA_VERSION = "ra-356.planner-spec-migration-apply-result.v0";
const CONTROLLER_PROJECT_DRY_RUN_RESULT_SCHEMA_VERSION = "ra-356.controller-project-dry-run-result.v0";
const EXECUTOR_PROJECT_TASK_RESULT_SCHEMA_VERSION = "ra-356.executor-project-task-result.v0";
const VISUAL_WORKBENCH_EVIDENCE_AUTOMATION_RESULT_SCHEMA_VERSION = "ra-356.visual-workbench-automation.v5";
const EXECUTOR_PROJECT_TASK_MAX_TIMEOUT_MINUTES = 60;
const EXECUTOR_PROJECT_TASK_EXTRA_TIMEOUT_MS = 120_000;
const EXECUTOR_PROJECT_TASK_MAX_BUFFER = 25 * 1024 * 1024;
const EXECUTOR_PROJECT_TASK_COMPLETION_PROMISE_MAX_LENGTH = 2000;
const EXECUTOR_PROJECT_TASK_MODEL_MAX_LENGTH = 160;
const RALPH_RUNTIME_REPO_ROOT_COMMAND = "npm --prefix packages/loops/ralph-runtime run ralph --";

export type AdminLabStageStatus = "supported_now" | "target_shape";
export type AdminLabRunSurface = "admin_lab_run" | "direct_cli" | "target_shape";
export type AdminLabExecutorMode = "new_task" | "failed_task" | "resume_interrupted";
export type AdminLabExecutorAgent = "claude-code" | "codex" | "opencode";
export type AdminLabVisualEvidenceMode = "off" | "required" | "new_tasks_only";
export type AdminLabPromptReplayFixture = "product_skill" | "ux_skill";
export type AdminLabControllerTrigger =
  | "phase_complete"
  | "periodic"
  | "failure_threshold"
  | "replan"
  | "manual"
  | "final"
  | "spec_migration";

export type AdminLabStageId =
  | "project_operator_snapshot"
  | "spec_artifact_audit"
  | "runtime_claim_dry_run"
  | "runner_init_readiness"
  | "project_agent_off"
  | "project_agent_on"
  | "proof_reviews"
  | "visual_evidence_artifact_check"
  | "visual_evidence_ingest"
  | "prompt_contract_replay"
  | "project_stage_candidates"
  | "project_stage_snapshot"
  | "planner_project_dry_run"
  | "planner_spec_migration_apply"
  | "executor_project_task"
  | "executor_task_workspace_continue"
  | "executor_workspace_source_snapshot"
  | "controller_project_dry_run"
  | "visual_workbench_manifest_readiness"
  | "visual_workbench_selector_readiness"
  | "visual_workbench_shell_policy"
  | "visual_workbench_browser_readiness"
  | "visual_workbench_automation_status"
  | "visual_workbench_evidence_chain_readiness"
  | "visual_workbench_evidence_automation"
  | "visual_workbench_evidence_automation_run";

export type AdminLabStageCatalogItem = {
  id: AdminLabStageId;
  label: string;
  status: AdminLabStageStatus;
  runSurface: AdminLabRunSurface;
  mode: "read_only" | "fixture" | "workspace_dry_run" | "workspace_mutation" | "operator_mutation" | "target_shape";
  ownerBoundary: string;
  description: string;
  currentCommand: string | null;
  allowedMutations: string[];
  forbiddenMutations: string[];
  nextHandoff: string[];
};

export type AdminLabRunOptions = {
  taskId?: string;
  tail?: number;
  limit?: number;
  includeArchived?: boolean;
  visualEvidenceMode?: AdminLabVisualEvidenceMode;
  executorMode?: AdminLabExecutorMode;
  completionPromise?: string;
  agent?: AdminLabExecutorAgent;
  model?: string;
  timeoutMinutes?: number;
  controllerTrigger?: AdminLabControllerTrigger;
  promptReplayFixture?: AdminLabPromptReplayFixture;
  confirmed?: boolean;
};

const PROMPT_REPLAY_FIXTURES: Record<AdminLabPromptReplayFixture, {
  label: string;
  fixturePath: string;
  expectedPromptId: string;
}> = {
  product_skill: {
    label: "Product role guidance",
    fixturePath: "work/plans/ra-356-manual-experiment-tooling/fixtures/executor-product-skill.json",
    expectedPromptId: "executor.productSkill",
  },
  ux_skill: {
    label: "UX role guidance",
    fixturePath: "work/plans/ra-356-manual-experiment-tooling/fixtures/executor-ux-skill.json",
    expectedPromptId: "executor.uxSkill",
  },
};

const ADMIN_LAB_STAGE_CATALOG: AdminLabStageCatalogItem[] = [
  {
    id: "project_operator_snapshot",
    label: "Project status",
    status: "supported_now",
    runSurface: "admin_lab_run",
    mode: "read_only",
    ownerBoundary: "ProjectOperatorSnapshot",
    description: "Reads the current project status for one project.",
    currentCommand: null,
    allowedMutations: ["none"],
    forbiddenMutations: ["lifecycle writes", "runtime-intent writes", "task/evidence/progress writes"],
    nextHandoff: ["Choose another read-only lab stage or use normal operator actions outside Lab."],
  },
  {
    id: "project_agent_off",
    label: "Pause agent",
    status: "supported_now",
    runSurface: "admin_lab_run",
    mode: "operator_mutation",
    ownerBoundary: "governance.project-agent-intent",
    description: "Sets Agent intent OFF through the existing lifecycle owner while preserving App/preview intent.",
    currentCommand: null,
    allowedMutations: ["ProjectComponent.agentIntent through governance setAgentIntent owner"],
    forbiddenMutations: ["App power changes", "runtime recreate", "relaunch", "retry", "blocker edits", "task/progress/evidence writes"],
    nextHandoff: ["Run read-only project status or task context before choosing the next manual Lab action."],
  },
  {
    id: "project_agent_on",
    label: "Resume agent",
    status: "supported_now",
    runSurface: "admin_lab_run",
    mode: "operator_mutation",
    ownerBoundary: "governance.project-agent-intent",
    description: "Sets Agent intent ON through the existing lifecycle owner so normal claim path can resume work.",
    currentCommand: null,
    allowedMutations: ["ProjectComponent.agentIntent through governance setAgentIntent owner"],
    forbiddenMutations: ["App power changes", "runtime recreate", "relaunch", "retry", "blocker edits", "task/progress/evidence writes"],
    nextHandoff: ["Use project status readback to confirm whether work resumed, idled or blocked."],
  },
  {
    id: "spec_artifact_audit",
    label: "Spec artifact audit",
    status: "supported_now",
    runSurface: "admin_lab_run",
    mode: "read_only",
    ownerBoundary: "AcceptedSpecArtifact audit",
    description: "Checks accepted artifact identity/readiness for one project.",
    currentCommand: null,
    allowedMutations: ["none"],
    forbiddenMutations: ["accepted-spec reinterpretation", "planner/executor/controller runs"],
    nextHandoff: ["Use task context or preflight before any launch or stage experiment."],
  },
  {
    id: "runtime_claim_dry_run",
    label: "Runtime claim dry-run",
    status: "supported_now",
    runSurface: "admin_lab_run",
    mode: "read_only",
    ownerBoundary: "runtime-intent claim projection",
    description: "Evaluates runtime claim policy without locking or creating a lease.",
    currentCommand: null,
    allowedMutations: ["none"],
    forbiddenMutations: ["runtime-intent lease creation", "container start", "hidden retry/relaunch"],
    nextHandoff: ["If a real action is needed, use the explicit operator action outside Lab."],
  },
  {
    id: "runner_init_readiness",
    label: "Runner init readiness",
    status: "supported_now",
    runSurface: "admin_lab_run",
    mode: "read_only",
    ownerBoundary: "runner init readiness",
    description: "Reads runner initialization readiness for the project.",
    currentCommand: null,
    allowedMutations: ["none"],
    forbiddenMutations: ["runner config writes", "runtime recreate", "source repair"],
    nextHandoff: ["Fix readiness through the owning config/runtime path."],
  },
  {
    id: "proof_reviews",
    label: "Screenshot reviews",
    status: "supported_now",
    runSurface: "admin_lab_run",
    mode: "read_only",
    ownerBoundary: "ProjectInteractionSnapshot",
    description: "Checks whether Arena already has screenshot review rows for this project.",
    currentCommand: null,
    allowedMutations: ["none"],
    forbiddenMutations: ["raw artifact scans", "Telegram delivery inference", "evidence creation"],
    nextHandoff: ["Run artifact check only when visualEvidenceReviews exist."],
  },
  {
    id: "visual_evidence_artifact_check",
    label: "Visual evidence artifact check",
    status: "supported_now",
    runSurface: "admin_lab_run",
    mode: "read_only",
    ownerBoundary: "visual evidence artifact download owner",
    description: "Checks current visualEvidenceReviews artifact downloadability without returning bytes.",
    currentCommand: null,
    allowedMutations: ["none"],
    forbiddenMutations: ["raw bytes response", "storage path leakage", "raw Workbench folder scans"],
    nextHandoff: ["Open the project visual evidence review when artifacts are available."],
  },
  {
    id: "visual_evidence_ingest",
    label: "Visual evidence ingest",
    status: "supported_now",
    runSurface: "direct_cli",
    mode: "operator_mutation",
    ownerBoundary: "governance.project-visual-evidence-ingest",
    description: "Imports one explicit published Workbench evidence row and matching screenshot asset into Arena after a completed/manual experiment.",
    currentCommand: "services/arena-ctl/cli.sh project_visual_evidence_ingest --project-id <id> --task-id <task-id> --evidence-ref <visual-workbench-capture:...> --progress-json <workspace/.arena/progress.json> --artifact-file <workspace/.ralph/visual-workbench/.../capture.png>",
    allowedMutations: ["selected visualEvidence row merge into Project.progressJson", "matching system ProjectAsset import", "idempotent same path and sha reuse"],
    forbiddenMutations: ["raw progress JSON overwrite", "raw Workbench folder scans", "proofReviews[] writes", "task/lifecycle/runtime writes", "retry/relaunch/unblock", "Telegram/outbox writes"],
    nextHandoff: ["Run Screenshot reviews, then Screenshot files when visualEvidenceReviews exist."],
  },
  {
    id: "prompt_contract_replay",
    label: "Prompt contract replay",
    status: "supported_now",
    runSurface: "admin_lab_run",
    mode: "fixture",
    ownerBoundary: "ralph.prompt-repository",
    description: "Browser wrapper over Ralph Prompt Lab replay for one fixed product or UX role-skill fixture.",
    currentCommand: null,
    allowedMutations: ["explicit disposable --out file only"],
    forbiddenMutations: ["model provider calls", "planner/executor/controller runs", "prompt trace writes", ".ralph/.arena/task/evidence writes", "lifecycle/runtime/proof writes"],
    nextHandoff: ["Inspect the rendered prompt text before changing a prompt or running a later explicit stage."],
  },
  {
    id: "project_stage_candidates",
    label: "Find work",
    status: "supported_now",
    runSurface: "admin_lab_run",
    mode: "read_only",
    ownerBoundary: "arena-ctl.project-stage-candidates",
    description: "Scans a capped active-project list through source-current arena-ctl project_stage_candidates to find executor task candidates.",
    currentCommand: null,
    allowedMutations: ["none; read-only disposable CLI output only"],
    forbiddenMutations: ["implicit task selection", "planner/executor/controller runs", "lifecycle writes", "runtime-intent writes", "source/plan/task/evidence writes"],
    nextHandoff: ["Pick one candidate project/task, then run Get task context explicitly for that task."],
  },
  {
    id: "project_stage_snapshot",
    label: "Task context",
    status: "supported_now",
    runSurface: "admin_lab_run",
    mode: "read_only",
    ownerBoundary: "arena-ctl.project-stage-snapshot",
    description: "Prepares disposable task context for one live project before a manual stage experiment.",
    currentCommand: null,
    allowedMutations: ["none; read-only disposable CLI output only"],
    forbiddenMutations: ["persisted project/task truth", "secrets", "lifecycle writes", "provider calls"],
    nextHandoff: ["Use this task context as input for one explicit planner, executor or controller action."],
  },
  {
    id: "planner_project_dry_run",
    label: "Planner project dry-run",
    status: "supported_now",
    runSurface: "admin_lab_run",
    mode: "workspace_dry_run",
    ownerBoundary: "ralph.planner.dry-run-adapter",
    description: "Runs one initial planner provider call from fresh task context and temp fork without applying plan changes.",
    currentCommand: `${RALPH_RUNTIME_REPO_ROOT_COMMAND} stage run planner_project_dry_run --snapshot <project-stage-snapshot.json> --work-dir <forked-project-source> --source-ref <snapshot-git-commit> --spec <workDir-relative-spec> --visual-evidence-mode <off|required|new_tasks_only> --out-dir <experiment-output-dir-outside-work-dir> --agent <claude-code|codex|opencode> --model <model> --timeout-minutes <minutes>`,
    allowedMutations: ["explicit experiment output directory outside workDir only"],
    forbiddenMutations: [".ralph/plan.json writes", "prompt trace writes", "source workspace mutations", "executor/controller auto-start", "lifecycle writes"],
    nextHandoff: ["Inspect planner-project-dry-run.json before manually choosing the next stage."],
  },
  {
    id: "planner_spec_migration_apply",
    label: "Apply spec diff to plan",
    status: "supported_now",
    runSurface: "admin_lab_run",
    mode: "workspace_mutation",
    ownerBoundary: "ralph.planner-spec-migration-apply",
    description: "Materializes accepted spec changes into existing .ralph/plan.json task truth through the same planner migration owner used by real Ralph, then stops.",
    currentCommand: `${RALPH_RUNTIME_REPO_ROOT_COMMAND} stage run planner_spec_migration_apply --snapshot <project-stage-snapshot.json> --source-ref <snapshot-git-commit> --out-dir <experiment-output-dir-outside-live-workspace> --agent <claude-code|codex|opencode> --model <model> --timeout-minutes <minutes>`,
    allowedMutations: ["live project .ralph/plan.json through PlanManager", "live project .ralph/decisions-log.json through JudgmentLog", "live project .ralph/prompt-trace.jsonl and .ralph/prompt-traces through Planner", "explicit experiment output directory outside live workspace"],
    forbiddenMutations: ["client workDir/spec/visualEvidenceMode inputs", "source files outside planner-owned .ralph files", "task/evidence/proof/lifecycle/runtime writes", "executor/controller/Workbench auto-start", "git commit, HEAD change or remote push"],
    nextHandoff: ["Inspect planner-spec-migration-apply.json and .ralph/plan.json diff, then manually select executor_project_task for one task."],
  },
  {
    id: "executor_project_task",
    label: "Executor single-task run",
    status: "supported_now",
    runSurface: "admin_lab_run",
    mode: "workspace_mutation",
    ownerBoundary: "ralph.executor-project-task-adapter",
    description: "Runs one selected new, failed or interrupted task from fresh task context as an explicit live workspace action through the source-current Ralph CLI, using the context visual policy through Ralph executor-observer.",
    currentCommand: `${RALPH_RUNTIME_REPO_ROOT_COMMAND} stage run executor_project_task --snapshot <project-stage-snapshot.json> --mode <new_task|failed_task|resume_interrupted> --workspace-mode live_workspace_action --completion-promise <promise> --out-dir <experiment-output-dir-outside-live-workspace> --agent <claude-code|codex|opencode> --model <model> --timeout-minutes <minutes>`,
    allowedMutations: ["selected live project workspace", "local project commit after successful clean result", "explicit experiment output directory outside live workspace"],
    forbiddenMutations: ["remote source push", "task completion write", "evidence/progress/lifecycle writes", "hidden fork fallback"],
    nextHandoff: ["Inspect executor-project-task-run.json before manually choosing the next stage."],
  },
  {
    id: "executor_task_workspace_continue",
    label: "Continue failed executor fork",
    status: "supported_now",
    runSurface: "direct_cli",
    mode: "workspace_mutation",
    ownerBoundary: "ralph.executor-action-core",
    description: "Continues the same dirty fork left by a previous failed executor workspace experiment, without weakening the clean executor stage.",
    currentCommand: `${RALPH_RUNTIME_REPO_ROOT_COMMAND} stage run executor_task_workspace_continue --executor-workspace-report <previous-executor-task-workspace-run.json> --task-fixture <task.json> --prompt-fixture <executor-prompt-fixture.json> --completion-promise <promise> --visual-evidence-mode <off|required|new_tasks_only> --work-dir <same-dirty-forked-project-source> --source-ref <git-commit> --out-dir <new-experiment-output-dir-outside-work-dir> --agent <claude-code|codex|opencode> --model <model> --timeout-minutes <minutes>`,
    allowedMutations: ["same explicit dirty forked workspace", "explicit new experiment output directory outside workDir"],
    forbiddenMutations: ["live source push", "task/evidence/progress/lifecycle writes", "hidden retry/fallback", "source snapshot adoption", "git commit or HEAD change"],
    nextHandoff: ["Inspect executor-task-workspace-continue-run.json, then choose source snapshot, another explicit continuation, or discard/reset the fork."],
  },
  {
    id: "executor_workspace_source_snapshot",
    label: "Executor source snapshot",
    status: "supported_now",
    runSurface: "direct_cli",
    mode: "workspace_mutation",
    ownerBoundary: "ralph.stage-lab.executor-source-handoff",
    description: "Creates an experiment-only local source ref from a completed executor workspace run before Visual Workbench readiness.",
    currentCommand: `${RALPH_RUNTIME_REPO_ROOT_COMMAND} stage run executor_workspace_source_snapshot --executor-workspace-report <executor-task-workspace-run.json> --work-dir <forked-project-source> --source-ref <executor-before-git-commit> --out-dir <experiment-output-dir-outside-work-dir> --commit-message <message> [--project-id <id>]`,
    allowedMutations: ["explicit forked workDir git index and local experiment commit only", "explicit outDir report outside workDir only"],
    forbiddenMutations: ["remote push", "lifecycle/task evidence/proof/runtime intent writes", "Visual Workbench capture auto-run", "product source truth or remote freshness truth"],
    nextHandoff: ["Inspect executor-workspace-source-snapshot.json, then run Workbench manifest or selector readiness only when the selected task needs visual evidence."],
  },
  {
    id: "controller_project_dry_run",
    label: "Controller project dry-run",
    status: "supported_now",
    runSurface: "admin_lab_run",
    mode: "workspace_dry_run",
    ownerBoundary: "ralph.controller.dry-run-adapter",
    description: "Runs one controller review from fresh task context and temp fork without applying reports or plan changes.",
    currentCommand: `${RALPH_RUNTIME_REPO_ROOT_COMMAND} stage run controller_project_dry_run --snapshot <project-stage-snapshot.json> --work-dir <forked-project-source> --source-ref <snapshot-git-commit> --spec <workDir-relative-spec> --trigger <phase_complete|periodic|failure_threshold|replan|manual|final|spec_migration> --visual-evidence-mode <off|required|new_tasks_only> --out-dir <experiment-output-dir-outside-work-dir> --agent <claude-code|codex|opencode> --model <model> --timeout-minutes <minutes>`,
    allowedMutations: ["explicit experiment output directory outside workDir only"],
    forbiddenMutations: ["controller report writes", "plan/task/evidence/lifecycle writes", "source workspace mutations", "planner/executor auto-start", "controller startup trigger"],
    nextHandoff: ["Inspect controller-project-dry-run.json before manually choosing whether to replan, apply a future explicit stage or discard output."],
  },
  {
    id: "visual_workbench_manifest_readiness",
    label: "Visual Workbench manifest readiness",
    status: "supported_now",
    runSurface: "admin_lab_run",
    mode: "read_only",
    ownerBoundary: "ra-355.visual-workbench-manifest",
    description: "Checks whether source-owned Visual Workbench stories exist for the selected project source.",
    currentCommand: null,
    allowedMutations: ["none; read-only source-ref manifest inspection"],
    forbiddenMutations: ["client workDir/sourceRef/manifest/story/viewport/baseUrl/outDir inputs", "working-tree manifest reads outside snapshot source", "workbench server start", "Playwright screenshot capture", "task evidence/proof/lifecycle/runtime writes", "fallback to app pages or old visual scenarios"],
    nextHandoff: ["If ready, run selector readiness or capture/evidence automation with explicit story/task inputs."],
  },
  {
    id: "visual_workbench_selector_readiness",
    label: "Visual Workbench selector readiness",
    status: "supported_now",
    runSurface: "admin_lab_run",
    mode: "read_only",
    ownerBoundary: "ralph.visual-workbench-selector-readiness",
    description: "Reads which source-owned stories and viewports are explicitly selectable for a selected task before screenshot capture or evidence export.",
    currentCommand: null,
    allowedMutations: ["none; read-only diagnostic over .ralph/plan.json and visual-workbench/manifest.json"],
    forbiddenMutations: ["Workbench server start", "Playwright screenshot capture", "evidence export or assessment", ".ralph/plan.json writes", ".arena/progress.json writes", "proof review, ProjectAsset, lifecycle, runtime intent or Telegram writes", "selector inference from routes, titles, widgets, states, claims or filenames"],
    nextHandoff: ["If ready, run shell policy/capture/evidence automation; otherwise fix story taskRelevance or task feedback refs."],
  },
  {
    id: "visual_workbench_shell_policy",
    label: "Visual Workbench shell policy",
    status: "supported_now",
    runSurface: "admin_lab_run",
    mode: "read_only",
    ownerBoundary: "ralph.visual-workbench-shell-policy",
    description: "Reads whether future executor-owned automation may start the source-owned Workbench serve command.",
    currentCommand: null,
    allowedMutations: ["none; read-only diagnostic over first-party Ralph config and visual-workbench/manifest.json"],
    forbiddenMutations: ["Workbench server start", "shell command execution", "Playwright screenshot capture", "evidence export or assessment", ".ralph/plan.json writes", ".arena/progress.json writes", "proof review, ProjectAsset, lifecycle, runtime intent or Telegram writes", "fallback command, app-page capture or legacy screenshot-proof path", "self-authorization from visual-workbench/manifest.json or project config"],
    nextHandoff: ["If allowed, run browser readiness or explicit evidence automation; if blocked, fix first-party Ralph allowlist or keep capture manual."],
  },
  {
    id: "visual_workbench_browser_readiness",
    label: "Visual Workbench browser readiness",
    status: "supported_now",
    runSurface: "admin_lab_run",
    mode: "read_only",
    ownerBoundary: "platform.browser-readiness",
    description: "Checks platform-owned Playwright Chromium readiness before Visual Workbench capture.",
    currentCommand: null,
    allowedMutations: ["none; read-only platform browser launch/close probe"],
    forbiddenMutations: ["project workspace browser install", "source workspace writes", "screenshot capture", "task evidence/proof/lifecycle/runtime writes", "Telegram/read-side availability inference"],
    nextHandoff: ["If ready, run capture/evidence automation; if blocked, repair platform browser infrastructure outside the project workspace."],
  },
  {
    id: "visual_workbench_evidence_automation",
    label: "Visual Workbench evidence automation",
    status: "supported_now",
    runSurface: "direct_cli",
    mode: "workspace_mutation",
    ownerBoundary: "ralph.visual-workbench-evidence-automation",
    description: "Runs the explicit selector, shell-policy, browser-readiness, capture, evidence export and progress publish chain for one task.",
    currentCommand: `${RALPH_RUNTIME_REPO_ROOT_COMMAND} visual-workbench automate-evidence --work-dir <project-source-workspace> --manifest visual-workbench/manifest.json --task <taskId> --source-ref <git-commit> --base-url <http://127.0.0.1:port> --out-dir <capture-output-dir-outside-work-dir> --config <ralph.config.json>`,
    allowedMutations: ["explicit capture output directory outside workDir", "Workbench adoption artifacts under .ralph/visual-workbench", "task-linked inconclusive evidence through PlanManager", ".arena/progress.json visual evidence projection"],
    forbiddenMutations: ["lifecycle, runtime intent, blocker or task status writes", "screenshotProof or proofReviews[] writes", "ProjectAsset upload or asset-derived evidence creation", "pass/fail assessment from capture", "fallback Workbench command, app-page capture or legacy screenshot-proof path", "selector inference from text, routes, filenames or screenshots", "project workspace browser install or browser-infra self-repair"],
    nextHandoff: ["Inspect the automation report, then use Arena visual evidence readback/artifact check or add manual assessment after user review."],
  },
  {
    id: "visual_workbench_evidence_automation_run",
    label: "Run Workbench evidence automation",
    status: "supported_now",
    runSurface: "admin_lab_run",
    mode: "workspace_mutation",
    ownerBoundary: "ralph.visual-workbench-evidence-automation",
    description: "Runs the source-current Workbench evidence automation owner for one selected task with server-derived workspace, source ref, base URL, output directory and config.",
    currentCommand: `${RALPH_RUNTIME_REPO_ROOT_COMMAND} visual-workbench automate-evidence --work-dir <server-derived-project-source-workspace> --manifest visual-workbench/manifest.json --task <taskId> --source-ref <snapshot-git-commit> --base-url <server-allocated-localhost-url> --out-dir <server-created-output-dir-outside-work-dir> --config <server-derived-ralph.config.json>`,
    allowedMutations: ["explicit capture output directory outside workDir", "Workbench adoption artifacts under .ralph/visual-workbench", "task-linked inconclusive evidence through PlanManager", ".arena/progress.json visual evidence projection"],
    forbiddenMutations: ["client workDir/sourceRef/baseUrl/outDir/config inputs", "lifecycle, runtime intent, blocker or task status writes", "screenshotProof or proofReviews[] writes", "ProjectAsset upload or asset-derived evidence creation", "pass/fail assessment from capture", "fallback Workbench command, app-page capture or legacy screenshot-proof path", "selector inference from text, routes, filenames or screenshots", "project workspace browser install or browser-infra self-repair", "evidence ingest, controller, executor, retry, relaunch, commit or push auto-start"],
    nextHandoff: ["Inspect the automation report, then explicitly choose automation status, evidence-chain readiness, Arena ingest or screenshot readback."],
  },
  {
    id: "visual_workbench_automation_status",
    label: "Visual Workbench automation status",
    status: "supported_now",
    runSurface: "admin_lab_run",
    mode: "read_only",
    ownerBoundary: "ralph.visual-workbench-automation-diagnostic-readback",
    description: "Reads the latest Ralph-local Visual Workbench automation diagnostic report for a selected task.",
    currentCommand: null,
    allowedMutations: ["none; read-only diagnostic over one task latest automation report"],
    forbiddenMutations: ["capture directory scanning", "Workbench server start", "Playwright screenshot capture", "evidence export or assessment", ".ralph/plan.json writes", ".arena/progress.json writes", "proof review, ProjectAsset, lifecycle, runtime intent or Telegram writes"],
    nextHandoff: ["If a report is available and published, read Arena screenshot status; otherwise fix blockers and rerun explicit evidence automation."],
  },
  {
    id: "visual_workbench_evidence_chain_readiness",
    label: "Visual Workbench evidence chain readiness",
    status: "supported_now",
    runSurface: "admin_lab_run",
    mode: "read_only",
    ownerBoundary: "ralph.visual-evidence-chain-readiness",
    description: "Reads which explicit Workbench evidence-chain boundary is ready or blocked for one selected task.",
    currentCommand: null,
    allowedMutations: ["none; read-only diagnostic over explicit Workbench/Arena owner boundaries"],
    forbiddenMutations: ["client workDir/sourceRef/run/story/viewport/evidenceRef inputs", "capture directory scanning", "Workbench server start", "Playwright screenshot capture", "evidence export or assessment", ".ralph/plan.json writes", ".arena/progress.json writes", "proof review, ProjectAsset, lifecycle, runtime intent or Telegram writes", "Arena or tg-spec screenshot availability inference"],
    nextHandoff: ["Use nextCommands as manual CLI handoffs only; read Arena screenshot status only after the chain says Arena readback is the next explicit step."],
  },
];

const ADMIN_LAB_STAGE_IDS = new Set<string>(
  ADMIN_LAB_STAGE_CATALOG.map((stage) => stage.id),
);

export function getAdminLabStageCatalog(): AdminLabStageCatalogItem[] {
  return ADMIN_LAB_STAGE_CATALOG;
}

export function isAdminLabStageId(value: unknown): value is AdminLabStageId {
  return typeof value === "string" && ADMIN_LAB_STAGE_IDS.has(value);
}

export class AdminLabError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export async function runAdminLabStage(input: {
  stageId: AdminLabStageId;
  actionId?: string;
  projectId: string;
  session: Session | null;
  hasBypass: boolean;
  options?: AdminLabRunOptions;
}) {
  const stage = ADMIN_LAB_STAGE_CATALOG.find((item) => item.id === input.stageId);
  if (!stage) {
    throw new AdminLabError(400, "unknown_stage", "Unknown lab stage");
  }
  if (stage.status !== "supported_now" || stage.runSurface !== "admin_lab_run") {
    throw new AdminLabError(400, "stage_not_runnable", "This lab stage is not runnable through the Admin Lab UI yet.");
  }
  const actionInvocation = input.actionId
    ? buildActionInvocation(input.actionId, stage, input.options)
    : null;

  const result = await runSupportedStage({
    stageId: input.stageId,
    projectId: input.projectId,
    session: input.session,
    hasBypass: input.hasBypass,
    options: input.options,
  });

  return {
    schemaVersion: ADMIN_LAB_RUN_SCHEMA_VERSION,
    projectId: input.projectId,
    stage,
    ...(actionInvocation ? { actionInvocation } : {}),
    executedAt: new Date().toISOString(),
    result,
    evidenceNotes: buildRunEvidenceNotes(stage),
  };
}

function buildActionInvocation(
  actionId: string,
  stage: AdminLabStageCatalogItem,
  options: AdminLabRunOptions | undefined,
) {
  const action = getAdminLabProjectActionDefinition(actionId);
  if (!action || action.stageId !== stage.id) {
    throw new AdminLabError(400, "invalid_action_invocation", "Lab action invocation does not match the selected stage.");
  }
  if (action.promptReplayFixture && options?.promptReplayFixture !== action.promptReplayFixture) {
    throw new AdminLabError(
      400,
      "invalid_action_invocation",
      "Lab action invocation does not match the selected action inputs.",
    );
  }
  return {
    actionId: action.id,
    title: action.title,
    stageId: stage.id,
    ownerBoundary: stage.ownerBoundary,
    runSurface: stage.runSurface,
    mode: stage.mode,
  };
}

async function runSupportedStage(input: {
  stageId: AdminLabStageId;
  projectId: string;
  session: Session | null;
  hasBypass: boolean;
  options?: AdminLabRunOptions;
}) {
  switch (input.stageId) {
    case "project_operator_snapshot": {
      const snapshot = await getProjectOperatorSnapshotForViewer({
        projectId: input.projectId,
        session: input.session,
        hasBypass: input.hasBypass,
      });
      if (!snapshot) throw new AdminLabError(404, "project_not_found", "Project not found");
      return snapshot;
    }

    case "spec_artifact_audit": {
      const audit = await getProjectSpecArtifactAudit(input.projectId);
      if (!audit) throw new AdminLabError(404, "project_not_found", "Project not found");
      return audit;
    }

    case "runtime_claim_dry_run":
      return buildRuntimeIntentClaimDryRun({ projectId: input.projectId });

    case "runner_init_readiness":
      return buildRunnerInitReadinessSummary(input.projectId);

    case "project_agent_off":
      return setProjectAgentIntentForLab(input.projectId, "OFF");

    case "project_agent_on":
      return setProjectAgentIntentForLab(input.projectId, "ON");

    case "proof_reviews":
      return getProofReviews(input);

    case "visual_evidence_artifact_check":
      return getVisualEvidenceArtifactCheck(input);

    case "prompt_contract_replay":
      return runPromptContractReplayHelper({
        options: normalizePromptContractReplayOptions(input.options),
      });

    case "project_stage_candidates":
      return runProjectStageCandidatesHelper({
        options: normalizeProjectStageCandidatesOptions(input.options),
      });

    case "project_stage_snapshot":
      return runProjectStageSnapshotHelper({
        projectId: input.projectId,
        options: normalizeProjectStageSnapshotOptions(input.options),
      });

    case "planner_project_dry_run": {
      const options = normalizePlannerProjectDryRunOptions(input.options);
      await assertProjectVisualEvidencePolicyReadable(input);
      return runPlannerProjectDryRunHelper({
        projectId: input.projectId,
        options,
      });
    }

    case "planner_spec_migration_apply":
      return runPlannerSpecMigrationApplyHelper({
        projectId: input.projectId,
        options: normalizePlannerSpecMigrationApplyOptions(input.options),
      });

    case "controller_project_dry_run": {
      const options = normalizeControllerProjectDryRunOptions(input.options);
      await assertProjectVisualEvidencePolicyReadable(input);
      return runControllerProjectDryRunHelper({
        projectId: input.projectId,
        options,
      });
    }

    case "executor_project_task":
      return runExecutorProjectTaskHelper({
        projectId: input.projectId,
        options: normalizeExecutorProjectTaskOptions(input.options),
      });

    case "visual_workbench_manifest_readiness":
      return runVisualWorkbenchManifestReadinessHelper({
        projectId: input.projectId,
        options: normalizeVisualWorkbenchManifestReadinessOptions(input.options),
      });

    case "visual_workbench_selector_readiness":
      return runVisualWorkbenchSelectorReadinessHelper({
        projectId: input.projectId,
        options: normalizeVisualWorkbenchSelectorReadinessOptions(input.options),
      });

    case "visual_workbench_shell_policy":
      return runVisualWorkbenchShellPolicyHelper({
        projectId: input.projectId,
        options: normalizeVisualWorkbenchShellPolicyOptions(input.options),
      });

    case "visual_workbench_browser_readiness":
      return runVisualWorkbenchBrowserReadinessHelper();

    case "visual_workbench_automation_status":
      return runVisualWorkbenchAutomationStatusHelper({
        projectId: input.projectId,
        options: normalizeVisualWorkbenchAutomationStatusOptions(input.options),
      });

    case "visual_workbench_evidence_chain_readiness":
      return runVisualWorkbenchEvidenceChainReadinessHelper({
        projectId: input.projectId,
        options: normalizeVisualWorkbenchEvidenceChainReadinessOptions(input.options),
      });

    case "visual_workbench_evidence_automation_run":
      return runVisualWorkbenchEvidenceAutomationRunHelper({
        projectId: input.projectId,
        options: normalizeVisualWorkbenchEvidenceAutomationRunOptions(input.options),
      });

    default:
      throw new AdminLabError(400, "stage_not_runnable", "This lab stage is not runnable yet.");
  }
}

async function setProjectAgentIntentForLab(
  projectId: string,
  intent: "ON" | "OFF",
) {
  const result = await setAgentIntentInternal(projectId, intent, INTERNAL_ACTION_TOKEN);
  if (!result.success) {
    throw new AdminLabError(
      409,
      intent === "ON" ? "project_agent_on_rejected" : "project_agent_off_rejected",
      result.error ?? `Failed to set Agent ${intent}`,
    );
  }

  return {
    schemaVersion: "ra-356.project-agent-intent-result.v1",
    ownerBoundary: "governance.project-agent-intent",
    projectId,
    agentIntent: intent,
    success: true,
    notes: [
      "Agent intent was changed through the existing governance lifecycle owner.",
      "This action does not relaunch, retry, recreate runtime, patch task truth or create evidence.",
    ],
  };
}

async function assertProjectVisualEvidencePolicyReadable(input: {
  projectId: string;
  session: Session | null;
  hasBypass: boolean;
}) {
  const snapshot = await getProjectOperatorSnapshotForViewer({
    projectId: input.projectId,
    session: input.session,
    hasBypass: input.hasBypass,
  });
  if (!snapshot) throw new AdminLabError(404, "project_not_found", "Project not found");
  if (snapshot.visualEvidenceModeError || !snapshot.visualEvidenceMode) {
    throw new AdminLabError(
      400,
      "invalid_project_visual_evidence_mode",
      `Project visual evidence policy must be readable before this dry-run: ${snapshot.visualEvidenceModeError ?? "mode is missing"}`,
    );
  }
}

function buildRunEvidenceNotes(stage: AdminLabStageCatalogItem): string[] {
  if (stage.id === "project_agent_off" || stage.id === "project_agent_on") {
    return [
      "Admin Lab called the existing governance Agent lifecycle owner through setAgentIntent.",
      "This is the same Agent OFF/ON owner used by arena-ctl and operator actions; it is not a Lab-only pause state.",
      "The action does not relaunch, retry, recreate runtime, patch task truth or create proof/evidence.",
    ];
  }

  if (stage.id === "project_stage_candidates") {
    return [
      "Admin Lab used the source-current arena-ctl project_stage_candidates command through a fixed stage-specific backend runner.",
      "This run scanned a capped project list through task-context owner reads; it did not select a task or run planner/executor/controller.",
      "Use scan.truncated and scan.omittedProjectCount before treating zero candidates as a fleet-wide result.",
    ];
  }

  if (stage.id === "project_stage_snapshot") {
    return [
      "Admin Lab used the source-current arena-ctl project_stage_snapshot command through a fixed stage-specific backend runner.",
      "This run did not create runtime-intent leases, start containers, write task/evidence/progress, or run planner/executor/controller.",
      "If the source-current command is unavailable in this runtime, the lab reports that as unavailable instead of synthesizing a snapshot.",
    ];
  }

  if (stage.id === "prompt_contract_replay") {
    return [
      "Admin Lab called the source-current Ralph Prompt Lab replay owner through a bounded browser wrapper for one fixed product/UX role-skill fixture.",
      "The Ralph stage catalog can still expose prompt_contract_replay as a direct CLI handoff; this Admin Lab run is a wrapper, not a second prompt owner.",
      "Governance did not render prompt bodies itself, accept arbitrary fixture paths, call providers, run product/UX stages or write prompt traces.",
      "This result is prompt inspection only; it is not product findings, UX findings, task evidence or screenshot proof.",
    ];
  }

  if (stage.id === "executor_project_task") {
    return [
      "Admin Lab used arena-ctl project_stage_snapshot first, then passed that exact disposable snapshot file to the source-current Ralph executor_project_task CLI.",
      "Governance did not render executor prompts, call providers directly, classify diffs or create project commits itself.",
      "Governance did not accept an executor visual-mode input; Ralph used the snapshot visualEvidencePolicy through the shared executor-observer helper.",
      "The Ralph stage may mutate the selected live project workspace and create a local project commit; it must not write task/lifecycle/proof/evidence truth, auto-push, or fall back to fork mode.",
    ];
  }

  if (stage.id === "planner_project_dry_run") {
    return [
      "Admin Lab used arena-ctl project_stage_snapshot first, cloned the selected source commit into a temp fork, then passed that disposable snapshot/fork to the source-current Ralph planner_project_dry_run CLI.",
      "Governance did not render planner prompts, call providers directly, parse planner output or apply .ralph/plan.json itself.",
      "The Ralph stage writes only experiment output outside the temp fork; it must not mutate the source workspace, start executor/controller, write task/proof/lifecycle truth, or invent missing spec/config defaults.",
    ];
  }

  if (stage.id === "planner_spec_migration_apply") {
    return [
      "Admin Lab used arena-ctl project_stage_snapshot first, then passed that exact disposable snapshot file and its source commit to the source-current Ralph planner_spec_migration_apply CLI.",
      "Governance did not render planner prompts, call providers directly, patch .ralph/plan.json, accept client workDir/spec/visualEvidenceMode inputs, or apply dry-run output.",
      "The Ralph stage may mutate planner-owned .ralph plan/judgment/prompt-trace files in the selected live workspace and then stops; it must not start executor, controller, Workbench, lifecycle repair, deploy or push.",
    ];
  }

  if (stage.id === "controller_project_dry_run") {
    return [
      "Admin Lab used arena-ctl project_stage_snapshot first, cloned the selected source commit into a temp fork, then passed that disposable snapshot/fork to the source-current Ralph controller_project_dry_run CLI.",
      "Governance did not render controller prompts, call providers directly, parse or apply ControllerReport truth, write controller reports, or update .ralph/plan.json itself.",
      "The Ralph stage writes only experiment output outside the temp fork; it must not mutate source, start planner/executor, write task/proof/lifecycle truth, or accept the controller startup trigger.",
    ];
  }

  if (stage.id === "visual_workbench_manifest_readiness") {
    return [
      "Admin Lab used arena-ctl project_stage_snapshot first, then passed the snapshot live workspace and source commit to the source-current Ralph visual-workbench inspect owner.",
      "Governance did not accept client workDir/sourceRef/manifest/story/viewport/baseUrl/outDir inputs, read raw Workbench files itself, start the Workbench server, run Playwright, capture screenshots or export evidence.",
      "A ready manifest result only means source-owned Workbench story coverage is structurally usable for later selector/capture steps; it is not screenshot proof or Telegram screenshot availability.",
    ];
  }

  if (stage.id === "visual_workbench_selector_readiness") {
    return [
      "Admin Lab used arena-ctl project_stage_snapshot first, then passed the snapshot-selected live workspace and task id to the source-current Ralph visual-workbench selector-readiness owner.",
      "Governance did not read raw Workbench stories, infer selectors, start the Workbench server, run Playwright, capture screenshots, export evidence, publish progress, or infer Telegram screenshot availability.",
      "A ready selector result only means story and viewport choices are explicit enough for a later manual capture/export step; it is not screenshot proof.",
    ];
  }

  if (stage.id === "visual_workbench_shell_policy") {
    return [
      "Admin Lab used arena-ctl project_stage_snapshot first, then passed the snapshot-selected live workspace and runner-owned .arena/ralph.config.json path to the source-current Ralph visual-workbench shell-policy owner.",
      "Governance did not accept client workDir, manifest, config, baseUrl or outDir inputs, and did not treat source-owned manifest commands as authority to execute.",
      "Shell policy is diagnostic readback only; it does not execute the Workbench serve command, start a browser, capture screenshots, export evidence or publish progress.",
    ];
  }

  if (stage.id === "visual_workbench_browser_readiness") {
    return [
      "Admin Lab called the source-current Ralph visual-workbench browser-readiness owner with fixed arguments only.",
      "Governance did not accept project workDir, sourceRef, manifest, story/viewport, baseUrl or outDir inputs for this platform check.",
      "A ready browser result only means the platform browser probe passed; it is not screenshot capture, screenshot proof or Telegram screenshot availability.",
    ];
  }

  if (stage.id === "visual_workbench_automation_status") {
    return [
      "Admin Lab used arena-ctl project_stage_snapshot first, then passed the snapshot-selected live workspace and task id to the source-current Ralph visual-workbench automation-status owner.",
      "Governance did not accept project workDir, sourceRef, report path, manifest, story/viewport, baseUrl, outDir or capture/export/ingest inputs for this readback.",
      "Automation status is diagnostic readback only; it is not screenshot capture, screenshot proof, progress publish or Telegram screenshot availability.",
    ];
  }

  if (stage.id === "visual_workbench_evidence_chain_readiness") {
    return [
      "Admin Lab used arena-ctl project_stage_snapshot first, then passed the snapshot-selected live workspace, task id and project id to the source-current Ralph visual-workbench evidence-chain-readiness owner.",
      "Governance did not accept project workDir, sourceRef, run, story, viewport, evidenceRef, baseUrl, outDir or capture/export/ingest inputs for this readiness check.",
      "Evidence-chain readiness is diagnostic readback only; nextCommands are manual handoffs and are not screenshot capture, screenshot proof, progress publish or Telegram screenshot availability.",
    ];
  }

  if (stage.id === "visual_workbench_evidence_automation_run") {
    return [
      "Admin Lab used arena-ctl project_stage_snapshot first, then derived the live workspace, task id, source commit, .arena/ralph.config.json, localhost base URL and output directory server-side.",
      "Governance called the source-current Ralph visual-workbench automate-evidence owner; it did not implement selector, shell policy, browser readiness, capture, export or progress publish itself.",
      "This action can write Workbench diagnostic/evidence/progress files for the selected task, but it must not ingest evidence, create proofReviews, deliver Telegram buttons, start controller/executor, commit, push, retry, relaunch or infer screenshot availability.",
    ];
  }

  return [
    "Admin Lab v0 uses governance read-side helpers only.",
    "This run did not create runtime-intent leases, start containers, write task/evidence/progress, or run planner/executor/controller.",
  ];
}

function normalizeProjectStageCandidatesOptions(options: AdminLabRunOptions | undefined): AdminLabRunOptions {
  const limit = options?.limit ?? 25;
  if (!Number.isInteger(limit) || limit < 1 || limit > PROJECT_STAGE_CANDIDATES_MAX_LIMIT) {
    throw new AdminLabError(400, "invalid_limit", `Project Stage Candidates limit must be an integer from 1 to ${PROJECT_STAGE_CANDIDATES_MAX_LIMIT}.`);
  }

  const tail = options?.tail ?? 5;
  if (!Number.isInteger(tail) || tail < 1 || tail > PROJECT_STAGE_CANDIDATES_MAX_TAIL) {
    throw new AdminLabError(400, "invalid_tail", `Project Stage Candidates tail must be an integer from 1 to ${PROJECT_STAGE_CANDIDATES_MAX_TAIL}.`);
  }

  return {
    limit,
    tail,
    includeArchived: options?.includeArchived === true,
  };
}

function normalizeProjectStageSnapshotOptions(options: AdminLabRunOptions | undefined): AdminLabRunOptions {
  const taskId = options?.taskId?.trim() || undefined;
  if (taskId && !PROJECT_STAGE_SNAPSHOT_TASK_ID_PATTERN.test(taskId)) {
    throw new AdminLabError(400, "invalid_task_id", "Project Stage Snapshot taskId is invalid.");
  }

  const tail = options?.tail;
  if (tail !== undefined && (!Number.isInteger(tail) || tail < 1 || tail > PROJECT_STAGE_SNAPSHOT_MAX_TAIL)) {
    throw new AdminLabError(400, "invalid_tail", `Project Stage Snapshot tail must be an integer from 1 to ${PROJECT_STAGE_SNAPSHOT_MAX_TAIL}.`);
  }

  return {
    ...(taskId ? { taskId } : {}),
    ...(tail !== undefined ? { tail } : {}),
  };
}

function normalizePromptContractReplayOptions(options: AdminLabRunOptions | undefined): AdminLabRunOptions {
  const optionKeys = Object.keys(options ?? {}).filter((key) => (options as Record<string, unknown>)[key] !== undefined);
  const unexpectedKeys = optionKeys.filter((key) => key !== "promptReplayFixture");
  if (unexpectedKeys.length > 0) {
    throw new AdminLabError(400, "invalid_prompt_replay_options", "Prompt replay accepts only promptReplayFixture.");
  }

  const promptReplayFixture = options?.promptReplayFixture;
  if (promptReplayFixture !== "product_skill" && promptReplayFixture !== "ux_skill") {
    throw new AdminLabError(400, "invalid_prompt_replay_fixture", "Prompt replay fixture must be product_skill or ux_skill.");
  }

  return { promptReplayFixture };
}

function normalizePlannerProjectDryRunOptions(options: AdminLabRunOptions | undefined): AdminLabRunOptions {
  const snapshotOptions = normalizeProjectStageSnapshotOptions(options);
  const visualEvidenceMode = options?.visualEvidenceMode;
  if (visualEvidenceMode !== "off" && visualEvidenceMode !== "required" && visualEvidenceMode !== "new_tasks_only") {
    throw new AdminLabError(400, "invalid_visual_evidence_mode", "Visual evidence mode must be off, required or new_tasks_only.");
  }

  const agent = options?.agent;
  if (agent !== "claude-code" && agent !== "codex" && agent !== "opencode") {
    throw new AdminLabError(400, "invalid_agent", "Planner agent must be claude-code, codex or opencode.");
  }

  const model = options?.model?.trim();
  if (!model) {
    throw new AdminLabError(400, "invalid_model", "Planner dry-run requires an explicit model.");
  }
  if (model.length > EXECUTOR_PROJECT_TASK_MODEL_MAX_LENGTH) {
    throw new AdminLabError(400, "invalid_model", `Planner model must be ${EXECUTOR_PROJECT_TASK_MODEL_MAX_LENGTH} characters or fewer.`);
  }

  const timeoutMinutes = options?.timeoutMinutes;
  if (
    typeof timeoutMinutes !== "number"
    || !Number.isInteger(timeoutMinutes)
    || timeoutMinutes < 1
    || timeoutMinutes > PLANNER_PROJECT_DRY_RUN_MAX_TIMEOUT_MINUTES
  ) {
    throw new AdminLabError(400, "invalid_timeout", `Planner timeout must be an integer from 1 to ${PLANNER_PROJECT_DRY_RUN_MAX_TIMEOUT_MINUTES} minutes.`);
  }

  return {
    ...(snapshotOptions.taskId ? { taskId: snapshotOptions.taskId } : {}),
    ...(snapshotOptions.tail !== undefined ? { tail: snapshotOptions.tail } : {}),
    visualEvidenceMode,
    agent,
    model,
    timeoutMinutes,
  };
}

function normalizePlannerSpecMigrationApplyOptions(options: AdminLabRunOptions | undefined): AdminLabRunOptions {
  const optionKeys = Object.keys(options ?? {}).filter((key) => (options as Record<string, unknown>)[key] !== undefined);
  const unexpectedKeys = optionKeys.filter((key) => !["agent", "model", "timeoutMinutes", "tail"].includes(key));
  if (unexpectedKeys.length > 0) {
    throw new AdminLabError(400, "invalid_planner_spec_migration_apply_options", "Planner spec migration apply accepts only agent, model, timeoutMinutes and tail.");
  }

  const tail = options?.tail;
  if (tail !== undefined && (!Number.isInteger(tail) || tail < 1 || tail > PROJECT_STAGE_SNAPSHOT_MAX_TAIL)) {
    throw new AdminLabError(400, "invalid_tail", `Planner spec migration apply tail must be an integer from 1 to ${PROJECT_STAGE_SNAPSHOT_MAX_TAIL}.`);
  }

  const agent = options?.agent;
  if (agent !== "claude-code" && agent !== "codex" && agent !== "opencode") {
    throw new AdminLabError(400, "invalid_agent", "Planner spec migration apply agent must be claude-code, codex or opencode.");
  }

  const model = options?.model?.trim();
  if (!model) {
    throw new AdminLabError(400, "invalid_model", "Planner spec migration apply requires an explicit model.");
  }
  if (model.length > EXECUTOR_PROJECT_TASK_MODEL_MAX_LENGTH) {
    throw new AdminLabError(400, "invalid_model", `Planner spec migration apply model must be ${EXECUTOR_PROJECT_TASK_MODEL_MAX_LENGTH} characters or fewer.`);
  }

  const timeoutMinutes = options?.timeoutMinutes;
  if (
    typeof timeoutMinutes !== "number"
    || !Number.isInteger(timeoutMinutes)
    || timeoutMinutes < 1
    || timeoutMinutes > PLANNER_PROJECT_DRY_RUN_MAX_TIMEOUT_MINUTES
  ) {
    throw new AdminLabError(400, "invalid_timeout", `Planner spec migration apply timeout must be an integer from 1 to ${PLANNER_PROJECT_DRY_RUN_MAX_TIMEOUT_MINUTES} minutes.`);
  }

  return {
    ...(tail !== undefined ? { tail } : {}),
    agent,
    model,
    timeoutMinutes,
  };
}

function normalizeControllerProjectDryRunOptions(options: AdminLabRunOptions | undefined): AdminLabRunOptions {
  const snapshotOptions = normalizeProjectStageSnapshotOptions(options);
  const controllerTrigger = options?.controllerTrigger;
  if (
    controllerTrigger !== "phase_complete"
    && controllerTrigger !== "periodic"
    && controllerTrigger !== "failure_threshold"
    && controllerTrigger !== "replan"
    && controllerTrigger !== "manual"
    && controllerTrigger !== "final"
    && controllerTrigger !== "spec_migration"
  ) {
    throw new AdminLabError(400, "invalid_controller_trigger", "Controller trigger must be phase_complete, periodic, failure_threshold, replan, manual, final or spec_migration.");
  }

  const visualEvidenceMode = options?.visualEvidenceMode;
  if (visualEvidenceMode !== "off" && visualEvidenceMode !== "required" && visualEvidenceMode !== "new_tasks_only") {
    throw new AdminLabError(400, "invalid_visual_evidence_mode", "Visual evidence mode must be off, required or new_tasks_only.");
  }

  const agent = options?.agent;
  if (agent !== "claude-code" && agent !== "codex" && agent !== "opencode") {
    throw new AdminLabError(400, "invalid_agent", "Controller agent must be claude-code, codex or opencode.");
  }

  const model = options?.model?.trim();
  if (!model) {
    throw new AdminLabError(400, "invalid_model", "Controller dry-run requires an explicit model.");
  }
  if (model.length > EXECUTOR_PROJECT_TASK_MODEL_MAX_LENGTH) {
    throw new AdminLabError(400, "invalid_model", `Controller model must be ${EXECUTOR_PROJECT_TASK_MODEL_MAX_LENGTH} characters or fewer.`);
  }

  const timeoutMinutes = options?.timeoutMinutes;
  if (
    typeof timeoutMinutes !== "number"
    || !Number.isInteger(timeoutMinutes)
    || timeoutMinutes < 1
    || timeoutMinutes > CONTROLLER_PROJECT_DRY_RUN_MAX_TIMEOUT_MINUTES
  ) {
    throw new AdminLabError(400, "invalid_timeout", `Controller timeout must be an integer from 1 to ${CONTROLLER_PROJECT_DRY_RUN_MAX_TIMEOUT_MINUTES} minutes.`);
  }

  return {
    ...(snapshotOptions.taskId ? { taskId: snapshotOptions.taskId } : {}),
    ...(snapshotOptions.tail !== undefined ? { tail: snapshotOptions.tail } : {}),
    controllerTrigger,
    visualEvidenceMode,
    agent,
    model,
    timeoutMinutes,
  };
}

function normalizeExecutorProjectTaskOptions(options: AdminLabRunOptions | undefined): AdminLabRunOptions {
  const snapshotOptions = normalizeProjectStageSnapshotOptions(options);
  if (!snapshotOptions.taskId) {
    throw new AdminLabError(400, "invalid_task_id", "Executor single-task run requires a selected taskId.");
  }

  const executorMode = options?.executorMode;
  if (executorMode !== "new_task" && executorMode !== "failed_task" && executorMode !== "resume_interrupted") {
    throw new AdminLabError(400, "invalid_executor_mode", "Executor mode must be new_task, failed_task or resume_interrupted.");
  }

  const completionPromise = options?.completionPromise?.trim();
  if (!completionPromise) {
    throw new AdminLabError(400, "invalid_completion_promise", "Executor run requires an explicit completion promise.");
  }
  if (completionPromise.length > EXECUTOR_PROJECT_TASK_COMPLETION_PROMISE_MAX_LENGTH) {
    throw new AdminLabError(400, "invalid_completion_promise", `Completion promise must be ${EXECUTOR_PROJECT_TASK_COMPLETION_PROMISE_MAX_LENGTH} characters or fewer.`);
  }

  const agent = options?.agent;
  if (agent !== "claude-code" && agent !== "codex" && agent !== "opencode") {
    throw new AdminLabError(400, "invalid_agent", "Executor agent must be claude-code, codex or opencode.");
  }

  const model = options?.model?.trim();
  if (!model) {
    throw new AdminLabError(400, "invalid_model", "Executor run requires an explicit model.");
  }
  if (model.length > EXECUTOR_PROJECT_TASK_MODEL_MAX_LENGTH) {
    throw new AdminLabError(400, "invalid_model", `Executor model must be ${EXECUTOR_PROJECT_TASK_MODEL_MAX_LENGTH} characters or fewer.`);
  }

  const timeoutMinutes = options?.timeoutMinutes;
  if (
    typeof timeoutMinutes !== "number"
    || !Number.isInteger(timeoutMinutes)
    || timeoutMinutes < 1
    || timeoutMinutes > EXECUTOR_PROJECT_TASK_MAX_TIMEOUT_MINUTES
  ) {
    throw new AdminLabError(400, "invalid_timeout", `Executor timeout must be an integer from 1 to ${EXECUTOR_PROJECT_TASK_MAX_TIMEOUT_MINUTES} minutes.`);
  }

  return {
    taskId: snapshotOptions.taskId,
    ...(snapshotOptions.tail !== undefined ? { tail: snapshotOptions.tail } : {}),
    executorMode,
    completionPromise,
    agent,
    model,
    timeoutMinutes,
  };
}

function normalizeVisualWorkbenchSelectorReadinessOptions(options: AdminLabRunOptions | undefined): AdminLabRunOptions {
  const snapshotOptions = normalizeProjectStageSnapshotOptions(options);
  if (!snapshotOptions.taskId) {
    throw new AdminLabError(400, "invalid_task_id", "Visual Workbench selector readiness requires a selected taskId.");
  }

  return {
    taskId: snapshotOptions.taskId,
    ...(snapshotOptions.tail !== undefined ? { tail: snapshotOptions.tail } : {}),
  };
}

function normalizeVisualWorkbenchShellPolicyOptions(options: AdminLabRunOptions | undefined): AdminLabRunOptions {
  const snapshotOptions = normalizeProjectStageSnapshotOptions(options);
  if (!snapshotOptions.taskId) {
    throw new AdminLabError(400, "invalid_task_id", "Visual Workbench shell policy requires a selected taskId.");
  }

  return {
    taskId: snapshotOptions.taskId,
    ...(snapshotOptions.tail !== undefined ? { tail: snapshotOptions.tail } : {}),
  };
}

function normalizeVisualWorkbenchManifestReadinessOptions(options: AdminLabRunOptions | undefined): AdminLabRunOptions {
  const optionKeys = Object.keys(options ?? {}).filter((key) => (options as Record<string, unknown>)[key] !== undefined);
  const unexpectedKeys = optionKeys.filter((key) => key !== "tail");
  if (unexpectedKeys.length > 0) {
    throw new AdminLabError(400, "invalid_visual_workbench_manifest_options", "Visual Workbench manifest readiness accepts only tail.");
  }

  const tail = options?.tail;
  if (tail !== undefined && (!Number.isInteger(tail) || tail < 1 || tail > PROJECT_STAGE_SNAPSHOT_MAX_TAIL)) {
    throw new AdminLabError(400, "invalid_tail", `Visual Workbench manifest readiness tail must be an integer from 1 to ${PROJECT_STAGE_SNAPSHOT_MAX_TAIL}.`);
  }

  return {
    ...(tail !== undefined ? { tail } : {}),
  };
}

function normalizeVisualWorkbenchAutomationStatusOptions(options: AdminLabRunOptions | undefined): AdminLabRunOptions {
  const snapshotOptions = normalizeProjectStageSnapshotOptions(options);
  if (!snapshotOptions.taskId) {
    throw new AdminLabError(400, "invalid_task_id", "Visual Workbench automation status requires a selected taskId.");
  }

  return {
    taskId: snapshotOptions.taskId,
    ...(snapshotOptions.tail !== undefined ? { tail: snapshotOptions.tail } : {}),
  };
}

function normalizeVisualWorkbenchEvidenceChainReadinessOptions(options: AdminLabRunOptions | undefined): AdminLabRunOptions {
  const snapshotOptions = normalizeProjectStageSnapshotOptions(options);
  if (!snapshotOptions.taskId) {
    throw new AdminLabError(400, "invalid_task_id", "Visual Workbench evidence chain readiness requires a selected taskId.");
  }

  return {
    taskId: snapshotOptions.taskId,
    ...(snapshotOptions.tail !== undefined ? { tail: snapshotOptions.tail } : {}),
  };
}

function normalizeVisualWorkbenchEvidenceAutomationRunOptions(options: AdminLabRunOptions | undefined): AdminLabRunOptions {
  const optionKeys = Object.keys(options ?? {}).filter((key) => (options as Record<string, unknown>)[key] !== undefined);
  const unexpectedKeys = optionKeys.filter((key) => !["taskId", "tail", "confirmed"].includes(key));
  if (unexpectedKeys.length > 0) {
    throw new AdminLabError(400, "invalid_visual_workbench_evidence_automation_options", "Workbench evidence automation accepts only taskId, tail and confirmed.");
  }

  const snapshotOptions = normalizeProjectStageSnapshotOptions(options);
  if (!snapshotOptions.taskId) {
    throw new AdminLabError(400, "invalid_task_id", "Workbench evidence automation requires a selected taskId.");
  }
  if (options?.confirmed !== true) {
    throw new AdminLabError(400, "visual_workbench_evidence_automation_confirmation_required", "Workbench evidence automation requires explicit operator confirmation.");
  }

  return {
    taskId: snapshotOptions.taskId,
    ...(snapshotOptions.tail !== undefined ? { tail: snapshotOptions.tail } : {}),
    confirmed: true,
  };
}

async function runProjectStageCandidatesHelper(input: {
  options: AdminLabRunOptions;
}) {
  try {
    const { stdout } = await execFileCommand(
      resolveArenaCtlCliPath(),
      buildProjectStageCandidatesArgs(input),
      {
        cwd: resolveArenaRepoRoot(),
        timeout: PROJECT_STAGE_CANDIDATES_TIMEOUT_MS,
        maxBuffer: PROJECT_STAGE_CANDIDATES_MAX_BUFFER,
        env: {
          ...process.env,
          ARENA_CTL_INVOCATION_CWD: process.cwd(),
        },
      },
    );
    return parseArenaCtlJsonStdout(stdout, "Project Stage Candidates");
  } catch (error) {
    if (error instanceof AdminLabError) throw error;
    throw new AdminLabError(
      502,
      "stage_command_failed",
      `Source-current arena-ctl project_stage_candidates command failed: ${truncate(buildCommandErrorMessage(error), 1200)}`,
    );
  }
}

async function runProjectStageSnapshotHelper(input: {
  projectId: string;
  options: AdminLabRunOptions;
}) {
  try {
    const { stdout } = await execFileCommand(
      resolveArenaCtlCliPath(),
      buildProjectStageSnapshotArgs(input),
      {
        cwd: resolveArenaRepoRoot(),
        timeout: PROJECT_STAGE_SNAPSHOT_TIMEOUT_MS,
        maxBuffer: PROJECT_STAGE_SNAPSHOT_MAX_BUFFER,
        env: {
          ...process.env,
          ARENA_CTL_INVOCATION_CWD: process.cwd(),
        },
      },
    );
    return parseArenaCtlJsonStdout(stdout, "Project Stage Snapshot");
  } catch (error) {
    if (error instanceof AdminLabError) throw error;
    throw new AdminLabError(
      502,
      "stage_command_failed",
      `Source-current arena-ctl project_stage_snapshot command failed: ${truncate(buildCommandErrorMessage(error), 1200)}`,
    );
  }
}

async function runPromptContractReplayHelper(input: {
  options: AdminLabRunOptions;
}) {
  const fixtureId = input.options.promptReplayFixture;
  if (fixtureId !== "product_skill" && fixtureId !== "ux_skill") {
    throw new AdminLabError(400, "invalid_prompt_replay_fixture", "Prompt replay fixture must be product_skill or ux_skill.");
  }
  const fixture = PROMPT_REPLAY_FIXTURES[fixtureId];
  const fixturePath = path.join(resolveArenaRepoRoot(), fixture.fixturePath);
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "ra356-admin-lab-prompt-"));
  const outPath = path.join(tempRoot, "prompt-replay.json");

  try {
    await execFileCommand(
      "npm",
      buildPromptContractReplayArgs({
        fixturePath,
        outPath,
      }),
      {
        cwd: resolveArenaRepoRoot(),
        timeout: PROMPT_CONTRACT_REPLAY_TIMEOUT_MS,
        maxBuffer: PROMPT_CONTRACT_REPLAY_MAX_BUFFER,
        env: {
          ...process.env,
          ARENA_CTL_INVOCATION_CWD: process.cwd(),
        },
      },
    );
    const promptReplay = parseArenaCtlJsonStdout(
      await readFile(outPath, "utf8"),
      "Prompt Contract Replay output",
    );
    validatePromptReplayResult({
      promptReplay,
      fixtureId,
      expectedPromptId: fixture.expectedPromptId,
    });
    return {
      schemaVersion: "ra-356.admin-lab-prompt-contract-replay.v1",
      fixture: {
        id: fixtureId,
        label: fixture.label,
        fixturePath,
        expectedPromptId: fixture.expectedPromptId,
      },
      promptReplay,
      tempFiles: {
        outPath,
      },
    };
  } catch (error) {
    if (error instanceof AdminLabError) throw error;
    throw new AdminLabError(
      502,
      "stage_command_failed",
      `Source-current Ralph prompt replay command failed: ${truncate(buildCommandErrorMessage(error), 1600)}`,
    );
  }
}

function validatePromptReplayResult(input: {
  promptReplay: unknown;
  fixtureId: AdminLabPromptReplayFixture;
  expectedPromptId: string;
}): void {
  const record = readRecord(input.promptReplay);
  if (!record) {
    throwInvalidPromptReplayOutput("result must be an object");
  }
  const schemaVersion = readString(record.schemaVersion);
  if (schemaVersion !== PROMPT_CONTRACT_REPLAY_RESULT_SCHEMA_VERSION) {
    throwInvalidPromptReplayOutput(`schemaVersion must be ${PROMPT_CONTRACT_REPLAY_RESULT_SCHEMA_VERSION}`);
  }

  const promptId = readString(record.promptId);
  if (promptId !== input.expectedPromptId) {
    throw new AdminLabError(
      502,
      "prompt_replay_prompt_id_mismatch",
      `Prompt replay fixture ${input.fixtureId} returned promptId=${promptId ?? "missing"}; expected ${input.expectedPromptId}.`,
    );
  }

  const rendered = readRecord(record.rendered);
  const renderedText = readPromptReplayRequiredString(rendered?.text, "rendered.text");
  const charCount = typeof rendered?.charCount === "number" ? rendered.charCount : null;
  if (!Number.isInteger(charCount) || charCount !== renderedText.length) {
    throwInvalidPromptReplayOutput("rendered.charCount must match rendered.text length");
  }
  const sha256 = readPromptReplayRequiredString(rendered?.sha256, "rendered.sha256");
  if (!PROMPT_CONTRACT_REPLAY_SHA256_PATTERN.test(sha256)) {
    throwInvalidPromptReplayOutput("rendered.sha256 must be a lowercase sha256 hex digest");
  }

  const entry = readRecord(record.entry);
  readPromptReplayRequiredString(entry?.id, "entry.id");
  readPromptReplayRequiredString(entry?.title, "entry.title");
  const source = readRecord(entry?.source);
  readPromptReplayRequiredString(source?.file, "entry.source.file");
  readPromptReplayRequiredString(source?.symbol, "entry.source.symbol");

  const fixture = readRecord(record.fixture);
  readPromptReplayRequiredString(fixture?.path, "fixture.path");
}

function readPromptReplayRequiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throwInvalidPromptReplayOutput(`${field} is required`);
  }
  return value.trim();
}

function throwInvalidPromptReplayOutput(reason: string): never {
  throw new AdminLabError(
    502,
    "prompt_replay_invalid_output",
    `Prompt replay returned invalid output: ${reason}.`,
  );
}

function validatePlannerProjectDryRunResult(input: {
  plannerResult: unknown;
  projectId: string;
  snapshotPath: string;
  workDir: string;
  outDir: string;
  sourceRef: string;
  spec: string;
  visualEvidenceMode: AdminLabVisualEvidenceMode | undefined;
}): void {
  const record = readStageLabEnvelopeRecord({
    result: input.plannerResult,
    label: "Planner Project Dry-run",
    errorCode: "planner_project_dry_run_invalid_output",
  });
  requireStageLabString({
    value: record.schemaVersion,
    expected: PLANNER_PROJECT_DRY_RUN_RESULT_SCHEMA_VERSION,
    field: "schemaVersion",
    label: "Planner Project Dry-run",
    errorCode: "planner_project_dry_run_invalid_output",
  });
  validateStageLabStageEnvelope({
    stage: record.stage,
    expectedStageId: "planner_project_dry_run",
    expectedMode: "workspace_dry_run",
    expectedOwnerBoundary: "ralph.planner.dry-run-adapter",
    label: "Planner Project Dry-run",
    errorCode: "planner_project_dry_run_invalid_output",
  });
  validateStageLabCommonResultFields({
    record,
    allowedStatuses: ["completed", "blocked", "agent_failed", "parse_or_validation_failed", "forbidden_mutation"],
    snapshotPath: input.snapshotPath,
    workDir: input.workDir,
    outDir: input.outDir,
    label: "Planner Project Dry-run",
    errorCode: "planner_project_dry_run_invalid_output",
  });
  const resultInput = readRequiredStageLabRecord({
    value: record.input,
    field: "input",
    label: "Planner Project Dry-run",
    errorCode: "planner_project_dry_run_invalid_output",
  });
  requireStageLabString({
    value: resultInput.projectId,
    expected: input.projectId,
    field: "input.projectId",
    label: "Planner Project Dry-run",
    errorCode: "planner_project_dry_run_invalid_output",
  });
  requireStageLabString({
    value: resultInput.sourceRef,
    expected: input.sourceRef,
    field: "input.sourceRef",
    label: "Planner Project Dry-run",
    errorCode: "planner_project_dry_run_invalid_output",
  });
  requireStageLabString({
    value: resultInput.snapshotSourceRef,
    expected: input.sourceRef,
    field: "input.snapshotSourceRef",
    label: "Planner Project Dry-run",
    errorCode: "planner_project_dry_run_invalid_output",
  });
  requireStageLabString({
    value: resultInput.spec,
    expected: input.spec,
    field: "input.spec",
    label: "Planner Project Dry-run",
    errorCode: "planner_project_dry_run_invalid_output",
  });
  if (input.visualEvidenceMode) {
    requireStageLabString({
      value: resultInput.visualEvidenceMode,
      expected: input.visualEvidenceMode,
      field: "input.visualEvidenceMode",
      label: "Planner Project Dry-run",
      errorCode: "planner_project_dry_run_invalid_output",
    });
  }
}

function validateControllerProjectDryRunResult(input: {
  controllerResult: unknown;
  projectId: string;
  snapshotPath: string;
  workDir: string;
  outDir: string;
  sourceRef: string;
  spec: string;
  trigger: AdminLabControllerTrigger | undefined;
  visualEvidenceMode: AdminLabVisualEvidenceMode | undefined;
}): void {
  const record = readStageLabEnvelopeRecord({
    result: input.controllerResult,
    label: "Controller Project Dry-run",
    errorCode: "controller_project_dry_run_invalid_output",
  });
  requireStageLabString({
    value: record.schemaVersion,
    expected: CONTROLLER_PROJECT_DRY_RUN_RESULT_SCHEMA_VERSION,
    field: "schemaVersion",
    label: "Controller Project Dry-run",
    errorCode: "controller_project_dry_run_invalid_output",
  });
  validateStageLabStageEnvelope({
    stage: record.stage,
    expectedStageId: "controller_project_dry_run",
    expectedMode: "workspace_dry_run",
    expectedOwnerBoundary: "ralph.controller.dry-run-adapter",
    label: "Controller Project Dry-run",
    errorCode: "controller_project_dry_run_invalid_output",
  });
  validateStageLabCommonResultFields({
    record,
    allowedStatuses: ["completed", "blocked", "agent_failed", "parse_or_validation_failed", "forbidden_mutation"],
    snapshotPath: input.snapshotPath,
    workDir: input.workDir,
    outDir: input.outDir,
    label: "Controller Project Dry-run",
    errorCode: "controller_project_dry_run_invalid_output",
  });
  const resultInput = readRequiredStageLabRecord({
    value: record.input,
    field: "input",
    label: "Controller Project Dry-run",
    errorCode: "controller_project_dry_run_invalid_output",
  });
  requireStageLabString({
    value: resultInput.projectId,
    expected: input.projectId,
    field: "input.projectId",
    label: "Controller Project Dry-run",
    errorCode: "controller_project_dry_run_invalid_output",
  });
  requireStageLabString({
    value: resultInput.sourceRef,
    expected: input.sourceRef,
    field: "input.sourceRef",
    label: "Controller Project Dry-run",
    errorCode: "controller_project_dry_run_invalid_output",
  });
  requireStageLabString({
    value: resultInput.snapshotSourceRef,
    expected: input.sourceRef,
    field: "input.snapshotSourceRef",
    label: "Controller Project Dry-run",
    errorCode: "controller_project_dry_run_invalid_output",
  });
  requireStageLabString({
    value: resultInput.spec,
    expected: input.spec,
    field: "input.spec",
    label: "Controller Project Dry-run",
    errorCode: "controller_project_dry_run_invalid_output",
  });
  if (input.trigger) {
    requireStageLabString({
      value: resultInput.trigger,
      expected: input.trigger,
      field: "input.trigger",
      label: "Controller Project Dry-run",
      errorCode: "controller_project_dry_run_invalid_output",
    });
  }
  if (input.visualEvidenceMode) {
    requireStageLabString({
      value: resultInput.visualEvidenceMode,
      expected: input.visualEvidenceMode,
      field: "input.visualEvidenceMode",
      label: "Controller Project Dry-run",
      errorCode: "controller_project_dry_run_invalid_output",
    });
  }
}

function validatePlannerSpecMigrationApplyResult(input: {
  plannerResult: unknown;
  projectId: string;
  snapshotPath: string;
  outDir: string;
  snapshotSourceRef: string | null;
}): void {
  const record = readStageLabEnvelopeRecord({
    result: input.plannerResult,
    label: "Planner Spec Migration Apply",
    errorCode: "planner_spec_migration_apply_invalid_output",
  });
  requireStageLabString({
    value: record.schemaVersion,
    expected: PLANNER_SPEC_MIGRATION_APPLY_RESULT_SCHEMA_VERSION,
    field: "schemaVersion",
    label: "Planner Spec Migration Apply",
    errorCode: "planner_spec_migration_apply_invalid_output",
  });
  validateStageLabStageEnvelope({
    stage: record.stage,
    expectedStageId: "planner_spec_migration_apply",
    expectedMode: "workspace_mutation",
    expectedOwnerBoundary: "ralph.planner-spec-migration-apply",
    label: "Planner Spec Migration Apply",
    errorCode: "planner_spec_migration_apply_invalid_output",
  });
  validateStageLabCommonResultFields({
    record,
    allowedStatuses: ["completed", "blocked", "agent_failed", "apply_failed", "forbidden_mutation"],
    snapshotPath: input.snapshotPath,
    outDir: input.outDir,
    label: "Planner Spec Migration Apply",
    errorCode: "planner_spec_migration_apply_invalid_output",
  });
  const resultInput = readRequiredStageLabRecord({
    value: record.input,
    field: "input",
    label: "Planner Spec Migration Apply",
    errorCode: "planner_spec_migration_apply_invalid_output",
  });
  requireStageLabString({
    value: resultInput.projectId,
    expected: input.projectId,
    field: "input.projectId",
    label: "Planner Spec Migration Apply",
    errorCode: "planner_spec_migration_apply_invalid_output",
  });
  if (input.snapshotSourceRef) {
    requireStageLabString({
      value: resultInput.sourceRef,
      expected: input.snapshotSourceRef,
      field: "input.sourceRef",
      label: "Planner Spec Migration Apply",
      errorCode: "planner_spec_migration_apply_invalid_output",
    });
    requireStageLabString({
      value: resultInput.snapshotSourceRef,
      expected: input.snapshotSourceRef,
      field: "input.snapshotSourceRef",
      label: "Planner Spec Migration Apply",
      errorCode: "planner_spec_migration_apply_invalid_output",
    });
  }
}

function validateExecutorProjectTaskResult(input: {
  executorResult: unknown;
  projectId: string;
  snapshotPath: string;
  outDir: string;
  taskId: string | undefined;
  mode: AdminLabExecutorMode | undefined;
  snapshotSourceRef: string | null;
}): void {
  const record = readStageLabEnvelopeRecord({
    result: input.executorResult,
    label: "Executor Project Task",
    errorCode: "executor_project_task_invalid_output",
  });
  requireStageLabString({
    value: record.schemaVersion,
    expected: EXECUTOR_PROJECT_TASK_RESULT_SCHEMA_VERSION,
    field: "schemaVersion",
    label: "Executor Project Task",
    errorCode: "executor_project_task_invalid_output",
  });
  validateStageLabStageEnvelope({
    stage: record.stage,
    expectedStageId: "executor_project_task",
    expectedMode: "workspace_mutation",
    expectedOwnerBoundary: "ralph.executor-project-task-adapter",
    label: "Executor Project Task",
    errorCode: "executor_project_task_invalid_output",
    expectedAdapterFor: "executor_task_workspace",
  });
  validateStageLabCommonResultFields({
    record,
    allowedStatuses: ["completed", "blocked", "agent_failed", "forbidden_mutation"],
    snapshotPath: input.snapshotPath,
    outDir: input.outDir,
    label: "Executor Project Task",
    errorCode: "executor_project_task_invalid_output",
  });
  const resultInput = readRequiredStageLabRecord({
    value: record.input,
    field: "input",
    label: "Executor Project Task",
    errorCode: "executor_project_task_invalid_output",
  });
  requireStageLabString({
    value: resultInput.projectId,
    expected: input.projectId,
    field: "input.projectId",
    label: "Executor Project Task",
    errorCode: "executor_project_task_invalid_output",
  });
  if (input.taskId) {
    requireStageLabString({
      value: resultInput.selectedTaskId,
      expected: input.taskId,
      field: "input.selectedTaskId",
      label: "Executor Project Task",
      errorCode: "executor_project_task_invalid_output",
    });
  }
  if (input.mode) {
    requireStageLabString({
      value: resultInput.mode,
      expected: input.mode,
      field: "input.mode",
      label: "Executor Project Task",
      errorCode: "executor_project_task_invalid_output",
    });
  }
  requireStageLabString({
    value: resultInput.workspaceMode,
    expected: "live_workspace_action",
    field: "input.workspaceMode",
    label: "Executor Project Task",
    errorCode: "executor_project_task_invalid_output",
  });
  if (input.snapshotSourceRef) {
    requireStageLabString({
      value: resultInput.sourceRef,
      expected: input.snapshotSourceRef,
      field: "input.sourceRef",
      label: "Executor Project Task",
      errorCode: "executor_project_task_invalid_output",
    });
    requireStageLabString({
      value: resultInput.snapshotSourceRef,
      expected: input.snapshotSourceRef,
      field: "input.snapshotSourceRef",
      label: "Executor Project Task",
      errorCode: "executor_project_task_invalid_output",
    });
  }
}

function readStageLabEnvelopeRecord(input: {
  result: unknown;
  label: string;
  errorCode: string;
}): Record<string, unknown> {
  const record = readRecord(input.result);
  if (!record) {
    throwInvalidStageLabOutput(input.label, input.errorCode, "result must be an object");
  }
  return record;
}

function validateStageLabStageEnvelope(input: {
  stage: unknown;
  expectedStageId: string;
  expectedMode: string;
  expectedOwnerBoundary: string;
  expectedAdapterFor?: string;
  label: string;
  errorCode: string;
}): void {
  const stage = readRequiredStageLabRecord({
    value: input.stage,
    field: "stage",
    label: input.label,
    errorCode: input.errorCode,
  });
  requireStageLabString({
    value: stage.stageId,
    expected: input.expectedStageId,
    field: "stage.stageId",
    label: input.label,
    errorCode: input.errorCode,
  });
  requireStageLabString({
    value: stage.mode,
    expected: input.expectedMode,
    field: "stage.mode",
    label: input.label,
    errorCode: input.errorCode,
  });
  requireStageLabString({
    value: stage.ownerBoundary,
    expected: input.expectedOwnerBoundary,
    field: "stage.ownerBoundary",
    label: input.label,
    errorCode: input.errorCode,
  });
  if (input.expectedAdapterFor) {
    requireStageLabString({
      value: stage.adapterFor,
      expected: input.expectedAdapterFor,
      field: "stage.adapterFor",
      label: input.label,
      errorCode: input.errorCode,
    });
  }

  const projectStageSnapshot = readRequiredStageLabRecord({
    value: stage.projectStageSnapshot,
    field: "stage.projectStageSnapshot",
    label: input.label,
    errorCode: input.errorCode,
  });
  requireStageLabString({
    value: projectStageSnapshot.schemaVersion,
    expected: PROJECT_STAGE_SNAPSHOT_SCHEMA_VERSION,
    field: "stage.projectStageSnapshot.schemaVersion",
    label: input.label,
    errorCode: input.errorCode,
  });
  requireStageLabString({
    value: projectStageSnapshot.ownerBoundary,
    expected: "arena-ctl.project-stage-snapshot",
    field: "stage.projectStageSnapshot.ownerBoundary",
    label: input.label,
    errorCode: input.errorCode,
  });
}

function validateVisualWorkbenchEvidenceAutomationRunResult(input: {
  automationResult: unknown;
  expectedTaskId: string;
  expectedSourceRef: string;
  expectedBaseUrl: string;
  expectedOutDir: string;
  expectedWorkDir: string;
}) {
  const record = readRecord(input.automationResult);
  if (!record) {
    throwInvalidStageLabOutput(
      "Visual Workbench Evidence Automation",
      "visual_workbench_evidence_automation_invalid_output",
      "result must be an object",
    );
  }
  requireStageLabString({
    value: record.schemaVersion,
    expected: VISUAL_WORKBENCH_EVIDENCE_AUTOMATION_RESULT_SCHEMA_VERSION,
    field: "schemaVersion",
    label: "Visual Workbench Evidence Automation",
    errorCode: "visual_workbench_evidence_automation_invalid_output",
  });
  requireStageLabString({
    value: record.ownerBoundary,
    expected: "ralph.visual-workbench-evidence-automation",
    field: "ownerBoundary",
    label: "Visual Workbench Evidence Automation",
    errorCode: "visual_workbench_evidence_automation_invalid_output",
  });
  requireStageLabStringIn({
    value: record.status,
    allowed: ["blocked", "capture_failed", "export_failed", "publish_failed", "published", "setup_failed"],
    field: "status",
    label: "Visual Workbench Evidence Automation",
    errorCode: "visual_workbench_evidence_automation_invalid_output",
  });
  requireStageLabString({
    value: record.workDir,
    expected: input.expectedWorkDir,
    field: "workDir",
    label: "Visual Workbench Evidence Automation",
    errorCode: "visual_workbench_evidence_automation_invalid_output",
  });
  requireStageLabString({
    value: record.taskId,
    expected: input.expectedTaskId,
    field: "taskId",
    label: "Visual Workbench Evidence Automation",
    errorCode: "visual_workbench_evidence_automation_invalid_output",
  });
  requireStageLabString({
    value: record.sourceRef,
    expected: input.expectedSourceRef,
    field: "sourceRef",
    label: "Visual Workbench Evidence Automation",
    errorCode: "visual_workbench_evidence_automation_invalid_output",
  });
  requireStageLabString({
    value: record.baseUrl,
    expected: input.expectedBaseUrl,
    field: "baseUrl",
    label: "Visual Workbench Evidence Automation",
    errorCode: "visual_workbench_evidence_automation_invalid_output",
  });
  requireStageLabString({
    value: record.outDir,
    expected: input.expectedOutDir,
    field: "outDir",
    label: "Visual Workbench Evidence Automation",
    errorCode: "visual_workbench_evidence_automation_invalid_output",
  });
}

function validateStageLabCommonResultFields(input: {
  record: Record<string, unknown>;
  allowedStatuses: string[];
  snapshotPath: string;
  outDir: string;
  workDir?: string;
  label: string;
  errorCode: string;
}): void {
  requireStageLabStringIn({
    value: input.record.status,
    allowed: input.allowedStatuses,
    field: "status",
    label: input.label,
    errorCode: input.errorCode,
  });

  const resultInput = readRequiredStageLabRecord({
    value: input.record.input,
    field: "input",
    label: input.label,
    errorCode: input.errorCode,
  });
  requireStageLabString({
    value: resultInput.snapshotPath,
    expected: input.snapshotPath,
    field: "input.snapshotPath",
    label: input.label,
    errorCode: input.errorCode,
  });
  requireStageLabString({
    value: resultInput.outDir,
    expected: input.outDir,
    field: "input.outDir",
    label: input.label,
    errorCode: input.errorCode,
  });
  if (input.workDir) {
    requireStageLabString({
      value: resultInput.workDir,
      expected: input.workDir,
      field: "input.workDir",
      label: input.label,
      errorCode: input.errorCode,
    });
  }

  const output = readRequiredStageLabRecord({
    value: input.record.output,
    field: "output",
    label: input.label,
    errorCode: input.errorCode,
  });
  requireStageLabString({
    value: output.outDir,
    expected: input.outDir,
    field: "output.outDir",
    label: input.label,
    errorCode: input.errorCode,
  });
}

function readRequiredStageLabRecord(input: {
  value: unknown;
  field: string;
  label: string;
  errorCode: string;
}): Record<string, unknown> {
  const record = readRecord(input.value);
  if (!record) {
    throwInvalidStageLabOutput(input.label, input.errorCode, `${input.field} must be an object`);
  }
  return record;
}

function requireStageLabString(input: {
  value: unknown;
  expected: string;
  field: string;
  label: string;
  errorCode: string;
}): void {
  const actual = readString(input.value);
  if (actual !== input.expected) {
    throwInvalidStageLabOutput(
      input.label,
      input.errorCode,
      `${input.field} must be ${input.expected}; got ${actual ?? "missing"}`,
    );
  }
}

function requireStageLabStringIn(input: {
  value: unknown;
  allowed: string[];
  field: string;
  label: string;
  errorCode: string;
}): void {
  const actual = readString(input.value);
  if (!actual || !input.allowed.includes(actual)) {
    throwInvalidStageLabOutput(
      input.label,
      input.errorCode,
      `${input.field} must be one of ${input.allowed.join(", ")}; got ${actual ?? "missing"}`,
    );
  }
}

function throwInvalidStageLabOutput(label: string, code: string, reason: string): never {
  throw new AdminLabError(
    502,
    code,
    `${label} returned invalid output: ${reason}.`,
  );
}

async function runPlannerProjectDryRunHelper(input: {
  projectId: string;
  options: AdminLabRunOptions;
}) {
  const snapshot = await runProjectStageSnapshotHelper({
    projectId: input.projectId,
    options: {
      ...(input.options.taskId ? { taskId: input.options.taskId } : {}),
      ...(input.options.tail !== undefined ? { tail: input.options.tail } : {}),
    },
  });
  const source = readPlannerSnapshotSource(snapshot);
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "ra356-admin-lab-planner-"));
  const snapshotPath = path.join(tempRoot, "project-stage-snapshot.json");
  const workDir = path.join(tempRoot, "fork");
  const outDir = path.join(tempRoot, "out");
  await writeFile(snapshotPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
  await cloneSnapshotSourceToTempFork({
    sourcePath: source.liveWorkspacePath,
    sourceRef: source.sourceRef,
    workDir,
  });

  try {
    const { stdout } = await execFileCommand(
      "npm",
      buildPlannerProjectDryRunArgs({
        snapshotPath,
        workDir,
        outDir,
        sourceRef: source.sourceRef,
        spec: source.specFile,
        options: input.options,
      }),
      {
        cwd: resolveArenaRepoRoot(),
        timeout: (input.options.timeoutMinutes ?? 1) * 60_000 + PLANNER_PROJECT_DRY_RUN_EXTRA_TIMEOUT_MS,
        maxBuffer: PLANNER_PROJECT_DRY_RUN_MAX_BUFFER,
        env: {
          ...process.env,
          ARENA_CTL_INVOCATION_CWD: process.cwd(),
        },
      },
    );
    const plannerResult = parseArenaCtlJsonStdout(stdout, "Planner Project Dry-run");
    validatePlannerProjectDryRunResult({
      plannerResult,
      projectId: input.projectId,
      snapshotPath,
      workDir,
      outDir,
      sourceRef: source.sourceRef,
      spec: source.specFile,
      visualEvidenceMode: input.options.visualEvidenceMode,
    });
    return {
      schemaVersion: "ra-356.admin-lab-planner-project-dry-run.v1",
      snapshot,
      plannerResult,
      tempFiles: {
        snapshotPath,
        workDir,
        outDir,
      },
    };
  } catch (error) {
    if (error instanceof AdminLabError) throw error;
    throw new AdminLabError(
      502,
      "stage_command_failed",
      `Source-current Ralph planner_project_dry_run command failed: ${truncate(buildCommandErrorMessage(error), 1600)}`,
    );
  }
}

async function runPlannerSpecMigrationApplyHelper(input: {
  projectId: string;
  options: AdminLabRunOptions;
}) {
  const snapshot = await runProjectStageSnapshotHelper({
    projectId: input.projectId,
    options: {
      ...(input.options.tail !== undefined ? { tail: input.options.tail } : {}),
    },
  });
  const sourceRef = readSnapshotSourceRef(snapshot);
  if (!sourceRef) {
    throw new AdminLabError(
      400,
      "snapshot_source_ref_unavailable",
      "Planner spec migration apply requires Project Stage Snapshot source.workspace.commitSha.",
    );
  }
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "ra356-admin-lab-planner-apply-"));
  const snapshotPath = path.join(tempRoot, "project-stage-snapshot.json");
  const outDir = path.join(tempRoot, "out");
  await writeFile(snapshotPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");

  try {
    const { stdout } = await execFileCommand(
      "npm",
      buildPlannerSpecMigrationApplyArgs({
        snapshotPath,
        outDir,
        sourceRef,
        options: input.options,
      }),
      {
        cwd: resolveArenaRepoRoot(),
        timeout: (input.options.timeoutMinutes ?? 1) * 60_000 + PLANNER_PROJECT_DRY_RUN_EXTRA_TIMEOUT_MS,
        maxBuffer: PLANNER_PROJECT_DRY_RUN_MAX_BUFFER,
        env: {
          ...process.env,
          ARENA_CTL_INVOCATION_CWD: process.cwd(),
        },
      },
    );
    const plannerResult = parseArenaCtlJsonStdout(stdout, "Planner Spec Migration Apply");
    validatePlannerSpecMigrationApplyResult({
      plannerResult,
      projectId: input.projectId,
      snapshotPath,
      outDir,
      snapshotSourceRef: sourceRef,
    });
    return {
      schemaVersion: "ra-356.admin-lab-planner-spec-migration-apply.v1",
      snapshot,
      plannerResult,
      tempFiles: {
        snapshotPath,
        outDir,
      },
    };
  } catch (error) {
    if (error instanceof AdminLabError) throw error;
    throw new AdminLabError(
      502,
      "stage_command_failed",
      `Source-current Ralph planner_spec_migration_apply command failed: ${truncate(buildCommandErrorMessage(error), 1600)}`,
    );
  }
}

async function runControllerProjectDryRunHelper(input: {
  projectId: string;
  options: AdminLabRunOptions;
}) {
  const snapshot = await runProjectStageSnapshotHelper({
    projectId: input.projectId,
    options: {
      ...(input.options.taskId ? { taskId: input.options.taskId } : {}),
      ...(input.options.tail !== undefined ? { tail: input.options.tail } : {}),
    },
  });
  const source = readPlannerSnapshotSource(snapshot);
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "ra356-admin-lab-controller-"));
  const snapshotPath = path.join(tempRoot, "project-stage-snapshot.json");
  const workDir = path.join(tempRoot, "fork");
  const outDir = path.join(tempRoot, "out");
  await writeFile(snapshotPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
  await cloneSnapshotSourceToTempFork({
    sourcePath: source.liveWorkspacePath,
    sourceRef: source.sourceRef,
    workDir,
  });

  try {
    const { stdout } = await execFileCommand(
      "npm",
      buildControllerProjectDryRunArgs({
        snapshotPath,
        workDir,
        outDir,
        sourceRef: source.sourceRef,
        spec: source.specFile,
        options: input.options,
      }),
      {
        cwd: resolveArenaRepoRoot(),
        timeout: (input.options.timeoutMinutes ?? 1) * 60_000 + CONTROLLER_PROJECT_DRY_RUN_EXTRA_TIMEOUT_MS,
        maxBuffer: CONTROLLER_PROJECT_DRY_RUN_MAX_BUFFER,
        env: {
          ...process.env,
          ARENA_CTL_INVOCATION_CWD: process.cwd(),
        },
      },
    );
    const controllerResult = parseArenaCtlJsonStdout(stdout, "Controller Project Dry-run");
    validateControllerProjectDryRunResult({
      controllerResult,
      projectId: input.projectId,
      snapshotPath,
      workDir,
      outDir,
      sourceRef: source.sourceRef,
      spec: source.specFile,
      trigger: input.options.controllerTrigger,
      visualEvidenceMode: input.options.visualEvidenceMode,
    });
    return {
      schemaVersion: "ra-356.admin-lab-controller-project-dry-run.v1",
      snapshot,
      controllerResult,
      tempFiles: {
        snapshotPath,
        workDir,
        outDir,
      },
    };
  } catch (error) {
    if (error instanceof AdminLabError) throw error;
    throw new AdminLabError(
      502,
      "stage_command_failed",
      `Source-current Ralph controller_project_dry_run command failed: ${truncate(buildCommandErrorMessage(error), 1600)}`,
    );
  }
}

async function runExecutorProjectTaskHelper(input: {
  projectId: string;
  options: AdminLabRunOptions;
}) {
  const snapshot = await runProjectStageSnapshotHelper({
    projectId: input.projectId,
    options: {
      taskId: input.options.taskId,
      ...(input.options.tail !== undefined ? { tail: input.options.tail } : {}),
    },
  });
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "ra356-admin-lab-executor-"));
  const snapshotPath = path.join(tempRoot, "project-stage-snapshot.json");
  const outDir = path.join(tempRoot, "out");
  await writeFile(snapshotPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");

  try {
    const { stdout } = await execFileCommand(
      "npm",
      buildExecutorProjectTaskArgs({
        snapshotPath,
        outDir,
        options: input.options,
      }),
      {
        cwd: resolveArenaRepoRoot(),
        timeout: (input.options.timeoutMinutes ?? 1) * 60_000 + EXECUTOR_PROJECT_TASK_EXTRA_TIMEOUT_MS,
        maxBuffer: EXECUTOR_PROJECT_TASK_MAX_BUFFER,
        env: {
          ...process.env,
          ARENA_CTL_INVOCATION_CWD: process.cwd(),
        },
      },
    );
    const executorResult = parseArenaCtlJsonStdout(stdout, "Executor Project Task");
    validateExecutorProjectTaskResult({
      executorResult,
      projectId: input.projectId,
      snapshotPath,
      outDir,
      taskId: input.options.taskId,
      mode: input.options.executorMode,
      snapshotSourceRef: readSnapshotSourceRef(snapshot),
    });
    return {
      schemaVersion: "ra-356.admin-lab-executor-project-task.v1",
      snapshot,
      executorResult,
      tempFiles: {
        snapshotPath,
        outDir,
      },
    };
  } catch (error) {
    if (error instanceof AdminLabError) throw error;
    throw new AdminLabError(
      502,
      "stage_command_failed",
      `Source-current Ralph executor_project_task command failed: ${truncate(buildCommandErrorMessage(error), 1600)}`,
    );
  }
}

async function runVisualWorkbenchSelectorReadinessHelper(input: {
  projectId: string;
  options: AdminLabRunOptions;
}) {
  const taskId = input.options.taskId;
  if (!taskId) {
    throw new AdminLabError(400, "invalid_task_id", "Visual Workbench selector readiness requires a selected taskId.");
  }
  const snapshot = await runProjectStageSnapshotHelper({
    projectId: input.projectId,
    options: {
      taskId,
      ...(input.options.tail !== undefined ? { tail: input.options.tail } : {}),
    },
  });
  assertVisualWorkbenchSelectorHandoffReady(snapshot, taskId);
  const source = readVisualWorkbenchTaskSnapshotSource({
    snapshot,
    expectedTaskId: taskId,
    ownerLabel: "Selector readiness",
    errorPrefix: "selector",
  });

  try {
    const { stdout } = await execFileCommand(
      "npm",
      buildVisualWorkbenchSelectorReadinessArgs({
        workDir: source.liveWorkspacePath,
        taskId: source.taskId,
      }),
      {
        cwd: resolveArenaRepoRoot(),
        timeout: VISUAL_WORKBENCH_SELECTOR_READINESS_TIMEOUT_MS,
        maxBuffer: VISUAL_WORKBENCH_SELECTOR_READINESS_MAX_BUFFER,
        env: {
          ...process.env,
          ARENA_CTL_INVOCATION_CWD: process.cwd(),
        },
      },
    );
    return {
      schemaVersion: "ra-356.admin-lab-visual-workbench-selector-readiness.v1",
      snapshot,
      selectorReadiness: parseArenaCtlJsonStdout(stdout, "Visual Workbench Selector Readiness"),
    };
  } catch (error) {
    if (error instanceof AdminLabError) throw error;
    throw new AdminLabError(
      502,
      "stage_command_failed",
      `Source-current Ralph visual-workbench selector-readiness command failed: ${truncate(buildCommandErrorMessage(error), 1600)}`,
    );
  }
}

async function runVisualWorkbenchShellPolicyHelper(input: {
  projectId: string;
  options: AdminLabRunOptions;
}) {
  const taskId = input.options.taskId;
  if (!taskId) {
    throw new AdminLabError(400, "invalid_task_id", "Visual Workbench shell policy requires a selected taskId.");
  }
  const snapshot = await runProjectStageSnapshotHelper({
    projectId: input.projectId,
    options: {
      taskId,
      ...(input.options.tail !== undefined ? { tail: input.options.tail } : {}),
    },
  });
  const source = readVisualWorkbenchTaskSnapshotSource({
    snapshot,
    expectedTaskId: taskId,
    ownerLabel: "Shell policy",
    errorPrefix: "shell_policy",
  });

  try {
    const { stdout } = await execFileCommand(
      "npm",
      buildVisualWorkbenchShellPolicyArgs({
        workDir: source.liveWorkspacePath,
        configPath: path.join(source.liveWorkspacePath, ".arena", "ralph.config.json"),
      }),
      {
        cwd: resolveArenaRepoRoot(),
        timeout: VISUAL_WORKBENCH_SHELL_POLICY_TIMEOUT_MS,
        maxBuffer: VISUAL_WORKBENCH_SHELL_POLICY_MAX_BUFFER,
        env: {
          ...process.env,
          ARENA_CTL_INVOCATION_CWD: process.cwd(),
        },
      },
    );
    return {
      schemaVersion: "ra-356.admin-lab-visual-workbench-shell-policy.v1",
      snapshot,
      shellPolicy: parseArenaCtlJsonStdout(stdout, "Visual Workbench Shell Policy"),
    };
  } catch (error) {
    if (error instanceof AdminLabError) throw error;
    throw new AdminLabError(
      502,
      "stage_command_failed",
      `Source-current Ralph visual-workbench shell-policy command failed: ${truncate(buildCommandErrorMessage(error), 1600)}`,
    );
  }
}

async function runVisualWorkbenchManifestReadinessHelper(input: {
  projectId: string;
  options: AdminLabRunOptions;
}) {
  const snapshot = await runProjectStageSnapshotHelper({
    projectId: input.projectId,
    options: {
      ...(input.options.tail !== undefined ? { tail: input.options.tail } : {}),
    },
  });
  const source = readVisualWorkbenchSnapshotSource({
    snapshot,
    ownerLabel: "Manifest readiness",
    errorPrefix: "manifest",
  });

  try {
    const { stdout } = await execFileCommand(
      "npm",
      buildVisualWorkbenchManifestReadinessArgs({
        workDir: source.liveWorkspacePath,
        sourceRef: source.sourceRef,
      }),
      {
        cwd: resolveArenaRepoRoot(),
        timeout: VISUAL_WORKBENCH_MANIFEST_READINESS_TIMEOUT_MS,
        maxBuffer: VISUAL_WORKBENCH_MANIFEST_READINESS_MAX_BUFFER,
        env: {
          ...process.env,
          ARENA_CTL_INVOCATION_CWD: process.cwd(),
        },
      },
    );
    return {
      schemaVersion: "ra-356.admin-lab-visual-workbench-manifest-readiness.v1",
      snapshot,
      manifestReadiness: parseArenaCtlJsonStdout(stdout, "Visual Workbench Manifest Readiness"),
    };
  } catch (error) {
    if (error instanceof AdminLabError) throw error;
    throw new AdminLabError(
      502,
      "stage_command_failed",
      `Source-current Ralph visual-workbench inspect command failed: ${truncate(buildCommandErrorMessage(error), 1600)}`,
    );
  }
}

async function runVisualWorkbenchBrowserReadinessHelper() {
  try {
    const { stdout } = await execFileCommand(
      "npm",
      buildVisualWorkbenchBrowserReadinessArgs(),
      {
        cwd: resolveArenaRepoRoot(),
        timeout: VISUAL_WORKBENCH_BROWSER_READINESS_TIMEOUT_MS,
        maxBuffer: VISUAL_WORKBENCH_BROWSER_READINESS_MAX_BUFFER,
        env: {
          ...process.env,
          ARENA_CTL_INVOCATION_CWD: process.cwd(),
        },
      },
    );
    return {
      schemaVersion: "ra-356.admin-lab-visual-workbench-browser-readiness.v1",
      browserReadiness: parseArenaCtlJsonStdout(stdout, "Visual Workbench Browser Readiness"),
    };
  } catch (error) {
    if (error instanceof AdminLabError) throw error;
    throw new AdminLabError(
      502,
      "stage_command_failed",
      `Source-current Ralph visual-workbench browser-readiness command failed: ${truncate(buildCommandErrorMessage(error), 1600)}`,
    );
  }
}

async function runVisualWorkbenchAutomationStatusHelper(input: {
  projectId: string;
  options: AdminLabRunOptions;
}) {
  const taskId = input.options.taskId;
  if (!taskId) {
    throw new AdminLabError(400, "invalid_task_id", "Visual Workbench automation status requires a selected taskId.");
  }
  const snapshot = await runProjectStageSnapshotHelper({
    projectId: input.projectId,
    options: {
      taskId,
      ...(input.options.tail !== undefined ? { tail: input.options.tail } : {}),
    },
  });
  const source = readVisualWorkbenchTaskSnapshotSource({
    snapshot,
    expectedTaskId: taskId,
    ownerLabel: "Automation status",
    errorPrefix: "automation_status",
  });

  try {
    const { stdout } = await execFileCommand(
      "npm",
      buildVisualWorkbenchAutomationStatusArgs({
        workDir: source.liveWorkspacePath,
        taskId: source.taskId,
      }),
      {
        cwd: resolveArenaRepoRoot(),
        timeout: VISUAL_WORKBENCH_AUTOMATION_STATUS_TIMEOUT_MS,
        maxBuffer: VISUAL_WORKBENCH_AUTOMATION_STATUS_MAX_BUFFER,
        env: {
          ...process.env,
          ARENA_CTL_INVOCATION_CWD: process.cwd(),
        },
      },
    );
    return {
      schemaVersion: "ra-356.admin-lab-visual-workbench-automation-status.v1",
      snapshot,
      automationStatus: parseArenaCtlJsonStdout(stdout, "Visual Workbench Automation Status"),
    };
  } catch (error) {
    if (error instanceof AdminLabError) throw error;
    throw new AdminLabError(
      502,
      "stage_command_failed",
      `Source-current Ralph visual-workbench automation-status command failed: ${truncate(buildCommandErrorMessage(error), 1600)}`,
    );
  }
}

async function runVisualWorkbenchEvidenceChainReadinessHelper(input: {
  projectId: string;
  options: AdminLabRunOptions;
}) {
  const taskId = input.options.taskId;
  if (!taskId) {
    throw new AdminLabError(400, "invalid_task_id", "Visual Workbench evidence chain readiness requires a selected taskId.");
  }
  const snapshot = await runProjectStageSnapshotHelper({
    projectId: input.projectId,
    options: {
      taskId,
      ...(input.options.tail !== undefined ? { tail: input.options.tail } : {}),
    },
  });
  const source = readVisualWorkbenchTaskSnapshotSource({
    snapshot,
    expectedTaskId: taskId,
    ownerLabel: "Evidence chain readiness",
    errorPrefix: "evidence_chain",
  });

  try {
    const { stdout } = await execFileCommand(
      "npm",
      buildVisualWorkbenchEvidenceChainReadinessArgs({
        workDir: source.liveWorkspacePath,
        taskId: source.taskId,
        projectId: input.projectId,
      }),
      {
        cwd: resolveArenaRepoRoot(),
        timeout: VISUAL_WORKBENCH_EVIDENCE_CHAIN_READINESS_TIMEOUT_MS,
        maxBuffer: VISUAL_WORKBENCH_EVIDENCE_CHAIN_READINESS_MAX_BUFFER,
        env: {
          ...process.env,
          ARENA_CTL_INVOCATION_CWD: process.cwd(),
        },
      },
    );
    return {
      schemaVersion: "ra-356.admin-lab-visual-workbench-evidence-chain-readiness.v1",
      snapshot,
      evidenceChainReadiness: parseArenaCtlJsonStdout(stdout, "Visual Workbench Evidence Chain Readiness"),
    };
  } catch (error) {
    if (error instanceof AdminLabError) throw error;
    throw new AdminLabError(
      502,
      "stage_command_failed",
      `Source-current Ralph visual-workbench evidence-chain-readiness command failed: ${truncate(buildCommandErrorMessage(error), 1600)}`,
    );
  }
}

async function runVisualWorkbenchEvidenceAutomationRunHelper(input: {
  projectId: string;
  options: AdminLabRunOptions;
}) {
  const taskId = input.options.taskId;
  if (!taskId) {
    throw new AdminLabError(400, "invalid_task_id", "Workbench evidence automation requires a selected taskId.");
  }
  const snapshot = await runProjectStageSnapshotHelper({
    projectId: input.projectId,
    options: {
      taskId,
      ...(input.options.tail !== undefined ? { tail: input.options.tail } : {}),
    },
  });
  const source = readVisualWorkbenchTaskSnapshotSource({
    snapshot,
    expectedTaskId: taskId,
    ownerLabel: "Workbench evidence automation",
    errorPrefix: "evidence_automation",
  });
  const port = await findFreeLocalhostPort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "ra356-admin-lab-workbench-automation-"));
  const outDir = path.join(tempRoot, "out");
  const configPath = path.join(source.liveWorkspacePath, ".arena", "ralph.config.json");

  try {
    const { stdout } = await execFileCommand(
      "npm",
      buildVisualWorkbenchEvidenceAutomationRunArgs({
        workDir: source.liveWorkspacePath,
        taskId: source.taskId,
        sourceRef: source.sourceRef,
        baseUrl,
        outDir,
        configPath,
      }),
      {
        cwd: resolveArenaRepoRoot(),
        timeout: VISUAL_WORKBENCH_EVIDENCE_AUTOMATION_TIMEOUT_MS,
        maxBuffer: VISUAL_WORKBENCH_EVIDENCE_AUTOMATION_MAX_BUFFER,
        env: {
          ...process.env,
          ARENA_CTL_INVOCATION_CWD: process.cwd(),
        },
      },
    );
    const automationResult = parseArenaCtlJsonStdout(stdout, "Visual Workbench Evidence Automation");
    validateVisualWorkbenchEvidenceAutomationRunResult({
      automationResult,
      expectedTaskId: source.taskId,
      expectedSourceRef: source.sourceRef,
      expectedBaseUrl: baseUrl,
      expectedOutDir: outDir,
      expectedWorkDir: source.liveWorkspacePath,
    });
    return {
      schemaVersion: "ra-356.admin-lab-visual-workbench-evidence-automation-run.v1",
      snapshot,
      automationResult,
      tempFiles: {
        outDir,
      },
    };
  } catch (error) {
    if (error instanceof AdminLabError) throw error;
    throw new AdminLabError(
      502,
      "stage_command_failed",
      `Source-current Ralph visual-workbench automate-evidence command failed: ${truncate(buildCommandErrorMessage(error), 1600)}`,
    );
  }
}

function execFileCommand(
  file: string,
  args: string[],
  options: Parameters<typeof execFile>[2],
): Promise<{ stdout: string | Buffer; stderr: string | Buffer }> {
  return new Promise((resolve, reject) => {
    execFile(file, args, options, (error, stdout, stderr) => {
      if (error) {
        Object.assign(error, { stdout, stderr });
        reject(error);
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

function resolveArenaRepoRoot(): string {
  return path.resolve(process.env.ARENA_REPO_ROOT?.trim() || path.join(process.cwd(), "..", ".."));
}

function resolveArenaCtlCliPath(): string {
  const configured = process.env.ARENA_CTL_CLI_PATH?.trim();
  if (configured) return configured;
  return path.join(resolveArenaRepoRoot(), "services", "arena-ctl", "cli.sh");
}

function buildProjectStageSnapshotArgs(input: {
  projectId: string;
  options: AdminLabRunOptions;
}): string[] {
  return [
    "project_stage_snapshot",
    "--project-id",
    input.projectId,
    ...(input.options.taskId ? ["--task-id", input.options.taskId] : []),
    ...(input.options.tail !== undefined ? ["--tail", String(input.options.tail)] : []),
  ];
}

function buildProjectStageCandidatesArgs(input: {
  options: AdminLabRunOptions;
}): string[] {
  return [
    "project_stage_candidates",
    ...(input.options.limit !== undefined ? ["--limit", String(input.options.limit)] : []),
    ...(input.options.includeArchived ? ["--include-archived", "enabled"] : []),
    ...(input.options.tail !== undefined ? ["--tail", String(input.options.tail)] : []),
  ];
}

function buildPromptContractReplayArgs(input: {
  fixturePath: string;
  outPath: string;
}): string[] {
  return [
    "--prefix",
    "packages/loops/ralph-runtime",
    "run",
    "ralph",
    "--",
    "prompts",
    "replay",
    "--fixture",
    input.fixturePath,
    "--out",
    input.outPath,
    "--compact",
  ];
}

function buildPlannerProjectDryRunArgs(input: {
  snapshotPath: string;
  workDir: string;
  outDir: string;
  sourceRef: string;
  spec: string;
  options: AdminLabRunOptions;
}): string[] {
  return [
    "--prefix",
    "packages/loops/ralph-runtime",
    "run",
    "ralph",
    "--",
    "stage",
    "run",
    "planner_project_dry_run",
    "--snapshot",
    input.snapshotPath,
    "--work-dir",
    input.workDir,
    "--source-ref",
    input.sourceRef,
    "--spec",
    input.spec,
    "--visual-evidence-mode",
    input.options.visualEvidenceMode ?? "",
    "--out-dir",
    input.outDir,
    "--agent",
    input.options.agent ?? "",
    "--model",
    input.options.model ?? "",
    "--timeout-minutes",
    String(input.options.timeoutMinutes ?? ""),
    "--compact",
  ];
}

function buildPlannerSpecMigrationApplyArgs(input: {
  snapshotPath: string;
  outDir: string;
  sourceRef: string;
  options: AdminLabRunOptions;
}): string[] {
  return [
    "--prefix",
    "packages/loops/ralph-runtime",
    "run",
    "ralph",
    "--",
    "stage",
    "run",
    "planner_spec_migration_apply",
    "--snapshot",
    input.snapshotPath,
    "--source-ref",
    input.sourceRef,
    "--out-dir",
    input.outDir,
    "--agent",
    input.options.agent ?? "",
    "--model",
    input.options.model ?? "",
    "--timeout-minutes",
    String(input.options.timeoutMinutes ?? ""),
    "--compact",
  ];
}

function buildControllerProjectDryRunArgs(input: {
  snapshotPath: string;
  workDir: string;
  outDir: string;
  sourceRef: string;
  spec: string;
  options: AdminLabRunOptions;
}): string[] {
  return [
    "--prefix",
    "packages/loops/ralph-runtime",
    "run",
    "ralph",
    "--",
    "stage",
    "run",
    "controller_project_dry_run",
    "--snapshot",
    input.snapshotPath,
    "--work-dir",
    input.workDir,
    "--source-ref",
    input.sourceRef,
    "--spec",
    input.spec,
    "--trigger",
    input.options.controllerTrigger ?? "",
    "--visual-evidence-mode",
    input.options.visualEvidenceMode ?? "",
    "--out-dir",
    input.outDir,
    "--agent",
    input.options.agent ?? "",
    "--model",
    input.options.model ?? "",
    "--timeout-minutes",
    String(input.options.timeoutMinutes ?? ""),
    "--compact",
  ];
}

function buildExecutorProjectTaskArgs(input: {
  snapshotPath: string;
  outDir: string;
  options: AdminLabRunOptions;
}): string[] {
  return [
    "--prefix",
    "packages/loops/ralph-runtime",
    "run",
    "ralph",
    "--",
    "stage",
    "run",
    "executor_project_task",
    "--snapshot",
    input.snapshotPath,
    "--mode",
    input.options.executorMode ?? "",
    "--workspace-mode",
    "live_workspace_action",
    "--completion-promise",
    input.options.completionPromise ?? "",
    "--out-dir",
    input.outDir,
    "--agent",
    input.options.agent ?? "",
    "--model",
    input.options.model ?? "",
    "--timeout-minutes",
    String(input.options.timeoutMinutes ?? ""),
    "--compact",
  ];
}

function buildVisualWorkbenchSelectorReadinessArgs(input: {
  workDir: string;
  taskId: string;
}): string[] {
  return [
    "--prefix",
    "packages/loops/ralph-runtime",
    "run",
    "ralph",
    "--",
    "visual-workbench",
    "selector-readiness",
    "--work-dir",
    input.workDir,
    "--task",
    input.taskId,
    "--compact",
  ];
}

function buildVisualWorkbenchShellPolicyArgs(input: {
  workDir: string;
  configPath: string;
}): string[] {
  return [
    "--prefix",
    "packages/loops/ralph-runtime",
    "run",
    "ralph",
    "--",
    "visual-workbench",
    "shell-policy",
    "--work-dir",
    input.workDir,
    "--config",
    input.configPath,
    "--compact",
  ];
}

function buildVisualWorkbenchManifestReadinessArgs(input: {
  workDir: string;
  sourceRef: string;
}): string[] {
  return [
    "--prefix",
    "packages/loops/ralph-runtime",
    "run",
    "ralph",
    "--",
    "visual-workbench",
    "inspect",
    "--work-dir",
    input.workDir,
    "--source-ref",
    input.sourceRef,
    "--compact",
  ];
}

function buildVisualWorkbenchBrowserReadinessArgs(): string[] {
  return [
    "--prefix",
    "packages/loops/ralph-runtime",
    "run",
    "ralph",
    "--",
    "visual-workbench",
    "browser-readiness",
    "--compact",
  ];
}

function buildVisualWorkbenchAutomationStatusArgs(input: {
  workDir: string;
  taskId: string;
}): string[] {
  return [
    "--prefix",
    "packages/loops/ralph-runtime",
    "run",
    "ralph",
    "--",
    "visual-workbench",
    "automation-status",
    "--work-dir",
    input.workDir,
    "--task",
    input.taskId,
    "--compact",
  ];
}

function buildVisualWorkbenchEvidenceChainReadinessArgs(input: {
  workDir: string;
  taskId: string;
  projectId: string;
}): string[] {
  return [
    "--prefix",
    "packages/loops/ralph-runtime",
    "run",
    "ralph",
    "--",
    "visual-workbench",
    "evidence-chain-readiness",
    "--work-dir",
    input.workDir,
    "--task",
    input.taskId,
    "--project-id",
    input.projectId,
    "--compact",
  ];
}

function buildVisualWorkbenchEvidenceAutomationRunArgs(input: {
  workDir: string;
  taskId: string;
  sourceRef: string;
  baseUrl: string;
  outDir: string;
  configPath: string;
}): string[] {
  return [
    "--prefix",
    "packages/loops/ralph-runtime",
    "run",
    "ralph",
    "--",
    "visual-workbench",
    "automate-evidence",
    "--work-dir",
    input.workDir,
    "--manifest",
    "visual-workbench/manifest.json",
    "--task",
    input.taskId,
    "--source-ref",
    input.sourceRef,
    "--base-url",
    input.baseUrl,
    "--out-dir",
    input.outDir,
    "--config",
    input.configPath,
    "--compact",
  ];
}

function findFreeLocalhostPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        if (!address || typeof address === "string") {
          reject(new Error("Unable to allocate localhost port for Workbench evidence automation."));
          return;
        }
        resolve(address.port);
      });
    });
  });
}

async function cloneSnapshotSourceToTempFork(input: {
  sourcePath: string;
  sourceRef: string;
  workDir: string;
}) {
  await execFileCommand(
    "git",
    ["clone", "--no-hardlinks", "--quiet", input.sourcePath, input.workDir],
    {
      cwd: resolveArenaRepoRoot(),
      timeout: 60_000,
      maxBuffer: 10 * 1024 * 1024,
      env: process.env,
    },
  );
  await execFileCommand(
    "git",
    ["checkout", "--quiet", input.sourceRef],
    {
      cwd: input.workDir,
      timeout: 30_000,
      maxBuffer: 10 * 1024 * 1024,
      env: process.env,
    },
  );
}

function readPlannerSnapshotSource(snapshot: unknown): {
  liveWorkspacePath: string;
  sourceRef: string;
  specFile: string;
} {
  const record = readRecord(snapshot);
  const source = readRecord(record?.source);
  const workspace = readRecord(source?.workspace);
  const plan = readRecord(record?.plan);
  const planStatus = readRequiredString(plan?.status, "Project Stage Snapshot plan.status is missing.");
  if (planStatus !== "ready") {
    throw new AdminLabError(400, "planner_snapshot_not_ready", `Planner dry-run requires Project Stage Snapshot plan.status=ready; got ${planStatus}.`);
  }
  if (workspace?.available !== true || workspace?.isGitRepo !== true) {
    throw new AdminLabError(400, "planner_source_workspace_unavailable", "Planner dry-run requires an available git source workspace from Project Stage Snapshot.");
  }
  return {
    liveWorkspacePath: readRequiredString(workspace.path, "Planner dry-run requires source.workspace.path from Project Stage Snapshot."),
    sourceRef: readRequiredString(workspace.commitSha, "Planner dry-run requires source.workspace.commitSha from Project Stage Snapshot."),
    specFile: readRequiredString(plan?.specFile, "Planner dry-run requires plan.specFile from Project Stage Snapshot."),
  };
}

function readSnapshotSourceRef(snapshot: unknown): string | null {
  const record = readRecord(snapshot);
  const source = readRecord(record?.source);
  const workspace = readRecord(source?.workspace);
  return readString(workspace?.commitSha);
}

function readVisualWorkbenchSnapshotSource(input: {
  snapshot: unknown;
  ownerLabel: string;
  errorPrefix: "manifest";
}): {
  liveWorkspacePath: string;
  sourceRef: string;
} {
  const record = readRecord(input.snapshot);
  const source = readRecord(record?.source);
  const workspace = readRecord(source?.workspace);
  if (workspace?.available !== true || workspace?.isGitRepo !== true) {
    throw new AdminLabError(400, `${input.errorPrefix}_source_workspace_unavailable`, `${input.ownerLabel} requires an available git source workspace from Project Stage Snapshot.`);
  }
  return {
    liveWorkspacePath: readRequiredString(
      workspace.path,
      `${input.ownerLabel} requires source.workspace.path from Project Stage Snapshot.`,
      `${input.errorPrefix}_snapshot_missing_input`,
    ),
    sourceRef: readRequiredString(
      workspace.commitSha,
      `${input.ownerLabel} requires source.workspace.commitSha from Project Stage Snapshot.`,
      `${input.errorPrefix}_snapshot_missing_input`,
    ),
  };
}

function assertVisualWorkbenchSelectorHandoffReady(snapshot: unknown, expectedTaskId: string) {
  const record = readRecord(snapshot);
  const readback = readRecord(record?.selectedTaskVisualReadback);
  const selectedTaskId = readString(readback?.selectedTaskId);
  const nextProjectActionId = readString(readback?.nextProjectActionId);

  if (
    selectedTaskId === expectedTaskId
    && nextProjectActionId === "check_story_selection"
    && readback?.canCheckStorySelection === true
  ) {
    return;
  }

  const title = readString(readback?.title) ?? "Story selection is not ready";
  const message = readString(readback?.message)
    ?? "Project Stage Snapshot did not return selectedTaskVisualReadback.canCheckStorySelection=true for the selected task.";
  const reasonCode = readString(readback?.reasonCode) ?? "selected_task_visual_readback_unavailable";
  throw new AdminLabError(
    400,
    "selector_visual_handoff_blocked",
    `${title}: ${message} reason=${reasonCode}. Run Get task context for the selected task and follow the snapshot visual readback before selector readiness.`,
  );
}

function readVisualWorkbenchTaskSnapshotSource(input: {
  snapshot: unknown;
  expectedTaskId: string;
  ownerLabel: string;
  errorPrefix: "selector" | "shell_policy" | "automation_status" | "evidence_chain" | "evidence_automation";
}): {
  liveWorkspacePath: string;
  taskId: string;
  sourceRef: string;
} {
  const record = readRecord(input.snapshot);
  const source = readRecord(record?.source);
  const workspace = readRecord(source?.workspace);
  const plan = readRecord(record?.plan);
  const selectedTask = readRecord(plan?.selectedTask);
  const selectedTaskId = readRequiredString(
    record?.selectedTaskId,
    `${input.ownerLabel} requires selectedTaskId from Project Stage Snapshot.`,
    `${input.errorPrefix}_snapshot_missing_input`,
  );
  const selectedPlanTaskId = readRequiredString(
    selectedTask?.id,
    `${input.ownerLabel} requires plan.selectedTask.id from Project Stage Snapshot.`,
    `${input.errorPrefix}_snapshot_missing_input`,
  );
  const planStatus = readRequiredString(
    plan?.status,
    "Project Stage Snapshot plan.status is missing.",
    `${input.errorPrefix}_snapshot_missing_input`,
  );
  if (selectedTaskId !== input.expectedTaskId || selectedPlanTaskId !== input.expectedTaskId) {
    throw new AdminLabError(400, `${input.errorPrefix}_snapshot_task_mismatch`, `${input.ownerLabel} expected taskId=${input.expectedTaskId}; snapshot selectedTaskId=${selectedTaskId}.`);
  }
  if (planStatus !== "ready" || !selectedTask) {
    const reason = readString(plan?.reasonCode) ?? "unknown";
    throw new AdminLabError(400, `${input.errorPrefix}_snapshot_not_ready`, `${input.ownerLabel} requires Project Stage Snapshot plan.selectedTask; plan.status=${planStatus}, reason=${reason}.`);
  }
  if (workspace?.available !== true || workspace?.isGitRepo !== true) {
    throw new AdminLabError(400, `${input.errorPrefix}_source_workspace_unavailable`, `${input.ownerLabel} requires an available git source workspace from Project Stage Snapshot.`);
  }
  return {
    liveWorkspacePath: readRequiredString(
      workspace.path,
      `${input.ownerLabel} requires source.workspace.path from Project Stage Snapshot.`,
      `${input.errorPrefix}_snapshot_missing_input`,
    ),
    taskId: selectedTaskId,
    sourceRef: readRequiredString(
      workspace.commitSha,
      `${input.ownerLabel} requires source.workspace.commitSha from Project Stage Snapshot.`,
      `${input.errorPrefix}_snapshot_missing_input`,
    ),
  };
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? value as Record<string, unknown> : null;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readRequiredString(value: unknown, message: string, code = "planner_snapshot_missing_input"): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new AdminLabError(400, code, message);
  }
  return value.trim();
}

function parseArenaCtlJsonStdout(stdout: string | Buffer, label: string): unknown {
  const text = stdout.toString().trim();
  if (!text) {
    throw new AdminLabError(502, "stage_command_empty_output", `${label} command returned empty output.`);
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new AdminLabError(
      502,
      "stage_command_invalid_json",
      `${label} command returned invalid JSON: ${truncate(error instanceof Error ? error.message : String(error), 400)}`,
    );
  }
}

function buildCommandErrorMessage(error: unknown): string {
  if (!error || typeof error !== "object") return String(error);
  const record = error as Record<string, unknown>;
  const parts = [
    error instanceof Error ? error.message : null,
    typeof record.stderr === "string" ? record.stderr.trim() : null,
    Buffer.isBuffer(record.stderr) ? record.stderr.toString("utf8").trim() : null,
    typeof record.stdout === "string" ? record.stdout.trim() : null,
    Buffer.isBuffer(record.stdout) ? record.stdout.toString("utf8").trim() : null,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join("\n") : String(error);
}

function truncate(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength)}...`;
}

async function getProofReviews(input: {
  projectId: string;
  session: Session | null;
  hasBypass: boolean;
}) {
  const result = await getProjectInteractionSnapshotForViewer({
    projectId: input.projectId,
    session: input.session,
    hasBypass: input.hasBypass,
    surface: "telegram",
  });

  switch (result.status) {
    case "ok":
      return {
        project: {
          id: result.snapshot.project.id,
          name: result.snapshot.project.name,
          slug: result.snapshot.project.slug,
        },
        statusSummary: result.snapshot.execution.statusSummary,
        latestAcceptedUpdate: result.snapshot.execution.latestAcceptedUpdate,
        visualEvidenceReadiness: buildVisualEvidenceReadiness(result.snapshot),
        proofReviews: result.snapshot.proofReviews,
        visualEvidenceReviews: result.snapshot.visualEvidenceReviews,
      };
    case "not_found":
      throw new AdminLabError(404, "project_not_found", "Project not found");
    case "unauthorized":
      throw new AdminLabError(401, "project_access_denied", "Project access denied");
    case "forbidden":
      throw new AdminLabError(403, "project_access_denied", "Project access denied");
  }
}

async function getVisualEvidenceArtifactCheck(input: {
  projectId: string;
  session: Session | null;
  hasBypass: boolean;
}) {
  const result = await getProjectInteractionSnapshotForViewer({
    projectId: input.projectId,
    session: input.session,
    hasBypass: input.hasBypass,
    surface: "telegram",
  });

  switch (result.status) {
    case "ok": {
      const artifactCheck = await buildProjectVisualEvidenceArtifactCheck({
        projectId: input.projectId,
        reviews: result.snapshot.visualEvidenceReviews,
      });
      return {
        project: {
          id: result.snapshot.project.id,
          name: result.snapshot.project.name,
          slug: result.snapshot.project.slug,
        },
        latestAcceptedUpdate: result.snapshot.execution.latestAcceptedUpdate,
        visualEvidenceReadiness: buildVisualEvidenceReadiness(result.snapshot),
        ...artifactCheck,
      };
    }
    case "not_found":
      throw new AdminLabError(404, "project_not_found", "Project not found");
    case "unauthorized":
      throw new AdminLabError(401, "project_access_denied", "Project access denied");
    case "forbidden":
      throw new AdminLabError(403, "project_access_denied", "Project access denied");
  }
}
