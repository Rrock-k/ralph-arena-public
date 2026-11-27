# Task Board

Kanban-style board for Ralph Arena markdown backlogs. It reads and writes `docs/backlog/*.md`; there is no database.

## Runtime

The local stack runs task-board in production mode (`next build && next start`) to keep steady-state memory low. Startup syncs the `node_modules` volume to `package-lock.json` before building, so dependency changes do not require manual volume cleanup.

After source changes, recreate it through the root wrapper:

```bash
./scripts/docker-local-stack.sh rm -sf task-board
./scripts/docker-local-stack.sh up -d task-board
```

Markdown data changes take effect immediately because files are read at request time.

## Architecture

- `src/lib/parser.ts` parses markdown headings into `BacklogTask[]`.
- `src/lib/writer.ts` updates, deletes, reorders, and appends tasks.
- `src/lib/backlog.ts` reads backlog files and delegates to the parser.
- `src/lib/constants.ts` owns status/priority labels, colors, and board column order.

Supported task format:

```markdown
### [STATUS] PREFIX-NNN: Task title
> Priority: P0
> Depends on: PREFIX-001, PREFIX-002

Description text.

**Acceptance criteria:**
- [x] Done item
- [ ] Pending item
```

Parser validation is strict:
- unsupported task statuses throw `InvalidTaskStatusError`
- duplicate task IDs throw `DuplicateTaskIdError`

The parser test suite reads the real `docs/backlog/*.md` files, so malformed task headings cannot be left hidden in source while the board silently skips them.
The repo-level `npm run backlog:check` command performs the same fast markdown format check and is wired into Claude/Codex Stop hooks.

## UI and API Conventions

- API routes live under `src/app/api/tasks/`; return JSON with explicit `success` / `error` shape.
- Surface parser/writer failures in the UI; include source-file context when available.
- Components live under `src/components/`; keep user-facing board text in Russian.
- Optimistic UI updates must roll back on failed writes.
- New tasks are created in `IDEA` or `PLANNED`; preserve same-file drag reorder semantics unless `writer.ts` explicitly grows cross-file support.

## Testing

Parser/writer changes need focused coverage around heading parsing, duplicate IDs, status moves, deletes, and same-file reorder.
