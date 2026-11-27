# Контракт operator tools для arena-ctl

Этот tool layer должен оставаться внутри границ
[Системного контракта простоты](docs/contracts/system-simplicity-contract.md):
один truth boundary, никакого synthetic lore и никакого параллельного lifecycle language.

Это короткая каноническая shape для первых operator-facing tools в `arena-ctl`.

Текущий live status:

- `fleet_summary` уже реализован
- `project_explain` уже реализован как первый read-only slice поверх `project_snapshot + project_health`
- `project_updates` уже реализован как read-only delivery/outbox view для user-facing project updates и private notifications
- `project_proof_reviews` уже реализован как read-only current proof-review /
  visual evidence review projection для screenshot CTA audits
- `project_spec_artifact_audit` уже реализован как read-only accepted-spec
  artifact audit для RA-287 repair/upgrade decisions
- `fleet_spec_artifact_audit` уже реализован как read-only fleet accepted-spec
  artifact audit поверх тех же project-level classes
- `project_retry_now` уже реализован как explicit mutation для retryable
  blockers (`RATE_LIMIT`, `API`, `INFRA`), когда оператор получил evidence,
  что можно не ждать текущий `retryAt`
- `worker_restart_service` уже реализован как explicit worker-scoped mutation
  для `RA-269` safe-window maintenance; это не project recovery и не
  `Recreate Runtime`
- следующий шаг — переиспользовать тот же snapshot boundary и в других operator-facing reads, используя `project_health` только как supplemental evidence

## Usefulness contract

`arena-ctl` должен оставаться полезным live operator surface, а не музейным adapter layer.

Правило:

- live project incident сначала проходит через `project_explain` или `fleet_summary`, если вопрос попадает в их scope
- raw DB / Docker / Git / curl evidence допустим как нижний слой, но не должен становиться молчаливой заменой operator tool
- если operator регулярно уходит в raw layer за одним и тем же фактом, это `arena-ctl` gap: добавить поле/tool, сузить существующий tool или явно удалить устаревший surface
- если tool больше не отражает текущий lifecycle/operator contract, его нужно чинить или удалять, а не обходить привычкой
- RA-263 operations log фиксирует такие gaps короткой строкой, чтобы tool evolution шла вслед за live operations

## RA-263 lesson promotion rule

RA-263 live incidents are historical evidence until a lesson is promoted into a
current owner.

When an incident exposes a repeatable operator problem:

- start with `arena-ctl` if an existing tool fits the question
- classify every raw DB / Docker / Git / curl bypass as one-off forensic detail
  or missing operator-tool capability
- promote recurring missing-tool capability into backlog, docs or tool work
- keep loop execution protocol lessons in Ralph/runtime contracts, not
  Codex-only or Claude-only skills
- never normalize raw shell/SQL as the default operating procedure

For restore/resume incidents, use this compact gate before closeout:

- source truth checked: `repoUrl + repoBranch`, workspace ahead/dirty state and
  runtime artifacts are classified
- runtime action chosen from the operator contract: `App ON`, `Refresh Preview`,
  `Recreate Runtime`, `Agent ON`, `Retry Now` or no action
- blocker truth checked after action, not inferred from preview health
- source delivery checked again when loop-owned `.ralph/plan.json` or other
  durable execution truth changed
- any raw-layer evidence gap is recorded as one-off or missing tool capability

## Shared rule

Lifecycle summary tools должны возвращать одну и ту же строгую структуру:

- `truth`
- `classification`
- `why`
- `allowedActions`
- `recommendedNextAction`
- `operatorNotes`

Цель не в lore и не в длинной diagnostic prose. Цель — компактная operator truth.

## `project_explain`

Назначение:

- объяснить состояние одного проекта на operator language
- сказать, что истинно сейчас
- строго классифицировать row
- показать только честные next actions

Текущий набор classification:

- `healthy_preview_only`
- `paused_preview`
- `healthy_agent_run`
- `parked`
- `active_broken`
- `unsupported_runtime`
- `empty_bootstrap`
- `manual_row`
- `provisioning_wait`

Типичные поля в `truth`:

