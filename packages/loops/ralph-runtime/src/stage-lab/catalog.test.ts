import assert from 'node:assert/strict';
import test from 'node:test';
import {
  STAGE_CATALOG_SCHEMA_VERSION,
  formatStageCatalogResult,
  getSupportedStageCatalogIds,
  getSupportedStageRunIds,
  getStageCatalogResult,
} from './catalog.js';

test('stage catalog lists supported stage workflows without runtime truth', () => {
  const result = getStageCatalogResult();
  const stageIds = result.stages.map((stage) => stage.stageId);

  assert.equal(result.schemaVersion, STAGE_CATALOG_SCHEMA_VERSION);
  assert.equal(result.owner, 'ralph.stage-lab.catalog');
  assert.equal(result.mode, 'static_code_catalog');
  assert.equal(result.scope, 'supported_stage_workflows');
  assert.deepEqual(stageIds, [
    'arena_visual_evidence_artifact_check',
    'arena_visual_evidence_ingest',
    'arena_visual_evidence_readback',
    'controller_project_dry_run',
    'controller_visual_review',
    'executor_project_task',
    'executor_task_io',
    'executor_task_workspace',
    'executor_task_workspace_continue',
    'executor_workspace_source_snapshot',
    'planner_project_dry_run',
    'planner_prompt_io',
    'planner_spec_migration_apply',
    'project_spec_artifact_audit',
    'prompt_contract_replay',
    'runtime_auth_readiness',
    'tg_spec_accepted_artifact_import',
    'tg_spec_launch_configure',
    'tg_spec_launch_start',
    'tg_spec_target_create',
    'visual_workbench_assessment',
    'visual_workbench_automation_status',
    'visual_workbench_browser_readiness',
    'visual_workbench_capture',
    'visual_workbench_capture_viewer',
    'visual_workbench_evidence_automation',
    'visual_workbench_evidence_chain_readiness',
    'visual_workbench_evidence_export',
    'visual_workbench_manifest_readiness',
    'visual_workbench_progress_publish',
    'visual_workbench_selector_readiness',
    'visual_workbench_shell_policy',
    'visual_workbench_status',
    'worker_path_canary',
  ]);
  assert.deepEqual(stageIds, getSupportedStageCatalogIds());
  assert.deepEqual(getSupportedStageRunIds(), [
    'controller_visual_review',
    'executor_task_io',
    'planner_prompt_io',
  ]);

  for (const stage of result.stages) {
    assert.equal(stage.status, 'supported_now');
    if (stage.runSurface === 'stage_run_workspace') {
      assert.match(stage.currentCommand, /^ralph stage run /);
      assert.match(stage.resultSchemaVersion ?? '', /^ra-356\./);
      if (stage.stageId === 'planner_project_dry_run') {
        assert.deepEqual(stage.modes, ['workspace_dry_run']);
        assert.equal(stage.fixtureSchemaVersion, 'ra-356.project-stage-snapshot.v1');
        assert.equal(stage.resultSchemaVersion, 'ra-356.planner-project-dry-run-result.v0');
        assert.equal(stage.ownerBoundary, 'ralph.planner.dry-run-adapter');
        assert(stage.forbiddenMutationSummary.includes('no .ralph/plan.json write'));
        assert(stage.forbiddenMutationSummary.includes('no hidden project-config, visualEvidenceMode, agent, model or timeout defaults'));
      } else if (stage.stageId === 'planner_spec_migration_apply') {
        assert.deepEqual(stage.modes, ['workspace_mutation']);
        assert.equal(stage.fixtureSchemaVersion, 'ra-356.project-stage-snapshot.v1');
        assert.equal(stage.resultSchemaVersion, 'ra-356.planner-spec-migration-apply-result.v0');
        assert.equal(stage.ownerBoundary, 'ralph.planner-spec-migration-apply');
        assert(stage.allowedMutationSummary.includes('live Project Stage Snapshot workspace .ralph/plan.json writes through PlanManager'));
        assert(stage.forbiddenMutationSummary.includes('no client workDir, spec or visualEvidenceMode truth'));
        assert(stage.forbiddenMutationSummary.includes('no executor, controller or Visual Workbench auto-start'));
        assert(stage.notes.some((note) => /applyPendingSpecMigrations/.test(note)));
      } else if (stage.stageId === 'controller_project_dry_run') {
        assert.deepEqual(stage.modes, ['workspace_dry_run']);
        assert.equal(stage.fixtureSchemaVersion, 'ra-356.project-stage-snapshot.v1');
        assert.equal(stage.resultSchemaVersion, 'ra-356.controller-project-dry-run-result.v0');
        assert.equal(stage.ownerBoundary, 'ralph.controller.dry-run-adapter');
        assert(stage.promptIds.includes('controller.audit'));
        assert(stage.forbiddenMutationSummary.includes('no .ralph/controller-reports write'));
        assert(stage.forbiddenMutationSummary.includes('no controller startup trigger'));
        assert(stage.notes.some((note) => /does not persist a full apply-ready ControllerReport/.test(note)));
        assert(stage.notes.some((note) => /E2E enforcer is explicitly disabled/.test(note)));
      } else if (stage.stageId === 'executor_project_task') {
        assert.deepEqual(stage.modes, ['workspace_mutation']);
        assert.equal(stage.fixtureSchemaVersion, 'ra-356.project-stage-snapshot.v1');
        assert.equal(stage.resultSchemaVersion, 'ra-356.executor-project-task-result.v0');
        assert.equal(stage.ownerBoundary, 'ralph.executor-project-task-adapter');
        assert(stage.allowedMutationSummary.includes('explicit live Project Stage Snapshot workspace source mutations from the selected agent'));
        assert(stage.allowedMutationSummary.includes('local project commit after a successful clean live workspace action'));
        assert(stage.forbiddenMutationSummary.includes('no remote git push'));
        assert(stage.forbiddenMutationSummary.includes('no task/proof/lifecycle truth from the local project commit'));
        assert(stage.forbiddenMutationSummary.includes('no live project truth reread after Project Stage Snapshot'));
      } else if (stage.stageId === 'executor_task_workspace') {
        assert.deepEqual(stage.modes, ['workspace_mutation']);
        assert.equal(stage.fixtureSchemaVersion, null);
        assert.equal(stage.resultSchemaVersion, 'ra-356.executor-task-workspace-result.v0');
        assert.equal(stage.ownerBoundary, 'ralph.executor-action-core');
        assert(stage.allowedMutationSummary.includes('explicit forked workDir source mutations from the selected agent'));
        assert(stage.forbiddenMutationSummary.includes('no hidden agent/model/timeout defaults'));
      } else if (stage.stageId === 'executor_task_workspace_continue') {
        assert.deepEqual(stage.modes, ['workspace_mutation']);
        assert.equal(stage.fixtureSchemaVersion, null);
        assert.equal(stage.resultSchemaVersion, 'ra-356.executor-task-workspace-continue-result.v0');
        assert.equal(stage.ownerBoundary, 'ralph.executor-action-core');
        assert(stage.currentCommand.includes('--executor-workspace-report <previous-executor-task-workspace-run.json>'));
        assert(stage.forbiddenMutationSummary.includes('no hidden retry, fallback, source adoption or task-state resume'));
        assert(stage.notes.some((note) => /previous agent_failed executor workspace report/.test(note)));
      } else {
        assert.deepEqual(stage.modes, ['workspace_mutation']);
        assert.equal(stage.stageId, 'executor_workspace_source_snapshot');
        assert.equal(stage.fixtureSchemaVersion, null);
        assert.equal(stage.resultSchemaVersion, 'ra-356.executor-workspace-source-snapshot.v0');
        assert.equal(stage.ownerBoundary, 'ralph.stage-lab.executor-source-handoff');
        assert(stage.allowedMutationSummary.includes('explicit forked workDir git index and local experiment commit only'));
        assert(stage.forbiddenMutationSummary.includes('no Visual Workbench capture auto-run'));
        assert(stage.handoff.includes('run_visual_workbench_selector_readiness_after_visual_task_snapshot'));
        assert(!stage.handoff.includes('run_visual_workbench_capture_if_selected'));
        assert(stage.notes.some((note) => /does not emit a capture command/.test(note)));
      }
    } else if (stage.runSurface === 'stage_run_fixture') {
      assert.deepEqual(stage.modes, ['fixture']);
      assert.match(stage.currentCommand, /^ralph stage run /);
      assert.match(stage.fixtureSchemaVersion ?? '', /^ra-356\./);
      assert.match(stage.resultSchemaVersion ?? '', /^ra-356\./);
      assert(stage.ownerBoundary.startsWith('ralph.'));
      assert(stage.allowedMutationSummary.includes('new explicit temp --out file only'));
    } else {
      if (stage.stageId === 'arena_visual_evidence_artifact_check') {
        assert.deepEqual(stage.modes, ['read_only']);
        assert.match(stage.currentCommand, /^services\/arena-ctl\/cli\.sh project_visual_evidence_artifact_check /);
        assert.equal(stage.fixtureSchemaVersion, null);
        assert.equal(stage.resultSchemaVersion, null);
        assert.equal(stage.ownerBoundary, 'governance.project-interaction-snapshot');
        assert(stage.allowedMutationSummary.includes('none; read-only visual evidence artifact downloadability diagnostics'));
        assert(stage.forbiddenMutationSummary.includes('no raw bytes or storage paths in output'));
        assert(stage.forbiddenMutationSummary.includes('no Workbench capture folder scan'));
        assert(stage.handoff.includes('open_current_visual_evidence_review_artifact_if_downloadable'));
      } else if (stage.stageId === 'arena_visual_evidence_ingest') {
        assert.deepEqual(stage.modes, ['operator_mutation']);
        assert.match(stage.currentCommand, /^services\/arena-ctl\/cli\.sh project_visual_evidence_ingest /);
        assert.equal(stage.fixtureSchemaVersion, null);
        assert.equal(stage.resultSchemaVersion, 'ra-356.project-visual-evidence-ingest.v1');
        assert.equal(stage.ownerBoundary, 'governance.project-visual-evidence-ingest');
        assert(stage.allowedMutationSummary.includes('canonical selected visualEvidence row merge into Project.progressJson'));
        assert(stage.allowedMutationSummary.includes('matching system ProjectAsset import under assets/system/visual-evidence/<reviewId>/capture.png'));
        assert(stage.forbiddenMutationSummary.includes('no submitted progress JSON verbatim persistence'));
        assert(stage.forbiddenMutationSummary.includes('no relaunch, recreate runtime, retry or hidden unblock'));
        assert(stage.handoff.includes('run_arena_visual_evidence_readback'));
      } else if (stage.stageId === 'arena_visual_evidence_readback') {
        assert.deepEqual(stage.modes, ['read_only']);
        assert.match(stage.currentCommand, /^services\/arena-ctl\/cli\.sh project_proof_reviews /);
        assert.equal(stage.fixtureSchemaVersion, null);
        assert.equal(stage.resultSchemaVersion, null);
        assert.equal(stage.ownerBoundary, 'governance.project-interaction-snapshot');
        assert(stage.allowedMutationSummary.includes('none; read-only governance proof-review projection'));
        assert(stage.forbiddenMutationSummary.includes('no local .ralph or .arena file scan'));
        assert(stage.forbiddenMutationSummary.includes('no delivery/outbox history inference'));
        assert(stage.handoff.includes('run_arena_visual_evidence_artifact_check_if_reviews_exist'));
        assert(stage.handoff.includes('render_tg_spec_screenshot_action_if_arena_returns_one'));
      } else if (stage.stageId === 'prompt_contract_replay') {
        assert.deepEqual(stage.modes, ['fixture']);
        assert.match(stage.currentCommand, /^ralph prompts replay /);
        assert.equal(stage.fixtureSchemaVersion, 'ra-356.prompt-fixture.v1');
        assert.equal(stage.resultSchemaVersion, 'ra-356.prompt-replay-result.v1');
        assert.equal(stage.ownerBoundary, 'ralph.prompt-repository');
        assert(stage.promptIds.includes('executor.taskSection'));
        assert(stage.promptIds.includes('executor.productSkill'));
        assert(stage.promptIds.includes('executor.uxSkill'));
        assert(stage.fixtureExamples.includes('work/plans/ra-356-manual-experiment-tooling/fixtures/executor-product-skill.json'));
        assert(stage.fixtureExamples.includes('work/plans/ra-356-manual-experiment-tooling/fixtures/executor-ux-skill.json'));
        assert(stage.allowedMutationSummary.includes('new explicit disposable --out file only'));
        assert(stage.forbiddenMutationSummary.includes('no model provider call'));
        assert(stage.forbiddenMutationSummary.includes('no planner/executor/controller stage run'));
        assert(stage.notes.some((note) => /not runnable product\/UX provider passes/.test(note)));
      } else if (stage.stageId === 'project_spec_artifact_audit') {
        assert.deepEqual(stage.modes, ['read_only']);
        assert.match(stage.currentCommand, /^services\/arena-ctl\/cli\.sh project_spec_artifact_audit /);
        assert.equal(stage.fixtureSchemaVersion, null);
        assert.equal(stage.resultSchemaVersion, null);
        assert.equal(stage.ownerBoundary, 'governance.spec-artifact-audit');
        assert(stage.allowedMutationSummary.includes('none; read-only governance spec artifact audit'));
        assert(stage.forbiddenMutationSummary.includes('no workspace/spec-input file inspection as truth'));
      } else if (stage.stageId === 'runtime_auth_readiness') {
        assert.deepEqual(stage.modes, ['read_only']);
        assert.match(stage.currentCommand, /^services\/arena-ctl\/cli\.sh authd_health$/);
        assert.equal(stage.fixtureSchemaVersion, null);
        assert.equal(stage.resultSchemaVersion, null);
        assert.equal(stage.ownerBoundary, 'governance.runtime-auth-readiness');
        assert(stage.allowedMutationSummary.includes('none; read-only governance authd health and TokenManager status projections'));
        assert(stage.forbiddenMutationSummary.includes('no provider refresh or token rotation'));
        assert(stage.forbiddenMutationSummary.includes('no mint-run-auth call'));
        assert(stage.handoff.includes('run_project_experiment_preflight_after_auth_ready'));
        assert(stage.handoff.includes('inspect_token_status_if_api_key_provider_missing'));
        assert(stage.notes.some((note) => /authd_operator_digest/i.test(note)));
      } else if (stage.stageId === 'tg_spec_target_create') {
        assert.deepEqual(stage.modes, ['operator_mutation']);
        assert.match(stage.currentCommand, /^services\/arena-ctl\/cli\.sh tg_spec_target_create /);
        assert.equal(stage.fixtureSchemaVersion, null);
        assert.equal(stage.resultSchemaVersion, null);
        assert.equal(stage.ownerBoundary, 'governance.tg-spec-target-project-create');
        assert(stage.allowedMutationSummary.includes('optional explicit sourceSeedProfile in sourceConfig'));
        assert(stage.forbiddenMutationSummary.includes('no raw local spec seed'));
        assert(stage.handoff.includes('run_tg_spec_accepted_artifact_import'));
      } else if (stage.stageId === 'tg_spec_accepted_artifact_import') {
        assert.deepEqual(stage.modes, ['operator_mutation']);
        assert.match(stage.currentCommand, /^services\/arena-ctl\/cli\.sh tg_spec_accepted_artifact_import /);
        assert.equal(stage.fixtureSchemaVersion, null);
        assert.equal(stage.resultSchemaVersion, null);
        assert.equal(stage.ownerBoundary, 'governance.tg-spec-accepted-artifact-import');
        assert(stage.allowedMutationSummary.includes('mirror spec/spec version update through the shared tg-spec import helper'));
        assert(stage.forbiddenMutationSummary.includes('no .arena/spec-input.json or workspace injection'));
        assert(stage.handoff.includes('inspect_project_spec_artifact_audit'));
      } else if (stage.stageId === 'tg_spec_launch_configure') {
        assert.deepEqual(stage.modes, ['operator_mutation']);
        assert.match(stage.currentCommand, /^services\/arena-ctl\/cli\.sh tg_spec_launch_configure /);
        assert.equal(stage.fixtureSchemaVersion, null);
        assert.equal(stage.resultSchemaVersion, null);
        assert.equal(stage.ownerBoundary, 'governance.tg-spec-project-launch');
        assert(stage.allowedMutationSummary.includes('launch configuration state and project/component config through configureTgSpecProjectLaunch'));
        assert(stage.forbiddenMutationSummary.includes('no launch start'));
        assert(stage.handoff.includes('run_project_experiment_preflight_agent_run_before_start'));
        assert(stage.handoff.includes('run_tg_spec_launch_start_only_when_preflight_proposes_tg_spec_launch_start'));
      } else if (stage.stageId === 'tg_spec_launch_start') {
        assert.deepEqual(stage.modes, ['operator_mutation']);
        assert.match(stage.currentCommand, /^services\/arena-ctl\/cli\.sh tg_spec_launch_start /);
        assert.equal(stage.fixtureSchemaVersion, null);
        assert.equal(stage.resultSchemaVersion, null);
        assert.equal(stage.ownerBoundary, 'governance.tg-spec-project-launch');
        assert(stage.forbiddenMutationSummary.includes('no relaunch alias'));
        assert(stage.handoff.includes('run_worker_path_canary'));
      } else if (stage.stageId === 'visual_workbench_manifest_readiness') {
        assert.equal(stage.fixtureSchemaVersion, null);
        assert.deepEqual(stage.modes, ['read_only']);
        assert.match(stage.currentCommand, /^ralph visual-workbench inspect /);
        assert.equal(stage.resultSchemaVersion, 'ra-356.visual-workbench-inspect-result.v0');
        assert.equal(stage.ownerBoundary, 'ra-355.visual-workbench-manifest');
        assert(stage.allowedMutationSummary.includes('none; read-only source-ref manifest inspection'));
      } else if (stage.stageId === 'visual_workbench_capture') {
        assert.equal(stage.fixtureSchemaVersion, null);
        assert.deepEqual(stage.modes, ['workspace_mutation']);
        assert.match(stage.currentCommand, /^ralph visual-workbench capture /);
        assert(stage.currentCommand.includes('--selection story_viewports'));
        assert(stage.currentCommand.includes('--story <storyId>'));
        assert(stage.currentCommand.includes('--viewport <viewportName>'));
        assert.equal(stage.resultSchemaVersion, 'ra-355.visual-workbench-capture-run.v0');
        assert.equal(stage.ownerBoundary, 'ra-355.visual-workbench-capture');
        assert(stage.allowedMutationSummary.includes('explicit output directory outside workDir only'));
        assert(stage.notes.some((note) => note.includes('never falls back to full_manifest')));
      } else if (stage.stageId === 'visual_workbench_capture_viewer') {
        assert.equal(stage.fixtureSchemaVersion, null);
        assert.deepEqual(stage.modes, ['artifact_write']);
        assert.match(stage.currentCommand, /^ralph visual-workbench render-viewer /);
        assert.equal(stage.resultSchemaVersion, 'ra-356.visual-workbench-capture-viewer.v1');
        assert.equal(stage.ownerBoundary, 'ra-355.visual-workbench-capture-viewer');
        assert(stage.allowedMutationSummary.includes('index.html beside the provided capture report only'));
        assert(stage.forbiddenMutationSummary.includes('no screenshot capture'));
      } else if (stage.stageId === 'visual_workbench_evidence_automation') {
        assert.equal(stage.fixtureSchemaVersion, null);
        assert.deepEqual(stage.modes, ['workspace_mutation']);
        assert.match(stage.currentCommand, /^ralph visual-workbench automate-evidence /);
        assert.equal(stage.resultSchemaVersion, 'ra-356.visual-workbench-automation.v5');
        assert.equal(stage.ownerBoundary, 'ralph.visual-workbench-evidence-automation');
        assert(stage.allowedMutationSummary.includes('visual-workbench-automation-run.json diagnostic report in the explicit outDir'));
        assert(stage.allowedMutationSummary.includes('Ralph-local latest diagnostic copy under .ralph/visual-workbench/automation-runs/<taskId>/latest.json'));
        assert(stage.allowedMutationSummary.includes('task-linked evidence rows through PlanManager only'));
        assert(stage.forbiddenMutationSummary.includes('no lifecycle, runtime intent, blocker or task status writes'));
        assert(stage.forbiddenMutationSummary.includes('no pass/fail assessment from capture'));
        assert(stage.forbiddenMutationSummary.includes('no project workspace browser install or browser-infra self-repair'));
        assert(stage.handoff.includes('inspect_report_selector_ambiguities_when_story_matches_multiple_tasks'));
        assert(stage.handoff.includes('run_visual_workbench_browser_readiness_if_browser_readiness_blocked'));
        assert(stage.notes.some((note) => note.includes('report.selector.ambiguities')));
      } else if (stage.stageId === 'visual_workbench_automation_status') {
        assert.equal(stage.fixtureSchemaVersion, null);
        assert.deepEqual(stage.modes, ['read_only']);
        assert.match(stage.currentCommand, /^ralph visual-workbench automation-status /);
        assert.equal(stage.resultSchemaVersion, 'ra-356.visual-workbench-automation-status.v1');
        assert.equal(stage.ownerBoundary, 'ralph.visual-workbench-automation-diagnostic-readback');
        assert(stage.allowedMutationSummary.includes('none; read-only diagnostic over one explicit automation report path or one task latest diagnostic path'));
        assert(stage.forbiddenMutationSummary.includes('no capture directory scanning'));
        assert(stage.forbiddenMutationSummary.includes('no .arena/progress.json writes'));
      } else if (stage.stageId === 'visual_workbench_browser_readiness') {
        assert.equal(stage.fixtureSchemaVersion, null);
        assert.deepEqual(stage.modes, ['read_only']);
        assert.match(stage.currentCommand, /^ralph visual-workbench browser-readiness$/);
        assert.equal(stage.resultSchemaVersion, 'ra-356.platform-browser-readiness.v1');
        assert.equal(stage.ownerBoundary, 'platform.browser-readiness');
        assert(stage.allowedMutationSummary.includes('none; read-only platform browser launch/close probe'));
        assert(stage.forbiddenMutationSummary.includes('no project workspace browser install'));
      } else if (stage.stageId === 'visual_workbench_evidence_chain_readiness') {
        assert.equal(stage.fixtureSchemaVersion, null);
        assert.deepEqual(stage.modes, ['read_only']);
        assert.match(stage.currentCommand, /^ralph visual-workbench evidence-chain-readiness /);
        assert.equal(stage.resultSchemaVersion, 'ra-356.visual-workbench-evidence-chain-readiness.v4');
        assert.equal(stage.ownerBoundary, 'ralph.visual-evidence-chain-readiness');
        assert(stage.allowedMutationSummary.includes('none; read-only diagnostic over explicit owner boundaries'));
      } else if (stage.stageId === 'visual_workbench_evidence_export') {
        assert.equal(stage.fixtureSchemaVersion, null);
        assert.deepEqual(stage.modes, ['workspace_mutation']);
        assert.match(stage.currentCommand, /^ralph visual-workbench export-evidence /);
        assert.equal(stage.resultSchemaVersion, 'ra-355.visual-workbench-evidence-export.v1');
        assert.equal(stage.ownerBoundary, 'ralph.task-linked-evidence');
        assert(stage.allowedMutationSummary.includes('task-linked evidence rows through PlanManager only'));
      } else if (stage.stageId === 'visual_workbench_assessment') {
        assert.equal(stage.fixtureSchemaVersion, null);
        assert.deepEqual(stage.modes, ['workspace_mutation']);
        assert.match(stage.currentCommand, /^ralph visual-workbench assess /);
        assert.equal(stage.resultSchemaVersion, 'ra-355.visual-workbench-assessment.v1');
        assert.equal(stage.ownerBoundary, 'ralph.task-linked-evidence');
      } else if (stage.stageId === 'visual_workbench_progress_publish') {
        assert.equal(stage.fixtureSchemaVersion, null);
        assert.deepEqual(stage.modes, ['workspace_mutation']);
        assert.match(stage.currentCommand, /^ralph visual-workbench publish-progress /);
        assert.equal(stage.resultSchemaVersion, 'ra-356.visual-workbench-progress-publish.v1');
        assert.equal(stage.ownerBoundary, 'ralph.visual-evidence-progress-readside');
        assert(stage.allowedMutationSummary.includes('.arena/progress.json read-side projection only'));
        assert(stage.forbiddenMutationSummary.includes('no .ralph/plan.json writes'));
        assert(stage.handoff.includes('run_arena_visual_evidence_readback'));
      } else if (stage.stageId === 'visual_workbench_selector_readiness') {
        assert.equal(stage.fixtureSchemaVersion, null);
        assert.deepEqual(stage.modes, ['read_only']);
        assert.match(stage.currentCommand, /^ralph visual-workbench selector-readiness /);
        assert.equal(stage.resultSchemaVersion, 'ra-356.visual-workbench-selector-readiness.v2');
        assert.equal(stage.ownerBoundary, 'ralph.visual-workbench-selector-readiness');
        assert(stage.allowedMutationSummary.includes('none; read-only diagnostic over .ralph/plan.json and visual-workbench/manifest.json'));
        assert(stage.forbiddenMutationSummary.includes('no Workbench server start'));
        assert(stage.forbiddenMutationSummary.includes('no selector inference from routes, titles, widgets, states, claims or filenames'));
        assert(stage.handoff.includes('run_visual_workbench_shell_policy_if_selector_ready'));
      } else if (stage.stageId === 'visual_workbench_shell_policy') {
        assert.equal(stage.fixtureSchemaVersion, null);
        assert.deepEqual(stage.modes, ['read_only']);
        assert.match(stage.currentCommand, /^ralph visual-workbench shell-policy /);
        assert.equal(stage.resultSchemaVersion, 'ra-356.visual-workbench-shell-policy.v1');
        assert.equal(stage.ownerBoundary, 'ralph.visual-workbench-shell-policy');
        assert(stage.allowedMutationSummary.includes('none; read-only diagnostic over first-party Ralph config and visual-workbench/manifest.json'));
        assert(stage.forbiddenMutationSummary.includes('no shell command execution'));
        assert(stage.forbiddenMutationSummary.includes('no self-authorization from visual-workbench/manifest.json or project config'));
        assert(stage.handoff.includes('run_visual_workbench_capture_only_after_selector_ready_and_shell_policy_allowed'));
      } else if (stage.stageId === 'visual_workbench_status') {
        assert.equal(stage.fixtureSchemaVersion, null);
        assert.equal(stage.stageId, 'visual_workbench_status');
        assert.deepEqual(stage.modes, ['read_only']);
        assert.match(stage.currentCommand, /^ralph visual-workbench status /);
        assert.equal(stage.resultSchemaVersion, 'ra-355.visual-workbench-status.v1');
        assert.equal(stage.ownerBoundary, 'ralph.task-linked-evidence-readback');
      } else {
        assert.equal(stage.fixtureSchemaVersion, null);
        assert.equal(stage.stageId, 'worker_path_canary');
        assert.deepEqual(stage.modes, ['read_only', 'worker_path']);
        assert.match(stage.currentCommand, /^services\/arena-ctl\/cli\.sh project_experiment_preflight /);
        assert.equal(stage.resultSchemaVersion, null);
        assert.equal(stage.ownerBoundary, 'governance.runtime-intent-worker-runner');
        assert(stage.allowedMutationSummary.includes('none in this direct CLI observation stage'));
        assert(stage.forbiddenMutationSummary.includes('no runtime-intent lease creation'));
        assert(stage.forbiddenMutationSummary.includes('no hidden retry/relaunch/recreate'));
      }
    }
  }

  const raw = JSON.stringify(result);
  assert.equal(raw.includes('projectId'), false);
  assert.equal(raw.includes('runtimeState'), false);
  assert.equal(raw.includes('lifecycleState'), false);
  assert.equal(raw.includes('allowedMutations'), false);
  assert.equal(raw.includes('resultPath'), false);
  assert.equal(raw.includes('verificationEvidence'), false);
});

