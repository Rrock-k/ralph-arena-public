#!/usr/bin/env bash
# Claude/Codex Stop hook: keep env contract, examples, compose wiring, and local env placement aligned.

set -euo pipefail

ROOT_DIR="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT_DIR"

input="$(cat || true)"

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  exit 0
fi

if output="$(node scripts/check-env-contract.mjs 2>&1)"; then
  exit 0
fi

reason="[env-contract] Env ownership/template drift detected. If you edited env vars, align docs/contracts/env-secrets-contract.md, .env.example, app/service .env.example files, docker-compose wiring, and scripts/check-env-contract.mjs.

Run: node scripts/check-env-contract.mjs

$output"

hook_event_name=""
if printf '%s' "$input" | jq -e . >/dev/null 2>&1; then
  hook_event_name="$(printf '%s' "$input" | jq -r '.hook_event_name // empty')"
fi

case "$hook_event_name" in
  Stop)
    jq -n --arg reason "$reason" '{decision:"block", reason:$reason}'
    ;;
  PostToolUse|PreToolUse|PermissionRequest|UserPromptSubmit|SessionStart)
    jq -n --arg event "$hook_event_name" --arg reason "$reason" '{
      decision: "block",
      reason: $reason,
      hookSpecificOutput: {
        hookEventName: $event,
        additionalContext: $reason
      }
    }'
    ;;
  *)
    jq -n --arg reason "$reason" '{decision:"block", reason:$reason}'
    ;;
esac
