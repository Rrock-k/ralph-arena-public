# Weekly instruction system maintenance

Это канонический weekly maintenance task для instruction surfaces Ralph Arena.
Он удерживает docs, корневые agent instructions, hooks, repo-owned skills и
accepted-artifact boundary с `tg-spec` связными, не создавая вторую
конституцию.

## Граница

- `docs/` остаётся поддерживаемой актуальной истиной.
- `work/` остаётся местом для планов, evidence и истории.
- `AGENTS.md`, `CLAUDE.md`, `.codex/**` и `.claude/**` являются instruction
  surfaces. Они могут ссылаться на канонические docs, но не должны
  переопределять platform truth.
- `tg-spec` владеет Telegram/spec-plane producer behavior. Arena потребляет
  только accepted artifacts через явные контракты.
- Задача read-only по умолчанию. Не мутировать production/runtime state, не
  удалять runtime residue, не запускать destructive cleanup и не коммитить
  изменения, если оператор явно не попросил fix.

## Частота

Запускать weekly. Codex automation является executor; этот файл является task
contract.

Если automation находит drift, она должна выдать короткий русский отчёт с
точными путями файлов, строками где возможно, severity и recommended owner.
Automation не должна тихо patch repo.

В конце того же automation run она должна сформировать финальную секцию
`Operator digest`. Это message-ready краткая выжимка из собственного отчёта,
а не отдельный summarizer, второй бот или последующая интерпретация. Если
digest доставляется в Telegram/chat, delivery layer должен отправлять текст
этой секции, а не пересказывать run заново.

## Проверки

### 1. Instruction drift

Цель: retired executable instructions не должны возвращаться в current docs,
hooks или skills.

Проверить current instruction surfaces на:

- удалённые lifecycle fields: `desiredRuntime`, `actualRuntime`, `implState`;
- retired loop terminal marker: `.arena/done`;
- operator-facing `latest` language для baked agent CLI image versions;
- semantic drift между root `AGENTS.md` / `CLAUDE.md`.

Разрешённые historical zones:

- `docs/backlog/**`;
- `work/**`;
- committed historical notes, если они явно не current instructions.

Рекомендуемые команды:

```bash
node scripts/check-instruction-system-maintenance.mjs
rg -n --glob '!docs/backlog/**' --glob '!work/**' --glob '!.claude/worktrees/**' --glob '!docs/glossary.md' --glob '!docs/ops/weekly-instruction-system-maintenance.md' 'desiredRuntime|actualRuntime|implState|\.arena/done' AGENTS.md CLAUDE.md docs .codex .claude
rg -n --glob '!docs/backlog/**' --glob '!work/**' --glob '!.claude/worktrees/**' 'latest' AGENTS.md CLAUDE.md docs .codex .claude services/worker-agent scripts
cmp -s AGENTS.md CLAUDE.md
```

Ожидаемый результат:

- ни одна current instruction не говорит оператору или агенту использовать
  retired lifecycle fields;
- ни один current loop authoring doc не говорит, что `.arena/done` является
  completion contract;
- если root `AGENTS.md` и `CLAUDE.md` различаются, отличие intentional и
  объяснено.

### 2. Cross-repo accepted artifact check

Цель: Arena и `tg-spec` держат один accepted-artifact contract и не возвращают
copied schemas или proposal-first handoff paths.

Запустить:

```bash
node scripts/check-accepted-spec-artifact-contract.mjs --verbose
```

Если sibling repo доступен, также проверить:

- `/path/to/user/Desktop/repo/tg-spec/AGENTS.md`;
- `/path/to/user/Desktop/repo/tg-spec/CLAUDE.md`;
- `/path/to/user/Desktop/repo/tg-spec/.codex/**`;
- `/path/to/user/Desktop/repo/tg-spec/.claude/**`;
- `tg-spec` package references to `@arena/contracts`.

Ожидаемый результат:

- `tg-spec` передаёт только accepted artifacts;
- copied accepted-artifact schema/validator bridge не возвращается;
- drafts, inbox state, bindings и vote state остаются на стороне `tg-spec`.

### 3. Docs/work placement check

Цель: current truth остаётся в `docs/`; audits, plans и run evidence остаются в
`work/`.

Проверить current-truth violations:

```bash
find docs \( -path 'docs/plans/*' -o -path 'docs/audit/*' -o -path 'docs/history/*' \) -type f
```

Ожидаемый результат:

- новый plan, audit или history bundle не попадает под `docs/`;
- любое remaining exception явно названо и имеет promotion/move owner;
- новые canonical docs отвечают на вопрос "как система работает сейчас" или
  "что операторы могут делать сейчас".

### 4. Hook parity check

Цель: Codex и Claude могут иметь разные UX-specific hooks, но mandatory
guardrails не должны drift silently.

Сравнивать categories, не exact JSON:

- env contract check;
- backlog format check;
- accepted spec artifact check;
- instruction system maintenance check;
- command policy for host DB/npm/docker-danger paths;
- destructive or migration backup policy;
- allowed per-agent differences such as UI noise, file tracking and local
  browser guidance.

Рекомендуемые файлы:

- `.codex/hooks.json`;
- `.codex/scripts/**`;
- `.claude/settings.json`;
- `.claude/hooks/**`.

Ожидаемый результат:

- любой mandatory guardrail, который есть для одной agent surface, либо есть
  для другой surface, либо явно задокументирован как allowed asymmetry;
- shared logic по возможности живёт в scripts, а не в duplicated policy prose.
- parity categories и allowed asymmetry соответствуют
  [agent-hook-contract.md](docs/ops/agent-hook-contract.md).

### 5. RA-263 lesson promotion check

Цель: recurring lessons from live operations не должны навсегда оставаться
только в `work/` логах и при этом не должны раздувать root instructions.

Проверить:

- `work/plans/ra-263-live-project-operations/operations-log.md` на свежие
  `Tool gap`, `Operator gap`, `Follow-up`, `System gap`, `Contract gap`;
- каждый повторяемый gap должен иметь один owner:
  `arena-ctl` tool/backlog, current `docs/ops`, Ralph/runtime contract или
  явно historical/no-action;
- Codex-only или Claude-only skill не должен быть единственным current owner
  для universal operator lessons;
- raw DB / Docker / Git / curl steps не должны превращаться в default runbook
  без tool/backlog decision.

Ожидаемый результат:

- stable rule promoted into current docs or runtime contract;
- implementable tool/hook/test debt has a backlog task;
- one-off forensic notes remain historical work evidence.

## Базовая проверка

Всегда запускать:

```bash
node scripts/check-env-contract.mjs
node scripts/check-backlog-format.mjs --verbose
node scripts/check-accepted-spec-artifact-contract.mjs --verbose
node scripts/check-instruction-system-maintenance.mjs
git diff --check
```

Если check падает из-за unrelated dirty scope, явно сказать об этом и не
заявлять, что weekly task прошёл.

## Формат вывода

Automation output должен быть на русском и коротким:

- status: `clean`, `needs attention` или `blocked`;
- запущенные commands и pass/fail;
- P0/P1 findings с точными file paths и line numbers, где возможно;
- нужен ли follow-up backlog task или direct fix;
- unrelated dirty scope, если он влияет на confidence.

Финальная секция `Operator digest` обязательна:

- генерируется той же automation до завершения run;
- 3-5 строк, готовых к отправке оператору;
- включает status, P0/P1 только если есть, next owner/action и confidence
  impact от unrelated dirty scope;
- не добавляет фактов или трактовок, которых нет в основном отчёте;
- не перечисляет все команды, кроме failed command, который объясняет status.