test('stage catalog filters to one stage and rejects unknown stage ids', () => {
  const result = getStageCatalogResult({ stageId: 'executor_task_io' });

  assert.equal(result.stages.length, 1);
  assert.equal(result.stages[0].stageId, 'executor_task_io');
  assert.deepEqual(result.stages[0].promptIds, ['executor.agentPrompt']);
  assert.match(result.stages[0].fixtureExamples[0], /executor-task-io-visual-task\.json$/);

  assert.throws(() => getStageCatalogResult({ stageId: 'unknown_stage' }), /Unsupported isolated stage/);
});

test('stage catalog filters to executor workspace stage', () => {
  const result = getStageCatalogResult({ stageId: 'executor_task_workspace' });

  assert.equal(result.stages.length, 1);
  assert.equal(result.stages[0].stageId, 'executor_task_workspace');
  assert.equal(result.stages[0].runSurface, 'stage_run_workspace');
  assert.deepEqual(result.stages[0].modes, ['workspace_mutation']);
  assert.deepEqual(result.stages[0].promptIds, ['executor.agentPrompt']);
  assert(result.stages[0].currentCommand.includes('--agent <claude-code|codex|opencode> --model <model> --timeout-minutes <minutes>'));
});

test('stage catalog filters to executor workspace continuation stage', () => {
  const result = getStageCatalogResult({ stageId: 'executor_task_workspace_continue' });

  assert.equal(result.stages.length, 1);
  assert.equal(result.stages[0].stageId, 'executor_task_workspace_continue');
  assert.equal(result.stages[0].runSurface, 'stage_run_workspace');
  assert.deepEqual(result.stages[0].modes, ['workspace_mutation']);
  assert.deepEqual(result.stages[0].promptIds, ['executor.agentPrompt']);
  assert(result.stages[0].currentCommand.includes('--executor-workspace-report <previous-executor-task-workspace-run.json>'));
  assert(result.stages[0].notes.some((note) => /separate from executor_project_task --mode resume_interrupted/i.test(note)));
});

