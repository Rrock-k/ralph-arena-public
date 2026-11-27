#!/usr/bin/env bash
# install-token-refresh.sh — Install/uninstall launchd agent that keeps
# local auth snapshots fresh by running refresh-tokens.sh on a short interval.
#
# macOS TCC restricts launchd from accessing ~/Desktop. This script copies
# refresh-tokens.sh to ~/.ralph-arena/ (outside TCC scope) and points
# the launchd agent there.
#
# Usage:
#   ./scripts/install-token-refresh.sh            # install & start
#   ./scripts/install-token-refresh.sh --uninstall # stop & remove
#   ./scripts/install-token-refresh.sh --status    # check if running

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
LABEL="com.ralph-arena.refresh-tokens"
PLIST_SRC="$SCRIPT_DIR/$LABEL.plist"
PLIST_DST="$HOME/Library/LaunchAgents/$LABEL.plist"
RUNNER_DIR="$HOME/.ralph-arena"

case "${1:-install}" in
  --uninstall)
    if launchctl list "$LABEL" &>/dev/null; then
      launchctl unload "$PLIST_DST" 2>/dev/null || true
      echo "[token-refresh] Stopped agent."
    fi
    rm -f "$PLIST_DST"
    rm -rf "$RUNNER_DIR"
    echo "[token-refresh] Uninstalled ($PLIST_DST and $RUNNER_DIR removed)."
    ;;

  --status)
    if launchctl list "$LABEL" &>/dev/null; then
      echo "[token-refresh] Running."
      launchctl list "$LABEL"
    else
      echo "[token-refresh] Not running."
    fi
    echo "[token-refresh] Log: /tmp/ralph-arena-refresh-tokens.log"
    [ -f /tmp/ralph-arena-refresh-tokens.log ] && tail -5 /tmp/ralph-arena-refresh-tokens.log
    ;;

  install|*)
    # Copy refresh script outside ~/Desktop to avoid macOS TCC restrictions.
    mkdir -p "$RUNNER_DIR"
    cp "$SCRIPT_DIR/refresh-tokens.sh" "$RUNNER_DIR/refresh-tokens.sh"
    chmod +x "$RUNNER_DIR/refresh-tokens.sh"

    # Patch the copied script to use absolute REPO_ROOT (since it's no longer in the repo).
    sed -i '' "s|REPO_ROOT=\"\$(cd \"\$SCRIPT_DIR/..\" && pwd)\"|REPO_ROOT=\"$REPO_ROOT\"|" "$RUNNER_DIR/refresh-tokens.sh"

    # Generate plist pointing to the copied script
    mkdir -p "$HOME/Library/LaunchAgents"
    sed "s|__SCRIPT_PATH__|$RUNNER_DIR/refresh-tokens.sh|g" "$PLIST_SRC" > "$PLIST_DST"

    # Run refresh-tokens.sh once immediately (from Terminal — no TCC issue)
    "$SCRIPT_DIR/refresh-tokens.sh" || true

    # Load agent (unload first if already loaded)
    launchctl unload "$PLIST_DST" 2>/dev/null || true
    launchctl load "$PLIST_DST"

    echo "[token-refresh] Installed and started."
    echo "[token-refresh] Script: $RUNNER_DIR/refresh-tokens.sh"
    echo "[token-refresh] Tokens will refresh every 60 seconds."
    echo "[token-refresh] Log: /tmp/ralph-arena-refresh-tokens.log"
    echo "[token-refresh] Uninstall: $0 --uninstall"
    ;;
esac
