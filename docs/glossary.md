# Glossary / Domain Terms

## Core Entities

| Term | DB model | Meaning |
|---|---|---|
| `Proposal` | `Proposal` | Community idea/spec. Can exist without a running runtime. |
| `Project` | `Project` | Root entity. Identity, ownership, specs, budget, secrets. No runtime lifecycle. `archivedAt` replaces old `state` field. |
| `ProjectComponent` | `ProjectComponent` | Runtime component. Holds axes: `powerIntent`, `runtimeState`, `agentState`, `blockers`, `lastOutcome`, container metadata, preview URL. |
| `RunLog` | `RunLog` | Append-only lifecycle event journal. |
| `Spec` | `Spec` | Versioned project requirements document. |
| `Vote` | `Vote` | User vote on a Proposal. |

## Accepted Spec Artifact Terms

These terms are defined by
[accepted-spec-artifact-contract.md](docs/contracts/accepted-spec-artifact-contract.md).

| Term | Meaning |
|---|---|
| `AcceptedSpecArtifact` | Loop-neutral structured product-truth packet exchanged between `tg-spec`, Arena, runner and loops. |
| `Accepted Spec` | Full current accepted product spec. Arena stores it as versioned spec truth; loops read it. |
| `Accepted Diff` | Focused accepted change packet. Fresh diff outranks historical loop task state. |
| Task projection | Read-side UI work item derived from accepted feedback/diff and loop status. It is not accepted artifact truth and not a Ralph internal task. |
| `FeedbackItem` | Product signal that reality does not match accepted intent. `handled` means loop-claimed fixed; `accepted_closed` means user/product accepted closure; `reopened#N` is status on the same item, not a duplicate bug. |
| `Assumption` | Loop-to-user signal for a spec gap the loop interpreted. User response returns only through accepted spec/diff. |
| `SecretRequirementRef` | Safe secret-name requirement. It never contains a secret value. |
| `AssetRef` | Typed product reference to a project file. Arena owns storage and runner delivery. |

## Runtime Stack

| Layer | Term | Meaning |
|---|---|---|
| 1 | `worker-agent` | Host poller: claims runtime intents from governance, does `docker run` / stop. |
| 2 | `arena-runner` | PID 1 inside preview container. Prepares workspace, syncs status/specs/auth, manages agent child process. |
| 3 | Loop contract | Pluggable platform boundary between runner and a concrete loop implementation. |
| 4 | Bundled Ralph runtime | Current first-party loop implementation shipped with Arena. Canonical home: `packages/loops/ralph-runtime`. |
| 5 | Tool | CLI tool (`claude-code`, `codex`, `antigravity`, `opencode`). |
| 6 | `authd` | Dev-only local auth authority for Claude OAuth and Codex subscription. |

## Runtime Axes (RA-237)

### `Project`
- `archivedAt`: null = active, non-null = archived (replaces old `state` field)
- No runtime lifecycle on Project level

### `ProjectComponent` — three orthogonal axes

**Intent (governance writes):**
- `powerIntent`: `ON | OFF` — should container exist?
- `agentIntent`: `ON | OFF` — should loop work be allowed when possible?
- `blockers`: `string[]` — system-owned reasons that prevent agent work (`MANUAL`, `BUDGET`, `RATE_LIMIT`, `SECRETS`, `INFRA`, `API`)
- blockers do not themselves mean `App OFF` or `Agent OFF`; they explain why work waits
- user-controlled stop/start is not a blocker; it lives on `agentIntent=OFF|ON`

**Runtime observation (worker writes):**
- `runtimeState`: `ABSENT | RUNNING | STOPPED` — is container there? (pure observation, no ERROR state)
- `previewHealth`: `HEALTHY | UNHEALTHY | UNKNOWN` — soft cache, not lifecycle. A healthy preview can still be externally `auth_gated`.

**Agent state (runner writes):**
- `agentState`: `IDLE | RUNNING` — what is the agent doing right now?
- `lastOutcome`: `COMPLETED | FAILED | null` — how did the last agent iteration end?
- Public `PAUSED` is derived from `blockers`, not a persisted agent state.
- Legacy rows may still contain `agentState=FAILED` during cutover, but new writes should not produce it.

### Ownership split
- Governance writes: `powerIntent`, `blockers` (via `source: "admin" | "cron"`)
- Worker/Runner writes: `runtimeState`, `agentState`, `lastOutcome` (via `source: "runner" | "worker"`)
- `source: "system"` = boundary adapter, can write both sides (8 audited usages, upper bound)

### Key tuples
- `ON + RUNNING + IDLE + COMPLETED` = live preview, agent done
- `ON + RUNNING + IDLE + null` + `agentIntent=ON` + `blockers[]` = waiting row, project still wants automatic continuation when blocker clears
- `ON + RUNNING + IDLE + null` + `agentIntent=OFF` = paused preview, незавершённая работа поставлена на паузу вручную
- `OFF + ABSENT + IDLE + COMPLETED` = parked, valid
- `ON + RUNNING + RUNNING + null` = active agent run
- `OFF + ABSENT + IDLE + FAILED` = parked failed history
- `previewHealth=HEALTHY` + external `403/401` = likely `auth_gated`, not necessarily broken runtime

## Storage

| Path | Meaning |
|---|---|
| `$ARENA_PROJECT_WORKSPACES_ROOT/<label>` | Host workspace for a project |
| `/workspace` | Mounted workspace inside preview container |
| `.arena/` | Runner <-> loop communication channel inside workspace |

## Auth Terms

| Term | Meaning |
|---|---|
| `authd` | Local runtime source of truth for `claudeAuthMode=oauth` and `codexAuthMode=subscription` |
| `TokenManager` | Governance-side source of truth for API-key modes |
| `authVersion` | Versioned auth snapshot identifier used by runner to decide refresh/respawn |

## VPS — two meanings

- **Platform VPS**: the developer's laptop (or a VPS) running docker-compose with governance, Caddy, worker-agent. Exposed via Cloudflare Tunnel.
- **Project VPS**: a Hetzner VPS provisioned per-project by worker-agent. Runs a single arena-worker container. Has its own Caddy for preview TLS. Connects back to Platform via `GOVERNANCE_URL`.

These are different machines. Don't confuse them. For the current RA-344
local/cloudflared production serving path, the active platform machine is this
operator computer, not `do-2` and not a project VPS.

## Project Branches & Code Flow

- Loops run on `arena/project-<slug>` branches, NOT on `main`.
- `useRepoHead: true` = launch path requests current **bundled default runtime** mode.
- Operator truth should distinguish `Bundled default` from `Pinned <version/ref>`; do not call both just `latest`.
- Runner clones from remote git HEAD, not local filesystem. Local uncommitted changes are invisible.
- Runner does `git clone` → `git checkout arena/project-X` inside the container.

## Anti-Glossary (legacy terms, no longer current)

`Run` (as main entity), `dispatcher` (now worker-agent), `runtime/runner-work`, `services/runner/`,
`Project.status` (removed in RA-237), `Project.state` (removed in RA-237),
`desiredRuntime` / `actualRuntime` / `implState` (removed in RA-237, replaced by powerIntent/runtimeState/agentState),
`pauseReason` (removed, replaced by blockers[]),
`previewDesired` / `previewActual` (removed, replaced by previewHealth),
`runtimeState=ERROR` (removed, ERROR is not an observable state — use ABSENT + blocker),
`packages/contracts/src/state-machine/` (dead code — legacy transitions/invariants, no consumers after gallery-card-state inline),
`agentState=PAUSED` and `agentState=FAILED` as canonical live runtime states
