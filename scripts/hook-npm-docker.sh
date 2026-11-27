#!/usr/bin/env bash
# PreToolUse hook: block bare npm/npx on host — dev runs in Docker.

set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/hook-command-policy-lib.sh"

input=$(cat)

tool_name=$(echo "$input" | jq -r '.tool_name // empty')
[ "$tool_name" = "Bash" ] || exit 0

command=$(echo "$input" | jq -r '.tool_input.command // empty')

if hook_command_has_blocked_host_npm "$command"; then
  jq -n '{
    decision: "block",
    reason: "Dev runs in Docker, not on the host. Use:\n  ./scripts/docker-local-stack.sh exec -T <service> npm run ...\n  (governance-platform, api-proxy, worker-agent, etc.)\nFor contracts: ./scripts/docker-local-stack.sh exec -T governance-platform sh -c \"cd packages/contracts && npm run build\"\nSee .claude/rules/docker-dev.md"
  }'
  exit 0
fi
