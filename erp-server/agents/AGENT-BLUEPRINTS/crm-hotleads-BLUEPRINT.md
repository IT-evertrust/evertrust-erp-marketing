# Blueprint — EVERTRUST · CRM Hot Leads (n8n `s65rZ9hiuvVCbKu5`)

> Faithful distillation of the live n8n workflow for re-implementation as local Python
> (EVERTRUST migration off n8n → Postgres/Supabase). Source: `n8n_get_workflow` mode=full,
> instance `evertrustgmbh.app.n8n.cloud`, project **REACH ARSENAL**. 13 nodes, `active: false`,
> versionCounter 71, updated 2026-06-05.

---

## ⚠️ TOP-LINE FINDING (read this first)

**The real "CRM Hot Leads" workflow is a PROVISIONER, not a processor.**

Despite its name and tracking-column headers, this workflow does **NOT**:
- read leads,
- qualify "hot" leads,
- dedup,
- derive `hot_reason`,
- write any data rows.

All it does is: **detect whether a `hot_leads` spreadsheet already exists in a campaign's
Google Drive folder, and if not, create one, move it into the folder, and write a single
header row of 21 columns.** That's the entire job.

The workflow's own description confirms this:
> "3 triggers (Webhook + Manual + On New Folder Drive poll on Evertrust Campaigns) -> Resolve
> Folder ID -> skip if hot_leads exists, else create + move + header (now incl. Meeting 1-5,
> Final Meeting, Contract Status tracking columns)."

