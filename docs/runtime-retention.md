# Runtime Artifacts Retention

Текущие project workspaces живут под настроенным workspace root. В local dev default — `~/.arena-runtime/project-workspaces`.

Это host-side runtime state, который использует `worker-agent` при локальных и VPS-backed запусках. Он intentionally вынесен за пределы `apps/`, `services/` и `packages/`, чтобы runtime-артефакты можно было чистить отдельно от кода.

## Workspace layout

- `$ARENA_PROJECT_WORKSPACES_ROOT/<workspaceLabel>/`
- внутри лежат:
  - cloned repo / рабочее дерево проекта
  - `.arena/` runtime-каналы и артефакты
  - tool logs / временные output-файлы

Внутри preview-контейнера этот workspace монтируется как `/workspace`.

## Что хранить

### Держать

- rows with live runtime:
  - `powerIntent=ON`
  - or `runtimeState=RUNNING`
- rows that are about to launch, recreate, or recover through the normal platform path
- recently failed iterations, if the workspace is still needed for post-mortem

### Можно чистить

- honestly parked rows:
  - `App OFF`
  - `Agent OFF`
  - `runtimeState=ABSENT`
- archived rows with no live runtime left
- trash/manual/empty-bootstrap rows that are being explicitly deleted or cleaned up
- any row whose container is already gone and whose workspace is no longer needed for debugging

## Предпочтительный путь cleanup

Не чисти active workspace вручную через `rm -rf`.

Предпочитай существующие runtime-maintenance пути в governance:

- admin cleanup runtime artifacts
- project delete / runtime cleanup actions
- worker-agent container removal flows

Кодовые опорные точки:

- `apps/governance-platform/src/app/actions/runtime-maintenance.ts`
- `apps/governance-platform/src/app/actions/project-manage.ts`

## Manual cleanup checklist

Если нужен ручной cleanup:

1. Убедись, что проект не active.
2. Проверь фактический `docker ps` и live runtime identity на component side.
3. Сначала убери контейнер, потом workspace.
4. Не оставляй stale runtime identity или blocked claim state без осознанного reset/requeue path.

## Disk guidance

- Храни настроенный workspace root на диске с запасом по месту.
- Если локальный хост упирается в диск, сначала останови проблемные/ненужные runtime-артефакты штатным путём, а не массовым удалением живых workspace.
- Source of truth для проекта — governance DB + git repo. Workspace нужен в первую очередь для live runtime и пост-мортема.

## RunLog heartbeat retention

`RunLog` — это audit/debug history для смысловых runtime changes. Он не должен
быть live control plane для heartbeat.

Live heartbeat truth:

- `ProjectComponent.lastHeartbeat`

Heartbeat rows that are compactable:

- `RunLog.event = HEARTBEAT`
- `RunLog.event = PROGRESS_HEARTBEAT`

Policy:

- No-op runner heartbeat/progress heartbeat metadata updates that only move
  `lastHeartbeat` are not written to `RunLog`.
- Recent heartbeat rows may be kept as a short debug window.
- Stale heartbeat rows older than
  `ARENA_RUNLOG_HEARTBEAT_RETENTION_DAYS` are compacted by deleting the old
  heartbeat rows in bounded batches.
- Default retention window: 7 days.
- Default compaction batch size:
  `ARENA_RUNLOG_HEARTBEAT_COMPACTION_BATCH_SIZE=10000`.
- Default per-run cap:
  `ARENA_RUNLOG_HEARTBEAT_COMPACTION_MAX_BATCHES_PER_RUN=25`.
  A capped run records `maxBatchesPerRunReached=true` in `MaintenanceRun.result`;
  rerun the same manual maintenance item to continue.
- Semantic runtime transitions, blocker changes and outcome changes are not
  heartbeat telemetry and are not part of heartbeat compaction.
- Progress heartbeat rows that carried preview health debug context are kept in
  the short debug window, then compacted with the rest of stale heartbeat
  telemetry. Live preview health truth remains on `ProjectComponent`.

Maintenance entry:

- `maintenance:runlog-heartbeat-compaction`
- manual/operator invocation only by default
- executor: `fixed_runlog_heartbeat_compaction`
- non-browser manual run-now endpoint:
  `POST /api/admin/maintenance-jobs/run-now` with `x-arena-admin-secret` and
  JSON body `{ "key": "maintenance:runlog-heartbeat-compaction" }`

Do not derive lifecycle state from old heartbeat logs. Use component state and
`lastHeartbeat`; use `RunLog` for bounded debug/audit context.

## Docker log retention

Local compose services and worker-created preview containers use Docker
`json-file` log rotation:

- `ARENA_DOCKER_LOG_MAX_SIZE`, default `10m`
- `ARENA_DOCKER_LOG_MAX_FILE`, default `5`

This bounds host-side Docker JSON logs. It does not replace governance
`RunLog`, terminal snapshots or project update history.

For worker-created preview containers, log rotation is part of container
creation config. A stopped preview container whose Docker log config does not
match the current worker config is stale and should be recreated rather than
reused.

## Что больше не считать правдой

- `runtime/runner-work` — старый путь
- `Run` как единица retention policy
- “cleanup = nightly shell script по всем workspaces без учёта Project/ProjectComponent state”