- `powerIntent`
- `agentIntent`
- `runtimeState`
- `agentState`
- `blockers`
- `lastOutcome`
- `previewHealth`
- `loopRuntime`
- `loopSupportStatus`

## `fleet_summary`

Назначение:

- суммировать весь флот на operator language
- отделять healthy fleet от residual damage
- показывать следующий честный fleet-level move

Текущая shape у `classification`:

- `status`
  - `healthy_live_fleet`
  - `residual_damage_present`
- `residualCohorts`

Типичные поля в `truth`:

- `runningHealthy`
- `parked`
- `activeBroken`
- `archived`
- `activeAgentRuns`
- `featuredHealthy`
- `publicHealthy`

## `project_updates`

Назначение:

- показать recent Arena-owned delivery rows for one project
- проверить, какой event действительно выпущен: например `work.needs_evidence` vs `work.failed`
- проверить delivery/ack outcome без raw DB

Этот tool читает delivery/outbox truth. Он не классифицирует lifecycle и не решает, что делать с row. Для lifecycle answer использовать `project_explain`.

`deliveryDiagnostics` показывает только Arena-owned delivery readback:
`Project.tgSpecSourceProjectId`, eligibility for Arena project update enqueue,
and the latest project/personal delivery status/error. It does not query
`tg-spec`, send Telegram messages or decide screenshot availability. If
`project_proof_reviews` has current `visualEvidenceReviews` but
`project_updates.deliveryDiagnostics.latestProjectUpdate.lastError` says
`No bound tg-spec project for Arena project id`, the next issue is tg-spec
binding/presentation, not Workbench capture or Arena evidence truth.

## `project_proof_reviews`

Назначение:

- показать current screenshot proof-review projection для одного проекта
- отличить текущий read-side статус proof CTA от уже доставленных historical
  `ProjectUpdateOutbox` rows
- проверить `ready` / `expected` / `unavailable` без raw DB, Docker secret
  dance или скачивания image bytes
- показать sanitized `proofReviews`, `visualEvidenceReviews`,
  `visualEvidenceReadiness`, `latestAcceptedUpdate` и status summary

Этот tool читает текущую interaction/proof read model.
`visualEvidenceReadiness` объясняет только текущий empty/available readback
state из `ProjectInteractionSnapshot`; оно не сканирует raw Workbench folders,
outbox rows или legacy proof assets. Tool не классифицирует lifecycle и не
является delivery history; для уже отправленных сообщений использовать
`project_updates`.

## `project_spec_artifact_audit`

Назначение:

- показать, есть ли у проекта current v1 `AcceptedSpecArtifact`
- отделить spec artifact repair от lifecycle repair
- не отдавать raw artifact payload, legacy delta или provenance в operator UI
- считать markdown-only spec состоянием repair-required, а не runner-ready
  legacy launch path

Классы:

- `current_v1_artifact`
- `markdown_only_spec`
- `malformed_metadata`
- `unsafe_metadata`
- `no_spec`

Этот tool не решает lifecycle state. Для lifecycle answer использовать
`project_explain`.

## `fleet_spec_artifact_audit`

Назначение:

- показать, сколько проектов уже имеют current v1 `AcceptedSpecArtifact`
- показать repair-required cohorts: markdown-only, malformed, unsafe, no-spec
- вернуть ограниченный список проектов для следующего
  `project_spec_artifact_audit`
- не превращать fleet audit в batch mutation или lifecycle classifier

Этот tool переиспользует project-level artifact classes. Он не заменяет
`fleet_summary`, потому что spec artifact readiness и lifecycle fleet health —
разные плоскости.

## Правила

- Никаких hidden fallback advice.
- Никакого synthetic lore.
- Не придумывать extra classification strings вне канонического набора.
- Не смешивать preview restore и loop support в одном объяснении.
- Не считать каждую non-running row повреждением.
- Если row — это не lifecycle bug, говорить это прямо.
- Если blocker — это unsupported runtime, именно это и показывать как причину.
- Если вопрос касается source truth проекта, показывать `repoUrl + repoBranch`, а не оживлять truth из workspace или warm container.
- Если текущий incident потребовал raw evidence вне `arena-ctl`, закрывающая operator note должна сказать, это one-off forensic detail или missing tool capability.
