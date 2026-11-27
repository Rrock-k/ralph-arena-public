#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
COMPOSE_FILE="$ROOT_DIR/docker-compose.local.yml"
PROJECT_NAME_DEFAULT="arena-public-review"

if ! command -v docker >/dev/null 2>&1; then
  echo "docker command not found" >&2
  exit 1
fi

# Load env defaults from root and governance .env files.
# Shell-exported vars always take precedence (no-override convention).
load_env_no_override() {
  local file="$1"
  [ -f "$file" ] || return 0
  while IFS= read -r line || [ -n "$line" ]; do
    [[ "$line" =~ ^[[:space:]]*# ]] && continue
    [[ -z "${line// }" ]] && continue
    local key="${line%%=*}"
    [ -z "$key" ] && continue
    if [ -z "${!key+x}" ]; then
      local val="${line#*=}"
      # Strip surrounding quotes (single or double), matching dotenv convention
      if [[ "$val" =~ ^\"(.*)\"$ ]] || [[ "$val" =~ ^\'(.*)\'$ ]]; then
        val="${BASH_REMATCH[1]}"
      fi
      export "$key=$val"
    fi
  done < "$file"
}

load_env_no_override "$ROOT_DIR/.env"
load_env_no_override "$ROOT_DIR/.env.local"
load_env_no_override "$ROOT_DIR/apps/governance-platform/.env"
load_env_no_override "$ROOT_DIR/apps/governance-platform/.env.local"

command_word="${1:-up}"
target_word="${2:-}"
export COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-$PROJECT_NAME_DEFAULT}"

if [ "$command_word" = "inspect" ] && [ "$target_word" = "topology" ]; then
  shift 2
  exec node "$ROOT_DIR/scripts/governance-rollout-local-topology.mjs" \
    --project-name "$COMPOSE_PROJECT_NAME" \
    --compose-file "$COMPOSE_FILE" \
    "$@"
fi

export ARENA_HOST_PATH="${ARENA_HOST_PATH:-$ROOT_DIR}"
export ARENA_HOME_PATH="${ARENA_HOME_PATH:-$ROOT_DIR/runtime/public-home}"
export ARENA_PROJECT_WORKSPACES_ROOT="${ARENA_PROJECT_WORKSPACES_ROOT:-$ARENA_HOME_PATH/.arena-public-review-runtime/project-workspaces}"
export ARENA_PROJECT_DATA_ROOT="${ARENA_PROJECT_DATA_ROOT:-$ARENA_HOME_PATH/.arena-public-review-runtime/project-data}"
# Governance asset bytes live here; without this the container falls back to a
# non-writable in-image path (/app/runtime) and every asset upload fails EACCES.
export ARENA_PROJECT_ASSETS_ROOT="${ARENA_PROJECT_ASSETS_ROOT:-$ROOT_DIR/runtime/project-assets}"
default_backup_root_parent="$ROOT_DIR/runtime"
export ARENA_WORKSPACE_BACKUP_ROOT="${ARENA_WORKSPACE_BACKUP_ROOT:-$default_backup_root_parent/runtime-backup-pre-ra-237}"
export ARENA_DB_BACKUP_ROOT="${ARENA_DB_BACKUP_ROOT:-$ROOT_DIR/runtime/db-backups}"
export ARENA_UID="${ARENA_UID:-$(id -u)}"
export ARENA_GID="${ARENA_GID:-$(id -g)}"
export CLOUDFLARED_TUNNEL_ID="${CLOUDFLARED_TUNNEL_ID:-00000000-0000-4000-8000-000000000000}"
export CLOUDFLARED_CREDENTIALS_FILE="${CLOUDFLARED_CREDENTIALS_FILE:-$ARENA_HOME_PATH/.cloudflared/$CLOUDFLARED_TUNNEL_ID.json}"

export RUNNER_CODEX_CONFIG_DIR="${RUNNER_CODEX_CONFIG_DIR:-$ARENA_HOME_PATH/.codex}"
export ARENA_BOT_AUTOMATIONS_DIR="${ARENA_BOT_AUTOMATIONS_DIR:-$ARENA_HOME_PATH/.codex/automations}"
export ARENA_BOT_WEEKLY_DIGEST_AUTOMATION_DIR="${ARENA_BOT_WEEKLY_DIGEST_AUTOMATION_DIR:-$ARENA_HOME_PATH/.codex/automations/ralph-weekly-instruction-maintenance}"
export ARENA_BOT_DIGEST_SOURCE_FILES="${ARENA_BOT_DIGEST_SOURCE_FILES:-}"
export ARENA_BOT_DIGEST_MAX_AGE_HOURS="${ARENA_BOT_DIGEST_MAX_AGE_HOURS:-48}"
export CODEX_CLI_VERSION="${CODEX_CLI_VERSION:-0.144.4}"
export CLAUDE_CODE_CLI_VERSION="${CLAUDE_CODE_CLI_VERSION:-2.1.212}"
export OPENCLAW_CLI_VERSION="${OPENCLAW_CLI_VERSION:-2026.5.28}"
export OPENCODE_CLI_VERSION="${OPENCODE_CLI_VERSION:-1.16.2}"
export ANTIGRAVITY_CLI_VERSION="${ANTIGRAVITY_CLI_VERSION:-1.0.0}"

# External loop repositories must be supplied explicitly.

mkdir -p "$ARENA_PROJECT_WORKSPACES_ROOT" "$ARENA_PROJECT_DATA_ROOT" "$ARENA_DB_BACKUP_ROOT" "$ARENA_BOT_AUTOMATIONS_DIR" "$ARENA_BOT_WEEKLY_DIGEST_AUTOMATION_DIR"

build_worker_image() {
  local image_tag="$1"
  local dockerfile_path="$2"
  shift 2
  local cli_build_args=()

  if [ "$image_tag" = "arena-public-worker:local" ]; then
    cli_build_args+=(
      --build-arg "CODEX_CLI_VERSION=$CODEX_CLI_VERSION"
      --build-arg "CLAUDE_CODE_CLI_VERSION=$CLAUDE_CODE_CLI_VERSION"
      --build-arg "OPENCLAW_CLI_VERSION=$OPENCLAW_CLI_VERSION"
      --build-arg "OPENCODE_CLI_VERSION=$OPENCODE_CLI_VERSION"
      --build-arg "ANTIGRAVITY_CLI_VERSION=$ANTIGRAVITY_CLI_VERSION"
    )
  elif [ "$image_tag" = "arena-public-worker-openclaw:local" ]; then
    cli_build_args+=(
      --build-arg "OPENCLAW_CLI_VERSION=$OPENCLAW_CLI_VERSION"
    )
  fi

  echo "[docker-local-stack] Building fresh arena-runner dist for worker image..."
  (cd "$ROOT_DIR/services/arena-runner" && npm run build)

  echo "[docker-local-stack] Building worker image: $image_tag"
  docker build "${cli_build_args[@]}" "$@" -t "$image_tag" -f "$dockerfile_path" "$ROOT_DIR"
}

build_authd_image() {
  local compose_build_args=()
  local arg=""

  # authd inherits the local arena-public-worker:local base, so --pull would try to
  # fetch that local tag from a registry and fail.
  for arg in "$@"; do
    if [ "$arg" = "--pull" ]; then
      continue
    fi
    compose_build_args+=("$arg")
  done

  echo "[docker-local-stack] Building authd image from current arena-public-worker:local base..."
  if [ "${#compose_build_args[@]}" -gt 0 ]; then
    docker compose -p "$COMPOSE_PROJECT_NAME" -f "$COMPOSE_FILE" build "${compose_build_args[@]}" authd
  else
    docker compose -p "$COMPOSE_PROJECT_NAME" -f "$COMPOSE_FILE" build authd
  fi
}

build_governance_image() {
  local image_tag="${GOVERNANCE_IMAGE:-arena-public-governance:local}"
  local source_sha=""
  local archive_root=""
  local source_root=""
  local archive_tar=""
  local docker_status=0

  source_sha="$(git -C "$ROOT_DIR" rev-parse --short=12 HEAD)"
  archive_root="$(mktemp -d "${TMPDIR:-/tmp}/arena-governance-head-build.XXXXXX")"
  source_root="$archive_root/source"
  archive_tar="$archive_root/source.tar"
  mkdir -p "$source_root"

  echo "[docker-local-stack] Archiving committed HEAD $source_sha for governance production image."
  git -C "$ROOT_DIR" archive --format=tar --output "$archive_tar" HEAD
  tar -xf "$archive_tar" -C "$source_root"

  echo "[docker-local-stack] Building governance production image from committed HEAD: $image_tag"
  docker build \
    "$@" \
    --build-arg "GOVERNANCE_SOURCE_SHA=$source_sha" \
    -t "$image_tag" \
    -f "$source_root/apps/governance-platform/Dockerfile.local-production" \
    "$source_root" || docker_status=$?

  rm -rf "$archive_root"
  return "$docker_status"
}

arg_has() {
  local expected="$1"
  local arg=""

  shift
  for arg in "$@"; do
    if [ "$arg" = "$expected" ]; then
      return 0
    fi
  done

  return 1
}

compose_targets_governance() {
  local command_seen=0
  local target_count=0
  local arg=""

  for arg in "$@"; do
    if [ "$command_seen" -eq 0 ]; then
      command_seen=1
      continue
    fi

    case "$arg" in
      -*)
        continue
        ;;
      governance-platform)
        return 0
        ;;
      *)
        target_count=$((target_count + 1))
        ;;
    esac
  done

  [ "$target_count" -eq 0 ]
}

