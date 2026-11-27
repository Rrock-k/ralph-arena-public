# Ralph Feedback and Evidence Contract

This contract defines how user feedback, reopened bugs and production evidence move through Arena into Ralph without becoming a second lifecycle system.

Use it together with:

- [system-simplicity-contract.md](docs/contracts/system-simplicity-contract.md)
- [project-runtime-preview-business-contract.md](docs/contracts/project-runtime-preview-business-contract.md)
- [accepted-spec-artifact-contract.md](docs/contracts/accepted-spec-artifact-contract.md)
- [docs/loops/contract.md](docs/loops/contract.md)

## Goal

Fresh user feedback must outrank historical task state.

If users say a bug is still present after Ralph attempted a fix, the next Ralph run must treat that as current product truth, not as a duplicate of an old completed task.

The loop-neutral owner for this product truth is
`AcceptedSpecArtifact`. This Ralph contract describes how bundled Ralph maps
that platform artifact into `.ralph/plan.json`, dispositions and evidence.
Ralph-branded legacy adapter fields are not platform truth.

## Ownership

| Layer | Owns | Must not own |
|---|---|---|
| `tg-spec` / accepted spec plane | accepted feedback text, status, `reopened#N`, user/prod evidence collection UX | Ralph task completion or lifecycle blockers |
| Arena spec import | mirror the latest accepted spec into project spec truth; store `AcceptedSpecArtifact` on `SpecVersion.acceptedArtifact` | decide whether the product bug is fixed |
| `arena-runner` | write accepted specs into the workspace and report loop terminal state | parse feedback semantics or read `.ralph/` |
| Ralph planner | extract current feedback and persist one disposition per required item in `.ralph/plan.json` | skip current feedback because old work is completed |
| Ralph executor | implement product work and attach item-linked verification evidence to tasks | manufacture closure evidence for checks it did not run |
| Ralph controller | build the feedback evidence matrix, prevent overclaims, record judgments only for real product ambiguity and add implementable follow-up tasks | encode lifecycle state directly, turn weak evidence into public assumptions, or stop work for product judgment |
| Governance lifecycle | store `blockers[]`; `MANUAL` means user/operator evidence is required | parse controller reports as lifecycle truth |
| Operator tools | read lifecycle blockers and runtime truth | reconstruct lifecycle from local `.ralph/controller-reports` |

## Accepted Spec Diff

The diff from the accepted spec plane is Ralph's primary input for feedback work.

- `reopened#1`, `reopened#2`, etc. are status changes on the same `BUG-*` item, not duplicate bug records.
- New or reopened current feedback requires a Ralph disposition.
- Legacy open feedback that already has linked open work does not automatically create duplicate tasks.
- Handled feedback means Ralph or another loop claims the bug has been fixed.
  It is not accepted closure, but it is also not work-required unless a later
  accepted diff reopens it.
- Closed feedback is not work-required unless a later accepted diff reopens it.
- User silence is not a lifecycle blocker. A loop claim is enough to proceed by
  default unless newer accepted feedback reopens the item.
- Optional verification UX can ask users `fixed / not fixed`, but its output
  must converge into accepted artifact feedback, not a side channel.

When `tg-spec` sends a versioned import payload, Arena stores the structured
accepted artifact on the created `SpecVersion`:

- `SpecVersion.content` remains the full accepted product spec.
- `SpecVersion.acceptedArtifact.acceptedDiff` explains what changed in that
  accepted version.
- `SpecVersion.acceptedArtifact.feedback` owns feedback state and reopen count.
- `SpecVersion.updatedAt` is the freshness timestamp for accepted input. It is
  updated when same-source-version accepted artifact metadata changes.
- `ProjectUpdateOutbox` may carry safe correlation fields such as diff item ids
  and metadata hash, but not raw provenance evidence.
- Legacy imports can have null metadata; null means "metadata missing for this version", not "nothing changed".

