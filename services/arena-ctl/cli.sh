#!/usr/bin/env bash
set -euo pipefail

source "$(cd "$(dirname "$0")" && pwd)/env.sh"

load_arena_ctl_env

export ARENA_CTL_INVOCATION_CWD="${ARENA_CTL_INVOCATION_CWD:-$PWD}"
ensure_arena_ctl_build cli.js

cd "$ARENA_CTL_ROOT_DIR/services/arena-ctl"
exec node dist/cli.js "$@"