governance_image_source_sha() {
  local image_tag="$1"
  local source_sha=""

  source_sha="$(docker image inspect \
    --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}' \
    "$image_tag" 2>/dev/null || true)"

  if [ "$source_sha" = "<no value>" ]; then
    source_sha=""
  fi

  printf '%s\n' "$source_sha"
}

is_default_governance_image() {
  [ "$1" = "arena-public-governance:local" ]
}

ensure_governance_image_available_for_current_head() {
  local image_tag="$1"
  local source_sha=""
  local image_source_sha=""

  source_sha="$(git -C "$ROOT_DIR" rev-parse --short=12 HEAD)"
  image_source_sha="$(governance_image_source_sha "$image_tag")"

  if is_default_governance_image "$image_tag" && [ "$image_source_sha" != "$source_sha" ]; then
    build_governance_image
    return 0
  fi

  if ! docker image inspect "$image_tag" >/dev/null 2>&1; then
    echo "[docker-local-stack] Governance image not found: $image_tag" >&2
    echo "[docker-local-stack] Build it first or use the default local governance image." >&2
    exit 1
  fi
}

ensure_governance_image_for_compose() {
  local image_tag="${GOVERNANCE_IMAGE:-arena-public-governance:local}"

  if [ "$command_word" != "up" ] && [ "$command_word" != "create" ]; then
    return 0
  fi

  if ! compose_targets_governance "$@"; then
    return 0
  fi

  if arg_has "--build" "$@"; then
    build_governance_image
    return 0
  fi

  ensure_governance_image_available_for_current_head "$image_tag"
}

