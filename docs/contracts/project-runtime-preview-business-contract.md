# Конституция жизнедеятельности проекта и превью

Это канонический business contract для `Project`, `App`, `Agent`, `Preview` и `blockers` в `agents-arena`.

Связанные документы:
- [system-simplicity-contract.md](docs/contracts/system-simplicity-contract.md)
- [accepted-spec-artifact-contract.md](docs/contracts/accepted-spec-artifact-contract.md)
- [project-lifecycle-operator-contract.md](docs/ops/project-lifecycle-operator-contract.md)
- [fleet-maintenance-contract.md](docs/ops/fleet-maintenance-contract.md)
- [glossary.md](docs/glossary.md)

Этот документ отвечает не на вопрос "как именно сегодня устроен один helper или route", а на вопрос:

`Какой бизнес-смысл платформа обязана удерживать для жизнедеятельности проекта и его превью?`

## 1. Базовые понятия

- `Project`
  Корневая identity, owner, spec, budget, secrets и archive boundary. Это не runtime state machine.

- `App`
  Желание держать проектный runtime и превью доступными.

- `Agent`
  Желание, чтобы loop продолжал работу над проектом, когда это допустимо.

- `Preview`
  Внешне доступная поверхность проекта. Preview может жить во время активной работы, после завершённой работы и во время ожидания.

- `blockers`
  Явные причины, почему loop work сейчас нельзя продолжать:
  `MANUAL`, `BUDGET`, `RATE_LIMIT`, `SECRETS`, `INFRA`, `API`.

  `MANUAL` означает, что работа ждёт человеческой или пользовательской evidence:
  проверку в реальном окружении, подтверждение бага, ответственного reviewer'а или другой feedback, который агент не может честно получить сам.

- `Loop/runtime support`
  Техническая truth о том, поддерживает ли текущая runtime-реализация agent work. Это отдельная ось, не равная preview availability.

## 2. Главные бизнес-инварианты

### 2.1 `App` и `Agent` — разные желания

- `App ON` означает:
  платформа должна стремиться держать project runtime и preview живыми.

- `Agent ON` означает:
  пользователь хочет, чтобы loop продолжал работу, как только это станет допустимо.

- `Agent OFF` означает:
  пользователь сознательно не хочет loop work сейчас.

`Agent ON` не должен значить "агент прямо сейчас бежит".
`App ON` не должен скрыто значить "запусти agent run".

### 2.2 Blocker блокирует работу, а не желание

- Blocker не должен сам по себе переводить `Agent ON` в `Agent OFF`.
- Blocker не должен сам по себе означать `App OFF`.
- Blocker означает:
  `loop work сейчас остановлен или не может стартовать, пока причина не снята`.

Нормальное состояние:

- `App ON`
- `Agent ON`
- project runtime жив или восстанавливается
- loop ждёт снятия blocker

Это waiting state, а не contradicted intent.

### 2.3 Preview и loop work не одно и то же

- Preview может быть валидно живым, даже когда agent work paused или unsupported.
- `preview restore` и `agent execution` — разные разрешения.
- Maintenance restart не должен превращать healthy preview project в сломанную row только потому, что loop work временно blocked.

### 2.4 Retryable blocker должен быть полным

Для retryable blockers (`RATE_LIMIT`, `API`, `INFRA`) система обязана держать полную retry truth:

- blocker reason
- `retryAt`, если row должна автоматически продолжиться
- понятное operator explanation

Недопустимое состояние:

- retryable blocker есть
- `retryAt=null`
- при этом row neither claimable nor auto-retriable

Это deadlock, а не валидная paused semantics.

### 2.5 Plain verbs должны оставаться plain

- `App ON`
  означает restore/keep runtime and preview.

- `App OFF`
  означает park runtime and preview.

- `Agent ON`
  означает allow/resume loop work when possible.

- `Agent OFF`
  означает pause loop work without pretending the project failed.

- `Relaunch`
  означает новый run from project truth, а не hidden unblock/recovery/migration.

- `Recreate Runtime`
  означает заменить текущий runtime instance на новый container/current platform software,
  сохранив project truth и логический класс row.
  Это maintenance verb, а не hidden relaunch, не hidden unblock и не новый lifecycle.

