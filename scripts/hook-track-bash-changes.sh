#!/usr/bin/env bash
# Session-aware Bash tracker:
# - pre: snapshot current dirty/untracked git paths and their signatures
# - post: compare with the snapshot and append only paths changed by this Bash command

set -euo pipefail

input=$(cat)
mode="${1:-}"
[ "$mode" = "pre" ] || [ "$mode" = "post" ] || exit 0

project_dir="${CLAUDE_PROJECT_DIR:-${CODEX_PROJECT_DIR:-}}"
if [ -z "$project_dir" ] && printf '%s' "$input" | jq -e . >/dev/null 2>&1; then
  project_dir=$(printf '%s' "$input" | jq -r '.cwd // empty')
fi
project_dir="${project_dir:-$(pwd)}"
root_dir=$(git -C "$project_dir" rev-parse --show-toplevel 2>/dev/null || printf '%s' "$project_dir")
cd "$root_dir"

tool_name=$(echo "$input" | jq -r '.tool_name // empty')
[ "$tool_name" = "Bash" ] || exit 0

session_id=$(echo "$input" | jq -r '.session_id // empty')
[ -n "$session_id" ] || exit 0

if ! git rev-parse --show-toplevel >/dev/null 2>&1; then
  exit 0
fi

snapshot_file="/tmp/arena-session-${session_id}.bash-snapshot"
changed_file="/tmp/arena-session-${session_id}.files"

list_dirty_paths() {
  if git rev-parse --verify HEAD >/dev/null 2>&1; then
    git diff --name-only HEAD -- 2>/dev/null || true
  else
    git diff --name-only -- 2>/dev/null || true
  fi
  git ls-files --others --exclude-standard 2>/dev/null || true
}

path_signature() {
  local path="$1"
  if [ -f "$path" ]; then
    shasum "$path" | awk '{print $1}'
    return
  fi
  if [ -e "$path" ]; then
    stat -f '%m:%z' "$path" 2>/dev/null || stat -c '%Y:%s' "$path" 2>/dev/null || echo "__exists__"
    return
  fi
  echo "__missing__"
}

write_snapshot() {
  local output="$1"
  : > "$output"
  while IFS= read -r path; do
    [ -n "$path" ] || continue
    printf '%s\t%s\n' "$path" "$(path_signature "$path")" >> "$output"
  done < <(list_dirty_paths | sort -u)
}

if [ "$mode" = "pre" ]; then
  write_snapshot "$snapshot_file"
  exit 0
fi

tmp_after=$(mktemp "/tmp/arena-session-${session_id}.bash-after.XXXXXX")
trap 'rm -f "$tmp_after"' EXIT
write_snapshot "$tmp_after"

if [ -f "$snapshot_file" ]; then
  awk -F '\t' '
    FNR == NR {
      if ($1 != "") {
        before[$1] = $2
        paths[$1] = 1
      }
      next
    }
    {
      if ($1 != "") {
        after[$1] = $2
        paths[$1] = 1
      }
    }
    END {
      for (path in paths) {
        if (before[path] != after[path]) {
          print path
        }
      }
    }
  ' "$snapshot_file" "$tmp_after" >> "$changed_file"
else
  cut -f1 "$tmp_after" >> "$changed_file"
fi

mv "$tmp_after" "$snapshot_file"
