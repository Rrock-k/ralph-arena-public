# Env and Secrets Contract

This contract owns platform env placement. It does not replace the security redesign in `RA-184`; it makes the current MVP layout explicit and checkable.

## Boundary

The canonical local production Docker boundary is the root dotenv set loaded by `scripts/docker-local-stack.sh`:

1. `.env`
2. `.env.local`
3. `apps/governance-platform/.env`
4. `apps/governance-platform/.env.local`

Loading is no-override. If the same key appears in more than one file, the earlier root value wins. For the local production Docker stack, root `.env.local` is the preferred source for platform secrets and shared runtime config. Governance app env files are for standalone governance/VPS or direct `next dev` runs.

## Rules

- `NEXT_PUBLIC_*` is browser-visible. It may contain public identifiers, never tokens.
- Platform secrets do not belong in `ProjectSecret`. `ProjectSecret` is for project/app runtime env only.
- Project-required keys such as `TELEGRAM_BOT_TOKEN` are project runtime secrets. They should be stored through the encrypted `ProjectSecret` lifecycle, not copied into platform auth env.
- Provider subscription auth is owned by `authd`; host token-refresh scripts are legacy fallback.
- Antigravity CLI subscription auth is materialized only through the
  authd-owned Linux keyring home. Live RA-313 proof showed `agy` OAuth is
  reusable across fresh worker containers when the same headless Secret Service
  home is mounted and unlocked. Do not copy host GUI profile files or ask for
  per-run OAuth codes.
- Compose must explicitly pass root-owned governance keys into `governance-platform`; relying on hidden Next dotenv loading is not the local production Docker contract.
- Adding or renaming an env var requires updating this contract, `.env.example`, the relevant app/service `.env.example`, compose wiring when the variable must enter a container, and `scripts/check-env-contract.mjs`.

## File Roles

| File | Role | Allowed content |
| --- | --- | --- |
| `.env.local` | Local production Docker operator source | Platform secrets, provider keys, auth modes, internal shared secrets, local runtime knobs |
| `.env` | Local machine defaults only | Non-committed machine settings; avoid secrets unless a tool explicitly requires this filename |
| `.env.example` | Local production Docker template | Every root-owned local stack key; safe defaults/placeholders only |
| `apps/governance-platform/.env` | Standalone/VPS governance runtime | Production governance values when systemd/VPS runs the app outside local compose |
| `apps/governance-platform/.env.local` | Direct Next local override | Keep comment-only on this production-serving machine; use root `.env.local` for local production Docker |
| `apps/governance-platform/.env.example` | Standalone governance template | Governance-only and production/VPS keys; safe defaults/placeholders only |
| `infra/vps/provision.env` | VPS provisioning operator input | SSH/deploy/provisioning settings, not app runtime secrets except deployment tool tokens |
| `ProjectSecret` rows | Project runtime secret store | Per-project app credentials materialized into `.env.arena-secrets` inside the project runtime |

## Current Owners