- `Refresh Preview`
  означает maintenance refresh текущего preview runtime.
  Это не hidden relaunch и не hidden loop resume.

## 3. Конституционные правила поведения системы

### 3.1 Простое управление app/runtime

- Пользователь должен уметь легко включать и выключать `App`.

- `App ON` должно автоматически поднимать preview/runtime, если runnable bootstrap существует.

- `App OFF` влечёт `Agent OFF`.
  Система не должна по умолчанию оставлять loop work разрешённой при выключенном app/runtime.

- Если пользователь выключает `App`, пока loop реально работает, UI должен честно предупредить об этом действии.

- Проекты без встроенного agent loop тоже остаются валидными проектами.
  Для них `App ON/OFF` по-прежнему должен управлять preview/runtime без притворства, что там есть resident loop semantics.

### 3.2 Простое управление агентом

- Пользователь должен иметь возможность многократно делать `Agent OFF -> Agent ON` без превращения проекта в failed row.

- Если проект ещё не завершил текущую работу, `Agent ON` должен означать продолжение работы, а не новый искусственный project lifecycle.

- Если по текущим задачам work больше нет, `Agent ON` не должен требовать специальных действий от agent CLI.
  Правильная сходимость: loop просто живёт в `idle`.

- Исчерпание текущих задач не должно считаться terminal project completion.
  Агент не "завершает проект навсегда"; он переходит в ожидание следующей работы.

- Когда `Agent ON`, loop должен либо реально работать, либо честно ждать в `idle`.

- Если resident runner сам сообщает `state=idle`, это live evidence от runner boundary.
  Governance не должен позволять stale `agentState=RUNNING` из DB скрывать pending spec/loop work; такой idle runner должен увидеть `pendingLoopWork` и yielded runtime должен пройти через normal fresh claim.

### 3.3 Recoverable причины не должны становиться финальной ошибкой

- Recoverable interruption не должна порождать финальный project failure.
  Сюда относятся:
  - rate limit
  - budget exhaustion
  - missing required secrets
  - временное отсутствие auth
  - container loss
  - app выключен пользователем
  - runner/worker restart

- Если loop утыкается в лимит подписки или провайдера, проект должен встать на `RATE_LIMIT`, а не в `FAILED`.

- Когда rate limit заканчивается, проект должен возобновляться по сохранённой retry truth.

- Rate-limit pause is not task progress. If a loop task was already started,
  the plan may keep exactly one `in_progress` task as the active WIP lease.
  On resume, the loop must reconcile that WIP before starting unrelated pending
  work.

- Provider CLI session resume is best-effort, not source truth. When a provider
  exposes a deterministic session id, the runner should resume the same session
  for the same active task, including after an accepted spec hash change. If the
  provider session is unavailable, durable truth remains repo state,
  `.ralph/plan.json`, latest accepted spec/diff, and prior agent logs.
  A failed provider-session lookup is not task progress and must not consume
  product-task retries; the loop should fall back to fresh execution from
  durable task/source truth.

- Provider CLI session ids should be recorded for every task attempt when the
  provider exposes them, not only for rate-limit pauses. This task-session
  ledger is loop-internal evidence for future continuation and debugging; it is
  not a lifecycle state, not a scheduler, and not a replacement for
  `.ralph/plan.json`.

- Planner/controller provider-call checkpoints are the same class of
  loop-internal evidence. They may best-effort resume the same exact rendered
  model-call input after provider failure, but success/fresh fallback history is
  diagnostic only and must not replace fresh repo/spec/plan truth.

- Если бюджет исчерпан, проект должен встать на `BUDGET`, а не в `FAILED`.

- Когда бюджет пополнен, проект должен продолжить работу, если user intent по-прежнему этого хочет.

- Budget limit is opt-in project policy.
  Admin/operator-created projects are unlimited unless a budget limit is explicitly enabled.
  Future public/community launch policy may require an enabled budget, but that policy must be explicit at creation time.

- Если auth временно отсутствует, система не должна симулировать фальшивую failure story.
  Она должна либо не запускать loop, либо держать его в честном waiting state.

