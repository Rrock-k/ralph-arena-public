#!/usr/bin/env bash
# PostToolUse hook: tracks which files this session modified via Edit/Write/MultiEdit.
# Writes file paths to /tmp/arena-session-{session_id}.files

set -euo pipefail

input=$(cat)

session_id=$(echo "$input" | jq -r '.session_id // empty')
[ -z "$session_id" ] && exit 0

# Make path relative to project dir
project_dir="${CLAUDE_PROJECT_DIR:-${CODEX_PROJECT_DIR:-}}"
if [ -z "$project_dir" ] && printf '%s' "$input" | jq -e . >/dev/null 2>&1; then
  project_dir=$(printf '%s' "$input" | jq -r '.cwd // empty')
fi
project_dir="${project_dir:-$(pwd)}"
root_dir=$(git -C "$project_dir" rev-parse --show-toplevel 2>/dev/null || printf '%s' "$project_dir")
cwd_rel="${project_dir#"$root_dir"/}"
[ "$cwd_rel" = "$project_dir" ] && cwd_rel=""

emit_path() {
  local file_path="$1"
  [ -z "$file_path" ] && return
  local rel_path
  if [[ "$file_path" = /* ]]; then
    rel_path="${file_path#"$root_dir"/}"
  elif [ -n "$cwd_rel" ]; then
    rel_path="$cwd_rel/$file_path"
  else
    rel_path="$file_path"
  fi
  echo "$rel_path"
}

tool_name=$(echo "$input" | jq -r '.tool_name // empty')
case "$tool_name" in
  apply_patch)
    echo "$input" | jq -r '.tool_input.command // empty' \
      | sed -nE 's/^\*\*\* (Add|Update|Delete) File: (.*)$/\2/p; s/^\*\*\* Move to: (.*)$/\1/p' \
      | while IFS= read -r file_path; do
          emit_path "$file_path"
        done >> "/tmp/arena-session-${session_id}.files"
    ;;
  *)
    file_path=$(echo "$input" | jq -r '.tool_input.file_path // .tool_response.filePath // empty')
    emit_path "$file_path" >> "/tmp/arena-session-${session_id}.files"
    ;;
esac
