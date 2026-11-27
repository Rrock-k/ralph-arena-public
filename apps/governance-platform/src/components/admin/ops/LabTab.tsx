"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowRight, ChevronDown, ChevronUp, Clipboard, Download, ExternalLink, Play } from "lucide-react";
import { toast } from "sonner";
import type { OpsProject, OpsVisualEvidenceMode } from "./OpsDashboard";
import { getProjectName } from "@/lib/project-identity";
import {
  getSnapshotExecutorCheckpointReadback,
  getSnapshotNextHandoff,
  getSnapshotSelectedTaskVisualReadback,
  getSnapshotTaskCandidates,
  type SnapshotExecutorCheckpointReadback,
  type SnapshotSelectedTaskVisualReadback,
  type SnapshotTaskCandidateView,
} from "@/lib/admin-lab-snapshot-view";
import {
  getCandidateScanOperatorNotice,
  getCandidateScanProjects,
  type CandidateScanProjectView,
} from "@/lib/admin-lab-candidate-scan-view";
import {
  applyCommandPlaceholderValues,
  formatCommandPlaceholderLabel,
  getCommandPlaceholderCompletion,
  getCommandPlaceholders,
  getSnapshotCommandInputHints,
} from "@/lib/admin-lab-command-template";
import {
  ADMIN_LAB_PROJECT_ACTIONS,
  type AdminLabProjectActionDefinition,
  type AdminLabProjectActionGroup,
} from "@/lib/admin-lab-actions";

export type LabStageStatus = "supported_now" | "target_shape";
export type LabRunSurface = "admin_lab_run" | "direct_cli" | "target_shape";

export type LabStage = {
  id: string;
  label: string;
  status: LabStageStatus;
  runSurface: LabRunSurface;
  mode: "read_only" | "fixture" | "workspace_dry_run" | "workspace_mutation" | "operator_mutation" | "target_shape";
  ownerBoundary: string;
  description: string;
  currentCommand: string | null;
  allowedMutations: string[];
  forbiddenMutations: string[];
  nextHandoff: string[];
};

type StageCatalogResponse = {
  stages?: LabStage[];
  notes?: string[];
  error?: string;
};

export type LabRunResponse = {
  projectId?: string;
  stage?: LabStage;
  actionInvocation?: {
    actionId: string;
    title: string;
    stageId: string;
    ownerBoundary: string;
    runSurface: LabRunSurface;
    mode: LabStage["mode"];
  };
  result?: unknown;
  evidenceNotes?: string[];
  executedAt?: string;
  error?: string;
  code?: string;
};

export type LabTabStoryFixture = {
  selectedDebugStageId?: string;
  selectedProjectActionId?: string | null;
  selectedTaskId?: string;
  initialRunResult?: LabRunResponse | null;
};

type LabTabProps = {
  projects: OpsProject[];
  storyFixture?: LabTabStoryFixture;
};

type LabStageCopy = {
  title: string;
  summary: string;
  useWhen?: string;
  dependsOn?: string;
  reads: string;
  wont: string;
  next: string;
  resultSummary: string;
};

type ResultHighlight = {
  label: string;
  value: string;
  tone?: "good" | "warn" | "neutral";
};

async function readJsonResponse<T>(response: Response, label: string): Promise<T> {
  const raw = await response.text();
  try {
    return JSON.parse(raw) as T;
  } catch {
    const statusText = response.statusText ? ` ${response.statusText}` : "";
    const contentType = response.headers.get("content-type") ?? "unknown content-type";
    const snippet = formatResponseSnippet(raw);
    throw new Error(`${label} returned ${response.status}${statusText} ${contentType} instead of JSON${snippet ? `: ${snippet}` : "."}`);
  }
}

function formatResponseSnippet(raw: string): string {
  const normalized = raw.replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  return normalized.length > 180 ? `${normalized.slice(0, 180)}...` : normalized;
}

function formatLabActionError(message: string): string {
  const normalized = message.replace(/\s+/g, " ").trim();
  const lower = normalized.toLowerCase();
  if (!normalized) return "Lab action failed.";
  if (lower === "failed to fetch" || lower.includes("networkerror")) {
    return "Lab API is unreachable. Check the governance server, session and admin URL/tunnel, then run the action again.";
  }
  if (lower.includes("instead of json")) {
    return `Lab API returned a server/session page instead of JSON. Check /api/admin/lab/run, reload or re-login if needed, then run the action again. Details: ${normalized}`;
  }
  if (lower.includes("arena-ctl") && lower.includes("fetch failed") && lower.includes("governance is running")) {
    return `Governance admin API is not reachable from Admin Lab. Check the governance server or admin URL/tunnel, then run the action again. Details: ${normalized}`;
  }
  return normalized;
}

type VisualEvidenceReviewLink = {
  id: string;
  label: string;
  href: string;
  taskLabel: string;
  status: string;
  summary: string | null;
  target: string | null;
  artifactLabel: string;
};

type VisualEvidenceArtifactCheckRow = {
  reviewId: string;
  taskLabel: string;
  reviewStatus: string;
  downloadStatus: string;
  reasonCode: string | null;
  contentType: string | null;
  sha256: string | null;
  byteLength: number | null;
};

type EvidenceChainManualCommand = {
  label: string;
  command: string;
};

type EvidenceChainManualHandoff = {
  status: string;
  selectedTaskId: string | null;
  sourceRef: string | null;
  commands: EvidenceChainManualCommand[];
};

type ScreenshotCatalogReadback = {
  source: "evidence_chain" | "automation_status";
  status: "ready_to_open" | "render_command_ready" | "viewer_path_expected" | "viewer_path_recorded";
  selectedTaskId: string | null;
  sourceRef: string | null;
  viewerPath: string | null;
  exists: boolean | null;
  commandHint: string | null;
  captureStatus: string | null;
  capturedStories: number | null;
  capturedViewports: number | null;
  freshness: string | null;
};

type ScreenshotReadbackGap = {
  title: string;
  message: string;
  status: string;
  reasonCode: string;
  recordedRows: number;
  reviewableRows: number;
  nextAction: string;
};

type PlannerApplyNextHandoff = {
  status: string;
  title: string;
  message: string;
  recordedCount: number;
  plannerAppliedCount: number;
  allowedChangedFiles: number;
  forbiddenChangedFiles: number;
  headChanged: boolean | null;
  sourceRef: string | null;
};

type ExecutorResultError = {
  code: string | null;
  message: string | null;
};

type ExecutorResultSummary = {
  status: string;
  selectedTaskId: string | null;
  mode: string | null;
  workspaceMode: string | null;
  beforeCommit: string | null;
  localProjectCommit: string | null;
  projectCommitStatus: string | null;
  changedFiles: string[];
  changedFilesSource: "project_commit" | "workspace_diff" | null;
  executorReportPath: string | null;
  workspaceReportPath: string | null;
  executorError: ExecutorResultError | null;
  projectCommitError: ExecutorResultError | null;
  agentOutputPreview: string | null;
  agentOutputPreviewTruncated: boolean;
};

type ExecutorObserverReadback = {
  ownerBoundary: "ralph.executor-observer";
  status: string;
  visualEvidenceMode: string | null;
  filesChangedCount: number | null;
  visualWorkbenchCoverage: string | null;
  detectedCompletionPromiseFound: boolean | null;
  needsReplanSignalDetected: boolean | null;
  malformedCompletion: string | null;
  changedVisualWorkbenchFiles: string[];
  forbiddenChangedFiles: string[];
  adHocProofLikeFiles: string[];
  expectedVisualWorkbenchStoryIds: string[];
  coveredExpectedVisualWorkbenchStoryIds: string[];
  missingExpectedVisualWorkbenchStoryIds: string[];
  warnings: string[];
};

type ExecutorVisualWorkbenchHandoff = {
  status: "ready_for_selector_readiness" | "blocked" | "not_applicable";
  title: string;
  message: string;
  taskId: string | null;
  workDir: string | null;
  sourceRef: string | null;
  nextStageId: "visual_workbench_selector_readiness" | null;
  projectClass: string | null;
  visualEvidenceMode: string | null;
  acceptedDiffRefs: string[];
  blockers: string[];
  warnings: string[];
  commandInputValues: Record<string, string>;
};

type SelectorCapturePolicyHandoff = {
  status: "ready";
  title: string;
  message: string;
  taskId: string;
  sourceRef: string | null;
};

type ShellPolicyBrowserReadinessHandoff = {
  status: "allowed";
  title: string;
  message: string;
  taskId: string | null;
  sourceRef: string | null;
};

type BrowserReadinessScreenshotHandoff = {
  status: "ready";
  title: string;
  message: string;
  executablePath: string | null;
};

type LabProjectAction = AdminLabProjectActionDefinition;

type LabProjectActionView = LabProjectAction & { stage: LabStage | null };

type LabActionRunKind = {
  label: string;
  helper: string;
  outputLabel: "Result" | "Handoff" | "Target";
  tone: "run" | "copy" | "planned";
};

type LabActionReadiness = {
  label: string;
  helper: string;
  needs: string[];
  needsLabel?: string;
  tone: "ready" | "needs" | "copy" | "planned";
};

type LabExecutorAgent = "claude-code" | "codex" | "opencode";

const DEFAULT_STAGE_COPY: LabStageCopy = {
  title: "Project check",
  summary: "Runs one explicit read-only check for the selected project.",
  reads: "Current project state from its existing owner.",
  wont: "It will not change project state or start any agent work.",
  next: "Use the result to decide the next manual step.",
  resultSummary: "The check finished. Technical output is available below.",
};

const STAGE_COPY: Record<string, LabStageCopy> = {
  project_operator_snapshot: {
    title: "Project status",
    summary: "Shows whether the project is running, paused, blocked, archived or waiting.",
    reads: "App, Agent, preview, blockers, repo and runtime support.",
    wont: "It will not retry, relaunch, recreate runtime or change blockers.",
    next: "Use this first when the project state is unclear.",
    resultSummary: "Project status was read.",
  },
  project_agent_off: {
    title: "Pause agent",
    summary: "Stops loop work for this project while keeping App/preview intent unchanged.",
    reads: "The selected project id and the existing governance Agent lifecycle owner.",
    wont: "It will not relaunch, retry, recreate runtime, change App intent, patch tasks or create evidence.",
    next: "Use Project status to confirm the project is parked before isolated manual experiments.",
    resultSummary: "Agent intent was set to OFF through the lifecycle owner.",
  },
  project_agent_on: {
    title: "Resume agent",
    summary: "Allows loop work again through the existing Agent lifecycle owner.",
    reads: "The selected project id, lifecycle tuple and loop-support gate.",
    wont: "It will not relaunch, recreate runtime, select a task, patch a plan or create evidence.",
    next: "Use Project status to see whether normal claim path resumed, idled or blocked.",
    resultSummary: "Agent intent was set to ON through the lifecycle owner.",
  },
  spec_artifact_audit: {
    title: "Accepted spec check",
    summary: "Shows whether Arena has a current accepted spec artifact for this project.",
    reads: "Accepted spec, accepted diff and import readiness.",
    wont: "It will not reinterpret the spec or start planner work.",
    next: "Use this before planner or screenshot-evidence experiments.",
    resultSummary: "Accepted spec artifact status was checked.",
  },
  runtime_claim_dry_run: {
    title: "Runtime claim preview",
    summary: "Shows what the worker would do if it tried to claim this project now.",
    reads: "Runtime intent policy and current worker capacity inputs.",
    wont: "It will not create a lease, start a container or resume the agent.",
    next: "Use this before any real runtime action.",
    resultSummary: "Runtime claim policy was evaluated without claiming anything.",
  },
  runner_init_readiness: {
    title: "Runner readiness",
    summary: "Checks whether the project has enough runtime configuration to initialize.",
    reads: "Runner command, source config and runtime auth requirements.",
    wont: "It will not write config, repair source or recreate runtime.",
    next: "Fix readiness through the owning runtime/config path.",
    resultSummary: "Runner initialization readiness was checked.",
  },
  proof_reviews: {
    title: "Are screenshots recorded?",
    summary: "Reads whether Arena already has screenshot review rows for this project.",
    useWhen: "Use after a UI task, Workbench evidence publish or completed visual run.",
    dependsOn: "To open files, run \"Can screenshots be opened?\" after this shows screenshot reviews.",
    reads: "Screenshot review count, proof review count and screenshot readiness from Arena's project readback.",
    wont: "It will not capture screenshots, create evidence, scan raw folders or send Telegram messages.",
    next: "If screenshot reviews exist, check whether their files are downloadable.",
    resultSummary: "Screenshot review status was loaded.",
  },
  visual_evidence_artifact_check: {
    title: "Can screenshots be opened?",
    summary: "Checks whether recorded screenshot review files are downloadable.",
    useWhen: "Use only after \"Are screenshots recorded?\" shows at least one screenshot review.",
    dependsOn: "Needs existing visual evidence reviews with artifact handles.",
    reads: "Recorded screenshot review files through Arena's download path.",
    wont: "It will not return raw image bytes, expose storage paths or create new evidence.",
    next: "Open the screenshot review only when downloadable files exist.",
    resultSummary: "Screenshot file downloadability was checked.",
  },
  visual_evidence_ingest: {
    title: "Screenshot ingest",
    summary: "CLI ready: registers one already-published Workbench screenshot with Arena.",
    reads: "Selected project, task, evidence id, published progress file and matching screenshot file.",
    wont: "It will not scan folders, retry the project, mark tasks done or send Telegram messages.",
    next: "Run this only after Workbench progress publish, then read Screenshot reviews.",
    resultSummary: "Screenshot ingest is a CLI handoff from this screen.",
  },
  prompt_contract_replay: {
    title: "Prompt contract",
    summary: "UI ready: wraps Prompt Lab replay for one fixed product or UX role-skill fixture.",
    reads: "A fixed product/UX Prompt Lab fixture and the Ralph Prompt Repository.",
    wont: "It will not call a model, run planner/executor/controller, write prompt traces or change project truth.",
    next: "Use this before prompt edits or before splitting product/UX passes into real runnable owners.",
    resultSummary: "Prompt replay finished.",
  },
  project_stage_candidates: {
    title: "Find work",
    summary: "Finds pending, failed or interrupted tasks that can feed a manual executor stage.",
    useWhen: "Use before Get task context when you need a real project/task candidate.",
    dependsOn: "The scan is capped. Check the scope card before treating an empty result as fleet-wide.",
    reads: "A capped project list and each project's current task context.",
    wont: "It will not select a task, run executor, infer screenshots or change project state.",
    next: "Pick a project/task row, then run Get task context for that exact task.",
    resultSummary: "Task candidate scan finished.",
  },
  project_stage_snapshot: {
    title: "Task context",
    summary: "Prepares one read-only input for planner, executor or controller experiments.",
    reads: "Project state, source state, task state and selected task context.",
    wont: "It will not apply plan changes or run any production stage.",
    next: "Pass the resulting task context JSON to an explicit planner, executor or controller stage.",
    resultSummary: "Task context was created as a disposable read-only artifact.",
  },
  planner_project_dry_run: {
    title: "Planner dry-run",
    summary: "UI ready: runs one planner pass from fresh task context and a temp fork.",
    reads: "Fresh task context, source commit, spec file and explicit provider settings.",
    wont: "It will not write .ralph/plan.json or start executor work.",
    next: "Inspect the plan diff report before choosing executor, prompt edits or discard.",
    resultSummary: "Planner dry-run finished.",
  },
  planner_spec_migration_apply: {
    title: "Apply spec diff to plan",
    summary: "UI ready: materializes accepted spec changes into the existing Ralph plan.",
    reads: "Fresh task context, live workspace, source commit, spec file, visual policy and explicit provider settings.",
    wont: "It will not apply dry-run output, edit source files, start executor/controller/Workbench, commit or push.",
    next: "Inspect the plan diff and report, then manually run executor for one selected task.",
    resultSummary: "Planner apply finished.",
  },
  executor_project_task: {
    title: "Executor on one task",
    summary: "UI ready: runs executor for one selected task as an explicit live workspace action.",
    reads: "Fresh task context, selected task state, visual policy and explicit provider settings.",
    wont: "It will not push source, complete the live task, write evidence or hide a fork fallback.",
    next: "Inspect the result and local project commit before choosing controller, screenshots or rollback.",
    resultSummary: "Executor task run finished.",
  },
  executor_workspace_source_snapshot: {
    title: "Executor source snapshot",
    summary: "CLI ready: turns a completed executor fork into a local experiment source ref.",
    reads: "A completed executor workspace report, the same forked source workspace and its original source ref.",
    wont: "It will not push source, deploy, create screenshots, mark tasks done or write proof evidence.",
    next: "Use this before Workbench manifest or selector readiness when executor changed visual source.",
    resultSummary: "Executor source snapshot is a CLI handoff from this screen.",
  },
  controller_project_dry_run: {
    title: "Controller dry-run",
    summary: "UI ready: runs one controller review from fresh task context and a temp fork.",
    reads: "Fresh task context, source commit, spec file, explicit trigger and provider settings.",
    wont: "It will not write controller reports, plan changes, evidence or lifecycle state.",
    next: "Inspect the dry-run report before any explicit apply, replan or discard decision.",
    resultSummary: "Controller dry-run finished.",
  },
  visual_workbench_manifest_readiness: {
    title: "Workbench manifest",
    summary: "UI ready: checks whether source-owned stories exist for the selected project source.",
    reads: "Fresh task context and source-owned Workbench manifest at the context commit.",
    wont: "It will not accept source paths, start the workbench server, capture screenshots or infer evidence availability.",
    next: "If ready, check selector, capture policy and browser readiness before manual screenshot handoff.",
    resultSummary: "Workbench manifest readiness finished.",
  },
  visual_workbench_selector_readiness: {
    title: "Workbench selector",
    summary: "UI ready: checks which story/viewports are explicitly linked to one selected task.",
    reads: "Fresh task context, selected task and source-owned Workbench manifest.",
    wont: "It will not infer selectors from routes, names or screenshot content.",
    next: "Fix task/story links if blocked, or continue to capture policy before browser readiness and evidence automation.",
    resultSummary: "Workbench selector readiness finished.",
  },
  visual_workbench_shell_policy: {
    title: "Workbench capture policy",
    summary: "UI ready: checks whether Ralph may start the source-owned Workbench command.",
    reads: "Fresh task context, selected task and runner-owned Ralph config.",
    wont: "It will not execute shell commands, start a browser, capture screenshots or create evidence.",
    next: "If allowed, continue to browser readiness before the explicit screenshot handoff.",
    resultSummary: "Workbench capture policy finished.",
  },
  visual_workbench_browser_readiness: {
    title: "Browser readiness",
    summary: "UI ready: checks platform Chromium readiness before screenshot capture.",
    reads: "The platform browser environment Ralph would use for Workbench capture.",
    wont: "It will not install browsers inside a project or capture screenshots.",
    next: "Repair platform browser infra if blocked, or continue to capture/evidence automation.",
    resultSummary: "Browser readiness finished.",
  },
  visual_workbench_evidence_automation: {
    title: "Workbench evidence",
    summary: "CLI ready: creates screenshot evidence for one selected Workbench story/task path.",
    reads: "Explicit task, source ref, Workbench manifest, base URL and Ralph config.",
    wont: "It will not mark a task done, create proofReviews, assess pass/fail or repair browser infra.",
    next: "Inspect the report, then read Arena visual evidence status or add a manual assessment.",
    resultSummary: "Workbench evidence automation is a CLI handoff from this screen.",
  },
  visual_workbench_evidence_automation_run: {
    title: "Run screenshot capture",
    summary: "UI ready: runs Workbench evidence automation once for the selected task after confirmation.",
    reads: "Fresh task context, selected task, source commit, server-derived Ralph config, localhost base URL and output directory.",
    wont: "It will not accept paths from the browser, ingest evidence, create proofReviews, deliver Telegram buttons, commit or push.",
    next: "Inspect the report, then explicitly run automation status, evidence-chain readiness, ingest or screenshot readback.",
    resultSummary: "Workbench evidence automation finished.",
  },
  visual_workbench_automation_status: {
    title: "Automation status",
    summary: "UI ready: reads the latest Workbench automation diagnostic for one selected task.",
    reads: "Fresh task context and the task's Ralph-local automation diagnostic.",
    wont: "It will not scan capture folders, capture screenshots, export evidence or publish progress.",
    next: "If published, read screenshot status; if blocked, fix the explicit blocker and rerun the Workbench evidence command.",
    resultSummary: "Automation status readback finished.",
  },
  visual_workbench_evidence_chain_readiness: {
    title: "Evidence chain readiness",
    summary: "UI ready: checks which explicit Workbench/Arena evidence boundary is ready or blocked for one selected task.",
    reads: "Fresh task context and Ralph evidence-chain readiness for that task.",
    wont: "It will not accept capture files, capture screenshots, export evidence, publish progress or infer Telegram availability.",
    next: "Use nextCommands as manual handoffs only, then read Arena screenshot status when Arena readback is the next explicit step.",
    resultSummary: "Evidence chain readiness finished.",
  },
};

function getStageCopy(stage: LabStage | null | undefined): LabStageCopy {
  if (!stage) return DEFAULT_STAGE_COPY;
  return STAGE_COPY[stage.id] ?? {
    ...DEFAULT_STAGE_COPY,
    title: stage.label,
    summary: stage.description,
  };
}

function formatStageAvailability(stage: LabStage): string {
  if (stage.runSurface === "admin_lab_run" && stage.status === "supported_now") return "Ready in UI";
  if (stage.runSurface === "direct_cli" && stage.status === "supported_now") return "CLI ready";
  return "Planned";
}

function formatRunButton(stage: LabStage | null, commandHasPlaceholders = false): string {
  if (!stage) return "Select stage";
  if (stage.runSurface === "admin_lab_run" && stage.status === "supported_now") {
    return stage.mode === "workspace_mutation" || stage.mode === "operator_mutation" ? "Run now" : "Check now";
  }
  if (stage.runSurface === "direct_cli" && stage.status === "supported_now") {
    return commandHasPlaceholders ? "Copy template" : "Copy command";
  }
  return "Planned";
}

function getActionRunKind(stage: LabStage | null | undefined): LabActionRunKind {
  if (!stage || stage.status === "target_shape" || stage.runSurface === "target_shape") {
    return {
      label: "Planned only",
      helper: "Shown as target shape; no runnable owner yet.",
      outputLabel: "Target",
      tone: "planned",
    };
  }
  if (stage.runSurface === "direct_cli") {
    return {
      label: "Copy CLI",
      helper: "Copies a source-current command; run it manually in the operator shell.",
      outputLabel: "Handoff",
      tone: "copy",
    };
  }
  if (stage.mode === "workspace_mutation" || stage.mode === "operator_mutation") {
    return {
      label: "Runs in UI",
      helper: "Runs one explicit mutating Lab action. It does not start the next stage.",
      outputLabel: "Result",
      tone: "run",
    };
  }
  return {
    label: "Checks in UI",
    helper: "Runs one bounded check here. It does not start the next stage.",
    outputLabel: "Result",
    tone: "run",
  };
}

function getSelectedActionClickDoes(
  action: LabProjectActionView | null,
  stage: LabStage | null,
  kind: LabActionRunKind,
): string {
  if (!stage) return "Select one project action or debug stage first.";
  if (!action) {
    return `Uses raw debug stage "${stage.id}". Normal work should start from Project actions.`;
  }
  if (kind.tone === "copy") {
    return `Copies "${action.title}" as an explicit terminal handoff. The browser does not execute it.`;
  }
  if (kind.tone === "planned") {
    return `"${action.title}" is planned only; there is no runnable owner yet.`;
  }
  if (stage.mode === "workspace_mutation" || stage.mode === "operator_mutation") {
    return `Runs "${action.title}" once for the selected project and stops.`;
  }
  return `Checks "${action.title}" once for the selected project and stops.`;
}

function getRunResultOriginLabel(
  runResult: LabRunResponse,
  actions: LabProjectActionView[],
): string {
  if (runResult.actionInvocation?.title) return `Result for ${runResult.actionInvocation.title}`;
  const stageId = runResult.stage?.id;
  if (!stageId) return "Result";
  const matchingActions = actions.filter((action) => action.stageId === stageId);
  if (matchingActions.length === 1) return `Result for ${matchingActions[0].title}`;
  if (stageId === "prompt_contract_replay") {
    const result = asRecord(runResult.result);
    const fixture = readRecordField(result, "fixture");
    const fixtureId = readString(fixture?.id);
    const matchingPromptAction = matchingActions.find((action) => action.promptReplayFixture === fixtureId);
    if (matchingPromptAction) return `Result for ${matchingPromptAction.title}`;
  }
  if (matchingActions.length === 0) return `Debug stage result: ${getStageCopy(runResult.stage).title}`;
  return `Result for ${getStageCopy(runResult.stage).title}`;
}

function getPrimaryButtonLabel(
  action: LabProjectActionView | null,
  stage: LabStage | null,
  commandHasPlaceholders: boolean,
): string {
  if (action?.buttonLabel) return action.buttonLabel;
  return formatRunButton(stage, commandHasPlaceholders);
}

function formatPromptReplayFixtureLabel(value: "product_skill" | "ux_skill"): string {
  return value === "product_skill" ? "Product role guidance" : "UX role guidance";
}

function isProjectActionVisibleOnFirstScreen(
  action: LabProjectActionView,
  input: {
    selectedProjectActionId: string | null;
    showVisualEvidenceDetails: boolean;
  },
): boolean {
  if (action.primaryVisibility !== "details") return true;
  return input.showVisualEvidenceDetails || action.id === input.selectedProjectActionId;
}

function normalizeLabExecutorAgent(value: string | null | undefined): LabExecutorAgent | null {
  if (value === "claude-code" || value === "codex" || value === "opencode") return value;
  return null;
}

function actionRunKindBadgeClasses(kind: LabActionRunKind, selected: boolean): string {
  if (selected) {
    return "border-white/40 bg-white/15 text-white dark:border-slate-900/30 dark:bg-slate-950/20 dark:text-slate-950";
  }
  if (kind.tone === "copy") {
    return "border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-100";
  }
  if (kind.tone === "planned") {
    return "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200";
  }
  return "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-200";
}

function readinessBadgeClasses(tone: LabActionReadiness["tone"]): string {
  if (tone === "ready") {
    return "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-200";
  }
  if (tone === "copy") {
    return "border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-100";
  }
  if (tone === "planned") {
    return "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200";
  }
  return "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-200";
}

function renderCommandTemplate(
  command: string,
  input: {
    stageId: string | null | undefined;
    projectId: string | null | undefined;
    taskId?: string;
    tail?: string;
  },
): string {
  const taskId = normalizeTaskId(input.taskId);
  const tail = normalizeTail(input.tail);
  let rendered = command
    .replaceAll("<project-id>", input.projectId || "<project-id>")
    .replaceAll("<id>", input.projectId || "<id>")
    .replaceAll("<task-id>", taskId || "<task-id>")
    .replaceAll("<tail>", tail);
  if (input.stageId === "project_stage_snapshot") {
    rendered = rendered.replaceAll(" --task-id <task-id>", taskId ? ` --task-id ${taskId}` : "");
  }
  return rendered;
}

function normalizeTail(value: string | null | undefined): string {
  return normalizeBoundedInteger(value, "80", 5000);
}

function normalizeCandidateLimit(value: string | null | undefined): string {
  return normalizeBoundedInteger(value, "25", 100);
}

function normalizeCandidateTail(value: string | null | undefined): string {
  return normalizeBoundedInteger(value, "5", 5000);
}

function normalizeBoundedInteger(value: string | null | undefined, fallback: string, max: number): string {
  const trimmed = value?.trim() || "";
  if (!/^[1-9][0-9]*$/.test(trimmed)) return fallback;
  return Number(trimmed) <= max ? trimmed : fallback;
}

