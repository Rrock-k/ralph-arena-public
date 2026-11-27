#!/usr/bin/env bash
# Claude/Codex Stop hook: block accepted-spec artifact contract drift.

set -euo pipefail

ROOT_DIR="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT_DIR"

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  exit 0
fi

if output="$(node scripts/check-accepted-spec-artifact-contract.mjs 2>&1)"; then
  exit 0
fi

reason="[accepted-spec-artifact-contract] Accepted spec artifact boundary drift detected. Run: node scripts/check-accepted-spec-artifact-contract.mjs --verbose

$output"

jq -n --arg reason "$reason" '{decision:"block", reason:$reason}'
