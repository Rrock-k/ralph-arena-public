#!/usr/bin/env bash
set -e

# Start PostgreSQL if not running
if command -v pg_isready &>/dev/null; then
  if ! pg_isready -q 2>/dev/null; then
    echo "[start] Starting PostgreSQL..."
    sudo pg_ctlcluster 15 main start 2>/dev/null || true
    # Wait for postgres to be ready
    for i in $(seq 1 30); do
      pg_isready -q 2>/dev/null && break
      sleep 1
    done
  fi
fi

# Set DATABASE_URL if not set
export DATABASE_URL="${DATABASE_URL:-postgresql://ralph:ralph@localhost:5432/ralph_arena}"

# Ensure database exists
sudo -u postgres createdb -O ralph ralph_arena 2>/dev/null || true

# Push schema
echo "[start] Pushing Prisma schema..."
cd /workspace/apps/governance-platform
npx prisma db push --accept-data-loss 2>&1 | tail -3

# Build if standalone build doesn't exist
if [ ! -f /workspace/apps/governance-platform/.next/standalone/server.js ]; then
  echo "[start] Building Next.js app..."
  npm run build
fi

# Bind to all interfaces so localhost health checks work
export HOSTNAME="0.0.0.0"

# Start the app
echo "[start] Starting governance platform..."
exec npm start
