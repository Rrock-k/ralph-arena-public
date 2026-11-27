# Операторский контракт жизненного цикла проекта

Это короткая operator truth для project lifecycle в `agents-arena`.

Связанные документы:
- [Системный контракт простоты](docs/contracts/system-simplicity-contract.md)
- [Бизнес-контракт жизнедеятельности проекта и превью](docs/contracts/project-runtime-preview-business-contract.md)
- [Accepted Spec Artifact Contract](docs/contracts/accepted-spec-artifact-contract.md)
- [Контракт поддержки флота](docs/ops/fleet-maintenance-contract.md)

Этот файл — канонический короткий operator contract. Он заменяет зависимость операторских решений от старой lifecycle-правды, размазанной по plan docs `RA-237`, `RA-243` и `RA-247`.

## Базовые сущности

- `Project`
  Корневая identity и archive boundary. Project-level lifecycle — это не runtime lifecycle.

- `App`
  Означает наличие preview/runtime. `App ON` просит платформу держать preview container живым.

- `Agent`
  Означает разрешение на loop execution. `Agent ON` позволяет loop работать; `Agent OFF` паркует loop.

- `Preview`
  Внешне доступная поверхность приложения. Health preview — это observation, а не отдельная lifecycle-ось.

- `Loop runtime`
  Семейство implementation/runtime, которое определяет, поддерживается ли agent execution. Preview restore и loop support — разные вопросы.

- `repoUrl + repoBranch`
  Каноническая source truth для project code. Workspace, live container и прочие тёплые артефакты — это кэш или evidence, а не owner кода.

- `TG-Spec launch configuration`
  Source-config truth у primary component для accepted/imported tg-spec target до
  первого runtime launch. Она не является lifecycle state и не заменяет
  `repoUrl + repoBranch`; она только объясняет, что row ждёт явный tg-spec
  launch action.

- `blockers`
  Явные pause reasons: `MANUAL`, `BUDGET`, `RATE_LIMIT`, `SECRETS`, `INFRA`, `API`.
  `MANUAL` значит, что loop ждёт явного user/operator/platform действия, а не нового автоматического relaunch.
  Ralph controller не должен создавать `MANUAL` как дефолтный способ остановить работу из-за product judgment или missing production proof.
  Если `MANUAL` всё же есть, user-facing update должен быть action request, не `work.failed`.
  Retryable provider/platform pauses (`RATE_LIMIT`, `API`, `INFRA`) тоже не являются work failure: user-facing update должен быть wait/retry action request, пока lifecycle держит явный blocker/retry truth.

## Truth о loop runtime

- Показывать loop identity явно:
  `Bundled default` или `Pinned <version/ref>`

- Не использовать `latest` как operator truth.
  Это двусмысленно.

- `Agent ON` и `Relaunch` зависят от supported loop/runtime truth.
- `Recreate Runtime` живёт в maintenance plane. Он может быть валидным даже тогда, когда loop work blocked или agent execution unsupported, если preview/runtime restore itself поддерживается.

- `App ON` — это другая плоскость.
  Preview-only restore может быть валидным даже тогда, когда agent execution заблокирован legacy или pinned runtime truth.

- Если loop work заблокирован, следующее действие — `Upgrade runtime`, а не hidden fallback и не silent noop behavior.

## Разрешённые operator actions

- `Archive` / `Unarchive`
  Сильные project-level действия park/restore.

- `App ON`
  Restore или удержание preview. Это допустимо даже для preview-only rows.

- `Refresh Preview`
  Мягкий maintenance refresh текущего preview runtime.
  Не меняет `Agent` intent, не снимает blocker и не объявляет новый run.

- `Recreate Runtime`
  Жёсткий maintenance restart текущего runtime instance на новом container/current platform software.
  Не меняет `powerIntent`, `agentIntent`, `blockers`, `retryAt` и не объявляет новый run.

- `App OFF`
  Park проекта. Это должно сходиться в `powerIntent=OFF`, `agentIntent=OFF`, `runtimeState=ABSENT`.

- `Agent ON`
  Разрешение или возобновление loop work. Для этого нужен supported loop/runtime contract.
  Для `paused preview` row это не hidden hot restart внутри живого runner'а, а resume через fresh claim после честного reclaim текущего idle runtime.

- `Agent OFF`
  Остановка loop work без притворства, что проект failed.

- `Relaunch`
  Новый agent run. Это не resume того же in-memory loop, а новый run из project truth.

- `Retry Now`
  Явное operator-действие для retryable blockers (`RATE_LIMIT`, `API`,
  `INFRA`) или явного `MANUAL`, когда оператор уже получил новую evidence,
  что ждать больше не нужно. Оно снимает только выбранный blocker и очищает
  retry schedule; это не relaunch, не recreate runtime и не скрытая смена
  модели. `MANUAL` не становится auto-retry: его можно снять только explicit
  operator action или свежим accepted import.

- `Upgrade runtime`
  Перевод проекта из legacy/pinned runtime truth в поддерживаемый runtime contract. Это правильный ответ для unsupported loop rows, а не hidden compatibility behavior.

- `Delete`
  Финальное удаление для trash/manual/empty-bootstrap rows, которые не должны оставаться во флоте.

