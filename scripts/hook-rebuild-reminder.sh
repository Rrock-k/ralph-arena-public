#!/usr/bin/env bash
# Stop hook: checks which files THIS SESSION changed (via PostToolUse tracker)
# and reminds to restart/rebuild affected services.
# Session-aware: parallel sessions only see their own changes.
#
# Architecture: all services run in Docker (docker-compose.local.yml).
# - governance-platform: Next.js in dev mode with HMR.
#   Code changes are picked up automatically (no rebuild needed).
#   Prisma schema changes need `prisma migrate dev` inside the container.
#   New deps/workspace packages need node_modules volume recreation.
# - worker-agent, api-proxy: volume-mounted, restart to pick up changes.
# - authd: image-only service with persistent /home/node, rebuild + recreate on code/image changes.
# - arena-runner and bundled Ralph runtime: built into arena-worker image, need worker image rebuild + fresh preview runtime.
# - caddy: config is bind-mounted, restart to reload.

set -euo pipefail

input=$(cat)
project_dir="${CLAUDE_PROJECT_DIR:-${CODEX_PROJECT_DIR:-}}"
if [ -z "$project_dir" ] && printf '%s' "$input" | jq -e . >/dev/null 2>&1; then
  project_dir=$(printf '%s' "$input" | jq -r '.cwd // empty')
fi
project_dir="${project_dir:-$(pwd)}"
root_dir=$(git -C "$project_dir" rev-parse --show-toplevel 2>/dev/null || printf '%s' "$project_dir")
cd "$root_dir"

session_id=$(echo "$input" | jq -r '.session_id // empty')

# Only check files changed by THIS session (tracked by PostToolUse hook)
SESSION_FILE="/tmp/arena-session-${session_id}.files"
[ -z "$session_id" ] && exit 0
[ ! -f "$SESSION_FILE" ] && exit 0
CHANGED=$(sort -u "$SESSION_FILE")

[ -z "$CHANGED" ] && exit 0

# Check paths that require rebuild/restart (governance uses dev mode with HMR, only prisma/deps need action)
RELEVANT=$(echo "$CHANGED" | grep -E '^(apps/governance-platform/(prisma/|package(-lock)?\.json)|services/(worker-agent|api-proxy|arena-runner)/|packages/loops/ralph-runtime/|services/authd/(src/|package(-lock)?\.json|tsconfig\.json|Dockerfile)|infra/caddy/|docker-compose\.local\.yml$)' || true)
[ -z "$RELEVANT" ] && exit 0

# Agent can acknowledge by writing diff hash to skip until files change
ACK_FILE="/tmp/arena-rebuild-ack-${session_id:-global}"
path_signature() {
  local path="$1"
  if [ -f "$path" ]; then
    shasum "$path" | awk '{print $1}'
    return
  fi
  if [ -e "$path" ]; then
    stat -f '%m:%z' "$path" 2>/dev/null || stat -c '%Y:%s' "$path" 2>/dev/null || echo "__exists__"
    return
  fi
  echo "__missing__"
}
DIFF_INPUT=$(
  while IFS= read -r path; do
    [ -n "$path" ] || continue
    printf '%s\t%s\n' "$path" "$(path_signature "$path")"
  done <<< "$RELEVANT"
)
DIFF_HASH=$(echo "$DIFF_INPUT" | md5 -q 2>/dev/null || echo "$DIFF_INPUT" | md5sum 2>/dev/null | cut -d' ' -f1)
COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-agents-arena}"
if [ -f "$ACK_FILE" ] && [ "$(cat "$ACK_FILE")" = "$DIFF_HASH" ]; then
  exit 0
fi

REMINDERS=""

add() { REMINDERS="${REMINDERS:+$REMINDERS\n}• $1"; }

# Governance: dev mode with HMR — src/ changes are picked up automatically, only prisma/deps need action
echo "$RELEVANT" | grep -q '^apps/governance-platform/prisma/' && \
  add "Prisma schema changed → run inside container: ARENA_ACK_MULTIPLE_DB_VOLUMES=1 ./scripts/docker-local-stack.sh exec governance-platform sh -c 'cd apps/governance-platform && npx prisma migrate dev' && then restart to reset cached PrismaClient: ARENA_ACK_MULTIPLE_DB_VOLUMES=1 ./scripts/docker-local-stack.sh restart governance-platform"

echo "$RELEVANT" | grep -qE '^apps/governance-platform/package(-lock)?\.json$' && \
  add "governance deps changed → remove service container, remove node_modules volume, then recreate service: ARENA_ACK_MULTIPLE_DB_VOLUMES=1 ./scripts/docker-local-stack.sh rm -sf governance-platform && docker volume rm ${COMPOSE_PROJECT_NAME}_governance_node_modules && ARENA_ACK_MULTIPLE_DB_VOLUMES=1 ./scripts/docker-local-stack.sh up -d governance-platform"

