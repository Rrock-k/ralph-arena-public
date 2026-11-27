# Admin Laboratory Operator Contract

This is the current operator contract for Admin -> Laboratory.

The Laboratory is a manual experiment surface over existing Arena/Ralph owners.
It is not a second lifecycle system, not a second scheduler, not a hidden
repair path and not a generic shell.

Use this together with:

- [system-simplicity-contract.md](docs/contracts/system-simplicity-contract.md)
- [change-review-checklist.md](docs/ops/change-review-checklist.md)
- [project-lifecycle-operator-contract.md](docs/ops/project-lifecycle-operator-contract.md)
- [ralph-feedback-evidence-contract.md](docs/contracts/ralph-feedback-evidence-contract.md)

## Product Shape

The default Lab UX is a project cockpit:

```text
selected repository/project state -> one plain action -> one explicit result
```

The simple invocation invariant is:

```text
project context/live workspace -> one plain action/function -> explicit argument schema (task/spec/state) -> one owner-backed stage -> observable result/diff/report -> manual next action
```

`Project Stage Snapshot`, live workspace and repository state are context
inputs for that invariant. They are not new product truth, lifecycle truth or
task truth. If an action does not yet share the same owner/helper that real
Ralph uses, the Lab must label it as target/readback/migration debt instead of
presenting it as a normal shared brick.

Operator-facing copy should call this action `Get task context`. The technical
owner name `Project Stage Snapshot` may appear in debug details, stage metadata
or copied CLI handoffs, but the first-screen workflow should not ask the
operator to understand "stage snapshot" before choosing the action.

The operator should not start from a blank technical command form or a raw task
candidate scan. The Lab should first show the current project state, default to
`Check project status`, and then offer a small set of understandable actions.

## Storybook Render Smoke

Admin Lab Storybook render smoke may have source-owned Storybook states for UI
dogfooding. These states are allowed only as a temp UI render smoke over the
Lab surface and verify UI states only:

```text
fresh temp Storybook build -> verify:storybook:lab -> browser-visible Lab states
```

The verifier must require an explicit `STORYBOOK_DIR`, normally under
`/private/tmp`, so stale checked-out or local `storybook-static` output is not
accepted as proof. The smoke may serve the static Storybook build on disposable
localhost and open the known Lab story iframes with Playwright/Chrome.

This smoke is not a Lab action runner, not Visual Workbench evidence and not an
Arena proof path. It does not run Lab actions and must not run
`/api/admin/lab/run`, create evidence, ingest proof rows, scan raw artifacts,
publish progress, infer Telegram screenshot availability or write/commit
`storybook-static`.
The verifier may perform bounded clicks inside source-owned Storybook fixtures
to prove that selected-action UI state stays understandable, such as pinned
product/UX prompt inputs and result handoffs staying on primary actions. Those
clicks are still UI-state verification only: they must not call Lab run APIs,
copy terminal commands, execute Workbench automation or create any project
truth.

If the verifier is run with optional screenshot capture, those files are
temporary render diagnostics only. They are not Arena visual evidence, not
proof truth and not screenshot-review availability.

The current canonical command pair is:

```bash
npm --prefix apps/governance-platform run build-storybook -- --output-dir /private/tmp/ra356-labtab-verified-storybook-current
STORYBOOK_DIR=/private/tmp/ra356-labtab-verified-storybook-current npm --prefix apps/governance-platform run verify:storybook:lab
```

Default actions:

- `Check project status`: read App, Agent, preview, blockers, repository and
  runtime support from `ProjectOperatorSnapshot` for the selected project. It
  does not retry, relaunch, recreate runtime, change blockers or infer task/
  screenshot readiness.
- `Pause agent`: set Agent intent `OFF` through the existing governance Agent
  lifecycle owner while keeping App/preview intent unchanged. It must not
  relaunch, retry, recreate runtime, patch task truth or create proof/evidence.
- `Resume agent`: set Agent intent `ON` through the same existing governance
  Agent lifecycle owner so normal claim path can resume, idle or block through
  production rules. It must not relaunch, recreate runtime, select a task,
  patch a plan or create proof/evidence.
- `Find work`: read current pending, failed or interrupted task candidates
  without selecting or running any task.
- `Get task context`: read one disposable `Project Stage Snapshot` for the
  selected project and optional selected task. It prepares explicit context
  and CLI handoff values for the next action, but it does not run planner,
  executor, controller, Workbench capture or lifecycle repair.
- `Apply spec diff`: run planner dry-run and inspect a plan/task diff.
  This action must not write `.ralph/plan.json`, replay dry-run output as plan
  truth or imply that an executor-ready task was created. Use the separate
  `Apply spec diff to plan` action when the operator wants to materialize
  accepted spec changes.
