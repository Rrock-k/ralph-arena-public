# Worker-Service Maintenance Contract

Этот документ фиксирует `RA-269` как contract для maintenance самого `worker-agent` service, а не project runtime rows.

## Зачем это существует

`worker_sha_mismatch` и `runner_sha_mismatch` из `worker-agent /meta` описывают **worker-service generation drift**. Это worker-scoped maintenance truth, а не safe project-level trigger для `Recreate Runtime`.

## Ownership

- worker-service drift принадлежит worker host/service layer
- project lifecycle truth (`powerIntent`, `agentIntent`, `blockers`, `retryAt`, `lastOutcome`) остаётся project-owned
- worker maintenance не записывается в project `blockers[]`

## Shipped v1

Текущий shipped slice intentional narrow:

- operator truth про stale worker service уже поднята в fleet/read-side
- manual-first maintenance verb умеет просить **restart live worker service**
  через admin ctl и `arena-ctl worker_restart_service`
- restart разрешён только в safe window:
  - на worker нет active `RUNNING / RUNNING` rows

## Safe window

Worker restart сейчас допускается только если на этом worker нет working agent loop.

Допустимые cohorts во время worker maintenance:

- blocked waiting preview
- retained preview
- `Agent OFF`
- пустой host

Недопустимый cohort:

- active `RUNNING / RUNNING`

## What restart does

Worker-service restart:

- перезапускает сам `worker-agent` process
- обновляет live `/meta` truth этого worker service
- временно снимает host control-plane на этом worker

Worker restart не должен:

- мутировать project rows
- массово чистить blockers
- делать hidden relaunch
- делать per-project `Recreate Runtime`

## Local vs VPS

- local worker restart живёт на compose service restart policy
- VPS worker restart живёт на systemd restart policy

Обе среды сходятся через один worker-level self-restart verb; не нужен отдельный project-level substitute вроде host reboot или `Recreate Runtime`.

## Important split

`build worker` и `restart worker service` — это разные вещи:

- `build worker` обновляет worker image truth
- worker-service restart обновляет live `worker-agent` process truth

Один шаг не должен маскироваться под другой.

## Browser verification readiness

Browser verification infrastructure belongs to the worker image/platform, not to
project workspaces.

For the bundled Ralph runtime:

- `Dockerfile.worker` installs Playwright OS dependencies as root.
- `Dockerfile.worker` installs the Playwright-managed Chromium browser as user
  `node` under `PLAYWRIGHT_BROWSERS_PATH=/home/node/.cache/ms-playwright`.
- `Dockerfile.worker` exposes that platform-owned browser through the stable
  project-local executable contract `CHROME_BIN=/usr/bin/chromium`.
- bundled Ralph browser checks and screenshot capture use `CHROME_BIN` when it
  is present; when the platform has not set an explicit executable, they use
  the Playwright-managed browser path.
- project executors may install app/runtime dependencies, but must not install
  Chromium, Chrome, Playwright browser downloads, `npx playwright install`,
  `playwright install-deps`, or equivalent browser verification infra inside the
  project workspace.
- if Playwright/browser verification cannot run because the platform browser is
  missing or its OS dependencies are unavailable, the honest evidence is
  `INFRA_BROWSER_UNAVAILABLE`; it is not a project bug and not a reason for an
  ad hoc workspace install.

## Future expansion

Automation/wave поверх этого допускается позже, но только как worker-owned maintenance lane.

До этого `RA-269` остаётся manual-first.
