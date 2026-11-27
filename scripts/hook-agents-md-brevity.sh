#!/usr/bin/env bash
# PostToolUse hook: warn about brevity when editing AGENTS.md or CLAUDE.md.

input=$(cat)

matches_agent_file() {
  local file_path="$1"
  local base
  base=$(basename "$file_path" 2>/dev/null)
  [[ "$base" == "AGENTS.md" || "$base" == "CLAUDE.md" ]]
}

tool_name=$(printf '%s' "$input" | jq -r '.tool_name // empty' 2>/dev/null)
if [ "$tool_name" = "apply_patch" ]; then
  if printf '%s' "$input" | jq -r '.tool_input.command // empty' \
    | sed -nE 's/^\*\*\* (Add|Update|Delete) File: (.*)$/\2/p; s/^\*\*\* Move to: (.*)$/\1/p' \
    | while IFS= read -r file_path; do matches_agent_file "$file_path" && exit 42; done; then
      exit 0
    else
      status=$?
      [ "$status" -eq 42 ] || exit 0
    fi
else
  FILE=$(printf '%s' "$input" | jq -r '.tool_input.file_path // .tool_response.filePath // empty' 2>/dev/null)
  matches_agent_file "$FILE" || exit 0
fi

if true; then
  echo '{"hookSpecificOutput":{"hookEventName":"PostToolUse","additionalContext":"[brevity-guard] AGENTS.md / CLAUDE.md должны быть максимально краткими. Проверь: нет ли лишних слов, примеров, повторов? Если файл длиннее ~15 строк — скорее всего можно сократить."}}'
fi