- `Apply spec diff to plan`: materialize accepted spec changes into the
  existing Ralph plan through the source-current
  `ralph.planner-spec-migration-apply` owner, then stop. It must derive live
  workspace, source ref, spec file and visual evidence mode from a fresh
  `Project Stage Snapshot`; it must not accept client `workDir`, `spec`,
  `sourceRef` or `visualEvidenceMode`, apply dry-run output, commit source,
  start executor/controller/Workbench or write lifecycle/proof/evidence truth.
  If the result is clean, the Lab may offer select-only handoff buttons for
  `Find work` and `Get task context`. Those buttons must only select the next
  existing project action; they must not run a candidate scan, select a task,
  start executor/controller/Workbench, infer screenshot availability or mark
  proof/evidence ready.
- `Inspect product pass`: inspect the product prompt/role guidance now; later
  run a separate product judgment owner when it exists.
- `Inspect UX pass`: inspect the UX prompt/role guidance now; later run a
  separate UX/visual-quality owner when it exists.
- `Run executor on selected task`: target v0 is one explicit live workspace
  action over the selected project/task: record `beforeCommit`, run one
  executor owner, return diff/report, and create a local project commit only
  for accepted source changes. Forked execution remains a later/advanced
  isolation mode, not the default mental model.
- `Continue failed executor fork`: continue one prior failed manual executor
  experiment in the same dirty fork.
- `Run controller`: optional controller dry-run over selected state.
- `Check visual stories`: run read-only manifest readiness for source-owned
  Visual Workbench stories. It checks structural story availability only; it
  does not capture screenshots or create evidence.
- `Check story selection`: run read-only selector readiness for one selected
  task. It checks explicit story/viewport choices only; it does not capture
  screenshots, export evidence or infer screenshot availability.
- `Check capture policy`: run read-only Workbench shell policy for one selected
  task source. It checks first-party Ralph allowlist only; it does not execute
  the Workbench serve command, capture screenshots, export evidence or infer
  screenshot availability.
- `Check browser`: run read-only platform/browser readiness before screenshot
  capture. It checks the platform Playwright/Chromium probe only; it does not
  capture screenshots, install browsers or mutate project workspace.
- `Copy screenshot command`: prepare the explicit Workbench evidence automation
  command for one selected task. It is a CLI handoff, not a browser-run
  continuation.
- `Run screenshot capture`: run the source-current Workbench evidence
  automation owner once for one selected task after explicit operator
  confirmation. It derives workspace, source commit, config, localhost base URL
  and output directory server-side; it must not ingest evidence, create proof
  reviews, deliver Telegram buttons, commit, push, retry, relaunch or start the
  next stage.
- `Check screenshot run`: run read-only automation status for one selected
  task after a Workbench evidence attempt. It reads the latest diagnostic only;
  it does not capture screenshots, export evidence, publish progress or infer
  screenshot availability.
- `Check evidence chain`: run read-only evidence-chain readiness for one
  selected task. It reports which explicit Workbench/Arena handoff is ready or
  blocked; `nextCommands` are manual handoffs, not browser-run continuations.
- `Ingest evidence`: copy the explicit Arena ingest command for one selected
  Workbench evidence row and artifact. It is a CLI handoff only; the Lab must
  not browser-run ingest, infer proof, scan raw folders or mark screenshots
  reviewable.
- `Collect/check screenshots`: read existing Arena visual evidence status and
  review links only. Screenshot capture, evidence export and ingest stay
  separate explicit Workbench/Arena actions.
- `Check screenshot files`: run read-only artifact downloadability for existing
  Arena screenshot review rows. It must not expose raw storage paths, scan raw
  folders, create evidence or infer proof.

Raw stage ids, command placeholders, source refs, provider/model/timeout,
owner boundaries and mutation declarations are still required audit data. They
belong in a clearly marked debug/advanced stage-catalog surface or copied CLI
handoffs, not in the first mental model. The advanced stage selector must not
look like the normal work path; it is for audit/debug of raw stage ids,
placeholders and exact run boundaries after the operator has already seen the
plain project actions.

