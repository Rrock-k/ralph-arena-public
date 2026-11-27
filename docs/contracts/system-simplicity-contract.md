# Системный контракт простоты

Это короткий поперечный контракт для `agents-arena`, который стоит над runtime, read-side, operator tooling и будущими рефакторами.

Он нужен, чтобы система не зависела от того, помнит ли кто-то “дух `RA-257`” из головы.

Использовать вместе с:

- [change-review-checklist.md](docs/ops/change-review-checklist.md)
- [project-runtime-preview-business-contract.md](docs/contracts/project-runtime-preview-business-contract.md)
- [accepted-spec-artifact-contract.md](docs/contracts/accepted-spec-artifact-contract.md)
- [ralph-feedback-evidence-contract.md](docs/contracts/ralph-feedback-evidence-contract.md)
- [project-lifecycle-operator-contract.md](docs/ops/project-lifecycle-operator-contract.md)
- [fleet-maintenance-contract.md](docs/ops/fleet-maintenance-contract.md)
- [admin-laboratory-contract.md](docs/ops/admin-laboratory-contract.md)

## Цель

Цель не в том, чтобы “сделать код красивым”.

Цель в том, чтобы было:

- меньше сущностей
- меньше verb-ов
- меньше источников истины
- меньше скрытых recovery-путей
- проще operator truth
- строже и честнее convergence

Если change делает систему труднее для объяснения, он должен очень явно заслужить эту сложность.

## Жёсткие правила

### 1. Один concept — один owner

У каждого важного concept должен быть один понятный owner:

- одна runtime truth
- одна retry truth
- одна lifecycle truth
- одна support truth
- одна operator-facing explanation

Не держать параллельные mirrors только потому, что они уже существуют.

### 2. Сначала удалить или схлопнуть, потом добавлять

Перед тем как добавить новый:

- entity
- state
- verb
- helper
- snapshot field
- fallback

сначала спросить, нельзя ли поручить эту работу уже существующему контракту.

Дефолтное движение:

- схлопнуть
- объединить
- локализовать
- удалить

А не:

- накинуть ещё один слой

### 3. Простые действия должны оставаться простыми

У обычного действия должен быть один честный смысл.

Примеры:

- `App ON` должен значить restore preview/runtime
- `Agent ON` должен значить разрешение на loop work
- `Relaunch` должен значить restart, а не hidden migration + recovery + config rewrite

Если change требует второго смысла, его нужно выносить в explicit advanced path, а не расширять plain action.

Для Admin Laboratory это означает: primary UX начинается с текущего
repository/project state и одного понятного действия (`Apply spec diff`,
`Run executor on selected task`, `Collect/check screenshots`), а raw stage ids,
CLI arguments и mutation details остаются audit/debug details. Нельзя прятать
цепочку planner + executor + controller + Workbench за одной простой кнопкой.

### 4. Никакой synthetic lifecycle truth

Нельзя придумывать фальшивые lifecycle-сигналы вроде:

- synthetic states
- synthetic queue/launch history
- synthetic paused/failure vocabulary
- optimistic UI truth, которой сама система не владеет

History может быть полезной, но fake history — это ballast.

### 5. History и telemetry не должны становиться live control plane

Логи, отчёты, outcomes и diagnosis могут помогать принимать решения.
Но они не должны тихо превращаться во второй scheduler или lifecycle owner.

Предпочитать live truth, собранную из:

- intents
- runtime presence
- blockers
- pending work
- explicit support truth

А не из stale history fields.

### 6. Read-side должен читать boundary, а не собирать truth заново

UI, tools и read-side surfaces должны читать один explicit boundary shape.

Нельзя позволять каждому consumer заново склеивать:

- project row
- component tuple
- loop support
- preview bits
- worker bits

в свою собственную версию truth.

Чем больше consumers сами собирают truth, тем сильнее система дрейфует.

### 7. Compatibility должна жить на краю

Backward compatibility допустима только если она:

- локализована
- временная
- явная

Нельзя позволять старым aliases, dual vocabulary или legacy wire shapes снова становиться общей внутренней truth.

### 8. Operator truth должна оставаться объяснимой

Строку должно быть можно объяснить одним строгим предложением:

