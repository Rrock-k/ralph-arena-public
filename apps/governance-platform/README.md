# Governance Platform

Next.js app for Ralph Arena community governance: proposals, voting, admin operations, project launch flow, logs, budgets, secrets, VPS management, and internal APIs used by `worker-agent` / `arena-runner`.

## Scope

This directory contains the governance web app only.

Current runtime architecture lives in the monorepo:

- `apps/governance-platform/` — UI, auth, server actions, internal APIs
- `services/worker-agent/` — claims runtime intents from governance and starts/maintains preview containers
- `services/arena-runner/` — PID 1 inside each preview container
- `services/api-proxy/` — provider traffic accounting / budget enforcement
- `infra/caddy/` — local/prod preview routing

`governance-platform` is not a standalone deployment orchestrator anymore. Old `dispatcher` references are obsolete.

## Recommended Local Development

Use the repo-root stack wrapper, not raw `docker compose` from this folder.

From repo root:

```bash
./scripts/docker-local-stack.sh up -d postgres governance-platform api-proxy worker-agent caddy
```

Then open `http://localhost:3000`.

The wrapper:

- loads env from repo + governance dotenv files
- creates `arena-public-network` if missing
- builds `arena-public-worker:local` if missing
- keeps local service names aligned with the rest of the monorepo

If you want the full local stack instead of only governance-related services:

```bash
./scripts/docker-local-stack.sh up -d
```

## Local Production / Devprod Runtime

The public devprod governance path runs through the root local stack, not a
host `npm run dev` process:

```text
cloudflared governance-tunnel -> local Caddy -> governance-platform:3000
```

`governance-platform` defaults to the production image managed by
`./scripts/docker-local-stack.sh build governance-image` and
`./scripts/docker-local-stack.sh up`. HMR/dev mode remains an explicit
app-only workflow; it is not the runtime for `https://app.arena.example.test`.

For RA-344 rollout checks, use the root wrapper canary/switch helpers and
readiness/route probes documented in `../../docs/local-docker-stack.md`.
`apps/governance-platform/public/short-html` is deliberately served directly by
local Caddy at `/short-html/*`; files there become public through the current
cloudflared path without rebuilding the governance image.

## Minimal Env

For the local Docker/devprod stack, root `.env.local` is the preferred owner for platform secrets and shared runtime config. Compose owns the container `DATABASE_URL`; keep `apps/governance-platform/.env.local` for direct Next.js/app-only overrides only.

Set at least:

```env
NEXTAUTH_SECRET="..."
NEXTAUTH_URL="http://localhost:3000"
AUTH_URL="http://localhost:3000"
GOOGLE_CLIENT_ID="..."
GOOGLE_CLIENT_SECRET="..."
ADMIN_EMAILS="you@example.com"
```

For direct app-only runs, set an app-local `DATABASE_URL` that points at the target database.

Useful extras when exercising real run flow:

```env
GITHUB_TOKEN="..."
RUNNER_GIT_TRANSPORT="https"
RUNNER_WEBHOOK_SECRET="..."
API_PROXY_URL="http://localhost:4100"
PLAYWRIGHT_DATABASE_URL="postgresql://ralph:ralph@localhost:5434/ralph_arena_e2e"
```

See also:

- `../../AGENTS.md`
- `../../docs/auth-tokens.md`

## Auth

Authentication uses NextAuth v5 beta with Google and optional Telegram OIDC providers.

Local Google OAuth redirect URI:

```text
http://localhost:3000/api/auth/callback/google
```

Local Telegram OIDC redirect URI:

```text
http://localhost:3000/api/auth/callback/telegram
```

If you change the port, update both:

- `NEXTAUTH_URL`
- `AUTH_URL`

and the matching provider redirect URI.

Admin access is derived from `ADMIN_EMAILS` and `ADMIN_TELEGRAM_USER_IDS` on sign-in.

## Current Lifecycle Model

Lifecycle model is RA-237 / RA-247, not a single stored `Project.status` flow:

