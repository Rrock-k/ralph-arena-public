#!/usr/bin/env bash
set -euo pipefail

source "$(cd "$(dirname "$0")" && pwd)/env.sh"

load_arena_ctl_env
ensure_arena_ctl_build index.js

cd "$ARENA_CTL_ROOT_DIR/services/arena-ctl"
exec node dist/index.js