`Find work` result readback must distinguish direct executor candidates from
resume-only candidates. Pending and failed task rows may be shown as
executor-ready handoffs. Interrupted/in-progress rows must be explained as
checkpoint-gated: the operator should run `Get task context` for the specific
task first and only treat executor resume as ready when failed/error
provider-session checkpoint readback for that task is present and
`Project Stage Snapshot` returns
`providerSessions.selectedTaskCheckpointReadback.canPrepareExecutor=true`
with `recommendedExecutorMode=resume_interrupted`. A successful provider
session is not resumable work. The Lab UI must
not show interrupted scan rows with the same executor-ready affordance as
pending or failed rows; it may only route them to selected snapshot/checkpoint
readback first. The executor run owner still performs the final
agent/model/fingerprint/outcome match before any provider resume. Empty
candidate scans must also show whether the scan was capped/truncated before
the operator treats the result as fleet-wide. This is readback over the existing
`project_stage_candidates` and `project_stage_snapshot` owners, not a second
task selector or retry policy.
If selected snapshot/checkpoint readback finds provider-session history for
the interrupted task but no failed/error checkpoint, the UI may offer a
select-only handoff to the existing `Resume agent` project action only when
`providerSessions.selectedTaskCheckpointReadback.nextProjectActionId` is
`resume_agent` with reason `success_checkpoint_not_resumable`. That handoff
only selects the governance Agent lifecycle owner so normal Ralph can continue
through a fresh claim from project truth; it must not run the action, prepare
executor input, call a provider, relaunch, retry, patch task truth or create
evidence. The UI and command-template must not derive this handoff or
executor readiness from raw `selectedTaskSessionCount` /
`selectedTaskResumableSessionCount`; those counts are diagnostic readback, not
the action/readiness API.
`Find work` may also show `visualEvidenceRequired` counts and labels from the
same task-candidate readback so an operator can distinguish visual-marked
frontend work from backend or legacy unmarked tasks. These labels are readback
only: they must not infer UI work from titles, decide screenshot availability,
automatically select or run a task, create evidence or override the selected
project `visualEvidenceMode`. For a task already marked
`visualEvidenceRequired=true`, the Lab may offer a button that fills the
selected project/task into `Get task context`; it must not select
`Check story selection` directly. The actual `Check story selection` handoff
must come from `Project Stage Snapshot.selectedTaskVisualReadback` for the
same selected task with `canCheckStorySelection=true` and
`nextProjectActionId=check_story_selection`. That selected-task visual
readback may combine only the selected task, sanitized `visualEvidencePolicy`
and sanitized `visualWorkbenchManifestReadiness`; it must not inspect raw
Workbench stories, infer UI work from task titles, decide screenshot
availability, run selector readiness, capture screenshots, export evidence,
ingest Arena rows or mark screenshot review available.
If the candidate scan has executor-ready rows, visual task counts are known
for every direct-executor candidate project, and no
`visualEvidenceRequired=true` task counts, the Lab may show an operator notice
that no visual-marked executor task exists in that scan. Missing or partial
visual count payloads must not be interpreted as zero visual tasks. This is
readback over task fields only; it must not infer that the tasks are
backend-only, mutate the project policy, auto-select another project or decide
screenshot availability.
`Find work` may also show the project-level `visualEvidencePolicy` and
`visualWorkbenchManifestReadiness` copied from the same
`Project Stage Snapshot` owner reads. This readback helps the operator see
whether a candidate project is visual-policy-enabled and story-ready without
opening every project first. It must not become a scan-level visual-candidate
classifier, task filter, task ranking rule, screenshot-ready label, raw
Workbench read, auto-selection rule or evidence/proof availability signal.
If selected snapshot visual readback says story selection is blocked or not
applicable, the Lab may show the title/message as operator readback, but it
must not reconstruct a different answer from raw task, policy or manifest
fields.
If a `Check story selection` result is ready, the Lab may offer a button that
fills the same task into `Check capture policy`; that button must not run shell
policy, start Workbench, capture screenshots, export evidence, ingest Arena
rows or infer screenshot availability.
If a `Check capture policy` result is allowed, the Lab may offer a button that
selects `Check browser`; that button must not run browser readiness, start
Workbench, capture screenshots, export evidence, ingest Arena rows or infer
screenshot availability.
If a `Check browser` result is ready, the Lab may offer a button that selects
the copy-only `Copy screenshot command` handoff or the separate confirmed
`Run screenshot capture` action. That navigation button must not start
Workbench, capture screenshots, export evidence, ingest Arena rows or infer
screenshot availability. Browser readiness is platform-scoped and does not own
project, task, workspace, source, base URL or output-directory values, so any
terminal values for `Copy screenshot command` must stay explicit or come only
from a current matching `Project Stage Snapshot` helper, and `Run screenshot
capture` must derive those values server-side from a fresh matching snapshot.

For provider-backed Lab actions, the browser UI may offer an explicit "use
selected project settings" helper that copies the selected project's current
agent/model into visible form fields. This is operator input assistance only:
the backend must still receive explicit provider settings and must not invent
hidden provider/model defaults.

Provider-backed stage reports must make provider failures diagnosable without
turning the Lab into a log warehouse. For failed agent outcomes, the
owner-backed result may include a bounded `agent.outputPreview` copied from
the existing `AgentResult.output`, plus an `outputPreviewTruncated` flag. The
preview is readback only: it must not become retry policy, task truth,
proof/evidence truth, lifecycle truth or provider availability truth. The full
output remains outside the normal Lab mental model unless an operator
deliberately inspects the stage artifact.

