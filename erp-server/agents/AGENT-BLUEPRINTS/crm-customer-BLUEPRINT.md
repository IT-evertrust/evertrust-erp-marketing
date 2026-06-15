# Blueprint — EVERTRUST - CRM Customer (n8n `Dddp6wSvw3rwEsOw`)

> Faithful distillation of the live 23-node n8n workflow for re-implementation as local Python,
> as part of the EVERTRUST marketing-agent-workflows migration off n8n (Google Drive/Sheets → Postgres/Supabase).
> Instance: `evertrustgmbh.app.n8n.cloud`. Project: REACH ARSENAL. Active: **false** (manual/scheduled, not yet live).
> AI-builder assisted (`builderVariant: mcp`). `executionOrder: v1`.

Workflow self-description (verbatim):
> "CRM brain: intake Interested+Meeting to hot_leads; fills Meeting 1-5 from CM Meeting Log; graduates to
> customers only on a logged signing (+Cooperation Term). Not on Meeting Scheduled."

---

## 1. Purpose (end-to-end)

This is a **scheduled, multi-campaign CRM rollup**, NOT just a graduation step. Per run it:

1. **Discovers campaigns dynamically** by walking a Google Drive folder tree (`Evertrust Campaigns` →
   one subfolder per campaign), rather than reading a campaigns table. Each campaign folder is expected to
   contain a `config.json`, a `Leads` sheet, and a `hot_leads` sheet.
2. **Loops each campaign** (SplitInBatches): reads `config.json` (→ project + niche), reads that campaign's
   Leads sheet and its existing Hot Leads sheet, and accumulates everything into workflow staticData.