test('stage catalog filters to executor project task adapter stage', () => {
  const result = getStageCatalogResult({ stageId: 'executor_project_task' });

  assert.equal(result.stages.length, 1);
  assert.equal(result.stages[0].stageId, 'executor_project_task');
  assert.equal(result.stages[0].runSurface, 'stage_run_workspace');
  assert.deepEqual(result.stages[0].modes, ['workspace_mutation']);
  assert.deepEqual(result.stages[0].promptIds, ['executor.agentPrompt', 'executor.taskSection']);
  assert.equal(result.stages[0].fixtureSchemaVersion, 'ra-356.project-stage-snapshot.v1');
  assert(result.stages[0].currentCommand.includes('--snapshot <project-stage-snapshot.json> --mode <new_task|failed_task|resume_interrupted> --workspace-mode live_workspace_action'));
  assert(result.stages[0].notes.some((note) => /not a second executor/i.test(note)));
  assert(result.stages[0].notes.some((note) => /live_workspace_action/i.test(note)));
  assert(result.stages[0].notes.some((note) => /create or clone the fork workDir first/i.test(note)));
  assert(result.stages[0].notes.some((note) => /failed_task for failed tasks/i.test(note)));
  assert(result.stages[0].notes.some((note) => /resume_interrupted for in-progress tasks/i.test(note)));
});

