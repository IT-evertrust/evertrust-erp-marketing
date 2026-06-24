-- Reconcile the denormalized reach_aims.companies with the REAL reach_leads count.
-- Legacy rows (older scraper versions) recorded a count without persisting the lead
-- rows, leaving a phantom number (e.g. companies=98 but 0 leads). Idempotent.
UPDATE "reach_aims" a
SET "companies" = COALESCE(
  (SELECT count(*) FROM "reach_leads" l WHERE l.aim_id = a.id),
  0
);