governance_readiness_marker_source_sha() {
  local image_tag="${GOVERNANCE_IMAGE:-arena-public-governance:local}"
  local image_source_sha=""

  if { [ "$command_word" = "up" ] || [ "$command_word" = "create" ]; } && compose_targets_governance "$@"; then
    image_source_sha="$(governance_image_source_sha "$image_tag")"
    if [ -n "$image_source_sha" ]; then
      printf '%s\n' "$image_source_sha"
      return 0
    fi

    if [ -n "${GOVERNANCE_BUILD_ID:-}" ] && [ -n "${GOVERNANCE_RELEASE_SHA:-}" ]; then
      git -C "$ROOT_DIR" rev-parse --short=12 HEAD
      return 0
    fi

    echo "[docker-local-stack] Governance image lacks org.opencontainers.image.revision; cannot default readiness build/release markers honestly." >&2
    echo "[docker-local-stack] Rebuild through ./scripts/docker-local-stack.sh build governance-image or set GOVERNANCE_BUILD_ID and GOVERNANCE_RELEASE_SHA explicitly." >&2
    exit 1
  fi

  git -C "$ROOT_DIR" rev-parse --short=12 HEAD
}

ensure_governance_readiness_marker_env_for_compose() {
  local source_sha=""

  if [ "$command_word" != "up" ] && [ "$command_word" != "create" ] && [ "$command_word" != "config" ]; then
    return 0
  fi

  if ! compose_targets_governance "$@"; then
    return 0
  fi

  source_sha="$(governance_readiness_marker_source_sha "$@")"
  export GOVERNANCE_SLOT_ID="${GOVERNANCE_SLOT_ID:-local}"
  export GOVERNANCE_SCHEDULER_ROLE="${GOVERNANCE_SCHEDULER_ROLE:-active}"
  export GOVERNANCE_BUILD_ID="${GOVERNANCE_BUILD_ID:-$source_sha}"
  export GOVERNANCE_RELEASE_SHA="${GOVERNANCE_RELEASE_SHA:-$source_sha}"
  export GOVERNANCE_MIGRATION_STATUS="${GOVERNANCE_MIGRATION_STATUS:-not_required}"
}

