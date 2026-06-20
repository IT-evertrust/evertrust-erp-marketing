-- Engage demo seed for the OFFICIAL Supabase DB. Idempotent (fixed UUIDs + ON CONFLICT
-- DO NOTHING) so it is safe to re-run. All addresses use .example so nothing real is
-- contacted. Scope: the Evertrust org. Exercises the inbox filter (info@ + hanna@), all
-- three reply buckets, and unclassified inbound replies (the Reply Glock classify backlog).
--
-- Run:  psql "$DATABASE_URL" -f packages/db/src/seed-engage-demo.sql

-- campA = existing campaign (sender=info, Cloud Infrastructure); campB = new (sender=hanna, LED)
\set org '833e83c7-ba3a-4539-8499-8e5e532444a8'
\set campA '9e606cd3-6c1e-4d51-8a24-6ca233d98f4e'
\set campB 'cb000000-0000-0000-0000-0000000000b2'
\set nicheLED 'bd678e89-fb49-4d5a-a442-bda92ed2d1c3'

BEGIN;

-- 1) Org sender mailboxes (the DB-driven inbox list).
INSERT INTO org_senders (id, organization_id, sender_key, email, label, is_default) VALUES
  ('5e000000-0000-0000-0000-000000000001', :'org', 'info',  'info@evertrust-germany.de',  'Info Mailbox',  true),
  ('5e000000-0000-0000-0000-000000000002', :'org', 'hanna', 'hanna@evertrust-germany.de', 'Hanna Mailbox', false)
ON CONFLICT DO NOTHING;

-- 2) Second campaign on the hanna@ inbox (so the inbox filter has 2 options).
INSERT INTO campaigns (id, organization_id, name, country, region, project, gmail_label, whatsapp_number, niche_id, sender, lifecycle) VALUES
  (:'campB', :'org', 'PL LED Retrofit', 'Poland', 'Mazowieckie', 'LED Retrofit PL', 'hanna/led', '000', :'nicheLED', 'hanna', 'ACTIVE')
ON CONFLICT DO NOTHING;

-- 3) Prospects (one conversation each). aN = info campaign, bN = hanna campaign.
INSERT INTO prospects (id, organization_id, campaign_id, email, company_name, city, country, email_verified, status) VALUES
  ('aa000000-0000-0000-0000-000000000001', :'org', :'campA', 'demo.kowalski@cloudpoland.example', 'CloudPoland Sp. z o.o.', 'Warsaw',  'Poland', true, 'INTERESTED'),
  ('aa000000-0000-0000-0000-000000000002', :'org', :'campA', 'demo.nowak@datarun.example',        'DataRun S.A.',           'Krakow',  'Poland', true, 'REPLIED'),
  ('aa000000-0000-0000-0000-000000000003', :'org', :'campA', 'demo.wisniewski@hostbridge.example','HostBridge',             'Gdansk',  'Poland', true, 'EMAILED'),
  ('bb000000-0000-0000-0000-000000000001', :'org', :'campB', 'demo.lewandowski@brightled.example','BrightLED',              'Lodz',    'Poland', true, 'NOT_INTERESTED'),
  ('bb000000-0000-0000-0000-000000000002', :'org', :'campB', 'demo.zielinski@lumenworks.example', 'LumenWorks',             'Poznan',  'Poland', true, 'INTERESTED'),
  ('bb000000-0000-0000-0000-000000000003', :'org', :'campB', 'demo.kaminski@ledomat.example',     'Ledomat',                'Wroclaw', 'Poland', true, 'EMAILED')
ON CONFLICT DO NOTHING;

