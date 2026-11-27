# Карта структуры Ralph Arena

Это поддерживаемая repo-side блок-схема для `agents-arena`.

Файл нужен как навигационная карта для агентов и операторов. Это не новый
источник истины. Если карта расходится с кодом или каноническим контрактом,
правда за кодом/контрактом, а этот файл нужно обновить.

Внешние диаграммы, включая Miro-доску через MCP, могут зеркалить этот файл.
Они не должны становиться владельцем runtime, product, lifecycle или operator
truth.

## Контракт

- Канонические платформенные контракты живут в `docs/contracts/` и `docs/ops/`.
- Каноническая ownership-карта кода живет в `apps/`, `services/` и `packages/`.
- Эта карта только называет boundary, потоки и точки операторской проверки.
- Не добавляй сюда states, fallback paths, lifecycle vocabulary или product
  semantics, которых нет в канонических контрактах.

## Search hygiene

При repo-wide поиске отделяй current truth от snapshots:

- current surfaces: `AGENTS.md`, `CLAUDE.md`, `.codex/**`, `.claude/**`,
  `docs/**`, `apps/**`, `services/**`, `packages/**`, `scripts/**`;
- historical/work surfaces: `docs/backlog/**`, `work/**`;
- ignored runtime/build snapshots: `.claude/worktrees/**`, `runtime/**`,
  `node_modules/**`, `.next/**`, `dist/**`, `build/**`, `coverage/**`.

Если finding найден только в ignored snapshot, не переносить его в вывод как
актуальный drift без live evidence из current surfaces.

## Верхнеуровневые плоскости

```mermaid
flowchart LR
  user["Пользователь / менеджер / админ"]
  tg["tg-spec / Telegram"]
  github["GitHub repos"]
  providers["LLM провайдеры"]

  governance["apps/governance-platform<br/>UI, auth, админка, internal APIs"]
  postgres[("Postgres<br/>Project, ProjectComponent,<br/>SpecVersion, RunLog")]
  authd["services/authd<br/>источник auth для Claude OAuth<br/>и Codex subscription"]
  proxy["services/api-proxy<br/>считает usage и держит budget"]
  worker["services/worker-agent<br/>берёт runtime intents<br/>и управляет containers"]
  caddy["Caddy / preview router"]

  subgraph preview["Preview container"]
    runner["services/arena-runner<br/>PID 1 внутри preview:<br/>workspace, status, spec, auth"]
    workspace["/workspace<br/>код проекта + .arena channel"]
    loop["@arena/ralph-runtime<br/>встроенный Ralph loop"]
    cli["Agent CLI<br/>claude-code / codex / другие tools"]
    app["Project app preview<br/>то, что смотрит пользователь"]
  end

  tg -->|"импорт спека / feedback"| governance
  user -->|"действия в UI / admin"| governance
  governance <--> postgres
  governance -->|"auth snapshot для runtime"| authd
  governance -->|"provider traffic policy"| proxy
  proxy --> providers
  governance -->|"runtime-intents claim/status"| worker
  worker -->|"docker run / stop"| runner
  runner <--> governance
  runner <--> workspace
  runner --> loop
  loop --> cli
  cli --> providers
  workspace --> app
  app --> caddy
  caddy --> user
  worker --> github
```

## Runtime claim flow

```mermaid
flowchart TD
  adminAction["Governance UI / API<br/>пользователь просит:<br/>launch, App ON, Agent ON,<br/>relaunch или maintenance"]
  writeIntent["governance-platform<br/>записывает желание проекта<br/>в Project / ProjectComponent"]
  dbIntent[("Postgres<br/>intent + текущая component truth")]
  claim["worker-agent<br/>забирает runtime intent"]
  auth["authd<br/>даёт auth snapshot,<br/>если он нужен"]
  payload["governance-platform<br/>отдаёт worker'у задачу<br/>и runtime payload"]
  start["worker-agent<br/>стартует или reconcile<br/>preview container"]
  runner["arena-runner<br/>читает init/status/specs,<br/>secrets и auth refresh"]
  loop["Ralph runtime / agent CLI<br/>поднимает preview<br/>или работает агентом"]
  terminal["arena-runner<br/>передаёт logs, progress<br/>и terminal state"]
  persist["governance-platform<br/>пишет RunLog<br/>и runtime observation"]

  adminAction --> writeIntent
  writeIntent --> dbIntent
  claim --> payload
  payload --> auth
  auth --> payload
  payload --> start
  start --> runner
  start -->|"started + runtime observation"| persist
  runner --> loop
  loop -->|"logs / progress / terminal result"| terminal
  terminal --> persist
  persist --> dbIntent
```

## Product truth flow

