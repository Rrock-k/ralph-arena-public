# Agent hook contract

Этот контракт фиксирует, какие hook guardrails должны быть общими для Codex и
Claude project surfaces, а какие различия допустимы как UX-specific.

## Owner

- Hook configuration: `.codex/hooks.json` and `.claude/settings.json`.
- Shared hook logic: `scripts/hook-*.sh` and `scripts/check-*.mjs`.
- Review cadence: [weekly-instruction-system-maintenance.md](docs/ops/weekly-instruction-system-maintenance.md).

Do not duplicate long policy prose inside hook JSON. Keep reusable checks in
scripts and keep hook config as wiring.

## Mandatory shared checks

Both Codex and Claude surfaces must run these categories unless a documented
tooling limitation makes it impossible:

- env ownership and template drift: `scripts/hook-env-contract.sh`;
- backlog format drift: `scripts/hook-backlog-format.sh`;
- accepted artifact boundary drift: `scripts/hook-accepted-spec-artifact-contract.sh`;
- instruction-system drift: `scripts/hook-instruction-system-maintenance.sh`.

Host command safety must be covered before risky commands execute:

- host DB access must point operators back to the Docker DB path;
- host `npm` and direct Docker danger paths must be blocked or warned;
- destructive DB or migration commands must require backup posture.

Codex and Claude can implement command safety through different hook matchers,
but the resulting operator protection must be equivalent.

## Allowed asymmetry

These hooks may exist on one surface without being mirrored exactly on the
other:

- Claude UI-noise/file tracking hooks;
- local Chrome/browser automation guide injection;
- session activity markers;
- rebuild reminders tied to Claude editing flow;
- Codex-specific Bash policy wrappers.

Allowed asymmetry must not replace a mandatory shared check. If a guardrail
becomes business-critical, move the logic into `scripts/` and wire both
surfaces.

## Local settings

Tracked project policy belongs in `.claude/settings.json`. Do not commit
`.claude/settings.local.json`; personal local overrides should stay ignored and
must not carry mandatory project guardrails.