start_governance_canary() {
  local image_tag="${GOVERNANCE_IMAGE:-arena-public-governance:local}"
  local slot_id="${GOVERNANCE_CANARY_SLOT_ID:-green}"
  local port="${GOVERNANCE_CANARY_PORT:-3006}"
  local scheduler_role="${GOVERNANCE_CANARY_SCHEDULER_ROLE:-standby}"
  local artifact_sha=""
  local build_id=""
  local release_sha=""
  local migration_status="${GOVERNANCE_CANARY_MIGRATION_STATUS:-not_required}"
  local container_name="${GOVERNANCE_CANARY_CONTAINER:-agents-arena-governance-canary-$slot_id}"
  local active_container=""
  local env_file=""
  local key=""

  if [ "$port" = "3000" ]; then
    echo "[docker-local-stack] Refusing canary on active governance port 3000." >&2
    exit 1
  fi

  if docker inspect "$container_name" >/dev/null 2>&1; then
    echo "[docker-local-stack] Canary container already exists: $container_name" >&2
    echo "[docker-local-stack] Stop/remove it explicitly before starting another canary with the same name." >&2
    exit 1
  fi

  ensure_governance_image_available_for_current_head "$image_tag"

  artifact_sha="$(governance_image_source_sha "$image_tag")"
  if [ -z "$artifact_sha" ]; then
    if [ -z "${GOVERNANCE_CANARY_BUILD_ID:-}" ] || [ -z "${GOVERNANCE_CANARY_RELEASE_SHA:-}" ]; then
      echo "[docker-local-stack] Governance canary image lacks org.opencontainers.image.revision; set GOVERNANCE_CANARY_BUILD_ID and GOVERNANCE_CANARY_RELEASE_SHA explicitly." >&2
      exit 1
    fi
    artifact_sha="$(git -C "$ROOT_DIR" rev-parse --short=12 HEAD)"
  fi

  build_id="${GOVERNANCE_CANARY_BUILD_ID:-$artifact_sha}"
  release_sha="${GOVERNANCE_CANARY_RELEASE_SHA:-$artifact_sha}"

  active_container="$(docker compose -p "$COMPOSE_PROJECT_NAME" -f "$COMPOSE_FILE" ps -q governance-platform 2>/dev/null || true)"
  if [ -z "$active_container" ]; then
    echo "[docker-local-stack] Active governance-platform container is required to seed canary env." >&2
    exit 1
  fi

  env_file="$(mktemp "${TMPDIR:-/tmp}/arena-governance-canary-env.XXXXXX")"
  chmod 0600 "$env_file"
  trap 'rm -f "$env_file"' RETURN

  while IFS= read -r line || [ -n "$line" ]; do
    key="${line%%=*}"
    case "$key" in
      PORT|APP_PORT|HOSTNAME|GOVERNANCE_SLOT_ID|GOVERNANCE_SCHEDULER_ROLE|GOVERNANCE_BUILD_ID|GOVERNANCE_RELEASE_SHA|GOVERNANCE_MIGRATION_STATUS)
        continue
        ;;
    esac
    printf '%s\n' "$line" >> "$env_file"
  done < <(docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$active_container")

  {
    printf 'PORT=3000\n'
    printf 'APP_PORT=3000\n'
    printf 'HOSTNAME=0.0.0.0\n'
    printf 'GOVERNANCE_SLOT_ID=%s\n' "$slot_id"
    printf 'GOVERNANCE_SCHEDULER_ROLE=%s\n' "$scheduler_role"
    printf 'GOVERNANCE_BUILD_ID=%s\n' "$build_id"
    printf 'GOVERNANCE_RELEASE_SHA=%s\n' "$release_sha"
    printf 'GOVERNANCE_MIGRATION_STATUS=%s\n' "$migration_status"
  } >> "$env_file"

  echo "[docker-local-stack] Starting governance canary $container_name from $image_tag on 127.0.0.1:$port"
  docker run -d \
    --name "$container_name" \
    --network arena-public-network \
    --restart no \
    --env-file "$env_file" \
    --label "ra.task=RA-344" \
    --label "ra.role=governance-canary" \
    --label "ra.slot=$slot_id" \
    -p "127.0.0.1:$port:3000" \
    -v "$ARENA_PROJECT_WORKSPACES_ROOT:$ARENA_PROJECT_WORKSPACES_ROOT" \
    -v "$ARENA_WORKSPACE_BACKUP_ROOT:$ARENA_WORKSPACE_BACKUP_ROOT" \
    -v "$ARENA_DB_BACKUP_ROOT:$ARENA_DB_BACKUP_ROOT" \
    "$image_tag"

  echo "[docker-local-stack] Governance canary readiness URL: http://127.0.0.1:$port/api/readiness"
}