test('stage catalog filters to executor workspace source snapshot stage', () => {
  const result = getStageCatalogResult({ stageId: 'executor_workspace_source_snapshot' });

  assert.equal(result.stages.length, 1);
  assert.equal(result.stages[0].stageId, 'executor_workspace_source_snapshot');
  assert.equal(result.stages[0].runSurface, 'stage_run_workspace');
  assert.deepEqual(result.stages[0].modes, ['workspace_mutation']);
  assert.deepEqual(result.stages[0].promptIds, []);
  assert(result.stages[0].currentCommand.includes('--executor-workspace-report <executor-task-workspace-run.json>'));
  assert(result.stages[0].currentCommand.includes('[--project-id <id>]'));
  assert(result.stages[0].notes.some((note) => /readback handoff hint only/i.test(note)));
});

test('stage catalog filters to Prompt Lab contract replay stage', () => {
  const result = getStageCatalogResult({ stageId: 'prompt_contract_replay' });
  const stage = result.stages[0];

  assert.equal(stage.stageId, 'prompt_contract_replay');
  assert.equal(stage.runSurface, 'direct_cli');
  assert.deepEqual(stage.modes, ['fixture']);
  assert.equal(stage.fixtureSchemaVersion, 'ra-356.prompt-fixture.v1');
  assert.equal(stage.resultSchemaVersion, 'ra-356.prompt-replay-result.v1');
  assert.deepEqual(stage.promptIds, [
    'planner.initial',
    'planner.replan',
    'planner.specMigration',
    'executor.agentPrompt',
    'executor.taskSection',
    'executor.productSkill',
    'executor.uxSkill',
    'controller.audit',
    'controller.e2eApplicability',
  ]);
  assert(stage.fixtureExamples.some((example) => /executor-task-section-visual-workbench\.json$/.test(example)));
  assert(stage.fixtureExamples.some((example) => /executor-product-skill\.json$/.test(example)));
  assert(stage.fixtureExamples.some((example) => /executor-ux-skill\.json$/.test(example)));
  assert(stage.notes.some((note) => /Prompt replay is prompt-shape inspection only/i.test(note)));
});

