#!/usr/bin/env bash
# PreToolUse hook: block direct psql/pg_dump on host — must go through Docker.

set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/hook-command-policy-lib.sh"

input=$(cat)

tool_name=$(echo "$input" | jq -r '.tool_name // empty')
[ "$tool_name" = "Bash" ] || exit 0

command=$(echo "$input" | jq -r '.tool_input.command // empty')

if hook_command_has_blocked_host_db_client "$command"; then
  jq -n '{
    decision: "block",
    reason: "DB runs in Docker. Use:\n  ./scripts/docker-local-stack.sh exec -T postgres psql -U ralph -d ralph_arena"
  }'
  exit 0
fi
