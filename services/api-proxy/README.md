# API Proxy Service

RA-042 service for provider traffic accounting and budget enforcement.

## Role

Agent containers route LLM provider calls through this service via `ANTHROPIC_BASE_URL` / `OPENAI_BASE_URL`. The proxy parses usage, records `ApiUsage`, and enforces project budget before forwarding requests.

## Local Runtime

Use the repo root Docker wrapper for normal local/devprod work:

```bash
./scripts/docker-local-stack.sh up -d api-proxy
./scripts/docker-local-stack.sh logs -f --tail=100 api-proxy
```

The service listens on `API_PROXY_PORT` (`4100` by default) inside the local stack.

## API

- `GET /health` — health check and active run count.
- `POST /runs/{runId}/register` — register a run; requires `x-proxy-secret`.
- `POST /runs/{runId}/unregister` — unregister a run; requires `x-proxy-secret`.
- `/{anthropic|openai}/run/{runId}/...` — provider proxy endpoint used by agent CLIs.

## Key Files

- `src/index.ts` — HTTP server, management endpoints, auth.
- `src/proxy.ts` — request forwarding, streaming, usage recording.
- `src/usage-parser.ts` — token extraction from provider responses.
- `src/budget-check.ts` — budget enforcement against persisted `ProjectBudget.usedCreditsUsd`; no in-memory pending accumulator.
- `src/pricing.ts` — model pricing table; keep aligned with governance pricing.
- `src/run-registry.ts` — in-memory run to project mapping.