-- 4) Outreach messages: one OUTBOUND (our cold mail) + one INBOUND (their reply) per prospect.
INSERT INTO outreach_messages (id, prospect_id, direction, status, gmail_message_id, gmail_thread_id, subject, body_snippet, sent_at) VALUES
  ('a1000000-0000-0000-0000-0000000000a1', 'aa000000-0000-0000-0000-000000000001', 'OUTBOUND', 'SENT',     'seed-a1-out', 'thr-a1', 'Managed cloud infrastructure for CloudPoland', 'Hello, we provide managed cloud infrastructure with tiered pricing for scale-ups.', now() - interval '2 days'),
  ('a1000000-0000-0000-0000-0000000000a2', 'aa000000-0000-0000-0000-000000000001', 'INBOUND',  'RECEIVED', 'seed-a1-in',  'thr-a1', 'Re: Managed cloud infrastructure for CloudPoland', 'This looks interesting — could you send pricing for ~40 vCPUs and a short call this week?', now() - interval '3 hours'),
  ('a2000000-0000-0000-0000-0000000000a1', 'aa000000-0000-0000-0000-000000000002', 'OUTBOUND', 'SENT',     'seed-a2-out', 'thr-a2', 'Managed cloud infrastructure for DataRun', 'Hello, we provide managed cloud infrastructure with tiered pricing.', now() - interval '2 days'),
  ('a2000000-0000-0000-0000-0000000000a2', 'aa000000-0000-0000-0000-000000000002', 'INBOUND',  'RECEIVED', 'seed-a2-in',  'thr-a2', 'Re: Managed cloud infrastructure for DataRun', 'What certifications do you hold, and do you support on-prem hybrid?', now() - interval '5 hours'),
  ('a3000000-0000-0000-0000-0000000000a1', 'aa000000-0000-0000-0000-000000000003', 'OUTBOUND', 'SENT',     'seed-a3-out', 'thr-a3', 'Managed cloud infrastructure for HostBridge', 'Hello, we provide managed cloud infrastructure with tiered pricing.', now() - interval '1 day'),
  ('a3000000-0000-0000-0000-0000000000a2', 'aa000000-0000-0000-0000-000000000003', 'INBOUND',  'RECEIVED', 'seed-a3-in',  'thr-a3', 'Re: Managed cloud infrastructure for HostBridge', 'Can you tell me more about your SLAs and data residency in the EU?', now() - interval '1 hour'),
  ('b1000000-0000-0000-0000-0000000000b1', 'bb000000-0000-0000-0000-000000000001', 'OUTBOUND', 'SENT',     'seed-b1-out', 'thr-b1', 'LED retrofit for BrightLED portfolio', 'Hello, we supply LED retrofit kits with tiered pricing for property portfolios.', now() - interval '2 days'),
  ('b1000000-0000-0000-0000-0000000000b2', 'bb000000-0000-0000-0000-000000000001', 'INBOUND',  'RECEIVED', 'seed-b1-in',  'thr-b1', 'Re: LED retrofit for BrightLED portfolio', 'No thank you, not relevant for us. Please remove us from your list.', now() - interval '4 hours'),
  ('b2000000-0000-0000-0000-0000000000b1', 'bb000000-0000-0000-0000-000000000002', 'OUTBOUND', 'SENT',     'seed-b2-out', 'thr-b2', 'LED retrofit for LumenWorks', 'Hello, we supply LED retrofit kits with tiered pricing for property portfolios.', now() - interval '2 days'),
  ('b2000000-0000-0000-0000-0000000000b2', 'bb000000-0000-0000-0000-000000000002', 'INBOUND',  'RECEIVED', 'seed-b2-in',  'thr-b2', 'Re: LED retrofit for LumenWorks', 'Great — please send a quote for 300 units including delivery to Poznan.', now() - interval '2 hours'),
  ('b3000000-0000-0000-0000-0000000000b1', 'bb000000-0000-0000-0000-000000000003', 'OUTBOUND', 'SENT',     'seed-b3-out', 'thr-b3', 'LED retrofit for Ledomat', 'Hello, we supply LED retrofit kits with tiered pricing for property portfolios.', now() - interval '1 day'),
  ('b3000000-0000-0000-0000-0000000000b2', 'bb000000-0000-0000-0000-000000000003', 'INBOUND',  'RECEIVED', 'seed-b3-in',  'thr-b3', 'Re: LED retrofit for Ledomat', 'Is this compatible with existing fittings? What is the warranty?', now() - interval '30 minutes')
ON CONFLICT DO NOTHING;

