# ContractMaker (PG) — n8n rebuild plan

## RESULT (2026-06-12)
Created NEW workflow **wZWcjzx7fSbbsT7c** "EVERTRUST - ContractMaker (PG)" — INACTIVE — in
project **ur8aLn8JmnpaN0ih** (same as original ojHoD5ef3lG15YSi). 27 nodes. validate_workflow=valid.
URL: https://evertrustgmbh.app.n8n.cloud/workflow/wZWcjzx7fSbbsT7c

USER STEPS (credential auto-assignment by n8n picked generic, not the intended creds):
- Copy Template / Export PDF / Save PDF: got "Google Drive OAuth2 API" → switch to "Google Drive account: Hanna" (R1hfa3xjcJxi0F2E).
- Fill: got "Google Docs OAuth2 API" → switch to "Google Docs account: Hanna" (CL2ABY272xHf9GZq).
- Signal Model / Deal Model: got "OpenAI account" → confirm/switch to "LiteLLM Gateway (mac-mini)" (2YgDmy9NuLHvOgzJ) for gpt-5-mini routing.
- ERP nodes (Active Campaigns, Contract Idempotency, Record Contract, Mark Signed): UNBOUND httpHeaderAuth → select the ERP Ingest (x-arsenal-token) credential.
- Ping CRM Sync / Resolve Template: Ping CRM needs no cred; Resolve Template uses predefined googleDriveOAuth2Api → bind Hanna Drive too.


Source: EVERTRUST — ContractMaker v2 (Multi-Meeting) `ojHoD5ef3lG15YSi`
Original project: **ur8aLn8JmnpaN0ih** (personal: Trung Cang Huynh) — NOT REACH ARSENAL.
Target: create NEW workflow "EVERTRUST - ContractMaker (PG)" in the SAME project (ur8aLn8JmnpaN0ih), INACTIVE.

ERP base: https://evertrust-api.onrender.com  (sticky: live only post-deploy; update base if differs)

## Live topology (27 nodes)
Webhook → Adapt Meeting Text → Signal Extractor(+Signal Model) → Build Log Row → Append Log(Sheets)
  → [Ping CRM Sync] + [Gate: Signing(filter) → Read Company Log(Sheets) → Check & Aggregate
     → Deal Extractor(+Deal Model) → Search Configs(Drive) → Explode Configs → Download Config(Drive)
     → Match Campaign → Build Fields → Resolve Template(Drive) → Pick Template → Copy Template(Drive)
     → Fill(Docs) → Export PDF(Drive) → Save PDF(Drive) → Build Marker → Mark Processed(Sheets)]
Manual test path: Run Manually → Sample Meetings → Signal Extractor.

## New topology
KEEP trigger + Read.ai logging + signing detection + the Drive/Docs PDF generation spine.
REPLACE the config.json/Drive lookup and the hot_leads Sheet writes with ERP API calls.

Webhook → Adapt Meeting Text → Signal Extractor(+Signal Model) → Build Signal (was Build Log Row)
  → [Ping CRM Sync (onError continue)]
  → [Gate: Signing(filter) → Check & Aggregate → Deal Extractor(+Deal Model)
     → ERP: Active Campaigns (GET /campaigns/machine/list?lifecycle=ACTIVE)
     → Match Campaign (filter list by niche+country in Code → campaignId + template + folder)
     → ERP: Contract Idempotency (GET /contracts?leadId=&limit=1, onError continue + alwaysOutput)
     → IF no GENERATED/SIGNED contract:
         Build Fields → Resolve Template(Drive) → Pick Template → Copy Template(Drive)
         → Fill(Docs) → Export PDF(Drive) → Save PDF(Drive)
         → ERP: Record Contract (POST /contracts GENERATED, driveFileId/driveUrl)  [SPINE — fails loud]
         → ERP: Mark Signed (PATCH /contracts/{id} SIGNED, signedAt, cooperationTerm) [SPINE — fails loud]
     ]
Manual test path retained: Run Manually → Sample Meetings → Signal Extractor.

## Dropped vs kept
DROP (Drive config / Sheets): Append Log, Read Company Log, Search Configs, Explode Configs,
  Download Config, Build Marker, Mark Processed.
KEEP (Drive PDF gen, binary): Resolve Template, Pick Template, Copy Template, Fill, Export PDF, Save PDF.
KEEP (logic): Webhook, Adapt Meeting Text, Signal Extractor/Model, Gate: Signing, Check & Aggregate,
  Deal Extractor/Model, Build Fields, Pick Template, Ping CRM Sync, Run Manually, Sample Meetings.
NEW (ERP): Active Campaigns(GET), Match Campaign(Code, re-pointed), Contract Idempotency(GET),
  Record Contract(POST), Mark Signed(PATCH).

## Credentials
- Drive nodes → Google Drive account: Hanna  (R1hfa3xjcJxi0F2E, googleDriveOAuth2Api)
- Docs node  → Google Docs account: Hanna   (CL2ABY272xHf9GZq, googleDocsOAuth2Api)
- AI models  → newCredential('LiteLLM Gateway (mac-mini)') (openAiApi) — user binds
- ERP HTTP   → authentication genericCredentialType / genericAuthType httpHeaderAuth, UNBOUND;
               sticky tells user to select "ERP Ingest (x-arsenal-token)".
- Ping CRM   → no creds (internal n8n webhook), unchanged.

## ID resolution assumptions (documented for user)
- leadId / customerId: not present in Read.ai payload. Build Signal sets leadId = companyKey-derived
  external key passthrough = '' unless provided; ERP calls send whatever is resolved. Idempotency GET
  uses leadId when available else campaignId. Documented as assumption.
- signingMeetingId = session_id from Read.ai webhook (meetingId).
- campaignId from ERP active-list match (niche+country). campaignFolderId/templateName from the campaign
  config (driveFolderId / templateAssetName fields) with fallback to legacy stub if absent.
