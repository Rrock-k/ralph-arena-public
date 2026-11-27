#!/usr/bin/env bash
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT"

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  exit 0
fi

if output="$(node scripts/check-instruction-system-maintenance.mjs 2>&1)"; then
  exit 0
fi

reason="[instruction-system-maintenance] Instruction/docs/hook drift detected. Run: node scripts/check-instruction-system-maintenance.mjs

$output"

jq -n --arg reason "$reason" '{decision:"block", reason:$reason}'
