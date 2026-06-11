#!/bin/sh
# Mac mini compose API startup (compose `command`: sh /app/erp-server/api-start.sh).
#
# Migrations + the bootstrap seed run on every start. Both are idempotent:
# drizzle-kit migrate is a no-op when the DB is up to date; seed exits early if
# the org already exists.
set -e

echo "[api-start] running DB migrations..."
corepack pnpm --filter @evertrust/db db:migrate

echo "[api-start] seeding bootstrap data (idempotent)..."
corepack pnpm --filter @evertrust/db db:seed

echo "[api-start] launching API..."
exec corepack pnpm --filter @evertrust/db exec node --import tsx /app/erp-server/dist/main.js
