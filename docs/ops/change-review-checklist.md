# Чеклист change/review

Используй этот чеклист для любого change в `agents-arena`, который трогает:

- lifecycle
- runtime
- preview
- loop support
- read-side truth
- operator tooling

Это execution/review companion к:

- [system-simplicity-contract.md](docs/contracts/system-simplicity-contract.md)
- [project-runtime-preview-business-contract.md](docs/contracts/project-runtime-preview-business-contract.md)
- [project-lifecycle-operator-contract.md](docs/ops/project-lifecycle-operator-contract.md)
- [admin-laboratory-contract.md](docs/ops/admin-laboratory-contract.md)

## Обязательные вопросы

Перед тем как считать change готовым, нужно ответить на это прямо.

### 1. Какой здесь canonical boundary?

Назови один boundary, который после change должен владеть truth.

Примеры:

- component tuple
- operator snapshot
- loop support projection
- runtime-intent lease row

Если ответ звучит как “ну, несколько мест вместе”, change уже, скорее всего, дрейфует.

### 2. Что мы удалили, схлопнули или локализовали?

Хороший change обычно не только добавляет, но и что-то сужает:

- dead field
- dead helper
- duplicate read path
- synthetic vocabulary
- fallback branch
- overly broad verb

Если change только добавляет и добавляет, это подозрительно.

### 3. Не добавили ли мы новый noun, state или verb?

Если добавили, надо прямо объяснить, почему существующий контракт не мог взять это на себя.

Ожидание по умолчанию:

- reuse или сужение существующих concepts

### 4. Не создали ли мы второй source of truth?

Проверять особенно вот это:

- project row vs component row
- UI-local truth vs snapshot truth
- history fields vs live state
- recovery sidecar vs core lifecycle
- source snapshot vs loop execution truth при переносе/копировании live project
- instruction mirrors: канонические операционные правила должны жить одинаково в `AGENTS.md`/`CLAUDE.md` (Claude) и `docs/codex-native-repo-operating-slice.md` (Codex). Менял операционное правило — обнови оба зеркала; дрейф ловит `node scripts/check-instruction-system-maintenance.mjs` (Stop-hook у обоих агентов).

Если да, change надо переделывать.

Если change переносит existing project на новый runtime/spec contract, нужно явно ответить:
переносим/реконструируем plan/status truth или сознательно сбрасываем project в clean-slate?
Молчаливый reset execution truth поверх готового repo — это дефект миграции, не нормальный fresh start.

### 5. Не расширили ли мы plain action?

Проверь, не стал ли простой action тайно значить больше одного действия.

Опасные примеры:

- restart + migrate
- toggle + repair
- diagnosis + mutation
- preview restore + loop launch без явного split

Если да, path надо разделять.

### 6. Не добавили ли мы hidden fallback или compatibility ballast?

По умолчанию reject для change, который добавляет:

- silent fallback
- optimistic no-op behavior
- hidden auto-heal
- dual vocabulary
- long-lived alias

Compatibility допустима только если она явно локализована на boundary.

### 7. Read-side всё ещё читает одну truth?

Проверь, что UI/tools не собирают truth вручную из смешанных источников.

Красные флаги:

- `components[0]`
- hand-built loop gate в page/component
- отдельные project/component/support reads, склеенные ad hoc

### 8. Может ли оператор просто объяснить новое состояние?

Operator answer должен укладываться в форму:

- `truth`
- `classification`
- `why`
- `allowed actions`

Если объяснение теперь требует caveats, exceptions или historical lore, система, скорее всего, стала хуже.

### 9. Operator tools остались полезными?

Если change касается live operations, read-side truth или lifecycle/debug boundary, проверь:

- `arena-ctl project_explain` / `fleet_summary` всё ещё дают честный первый ответ
- новый факт не требует постоянного raw DB / Docker / Git обхода
- если raw обход теперь нужен регулярно, есть явный follow-up: добавить поле/tool, сузить tool или удалить устаревший surface

Нельзя оставлять tool как legacy UI/API, которым операторы перестали пользоваться из-за рассинхрона.

### 10. Exact accepted requirements не ослаблены?

Если change касается accepted spec/diff/source evidence, проверь:

- точные библиотеки, фреймворки, design systems, CLI, providers и integrations
  сохранены как exact requirements;
- визуальные референсы, assets, files, behaviors и removal/absence требования
  не превращены в более удобную частичную трактовку;
- нет закрытия через `compatible`, `style`, `inspired`, mock, local-only или
  narrow substitute, если accepted diff сам явно не расслабил требование;
- если текущий код/стек конфликтует с exact requirement, это оформлено как
  implementable work, real blocker или explicit product/spec judgment, а не
  локальное решение исполнителя.

## Smells, которые надо reject-ить по умолчанию

Вот это должно проваливать review, если нет очень сильной и явной причины:

- новые persisted lifecycle states
- новые mirrored runtime fields
- новые local mini-state-machines
- новые synthetic history или status labels
- array-order lifecycle truth
- history fields, используемые как live scheduler
- diagnosis payloads с декоративным ballast
- plain actions, которые тихо мутируют config/runtime family
- local substitute вместо exact accepted requirement
- Lab UI, который снова заставляет оператора собирать raw stage command до
  выбора понятного действия над текущим project/repository state
- product/UX Lab labels, которые выглядят как runnable provider pass без
  отдельного code-owned owner

## Минимальная closeout-note

Каждый существенный change в этой зоне должен оставлять короткую note:

- какой boundary затронут
- какой у change contract effect
- что удалено или сужено
- какая verification доказывает, что старый path действительно ушёл
