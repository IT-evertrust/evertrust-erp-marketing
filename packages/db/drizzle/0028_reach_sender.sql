-- Which mailbox a Reach campaign sends from (info | hanna). Resolves to a
-- connected google_accounts row by email for real Gmail delivery.
ALTER TABLE reach_aims ADD COLUMN IF NOT EXISTS sender text NOT NULL DEFAULT 'info';