test('stage catalog filters to tg-spec accepted-artifact operator stages', () => {
  const auditStage = getStageCatalogResult({ stageId: 'project_spec_artifact_audit' }).stages[0];
  assert.equal(auditStage.runSurface, 'direct_cli');
  assert.deepEqual(auditStage.modes, ['read_only']);
  assert(auditStage.currentCommand.includes('project_spec_artifact_audit'));

  const targetStage = getStageCatalogResult({ stageId: 'tg_spec_target_create' }).stages[0];
  assert.equal(targetStage.runSurface, 'direct_cli');
  assert.deepEqual(targetStage.modes, ['operator_mutation']);
  assert(targetStage.currentCommand.includes('tg_spec_target_create'));
  assert(targetStage.forbiddenMutationSummary.includes('no raw local spec seed'));

  const importStage = getStageCatalogResult({ stageId: 'tg_spec_accepted_artifact_import' }).stages[0];
  assert.equal(importStage.runSurface, 'direct_cli');
  assert.deepEqual(importStage.modes, ['operator_mutation']);
  assert(importStage.currentCommand.includes('tg_spec_accepted_artifact_import'));
  assert(importStage.forbiddenMutationSummary.includes('no feedbackItemRefs invented by operator tooling'));

  const configureStage = getStageCatalogResult({ stageId: 'tg_spec_launch_configure' }).stages[0];
  assert.equal(configureStage.runSurface, 'direct_cli');
  assert.deepEqual(configureStage.modes, ['operator_mutation']);
  assert(configureStage.currentCommand.includes('tg_spec_launch_configure'));
  assert(configureStage.forbiddenMutationSummary.includes('no launch start'));
  assert(configureStage.handoff.includes('run_project_experiment_preflight_agent_run_before_start'));

  const launchStage = getStageCatalogResult({ stageId: 'tg_spec_launch_start' }).stages[0];
  assert.equal(launchStage.runSurface, 'direct_cli');
  assert.deepEqual(launchStage.modes, ['operator_mutation']);
  assert(launchStage.currentCommand.includes('tg_spec_launch_start'));
  assert(launchStage.forbiddenMutationSummary.includes('no plain agent-on shortcut'));
  assert.match(launchStage.notes.join(' '), /project_experiment_preflight --mode agent_run proposes tg_spec_launch_start/);
});