`AcceptedSpecArtifact` is semantic product truth from the spec plane, not a
second lifecycle state and not a plain text diff. Arena may already store the
previous and next markdown versions, but it must not infer reopened feedback
semantics by parsing markdown history itself. `tg-spec` owns whether an
accepted change means `BUG-001` is `reopened#2`, newly opened, handled by a
loop claim, closed by accepted evidence, or only contextual.

Arena's runner-facing spec payload now carries this metadata through the shared builder used by `/api/internal/projects/:id/init` and `/api/internal/projects/:id/specs`:

- each spec item keeps the legacy content `hash`;
- metadata-aware versions also get an `inputHash`;
- the aggregate payload hash uses `inputHash` when present, so a metadata-only accepted diff can still wake runner/spec consumers;
- the metadata field is `acceptedArtifact`.

Runtime wake must use the same accepted-input boundary:

- a fresh loop run is eligible when any project spec has accepted input newer
  than the latest loop outcome and that spec's latest artifact contains
  `workImpact="requires_loop_work"`;
- a newer `context_only` or `no_loop_work` artifact must not hide an older
  unprocessed `requires_loop_work` artifact from another spec;
- identical same-source-version retries are no-ops, keyed by accepted metadata
  hash, and must not create duplicate outbox or runtime wake paths.

Runner materializes the same boundary into `.arena/spec-input.json` when it syncs specs into the workspace. This file is runner-owned read-only input metadata, not lifecycle state and not a task store.

Ralph uses `.arena/spec-input.json` when present:

- the manifest aggregate hash becomes the spec migration input hash for `spec.md`, so metadata-only accepted changes can be processed;
- `acceptedArtifact.acceptedDiff.items[]` with
  `workImpact="requires_loop_work"` become the required per-item disposition
  packet;
- markdown extraction remains the fallback for projects or imports without
  structured accepted artifact metadata.

## Ralph Disposition

Ralph records dispositions in `.ralph/plan.json` under:

```text
specMigrations[].feedbackDispositions[]
```

Each required current feedback item gets exactly one disposition:

- `addTask` for new product work.
- `updateOpenTask` for existing open work that must be changed.
- `coveredByOpenTask` when existing open work already covers it.
- `closedByEvidence` only with concrete positive evidence.
- `needsJudgment` when product intent is ambiguous.
- `blocked` when a real dependency prevents work.

This is the durable answer to "what did Ralph do with each diff item?" It should not be saved in a second feedback store.

## Evidence

Evidence is execution evidence, not source-of-truth product spec.

Valid closure evidence must be item-linked and concrete: targeted tests, integration checks, post-deploy smoke, screenshots, vision QA, code inspection, or explicit manual/operator note.

Weak evidence does not close feedback:

- completed task status alone;
- generic lint/build pass;
- old screenshots unrelated to the current item;
- vague "looks fixed" text without item linkage.

## Visual Scenario Lab Evidence

Visual Scenario Lab captures are a Ralph-local execution-lab input, not product
truth and not screenshot proof by themselves.

Visual scenario targets may include a bounded `waitAfterLoadMs` value. This is
an explicit scenario settle delay for SPAs/games after browser `load`; it is
not an implicit retry, visual assertion, lifecycle wait or proof decision.
When omitted, capture uses the existing short default wait.

The first safe boundary into durable evidence is:

```text
ralph visual-scenarios export-evidence --work-dir <project-workdir> --run <scenario-run.json> --task <taskId>
```

This command may record task-linked `verificationEvidence` only when all of the
following are true:

- the run report schema is `ra-355.visual-scenario-run.v1`;
- the run status is `captured`;
- the screenshot artifact exists under the project `workDir`;
- the artifact SHA-256 digest matches the run report;
- the target task exists in `.ralph/plan.json`;
- the target task has non-empty `feedbackItemRefs[]`.

The export must derive `feedbackItemIds` from the task's existing
`feedbackItemRefs[]`. It must not accept free-form feedback ids, infer links
from scenario names or parse accepted spec text.