The selected project state must expose the current project visual evidence
policy as a readback from the existing runtime configuration boundary:
`visualEvidenceMode=off|required|new_tasks_only`. Planner and controller
dry-run forms may initialize their visible `visualEvidenceMode` input from that
selected project policy. This is operator input assistance only: changing the
field affects the one manual dry-run request and does not mutate project
runtime config, task truth, proof truth, lifecycle truth or screenshot
availability. If the selected project policy is not readable, planner and
controller dry-runs must stay blocked instead of reusing stale UI-local mode.
Malformed visual evidence runtime config is an explicit operator readback
error, not a fallback to `off` and not an implicit config repair. This gate is
backend-enforced for the runnable Lab dry-run owner as well as reflected in the
browser UI.
`Project Stage Snapshot` must also expose this policy as a sanitized
`visualEvidencePolicy` readback owned by
`governance.runner-init-readiness.ralphConfig`. The mutating
`executor_project_task` Lab owner must use that snapshot policy plus the shared
`ralph.executor-observer` visual-evidence helper. It must block if the snapshot
policy is unavailable or invalid, must not accept a client-supplied executor
visual mode and must not derive `required`/`off` locally from only
`task.visualEvidenceRequired`.

Primary action cards must make the action type explicit before the operator
clicks: `Checks in UI`, `Runs in UI`, `Copy CLI` or `Planned only`. The
selected-action panel must also show what the click does, what result/handoff
is expected, and the guard that no next stage starts automatically.
The default-visible selected-action panel should stay short: selected action,
what the click does, action readiness and the primary button. Audit details
such as brick status, exact `Uses` / `You provide` / `You get` wording and stop-after
copy may be collapsed under `Action contract details` so the first-screen
workflow remains project/action/result instead of a contract dump.
The primary button label should restate the selected plain action or handoff
in short words, for example `Check project status`, `Run executor` or
`Copy screenshot command`. This label is presentation copy on the same primary
action entry that owns the stage mapping; it must not become a second action
catalog or imply extra hidden stages.
When the debug raw-stage selector is used, the same panel must label it as a
`Debug stage`, not as the normal selected project action. This keeps raw stage
execution visibly separate from the primary project-action path.
For every primary action, the selected-action panel must show the operator
shape in plain terms using the visible labels `Uses`, `You provide` and
`You get`. `Uses` says which project, workspace, task context, fixture or
readback boundary is used. `You provide` says which remaining explicit inputs
the operator controls. `You get` says the observable output, diff, report,
handoff or readback. These are presentation fields over existing owners; they
must not become a second stage catalog or a second source of task/lifecycle/
proof truth.
Result headers must identify the originating primary action from the validated
`actionInvocation` returned by the run response, or fall back to debug stage
metadata when the operator intentionally used a raw stage. They must not infer
identity from the currently selected action, so changing the selected action
after a run cannot make an old result look like a new one.
Normal primary-action browser requests must send `actionId` only. Governance
derives the raw stage id from the same `ADMIN_LAB_PROJECT_ACTIONS` entry that
owns the visible action copy and validates `actionId -> stageId` before
running. Raw `stageId` requests are reserved for the explicit debug stage
catalog. A request that sends both `actionId` and `stageId` is rejected instead
of treating one as a fallback for the other.
The browser UI must follow the same split: normal project-action state is
`selectedProjectActionId`, while raw stage state is kept only as
`selectedDebugStageId` for the debug catalog. Handoffs that target normal work
must select the primary action id and let the stage derive from
`ADMIN_LAB_PROJECT_ACTIONS`; they must not also store or synchronize a raw
stage id.
The selected-action panel must also show the action's production relationship
or migration debt as `Brick status`. This copy must live on the same primary
action entry that maps the action to its owner/stage, not in a separate
workflow or readiness catalog. It may say `Shared`, `Readback`, `Manual
handoff`, `Arena readback` or `Migration debt`, but it must not decide
readiness, run order, task truth, lifecycle truth or screenshot availability.
Primary action grouping is presentation only. Group labels must live on the
same shared `ADMIN_LAB_PROJECT_ACTIONS` entries that map actions to stage
owners and validate `actionId -> stageId` for normal runs. Grouping must not
introduce a second action catalog, sequence, readiness model or source of
truth.
Detailed visual-evidence actions may be collapsed behind a small presentation
toggle so the first screen remains project/action/result instead of a full
screenshot pipeline. The collapsed state must be stored only as UI
presentation over `ADMIN_LAB_PROJECT_ACTIONS`: it must not move actions to a
second catalog, reorder the stage chain as workflow truth, hide selected
result handoffs, change readiness, run/copy behavior, task truth, proof truth
or screenshot availability.
The selected-action panel must expose current action readiness from the same
visible inputs that gate the button: ready, template/copy-ready, planned, or
the exact missing inputs. This readiness readback is UI guidance only; it is
not task truth, source truth, lifecycle truth or proof truth.
For primary `Copy CLI` actions, the selected-action surface should show the
terminal command template and its visible placeholder inputs directly. Raw
stage selection can stay in advanced controls, but the operator must not have
to open advanced controls just to see or fill the handoff for the selected
action.
If the current result is a matching `Project Stage Snapshot`, the terminal
handoff may offer a visible "use context values" helper for placeholders that
the task context already owns, such as selected task id or source commit. This
is input assistance over the disposable snapshot result only; it must not
reread project source, rescan tasks, run Workbench or infer missing command
values.
After a run/copy, the result belongs directly under the selected action
surface. The Lab must not render a standalone usual-path workflow or ordered
stage-id sequence beside the primary project actions. Any next-step affordance
must come from the current action result or an explicit owner handoff, such as
selector readiness, capture policy, browser readiness, evidence-chain
`nextCommands` or Arena readback. Those affordances may fill inputs or copy
commands, but they must not become a second run-surface catalog, readiness
model, runnable workflow truth or automatic next-stage chain. When a result
handoff targets an existing primary action, the UI should select that primary
action identity instead of dropping into raw/debug stage mode.
Raw evidence/audit notes may stay available, but normal result reading should
show them under an explicit `Audit notes` detail instead of making raw stage
ids, CLI owner language or evidence diagnostics the first result narrative.
When several primary actions share one technical stage, the run owner must
validate the action-specific pinned inputs before execution. For example,
`product_pass` and `ux_pass` both use `prompt_contract_replay`, but they must
pin different `promptReplayFixture` values. The result heading then uses the
validated `actionInvocation`, not a client-side fixture guess. The normal
selected-action UI must not expose those pinned action inputs as editable
fields; if the operator needs to choose a raw prompt fixture, that belongs in
debug/raw stage selection without a primary action id.
If an Admin Lab or `arena-ctl` action cannot reach the governance admin API,
the error must name the attempted admin boundary and local service/tunnel
check. That transport failure is an operator blocker only; it must not retry,
switch URLs, start services, mutate lifecycle or fall back to raw DB/Docker
reads.