inspect_governance_canary() {
  local slot_id="${GOVERNANCE_CANARY_SLOT_ID:-green}"
  local container_name="${GOVERNANCE_CANARY_CONTAINER:-agents-arena-governance-canary-$slot_id}"

  if ! docker inspect "$container_name" >/dev/null 2>&1; then
    echo "[docker-local-stack] Canary container not found: $container_name" >&2
    exit 1
  fi

  docker inspect \
    --format 'name={{.Name}} status={{.State.Status}} running={{.State.Running}} exitCode={{.State.ExitCode}} startedAt={{.State.StartedAt}} finishedAt={{.State.FinishedAt}} image={{.Config.Image}} ports={{json .NetworkSettings.Ports}}' \
    "$container_name"
}

logs_governance_canary() {
  local slot_id="${GOVERNANCE_CANARY_SLOT_ID:-green}"
  local container_name="${GOVERNANCE_CANARY_CONTAINER:-agents-arena-governance-canary-$slot_id}"
  local tail="${GOVERNANCE_CANARY_LOG_TAIL:-120}"

  if ! docker inspect "$container_name" >/dev/null 2>&1; then
    echo "[docker-local-stack] Canary container not found: $container_name" >&2
    exit 1
  fi

  docker logs --tail "$tail" "$container_name"
}

stop_governance_canary() {
  local slot_id="${GOVERNANCE_CANARY_SLOT_ID:-green}"
  local container_name="${GOVERNANCE_CANARY_CONTAINER:-agents-arena-governance-canary-$slot_id}"

  if ! docker inspect "$container_name" >/dev/null 2>&1; then
    echo "[docker-local-stack] Canary container not found: $container_name"
    return 0
  fi

  echo "[docker-local-stack] Stopping governance canary $container_name"
  docker stop "$container_name" >/dev/null
}

