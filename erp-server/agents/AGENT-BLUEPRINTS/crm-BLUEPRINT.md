# EVERTRUST CRM — Python Port Blueprint

Two n8n workflows form the CRM. They share Google Drive/Sheets credentials and operate
over a Drive root folder **"Evertrust Campaigns"** (id `1Keop0NUWo3dX7LsaqTwhJcZlAFGP7wId`),
which contains one sub-folder per campaign. Each campaign folder holds a `config.json`,
a leads sheet, and (after provisioning) a `hot_leads` sheet.

- **CRM Hot Leads** (`s65rZ9hiuvVCbKu5`) — *provisioner*. Ensures a `hot_leads` spreadsheet
  exists in a given campaign folder; creates + headers it if missing, skips if present.
- **CRM Customer** (`Dddp6wSvw3rwEsOw`) — *brain*. Walks all campaigns, intakes
  Interested/Meeting leads into each campaign's `hot_leads`, fills Meeting 1–5 from the
  CM Meeting Log, and graduates a lead to the central **Customers** sheet only on a logged signing.

Shared global config (hardcoded IDs):
- Customers sheet (central CRM): `1Zr9qi-cNA3DYFu8v2AnyMc4A2s2LJ11haHo9novdv98` (gid=0 / Sheet1)
- CM Meeting Log sheet: `1IHtYVDvogVe0pth3hsHhpGHxcSknThRTX8C4vXEcO9A` (gid=0 / Sheet1)
- Default fallback folderId (Hot Leads): `16XDJ1VIUa-I6yVP_dWQ4yO0YtguwJkoY`
- Google credentials: Google Drive OAuth2 (`7ntqqDsIDCgae66w`), Google Sheets OAuth2 (`nVxTVzA6qeIhESvH`)

---

# WORKFLOW 1 — CRM Hot Leads (`s65rZ9hiuvVCbKu5`)

**Purpose:** idempotently provision a `hot_leads` Google Sheet inside one campaign folder.
It does NOT populate rows — only creates the sheet + writes the header row. Row population
is done by Workflow 2.

## 1.1 Triggers (3)
1. **Webhook** — `POST /provision-hot-leads`, `responseMode: responseNode`, CORS `allowedOrigins: *`.
   Expects body `{ folderId }`.
2. **Run Manually** — manual trigger (testing).
3. **On New Folder (Drive Poll)** — `googleDriveTrigger`, polls **every minute**,
   `triggerOn: specificFolder`, `folderToWatch` = Evertrust Campaigns root, `event: folderCreated`.
   Fires when a new campaign sub-folder is created → auto-provisions its hot_leads.

All three converge on **Resolve Folder ID**.

## 1.2 Flow (linear, one IF branch)
1. **Resolve Folder ID** (Set) — `folderId = $json.body?.folderId || $json.id || '16XDJ1VIUa-I6yVP_dWQ4yO0YtguwJkoY'`.
   (Webhook → `body.folderId`; Drive trigger → new folder `id`; manual → default.)
2. **List Folder Files** (Drive search) — `resource: fileFolder, operation: search, whatToSearch: files`
   in that folder. `alwaysOutputData: true`, `onError: continueRegularOutput`.
3. **Check hot_leads Exists** (Code) — `exists = files.some(name === 'hot_leads' OR (name includes 'hot' AND includes 'lead'))`
   (case-insensitive). Emits `{ folderId, exists: 'true'|'false' }`.
4. **hot_leads exists?** (IF) — `exists === "true"` (strict string).
   - **TRUE → Respond Exists** (respondToWebhook): `{ success:true, alreadyExists:true, folderId }`. **SKIP creation.**
   - **FALSE →** create path:
5. **Create hot_leads Sheet** (Sheets) — `resource: spreadsheet, operation: create, title: "hot_leads"`.
6. **Move hot_leads To Campaign Folder** (Drive move) — moves new spreadsheet into the campaign folder.
7. **Build hot_leads Header** (Code) — emits one object whose keys are the header columns (all values `''`).
8. **Write hot_leads Header** (Sheets append, autoMapInputData) — writes the header row into Sheet1.
9. **Respond OK** (respondToWebhook) — `{ success:true, hotLeadsSheetId, hotLeadsUrl }`.

## 1.3 Provisioning detail — create vs skip
- **Skip if exists:** a file in the folder named exactly `hot_leads` (case-insensitive) OR a name
  containing both `hot` and `lead`. → responds `alreadyExists:true`, no write.
- **Create if absent:** create blank spreadsheet titled `hot_leads`, move into folder, write header.
- Hot Leads does **not** intake any leads or read statuses — it only sets up the sheet structure.

## 1.4 EXACT hot_leads columns (header order, verbatim)
```
Company Name, Company Type, Email, Website, City, Country, Tier, Niche,
Source Campaign, Hot Reason, Meeting Date, Lead Status, Detected At, Note,
Meeting 1, Meeting 2, Meeting 3, Meeting 4, Meeting 5, Final Meeting, Contract Status
```
(21 columns. Note: WF2 writes rows that omit `Note`; appendOrUpdate with
`handlingExtraData: insertInNewColumn` tolerates the mismatch.)