- Если controller дошёл до продуктовой неопределённости или проверки, которую нельзя закрыть кодом или локальными тестами,
  он не должен превращать это в lifecycle blocker.
  Он должен зафиксировать judgment только для реальной продуктовой неопределённости,
  overclaim warning / private runtime evidence для слабой проверки, добавить
  implementable follow-up tasks если они есть, и продолжать по лучшей интерпретации.
  Отсутствие свежего негативного feedback после loop-claim считается нормальным
  default path; `needs confirmation` / missing production proof не должны
  превращаться в user-facing confirmation gate или `Assumption`.

- `MANUAL` не является дефолтным способом для Ralph controller остановить работу из-за product judgment.
  `MANUAL` допустим для явных user/operator/platform waiting states, но не для обычного "нужна проверка, чтобы принять суждение агента".

- Свежий accepted import из `tg-spec` может снимать только `MANUAL`, потому что он приносит новую пользовательскую или production evidence.
  Он не должен снимать `BUDGET`, `RATE_LIMIT`, `SECRETS`, `INFRA` или `API`.

- Явное operator-действие `Retry Now` может снять `MANUAL`, только если
  оператор уже получил evidence, что причина ожидания устранена. Это не
  auto-retry, не relaunch и не runtime recreate.

### 3.4 Secrets и spec changes — это normal operating paths

- Если loop запрашивает обязательные secrets, он должен останавливаться в pause/waiting semantics, а не в final failure.

- После предоставления обязательных secrets loop должен продолжаться от текущей project truth.

- Secrets, required for the spec's core behavior, production integration, or final verification, are blocking by default.
  Local/fake/mock/offline adapters are valid development tools, but they do not turn a required external integration into a completed product.

- `--non-blocking` secret requests are only for optional extras that are not required to complete the product as specified.

- Runtime secret/platform files are workspace-only, not project source truth.
  `.env.arena-secrets`, `.arena/auth.json`, `.arena/events.json`, `.arena/platform.md`, `.arena/spec-input.json`, local SQLite/DB files, and similar runner-owned files must be ignored and actively removed from the git index if a legacy branch already tracks them.

- `/workspace` is source code plus tracked project truth.
  Application/runtime data belongs under `ARENA_DATA_DIR`, mounted by the
  platform at `/data`. SQLite DBs, uploads, generated videos/media, thumbnails,
  app caches and temporary user artifacts must use this path unless the spec
  explicitly requires a source fixture.
  Runner restore/recreate must not silently delete unknown dirty source files;
  those files block sync and surface as an action-required project update.

- Если spec добавляется или редактируется во время `Agent ON`, loop должен подхватывать это и отрабатывать spec migration на безопасной iteration boundary.

- Safe iteration boundary includes a fresh claim after pause/retry. If a new
  accepted spec changes, supersedes or cancels the active WIP task, the next
  executor prompt must close that active WIP boundary honestly: complete it,
  adapt it to the new spec, or clean up/revert partial work. The scheduler must
  not silently start a second task while the first task still owns WIP.

- Fresh claim repo sync may restore only deterministic runner/ephemeral loop
  artifacts when every dirty entry is classified replayable by the shared
  `@arena/contracts` preview-workspace policy. This is not product WIP
  cleanup: app/source files and durable same-loop truth such as
  `.ralph/plan.json` must still block repo sync. Special cases stay
  entry-aware, not path-wide: Ralph-managed `.gitignore` changes are
  replayable only when user-owned content outside the managed section is
  unchanged, and root `arena-start.sh` is replayable only for mode-only
  executable-bit normalization with no content diff.

- Если spec changes накопились во время `Agent OFF`, следующий `Agent ON` должен их подхватить и обработать.

- Structured accepted spec changes должны приходить через
  `AcceptedSpecArtifact`: accepted spec, accepted diff,
  feedback/reopened, assumptions, safe secret refs and asset refs. Это
  product-truth input для loop, а не lifecycle state и не второй scheduler.

