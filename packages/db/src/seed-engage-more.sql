-- More Engage demo campaigns for the Supabase DB. Idempotent (fixed UUIDs + ON CONFLICT
-- DO NOTHING). Adds 3 campaigns across 2 inboxes, each with INTERESTED / UNSURE /
-- NOT_INTERESTED replies (all pre-classified so they show immediately). All .example.
-- Run:  psql "$DATABASE_URL" -f packages/db/src/seed-engage-more.sql

\set org '833e83c7-ba3a-4539-8499-8e5e532444a8'
\set nCyber '6647cd26-33e8-42f5-9432-07f3ce9356a6'
\set nContainer '52fd9093-c283-476c-8c34-9dd1155cdde6'
\set nAI '45e3e297-013d-43e5-9915-c31c433ea77d'

BEGIN;

-- Campaigns: C = info/Cybersecurity, D = hanna/Container, E = info/AI Platform.
INSERT INTO campaigns (id, organization_id, name, country, region, project, gmail_label, whatsapp_number, niche_id, sender, lifecycle) VALUES
  ('cc000000-0000-0000-0000-0000000000c3', :'org', 'DE Cybersecurity SMB', 'Germany', 'NRW',        'Cyber SMB DE',   'info/cyber',     '000', :'nCyber',     'info',  'ACTIVE'),
  ('cd000000-0000-0000-0000-0000000000d4', :'org', 'PL Container Logistics', 'Poland', 'Pomorskie', 'Container PL',   'hanna/container', '000', :'nContainer', 'hanna', 'ACTIVE'),
  ('ce000000-0000-0000-0000-0000000000e5', :'org', 'EU AI Platform Pilots', 'Germany', 'Bavaria',   'AI Pilots EU',   'info/ai',        '000', :'nAI',        'info',  'PAUSED')
ON CONFLICT DO NOTHING;

-- Prospects: one INTERESTED, one UNSURE, one NOT_INTERESTED per campaign.
INSERT INTO prospects (id, organization_id, campaign_id, email, company_name, city, country, email_verified, status) VALUES
  ('c0000000-0000-0000-0000-0000000000c1', :'org', 'cc000000-0000-0000-0000-0000000000c3', 'demo.weber@securenet.example',    'SecureNet GmbH',     'Cologne',   'Germany', true, 'INTERESTED'),
  ('c0000000-0000-0000-0000-0000000000c2', :'org', 'cc000000-0000-0000-0000-0000000000c3', 'demo.schulz@netguard.example',    'NetGuard',           'Dortmund',  'Germany', true, 'REPLIED'),
  ('c0000000-0000-0000-0000-0000000000c3', :'org', 'cc000000-0000-0000-0000-0000000000c3', 'demo.fischer@byteshield.example', 'ByteShield',         'Essen',     'Germany', true, 'NOT_INTERESTED'),
  ('d0000000-0000-0000-0000-0000000000d1', :'org', 'cd000000-0000-0000-0000-0000000000d4', 'demo.mazur@portflow.example',     'PortFlow Sp. z o.o.', 'Gdynia',   'Poland',  true, 'INTERESTED'),
  ('d0000000-0000-0000-0000-0000000000d2', :'org', 'cd000000-0000-0000-0000-0000000000d4', 'demo.jankowski@boxline.example',  'BoxLine',            'Gdansk',    'Poland',  true, 'REPLIED'),
  ('d0000000-0000-0000-0000-0000000000d3', :'org', 'cd000000-0000-0000-0000-0000000000d4', 'demo.wojcik@cargopl.example',     'CargoPL',            'Sopot',     'Poland',  true, 'NOT_INTERESTED'),
  ('e0000000-0000-0000-0000-0000000000e1', :'org', 'ce000000-0000-0000-0000-0000000000e5', 'demo.huber@modelworks.example',   'ModelWorks AG',      'Munich',    'Germany', true, 'INTERESTED'),
  ('e0000000-0000-0000-0000-0000000000e2', :'org', 'ce000000-0000-0000-0000-0000000000e5', 'demo.bauer@inferenceio.example',  'Inference.io',       'Nuremberg', 'Germany', true, 'REPLIED'),
  ('e0000000-0000-0000-0000-0000000000e3', :'org', 'ce000000-0000-0000-0000-0000000000e5', 'demo.wolf@neuralstack.example',   'NeuralStack',        'Augsburg',  'Germany', true, 'NOT_INTERESTED')
ON CONFLICT DO NOTHING;