remove_governance_canary() {
  local slot_id="${GOVERNANCE_CANARY_SLOT_ID:-green}"
  local container_name="${GOVERNANCE_CANARY_CONTAINER:-agents-arena-governance-canary-$slot_id}"
  local task_label=""
  local role_label=""
  local running=""

  if ! docker inspect "$container_name" >/dev/null 2>&1; then
    echo "[docker-local-stack] Canary container not found: $container_name"
    return 0
  fi

  task_label="$(docker inspect -f '{{ index .Config.Labels "ra.task" }}' "$container_name")"
  role_label="$(docker inspect -f '{{ index .Config.Labels "ra.role" }}' "$container_name")"
  if [ "$task_label" != "RA-344" ] || [ "$role_label" != "governance-canary" ]; then
    echo "[docker-local-stack] Refusing to remove $container_name; labels are not RA-344 governance-canary." >&2
    echo "[docker-local-stack] Found labels: ra.task=$task_label ra.role=$role_label" >&2
    exit 1
  fi

  running="$(docker inspect -f '{{.State.Running}}' "$container_name")"
  if [ "$running" = "true" ] && [ "${GOVERNANCE_CANARY_FORCE:-}" != "1" ]; then
    echo "[docker-local-stack] Refusing to remove running canary $container_name." >&2
    echo "[docker-local-stack] Stop it first, or set GOVERNANCE_CANARY_FORCE=1 for explicit forced cleanup." >&2
    exit 1
  fi

  echo "[docker-local-stack] Removing governance canary $container_name"
  if [ "$running" = "true" ]; then
    docker rm -f "$container_name" >/dev/null
  else
    docker rm "$container_name" >/dev/null
  fi
}

switch_governance_caddy_upstream() {
  local upstream="${GOVERNANCE_CADDY_UPSTREAM:-}"
  local host=""
  local port=""
  local caddy_container=""
  local rendered_config=""

  if [[ ! "$upstream" =~ ^[A-Za-z0-9._-]+:[0-9]+$ ]]; then
    echo "[docker-local-stack] GOVERNANCE_CADDY_UPSTREAM must look like host:port." >&2
    exit 1
  fi

  host="${upstream%:*}"
  port="${upstream##*:}"
  rendered_config="$(mktemp "${TMPDIR:-/tmp}/arena-caddy-upstream.XXXXXX")"
  trap 'rm -f "$rendered_config"' RETURN

  sed \
    -e "s/dynamic a governance-platform 3000/dynamic a $host $port/g" \
    -e "s/governance-platform:3000/$host:$port/g" \
    "$ROOT_DIR/infra/caddy/Caddyfile.local" > "$rendered_config"

  if ! grep -q "$host" "$rendered_config"; then
    echo "[docker-local-stack] Rendered Caddyfile does not contain requested upstream." >&2
    exit 1
  fi

  caddy_container="$(docker compose -p "$COMPOSE_PROJECT_NAME" -f "$COMPOSE_FILE" ps -q caddy 2>/dev/null || true)"
  if [ -z "$caddy_container" ]; then
    echo "[docker-local-stack] Caddy container is required for upstream switch." >&2
    exit 1
  fi

  echo "[docker-local-stack] Reloading Caddy governance upstream to $upstream"
  docker cp "$rendered_config" "$caddy_container:/tmp/Caddyfile.ra344"
  docker exec "$caddy_container" caddy validate --config /tmp/Caddyfile.ra344
  docker exec "$caddy_container" caddy reload --config /tmp/Caddyfile.ra344
}

rollback_governance_caddy_upstream() {
  local caddy_container=""

  caddy_container="$(docker compose -p "$COMPOSE_PROJECT_NAME" -f "$COMPOSE_FILE" ps -q caddy 2>/dev/null || true)"
  if [ -z "$caddy_container" ]; then
    echo "[docker-local-stack] Caddy container is required for upstream rollback." >&2
    exit 1
  fi

  echo "[docker-local-stack] Reloading Caddy governance upstream from mounted /etc/caddy/Caddyfile"
  docker exec "$caddy_container" caddy validate --config /etc/caddy/Caddyfile
  docker exec "$caddy_container" caddy reload --config /etc/caddy/Caddyfile
}

print_worker_agent_restart_notice() {
  local service_name="$1"
  local container_id=""

  container_id="$(docker compose -p "$COMPOSE_PROJECT_NAME" -f "$COMPOSE_FILE" ps -q "$service_name" 2>/dev/null || true)"
  if [ -z "$container_id" ]; then
    return 0
  fi

  echo "[docker-local-stack] NOTE: build finished, but the running $service_name process was not restarted."
  echo "[docker-local-stack] Recreate or restart it when you want the running container/process to pick up the refreshed image/runtime:"
  echo "[docker-local-stack]   ./scripts/docker-local-stack.sh up -d --force-recreate $service_name"
}

