import {
  CONTROLLER_VISUAL_REVIEW_STAGE_CATALOG_ENTRY,
  formatControllerVisualReviewResult,
  runControllerVisualReviewFixtureFile,
} from './controller-visual-review.js';
import {
  CONTROLLER_PROJECT_DRY_RUN_RESULT_SCHEMA_VERSION,
} from './controller-project-dry-run.js';
import {
  EXECUTOR_TASK_IO_STAGE_CATALOG_ENTRY,
  formatExecutorTaskIoResult,
  runExecutorTaskIoFixtureFile,
} from './executor-task-io.js';
import {
  EXECUTOR_PROJECT_TASK_RESULT_SCHEMA_VERSION,
} from './executor-project-task.js';
import {
  EXECUTOR_TASK_WORKSPACE_RESULT_SCHEMA_VERSION,
} from './executor-task-workspace.js';
import {
  EXECUTOR_TASK_WORKSPACE_CONTINUE_RESULT_SCHEMA_VERSION,
} from './executor-task-workspace-continue.js';
import {
  EXECUTOR_WORKSPACE_SOURCE_SNAPSHOT_SCHEMA_VERSION,
} from './executor-workspace-source-snapshot.js';
import {
  PLANNER_PROMPT_IO_STAGE_CATALOG_ENTRY,
  formatPlannerPromptIoResult,
  runPlannerPromptIoFixtureFile,
} from './planner-prompt-io.js';
import {
  PLANNER_PROJECT_DRY_RUN_RESULT_SCHEMA_VERSION,
} from './planner-project-dry-run.js';
import {
  PLANNER_SPEC_MIGRATION_APPLY_RESULT_SCHEMA_VERSION,
} from './planner-spec-migration-apply.js';
import {
  PROMPT_LAB_FIXTURE_SCHEMA_VERSION,
  PROMPT_LAB_REPLAY_RESULT_SCHEMA_VERSION,
  PROMPT_LAB_SUPPORTED_PROMPT_IDS,
} from '../prompts/prompt-lab.js';
import {
  PLATFORM_BROWSER_READINESS_SCHEMA_VERSION,
} from '../verification/browser-readiness.js';
import {
  VISUAL_WORKBENCH_CAPTURE_VIEWER_SCHEMA_VERSION,
  VISUAL_WORKBENCH_CAPTURE_RUN_SCHEMA_VERSION,
  VISUAL_WORKBENCH_INSPECT_RESULT_SCHEMA_VERSION,
} from '../verification/visual-workbench-runner.js';
import {
  VISUAL_WORKBENCH_AUTOMATION_OWNER_BOUNDARY,
  VISUAL_WORKBENCH_AUTOMATION_SCHEMA_VERSION,
  VISUAL_WORKBENCH_AUTOMATION_STATUS_SCHEMA_VERSION,
} from '../verification/visual-workbench-automation.js';
import {
  EXECUTOR_ACTION_CORE_OWNER_BOUNDARY,
} from '../loop/executor-action-core.js';
import {
  VISUAL_WORKBENCH_ASSESSMENT_SCHEMA_VERSION,
  VISUAL_WORKBENCH_EVIDENCE_CHAIN_READINESS_SCHEMA_VERSION,
  VISUAL_WORKBENCH_EVIDENCE_EXPORT_SCHEMA_VERSION,
  VISUAL_WORKBENCH_PROGRESS_PUBLISH_SCHEMA_VERSION,
  VISUAL_WORKBENCH_SELECTOR_READINESS_SCHEMA_VERSION,
  VISUAL_WORKBENCH_SHELL_POLICY_SCHEMA_VERSION,
  VISUAL_WORKBENCH_STATUS_SCHEMA_VERSION,
} from '../verification/visual-workbench-evidence.js';

export const STAGE_CATALOG_SCHEMA_VERSION = 'ra-356.stage-catalog.v2' as const;

export type StageCatalogEntry = {
  stageId: string;
  status: 'supported_now' | 'target_shape';
  modes: Array<'read_only' | 'fixture' | 'workspace_dry_run' | 'workspace_mutation' | 'artifact_write' | 'worker_path' | 'operator_mutation'>;
  runSurface: 'stage_run_fixture' | 'stage_run_workspace' | 'direct_cli';
  ownerBoundary: string;
  purpose: string;
  currentCommand: string;
  fixtureSchemaVersion: string | null;
  resultSchemaVersion: string | null;
  promptIds: string[];
  fixtureExamples: string[];
  allowedMutationSummary: string[];
  forbiddenMutationSummary: string[];
  handoff: string[];
  notes: string[];
};

type StageFixtureRunner = {
  entry: StageCatalogEntry;
  runFixtureFile: (input: {
    fixturePath: string;
    outPath?: string;
    compact?: boolean;
  }) => Promise<unknown>;
  formatResult: (result: any, compact?: boolean) => string;
};

export type StageFixtureRunResult = {
  stageId: string;
  result: unknown;
  formatted: string;
};

export type StageCatalogResult = {
  schemaVersion: typeof STAGE_CATALOG_SCHEMA_VERSION;
  owner: 'ralph.stage-lab.catalog';
  mode: 'static_code_catalog';
  scope: 'supported_stage_workflows';
  stages: StageCatalogEntry[];
  notes: string[];
};

const SUPPORTED_STAGE_FIXTURE_RUNNERS: Record<string, StageFixtureRunner> = {
  planner_prompt_io: {
    entry: PLANNER_PROMPT_IO_STAGE_CATALOG_ENTRY,
    runFixtureFile: runPlannerPromptIoFixtureFile,
    formatResult: formatPlannerPromptIoResult,
  },
  executor_task_io: {
    entry: EXECUTOR_TASK_IO_STAGE_CATALOG_ENTRY,
    runFixtureFile: runExecutorTaskIoFixtureFile,
    formatResult: formatExecutorTaskIoResult,
  },
  controller_visual_review: {
    entry: CONTROLLER_VISUAL_REVIEW_STAGE_CATALOG_ENTRY,
    runFixtureFile: runControllerVisualReviewFixtureFile,
    formatResult: formatControllerVisualReviewResult,
  },
};