## 1.5 State WRITTEN
- Creates spreadsheet `hot_leads` in the campaign folder; writes the 21-column header row only.

## 1.6 LLM / credentials / errors
- **No LLM.**
- Creds: Drive OAuth2 + Sheets OAuth2 (ids above).
- Error handling: List/Respond nodes use `continueRegularOutput`; otherwise default.

---

# WORKFLOW 2 — CRM Customer (the brain) (`Dddp6wSvw3rwEsOw`)

**Purpose:** the state machine. For every campaign: read its leads + hot_leads + config,
read central Customers + CM Meeting Log once, then (a) upsert qualifying leads into each
campaign's hot_leads with Meeting 1–5 filled, and (b) graduate signed leads into Customers.

## 2.1 Triggers (3)
1. **Schedule 8AM** — `scheduleTrigger`, cron `0 0 8 * * *` (daily 08:00).
2. **Run Manually** — manual trigger.
3. **Webhook** — `POST /crm-customer` (no responseNode; fire-and-forget).

All three → **Config** (Set: `rootFolderName = "Evertrust Campaigns"`).

## 2.2 Flow
**Phase A — enumerate campaigns**
1. **Config** → **Find Root Folder** (Drive search folders by name, limit 1) →
2. **List Campaign Folders** (Drive: all sub-folders of root) →
3. **Explode Campaigns** (Code) — `sd.campaigns = []` (resets global static array), emits one item per
   sub-folder `{ campaignFolderId, campaignName }` →
4. **Loop Campaigns** (splitInBatches). Two outputs:
   - **output 1 (done):** → Read Customers (Phase C)
   - **output 0 (loop body):** → List Files (Phase B)

**Phase B — per-campaign collection (loop body)**
5. **List Files** (Drive: files in `campaignFolderId`) →
6. **Resolve Files** (Code) — finds `config.json`, the leads file
   (`name includes 'lead' AND NOT 'hot' AND != config.json`), and hot_leads file
   (`name == 'hot_leads' OR (includes 'hot' AND 'lead')`) →
7. **Download config.json** (Drive download) →
8. **Parse config.json** (Code) — decodes binary (utf8/base64), JSON-parses; derives
   `project = cfg.project || cfg.niche || campaignName`, `niche = cfg.niche` →
9. **Read Leads** (Sheets read leadsFileId, gid=0) →
10. **Read Hot Leads** (Sheets read hotLeadsFileId; `executeOnce`) →
11. **Collect Campaign** (Code) — pushes into `sd.campaigns` global:
    `{ project, niche, hotLeadsFileId, leads:[…non-empty-email…], hot:[…] }` → back to **Loop Campaigns**.

**Phase C — compute (after loop completes)**
12. **Read Customers** (Sheets read central Customers sheet; `executeOnce`, alwaysOutputData) →
13. **Read Meeting Log** (Sheets read CM Meeting Log; `executeOnce`, alwaysOutputData,
    onError continue) →
14. **Compute Intake + Graduate** (Code) — the core; see 2.4 →
15. **Route hot / customer** (IF `_t === "hot"`):
    - **TRUE → Clean Hot Row** (drop `_t`, `hotLeadsFileId`) → **Append Hot Leads (per campaign)**
      (Sheets `appendOrUpdate`, documentId = per-row `hotLeadsFileId`, matchOn `Email`,
      `handlingExtraData: insertInNewColumn`).
    - **FALSE → Clean Cust Row** (drop `_t`) → **Append Customers (Evertrust CRM)**
      (Sheets `appendOrUpdate`, central Customers sheet, matchOn `Email`).

## 2.3 State READ — the key contract (verbatim)

**Lead statuses (from leads sheet `Status` column, written by Reply Glock / ContractMaker):**
the qualifying test in Compute Intake + Graduate is, on lowercased trimmed `Status`:
```js
const isInterested = sl.indexOf('interested') === 0;   // Status starts with "interested"
const isMeeting    = sl.indexOf('meeting')     === 0;   // Status starts with "meeting"
if (!isInterested && !isMeeting) continue;              // everything else skipped
```
- **Qualifies for intake:** any Status beginning with `interested` (→ stage `Interested`) OR
  beginning with `meeting` (→ stage `MeetingScheduled`). This matches real data values
  `"interested"`, `"Meeting Schedule"`, `"Meeting Scheduled"`.
- **Skipped:** `Cold Outreached`, empty, and anything not starting with those prefixes.
- Match is `indexOf(...) === 0` (prefix, not equality) and case-insensitive.

**CM Meeting Log (`Read Meeting Log`) — consumed fields per row:**
`companyKey` (or fallback `companyName`), `meetingDate`, `meetingOutcome` (or `title`),
`signNow`, `cooperationTerm`. Rows grouped by `companyKey` (else normalized `companyName`),
sorted ascending by `meetingDate`.