# Guard against accidental data wipe via volume deletion.
if [ "$command_word" = "down" ] && printf '%s\n' "$*" | rg -q -- '(^|[[:space:]])-v($|[[:space:]])'; then
  if [ "${ARENA_ALLOW_DB_VOLUME_DROP:-}" != "1" ]; then
    echo "[docker-local-stack] Refusing 'down -v' without ARENA_ALLOW_DB_VOLUME_DROP=1."
    echo "Set ARENA_ALLOW_DB_VOLUME_DROP=1 only when you explicitly want to delete Postgres data volumes."
    exit 1
  fi
fi

if [ "$command_word" = "build" ] && [ "$target_word" = "governance-image" ]; then
  shift 2
  build_governance_image "$@"
  echo "[docker-local-stack] Governance image is ready for inactive-slot canary containers."
  exit 0
fi

# Guard against ambiguous source-of-truth when both old and current pgdata volumes exist.
legacy_volume="governance-platform_pgdata"
expected_volume="${COMPOSE_PROJECT_NAME}_pgdata"
if docker volume inspect "$legacy_volume" >/dev/null 2>&1 && docker volume inspect "$expected_volume" >/dev/null 2>&1; then
  if [ "${ARENA_ACK_MULTIPLE_DB_VOLUMES:-}" != "1" ]; then
    echo "[docker-local-stack] Found both '$expected_volume' and legacy '$legacy_volume'."
    echo "This can load stale data. Remove legacy volume or set ARENA_ACK_MULTIPLE_DB_VOLUMES=1."
    echo "If intentional, re-run with ARENA_ACK_MULTIPLE_DB_VOLUMES=1."
    exit 1
  fi
fi

if ! docker network inspect arena-public-network >/dev/null 2>&1; then
  echo "[docker-local-stack] Creating missing network: arena-public-network"
  docker network create arena-public-network >/dev/null
fi

if [ "$command_word" = "start" ] && [ "$target_word" = "governance-canary" ]; then
  shift 2
  start_governance_canary "$@"
  exit 0
fi

if [ "$command_word" = "inspect" ] && [ "$target_word" = "governance-canary" ]; then
  shift 2
  inspect_governance_canary "$@"
  exit 0
fi

if [ "$command_word" = "logs" ] && [ "$target_word" = "governance-canary" ]; then
  shift 2
  logs_governance_canary "$@"
  exit 0
fi

if [ "$command_word" = "stop" ] && [ "$target_word" = "governance-canary" ]; then
  shift 2
  stop_governance_canary "$@"
  exit 0
fi

if [ "$command_word" = "remove" ] && [ "$target_word" = "governance-canary" ]; then
  shift 2
  remove_governance_canary "$@"
  exit 0
fi

if [ "$command_word" = "switch" ] && [ "$target_word" = "governance-caddy-upstream" ]; then
  shift 2
  switch_governance_caddy_upstream "$@"
  exit 0
fi

if [ "$command_word" = "rollback" ] && [ "$target_word" = "governance-caddy-upstream" ]; then
  shift 2
  rollback_governance_caddy_upstream "$@"
  exit 0
fi

# Configuration inspection and the isolated test container do not need worker images.
if [ "$command_word" = "config" ]; then
  exec docker compose -p "$COMPOSE_PROJECT_NAME" -f "$COMPOSE_FILE" "$@"
fi
if [ "$command_word" = "verify" ]; then
  shift
  exec docker compose -p "$COMPOSE_PROJECT_NAME" -f "$COMPOSE_FILE" run --rm --no-deps --entrypoint sh verification -c "$*"
fi

# Build shared contracts (needed by arena-runner)
if [ ! -d "$ROOT_DIR/packages/contracts/dist" ]; then
  echo "[docker-local-stack] Building @arena/contracts..."
  (cd "$ROOT_DIR/packages/contracts" && npm ci && npm run build)
fi

