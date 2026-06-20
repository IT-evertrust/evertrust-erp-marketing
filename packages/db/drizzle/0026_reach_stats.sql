-- Per-round send/engagement stats for a Reach campaign, stored as jsonb on the
-- aim: { cold:{sent,opened,clicked,replied,bounced,meetings}, followup:{...},
-- final:{...} }. `sent` is driven by the manual Send action; the rest stay 0
-- until real tracking (open/click/bounce/reply/meeting) exists. Idempotent.

ALTER TABLE reach_aims ADD COLUMN IF NOT EXISTS stats jsonb;