- `Project` owns identity and archive state, mainly `archivedAt`.
- Primary `ProjectComponent` owns app/runtime axes: `powerIntent`, `runtimeState`, `previewHealth`.
- Primary `ProjectComponent` owns agent axes: `agentIntent`, `agentState`, `lastOutcome`, `blockers`.
- User stop/start is `agentIntent`, not a `MANUAL` blocker.
- `RunLog` is append-only audit history, not live lifecycle truth.

See `../../docs/ops/project-lifecycle-operator-contract.md` for operator language.

## Runtime Flow

```text
Admin action in governance
  -> project/component truth changes
  -> governance creates or derives a runtime intent
  -> worker-agent polls /api/internal/runtime-intents/claim
  -> worker-agent starts or reconciles preview container
  -> arena-runner inside container polls governance init/status/specs
  -> governance receives logs/progress/terminal state
```

Important compatibility rule:

- when changing internal API fields, headers, or endpoints, keep fallback handling in governance for older runners/workers

## Scripts

Inside `apps/governance-platform/` these package scripts exist. For normal local/devprod work, run them through the Docker stack wrapper instead of on the host.

```bash
npm run dev
npm run build
npm run start
npm run lint
npm run test
npm run test:e2e
npm run db:generate
npm run db:migrate
npm run db:deploy
npm run db:push
npm run db:studio
```

Useful repo-root helpers:

```bash
./scripts/docker-local-stack.sh up -d
./scripts/docker-local-stack.sh down
./scripts/docker-local-stack.sh logs -f --tail=100 governance-platform
```

## App-Only Mode

This directory still has its own `Dockerfile` and `docker-compose.yml`, but that setup is app-only:

- Next.js app
- local Postgres

It does not include:

- `worker-agent`
- `arena-runner`
- `api-proxy`
- preview routing via root local stack

Use it only for isolated smoke/prod-like app checks. For real local Arena development, prefer the repo-root stack wrapper.

## Testing

Unit tests:

```bash
npm run test
```

Playwright:

```bash
npm run test:e2e
```

Rules:

- always use a dedicated e2e DB via `PLAYWRIGHT_DATABASE_URL`
- do not point Playwright at the main dev DB

## Troubleshooting

### Google sign-in fails

Check:

- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`
- `NEXTAUTH_URL` and `AUTH_URL` match the actual browser URL exactly
- Google redirect URI matches exactly
- `NEXTAUTH_SECRET` is set

### Can't reach database

From repo root:

```bash
./scripts/docker-local-stack.sh up -d postgres
```

Then verify `DATABASE_URL` and run:

```bash
./scripts/docker-local-stack.sh exec governance-platform sh -c 'cd apps/governance-platform && npx prisma generate'
./scripts/docker-local-stack.sh exec governance-platform sh -c 'cd apps/governance-platform && npx prisma migrate dev'
```

### Local services disagree with each other

Prefer restarting through the root wrapper:

```bash
./scripts/docker-local-stack.sh restart governance-platform
./scripts/docker-local-stack.sh restart worker-agent
./scripts/docker-local-stack.sh restart api-proxy
```

### Prisma/client drift after schema changes

Run migration inside the governance container when using the local Docker stack:

```bash
./scripts/docker-local-stack.sh exec governance-platform sh -c 'cd apps/governance-platform && npx prisma migrate dev'
./scripts/docker-local-stack.sh restart governance-platform
```

## File Pointers

- `src/app/actions/` — server actions
- `src/app/api/` — public + internal API routes
- `src/lib/auth.ts` — NextAuth config
- `src/lib/token-manager.ts` — token refresh / auth materialization
- `src/lib/vps/` — VPS/cloud-init logic
- `src/components/admin/` — admin UI
- `prisma/schema.prisma` — source of truth for data model

## Related Docs

- `../../AGENTS.md`
- `../../docs/auth-tokens.md`
- `../../docs/local-docker-stack.md`
- `../../docs/backlog/ralph-arena.md`