3. After all campaigns are collected, **reads two GLOBAL sheets once**: the central **Customers** sheet
   (dedup source) and the **CM Meeting Log** (ContractMaker's meeting/signing log).
4. **Computes intake + graduation** in one Code node:
   - **Intake**: any lead whose Status starts with `interested` or `meeting` becomes a **hot lead** row
     (one per campaign, deduped by email within the campaign), enriched with Meeting 1–5 columns pulled
     from the Meeting Log (matched by normalized company name).
   - **Graduation**: a hot lead becomes a **customer** ONLY if its company has a Meeting Log row with
     `signNow` = YES/TRUE, AND its email is not already a customer (global dedup), AND it hasn't been
     graduated earlier in this same run. Captures the **Cooperation Term** from the signing meeting.
5. **Routes** each emitted row by a `_t` tag: `hot` rows → that campaign's Hot Leads sheet; `cust` rows
   → the central Customers sheet. Both via Google Sheets `appendOrUpdate` keyed on Email.

What it does **NOT** do (confirmed by node-by-node read): no welcome/onboarding email, no renewal logic,
no ERP/app sync, no reporting, no stage-machine beyond `Interested`/`MeetingScheduled`/`Customer`,
no Postgres, no Drive writes (only reads from Drive). No LLM nodes at all.

---

## 2. Trigger & Inputs

Three triggers, all converging on the **Config** node:

| Trigger | Type | Detail |
|---|---|---|
| **Schedule 8AM** | `scheduleTrigger` v1.3 | cron `0 0 8 * * *` (daily 08:00) — the production trigger |
| **Run Manually** | `manualTrigger` v1 | for manual runs |
| **Webhook** | `webhook` v2.1 | `POST /crm-customer` (webhookId `d3fb81aa-...`); body is **ignored** — it only kicks off the same Drive-walk pipeline |

**Input shape:** none meaningful. The webhook payload is not read anywhere. All data comes from Drive +
Sheets discovered at runtime. This is effectively a self-contained scheduled batch job. It is **not** called
by / does not call the Hot Leads workflow — they are siblings that both read the same sheets.

`Config` node sets `rootFolderName = "Evertrust Campaigns"` (the Drive root to walk).

---

## 3. Node-by-node flow (execution order)

```
[Schedule 8AM | Run Manually | Webhook]
        └─> Config (set rootFolderName="Evertrust Campaigns")
        └─> Find Root Folder (Drive: search folder by name, limit 1)
        └─> List Campaign Folders (Drive: list subfolders of root, returnAll)
        └─> Explode Campaigns (Code: reset staticData.campaigns=[]; map folders -> {campaignFolderId, campaignName})
        └─> Loop Campaigns (SplitInBatches v3)         <-- LOOP HEAD, two outputs
              ├─ output 0 (done/after loop): Read Customers -> Read Meeting Log -> Compute Intake + Graduate -> Route hot/customer
              └─ output 1 (each batch/item): List Files -> Resolve Files -> Download config.json -> Parse config.json
                                              -> Read Leads -> Read Hot Leads -> Collect Campaign -> (back to Loop Campaigns)
        Route hot / customer (IF _t == "hot")
              ├─ TRUE  -> Clean Hot Row  -> Append Hot Leads (per campaign)   [Sheets appendOrUpdate, match Email]
              └─ FALSE -> Clean Cust Row -> Append Customers (Evertrust CRM)  [Sheets appendOrUpdate, match Email]
```

> NOTE on SplitInBatches v3 wiring: output **0** is the "loop finished" branch (runs Read Customers… once after
> the loop drains), output **1** is the per-batch branch (List Files…). This is the n8n v3 convention; the
> connection array order in the JSON is `[Read Customers, List Files]`.

Node details:

1. **Config** (`set` v3.4) — assigns `rootFolderName = "Evertrust Campaigns"`.
2. **Find Root Folder** (`googleDrive` v3, resource `fileFolder`) — search folders by `queryString = {{ $json.rootFolderName }}`, limit 1. Returns the root folder id.
3. **List Campaign Folders** (`googleDrive` v3) — list subfolders where parent `folderId = {{ $json.id }}`, `returnAll: true`, `whatToSearch: folders`. One item per campaign folder.
4. **Explode Campaigns** (`code` v2) — resets `staticData.global.campaigns = []`; maps each folder → `{campaignFolderId: id, campaignName: name}`.
5. **Loop Campaigns** (`splitInBatches` v3) — iterates campaign items.
6. **List Files** (`googleDrive` v3) — list files in `folderId = {{ $json.campaignFolderId }}`, `returnAll: true` (no folder filter; lists all files).
7. **Resolve Files** (`code` v2) — picks `config.json`, the Leads file, and the hot_leads file by filename heuristics (see §4.2).
8. **Download config.json** (`googleDrive` v3) — `operation: download`, `fileId = {{ $json.configFileId }}`.
9. **Parse config.json** (`code` v2, runOnceForEachItem) — base64/utf8-decodes the binary, `JSON.parse`, derives `project` and `niche` (see §4.3).
10. **Read Leads** (`googleSheets` v4.7) — read `documentId = {{ $json.leadsFileId }}`, tab `gid=0` (Sheet1). `alwaysOutputData`, `onError: continueRegularOutput`.
11. **Read Hot Leads** (`googleSheets` v4.7) — read `documentId = {{ $('Parse config.json').item.json.hotLeadsFileId }}`, tab `gid=0`. `executeOnce`, `alwaysOutputData`, `onError: continueRegularOutput`.
12. **Collect Campaign** (`code` v2) — pushes `{project, niche, hotLeadsFileId, leads[], hot[]}` into `staticData.global.campaigns` (filters leads/hot to rows with a non-empty Email). Returns a summary item; flow returns to Loop Campaigns.
13. **Read Customers** (`googleSheets` v4.7) — GLOBAL central CRM sheet `documentId = 1Zr9qi-cNA3DYFu8v2AnyMc4A2s2LJ11haHo9novdv98`, tab `gid=0`. `executeOnce`, `alwaysOutputData`. (No onError handler.)
14. **Read Meeting Log** (`googleSheets` v4.7) — GLOBAL CM Meeting Log `documentId = 1IHtYVDvogVe0pth3hsHhpGHxcSknThRTX8C4vXEcO9A`, tab `gid=0`. `executeOnce`, `alwaysOutputData`, `onError: continueRegularOutput`.
15. **Compute Intake + Graduate** (`code` v2) — the brain (see §4.1). Emits tagged `hot`/`cust` items.
16. **Route hot / customer** (`if` v2.2) — TRUE if `{{ $json._t }} == "hot"`.
17. **Clean Hot Row** (`code` v2, runOnceForEachItem) — strips `_t` and `hotLeadsFileId` from the item.
18. **Append Hot Leads (per campaign)** (`googleSheets` v4.7) — `appendOrUpdate`, `documentId = {{ $('Compute Intake + Graduate').item.json.hotLeadsFileId }}`, tab `gid=0`, `matchingColumns: [Email]`, `mappingMode: autoMapInputData`, `handlingExtraData: insertInNewColumn`.
19. **Clean Cust Row** (`code` v2, runOnceForEachItem) — strips `_t` only.
20. **Append Customers (Evertrust CRM)** (`googleSheets` v4.7) — `appendOrUpdate`, `documentId = 1Zr9qi-...` (same as Read Customers), tab `gid=0`, `matchingColumns: [Email]`, `autoMapInputData`, `insertInNewColumn`.

---

## 4. Code-node algorithms (verbatim logic)

### 4.1 Compute Intake + Graduate (THE BRAIN)

Full source (verbatim):

```js
const sd = $getWorkflowStaticData('global');
const camps = sd.campaigns || [];
const custItems = $('Read Customers').all().map(function(i){ return i.json; });
const custEmails = new Set();
for (const c of custItems) { const e = ((c.Email || c.email || '') + '').trim().toLowerCase(); if (e) custEmails.add(e); }
function norm(s){ var x=(''+s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,''); x=x.split('sp. z o.o.').join(' ').split('sp.z o.o.').join(' ').split('sp z o o').join(' ').split('gmbh').join(' '); return x.replace(/[^a-z0-9]/g,''); }
const logItems = $('Read Meeting Log').all().map(function(i){ return i.json; });
const byKey = new Map();
for (const r of logItems) { var k=((r.companyKey||'')+'').trim(); if(!k) k=norm(r.companyName||''); if(!k) continue; if(!byKey.has(k)) byKey.set(k, []); byKey.get(k).push(r); }
for (const arr of byKey.values()) { arr.sort(function(a,b){ return (((a.meetingDate||'')+'')).localeCompare(((b.meetingDate||'')+'')); }); }
const nowIso = new Date().toISOString();
const out = [];
const gradSeen = new Set();
for (const camp of camps) {
  const seen = new Set();
  for (const L of camp.leads) {
    const email = ((L.Email || L.email || '') + '').trim();
    if (!email) continue;
    const key = email.toLowerCase();
    if (seen.has(key)) continue;
    const status = ((L.Status || '') + '').trim();
    const sl = status.toLowerCase();
    const isInterested = sl.indexOf('interested') === 0;
    const isMeeting = sl.indexOf('meeting') === 0;
    if (!isInterested && !isMeeting) continue;
    seen.add(key);
    const companyName = L['Company Name'] || L.companyName || '';
    const ck = norm(companyName);
    const meetings = byKey.get(ck) || [];
    const m = {};
    for (var i=0;i<5;i++){ var mt=meetings[i]; m['Meeting '+(i+1)] = mt ? (((mt.meetingDate||'')+': '+((mt.meetingOutcome||mt.title||'')+'')).slice(0,300)) : ''; }
    var signed=null;
    for (const mm of meetings){ var snv=((mm.signNow||'')+'').trim().toUpperCase(); if(snv==='YES'||snv==='TRUE'){ signed=mm; break; } }
    const stage = isMeeting ? 'MeetingScheduled' : 'Interested';
    out.push({ json: { _t:'hot', hotLeadsFileId: camp.hotLeadsFileId,
      'Company Name': companyName, 'Company Type': L['Company Type']||L.companyType||'', 'Email': email,
      'Website': L.Website||L.website||'', 'City': L.City||L.city||'', 'Country': L.Country||L.country||'', 'Tier': L.Tier||L.tier||'',
      'Niche': camp.niche||L.Niche||L.niche||'', 'Source Campaign': camp.project, 'Hot Reason': stage, 'Meeting Date': L['Meeting Date']||'',
      'Lead Status': status, 'Detected At': nowIso,
      'Meeting 1': m['Meeting 1'], 'Meeting 2': m['Meeting 2'], 'Meeting 3': m['Meeting 3'], 'Meeting 4': m['Meeting 4'], 'Meeting 5': m['Meeting 5'],
      'Final Meeting': signed ? ('Signed '+((signed.meetingDate||'')+'')) : '', 'Contract Status': signed ? 'Signed' : '' } });
    if (signed && !custEmails.has(key) && !gradSeen.has(key)) {
      gradSeen.add(key);
      out.push({ json: { _t:'cust',
        'Company Name': companyName, 'Company Type': L['Company Type']||L.companyType||'', 'Email': email,
        'Website': L.Website||L.website||'', 'City': L.City||L.city||'', 'Country': L.Country||L.country||'', 'Tier': L.Tier||L.tier||'',
        'Niche': camp.niche||L.Niche||L.niche||'', 'Source Campaign': camp.project, 'Stage':'Customer', 'Hot Reason':'Signed',
        'Meeting Date': L['Meeting Date']||'', 'Owner':'', 'Created At': nowIso, 'Updated At': nowIso, 'Notes':'',
        'Cooperation Term': ((signed.cooperationTerm||'')+'').trim(), 'Contract Status':'Signed' } });
    }
  }
}
console.log('[CRM brain] campaigns='+camps.length+' rows='+out.length);
return out;
```

Key algorithm points (load-bearing):
- **norm()** company-name normalization: lowercase → NFD-strip diacritics (`/[̀-ͯ]/g`) → remove
  legal forms `sp. z o.o.`, `sp.z o.o.`, `sp z o o`, `gmbh` → strip to `[a-z0-9]` only.
- **Qualifies if** Status (lowercased, trimmed) `indexOf('interested') === 0` **OR** `indexOf('meeting') === 0`
  — i.e. **prefix match, not equality**. Note: `"Meeting Schedule"` (no "d") qualifies; `"Cold Outreached"`
  does NOT (its `interested` substring isn't at index 0). Empty Status does not qualify.
- **Per-campaign email dedup** via `seen` set; **global graduation dedup** via `gradSeen` set + `custEmails`.
- **Meeting 1–5** = first five meetings for the company (sorted ascending by `meetingDate` string via
  `localeCompare`), each formatted `"<meetingDate>: <meetingOutcome||title>"` truncated to 300 chars.
- **Signing detection**: first meeting whose `signNow` (uppercased, trimmed) is `"YES"` or `"TRUE"`.
- **Hot Reason** = `MeetingScheduled` if status starts with `meeting`, else `Interested`. (For customers,
  Hot Reason is hardcoded `Signed`.)
- **Graduation gate**: `signed && !custEmails.has(key) && !gradSeen.has(key)`. Pure signing-driven; a meeting
  being merely scheduled does NOT graduate.
- **Meeting Log field names** are camelCase: `companyKey`, `companyName`, `meetingDate`, `meetingOutcome`,
  `title`, `signNow`, `cooperationTerm`. Leads/Customers sheet fields are Title Case ("Company Name", "Email"…).

### 4.2 Resolve Files

```js
const campaign = $('Loop Campaigns').first().json;
const files = $input.all().map(i => i.json).filter(f => f && f.name);
const cfg = files.find(f => (f.name || '').toLowerCase() === 'config.json') || files.find(f => (f.name || '').toLowerCase().includes('config'));
const leadsF = files.find(f => { const n = (f.name || '').toLowerCase(); return n.includes('lead') && !n.includes('hot') && n !== 'config.json'; });
const hotF = files.find(f => { const n = (f.name || '').toLowerCase(); return n === 'hot_leads' || (n.includes('hot') && n.includes('lead')); });
return [{ json: { campaignFolderId, campaignName, configFileId, leadsFileId, hotLeadsFileId } }];
```
Filename heuristics: config = exactly `config.json` (or any name containing "config"); leads = name contains
"lead" AND not "hot" AND not config.json; hot = name `hot_leads` or contains both "hot" and "lead".

### 4.3 Parse config.json

```js
const campaign = $('Resolve Files').item.json;
const bin = $input.item.binary && $input.item.binary.data;
let cfg = {};
if (bin) {
  let text = '';
  try { const buf = await this.helpers.getBinaryDataBuffer(0, 'data'); text = buf.toString('utf8'); } catch (e) {}
  if (!text && typeof bin.data === 'string') { text = bin.data; }
  if (text && !text.trim().startsWith('{')) { try { text = Buffer.from(text, 'base64').toString('utf8'); } catch (e) {} }
  if (text && text.trim().startsWith('{')) { try { cfg = JSON.parse(text); } catch (e) {} }
}
const project = cfg.project || cfg.niche || campaign.campaignName || '';
const niche = cfg.niche || '';
return { json: { ...campaign, project, niche } };
```
`project` falls back chain: `config.project` → `config.niche` → folder name. `niche` = `config.niche` only.

### 4.4 Explode Campaigns / Collect Campaign / Clean Hot/Cust Row
- **Explode Campaigns**: `sd.campaigns = []` then maps Drive folders → `{campaignFolderId, campaignName}`.
- **Collect Campaign**: appends `{project, niche, hotLeadsFileId, leads, hot}` to `sd.campaigns`; leads/hot
  filtered to non-empty Email.
- **Clean Hot Row**: `delete j._t; delete j.hotLeadsFileId`.
- **Clean Cust Row**: `delete j._t`.

---

## 5. Data read & write

### 5.1 Reads
| Source | Type | ID / location | Tab | Notes | Migration |
|---|---|---|---|---|---|
| Drive root `Evertrust Campaigns` | Drive folder search | by name | — | campaign discovery | → drop; use `campaigns` table |
| Campaign subfolders | Drive folder list | child of root | — | one per campaign | → `campaigns` rows |
| `config.json` per campaign | Drive file download | resolved per folder | — | gives project + niche | → `campaigns.project` / `.niche` |
| Leads sheet per campaign | Google Sheets | `{{leadsFileId}}` (per folder) | gid=0 / Sheet1 | lead rows | → `leads` table (filter `campaign_id`) |
| Hot Leads sheet per campaign | Google Sheets | `{{hotLeadsFileId}}` (per folder) | gid=0 / Sheet1 | existing hot rows (read but barely used) | → `hot_leads` table |
| **Customers (central CRM)** | Google Sheets | `1Zr9qi-cNA3DYFu8v2AnyMc4A2s2LJ11haHo9novdv98` | gid=0 / Sheet1 | dedup source (existing customer emails) | **→ `customers` table** |
| **CM Meeting Log** | Google Sheets | `1IHtYVDvogVe0pth3hsHhpGHxcSknThRTX8C4vXEcO9A` | gid=0 / Sheet1 | meetings + signings | **→ `meetings` table** |

### 5.2 Writes
| Target | Op | ID | Match key | Migration |
|---|---|---|---|---|
| Hot Leads sheet (per campaign) | appendOrUpdate | `{{hotLeadsFileId}}` | Email | → upsert `hot_leads` on `(campaign_id, email)` |
| **Customers sheet (central)** | appendOrUpdate | `1Zr9qi-...` | Email | **→ upsert `customers` on email** |

### 5.3 Customers output — FULL column set (exact, from the cust row in §4.1)

The Customers sheet row written has these columns (in emit order):
`Company Name`, `Company Type`, `Email`, `Website`, `City`, `Country`, `Tier`, `Niche`, `Source Campaign`,
`Stage` (="Customer"), `Hot Reason` (="Signed"), `Meeting Date`, `Owner` (=""), `Created At`, `Updated At`,
`Notes` (=""), `Cooperation Term`, `Contract Status` (="Signed").  → **18 columns.**

Mapping Customers sheet → live `customers` table:

| Customers sheet column | `customers` table column | Notes |
|---|---|---|
| Company Name | company_name | ✅ |
| Company Type | company_type | ✅ |
| Email | email | ✅ (upsert key) |
| Website | website | ✅ |
| City | city | ✅ |
| Country | country | ✅ |
| Tier | tier | ✅ |
| Niche | niche | ✅ |
| Source Campaign | source_campaign | ✅ |
| Stage ("Customer") | stage | ✅ (table default 'Customer') |
| Hot Reason ("Signed") | hot_reason | ✅ (table default 'Signed') |
| Meeting Date | meeting_date | ✅ — but see mismatch ⚠️ below |
| Owner ("") | owner | ✅ |
| Created At | created_at | table has its own `now()` default — sheet sends ISO string |
| Updated At | updated_at | table has its own `now()` default + ON CONFLICT bump |
| Notes ("") | notes | ✅ |
| Cooperation Term | cooperation_term | ✅ |
| Contract Status ("Signed") | contract_status | ✅ (table default 'Signed') |

**Mismatch ⚠️:** the n8n cust row sets `Meeting Date` from `L['Meeting Date']` (the LEAD's Meeting Date column,
usually blank in the data), **not** from the signing meeting's `meetingDate`. The hot row's `Final Meeting`
carries `"Signed <signed.meetingDate>"`, but the customer row's `Meeting Date` is the lead-sheet value.
So in the n8n flow, a graduated customer's `meeting_date` is typically empty. The existing Python port
(see §7) instead sets `meeting_date = signed.meeting_date` — a **divergence** (arguably a bug-fix).

Live `customers` columns NOT produced by n8n: `id` (serial), nothing else missing — n8n produces a superset
that maps cleanly. All 18 live columns are covered.

Hot Leads sheet → `hot_leads` table: 21 cols — `Company Name, Company Type, Email, Website, City, Country,
Tier, Niche, Source Campaign, Hot Reason, Meeting Date, Lead Status, Detected At, Note(="" — n8n key is "Note",
table col is "note"), Meeting 1..5, Final Meeting, Contract Status` + `campaign_id`. (n8n's hot row uses key
`'Note'`; the existing Python schema/port use `note`.)

---

## 6. Routing & Credentials

**Routing** — single IF node `Route hot / customer`:
- Condition: `{{ $json._t }}` **equals** `"hot"` (string, case-sensitive, strict typeValidation, v2).
- TRUE (output 0) → Clean Hot Row → Append Hot Leads.
- FALSE (output 1) → Clean Cust Row → Append Customers.

**SplitInBatches `Loop Campaigns`** also routes: output 0 = after-loop (global reads + compute), output 1 =
per-item (file resolution + sheet reads + Collect Campaign back-edge).

**Credentials referenced:**
| Name | Type | Used by |
|---|---|---|
| Google Drive OAuth2 API | `googleDriveOAuth2Api` (id `7ntqqDsIDCgae66w`) | Find Root Folder, List Campaign Folders, List Files, Download config.json |
| Google Sheets OAuth2 API | `googleSheetsOAuth2Api` (id `nVxTVzA6qeIhESvH`) | Read Customers, Read Meeting Log, Read Leads, Read Hot Leads, Append Hot Leads, Append Customers |

---

## 7. Gap analysis — existing `crm/` package vs the real CRM Customer workflow

The existing `/Users/kobewannkenobi/marketing-agent-workflows/crm/` package **merged** CRM Hot Leads
(`s65rZ9hiuvVCbKu5`) + CRM Customer (`Dddp6wSvw3rwEsOw`) into one thin `compute()` (state.py) reading from
Postgres tables (`campaigns`, `leads`, `meetings`, `customers`). It is a clean, mostly faithful port of the
**intake + graduation brain (§4.1)**. Comparison:

**What `crm/` already covers correctly (matches §4.1):**
- ✅ `norm()` — identical algorithm (NFD strip + legal forms `sp. z o.o.`/`sp.z o.o.`/`sp z o o`/`gmbh` + `[a-z0-9]`).
- ✅ `qualifies()` — prefix match `startswith("interested") or startswith("meeting")` (matches `indexOf===0`).
- ✅ Per-lead email dedup (`seen_emails`) and global graduation dedup (`graduated` + `existing_customer_emails`).
- ✅ Meeting 1–5 fill, sorted by date, `"<date>: <outcome||title>"`, 300-char truncate.
- ✅ Signing detection (`sign_now` true / "YES" / "TRUE"); graduate only on a signing.
- ✅ Cooperation Term captured from the signing meeting.
- ✅ Hot Reason `MeetingScheduled`/`Interested`; customer Hot Reason `Signed`; Contract Status `Signed`.
- ✅ hot_leads + customers upsert on email (db.py).

**What the thin port MISSED / changed (CRM Customer behavior NOT reproduced):**
1. **Multi-campaign discovery via Drive folder tree** — n8n walks `Evertrust Campaigns` → subfolders →
   per-campaign `config.json` + Leads sheet + Hot Leads sheet. The port replaces this entirely with a
   `campaigns` table (`fetch_campaigns` WHERE active). **The config.json parsing (project/niche fallback
   chain) and the file-name heuristics (Resolve Files §4.2) are gone** — fine if `campaigns` rows already
   carry `project`/`niche`, but the migration must guarantee that.
2. **`meeting_date` source divergence (⚠️ §5.3):** n8n customer rows set `Meeting Date` = the LEAD'S
   `Meeting Date` (usually blank). The port sets `meeting_date = signed.meeting_date`. The port's behavior is
   more useful, but it is **not byte-faithful** to n8n. Flag this as an intentional improvement, not a bug,
   in migration notes. (n8n hot rows ALSO set `Meeting Date` from the lead, not the signing — same divergence
   would apply if you wanted exact parity.)
3. **`Niche` precedence:** n8n uses `camp.niche || L.Niche || L.niche` (campaign niche first, then lead niche).
   The port uses `campaign.get("niche")` only — drops the per-lead niche fallback. Minor; only matters if a
   campaign has no niche but leads do.
4. **`Source Campaign` value:** n8n uses `camp.project` (from config.json's `project`, falling back to
   niche/folder name). The port uses `campaign.get("project")`. Equivalent IF the `campaigns` table's `project`
   is populated the same way config.json's `project` was. **Verify the campaigns table `project` matches the
   old config.json `project` values** (e.g. `PLCybersec202676`).
5. **`note` vs `Note` key** and **`Detected At`/`Created At`/`Updated At` timestamps:** n8n emits ISO strings;
   the port relies on DB `now()` defaults. Behaviorally fine, but `detected_at`/`created_at` will differ from
   the lead-detection moment if rows are reprocessed — acceptable.
6. **Reading the per-campaign Hot Leads sheet (`Read Hot Leads` / `camp.hot`)** is **dead-ish in both:** n8n
   collects `hot` into staticData but the brain never reads `camp.hot`. The port drops it. No behavior lost.
7. **The three triggers (schedule/manual/webhook)** are orchestration, not logic — the port is a CLI
   (`pipeline.run`, dry-run default, `--live`). The 08:00 cron must be reproduced by the new scheduler
   (cron/systemd/Supabase cron), and the webhook endpoint (`POST /crm-customer`) is **not reproduced** —
   confirm nothing external calls it (it ignored its body anyway).

**Net:** the port faithfully reproduces the *brain*. It MISSED the *Drive-based campaign/config discovery layer*
(now a `campaigns` table — acceptable if populated correctly) and made two small **intentional divergences**
(`meeting_date` from signing, niche precedence) that should be documented as improvements over n8n.

---

## 8. Known issues / landmines

- **`meeting_date` is effectively blank for n8n customers** (pulls lead's Meeting Date, which is empty in the
  data). Anyone comparing n8n output to the Python output will see `meeting_date` differ — by design.
- **Status prefix matching is loose:** `"Meeting Schedule"` (typo, no "d") qualifies; any future status like
  `"Interested - later"` qualifies; `"Meeting cancelled"` would ALSO qualify (starts with "meeting"). Preserve
  this prefix behavior in Python (the port already does).
- **Meeting Log field names are camelCase** (`signNow`, `cooperationTerm`, `meetingDate`, `companyKey`).
  In Postgres they are snake_case (`sign_now`, `cooperation_term`, `meeting_date`, `company_key`) — the port's
  `db.meetings_by_company_key` already handles this. Don't re-introduce camelCase lookups.
- **`signNow` semantics:** sheet stored strings "YES"/"TRUE"; the live `meetings.sign_now` is a boolean. The
  port's `find_signing` handles both `is True` and string "YES"/"TRUE" — keep that.
- **staticData reset bug-shape:** `Explode Campaigns` resets `sd.campaigns=[]` but the LIVE staticData blob
  still contains a stale `campaigns` array (the PLCybersec202676 run). Irrelevant to Python (no staticData),
  but explains the data dump in the workflow JSON. Ignore it.
- **Workflow is inactive** (`active:false`) and was AI-builder generated. Treat it as a blueprint, per project
  policy ("n8n is blueprint only").
- **No idempotent meeting_date / no renewal / no onboarding** — if the business wants welcome emails or renewal
  tracking later, neither n8n nor the port has it; it's net-new.

---

## 9. Suggested Python architecture (migration)

The existing `crm/` package is the right shape. To fully cover CRM Customer:

1. **Keep `crm/domain/state.py` `compute()` as-is** — it is the faithful brain. Optionally add a flag to
   choose `meeting_date` source (lead vs signing) if exact n8n parity is ever needed.
2. **Campaign source = Postgres `campaigns` table** (replaces Drive walk + config.json). Migration task: ensure
   every campaign that had a Drive folder + config.json has a `campaigns` row with `project` (e.g.
   `PLCybersec202676`), `niche`, and `active=true`. Backfill `project`/`niche` from old config.json files.
3. **Reads:** `leads` (by campaign_id), `meetings` (all, grouped by company_key), `customers` (dedup) — already
   in `db.py`. Map CM Meeting Log → `meetings` and Customers sheet → `customers` (done in live schema).
4. **Writes:** upsert `hot_leads` on `(campaign_id, email)`, upsert `customers` on `email` — already in `db.py`.
   Confirm `customers` table has all 18 mapped columns (it does: id + the 17 non-id + serial).
5. **Scheduling:** reproduce the 08:00 daily cron via system cron / scheduled job calling `pipeline.run(live=True)`.
   Drop the webhook unless an external caller is confirmed.
6. **Drive/Sheets dependencies removed:** Find Root Folder, List Campaign Folders, List Files,
   Download/Parse config.json, all Read/Append Sheets nodes → Postgres queries. Flagged per row in §5.
7. **Document the two intentional divergences** (meeting_date, niche precedence) in the crm/ README so future
   maintainers don't "fix" them back to n8n behavior.

---

*Source: live n8n workflow `Dddp6wSvw3rwEsOw` (v50, updated 2026-06-05), fetched in full. No LLM/prompt nodes
exist in this workflow. staticData blob inspected for field names only, otherwise ignored per instructions.*
