-- ============================================================================
-- EverTrust — seed a SECOND organization + its users (multi-tenant test).
-- Run in the Supabase SQL Editor (after 0003, or any time).
--
-- Creates org "Acme Test GmbH" with two users so you can verify org isolation
-- against your existing org. Both users' password is:  ChangeMe2026
-- (argon2id hashes below — the API's argon2.verify accepts them; change the
-- password from the UI after first login).
--
--   admin@acme-test.de   role ADMIN     (org B)
--   sales@acme-test.de   role EMPLOYEE  (org B)
--
-- Idempotent: ON CONFLICT on org slug / user email / credential PK, so
-- re-running won't duplicate. One transactional statement (data-modifying CTE).
-- NOTE: org id is NOT taken from any request — a user's org is whatever this
-- row says, resolved from the JWT on every request. So these users are fully
-- partitioned into org B.
-- ============================================================================
WITH new_org AS (
  INSERT INTO organizations (name, slug)
  VALUES ('Acme Test GmbH', 'acme-test')
  ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
  RETURNING id
),
admin_user AS (
  INSERT INTO users (organization_id, name, email, role, department, position)
  SELECT id, 'Acme Admin', 'admin@acme-test.de', 'ADMIN', 'BUSINESS', 'CEO'
    FROM new_org
  ON CONFLICT (email) DO NOTHING
  RETURNING id
),
sales_user AS (
  INSERT INTO users (organization_id, name, email, role, department, position)
  SELECT id, 'Acme Sales', 'sales@acme-test.de', 'EMPLOYEE', 'MARKETING', 'SPECIALIST'
    FROM new_org
  ON CONFLICT (email) DO NOTHING
  RETURNING id
)
INSERT INTO auth_credentials (user_id, password_hash)
SELECT id, '$argon2id$v=19$m=65536,t=3,p=4$M/hf0c6IIzuFOItWirnPiA$u6dvKUearLeGrGXcXKRy+POrrh8OzftUH8V1brANVYc'
  FROM admin_user
UNION ALL
SELECT id, '$argon2id$v=19$m=65536,t=3,p=4$jx4BDWDBCpLQNx89VXOv3w$HselGEfn7LQbO70GQ+j9V0vgdMxrpUtLWv1uyb+Abd0'
  FROM sales_user
ON CONFLICT (user_id) DO NOTHING;