function normalizeRequiredBoundedInteger(value: string | null | undefined, max: number): string {
  const trimmed = value?.trim() || "";
  if (!/^[1-9][0-9]*$/.test(trimmed)) return "";
  return Number(trimmed) <= max ? trimmed : "";
}

function normalizeTaskId(value: string | null | undefined): string {
  const trimmed = value?.trim() || "";
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/.test(trimmed) ? trimmed : "";
}

function shortProjectId(id: string): string {
  return id.length > 12 ? `${id.slice(0, 8)}...${id.slice(-4)}` : id;
}

function getCopyableResultPayload(runResult: LabRunResponse): unknown {
  if (isSnapshotRunResult(runResult) || isCandidateScanRunResult(runResult)) {
    return runResult.result;
  }
  return runResult;
}

function isSnapshotRunResult(runResult: LabRunResponse): boolean {
  return !runResult.error && runResult.stage?.id === "project_stage_snapshot" && runResult.result !== undefined;
}

function isCandidateScanRunResult(runResult: LabRunResponse): boolean {
  return !runResult.error && runResult.stage?.id === "project_stage_candidates" && runResult.result !== undefined;
}

function getRunResultProjectId(runResult: LabRunResponse): string | null {
  return runResult.projectId ?? readResultStringField(runResult.result, "projectId");
}

function readResultStringField(value: unknown, field: string): string | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  return typeof record[field] === "string" ? record[field] : null;
}

function sanitizeDownloadSegment(value: string | null, fallback: string): string {
  const sanitized = (value || "").replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
  return sanitized || fallback;
}

function getSnapshotDownloadFilename(runResult: LabRunResponse): string {
  const projectId = sanitizeDownloadSegment(readResultStringField(runResult.result, "projectId"), "project");
  const taskId = sanitizeDownloadSegment(readResultStringField(runResult.result, "selectedTaskId"), "all-tasks");
  return `project-stage-snapshot-${projectId}-${taskId}.json`;
}

function getSnapshotSuggestedFilePath(runResult: LabRunResponse): string {
  return `/private/tmp/${getSnapshotDownloadFilename(runResult)}`;
}

function getCopyResultLabel(runResult: LabRunResponse): string {
  if (isSnapshotRunResult(runResult)) return "Copy task context JSON";
  if (isCandidateScanRunResult(runResult)) return "Copy scan JSON";
  return "Copy result JSON";
}

function isMutatingLabStage(stage: LabStage | null | undefined): boolean {
  return stage?.mode === "workspace_mutation" || stage?.mode === "operator_mutation";
}

function getRunResultHeading(runResult: LabRunResponse): string {
  if (runResult.error) return isMutatingLabStage(runResult.stage) ? "Run failed" : "Check failed";
  return isMutatingLabStage(runResult.stage) ? "Run finished" : "Check finished";
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? value as Record<string, unknown> : null;
}

function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function readArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function readStringArray(value: unknown): string[] {
  return readArray(value).flatMap((item) => {
    const text = readString(item);
    return text ? [text] : [];
  });
}

function readRecordField(value: Record<string, unknown> | null, field: string): Record<string, unknown> | null {
  return asRecord(value?.[field]);
}

function formatShortSha(value: string | null): string {
  return value ? value.slice(0, 12) : "unknown";
}

function formatPathTail(value: string): string {
  const parts = value.split("/");
  return parts.at(-1) || value;
}

function isExecutorWarningStatus(status: string | null): boolean {
  return status === "blocked"
    || status === "failed"
    || status === "agent_failed"
    || status === "forbidden_mutation";
}

function formatExecutorResultValue(value: string | null): string {
  return value ? value.replaceAll("_", " ") : "unknown";
}

function readExecutorResultError(value: Record<string, unknown> | null): ExecutorResultError | null {
  if (!value) return null;
  const code = readString(value.code);
  const message = readString(value.message);
  if (!code && !message) return null;
  return { code, message };
}

function getExecutorResultSummary(runResult: LabRunResponse | null): ExecutorResultSummary | null {
  if (!runResult || runResult.error || runResult.stage?.id !== "executor_project_task") return null;

  const result = asRecord(runResult.result);
  const executorResult = readRecordField(result, "executorResult");
  if (!executorResult) return null;

  const input = readRecordField(executorResult, "input");
  const output = readRecordField(executorResult, "output");
  const projectCommit = readRecordField(executorResult, "projectCommit");
  const workspaceResult = readRecordField(executorResult, "workspaceResult");
  const workspaceSource = readRecordField(workspaceResult, "source");
  const agent = readRecordField(workspaceResult, "agent");
  const projectCommitStatus = readString(projectCommit?.status);
  const commitChangedFiles = projectCommit ? readStringArray(projectCommit.changedFiles) : [];
  const workspaceChangedFiles = projectCommit ? [] : readStringArray(workspaceSource?.changedFilesFromGitStatus);
  const changedFiles = projectCommit ? commitChangedFiles : workspaceChangedFiles;

  return {
    status: readString(executorResult.status) ?? "unknown",
    selectedTaskId: readString(input?.selectedTaskId),
    mode: readString(input?.mode),
    workspaceMode: readString(input?.workspaceMode),
    beforeCommit: readString(projectCommit?.beforeCommit) ?? readString(input?.sourceRef),
    localProjectCommit: projectCommitStatus === "committed" ? readString(projectCommit?.afterCommit) : null,
    projectCommitStatus,
    changedFiles,
    changedFilesSource: changedFiles.length > 0
      ? projectCommit
        ? "project_commit"
        : "workspace_diff"
      : null,
    executorReportPath: readString(output?.reportPath),
    workspaceReportPath: readString(output?.delegatedWorkspaceReportPath),
    executorError: readExecutorResultError(readRecordField(executorResult, "error")),
    projectCommitError: readExecutorResultError(readRecordField(projectCommit, "error")),
    agentOutputPreview: readString(agent?.outputPreview),
    agentOutputPreviewTruncated: readBoolean(agent?.outputPreviewTruncated) ?? false,
  };
}

function getExecutorObserverReadback(runResult: LabRunResponse | null): ExecutorObserverReadback | null {
  if (!runResult || runResult.error || runResult.stage?.id !== "executor_project_task") return null;

  const result = asRecord(runResult.result);
  const executorResult = readRecordField(result, "executorResult");
  const workspaceResult = readRecordField(executorResult, "workspaceResult");
  const executorOutput = readRecordField(workspaceResult, "executorOutput");
  if (readString(executorOutput?.ownerBoundary) !== "ralph.executor-observer") return null;

  const summary = readRecordField(executorOutput, "summary");
  const task = readRecordField(workspaceResult, "task");
  const warnings = readArray(executorOutput?.warnings).flatMap((entry) => {
    const warning = asRecord(entry);
    const code = readString(warning?.code);
    const message = readString(warning?.message);
    const label = [code, message].filter(Boolean).join(": ");
    return label ? [label] : [];
  });

  return {
    ownerBoundary: "ralph.executor-observer",
    status: readString(executorOutput?.status) ?? "unknown",
    visualEvidenceMode: readString(executorOutput?.visualEvidenceMode) ?? readString(task?.visualEvidenceMode),
    filesChangedCount: readNumber(summary?.filesChangedCount),
    visualWorkbenchCoverage: readString(summary?.visualWorkbenchCoverage),
    detectedCompletionPromiseFound: readBoolean(executorOutput?.detectedCompletionPromiseFound),
    needsReplanSignalDetected: readBoolean(executorOutput?.needsReplanSignalDetected),
    malformedCompletion: readString(executorOutput?.malformedCompletion),
    changedVisualWorkbenchFiles: readStringArray(summary?.changedVisualWorkbenchFiles),
    forbiddenChangedFiles: readStringArray(summary?.forbiddenChangedFiles),
    adHocProofLikeFiles: readStringArray(summary?.adHocProofLikeFiles),
    expectedVisualWorkbenchStoryIds: readStringArray(summary?.expectedVisualWorkbenchStoryIds),
    coveredExpectedVisualWorkbenchStoryIds: readStringArray(summary?.coveredExpectedVisualWorkbenchStoryIds),
    missingExpectedVisualWorkbenchStoryIds: readStringArray(summary?.missingExpectedVisualWorkbenchStoryIds),
    warnings,
  };
}

function getExecutorVisualWorkbenchHandoff(runResult: LabRunResponse | null): ExecutorVisualWorkbenchHandoff | null {
  if (!runResult || runResult.error || runResult.stage?.id !== "executor_project_task") return null;

  const result = asRecord(runResult.result);
  const executorResult = readRecordField(result, "executorResult");
  if (!executorResult) return null;

  const input = readRecordField(executorResult, "input");
  const handoffGate = readRecordField(executorResult, "visualWorkbenchHandoffGate");
  if (!handoffGate) return null;

  const status = readString(handoffGate.status);
  if (status !== "ready_for_selector_readiness" && status !== "blocked" && status !== "not_applicable") return null;
  const nextStageId = readString(handoffGate.nextStageId) === "visual_workbench_selector_readiness"
    ? "visual_workbench_selector_readiness"
    : null;
  const commandInputValuesSource = readRecordField(handoffGate, "commandInputValues");
  const commandInputValues: Record<string, string> = {};
  for (const key of ["<project-source-workspace>", "<taskId>"]) {
    const value = readString(commandInputValuesSource?.[key]);
    if (value) commandInputValues[key] = value;
  }
  const acceptedDiffRefs = readArray(handoffGate.acceptedDiffRefs)
    .map((entry) => readString(asRecord(entry)?.diffItemId))
    .filter((value): value is string => Boolean(value));
  const taskId = readString(handoffGate.taskId) ?? readString(input?.selectedTaskId);
  const workDir = readString(input?.workDir);
  const sourceRef = readString(handoffGate.sourceRef);

  if (status === "not_applicable") {
    return {
      status: "not_applicable",
      title: "Visual handoff not needed",
      message: "This executor result says the selected task should not enter the Visual Workbench evidence path.",
      taskId,
      workDir,
      sourceRef,
      nextStageId,
      projectClass: readString(handoffGate.projectClass),
      visualEvidenceMode: readString(handoffGate.visualEvidenceMode),
      acceptedDiffRefs,
      blockers: readStringArray(handoffGate.blockers),
      warnings: readStringArray(handoffGate.warnings),
      commandInputValues: {},
    };
  }

  return {
    status,
    title: status === "ready_for_selector_readiness" ? "Selector readiness can run next" : "Visual handoff blocked",
    message: status === "ready_for_selector_readiness"
      ? "This only fills the selector-readiness handoff. It does not run screenshots automatically."
      : "Visual evidence may apply, but an owner-backed gate is still missing required metadata.",
    taskId,
    workDir,
    sourceRef,
    nextStageId,
    projectClass: readString(handoffGate.projectClass),
    visualEvidenceMode: readString(handoffGate.visualEvidenceMode),
    acceptedDiffRefs,
    blockers: readStringArray(handoffGate.blockers),
    warnings: readStringArray(handoffGate.warnings),
    commandInputValues,
  };
}

function getEvidenceChainManualHandoff(runResult: LabRunResponse | null): EvidenceChainManualHandoff | null {
  if (!runResult || runResult.error || runResult.stage?.id !== "visual_workbench_evidence_chain_readiness") return null;

  const result = asRecord(runResult.result);
  const readiness = readRecordField(result, "evidenceChainReadiness");
  if (!readiness) return null;

  const snapshot = readRecordField(result, "snapshot");
  const source = readRecordField(snapshot, "source");
  const workspace = readRecordField(source, "workspace");
  const input = readRecordField(readiness, "input");
  const task = readRecordField(readiness, "task");
  const commands = readStringArray(readiness.nextCommands).map((command, index) => ({
    label: labelEvidenceChainCommand(command, index),
    command,
  }));

  return {
    status: readString(readiness.status) ?? "unknown",
    selectedTaskId: readString(task?.taskId) ?? readString(input?.taskId),
    sourceRef: readString(workspace?.commitSha),
    commands,
  };
}

function getSelectorCapturePolicyHandoff(runResult: LabRunResponse | null): SelectorCapturePolicyHandoff | null {
  if (!runResult || runResult.error || runResult.stage?.id !== "visual_workbench_selector_readiness") return null;

  const result = asRecord(runResult.result);
  const selector = readRecordField(result, "selectorReadiness");
  if (!selector || readString(selector.status) !== "ready") return null;

  const snapshot = readRecordField(result, "snapshot");
  const source = readRecordField(snapshot, "source");
  const workspace = readRecordField(source, "workspace");
  const plan = readRecordField(snapshot, "plan");
  const selectedTask = readRecordField(plan, "selectedTask");
  const input = readRecordField(selector, "input");
  const taskId = readString(snapshot?.selectedTaskId)
    ?? readString(selectedTask?.id)
    ?? readString(input?.taskId);
  if (!taskId) return null;

  return {
    status: "ready",
    title: "Capture policy can run next",
    message: "This only fills the capture-policy check for the same task. It does not start Workbench or capture screenshots.",
    taskId,
    sourceRef: readString(workspace?.commitSha),
  };
}

function getShellPolicyBrowserReadinessHandoff(runResult: LabRunResponse | null): ShellPolicyBrowserReadinessHandoff | null {
  if (!runResult || runResult.error || runResult.stage?.id !== "visual_workbench_shell_policy") return null;

  const result = asRecord(runResult.result);
  const shellPolicy = readRecordField(result, "shellPolicy");
  if (!shellPolicy || readString(shellPolicy.status) !== "allowed") return null;

  const snapshot = readRecordField(result, "snapshot");
  const source = readRecordField(snapshot, "source");
  const workspace = readRecordField(source, "workspace");
  const plan = readRecordField(snapshot, "plan");
  const selectedTask = readRecordField(plan, "selectedTask");

  return {
    status: "allowed",
    title: "Browser readiness can run next",
    message: "This only selects the platform browser readiness check. It does not start Workbench or capture screenshots.",
    taskId: readString(snapshot?.selectedTaskId) ?? readString(selectedTask?.id),
    sourceRef: readString(workspace?.commitSha),
  };
}

function getBrowserReadinessScreenshotHandoff(runResult: LabRunResponse | null): BrowserReadinessScreenshotHandoff | null {
  if (!runResult || runResult.error || runResult.stage?.id !== "visual_workbench_browser_readiness") return null;

  const result = asRecord(runResult.result);
  const browserReadiness = readRecordField(result, "browserReadiness");
  if (!browserReadiness || readString(browserReadiness.status) !== "ready") return null;

  return {
    status: "ready",
    title: "Screenshot handoff can be prepared",
    message: "This only selects the copy-only screenshot command. Terminal values remain explicit or context-filled; it does not start Workbench or capture screenshots.",
    executablePath: readString(browserReadiness.executablePath),
  };
}

function labelEvidenceChainCommand(command: string, index: number): string {
  if (command.includes("visual-workbench render-viewer")) return "Render screenshot catalog";
  if (command.includes("visual-workbench export-evidence")) return "Export task evidence";
  if (command.includes("visual-workbench assess")) return "Assess screenshot evidence";
  if (command.includes("visual-workbench publish-progress")) return "Publish Arena readback";
  if (command.includes("project_proof_reviews")) return "Read screenshot status";
  if (command.includes("project_visual_evidence_artifact_check")) return "Check screenshot files";
  return `Manual handoff ${index + 1}`;
}

function getLocalFileUrl(filePath: string | null | undefined): string | null {
  const trimmed = filePath?.trim();
  if (!trimmed || !trimmed.startsWith("/")) return null;
  const encodedPath = trimmed
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return `file://${encodedPath}`;
}

function getEvidenceChainCaptureViewerHandoff(runResult: LabRunResponse | null): ScreenshotCatalogReadback | null {
  if (!runResult || runResult.error || runResult.stage?.id !== "visual_workbench_evidence_chain_readiness") return null;

  const result = asRecord(runResult.result);
  const readiness = readRecordField(result, "evidenceChainReadiness");
  if (!readiness) return null;

  const captureViewer = readRecordField(readiness, "captureViewer");
  if (!captureViewer) return null;

  const viewerPath = readString(captureViewer.viewerPath);
  const commandHint = readString(captureViewer.commandHint);
  if (!viewerPath && !commandHint) return null;

  const snapshot = readRecordField(result, "snapshot");
  const source = readRecordField(snapshot, "source");
  const workspace = readRecordField(source, "workspace");
  const input = readRecordField(readiness, "input");
  const task = readRecordField(readiness, "task");
  const exists = readBoolean(captureViewer.exists);
  const status = exists === true
    ? "ready_to_open"
    : commandHint
      ? "render_command_ready"
      : "viewer_path_expected";

  return {
    source: "evidence_chain",
    status,
    selectedTaskId: readString(task?.taskId) ?? readString(input?.taskId),
    sourceRef: readString(workspace?.commitSha),
    viewerPath,
    exists,
    commandHint,
    captureStatus: null,
    capturedStories: null,
    capturedViewports: null,
    freshness: null,
  };
}

function getAutomationStatusCaptureViewerHandoff(runResult: LabRunResponse | null): ScreenshotCatalogReadback | null {
  if (!runResult || runResult.error || runResult.stage?.id !== "visual_workbench_automation_status") return null;

  const result = asRecord(runResult.result);
  const automationStatus = readRecordField(result, "automationStatus");
  if (!automationStatus) return null;

  const report = readRecordField(automationStatus, "report");
  const capture = readRecordField(report, "capture");
  const viewerPath = readString(capture?.viewerPath);
  if (!viewerPath) return null;

  const sourceFreshness = readRecordField(automationStatus, "sourceFreshness");
  const reportSourceRef = readString(sourceFreshness?.reportSourceRef);
  const resolvedReportSourceRef = readString(sourceFreshness?.resolvedReportSourceRef);

  return {
    source: "automation_status",
    status: "viewer_path_recorded",
    selectedTaskId: readString(automationStatus.taskId),
    sourceRef: resolvedReportSourceRef ?? reportSourceRef,
    viewerPath,
    exists: null,
    commandHint: null,
    captureStatus: readString(capture?.status),
    capturedStories: readNumber(capture?.capturedStories),
    capturedViewports: readNumber(capture?.capturedViewports),
    freshness: readString(sourceFreshness?.status),
  };
}

function getScreenshotCatalogReadback(runResult: LabRunResponse | null): ScreenshotCatalogReadback | null {
  return getEvidenceChainCaptureViewerHandoff(runResult)
    ?? getAutomationStatusCaptureViewerHandoff(runResult);
}