**Company normalization** (for matching leads ↔ meeting log), verbatim:
```js
function norm(s){ var x=(''+s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'');
  x=x.split('sp. z o.o.').join(' ').split('sp.z o.o.').join(' ').split('sp z o o').join(' ')
     .split('gmbh').join(' '); return x.replace(/[^a-z0-9]/g,''); }
```

**Customers sheet (`Read Customers`)** — read only to build a dedup set of existing customer
emails (`Email`/`email`, lowercased) so a lead is not graduated twice.

## 2.4 The state machine — Meeting fill, signing detection, graduation

For each campaign, for each qualifying lead (deduped by lowercased email within the campaign):

**Fill Meeting 1–5:** `meetings = byKey.get(norm(companyName)) || []` (sorted by date);
```js
for (i=0;i<5;i++) m['Meeting '+(i+1)] = meetings[i]
  ? (meetings[i].meetingDate + ': ' + (meetings[i].meetingOutcome||meetings[i].title)).slice(0,300)
  : '';
```

**Signing detection (verbatim):**
```js
var signed = null;
for (const mm of meetings){
  var snv = ((mm.signNow||'')+'').trim().toUpperCase();
  if (snv === 'YES' || snv === 'TRUE'){ signed = mm; break; }
}
```
So a signing = the first meeting-log row for that company whose `signNow` is `YES` or `TRUE`
(case-insensitive). `Cooperation Term` is read from that same signed row's `cooperationTerm`.

**Hot row emitted for every qualifying lead** (`_t:'hot'`), with:
- `Hot Reason` = `MeetingScheduled` if Status starts "meeting", else `Interested`.
- `Lead Status` = raw Status string; `Source Campaign` = campaign `project`; `Niche` from config.
- `Final Meeting` = `'Signed ' + signed.meetingDate` if signed else `''`.
- `Contract Status` = `'Signed'` if signed else `''`.

**Graduation rule (verbatim condition):**
```js
if (signed && !custEmails.has(key) && !gradSeen.has(key)) { /* emit _t:'cust' */ }
```
- **Graduates ONLY when a signing exists** (`signed` truthy), the email is not already in
  Customers, and not already graduated this run.
- **NOT on Meeting Scheduled.** A lead with Status "Meeting Scheduled" but no `signNow=YES/TRUE`
  meeting-log row produces a hot row only — never a customer row.
- Customer row carries `Stage:'Customer'`, `Hot Reason:'Signed'`, `Contract Status:'Signed'`,
  and `Cooperation Term` = the signed row's `cooperationTerm` (trimmed).

## 2.5 State WRITTEN
- **hot_leads** (per campaign, matchOn `Email`, upsert): the 21-column row incl. Meeting 1–5,
  Final Meeting, Contract Status. (Customer-row writer adds `Stage`, `Owner`, `Created At`,
  `Updated At`, `Notes`, `Cooperation Term` columns to the central sheet via insertInNewColumn.)
- **Customers** central sheet (matchOn `Email`, upsert): Company Name, Company Type, Email, Website,
  City, Country, Tier, Niche, Source Campaign, Stage(`Customer`), Hot Reason(`Signed`), Meeting Date,
  Owner, Created At, Updated At, Notes, Cooperation Term, Contract Status(`Signed`).
- Global staticData `sd.campaigns` is the cross-loop accumulator (ignore for port — replace with a list).

## 2.6 LLM / credentials / errors
- **No LLM in either workflow.** Pure data/Sheets logic.
- Creds: Drive OAuth2 (`7ntqqDsIDCgae66w`) + Sheets OAuth2 (`nVxTVzA6qeIhESvH`).
- Error handling: Read Meeting Log / Read Leads / Read Hot Leads use `onError: continueRegularOutput`
  + `alwaysOutputData` so a missing/empty sheet doesn't abort the run.

---

# n8n artifacts NOT worth porting
- `splitInBatches` + `$getWorkflowStaticData('global')` accumulator pattern — in Python just
  iterate campaigns and build a list.
- `__rl` resource-locator wrappers, `cachedResultName`, node positions, webhookIds, versionIds.
- respondToWebhook nodes / CORS headers — provisioning can be a plain function return.
- The Drive `folderCreated` poll trigger → replace with a scheduled scan or event hook.
- binary base64/utf8 juggling in Parse config.json → `json.loads(file_bytes)`.
- Manual triggers (test-only).

# Surprising / fragile bits to preserve carefully
- Intake test is **prefix match** (`indexOf===0`), not equality — `"Meeting Schedule"` (no "d")
  qualifies. Don't tighten to exact strings.
- Lead↔meeting matching is by **normalized company name**, not email (norm strips
  `sp. z o.o.`, `gmbh`, diacritics, non-alphanumerics). Email is only used for dedup/graduation.
- Signing key is `signNow ∈ {YES, TRUE}` (upper-cased) — case-insensitive, but only those two tokens.
- hot_leads header includes `Note`, but WF2 hot rows omit it (relies on insertInNewColumn upsert).
- `Hot Reason` value `MeetingScheduled` (one word) differs from the `Lead Status` string `Meeting Scheduled`.
