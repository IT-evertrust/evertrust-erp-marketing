-- Drop NOT NULL on campaigns.sales_calendar_id. The sales calendar moved to the org
-- level (org_config.sales_calendar_id, migration 0028); the per-campaign column is now
-- an OPTIONAL override the AIM Calendar dropdown sets — null means "resolve per-org"
-- (org_config.salesCalendarId ?? env SALES_CALENDAR_ID ?? null).
-- Idempotent: DROP NOT NULL on an already-nullable column is a no-op in Postgres.
ALTER TABLE "campaigns" ALTER COLUMN "sales_calendar_id" DROP NOT NULL;