export const SUPPORTED_STAGE_CATALOG_ENTRIES: StageCatalogEntry[] = Object.values(SUPPORTED_STAGE_FIXTURE_RUNNERS)
  .map((runner) => runner.entry)
  .concat([
    {
      stageId: 'project_spec_artifact_audit',
      status: 'supported_now',
      modes: ['read_only'],
      runSurface: 'direct_cli',
      ownerBoundary: 'governance.spec-artifact-audit',
      purpose: 'Read current AcceptedSpecArtifact import/audit status for a project before launching or debugging a canary.',
      currentCommand: 'services/arena-ctl/cli.sh project_spec_artifact_audit --project-id <id>',
      fixtureSchemaVersion: null,
      resultSchemaVersion: null,
      promptIds: [],
      fixtureExamples: [],
      allowedMutationSummary: [
        'none; read-only governance spec artifact audit',
      ],
      forbiddenMutationSummary: [
        'no workspace/spec-input file inspection as truth',
        'no direct DB write',
        'no import or repair',
        'no lifecycle/runtime/task/evidence/proof writes',
      ],
      handoff: [
        'run_tg_spec_accepted_artifact_import_if_missing',
        'run_tg_spec_launch_configure_after_artifact_identity_is_present',
        'inspect_project_experiment_preflight_after_launch',
      ],
      notes: [
        'This stage reads the same governance spec-artifact audit owner exposed through admin ctl.',
        'It exists so operators can verify accepted artifact identity without relying on stale MCP or raw DB inspection.',
      ],
    },
    {
      stageId: 'runtime_auth_readiness',
      status: 'supported_now',
      modes: ['read_only'],
      runSurface: 'direct_cli',
      ownerBoundary: 'governance.runtime-auth-readiness',
      purpose: 'Read sanitized authd and TokenManager provider readiness before starting or retrying agent runs.',
      currentCommand: 'services/arena-ctl/cli.sh authd_health',
      fixtureSchemaVersion: null,
      resultSchemaVersion: null,
      promptIds: [],
      fixtureExamples: [],
      allowedMutationSummary: [
        'none; read-only governance authd health and TokenManager status projections',
      ],
      forbiddenMutationSummary: [
        'no provider refresh or token rotation',
        'no mint-run-auth call',
        'no auth file write or token print',
        'no project retry/relaunch/recreate',
        'no lifecycle/runtime/task/evidence/proof writes',
      ],
      handoff: [
        'run_project_experiment_preflight_after_auth_ready',
        'operator_login_inside_authd_if_required_provider_missing',
        'inspect_token_status_if_api_key_provider_missing',
        'use_project_retry_now_only_after_auth_readiness_is_ready',
      ],
      notes: [
        'project_experiment_preflight is the project-specific readiness gate and combines authd health with TokenManager status.',
        'Use services/arena-ctl/cli.sh authd_health for subscription/OAuth providers and services/arena-ctl/cli.sh token_status for API-key providers.',
        'Use services/arena-ctl/cli.sh authd_operator_digest --provider codex when a reminder needs message-ready re-login text without making the delivery bot an authd consumer.',
        'These commands report provider metadata only; project-specific required providers still come from runner init readiness inside preflight.',
      ],
    },
    {
      stageId: 'tg_spec_target_create',
      status: 'supported_now',
      modes: ['operator_mutation'],
      runSurface: 'direct_cli',
      ownerBoundary: 'governance.tg-spec-target-project-create',
      purpose: 'Create a dormant tg-spec target project for an accepted-artifact canary without seeding a raw local spec.',
      currentCommand: 'services/arena-ctl/cli.sh tg_spec_target_create --title <title> --source-project-id <tg-spec-id> [--source-seed-profile visual_workbench_canary_v0]',
      fixtureSchemaVersion: null,
      resultSchemaVersion: null,
      promptIds: [],
      fixtureExamples: [],
      allowedMutationSummary: [
        'governance Project and primary ProjectComponent create through createPersonalTgSpecProjectInternal',
        'optional explicit sourceSeedProfile in sourceConfig',
      ],
      forbiddenMutationSummary: [
        'no raw local spec seed',
        'no runtime-intent lease creation',
        'no worker/runner launch',
        'no workspace writes or canary repair',
        'no accepted artifact import',
        'no hidden retry/relaunch/recreate',
      ],
      handoff: [
        'run_tg_spec_accepted_artifact_import',
        'inspect_project_spec_artifact_audit',
        'start_tg_spec_launch_only_after_import_configure_and_preflight',
      ],
      notes: [
        'This stage uses the current-source arena-ctl admin path over the existing tg-spec target project owner.',
        'The target remains dormant by default through the tg-spec launch-configuration gate.',
        'The Workbench seed profile is an explicit sourceConfig flag for canaries, not runner/worker fallback generation.',
      ],
    },
    {
      stageId: 'tg_spec_accepted_artifact_import',
      status: 'supported_now',
      modes: ['operator_mutation'],
      runSurface: 'direct_cli',
      ownerBoundary: 'governance.tg-spec-accepted-artifact-import',
      purpose: 'Import a strict AcceptedSpecArtifact package into a tg-spec target through the shared accepted import owner.',
      currentCommand: 'services/arena-ctl/cli.sh tg_spec_accepted_artifact_import --project-id <id> --package-file <accepted-import-package.json>',
      fixtureSchemaVersion: null,
      resultSchemaVersion: null,
      promptIds: [],
      fixtureExamples: [],
      allowedMutationSummary: [
        'mirror spec/spec version update through the shared tg-spec import helper',
        'project tg-spec binding fields and sanitized spec.imported outbox event',
        'existing first-import auto-start behavior only when the target is not launch-configuration gated',
      ],
      forbiddenMutationSummary: [
        'no direct DB/import script path',
        'no .arena/spec-input.json or workspace injection',
        'no feedbackItemRefs invented by operator tooling',
        'no full accepted artifact echoed as CLI proof output',
        'no screenshot/capture/evidence/proof writes',
      ],
      handoff: [
        'inspect_project_spec_artifact_audit',
        'run_worker_path_canary_after_explicit_launch_if_selected',
        'verify_task_feedbackItemRefs_from_runner_plan_after_execution_starts',
      ],
      notes: [
        'This stage imports accepted product truth; it does not create task evidence or screenshot-review availability.',
        'Positive Workbench proof still needs planner/executor task refs, Workbench export, progress publish and Arena visualEvidenceReviews readback.',
        'Raw project_create --spec canaries remain negative diagnostics, not screenshot-review proof.',
      ],
    },
    {
      stageId: 'tg_spec_launch_configure',
      status: 'supported_now',
      modes: ['operator_mutation'],
      runSurface: 'direct_cli',
      ownerBoundary: 'governance.tg-spec-project-launch',
      purpose: 'Write explicit launch configuration for an accepted tg-spec target before the normal worker/runner start.',
      currentCommand: 'services/arena-ctl/cli.sh tg_spec_launch_configure --project-id <id> --agent <agent> --agent-impl <impl> --runner-backend <local|vps> --provider-billing-mode <mode> [--model <model>] [--codex-auth-mode <mode>] [--visual-workbench-evidence-automation <enabled|disabled>]',
      fixtureSchemaVersion: null,
      resultSchemaVersion: null,
      promptIds: [],
      fixtureExamples: [],
      allowedMutationSummary: [
        'launch configuration state and project/component config through configureTgSpecProjectLaunch',
        'optional explicit Workbench evidence automation runtime marker for executor-hook canaries',
      ],
      forbiddenMutationSummary: [
        'no launch start',
        'no relaunch alias',
        'no plain agent-on shortcut',
        'no accepted artifact import',
        'no workspace repair',
        'no screenshot/capture/evidence/proof writes',
      ],
      handoff: [
        'run_project_experiment_preflight_agent_run_before_start',
        'run_runtime_auth_readiness_if_preflight_blocks_auth',
        'run_tg_spec_launch_start_only_when_preflight_proposes_tg_spec_launch_start',
        'inspect_project_spec_artifact_audit_before_start_if_needed',
      ],
      notes: [
        'This stage uses the existing tg-spec launch configuration owner and keeps configuration separate from start.',
        'Omitted add-ons are preserved by the launch owner; operators should pass only explicit changes needed for the experiment.',
        'Positive production Workbench canaries should pass visual-workbench-evidence-automation enabled. Omitted config preserves existing launch config; fresh targets therefore stay disabled unless explicitly enabled.',
        'After configuration, use project_experiment_preflight --mode agent_run as the read-only launch readiness gate; start only when proposedOperatorAction is tg_spec_launch_start, not when auth/runtime blockers remain.',
      ],
    },
    {
      stageId: 'tg_spec_launch_start',
      status: 'supported_now',
      modes: ['operator_mutation'],
      runSurface: 'direct_cli',
      ownerBoundary: 'governance.tg-spec-project-launch',
      purpose: 'Explicitly start a configured tg-spec target after accepted artifact import and operator inspection.',
      currentCommand: 'services/arena-ctl/cli.sh tg_spec_launch_start --project-id <id>',
      fixtureSchemaVersion: null,
      resultSchemaVersion: null,
      promptIds: [],
      fixtureExamples: [],
      allowedMutationSummary: [
        'launch-configuration state clear and lifecycle intents through startTgSpecProjectLaunch',
      ],
      forbiddenMutationSummary: [
        'no relaunch alias',
        'no plain agent-on shortcut',
        'no accepted artifact import',
        'no workspace repair',
        'no screenshot/capture/evidence/proof writes',
      ],
      handoff: [
        'run_worker_path_canary',
        'inspect_project_experiment_preflight',
        'inspect_runner_workspace_and_task_feedbackItemRefs_after_execution_starts',
      ],
      notes: [
        'This stage uses the existing explicit tg-spec launch owner and is intentionally separate from create/import.',
        'It may cause the normal worker path to claim work; use after accepted artifact audit/readback is clean and project_experiment_preflight --mode agent_run proposes tg_spec_launch_start.',
        'If preflight reports runtime_auth_* blockers, run runtime_auth_readiness or restore authd first; tg_spec_launch_start is not an auth repair, retry or hidden fallback.',
      ],
    },
    {
      stageId: 'arena_visual_evidence_artifact_check',
      status: 'supported_now',
      modes: ['read_only'],
      runSurface: 'direct_cli',
      ownerBoundary: 'governance.project-interaction-snapshot',
      purpose: 'Check whether current Arena visualEvidenceReviews artifact handles are downloadable through the existing visual evidence artifact owner without returning raw bytes.',
      currentCommand: 'services/arena-ctl/cli.sh project_visual_evidence_artifact_check --project-id <id>',
      fixtureSchemaVersion: null,
      resultSchemaVersion: null,
      promptIds: [],
      fixtureExamples: [],
      allowedMutationSummary: [
        'none; read-only visual evidence artifact downloadability diagnostics',
      ],
      forbiddenMutationSummary: [
        'no local .ralph or .arena file scan',
        'no Workbench capture folder scan',
        'no delivery/outbox history inference',
        'no Telegram button decision outside Arena returned actions',
        'no raw bytes or storage paths in output',
        'no task evidence/proof/lifecycle/runtime writes',
      ],
      handoff: [
        'open_current_visual_evidence_review_artifact_if_downloadable',
        'run_arena_visual_evidence_readback_if_no_reviews',
        'run_visual_workbench_progress_publish_if_reviews_missing',
        'run_visual_workbench_status_if_artifact_not_downloadable',
      ],
      notes: [
        'This stage verifies current review artifact handles only after Arena visualEvidenceReviews exist.',
        'ProjectInteractionSnapshot owns review/action availability; the artifact download helper owns byte readability.',
        'visualEvidenceReadiness may be available while this stage reports partial artifact downloadability.',
        'The command must not infer screenshot availability from raw Workbench folders, local progress files, outbox rows or Telegram history.',
      ],
    },
    {
      stageId: 'arena_visual_evidence_ingest',
      status: 'supported_now',
      modes: ['operator_mutation'],
      runSurface: 'direct_cli',
      ownerBoundary: 'governance.project-visual-evidence-ingest',
      purpose: 'Import one explicit published Visual Workbench evidence row and its matching screenshot asset into Arena after a completed/manual experiment.',
      currentCommand: 'services/arena-ctl/cli.sh project_visual_evidence_ingest --project-id <id> --task-id <task-id> --evidence-ref <visual-workbench-capture:...> --progress-json <workspace/.arena/progress.json> --artifact-file <workspace/.ralph/visual-workbench/.../capture.png>',
      fixtureSchemaVersion: null,
      resultSchemaVersion: 'ra-356.project-visual-evidence-ingest.v1',
      promptIds: [],
      fixtureExamples: [],
      allowedMutationSummary: [
        'canonical selected visualEvidence row merge into Project.progressJson',
        'matching system ProjectAsset import under assets/system/visual-evidence/<reviewId>/capture.png',
        'idempotent reuse of an existing same path and same sha asset',
      ],
      forbiddenMutationSummary: [
        'no submitted progress JSON verbatim persistence',
        'no local .ralph or .arena broad scan',
        'no raw artifactPath publication',
        'no proofReviews[] write',
        'no task evidence/proof/lifecycle/runtime writes',
        'no relaunch, recreate runtime, retry or hidden unblock',
        'no Telegram or outbox write',
        'no overwrite of an existing same path asset with a different sha',
      ],
      handoff: [
        'run_arena_visual_evidence_readback',
        'run_arena_visual_evidence_artifact_check_if_reviews_exist',
        'inspect_ingest_validation_error_before_rerun',
      ],
      notes: [
        'This is a manual operator bridge for completed/manual experiments where no live runner ProgressWatcher is still publishing progress.',
        'During normal live execution, ProgressWatcher remains the ordinary progress ingestion owner.',
        'The command requires one explicit task, evidence ref, progress JSON file and artifact file; it must not discover evidence by scanning Workbench folders.',
        'Arena ProjectInteractionSnapshot still owns screenshot-review availability after the ingest; run project_proof_reviews to verify the result.',
      ],
    },
    {
      stageId: 'arena_visual_evidence_readback',
      status: 'supported_now',
      modes: ['read_only'],
      runSurface: 'direct_cli',
      ownerBoundary: 'governance.project-interaction-snapshot',
      purpose: 'Read current Arena proofReviews, visualEvidenceReviews and visualEvidenceReadiness after sanitized Workbench progress metadata has been published.',
      currentCommand: 'services/arena-ctl/cli.sh project_proof_reviews --project-id <id>',
      fixtureSchemaVersion: null,
      resultSchemaVersion: null,
      promptIds: [],
      fixtureExamples: [],
      allowedMutationSummary: [
        'none; read-only governance proof-review projection',
      ],
      forbiddenMutationSummary: [
        'no local .ralph or .arena file scan',
        'no delivery/outbox history inference',
        'no Telegram button decision outside Arena returned actions',
        'no task evidence/proof/lifecycle/runtime writes',
        'no fallback to raw screenshot folders',
      ],
      handoff: [
        'inspect_visualEvidenceReviews',
        'run_arena_visual_evidence_artifact_check_if_reviews_exist',
        'inspect_visualEvidenceReadiness_when_empty',
        'render_tg_spec_screenshot_action_if_arena_returns_one',
        'run_visual_workbench_status_if_projection_missing',
        'run_visual_workbench_progress_publish_if_progress_missing',
      ],
      notes: [
        'This entry points to the current-source arena-ctl proof review CLI; it does not inspect local artifacts or mutate project state.',
        'Arena ProjectInteractionSnapshot remains the owner of visual evidence review availability and actions.',
        'visualEvidenceReadiness explains empty readback state but does not create a Telegram action by itself.',
        'Outbox rows are delivery history only and must not be used as screenshot availability truth.',
      ],
    },
    {
      stageId: 'prompt_contract_replay',
      status: 'supported_now',
      modes: ['fixture'],
      runSurface: 'direct_cli',
      ownerBoundary: 'ralph.prompt-repository',
      purpose: 'Render a repository-owned prompt or context section from an explicit Prompt Lab fixture without model calls or runtime writes.',
      currentCommand: 'ralph prompts replay --fixture <prompt-fixture.json> --out <temp-output.json> --compact',
      fixtureSchemaVersion: PROMPT_LAB_FIXTURE_SCHEMA_VERSION,
      resultSchemaVersion: PROMPT_LAB_REPLAY_RESULT_SCHEMA_VERSION,
      promptIds: [...PROMPT_LAB_SUPPORTED_PROMPT_IDS],
      fixtureExamples: [
        'work/plans/ra-356-manual-experiment-tooling/fixtures/executor-task-section-visual-workbench.json',
        'work/plans/ra-356-manual-experiment-tooling/fixtures/executor-task-workspace-prompt-visual-task.json',
        'work/plans/ra-356-manual-experiment-tooling/fixtures/executor-product-skill.json',
        'work/plans/ra-356-manual-experiment-tooling/fixtures/executor-ux-skill.json',
      ],
      allowedMutationSummary: [
        'new explicit disposable --out file only',
      ],
      forbiddenMutationSummary: [
        'no model provider call',
        'no planner/executor/controller stage run',
        'no prompt trace, .ralph, .arena or task evidence write',
        'no model output parsing or apply step',
        'no runtime intent, lifecycle or proof write',
        'no next-stage auto-start',
      ],
      handoff: [
        'inspect_prompt_contract',
        'fix_prompt_repository_owner_if_contract_is_wrong',
        'run_planner_prompt_io_or_executor_task_io_later_if_selected',
        'discard_experiment_output',
      ],
      notes: [
        'This entry makes Prompt Lab replay discoverable through the stage catalog; the command itself remains `ralph prompts replay`.',
        '`executor.taskSection` replay uses the production task-section renderer, including Visual Workbench coverage guidance for UX/frontend tasks.',
        '`executor.productSkill` and `executor.uxSkill` replay static role-skill guidance from Prompt Repository only; they are not runnable product/UX provider passes.',
        'Prompt replay is prompt-shape inspection only and is not equivalent to planner, executor or controller execution.',
      ],
    },
    {
      stageId: 'controller_project_dry_run',
      status: 'supported_now',
      modes: ['workspace_dry_run'],
      runSurface: 'stage_run_workspace',
      ownerBoundary: 'ralph.controller.dry-run-adapter',
      purpose: 'Run one controller audit provider call from a Project Stage Snapshot and explicit fork workspace without applying reports, plan changes, judgments, evidence or lifecycle writes.',
      currentCommand: 'ralph stage run controller_project_dry_run --snapshot <project-stage-snapshot.json> --work-dir <forked-project-source> --source-ref <snapshot-git-commit> --spec <workDir-relative-spec> --trigger <phase_complete|periodic|failure_threshold|replan|manual|final|spec_migration> --visual-evidence-mode <off|required|new_tasks_only> --out-dir <experiment-output-dir-outside-work-dir> --agent <claude-code|codex|opencode> --model <model> --timeout-minutes <minutes>',
      fixtureSchemaVersion: 'ra-356.project-stage-snapshot.v1',
      resultSchemaVersion: CONTROLLER_PROJECT_DRY_RUN_RESULT_SCHEMA_VERSION,
      promptIds: ['controller.audit'],
      fixtureExamples: [],
      allowedMutationSummary: [
        'explicit outDir report outside workDir only',
      ],
      forbiddenMutationSummary: [
        'no .ralph/controller-reports write',
        'no .ralph/plan.json write',
        'no prompt trace, judgment log, task evidence, proof, runtime intent or lifecycle write',
        'no live project truth reread after Project Stage Snapshot',
        'no source workspace mutation or git HEAD change',
        'no hidden spec, visualEvidenceMode, trigger, agent, model or timeout defaults',
        'no controller startup trigger',
        'no planner or executor auto-start',
      ],
      handoff: [
        'inspect_controller_project_dry_run_report',
        'decide_whether_to_apply_or_replan_in_a_future_explicit_stage',
        'run_visual_workbench_handoff_later_if_selected',
        'discard_experiment_output',
      ],
      notes: [
        'This adapter consumes one disposable project_stage_snapshot artifact plus an explicit source-ref fork; it does not read governance/project truth itself.',
        'It calls the existing Controller dry-run owner and controller-output parser; it is not a second controller.',
        'The report stores prompt/output hashes, counters and reduced observations only; it does not persist a full apply-ready ControllerReport.',
        'Startup is intentionally excluded because production startup can persist E2E applicability and add E2E tasks.',
        'E2E enforcer is explicitly disabled for this non-startup dry-run instead of relying on schema defaults.',
        'It performs one provider call with no hidden retries so token spend and behavior remain observable.',
      ],
    },
    {
      stageId: 'planner_project_dry_run',
      status: 'supported_now',
      modes: ['workspace_dry_run'],
      runSurface: 'stage_run_workspace',
      ownerBoundary: 'ralph.planner.dry-run-adapter',
      purpose: 'Run one initial planner provider call from a Project Stage Snapshot and explicit fork workspace without applying .ralph/plan.json.',
      currentCommand: 'ralph stage run planner_project_dry_run --snapshot <project-stage-snapshot.json> --work-dir <forked-project-source> --source-ref <snapshot-git-commit> --spec <workDir-relative-spec> --visual-evidence-mode <off|required|new_tasks_only> --out-dir <experiment-output-dir-outside-work-dir> --agent <claude-code|codex|opencode> --model <model> --timeout-minutes <minutes>',
      fixtureSchemaVersion: 'ra-356.project-stage-snapshot.v1',
      resultSchemaVersion: PLANNER_PROJECT_DRY_RUN_RESULT_SCHEMA_VERSION,
      promptIds: ['planner.initial'],
      fixtureExamples: [],
      allowedMutationSummary: [
        'explicit outDir report outside workDir only',
      ],
      forbiddenMutationSummary: [
        'no .ralph/plan.json write',
        'no prompt trace, judgment log, task evidence, proof, runtime intent or lifecycle write',
        'no live project truth reread after Project Stage Snapshot',
        'no source workspace mutation or git HEAD change',
        'no hidden project-config, visualEvidenceMode, agent, model or timeout defaults',
        'no executor or controller auto-start',
      ],
      handoff: [
        'inspect_planner_project_dry_run_report',
        'adjust_spec_or_visual_mode_and_rerun_if_selected',
        'run_executor_project_task_later_if_a_task_is_selected',
        'discard_experiment_output',
      ],
      notes: [
        'This adapter consumes one disposable project_stage_snapshot artifact plus an explicit source-ref fork; it does not read governance/project truth itself.',
        'Spec content is read only from the source-ref workspace path named by --spec; accepted-artifact audit remains identity/readiness only.',
        'It calls the existing Planner dry-run owner and planner-output parser; it is not a second planner.',
        'It performs one provider call with no hidden retries so token spend and behavior remain observable.',
      ],
    },
    {
      stageId: 'planner_spec_migration_apply',
      status: 'supported_now',
      modes: ['workspace_mutation'],
      runSurface: 'stage_run_workspace',
      ownerBoundary: 'ralph.planner-spec-migration-apply',
      purpose: 'Materialize accepted spec changes into existing .ralph/plan.json task truth through the same planner migration owner used by real Ralph, then stop.',
      currentCommand: 'ralph stage run planner_spec_migration_apply --snapshot <project-stage-snapshot.json> --source-ref <snapshot-git-commit> --out-dir <experiment-output-dir-outside-live-workspace> --agent <claude-code|codex|opencode> --model <model> --timeout-minutes <minutes>',
      fixtureSchemaVersion: 'ra-356.project-stage-snapshot.v1',
      resultSchemaVersion: PLANNER_SPEC_MIGRATION_APPLY_RESULT_SCHEMA_VERSION,
      promptIds: ['planner.specMigration'],
      fixtureExamples: [],
      allowedMutationSummary: [
        'live Project Stage Snapshot workspace .ralph/plan.json writes through PlanManager',
        'live Project Stage Snapshot workspace .ralph/decisions-log.json writes through JudgmentLog',
        'live Project Stage Snapshot workspace .ralph/prompt-trace.jsonl and .ralph/prompt-traces writes through Planner prompt tracing',
        'explicit outDir report outside workDir only',
      ],
      forbiddenMutationSummary: [
        'no client workDir, spec or visualEvidenceMode truth',
        'no source workspace files outside planner-owned .ralph files',
        'no .arena/progress.json write',
        'no task/proof/lifecycle/runtime intent writes',
        'no git commit, HEAD change or remote push',
        'no executor, controller or Visual Workbench auto-start',
        'no hidden project-config, visualEvidenceMode, agent, model or timeout defaults',
      ],
      handoff: [
        'inspect_planner_spec_migration_apply_report',
        'inspect_.ralph_plan_json_task_diff',
        'run_executor_project_task_later_if_a_task_is_selected',
        'rollback_live_workspace_manually_if_needed',
      ],
      notes: [
        'This stage consumes one disposable project_stage_snapshot artifact and derives live workDir, spec and visualEvidenceMode from it.',
        'It calls applyPendingSpecMigrations rather than applying planner_project_dry_run output.',
        'It intentionally omits production LoopExecutor tails such as priority rebalance, progress sync, executor, controller, deploy and Workbench continuation.',
        'It may perform the production planner migration retry loop; the report distinguishes recordedCount from plannerAppliedCount.',
      ],
    },
    {
      stageId: 'executor_project_task',
      status: 'supported_now',
      modes: ['workspace_mutation'],
      runSurface: 'stage_run_workspace',
      ownerBoundary: 'ralph.executor-project-task-adapter',
      purpose: 'Run one selected pending, failed or interrupted task from a Project Stage Snapshot by delegating to executor_task_workspace in an explicit live workspace action or advanced fork workspace.',
      currentCommand: 'ralph stage run executor_project_task --snapshot <project-stage-snapshot.json> --mode <new_task|failed_task|resume_interrupted> --workspace-mode live_workspace_action --completion-promise <promise> --out-dir <experiment-output-dir-outside-live-workspace> --agent <claude-code|codex|opencode> --model <model> --timeout-minutes <minutes>',
      fixtureSchemaVersion: 'ra-356.project-stage-snapshot.v1',
      resultSchemaVersion: EXECUTOR_PROJECT_TASK_RESULT_SCHEMA_VERSION,
      promptIds: ['executor.agentPrompt', 'executor.taskSection'],
      fixtureExamples: [],
      allowedMutationSummary: [
        'explicit live Project Stage Snapshot workspace source mutations from the selected agent',
        'local project commit after a successful clean live workspace action',
        'explicit outDir reports outside workDir only',
      ],
      forbiddenMutationSummary: [
        'no live project truth reread after Project Stage Snapshot',
        'no planner/controller/lifecycle continuation',
        'no task evidence/proof/runtime intent writes',
        'no .ralph/.arena/proof/lifecycle changed files',
        'no remote git push',
        'no task/proof/lifecycle truth from the local project commit',
        'no hidden agent/model/timeout defaults',
      ],
      handoff: [
        'inspect_executor_project_task_report',
        'inspect_executor_task_workspace_report_if_delegated',
        'run_executor_workspace_source_snapshot_if_source_changed_and_selected',
        'run_visual_workbench_manifest_readiness_if_visual_files_changed',
        'discard_or_reset_forked_workspace',
      ],
      notes: [
        'This adapter consumes one disposable project_stage_snapshot artifact and does not read governance/project truth itself.',
        'Supports --mode new_task for pending tasks, --mode failed_task for failed tasks and --mode resume_interrupted for in-progress tasks with a matching failed/error provider session.',
        'Supports --workspace-mode live_workspace_action for the selected live project workspace and --workspace-mode fork for an explicit advanced fork.',
        'For advanced fork mode, create or clone the fork workDir first and keep --out-dir outside that existing workDir so the path guard can prove experiment artifacts are disposable.',
        'Provider sessions are best-effort continuation hints from the Project Stage Snapshot, not lifecycle truth or scheduler state.',
        'It delegates execution to executor_task_workspace; it is not a second executor.',
      ],
    },
    {
      stageId: 'executor_task_workspace',
      status: 'supported_now',
      modes: ['workspace_mutation'],
      runSurface: 'stage_run_workspace',
      ownerBoundary: EXECUTOR_ACTION_CORE_OWNER_BOUNDARY,
      purpose: 'Run one selected executor task against an explicit forked git workspace with a real explicitly selected agent.',
      currentCommand: 'ralph stage run executor_task_workspace --task-fixture <task.json> --prompt-fixture <executor-prompt-fixture.json> --completion-promise <promise> --visual-evidence-mode <off|required|new_tasks_only> --work-dir <forked-project-source> --source-ref <git-commit> --out-dir <experiment-output-dir-outside-work-dir> --agent <claude-code|codex|opencode> --model <model> --timeout-minutes <minutes>',
      fixtureSchemaVersion: null,
      resultSchemaVersion: EXECUTOR_TASK_WORKSPACE_RESULT_SCHEMA_VERSION,
      promptIds: ['executor.agentPrompt'],
      fixtureExamples: [
        'work/plans/ra-356-manual-experiment-tooling/fixtures/executor-task-workspace-task-visual-task.json',
        'work/plans/ra-356-manual-experiment-tooling/fixtures/executor-task-workspace-prompt-visual-task.json',
      ],
      allowedMutationSummary: [
        'explicit forked workDir source mutations from the selected agent',
        'explicit outDir report outside workDir only',
      ],
      forbiddenMutationSummary: [
        'no planner/controller/lifecycle continuation',
        'no task evidence/proof/runtime intent writes',
        'no .ralph/.arena/proof/lifecycle changed files',
        'no git commit or HEAD change',
        'no hidden agent/model/timeout defaults',
        'no antigravity until explicit model selection is proven',
      ],
      handoff: [
        'inspect_workspace_diff',
        'run_visual_workbench_manifest_readiness_if_visual_files_changed',
        'run_visual_workbench_capture_if_selected',
        'run_controller_visual_review_later_if_selected',
        'discard_or_reset_forked_workspace',
      ],
      notes: [
        'This stage requires explicit --agent, --model and --timeout-minutes values; antigravity is disabled until its model contract is explicit.',
        'It writes experiment output only to --out-dir and does not update task/proof/lifecycle truth.',
        'It fails closed when source refs, dirty workspace, forbidden paths or HEAD changes violate the contract.',
      ],
    },
    {
      stageId: 'executor_task_workspace_continue',
      status: 'supported_now',
      modes: ['workspace_mutation'],
      runSurface: 'stage_run_workspace',
      ownerBoundary: EXECUTOR_ACTION_CORE_OWNER_BOUNDARY,
      purpose: 'Explicitly continue the same dirty fork left by a previous failed executor workspace experiment without weakening the clean executor stage.',
      currentCommand: 'ralph stage run executor_task_workspace_continue --executor-workspace-report <previous-executor-task-workspace-run.json> --task-fixture <task.json> --prompt-fixture <executor-prompt-fixture.json> --completion-promise <promise> --visual-evidence-mode <off|required|new_tasks_only> --work-dir <same-dirty-forked-project-source> --source-ref <git-commit> --out-dir <new-experiment-output-dir-outside-work-dir> --agent <claude-code|codex|opencode> --model <model> --timeout-minutes <minutes>',
      fixtureSchemaVersion: null,
      resultSchemaVersion: EXECUTOR_TASK_WORKSPACE_CONTINUE_RESULT_SCHEMA_VERSION,
      promptIds: ['executor.agentPrompt'],
      fixtureExamples: [
        'executor_project_task output executor-project-task-task.json',
        'executor_project_task output executor-project-task-prompt-fixture.json',
      ],
      allowedMutationSummary: [
        'same explicit dirty forked workDir source mutations from the selected agent',
        'explicit new outDir report outside workDir only',
      ],
      forbiddenMutationSummary: [
        'no project snapshot reread or live project workspace mutation',
        'no planner/controller/lifecycle continuation',
        'no task evidence/proof/runtime intent writes',
        'no .ralph/.arena/proof/lifecycle changed files',
        'no git commit or HEAD change',
        'no hidden retry, fallback, source adoption or task-state resume',
        'no antigravity until explicit model selection is proven',
      ],
      handoff: [
        'inspect_continuation_workspace_diff',
        'run_executor_workspace_source_snapshot_if_completed_and_selected',
        'run_visual_workbench_manifest_readiness_if_visual_files_changed',
        'discard_or_reset_forked_workspace',
      ],
      notes: [
        'This stage accepts only a previous agent_failed executor workspace report and the same dirty fork status recorded by that report.',
        'It is separate from executor_project_task --mode resume_interrupted, which is live task/session continuation from Project Stage Snapshot truth.',
        'It blocks before provider creation when workDir, sourceRef, HEAD, task id, prior forbidden files or dirty changed files drift.',
        'It writes experiment output only to a new --out-dir and does not update task/proof/lifecycle truth.',
      ],
    },
    {
      stageId: 'executor_workspace_source_snapshot',
      status: 'supported_now',
      modes: ['workspace_mutation'],
      runSurface: 'stage_run_workspace',
      ownerBoundary: 'ralph.stage-lab.executor-source-handoff',
      purpose: 'Create an experiment-only local source ref from a completed executor workspace run so Visual Workbench readiness stages can read committed source.',
      currentCommand: 'ralph stage run executor_workspace_source_snapshot --executor-workspace-report <executor-task-workspace-run.json> --work-dir <forked-project-source> --source-ref <executor-before-git-commit> --out-dir <experiment-output-dir-outside-work-dir> --commit-message <message> [--project-id <id>]',
      fixtureSchemaVersion: null,
      resultSchemaVersion: EXECUTOR_WORKSPACE_SOURCE_SNAPSHOT_SCHEMA_VERSION,
      promptIds: [],
      fixtureExamples: [],
      allowedMutationSummary: [
        'explicit forked workDir git index and local experiment commit only',
        'explicit outDir report outside workDir only',
      ],
      forbiddenMutationSummary: [
        'no remote push',
        'no lifecycle/task evidence/proof/runtime intent writes',
        'no Visual Workbench capture auto-run',
        'no product source truth or remote freshness truth',
      ],
      handoff: [
        'run_visual_workbench_inspect_after_visual_task_snapshot',
        'run_visual_workbench_selector_readiness_after_visual_task_snapshot',
        'run_visual_workbench_evidence_chain_readiness_after_selector_inputs_exist',
        'inspect_experiment_source_diff',
        'discard_or_reset_forked_workspace',
      ],
      notes: [
        'This stage snapshots only a disposable forked workspace after executor_task_workspace has completed.',
        'Optional --project-id is a readback handoff hint only; it is not read or treated as project truth.',
        'It fails if current workspace changes no longer match the executor report.',
        'It creates a local experiment source ref; it does not push, deploy, capture screenshots or update task proof.',
        'It does not emit a capture command; selected-story capture belongs after selector readiness has produced explicit story and viewport values.',
      ],
    },
    {
      stageId: 'visual_workbench_selector_readiness',
      status: 'supported_now',
      modes: ['read_only'],
      runSurface: 'direct_cli',
      ownerBoundary: 'ralph.visual-workbench-selector-readiness',
      purpose: 'Read which source-owned Workbench stories and viewports are explicitly selectable for a task before capture/export automation.',
      currentCommand: 'ralph visual-workbench selector-readiness --work-dir <project-source-workspace> [--task <taskId>]',
      fixtureSchemaVersion: null,
      resultSchemaVersion: VISUAL_WORKBENCH_SELECTOR_READINESS_SCHEMA_VERSION,
      promptIds: [],
      fixtureExamples: [],
      allowedMutationSummary: [
        'none; read-only diagnostic over .ralph/plan.json and visual-workbench/manifest.json',
      ],
      forbiddenMutationSummary: [
        'no Workbench server start',
        'no Playwright screenshot capture',
        'no evidence export or assessment',
        'no .ralph/plan.json writes',
        'no .arena/progress.json writes',
        'no proof review, ProjectAsset, lifecycle, runtime intent or Telegram writes',
        'no selector inference from routes, titles, widgets, states, claims or filenames',
      ],
      handoff: [
        'run_visual_workbench_shell_policy_if_selector_ready',
        'fix_story_taskRelevance_defaultFor_if_no_match',
        'fix_task_feedback_refs_if_missing',
        'resolve_ambiguous_story_selector_before_export',
      ],
      notes: [
        'This stage answers the pre-capture question: which story/viewport pairs are allowed to become task-linked evidence later.',
        'Selector truth comes only from task ids, task feedback refs and story taskRelevance.defaultFor values.',
        'A ready selector is not screenshot proof and does not mean evidence has been captured, exported or published.',
      ],
    },
    {
      stageId: 'visual_workbench_shell_policy',
      status: 'supported_now',
      modes: ['read_only'],
      runSurface: 'direct_cli',
      ownerBoundary: 'ralph.visual-workbench-shell-policy',
      purpose: 'Read whether future executor-owned automation is allowed to start the source-owned Workbench serveCommand.',
      currentCommand: 'ralph visual-workbench shell-policy --work-dir <project-source-workspace> --config <ralph.config.json>',
      fixtureSchemaVersion: null,
      resultSchemaVersion: VISUAL_WORKBENCH_SHELL_POLICY_SCHEMA_VERSION,
      promptIds: [],
      fixtureExamples: [],
      allowedMutationSummary: [
        'none; read-only diagnostic over first-party Ralph config and visual-workbench/manifest.json',
      ],
      forbiddenMutationSummary: [
        'no Workbench server start',
        'no shell command execution',
        'no Playwright screenshot capture',
        'no evidence export or assessment',
        'no .ralph/plan.json writes',
        'no .arena/progress.json writes',
        'no proof review, ProjectAsset, lifecycle, runtime intent or Telegram writes',
        'no fallback command, app-page capture or legacy screenshot-proof path',
        'no self-authorization from visual-workbench/manifest.json or project config',
      ],
      handoff: [
        'run_visual_workbench_capture_only_after_selector_ready_and_shell_policy_allowed',
        'add_first_party_allowlist_for_canary_if_policy_blocked',
        'fix_manifest_baseUrlEnv_if_missing_or_unallowlisted',
        'keep_capture_manual_if_policy_not_allowed',
      ],
      notes: [
        'The manifest serveCommand is source-owned execution input, not authority to execute.',
        'Executor automation may start Workbench only after first-party Ralph config explicitly allowlists the exact serveCommand and baseUrlEnv.',
        'Policy denial is a blocked diagnostic; it must not change lifecycle, task status, proof state, runtime intent or Telegram availability.',
      ],
    },
    {
      stageId: 'visual_workbench_evidence_automation',
      status: 'supported_now',
      modes: ['workspace_mutation'],
      runSurface: 'direct_cli',
      ownerBoundary: VISUAL_WORKBENCH_AUTOMATION_OWNER_BOUNDARY,
      purpose: 'Run the explicit selector -> shell-policy -> platform browser readiness -> capture -> evidence export -> progress publish chain for one task.',
      currentCommand: 'ralph visual-workbench automate-evidence --work-dir <project-source-workspace> --manifest visual-workbench/manifest.json --task <taskId> --source-ref <git-commit> --base-url <http://127.0.0.1:port> --out-dir <capture-output-dir-outside-work-dir> --config <ralph.config.json>',
      fixtureSchemaVersion: null,
      resultSchemaVersion: VISUAL_WORKBENCH_AUTOMATION_SCHEMA_VERSION,
      promptIds: [],
      fixtureExamples: [],
      allowedMutationSummary: [
        'visual-workbench-automation-run.json diagnostic report in the explicit outDir',
        'setup_failed latest diagnostic report under .ralph/visual-workbench/automation-runs/<taskId>/latest.json when setup fails before safe outDir writes',
        'Ralph-local latest diagnostic copy under .ralph/visual-workbench/automation-runs/<taskId>/latest.json',
        'explicit capture output directory outside workDir',
        'workDir-local .ralph/visual-workbench artifact adoption for selected captured screenshots',
        'task-linked evidence rows through PlanManager only',
        '.arena/progress.json read-side visualEvidence projection',
      ],
      forbiddenMutationSummary: [
        'no lifecycle, runtime intent, blocker or task status writes',
        'no screenshotProof or proofReviews[] writes',
        'no ProjectAsset upload or asset-derived evidence creation',
        'no pass/fail assessment from capture',
        'no fallback Workbench command, app-page capture or legacy screenshot-proof path',
        'no selector inference from text, routes, filenames or screenshots',
        'no project workspace browser install or browser-infra self-repair',
      ],
      handoff: [
        'inspect_visual_workbench_automation_report_if_not_published',
        'run_arena_visual_evidence_readback_if_published',
        'inspect_automation_blockers_if_blocked',
        'inspect_report_selector_ambiguities_when_story_matches_multiple_tasks',
        'run_visual_workbench_browser_readiness_if_browser_readiness_blocked',
        'fix_selector_or_shell_policy_before_rerun',
        'run_manual_assessment_after_user_review',
      ],
      notes: [
        'This stage composes existing owner boundaries and requires explicit taskId, sourceRef, baseUrl, outDir, manifest and config inputs.',
        'Platform browser readiness is checked before starting the source-owned Workbench server; INFRA_BROWSER_UNAVAILABLE remains platform maintenance, not project work.',
        'If selector readiness blocks on ambiguous story ownership, inspect report.selector.ambiguities for the selector-owned matched task ids and selector tokens.',
        'When selector readiness maps the task to one story, automation captures that story with explicit story_viewports selection instead of full_manifest.',
        'It writes structured automation reports to the explicit outDir after setup is safe and always keeps a Ralph-local latest diagnostic path for returned setup/blocked/failed/published outcomes; those reports are not proof, lifecycle truth or Telegram availability.',
        'It exports screenshots as inconclusive evidence only and publishes sanitized progress for Arena readback.',
        'It is the reusable production-like brick intended for later executor-owned automation, but it is still an explicit direct CLI stage.',
      ],
    },
    {
      stageId: 'visual_workbench_automation_status',
      status: 'supported_now',
      modes: ['read_only'],
      runSurface: 'direct_cli',
      ownerBoundary: 'ralph.visual-workbench-automation-diagnostic-readback',
      purpose: 'Read the latest Ralph-local Visual Workbench automation diagnostic report for one task, or an explicit automation report path.',
      currentCommand: 'ralph visual-workbench automation-status --work-dir <project-source-workspace> [--task <taskId>] [--report <visual-workbench-automation-run.json>]',
      fixtureSchemaVersion: null,
      resultSchemaVersion: VISUAL_WORKBENCH_AUTOMATION_STATUS_SCHEMA_VERSION,
      promptIds: [],
      fixtureExamples: [],
      allowedMutationSummary: [
        'none; read-only diagnostic over one explicit automation report path or one task latest diagnostic path',
      ],
      forbiddenMutationSummary: [
        'no capture directory scanning',
        'no Workbench server start',
        'no screenshot capture',
        'no evidence export or assessment',
        'no .ralph/plan.json writes',
        'no .arena/progress.json writes',
        'no proof review, ProjectAsset, lifecycle, runtime intent or Telegram writes',
      ],
      handoff: [
        'inspect_automation_blockers_if_available',
        'rerun_visual_workbench_evidence_automation_after_fix',
        'run_visual_workbench_evidence_chain_readiness_if_published',
      ],
      notes: [
        'This stage is an operator readback for automation attempts; it does not decide screenshot-review availability.',
        'It reports sourceFreshness by comparing the saved report sourceRef with the current workDir HEAD, so stale diagnostics are visible without rerunning capture.',
        'When capture fails before Workbench readiness, inspect report.capture.startDiagnostics for bounded sanitized serveCommand stdout/stderr and exit metadata.',
        'Without --task or --report it returns not_provided instead of scanning for reports.',
      ],
    },
    {
      stageId: 'visual_workbench_capture',
      status: 'supported_now',
      modes: ['workspace_mutation'],
      runSurface: 'direct_cli',
      ownerBoundary: 'ra-355.visual-workbench-capture',
      purpose: 'Start the source-owned Visual Workbench and capture explicit full-manifest or selected story/viewport experiment artifacts outside project source.',
      currentCommand: 'ralph visual-workbench capture --work-dir <project-source-workspace> --source-ref <git-commit> --base-url <http://127.0.0.1:port> --out-dir <experiment-output-dir-outside-work-dir> [--selection story_viewports --story <storyId> --viewport <viewportName>]',
      fixtureSchemaVersion: null,
      resultSchemaVersion: VISUAL_WORKBENCH_CAPTURE_RUN_SCHEMA_VERSION,
      promptIds: [],
      fixtureExamples: [],
      allowedMutationSummary: [
        'explicit output directory outside workDir only',
        'visual-workbench-capture-run.json, manifest snapshot and screenshot PNG files',
      ],
      forbiddenMutationSummary: [
        'no source workspace writes',
        'no task evidence/proof/lifecycle/runtime writes',
        'no ProjectAsset upload',
        'no task status update',
        'no fallback to app pages or old visual scenarios',
      ],
      handoff: [
        'inspect_visual_workbench_artifacts',
        'fix_manifest_or_story_and_rerun',
        'run_explicit_evidence_export_later_if_needed',
        'run_controller_visual_review_fixture_if_explicit_evidence_context_needed',
      ],
      notes: [
        'This stage is runnable through the direct visual-workbench CLI, not through `ralph stage run` fixture mode.',
        'It requires a clean workspace with HEAD matching the explicit sourceRef.',
        '`--selection story_viewports` is explicit and blocked when the story/viewport is absent; it never falls back to full_manifest or app-page capture.',
        'Captured screenshots are experiment evidence, not proof or lifecycle truth.',
        'The capture command also writes a static index.html viewer beside the report.',
      ],
    },
    {
      stageId: 'visual_workbench_capture_viewer',
      status: 'supported_now',
      modes: ['artifact_write'],
      runSurface: 'direct_cli',
      ownerBoundary: 'ra-355.visual-workbench-capture-viewer',
      purpose: 'Render or refresh the static screenshot catalog viewer from an existing Visual Workbench capture report.',
      currentCommand: 'ralph visual-workbench render-viewer --run <visual-workbench-capture-run.json>',
      fixtureSchemaVersion: null,
      resultSchemaVersion: VISUAL_WORKBENCH_CAPTURE_VIEWER_SCHEMA_VERSION,
      promptIds: [],
      fixtureExamples: [],
      allowedMutationSummary: [
        'index.html beside the provided capture report only',
      ],
      forbiddenMutationSummary: [
        'no source workspace writes',
        'no screenshot capture',
        'no task evidence/proof/lifecycle/runtime writes',
        'no progress publish',
        'no Telegram/read-side availability inference',
      ],
      handoff: [
        'open_static_viewer_for_manual_inspection',
        'run_visual_workbench_evidence_export_later_if_task_linked_evidence_is_needed',
        'run_visual_workbench_assessment_after_user_review',
      ],
      notes: [
        'This stage exists so old capture reports can get the same browsable screenshot catalog without rerunning Playwright.',
        'The capture report remains the structured artifact; the viewer is convenience UI only.',
      ],
    },
    {
      stageId: 'visual_workbench_browser_readiness',
      status: 'supported_now',
      modes: ['read_only'],
      runSurface: 'direct_cli',
      ownerBoundary: 'platform.browser-readiness',
      purpose: 'Check platform-owned Playwright Chromium readiness before Visual Workbench capture.',
      currentCommand: 'ralph visual-workbench browser-readiness',
      fixtureSchemaVersion: null,
      resultSchemaVersion: PLATFORM_BROWSER_READINESS_SCHEMA_VERSION,
      promptIds: [],
      fixtureExamples: [],
      allowedMutationSummary: [
        'none; read-only platform browser launch/close probe',
      ],
      forbiddenMutationSummary: [
        'no project workspace browser install',
        'no source workspace writes',
        'no screenshot capture',
        'no task evidence/proof/lifecycle/runtime writes',
        'no Telegram/read-side availability inference',
      ],
      handoff: [
        'run_visual_workbench_capture_if_ready',
        'perform_worker_platform_browser_maintenance_if_blocked',
      ],
      notes: [
        'Browser verification infrastructure is platform-owned; missing Chromium is INFRA_BROWSER_UNAVAILABLE, not a project bug.',
        'Do not run playwright install or install-deps inside a project workspace to satisfy this stage.',
        'This stage explains whether capture can use the current runtime browser before starting the Workbench server.',
      ],
    },
    {
      stageId: 'visual_workbench_progress_publish',
      status: 'supported_now',
      modes: ['workspace_mutation'],
      runSurface: 'direct_cli',
      ownerBoundary: 'ralph.visual-evidence-progress-readside',
      purpose: 'Publish already-exported Visual Workbench task evidence into .arena/progress.json so Arena can derive visualEvidenceReviews.',
      currentCommand: 'ralph visual-workbench publish-progress --work-dir <project-source-workspace> [--task <taskId>]',
      fixtureSchemaVersion: null,
      resultSchemaVersion: VISUAL_WORKBENCH_PROGRESS_PUBLISH_SCHEMA_VERSION,
      promptIds: [],
      fixtureExamples: [],
      allowedMutationSummary: [
        '.arena/progress.json read-side projection only',
      ],
      forbiddenMutationSummary: [
        'no .ralph/plan.json writes',
        'no task evidence/proof/lifecycle/runtime writes',
        'no ProjectAsset upload',
        'no proofReviews[] write',
        'no capture directory scan',
        'no tg-spec evidence availability inference',
      ],
      handoff: [
        'run_arena_visual_evidence_ingest_after_manual_or_completed_experiment',
        'run_arena_visual_evidence_readback',
        'read_tg_spec_interaction_status_if_needed',
        'run_visual_workbench_status_if_projection_missing',
      ],
      notes: [
        'This stage is a read-side publish step over existing task-linked evidence rows; it does not create evidence.',
        'It preserves existing Arena progress state/message where present and publishes sanitized visualEvidence metadata without raw artifactPath values.',
        'Telegram screenshot-review availability still belongs to Arena visualEvidenceReviews, not this command or tg-spec heuristics.',
      ],
    },
    {
      stageId: 'visual_workbench_evidence_chain_readiness',
      status: 'supported_now',
      modes: ['read_only'],
      runSurface: 'direct_cli',
      ownerBoundary: 'ralph.visual-evidence-chain-readiness',
      purpose: 'Read which explicit Workbench evidence-chain boundary is ready or blocked before export, assessment, publish and Arena readback.',
      currentCommand: 'ralph visual-workbench evidence-chain-readiness --work-dir <project-source-workspace> [--run <visual-workbench-capture-run.json>] [--task <taskId>] [--story <storyId>] [--viewport <viewportName>] [--evidence-ref <visual-workbench-capture:...>] [--project-id <id>]',
      fixtureSchemaVersion: null,
      resultSchemaVersion: VISUAL_WORKBENCH_EVIDENCE_CHAIN_READINESS_SCHEMA_VERSION,
      promptIds: [],
      fixtureExamples: [],
      allowedMutationSummary: [
        'none; read-only diagnostic over explicit owner boundaries',
      ],
      forbiddenMutationSummary: [
        'no .ralph/plan.json writes',
        'no .arena/progress.json writes',
        'no task evidence/proof/lifecycle/runtime writes',
        'no ProjectAsset upload',
        'no capture directory scan as truth',
        'no Arena or tg-spec availability inference',
      ],
      handoff: [
        'run_visual_workbench_selector_readiness_if_selector_blocked',
        'run_visual_workbench_evidence_export_if_ready',
        'run_visual_workbench_assessment_if_ready',
        'run_visual_workbench_progress_publish_if_ready',
        'run_arena_visual_evidence_readback_if_ready',
      ],
      notes: [
        'This stage starts by delegating selector ownership diagnostics to visual_workbench_selector_readiness; it does not auto-select stories or viewports.',
        'This stage reports blockers such as missing plan truth, missing task feedback refs, missing capture selection or missing progress publish.',
        'It does not create evidence or publish progress; it only points to the next explicit stage command.',
        'Arena ProjectInteractionSnapshot remains the owner of final visualEvidenceReviews availability.',
      ],
    },
    {
      stageId: 'visual_workbench_manifest_readiness',
      status: 'supported_now',
      modes: ['read_only'],
      runSurface: 'direct_cli',
      ownerBoundary: 'ra-355.visual-workbench-manifest',
      purpose: 'Inspect the source-owned Visual Workbench manifest from an explicit git source ref before capture.',
      currentCommand: 'ralph visual-workbench inspect --work-dir <project-source-workspace> --source-ref <git-commit>',
      fixtureSchemaVersion: null,
      resultSchemaVersion: VISUAL_WORKBENCH_INSPECT_RESULT_SCHEMA_VERSION,
      promptIds: [],
      fixtureExamples: [],
      allowedMutationSummary: ['none; read-only source-ref manifest inspection'],
      forbiddenMutationSummary: [
        'no working-tree manifest reads',
        'no workbench server start',
        'no Playwright screenshot capture',
        'no task evidence/proof/lifecycle/runtime writes',
        'no fallback to app pages or old visual scenarios',
      ],
      handoff: [
        'run_visual_workbench_capture_if_selected',
        'fix_manifest_or_select_matching_source_ref',
        'checkout_source_ref_before_capture_if_needed',
      ],
      notes: [
        'This stage is runnable through the direct visual-workbench CLI, not through `ralph stage run` fixture mode.',
        'It uses @arena/contracts as the manifest schema and summary owner.',
        'It reports source HEAD match because capture requires HEAD == sourceRef.',
      ],
    },
    {
      stageId: 'visual_workbench_evidence_export',
      status: 'supported_now',
      modes: ['workspace_mutation'],
      runSurface: 'direct_cli',
      ownerBoundary: 'ralph.task-linked-evidence',
      purpose: 'Adopt one captured Visual Workbench story viewport into task-linked evidence as an inconclusive screenshot row.',
      currentCommand: 'ralph visual-workbench export-evidence --work-dir <project-source-workspace> --run <visual-workbench-capture-run.json> --task <taskId> --story <storyId> --viewport <viewportName>',
      fixtureSchemaVersion: null,
      resultSchemaVersion: VISUAL_WORKBENCH_EVIDENCE_EXPORT_SCHEMA_VERSION,
      promptIds: [],
      fixtureExamples: [],
      allowedMutationSummary: [
        'workDir-local .ralph visual-workbench artifact adoption',
        'task-linked evidence rows through PlanManager only',
      ],
      forbiddenMutationSummary: [
        'no screenshotProof or proof review write',
        'no ProjectAsset upload',
        'no task status update',
        'no blocker/runtime/lifecycle writes',
        'no feedback links invented from story names',
      ],
      handoff: [
        'run_visual_workbench_assessment_if_selected',
        'run_visual_workbench_status',
        'run_controller_visual_review_fixture_if_explicit_evidence_context_needed',
      ],
      notes: [
        'A captured Workbench screenshot is exported as inconclusive evidence only.',
        'The selected screenshot is copied from experiment output into a workDir-local Ralph evidence artifact path before the evidence row is written.',
        'The command derives feedback links only from the selected task.',
      ],
    },
    {
      stageId: 'visual_workbench_assessment',
      status: 'supported_now',
      modes: ['workspace_mutation'],
      runSurface: 'direct_cli',
      ownerBoundary: 'ralph.task-linked-evidence',
      purpose: 'Record an explicit manual assessment for one exported Visual Workbench screenshot evidence row.',
      currentCommand: 'ralph visual-workbench assess --work-dir <project-source-workspace> --task <taskId> --evidence-ref <visual-workbench-capture:...> --kind manual_note --result pass|fail|inconclusive --assessment <text>',
      fixtureSchemaVersion: null,
      resultSchemaVersion: VISUAL_WORKBENCH_ASSESSMENT_SCHEMA_VERSION,
      promptIds: [],
      fixtureExamples: [],
      allowedMutationSummary: [
        'manual_note evidence row through PlanManager only',
      ],
      forbiddenMutationSummary: [
        'no source screenshot row mutation',
        'no screenshotProof or proof review write',
        'no ProjectAsset upload',
        'no task status update',
        'no blocker/runtime/lifecycle writes',
      ],
      handoff: [
        'run_visual_workbench_status',
        'run_controller_visual_review_fixture_if_explicit_evidence_context_needed',
      ],
      notes: [
        'Pass/fail/inconclusive assessment is separate from the source screenshot row.',
        'The source screenshot row must remain inconclusive.',
        'Conflicting second assessments are rejected until a supersession model exists.',
      ],
    },
    {
      stageId: 'visual_workbench_status',
      status: 'supported_now',
      modes: ['read_only'],
      runSurface: 'direct_cli',
      ownerBoundary: 'ralph.task-linked-evidence-readback',
      purpose: 'Read Visual Workbench screenshot evidence and manual assessments from task-linked evidence rows.',
      currentCommand: 'ralph visual-workbench status --work-dir <project-source-workspace> [--task <taskId>]',
      fixtureSchemaVersion: null,
      resultSchemaVersion: VISUAL_WORKBENCH_STATUS_SCHEMA_VERSION,
      promptIds: [],
      fixtureExamples: [],
      allowedMutationSummary: ['none; read-only task evidence projection'],
      forbiddenMutationSummary: [
        'no artifact directory scans as truth',
        'no proof review write',
        'no ProjectAsset upload',
        'no task status update',
        'no blocker/runtime/lifecycle writes',
      ],
      handoff: [
        'inspect_visual_workbench_evidence_status',
        'run_visual_workbench_assessment_if_unassessed',
        'run_controller_visual_review_fixture_if_explicit_evidence_context_needed',
      ],
      notes: [
        'Status groups assessments by sourceEvidenceRef.',
        'Invalid, orphan or conflicting rows are reported, not repaired.',
        'Status does not decide task completion, proof readiness or lifecycle.',
      ],
    },
    {
      stageId: 'worker_path_canary',
      status: 'supported_now',
      modes: ['read_only', 'worker_path'],
      runSurface: 'direct_cli',
      ownerBoundary: 'governance.runtime-intent-worker-runner',
      purpose: 'Observe whether a selected project is ready for the normal worker path and compare production-path state with isolated-stage expectations.',
      currentCommand: 'services/arena-ctl/cli.sh project_experiment_preflight --project-id <id> --mode agent_run --tail <lines>',
      fixtureSchemaVersion: null,
      resultSchemaVersion: null,
      promptIds: [],
      fixtureExamples: [],
      allowedMutationSummary: [
        'none in this direct CLI observation stage',
        'normal project create/launch/retry mutations remain explicit operator actions outside the catalog',
      ],
      forbiddenMutationSummary: [
        'no runtime-intent lease creation',
        'no hidden retry/relaunch/recreate',
        'no workspace edits or canary repair',
        'no provider/model call',
        'no lifecycle/task/evidence/proof writes',
      ],
      handoff: [
        'wait_for_worker_claim_if_claimable',
        'inspect_executionReadiness_lifecycleBlockers_before_retry_when_waiting',
        'use_project_retry_now_only_with_required_human_evidence',
        'inspect_visual_workbench_manifest_readiness_after_product_work',
        'fix_owner_boundary_if_preflight_false_green_or_false_red',
      ],
      notes: [
        'This catalog entry points to the current-source arena-ctl preflight CLI; it does not start the canary or mutate lifecycle state.',
        'The actual worker-path canary is the normal create/provisioner/runtime-intent/worker/runner path.',
        'Use this stage before and after a normal worker-path run to compare isolated-stage expectations with production behavior.',
        'When proposedOperatorAction is none_wait_for_lifecycle_blocker, inspect executionReadiness.lifecycleBlockers; claim_not_agent_run is only the current claim symptom, not permission to repair or retry.',
      ],
    },
  ]);