function getResultHighlights(runResult: LabRunResponse): ResultHighlight[] {
  const result = asRecord(runResult.result);
  if (!result || runResult.error) return [];

  if (runResult.stage?.id === "project_operator_snapshot") {
    const app = readRecordField(result, "app");
    const blockers = readArray(app?.blockers);
    const powerIntent = readString(app?.powerIntent) ?? "unknown";
    const runtimeState = readString(app?.runtimeState) ?? "unknown";
    const agentIntent = readString(app?.agentIntent) ?? "unknown";
    const agentState = readString(app?.agentState) ?? "unknown";
    const previewHealth = readString(app?.previewHealth) ?? "unknown";
    const loopSupportStatus = readString(result.loopSupportStatus) ?? "unknown";

    return [
      {
        label: "App",
        value: `${powerIntent} / ${runtimeState}`,
        tone: powerIntent === "ON" && runtimeState === "RUNNING" ? "good" : "warn",
      },
      {
        label: "Agent",
        value: `${agentIntent} / ${agentState}`,
        tone: agentIntent === "ON" && agentState === "RUNNING" ? "good" : "neutral",
      },
      {
        label: "Preview",
        value: previewHealth,
        tone: previewHealth === "HEALTHY" ? "good" : "warn",
      },
      {
        label: "Blockers",
        value: blockers.length === 0 ? "None" : String(blockers.length),
        tone: blockers.length === 0 ? "good" : "warn",
      },
      {
        label: "Loop support",
        value: loopSupportStatus,
        tone: loopSupportStatus === "supported" ? "good" : "warn",
      },
    ];
  }

  if (runResult.stage?.id === "project_stage_candidates") {
    const scan = readRecordField(result, "scan");
    const candidateProjectCount = readNumber(scan?.candidateProjectCount) ?? 0;
    const scannedProjectCount = readNumber(scan?.scannedProjectCount) ?? 0;
    const eligibleProjectCount = readNumber(scan?.eligibleProjectCount) ?? scannedProjectCount;
    const omittedProjectCount = readNumber(scan?.omittedProjectCount) ?? 0;
    const scanFailureCount = readNumber(scan?.scanFailureCount) ?? 0;
    const truncated = scan?.truncated === true;
    const includeArchived = scan?.includeArchived === true;

    return [
      {
        label: "Candidates",
        value: `${candidateProjectCount}/${scannedProjectCount} scanned`,
        tone: candidateProjectCount > 0 ? "good" : "warn",
      },
      {
        label: "Scope",
        value: truncated
          ? `${scannedProjectCount}/${eligibleProjectCount}, ${omittedProjectCount} omitted`
          : `${scannedProjectCount}/${eligibleProjectCount}, complete`,
        tone: truncated ? "warn" : "good",
      },
      {
        label: "Scan failures",
        value: scanFailureCount === 0 ? "None" : String(scanFailureCount),
        tone: scanFailureCount === 0 ? "good" : "warn",
      },
      {
        label: "Archive",
        value: includeArchived ? "Including archived" : "Active only",
      },
    ];
  }

  if (runResult.stage?.id === "project_stage_snapshot") {
    const lifecycle = readRecordField(result, "lifecycleContext");
    const tuple = readRecordField(lifecycle, "tuple");
    const plan = readRecordField(result, "plan");
    const taskCounts = readRecordField(plan, "taskCounts");
    const taskCandidates = Array.isArray(plan?.taskCandidates) ? plan.taskCandidates : [];
    const source = readRecordField(result, "source");
    const workspace = readRecordField(source, "workspace");
    const classification = readString(lifecycle?.classification) ?? "unknown";
    const previewHealth = readString(tuple?.previewHealth) ?? "preview unknown";
    const completed = readNumber(taskCounts?.completed) ?? 0;
    const pending = readNumber(taskCounts?.pending) ?? 0;
    const inProgress = readNumber(taskCounts?.in_progress) ?? 0;
    const failed = readNumber(taskCounts?.failed) ?? 0;
    const total = readNumber(taskCounts?.total) ?? completed + pending + inProgress + failed;
    const selectedTask = readString(result.selectedTaskId);
    const selectedTaskSummary = selectedTask ?? (taskCandidates.length > 0
      ? `${taskCandidates.length} candidate${taskCandidates.length === 1 ? "" : "s"}`
      : "None selected");
    const sourceCommit = readString(workspace?.commitSha);

    return [
      {
        label: "Project state",
        value: `${classification} / ${previewHealth}`,
        tone: previewHealth === "HEALTHY" ? "good" : "warn",
      },
      {
        label: "Tasks",
        value: `${completed}/${total} done, ${pending + inProgress} active, ${failed} failed`,
        tone: failed === 0 ? "good" : "warn",
      },
      {
        label: "Selected task",
        value: selectedTaskSummary,
        tone: selectedTask ? "neutral" : "warn",
      },
      {
        label: "Source",
        value: formatShortSha(sourceCommit),
        tone: sourceCommit ? "good" : "warn",
      },
    ];
  }

  if (runResult.stage?.id === "planner_spec_migration_apply") {
    const plannerResult = readRecordField(result, "plannerResult");
    const input = readRecordField(plannerResult, "input");
    const source = readRecordField(plannerResult, "source");
    const applyOutput = readRecordField(plannerResult, "applyOutput");
    const status = readString(plannerResult?.status) ?? "unknown";
    const recordedCount = readNumber(applyOutput?.recordedCount) ?? 0;
    const plannerAppliedCount = readNumber(applyOutput?.plannerAppliedCount) ?? 0;
    const headChanged = readBoolean(source?.headChanged);
    const allowedChangedFiles = readStringArray(source?.allowedChangedFiles);
    const forbiddenChangedFiles = readStringArray(source?.forbiddenChangedFiles);
    const sourceRef = readString(input?.sourceRef);

    return [
      {
        label: "Planner apply status",
        value: status.replaceAll("_", " "),
        tone: status === "completed" ? "good" : "warn",
      },
      {
        label: "Spec migrations",
        value: `${recordedCount} recorded / ${plannerAppliedCount} planner`,
        tone: status === "completed" && recordedCount > 0 ? "good" : "neutral",
      },
      {
        label: "HEAD",
        value: headChanged === true ? "changed" : headChanged === false ? "unchanged" : "unknown",
        tone: headChanged === false ? "good" : "warn",
      },
      {
        label: "Allowed .ralph files",
        value: String(allowedChangedFiles.length),
        tone: forbiddenChangedFiles.length === 0 ? "good" : "neutral",
      },
      {
        label: "Forbidden files",
        value: forbiddenChangedFiles.length === 0 ? "None" : String(forbiddenChangedFiles.length),
        tone: forbiddenChangedFiles.length === 0 ? "good" : "warn",
      },
      {
        label: "Source",
        value: formatShortSha(sourceRef),
        tone: sourceRef ? "good" : "warn",
      },
    ];
  }

  if (runResult.stage?.id === "executor_project_task") {
    const executorResult = readRecordField(result, "executorResult");
    const input = readRecordField(executorResult, "input");
    const projectCommit = readRecordField(executorResult, "projectCommit");
    const status = readString(executorResult?.status) ?? "unknown";
    const selectedTask = readString(input?.selectedTaskId);
    const sourceRef = readString(input?.sourceRef);
    const commitStatus = readString(projectCommit?.status);
    const afterCommit = readString(projectCommit?.afterCommit);

    return [
      {
        label: "Executor run status",
        value: status,
        tone: status === "completed" ? "good" : isExecutorWarningStatus(status) ? "warn" : "neutral",
      },
      {
        label: "Selected task",
        value: selectedTask ?? "none",
        tone: selectedTask ? "neutral" : "warn",
      },
      {
        label: "Before commit",
        value: formatShortSha(sourceRef),
        tone: sourceRef ? "good" : "warn",
      },
      {
        label: "Local project commit",
        value: afterCommit ? formatShortSha(afterCommit) : commitStatus ?? "none",
        tone: afterCommit ? "good" : commitStatus === "blocked" ? "warn" : "neutral",
      },
    ];
  }

  if (runResult.stage?.id === "planner_project_dry_run") {
    const plannerResult = readRecordField(result, "plannerResult");
    const input = readRecordField(plannerResult, "input");
    const output = readRecordField(plannerResult, "plannerOutput");
    const summary = readRecordField(output, "summary");
    const status = readString(plannerResult?.status) ?? "unknown";
    const taskCount = readNumber(summary?.taskCount) ?? 0;
    const phaseCount = readNumber(summary?.phaseCount) ?? 0;
    const visualMode = readString(input?.visualEvidenceMode) ?? "unknown";
    const sourceRef = readString(input?.sourceRef);

    return [
      {
        label: "Planner run status",
        value: status,
        tone: status === "completed" ? "good" : "warn",
      },
      {
        label: "Plan diff",
        value: `${taskCount} task${taskCount === 1 ? "" : "s"} / ${phaseCount} phase${phaseCount === 1 ? "" : "s"}`,
        tone: status === "completed" ? "good" : "neutral",
      },
      {
        label: "Visual mode",
        value: visualMode.replaceAll("_", " "),
      },
      {
        label: "Source",
        value: formatShortSha(sourceRef),
        tone: sourceRef ? "good" : "warn",
      },
    ];
  }

  if (runResult.stage?.id === "prompt_contract_replay") {
    const replayEnvelope = readRecordField(result, "promptReplay");
    const rendered = readRecordField(replayEnvelope, "rendered");
    const fixture = readRecordField(result, "fixture");
    const entry = readRecordField(replayEnvelope, "entry");
    const promptId = readString(replayEnvelope?.promptId) ?? "unknown";
    const fixtureLabel = readString(fixture?.label) ?? readString(fixture?.id) ?? "unknown";
    const charCount = readNumber(rendered?.charCount) ?? 0;
    const sha256 = readString(rendered?.sha256);
    const sourcePath = readString(readRecordField(entry, "source")?.path);

    return [
      {
        label: "Prompt",
        value: promptId,
        tone: promptId.startsWith("executor.") ? "good" : "neutral",
      },
      {
        label: "Fixture",
        value: fixtureLabel,
      },
      {
        label: "Rendered text",
        value: `${charCount} chars`,
        tone: charCount > 0 ? "good" : "warn",
      },
      {
        label: "Hash",
        value: formatShortSha(sha256),
        tone: sha256 ? "good" : "warn",
      },
      {
        label: "Source",
        value: sourcePath ? formatPathTail(sourcePath) : "Prompt Repository",
      },
    ];
  }

  if (runResult.stage?.id === "controller_project_dry_run") {
    const controllerResult = readRecordField(result, "controllerResult");
    const input = readRecordField(controllerResult, "input");
    const output = readRecordField(controllerResult, "controllerOutput");
    const status = readString(controllerResult?.status) ?? "unknown";
    const trigger = readString(input?.trigger) ?? "unknown";
    const verdict = readString(output?.verdict) ?? "none";
    const planChangeCount = readNumber(output?.planChangeCount) ?? 0;
    const sourceRef = readString(input?.sourceRef);

    return [
      {
        label: "Controller run status",
        value: status,
        tone: status === "completed" ? "good" : "warn",
      },
      {
        label: "Trigger",
        value: trigger.replaceAll("_", " "),
      },
      {
        label: "Verdict",
        value: verdict.replaceAll("_", " "),
        tone: status === "completed" ? "neutral" : "warn",
      },
      {
        label: "Plan changes",
        value: String(planChangeCount),
        tone: planChangeCount > 0 ? "warn" : "neutral",
      },
      {
        label: "Source",
        value: formatShortSha(sourceRef),
        tone: sourceRef ? "good" : "warn",
      },
    ];
  }

  if (runResult.stage?.id === "visual_workbench_manifest_readiness") {
    const manifestReadiness = readRecordField(result, "manifestReadiness");
    const snapshot = readRecordField(result, "snapshot");
    const source = readRecordField(snapshot, "source");
    const workspace = readRecordField(source, "workspace");
    const manifest = readRecordField(manifestReadiness, "manifest");
    const summary = readRecordField(manifest, "summary");
    const status = readString(manifestReadiness?.status) ?? "unknown";
    const storyCount = readNumber(summary?.storyCount) ?? 0;
    const blockerCount = readArray(manifest?.blockers).length;
    const sourceRef = readString(workspace?.commitSha);
    const canCapture = readBoolean(manifestReadiness?.canRunWorkbenchCapture);

    return [
      {
        label: "Manifest status",
        value: status.replaceAll("_", " "),
        tone: status === "ready" ? "good" : status === "blocked" ? "warn" : "neutral",
      },
      {
        label: "Stories",
        value: String(storyCount),
        tone: storyCount > 0 ? "good" : "warn",
      },
      {
        label: "Blockers",
        value: String(blockerCount),
        tone: blockerCount === 0 ? "good" : "warn",
      },
      {
        label: "Capture gate",
        value: canCapture === true ? "source head matches" : canCapture === false ? "not ready" : "unknown",
        tone: canCapture === true ? "good" : "warn",
      },
      {
        label: "Source",
        value: formatShortSha(sourceRef),
        tone: sourceRef ? "good" : "warn",
      },
    ];
  }

  if (runResult.stage?.id === "visual_workbench_selector_readiness") {
    const selector = readRecordField(result, "selectorReadiness");
    const snapshot = readRecordField(result, "snapshot");
    const source = readRecordField(snapshot, "source");
    const workspace = readRecordField(source, "workspace");
    const summary = readRecordField(selector, "summary");
    const status = readString(selector?.status) ?? "unknown";
    const readyTasks = readNumber(summary?.readyTasks) ?? 0;
    const blockedTasks = readNumber(summary?.blockedTasks) ?? 0;
    const selectedViewports = readNumber(summary?.selectedViewports) ?? 0;
    const sourceRef = readString(workspace?.commitSha);

    return [
      {
        label: "Selector status",
        value: status.replaceAll("_", " "),
        tone: status === "ready" ? "good" : status === "blocked" ? "warn" : "neutral",
      },
      {
        label: "Tasks",
        value: `${readyTasks} ready / ${blockedTasks} blocked`,
        tone: blockedTasks === 0 ? "good" : "warn",
      },
      {
        label: "Viewports",
        value: String(selectedViewports),
        tone: selectedViewports > 0 ? "good" : "neutral",
      },
      {
        label: "Source",
        value: formatShortSha(sourceRef),
        tone: sourceRef ? "good" : "warn",
      },
    ];
  }

  if (runResult.stage?.id === "visual_workbench_browser_readiness") {
    const browserReadiness = readRecordField(result, "browserReadiness");
    const status = readString(browserReadiness?.status) ?? "unknown";
    const provider = readString(browserReadiness?.provider) ?? "unknown";
    const executablePath = readString(browserReadiness?.executablePath);
    const blockers = readArray(browserReadiness?.blockers);

    return [
      {
        label: "Browser status",
        value: status.replaceAll("_", " "),
        tone: status === "ready" ? "good" : status === "blocked" ? "warn" : "neutral",
      },
      {
        label: "Provider",
        value: provider,
      },
      {
        label: "Executable",
        value: executablePath ? formatPathTail(executablePath) : "none",
        tone: executablePath ? "good" : "warn",
      },
      {
        label: "Blockers",
        value: String(blockers.length),
        tone: blockers.length === 0 ? "good" : "warn",
      },
    ];
  }

  if (runResult.stage?.id === "visual_workbench_automation_status") {
    const automationStatus = readRecordField(result, "automationStatus");
    const report = readRecordField(automationStatus, "report");
    const sourceFreshness = readRecordField(automationStatus, "sourceFreshness");
    const status = readString(automationStatus?.status) ?? "unknown";
    const reportStatus = readString(report?.status) ?? "none";
    const reportSource = readString(automationStatus?.reportSource) ?? "none";
    const freshness = readString(sourceFreshness?.status) ?? "unknown";
    const blockers = readArray(automationStatus?.blockers);

    return [
      {
        label: "Automation status",
        value: status.replaceAll("_", " "),
        tone: status === "available" ? "good" : status === "missing" ? "warn" : "neutral",
      },
      {
        label: "Report",
        value: reportStatus.replaceAll("_", " "),
        tone: reportStatus === "published" ? "good" : reportStatus === "blocked" || reportStatus === "failed" ? "warn" : "neutral",
      },
      {
        label: "Source",
        value: `${reportSource} / ${freshness.replaceAll("_", " ")}`,
        tone: freshness === "current" ? "good" : freshness === "stale" ? "warn" : "neutral",
      },
      {
        label: "Blockers",
        value: String(blockers.length),
        tone: blockers.length === 0 ? "good" : "warn",
      },
    ];
  }

  if (runResult.stage?.id === "visual_workbench_evidence_chain_readiness") {
    const readiness = readRecordField(result, "evidenceChainReadiness");
    const snapshot = readRecordField(result, "snapshot");
    const source = readRecordField(snapshot, "source");
    const workspace = readRecordField(source, "workspace");
    const status = readString(readiness?.status) ?? "unknown";
    const checks = readArray(readiness?.checks);
    const blockedChecks = checks.filter((item) => readString(asRecord(item)?.status) === "blocked").length;
    const nextCommands = readArray(readiness?.nextCommands);
    const sourceRef = readString(workspace?.commitSha);

    return [
      {
        label: "Chain status",
        value: status.replaceAll("_", " "),
        tone: status === "blocked" ? "warn" : status.startsWith("ready_for_") ? "good" : "neutral",
      },
      {
        label: "Checks",
        value: `${checks.length - blockedChecks} ok / ${blockedChecks} blocked`,
        tone: blockedChecks === 0 ? "good" : "warn",
      },
      {
        label: "Next handoffs",
        value: String(nextCommands.length),
        tone: nextCommands.length > 0 ? "good" : "neutral",
      },
      {
        label: "Source",
        value: formatShortSha(sourceRef),
        tone: sourceRef ? "good" : "warn",
      },
    ];
  }

  if (runResult.stage?.id === "proof_reviews") {
    const readiness = asRecord(result.visualEvidenceReadiness);
    const counts = asRecord(readiness?.counts);
    const status = readString(readiness?.status);
    const visualReviews = readNumber(counts?.visualEvidenceReviewCount) ?? 0;
    const reviewable = readNumber(counts?.reviewableVisualEvidenceReviewCount) ?? 0;
    const unavailable = readNumber(counts?.unavailableVisualEvidenceArtifactCount) ?? 0;
    const proofReviews = readNumber(counts?.proofReviewCount) ?? 0;
    return [
      {
        label: "Screenshot status",
        value: status === "available" ? `${reviewable} ready to review` : status ?? "not available",
        tone: status === "available" ? "good" : "warn",
      },
      {
        label: "Recorded rows",
        value: `${visualReviews} screenshot / ${proofReviews} proof`,
      },
      {
        label: "Files",
        value: unavailable === 0 ? "No missing screenshot files" : `${unavailable} file missing`,
        tone: unavailable === 0 ? "good" : "warn",
      },
    ];
  }

  if (runResult.stage?.id === "visual_evidence_artifact_check") {
    const artifactCheck = asRecord(result.artifactCheck);
    const status = readString(artifactCheck?.status);
    const reviewCount = readNumber(artifactCheck?.reviewCount) ?? 0;
    const downloadable = readNumber(artifactCheck?.downloadableCount) ?? 0;
    const blocked = readNumber(artifactCheck?.notDownloadableCount) ?? 0;
    return [
      {
        label: "File status",
        value: status === "available" ? `${downloadable} downloadable` : status ?? "not available",
        tone: status === "available" ? "good" : "warn",
      },
      {
        label: "Reviews checked",
        value: String(reviewCount),
      },
      {
        label: "Blocked files",
        value: blocked === 0 ? "None" : String(blocked),
        tone: blocked === 0 ? "good" : "warn",
      },
    ];
  }

  return [];
}

function resultHighlightClasses(tone: ResultHighlight["tone"]): string {
  if (tone === "good") {
    return "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-100";
  }
  if (tone === "warn") {
    return "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100";
  }
  return "border-gray-200 bg-gray-50 text-gray-900 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100";
}

function getPlannerApplyNextHandoff(runResult: LabRunResponse | null): PlannerApplyNextHandoff | null {
  if (!runResult || runResult.error || runResult.stage?.id !== "planner_spec_migration_apply") return null;
  const result = asRecord(runResult.result);
  const plannerResult = readRecordField(result, "plannerResult");
  if (!plannerResult) return null;

  const input = readRecordField(plannerResult, "input");
  const source = readRecordField(plannerResult, "source");
  const applyOutput = readRecordField(plannerResult, "applyOutput");
  const status = readString(plannerResult?.status) ?? "unknown";
  const recordedCount = readNumber(applyOutput?.recordedCount) ?? 0;
  const plannerAppliedCount = readNumber(applyOutput?.plannerAppliedCount) ?? 0;
  const allowedChangedFiles = readStringArray(source?.allowedChangedFiles).length;
  const forbiddenChangedFiles = readStringArray(source?.forbiddenChangedFiles).length;
  const headChanged = readBoolean(source?.headChanged);
  const sourceRef = readString(input?.sourceRef);

  if (status === "completed" && recordedCount > 0 && forbiddenChangedFiles === 0 && headChanged === false) {
    return {
      status,
      title: "Plan tasks were materialized",
      message: "Run Find work next to select a task, or Get task context for a known task. This only selects the next action; it does not run Find work or executor automatically.",
      recordedCount,
      plannerAppliedCount,
      allowedChangedFiles,
      forbiddenChangedFiles,
      headChanged,
      sourceRef,
    };
  }

  if (status === "completed" && recordedCount === 0 && forbiddenChangedFiles === 0) {
    return {
      status,
      title: "No new plan tasks",
      message: "The planner apply owner finished, but no pending spec migration was recorded. Check task context before choosing another action.",
      recordedCount,
      plannerAppliedCount,
      allowedChangedFiles,
      forbiddenChangedFiles,
      headChanged,
      sourceRef,
    };
  }

  return {
    status,
    title: "Planner apply needs attention",
    message: "Inspect the apply report before running another stage. Do not run executor until the plan mutation and forbidden-file checks are understood.",
    recordedCount,
    plannerAppliedCount,
    allowedChangedFiles,
    forbiddenChangedFiles,
    headChanged,
    sourceRef,
  };
}

function canSelectPlannerApplyNextAction(handoff: PlannerApplyNextHandoff): boolean {
  return handoff.status === "completed"
    && handoff.forbiddenChangedFiles === 0
    && handoff.headChanged !== true;
}

function getVisualEvidenceReviewLinks(runResult: LabRunResponse | null): VisualEvidenceReviewLink[] {
  if (!runResult || runResult.error || runResult.stage?.id !== "proof_reviews") return [];
  const result = asRecord(runResult.result);
  return readArray(result?.visualEvidenceReviews).flatMap((item) => {
    const review = asRecord(item);
    const action = readRecordField(review, "action");
    const artifact = readRecordField(review, "artifact");
    const target = readRecordField(review, "target");
    const viewport = readRecordField(target, "viewport");
    const id = readString(review?.id);
    const href = readInternalProjectHref(action?.href);
    if (!id || !href) return [];

    const route = readString(target?.route);
    const width = readNumber(viewport?.width);
    const height = readNumber(viewport?.height);
    const claim = readString(target?.claim);
    const targetParts = [
      route,
      width && height ? `${width}x${height}` : null,
      claim,
    ].filter(Boolean);
    const artifactAvailability = readString(artifact?.availability);
    return [{
      id,
      href,
      label: readString(action?.label) ?? "Open screenshot review",
      taskLabel: readString(review?.taskLabel) ?? id,
      status: readString(review?.status) ?? "unknown",
      summary: readString(review?.summary),
      target: targetParts.length > 0 ? targetParts.join(" - ") : null,
      artifactLabel: artifactAvailability === "available" ? "file available" : artifactAvailability ?? "file unknown",
    }];
  });
}

function readInternalProjectHref(value: unknown): string | null {
  const href = readString(value);
  return href?.startsWith("/my/projects/") ? href : null;
}

function getVisualEvidenceArtifactCheckRows(runResult: LabRunResponse | null): VisualEvidenceArtifactCheckRow[] {
  if (!runResult || runResult.error || runResult.stage?.id !== "visual_evidence_artifact_check") return [];
  const result = asRecord(runResult.result);
  return readArray(result?.reviews).flatMap((item) => {
    const review = asRecord(item);
    const download = readRecordField(review, "download");
    const reviewId = readString(review?.reviewId);
    const downloadStatus = readString(download?.status);
    if (!reviewId || !downloadStatus) return [];
    return [{
      reviewId,
      taskLabel: readString(review?.taskLabel) ?? reviewId,
      reviewStatus: readString(review?.status) ?? "unknown",
      downloadStatus,
      reasonCode: readString(download?.reasonCode),
      contentType: readString(download?.contentType),
      sha256: readString(download?.sha256),
      byteLength: readNumber(download?.byteLength),
    }];
  });
}

function getScreenshotReadbackGap(runResult: LabRunResponse | null): ScreenshotReadbackGap | null {
  if (!runResult || runResult.error || runResult.stage?.id !== "proof_reviews") return null;
  if (getVisualEvidenceReviewLinks(runResult).length > 0) return null;

  const result = asRecord(runResult.result);
  const readiness = asRecord(result?.visualEvidenceReadiness);
  const counts = asRecord(readiness?.counts);
  const visualReviews = readArray(result?.visualEvidenceReviews);
  const recordedRows = readNumber(counts?.visualEvidenceReviewCount) ?? visualReviews.length;
  const reviewableRows = readNumber(counts?.reviewableVisualEvidenceReviewCount) ?? 0;
  const status = readString(readiness?.status) ?? "not_available";
  const reasonCode = readString(readiness?.reasonCode) ?? "no_visual_evidence_reviews";
  const message = readString(readiness?.message) ?? (recordedRows > 0
    ? "Arena has screenshot rows, but this readback did not expose a safe review link."
    : "No screenshot reviews are recorded yet.");

  return {
    title: recordedRows > 0 ? "Screenshot rows need attention" : "No screenshot reviews yet",
    message,
    status,
    reasonCode,
    recordedRows,
    reviewableRows,
    nextAction: recordedRows > 0
      ? "Check screenshot files through Arena's artifact owner, then inspect the readback JSON if links are still missing."
      : "Create or ingest task-linked Workbench evidence, then run this screenshot status check again.",
  };
}

function formatByteLength(value: number | null): string {
  if (value === null) return "size unknown";
  if (value < 1024) return `${value} B`;
  const kib = value / 1024;
  if (kib < 1024) return `${kib.toFixed(kib >= 10 ? 0 : 1)} KiB`;
  const mib = kib / 1024;
  return `${mib.toFixed(mib >= 10 ? 0 : 1)} MiB`;
}

function formatShortShaLabel(value: string | null): string {
  if (!value) return "sha unknown";
  return value.length > 19 ? `${value.slice(0, 19)}...` : value;
}

function formatTaskCandidateStatus(status: SnapshotTaskCandidateView["status"]): string {
  if (status === "in_progress") return "In progress";
  return status === "pending" ? "Pending" : "Failed";
}

function formatExecutorMode(mode: SnapshotTaskCandidateView["recommendedExecutorMode"]): string {
  if (mode === "resume_interrupted") return "Resume interrupted";
  return mode === "failed_task" ? "Retry failed task" : "New task";
}

function getExecutorCandidateReadinessNote(mode: SnapshotTaskCandidateView["recommendedExecutorMode"]): string | null {
  if (mode !== "resume_interrupted") return null;
  return "Resume needs Get task context with a matching provider-session checkpoint before executor can run.";
}

function canPrepareExecutorFromSnapshotReadback(
  candidate: Pick<SnapshotTaskCandidateView, "id" | "recommendedExecutorMode">,
  readback: SnapshotExecutorCheckpointReadback | null,
): boolean {
  if (candidate.recommendedExecutorMode !== "resume_interrupted") return true;
  return Boolean(
    readback
    && readback.selectedTaskId === candidate.id
    && readback.recommendedExecutorMode === "resume_interrupted"
    && readback.canPrepareExecutor,
  );
}

function canSelectResumeAgentFromSnapshotReadback(
  candidate: Pick<SnapshotTaskCandidateView, "id" | "recommendedExecutorMode">,
  readback: SnapshotExecutorCheckpointReadback | null,
): boolean {
  return Boolean(
    candidate.recommendedExecutorMode === "resume_interrupted"
    && readback
    && readback.selectedTaskId === candidate.id
    && readback.recommendedExecutorMode === "resume_interrupted"
    && readback.nextProjectActionId === "resume_agent",
  );
}

function canCheckStorySelectionFromSnapshotReadback(
  candidate: Pick<SnapshotTaskCandidateView, "id">,
  readback: SnapshotSelectedTaskVisualReadback | null,
): boolean {
  return Boolean(
    readback
    && readback.selectedTaskId === candidate.id
    && readback.nextProjectActionId === "check_story_selection"
    && readback.canCheckStorySelection,
  );
}

function checkpointReadbackBorderClasses(tone: SnapshotExecutorCheckpointReadback["tone"]): string {
  if (tone === "good") {
    return "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-100";
  }
  if (tone === "warn") {
    return "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100";
  }
  return "border-sky-200 bg-sky-50 text-sky-900 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-100";
}

function formatVisualEvidenceRequirement(value: SnapshotTaskCandidateView["visualEvidenceRequired"]): string {
  if (value === true) return "visual evidence required";
  if (value === false) return "visual evidence not required";
  return "visual evidence not marked";
}

function formatCandidateProjectVisualPolicy(project: CandidateScanProjectView): string {
  const status = project.visualEvidencePolicyStatus;
  if (status === "ready") return `Visual policy: ${formatVisualEvidenceModeLabel(project.visualEvidenceMode)}`;
  return `Visual policy: ${status ?? "Unknown"}`;
}

function formatCandidateProjectStoriesReadiness(project: CandidateScanProjectView): string {
  if (project.visualWorkbenchCanRunCapture === true) return "Stories: ready";
  if (project.visualWorkbenchManifestStatus) return `Stories: ${project.visualWorkbenchManifestStatus}`;
  return "Stories: unknown";
}

function formatCandidateProjectClass(projectClass: string): string {
  return projectClass.replaceAll("_", " ");
}

function candidateProjectStoriesClasses(project: CandidateScanProjectView): string {
  if (project.visualWorkbenchCanRunCapture === true) {
    return "rounded border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 font-semibold text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-100";
  }
  if (project.visualWorkbenchManifestStatus && project.visualWorkbenchManifestStatus !== "ready") {
    return "rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 font-semibold text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100";
  }
  return "rounded border border-gray-200 bg-gray-50 px-1.5 py-0.5 font-semibold text-gray-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300";
}

function normalizeOpsVisualEvidenceMode(value: unknown): OpsVisualEvidenceMode | null {
  if (value === "off" || value === "required" || value === "new_tasks_only") return value;
  return null;
}

function formatVisualEvidenceModeLabel(mode: OpsVisualEvidenceMode | null): string {
  switch (mode) {
    case "off":
      return "Off";
    case "required":
      return "Required";
    case "new_tasks_only":
      return "New tasks only";
    default:
      return "Unknown";
  }
}

function getVisualEvidenceModeHint(mode: OpsVisualEvidenceMode | null, error?: string | null): string {
  if (error) return `Project policy readback is invalid: ${error}`;
  switch (mode) {
    case "off":
      return "Screenshots are not required by project policy.";
    case "required":
      return "Frontend tasks are expected to keep Workbench evidence ready.";
    case "new_tasks_only":
      return "Only newly planned frontend tasks get the visual evidence flag.";
    default:
      return "Project policy is not available in this readback.";
  }
}

