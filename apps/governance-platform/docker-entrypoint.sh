#!/bin/sh
set -e

if [ -f server.js ]; then
  exec node server.js
fi

if [ -f apps/governance-platform/server.js ]; then
  exec node apps/governance-platform/server.js
fi

echo "Standalone server.js not found" >&2
exit 1