export function getSupportedStageRunIds(): string[] {
  return Object.keys(SUPPORTED_STAGE_FIXTURE_RUNNERS).sort();
}

export function getSupportedStageCatalogIds(): string[] {
  return SUPPORTED_STAGE_CATALOG_ENTRIES.map((entry) => entry.stageId).sort();
}

export function getStageCatalogResult(input: {
  stageId?: string;
} = {}): StageCatalogResult {
  return filterStageCatalogResult(
    buildStageCatalogResult(SUPPORTED_STAGE_CATALOG_ENTRIES),
    input.stageId,
  );
}

export async function runStageFixtureFile(input: {
  stageId: string;
  fixturePath: string;
  outPath?: string;
  compact?: boolean;
}): Promise<StageFixtureRunResult> {
  const runner = SUPPORTED_STAGE_FIXTURE_RUNNERS[input.stageId];
  if (!runner) {
    throw new Error(`Unsupported isolated stage: ${input.stageId}`);
  }

  const result = await runner.runFixtureFile({
    fixturePath: input.fixturePath,
    outPath: input.outPath,
    compact: input.compact,
  });
  return {
    stageId: input.stageId,
    result,
    formatted: runner.formatResult(result, input.compact),
  };
}

export function buildStageCatalogResult(stages: StageCatalogEntry[]): StageCatalogResult {
  return {
    schemaVersion: STAGE_CATALOG_SCHEMA_VERSION,
    owner: 'ralph.stage-lab.catalog',
    mode: 'static_code_catalog',
    scope: 'supported_stage_workflows',
    stages: [...stages].sort((a, b) => a.stageId.localeCompare(b.stageId)),
    notes: [
      'Stage catalog is static code metadata for supported RA-356 isolated stage workflows.',
      '`runSurface=stage_run_fixture` stages are runnable through `ralph stage run`; `runSurface=direct_cli` stages use the listed command.',
      '`runSurface=stage_run_workspace` stages are runnable through `ralph stage run` with explicit workspace, source and provider inputs.',
      'Broader target-shape stages remain in task-local work docs until they have code-owned runnable entries.',
      'It does not inspect projects, fixtures, .ralph, .arena, screenshots, runtime state or lifecycle truth.',
      'Run a stage explicitly to produce disposable experiment output; listing stages never starts another stage.',
    ],
  };
}

export function filterStageCatalogResult(
  result: StageCatalogResult,
  stageId: string | undefined,
): StageCatalogResult {
  if (!stageId) return result;
  const stages = result.stages.filter((stage) => stage.stageId === stageId);
  if (stages.length === 0) {
    throw new Error(`Unsupported isolated stage: ${stageId}`);
  }
  return {
    ...result,
    stages,
  };
}

export function formatStageCatalogResult(result: StageCatalogResult, compact = false): string {
  return `${JSON.stringify(result, null, compact ? 0 : 2)}\n`;
}