The first export slice records screenshot evidence as `result="inconclusive"`.
Capture means the target route was rendered and imaged; it does not mean the
visual claim was assessed or the feedback item is fixed. Positive closure needs
a separate concrete assessment boundary, for example manual review or vision
QA, before `pass` evidence is allowed.

This export must not set `screenshotProof`, upload `ProjectAsset` rows, write
`proofReviews[]`, write `assets/proof/...`, mutate task status, write
dispositions, clear blockers, claim runtime intent or change lifecycle state.

First-party Ralph executor must not produce legacy `screenshotProof` /
`ProjectAsset` before-after proof rows. Existing `screenshotProof` shapes may
remain readable only as historical compatibility where older progress rows or
tests need them; new visual evidence is produced through the Visual Workbench
or visual-scenario export boundaries.

The first assessment boundary is manual-only:

```text
ralph visual-scenarios assess --work-dir <project-workdir> --task <taskId> --evidence-ref <visual-scenario-run:...> --kind manual_note --result pass|fail|inconclusive --assessment <text>
```

Manual assessment may append a `manual_note` evidence row only when it points to
an existing exported visual scenario screenshot row on the same task. The source
row must be an inconclusive `visual-scenario-run:*` screenshot recorded by the
agent, with no `screenshotProof`, exactly one feedback item, a non-empty target
and a revalidated workDir-local artifact hash. The assessment row must copy the
source feedback id, target, artifact path and artifact digest; it must never
accept those fields from CLI flags.

The assessment row must persist `sourceEvidenceRef` as the canonical link back
to the exported screenshot evidence row. Deterministic assessment refs are for
idempotency and conflict detection; they are not the canonical grouping truth.

The assessment result must be explicit. `pass` is allowed only on the appended
manual assessment row; the source screenshot row must remain inconclusive.
`fail` and `inconclusive` are evidence, but they do not close feedback.
Conflicting second assessments for the same source screenshot are rejected until
the system has a deliberate supersession model.

`vision_qa` is not enabled by this manual assessment command. Vision QA evidence
must come from a structured vision report/artifact boundary, not arbitrary typed
text.

Visual scenario readback is also Ralph-local and read-only:

```text
ralph visual-scenarios status --work-dir <project-workdir> [--task <taskId>]
```

Status reads `.ralph/plan.json` through the plan schema and reports visual
scenario screenshot evidence plus manual assessments grouped by
`sourceEvidenceRef`. It must not scan run directories as truth, recompute
artifact digests, upload assets, write `proofReviews[]`, change task status,
write dispositions, clear blockers, claim runtime intent or infer lifecycle
state. Invalid source rows, orphan assessments and conflicting assessments are
reported as readback issues, not repaired.

## Visual Workbench Evidence

Visual Workbench captures are source-owned isolated UI story renders. They are
the preferred visual-first path for ordinary web UI work when a project has a
`visual-workbench/manifest.json`.

Visual Workbench capture/export requirements are opt-in project/runtime policy,
not a global Ralph default. The canonical policy field is
`visualEvidenceMode`:

- `off`: default. Ralph may do normal UX/product work, but planner, executor
  automation and controller source-contract guard must not add or require
  Workbench coverage unless the accepted spec explicitly asks for it.
- `required`: ordinary DOM/web frontend tasks may be marked
  `visualEvidenceRequired=true`, and legacy/frontend Workbench-relevant tasks
  remain eligible for controller guard and executor evidence automation.
- `new_tasks_only`: only tasks explicitly carrying
  `visualEvidenceRequired=true` are Workbench-required. Existing tasks without
  that marker are legacy/non-required and must not be retrofitted solely to
  collect screenshots.

`visualEvidenceRequired` is task metadata for the existing Workbench evidence
chain. It is not evidence, not proof, not lifecycle truth and not screenshot
availability. A compatibility launch input may map the old
`visualWorkbenchEvidenceAutomation` marker to `visualEvidenceMode="required"`
at the governance edge, but internal runtime behavior must read the canonical
mode.

