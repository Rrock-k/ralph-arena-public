# Arena Control MCP

Local-only MCP control plane for Ralph Arena admin/operator work.

- Stdio-only MCP server; it does not listen on a public port.
- `start.sh` loads env from repo/governance dotenv files.
- `cli.sh project_experiment_preflight --project-id <id> --mode <preview_only|agent_run>`
  runs the same read-only preflight from current source without depending on an
  already-running Codex MCP process.
- `cli.sh project_stage_snapshot --project-id <id> [--task-id <task-id>]`
  reads a disposable RA-356 live-stage input from current source: preflight,
  accepted-artifact audit, `.ralph/plan.json` summary and selected-task
  provider-session summary. It does not run a stage, call providers, retry,
  relaunch, recreate runtime or write lifecycle/source/task/evidence state.
- `cli.sh project_updates --project-id <id> --tail <rows>` reads recent
  Arena-owned update/outbox rows for one project from current source, including
  `deliveryDiagnostics` for the project tg-spec source binding and latest
  delivery status/error.
- `cli.sh project_proof_reviews --project-id <id>` reads current governance
  `proofReviews`, `visualEvidenceReviews` and `visualEvidenceReadiness` for
  screenshot CTA audits without using outbox history as evidence availability.
- `cli.sh project_visual_evidence_artifact_check --project-id <id>` checks
  current `visualEvidenceReviews` artifact handles through Arena's download
  owner and returns sanitized downloadability metadata without raw bytes,
  storage paths, Workbench folder scans or delivery history inference.
  The same read-only surface is also exposed as the
  `project_visual_evidence_artifact_check` MCP tool.
- `cli.sh authd_operator_digest --provider codex` reads sanitized authd health
  and returns message-ready operator text for re-login reminders. It does not
  refresh providers, run login, write automation memory or send Telegram.
- `cli.sh project_retry_now --project-id <id>` clears one retryable/manual
  blocker through the lifecycle owner. Use only after fresh operator evidence
  says the wait condition can be retried.
- `cli.sh project_relaunch --project-id <id>` queues an explicit relaunch
  through the lifecycle owner. It accepts no overrides; use only after fresh
  operator evidence says relaunch is the recommended action.
- `cli.sh project_recreate_runtime --project-id <id>` recreates the current
  runtime through the recovery owner while preserving project truth. Use for
  runtime recovery, not as a retry or new-run shortcut.
- `cli.sh project_create --title <title> --spec <text> --source-seed-profile visual_workbench_canary_v0`
  creates an explicit managed canary through governance. This is a mutating
  operator action, not a stage run, retry, relaunch or workspace repair.
- Governance remains the source of truth for project/system state.
- Admin ctl routes use `/api/admin/ctl/*` plus `ARENA_ADMIN_SECRET`.
- Workspace access is local-only; VPS workspace operations return an explicit error.
