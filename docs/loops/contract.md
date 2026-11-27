# Runner ↔ Loop Contract

Этот контракт описывает **platform boundary**, а не конкретную реализацию loop-а.

Сейчас first-party реализация по умолчанию — bundled Ralph runtime в `packages/loops/ralph-runtime`.
Другие loop implementations могут оставаться pluggable, если говорят тем же контрактом.

Structured accepted product truth is defined in
[accepted-spec-artifact-contract.md](docs/contracts/accepted-spec-artifact-contract.md).
The loop contract only defines how runner materializes that truth into
workspace-readable inputs.

> Formal specification of the interface between the **Arena Runner** (PID 1 in the container) and any **loop** running inside.
>
> The runner treats loops as black boxes. It only interacts through this contract. Any loop that implements this contract can run on the platform without code changes.

## 1. Workspace Layout

Runner clones the project repo and sets up the workspace before spawning the loop:

```
/workspace/                     # $ARENA_WORK_DIR
├── specs/                      # $ARENA_SPEC_DIR — runner writes, loop reads
│   ├── 001-feature-a.md
│   └── 002-feature-b.md
├── arena-start.sh              # Loop → runner: app startup script (REQUIRED for preview)
├── spec.md                     # Combined spec (all specs in one file)
├── .arena/                     # Communication channel (runner ↔ loop)
│   ├── result.json             # Loop → runner: terminal state signal
│   ├── progress.json           # Loop → runner: progress state (UI display only)
│   ├── outgoing-events.json    # Loop → runner: events for governance (QA, etc.)
│   ├── events.json             # Runner → loop: incoming events from governance
│   ├── platform.md             # Runner → loop: platform contract + runtime context
│   ├── spec-input.json         # Runner → loop: accepted spec input metadata
│   └── auth-refresh.json       # Runner → loop: refreshed auth tokens
├── .ralph/                     # Ralph-private loop memory (when bundled Ralph is used)
│   ├── plan.json               # Ralph-owned execution plan; executor reads, runtime writes
│   └── tasks/<task-id>/        # Task-local working notes, not product truth
├── .env.arena-secrets          # Decrypted project secrets (chmod 0600)
└── ... (project source code)
```

## 2. Environment Variables

### Guaranteed

