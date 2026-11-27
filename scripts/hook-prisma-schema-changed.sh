#!/usr/bin/env bash
# PostToolUse hook: schema.prisma changed → need to regenerate Prisma client.

set -euo pipefail

input=$(cat)
tool_name=$(echo "$input" | jq -r '.tool_name // empty')

case "$tool_name" in
  Edit|Write|MultiEdit)
    file_path=$(echo "$input" | jq -r '.tool_input.file_path // empty')
    case "$file_path" in *schema.prisma) ;; *) exit 0 ;; esac
    ;;
  apply_patch)
    echo "$input" | jq -r '.tool_input.command // empty' | grep -qE '^\*\*\* (Add|Update|Delete) File: .*schema\.prisma$' || exit 0
    ;;
  *)
    exit 0
    ;;
esac

jq -n '{
  hookSpecificOutput: {
    hookEventName: "PostToolUse",
    additionalContext: "Ты изменил schema.prisma. У нас devprod — изменения попадают на live сайт через HMR мгновенно. Но Prisma Client ещё не знает о новой schema, поэтому governance сейчас падает на каждом запросе к БД. Нужно сразу применить schema к БД и перегенерить клиент."
  }
}'