-- 5) Reply classifications. a1,a2,b1,b2 are PRE-classified (show in the queue immediately);
--    a3,b3 are intentionally LEFT UNCLASSIFIED to exercise the Reply Glock classify flow.
INSERT INTO reply_classifications (id, prospect_id, message_id, verdict, model, suggested_reply, raw) VALUES
  ('c1000000-0000-0000-0000-000000000001', 'aa000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-0000000000a2', 'INTERESTED', 'demo-seed',
     'Dear CloudPoland team,\n\nThank you — for ~40 vCPUs I will prepare tiered pricing and propose a short call. Would Thursday 14:00 suit you?\n\nKind regards,\nEVERTRUST GmbH',
     '{"source":"demo-seed","status":"INTERESTED","confidence":0.92,"reasoning":"Asks for pricing and a call — clear buying intent.","draft":{"subject":"Re: Managed cloud infrastructure for CloudPoland — next steps","body":"Dear CloudPoland team,\n\nThank you — for ~40 vCPUs I will prepare tiered pricing and propose a short call. Would Thursday 14:00 suit you?\n\nKind regards,\nEVERTRUST GmbH"}}'),
  ('c2000000-0000-0000-0000-000000000002', 'aa000000-0000-0000-0000-000000000002', 'a2000000-0000-0000-0000-0000000000a2', 'UNSURE', 'demo-seed',
     'Dear DataRun team,\n\nHappy to help — we hold ISO 27001 and SOC 2, and we do support on-prem hybrid. Shall I send the details and set up a short call?\n\nKind regards,\nEVERTRUST GmbH',
     '{"source":"demo-seed","status":"UNSURE","confidence":0.54,"reasoning":"Asks clarifying questions with no clear buying intent yet.","draft":{"subject":"Re: Managed cloud infrastructure for DataRun — your questions","body":"Dear DataRun team,\n\nHappy to help — we hold ISO 27001 and SOC 2, and we do support on-prem hybrid. Shall I send the details and set up a short call?\n\nKind regards,\nEVERTRUST GmbH"}}'),
  ('c3000000-0000-0000-0000-000000000001', 'bb000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-0000000000b2', 'NOT_INTERESTED', 'demo-seed',
     'Dear BrightLED team,\n\nUnderstood — we have removed you from our list and will not contact you again. Thank you for letting us know.\n\nKind regards,\nEVERTRUST GmbH',
     '{"source":"demo-seed","status":"UNINTERESTED","confidence":0.9,"reasoning":"Explicit opt-out request.","draft":{"subject":"Re: LED retrofit for BrightLED portfolio","body":"Dear BrightLED team,\n\nUnderstood — we have removed you from our list and will not contact you again. Thank you for letting us know.\n\nKind regards,\nEVERTRUST GmbH"}}'),
  ('c4000000-0000-0000-0000-000000000002', 'bb000000-0000-0000-0000-000000000002', 'b2000000-0000-0000-0000-0000000000b2', 'INTERESTED', 'demo-seed',
     'Dear LumenWorks team,\n\nThank you — I will prepare a quote for 300 units including delivery to Poznan and share it shortly. Would a brief call help align on timing?\n\nKind regards,\nEVERTRUST GmbH',
     '{"source":"demo-seed","status":"INTERESTED","confidence":0.94,"reasoning":"Requests a quote for 300 units with delivery — strong buying intent.","draft":{"subject":"Re: LED retrofit for LumenWorks — quote","body":"Dear LumenWorks team,\n\nThank you — I will prepare a quote for 300 units including delivery to Poznan and share it shortly. Would a brief call help align on timing?\n\nKind regards,\nEVERTRUST GmbH"}}')
ON CONFLICT DO NOTHING;

-- Postgres standard string literals don't interpret '\n', so the draft bodies above
-- store a literal backslash-n. Convert to real newlines so the UI renders line breaks.
UPDATE reply_classifications
  SET suggested_reply = replace(suggested_reply, '\n', chr(10))
  WHERE model = 'demo-seed' AND suggested_reply LIKE '%\n%';

COMMIT;

-- Summary
SELECT 'org_senders' AS t, count(*) FROM org_senders WHERE organization_id = :'org'
UNION ALL SELECT 'campaigns', count(*) FROM campaigns WHERE organization_id = :'org'
UNION ALL SELECT 'prospects (seed)', count(*) FROM prospects WHERE email LIKE 'demo.%@%.example'
UNION ALL SELECT 'outreach_messages (seed)', count(*) FROM outreach_messages WHERE gmail_message_id LIKE 'seed-%'
UNION ALL SELECT 'reply_classifications (seed)', count(*) FROM reply_classifications WHERE model = 'demo-seed';