## Ownership Rules

- Every plain action must resolve to exactly one code-owned stage or one
  explicitly marked target owner.
- Lab actions must be manual surfaces over Ralph/Arena production bricks, not
  separate Lab implementations. If a runnable Lab action still has no real
  Ralph production consumer or migration path to the same owner, that gap must
  be visible as migration debt before the action is treated as a normal
  supported brick.
- `Shared` is a gated word. A Lab action may be labelled shared only when the
  task-local `Production Convergence Evidence` records its normal-run caller,
  shared helper, source-current diagnostic or explicit migration debt. Readback
  and operator status actions are allowed to stay outside normal `ralph run`;
  they must be labelled as readback, handoff or Arena read-side actions instead
  of being promoted into fake production loop bricks.
- Shared brick semantics include prompt rendering, provider invocation,
  executor observation, diff classification, source commit identity and
  production source staging/protected-path policy. The browser Lab may call
  those owners, but must not recreate them in governance.
- Live accepted-spec imports and live planner/executor actions are production
  inputs. If the selected project is Agent ON, real Ralph may legitimately pick
  up the new state through the same shared bricks before the operator clicks the
  next Lab action. For isolated one-step experiments, the operator should park
  the project through the existing lifecycle owner first (`project_agent_off`)
  and resume through the same owner (`project_agent_on`). Admin Lab may expose
  those owner calls as `Pause agent` and `Resume agent`, but this must not be
  implemented as a Lab-only pause state, hidden retry, relaunch or task/proof
  mutation. The browser action must call the existing governance Agent
  lifecycle owner and must not relaunch, retry, recreate runtime, patch task
  truth or create proof/evidence.
- `Project Stage Snapshot` is the disposable read-only input boundary for
  source-current project stages.
- The stage catalog remains the technical/audit truth for runnable stage
  metadata.
- A live workspace action is allowed only as an explicit Lab action with a
  selected project, selected task/spec, recorded `beforeCommit`, structured
  report and visible diff. Its local source commit is experiment/source
  evidence, not task completion, lifecycle truth, proof truth or remote source
  publication.
- Product and UX passes are desired separate owners. Until they exist as
  runnable code-owned stages, the Lab must expose them only as prompt
  inspection or target-shape handoffs.
- Visual screenshot availability comes from Arena visual evidence readback,
  not from raw files, Telegram delivery history or UI-side inference.
  The `Copy screenshot command` action is a copy-only Workbench handoff: it may
  expose the existing `visual_workbench_evidence_automation` command template
  and placeholders, but the browser must not run capture/export/publish from
  that primary action.
  The `Collect/check screenshots` action is a readback action: it must not
  capture screenshots, create evidence, export Workbench rows or ingest Arena
  assets.
- Empty screenshot readback is a first-class operator result. If
  `Collect/check screenshots` finds no reviewable `visualEvidenceReviews`, the
  Lab should say that the screenshot-review button is not expected yet and
  point to the next explicit Workbench evidence or Arena ingest brick. It must
  not send the operator to raw artifact folders or imply that Telegram failed.
- The screenshot-readback gap has two different next-action branches:
  - if Arena has no `visualEvidenceReviews` rows, the safe next action is an
    explicit Workbench evidence or `visual_evidence_ingest` handoff;
  - if Arena has rows but no safe review link, the safe next action is
    `visual_evidence_artifact_check`, because the issue is artifact
    downloadability/readback, not evidence creation.
  Both branches only select or point to an explicit next action. They must not
  auto-run ingest, scan raw artifact folders, create screenshot evidence, infer
  Telegram delivery failure or mark screenshots reviewable.

