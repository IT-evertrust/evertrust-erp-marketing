# CRM Customer — Blueprint (ERP / PG)

**Spec:** n8n workflow `vNCqzVjOOhSD2Czb` — *EVERTRUST - CRM Customer (PG)* (19 nodes).
**Python:** `erp-server/agents/crm/` (ERP-native; reach pattern). Pure ERP agent — no LLM/Gmail.
**Role:** keeps the CRM in sync — promotes engaged prospects to **hot-leads** and graduates
signed-contract companies to **customers**.

> Supersedes the Drive folder walk + Leads/Customers/Meeting-Log Sheets. Signing now comes from
> `/contracts` (written by ContractMaker), not a Meeting-Log signNow column.

## Trigger & I/O
- **Trigger:** daily 08:00 (also manual/webhook). Python = `POST /crm/run`.
- **Output:** `{ runId, mode, campaigns, counts:{hotLeads, customers}, posted, hotLeads[], customers[] }`.

## ERP machine endpoints (x-arsenal-token)
| Call | Purpose |
|---|---|
| `GET /campaigns/machine/list?lifecycle=ACTIVE` | active campaigns |
| `GET /prospects?campaignId=&limit=500` | campaign prospects |
| `GET /contracts?campaignId=&status=SIGNED&limit=200` | signed contracts (→ signed company keys) |
| `GET /customers?limit=1000` | existing customers (dedup graduations) |
| `POST /hot-leads` | intake (Interested/Meeting prospects) |
| `POST /customers` | graduation (signed, not already a customer) |

> The workflow sticky flags `/customers` + `/hot-leads` as **ASSUMED** — confirm against the ERP API.

## Logic (pure, unit-tested — `domain/models.py`)
- `norm_company(name)` — comparison key: NFD-strip diacritics, drop `sp. z o.o.`/`gmbh`, keep
  `[a-z0-9]`. (Faithful to the JS: `ł` is dropped, not folded to `l` — applied to both sides.)
- `signed_keys_from(contracts)` → set of normalized company keys.
- `compute_rows(campaigns, customer_emails, now_iso)` → rows:
  - prospect status `Interested*`/`Meeting*` (dedup by email) ⇒ **hot** row
    (`hotReason = "Signed"` if its company key is in the signed set, else `Interested`/`MeetingScheduled`).
  - signed company **and** email not already a customer (dedup) ⇒ **cust** row (`stage: Customer`).

## Python implementation map
- `domain/models.py` — `Campaign`, `norm_company`, `signed_keys_from`, `compute_rows`.
- `clients/erp.py` — `ErpGateway` + `ErpClient` (the 6 calls). **(new — replaces db.py)**
- `pipeline.py` — `run(settings, opts, erp)`: per campaign gather prospects+contracts, compute, post.
- `server.py` — `POST /crm/run`; injectable `get_erp`. `settings.py` (ERP only); `cli.py` (`--live`).

## Behaviour
- **Dry-run (default):** compute intake + graduation, **no ERP writes**.
- **--live:** `POST /hot-leads` per hot row, `POST /customers` per graduation.

## Tests (`tests/`, all green — 6)
- `test_models.py` — `norm_company`, `signed_keys_from`, `compute_rows` (intake + graduation +
  dedup + already-a-customer skip).
- `test_route_run.py` — route → crm → output (FakeErp): dry counts/no-writes; live upserts
  3 hot-leads + 1 customer (the signed-but-already-customer prospect stays hot-only).

## Credentials
- ERP `ARSENAL_TOKEN` only (no LLM, no Gmail).