test('stage catalog filters to direct CLI Visual Workbench readiness stage', () => {
  const result = getStageCatalogResult({ stageId: 'visual_workbench_manifest_readiness' });

  assert.equal(result.stages.length, 1);
  assert.equal(result.stages[0].stageId, 'visual_workbench_manifest_readiness');
  assert.equal(result.stages[0].runSurface, 'direct_cli');
  assert.deepEqual(result.stages[0].promptIds, []);
  assert.deepEqual(result.stages[0].fixtureExamples, []);
  assert(result.stages[0].handoff.includes('run_visual_workbench_capture_if_selected'));
});

test('stage catalog filters to direct CLI Visual Workbench capture stage', () => {
  const result = getStageCatalogResult({ stageId: 'visual_workbench_capture' });

  assert.equal(result.stages.length, 1);
  assert.equal(result.stages[0].stageId, 'visual_workbench_capture');
  assert.equal(result.stages[0].runSurface, 'direct_cli');
  assert.deepEqual(result.stages[0].modes, ['workspace_mutation']);
  assert.deepEqual(result.stages[0].promptIds, []);
  assert.deepEqual(result.stages[0].fixtureExamples, []);
  assert(result.stages[0].handoff.includes('run_controller_visual_review_fixture_if_explicit_evidence_context_needed'));
});

test('stage catalog filters to direct CLI Visual Workbench capture viewer stage', () => {
  const result = getStageCatalogResult({ stageId: 'visual_workbench_capture_viewer' });

  assert.equal(result.stages.length, 1);
  assert.equal(result.stages[0].stageId, 'visual_workbench_capture_viewer');
  assert.equal(result.stages[0].runSurface, 'direct_cli');
  assert.deepEqual(result.stages[0].modes, ['artifact_write']);
  assert(result.stages[0].handoff.includes('open_static_viewer_for_manual_inspection'));
});