- `AcceptedSpecArtifact.acceptedDiff.items[].workImpact` является gate для
  нового loop work. `requires_loop_work` может разбудить loop; `context_only` и
  `no_loop_work` обновляют product truth, но не должны сами запускать planner,
  relaunch или fresh agent claim.

- Fresh loop work is computed across all project specs: any accepted input
  newer than the latest loop outcome with `workImpact="requires_loop_work"`
  may wake the loop. A newer `context_only` or `no_loop_work` update must not
  suppress older unprocessed required work.

- Public task UI is a projection from accepted feedback/diff and loop status,
  not a top-level `AcceptedSpecArtifact.tasks[]` entity and not Ralph/progress
  task truth. Loop progress can report execution, but it must not become
  product truth.
- Feedback does not back-reference projected task ids. If a surface wants a task
  list, it derives it read-side from the same feedback/diff boundary.

- Assumptions are loop-to-user signals. If users accept or correct them, the
  result returns to the loop only as a new accepted spec/diff, not as a direct
  patch into loop state.

- Если existing project переносится, копируется или привязывается к новому spec-plane, перенос кода сам по себе не переносит execution truth.
  Нужно либо явно перенести/реконструировать loop plan/status truth, либо объявить проект clean-slate target.
  Нельзя позволять planner'у создавать fresh bootstrap backlog поверх уже готового проекта, если operator intent — incremental evolution.

### 3.5 Потеря контейнера — это observation, а не бизнес-решение

- События контейнера не должны переписывать user intent задним числом.

- Если `App ON`, а контейнер исчез или упал, платформа должна:
  - либо восстановить runtime
  - либо честно показать broken/waiting row

- Если `App OFF`, потеря контейнера — это нормальная parked convergence, а не ошибка.

## 4. Канонические живые классы row

### 4.1 Active agent run

- `App ON`
- `Agent ON`
- `runtimeState=RUNNING`
- `agentState=RUNNING`

### 4.2 Waiting with live preview

- `App ON`
- `Agent ON`
- `runtimeState=RUNNING`
- `agentState=IDLE`
- `blockers` non-empty
- preview live or restoring

Смысл:
пользователь всё ещё хочет продолжения работы, но система честно ждёт снятия blocker.

### 4.3 Manual paused preview

- `App ON`
- `Agent OFF`
- `runtimeState=RUNNING`
- `agentState=IDLE`
- `lastOutcome=null`

Смысл:
незавершённая работа поставлена на паузу вручную.

### 4.4 Retained preview after completed work

- `App ON`
- `runtimeState=RUNNING`
- `agentState=IDLE`
- `lastOutcome=COMPLETED`

### 4.5 Parked

- `App OFF`
- `Agent OFF`
- `runtimeState=ABSENT`
- `agentState=IDLE`

## 5. Требования к maintenance и convergence

### 5.1 Maintenance restart не должен ломать проект

Если у проекта:

- `App ON`
- был runnable bootstrap
- был живой preview или валидный preview-only restore path

то maintenance restart, image refresh или runner refresh не должны делать проект permanently broken только из-за blocker.

Правильный результат после maintenance:

- либо проект возвращается в active/live preview class
- либо он явно broken и классифицирован по реальной причине

Неправильный результат:

- deadlocked row
- stale "Container starting..."
- hidden loss of retry truth

### 5.2 App restore допустим при blocked agent work

Если user truth всё ещё `App ON`, а blocker запрещает только loop progress, платформа должна уметь:

- сохранить или восстановить preview/runtime
- отдельно удерживать agent work в waiting state

Исключение допустимо только если runnable preview bootstrap реально отсутствует или runtime explicitly unsupported для preview restore.

### 5.3 `Recreate Runtime` должен сохранять project truth

`Recreate Runtime` существует для простого maintenance:

- перезапустить container
- поднять проект на текущем worker/runner/bundled-runtime software
- не переписывая бизнес-смысл проекта

Инварианты `Recreate Runtime`:

- не менять `powerIntent`
- не менять `agentIntent`
- не снимать `blockers`
- не терять `retryAt`
- не переписывать `lastOutcome` semantics
- не мутировать specs/assets/source truth

Правильная сходимость:

- если row была `Preview-only live`, после recreate она снова `Preview-only live`
- если row была `Waiting by blocker`, после recreate она снова `Waiting by blocker`
- если row держала retained preview после completed work, после recreate она снова держит retained preview

Неправильная сходимость:

- deadlocked row
- silent unblock
- forced new run
- fake failure story

### 5.4 Maintenance и runtime generation

Project truth и runtime generation — разные оси.

Maintenance может заменить runtime instance на текущее platform software, даже если проект до этого был поднят на старом container generation.

Это не должно требовать от оператора скрыто понимать внутренние runner/loop ref-детали.
Для maintenance нужен один простой смысл:

- `Recreate Runtime` = "подними тот же проект на текущем platform software"

Отдельная upgrade/support policy остаётся только там, где речь уже идёт не о preview/runtime maintenance, а о праве запускать новый agent work.

### 5.5 Running loop — отдельный, более строгий случай

`Recreate Runtime` во время реально идущего `agentState=RUNNING` не должен притворяться безопасным no-op.

Для active run у системы должен быть отдельный честный контракт:

- либо explicit interruption + resume path
- либо временный запрет/reason в operator plane

Но недопустимо делать вид, что hard recreate активного loop — это тот же простой maintenance, что и recreate paused/live preview row.

### 5.6 Preview refresh — maintenance verb

Ручной refresh preview:

- не меняет `Agent` intent
- не снимает blocker
- не объявляет новый run
- не должен владеть lifecycle truth

Его смысл только один:
мягко актуализировать preview-serving runtime.

### 5.7 Preview cache freshness

Проект может использовать real service worker / PWA-кэш. Платформа не должна запрещать это глобально только потому, что preview embedded или временный.

Но freshness preview принадлежит Arena:

- browser-visible `/sw.js` на preview origin должен иметь platform generation boundary
- generation должен меняться при смене preview workspace/code truth
- project-owned service worker может импортироваться/исполняться внутри этой boundary
- preview ingress должен запрещать browser/CDN caching для preview responses;
  обычные assets (`/app.js`, `/game.js`, картинки, HTML) не должны зависеть от
  project-local cache headers, чтобы стать свежими после runtime refresh
- при смене preview generation runner-owned wrapper может очищать preview
  CacheStorage перед возвратом клиента к app, чтобы cache-first project service
  worker не продолжал отдавать старые assets
- пользователь не должен вручную чистить site data, чтобы увидеть обновлённый preview после честного runtime refresh/recreate

Иначе live preview truth расходится с browser truth: runtime уже обновлён, но пользователь продолжает видеть старую app shell из кэша.

## 6. Что оператор и UI должны объяснять

UI и operator tooling должны уметь объяснить row одним честным предложением:

- хочет ли пользователь живой app
- хочет ли пользователь loop work
- есть ли blocker
- жив ли preview
- что можно сделать дальше

Примеры правильных объяснений:

- `Agent is ON, but work is paused by provider rate limit until ...`
- `Preview is still live; the project is waiting for blocker removal`
- `Work is manually paused; turn Agent ON to continue`

Неправильные объяснения:

- маскировать waiting row как generic startup
- выключать агентский смысл только потому, что есть blocker
- делать вид, что broken maintenance row "просто стартует"

## 7. Чего не должно быть

- скрытого перевода `Agent ON -> OFF` из-за blocker
- скрытого перевода `App ON -> OFF` из-за blocker
- hidden unblock внутри `Relaunch`
- потери `retryAt` при сохранённом retryable blocker
- смешения `preview restore` и `agent resume` в один недифференцированный claim path
- operator/UI truth, которая не различает:
  - manual pause
  - blocked waiting
  - completed retained preview
  - real broken runtime

## 8. Правило для будущих изменений

Любой change в lifecycle/runtime/preview должен сохранять эту последовательность вопросов:

1. Хочет ли пользователь живой app?
2. Хочет ли пользователь loop work?
3. Есть ли системная причина подождать?
4. Может ли preview жить независимо от этого ожидания?
5. Какое следующее действие честно разрешено?

Если change ломает это объяснение, он деградирует бизнес-контракт, даже если код локально "работает".