## Forbidden

The Lab must not:

- hide a multi-stage sequence behind one plain action label;
- make planner, executor, controller, Workbench and readback run as an implicit
  chain;
- use a product/UX label to pretend a provider judgment stage exists;
- mutate lifecycle, task truth, proof truth or source truth from a read-only
  diagnostic action;
- treat a local project commit from a live workspace action as task
  completion, controller approval, screenshot proof or remote publication;
- silently fall back from a failed live workspace guard into a forked run;
- auto-push project commits from the Lab action;
- infer screenshot review availability from raw Workbench folders,
  `.arena/progress.json`, task titles, story ids or Telegram messages;
- expose a generic browser shell or arbitrary command runner;
- add fallback page screenshots when source-owned Workbench stories are
  missing.

## Stage Surfaces

The Lab uses three surfaces:

- `admin_lab_run`: narrow browser-runnable actions with fixed backend owners.
- `direct_cli`: source-current terminal handoffs copied from the stage catalog.
- `target_shape`: planned owner boundaries that are not runnable yet.

Every `admin_lab_run` request schema must fail closed. The browser route may
accept only the explicit keys documented for that action; unexpected
workspace, source, report, proof, Workbench, provider or command keys must
return a structured error instead of being ignored or treated as hidden input.

Promoting a `direct_cli` or `target_shape` stage into `admin_lab_run` requires a
separate audited design: fixed input schema, explicit mutation declaration,
owner check, bounded execution, structured output and a shared-production-brick
check showing whether the real Ralph loop already calls the same owner or what
small migration slice will make it do so. Broadening the current browser route
is not acceptable.

For the `prompt_contract_replay` action, the current allowed browser-run shape
is fixed prompt inspection only: Admin Lab may accept only the selected project
id, stage id, optional top-level primary `actionId` and
`promptReplayFixture=product_skill|ux_skill`. Governance maps those two enum
values to a fixed product/UX role-skill fixture, calls the
source-current Ralph Prompt Lab replay owner with a disposable output file, and
verifies that the returned prompt id matches the selected fixture. The browser
route must not accept client fixture paths, prompt ids, output paths, task ids,
source/workspace paths, provider/model settings, timeout, generic Prompt Lab
ids or any planner/executor/controller/run/apply input. Governance does not
render prompt bodies itself and does not produce product findings, UX
findings, task evidence, screenshot proof, prompt traces, `.ralph`/`.arena`
writes, planner/executor/controller output or lifecycle/source truth. The
result is prompt text/hash/source metadata only. Ralph's own stage catalog may
still expose `prompt_contract_replay` as a source-current `direct_cli` Prompt
Lab surface; Admin Lab's `admin_lab_run` is a bounded browser wrapper over that
owner, not a second prompt catalog or fallback owner.

For the mutating executor action, the current allowed browser-run shape is
narrow: Admin Lab may create a fresh Project Stage Snapshot through the
arena-ctl owner, write that disposable JSON to a temp file, then call the
source-current Ralph `executor_project_task --workspace-mode
live_workspace_action` owner with fixed arguments. Governance must not
duplicate prompt rendering, provider execution, diff classification or commit
behavior: it does not render executor prompts, call providers, classify diffs
or create project commits itself. Visual evidence policy is carried only by the
fresh Project Stage Snapshot's sanitized `visualEvidencePolicy`; Governance
must not add a separate executor visual-mode input or infer UI work from task
titles. Normal `ralph run` convergence remains
explicit debt where it still owns separate task selection, verification,
progress and lifecycle side effects. This is not precedent for a generic
browser-triggered provider runner.

For planner, controller and executor browser-run wrappers, Governance
validates only the returned Ralph stage envelope before showing a green
result: schema version, stage id, stage owner, stage mode, project-stage
snapshot owner, status allowlist and the correlation fields Governance just
passed to the CLI such as project id, task id, source ref, snapshot path, work
dir, snapshot source ref and output dir. Governance must not validate planner
output meaning, controller verdicts, executor observer details, project
commits, changed files, visual handoff meaning, hashes, counts or
status-specific completion semantics. Those remain owned by the source-current
Ralph stage result.

If an executor result includes `workspaceResult.executorOutput` with
`ownerBoundary=ralph.executor-observer`, Admin Lab may show that shared
observer readback in the executor result surface: status, completion/replan
signals, visual coverage, expected-story coverage and warning counts. This is
telemetry/readback only. It must not become task completion, proof approval,
lifecycle truth, retry truth, screenshot availability or a next-stage
readiness model. If the owner boundary is missing or different, the Lab must
not synthesize observer output from changed files, task titles or raw reports.

If an executor result includes `visualWorkbenchHandoffGate`, Admin Lab may show
it as a metadata-only next-step hint. The only ready state from the executor
result is `ready_for_selector_readiness`, and the UI may fill only the
`visual_workbench_selector_readiness` handoff inputs proven by that result. It
must not jump from executor completion to Workbench capture, evidence
automation, evidence ingest, proof review or screenshot availability.

