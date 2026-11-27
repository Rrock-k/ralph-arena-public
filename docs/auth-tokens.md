# Аутентификация агентов: текущий local runtime contract

## Коротко

Для локального стека есть два auth path:

- `Claude OAuth` и `Codex subscription`
  runtime source of truth = `authd`
- `Claude API key` и `OpenAI API key`
  runtime source of truth = `TokenManager`

`refresh-tokens.sh` больше не является runtime source of truth для OAuth/subscription. Это только host-side bootstrap/diagnostics helper.

## Runtime truth

### OAuth / subscription

`authd`:

- хранит native provider session state в persistent `/home/node`
- проверяет provider health по provider-owned локальному state
- умеет делать provider refresh
- выдаёт versioned run-auth snapshot

Native files:

- Claude: `~/.claude/.credentials.json`
- Codex: `~/.codex/auth.json`

### API key mode

API-key runtime auth по-прежнему идёт через `TokenManager`.

## Governance / runner contract

Для `Claude OAuth` и `Codex subscription` governance ведёт себя так:

- `claim` запрашивает fresh auth snapshot у `authd`
- `status` отдаёт `auth` + `authVersion`
- `status?refreshAuth=1` принудительно запрашивает новый snapshot у `authd`
- если `authd` недоступен, governance возвращает `503`

`arena-runner` работает по versioned snapshot model:

1. child падает по auth-path
2. runner вызывает `GET /status?refreshAuth=1`
3. governance при необходимости минтит новый snapshot через `authd`
4. если `authVersion` изменилась, runner делает immediate respawn child process
5. если snapshot не изменился и auth всё ещё мёртв, это настоящий `PAUSED_API`

Следствие:

- stale auth не должен маскировать обычное падение агента под `auth_expired`
- для Claude не нужна опора на overlap между старым и новым access token
- Codex health не использует `chatgpt.com/backend-api/wham/usage` как
  canonical validator; он читает локальный `auth.json`, безопасно показывает
  `accessTokenExpiresAt` / `lastRefresh`, а fresh runtime auth проходит через
  `authd` refresh.

## Практическая диагностика

Проверить `authd`:

```bash
curl -sS http://localhost:4311/health | jq
```

Получить готовый operator digest для Codex re-login reminder:

```bash
services/arena-ctl/cli.sh authd_operator_digest --provider codex
```

Эта команда read-only: она читает sanitized `authd` health через governance,
не делает refresh/login, не минтит runtime auth, не пишет automation memory и
не отправляет Telegram. Delivery layer должен только доставить готовый digest:
если нужен Telegram reminder, его automation memory подключается в
`ARENA_BOT_DIGEST_SOURCE_FILES` как обычный source-owned `Operator digest`,
без authd-логики внутри `arena-bot`.

Проверить login внутри `authd`:

```bash
docker exec -it agents-arena-authd-1 sh
claude auth status --json
codex login status
```

Перелогинить Codex subscription внутри headless `authd`:

```bash
docker exec -it agents-arena-authd-1 codex login --device-auth
```

Plain `codex login` на хосте не является runtime repair для local stack.
Для `authd` canonical command is `codex login --device-auth`.

Проверить, что governance реально использует `authd`:

```bash
docker exec agents-arena-governance-platform-1 sh -lc 'echo "$AUTHD_URL"'
```

Проверить live project:

```bash
curl -sS \
  -H 'x-arena-admin-secret: <secret>' \
  'http://localhost:3000/api/admin/ctl/projects/<projectId>/health?tail=80' | jq
```

## Related docs

- [docs/local-docker-stack.md](docs/local-docker-stack.md)
- [services/authd/README.md](services/authd/README.md)

## Что больше не считать правдой

- Governance читает runtime OAuth/subscription auth напрямую из `.env.local`
- `TokenManager` — единый runtime source of truth для всех auth modes
- mid-run auth recovery зависит от того, что child сам подхватит новый env
- Codex subscription runtime живёт только через `CODEX_AUTH_JSON` из `.env.local`

## История

Если нужен spike/history context по `RA-208`, см. `work/plans/ra-208-authd-oauth-spike/README.md`.