-- One OUTBOUND + one INBOUND per prospect.
INSERT INTO outreach_messages (id, prospect_id, direction, status, gmail_message_id, gmail_thread_id, subject, body_snippet, sent_at) VALUES
  ('c1a00000-0000-0000-0000-0000000000c1', 'c0000000-0000-0000-0000-0000000000c1', 'OUTBOUND', 'SENT',     'seed-c1-out', 'thr-c1', 'Managed SOC for SecureNet',  'Hello, we provide a managed SOC with 24/7 monitoring for German SMBs.', now() - interval '2 days'),
  ('c1b00000-0000-0000-0000-0000000000c1', 'c0000000-0000-0000-0000-0000000000c1', 'INBOUND',  'RECEIVED', 'seed-c1-in',  'thr-c1', 'Re: Managed SOC for SecureNet', 'Sounds good — please send pricing for 24/7 SOC for ~80 endpoints and a call next week.', now() - interval '3 hours'),
  ('c2a00000-0000-0000-0000-0000000000c2', 'c0000000-0000-0000-0000-0000000000c2', 'OUTBOUND', 'SENT',     'seed-c2-out', 'thr-c2', 'Managed SOC for NetGuard',   'Hello, we provide a managed SOC with 24/7 monitoring.', now() - interval '2 days'),
  ('c2b00000-0000-0000-0000-0000000000c2', 'c0000000-0000-0000-0000-0000000000c2', 'INBOUND',  'RECEIVED', 'seed-c2-in',  'thr-c2', 'Re: Managed SOC for NetGuard', 'Are you ISO 27001 certified and do you cover incident response?', now() - interval '6 hours'),
  ('c3a00000-0000-0000-0000-0000000000c3', 'c0000000-0000-0000-0000-0000000000c3', 'OUTBOUND', 'SENT',     'seed-c3-out', 'thr-c3', 'Managed SOC for ByteShield', 'Hello, we provide a managed SOC with 24/7 monitoring.', now() - interval '2 days'),
  ('c3b00000-0000-0000-0000-0000000000c3', 'c0000000-0000-0000-0000-0000000000c3', 'INBOUND',  'RECEIVED', 'seed-c3-in',  'thr-c3', 'Re: Managed SOC for ByteShield', 'We already have a provider. Not interested, thanks.', now() - interval '5 hours'),
  ('d1a00000-0000-0000-0000-0000000000d1', 'd0000000-0000-0000-0000-0000000000d1', 'OUTBOUND', 'SENT',     'seed-d1-out', 'thr-d1', 'Container yard optimization for PortFlow', 'Hello, we optimize container yard throughput with scheduling software.', now() - interval '2 days'),
  ('d1b00000-0000-0000-0000-0000000000d1', 'd0000000-0000-0000-0000-0000000000d1', 'INBOUND',  'RECEIVED', 'seed-d1-in',  'thr-d1', 'Re: Container yard optimization for PortFlow', 'Interested — can you send a quote and ROI estimate for a 500 TEU/day yard?', now() - interval '2 hours'),
  ('d2a00000-0000-0000-0000-0000000000d2', 'd0000000-0000-0000-0000-0000000000d2', 'OUTBOUND', 'SENT',     'seed-d2-out', 'thr-d2', 'Container yard optimization for BoxLine', 'Hello, we optimize container yard throughput with scheduling software.', now() - interval '2 days'),
  ('d2b00000-0000-0000-0000-0000000000d2', 'd0000000-0000-0000-0000-0000000000d2', 'INBOUND',  'RECEIVED', 'seed-d2-in',  'thr-d2', 'Re: Container yard optimization for BoxLine', 'Does this integrate with our existing TOS? Which one do you support?', now() - interval '7 hours'),
  ('d3a00000-0000-0000-0000-0000000000d3', 'd0000000-0000-0000-0000-0000000000d3', 'OUTBOUND', 'SENT',     'seed-d3-out', 'thr-d3', 'Container yard optimization for CargoPL', 'Hello, we optimize container yard throughput with scheduling software.', now() - interval '2 days'),
  ('d3b00000-0000-0000-0000-0000000000d3', 'd0000000-0000-0000-0000-0000000000d3', 'INBOUND',  'RECEIVED', 'seed-d3-in',  'thr-d3', 'Re: Container yard optimization for CargoPL', 'Please remove us, not relevant.', now() - interval '4 hours'),
  ('e1a00000-0000-0000-0000-0000000000e1', 'e0000000-0000-0000-0000-0000000000e1', 'OUTBOUND', 'SENT',     'seed-e1-out', 'thr-e1', 'AI inference platform for ModelWorks', 'Hello, we host low-latency model inference with autoscaling.', now() - interval '2 days'),
  ('e1b00000-0000-0000-0000-0000000000e1', 'e0000000-0000-0000-0000-0000000000e1', 'INBOUND',  'RECEIVED', 'seed-e1-in',  'thr-e1', 'Re: AI inference platform for ModelWorks', 'Great timing — we need this. Can you quote for 5M requests/day and set up a call?', now() - interval '1 hour'),
  ('e2a00000-0000-0000-0000-0000000000e2', 'e0000000-0000-0000-0000-0000000000e2', 'OUTBOUND', 'SENT',     'seed-e2-out', 'thr-e2', 'AI inference platform for Inference.io', 'Hello, we host low-latency model inference with autoscaling.', now() - interval '2 days'),
  ('e2b00000-0000-0000-0000-0000000000e2', 'e0000000-0000-0000-0000-0000000000e2', 'INBOUND',  'RECEIVED', 'seed-e2-in',  'thr-e2', 'Re: AI inference platform for Inference.io', 'What GPUs do you run, and where are the regions?', now() - interval '8 hours'),
  ('e3a00000-0000-0000-0000-0000000000e3', 'e0000000-0000-0000-0000-0000000000e3', 'OUTBOUND', 'SENT',     'seed-e3-out', 'thr-e3', 'AI inference platform for NeuralStack', 'Hello, we host low-latency model inference with autoscaling.', now() - interval '2 days'),
  ('e3b00000-0000-0000-0000-0000000000e3', 'e0000000-0000-0000-0000-0000000000e3', 'INBOUND',  'RECEIVED', 'seed-e3-in',  'thr-e3', 'Re: AI inference platform for NeuralStack', 'We build this in-house. No thank you.', now() - interval '5 hours')