test('stage catalog does not advertise broad controller-live handoffs from Workbench stages', () => {
  const result = getStageCatalogResult();
  const workbenchHandoffs = result.stages
    .filter((stage) => stage.stageId.startsWith('visual_workbench_'))
    .flatMap((stage) => stage.handoff);

  assert(!workbenchHandoffs.includes('run_controller_visual_review_later_if_needed'));
  assert(workbenchHandoffs.includes('run_controller_visual_review_fixture_if_explicit_evidence_context_needed'));
});

test('stage catalog filters to direct CLI Visual Workbench evidence stages', () => {
  const readinessStage = getStageCatalogResult({ stageId: 'visual_workbench_evidence_chain_readiness' });
  assert.equal(readinessStage.stages[0].runSurface, 'direct_cli');
  assert.equal(readinessStage.stages[0].resultSchemaVersion, 'ra-356.visual-workbench-evidence-chain-readiness.v4');
  assert.deepEqual(readinessStage.stages[0].modes, ['read_only']);
  assert(readinessStage.stages[0].forbiddenMutationSummary.includes('no .arena/progress.json writes'));
  assert(readinessStage.stages[0].handoff.includes('run_visual_workbench_evidence_export_if_ready'));

  const exportStage = getStageCatalogResult({ stageId: 'visual_workbench_evidence_export' });
  assert.equal(exportStage.stages[0].runSurface, 'direct_cli');
  assert.equal(exportStage.stages[0].resultSchemaVersion, 'ra-355.visual-workbench-evidence-export.v1');
  assert(exportStage.stages[0].handoff.includes('run_visual_workbench_assessment_if_selected'));

  const assessmentStage = getStageCatalogResult({ stageId: 'visual_workbench_assessment' });
  assert.equal(assessmentStage.stages[0].runSurface, 'direct_cli');
  assert.equal(assessmentStage.stages[0].resultSchemaVersion, 'ra-355.visual-workbench-assessment.v1');
  assert(assessmentStage.stages[0].forbiddenMutationSummary.includes('no source screenshot row mutation'));

  const statusStage = getStageCatalogResult({ stageId: 'visual_workbench_status' });
  assert.equal(statusStage.stages[0].runSurface, 'direct_cli');
  assert.equal(statusStage.stages[0].resultSchemaVersion, 'ra-355.visual-workbench-status.v1');
  assert.deepEqual(statusStage.stages[0].modes, ['read_only']);

  const progressPublishStage = getStageCatalogResult({ stageId: 'visual_workbench_progress_publish' });
  assert.equal(progressPublishStage.stages[0].runSurface, 'direct_cli');
  assert.equal(progressPublishStage.stages[0].resultSchemaVersion, 'ra-356.visual-workbench-progress-publish.v1');
  assert.deepEqual(progressPublishStage.stages[0].modes, ['workspace_mutation']);
  assert(progressPublishStage.stages[0].forbiddenMutationSummary.includes('no tg-spec evidence availability inference'));
  assert(progressPublishStage.stages[0].handoff.includes('run_arena_visual_evidence_readback'));

  const shellPolicyStage = getStageCatalogResult({ stageId: 'visual_workbench_shell_policy' });
  assert.equal(shellPolicyStage.stages[0].runSurface, 'direct_cli');
  assert.equal(shellPolicyStage.stages[0].resultSchemaVersion, 'ra-356.visual-workbench-shell-policy.v1');
  assert.deepEqual(shellPolicyStage.stages[0].modes, ['read_only']);
  assert(shellPolicyStage.stages[0].forbiddenMutationSummary.includes('no fallback command, app-page capture or legacy screenshot-proof path'));
  assert(shellPolicyStage.stages[0].notes.some((note) => /not authority to execute/i.test(note)));

  const automationStage = getStageCatalogResult({ stageId: 'visual_workbench_evidence_automation' });
  assert.equal(automationStage.stages[0].runSurface, 'direct_cli');
  assert.equal(automationStage.stages[0].resultSchemaVersion, 'ra-356.visual-workbench-automation.v5');
  assert.deepEqual(automationStage.stages[0].modes, ['workspace_mutation']);
  assert(automationStage.stages[0].currentCommand.includes('--manifest visual-workbench/manifest.json'));
  assert(automationStage.stages[0].forbiddenMutationSummary.includes('no ProjectAsset upload or asset-derived evidence creation'));
  assert(automationStage.stages[0].forbiddenMutationSummary.includes('no project workspace browser install or browser-infra self-repair'));
  assert(automationStage.stages[0].handoff.includes('inspect_visual_workbench_automation_report_if_not_published'));
  assert(automationStage.stages[0].handoff.includes('inspect_report_selector_ambiguities_when_story_matches_multiple_tasks'));
  assert(automationStage.stages[0].handoff.includes('run_visual_workbench_browser_readiness_if_browser_readiness_blocked'));
  assert(automationStage.stages[0].handoff.includes('run_arena_visual_evidence_readback_if_published'));
  assert(automationStage.stages[0].notes.some((note) => note.includes('report.selector.ambiguities')));

  const automationStatusStage = getStageCatalogResult({ stageId: 'visual_workbench_automation_status' });
  assert.equal(automationStatusStage.stages[0].runSurface, 'direct_cli');
  assert.equal(automationStatusStage.stages[0].resultSchemaVersion, 'ra-356.visual-workbench-automation-status.v1');
  assert.deepEqual(automationStatusStage.stages[0].modes, ['read_only']);
  assert(automationStatusStage.stages[0].currentCommand.includes('automation-status'));
  assert(automationStatusStage.stages[0].forbiddenMutationSummary.includes('no capture directory scanning'));

  const workerPathStage = getStageCatalogResult({ stageId: 'worker_path_canary' });
  assert.equal(workerPathStage.stages[0].runSurface, 'direct_cli');
  assert(workerPathStage.stages[0].handoff.includes('inspect_executionReadiness_lifecycleBlockers_before_retry_when_waiting'));
  assert(workerPathStage.stages[0].notes.some((note) => /executionReadiness\.lifecycleBlockers/i.test(note)));
});