For the `visual_workbench_manifest_readiness` action, the current allowed
browser-run shape is read-only and source-scoped: Admin Lab may create a fresh
Project Stage Snapshot, derive the live source workspace and source commit
from that snapshot, then call the source-current Ralph `visual-workbench
inspect` owner. The browser route may accept only optional snapshot `tail`. It
must not accept client `workDir`, `sourceRef`, manifest path/content,
story/viewport, `baseUrl`, `outDir`, task id, provider settings or any
capture/export/ingest trigger. Governance must not read raw Workbench files
itself, start the Workbench server, run Playwright, capture screenshots,
export evidence, publish progress or infer Telegram screenshot availability.
A ready manifest result only means the source-owned Workbench manifest is
structurally usable for later selector/capture steps; it is not screenshot
proof or screenshot-review button availability.

For the `visual_workbench_selector_readiness` action, the current allowed
browser-run shape is read-only and narrow: Admin Lab may create a fresh Project
Stage Snapshot, derive the selected live source workspace and task id from that
snapshot, then call the source-current Ralph selector-readiness owner. The
browser route may accept only the selected task id and optional snapshot tail.
Before Admin Lab calls the selector-readiness owner, it must check
`Project Stage Snapshot.selectedTaskVisualReadback` for the same selected task
and require `canCheckStorySelection=true` with
`nextProjectActionId=check_story_selection`. If that readback is missing,
blocked or for a different task, Admin Lab must return a blocked result and
must not call the selector-readiness owner. Admin Lab must not reconstruct a
different answer from raw task, policy or manifest fields.
It must not accept `workDir`, `sourceRef`, `manifest`, story/viewport,
`baseUrl`, `outDir`, provider settings or any capture/export/ingest trigger.
A ready selector result only means story and viewport choices are explicit
enough for a later manual capture/export step; it is not screenshot proof or
Telegram screenshot availability.

For the `visual_workbench_shell_policy` action, the current allowed
browser-run shape is read-only and narrow: Admin Lab may create a fresh Project
Stage Snapshot for the selected task, derive only the selected live source
workspace and runner-owned `.arena/ralph.config.json` path from that snapshot,
then call the source-current Ralph shell-policy owner. The browser route may
accept only the selected task id and optional snapshot tail. It must not accept
client config, manifest, baseUrl or outDir, and it must not treat source-owned
manifest commands as authority to execute.
A ready shell-policy result only means first-party Ralph config allows the
future executor-owned automation to start the exact Workbench serve command;
it does not execute the Workbench serve command, start a browser, capture
screenshots, export evidence, publish progress or infer Telegram screenshot
availability.

For the `visual_workbench_browser_readiness` action, the current allowed
browser-run shape is read-only and platform-scoped: Admin Lab may call the
source-current Ralph browser-readiness owner with fixed arguments only. It
does not accept project workspace, source ref, manifest, story/viewport,
`baseUrl`, `outDir`, task id, provider settings or capture/export/ingest
inputs. A ready browser result only means the platform Playwright Chromium
probe passed; it is not screenshot capture, screenshot proof or Telegram
screenshot availability. A ready result may prepare the `Copy screenshot command`
copy-only handoff, but it must not fill missing project/workspace/source/
task/base URL/output-directory values from the browser-readiness payload.

For the `visual_workbench_automation_status` action, the current allowed
browser-run shape is read-only diagnostic readback: Admin Lab may create a
fresh Project Stage Snapshot, derive the selected live source workspace and
task id from that snapshot, then call the source-current Ralph
automation-status owner for that task. The browser route may accept only the
selected task id and optional snapshot tail. It must not accept client
`workDir`, `sourceRef`, report path, manifest, story/viewport, `baseUrl`,
`outDir`, provider settings or any capture/export/ingest trigger. Available
automation status only means a prior automation diagnostic report exists; it
is diagnostic readback only, not screenshot capture, screenshot proof, progress
publish or Telegram screenshot availability. If the diagnostic report includes
`report.capture.viewerPath`, the UI may show it as the same copy-only
screenshot catalog handle described below; it must not open, proxy, scan or
render that file from governance.

