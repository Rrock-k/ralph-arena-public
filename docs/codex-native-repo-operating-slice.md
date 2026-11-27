# Codex Repo Operating Contract

This is the short Codex-visible operating contract for this repo.

## Canonical rules

- `arena.example.test` is production. Local source changes do not reach live users
  just because files changed or tests passed; live effect requires an explicit
  build/deploy/restart/promotion path and production evidence. HMR/dev mode is
  opt-in and is not live route truth.
- Use `./scripts/docker-local-stack.sh` for local stack and Docker operations.
- Access Postgres only through Docker, with `psql -U ralph -d ralph_arena`.
- Access governance/admin shell only through `docker exec agents-arena-governance-platform-1`.
- Prefer existing admin UI/API mechanisms before writing custom SQL or one-off scripts.
- After schema migrations or auth/runtime contract changes, run the smoke path: `launch -> claim -> status -> terminal state`.
- Auth is owned by `authd`. If OAuth/subscription tokens break, re-login inside `agents-arena-authd-1` with `claude auth login` or `codex login --device-auth`. Do not move refresh tokens into app containers.
- `refresh-tokens.sh` is a legacy fallback, not runtime source of truth.
- Codex subscription mode does not work on VPS; use API key mode there.
- Keep contracts strict and prefer evidence before treatment. Do not add extra defaults or workarounds unless they remove a real blocker.

## Detailed rules (shared with Claude — read the file when working in that area)

These are the single source of the detailed operating rules; both Claude and Codex
follow them (Claude auto-loads each by path; Codex must open the relevant file when
working in that area). Do not copy their content here — read the file.

- `.claude/rules/deployment.md` — Cloudflare tunnel, preview routing, arena-ctl, and the governance deploy model (prebuilt prod image, blue-green canary promote, not in-place bounce).
- `.claude/rules/docker-dev.md` — Docker dev model: bind-mount + hot-reload for `node:20-slim` services; governance is the exception (prebuilt prod image, rebuild-from-HEAD + canary deploy).
- `.claude/rules/governance-platform.md` — server actions (try/catch/finally), UI error policy, top-down debugging, Playwright.
- `.claude/rules/auth-tokens.md` — OAuth/subscription tokens, `authd` as source of truth, refresh constraints.
- `.claude/rules/prisma-safety.md` — `prisma migrate reset` destroys data; on drift use `prisma migrate resolve --applied`.
- `.claude/rules/arena-runner.md` — arena-runner: `plan.json`, lifecycle, implementation-agnostic design.

(The domain glossary is canonical in `docs/glossary.md` — see "Canonical docs" in AGENTS.md — so it is not relisted here.)