# Services: volume-mounted, need restart
echo "$RELEVANT" | grep -q '^services/worker-agent/src/' && \
  add "worker-agent code changed → ARENA_ACK_MULTIPLE_DB_VOLUMES=1 ./scripts/docker-local-stack.sh restart worker-agent"

echo "$RELEVANT" | grep -qE '^services/worker-agent/package(-lock)?\.json$' && \
  add "worker-agent deps changed → remove service container, remove node_modules volume, then recreate service: ARENA_ACK_MULTIPLE_DB_VOLUMES=1 ./scripts/docker-local-stack.sh rm -sf worker-agent && docker volume rm ${COMPOSE_PROJECT_NAME}_worker_agent_node_modules && ARENA_ACK_MULTIPLE_DB_VOLUMES=1 ./scripts/docker-local-stack.sh up -d worker-agent"

echo "$RELEVANT" | grep -q '^services/api-proxy/src/' && \
  add "api-proxy code changed → ARENA_ACK_MULTIPLE_DB_VOLUMES=1 ./scripts/docker-local-stack.sh restart api-proxy"

echo "$RELEVANT" | grep -qE '^services/api-proxy/package(-lock)?\.json$' && \
  add "api-proxy deps changed → remove service container, remove node_modules volume, then recreate service: ARENA_ACK_MULTIPLE_DB_VOLUMES=1 ./scripts/docker-local-stack.sh rm -sf api-proxy && docker volume rm ${COMPOSE_PROJECT_NAME}_api_proxy_node_modules && ARENA_ACK_MULTIPLE_DB_VOLUMES=1 ./scripts/docker-local-stack.sh up -d api-proxy"

echo "$RELEVANT" | grep -qE '^services/arena-runner/(src/|package(-lock)?\.json|tsconfig\.json|placeholder-server\.cjs$)' && \
  add "arena-runner changed → ARENA_ACK_MULTIPLE_DB_VOLUMES=1 ./scripts/docker-local-stack.sh build worker, then restart affected preview containers so they remount fresh /arena dist"

echo "$RELEVANT" | grep -q '^packages/loops/ralph-runtime/' && \
  add "bundled Ralph runtime changed → ARENA_ACK_MULTIPLE_DB_VOLUMES=1 ./scripts/docker-local-stack.sh build worker && ARENA_ACK_MULTIPLE_DB_VOLUMES=1 ./scripts/docker-local-stack.sh restart worker-agent, then recreate affected preview runtimes through the operator surface so they use fresh /ralph dist"

echo "$RELEVANT" | grep -q '^services/worker-agent/Dockerfile\.worker$' && \
  add "worker image Dockerfile changed → ARENA_ACK_MULTIPLE_DB_VOLUMES=1 ./scripts/docker-local-stack.sh build worker"

echo "$RELEVANT" | grep -q '^services/worker-agent/Dockerfile\.worker\.openclaw$' && \
  add "worker openclaw Dockerfile changed → ARENA_ACK_MULTIPLE_DB_VOLUMES=1 ./scripts/docker-local-stack.sh build worker-openclaw"

echo "$RELEVANT" | grep -qE '^services/authd/(src/|package(-lock)?\.json|tsconfig\.json|Dockerfile)' && \
  add "authd changed → ARENA_ACK_MULTIPLE_DB_VOLUMES=1 ./scripts/docker-local-stack.sh build authd && ARENA_ACK_MULTIPLE_DB_VOLUMES=1 ./scripts/docker-local-stack.sh up -d authd"

echo "$RELEVANT" | grep -q '^infra/caddy/Caddyfile\.local' && \
  add "Caddy config changed → ARENA_ACK_MULTIPLE_DB_VOLUMES=1 ./scripts/docker-local-stack.sh restart caddy"

echo "$RELEVANT" | grep -q '^docker-compose\.local\.yml$' && \
  add "docker-compose.local.yml changed → recreate affected services with ARENA_ACK_MULTIPLE_DB_VOLUMES=1 ./scripts/docker-local-stack.sh up -d --build"

[ -z "$REMINDERS" ] && exit 0

MSG=$(printf "[rebuild-reminder] Project runs in Docker (docker-compose.local.yml). Governance uses dev mode (HMR for src/ changes). Actions needed:\n$REMINDERS\nAcknowledge to suppress until diff changes: echo $DIFF_HASH > $ACK_FILE")

jq -n --arg ctx "$MSG" '{
  decision: "block",
  reason: $ctx
}'
