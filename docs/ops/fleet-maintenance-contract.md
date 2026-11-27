# Контракт поддержки флота

Это короткий контракт о том, как `agents-arena` должен удерживать project fleet рабочим, пока платформа быстро меняется.

Цель не в том, чтобы держать каждую старую row runnable вечно. Цель в том, чтобы каждая row была **supported, parked или явно классифицирована**.

## Здоровый флот

Каждая non-archived row должна быть одной из трёх:

- `live and healthy`
- `parked and healthy`
- `explicitly unsupported or special-case`

Всё остальное — это fleet damage.

## Инварианты

- `App ON` означает, что row должна сходиться к `RUNNING + HEALTHY` или быть явно видимой как broken.
- `App ON` допустим для preview restore даже тогда, когда loop runtime legacy.
- `Agent ON` и `Relaunch` требуют supported loop/runtime truth.
- `Recreate Runtime` не должен менять логический класс row; он только заменяет runtime instance на текущем platform software.
- `App OFF` влечёт `Agent OFF`.
- Parked rows сходятся к `OFF + OFF + ABSENT + IDLE`.
- `OFF + OFF + ABSENT + non-IDLE` — это cleanup debt, а не здоровый parked state.
- `Archive` — сильное park-действие. Archived rows не должны держать live runtime или live agent intent.
- `unsupported_runtime`, `empty_bootstrap`, `tg_spec_launch_gated`,
  `provisioning_wait` и `manual_row` — это не generic lifecycle bugs.

## Допустимые maintenance moves

Разрешённые maintenance moves:

- нормализовать illegal tuples через существующие lifecycle boundaries
- восстанавливать preview через явный `App ON`
- пересоздавать runtime через явный `Recreate Runtime`; strict blocked-row semantics для этого verb всё ещё сводятся отдельно
- парковать rows через явный `App OFF` или `Archive`
- делать `upgrade runtime` вместо оживления unsupported loop behavior
- честно классифицировать или удалять trash/manual/empty-bootstrap rows
- для resident runtime maintenance использовать отдельный auto-maintenance contract, а не hidden relaunch

Запрещённые maintenance moves:

- hidden compatibility layers
- synthetic status labels, которые скрывают broken tuples
- silent fallback from unsupported runtime into generic preview or agent behavior
- трактовать warm-container luck как supported fleet truth
- использовать recreate/maintenance как hidden relaunch или hidden unblock

Resident runtime auto-maintenance contract отдельно описан в:

- [docs/ops/blocked-window-maintenance-contract.md](docs/ops/blocked-window-maintenance-contract.md)
- [docs/ops/worker-service-maintenance-contract.md](docs/ops/worker-service-maintenance-contract.md)

## Правило для рефакторов

Любой рефактор, который трогает runtime, preview, lifecycle или loop support, должен оставлять каждую row в одном из двух исходов:

- либо она остаётся supported и converged
- либо она больше не supported, но явно классифицирована

Rows не должны становиться ambiguous и не должны зависеть от operator memory.

При переносе project на новый spec/runtime contract проверять две truth отдельно:

- source truth: `repoUrl + repoBranch` и ожидаемый code snapshot
- execution truth: loop plan/status/migration history, по которой agent решает, что уже сделано

Если переносится только code snapshot, но теряется execution truth, row не считается честно migrated.
Её нужно либо снабдить reconstructed baseline plan/status truth, либо явно классифицировать как clean-slate target до `Agent ON`.

## Видимость

Этот контракт должен быть легко находимым через:

- [docs/contracts/system-simplicity-contract.md](docs/contracts/system-simplicity-contract.md)
- [docs/ops](docs/ops)
- тонкий repo-owned operator skill
- короткий pointer в корневом [AGENTS.md](AGENTS.md)