**Consequence for the migration:** the existing `crm/` Python package implements qualification,
dedup, `hot_reason`, meeting fill, and graduation — i.e. the *processing* logic. None of that
logic lives in THIS workflow. It must have come from the sibling **"CRM Customer"
`Dddp6wSvw3rwEsOw"** workflow (or "Compute Intake + Graduate" node referenced in `state.py`'s
docstring). So the "thin port" did not actually *miss* CRM-Hot-Leads logic — because CRM Hot
Leads has almost no logic. What the thin port replaced is the **provisioning step**, which it
correctly declares unnecessary (see `schema_additions.sql` header comment). The real gap is
elsewhere (see Gap Analysis).

---

## Purpose (end-to-end)

Per-campaign **schema provisioning** for the Hot Leads output store. When a new campaign folder
appears under "Evertrust Campaigns" (or is provisioned on demand via webhook / manual run), this
workflow guarantees that campaign folder contains exactly one `hot_leads` spreadsheet with the
canonical 21-column header. It is idempotent: if a `hot_leads` sheet already exists, it responds
"already exists" and writes nothing.

The actual population of that sheet with qualified hot leads is done by a **different** workflow.

---

## Trigger & Inputs

Three triggers, all converging on `Resolve Folder ID`:

| Trigger node | Type | Fires when | Payload shape |
|---|---|---|---|
| **Webhook** | `n8n-nodes-base.webhook` v2.1 | POST to path `provision-hot-leads`, `responseMode: responseNode`, CORS `allowedOrigins: *` | `$json.body.folderId` (optional) |
| **Run Manually** | `n8n-nodes-base.manualTrigger` v1 | Manual click | none |
| **On New Folder (Drive Poll)** | `n8n-nodes-base.googleDriveTrigger` v1 | `event: folderCreated`, `triggerOn: specificFolder`, polls **everyMinute** on folder **`1Keop0NUWo3dX7LsaqTwhJcZlAFGP7wId` ("Evertrust Campaigns")** | new folder object → `$json.id` |

**Folder resolution** (`Resolve Folder ID`, Set node, manual mode, includeOtherFields false):
```
folderId = {{ $json.body?.folderId || $json.id || '16XDJ1VIUa-I6yVP_dWQ4yO0YtguwJkoY' }}
```
i.e. webhook body folderId → Drive-trigger new-folder id → hardcoded fallback folder
`16XDJ1VIUa-I6yVP_dWQ4yO0YtguwJkoY`.

---

## Node-by-node flow (execution order)

1. **Webhook / Run Manually / On New Folder (Drive Poll)** — three entry points (above).
2. **Resolve Folder ID** (`set` v3.4) — compute single string field `folderId` (expression above).
3. **List Folder Files** (`googleDrive` v3) — `resource: fileFolder`, `operation: search`,
   `returnAll: true`, `filter.folderId = {{ $json.folderId }}` (mode id), `whatToSearch: files`.
   `alwaysOutputData: true`, `onError: continueRegularOutput`. Lists every file in the campaign folder.
4. **Check hot_leads Exists** (`code` v2) — JS, detects existing hot_leads sheet (full code below).
5. **hot_leads exists?** (`if` v2.2) — strict, caseSensitive, typeValidation strict.
   Condition: `{{ $json.exists }}` **string equals** `"true"`.
   - **TRUE output (index 0)** → Respond Exists
   - **FALSE output (index 1)** → Create hot_leads Sheet
6. **Respond Exists** (`respondToWebhook` v1.5) — JSON `{ success:true, alreadyExists:true, folderId:<resolved> }`, header `Access-Control-Allow-Origin: *`. `onError: continueRegularOutput`. (Terminal on the exists branch.)
7. **Create hot_leads Sheet** (`googleSheets` v4.7) — `resource: spreadsheet`, `operation: create`, `title: "hot_leads"`. Returns `spreadsheetId`.
8. **Move hot_leads To Campaign Folder** (`googleDrive` v3) — `resource: file`, `operation: move`, `fileId = {{ $('Create hot_leads Sheet').first().json.spreadsheetId }}`, `driveId: My Drive`, `folderId = {{ $('Resolve Folder ID').item.json.folderId }}`.
9. **Build hot_leads Header** (`code` v2) — emits one object with the 21 header keys, all empty strings (full code below).
10. **Write hot_leads Header** (`googleSheets` v4.7) — `resource: sheet`, `operation: append`, `documentId = spreadsheetId` (from Create), `sheetName: gid=0` (Sheet1), `columns.mappingMode: autoMapInputData`. Writes the header row (keys become the column header row).
11. **Respond OK** (`respondToWebhook` v1.5) — JSON `{ success:true, hotLeadsSheetId:<id>, hotLeadsUrl: 'https://docs.google.com/spreadsheets/d/'+id }`, CORS header. (Terminal on the create branch.)

Linear chain: `trigger → Resolve Folder ID → List Folder Files → Check hot_leads Exists → hot_leads exists? → {Respond Exists | Create → Move → Build Header → Write Header → Respond OK}`.

---

## Code-node algorithms (FULL JS, verbatim)

### `Check hot_leads Exists` (node 4)
```js
const folderId = $('Resolve Folder ID').first().json.folderId;
const files = $input.all().map(i => i.json).filter(f => f && f.name);
const exists = files.some(f => { const n = (f.name || '').toLowerCase(); return n === 'hot_leads' || (n.includes('hot') && n.includes('lead')); });
return [{ json: { folderId: folderId, exists: exists ? 'true' : 'false' } }];
```
**Algorithm:** existence = any file whose lowercased name is exactly `hot_leads`, **OR** contains
both substrings `"hot"` and `"lead"`. Returns `exists` as a **string** `"true"`/`"false"` (the IF
node compares as string).

### `Build hot_leads Header` (node 9)
```js
return [{ json: {
  'Company Name': '',
  'Company Type': '',
  'Email': '',
  'Website': '',
  'City': '',
  'Country': '',
  'Tier': '',
  'Niche': '',
  'Source Campaign': '',
  'Hot Reason': '',
  'Meeting Date': '',
  'Lead Status': '',
  'Detected At': '',
  'Note': '',
  'Meeting 1': '',
  'Meeting 2': '',
  'Meeting 3': '',
  'Meeting 4': '',
  'Meeting 5': '',
  'Final Meeting': '',
  'Contract Status': ''
} }];
```
**This is the canonical Hot Leads column schema** (21 columns, in this exact order).

There is **no qualification, dedup, hot_reason, or column-mapping code in this workflow.** Those
algorithms are documented in the existing `crm/crm/domain/state.py` (sourced from the sibling
workflow) and reproduced in Gap Analysis below for completeness.

---

## LLM nodes

**None.** No LangChain/AI nodes anywhere in this workflow.

---

## Data: reads & writes (flag → Postgres)

### Reads
| What | Source | Migration target |
|---|---|---|
| Files in a campaign folder | Google Drive `fileFolder.search` on `folderId` | **→ Postgres:** existence check becomes `SELECT 1 FROM hot_leads WHERE campaign_id=%s` (or a campaigns/provisioning flag). No Drive listing needed. |
| New campaign folders | Google Drive Trigger (poll folder `1Keop0NUWo3dX7LsaqTwhJcZlAFGP7wId`) | **→ Postgres:** new-campaign detection becomes a `campaigns` table insert/trigger, or scheduled scan of `campaigns WHERE active`. |

### Writes
| What | Target | Migration target |
|---|---|---|
| New `hot_leads` spreadsheet (title "hot_leads") | Google Sheets `spreadsheet.create` | **→ Postgres `hot_leads` table** — provisioned ONCE via `schema_additions.sql`; no per-campaign sheet creation. |
| Move sheet into campaign folder | Google Drive `file.move` | **→ N/A** (Postgres rows carry `campaign_id`; no file placement). |
| Header row (21 cols) | Google Sheets `sheet.append` | **→ N/A** (table columns ARE the schema). |

**Drive/Sheets dependencies to eliminate (all → Postgres):** `googleDriveTrigger`, `googleDrive`
search, `googleDrive` move, `googleSheets` create, `googleSheets` append.

### Hot Leads sheet columns → live `hot_leads` table mapping

Sheet header (21 cols, from `Build hot_leads Header`) vs live table columns
`id, campaign_id, lead_id, company_name, company_type, email, website, city, country, tier,
niche, source_campaign, hot_reason, meeting_date, lead_status, detected_at, note, final_meeting,
contract_status`:

| Sheet column | Live `hot_leads` column | Notes |
|---|---|---|
| Company Name | company_name | |
| Company Type | company_type | |
| Email | email | |
| Website | website | |
| City | city | |
| Country | country | |
| Tier | tier | |
| Niche | niche | |
| Source Campaign | source_campaign | |
| Hot Reason | hot_reason | `'Interested'` \| `'MeetingScheduled'` |
| Meeting Date | meeting_date | |
| Lead Status | lead_status | |
| Detected At | detected_at | table is `timestamptz DEFAULT now()`; sheet is free text |
| Note | note | |
| Meeting 1 | **— MISSING in live table** | sheet tracks Meeting 1–5; live `hot_leads` has NO meeting_1..5 cols |
| Meeting 2 | **— MISSING** | (`schema_additions.sql` DID add meeting_1..5; live table dropped them — mismatch) |
| Meeting 3 | **— MISSING** | |
| Meeting 4 | **— MISSING** | |
| Meeting 5 | **— MISSING** | |
| Final Meeting | final_meeting | `'Signed <date>'` or `''` |
| Contract Status | contract_status | `'Signed'` or `''` |
| *(no sheet col)* | **id** | DB-only PK |
| *(no sheet col)* | **campaign_id** | added by processor (part of unique key) |
| *(no sheet col)* | **lead_id** | DB-only; not in sheet, not in `schema_additions.sql`, not in `state.py` output |

**Mismatches to flag:**
1. **Meeting 1–5:** present in sheet AND in `crm/schema_additions.sql` (as `meeting_1..meeting_5`),
   but **absent from the live `hot_leads` table** listed in the migration context. Either the live
   table is behind `schema_additions.sql`, or the columns were intentionally dropped. **Decide:**
   keep meeting_1..5 (faithful) or move meeting history to a separate `meetings` join (cleaner).
2. **`lead_id`:** exists in the live table but is NOT produced by the sheet, `Build hot_leads
   Header`, or `state.py`'s `compute()`. The processor must be taught to set it (FK to `leads.id`).
3. **`detected_at`:** sheet stores it as a written string; live table auto-stamps `now()` on
   insert/update. Faithful behavior = stamp at write time (DB default is fine).

---

## Routing (IF/Switch)

Single IF node — **`hot_leads exists?`**:
- Type-strict, case-sensitive. Condition: `$json.exists` **(string) equals `"true"`**.
- **TRUE (output 0)** → `Respond Exists` (skip provisioning, idempotent no-op).
- **FALSE (output 1)** → `Create hot_leads Sheet` → Move → Build Header → Write Header → `Respond OK`.

No Switch nodes.

---

## Credentials referenced

| Credential | Type | Used by |
|---|---|---|
| **Google Drive OAuth2 API** (id `7ntqqDsIDCgae66w`) | `googleDriveOAuth2Api` | On New Folder trigger, List Folder Files, Move hot_leads |
| **Google Sheets OAuth2 API** (id `nVxTVzA6qeIhESvH`) | `googleSheetsOAuth2Api` | Create hot_leads Sheet, Write hot_leads Header |

Both replaced by a single Postgres/Supabase connection in the Python port.

---

## GAP ANALYSIS — existing `crm/` vs what CRM Hot Leads does

**Framing:** CRM Hot Leads (this workflow) = *provisioner only*. The `crm/` package = *processor*.
They are complementary, not the same job. So "what the thin port missed" splits two ways:

### A. What CRM Hot Leads does that `crm/` does NOT replicate (and mostly shouldn't)
| CRM Hot Leads behavior | In `crm/`? | Verdict |
|---|---|---|
| Per-campaign sheet provisioning (create + move + header) | No | **Correctly dropped.** `schema_additions.sql` comment: *"The n8n 'provision hot_leads sheet' step is unnecessary here — the table is provisioned once."* ✅ |
| Idempotent "already exists" skip | Partially — `upsert ON CONFLICT (campaign_id,email)` is the row-level analog | OK; table-level provisioning is one-time DDL. ✅ |
| 21-column header order incl. **Meeting 1–5** | `schema_additions.sql` has meeting_1..5; **live table does not** | **GAP / mismatch** — reconcile (see Data section, mismatch #1). ⚠️ |
| Drive-folder-created → auto-provision trigger | No | Replaced by campaign-driven run. Acceptable, but note: nothing auto-detects "new campaign" yet in Python — `pipeline.py` just iterates `campaigns WHERE active`. ⚠️ |

### B. Processing logic in `crm/` (from the SIBLING workflow, for completeness)
`crm/crm/domain/state.py` implements (these are NOT in CRM Hot Leads):
- **Qualification:** `qualifies(status)` = lowercased status `startswith('interested')` OR
  `startswith('meeting')` — **prefix match, not equality** (so `"Meeting Schedule"` w/o the 'd'
  still qualifies).
- **hot_reason:** `'MeetingScheduled'` if status startswith `'meeting'`, else `'Interested'`.
- **Dedup:** per-campaign by lowercased email (`seen_emails`).
- **Meeting fill:** `meeting_1..5` from meetings sorted by date, label `"<date>: <outcome|title>"`, truncated 300 chars.
- **Graduation:** to `customers` only when a meeting has `sign_now` true (never on "Meeting Scheduled" alone); matched by normalized company name (`norm()` strips accents + legal forms `sp. z o.o.`/`gmbh`).
- **final_meeting / contract_status:** `"Signed <date>"` / `"Signed"` when signed.

### C. Concrete things the thin port MISSED (actionable)
1. **`lead_id` is never populated.** Live table has it; `compute()` output omits it. Add FK from `leads.id`.
2. **Meeting 1–5 schema drift.** `schema_additions.sql` and the sheet have them; live table (per migration context) does not. Reconcile DDL ↔ live ↔ `state.py` (which emits `meeting_1..5`). `db.upsert_hot_lead` inserts `meeting_1..5` — **will fail against the live table if those columns are absent.** ⚠️ likely runtime bug.
3. **No "new campaign auto-provision" path.** The Drive-folder-poll trigger has no Python equivalent; new campaigns must be inserted into `campaigns` by something upstream. Document/own this.
4. **Hardcoded fallback folder `16XDJ1VIUa-I6yVP_dWQ4yO0YtguwJkoY`** and watched folder `1Keop0NUWo3dX7LsaqTwhJcZlAFGP7wId` ("Evertrust Campaigns") — these IDs anchored the n8n Drive layout; ensure the campaign→tenant mapping they implied is preserved in `campaigns`.

---

## Known issues / landmines

- **`db.upsert_hot_lead` vs live schema:** inserts `meeting_1..meeting_5` columns that the live
  `hot_leads` table (per migration context) does **not** have → `UndefinedColumn` at runtime. **Top fix.**
- **Sheet existence heuristic is loose:** any file containing both `"hot"` and `"lead"` counts as the
  hot_leads sheet (e.g. `"hottest_leads_backup"`). Irrelevant once on Postgres, but note the original intent was fuzzy.
- **`exists` is a string** `"true"`/`"false"` matched by a string-equals IF — porting to a boolean is fine but don't carry the stringly-typed pattern.
- **No error handling beyond `continueRegularOutput`** on Drive search and the two respond nodes; failures elsewhere (Sheets create/move) are unguarded.
- **Workflow is `active:false`** — provisioning currently only runs on manual/webhook, not the every-minute Drive poll.
- **`detected_at`** semantics differ (written string vs DB `now()`); use DB default.

---

## Suggested Python architecture (for this provisioner's role)

Since the heavy lifting already lives in `crm/` (processor), the CRM-Hot-Leads *provisioning*
responsibility collapses to almost nothing in Postgres:

1. **Schema = one-time DDL.** Keep the 21-column intent in `schema_additions.sql`; **reconcile
   meeting_1..5 + add `lead_id`** so DDL == live == `state.py` output. (Single source of truth.)
2. **"Ensure store exists" = a migration**, not runtime code. Drop the create/move/header nodes
   entirely (already done — keep it that way).
3. **New-campaign detection** → replace the Drive-folder poll with: campaigns are rows; the
   processor (`pipeline.py`) already iterates `campaigns WHERE active`. If you need an
   auto-provision hook, add it as a campaign-insert path, not a folder watcher.
4. **Webhook `provision-hot-leads`** → if any external caller relies on it, expose a thin endpoint
   that (a) ensures the campaign row exists and (b) returns `{success, alreadyExists}` — but most
   likely this endpoint can be retired.
5. **Fix the two real bugs in `crm/`:** `lead_id` population and the meeting_1..5 schema drift in
   `db.upsert_hot_lead`.

Net: this workflow contributes essentially **zero runtime logic** to the Python port — only the
**canonical 21-column schema** and the reconciliation flags above.
