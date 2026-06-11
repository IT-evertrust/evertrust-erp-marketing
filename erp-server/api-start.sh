#!/bin/sh
# Mac mini compose API startup (compose `command`: sh /app/erp-server/api-start.sh).
#
# Migrations + the bootstrap seed run on every start. Both are idempotent:
# drizzle-kit migrate is a no-op when the DB is up to date; seed exits early if
# the org already exists.
set -e

echo "[api-start] running DB migrations..."
corepack pnpm --filter @evertrust/db db:migrate

# The seed plants a SUPER_ADMIN with a fixed dev password when the bootstrap
# org is missing — fine on a dev DB, dangerous on an empty PRODUCTION DB (the
# API is network-reachable). Gate it: in production it only runs with an
# explicit one-shot opt-in (SEED_DEV_USERS=true).
if [ "$NODE_ENV" = "production" ] && [ "$SEED_DEV_USERS" != "true" ]; then
  echo "[api-start] NODE_ENV=production - skipping dev seed (set SEED_DEV_USERS=true once to bootstrap an empty DB, then change the admin password and unset it)"
else
  echo "[api-start] seeding bootstrap data (idempotent)..."
  corepack pnpm --filter @evertrust/db db:seed
fi

echo "[api-start] launching API..."
exec corepack pnpm --filter @evertrust/db exec node --import tsx /app/erp-server/dist/main.js