## Нормальные operator states

- `Preview-only live`
  `App ON`, `Agent OFF`, `runtimeState=RUNNING`, `agentState=IDLE`, `previewHealth=HEALTHY`
  Этот класс может быть как обычным preview-only рядом, так и retained preview после completed/failed work; operator detail не должен скрывать `lastOutcome`.

- `Paused preview`
  `App ON`, `Agent OFF`, `runtimeState=RUNNING`, `agentState=IDLE`, `lastOutcome=null`, `previewHealth=HEALTHY`

- `Waiting by blocker`
  `App ON`, `Agent ON`, `runtimeState=RUNNING`, `agentState=IDLE`, `blockers` non-empty
  Operator tools should surface this as a waiting state, for example
  `project_explain.classification=waiting_by_blocker`, not as active broken
  fleet damage.

- `Agent run live`
  `App ON`, `Agent ON`, `runtimeState=RUNNING`, `agentState=RUNNING`

- `Live preview after completed iteration`
  `App ON`, `runtimeState=RUNNING`, `agentState=IDLE`, `lastOutcome=COMPLETED`, `previewHealth=HEALTHY`

- `Parked`
  `App OFF`, `Agent OFF`, `runtimeState=ABSENT`, `agentState=IDLE`

- `Archived`
  `archivedAt != null`, `App OFF`, `Agent OFF`, `runtimeState=ABSENT`

## Residual / problem states

- `Active broken`
  `powerIntent=ON`, но row не сходится к `RUNNING + HEALTHY`

- `Illegal off-state drift`
  Примеры:
  - `App OFF + Agent ON`
  - `OFF + OFF + ABSENT + non-IDLE`

- `Unsupported runtime`
  Проект может поддерживать preview restore, но `Agent ON` или `Relaunch` заблокирован loop/runtime support policy.

- `Empty bootstrap / seedless project`
  Нет runnable preview bootstrap. Это не проблема lifecycle repair.

- `TG-Spec launch gated`
  Accepted/imported tg-spec target, у которого ещё нет repo/runtime source
  truth, но есть явная launch configuration truth на primary component.
  Это не trash/manual row и не bootstrap failure.

- `Manual row`
  Нестандартная project shape, которую нельзя трактовать как обычный preview project.

## Разрешённые следующие действия

- Если нужен preview и bootstrap существует:
  использовать `App ON`

- Если проект нужно сильно припарковать:
  использовать `Archive`

- Если loop work не нужна:
  использовать `Agent OFF` или `App OFF`

- Если `Agent ON` сохранён, но работу временно блокирует blocker:
  не выключать агентский смысл скрыто; объяснять row как waiting by blocker

- Если retryable blocker ждёт будущий `retryAt`, но оператор явно устранил
  причину ожидания:
  использовать `Retry Now`, а не `Relaunch` и не ручное редактирование retry
  truth

- Если row ждёт `MANUAL`, и оператор явно устранил причину ожидания:
  использовать `Retry Now`, а не `Relaunch` и не ручное редактирование
  blockers

- Если row ждёт `MANUAL`, а пришёл свежий accepted import из `tg-spec`:
  этот import может снять только `MANUAL`, после чего normal claim path снова отдаёт Ralph текущий spec diff.

- Если пришёл свежий `AcceptedSpecArtifact` с reopened feedback or assumptions:
  это new product truth for next loop claim, not a lifecycle action by itself.
  Operator не должен вручную реконструировать это из Ralph progress/history.

- Если project truth нужно сохранить, но runtime/container надо поднять заново на текущем platform software:
  использовать `Recreate Runtime`, а не `Relaunch`

- Если у проекта живой preview, но незавершённая работа вручную поставлена на паузу:
  использовать `Agent ON` как resume через normal claim path, а не relaunch и не hidden in-place restart

- Если preview живой, но устарел или требует maintenance refresh:
  использовать `Refresh Preview`, а не `Relaunch`

- Если preview/runtime нужно пересоздать полностью, но логический класс row должен сохраниться:
  использовать `Recreate Runtime`, а не `Refresh Preview`

- Если loop work нужна, но runtime unsupported:
  использовать `Upgrade runtime` для нового agent work, а `Recreate Runtime` — только для maintenance/preview restore, если этот restore поддерживается

- Если row — это trash, empty-bootstrap или что-то, что не стоит сохранять:
  использовать `Delete`, а не repeated repair attempts

- Если row уже фактически parked, но несёт stale live state:
  нормализовать его через существующий lifecycle boundary, а не придумывать новый state

- Если runnable bootstrap нет:
  классифицировать row как `empty bootstrap` или `manual`, а не как generic preview outage

- Если row — accepted/imported tg-spec target с launch configuration:
  использовать явный tg-spec launch action (`tg_spec_launch_configure` или
  `tg_spec_launch_start`), а не `App ON`, `Relaunch`, runtime repair или
  `Delete` как recommended next action.

## Operator rule

Предпочитать одно строгое объяснение вместо ещё одного fallback:

- сказать, что истинно сейчас
- классифицировать row
- объяснить почему
- показать allowed next actions

Не прятать lifecycle defects за optimistic UI или synthetic compatibility behavior.