ON CONFLICT DO NOTHING;

-- Classifications (verdict + draft) for each.
INSERT INTO reply_classifications (id, prospect_id, message_id, verdict, model, suggested_reply, raw) VALUES
  ('cf000000-0000-0000-0000-0000000000c1', 'c0000000-0000-0000-0000-0000000000c1', 'c1b00000-0000-0000-0000-0000000000c1', 'INTERESTED', 'demo-seed', 'Dear SecureNet team,\n\nThank you — I will prepare 24/7 SOC pricing for ~80 endpoints and propose a call. Does Wednesday 10:00 work?\n\nKind regards,\nEVERTRUST GmbH', '{"source":"demo-seed","status":"INTERESTED","confidence":0.9,"reasoning":"Requests pricing and a call.","draft":{"subject":"Re: Managed SOC for SecureNet — next steps","body":"Dear SecureNet team,\n\nThank you — I will prepare 24/7 SOC pricing for ~80 endpoints and propose a call. Does Wednesday 10:00 work?\n\nKind regards,\nEVERTRUST GmbH"}}'),
  ('cf000000-0000-0000-0000-0000000000c2', 'c0000000-0000-0000-0000-0000000000c2', 'c2b00000-0000-0000-0000-0000000000c2', 'UNSURE', 'demo-seed', 'Dear NetGuard team,\n\nYes — we are ISO 27001 certified and incident response is included. Shall I send the details and book a short call?\n\nKind regards,\nEVERTRUST GmbH', '{"source":"demo-seed","status":"UNSURE","confidence":0.5,"reasoning":"Clarifying questions, no clear intent yet.","draft":{"subject":"Re: Managed SOC for NetGuard — your questions","body":"Dear NetGuard team,\n\nYes — we are ISO 27001 certified and incident response is included. Shall I send the details and book a short call?\n\nKind regards,\nEVERTRUST GmbH"}}'),
  ('cf000000-0000-0000-0000-0000000000c3', 'c0000000-0000-0000-0000-0000000000c3', 'c3b00000-0000-0000-0000-0000000000c3', 'NOT_INTERESTED', 'demo-seed', 'Dear ByteShield team,\n\nUnderstood — thank you for letting us know. We will not contact you again.\n\nKind regards,\nEVERTRUST GmbH', '{"source":"demo-seed","status":"UNINTERESTED","confidence":0.88,"reasoning":"Has an existing provider, declines.","draft":{"subject":"Re: Managed SOC for ByteShield","body":"Dear ByteShield team,\n\nUnderstood — thank you for letting us know. We will not contact you again.\n\nKind regards,\nEVERTRUST GmbH"}}'),
  ('df000000-0000-0000-0000-0000000000d1', 'd0000000-0000-0000-0000-0000000000d1', 'd1b00000-0000-0000-0000-0000000000d1', 'INTERESTED', 'demo-seed', 'Dear PortFlow team,\n\nThank you — I will prepare a quote and ROI estimate for a 500 TEU/day yard and share it shortly. Would a call help?\n\nKind regards,\nEVERTRUST GmbH', '{"source":"demo-seed","status":"INTERESTED","confidence":0.93,"reasoning":"Requests quote and ROI.","draft":{"subject":"Re: Container yard optimization for PortFlow — quote","body":"Dear PortFlow team,\n\nThank you — I will prepare a quote and ROI estimate for a 500 TEU/day yard and share it shortly. Would a call help?\n\nKind regards,\nEVERTRUST GmbH"}}'),
  ('df000000-0000-0000-0000-0000000000d2', 'd0000000-0000-0000-0000-0000000000d2', 'd2b00000-0000-0000-0000-0000000000d2', 'UNSURE', 'demo-seed', 'Dear BoxLine team,\n\nWe integrate with the major TOS platforms — happy to confirm yours. Which TOS do you run, and shall I set up a short call?\n\nKind regards,\nEVERTRUST GmbH', '{"source":"demo-seed","status":"UNSURE","confidence":0.52,"reasoning":"Integration question, no clear intent.","draft":{"subject":"Re: Container yard optimization for BoxLine — integration","body":"Dear BoxLine team,\n\nWe integrate with the major TOS platforms — happy to confirm yours. Which TOS do you run, and shall I set up a short call?\n\nKind regards,\nEVERTRUST GmbH"}}'),
  ('df000000-0000-0000-0000-0000000000d3', 'd0000000-0000-0000-0000-0000000000d3', 'd3b00000-0000-0000-0000-0000000000d3', 'NOT_INTERESTED', 'demo-seed', 'Dear CargoPL team,\n\nUnderstood — we have removed you and will not contact you again. Thank you.\n\nKind regards,\nEVERTRUST GmbH', '{"source":"demo-seed","status":"UNINTERESTED","confidence":0.9,"reasoning":"Opt-out request.","draft":{"subject":"Re: Container yard optimization for CargoPL","body":"Dear CargoPL team,\n\nUnderstood — we have removed you and will not contact you again. Thank you.\n\nKind regards,\nEVERTRUST GmbH"}}'),
  ('ef000000-0000-0000-0000-0000000000e1', 'e0000000-0000-0000-0000-0000000000e1', 'e1b00000-0000-0000-0000-0000000000e1', 'INTERESTED', 'demo-seed', 'Dear ModelWorks team,\n\nThank you — I will quote for 5M requests/day and propose a call. Does Thursday 15:00 suit?\n\nKind regards,\nEVERTRUST GmbH', '{"source":"demo-seed","status":"INTERESTED","confidence":0.95,"reasoning":"Strong intent, requests quote + call.","draft":{"subject":"Re: AI inference platform for ModelWorks — next steps","body":"Dear ModelWorks team,\n\nThank you — I will quote for 5M requests/day and propose a call. Does Thursday 15:00 suit?\n\nKind regards,\nEVERTRUST GmbH"}}'),
  ('ef000000-0000-0000-0000-0000000000e2', 'e0000000-0000-0000-0000-0000000000e2', 'e2b00000-0000-0000-0000-0000000000e2', 'UNSURE', 'demo-seed', 'Dear Inference.io team,\n\nWe run current-gen GPUs across EU regions — happy to share specifics. Shall I send the datasheet and book a call?\n\nKind regards,\nEVERTRUST GmbH', '{"source":"demo-seed","status":"UNSURE","confidence":0.5,"reasoning":"Technical questions, no clear intent.","draft":{"subject":"Re: AI inference platform for Inference.io — specs","body":"Dear Inference.io team,\n\nWe run current-gen GPUs across EU regions — happy to share specifics. Shall I send the datasheet and book a call?\n\nKind regards,\nEVERTRUST GmbH"}}'),
  ('ef000000-0000-0000-0000-0000000000e3', 'e0000000-0000-0000-0000-0000000000e3', 'e3b00000-0000-0000-0000-0000000000e3', 'NOT_INTERESTED', 'demo-seed', 'Dear NeuralStack team,\n\nUnderstood — thanks for the reply. We will not contact you again.\n\nKind regards,\nEVERTRUST GmbH', '{"source":"demo-seed","status":"UNINTERESTED","confidence":0.87,"reasoning":"Builds in-house, declines.","draft":{"subject":"Re: AI inference platform for NeuralStack","body":"Dear NeuralStack team,\n\nUnderstood — thanks for the reply. We will not contact you again.\n\nKind regards,\nEVERTRUST GmbH"}}')
ON CONFLICT DO NOTHING;

-- Render literal '\n' in the draft bodies as real newlines (see seed-engage-demo.sql).
UPDATE reply_classifications
  SET suggested_reply = replace(suggested_reply, '\n', chr(10))
  WHERE model = 'demo-seed' AND suggested_reply LIKE '%\n%';

COMMIT;

SELECT 'campaigns (total)' AS t, count(*) FROM campaigns WHERE organization_id = :'org'
UNION ALL SELECT 'prospects (seed total)', count(*) FROM prospects WHERE email LIKE 'demo.%@%.example'
UNION ALL SELECT 'classified (seed total)', count(*) FROM reply_classifications WHERE model = 'demo-seed';