test('stage catalog filters to Arena visual evidence readback stage', () => {
  const result = getStageCatalogResult({ stageId: 'arena_visual_evidence_readback' });
  const stage = result.stages[0];

  assert.equal(stage.stageId, 'arena_visual_evidence_readback');
  assert.equal(stage.runSurface, 'direct_cli');
  assert.deepEqual(stage.modes, ['read_only']);
  assert.deepEqual(stage.promptIds, []);
  assert.deepEqual(stage.fixtureExamples, []);
  assert.equal(stage.fixtureSchemaVersion, null);
  assert.equal(stage.resultSchemaVersion, null);
  assert.match(stage.currentCommand, /project_proof_reviews --project-id <id>/);
  assert.equal(stage.ownerBoundary, 'governance.project-interaction-snapshot');
  assert.match(stage.purpose, /visualEvidenceReadiness/);
  assert(stage.notes.some((note) => /does not inspect local artifacts or mutate project state/i.test(note)));
  assert(stage.notes.some((note) => /does not create a Telegram action by itself/i.test(note)));
  assert(stage.handoff.includes('inspect_visualEvidenceReadiness_when_empty'));
  assert(stage.handoff.includes('run_arena_visual_evidence_artifact_check_if_reviews_exist'));
  assert(stage.handoff.includes('render_tg_spec_screenshot_action_if_arena_returns_one'));
});

test('stage catalog filters to Arena visual evidence ingest stage', () => {
  const result = getStageCatalogResult({ stageId: 'arena_visual_evidence_ingest' });
  const stage = result.stages[0];

  assert.equal(stage.stageId, 'arena_visual_evidence_ingest');
  assert.equal(stage.runSurface, 'direct_cli');
  assert.deepEqual(stage.modes, ['operator_mutation']);
  assert.deepEqual(stage.promptIds, []);
  assert.deepEqual(stage.fixtureExamples, []);
  assert.equal(stage.fixtureSchemaVersion, null);
  assert.equal(stage.resultSchemaVersion, 'ra-356.project-visual-evidence-ingest.v1');
  assert.match(stage.currentCommand, /project_visual_evidence_ingest --project-id <id> --task-id <task-id>/);
  assert.equal(stage.ownerBoundary, 'governance.project-visual-evidence-ingest');
  assert.match(stage.purpose, /completed\/manual experiment/);
  assert(stage.notes.some((note) => /manual operator bridge/i.test(note)));
  assert(stage.notes.some((note) => /ProgressWatcher remains the ordinary progress ingestion owner/i.test(note)));
  assert(stage.forbiddenMutationSummary.includes('no Telegram or outbox write'));
  assert(stage.forbiddenMutationSummary.includes('no overwrite of an existing same path asset with a different sha'));
  assert(stage.handoff.includes('run_arena_visual_evidence_readback'));
  assert(stage.handoff.includes('run_arena_visual_evidence_artifact_check_if_reviews_exist'));
});

test('stage catalog filters to Arena visual evidence artifact check stage', () => {
  const result = getStageCatalogResult({ stageId: 'arena_visual_evidence_artifact_check' });
  const stage = result.stages[0];

  assert.equal(stage.stageId, 'arena_visual_evidence_artifact_check');
  assert.equal(stage.runSurface, 'direct_cli');
  assert.deepEqual(stage.modes, ['read_only']);
  assert.deepEqual(stage.promptIds, []);
  assert.deepEqual(stage.fixtureExamples, []);
  assert.equal(stage.fixtureSchemaVersion, null);
  assert.equal(stage.resultSchemaVersion, null);
  assert.match(stage.currentCommand, /project_visual_evidence_artifact_check --project-id <id>/);
  assert.equal(stage.ownerBoundary, 'governance.project-interaction-snapshot');
  assert.match(stage.purpose, /downloadable/);
  assert(stage.notes.some((note) => /ProjectInteractionSnapshot owns review\/action availability/i.test(note)));
  assert(stage.notes.some((note) => /must not infer screenshot availability/i.test(note)));
  assert(stage.forbiddenMutationSummary.includes('no raw bytes or storage paths in output'));
  assert(stage.handoff.includes('run_arena_visual_evidence_readback_if_no_reviews'));
});

test('stage catalog filters to runtime auth readiness stage', () => {
  const result = getStageCatalogResult({ stageId: 'runtime_auth_readiness' });
  const stage = result.stages[0];

  assert.equal(stage.stageId, 'runtime_auth_readiness');
  assert.equal(stage.runSurface, 'direct_cli');
  assert.deepEqual(stage.modes, ['read_only']);
  assert.deepEqual(stage.promptIds, []);
  assert.deepEqual(stage.fixtureExamples, []);
  assert.equal(stage.fixtureSchemaVersion, null);
  assert.equal(stage.resultSchemaVersion, null);
  assert.match(stage.currentCommand, /authd_health/);
  assert.equal(stage.ownerBoundary, 'governance.runtime-auth-readiness');
  assert(stage.notes.some((note) => /combines authd health with TokenManager status/i.test(note)));
  assert(stage.notes.some((note) => /token_status/i.test(note)));
  assert(stage.notes.some((note) => /authd_operator_digest/i.test(note)));
  assert(stage.handoff.includes('operator_login_inside_authd_if_required_provider_missing'));
  assert(stage.handoff.includes('inspect_token_status_if_api_key_provider_missing'));
});

test('stage catalog filters to worker path canary observation stage', () => {
  const result = getStageCatalogResult({ stageId: 'worker_path_canary' });
  const stage = result.stages[0];

  assert.equal(stage.stageId, 'worker_path_canary');
  assert.equal(stage.runSurface, 'direct_cli');
  assert.deepEqual(stage.modes, ['read_only', 'worker_path']);
  assert.deepEqual(stage.promptIds, []);
  assert.deepEqual(stage.fixtureExamples, []);
  assert.equal(stage.fixtureSchemaVersion, null);
  assert.equal(stage.resultSchemaVersion, null);
  assert.match(stage.currentCommand, /project_experiment_preflight --project-id <id> --mode agent_run/);
  assert(stage.notes.some((note) => /does not start the canary or mutate lifecycle/i.test(note)));
  assert(stage.handoff.includes('fix_owner_boundary_if_preflight_false_green_or_false_red'));
});

test('stage catalog formats compact JSON', () => {
  const parsed = JSON.parse(formatStageCatalogResult(getStageCatalogResult({
    stageId: 'controller_visual_review',
  }), true));

  assert.equal(parsed.schemaVersion, STAGE_CATALOG_SCHEMA_VERSION);
  assert.equal(parsed.stages[0].stageId, 'controller_visual_review');
});
