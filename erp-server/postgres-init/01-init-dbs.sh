#!/bin/sh
# Runs ONLY on a fresh volume (postgres entrypoint initdb hook). Creates the
# databases the stack expects beyond POSTGRES_DB, so a from-scratch boot (new
# machine, disaster recovery without a pg_dumpall restore) doesn't leave
# erp-api and ai-litellm crash-looping on missing databases.
#
# If you ARE restoring a pg_dumpall backup afterwards, these empty DBs are
# harmless: the restore's CREATE DATABASE errors with "already exists" and the
# data still lands.
set -e

psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d postgres <<-SQL
	CREATE DATABASE evertrust;
SQL

# The LiteLLM gateway (ai-stack) keeps its DB on this Postgres. Role + DB are
# created only when LITELLM_DB_PASSWORD is provided (same value as in
# ai-stack/.env); without it, bootstrap the gateway DB manually later.
if [ -n "$LITELLM_DB_PASSWORD" ]; then
	psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d postgres <<-SQL
		CREATE ROLE litellm LOGIN PASSWORD '$LITELLM_DB_PASSWORD';
		CREATE DATABASE litellm OWNER litellm;
	SQL
else
	echo "[init-dbs] LITELLM_DB_PASSWORD not set - skipping litellm role/DB bootstrap"
fi
