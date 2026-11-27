#!/bin/sh
set -eu

APP_DIR="apps/task-board"
NODE_MODULES_DIR="${APP_DIR}/node_modules"
LOCK_FILE="${APP_DIR}/package-lock.json"
LOCK_MARKER="${NODE_MODULES_DIR}/.package-lock.sha256"
BUILD_NODE_OPTIONS="${TASK_BOARD_BUILD_NODE_OPTIONS:---max-old-space-size=512}"
START_NODE_OPTIONS="${TASK_BOARD_START_NODE_OPTIONS:---max-old-space-size=128}"

current_lock_sha="$(sha256sum "${LOCK_FILE}" | awk '{print $1}')"
installed_lock_sha=""

if [ -f "${LOCK_MARKER}" ]; then
  installed_lock_sha="$(cat "${LOCK_MARKER}")"
fi

if [ ! -x "${NODE_MODULES_DIR}/.bin/next" ] || [ "${installed_lock_sha}" != "${current_lock_sha}" ]; then
  npm --prefix "${APP_DIR}" ci
  mkdir -p "${NODE_MODULES_DIR}"
  printf '%s\n' "${current_lock_sha}" > "${LOCK_MARKER}"
fi

NODE_OPTIONS="${BUILD_NODE_OPTIONS}" npm --prefix "${APP_DIR}" run build
NODE_OPTIONS="${START_NODE_OPTIONS}" npm --prefix "${APP_DIR}" run start -- --hostname 0.0.0.0 --port 3001
