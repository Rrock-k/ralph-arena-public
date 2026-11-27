#!/usr/bin/env bash

ARENA_CTL_ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

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
      if [[ "$val" =~ ^\"(.*)\"$ ]] || [[ "$val" =~ ^\'(.*)\'$ ]]; then
        val="${BASH_REMATCH[1]}"
      fi
      export "$key=$val"
    fi
  done < "$file"
}

load_arena_ctl_env() {
  load_env_no_override "$ARENA_CTL_ROOT_DIR/.env"
  load_env_no_override "$ARENA_CTL_ROOT_DIR/.env.local"
  load_env_no_override "$ARENA_CTL_ROOT_DIR/apps/governance-platform/.env"
  load_env_no_override "$ARENA_CTL_ROOT_DIR/apps/governance-platform/.env.local"

  export ARENA_HOME_PATH="${ARENA_HOME_PATH:-$HOME}"
  export GOVERNANCE_ADMIN_URL="${GOVERNANCE_ADMIN_URL:-${GOVERNANCE_INTERNAL_URL:-${GOVERNANCE_URL:-http://127.0.0.1:3000}}}"
  export WORKSPACE_ROOT="${WORKSPACE_ROOT:-${ARENA_PROJECT_WORKSPACES_ROOT:-$ARENA_HOME_PATH/.arena-runtime/project-workspaces}}"
  export ARENA_REPO_ROOT="$ARENA_CTL_ROOT_DIR"
}

ensure_arena_ctl_build() {
  local entrypoint="$1"
  local package_dir="$ARENA_CTL_ROOT_DIR/services/arena-ctl"
  local entry_file="$package_dir/dist/$entrypoint"

  if [ ! -f "$entry_file" ] \
    || [ "$package_dir/tsconfig.json" -nt "$entry_file" ] \
    || [ "$package_dir/package.json" -nt "$entry_file" ] \
    || [ -n "$(find "$package_dir/src" -type f -name '*.ts' -newer "$entry_file" -print -quit)" ]; then
    npm --prefix "$package_dir" run --silent build >/dev/null
  fi
}
