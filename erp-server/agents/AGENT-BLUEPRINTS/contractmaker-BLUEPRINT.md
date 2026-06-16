# ContractMaker — Blueprint (ERP / PG)

**Spec:** n8n workflow `wZWcjzx7fSbbsT7c` — *EVERTRUST - ContractMaker (PG)* (27 nodes).
**Python:** `erp-server/agents/contractmaker/` (ERP-native; reach pattern).
**Role:** turns a signed-deal meeting into a cooperation contract PDF and records it in the ERP.

> Supersedes ContractMaker v2's config-doc lookup + hot-leads Sheet writes. **Contract PDF
> generation stays in Google Docs/Drive** (binary work). Only the data layer moved to the ERP:
> campaign resolution + contract idempotency/record/sign.

## Trigger & I/O
- **Trigger:** Read.ai meeting webhook. Python = `POST /contractmaker/run { meeting: {...} }`.
- **Output:** `{ runId, mode, companyKey, companyName, signNow, status, campaignId, fileBase,
  clientName, action, posted, driveUrl }`. `status` ∈ ok / no_signing / exists.

## ERP machine endpoints (x-arsenal-token)
| Call | Purpose |
|---|---|
| `GET /campaigns/machine/list?lifecycle=ACTIVE` | resolve campaign by country+niche (→ folder, template) |
| `GET /contracts?leadId=&campaignId=&limit=1` | idempotency (skip if GENERATED/SIGNED exists) |
| `POST /contracts` `{status:"GENERATED", driveUrl, leadId, campaignId, templateAssetId, signingMeetingId}` | record |
| `PATCH /contracts/:id` `{status:"SIGNED", signedAt, cooperationTerm}` | mark signed |

## Flow (faithful)
1. `readai.adapt(meeting)` → meeting text/title/id.
2. **Signal extract** (LLM, no-fabrication) → companyName/country/niche + `contractSigningMentioned`.
   **Gate:** only proceed when signing is agreed (`signNow`).
3. **Deal extract** (LLM) → partner legal identity (name/address/signatory/role) — only if literally stated.
4. **Match campaign** (`contract.match_campaign`, country+niche → folder + templateAssetId).
5. **Idempotency** — skip if a GENERATED/SIGNED contract already exists.
6. **Build fields** (`contract.build_fields`) — grounding-guarded identity (no invented facts) +
   hardcoded commercial terms + language EN/DE + file base.
7. **Generate PDF** (`gdocs.generate_contract_pdf`: copy template → fill placeholders → export PDF → save).
8. `POST /contracts` GENERATED → `PATCH /contracts/:id` SIGNED.

## Python implementation map (reuses existing modules)
- `readai.adapt`, `domain/company.company_key`, `domain/contract.{match_campaign,build_fields,grounded,...}`,
  `clients/llm.{signal_extract,deal_extract,offline_signal}`, `clients/gdocs.generate_contract_pdf` — reused.
- `clients/erp.py` — `ErpGateway` + `ErpClient` (the 4 calls). **(new — replaces db.py)**
- `pipeline.py` — `run(settings, opts, erp, llm, gdocs)`.
- `server.py` — `POST /contractmaker/run`; injectable `get_erp/get_llm/get_gdocs`.
- `settings.py` (ERP + LLM + google_token_dir); `cli.py` (meeting JSON in, `--live`, `--no-llm`).

## Behaviour
- **Dry-run (default):** extract + match + build fields, **no PDF, no ERP writes** (`action: planned`).
- **--live:** generate the PDF, `POST /contracts` GENERATED, `PATCH` SIGNED.
- **Fail-safe:** non-signing meetings (`no_signing`) and already-contracted deals (`exists`) skip cleanly.

## Tests (`tests/`, all green — 12)
- `test_contract.py` — existing pure tests (match/grounding/build_fields).
- `test_route_run.py` — route → contractmaker → output (FakeErp/LLM/gdocs): dry (no writes/PDF),
  live (PDF + record GENERATED + mark SIGNED), non-signing skip, idempotency skip.

## Credentials
- ERP `ARSENAL_TOKEN`; LiteLLM gateway (model `gpt-5-mini`); **Google Docs + Drive OAuth** (PDF gen).

## Notes / deferred
- The n8n "Ping CRM Sync" (posts to the n8n CRM webhook) is dropped — the CRM agent runs on its
  own schedule and reads `/contracts` directly.
- `record_contract` sends `driveUrl` (the gdocs client returns a URL); add `driveFileId` if the
  ERP needs it separately.