Capture output is still not proof by itself. The optional static capture
viewer (`index.html` in the run output directory, generated during capture or
refreshed from the existing report) is only a convenience view over the same
capture report and screenshots. A capture report may become
task-linked evidence only through an explicit export boundary:

```text
ralph visual-workbench export-evidence --work-dir <project-workdir> --run <visual-workbench-capture-run.json> --task <taskId> --story <storyId> --viewport <viewportName>
```

This command may record task-linked `verificationEvidence` only when all of the
following are true:

- the run report schema is `ra-355.visual-workbench-capture-run.v0`;
- the run status is `captured`;
- the run did not mutate the source workspace;
- the selected story and viewport exist in the report;
- the selected viewport status is `captured`;
- the screenshot artifact exists and its SHA-256 digest matches the run report;
- the screenshot is copied into a durable workDir-local
  `.ralph/visual-workbench/...` artifact path before the evidence row is
  written;
- the target task exists in `.ralph/plan.json`;
- the target task has non-empty `feedbackItemRefs[]`;
- the target task resolves to exactly one feedback item id and exactly one diff
  item id for manual assessment;
- the target task is the canonical implementation/evidence owner, not a
  controller-created source-repair task such as `Repair Visual Workbench
  coverage`.

The export must derive `feedbackItemIds` from the task's existing
`feedbackItemRefs[]`. It must not accept free-form feedback ids, infer links
from story ids, features, widgets, routes or claims, or parse accepted spec
text.

`taskRelevance.defaultFor[]` is source-owned recipe truth, but it is not allowed
to make a broad repair task the owner of screenshots. Repair tasks may fix
Workbench stories and selector tokens; they must point stories back to the
original implementation task id. The repair task id and repair task
`feedbackItemRefs[]` are context/dedupe only, not screenshot ownership tokens.
Selector readiness must block `repair_task_only_story_selection` and
`multi_ref_visual_export_owner`, and controller guard must keep
`no_non_repair_evidence_owner` visible instead of letting export/publish create
semantically broad screenshot rows.

The first export slice records Workbench screenshot evidence as
`result="inconclusive"`. A captured story/viewport means the isolated UI story
rendered and was imaged; it does not mean the visual claim was assessed or the
feedback item is fixed.

Manual assessment uses the same separate-evidence rule:

```text
ralph visual-workbench assess --work-dir <project-workdir> --task <taskId> --evidence-ref <visual-workbench-capture:...> --kind manual_note --result pass|fail|inconclusive --assessment <text>
```

Manual assessment may append a `manual_note` evidence row only when it points
to an existing exported Workbench screenshot row on the same task. The source
row must remain inconclusive, must have a workDir-local artifact path and must
not be `screenshotProof` evidence. The assessment row copies feedback ids,
target, artifact path and digest from the source row and persists
`sourceEvidenceRef`.

Workbench evidence readback is read-only:

```text
ralph visual-workbench status --work-dir <project-workdir> [--task <taskId>]
```

Status reads `.ralph/plan.json` through the plan schema and reports Workbench
screenshot evidence plus manual assessments grouped by `sourceEvidenceRef`.
When `.ralph/plan.json` is missing or unreadable, status returns structured
blocked readback with a stable `plan.reasonCode` instead of throwing raw file
errors.
It must not scan capture directories as truth, recompute artifact digests,
upload assets, write `proofReviews[]`, change task status, write
dispositions, clear blockers, claim runtime intent or infer lifecycle state.
Invalid source rows, orphan assessments and conflicting assessments are
reported as readback issues, not repaired.

Workbench evidence can be published to the Arena read-side only through an
explicit projection command:

```text
ralph visual-workbench publish-progress --work-dir <project-workdir> [--task <taskId>]
```

