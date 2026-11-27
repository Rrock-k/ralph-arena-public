# Docs

`docs/` is the supported current truth for `agents-arena`.

This space should stay small, maintained, and expensive. If a document answers:

- how the system works now
- what operators are allowed to do now
- what contract the platform currently supports

then it belongs in `docs/`.

If a document mainly answers:

- how we got here
- what we tried
- what a campaign/audit/run found at the time
- how work was coordinated

then it belongs in `work/`, not in `docs/`.

## What belongs here

Current canonical examples:

- [backlog](docs/backlog)
- [contracts/system-simplicity-contract.md](docs/contracts/system-simplicity-contract.md)
- [contracts/project-runtime-preview-business-contract.md](docs/contracts/project-runtime-preview-business-contract.md)
- [contracts/accepted-spec-artifact-contract.md](docs/contracts/accepted-spec-artifact-contract.md)
- [glossary.md](docs/glossary.md)
- [local-docker-stack.md](docs/local-docker-stack.md)
- [preview-security.md](docs/preview-security.md)
- [runtime-retention.md](docs/runtime-retention.md)
- [auth-tokens.md](docs/auth-tokens.md)
- [project-structure-map.md](docs/project-structure-map.md)
- [codex-native-repo-operating-slice.md](docs/codex-native-repo-operating-slice.md)
- [gh-pr-review-pipeline.md](docs/gh-pr-review-pipeline.md)
- [ops/admin-laboratory-contract.md](docs/ops/admin-laboratory-contract.md)
- [loops](docs/loops) — platform loop contract docs, not a claim that Ralph lives in an external repo
- [ops](docs/ops)

## What does not belong here

These are work/history zones and now live under `work/`:

- `work/plans/`
- `work/audit/`
- `work/a2e/`
- `work/e2e-validations/`
- `work/history/`
- ledgers, worklogs, campaign folders, temporary investigations

`RA-260` already moved the first obvious wave out of `docs/`:

- `docs/audit/` → `work/audit/`
- `docs/a2e/` → `work/a2e/`
- `docs/e2e-validations/` → `work/e2e-validations/`
- obvious one-off historical docs → `work/history/`
- `docs/plans/` → `work/plans/`

The remaining docs/work problem is now promotion, not placement:

- `work/plans/` is the historical and working home for plan bundles
- a few still-useful current contracts are stranded there
- those should be rewritten or promoted into canonical `docs/`

One important exception:

- some real current contracts still live under `work/plans/`

Those should eventually be promoted into canonical `docs/` rather than blindly moved into `work/`.

## Rule for new files

Before adding a new doc, ask one question:

`Will we maintain this as current truth?`

- If `yes`, add it under `docs/`.
- If `no`, add it under `work/`.

If unclear, prefer `work/` first and promote later.
