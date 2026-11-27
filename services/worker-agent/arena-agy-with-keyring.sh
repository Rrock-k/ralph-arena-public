#!/bin/sh
set -eu

AGY_BIN="${ARENA_RAW_AGY_BIN:-/usr/local/bin/agy}"

if [ "${1:-}" = "--version" ] || [ "${1:-}" = "-V" ]; then
  exec "$AGY_BIN" "$@"
fi

if [ "${ARENA_AGY_KEYRING_READY:-}" = "1" ]; then
  exec "$AGY_BIN" "$@"
fi

if ! command -v dbus-run-session >/dev/null 2>&1; then
  echo "Antigravity keyring wrapper requires dbus-run-session." >&2
  exit 127
fi

if ! command -v gnome-keyring-daemon >/dev/null 2>&1; then
  echo "Antigravity keyring wrapper requires gnome-keyring-daemon." >&2
  exit 127
fi

AGY_HOME="${ARENA_ANTIGRAVITY_HOME:-${HOME:-/home/node}}"
export HOME="$AGY_HOME"
export XDG_DATA_HOME="${XDG_DATA_HOME:-$HOME/.local/share}"
export XDG_CONFIG_HOME="${XDG_CONFIG_HOME:-$HOME/.config}"
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/tmp/xdg-runtime-$(id -u)}"

mkdir -p "$HOME" "$XDG_DATA_HOME" "$XDG_CONFIG_HOME" "$XDG_RUNTIME_DIR"
chmod 700 "$HOME" "$XDG_RUNTIME_DIR"

exec dbus-run-session sh -c '
  set -eu
  eval "$(printf "\n" | gnome-keyring-daemon --unlock --components=secrets)"
  export GNOME_KEYRING_CONTROL
  export GNOME_KEYRING_PID
  export ARENA_AGY_KEYRING_READY=1
  exec "$0" "$@"
' "$AGY_BIN" "$@"
