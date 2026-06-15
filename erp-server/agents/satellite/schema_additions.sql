-- Lead Satellite additions to the shared contract (see bazooka/schema.sql).
-- Satellite INSERTS leads; these columns carry research metadata that the old
-- system kept in extra sheet columns (Website, City, Country, Tier).
-- Status values written by satellite: '' (has email) | 'PROTECTED' | 'NO_EMAIL'.
-- Bazooka only acts on '' / 'Cold Outreached' / 'Followed Up', so PROTECTED and
-- NO_EMAIL rows are naturally skipped until an email is recovered.

ALTER TABLE leads ADD COLUMN IF NOT EXISTS website text NOT NULL DEFAULT '';
ALTER TABLE leads ADD COLUMN IF NOT EXISTS city    text NOT NULL DEFAULT '';
ALTER TABLE leads ADD COLUMN IF NOT EXISTS country text NOT NULL DEFAULT '';
ALTER TABLE leads ADD COLUMN IF NOT EXISTS tier    text NOT NULL DEFAULT '';