| Owner | Keys |
| --- | --- |
| Local stack auth modes | `CLAUDE_AUTH_MODE`, `CODEX_AUTH_MODE` |
| Provider/platform credential inputs | `CLAUDE_CODE_OAUTH_TOKEN`, `CLAUDE_CODE_OAUTH_REFRESH_TOKEN`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `CODEX_AUTH_JSON`, `OPENCODE_API_KEY` |
| Runtime run-auth material | Authd-minted `CLAUDE_CODE_OAUTH_TOKEN` and sanitized `CODEX_AUTH_JSON`, plus API-key mode keys. Refresh tokens and native provider homes are not runtime auth truth. |
| Reserved unsupported provider auth | `ANTIGRAVITY_AUTH_JSON` is scrubbed by runner auth handling but is not a supported authd credential; Antigravity uses authd-owned keyring volume materialization instead |
| Governance auth | `NEXTAUTH_SECRET`, `AUTH_SECRET`, `NEXTAUTH_URL`, `AUTH_URL`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `ADMIN_EMAILS`, `ADMIN_TELEGRAM_USER_IDS` |
| Governance public routing | `GOVERNANCE_PUBLIC_URL` |
| Governance rollout/readiness | `GOVERNANCE_BUILD_ID`, `GOVERNANCE_RELEASE_SHA`, `GOVERNANCE_SLOT_ID`, `GOVERNANCE_SCHEDULER_ROLE`, `GOVERNANCE_MIGRATION_STATUS` |
| Telegram OIDC auth | `TELEGRAM_OIDC_CLIENT_ID`, `TELEGRAM_OIDC_CLIENT_SECRET` |
| Telegram WebApp verification | `TELEGRAM_WEBAPP_BOT_ID` |
| Internal platform secrets | `SECRETS_ENCRYPTION_KEY`, `ARENA_ADMIN_SECRET`, `ARENA_PREVIEW_REFRESH_TOKEN`, `RUNNER_WEBHOOK_SECRET`, `AUTHD_SECRET`, `ARENA_PUSH_SECRET`, `CRON_SECRET`, `API_PROXY_SECRET` |
| Internal tg-spec bridge | `TG_SPEC_INTERNAL_BASE_URL` |
| Runner/local runtime | `RUNNER_MAX_CONCURRENT_RUNS`, `ARENA_PROJECT_DATA_ROOT`, `ARENA_PROJECT_ASSETS_ROOT`, `RUNNER_WORKER_MEMORY`, `RUNNER_WORKER_CPUS`, `PREVIEW_DOMAIN`, `RUNNER_GIT_TRANSPORT`, `RUNNER_GITHUB_OWNER`, `RUNNER_GITHUB_REPO_PREFIX`, `RUNNER_GITHUB_REPO_VISIBILITY`, `RUNNER_ALLOW_PLACEHOLDER_REPOS`, `AUTHD_ANTIGRAVITY_DOCKER_VOLUME` |
| Agent CLI image versions | `CODEX_CLI_VERSION`, `CLAUDE_CODE_CLI_VERSION`, `OPENCLAW_CLI_VERSION`, `OPENCODE_CLI_VERSION`, `ANTIGRAVITY_CLI_VERSION` |
| Prompt-call observability | `LANGFUSE_BASE_URL`, `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY` |
| Payments/notifications/analytics | `FREEMIUS_PRODUCT_ID`, `FREEMIUS_API_KEY`, `FREEMIUS_SECRET_KEY`, `FREEMIUS_PUBLIC_KEY`, `FREEMIUS_CHECKOUT_MODE`, `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `RESEND_WEBHOOK_SECRET`, `NEXT_PUBLIC_CF_BEACON_TOKEN` |
| Arena bot delivery | `ARENA_BOT_TELEGRAM_TOKEN`, `ARENA_BOT_TELEGRAM_CHAT_ID`, `ARENA_BOT_AUTOMATIONS_DIR`, `ARENA_BOT_DIGEST_SOURCE_FILES`, `ARENA_BOT_DIGEST_MAX_AGE_HOURS`, `ARENA_BOT_WEEKLY_DIGEST_AUTOMATION_DIR`, `ARENA_BOT_WEEKLY_DIGEST_POLL_INTERVAL_MS` |

`ARENA_PREVIEW_REFRESH_TOKEN` is an optional narrow governance credential for delegated `POST projects/:id/preview-refresh` calls. `ARENA_PREVIEW_REFRESH_PROJECT_IDS` is its comma-separated explicit project allowlist. When the token is empty, delegated preview refresh is disabled; neither key grants access to any other admin route or method.

`FREEMIUS_CHECKOUT_MODE` is the only payment-mode switch for Platform Credits
checkout. Allowed values are `live` and `sandbox`; an empty value means live
checkout. Sandbox checkout must be explicit and must not be inferred from
`NODE_ENV`: current local production governance runs as a production build while
being reachable by real users, and direct Next dev/HMR mode is opt-in rather
than live route truth.
| VPS provisioning | `VPS_*`, `HETZNER_*`, `CLOUDFLARED_*` |

`GOVERNANCE_SCHEDULER_ROLE` is the RA-344 scheduler ownership gate. Allowed
values are `active`, `standby` and `external`. Only `active` may run
governance in-process scheduled jobs. `standby` and `external` must report
scheduler disabled through `/api/readiness`; missing or unknown values keep
readiness `not_ready`.

`GOVERNANCE_BUILD_ID`, `GOVERNANCE_RELEASE_SHA`, `GOVERNANCE_SLOT_ID` and
`GOVERNANCE_MIGRATION_STATUS` are the RA-344 production-build readiness
markers. Local production Docker must pass them explicitly into
`governance-platform`; they are not inferred from Docker state, `.next`, Caddy
or project runtime containers. Missing build/slot/migration markers keep
`/api/readiness` `not_ready`.
The local stack wrapper supplies non-empty defaults for these markers when
`docker-local-stack.sh up`, `create` or `config` targets
`governance-platform`; operator-provided env still takes precedence. For
`up/create`, the wrapper first ensures the governance image source-revision
label matches committed `HEAD`, then defaults build/release markers from that
image revision. This prevents accidental marker-empty or artifact-mismatched
active starts, but canary/promotion evidence is still required before claiming
a specific release is live.

`OPENCODE_API_KEY` is an optional OpenCode Zen override. Current RA-317 live
proof shows the selected free Zen model path can run headlessly without this
key; paid or future OpenCode providers must not rely on that free-model
contract without a separate auth/policy slice.

## Telegram Auth

`TELEGRAM_OIDC_CLIENT_ID` and `TELEGRAM_OIDC_CLIENT_SECRET` are Arena platform auth credentials created in BotFather after switching the bot Login Widget settings to OpenID Connect.

There is no browser-facing Telegram login env. Arena renders its own login/link buttons and Auth.js performs the OIDC redirect/callback flow.

`TELEGRAM_WEBAPP_BOT_ID` is a non-secret server-side identifier for Telegram Mini App initData signature verification in the Project Interaction API. Arena verifies Telegram's Ed25519 `signature` with Telegram's public key and the configured bot id; it does not need the bot token for this embedded handoff path.

`GOVERNANCE_PUBLIC_URL` is the explicit public HTTPS Arena origin used to build project-owned Telegram Mini App preview entry URLs. It must not be inferred from `AUTH_URL` or `NEXTAUTH_URL`; when it is absent, runtime containers do not receive `ARENA_TELEGRAM_PREVIEW_URL`.

`TG_SPEC_INTERNAL_BASE_URL` is the server-side URL Arena uses to read and update tg-spec Telegram binding metadata. The call is still authenticated by `ARENA_PUSH_SECRET`; the URL itself is not a secret.

`TELEGRAM_BOT_TOKEN` remains a project runtime secret name for apps that need to call the Telegram Bot API. It must not be used as a fallback for Arena login verification. For project-owned Telegram Mini App preview entry, Arena may decrypt this project secret only to derive the non-secret bot id prefix used for Telegram's third-party Ed25519 `initData` signature verification. The token value itself must not be used for hash/HMAC validation, logged, exposed, or sent to Telegram/client surfaces.

## Arena Bot Delivery

`ARENA_BOT_TELEGRAM_TOKEN` and `ARENA_BOT_TELEGRAM_CHAT_ID` belong only to the
local `arena-bot` delivery container. They are platform/operator delivery
credentials for Arena-owned bot delivery modules. The first module sends the
weekly instruction automation's pre-authored `Operator digest`.

The digest delivery module reads configured Codex automation memory files and
sends only their latest `Operator digest` sections. It is source-agnostic:
producer logic stays in the automation, while the bot only extracts authored
digest sections. By default the local stack reads the legacy weekly instruction
digest at `/automation/memory.md` and the Codex authd re-login reminder at
`/automations/ralph-authd-relogin-reminder/memory.md`. Setting
`ARENA_BOT_DIGEST_SOURCE_FILES` switches delivery to one or more explicit
in-container memory files under the read-only `ARENA_BOT_AUTOMATIONS_DIR`
mount. `ARENA_BOT_DIGEST_MAX_AGE_HOURS` lets delivery skip dated automation
digests older than the configured window; `docker-local-stack.sh` defaults it
to 48 hours so old automation memory cannot be sent as fresh after a parser or
container restart. Delivery must not summarize reports again, interpret
auth/project truth itself or use the project runtime `TELEGRAM_BOT_TOKEN` name.

## Langfuse Prompt-Call Mirror

`LANGFUSE_BASE_URL`, `LANGFUSE_PUBLIC_KEY` and `LANGFUSE_SECRET_KEY` are optional Arena platform observability env vars. When all three are set, governance passes them into Ralph runtime launches and Ralph mirrors Prompt Calls to Langfuse. When any key is missing, the mirror is disabled.

PromptMap and Prompt Repository do not read from Langfuse. The local `.ralph/prompt-trace.jsonl` remains the mandatory Prompt Calls truth.

## Enforcement

Run:

```bash
node scripts/check-env-contract.mjs
```

Claude and Codex call `scripts/hook-env-contract.sh` on `Stop`. The hook is quiet on success and blocks only when the committed contract/template/compose wiring, checker registry, or ignored local env placement drifts. New env keys in examples or governance compose wiring must be registered in `scripts/check-env-contract.mjs`; unregistered keys are treated as contract drift.

For a one-time local cleanup, run:

```bash
node scripts/check-env-contract.mjs --fix-local
```

The fix mode writes a timestamped backup under `/private/tmp` and does not print secret values.
