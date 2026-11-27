#!/bin/sh
set -eu

cd "$(dirname "$0")/apps/governance-platform"

if [ ! -f .next/standalone/server.js ]; then
  npm run build
fi

export HOSTNAME="${HOSTNAME:-0.0.0.0}"
exec npm start
