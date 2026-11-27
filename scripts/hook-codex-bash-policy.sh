#!/usr/bin/env bash
# Codex quiet PreToolUse hook: one Bash hook for command policy.
#
# Claude keeps the richer per-tool hook wiring. Codex UI surfaces every
# lifecycle hook, so keep this repo-local Codex path intentionally compact.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/hook-command-policy-lib.sh"

input=$(cat)

if ! printf '%s' "$input" | jq -e . >/dev/null 2>&1; then
  exit 0
fi

tool_name=$(printf '%s' "$input" | jq -r '.tool_name // empty')
[ "$tool_name" = "Bash" ] || exit 0

command=$(printf '%s' "$input" | jq -r '.tool_input.command // empty')

if hook_command_has_blocked_host_db_client "$command"; then
  jq -n '{
    decision: "block",
    reason: "DB runs in Docker. Use:\n  ./scripts/docker-local-stack.sh exec -T postgres psql -U ralph -d ralph_arena"
  }'
  exit 0
fi

if hook_command_has_blocked_host_npm "$command"; then
  jq -n '{
    decision: "block",
    reason: "Dev runs in Docker, not on the host. Use:\n  ./scripts/docker-local-stack.sh exec -T <service> npm run ...\n  (governance-platform, api-proxy, worker-agent, etc.)\nFor contracts: ./scripts/docker-local-stack.sh exec -T governance-platform sh -c \"cd packages/contracts && npm run build\"\nSee .claude/rules/docker-dev.md"
  }'
  exit 0
fi

# Keep the migrate backup guardrail, but only after deny-fast policy checks.
# This avoids Codex concurrent PreToolUse side effects from separate hooks.
migrate_output=$(printf '%s' "$input" | bash "$SCRIPT_DIR/hook-pre-migrate-backup.sh")
if [ -n "$migrate_output" ]; then
  printf '%s\n' "$migrate_output"
fi
