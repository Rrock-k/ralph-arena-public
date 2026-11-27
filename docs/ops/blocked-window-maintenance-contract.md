# Resident Runtime Auto-Maintenance Contract

Этот документ фиксирует `RA-267` как contract для platform-owned auto-maintenance над уже живым resident runtime.

Исторически v1 стартовал как узкий blocked-window lane. Это остаётся правдой для shipped scheduler slice. Но сам task дальше должен расширяться не до “любой `IDLE` row”, а до **maintenance-safe resident runtime cohorts** и **явных maintenance reasons**.

## Зачем это существует

Платформа должна уметь обслуживать уже живые runtime instances, не превращая maintenance в hidden relaunch, hidden unblock или второй lifecycle.

Правильная ось тут не “row стоит в blocker” и не “row просто `IDLE`”, а:

- runtime уже живёт как resident preview/runtime
- logical project truth должна остаться прежней
- есть явная причина maintenance

## Что считается auto-maintenance reason

Auto-maintenance должен запускаться только по явной maintenance reason, а не “на всякий случай”.

Текущие и целевые reasons:

- `preview_serving_stale`
  - preview не `HEALTHY`
  - или resident runtime heartbeat stale/missing
- `runtime_generation_stale`
  - row живёт на устаревшем project runtime runner generation по сравнению с current worker runner target
- `deterministic_runtime_normalization`
  - только если normalization не меняет logical project truth и уже сходится через существующий plain verb

Из этого сейчас code-shipped только первый reason.

## Maintenance-safe cohorts

Scheduler может работать только по allowlist cohorts:

1. Blocked waiting preview

- `powerIntent = ON`
- `agentIntent = ON`
- `runtimeState = RUNNING`
- `agentState = IDLE`
- `blockers` не пустой

2. Retained preview with agent off

- `powerIntent = ON`
- `agentIntent = OFF`
- `runtimeState = RUNNING`
- `agentState = IDLE`

3. Retained completed/failed preview

- `powerIntent = ON`
- `runtimeState = RUNNING`
- `agentState = IDLE`
- `lastOutcome = COMPLETED | FAILED`

## Excluded cohorts

Auto-maintenance не должен лезть в:

- `agentState = RUNNING`
- `OFF / OFF / ABSENT / IDLE`
- `ON / ON / RUNNING / IDLE / blockers=[] / lastOutcome=null`

Последний класс — это resident loop wait/idle path, а не maintenance-owned row.

## Ownership

- logical truth (`powerIntent`, `agentIntent`, `blockers`, `retryAt`, `lastOutcome`) остаётся у governance lifecycle contract
- runtime/preview serving остаётся owned by runner
- loop не получает hidden maintenance work
- scheduler/cron вызывает только platform-owned plain verbs

## Allowed maintenance verbs

Разрешены только существующие plain verbs:

- `Refresh Preview`
- `Recreate Runtime`
- probe / health / audit jobs
- deterministic normalization через уже существующий lifecycle boundary

## Forbidden

Auto-maintenance lane не имеет права:

- менять `powerIntent`
- менять `agentIntent`
- снимать `blockers`
- менять `retryAt`
- запускать planning / coding / spec migration
- делать hidden relaunch
- делать hidden resume / unblock

## RA-267: what is currently shipped

Текущий shipped scheduler slice всё ещё узкий и intentionally not universal:

1. Blocked waiting preview

- `powerIntent = ON`
- `agentIntent = ON`
- `runtimeState = RUNNING`
- `agentState = IDLE`
- blockers только из safe scheduler класса:
  - `RATE_LIMIT`
  - `BUDGET`
  - `API`
- shipped reasons:
  - `preview_serving_stale` -> `Refresh Preview`
  - `runtime_generation_stale` -> `Recreate Runtime`

2. Retained completed/failed preview with `Agent ON`

- `powerIntent = ON`
- `agentIntent = ON`
- `runtimeState = RUNNING`
- `agentState = IDLE`
- `lastOutcome = COMPLETED | FAILED`
- shipped reason:
  - `runtime_generation_stale` -> `Recreate Runtime`

Это intentional restriction:

- `Refresh Preview` уже live-proved как plain maintenance verb
- `Recreate Runtime` уже live-proved для retained preview cohorts с preserved project truth
- scheduler по-прежнему не лезет в `agentState = RUNNING`
- scheduler по-прежнему не лезет в `Agent OFF` retained previews вроде `SD Downhill`

## RA-267 next expansion

Следующий честный шаг для `RA-267`:

- расширить lane дальше до broader resident runtime auto-maintenance
- использовать не blocker как главный trigger, а explicit maintenance reason
- аккуратно решить, нужны ли `Agent OFF` retained previews в shipped scheduler lane

`runtime_generation_stale -> Recreate Runtime` уже можно автоматизировать только потому, что были закрыты два условия:

1. есть явная operator/runtime truth про current vs stale project runtime runner generation
2. `Recreate Runtime` уже строго сходится для maintenance-safe cohorts и не мутирует logical project truth

Важная текущая оговорка:

- scheduler должен смотреть не на worker-service parity (`worker_sha_mismatch`, `runner_sha_mismatch`),
- а на отдельную **project runtime generation truth**
- worker-service maintenance остаётся отдельным слоем (`RA-269`)

## Live proving

`RA-263` остаётся live proving lane для этого контракта.

Текущий live cohort intentionally dynamic; concrete canaries фиксируются в `RA-263` live logs, а не в этом contract doc.
