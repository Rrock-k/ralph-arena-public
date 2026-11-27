#!/usr/bin/env bash
# ⚠️  DEPRECATED — authd is now the runtime source of truth for OAuth/subscription.
# This script remains as a legacy fallback called by TokenManager and worker-agent,
# but should NOT be used directly. To re-login:
#   docker exec -it agents-arena-authd-1 claude auth login   (Claude OAuth)
#   docker exec -it agents-arena-authd-1 codex login --device-auth
#                                                        (Codex subscription)
# See: .claude/rules/auth-tokens.md
#
# refresh-tokens.sh — Read Claude Code OAuth tokens from macOS Keychain
# and update local env snapshots for host-side bootstrap / diagnostics.
#
# Usage:  ./scripts/refresh-tokens.sh          (auto-detects .env.local)
#         ./scripts/refresh-tokens.sh --dry-run (print tokens, don't write)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
ENV_FILE="$REPO_ROOT/.env.local"
KEYCHAIN_SERVICE="Claude Code-credentials"
DRY_RUN=false

for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=true ;;
  esac
done

# --- Guard: skip on non-macOS or when `security` is unavailable ---
if ! command -v security &>/dev/null; then
  echo "[refresh-tokens] Skipped (not macOS / no Keychain)."
  exit 0
fi

# --- Ping Claude to force OAuth refresh if token is stale ---
if command -v claude &>/dev/null; then
  claude -p "ok" &>/dev/null || true
fi

# --- Read from Keychain ---
RAW=$(security find-generic-password -s "$KEYCHAIN_SERVICE" -w 2>/dev/null) || {
  echo "[refresh-tokens] No Keychain entry for '$KEYCHAIN_SERVICE' — skipped."
  echo "[refresh-tokens] Run 'claude auth login' to enable auto-refresh."
  exit 0
}

# Parse JSON (macOS ships with python3)
ACCESS_TOKEN=$(echo "$RAW" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['claudeAiOauth']['accessToken'])" 2>/dev/null) || {
  echo "[refresh-tokens] Failed to parse accessToken from Keychain JSON."
  exit 1
}
REFRESH_TOKEN=$(echo "$RAW" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['claudeAiOauth']['refreshToken'])" 2>/dev/null) || {
  echo "[refresh-tokens] Failed to parse refreshToken from Keychain JSON."
  exit 1
}

echo "[refresh-tokens] Tokens read from Keychain OK"
echo "[refresh-tokens]   accessToken:  ${ACCESS_TOKEN:0:20}...${ACCESS_TOKEN: -6}"
echo "[refresh-tokens]   refreshToken: ${REFRESH_TOKEN:0:20}...${REFRESH_TOKEN: -6}"

if $DRY_RUN; then
  echo "[refresh-tokens] Dry run — not writing to $ENV_FILE"
  exit 0
fi

# --- Update .env.local ---
if [ ! -f "$ENV_FILE" ]; then
  echo "[refresh-tokens] $ENV_FILE not found, creating."
  touch "$ENV_FILE"
fi

# Helper: update or append a key=value in the env file
update_env() {
  local key="$1" value="$2" file="$3"
  if grep -q "^${key}=" "$file" 2>/dev/null; then
    # Replace existing line (macOS sed -i requires '' argument)
    sed -i '' "s|^${key}=.*|${key}=${value}|" "$file"
  else
    echo "${key}=${value}" >> "$file"
  fi
}

update_env "CLAUDE_CODE_OAUTH_TOKEN" "$ACCESS_TOKEN" "$ENV_FILE"
update_env "CLAUDE_CODE_OAUTH_REFRESH_TOKEN" "$REFRESH_TOKEN" "$ENV_FILE"

# Codex subscription auth: read ~/.codex/auth.json and set CODEX_AUTH_JSON
if [ -f "$HOME/.codex/auth.json" ]; then
  CODEX_JSON=$(python3 -c "import sys,json; print(json.dumps(json.load(open('$HOME/.codex/auth.json'))))" 2>/dev/null) || {
    echo "[refresh-tokens] Failed to parse ~/.codex/auth.json"
    CODEX_JSON=""
  }
  if [ -n "$CODEX_JSON" ]; then
    update_env "CODEX_AUTH_JSON" "$CODEX_JSON" "$ENV_FILE"
    echo "[refresh-tokens] Codex auth.json refreshed → CODEX_AUTH_JSON"
  fi
fi

echo "[refresh-tokens] Updated $ENV_FILE"
