#!/usr/bin/env bash
# PreToolUse hook: auto-backup dev DB before mutating prisma migrate commands.
# Rotation: keep last 10 recent backups + 1 per month for the last 12 months.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/hook-command-policy-lib.sh"

project_dir="${CLAUDE_PROJECT_DIR:-${CODEX_PROJECT_DIR:-$(pwd)}}"
root_dir=$(git -C "$project_dir" rev-parse --show-toplevel 2>/dev/null || printf '%s' "$project_dir")
cd "$root_dir"

input=$(cat)

if ! printf '%s' "$input" | jq -e . >/dev/null 2>&1; then
  exit 0
fi

block_with_reason() {
  local reason="$1"
  jq -n --arg ctx "$reason" '{
    decision: "block",
    reason: $ctx
  }'
  exit 0
}

# Only trigger on Bash tool
tool_name=$(echo "$input" | jq -r '.tool_name // empty')
[ "$tool_name" != "Bash" ] && exit 0

# Check if command is a mutating prisma migrate command
command=$(echo "$input" | jq -r '.tool_input.command // empty')
echo "$command" | grep -qE '(^|[^[:alnum:]_])prisma\s+migrate\s+(dev|deploy|reset|resolve)([^[:alnum:]_]|$)' || exit 0

# Codex runs matching PreToolUse hooks concurrently. Avoid backup side effects
# for commands another repo policy hook will deny.
hook_command_has_blocked_host_npm "$command" && exit 0

# Backup directory
BACKUP_DIR="debug/backups"
mkdir -p "$BACKUP_DIR"

TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="${BACKUP_DIR}/ralph_arena_${TIMESTAMP}.sql.gz"

# pg_dump via the standard local stack wrapper (postgres container, port 5432 inside)
if ./scripts/docker-local-stack.sh exec -T postgres pg_dump -U ralph ralph_arena 2>/dev/null | gzip > "$BACKUP_FILE"; then
  SIZE=$(du -h "$BACKUP_FILE" | cut -f1)

  # Rotate: keep last 10 recent + 1 per month for 12 months
  # 1) Identify monthly keepers (oldest backup per YYYYMM within last 12 months)
  KEEP_FILES="$BACKUP_FILE"
  for month_offset in $(seq 0 11); do
    MONTH=$(date -v-${month_offset}m +%Y%m 2>/dev/null || date -d "-${month_offset} months" +%Y%m 2>/dev/null)
    MONTHLY=$(ls -t "$BACKUP_DIR"/ralph_arena_${MONTH}*.sql.gz 2>/dev/null | tail -1 || true)
    [ -n "$MONTHLY" ] && KEEP_FILES="$KEEP_FILES"$'\n'"$MONTHLY"
  done
  # 2) Keep last 10 recent
  RECENT=$(ls -t "$BACKUP_DIR"/ralph_arena_*.sql.gz 2>/dev/null | head -10 || true)
  [ -n "$RECENT" ] && KEEP_FILES="$KEEP_FILES"$'\n'"$RECENT"
  # 3) Delete everything not in keep list
  KEEP_FILES=$(echo "$KEEP_FILES" | sort -u)
  for f in "$BACKUP_DIR"/ralph_arena_*.sql.gz; do
    [ -f "$f" ] || continue
    echo "$KEEP_FILES" | grep -qF "$f" || rm -f "$f"
  done

  echo "[pre-migrate-backup] DB backed up to $BACKUP_FILE ($SIZE)" >&2
else
  rm -f "$BACKUP_FILE"
  block_with_reason "[pre-migrate-backup] Не удалось создать backup dev DB перед prisma migrate. Миграция заблокирована.

Проверь local stack и повтори:
ARENA_ACK_MULTIPLE_DB_VOLUMES=1 ./scripts/docker-local-stack.sh up -d postgres

Если backup нужен вручную, сначала создай его отдельно и только потом повтори migrate."
fi

exit 0