This command reads exported Workbench evidence and assessments, then writes
sanitized `visualEvidence` metadata to `.arena/progress.json` so Arena can
derive `ProjectInteractionSnapshot.visualEvidenceReviews`. It preserves
existing Arena progress state/message when present and must not publish raw
`artifactPath` values.

This projection does not create evidence, assess screenshots, upload
`ProjectAsset` rows, write `proofReviews[]`, mutate `.ralph/plan.json`, change
task status, write dispositions, clear blockers, claim runtime intent, infer
lifecycle state or decide whether `tg-spec` should show a screenshot button.
`tg-spec` may render only the Arena-provided review action.

Workbench export, assessment and status must not set `screenshotProof`, upload
`ProjectAsset` rows, write `proofReviews[]`, write `assets/proof/...`, mutate
task status, write dispositions, clear blockers, claim runtime intent or
change lifecycle state.

Ralph executor-owned visual capture must use the explicit Visual Workbench
automation helper when runtime-owned allowlisted config enables it. Executor
must not run the old page-level before/after screenshot proof capture or upload
`assets/proof/...` as a fallback.

Arena may expose exported Workbench or visual-scenario evidence through a
read-side review projection only. Ralph publishes sanitized visual evidence
metadata to `.arena/progress.json` without raw `artifactPath` values, and Arena
derives `ProjectInteractionSnapshot.visualEvidenceReviews` from that metadata.
This projection is for manager/TgSpec review UX. It must not become lifecycle
truth, task completion truth, `ProjectAsset` truth, outbox truth or accepted
feedback truth.

Metadata alone is not a user-facing Telegram screenshot action. The
`tg-spec` readback projection may expose a `visualEvidenceReviews` action only
for review rows backed by an available visual-evidence `ProjectAsset`; rows with
missing artifacts remain Arena diagnostics until ingestion or a production asset
bridge makes the screenshot artifact available.

Production runner artifact adoption uses the same governance ingest owner. A
runner-authenticated internal visual-evidence ingest endpoint may transport one
explicit sanitized progress row plus one matching screenshot artifact to
`ingestProjectVisualEvidence`. Runner must not use generic asset upload,
progress push, lifecycle retry or `tg-spec` delivery as a substitute for this
owner.

The production runner handoff is a private upload manifest emitted by Workbench
progress publish:

```text
.arena/visual-evidence-ingest-manifest.json
```

The manifest may list explicit upload candidates derived from exported task
evidence: `taskId`, `sourceEvidenceRef`, workdir-relative
`.ralph/visual-workbench/...png` artifact path, artifact digest and content
type. It is not public progress truth and not product proof. Runner may upload
only candidates that are also present in the current `.arena/progress.json`
snapshot, after that progress snapshot has been persisted through the normal
progress path. Runner must not scan `.ralph` folders, choose latest screenshots,
infer feedback links, mutate the manifest as a durable queue, or continue to
artifact ingest after ordinary progress persistence fails.

For completed/manual experiments where the live runner no longer transports
`.arena/progress.json` into governance, the only supported post-capture bridge
is explicit governance ingestion through `arena-ctl project_visual_evidence_ingest`.
That bridge treats the submitted progress file as source for one selected
Workbench row only: governance merges a canonical selected visual evidence row
into `Project.progressJson`, verifies accepted-diff readback, and imports the
matching image as a system visual-evidence `ProjectAsset`. It must not persist
the submitted progress JSON verbatim, scan Workbench folders, infer feedback
links, overwrite an existing different-sha review asset, retry/relaunch the
project or emit Telegram delivery.

Workbench automation may compose selector readiness, shell policy, capture,
export and progress publish in one explicit stage:

```text
ralph visual-workbench automate-evidence --work-dir <project-workdir> --manifest visual-workbench/manifest.json --task <taskId> --source-ref <git-commit> --base-url <url> --out-dir <capture-output-dir-outside-work-dir> --config <ralph.config.json>
```

