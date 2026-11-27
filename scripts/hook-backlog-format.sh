#!/usr/bin/env bash
# Claude/Codex Stop hook: block malformed backlog task headings.

set -euo pipefail

ROOT_DIR="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT_DIR"

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  exit 0
fi

if output="$(node scripts/check-backlog-format.mjs 2>&1)"; then
  exit 0
fi

reason="[backlog-format] Backlog task heading drift detected. Run: node scripts/check-backlog-format.mjs --verbose

$output"

jq -n --arg reason "$reason" '{decision:"block", reason:$reason}'
