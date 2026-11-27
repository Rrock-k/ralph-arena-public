# authd

`authd` is the `RA-208` local auth authority spike.

Current scope:

- standalone internal HTTP service;
- versioned `mint-run-auth` snapshots;
- provider health for Claude OAuth and Codex subscription auth;
- local docker-compose service for manual provider login;
- local `governance` wiring through `AUTHD_URL=http://authd:4311`.

## Native provider storage

`authd` now expects each CLI to own its native session state inside the container home:

- Claude OAuth credentials: `~/.claude/.credentials.json`
- Codex subscription auth: `~/.codex/auth.json`

Paths can be overridden with env vars:

- `AUTHD_CLAUDE_CREDENTIALS_PATH`
- `AUTHD_CODEX_AUTH_JSON_PATH`

## API

- `GET /health`
- `GET /providers`
- `GET /providers/:provider/health`
- `POST /providers/:provider/refresh`
- `POST /mint-run-auth`

Optional shared secret:

- set `AUTHD_SECRET`
- pass it as `x-authd-secret`

## Local commands

```bash
npm --prefix services/authd install
npm --prefix services/authd run build
npm --prefix services/authd test
npm --prefix services/authd start
```

## Local Docker flow

`docker-compose.local.yml` builds a dedicated `arena-public-authd:local` image on top of `arena-public-worker:local` and persists only `/home/node`.

The repo is not bind-mounted into `authd`. The service is now image-only plus the auth home volume.

Antigravity uses a separate authd-owned home volume mounted at `/auth/antigravity-home`.
Do not copy host GUI profile files into it; log in with the Linux CLI/keyring
path from inside the authd container.

Manual login flow:

```bash
./scripts/docker-local-stack.sh up -d authd
docker exec -it agents-arena-authd-1 sh

claude auth login
codex login --device-auth
```

`authd` is a headless/container login surface for Codex subscription auth.
Use `codex login --device-auth`; plain host `codex login` is not the local
runtime repair path.

Antigravity login flow:

```bash
HOME=/auth/antigravity-home \
ARENA_ANTIGRAVITY_HOME=/auth/antigravity-home \
arena-agy-with-keyring --dangerously-skip-permissions --print-timeout 5m0s --print "Reply with READY only."
```

Paste the Google authorization code into the CLI prompt inside the container.
The same auth home is mounted into Antigravity runtime containers by
`worker-agent`.

Then verify:

```bash
curl http://localhost:4311/health
```

Expected happy path after login:

- `claude.status = ready`
- `codex.status = ready`
- `codex.metadata.accessTokenExpiresAt` / `lastRefresh` are sanitized
  diagnostics only, not runtime auth payloads.

Local `governance` uses `http://authd:4311` by default. For Claude OAuth / Codex subscription runtime auth, `authd` is now mandatory and failures surface as `503` instead of silently falling back.

When `authd` source changes, rebuild it explicitly:

```bash
./scripts/docker-local-stack.sh build authd
./scripts/docker-local-stack.sh up -d authd
```

If `AUTHD_SECRET` is set, pass it as `x-authd-secret`.

## Notes

- Claude provider reads native Linux credentials from `~/.claude/.credentials.json` and mints only `CLAUDE_CODE_OAUTH_TOKEN`.
- Codex provider reads native `~/.codex/auth.json`, refreshes through the
  first-party Codex OAuth token endpoint (`https://auth.openai.com/oauth/token`)
  and returns sanitized `CODEX_AUTH_JSON` from `mint-run-auth`; refresh-token
  fields stay in the authd-owned native auth file.
- Antigravity keeps native keyring-backed `agy` state in `/auth/antigravity-home`;
  project containers receive that home through the dedicated
  `antigravity_auth_home` volume instead of env-token minting.
- Codex health does not use the non-contract WHAM usage endpoint as a hard
  validator. Local malformed or expired auth is `invalid`; transient refresh
  transport failure is `unknown`.
- On macOS Claude OAuth usually lives in Keychain, so host inspection is not a reliable source of truth.
- In the Linux `authd` container Claude should own a file-backed session, which is why manual in-container login is the intended path for this spike.
- The compose service no longer bind-mounts the repo; only the auth home volume survives container recreation.