The automation stage writes `visual-workbench-automation-run.json` in the
explicit output directory and a Ralph-local latest diagnostic copy under
`.ralph/visual-workbench/automation-runs/<taskId>/latest.json`. These reports
record setup-failed, blocked, capture-failed, export-failed, publish-failed
and published outcomes, but they are not proof, task status, lifecycle truth
or Telegram availability. If setup fails because the explicit output directory
resolves inside `workDir`, the automation must write only the Ralph-local
diagnostic report and must not write the unsafe output-directory report. Only
the export boundary may write task-linked `verificationEvidence`, and only the
publish boundary may write sanitized `.arena/progress.json` visual evidence.
New `ra-356.visual-workbench-automation.v5` reports include top-level
`ownerBoundary="ralph.visual-workbench-evidence-automation"`. This field is
diagnostic owner metadata for the automation report, not a new proof or
lifecycle source. Automation status must reject reports with a mismatched owner
boundary. It may normalize missing owner boundary only for historical v5
diagnostic reports that predate the field; that compatibility is local to
readback and does not authorize evidence creation, task completion, lifecycle
state or Telegram screenshot availability.
When capture fails before Workbench readiness, the automation report may project
bounded sanitized `capture.startDiagnostics` from the capture report so
operators can diagnose the source-owned `serveCommand` without reading
container-local temporary paths. These diagnostics are readback only and do not
authorize retry, fallback capture, evidence export or progress publish.

Automation status readback is Ralph-local and read-only:

```text
ralph visual-workbench automation-status --work-dir <project-workdir> [--task <taskId>] [--report <visual-workbench-automation-run.json>]
```

Status reads exactly one explicit report path or the deterministic latest
diagnostic path for the task. It must not scan capture directories, start
Workbench, capture screenshots, write `verificationEvidence`, publish
progress, mutate task status, infer lifecycle or decide Telegram screenshot
availability.

Negative user or production evidence should normally become current accepted feedback, for example by changing `BUG-005` to `reopened#2` with the latest actual behavior.

## Product Judgment and Evidence Requests

When Ralph cannot honestly prove the result from code/local tests alone, it must not overclaim.

But product uncertainty is not a lifecycle blocker by default:

- Ralph records a judgment when product intent is ambiguous.
- Completed linked work with weak or missing closure evidence stays private
  runtime evidence: `implemented_unverified` in `feedbackMatrix` plus
  `overclaimWarnings`, not a public judgment.
- Ralph adds concrete follow-up tasks when there is implementable product work.
- Ralph uses `overclaimWarnings` and item-linked evidence to avoid pretending weak evidence is closure.
- Ralph continues with the best implementable interpretation instead of pausing the project for user evidence.

If users or production evidence later contradict Ralph's judgment, that evidence must become current accepted feedback, for example by reopening an item in `tg-spec`. The next accepted diff then becomes Ralph's primary input.

`MANUAL` blockers are reserved for explicit user/operator/platform waiting states. Ralph controller product judgment must not create `MANUAL` as the default answer to missing production proof.

## UX Adapters

Buttons, polls, private messages and webapp review screens are UX adapters around the accepted feedback/evidence plane.

They should be admin-configurable because noisy feedback collection can hurt projects:

- chat buttons like `fixed` / `still failing`;
- mini-polls in the shared chat;
- private manager prompts;
- webapp bug review flows.

If Arena emits an evidence-oriented update from an explicit platform/user/operator waiting state, delivery adapters that claim it must render it as a clear action request or leave it unclaimed. Acknowledging unsupported events as `SKIPPED` hides the current human-action contract.

Whatever UX is used, the output must converge into accepted spec feedback/evidence, not a hidden side-channel that Ralph has to guess.

## Non-Goals

- Do not make runner parse raw Telegram messages.
- Do not make governance decide if a product bug is fixed.
- Do not let `arena-ctl` read local controller reports as lifecycle truth.
- Do not use lifecycle blockers or `FAILED` for ordinary controller product judgment.