| Variable | Description |
|---|---|
| `ARENA_PROJECT_ID` | Project identifier |
| `ARENA_AGENT` | CLI tool name (`claude-code`, `codex`, `antigravity`, `opencode`, or a service-style loop value) |
| `ARENA_MODEL` | Model ID (may be empty) |
| `ARENA_WORK_DIR` | `/workspace` |
| `ARENA_SPEC_DIR` | `/workspace/specs` |
| `ARENA_CAPABILITIES` | Comma-separated capabilities list (see [Capabilities](#3-capabilities)) |
| `ARENA_PREVIEW_URL` | Public preview URL, when the platform has assigned one |
| `ARENA_PREVIEW_ORIGIN` | Public preview origin, when derivable from the preview URL |
| `ARENA_TELEGRAM_PREVIEW_URL` | Arena Telegram Mini App preview entry URL, when the platform has assigned one |
| `CI` | Always `true` |
| `PORT` | `3000` — reserved for preview app |

### Auth & Proxy (when configured)

| Variable | Description |
|---|---|
| `GITHUB_TOKEN` | Token for git push operations |
| `ANTHROPIC_BASE_URL` | API proxy URL (budget enforcement) |
| `OPENAI_BASE_URL` | API proxy URL for OpenAI-compatible APIs |

Secrets from `.env.arena-secrets` are also injected into `process.env`.

## 3. Capabilities

Capabilities are a string array that defines which runner services are active and what features the loop can use. Passed via `ARENA_CAPABILITIES` env var (comma-separated).

| Capability | Runner Service | Description |
|---|---|---|
| `specs` | Specs polling (30s) | Runner updates spec files mid-run |
| `progress` | ProgressWatcher | Runner polls `.arena/progress.json` every ~5s |
| `community_qa` | EventSync | Runner syncs `.arena/outgoing-events.json` → governance, governance → `.arena/events.json` |
| `log_streaming` | LogCollector | Runner streams stdout/stderr to governance |

**Feature flag gating (RA-243):** Capabilities declared in `AgentLoopVersion` are filtered by platform feature flags before being passed to the loop. If a capability has a corresponding feature flag that is OFF, the capability is stripped. Capabilities without a flag mapping always pass through.

The loop reads `ARENA_CAPABILITIES` and adapts behavior accordingly:

```typescript
const caps = new Set((process.env.ARENA_CAPABILITIES ?? "").split(",").filter(Boolean));
if (caps.has("community_qa")) {
  // Generate test cases after each iteration
}
```

## 4. `.arena/` Channels

### progress.json (loop → runner)

Loop writes progress state. Runner polls every ~5s and pushes to governance.

```json
{
  "state": "coding",
  "message": "Building REST API",
  "iteration": 2,
  "steps": [
    { "id": "1", "label": "Setup project structure", "status": "completed" },
    { "id": "2", "label": "Build REST API", "status": "in_progress" },
    { "id": "3", "label": "Write tests", "status": "pending" }
  ]
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `state` | string | yes | Loop-defined UI/progress state such as `planning`, `coding`, `testing`, `deploying`, `verification`, `completed`, `paused_budget`, `paused_rate_limit`, `paused_infra`, `error` |
| `message` | string | no | Human-readable status |
| `iteration` | number | no | Current iteration number |
| `steps` | array | no | Discrete work items |

### result.json (loop → runner)

Loop writes terminal state before exiting. Runner reads after child process exits.

```json
{
  "status": "DEPLOYED",
  "reason": "All tasks completed"
}
```

Valid `status` values: `DEPLOYED`, `FAILED`, `CANCELED`.

Recoverable pauses are reported as:

```json
{
  "status": "CANCELED",
  "pauseReason": "BUDGET"
}
```

Valid `pauseReason` values: `MANUAL`, `BUDGET`, `SECRETS`, `RATE_LIMIT`, `INFRA`, `API`.

Provider quota/rate-limit pauses must be reported through this same structured
terminal artifact. Include `retryAt` when the provider exposes a deterministic
reset time:

```json
{
  "status": "CANCELED",
  "pauseReason": "RATE_LIMIT",
  "retryAt": "2026-04-22T19:00:00.000Z",
  "reason": "Provider rate limit reached"
}
```

`MANUAL` means an explicit user/operator/platform action paused the loop. Ralph controller product judgment must not create `MANUAL` as the default way to request acceptance or production proof; it should record judgments only for real product ambiguity, keep weak evidence as private runtime evidence / warnings, and keep moving.

Runner clears this file before each loop spawn. If file is missing after exit:
- exit 0 → `DEPLOYED`
- exit != 0 → `FAILED`

If runner itself initiated the stop (governance signal, idle timeout), runner's reason takes priority over result.json.

### outgoing-events.json (loop → runner)

JSON array of events for governance. Runner reads every ~5s and pushes new entries.

```json
[
  { "type": "test_request", "payload": { "testCases": [...] } }
]
```

### events.json (runner → loop)

Incoming events from governance (QA feedback, test results). **Read-only for the loop.** Runner appends every ~30s.

```json
[
  { "type": "test_result", "payload": { "passed": true, "feedback": "..." } },
  { "type": "qa_feedback_batch", "payload": { "summary": "...", "tests": [...] } }
]
```

### platform.md (runner → loop)

Runner writes multi-user runtime context at startup. Contains:
- Visitor identity mechanism (`X-Ralph-Anon-Id` header)
- Project-scoped access headers injected by preview-gate
- Access level description (featured/public/private)

Loop should read this file (if it exists) and incorporate it into agent instructions so the agent builds multi-user-aware applications.

Preview-gated requests may include:

| Header | Meaning |
|---|---|
| `X-Ralph-Anon-Id` | Stable anonymous per-project visitor id. Use this for app-local user state. |
| `X-Arena-Project-Id` | Current Arena project id. |
| `X-Arena-Project-Role` | `public`, `viewer`, `member`, `admin`, or `owner`, derived by Arena from project owner and direct project `AccessGrant` truth. |
| `X-Arena-Project-Capabilities` | Comma-separated app-scoped Arena project capabilities for the current visitor. Platform/operator grants are not exposed to generated apps as app-admin capabilities. |

Generated apps must treat these as request-scoped platform inputs:

- Missing project access headers mean `public` with no capabilities.
- Admin-only UI and server endpoints must check `owner`/`admin` role or explicit capabilities on every request.
- Apps must not check Telegram, email addresses, global user roles or hardcoded user ids for project admin features.
- Apps must not treat Arena platform/operator admins as project app admins unless these headers explicitly say `owner` or `admin`.
- `X-Ralph-Anon-Id` is identity, not authorization.

### spec-input.json (runner → loop)

Runner writes deterministic accepted spec input metadata whenever it syncs `spec.md` / `specs/`.

This is read-only input metadata for loop runtimes. It is not lifecycle state and not a task store.

Canonical target:

- `.arena/spec-input.json` materializes `AcceptedSpecArtifact` metadata from the
  accepted spec artifact contract;
- loops may map accepted feedback, diff items and assumptions into private execution
  memory;
- loops must not write task projection truth back into `.arena/spec-input.json`.

Current use:
- full accepted spec text still lives in `spec.md` and `specs/*.md`;
- each spec keeps a legacy content `hash`;
- metadata-aware specs can carry `inputHash`, current version/source,
  `acceptedArtifact` and metadata hash;
- loop runtimes can use the manifest aggregate hash to detect metadata-only accepted spec changes.
- retired v2 accepted-delta input is rejected at the Arena import edge; runner
  manifests must carry only `acceptedArtifact` metadata.

### auth-refresh.json (runner → loop)

Runner writes refreshed auth tokens when they change mid-run. JSON key-value pairs:

```json
{
  "version": "abc123",
  "auth": {
    "CLAUDE_CODE_OAUTH_TOKEN": "...",
    "ANTHROPIC_API_KEY": "..."
  }
}
```

Runner detects auth changes via SHA-256 hash comparison. When auth changes, runner **respawns the child process** with updated credentials rather than hot-patching.

## 5. Ralph-private task workspace

Bundled Ralph may create `.ralph/tasks/<task-id>/` for private task-local
working context. This folder is not accepted spec truth, not public task truth
and not lifecycle state.

Current v1 use:

- `brief.md` is runtime-seeded from the active Ralph task.
- `plan.md` is always written or updated by the executor before product code
  changes. Task completion requires this file to contain a real task-local
  plan, not only Ralph's scaffold.
- `product.md` may be written by the executor or a delegated `product` role
  pass before product-heavy implementation.
  The product pass should name the user's primary intent, the main action, the
  limited secondary actions, success criteria and non-goals before UI decisions
  are made. It should separate must-have behavior from nice-to-have detail
  without inventing product truth beyond the accepted spec/diff.
- `ux.md` may be written by the executor or a delegated `ux` role pass before
  UI, interaction, responsive, animation or gameplay-feel work.
  The UX pass is mobile-first by default unless the accepted spec names another
  primary target. It should keep the visible action set small, prefer familiar
  controls, push secondary detail into disclosure surfaces where appropriate,
  and verify that the introduced entities/actions fit the intended viewport
  without clipping, overlap or accidental horizontal scroll.

If subagent/delegation tools are unavailable, the executor performs the same
role pass itself using Ralph's read-only `.ralph/task-skills/` files. The
executor must not edit `.ralph/plan.json`, `.ralph/agent-logs/`,
`.ralph/controller-reports/`, `.ralph/task-skills/` or `.arena/` files to
manufacture completion or closure evidence.

## 6. Completion & Exit Codes

**Terminal signal:** write `.arena/result.json` with `{ "status": "DEPLOYED" }` and exit 0.

Runner determines terminal state by priority:
1. Runner-initiated stop (governance signal, idle timeout) → runner's reason wins
2. `.arena/result.json` exists → trust the loop's declared status
3. No result.json + exit 0 → `DEPLOYED`
4. No result.json + exit != 0 → runner terminal fallback:
   - token/auth freshness failure → retry with fresh auth or
     `CANCELED + pauseReason=API`
   - provider API unreachable (503/529/timeout) → `CANCELED + pauseReason=INFRA`
   - otherwise → `FAILED`

Provider quota/rate-limit is not inferred by runner from provider-specific
quota probes after an unstructured loop crash. A pluggable loop that wants a
`RATE_LIMIT` lifecycle pause MUST write structured `result.json` pause truth
before exiting. Without that artifact, non-zero exits are generic failures
unless runner can independently classify auth freshness or provider API
reachability.

For bundled Ralph, this is owned by the Ralph runtime (`finalize()`), not by executor/product tasks. The controller must not add work items whose only purpose is to create or verify `.arena/result.json`.

`progress.json` is for **UI display only** — runner does NOT make lifecycle decisions based on progress state.

## 7. What a Loop MUST Do

1. Read specs from `$ARENA_SPEC_DIR` (or `$ARENA_WORK_DIR/spec.md`)
2. Use the specified agent (`$ARENA_AGENT`) and model (`$ARENA_MODEL`)
3. Create `arena-start.sh` — the ONLY way the platform starts the preview app
4. Write `.arena/result.json` with terminal status before exiting
5. Exit 0 on success, non-zero on error
6. Git: if working with a repo — commit to the current branch, push
7. For recoverable provider/auth/quota pauses, write
   `{"status":"CANCELED","pauseReason":"..."}` with the appropriate
   `MANUAL`, `BUDGET`, `SECRETS`, `RATE_LIMIT`, `INFRA` or `API` value before
   exiting; include `retryAt` for `RATE_LIMIT`, `API` or `INFRA` when known.

## 8. What a Loop MUST NOT Do

- Listen on port 3000 — reserved for the preview app after deploy
- Contact governance API directly — no URL/tokens available; all communication through `.arena/`
- Modify runner-owned `.arena/events.json`, `.arena/platform.md`, `.arena/spec-input.json`, `.arena/assets-manifest.json`, `.arena/auth.json`, or `.arena/stop-request.json`
- Write loop-internal state into `.arena/` — use a loop-specific directory (e.g. `.ralph/`, `.sympho/`)
- Depend on a specific OS/distro beyond: Debian-based, Node 22+, git available

## 9. Secrets

**At init:** Runner writes decrypted secrets to `.env.arena-secrets` and injects into env.

**Runtime request:** Loop can request missing secrets via CLI:

```bash
node /arena/request-secrets.js SECRET_KEY "What this secret is for"
# --non-blocking — marks as optional (won't pause project)
```

This registers the secret need in governance. Admins see it in the UI and provide values.

Secrets are blocking by default. A loop should keep a secret blocking when that credential is required for the spec's core behavior, production integration, or final verification. `--non-blocking` is only for optional extras; a local/fake/mock path may support development, but it is not evidence that a required external integration is complete.

## 10. Git Contract

| Responsibility | Owner |
|---|---|
| Clone repo + checkout branch | Runner |
| Write specs to workspace | Runner |
| Commit changes | Loop |
| Push to branch | Loop |

## 11. Live Spec Updates

When `specs` capability is active:
1. Runner polls governance every ~30s for spec changes
2. When hash changes, runner writes updated files to `specs/`
3. Loop should re-read specs at iteration boundaries

## 12. Stop Signals

Three independent stop channels:

1. **Governance poll** — Runner polls `/status` every ~10s. On `shouldStop: true`, sends SIGTERM to loop
2. **Docker stop** — SIGTERM → 10s grace → SIGKILL
3. **Budget exhaustion** — API proxy returns 402, agent CLI exits

On graceful stop, loop should commit and push work in progress before exiting.

## 13. Idle Timeouts

Runner monitors loop activity and parks inactivity as `CANCELED + pauseReason=INFRA`:

| Timeout | Duration | Trigger |
|---|---|---|
| Verification idle | 10 min | No logs/progress/state change while in `verification` state |
| General idle | 30 min | No activity at all (no logs, no progress updates, no state changes) |

Activity is tracked via: last log timestamp, last progress update, last state change.

## 14. Rate Limit Detection

Loop runtimes classify provider rate-limit/quota output at the agent invocation
boundary. If detected:

- Terminal state: `CANCELED + pauseReason=RATE_LIMIT`
- The loop stops before more model calls, QA generation, deploy, or
  max-iteration failure

Runner treats `.arena/result.json` as the primary loop-owned terminal artifact.
Runner-side provider quota probes are not a post-run safety net. They must not
turn an unstructured crash into `RATE_LIMIT` by scraping logs or provider
account state as a second truth. Loops may also expose progress states like
`paused_rate_limit` in `progress.json`, but terminal truth is
`CANCELED + pauseReason=RATE_LIMIT`.

## 15. Asset Management

Runner syncs project assets (uploaded files) from governance to the workspace:
- Assets are downloaded to their declared paths relative to `/workspace/`
- Runner maintains `.arena/assets-manifest.json` (internal, not for loop consumption)
- Runner maintains `.arena/spec-input.json` for accepted spec metadata consumed by loop runtimes
- Runner polls for asset changes every ~30s

## 16. Preview Contract (RA-247: strict arena-start.sh)

After loop exits with DEPLOYED state, runner starts the workspace app:

- Runner executes `arena-start.sh` — the ONLY entry point. No `npm start` fallback.
- `arena-start.sh` must be executable, run in foreground, handle install/build/start.
- App must bind to `$PORT` (3000)
- Health check: `GET /health` returning HTTP 200 (30 attempts, 1s interval)
- No `arena-start.sh` → preview fails with `UNHEALTHY`
- Preview URL: `https://preview-{label}.{domain}`

Example `arena-start.sh`:
```bash
#!/bin/bash
npm install
exec npm start
```

## 17. Git-Based Loop Loading

External loops are loaded from git at container startup:

1. `AgentLoop.sourceUrl` specifies the git repository
2. `AgentLoopVersion.version` maps to git tag `v{version}`
3. Runner clones to `/arena/loops/{name}/`, runs `npm ci --production`
4. `commandTemplate` uses `{loopdir}` placeholder for the install path

Example commandTemplate for an external loop:
```
node {loopdir}/dist/index.js run --work-dir {workdir} --spec {specfile} --agent {agent} --model {model}
```

## 18. commandTemplate Placeholders

| Placeholder | Value |
|---|---|
| `{agent}` | CLI tool name (`claude-code`, `codex`) |
| `{model}` | Model ID (removed with `--model` flag if null) |
| `{specdir}` | `/workspace/specs` |
| `{specfile}` | `/workspace/spec.md` |
| `{workdir}` | `/workspace` |
| `{loopdir}` | `/arena/loops/{name}` (git-loaded loops only) |

## 19. Loop-Internal State

Loops may store internal state in a loop-specific directory (e.g. `.ralph/`, `.sympho/`). This directory is owned entirely by the loop — runner does not read or write it.

The only runner exception is git worktree hygiene before a fresh claim sync:
runner may restore explicitly replayable ephemeral files such as
`.ralph/iteration-log.json` and `.ralph/ralph-progress.json` from git when they
are the only dirty paths together with deterministic spec files. Runner must
not read them as truth, and must not restore durable loop truth such as
`.ralph/plan.json`.

**Convention:** `.{loop-name}/` at workspace root. The loop is responsible for creating the directory and managing its contents. This keeps `.arena/` clean for contract-only communication.

If a loop has execution truth that must survive fresh agent containers on the same loop contract, the loop must keep that truth in its own directory and commit the narrow owner artifact to project git. For bundled Ralph, that artifact is `.ralph/plan.json`. When the loop is running with project auto-push enabled, every non-empty loop-owned commit that changes durable execution truth must also be pushed to the configured project branch before the loop treats that slice as safely persisted; otherwise the next fresh runner sync can correctly refuse the workspace as split-brain.

Example for ralph:
```
.ralph/
├── plan.json              # Durable Ralph execution truth for same-loop resume/spec migration
├── ralph-progress.json    # Ephemeral runtime progress counters/state, not task lifecycle truth
├── decisions-log.json     # Ephemeral judgment audit log
├── iteration-log.json     # Ephemeral per-iteration summaries
├── provider-call-checkpoint.json    # Ephemeral planner/controller provider-call continuation hint
├── provider-session-checkpoint.json # Ephemeral provider CLI continuation hint
├── agent-logs/            # Ephemeral agent prompt/output logs
├── controller-reports/    # Ephemeral controller audit reports
└── logs/                  # Ephemeral run-level logs
```

Provider call/session checkpoints are best-effort loop hints only. Durable same-loop resume truth remains `.ralph/plan.json`; runner and governance must not depend on provider CLI session survival.

Public task progress for bundled Ralph is derived from `.ralph/plan.json` at
flush time. Ralph must not persist a separate task-status cache such as
`.ralph/ralph-features.json`, and `.ralph/ralph-progress.json` must not persist
task lifecycle fields such as current task id or task completion totals; those
would create a second task lifecycle owner.

### Ralph feedback/evidence truth

For bundled Ralph, accepted feedback handling is stored only in `.ralph/plan.json`:

- `specMigrations[].requiredFeedbackItems[]` records current accepted feedback that required a migration disposition.
- `specMigrations[].feedbackDispositions[]` records exactly how Ralph handled each required current item.
- `phases[].tasks[].feedbackItemRefs[]` links internal loop tasks to current feedback items.
- `phases[].tasks[].verificationEvidence[]` stores item-linked execution evidence.

Controller reports may include `feedbackMatrix`, but those reports are audit artifacts. Runner and Governance must not read `.ralph/controller-reports` as lifecycle truth.

Missing product evidence after Ralph claims a task or feedback item is handled is
not a user-facing confirmation gate by default. Users reopen work by providing
new negative feedback; Ralph should keep verification gaps and overclaim
warnings as loop evidence unless they produce implementable follow-up work.

## 20. State Lifecycle & Migration Rules

### Ownership split

| Layer | Persists across | Owner | Examples |
|---|---|---|---|
| **Workspace** (`/workspace/`) | Relaunches | Runner creates, loop writes code | Source code, package.json, git history |
| **Contract state** (`.arena/`) | Relaunches | Runner manages | progress.json, events.json, platform.md |
| **Loop execution truth** (`.ralph/plan.json` for Ralph) | Fresh containers on the same loop version | Loop manages, project git persists | completed tasks, spec migrations, current plan |
| **Loop telemetry** (`.ralph/` other files) | Current container / debugging only | Loop manages | iteration-log, agent-logs, controller reports |
| **Specs** (`/workspace/specs/`) | Relaunches | Runner writes from governance | 001-feature-a.md |

### Rules for contract-breaking changes

1. **No fallbacks.** When a new loop version changes internal state layout, old state is orphaned. The loop starts from a clean slate. No migration code, no compat shims.

2. **Loop telemetry is ephemeral.** A new loop version MUST be able to start from scratch on an existing workspace with no compatible `.{loop-name}/` directory. Durable execution truth for the same loop contract must be committed as a narrow loop-owned artifact, not mirrored into `.arena/`.

3. **Version boundaries are migration boundaries.** Changing `AgentLoopVersion` for a project means accepting that old loop execution truth may reset unless that new loop explicitly migrates it. This is explicit and expected.

4. **Contract state is stable.** Changes to `.arena/` channel formats require runner + loop coordination. Runner must continue reading old formats until all active loop versions are updated. New channels can be added freely (loops that don't know about them simply ignore them).

5. **Workspace survives everything.** Source code, git history, `package.json`, user-created files — these persist across relaunches, version changes, and loop switches. Loops must not assume they own the workspace exclusively.