export function LabTab({ projects, storyFixture }: LabTabProps) {
  const [stages, setStages] = useState<LabStage[]>([]);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState(projects[0]?.id ?? "");
  const [selectedDebugStageId, setSelectedDebugStageId] = useState("project_operator_snapshot");
  const [selectedProjectActionId, setSelectedProjectActionId] = useState<string | null>("check_project_status");
  const [isRunning, setIsRunning] = useState(false);
  const [runResult, setRunResult] = useState<LabRunResponse | null>(storyFixture?.initialRunResult ?? null);
  const [snapshotTaskId, setSnapshotTaskId] = useState(storyFixture?.selectedTaskId ?? "");
  const [snapshotTail, setSnapshotTail] = useState("80");
  const [candidateLimit, setCandidateLimit] = useState("25");
  const [candidateTail, setCandidateTail] = useState("5");
  const [candidateIncludeArchived, setCandidateIncludeArchived] = useState(false);
  const [executorMode, setExecutorMode] = useState<"new_task" | "failed_task" | "resume_interrupted">("new_task");
  const [executorCompletionPromise, setExecutorCompletionPromise] = useState("Finish only the selected task and stop after the executor result.");
  const [executorAgent, setExecutorAgent] = useState<"claude-code" | "codex" | "opencode">("codex");
  const [executorModel, setExecutorModel] = useState("");
  const [executorTimeout, setExecutorTimeout] = useState("20");
  const [plannerVisualEvidenceMode, setPlannerVisualEvidenceMode] = useState<OpsVisualEvidenceMode>("off");
  const [controllerTrigger, setControllerTrigger] = useState<"phase_complete" | "periodic" | "failure_threshold" | "replan" | "manual" | "final" | "spec_migration">("manual");
  const [promptReplayFixture, setPromptReplayFixture] = useState<"product_skill" | "ux_skill">("product_skill");
  const [commandInputValues, setCommandInputValues] = useState<Record<string, string>>({});
  const [showVisualEvidenceDetails, setShowVisualEvidenceDetails] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function loadStages() {
      setCatalogError(null);
      try {
        const response = await fetch("/api/admin/lab/stages", { cache: "no-store" });
        const payload = await readJsonResponse<StageCatalogResponse>(response, "Lab catalog");
        if (cancelled) return;
        if (!response.ok) {
          setCatalogError(payload.error ?? `Lab catalog returned ${response.status}`);
          return;
        }
        const loadedStages = Array.isArray(payload.stages) ? payload.stages : [];
        setStages(loadedStages);
        setSelectedDebugStageId((current) => {
          if (current && loadedStages.some((stage) => stage.id === current)) return current;
          return loadedStages.find((stage) => stage.id === "project_stage_candidates")?.id
            ?? loadedStages.find((stage) => stage.status === "supported_now")?.id
            ?? loadedStages[0]?.id
            ?? "";
        });
      } catch (error) {
        if (!cancelled) setCatalogError(error instanceof Error ? error.message : String(error));
      }
    }
    void loadStages();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (selectedProjectId && projects.some((project) => project.id === selectedProjectId)) return;
    setSelectedProjectId(projects[0]?.id ?? "");
  }, [projects, selectedProjectId]);

  useEffect(() => {
    if (storyFixture?.initialRunResult) {
      setRunResult(storyFixture.initialRunResult);
      setCommandInputValues({});
      setExecutorModel("");
      return;
    }
    setRunResult(null);
    setCommandInputValues({});
    setExecutorModel("");
  }, [selectedProjectId, storyFixture?.initialRunResult]);

  useEffect(() => {
    if (!storyFixture) return;
    if (storyFixture.selectedDebugStageId) setSelectedDebugStageId(storyFixture.selectedDebugStageId);
    if ("selectedProjectActionId" in storyFixture) {
      setSelectedProjectActionId(storyFixture.selectedProjectActionId ?? null);
    }
    if ("selectedTaskId" in storyFixture) {
      setSnapshotTaskId(storyFixture.selectedTaskId ?? "");
    }
    if ("initialRunResult" in storyFixture) {
      setRunResult(storyFixture.initialRunResult ?? null);
    }
  }, [storyFixture]);

  const selectedDebugStage = useMemo(
    () => stages.find((stage) => stage.id === selectedDebugStageId) ?? null,
    [selectedDebugStageId, stages],
  );
  const selectedProject = useMemo(
    () => projects.find((project) => project.id === selectedProjectId) ?? null,
    [projects, selectedProjectId],
  );
  const selectedProjectVisualEvidenceMode = normalizeOpsVisualEvidenceMode(selectedProject?.visualEvidenceMode ?? null);
  const selectedProjectVisualEvidenceModeError = selectedProject?.visualEvidenceModeError ?? null;

  useEffect(() => {
    const mode = normalizeOpsVisualEvidenceMode(selectedProject?.visualEvidenceMode ?? null);
    if (mode) setPlannerVisualEvidenceMode(mode);
  }, [selectedProject?.visualEvidenceMode]);

  const uiStages = stages.filter((stage) => stage.runSurface === "admin_lab_run" && stage.status === "supported_now");
  const cliStages = stages.filter((stage) => stage.runSurface === "direct_cli" && stage.status === "supported_now");
  const targetStages = stages.filter((stage) => stage.status === "target_shape");
  const stageGroups = [
    { label: "Run here", stages: uiStages },
    { label: "Copy terminal command", stages: cliStages },
    { label: "Planned", stages: targetStages },
  ].filter((group) => group.stages.length > 0);
  const stagesById = new Map(stages.map((stage) => [stage.id, stage]));
  const stageIds = new Set(stagesById.keys());
  const visibleProjectActions: LabProjectActionView[] = ADMIN_LAB_PROJECT_ACTIONS.map((action) => ({
    ...action,
    stage: action.stageId ? stagesById.get(action.stageId) ?? null : null,
  }));
  const firstScreenProjectActions = visibleProjectActions.filter((action) => isProjectActionVisibleOnFirstScreen(action, {
    selectedProjectActionId,
    showVisualEvidenceDetails,
  }));
  const visualEvidenceDetailActionCount = visibleProjectActions.filter((action) => action.group === "Visual evidence" && action.primaryVisibility === "details").length;
  const hiddenVisualEvidenceActionCount = visibleProjectActions.filter((action) => action.group === "Visual evidence"
    && action.primaryVisibility === "details"
    && !isProjectActionVisibleOnFirstScreen(action, { selectedProjectActionId, showVisualEvidenceDetails })).length;
  const projectActionGroups = firstScreenProjectActions.reduce<Array<{ label: AdminLabProjectActionGroup; actions: LabProjectActionView[] }>>(
    (groups, action) => {
      const lastGroup = groups[groups.length - 1];
      if (lastGroup?.label === action.group) {
        lastGroup.actions.push(action);
      } else {
        groups.push({ label: action.group, actions: [action] });
      }
      return groups;
    },
    [],
  );
  const selectedProjectAction = visibleProjectActions.find((action) => action.id === selectedProjectActionId) ?? null;
  const selectedStage = selectedProjectAction ? selectedProjectAction.stage : selectedDebugStage;
  const isCandidateScanStage = selectedStage?.id === "project_stage_candidates";
  const isSnapshotStage = selectedStage?.id === "project_stage_snapshot";
  const isPlannerProjectDryRunStage = selectedStage?.id === "planner_project_dry_run";
  const isPlannerSpecMigrationApplyStage = selectedStage?.id === "planner_spec_migration_apply";
  const isControllerProjectDryRunStage = selectedStage?.id === "controller_project_dry_run";
  const isPromptReplayStage = selectedStage?.id === "prompt_contract_replay";
  const isExecutorProjectTaskStage = selectedStage?.id === "executor_project_task";
  const isManifestReadinessStage = selectedStage?.id === "visual_workbench_manifest_readiness";
  const isSelectorReadinessStage = selectedStage?.id === "visual_workbench_selector_readiness";
  const isShellPolicyStage = selectedStage?.id === "visual_workbench_shell_policy";
  const isAutomationStatusStage = selectedStage?.id === "visual_workbench_automation_status";
  const isEvidenceChainReadinessStage = selectedStage?.id === "visual_workbench_evidence_chain_readiness";
  const isTaskScopedWorkbenchReadbackStage = isSelectorReadinessStage
    || isShellPolicyStage
    || isAutomationStatusStage
    || isEvidenceChainReadinessStage;
  const isProviderBackedStage = isExecutorProjectTaskStage || isPlannerProjectDryRunStage || isPlannerSpecMigrationApplyStage || isControllerProjectDryRunStage;
  const selectedProjectLabAgent = normalizeLabExecutorAgent(selectedProject?.agent);
  const selectedProjectModel = selectedProject?.model?.trim() ?? "";
  const canUseProjectProviderSettings = Boolean(selectedProjectLabAgent && selectedProjectModel);
  const normalizedCandidateLimit = normalizeCandidateLimit(candidateLimit);
  const normalizedCandidateTail = normalizeCandidateTail(candidateTail);
  const isCandidateLimitInvalid = Boolean(isCandidateScanStage && candidateLimit.trim() && normalizedCandidateLimit !== candidateLimit.trim());
  const isCandidateTailInvalid = Boolean(isCandidateScanStage && candidateTail.trim() && normalizedCandidateTail !== candidateTail.trim());
  const isSnapshotTaskIdInvalid = Boolean((isSnapshotStage || isTaskScopedWorkbenchReadbackStage) && snapshotTaskId.trim() && !normalizeTaskId(snapshotTaskId));
  const normalizedSnapshotTail = normalizeTail(snapshotTail);
  const isSnapshotTailInvalid = Boolean((isSnapshotStage || isPlannerSpecMigrationApplyStage || isManifestReadinessStage || isTaskScopedWorkbenchReadbackStage) && snapshotTail.trim() && normalizedSnapshotTail !== snapshotTail.trim());
  const normalizedExecutorTimeout = normalizeRequiredBoundedInteger(executorTimeout, 60);
  const isExecutorTaskIdInvalid = Boolean(isExecutorProjectTaskStage && !normalizeTaskId(snapshotTaskId));
  const isSelectorTaskIdInvalid = Boolean(isSelectorReadinessStage && !normalizeTaskId(snapshotTaskId));
  const isShellPolicyTaskIdInvalid = Boolean(isShellPolicyStage && !normalizeTaskId(snapshotTaskId));
  const isAutomationStatusTaskIdInvalid = Boolean(isAutomationStatusStage && !normalizeTaskId(snapshotTaskId));
  const isEvidenceChainTaskIdInvalid = Boolean(isEvidenceChainReadinessStage && !normalizeTaskId(snapshotTaskId));
  const isExecutorCompletionPromiseInvalid = Boolean(isExecutorProjectTaskStage && !executorCompletionPromise.trim());
  const isProviderModelInvalid = Boolean((isExecutorProjectTaskStage || isPlannerProjectDryRunStage || isPlannerSpecMigrationApplyStage || isControllerProjectDryRunStage) && !executorModel.trim());
  const isProviderTimeoutInvalid = Boolean((isExecutorProjectTaskStage || isPlannerProjectDryRunStage || isPlannerSpecMigrationApplyStage || isControllerProjectDryRunStage) && !normalizedExecutorTimeout);
  const isProjectVisualEvidenceModeUnavailable = Boolean(
    (isPlannerProjectDryRunStage || isControllerProjectDryRunStage)
    && !selectedProjectVisualEvidenceMode,
  );
  const canRun = Boolean(
    selectedProject
    && selectedStage?.status === "supported_now"
    && selectedStage.runSurface === "admin_lab_run"
    && !isCandidateLimitInvalid
    && !isCandidateTailInvalid
    && !isSnapshotTaskIdInvalid
    && !isSnapshotTailInvalid
    && !isExecutorTaskIdInvalid
    && !isSelectorTaskIdInvalid
    && !isShellPolicyTaskIdInvalid
    && !isAutomationStatusTaskIdInvalid
    && !isEvidenceChainTaskIdInvalid
    && !isExecutorCompletionPromiseInvalid
    && !isProviderModelInvalid
    && !isProviderTimeoutInvalid
    && !isProjectVisualEvidenceModeUnavailable
    && !isRunning,
  );
  const commandTemplate = selectedStage?.currentCommand
    ? renderCommandTemplate(selectedStage.currentCommand, {
      stageId: selectedStage.id,
      projectId: selectedProject?.id,
      taskId: selectedStage.id === "project_stage_snapshot" ? snapshotTaskId : undefined,
      tail: selectedStage.id === "project_stage_snapshot" ? snapshotTail : undefined,
    })
    : null;
  const commandInputPlaceholders = commandTemplate ? getCommandPlaceholders(commandTemplate) : [];
  const commandPlaceholderCompletion = commandTemplate
    ? getCommandPlaceholderCompletion(commandTemplate, commandInputValues)
    : { filled: [], missing: [] };
  const renderedCommand = commandTemplate
    ? applyCommandPlaceholderValues(commandTemplate, commandInputValues)
    : null;
  const renderedCommandPlaceholders = renderedCommand ? getCommandPlaceholders(renderedCommand) : [];
  const hasRenderedCommandPlaceholders = renderedCommandPlaceholders.length > 0;
  const canCopyCommand = Boolean(
    selectedProject
    && selectedStage?.status === "supported_now"
    && selectedStage.runSurface === "direct_cli"
    && renderedCommand
    && !isSnapshotTaskIdInvalid
    && !isSnapshotTailInvalid,
  );
  const selectedStageCopy = getStageCopy(selectedStage);
  const selectedActionTitle = selectedProjectAction?.title ?? selectedStageCopy.title;
  const selectedActionSummary = selectedProjectAction
    ? `${selectedProjectAction.note} ${selectedProjectAction.output}`
    : selectedStageCopy.summary;
  const selectedActionRunKind = getActionRunKind(selectedStage);
  const selectedActionContext = selectedProjectAction?.context ?? selectedStageCopy.reads;
  const selectedActionArgument = selectedProjectAction?.argument ?? "Explicit stage inputs only.";
  const selectedActionOutput = selectedProjectAction?.output ?? selectedStageCopy.resultSummary;
  const selectedActionBrickStatus = selectedProjectAction?.brickStatus ?? {
    label: selectedStage?.runSurface === "direct_cli"
      ? "CLI handoff"
      : selectedStage?.runSurface === "target_shape"
        ? "Target shape"
        : "Stage catalog",
    detail: "Raw stage selection; normal work should start from Project actions.",
  };
  const selectedActionPanelLabel = selectedProjectAction ? "Selected action" : "Debug stage";
  const selectedActionNeeds = [
    !selectedProject ? "project" : null,
    !selectedStage ? "action" : null,
    selectedStage && selectedStage.status !== "supported_now" ? "supported owner" : null,
    isCandidateLimitInvalid ? "valid candidate limit" : null,
    isCandidateTailInvalid ? "valid candidate log tail" : null,
    isSnapshotTaskIdInvalid ? "valid task id" : null,
    isSnapshotTailInvalid ? "valid log tail" : null,
    isExecutorTaskIdInvalid ? "task id" : null,
    isSelectorTaskIdInvalid ? "task id" : null,
    isShellPolicyTaskIdInvalid ? "task id" : null,
    isAutomationStatusTaskIdInvalid ? "task id" : null,
    isEvidenceChainTaskIdInvalid ? "task id" : null,
    isExecutorCompletionPromiseInvalid ? "completion promise" : null,
    isProviderModelInvalid ? "model" : null,
    isProviderTimeoutInvalid ? "valid timeout" : null,
    isProjectVisualEvidenceModeUnavailable ? "project visual evidence mode" : null,
  ].filter((item): item is string => Boolean(item));
  const selectedActionReadiness: LabActionReadiness = (() => {
    if (!selectedStage || selectedStage.status !== "supported_now") {
      return {
        label: "Not runnable",
        helper: "Pick a supported action or inspect the planned target shape.",
        needs: selectedActionNeeds,
        tone: "planned",
      };
    }
    if (selectedStage.runSurface === "direct_cli") {
      const commandNeeds = [
        ...selectedActionNeeds,
        !renderedCommand ? "command" : null,
        ...(
          hasRenderedCommandPlaceholders
            ? renderedCommandPlaceholders.map(formatCommandPlaceholderLabel)
            : []
        ),
      ].filter((item): item is string => Boolean(item));
      if (!canCopyCommand) {
        return {
          label: "Needs input",
          helper: "Fill the command/project values before copying this handoff.",
          needs: commandNeeds.length > 0 ? commandNeeds : ["valid command"],
          tone: "needs",
        };
      }
      return {
        label: hasRenderedCommandPlaceholders ? "Template ready" : "Ready to copy",
        helper: hasRenderedCommandPlaceholders
          ? "Copy the command template; terminal placeholders stay manual."
          : "Copy the exact handoff command and run it manually in the operator shell.",
        needs: commandNeeds,
        needsLabel: hasRenderedCommandPlaceholders ? "Terminal values" : undefined,
        tone: "copy",
      };
    }
    if (canRun) {
      return {
        label: selectedStage.mode === "workspace_mutation" ? "Ready to run" : "Ready to check",
        helper: "All required inputs for this one action are filled.",
        needs: [],
        tone: "ready",
      };
    }
    return {
      label: "Needs input",
      helper: "Fill only the fields below. Nothing starts automatically.",
      needs: selectedActionNeeds.length > 0 ? selectedActionNeeds : ["valid inputs"],
      tone: "needs",
    };
  })();
  const selectedActionClickDoes = getSelectedActionClickDoes(
    selectedProjectAction,
    selectedStage,
    selectedActionRunKind,
  );
  const primaryButtonLabel = getPrimaryButtonLabel(
    selectedProjectAction,
    selectedStage,
    hasRenderedCommandPlaceholders,
  );
  const selectedPromptReplayFixture = selectedProjectAction?.promptReplayFixture ?? promptReplayFixture;
  const promptReplayFixturePinnedByAction = Boolean(selectedProjectAction?.promptReplayFixture);
  const resultStageCopy = getStageCopy(runResult?.stage ?? selectedStage);
  const resultOriginLabel = runResult ? getRunResultOriginLabel(runResult, visibleProjectActions) : null;
  const resultHighlights = runResult ? getResultHighlights(runResult) : [];
  const plannerApplyNextHandoff = getPlannerApplyNextHandoff(runResult);
  const executorResultSummary = getExecutorResultSummary(runResult);
  const executorObserverReadback = getExecutorObserverReadback(runResult);
  const executorVisualWorkbenchHandoff = getExecutorVisualWorkbenchHandoff(runResult);
  const selectorCapturePolicyHandoff = getSelectorCapturePolicyHandoff(runResult);
  const shellPolicyBrowserReadinessHandoff = getShellPolicyBrowserReadinessHandoff(runResult);
  const browserReadinessScreenshotHandoff = getBrowserReadinessScreenshotHandoff(runResult);
  const evidenceChainManualHandoff = getEvidenceChainManualHandoff(runResult);
  const screenshotCatalogReadback = getScreenshotCatalogReadback(runResult);
  const screenshotCatalogFileUrl = getLocalFileUrl(screenshotCatalogReadback?.viewerPath);
  const visualEvidenceReviewLinks = getVisualEvidenceReviewLinks(runResult);
  const visualEvidenceArtifactCheckRows = getVisualEvidenceArtifactCheckRows(runResult);
  const screenshotReadbackGap = getScreenshotReadbackGap(runResult);
  const snapshotTaskCandidates = runResult && isSnapshotRunResult(runResult)
    ? getSnapshotTaskCandidates(runResult.result)
    : [];
  const snapshotExecutorCheckpointReadback = runResult && isSnapshotRunResult(runResult)
    ? getSnapshotExecutorCheckpointReadback(runResult.result)
    : null;
  const snapshotSelectedTaskVisualReadback = runResult && isSnapshotRunResult(runResult)
    ? getSnapshotSelectedTaskVisualReadback(runResult.result)
    : null;
  const candidateScanProjects = runResult && isCandidateScanRunResult(runResult)
    ? getCandidateScanProjects(runResult.result)
    : [];
  const candidateScanNotice = runResult && isCandidateScanRunResult(runResult)
    ? getCandidateScanOperatorNotice(runResult.result)
    : null;
  const snapshotNextHandoff = runResult && isSnapshotRunResult(runResult)
    ? getSnapshotNextHandoff(runResult.result)
    : [];
  const currentProjectSnapshotResult = runResult
    && selectedProject
    && isSnapshotRunResult(runResult)
    && getRunResultProjectId(runResult) === selectedProject.id;
  const snapshotSuggestedFilePath = runResult && isSnapshotRunResult(runResult)
    ? getSnapshotSuggestedFilePath(runResult)
    : null;
  const snapshotCommandInputHints: Record<string, string> = currentProjectSnapshotResult
    ? {
        ...getSnapshotCommandInputHints(runResult.result),
        ...(snapshotSuggestedFilePath ? { "<project-stage-snapshot.json>": snapshotSuggestedFilePath } : {}),
      }
    : {};
  const hasSnapshotCommandInputHints = Object.keys(snapshotCommandInputHints).length > 0;
  const commandInputPlaceholdersWithSnapshotHints = commandInputPlaceholders.filter((placeholder) =>
    Boolean(snapshotCommandInputHints[placeholder]),
  );
  const hasCommandInputPlaceholdersWithSnapshotHints = commandInputPlaceholdersWithSnapshotHints.length > 0;
  const snapshotFilledCommandInputPlaceholders = commandPlaceholderCompletion.filled.filter((placeholder) =>
    snapshotCommandInputHints[placeholder]
    && commandInputValues[placeholder]?.trim() === snapshotCommandInputHints[placeholder],
  );
  const manualFilledCommandInputCount = commandPlaceholderCompletion.filled.length
    - snapshotFilledCommandInputPlaceholders.length;

  async function handlePrimaryAction() {
    if (!selectedProject || !selectedStage) return;
    if (selectedStage.runSurface === "direct_cli") {
      if (!canCopyCommand || !renderedCommand) return;
      try {
        await navigator.clipboard.writeText(renderedCommand);
        toast.success(hasRenderedCommandPlaceholders ? "Command template copied" : "Command copied");
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        toast.error(`Copy failed: ${message}`);
      }
      return;
    }
    if (selectedStage.id === "visual_workbench_evidence_automation_run") {
      const taskId = normalizeTaskId(snapshotTaskId);
      if (!taskId) {
        toast.error("Select a valid task id before running screenshot capture.");
        return;
      }
      if (!window.confirm(`Run Workbench screenshot capture for ${taskId}? This can write visual evidence/progress files, but will not ingest proof or start the next stage.`)) {
        return;
      }
    }
    setIsRunning(true);
    setRunResult(null);
    const invocationInput = selectedProjectAction
      ? { actionId: selectedProjectAction.id }
      : { stageId: selectedStage.id };
    try {
      const response = await fetch("/api/admin/lab/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          projectId: selectedProject.id,
          ...invocationInput,
          ...(selectedStage.id === "project_stage_candidates"
            ? {
                limit: Number(normalizedCandidateLimit),
                tail: Number(normalizedCandidateTail),
                includeArchived: candidateIncludeArchived,
              }
            : {}),
          ...(selectedStage.id === "project_stage_snapshot"
            ? {
                ...(normalizeTaskId(snapshotTaskId) ? { taskId: normalizeTaskId(snapshotTaskId) } : {}),
                tail: Number(normalizedSnapshotTail),
              }
            : {}),
          ...(selectedStage.id === "prompt_contract_replay"
            ? {
                promptReplayFixture: selectedPromptReplayFixture,
              }
            : {}),
          ...(selectedStage.id === "visual_workbench_manifest_readiness"
            ? {
                tail: Number(normalizedSnapshotTail),
              }
            : {}),
          ...(selectedStage.id === "executor_project_task"
            ? {
                taskId: normalizeTaskId(snapshotTaskId),
                executorMode,
                completionPromise: executorCompletionPromise.trim(),
                agent: executorAgent,
                model: executorModel.trim(),
                timeoutMinutes: Number(normalizedExecutorTimeout),
              }
            : {}),
          ...(selectedStage.id === "planner_project_dry_run"
            ? {
                visualEvidenceMode: plannerVisualEvidenceMode,
                agent: executorAgent,
                model: executorModel.trim(),
                timeoutMinutes: Number(normalizedExecutorTimeout),
                tail: Number(normalizedSnapshotTail),
              }
            : {}),
          ...(selectedStage.id === "planner_spec_migration_apply"
            ? {
                agent: executorAgent,
                model: executorModel.trim(),
                timeoutMinutes: Number(normalizedExecutorTimeout),
                tail: Number(normalizedSnapshotTail),
              }
            : {}),
          ...(selectedStage.id === "controller_project_dry_run"
            ? {
                controllerTrigger,
                visualEvidenceMode: plannerVisualEvidenceMode,
                agent: executorAgent,
                model: executorModel.trim(),
                timeoutMinutes: Number(normalizedExecutorTimeout),
                tail: Number(normalizedSnapshotTail),
              }
            : {}),
          ...(selectedStage.id === "visual_workbench_selector_readiness"
            ? {
                taskId: normalizeTaskId(snapshotTaskId),
                tail: Number(normalizedSnapshotTail),
              }
            : {}),
          ...(selectedStage.id === "visual_workbench_shell_policy"
            ? {
                taskId: normalizeTaskId(snapshotTaskId),
                tail: Number(normalizedSnapshotTail),
              }
            : {}),
          ...(selectedStage.id === "visual_workbench_automation_status"
            ? {
                taskId: normalizeTaskId(snapshotTaskId),
                tail: Number(normalizedSnapshotTail),
              }
            : {}),
          ...(selectedStage.id === "visual_workbench_evidence_chain_readiness"
            ? {
                taskId: normalizeTaskId(snapshotTaskId),
                tail: Number(normalizedSnapshotTail),
              }
            : {}),
          ...(selectedStage.id === "visual_workbench_evidence_automation_run"
            ? {
                taskId: normalizeTaskId(snapshotTaskId),
                tail: Number(normalizedSnapshotTail),
                confirmed: true,
              }
            : {}),
        }),
      });
      const payload = await readJsonResponse<LabRunResponse>(response, selectedProjectAction?.title ?? selectedStage.label);
      if (!response.ok) {
        const message = formatLabActionError(payload.error ?? `Check returned ${response.status}`);
        setRunResult({ ...payload, error: message });
        toast.error(message);
        return;
      }
      setRunResult(payload);
      toast.success(selectedStage.mode === "workspace_mutation" ? "Run completed" : "Check completed");
    } catch (error) {
      const rawMessage = error instanceof Error ? error.message : String(error);
      const message = formatLabActionError(rawMessage);
      setRunResult({ error: message });
      toast.error(message);
    } finally {
      setIsRunning(false);
    }
  }

  function updateCommandInputValue(placeholder: string, value: string) {
    setCommandInputValues((current) => ({
      ...current,
      [placeholder]: value,
    }));
  }

  function handleApplySnapshotCommandHints() {
    if (!hasSnapshotCommandInputHints) return;
    setCommandInputValues((current) => ({
      ...current,
      ...snapshotCommandInputHints,
    }));
    toast.success("Task context command hints filled");
  }

  function handleUseProjectProviderSettings() {
    if (!selectedProjectLabAgent || !selectedProjectModel) return;
    setExecutorAgent(selectedProjectLabAgent);
    setExecutorModel(selectedProjectModel);
    toast.success("Project provider settings filled");
  }

  function handleUsePlannerApplyFindWorkHandoff(_handoff: PlannerApplyNextHandoff) {
    setSelectedProjectActionId("find_work");
    toast.success("Find work selected. Run it manually to read current task candidates.");
  }

  function handleUsePlannerApplyTaskContextHandoff(_handoff: PlannerApplyNextHandoff) {
    setSelectedProjectActionId("get_task_context");
    toast.success("Get task context selected. Run it manually before executor or visual checks.");
  }

  function handleUseExecutorVisualWorkbenchHandoff(handoff: ExecutorVisualWorkbenchHandoff) {
    if (handoff.status !== "ready_for_selector_readiness" || !handoff.nextStageId) return;
    setSelectedProjectActionId("check_story_selection");
    setShowVisualEvidenceDetails(true);
    if (handoff.taskId) setSnapshotTaskId(handoff.taskId);
    setCommandInputValues((current) => ({
      ...current,
      ...handoff.commandInputValues,
    }));
    toast.success("Selector readiness selected. Check it before any screenshot capture.");
  }

  function handleUseVisualEvidenceIngestHandoff() {
    if (!stages.some((stage) => stage.id === "visual_evidence_ingest")) return;
    setSelectedProjectActionId("ingest_evidence");
    setShowVisualEvidenceDetails(true);
    toast.success("Visual evidence ingest handoff selected. Fill the explicit command values, then copy it manually.");
  }

  function handleUseVisualEvidenceArtifactCheck() {
    if (!stages.some((stage) => stage.id === "visual_evidence_artifact_check")) return;
    setSelectedProjectActionId("check_screenshot_files");
    setShowVisualEvidenceDetails(true);
    toast.success("Screenshot file check selected. Run it to read downloadability through Arena's artifact owner.");
  }

  function handleUseSnapshotTaskCandidate(
    taskId: string,
    mode?: "new_task" | "failed_task" | "resume_interrupted",
  ) {
    setSelectedProjectActionId("get_task_context");
    setSnapshotTaskId(taskId);
    if (mode) setExecutorMode(mode);
    toast.success("Task id filled. Run Get task context for this task.");
  }

  function handleUseExecutorTaskCandidate(
    taskId: string,
    mode?: "new_task" | "failed_task" | "resume_interrupted",
  ) {
    if (
      mode === "resume_interrupted"
      && (!snapshotExecutorCheckpointReadback
        || snapshotExecutorCheckpointReadback.selectedTaskId !== taskId
        || !snapshotExecutorCheckpointReadback.canPrepareExecutor)
    ) {
      setSelectedProjectActionId("get_task_context");
      setSnapshotTaskId(taskId);
      setExecutorMode(mode);
      toast.info("Run Get task context first. Resume needs checkpoint readback before executor input is prepared.");
      return;
    }
    setSelectedProjectActionId("executor_task");
    setSnapshotTaskId(taskId);
    if (mode) setExecutorMode(mode);
    toast.success("Executor action selected. Review inputs, then run it manually.");
  }

  function handleUseCheckpointResumeAgentHandoff() {
    setSelectedProjectActionId("resume_agent");
    toast.success("Resume agent selected. Run it manually to continue through normal Ralph claim.");
  }

  function handleUseSelectedTaskVisualReadback(readback: SnapshotSelectedTaskVisualReadback) {
    if (!readback.canCheckStorySelection || readback.nextProjectActionId !== "check_story_selection" || !readback.selectedTaskId) return;
    setSelectedProjectActionId("check_story_selection");
    setShowVisualEvidenceDetails(true);
    setSnapshotTaskId(readback.selectedTaskId);
    toast.success("Story selection check selected. Review task id, then run it manually.");
  }

  function handleUseSelectorCapturePolicyHandoff(handoff: SelectorCapturePolicyHandoff) {
    setSelectedProjectActionId("check_capture_policy");
    setShowVisualEvidenceDetails(true);
    setSnapshotTaskId(handoff.taskId);
    toast.success("Capture policy check selected. Review task id, then run it manually.");
  }

  function handleUseShellPolicyBrowserReadinessHandoff(_handoff: ShellPolicyBrowserReadinessHandoff) {
    setSelectedProjectActionId("check_browser");
    setShowVisualEvidenceDetails(true);
    toast.success("Browser readiness check selected. Run it manually before screenshot capture.");
  }

  function handleUseBrowserReadinessScreenshotHandoff(_handoff: BrowserReadinessScreenshotHandoff) {
    setSelectedProjectActionId("make_screenshots");
    setShowVisualEvidenceDetails(true);
    toast.success("Screenshot handoff selected. Fill terminal values, then copy the command manually.");
  }

  function handleSelectProjectAction(action: LabProjectAction & { stage: LabStage | null }) {
    if (!action.stage) return;
    setSelectedProjectActionId(action.id);
    if (action.promptReplayFixture) {
      setPromptReplayFixture(action.promptReplayFixture);
    }
    if (action.commandInputValues) {
      setCommandInputValues((current) => ({
        ...current,
        ...action.commandInputValues,
      }));
    }
  }

  function handleUseCandidateScanTask(
    projectId: string,
    taskId: string,
    mode?: "new_task" | "failed_task" | "resume_interrupted",
  ) {
    setSelectedProjectId(projectId);
    setSelectedProjectActionId("get_task_context");
    setSnapshotTaskId(taskId);
    if (mode) setExecutorMode(mode);
    toast.success("Project and task filled. Run Get task context for this task.");
  }

  function handleUseCandidateScanExecutorTask(
    projectId: string,
    taskId: string,
    mode?: "new_task" | "failed_task" | "resume_interrupted",
  ) {
    setSelectedProjectId(projectId);
    handleUseExecutorTaskCandidate(taskId, mode);
  }

  function handleUseCandidateScanVisualTaskContext(projectId: string, taskId: string) {
    setSelectedProjectId(projectId);
    setSelectedProjectActionId("get_task_context");
    setSnapshotTaskId(taskId);
    toast.success("Project and task filled. Run Get task context to read visual handoff readiness.");
  }

  async function handleCopyRunResult() {
    if (!runResult) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(getCopyableResultPayload(runResult), null, 2));
      toast.success(runResult.stage?.id === "project_stage_snapshot" && !runResult.error
        ? "Task context JSON copied"
        : "Result JSON copied");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      toast.error(`Copy failed: ${message}`);
    }
  }

  async function handleCopyEvidenceChainCommand(command: string) {
    try {
      await navigator.clipboard.writeText(command);
      toast.success("Manual handoff command copied");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      toast.error(`Copy failed: ${message}`);
    }
  }

  async function handleCopyEvidenceChainViewerPath(viewerPath: string) {
    try {
      await navigator.clipboard.writeText(viewerPath);
      toast.success("Screenshot catalog path copied");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      toast.error(`Copy failed: ${message}`);
    }
  }

  async function handleCopyEvidenceChainViewerUrl(viewerPath: string) {
    const viewerUrl = getLocalFileUrl(viewerPath);
    if (!viewerUrl) {
      toast.error("Screenshot catalog file URL is unavailable");
      return;
    }
    try {
      await navigator.clipboard.writeText(viewerUrl);
      toast.success("Screenshot catalog file URL copied");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      toast.error(`Copy failed: ${message}`);
    }
  }

  async function handleCopySnapshotPath() {
    if (!snapshotSuggestedFilePath) return;
    try {
      await navigator.clipboard.writeText(snapshotSuggestedFilePath);
      toast.success("Task context path copied");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      toast.error(`Copy failed: ${message}`);
    }
  }

  function handleDownloadSnapshot() {
    if (!runResult || !isSnapshotRunResult(runResult)) return;
    try {
      const blob = new Blob([`${JSON.stringify(runResult.result, null, 2)}\n`], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = getSnapshotDownloadFilename(runResult);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
      toast.success("Task context JSON downloaded");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      toast.error(`Download failed: ${message}`);
    }
  }

  function renderTerminalCommandPanel(surface: "primary" | "advanced") {
    if (!renderedCommand) return null;
    const isPrimaryHandoff = surface === "primary";
    return (
      <div className="mt-4 rounded-md border border-gray-200 bg-gray-50 p-3 text-xs dark:border-slate-800 dark:bg-slate-900/70">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">
              {isPrimaryHandoff
                ? "Terminal handoff"
                : hasRenderedCommandPlaceholders ? "Terminal command template" : "Terminal command"}
            </div>
            <p className="mt-1 text-gray-600 dark:text-slate-300">
              {isPrimaryHandoff
                ? "Fill terminal values here or copy the template. This browser button does not execute CLI stages."
                : hasRenderedCommandPlaceholders
                  ? "Replace every placeholder before running. This browser button copies the template and does not execute terminal stages."
                  : "Copy this command and run it from the operator shell. This browser button does not execute terminal stages."}
            </p>
          </div>
          <button
            type="button"
            onClick={handlePrimaryAction}
            disabled={!canCopyCommand}
            className="inline-flex h-8 items-center gap-1 rounded-md border border-gray-300 bg-white px-2 text-xs font-semibold text-gray-700 transition hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200 dark:hover:bg-slate-900"
          >
            <Clipboard className="h-3.5 w-3.5" aria-hidden="true" />
            {hasRenderedCommandPlaceholders ? "Copy template" : "Copy"}
          </button>
        </div>
        {commandInputPlaceholders.length > 0 && (
          <>
            {isPrimaryHandoff && hasCommandInputPlaceholdersWithSnapshotHints && (
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-200">
                <span>
                  Current task context can fill {commandInputPlaceholdersWithSnapshotHints.map(formatCommandPlaceholderLabel).join(", ")}.
                </span>
                <button
                  type="button"
                  onClick={handleApplySnapshotCommandHints}
                  className="inline-flex h-7 items-center gap-1 rounded-md border border-emerald-300 bg-white px-2 text-[11px] font-semibold text-emerald-800 transition hover:bg-emerald-50 dark:border-emerald-500/40 dark:bg-slate-950 dark:text-emerald-100 dark:hover:bg-slate-900"
                >
                  <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                  Use context values
                </button>
              </div>
            )}
            <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {commandInputPlaceholders.map((placeholder) => (
                <label key={placeholder} className="block">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">
                    {formatCommandPlaceholderLabel(placeholder)}
                  </span>
                  <input
                    value={commandInputValues[placeholder] ?? ""}
                    onChange={(event) => updateCommandInputValue(placeholder, event.target.value)}
                    placeholder={placeholder}
                    className="mt-1 h-8 w-full rounded-md border border-gray-300 bg-white px-2 text-xs text-gray-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  />
                </label>
              ))}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px]">
              <span className={`rounded border px-1.5 py-0.5 ${
                commandPlaceholderCompletion.missing.length === 0
                  ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-200"
                  : "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200"
              }`}
              >
                {commandPlaceholderCompletion.missing.length === 0
                  ? "All values filled"
                  : `${commandPlaceholderCompletion.missing.length} values still needed`}
              </span>
              {snapshotFilledCommandInputPlaceholders.length > 0 && (
                <span className="rounded border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-200">
                  From snapshot: {snapshotFilledCommandInputPlaceholders.map(formatCommandPlaceholderLabel).join(", ")}
                </span>
              )}
              {manualFilledCommandInputCount > 0 && (
                <span className="rounded border border-gray-200 bg-white px-1.5 py-0.5 text-gray-600 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300">
                  Manual values: {manualFilledCommandInputCount}
                </span>
              )}
            </div>
          </>
        )}
        {hasRenderedCommandPlaceholders && (
          <div className="mt-2 flex flex-wrap gap-1">
            {renderedCommandPlaceholders.map((placeholder) => (
              <span
                key={placeholder}
                className="mono rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[11px] text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200"
              >
                {placeholder}
              </span>
            ))}
          </div>
        )}
        <pre className="mt-2 overflow-auto whitespace-pre-wrap break-words text-gray-800 dark:text-slate-100">
          {renderedCommand}
        </pre>
      </div>
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-6">
      <div className="mx-auto flex max-w-6xl flex-col gap-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-gray-900 dark:text-slate-100">
              Laboratory
            </h2>
            <p className="mt-1 max-w-2xl text-xs text-gray-500 dark:text-slate-400">
              Pick one project, choose one action, inspect one result. CLI handoffs stay explicit.
            </p>
          </div>
          <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-200">
            one project -&gt; one action -&gt; one result
          </div>
        </div>

        {catalogError && (
          <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-200">
            {catalogError}
          </div>
        )}

        <section className="rounded-lg border border-gray-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-950">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-gray-900 dark:text-slate-100">
                Project state
              </h3>
              <p className="mt-1 max-w-2xl text-xs text-gray-500 dark:text-slate-400">
                Choose the repository/project state first. Actions below will read from or hand off from this selection.
              </p>
            </div>
            {selectedProject && (
              <span className="mono rounded-full border border-gray-200 px-2 py-1 text-[11px] font-semibold text-gray-500 dark:border-slate-700 dark:text-slate-300">
                {shortProjectId(selectedProject.id)}
              </span>
            )}
          </div>
          <label className="mt-3 block">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">
              Project
            </span>
            <select
              value={selectedProjectId}
              onChange={(event) => setSelectedProjectId(event.target.value)}
              className="mt-1 h-10 w-full rounded-md border border-gray-300 bg-white px-3 text-sm text-gray-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            >
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {getProjectName(project)} - {shortProjectId(project.id)}
                </option>
              ))}
            </select>
          </label>
          {selectedProject && (
            <div className="mt-3 grid gap-2 rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-xs dark:border-slate-800 dark:bg-slate-900/70 sm:grid-cols-[12rem_minmax(0,1fr)]">
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 dark:text-slate-500">
                  Visual evidence mode
                </div>
                <div className="mt-1 font-semibold text-gray-800 dark:text-slate-100">
                  {formatVisualEvidenceModeLabel(selectedProjectVisualEvidenceMode)}
                </div>
              </div>
              <div className="text-gray-600 dark:text-slate-300">
                <div>
                  {getVisualEvidenceModeHint(selectedProjectVisualEvidenceMode, selectedProjectVisualEvidenceModeError)}
                </div>
                <div className="mt-1 text-gray-500 dark:text-slate-400">
                  Planner and controller dry-runs start from this visible project policy; changing the field below affects only that manual run.
                </div>
              </div>
            </div>
          )}
        </section>

        <section className="rounded-lg border border-gray-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-950">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-gray-900 dark:text-slate-100">
                Project actions
              </h3>
              <p className="mt-1 max-w-2xl text-xs text-gray-500 dark:text-slate-400">
                Start from the selected project state, choose one action, then inspect the result before the next step.
              </p>
            </div>
            <span className="rounded-full border border-gray-200 px-2 py-1 text-[11px] font-semibold text-gray-500 dark:border-slate-700 dark:text-slate-300">
              one action only
            </span>
          </div>
          <div className="mt-3 space-y-4">
            {projectActionGroups.map((group) => (
              <div key={group.label}>
                <div className="flex items-center justify-between gap-2">
                  <h4 className="text-xs font-semibold text-gray-700 dark:text-slate-200">
                    {group.label}
                  </h4>
                  <span className="flex items-center gap-2">
                    {group.label === "Visual evidence" && visualEvidenceDetailActionCount > 0 && (
                      <button
                        type="button"
                        onClick={() => setShowVisualEvidenceDetails((value) => !value)}
                        className="inline-flex h-7 items-center gap-1 rounded-md border border-gray-200 bg-white px-2 text-[11px] font-semibold text-gray-600 transition hover:bg-gray-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300 dark:hover:bg-slate-900"
                      >
                        {showVisualEvidenceDetails ? (
                          <ChevronUp className="h-3.5 w-3.5" aria-hidden="true" />
                        ) : (
                          <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
                        )}
                        {showVisualEvidenceDetails ? "Fewer" : "More visual actions"}
                        {!showVisualEvidenceDetails && hiddenVisualEvidenceActionCount > 0 && (
                          <span className="text-gray-400 dark:text-slate-500">
                            {hiddenVisualEvidenceActionCount}
                          </span>
                        )}
                      </button>
                    )}
                    <span className="text-[11px] font-semibold text-gray-400 dark:text-slate-500">
                      {group.actions.length}
                    </span>
                  </span>
                </div>
                <div className="mt-2 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                  {group.actions.map((action) => {
                    const stage = action.stage;
                    const isSelected = selectedProjectActionId === action.id;
                    const actionReady = Boolean(stage && stage.status === "supported_now");
                    const availability = stage ? formatStageAvailability(stage) : "Planned";
                    const runKind = getActionRunKind(stage);
                    return (
                      <button
                        key={action.id}
                        type="button"
                        onClick={() => handleSelectProjectAction(action)}
                        disabled={!stage}
                        className={`min-h-28 rounded-md border px-3 py-2 text-left transition disabled:cursor-not-allowed ${
                          isSelected
                            ? "border-gray-900 bg-gray-900 text-white dark:border-emerald-400 dark:bg-emerald-500 dark:text-slate-950"
                            : actionReady
                              ? "border-gray-200 bg-gray-50 text-gray-700 hover:bg-gray-100 dark:border-slate-800 dark:bg-slate-900/70 dark:text-slate-200 dark:hover:bg-slate-900"
                              : "border-dashed border-gray-300 bg-gray-50 text-gray-500 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-400"
                        }`}
                      >
                        <span className="flex items-start justify-between gap-2">
                          <span className="min-w-0">
                            <span className="block text-sm font-semibold">
                              {action.title}
                            </span>
                            <span className={`mt-1 block text-xs ${
                              isSelected ? "text-white/80 dark:text-slate-900/75" : "text-gray-500 dark:text-slate-400"
                            }`}
                            >
                              {action.note}
                            </span>
                          </span>
                          <span className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${
                            isSelected
                              ? "bg-white text-gray-900 dark:bg-slate-950 dark:text-emerald-200"
                              : "bg-white text-gray-600 dark:bg-slate-950 dark:text-slate-300"
                          }`}
                          >
                            {stage?.runSurface === "direct_cli" ? (
                              <Clipboard className="h-3.5 w-3.5" aria-hidden="true" />
                            ) : stage ? (
                              <Play className="h-3.5 w-3.5" aria-hidden="true" />
                            ) : (
                              <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                            )}
                          </span>
                        </span>
                        <span className="mt-3 flex flex-wrap gap-1.5 text-[11px]">
                          <span className={`rounded border px-1.5 py-0.5 font-semibold ${actionRunKindBadgeClasses(runKind, isSelected)}`}>
                            {runKind.label}
                          </span>
                          <span className={`rounded border px-1.5 py-0.5 font-semibold ${
                            isSelected
                              ? "border-white/40 bg-white/15 text-white dark:border-slate-900/30 dark:bg-slate-950/20 dark:text-slate-950"
                              : actionReady
                                ? "border-gray-200 bg-white text-gray-600 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300"
                                : "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200"
                          }`}
                          >
                            {availability}
                          </span>
                        </span>
                        <span className={`mt-2 block text-xs ${
                          isSelected ? "text-white/80 dark:text-slate-900/75" : "text-gray-500 dark:text-slate-400"
                        }`}
                        >
                          {runKind.helper}
                        </span>
                        <span className={`mt-3 block text-[10px] font-semibold uppercase tracking-wide ${
                          isSelected ? "text-white/60 dark:text-slate-900/60" : "text-gray-400 dark:text-slate-500"
                        }`}
                        >
                          {runKind.outputLabel}
                        </span>
                        <span className={`mt-2 block text-xs ${
                          isSelected ? "text-white/80 dark:text-slate-900/75" : "text-gray-500 dark:text-slate-400"
                        }`}
                        >
                          {action.plannedReason ?? action.output}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-lg border border-gray-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-950">
          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto]">
            <div className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2 dark:border-slate-800 dark:bg-slate-900/70">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">
                {selectedActionPanelLabel}
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold text-gray-900 dark:text-slate-100">
                  {selectedActionTitle}
                </span>
                {selectedStage && (
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                    selectedStage.status === "supported_now"
                      ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-200"
                      : "bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-200"
                  }`}
                  >
                    {formatStageAvailability(selectedStage)}
                  </span>
                )}
              </div>
              <p className="mt-1 line-clamp-2 text-xs text-gray-600 dark:text-slate-300">
                {selectedActionSummary}
              </p>
              <div className="mt-3 grid gap-3 md:grid-cols-[minmax(0,1fr)_18rem]">
                <div className="rounded-md border border-gray-200 bg-white px-3 py-2 text-xs dark:border-slate-800 dark:bg-slate-950">
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 dark:text-slate-500">
                    Click does
                  </div>
                  <div className="mt-1 text-gray-700 dark:text-slate-200">
                    {selectedActionClickDoes}
                  </div>
                </div>
                <div className="rounded-md border border-gray-200 bg-white px-3 py-2 text-xs dark:border-slate-800 dark:bg-slate-950">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 dark:text-slate-500">
                      Action readiness
                    </span>
                    <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${readinessBadgeClasses(selectedActionReadiness.tone)}`}>
                      {selectedActionReadiness.label}
                    </span>
                  </div>
                  <p className="mt-1 text-gray-600 dark:text-slate-300">
                    {selectedActionReadiness.helper}
                  </p>
                  {selectedActionReadiness.needs.length > 0 && (
                    <p className="mt-1 text-gray-600 dark:text-slate-300">
                      {selectedActionReadiness.needsLabel ?? "Needs"}: {selectedActionReadiness.needs.join(", ")}.
                    </p>
                  )}
                </div>
              </div>
              <details className="mt-3 rounded-md border border-gray-200 bg-white px-3 py-2 text-xs dark:border-slate-800 dark:bg-slate-950">
                <summary className="cursor-pointer text-xs font-semibold text-gray-600 dark:text-slate-300">
                  Action contract details
                </summary>
                <div className="mt-3 rounded-md border border-gray-200 bg-gray-50 px-3 py-2 dark:border-slate-800 dark:bg-slate-900/70">
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 dark:text-slate-500">
                    Brick status
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <span className="rounded-full border border-gray-200 bg-white px-2 py-0.5 text-[11px] font-semibold text-gray-700 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200">
                      {selectedActionBrickStatus.label}
                    </span>
                    <span className="text-gray-600 dark:text-slate-300">
                      {selectedActionBrickStatus.detail}
                    </span>
                  </div>
                </div>
                <div className="mt-3 grid gap-2 sm:grid-cols-4">
                  <div>
                    <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 dark:text-slate-500">
                      Uses
                    </div>
                    <div className="mt-1 text-gray-700 dark:text-slate-200">
                      {selectedActionContext}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 dark:text-slate-500">
                      You provide
                    </div>
                    <div className="mt-1 text-gray-700 dark:text-slate-200">
                      {selectedActionArgument}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 dark:text-slate-500">
                      You get
                    </div>
                    <div className="mt-1 text-gray-700 dark:text-slate-200">
                      {selectedActionOutput}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 dark:text-slate-500">
                      Stops after
                    </div>
                    <div className="mt-1 text-gray-700 dark:text-slate-200">
                      {selectedActionRunKind.label}. No automatic next step.
                    </div>
                  </div>
                </div>
              </details>
            </div>

            <div className="flex items-end">
              <button
                type="button"
                onClick={handlePrimaryAction}
                disabled={!canRun && !canCopyCommand}
                className="inline-flex min-h-10 items-center gap-2 rounded-md bg-gray-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-emerald-500 dark:text-slate-950 dark:hover:bg-emerald-400"
              >
                {selectedStage?.runSurface === "direct_cli" ? (
                  <Clipboard className="h-4 w-4" aria-hidden="true" />
                ) : (
                  <Play className="h-4 w-4" aria-hidden="true" />
                )}
                <span className="text-left leading-tight">
                  {isRunning ? selectedStage?.mode === "workspace_mutation" ? "Running..." : "Checking..." : primaryButtonLabel}
                </span>
              </button>
            </div>
          </div>

          {selectedStage?.runSurface === "direct_cli" && renderTerminalCommandPanel("primary")}

          {selectedStage?.id === "project_stage_candidates" && (
            <div className="mt-4 grid gap-3 rounded-md border border-gray-200 bg-gray-50 p-3 dark:border-slate-800 dark:bg-slate-900/70 sm:grid-cols-[8rem_8rem_minmax(0,1fr)]">
              <label className="block">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">
                  Limit
                </span>
                <input
                  value={candidateLimit}
                  onChange={(event) => setCandidateLimit(event.target.value)}
                  inputMode="numeric"
                  className="mt-1 h-9 w-full rounded-md border border-gray-300 bg-white px-3 text-sm text-gray-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                />
                {isCandidateLimitInvalid && (
                  <span className="mt-1 block text-xs text-rose-600 dark:text-rose-300">
                    Use a number from 1 to 100.
                  </span>
                )}
              </label>
              <label className="block">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">
                  Log tail
                </span>
                <input
                  value={candidateTail}
                  onChange={(event) => setCandidateTail(event.target.value)}
                  inputMode="numeric"
                  className="mt-1 h-9 w-full rounded-md border border-gray-300 bg-white px-3 text-sm text-gray-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                />
                {isCandidateTailInvalid && (
                  <span className="mt-1 block text-xs text-rose-600 dark:text-rose-300">
                    Use a number from 1 to 5000.
                  </span>
                )}
              </label>
              <label className="flex items-center gap-2 self-end pb-2 text-sm text-gray-700 dark:text-slate-200">
                <input
                  type="checkbox"
                  checked={candidateIncludeArchived}
                  onChange={(event) => setCandidateIncludeArchived(event.target.checked)}
                  className="h-4 w-4 rounded border-gray-300 text-gray-900 dark:border-slate-700"
                />
                Include archived projects
              </label>
              <div className="text-xs text-gray-600 dark:text-slate-300 sm:col-span-3">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">
                  Boundary
                </div>
                <p className="mt-1">
                  Candidate scan reads current task candidates only. It does not select, run or repair work.
                </p>
              </div>
            </div>
          )}

          {selectedStage?.id === "project_stage_snapshot" && (
            <div className="mt-4 grid gap-3 rounded-md border border-gray-200 bg-gray-50 p-3 dark:border-slate-800 dark:bg-slate-900/70 sm:grid-cols-[minmax(0,1fr)_8rem]">
              <label className="block">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">
                  Task id
                </span>
                <input
                  value={snapshotTaskId}
                  onChange={(event) => setSnapshotTaskId(event.target.value)}
                  placeholder="optional"
                  className="mt-1 h-9 w-full rounded-md border border-gray-300 bg-white px-3 text-sm text-gray-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                />
                {isSnapshotTaskIdInvalid && (
                  <span className="mt-1 block text-xs text-rose-600 dark:text-rose-300">
                    Use letters, numbers, dot, underscore or dash.
                  </span>
                )}
              </label>
              <label className="block">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">
                  Log lines
                </span>
                <input
                  value={snapshotTail}
                  onChange={(event) => setSnapshotTail(event.target.value)}
                  inputMode="numeric"
                  className="mt-1 h-9 w-full rounded-md border border-gray-300 bg-white px-3 text-sm text-gray-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                />
                {isSnapshotTailInvalid && (
                  <span className="mt-1 block text-xs text-rose-600 dark:text-rose-300">
                    Use a number from 1 to 5000.
                  </span>
                )}
              </label>
              <div className="text-xs text-gray-600 dark:text-slate-300 sm:col-span-2">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">
                  Boundary
                </div>
                <p className="mt-1">
                  Task context is disposable readback for the next action. It does not run planner, executor, Workbench, screenshot capture or lifecycle repair.
                </p>
              </div>
            </div>
          )}

          {isPromptReplayStage && (
            <div className="mt-4 grid gap-3 rounded-md border border-gray-200 bg-gray-50 p-3 dark:border-slate-800 dark:bg-slate-900/70 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              {promptReplayFixturePinnedByAction ? (
                <div className="block">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">
                    Prompt fixture
                  </div>
                  <div className="mt-1 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-semibold text-gray-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100">
                    {formatPromptReplayFixtureLabel(selectedPromptReplayFixture)}
                  </div>
                  <p className="mt-1 text-xs text-gray-500 dark:text-slate-400">
                    Pinned by selected action. Change the action, not this fixture.
                  </p>
                </div>
              ) : (
                <label className="block">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">
                    Prompt fixture
                  </span>
                  <select
                    value={promptReplayFixture}
                    onChange={(event) => setPromptReplayFixture(event.target.value as typeof promptReplayFixture)}
                    className="mt-1 h-9 w-full rounded-md border border-gray-300 bg-white px-3 text-sm text-gray-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  >
                    <option value="product_skill">Product role guidance</option>
                    <option value="ux_skill">UX role guidance</option>
                  </select>
                </label>
              )}
              <div className="text-xs text-gray-600 dark:text-slate-300">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">
                  Boundary
                </div>
                <p className="mt-1">
                  Fixed Prompt Lab replay only. No model call, product finding, UX finding or project write.
                </p>
              </div>
            </div>
          )}

          {isProviderBackedStage && (
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-md border border-gray-200 bg-gray-50 p-3 dark:border-slate-800 dark:bg-slate-900/70">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">
                  Project provider settings
                </div>
                <p className="mt-1 text-xs text-gray-600 dark:text-slate-300">
                  {canUseProjectProviderSettings
                    ? `Selected project: ${selectedProjectLabAgent} / ${selectedProjectModel}.`
                    : "Selected project has no Lab-compatible agent and model to copy."}
                </p>
              </div>
              <button
                type="button"
                onClick={handleUseProjectProviderSettings}
                disabled={!canUseProjectProviderSettings}
                className="inline-flex h-9 items-center rounded-md border border-gray-300 bg-white px-3 text-xs font-semibold text-gray-800 transition hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:hover:bg-slate-900"
              >
                Use project settings
              </button>
            </div>
          )}

          {selectedStage?.id === "planner_project_dry_run" && (
            <div className="mt-4 grid gap-3 rounded-md border border-gray-200 bg-gray-50 p-3 dark:border-slate-800 dark:bg-slate-900/70 lg:grid-cols-[minmax(0,1fr)_12rem_12rem_9rem_9rem]">
              <label className="block">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">
                  Visual evidence mode
                </span>
                <select
                  value={plannerVisualEvidenceMode}
                  onChange={(event) => setPlannerVisualEvidenceMode(event.target.value as typeof plannerVisualEvidenceMode)}
                  className="mt-1 h-9 w-full rounded-md border border-gray-300 bg-white px-3 text-sm text-gray-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                >
                  <option value="new_tasks_only">New tasks only</option>
                  <option value="required">Required</option>
                  <option value="off">Off</option>
                </select>
                <span className="mt-1 block text-xs text-gray-500 dark:text-slate-400">
                  Defaults to the selected project&apos;s visible policy.
                </span>
                {isProjectVisualEvidenceModeUnavailable && (
                  <span className="mt-1 block text-xs text-rose-600 dark:text-rose-300">
                    Project visual evidence policy must be readable before this dry-run.
                  </span>
                )}
              </label>
              <label className="block">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">
                  Agent
                </span>
                <select
                  value={executorAgent}
                  onChange={(event) => setExecutorAgent(event.target.value as typeof executorAgent)}
                  className="mt-1 h-9 w-full rounded-md border border-gray-300 bg-white px-3 text-sm text-gray-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                >
                  <option value="codex">Codex</option>
                  <option value="claude-code">Claude Code</option>
                  <option value="opencode">OpenCode</option>
                </select>
              </label>
              <label className="block">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">
                  Model
                </span>
                <input
                  value={executorModel}
                  onChange={(event) => setExecutorModel(event.target.value)}
                  placeholder="gpt-5.5"
                  className="mt-1 h-9 w-full rounded-md border border-gray-300 bg-white px-3 text-sm text-gray-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                />
                {isProviderModelInvalid && (
                  <span className="mt-1 block text-xs text-rose-600 dark:text-rose-300">
                    Enter the exact model to use.
                  </span>
                )}
              </label>
              <label className="block">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">
                  Timeout
                </span>
                <input
                  value={executorTimeout}
                  onChange={(event) => setExecutorTimeout(event.target.value)}
                  inputMode="numeric"
                  className="mt-1 h-9 w-full rounded-md border border-gray-300 bg-white px-3 text-sm text-gray-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                />
                {isProviderTimeoutInvalid && (
                  <span className="mt-1 block text-xs text-rose-600 dark:text-rose-300">
                    Use a number from 1 to 60.
                  </span>
                )}
              </label>
              <label className="block">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">
                  Log lines
                </span>
                <input
                  value={snapshotTail}
                  onChange={(event) => setSnapshotTail(event.target.value)}
                  inputMode="numeric"
                  className="mt-1 h-9 w-full rounded-md border border-gray-300 bg-white px-3 text-sm text-gray-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                />
                {isSnapshotTailInvalid && (
                  <span className="mt-1 block text-xs text-rose-600 dark:text-rose-300">
                    Use a number from 1 to 5000.
                  </span>
                )}
              </label>
            </div>
          )}

          {selectedStage?.id === "planner_spec_migration_apply" && (
            <div className="mt-4 grid gap-3 rounded-md border border-gray-200 bg-gray-50 p-3 dark:border-slate-800 dark:bg-slate-900/70 lg:grid-cols-[12rem_minmax(0,1fr)_9rem_9rem]">
              <label className="block">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">
                  Agent
                </span>
                <select
                  value={executorAgent}
                  onChange={(event) => setExecutorAgent(event.target.value as typeof executorAgent)}
                  className="mt-1 h-9 w-full rounded-md border border-gray-300 bg-white px-3 text-sm text-gray-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                >
                  <option value="codex">Codex</option>
                  <option value="claude-code">Claude Code</option>
                  <option value="opencode">OpenCode</option>
                </select>
              </label>
              <label className="block">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">
                  Model
                </span>
                <input
                  value={executorModel}
                  onChange={(event) => setExecutorModel(event.target.value)}
                  placeholder="gpt-5.5"
                  className="mt-1 h-9 w-full rounded-md border border-gray-300 bg-white px-3 text-sm text-gray-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                />
                {isProviderModelInvalid && (
                  <span className="mt-1 block text-xs text-rose-600 dark:text-rose-300">
                    Enter the exact model to use.
                  </span>
                )}
              </label>
              <label className="block">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">
                  Timeout
                </span>
                <input
                  value={executorTimeout}
                  onChange={(event) => setExecutorTimeout(event.target.value)}
                  inputMode="numeric"
                  className="mt-1 h-9 w-full rounded-md border border-gray-300 bg-white px-3 text-sm text-gray-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                />
                {isProviderTimeoutInvalid && (
                  <span className="mt-1 block text-xs text-rose-600 dark:text-rose-300">
                    Use a number from 1 to 60.
                  </span>
                )}
              </label>
              <label className="block">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">
                  Log lines
                </span>
                <input
                  value={snapshotTail}
                  onChange={(event) => setSnapshotTail(event.target.value)}
                  inputMode="numeric"
                  className="mt-1 h-9 w-full rounded-md border border-gray-300 bg-white px-3 text-sm text-gray-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                />
                {isSnapshotTailInvalid && (
                  <span className="mt-1 block text-xs text-rose-600 dark:text-rose-300">
                    Use a number from 1 to 5000.
                  </span>
                )}
              </label>
            </div>
          )}

          {selectedStage?.id === "controller_project_dry_run" && (
            <div className="mt-4 grid gap-3 rounded-md border border-gray-200 bg-gray-50 p-3 dark:border-slate-800 dark:bg-slate-900/70 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_12rem_12rem_9rem_9rem]">
              <label className="block">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">
                  Trigger
                </span>
                <select
                  value={controllerTrigger}
                  onChange={(event) => setControllerTrigger(event.target.value as typeof controllerTrigger)}
                  className="mt-1 h-9 w-full rounded-md border border-gray-300 bg-white px-3 text-sm text-gray-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                >
                  <option value="manual">Manual</option>
                  <option value="phase_complete">Phase complete</option>
                  <option value="periodic">Periodic</option>
                  <option value="failure_threshold">Failure threshold</option>
                  <option value="replan">Replan</option>
                  <option value="final">Final</option>
                  <option value="spec_migration">Spec migration</option>
                </select>
              </label>
              <label className="block">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">
                  Visual evidence mode
                </span>
                <select
                  value={plannerVisualEvidenceMode}
                  onChange={(event) => setPlannerVisualEvidenceMode(event.target.value as typeof plannerVisualEvidenceMode)}
                  className="mt-1 h-9 w-full rounded-md border border-gray-300 bg-white px-3 text-sm text-gray-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                >
                  <option value="new_tasks_only">New tasks only</option>
                  <option value="required">Required</option>
                  <option value="off">Off</option>
                </select>
                <span className="mt-1 block text-xs text-gray-500 dark:text-slate-400">
                  Defaults to the selected project&apos;s visible policy.
                </span>
                {isProjectVisualEvidenceModeUnavailable && (
                  <span className="mt-1 block text-xs text-rose-600 dark:text-rose-300">
                    Project visual evidence policy must be readable before this dry-run.
                  </span>
                )}
              </label>
              <label className="block">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">
                  Agent
                </span>
                <select
                  value={executorAgent}
                  onChange={(event) => setExecutorAgent(event.target.value as typeof executorAgent)}
                  className="mt-1 h-9 w-full rounded-md border border-gray-300 bg-white px-3 text-sm text-gray-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                >
                  <option value="codex">Codex</option>
                  <option value="claude-code">Claude Code</option>
                  <option value="opencode">OpenCode</option>
                </select>
              </label>
              <label className="block">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">
                  Model
                </span>
                <input
                  value={executorModel}
                  onChange={(event) => setExecutorModel(event.target.value)}
                  placeholder="gpt-5.5"
                  className="mt-1 h-9 w-full rounded-md border border-gray-300 bg-white px-3 text-sm text-gray-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                />
                {isProviderModelInvalid && (
                  <span className="mt-1 block text-xs text-rose-600 dark:text-rose-300">
                    Enter the exact model to use.
                  </span>
                )}
              </label>
              <label className="block">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">
                  Timeout
                </span>
                <input
                  value={executorTimeout}
                  onChange={(event) => setExecutorTimeout(event.target.value)}
                  inputMode="numeric"
                  className="mt-1 h-9 w-full rounded-md border border-gray-300 bg-white px-3 text-sm text-gray-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                />
                {isProviderTimeoutInvalid && (
                  <span className="mt-1 block text-xs text-rose-600 dark:text-rose-300">
                    Use a number from 1 to 60.
                  </span>
                )}
              </label>
              <label className="block">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">
                  Log lines
                </span>
                <input
                  value={snapshotTail}
                  onChange={(event) => setSnapshotTail(event.target.value)}
                  inputMode="numeric"
                  className="mt-1 h-9 w-full rounded-md border border-gray-300 bg-white px-3 text-sm text-gray-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                />
                {isSnapshotTailInvalid && (
                  <span className="mt-1 block text-xs text-rose-600 dark:text-rose-300">
                    Use a number from 1 to 5000.
                  </span>
                )}
              </label>
            </div>
          )}

          {(selectedStage?.id === "visual_workbench_selector_readiness" || selectedStage?.id === "visual_workbench_shell_policy" || selectedStage?.id === "visual_workbench_automation_status" || selectedStage?.id === "visual_workbench_evidence_chain_readiness") && (
            <div className="mt-4 grid gap-3 rounded-md border border-gray-200 bg-gray-50 p-3 dark:border-slate-800 dark:bg-slate-900/70 sm:grid-cols-[minmax(0,1fr)_10rem]">
              <label className="block">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">
                  Task id
                </span>
                <input
                  value={snapshotTaskId}
                  onChange={(event) => setSnapshotTaskId(event.target.value)}
                  placeholder="task-001"
                  className="mt-1 h-9 w-full rounded-md border border-gray-300 bg-white px-3 text-sm text-gray-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                />
                {(isSnapshotTaskIdInvalid || isSelectorTaskIdInvalid || isShellPolicyTaskIdInvalid || isAutomationStatusTaskIdInvalid || isEvidenceChainTaskIdInvalid) && (
                  <span className="mt-1 block text-xs text-rose-600 dark:text-rose-300">
                    Select one task id from the current project snapshot.
                  </span>
                )}
              </label>
              <label className="block">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">
                  Log lines
                </span>
                <input
                  value={snapshotTail}
                  onChange={(event) => setSnapshotTail(event.target.value)}
                  inputMode="numeric"
                  className="mt-1 h-9 w-full rounded-md border border-gray-300 bg-white px-3 text-sm text-gray-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                />
                {isSnapshotTailInvalid && (
                  <span className="mt-1 block text-xs text-rose-600 dark:text-rose-300">
                    Use a number from 1 to 5000.
                  </span>
                )}
              </label>
            </div>
          )}

          {selectedStage?.id === "visual_workbench_manifest_readiness" && (
            <div className="mt-4 grid gap-3 rounded-md border border-gray-200 bg-gray-50 p-3 dark:border-slate-800 dark:bg-slate-900/70 sm:grid-cols-[8rem_minmax(0,1fr)]">
              <label className="block">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">
                  Log tail
                </span>
                <input
                  value={snapshotTail}
                  onChange={(event) => setSnapshotTail(event.target.value)}
                  inputMode="numeric"
                  className="mt-1 h-9 w-full rounded-md border border-gray-300 bg-white px-3 text-sm text-gray-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                />
                {isSnapshotTailInvalid && (
                  <span className="mt-1 block text-xs text-rose-600 dark:text-rose-300">
                    Use a number from 1 to 5000.
                  </span>
                )}
              </label>
              <div className="text-xs text-gray-600 dark:text-slate-300">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">
                  Boundary
                </div>
                <p className="mt-1">
                  Task context source only. No client workDir, sourceRef, server start, capture, export or evidence write.
                </p>
              </div>
            </div>
          )}

          {selectedStage?.id === "executor_project_task" && (
            <div className="mt-4 grid gap-3 rounded-md border border-gray-200 bg-gray-50 p-3 dark:border-slate-800 dark:bg-slate-900/70 lg:grid-cols-[minmax(0,1fr)_12rem_12rem]">
              <label className="block">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">
                  Task id
                </span>
                <input
                  value={snapshotTaskId}
                  onChange={(event) => setSnapshotTaskId(event.target.value)}
                  placeholder="task-123"
                  className="mt-1 h-9 w-full rounded-md border border-gray-300 bg-white px-3 text-sm text-gray-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                />
                {isExecutorTaskIdInvalid && (
                  <span className="mt-1 block text-xs text-rose-600 dark:text-rose-300">
                    Select or enter a task id before running executor.
                  </span>
                )}
              </label>
              <label className="block">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">
                  Mode
                </span>
                <select
                  value={executorMode}
                  onChange={(event) => setExecutorMode(event.target.value as typeof executorMode)}
                  className="mt-1 h-9 w-full rounded-md border border-gray-300 bg-white px-3 text-sm text-gray-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                >
                  <option value="new_task">New task</option>
                  <option value="failed_task">Retry failed</option>
                  <option value="resume_interrupted">Resume interrupted</option>
                </select>
              </label>
              <label className="block">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">
                  Timeout
                </span>
                <input
                  value={executorTimeout}
                  onChange={(event) => setExecutorTimeout(event.target.value)}
                  inputMode="numeric"
                  className="mt-1 h-9 w-full rounded-md border border-gray-300 bg-white px-3 text-sm text-gray-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                />
                {isProviderTimeoutInvalid && (
                  <span className="mt-1 block text-xs text-rose-600 dark:text-rose-300">
                    Use a number from 1 to 60.
                  </span>
                )}
              </label>
              <label className="block">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">
                  Agent
                </span>
                <select
                  value={executorAgent}
                  onChange={(event) => setExecutorAgent(event.target.value as typeof executorAgent)}
                  className="mt-1 h-9 w-full rounded-md border border-gray-300 bg-white px-3 text-sm text-gray-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                >
                  <option value="codex">Codex</option>
                  <option value="claude-code">Claude Code</option>
                  <option value="opencode">OpenCode</option>
                </select>
              </label>
              <label className="block">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">
                  Model
                </span>
                <input
                  value={executorModel}
                  onChange={(event) => setExecutorModel(event.target.value)}
                  placeholder="gpt-5.5"
                  className="mt-1 h-9 w-full rounded-md border border-gray-300 bg-white px-3 text-sm text-gray-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                />
                {isProviderModelInvalid && (
                  <span className="mt-1 block text-xs text-rose-600 dark:text-rose-300">
                    Enter the exact model to use.
                  </span>
                )}
              </label>
              <label className="block lg:col-span-3">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">
                  Completion promise
                </span>
                <input
                  value={executorCompletionPromise}
                  onChange={(event) => setExecutorCompletionPromise(event.target.value)}
                  className="mt-1 h-9 w-full rounded-md border border-gray-300 bg-white px-3 text-sm text-gray-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                />
                {isExecutorCompletionPromiseInvalid && (
                  <span className="mt-1 block text-xs text-rose-600 dark:text-rose-300">
                    Enter a concrete stopping promise for this one executor run.
                  </span>
                )}
              </label>
            </div>
          )}

          <details className="mt-4 rounded-md border border-gray-200 bg-gray-50 p-3 dark:border-slate-800 dark:bg-slate-900/70">
            <summary className="cursor-pointer text-sm font-semibold text-gray-700 dark:text-slate-200">
              <span className="inline-flex flex-wrap items-center gap-2">
                <span>Debug: stage catalog</span>
                <span className="rounded-full border border-gray-300 bg-white px-2 py-0.5 text-[11px] font-semibold text-gray-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-400">
                  Advanced
                </span>
              </span>
            </summary>
            <p className="mt-1 text-xs text-gray-500 dark:text-slate-400">
              Normal work starts from Project actions above. Open this only to inspect raw stage ids, command placeholders or exact run boundaries.
            </p>

            <label className="mt-3 block">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">
                Raw stage
              </span>
              <select
                value={selectedDebugStageId}
                onChange={(event) => {
                  setSelectedProjectActionId(null);
                  setSelectedDebugStageId(event.target.value);
                }}
                className="mt-1 h-10 w-full rounded-md border border-gray-300 bg-white px-3 text-sm text-gray-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              >
                {stageGroups.map((group) => (
                  <optgroup key={group.label} label={group.label}>
                    {group.stages.map((stage) => (
                      <option key={stage.id} value={stage.id}>
                        {getStageCopy(stage).title} - {formatStageAvailability(stage)}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </label>

            {selectedStage && (
            <div className="mt-4 border-t border-gray-200 pt-4 text-sm dark:border-slate-800">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-sm font-semibold text-gray-900 dark:text-slate-100">
                      {selectedStageCopy.title}
                    </h3>
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                      selectedStage.status === "supported_now"
                        ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-200"
                        : "bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-200"
                    }`}
                    >
                      {formatStageAvailability(selectedStage)}
                    </span>
                  </div>
                  <p className="mt-1 max-w-3xl text-gray-600 dark:text-slate-300">
                    {selectedStageCopy.summary}
                  </p>
                </div>
              </div>

              {(selectedStageCopy.useWhen || selectedStageCopy.dependsOn) && (
                <div className="mt-4 grid gap-3 rounded-md border border-gray-200 bg-gray-50 p-3 dark:border-slate-800 dark:bg-slate-900/70 md:grid-cols-2">
                  {selectedStageCopy.useWhen && (
                    <div>
                      <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">
                        Use when
                      </div>
                      <p className="mt-1 text-sm text-gray-700 dark:text-slate-200">
                        {selectedStageCopy.useWhen}
                      </p>
                    </div>
                  )}
                  {selectedStageCopy.dependsOn && (
                    <div>
                      <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">
                        Depends on
                      </div>
                      <p className="mt-1 text-sm text-gray-700 dark:text-slate-200">
                        {selectedStageCopy.dependsOn}
                      </p>
                    </div>
                  )}
                </div>
              )}

              <div className="mt-4 grid gap-4 lg:grid-cols-3">
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">
                    What it checks
                  </div>
                  <p className="mt-1 text-sm text-gray-700 dark:text-slate-200">
                    {selectedStageCopy.reads}
                  </p>
                </div>
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">
                    Will not
                  </div>
                  <p className="mt-1 text-sm text-gray-700 dark:text-slate-200">
                    {selectedStageCopy.wont}
                  </p>
                </div>
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">
                    Next
                  </div>
                  <p className="mt-1 text-sm text-gray-700 dark:text-slate-200">
                    {selectedStageCopy.next}
                  </p>
                </div>
              </div>

              {selectedStage.id === "project_stage_snapshot" && (
                <div className="mt-4 grid gap-3 rounded-md border border-gray-200 bg-gray-50 p-3 dark:border-slate-800 dark:bg-slate-900/70 sm:grid-cols-[minmax(0,1fr)_8rem]">
                  <label className="block">
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">
                      Task id
                    </span>
                    <input
                      value={snapshotTaskId}
                      onChange={(event) => setSnapshotTaskId(event.target.value)}
                      placeholder="optional"
                      className="mt-1 h-9 w-full rounded-md border border-gray-300 bg-white px-3 text-sm text-gray-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                    />
                    {isSnapshotTaskIdInvalid && (
                      <span className="mt-1 block text-xs text-rose-600 dark:text-rose-300">
                        Use letters, numbers, dot, underscore or dash.
                      </span>
                    )}
                  </label>
                  <label className="block">
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">
                      Log tail
                    </span>
                    <input
                      value={snapshotTail}
                      onChange={(event) => setSnapshotTail(event.target.value)}
                      inputMode="numeric"
                      className="mt-1 h-9 w-full rounded-md border border-gray-300 bg-white px-3 text-sm text-gray-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                    />
                    {isSnapshotTailInvalid && (
                      <span className="mt-1 block text-xs text-rose-600 dark:text-rose-300">
                        Use a number from 1 to 5000.
                      </span>
                    )}
                  </label>
                </div>
              )}

              {selectedStage.runSurface !== "direct_cli" && renderTerminalCommandPanel("advanced")}

            </div>
            )}
          </details>
        </section>

        {runResult && (
          <section className="rounded-lg border border-gray-200 bg-white dark:border-slate-800 dark:bg-slate-950">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-200 px-4 py-3 dark:border-slate-800">
              <div>
                <div className="text-sm font-semibold text-gray-900 dark:text-slate-100">
                  {resultOriginLabel}
                </div>
                <div className="mt-0.5 text-xs text-gray-500 dark:text-slate-400">
                  {getRunResultHeading(runResult)}
                </div>
                {runResult.executedAt && (
                  <div className="mono mt-0.5 text-[11px] text-gray-500 dark:text-slate-400">
                    {runResult.executedAt}
                  </div>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {hasSnapshotCommandInputHints && (
                  <button
                    type="button"
                    onClick={handleApplySnapshotCommandHints}
                    className="inline-flex h-8 items-center gap-1 rounded-md border border-gray-300 bg-white px-2 text-xs font-semibold text-gray-700 transition hover:bg-gray-100 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200 dark:hover:bg-slate-900"
                  >
                    <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                    Fill command hints
                  </button>
                )}
                {isSnapshotRunResult(runResult) && (
                  <button
                    type="button"
                    onClick={handleDownloadSnapshot}
                    className="inline-flex h-8 items-center gap-1 rounded-md border border-gray-300 bg-white px-2 text-xs font-semibold text-gray-700 transition hover:bg-gray-100 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200 dark:hover:bg-slate-900"
                  >
                    <Download className="h-3.5 w-3.5" aria-hidden="true" />
                    Download task context
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleCopyRunResult}
                  className="inline-flex h-8 items-center gap-1 rounded-md border border-gray-300 bg-white px-2 text-xs font-semibold text-gray-700 transition hover:bg-gray-100 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200 dark:hover:bg-slate-900"
                >
                  <Clipboard className="h-3.5 w-3.5" aria-hidden="true" />
                  {getCopyResultLabel(runResult)}
                </button>
                {runResult.error && (
                  <span className="rounded-full border border-rose-200 bg-rose-50 px-2 py-1 text-xs font-semibold text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-200">
                    {runResult.code ?? "error"}
                  </span>
                )}
              </div>
            </div>
            <div className="space-y-3 p-4 text-sm text-gray-700 dark:text-slate-200">
              <p>
                {runResult.error ?? resultStageCopy.resultSummary}
              </p>
              {resultHighlights.length > 0 && (
                <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                  {resultHighlights.map((highlight) => (
                    <div
                      key={`${highlight.label}:${highlight.value}`}
                      className={`rounded-md border px-3 py-2 ${resultHighlightClasses(highlight.tone)}`}
                    >
                      <div className="text-[11px] font-semibold uppercase tracking-wide opacity-70">
                        {highlight.label}
                      </div>
                      <div className="mt-1 text-sm font-semibold">
                        {highlight.value}
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {plannerApplyNextHandoff && (
                <div className={`rounded-md border p-3 ${
                  canSelectPlannerApplyNextAction(plannerApplyNextHandoff)
                    ? "border-emerald-200 bg-emerald-50 dark:border-emerald-500/30 dark:bg-emerald-500/10"
                    : "border-amber-200 bg-amber-50 dark:border-amber-500/30 dark:bg-amber-500/10"
                }`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <div className={`text-[11px] font-semibold uppercase tracking-wide ${
                        canSelectPlannerApplyNextAction(plannerApplyNextHandoff)
                          ? "text-emerald-800 dark:text-emerald-100"
                          : "text-amber-800 dark:text-amber-100"
                      }`}
                      >
                        Planner handoff
                      </div>
                      <div className={`mt-1 text-sm font-semibold ${
                        canSelectPlannerApplyNextAction(plannerApplyNextHandoff)
                          ? "text-emerald-950 dark:text-emerald-50"
                          : "text-amber-950 dark:text-amber-50"
                      }`}
                      >
                        {plannerApplyNextHandoff.title}
                      </div>
                      <p className={`mt-1 text-xs ${
                        canSelectPlannerApplyNextAction(plannerApplyNextHandoff)
                          ? "text-emerald-900 dark:text-emerald-100"
                          : "text-amber-900 dark:text-amber-100"
                      }`}
                      >
                        {plannerApplyNextHandoff.message}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => handleUsePlannerApplyFindWorkHandoff(plannerApplyNextHandoff)}
                        disabled={!canSelectPlannerApplyNextAction(plannerApplyNextHandoff)}
                        className="inline-flex h-8 shrink-0 items-center gap-1 rounded-md border border-emerald-300 bg-white px-2 text-xs font-semibold text-emerald-800 transition hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-emerald-500/40 dark:bg-slate-950 dark:text-emerald-100 dark:hover:bg-slate-900"
                      >
                        <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                        Find work
                      </button>
                      <button
                        type="button"
                        onClick={() => handleUsePlannerApplyTaskContextHandoff(plannerApplyNextHandoff)}
                        disabled={!canSelectPlannerApplyNextAction(plannerApplyNextHandoff)}
                        className="inline-flex h-8 shrink-0 items-center gap-1 rounded-md border border-gray-300 bg-white px-2 text-xs font-semibold text-gray-700 transition hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200 dark:hover:bg-slate-900"
                      >
                        <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                        Get task context
                      </button>
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-1.5 text-[11px]">
                    <span className="rounded border border-white/70 bg-white px-1.5 py-0.5 font-semibold text-gray-700 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200">
                      records: {plannerApplyNextHandoff.recordedCount}
                    </span>
                    <span className="rounded border border-white/70 bg-white px-1.5 py-0.5 font-semibold text-gray-700 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200">
                      planner: {plannerApplyNextHandoff.plannerAppliedCount}
                    </span>
                    <span className="rounded border border-white/70 bg-white px-1.5 py-0.5 font-semibold text-gray-700 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200">
                      allowed .ralph files: {plannerApplyNextHandoff.allowedChangedFiles}
                    </span>
                    <span className="rounded border border-white/70 bg-white px-1.5 py-0.5 font-semibold text-gray-700 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200">
                      forbidden: {plannerApplyNextHandoff.forbiddenChangedFiles}
                    </span>
                    <span className="rounded border border-white/70 bg-white px-1.5 py-0.5 font-semibold text-gray-700 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200">
                      HEAD: {plannerApplyNextHandoff.headChanged === true ? "changed" : plannerApplyNextHandoff.headChanged === false ? "unchanged" : "unknown"}
                    </span>
                    <span className="mono rounded border border-white/70 bg-white px-1.5 py-0.5 text-gray-600 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300">
                      source: {formatShortSha(plannerApplyNextHandoff.sourceRef)}
                    </span>
                  </div>
                  <p className="mt-2 text-xs text-gray-600 dark:text-slate-300">
                    This is a manual bridge to the next shared Ralph brick. The Lab does not start planner, executor, controller or screenshot stages from this result.
                  </p>
                </div>
              )}
              {selectorCapturePolicyHandoff && (
                <div className="rounded-md border border-violet-200 bg-violet-50 p-3 dark:border-violet-500/30 dark:bg-violet-500/10">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <div className="text-[11px] font-semibold uppercase tracking-wide text-violet-800 dark:text-violet-100">
                        Visual Workbench handoff
                      </div>
                      <div className="mt-1 text-sm font-semibold text-violet-950 dark:text-violet-50">
                        {selectorCapturePolicyHandoff.title}
                      </div>
                      <p className="mt-1 text-xs text-violet-900 dark:text-violet-100">
                        {selectorCapturePolicyHandoff.message}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleUseSelectorCapturePolicyHandoff(selectorCapturePolicyHandoff)}
                      className="inline-flex h-8 shrink-0 items-center gap-1 rounded-md border border-violet-300 bg-white px-2 text-xs font-semibold text-violet-800 transition hover:bg-violet-100 dark:border-violet-500/40 dark:bg-slate-950 dark:text-violet-100 dark:hover:bg-slate-900"
                    >
                      <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                      Fill capture policy
                    </button>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-1.5 text-[11px]">
                    <span className="rounded border border-white/70 bg-white px-1.5 py-0.5 font-semibold text-gray-700 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200">
                      task: {selectorCapturePolicyHandoff.taskId}
                    </span>
                    <span className="mono rounded border border-white/70 bg-white px-1.5 py-0.5 text-gray-600 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300">
                      source: {formatShortSha(selectorCapturePolicyHandoff.sourceRef)}
                    </span>
                  </div>
                </div>
              )}
              {shellPolicyBrowserReadinessHandoff && (
                <div className="rounded-md border border-sky-200 bg-sky-50 p-3 dark:border-sky-500/30 dark:bg-sky-500/10">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <div className="text-[11px] font-semibold uppercase tracking-wide text-sky-800 dark:text-sky-100">
                        Visual Workbench handoff
                      </div>
                      <div className="mt-1 text-sm font-semibold text-sky-950 dark:text-sky-50">
                        {shellPolicyBrowserReadinessHandoff.title}
                      </div>
                      <p className="mt-1 text-xs text-sky-900 dark:text-sky-100">
                        {shellPolicyBrowserReadinessHandoff.message}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleUseShellPolicyBrowserReadinessHandoff(shellPolicyBrowserReadinessHandoff)}
                      className="inline-flex h-8 shrink-0 items-center gap-1 rounded-md border border-sky-300 bg-white px-2 text-xs font-semibold text-sky-800 transition hover:bg-sky-100 dark:border-sky-500/40 dark:bg-slate-950 dark:text-sky-100 dark:hover:bg-slate-900"
                    >
                      <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                      Fill browser check
                    </button>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-1.5 text-[11px]">
                    <span className="rounded border border-white/70 bg-white px-1.5 py-0.5 font-semibold text-gray-700 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200">
                      task: {shellPolicyBrowserReadinessHandoff.taskId ?? "none"}
                    </span>
                    <span className="mono rounded border border-white/70 bg-white px-1.5 py-0.5 text-gray-600 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300">
                      source: {formatShortSha(shellPolicyBrowserReadinessHandoff.sourceRef)}
                    </span>
                  </div>
                </div>
              )}
              {browserReadinessScreenshotHandoff && (
                <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 dark:border-emerald-500/30 dark:bg-emerald-500/10">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <div className="text-[11px] font-semibold uppercase tracking-wide text-emerald-800 dark:text-emerald-100">
                        Visual Workbench handoff
                      </div>
                      <div className="mt-1 text-sm font-semibold text-emerald-950 dark:text-emerald-50">
                        {browserReadinessScreenshotHandoff.title}
                      </div>
                      <p className="mt-1 text-xs text-emerald-900 dark:text-emerald-100">
                        {browserReadinessScreenshotHandoff.message}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleUseBrowserReadinessScreenshotHandoff(browserReadinessScreenshotHandoff)}
                      className="inline-flex h-8 shrink-0 items-center gap-1 rounded-md border border-emerald-300 bg-white px-2 text-xs font-semibold text-emerald-800 transition hover:bg-emerald-100 dark:border-emerald-500/40 dark:bg-slate-950 dark:text-emerald-100 dark:hover:bg-slate-900"
                    >
                      <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                      Fill screenshot handoff
                    </button>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-1.5 text-[11px]">
                    <span className="mono rounded border border-white/70 bg-white px-1.5 py-0.5 text-gray-600 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300">
                      browser: {browserReadinessScreenshotHandoff.executablePath ? formatPathTail(browserReadinessScreenshotHandoff.executablePath) : "ready"}
                    </span>
                  </div>
                </div>
              )}
              {executorResultSummary && (
                <div className="rounded-md border border-gray-200 bg-gray-50 p-3 dark:border-slate-800 dark:bg-slate-900/70">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">
                        Executor result
                      </div>
                      <p className="mt-1 text-xs text-gray-600 dark:text-slate-300">
                        Local source result from the executor stage. This is not task/proof/lifecycle truth.
                      </p>
                    </div>
                    <span className={`rounded border px-2 py-1 text-xs font-semibold ${
                      executorResultSummary.status === "completed"
                        ? "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-200"
                        : isExecutorWarningStatus(executorResultSummary.status)
                          ? "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200"
                          : "border-gray-200 bg-white text-gray-600 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300"
                    }`}
                    >
                      {formatExecutorResultValue(executorResultSummary.status)}
                    </span>
                  </div>
                  <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                    <div>
                      <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">
                        Task / mode
                      </div>
                      <div className="mt-1 break-words text-sm font-semibold text-gray-900 dark:text-slate-100">
                        {executorResultSummary.selectedTaskId ?? "task unknown"}
                      </div>
                      <div className="mt-0.5 text-xs text-gray-500 dark:text-slate-400">
                        {formatExecutorResultValue(executorResultSummary.mode)}
                        {" / "}
                        {formatExecutorResultValue(executorResultSummary.workspaceMode)}
                      </div>
                    </div>
                    <div>
                      <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">
                        Before commit
                      </div>
                      <div className="mono mt-1 text-sm font-semibold text-gray-900 dark:text-slate-100">
                        {formatShortSha(executorResultSummary.beforeCommit)}
                      </div>
                    </div>
                    <div>
                      <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">
                        Local project commit
                      </div>
                      <div className="mono mt-1 text-sm font-semibold text-gray-900 dark:text-slate-100">
                        {executorResultSummary.localProjectCommit
                          ? formatShortSha(executorResultSummary.localProjectCommit)
                          : formatExecutorResultValue(executorResultSummary.projectCommitStatus)}
                      </div>
                    </div>
                    <div>
                      <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">
                        Workspace diff
                      </div>
                      <div className="mt-1 text-sm font-semibold text-gray-900 dark:text-slate-100">
                        {executorResultSummary.changedFiles.length} file{executorResultSummary.changedFiles.length === 1 ? "" : "s"}
                      </div>
                      {executorResultSummary.changedFilesSource && (
                        <div className="mt-0.5 text-xs text-gray-500 dark:text-slate-400">
                          {executorResultSummary.changedFilesSource === "project_commit" ? "from project commit result" : "from workspace diff"}
                        </div>
                      )}
                    </div>
                  </div>
                  {executorObserverReadback && (
                    <div className="mt-3 border-t border-gray-200 pt-3 dark:border-slate-800">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">
                            Shared executor observer
                          </div>
                          <p className="mt-1 text-xs text-gray-600 dark:text-slate-300">
                            Owner-backed readback from ralph.executor-observer. Telemetry only; not task/proof/lifecycle truth.
                          </p>
                        </div>
                        <span className="mono rounded border border-gray-200 bg-white px-2 py-1 text-xs text-gray-600 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300">
                          {executorObserverReadback.ownerBoundary}
                        </span>
                      </div>
                      <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                        <div>
                          <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">
                            Observer status
                          </div>
                          <div className="mt-1 text-sm font-semibold text-gray-900 dark:text-slate-100">
                            {formatExecutorResultValue(executorObserverReadback.status)}
                          </div>
                        </div>
                        <div>
                          <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">
                            Completion signal
                          </div>
                          <div className="mt-1 text-sm font-semibold text-gray-900 dark:text-slate-100">
                            {executorObserverReadback.detectedCompletionPromiseFound === null
                              ? "unknown"
                              : executorObserverReadback.detectedCompletionPromiseFound ? "found" : "missing"}
                            {executorObserverReadback.needsReplanSignalDetected ? " / needs replan" : ""}
                          </div>
                        </div>
                        <div>
                          <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">
                            Visual policy
                          </div>
                          <div className="mt-1 text-sm font-semibold text-gray-900 dark:text-slate-100">
                            {formatExecutorResultValue(executorObserverReadback.visualEvidenceMode)}
                          </div>
                        </div>
                        <div>
                          <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">
                            Visual coverage
                          </div>
                          <div className="mt-1 text-sm font-semibold text-gray-900 dark:text-slate-100">
                            {formatExecutorResultValue(executorObserverReadback.visualWorkbenchCoverage)}
                          </div>
                        </div>
                        <div>
                          <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">
                            Files observed
                          </div>
                          <div className="mt-1 text-sm font-semibold text-gray-900 dark:text-slate-100">
                            {executorObserverReadback.filesChangedCount ?? "unknown"}
                          </div>
                        </div>
                        <div>
                          <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">
                            Workbench files
                          </div>
                          <div className="mt-1 text-sm font-semibold text-gray-900 dark:text-slate-100">
                            {executorObserverReadback.changedVisualWorkbenchFiles.length}
                          </div>
                        </div>
                        <div>
                          <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">
                            Forbidden files
                          </div>
                          <div className="mt-1 text-sm font-semibold text-gray-900 dark:text-slate-100">
                            {executorObserverReadback.forbiddenChangedFiles.length}
                          </div>
                        </div>
                        <div>
                          <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">
                            Proof-like files
                          </div>
                          <div className="mt-1 text-sm font-semibold text-gray-900 dark:text-slate-100">
                            {executorObserverReadback.adHocProofLikeFiles.length}
                          </div>
                        </div>
                      </div>
                      {executorObserverReadback.expectedVisualWorkbenchStoryIds.length > 0 && (
                        <div className="mt-3">
                          <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">
                            Expected stories
                          </div>
                          <div className="mt-1 flex flex-wrap gap-1.5">
                            {executorObserverReadback.expectedVisualWorkbenchStoryIds.slice(0, 8).map((storyId) => {
                              const isMissing = executorObserverReadback.missingExpectedVisualWorkbenchStoryIds.includes(storyId);
                              const isCovered = executorObserverReadback.coveredExpectedVisualWorkbenchStoryIds.includes(storyId);
                              return (
                                <span
                                  key={storyId}
                                  className={`mono rounded border px-1.5 py-0.5 text-[11px] ${
                                    isMissing
                                      ? "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200"
                                      : isCovered
                                        ? "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-200"
                                        : "border-gray-200 bg-white text-gray-600 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300"
                                  }`}
                                >
                                  {storyId}
                                </span>
                              );
                            })}
                            {executorObserverReadback.expectedVisualWorkbenchStoryIds.length > 8 && (
                              <span className="rounded border border-gray-200 bg-white px-1.5 py-0.5 text-[11px] font-semibold text-gray-600 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300">
                                +{executorObserverReadback.expectedVisualWorkbenchStoryIds.length - 8} more
                              </span>
                            )}
                          </div>
                        </div>
                      )}
                      {(executorObserverReadback.malformedCompletion || executorObserverReadback.warnings.length > 0) && (
                        <div className="mt-3 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100">
                          {executorObserverReadback.malformedCompletion && (
                            <div>
                              <span className="font-semibold">Malformed completion</span>
                              {": "}
                              {executorObserverReadback.malformedCompletion}
                            </div>
                          )}
                          {executorObserverReadback.warnings.slice(0, 5).map((warning, index) => (
                            <div key={`${warning}-${index}`} className={executorObserverReadback.malformedCompletion || index > 0 ? "mt-1" : ""}>
                              <span className="font-semibold">Observer warning</span>
                              {": "}
                              {warning}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                  {executorResultSummary.changedFiles.length > 0 && (
                    <div className="mt-3">
                      <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">
                        Changed files
                      </div>
                      <div className="mt-1 flex flex-wrap gap-1.5">
                        {executorResultSummary.changedFiles.slice(0, 10).map((file) => (
                          <span
                            key={file}
                            className="mono rounded border border-gray-200 bg-white px-1.5 py-0.5 text-[11px] text-gray-600 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300"
                          >
                            {file}
                          </span>
                        ))}
                        {executorResultSummary.changedFiles.length > 10 && (
                          <span className="rounded border border-gray-200 bg-white px-1.5 py-0.5 text-[11px] font-semibold text-gray-600 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300">
                            +{executorResultSummary.changedFiles.length - 10} more
                          </span>
                        )}
                      </div>
                    </div>
                  )}
                  {(executorResultSummary.executorReportPath || executorResultSummary.workspaceReportPath) && (
                    <div className="mt-3 grid gap-2 sm:grid-cols-2">
                      {executorResultSummary.executorReportPath && (
                        <div>
                          <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">
                            Executor report
                          </div>
                          <div className="mono mt-1 break-all text-xs text-gray-700 dark:text-slate-200">
                            {executorResultSummary.executorReportPath}
                          </div>
                        </div>
                      )}
                      {executorResultSummary.workspaceReportPath && (
                        <div>
                          <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">
                            Workspace report
                          </div>
                          <div className="mono mt-1 break-all text-xs text-gray-700 dark:text-slate-200">
                            {executorResultSummary.workspaceReportPath}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                  {(executorResultSummary.executorError || executorResultSummary.projectCommitError) && (
                    <div className="mt-3 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100">
                      {executorResultSummary.executorError && (
                        <div>
                          <span className="font-semibold">Executor error</span>
                          {": "}
                          {[executorResultSummary.executorError.code, executorResultSummary.executorError.message].filter(Boolean).join(" - ")}
                        </div>
                      )}
                      {executorResultSummary.projectCommitError && (
                        <div className={executorResultSummary.executorError ? "mt-1" : ""}>
                          <span className="font-semibold">Project commit error</span>
                          {": "}
                          {[executorResultSummary.projectCommitError.code, executorResultSummary.projectCommitError.message].filter(Boolean).join(" - ")}
                        </div>
                      )}
                    </div>
                  )}
                  {executorResultSummary.agentOutputPreview && (
                    <div className="mt-3 rounded border border-gray-200 bg-white px-3 py-2 text-xs text-gray-700 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200">
                      <div className="font-semibold text-gray-900 dark:text-slate-100">
                        Agent output{executorResultSummary.agentOutputPreviewTruncated ? " (truncated)" : ""}
                      </div>
                      <pre className="mono mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-words text-[11px] leading-relaxed text-gray-600 dark:text-slate-300">{executorResultSummary.agentOutputPreview}</pre>
                    </div>
                  )}
                </div>
              )}
              {executorVisualWorkbenchHandoff && executorVisualWorkbenchHandoff.status !== "not_applicable" && (
                <div className={`rounded-md border p-3 ${
                  executorVisualWorkbenchHandoff.status === "ready_for_selector_readiness"
                    ? "border-sky-200 bg-sky-50 dark:border-sky-500/30 dark:bg-sky-500/10"
                    : "border-amber-200 bg-amber-50 dark:border-amber-500/30 dark:bg-amber-500/10"
                }`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <div className={`text-[11px] font-semibold uppercase tracking-wide ${
                        executorVisualWorkbenchHandoff.status === "ready_for_selector_readiness"
                          ? "text-sky-800 dark:text-sky-100"
                          : "text-amber-800 dark:text-amber-100"
                      }`}
                      >
                        Visual Workbench handoff
                      </div>
                      <div className={`mt-1 text-sm font-semibold ${
                        executorVisualWorkbenchHandoff.status === "ready_for_selector_readiness"
                          ? "text-sky-950 dark:text-sky-50"
                          : "text-amber-950 dark:text-amber-50"
                      }`}
                      >
                        {executorVisualWorkbenchHandoff.title}
                      </div>
                      <p className={`mt-1 text-xs ${
                        executorVisualWorkbenchHandoff.status === "ready_for_selector_readiness"
                          ? "text-sky-900 dark:text-sky-100"
                          : "text-amber-900 dark:text-amber-100"
                      }`}
                      >
                        {executorVisualWorkbenchHandoff.message}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleUseExecutorVisualWorkbenchHandoff(executorVisualWorkbenchHandoff)}
                      disabled={executorVisualWorkbenchHandoff.status !== "ready_for_selector_readiness"}
                      className={`inline-flex h-8 shrink-0 items-center gap-1 rounded-md border px-2 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${
                        executorVisualWorkbenchHandoff.status === "ready_for_selector_readiness"
                          ? "border-sky-300 bg-white text-sky-800 hover:bg-sky-100 dark:border-sky-500/40 dark:bg-slate-950 dark:text-sky-100 dark:hover:bg-slate-900"
                          : "border-amber-300 bg-white text-amber-800 dark:border-amber-500/40 dark:bg-slate-950 dark:text-amber-100"
                      }`}
                    >
                      <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                      Fill selector readiness
                    </button>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-1.5 text-[11px]">
                    <span className="rounded border border-white/70 bg-white px-1.5 py-0.5 font-semibold text-gray-700 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200">
                      task: {executorVisualWorkbenchHandoff.taskId ?? "unknown"}
                    </span>
                    <span className="rounded border border-white/70 bg-white px-1.5 py-0.5 font-semibold text-gray-700 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200">
                      mode: {executorVisualWorkbenchHandoff.visualEvidenceMode ?? "unknown"}
                    </span>
                    <span className="rounded border border-white/70 bg-white px-1.5 py-0.5 font-semibold text-gray-700 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200">
                      project: {executorVisualWorkbenchHandoff.projectClass ?? "unknown"}
                    </span>
                    <span className="rounded border border-white/70 bg-white px-1.5 py-0.5 font-semibold text-gray-700 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200">
                      source: {formatShortSha(executorVisualWorkbenchHandoff.sourceRef)}
                    </span>
                    <span className="rounded border border-white/70 bg-white px-1.5 py-0.5 font-semibold text-gray-700 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200">
                      diff refs: {executorVisualWorkbenchHandoff.acceptedDiffRefs.length}
                    </span>
                  </div>
                  {executorVisualWorkbenchHandoff.acceptedDiffRefs.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {executorVisualWorkbenchHandoff.acceptedDiffRefs.map((source) => (
                        <span
                          key={source}
                          className="mono rounded border border-white/70 bg-white px-1.5 py-0.5 text-[11px] text-gray-600 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300"
                        >
                          {source}
                        </span>
                      ))}
                    </div>
                  )}
                  {executorVisualWorkbenchHandoff.blockers.length > 0 && (
                    <ul className="mt-2 space-y-1 text-xs text-amber-900 dark:text-amber-100">
                      {executorVisualWorkbenchHandoff.blockers.map((blocker) => (
                        <li key={blocker}>{blocker}</li>
                      ))}
                    </ul>
                  )}
                  {executorVisualWorkbenchHandoff.warnings.length > 0 && (
                    <ul className="mt-2 space-y-1 text-xs text-gray-600 dark:text-slate-300">
                      {executorVisualWorkbenchHandoff.warnings.map((warning) => (
                        <li key={warning}>{warning}</li>
                      ))}
                    </ul>
                  )}
                  <p className="mt-2 text-xs text-gray-600 dark:text-slate-300">
                    The Lab only fills known selector-readiness inputs. Capture, export, output directory and config stay explicit next-stage choices.
                  </p>
                </div>
              )}
              {evidenceChainManualHandoff && (
                <div className="rounded-md border border-sky-200 bg-sky-50 p-3 dark:border-sky-500/30 dark:bg-sky-500/10">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <div className="text-[11px] font-semibold uppercase tracking-wide text-sky-800 dark:text-sky-100">
                        Manual evidence handoffs
                      </div>
                      <div className="mt-1 text-sm font-semibold text-sky-950 dark:text-sky-50">
                        Copy one command, then run it manually from the operator shell.
                      </div>
                      <p className="mt-1 text-xs text-sky-900 dark:text-sky-100">
                        These commands come from Ralph evidence-chain readiness. The Lab does not run the next stage, create screenshots or infer Telegram availability.
                      </p>
                    </div>
                    <span className="rounded border border-sky-300 bg-white px-2 py-1 text-xs font-semibold text-sky-800 dark:border-sky-500/40 dark:bg-slate-950 dark:text-sky-100">
                      {evidenceChainManualHandoff.commands.length} command{evidenceChainManualHandoff.commands.length === 1 ? "" : "s"}
                    </span>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-1.5 text-[11px]">
                    <span className="rounded border border-sky-300 bg-white px-1.5 py-0.5 font-semibold text-sky-800 dark:border-sky-500/40 dark:bg-slate-950 dark:text-sky-100">
                      status: {evidenceChainManualHandoff.status.replaceAll("_", " ")}
                    </span>
                    <span className="mono rounded border border-sky-300 bg-white px-1.5 py-0.5 text-sky-800 dark:border-sky-500/40 dark:bg-slate-950 dark:text-sky-100">
                      task: {evidenceChainManualHandoff.selectedTaskId ?? "unknown"}
                    </span>
                    <span className="mono rounded border border-sky-300 bg-white px-1.5 py-0.5 text-sky-800 dark:border-sky-500/40 dark:bg-slate-950 dark:text-sky-100">
                      source: {formatShortSha(evidenceChainManualHandoff.sourceRef)}
                    </span>
                  </div>
                  {evidenceChainManualHandoff.commands.length > 0 ? (
                    <div className="mt-3 grid gap-2">
                      {evidenceChainManualHandoff.commands.map((handoff, index) => (
                        <div
                          key={`${index}:${handoff.command}`}
                          className="flex flex-col gap-2 rounded-md border border-sky-200 bg-white px-3 py-2 dark:border-sky-500/30 dark:bg-slate-950 sm:flex-row sm:items-start sm:justify-between"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="text-xs font-semibold text-sky-950 dark:text-sky-50">
                              {handoff.label}
                            </div>
                            <code className="mono mt-1 block break-all text-xs text-sky-950 dark:text-sky-100">
                              {handoff.command}
                            </code>
                          </div>
                          <button
                            type="button"
                            onClick={() => handleCopyEvidenceChainCommand(handoff.command)}
                            className="inline-flex h-8 shrink-0 items-center justify-center gap-1 rounded-md border border-sky-300 bg-white px-2 text-xs font-semibold text-sky-800 transition hover:bg-sky-100 dark:border-sky-500/40 dark:bg-slate-950 dark:text-sky-100 dark:hover:bg-slate-900"
                          >
                            <Clipboard className="h-3.5 w-3.5" aria-hidden="true" />
                            Copy command
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="mt-3 text-xs text-sky-900 dark:text-sky-100">
                      No next command is ready from this chain result. Fix the explicit blocker, then run this check again.
                    </p>
                  )}
                  <p className="mt-3 text-xs text-sky-900 dark:text-sky-100">
                    Nothing starts automatically from this result; capture, export, assessment, progress publish and Arena readback stay separate explicit actions.
                  </p>
                </div>
              )}
              {screenshotCatalogReadback && (
                <div className="rounded-md border border-indigo-200 bg-indigo-50 p-3 dark:border-indigo-500/30 dark:bg-indigo-500/10">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <div className="text-[11px] font-semibold uppercase tracking-wide text-indigo-800 dark:text-indigo-100">
                        Screenshot catalog
                      </div>
                      <div className="mt-1 text-sm font-semibold text-indigo-950 dark:text-indigo-50">
                        {screenshotCatalogReadback.source === "automation_status"
                          ? "Static viewer path was recorded by the automation diagnostic."
                          : screenshotCatalogReadback.exists === true
                          ? "Static viewer is already recorded."
                          : screenshotCatalogReadback.commandHint
                            ? "Static viewer can be rendered from the capture report."
                            : "Static viewer path is known, but readiness did not include a render command."}
                      </div>
                      <p className="mt-1 text-xs text-indigo-900 dark:text-indigo-100">
                        This handle comes from Ralph captureViewer or automation-status readiness. It is a convenience catalog over capture artifacts, not evidence proof or Telegram screenshot availability.
                      </p>
                    </div>
                    <span className="rounded border border-indigo-300 bg-white px-2 py-1 text-xs font-semibold text-indigo-800 dark:border-indigo-500/40 dark:bg-slate-950 dark:text-indigo-100">
                      {screenshotCatalogReadback.status.replaceAll("_", " ")}
                    </span>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-1.5 text-[11px]">
                    <span className="rounded border border-indigo-300 bg-white px-1.5 py-0.5 font-semibold text-indigo-800 dark:border-indigo-500/40 dark:bg-slate-950 dark:text-indigo-100">
                      source: {screenshotCatalogReadback.source.replaceAll("_", " ")}
                    </span>
                    <span className="mono rounded border border-indigo-300 bg-white px-1.5 py-0.5 text-indigo-800 dark:border-indigo-500/40 dark:bg-slate-950 dark:text-indigo-100">
                      task: {screenshotCatalogReadback.selectedTaskId ?? "unknown"}
                    </span>
                    <span className="mono rounded border border-indigo-300 bg-white px-1.5 py-0.5 text-indigo-800 dark:border-indigo-500/40 dark:bg-slate-950 dark:text-indigo-100">
                      source ref: {formatShortSha(screenshotCatalogReadback.sourceRef)}
                    </span>
                    {screenshotCatalogReadback.captureStatus && (
                      <span className="rounded border border-indigo-300 bg-white px-1.5 py-0.5 text-indigo-800 dark:border-indigo-500/40 dark:bg-slate-950 dark:text-indigo-100">
                        capture: {screenshotCatalogReadback.captureStatus.replaceAll("_", " ")}
                      </span>
                    )}
                    {screenshotCatalogReadback.capturedStories !== null && screenshotCatalogReadback.capturedViewports !== null && (
                      <span className="rounded border border-indigo-300 bg-white px-1.5 py-0.5 text-indigo-800 dark:border-indigo-500/40 dark:bg-slate-950 dark:text-indigo-100">
                        rows: {screenshotCatalogReadback.capturedStories} stories / {screenshotCatalogReadback.capturedViewports} viewports
                      </span>
                    )}
                    {screenshotCatalogReadback.freshness && (
                      <span className="rounded border border-indigo-300 bg-white px-1.5 py-0.5 text-indigo-800 dark:border-indigo-500/40 dark:bg-slate-950 dark:text-indigo-100">
                        freshness: {screenshotCatalogReadback.freshness.replaceAll("_", " ")}
                      </span>
                    )}
                  </div>
                  {screenshotCatalogReadback.viewerPath && (
                    <div className="mt-3 rounded-md border border-indigo-200 bg-white px-3 py-2 dark:border-indigo-500/30 dark:bg-slate-950">
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                        <code className="mono min-w-0 flex-1 break-all text-xs text-indigo-950 dark:text-indigo-100">
                          {screenshotCatalogReadback.viewerPath}
                        </code>
                        <button
                          type="button"
                          onClick={() => {
                            if (screenshotCatalogReadback.viewerPath) {
                              void handleCopyEvidenceChainViewerPath(screenshotCatalogReadback.viewerPath);
                            }
                          }}
                          className="inline-flex h-8 shrink-0 items-center justify-center gap-1 rounded-md border border-indigo-300 bg-white px-2 text-xs font-semibold text-indigo-800 transition hover:bg-indigo-100 dark:border-indigo-500/40 dark:bg-slate-950 dark:text-indigo-100 dark:hover:bg-slate-900"
                        >
                          <Clipboard className="h-3.5 w-3.5" aria-hidden="true" />
                          Copy path
                        </button>
                      </div>
                      {screenshotCatalogFileUrl && (
                        <div className="mt-2 flex flex-col gap-2 border-t border-indigo-100 pt-2 dark:border-indigo-500/20 sm:flex-row sm:items-start sm:justify-between">
                          <code className="mono min-w-0 flex-1 break-all text-xs text-indigo-950 dark:text-indigo-100">
                            {screenshotCatalogFileUrl}
                          </code>
                          <button
                            type="button"
                            onClick={() => {
                              if (screenshotCatalogReadback.viewerPath) {
                                void handleCopyEvidenceChainViewerUrl(screenshotCatalogReadback.viewerPath);
                              }
                            }}
                            className="inline-flex h-8 shrink-0 items-center justify-center gap-1 rounded-md border border-indigo-300 bg-white px-2 text-xs font-semibold text-indigo-800 transition hover:bg-indigo-100 dark:border-indigo-500/40 dark:bg-slate-950 dark:text-indigo-100 dark:hover:bg-slate-900"
                          >
                            <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                            Copy file URL
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                  {screenshotCatalogReadback.commandHint && (
                    <div className="mt-2 flex flex-col gap-2 rounded-md border border-indigo-200 bg-white px-3 py-2 dark:border-indigo-500/30 dark:bg-slate-950 sm:flex-row sm:items-start sm:justify-between">
                      <code className="mono min-w-0 flex-1 break-all text-xs text-indigo-950 dark:text-indigo-100">
                        {screenshotCatalogReadback.commandHint}
                      </code>
                      <button
                        type="button"
                        onClick={() => {
                          if (screenshotCatalogReadback.commandHint) {
                            void handleCopyEvidenceChainCommand(screenshotCatalogReadback.commandHint);
                          }
                        }}
                        className="inline-flex h-8 shrink-0 items-center justify-center gap-1 rounded-md border border-indigo-300 bg-white px-2 text-xs font-semibold text-indigo-800 transition hover:bg-indigo-100 dark:border-indigo-500/40 dark:bg-slate-950 dark:text-indigo-100 dark:hover:bg-slate-900"
                      >
                        <Clipboard className="h-3.5 w-3.5" aria-hidden="true" />
                        Copy render command
                      </button>
                    </div>
                  )}
                  <p className="mt-3 text-xs text-indigo-900 dark:text-indigo-100">
                    Opening this catalog is manual: paste the file URL into a local browser. The Lab does not read raw files, render the viewer, capture screenshots, export evidence or mark screenshot review ready.
                  </p>
                </div>
              )}
              {visualEvidenceReviewLinks.length > 0 && (
                <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 dark:border-emerald-500/30 dark:bg-emerald-500/10">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <div className="text-[11px] font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-200">
                        Screenshot reviews
                      </div>
                      <p className="mt-1 text-xs text-emerald-900 dark:text-emerald-100">
                        These links come from Arena visualEvidenceReviews. Lab does not infer screenshot availability.
                      </p>
                    </div>
                    <span className="rounded border border-emerald-200 bg-white px-2 py-1 text-xs font-semibold text-emerald-700 dark:border-emerald-500/30 dark:bg-slate-950 dark:text-emerald-200">
                      {visualEvidenceReviewLinks.length}
                    </span>
                  </div>
                  <div className="mt-3 grid gap-2">
                    {visualEvidenceReviewLinks.map((review) => (
                      <div
                        key={review.id}
                        className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-emerald-200 bg-white px-3 py-2 dark:border-emerald-500/30 dark:bg-slate-950"
                      >
                        <div className="min-w-0">
                          <div className="truncate text-sm font-semibold text-gray-900 dark:text-slate-100">
                            {review.taskLabel}
                          </div>
                          {review.summary && (
                            <div className="mt-1 truncate text-xs text-gray-600 dark:text-slate-300">
                              {review.summary}
                            </div>
                          )}
                          {review.target && (
                            <div className="mt-1 truncate text-xs text-gray-500 dark:text-slate-400">
                              {review.target}
                            </div>
                          )}
                          <div className="mt-1 flex flex-wrap gap-1.5 text-[11px]">
                            <span className="rounded border border-gray-200 bg-gray-50 px-1.5 py-0.5 font-semibold text-gray-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
                              {review.status}
                            </span>
                            <span className="rounded border border-gray-200 bg-gray-50 px-1.5 py-0.5 font-semibold text-gray-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
                              {review.artifactLabel}
                            </span>
                          </div>
                        </div>
                        <a
                          href={review.href}
                          className="inline-flex h-8 shrink-0 items-center gap-1 rounded-md border border-emerald-300 bg-emerald-600 px-2 text-xs font-semibold text-white transition hover:bg-emerald-700 dark:border-emerald-400 dark:bg-emerald-500 dark:text-slate-950 dark:hover:bg-emerald-400"
                        >
                          <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                          {review.label}
                        </a>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {screenshotReadbackGap && (
                <div className="rounded-md border border-amber-200 bg-amber-50 p-3 dark:border-amber-500/30 dark:bg-amber-500/10">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <div className="text-[11px] font-semibold uppercase tracking-wide text-amber-800 dark:text-amber-100">
                        Screenshot review gap
                      </div>
                      <div className="mt-1 text-sm font-semibold text-amber-950 dark:text-amber-50">
                        {screenshotReadbackGap.title}
                      </div>
                      <p className="mt-1 text-xs text-amber-900 dark:text-amber-100">
                        {screenshotReadbackGap.message}
                      </p>
                    </div>
                    <span className="rounded border border-amber-300 bg-white px-2 py-1 text-xs font-semibold text-amber-800 dark:border-amber-500/40 dark:bg-slate-950 dark:text-amber-100">
                      {screenshotReadbackGap.status.replaceAll("_", " ")}
                    </span>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-1.5 text-[11px]">
                    <span className="rounded border border-amber-300 bg-white px-1.5 py-0.5 font-semibold text-amber-800 dark:border-amber-500/40 dark:bg-slate-950 dark:text-amber-100">
                      reason: {screenshotReadbackGap.reasonCode.replaceAll("_", " ")}
                    </span>
                    <span className="rounded border border-amber-300 bg-white px-1.5 py-0.5 font-semibold text-amber-800 dark:border-amber-500/40 dark:bg-slate-950 dark:text-amber-100">
                      rows: {screenshotReadbackGap.reviewableRows}/{screenshotReadbackGap.recordedRows} reviewable
                    </span>
                  </div>
                  <p className="mt-3 text-xs text-amber-900 dark:text-amber-100">
                    Next: {screenshotReadbackGap.nextAction}
                  </p>
                  <div className="mt-3">
                    {screenshotReadbackGap.recordedRows > 0 ? (
                      <button
                        type="button"
                        onClick={handleUseVisualEvidenceArtifactCheck}
                        disabled={!stageIds.has("visual_evidence_artifact_check")}
                        className="inline-flex h-8 items-center gap-1 rounded-md border border-amber-300 bg-white px-2 text-xs font-semibold text-amber-800 transition hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-amber-500/40 dark:bg-slate-950 dark:text-amber-100 dark:hover:bg-slate-900"
                      >
                        <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                        Use file check
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={handleUseVisualEvidenceIngestHandoff}
                        disabled={!stageIds.has("visual_evidence_ingest")}
                        className="inline-flex h-8 items-center gap-1 rounded-md border border-amber-300 bg-white px-2 text-xs font-semibold text-amber-800 transition hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-amber-500/40 dark:bg-slate-950 dark:text-amber-100 dark:hover:bg-slate-900"
                      >
                        <Clipboard className="h-3.5 w-3.5" aria-hidden="true" />
                        Use ingest handoff
                      </button>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-amber-800 dark:text-amber-100">
                    No Telegram screenshot button is expected until Arena exposes reviewable visualEvidenceReviews.
                  </p>
                </div>
              )}
              {visualEvidenceArtifactCheckRows.length > 0 && (
                <div className="rounded-md border border-gray-200 bg-gray-50 p-3 dark:border-slate-800 dark:bg-slate-900/70">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">
                        Screenshot file checks
                      </div>
                      <p className="mt-1 text-xs text-gray-600 dark:text-slate-300">
                        Downloadability is checked through Arena&apos;s artifact owner. Raw bytes and storage paths are not shown.
                      </p>
                    </div>
                    <span className="rounded border border-gray-200 bg-white px-2 py-1 text-xs font-semibold text-gray-600 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300">
                      {visualEvidenceArtifactCheckRows.length}
                    </span>
                  </div>
                  <div className="mt-3 grid gap-2">
                    {visualEvidenceArtifactCheckRows.map((row) => {
                      const downloadable = row.downloadStatus === "downloadable";
                      return (
                        <div
                          key={row.reviewId}
                          className="rounded-md border border-gray-200 bg-white px-3 py-2 dark:border-slate-800 dark:bg-slate-950"
                        >
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="truncate text-sm font-semibold text-gray-900 dark:text-slate-100">
                                {row.taskLabel}
                              </div>
                              <div className="mono mt-1 truncate text-[11px] text-gray-500 dark:text-slate-400">
                                {row.reviewId}
                              </div>
                            </div>
                            <span className={`rounded border px-2 py-1 text-xs font-semibold ${
                              downloadable
                                ? "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-200"
                                : "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200"
                            }`}
                            >
                              {downloadable ? "Downloadable" : row.downloadStatus.replaceAll("_", " ")}
                            </span>
                          </div>
                          <div className="mt-2 flex flex-wrap gap-1.5 text-[11px]">
                            <span className="rounded border border-gray-200 bg-gray-50 px-1.5 py-0.5 font-semibold text-gray-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
                              {row.reviewStatus}
                            </span>
                            <span className="rounded border border-gray-200 bg-gray-50 px-1.5 py-0.5 font-semibold text-gray-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
                              {row.contentType ?? "content type unknown"}
                            </span>
                            <span className="rounded border border-gray-200 bg-gray-50 px-1.5 py-0.5 font-semibold text-gray-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
                              {formatByteLength(row.byteLength)}
                            </span>
                            <span className="mono rounded border border-gray-200 bg-gray-50 px-1.5 py-0.5 text-gray-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
                              {formatShortShaLabel(row.sha256)}
                            </span>
                          </div>
                          {row.reasonCode && (
                            <div className="mt-2 text-xs text-amber-700 dark:text-amber-200">
                              {row.reasonCode.replaceAll("_", " ")}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
              {candidateScanNotice && (
                <div className={candidateScanNotice.tone === "warning"
                  ? "rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100"
                  : "rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-900 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-100"}
                >
                  <div className="font-semibold uppercase tracking-wide opacity-70">
                    {candidateScanNotice.title}
                  </div>
                  <p className="mt-1">
                    {candidateScanNotice.body}
                  </p>
                </div>
              )}
              {candidateScanProjects.length > 0 && (
                <div className="rounded-md border border-gray-200 bg-gray-50 p-3 dark:border-slate-800 dark:bg-slate-900/70">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">
                        Candidate projects
                      </div>
                      <p className="mt-1 text-xs text-gray-600 dark:text-slate-300">
                        Pick one task, then either get task context or prepare the executor action.
                      </p>
                    </div>
                    <span className="rounded border border-gray-200 bg-white px-2 py-1 text-xs font-semibold text-gray-600 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300">
                      {candidateScanProjects.length}
                    </span>
                  </div>
                  <div className="mt-3 grid gap-2">
                    {candidateScanProjects.map((project) => (
                      <div
                        key={project.projectId}
                        className="rounded-md border border-gray-200 bg-white px-3 py-2 dark:border-slate-800 dark:bg-slate-950"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="min-w-0">
                            <div className="truncate text-sm font-semibold text-gray-900 dark:text-slate-100">
                              {project.projectName}
                            </div>
                            <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px]">
                              <span className="mono rounded border border-gray-200 bg-gray-50 px-1.5 py-0.5 text-gray-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
                                {project.projectId}
                              </span>
                              <span className="rounded border border-sky-200 bg-sky-50 px-1.5 py-0.5 font-semibold text-sky-800 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-100">
                                {project.classification}
                              </span>
                              <span className="rounded border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 font-semibold text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-100">
                                {project.previewHealth}
                              </span>
                            </div>
                            <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px]">
                              <span className="rounded border border-gray-200 bg-gray-50 px-1.5 py-0.5 font-semibold text-gray-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
                                {formatCandidateProjectVisualPolicy(project)}
                              </span>
                              <span className={candidateProjectStoriesClasses(project)}>
                                {formatCandidateProjectStoriesReadiness(project)}
                              </span>
                              {project.visualWorkbenchProjectClass && (
                                <span className="rounded border border-gray-200 bg-gray-50 px-1.5 py-0.5 font-semibold text-gray-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
                                  Class: {formatCandidateProjectClass(project.visualWorkbenchProjectClass)}
                                </span>
                              )}
                              {project.visualEvidencePolicyBlockers.length > 0 && (
                                <span className="rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 font-semibold text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100">
                                  {project.visualEvidencePolicyBlockers.length} policy blocker{project.visualEvidencePolicyBlockers.length === 1 ? "" : "s"}
                                </span>
                              )}
                              {project.visualWorkbenchManifestBlockers.length > 0 && (
                                <span className="rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 font-semibold text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100">
                                  {project.visualWorkbenchManifestBlockers.length} story blocker{project.visualWorkbenchManifestBlockers.length === 1 ? "" : "s"}
                                </span>
                              )}
                              {project.visualWorkbenchManifestUnknowns.length > 0 && (
                                <span className="rounded border border-gray-200 bg-gray-50 px-1.5 py-0.5 font-semibold text-gray-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
                                  {project.visualWorkbenchManifestUnknowns.length} story unknown{project.visualWorkbenchManifestUnknowns.length === 1 ? "" : "s"}
                                </span>
                              )}
                            </div>
                          </div>
                          <span className="rounded border border-gray-200 bg-gray-50 px-2 py-1 text-xs font-semibold text-gray-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
                            {project.candidates.length} task{project.candidates.length === 1 ? "" : "s"}
                          </span>
                        </div>
                        {(project.directExecutorCandidateCount !== null || project.resumeCheckpointRequiredCount !== null) && (
                          <div className="mt-2 flex flex-wrap gap-1.5 text-[11px]">
                            {project.directExecutorCandidateCount !== null && (
                              <span className="rounded border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 font-semibold text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-100">
                                {project.directExecutorCandidateCount} executor-ready
                              </span>
                            )}
                            {project.resumeCheckpointRequiredCount !== null && project.resumeCheckpointRequiredCount > 0 && (
                              <span className="rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 font-semibold text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100">
                                {project.resumeCheckpointRequiredCount} need checkpoint
                              </span>
                            )}
                          </div>
                        )}
                        {(project.visualEvidenceRequiredCount !== null
                          || project.visualEvidenceNotRequiredCount !== null
                          || project.visualEvidenceUnknownCount !== null) && (
                          <div className="mt-2 flex flex-wrap gap-1.5 text-[11px]">
                            {project.visualEvidenceRequiredCount !== null && project.visualEvidenceRequiredCount > 0 && (
                              <span className="rounded border border-violet-200 bg-violet-50 px-1.5 py-0.5 font-semibold text-violet-800 dark:border-violet-500/30 dark:bg-violet-500/10 dark:text-violet-100">
                                {project.visualEvidenceRequiredCount} visual-marked
                              </span>
                            )}
                            {project.visualEvidenceNotRequiredCount !== null && project.visualEvidenceNotRequiredCount > 0 && (
                              <span className="rounded border border-gray-200 bg-gray-50 px-1.5 py-0.5 font-semibold text-gray-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
                                {project.visualEvidenceNotRequiredCount} visual-off
                              </span>
                            )}
                            {project.visualEvidenceUnknownCount !== null && project.visualEvidenceUnknownCount > 0 && (
                              <span className="rounded border border-gray-200 bg-gray-50 px-1.5 py-0.5 font-semibold text-gray-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
                                {project.visualEvidenceUnknownCount} visual-unmarked
                              </span>
                            )}
                          </div>
                        )}
                        <div className="mt-3 grid gap-2">
                          {project.candidates.map((candidate) => {
                            const readinessNote = getExecutorCandidateReadinessNote(candidate.recommendedExecutorMode);
                            return (
                              <div
                                key={`${project.projectId}:${candidate.id}`}
                                className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-gray-200 bg-gray-50 px-3 py-2 dark:border-slate-800 dark:bg-slate-900"
                              >
                                <div className="min-w-0">
                                  <div className="flex flex-wrap items-center gap-1.5">
                                    <span className="mono rounded border border-gray-200 bg-white px-1.5 py-0.5 text-[11px] text-gray-600 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300">
                                      {candidate.id}
                                    </span>
                                    <span className="rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[11px] font-semibold text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100">
                                      {formatTaskCandidateStatus(candidate.status)}
                                    </span>
                                    <span className="rounded border border-sky-200 bg-sky-50 px-1.5 py-0.5 text-[11px] font-semibold text-sky-800 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-100">
                                      {formatExecutorMode(candidate.recommendedExecutorMode)}
                                    </span>
                                  </div>
                                  <div className="mt-1 truncate text-sm font-semibold text-gray-900 dark:text-slate-100">
                                    {candidate.title}
                                  </div>
                                  <div className="mt-1 text-xs text-gray-500 dark:text-slate-400">
                                    {formatVisualEvidenceRequirement(candidate.visualEvidenceRequired)}
                                    {candidate.feedbackItemRefCount > 0 ? `, ${candidate.feedbackItemRefCount} feedback ref` : ", no feedback refs"}
                                    {candidate.attempts !== null ? `, ${candidate.attempts} attempt${candidate.attempts === 1 ? "" : "s"}` : ""}
                                  </div>
                                  {readinessNote && (
                                    <div className="mt-1 text-xs text-amber-700 dark:text-amber-200">
                                      {readinessNote}
                                    </div>
                                  )}
                                </div>
                                <div className="flex shrink-0 flex-wrap gap-1.5">
                                  <button
                                    type="button"
                                    onClick={() => handleUseCandidateScanTask(project.projectId, candidate.id, candidate.recommendedExecutorMode)}
                                    className="inline-flex h-8 items-center gap-1 rounded-md border border-gray-300 bg-white px-2 text-xs font-semibold text-gray-700 transition hover:bg-gray-100 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200 dark:hover:bg-slate-900"
                                  >
                                    <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                                    Get context
                                  </button>
                                  {candidate.visualEvidenceRequired === true && (
                                    <button
                                      type="button"
                                      onClick={() => handleUseCandidateScanVisualTaskContext(project.projectId, candidate.id)}
                                      className="inline-flex h-8 items-center gap-1 rounded-md border border-violet-300 bg-violet-50 px-2 text-xs font-semibold text-violet-800 transition hover:bg-violet-100 dark:border-violet-500/40 dark:bg-violet-500/10 dark:text-violet-100 dark:hover:bg-violet-500/20"
                                    >
                                      <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                                      Get context
                                    </button>
                                  )}
                                  {candidate.recommendedExecutorMode === "resume_interrupted" ? (
                                    <span className="inline-flex h-8 items-center rounded-md border border-amber-200 bg-amber-50 px-2 text-xs font-semibold text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100">
                                      Get context first
                                    </span>
                                  ) : (
                                    <button
                                      type="button"
                                      onClick={() => handleUseCandidateScanExecutorTask(project.projectId, candidate.id, candidate.recommendedExecutorMode)}
                                      className="inline-flex h-8 items-center gap-1 rounded-md border border-emerald-300 bg-emerald-50 px-2 text-xs font-semibold text-emerald-800 transition hover:bg-emerald-100 dark:border-emerald-500/40 dark:bg-emerald-500/10 dark:text-emerald-100 dark:hover:bg-emerald-500/20"
                                    >
                                      <Play className="h-3.5 w-3.5" aria-hidden="true" />
                                      Use for executor
                                    </button>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {snapshotNextHandoff.length > 0 && (
                <div className="rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-900 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-100">
                  <div className="font-semibold uppercase tracking-wide opacity-70">
                    Next step
                  </div>
                  <ul className="mt-1 space-y-1">
                    {snapshotNextHandoff.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </div>
              )}
              {snapshotExecutorCheckpointReadback && (
                <div className={`rounded-md border px-3 py-2 text-xs ${checkpointReadbackBorderClasses(snapshotExecutorCheckpointReadback.tone)}`}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <div className="font-semibold uppercase tracking-wide opacity-70">
                        Executor checkpoint readback
                      </div>
                      <div className="mt-1 text-sm font-semibold">
                        {snapshotExecutorCheckpointReadback.title}
                      </div>
                    </div>
                    <span className="rounded border border-current/20 bg-white/40 px-2 py-1 text-[11px] font-semibold dark:bg-slate-950/30">
                      {snapshotExecutorCheckpointReadback.status.replaceAll("_", " ")}
                    </span>
                  </div>
                  <p className="mt-1">
                    {snapshotExecutorCheckpointReadback.message}
                  </p>
                  {snapshotExecutorCheckpointReadback.nextProjectActionId === "resume_agent" && (
                    <button
                      type="button"
                      onClick={handleUseCheckpointResumeAgentHandoff}
                      className="mt-2 inline-flex h-8 items-center gap-1 rounded-md border border-amber-300 bg-white px-2 text-xs font-semibold text-amber-900 transition hover:bg-amber-100 dark:border-amber-500/40 dark:bg-slate-950 dark:text-amber-100 dark:hover:bg-amber-500/20"
                    >
                      <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                      Select Resume agent
                    </button>
                  )}
                  <div className="mt-2 flex flex-wrap gap-1.5 text-[11px]">
                    <span className="rounded border border-current/20 bg-white/40 px-1.5 py-0.5 font-semibold dark:bg-slate-950/30">
                      task {snapshotExecutorCheckpointReadback.selectedTaskId ?? "not selected"}
                    </span>
                    <span className="rounded border border-current/20 bg-white/40 px-1.5 py-0.5 font-semibold dark:bg-slate-950/30">
                      {snapshotExecutorCheckpointReadback.recommendedExecutorMode
                        ? formatExecutorMode(snapshotExecutorCheckpointReadback.recommendedExecutorMode)
                        : "mode unavailable"}
                    </span>
                    <span className="rounded border border-current/20 bg-white/40 px-1.5 py-0.5 font-semibold dark:bg-slate-950/30">
                      checkpoint {snapshotExecutorCheckpointReadback.providerSessionStatus ?? "unavailable"}
                    </span>
                    <span className="rounded border border-current/20 bg-white/40 px-1.5 py-0.5 font-semibold dark:bg-slate-950/30">
                      {snapshotExecutorCheckpointReadback.selectedTaskSessionCount ?? 0} selected-task session{snapshotExecutorCheckpointReadback.selectedTaskSessionCount === 1 ? "" : "s"}
                    </span>
                    {snapshotExecutorCheckpointReadback.recommendedExecutorMode === "resume_interrupted" && (
                      <span className="rounded border border-current/20 bg-white/40 px-1.5 py-0.5 font-semibold dark:bg-slate-950/30">
                        {snapshotExecutorCheckpointReadback.selectedTaskResumableSessionCount ?? 0} resumable
                      </span>
                    )}
                  </div>
                </div>
              )}
              {snapshotSelectedTaskVisualReadback && (
                <div className={`rounded-md border px-3 py-2 text-xs ${checkpointReadbackBorderClasses(snapshotSelectedTaskVisualReadback.tone)}`}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <div className="font-semibold uppercase tracking-wide opacity-70">
                        Visual task readback
                      </div>
                      <div className="mt-1 text-sm font-semibold">
                        {snapshotSelectedTaskVisualReadback.title}
                      </div>
                    </div>
                    <span className="rounded border border-current/20 bg-white/40 px-2 py-1 text-[11px] font-semibold dark:bg-slate-950/30">
                      {snapshotSelectedTaskVisualReadback.status.replaceAll("_", " ")}
                    </span>
                  </div>
                  <p className="mt-1">
                    {snapshotSelectedTaskVisualReadback.message}
                  </p>
                  {snapshotSelectedTaskVisualReadback.canCheckStorySelection && (
                    <button
                      type="button"
                      onClick={() => handleUseSelectedTaskVisualReadback(snapshotSelectedTaskVisualReadback)}
                      className="mt-2 inline-flex h-8 items-center gap-1 rounded-md border border-violet-300 bg-white px-2 text-xs font-semibold text-violet-900 transition hover:bg-violet-100 dark:border-violet-500/40 dark:bg-slate-950 dark:text-violet-100 dark:hover:bg-violet-500/20"
                    >
                      <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                      Select Check stories
                    </button>
                  )}
                  <div className="mt-2 flex flex-wrap gap-1.5 text-[11px]">
                    <span className="rounded border border-current/20 bg-white/40 px-1.5 py-0.5 font-semibold dark:bg-slate-950/30">
                      task {snapshotSelectedTaskVisualReadback.selectedTaskId ?? "not selected"}
                    </span>
                    <span className="rounded border border-current/20 bg-white/40 px-1.5 py-0.5 font-semibold dark:bg-slate-950/30">
                      policy {snapshotSelectedTaskVisualReadback.visualEvidenceMode ?? snapshotSelectedTaskVisualReadback.visualEvidencePolicyStatus}
                    </span>
                    <span className="rounded border border-current/20 bg-white/40 px-1.5 py-0.5 font-semibold dark:bg-slate-950/30">
                      stories {snapshotSelectedTaskVisualReadback.canRunWorkbenchCapture ? "ready" : snapshotSelectedTaskVisualReadback.visualWorkbenchManifestStatus ?? "unknown"}
                    </span>
                    {snapshotSelectedTaskVisualReadback.visualExpectationSources.length > 0 && (
                      <span className="rounded border border-current/20 bg-white/40 px-1.5 py-0.5 font-semibold dark:bg-slate-950/30">
                        {snapshotSelectedTaskVisualReadback.visualExpectationSources.join(", ")}
                      </span>
                    )}
                  </div>
                </div>
              )}
              {snapshotSuggestedFilePath && (
                <div className="rounded-md border border-sky-200 bg-sky-50 p-3 dark:border-sky-500/30 dark:bg-sky-500/10">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <div className="text-[11px] font-semibold uppercase tracking-wide text-sky-800 dark:text-sky-100">
                        Suggested CLI task context file
                      </div>
                      <p className="mt-1 text-xs text-sky-900 dark:text-sky-100">
                        Lab does not write this file. Save the copied or downloaded task context JSON to this path before running a planner, executor or controller CLI stage.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={handleCopySnapshotPath}
                      className="inline-flex h-8 shrink-0 items-center gap-1 rounded-md border border-sky-300 bg-white px-2 text-xs font-semibold text-sky-800 transition hover:bg-sky-100 dark:border-sky-500/40 dark:bg-slate-950 dark:text-sky-100 dark:hover:bg-slate-900"
                    >
                      <Clipboard className="h-3.5 w-3.5" aria-hidden="true" />
                      Copy path
                    </button>
                  </div>
                  <code className="mono mt-2 block overflow-auto rounded border border-sky-200 bg-white px-2 py-1 text-xs text-sky-900 dark:border-sky-500/30 dark:bg-slate-950 dark:text-sky-100">
                    {snapshotSuggestedFilePath}
                  </code>
                </div>
              )}
              {snapshotTaskCandidates.length > 0 && (
                <div className="rounded-md border border-gray-200 bg-gray-50 p-3 dark:border-slate-800 dark:bg-slate-900/70">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">
                        Task candidates
                      </div>
                      <p className="mt-1 text-xs text-gray-600 dark:text-slate-300">
                        Pick one task, refresh its context or prepare the executor action. Nothing starts automatically.
                      </p>
                    </div>
                    <span className="rounded border border-gray-200 bg-white px-2 py-1 text-xs font-semibold text-gray-600 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300">
                      {snapshotTaskCandidates.length}
                    </span>
                  </div>
                  <div className="mt-3 grid gap-2">
                    {snapshotTaskCandidates.map((candidate) => {
                      const readinessNote = getExecutorCandidateReadinessNote(candidate.recommendedExecutorMode);
                      const canPrepareExecutor = canPrepareExecutorFromSnapshotReadback(candidate, snapshotExecutorCheckpointReadback);
                      const canSelectResumeAgent = canSelectResumeAgentFromSnapshotReadback(candidate, snapshotExecutorCheckpointReadback);
                      const canCheckStorySelection = canCheckStorySelectionFromSnapshotReadback(candidate, snapshotSelectedTaskVisualReadback);
                      return (
                        <div
                          key={candidate.id}
                          className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-gray-200 bg-white px-3 py-2 dark:border-slate-800 dark:bg-slate-950"
                        >
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className="mono rounded border border-gray-200 bg-gray-50 px-1.5 py-0.5 text-[11px] text-gray-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
                                {candidate.id}
                              </span>
                              <span className="rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[11px] font-semibold text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100">
                                {formatTaskCandidateStatus(candidate.status)}
                              </span>
                              <span className="rounded border border-sky-200 bg-sky-50 px-1.5 py-0.5 text-[11px] font-semibold text-sky-800 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-100">
                                {formatExecutorMode(candidate.recommendedExecutorMode)}
                              </span>
                            </div>
                            <div className="mt-1 truncate text-sm font-semibold text-gray-900 dark:text-slate-100">
                              {candidate.title}
                            </div>
                            <div className="mt-1 text-xs text-gray-500 dark:text-slate-400">
                              {formatVisualEvidenceRequirement(candidate.visualEvidenceRequired)}
                              {candidate.feedbackItemRefCount > 0 ? `, ${candidate.feedbackItemRefCount} feedback ref` : ", no feedback refs"}
                              {candidate.attempts !== null ? `, ${candidate.attempts} attempt${candidate.attempts === 1 ? "" : "s"}` : ""}
                            </div>
                            {readinessNote && (
                              <div className="mt-1 text-xs text-amber-700 dark:text-amber-200">
                                {readinessNote}
                              </div>
                            )}
                            {candidate.lastError && (
                              <div className="mt-1 break-words text-xs text-rose-600 dark:text-rose-300">
                                {candidate.lastError}
                              </div>
                            )}
                          </div>
                          <div className="flex shrink-0 flex-wrap gap-1.5">
                            <button
                              type="button"
                              onClick={() => handleUseSnapshotTaskCandidate(candidate.id, candidate.recommendedExecutorMode)}
                              className="inline-flex h-8 items-center gap-1 rounded-md border border-gray-300 bg-white px-2 text-xs font-semibold text-gray-700 transition hover:bg-gray-100 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200 dark:hover:bg-slate-900"
                            >
                              <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                              Use task id
                            </button>
                            {canCheckStorySelection && snapshotSelectedTaskVisualReadback && (
                              <button
                                type="button"
                                onClick={() => handleUseSelectedTaskVisualReadback(snapshotSelectedTaskVisualReadback)}
                                className="inline-flex h-8 items-center gap-1 rounded-md border border-violet-300 bg-violet-50 px-2 text-xs font-semibold text-violet-800 transition hover:bg-violet-100 dark:border-violet-500/40 dark:bg-violet-500/10 dark:text-violet-100 dark:hover:bg-violet-500/20"
                              >
                                <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                                Check stories
                              </button>
                            )}
                            {canSelectResumeAgent ? (
                              <button
                                type="button"
                                onClick={handleUseCheckpointResumeAgentHandoff}
                                className="inline-flex h-8 items-center gap-1 rounded-md border border-amber-300 bg-amber-50 px-2 text-xs font-semibold text-amber-900 transition hover:bg-amber-100 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-100 dark:hover:bg-amber-500/20"
                              >
                                <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                                Select Resume agent
                              </button>
                            ) : (
                              <button
                                type="button"
                                onClick={() => handleUseExecutorTaskCandidate(candidate.id, candidate.recommendedExecutorMode)}
                                disabled={!canPrepareExecutor}
                                className="inline-flex h-8 items-center gap-1 rounded-md border border-emerald-300 bg-emerald-50 px-2 text-xs font-semibold text-emerald-800 transition hover:bg-emerald-100 disabled:cursor-not-allowed disabled:border-amber-200 disabled:bg-amber-50 disabled:text-amber-800 disabled:opacity-80 dark:border-emerald-500/40 dark:bg-emerald-500/10 dark:text-emerald-100 dark:hover:bg-emerald-500/20 dark:disabled:border-amber-500/30 dark:disabled:bg-amber-500/10 dark:disabled:text-amber-100"
                              >
                                <Play className="h-3.5 w-3.5" aria-hidden="true" />
                                {canPrepareExecutor ? "Use for executor" : "Checkpoint first"}
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
              {Array.isArray(runResult.evidenceNotes) && runResult.evidenceNotes.length > 0 && (
                <details className="text-xs text-gray-500 dark:text-slate-400">
                  <summary className="cursor-pointer font-medium text-gray-600 dark:text-slate-300">
                    Audit notes
                  </summary>
                  <ul className="mt-2 space-y-1">
                    {runResult.evidenceNotes.map((note) => (
                      <li key={note}>{note}</li>
                    ))}
                  </ul>
                </details>
              )}
              <details className="text-xs text-gray-500 dark:text-slate-400">
                <summary className="cursor-pointer font-medium text-gray-600 dark:text-slate-300">
                  Technical result JSON
                </summary>
                <pre className="mt-2 max-h-[520px] overflow-auto rounded-md bg-gray-50 p-3 leading-relaxed text-gray-800 dark:bg-slate-900 dark:text-slate-200">
                  {JSON.stringify(runResult, null, 2)}
                </pre>
              </details>
            </div>
          </section>
        )}

      </div>
    </div>
  );
}