- что истинно сейчас
- какой это класс строки
- какие следующие действия разрешены

Если change делает это объяснение более мутным, дизайн, скорее всего, деградирует.

### 9. Accepted spec truth идёт через один artifact boundary

Accepted spec, accepted diff, feedback/reopened, assumptions, safe secret refs
and asset refs must converge through the
loop-neutral `AcceptedSpecArtifact` contract.

`tg-spec`, Arena, runner, Ralph and future loops must not each invent their own
accepted-spec semantics.

Loop execution tasks, UI task projections, progress steps, controller reports
and evidence matrices may project from or respond to the artifact, but they are
not the public product truth.

Semantic evidence decisions must not be encoded as keyword or regex policy.

Examples:

- do not decide that an attachment is implementation-critical because nearby
  text matches a phrase like "as in this image";
- do not decide that a source message is a bug, assumption, asset reference or
  context-only input through language-specific word lists;
- do not expand these heuristics by adding more languages, synonyms or aliases.

Such checks are allowed only for syntax and transport shape: ids, paths,
schema fields, known artifact references and structural consistency. The
semantic decision belongs in the producer's judgement/audit layer and must be
carried as `sourceEvidence`, `assetBindings`, claim decisions or another
explicit artifact field. Retrieval/RAG may surface candidate evidence, but it
does not own the product-truth decision.

### 10. User-facing project progress is delta-first

For Telegram, Mini App and other project-management surfaces the human story is:

`spec diff -> task diff -> project changes`

This means:

- accepted spec diff is the user-facing source of the next work packet;
- task changes are a read-side projection of that diff, not a second task source of truth;
- copy should describe active accepted change batches, not lifetime project totals;
- if a count is not clearly scoped to an active accepted change batch, omit it;
- long history and full details belong in the project surface, not in noisy chat messages.

Before shipping user-facing UX copy or flow changes, get a second opinion and ask:
"can this be simpler, clearer, and friendlier?"

### 11. No Local Semantic Substitutes

Downstream implementation context may explain difficulty, but it must not
silently weaken accepted product truth.

If accepted spec/diff/source evidence names an exact requirement, such as:

- a specific library, framework, design system, CLI, provider or integration;
- an exact visual reference, asset, file, behavior or negative requirement;
- a migration from one implementation family to another;

then planners, executors, controllers, tools and operators may not close it by
local substitution:

- `compatible with X` instead of `X`;
- `X-style` instead of `X`;
- `inspired by X` instead of `X`;
- a local mock/offline/private adapter instead of the required integration;
- a narrower partial outcome that is easier to test.

Allowed outcomes are:

- implement the exact accepted requirement;
- add or update implementable work that preserves the exact requirement;
- record a real product/spec judgment if the accepted truth is ambiguous;
- block on a real missing dependency;
- accept a newer spec/diff that explicitly changes or relaxes the requirement.

Anything else is semantic closure drift. It is not a valid completion path and
must not be hidden behind task wording, controller overclaim, tests or local
architecture convenience.

## Что считать подозрительным по умолчанию

Вот это по умолчанию красные флаги:

- новый persisted state
- новый mirrored field
- новая fallback-цепочка
- новый helper “на всякий случай”
- новая local mini-state-machine
- array-order truth вроде `components[0]`
- hidden migration внутри plain action
- ручная пересборка operator truth в read-side
- второй recovery или scheduling language рядом с core lifecycle
- локальная замена exact accepted requirement на `compatible` / `style` /
  `inspired` без accepted correction или explicit judgment

## Предпочтительные ходы

Если есть сомнение, предпочитать:

- explicit snapshot boundaries
- explicit coarse actions
- diagnosis, отделённую от mutation
- strict operator classification
- удаление stale ballast
- более узкие payloads и verbs

## Review bar

Любой lifecycle/runtime/read-side/operator change должен уметь ответить:

1. Что стало проще?
2. Что удалено или локализовано?
3. Не появился ли второй source of truth?
4. Не превратился ли plain verb в super-verb?
5. Может ли оператор объяснить результат проще, чем раньше?

Если ответы слабые, change, скорее всего, не соответствует этому контракту.
