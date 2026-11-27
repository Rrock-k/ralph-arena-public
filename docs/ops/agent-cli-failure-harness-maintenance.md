# Agent CLI Failure Harness Maintenance

## Boundary

The production agent adapters in `packages/loops/ralph-runtime/src/agents/`
own CLI invocation and error classification. Mock CLI fixtures may replay real
provider-shaped outputs through those adapters, but they must not introduce a
second adapter, classifier, lifecycle state, or provider truth.

Current first-party harness scope:

- `codex` through `CodexAgent` and `fixtures/mock-codex-cli.mjs`.
- `claude-code` through `ClaudeCodeAgent` and `fixtures/mock-claude-cli.mjs`.
- `opencode` through `OpenCodeAgent` and `fixtures/mock-opencode-cli.mjs`.

## Required Matrix

Every scoped CLI must support a prod-like replay for:

- rate limit / usage limit, preserving provider reset timing when present;
- provider-session resume target unavailable, proving the adapter falls back to
  fresh task execution instead of burning product-task retries;
- auth failure;
- config failure;
- budget-like failure;
- transport / infra failure;
- non-zero exit after a completion signal, so executor-level completion guards
  can prove the run does not proceed into verification after a provider pause.

The shared regression packet is
`packages/loops/ralph-runtime/src/agents/cli-failure-harness.test.ts`.
Adapter-local tests should keep provider-specific invocation, resume,
no-tools, usage, and config behavior close to the adapter that owns it.

## Evidence Classes

Fixtures may start as synthetic provider-shaped replay, but review notes must
not present them as live CLI parity until there is matching evidence from a
real CLI version.

Use these labels in action logs and review notes:

- `confirmed live`: backed by a sanitized real CLI/log snippet, local
  `--help`/`--version` invocation evidence, or readable packaged source for the
  same CLI version and boundary.
- `synthetic replay`: shaped to exercise the production adapter/classifier, but
  not yet proven against a real CLI failure sample.
- `stale`: previously confirmed against an older CLI version but not refreshed
  after a meaningful version bump or incident.

When a fixture is synthetic, it is still useful for adapter and executor
regression coverage, but it must not be used as proof that the provider
currently emits the same stdout/stderr/JSONL shape.

## Cadence

Review and refresh the mock CLI fixtures:

- at least once per month;
- after any live incident where CLI output, JSONL events, session resume,
  rate-limit reset semantics, or no-tools behavior affected runtime outcome;
- after a meaningful baked CLI version bump for Codex, Claude Code, or
  OpenCode.

When refreshing a fixture, use sanitized snippets from live logs or action-log
notes, update the shared matrix only for cross-provider contracts, and keep
provider-specific details in that adapter's own test file.

Minimum verification after a fixture or adapter change:

```bash
node --import tsx --test src/agents/cli-failure-harness.test.ts src/agents/codex.test.ts src/agents/claude-code.test.ts src/agents/opencode.test.ts
```

If executor pause behavior is touched, also run the focused executor tests that
cover real adapter failure paths.
