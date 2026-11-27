#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd "$(dirname "$0")" && pwd)
REPO_ROOT=$(CDPATH= cd "$SCRIPT_DIR/.." && pwd)

cd "$REPO_ROOT"

if ! command -v pg_dump >/dev/null 2>&1 || ! pg_dump --version | grep -q ' 17\.'; then
  apt-get update
  apt-get install -y --no-install-recommends ca-certificates wget gnupg
  install -d /usr/share/postgresql-common/pgdg
  wget -qO /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc https://www.postgresql.org/media/keys/ACCC4CF8.asc
  echo 'deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt bookworm-pgdg main' > /etc/apt/sources.list.d/pgdg.list
  apt-get update
  apt-get install -y --no-install-recommends postgresql-client-17
  rm -rf /var/lib/apt/lists/*
fi

if [ ! -f apps/governance-platform/node_modules/dotenv/package.json ] || [ ! -f apps/governance-platform/node_modules/typescript/package.json ]; then
  npm --prefix apps/governance-platform install --include=dev
fi

npm --prefix apps/governance-platform run build
exec npm --prefix apps/governance-platform run start