```mermaid
flowchart LR
  tgSpec["tg-spec<br/>принятый spec + feedback<br/>как structured artifact"]
  importRoute["governance import route<br/>внутренний tg-spec API"]
  specVersion["SpecVersion.acceptedArtifact<br/>AcceptedSpecArtifact"]
  runnerManifest[".arena/spec-input.json<br/>handoff file от runner"]
  ralph["Ralph runtime<br/>planner, executor, controller"]
  plan[".ralph/plan.json<br/>память loop execution"]
  status["Governance status/progress<br/>RunLog + component state"]
  snapshot["ProjectInteractionSnapshot<br/>простая read projection<br/>для manager UI"]

  tgSpec --> importRoute
  importRoute --> specVersion
  specVersion --> runnerManifest
  runnerManifest --> ralph
  ralph --> plan
  ralph --> status
  specVersion --> snapshot
  status --> snapshot
```

Важные ownership-заметки:

- `AcceptedSpecArtifact` — product truth для accepted spec, accepted diff,
  feedback, assumptions, safe secret refs и asset refs.
- `.ralph/plan.json` — loop execution memory, не публичная product truth.
- `ProjectInteractionSnapshot` — read-side projection для product surfaces,
  не отдельное product-хранилище.
- `RunLog`, prompt traces, Langfuse mirrors и maintenance runs — telemetry или
  evidence. Они не lifecycle owners.

## Карта операторских поверхностей

```mermaid
flowchart TD
  operator["Оператор"]
  admin["Admin UI<br/>основная operator surface"]
  adminCtl["/api/admin/ctl/*<br/>internal admin API"]
  arenaCtl["services/arena-ctl<br/>local-only MCP для оператора"]
  jobs["Jobs / maintenance runs<br/>evidence по maintenance"]
  taskBoard["apps/task-board<br/>UI для backlog"]
  backlog["docs/backlog/ralph-arena.md<br/>docs/backlog/task-manager.md"]
  plans["work/plans/*<br/>планы, action logs, evidence"]
  contracts["docs/contracts + docs/ops<br/>текущие правила системы"]

  operator --> admin
  operator --> arenaCtl
  arenaCtl --> adminCtl
  admin --> adminCtl
  admin --> jobs
  taskBoard --> backlog
  backlog --> plans
  plans --> contracts
  contracts --> admin
```

Операторские правила:

- Начинай lifecycle/runtime диагностику с admin UI/API или `arena-ctl`, а не с
  raw SQL или one-off scripts.
- Используй `project_explain` и `fleet_summary`, когда вопрос про project или
  fleet truth.
- Если повторяющийся операторский вопрос требует raw inspection, добавь или
  сузь явный operator tool вместо того, чтобы полагаться на эту карту.

## Быстрая карта ownership в репе

| Path | Владеет | Не владеет |
|---|---|---|
| `apps/governance-platform/` | UI, auth, admin actions, internal APIs, project/spec/component persistence | Direct Docker runtime execution |
| `services/worker-agent/` | Runtime-intent claims, Docker preview container start/stop/reconcile | Product/spec interpretation |
| `services/arena-runner/` | Preview container PID 1, workspace prep, status/spec/auth sync, loop command launch | Ralph-specific planning logic |
| `services/api-proxy/` | Provider proxying, usage accounting, budget enforcement | Auth source of truth |
| `services/authd/` | Local Claude OAuth and Codex subscription runtime auth authority | Project secrets или API-key policy |
| `services/arena-ctl/` | Local-only operator MCP/admin tools over governance truth | Public API или alternate lifecycle owner |
| `packages/contracts/` | Shared strict schemas, включая `AcceptedSpecArtifact` | UI-local projections |
| `packages/loops/ralph-runtime/` | Bundled first-party loop runtime and prompt/agent logic | Governance lifecycle truth |
| `apps/task-board/` | Backlog UI over markdown backlog files | Runtime status |
| `apps/a2e-studio/` | A2E operator/test studio | Core lifecycle ownership |
| `docs/` | Current supported contracts and operator docs | Historical campaign logs |
| `work/` | Plans, audits, evidence, handoff logs | Current platform contract by default |

## Checklist обновления

Используй этот checklist, когда меняешь карту или зеркалишь её во внешнюю
диаграмму:

1. Перечитай релевантные contract docs перед правкой.
2. Проверь затронутые code paths через `rg` или прямое чтение source.
3. Держи этот файл projection от текущих code/contracts.
4. Обновляй diagrams и quick map вместе, если ownership boundary переехал.
5. Не добавляй diagram-only states, verbs, fields или fallback behavior.
6. Если репа изменилась, а карта нет, запиши причину в task log.

Минимальная проверка для docs-only edits:

```bash
./scripts/docker-local-stack.sh exec -T governance-platform npm run backlog:check
git diff --check
```