# RA-083: Build arena-runner dist (needed by Dockerfile.worker COPY)
if [ ! -d "$ROOT_DIR/services/arena-runner/dist" ]; then
  echo "[docker-local-stack] Building arena-runner dist..."
  (cd "$ROOT_DIR/services/arena-runner" && npm ci && npm run build)
fi

if ! docker image inspect arena-public-worker:local >/dev/null 2>&1; then
  echo "[docker-local-stack] Building missing worker image: arena-public-worker:local"
  build_cmd=(
    docker build
    --build-arg "CODEX_CLI_VERSION=$CODEX_CLI_VERSION"
    --build-arg "CLAUDE_CODE_CLI_VERSION=$CLAUDE_CODE_CLI_VERSION"
    --build-arg "OPENCLAW_CLI_VERSION=$OPENCLAW_CLI_VERSION"
    --build-arg "OPENCODE_CLI_VERSION=$OPENCODE_CLI_VERSION"
    --build-arg "ANTIGRAVITY_CLI_VERSION=$ANTIGRAVITY_CLI_VERSION"
    -t arena-public-worker:local
    -f "$ROOT_DIR/services/worker-agent/Dockerfile.worker"
  )
  build_cmd+=("$ROOT_DIR")
  "${build_cmd[@]}"
fi

if ! docker image inspect arena-public-worker-openclaw:local >/dev/null 2>&1; then
  echo "[docker-local-stack] Building missing worker image: arena-public-worker-openclaw:local"
  docker build \
    --build-arg "OPENCLAW_CLI_VERSION=$OPENCLAW_CLI_VERSION" \
    -t arena-public-worker-openclaw:local \
    -f "$ROOT_DIR/services/worker-agent/Dockerfile.worker.openclaw" \
    "$ROOT_DIR"
fi

if [ "$command_word" = "build" ] && [ "$target_word" = "worker" ]; then
  shift 2
  build_worker_image "arena-public-worker:local" "$ROOT_DIR/services/worker-agent/Dockerfile.worker" "$@"
  print_worker_agent_restart_notice "worker-agent"
  exit 0
fi

if [ "$command_word" = "build" ] && [ "$target_word" = "worker-openclaw" ]; then
  shift 2
  build_worker_image "arena-public-worker-openclaw:local" "$ROOT_DIR/services/worker-agent/Dockerfile.worker.openclaw" "$@"
  print_worker_agent_restart_notice "worker-agent"
  exit 0
fi

if [ "$command_word" = "build" ] && [ "$target_word" = "authd" ]; then
  shift 2
  build_authd_image "$@"
  print_worker_agent_restart_notice "authd"
  exit 0
fi

if [ "$command_word" = "refresh" ] && [ "$target_word" = "agent-clis" ]; then
  shift 2
  build_worker_image "arena-public-worker:local" "$ROOT_DIR/services/worker-agent/Dockerfile.worker" --pull --no-cache "$@"
  build_worker_image "arena-public-worker-openclaw:local" "$ROOT_DIR/services/worker-agent/Dockerfile.worker.openclaw" --pull --no-cache "$@"
  build_authd_image --pull --no-cache "$@"
  print_worker_agent_restart_notice "worker-agent"
  print_worker_agent_restart_notice "authd"
  echo "[docker-local-stack] Agent CLI refresh built fresh images."
  echo "[docker-local-stack] Requested versions: codex=$CODEX_CLI_VERSION claude-code=$CLAUDE_CODE_CLI_VERSION openclaw=$OPENCLAW_CLI_VERSION opencode=$OPENCODE_CLI_VERSION antigravity=$ANTIGRAVITY_CLI_VERSION"
  echo "[docker-local-stack] Recreate running consumers when ready:"
  echo "[docker-local-stack]   ./scripts/docker-local-stack.sh up -d authd"
  echo "[docker-local-stack] Existing preview runtimes keep their old image until recreated through the operator surface."
  exit 0
fi

ensure_governance_image_for_compose "$@"
ensure_governance_readiness_marker_env_for_compose "$@"

exec docker compose -p "$COMPOSE_PROJECT_NAME" -f "$COMPOSE_FILE" "$@"