For the `visual_workbench_evidence_chain_readiness` action, the current allowed
browser-run shape is read-only evidence-chain readback: Admin Lab may create a
fresh Project Stage Snapshot, derive the selected live source workspace and
task id from that snapshot, then call the source-current Ralph
evidence-chain-readiness owner with the selected project id. The browser route
may accept only the selected task id and optional snapshot tail. It must not
accept client `workDir`, `sourceRef`, capture run path, story/viewport,
feedback/diff item id, evidence ref, `baseUrl`, `outDir`, provider settings or
any capture/export/ingest trigger. `nextCommands` are manual handoffs only;
this result is not screenshot capture, screenshot proof, progress publish or
Telegram screenshot availability. In plain terms: nextCommands are manual
handoffs, not browser-run continuations. The UI may list and copy these
commands so the operator does not have to inspect raw JSON, but it must not
parse them into runnable browser actions, auto-select the next stage or start a
follow-up capture/export/ingest/readback step. The UI may also surface the
owner-returned `captureViewer.viewerPath` and `captureViewer.commandHint` as a
copy-only screenshot catalog handle. That handle is convenience readback over
an existing capture report; it is not raw artifact scanning, screenshot
evidence, proof truth, progress publish or Telegram screenshot-review
availability. When `viewerPath` is an absolute local path, the UI may derive
and copy a `file://` URL for the same path so the operator can paste it into a
local browser. This is still a copy-only handoff: the Lab must not open, proxy,
read, render or validate the local file.
If the UI adds plain-language labels to known `nextCommands`, those labels are
display-only. They must not decide readiness, replace the command string,
select a stage, run a browser action or become a second command catalog.

`visual_workbench_evidence_automation` remains an explicit `direct_cli`
workspace-mutation handoff. It starts source-owned Workbench execution, runs
Playwright capture, exports task-linked inconclusive evidence and publishes
`.arena/progress.json`; it is therefore not a readback action and not a safe
continuation hidden behind `Collect/check screenshots`. Admin Lab must not make
this stage browser-runnable by a simple `runSurface` flip and must not parse
evidence-chain `nextCommands` into an automatic automation run.

The separate browser-runnable evidence automation action is an audited advanced
mutation. Its first-screen meaning must be exactly: run Workbench evidence
automation for one selected task. The browser request may accept only selected
`projectId`, selected `taskId`, optional bounded snapshot tail and an explicit
operator confirmation. Governance must derive the fresh Project Stage Snapshot,
live source workspace, exact source commit, fixed
`visual-workbench/manifest.json`, runtime-owned Ralph config, localhost
Workbench base URL and output directory outside the workspace. Governance must
call the source-current Ralph automation owner; it must not implement selector,
shell policy, browser readiness, capture, export, progress publish, evidence
ingest or screenshot availability itself. The result may show the automation
report, blockers and copy-only viewer/catalog handles, but it must not auto-run
artifact check, ingest, controller, retry, relaunch, Telegram delivery or proof
review.

For the planner dry-run action, the current allowed browser-run shape is also
narrow: Admin Lab may create a fresh Project Stage Snapshot through the
arena-ctl owner, clone the selected source commit into a temp fork, then call
the source-current Ralph `planner_project_dry_run` owner with explicit
provider settings and `visualEvidenceMode`. The boundary is: governance does not render planner prompts, call providers directly, parse planner output, apply `.ralph/plan.json` or invent missing spec/config defaults.

For the planner spec-migration apply action, the current allowed browser-run
shape is a separate live-workspace mutation: Admin Lab creates a fresh Project
Stage Snapshot through the arena-ctl owner, writes that disposable snapshot to
a temp file, derives the snapshot source commit server-side, and calls the
source-current Ralph `planner_spec_migration_apply` owner with explicit
provider settings. Governance must not clone a temp fork for this action, must
not accept client `workDir`, `sourceRef`, `spec`, `visualEvidenceMode` or
`outDir`, must not patch `.ralph/plan.json` itself, and must not start
executor, controller, Workbench, lifecycle repair, deploy, commit or push after
the apply result. The only allowed live workspace mutations are planner-owned
`.ralph/plan.json`, `.ralph/decisions-log.json`, planner prompt traces and the
explicit report outside the workspace.
The apply result may show status/count/source highlights and select-only
handoffs to the existing `Find work` or `Get task context` actions. This is
operator navigation over the same production bricks, not a second scheduler:
the UI must not auto-run either action, create task truth, infer visual task
readiness or proceed into executor/controller/Workbench from the apply result.

For the controller dry-run action, the current allowed browser-run shape is
the same narrow dry-run shape: Admin Lab may create a fresh Project Stage
Snapshot through the arena-ctl owner, clone the selected source commit into a
temp fork, then call the source-current Ralph `controller_project_dry_run`
owner with explicit `trigger`, `visualEvidenceMode` and provider settings.
The browser route may not accept client `snapshot`, `workDir`, `sourceRef`,
`spec`, `outDir`, controller report, proof/evidence, lifecycle, runtime or
Workbench capture/export/ingest inputs. Governance does not render controller
prompts, call providers directly, parse or apply ControllerReport truth, write
controller reports, update `.ralph/plan.json`, start planner/executor or infer
proof/lifecycle completion. The `startup` trigger remains intentionally
excluded because production startup can persist extra applicability and task
truth.

## Expected Operator Flow

1. Select a project.
2. Start from the default `Check project status` action for first-glance
   App/Agent/preview/blocker state.
3. Run `Find work` or `Get task context` when current task context is needed.
4. Choose one plain action.
5. Inspect the expected output and current runnable status.
6. Run only that action or copy its exact CLI handoff.
7. Decide the next action manually from the result.

No result auto-starts the next stage.
