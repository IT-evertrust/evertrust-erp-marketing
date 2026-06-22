#!/bin/sh
# Mac mini compose API startup (compose `command`: sh /app/erp-server/api-start.sh).
#
# Migrations + the bootstrap seed run on every start. Both are idempotent:
# drizzle-kit migrate is a no-op when the DB is up to date; seed exits early if
# the org already exists.
set -e

# Migrations can transiently fail during a deploy: Render keeps the OLD container
# (still holding its DB pool) alive until the NEW one is healthy, so for a few seconds
# both share Supabase's session-pooler client budget and `db:migrate` can hit
# `EMAXCONNSESSION: max clients reached`. Retry with backoff so the migrate self-heals
# once the old instance releases its connections, instead of crash-looping the deploy.
echo "[api-start] running DB migrations..."
attempt=1
max_attempts="${MIGRATE_MAX_ATTEMPTS:-5}"
until corepack pnpm --filter @evertrust/db db:migrate; do
  if [ "$attempt" -ge "$max_attempts" ]; then
    echo "[api-start] migrations failed after ${attempt} attempts - giving up"
    exit 1
  fi
  echo "[api-start] migration attempt ${attempt}/${max_attempts} failed; retrying in $((attempt * 5))s..."
  sleep "$((attempt * 5))"
  attempt=$((attempt + 1))
done

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
