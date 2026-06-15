# SLEEPER GRENADE — Port Blueprint

**Workflow:** `EVERTRUST - SLEEPER GRENADE` (id `4GgPmoulQDgDWtej`)
**Project:** REACH ARSENAL (team `MEQnSx1UZNkAJoiN`)
**Status:** inactive (`active: false`), AI-builder assisted, 23 nodes, `executionOrder: v1`.
**Self-description:** *"Not-Interested Sweep (clean). Mirrors Glock discovery; dual-vocab routing; provisions a per-campaign snooze sheet once before processing; copies snoozes then deletes Do-Not-Contacts. Copy-before-delete; always live."*

> ⚠️ **CRITICAL — the description over-promises.** Several things the task brief asks about **do not exist in the actual graph.** Read §0 first; it overrides any contrary expectation.

---

## 0. Reality check (what is NOT here)

| Asked about | Actual state in this workflow |
|---|---|
| **LLM re-engagement email** | **Does not exist.** No LangChain node, no OpenAI/chat-model node, no prompt string, no email-send node anywhere in the graph. Nothing re-engages a lead. The sweep only *moves and deletes rows*. |
| **Parsing the embedded snooze date `<YYYY-MM-DD>`** | **Never parsed.** No code extracts or compares the date. See §3 — routing is purely a `Status`-string prefix match. |
| **Deciding a snooze is "due" (today ≥ date)** | **No due-date logic at all.** Every row whose status begins with the snooze prefix is swept *immediately, regardless of date.* There is no "wait until due" gate. |
| **WhatsApp approve/deny gate** | **Does not exist.** WhatsApp is used only for (a) a one-shot end-of-run summary and (b) an error alert. There is no approval branch, no `wait`, no reply-handling. |
| **Copy snoozes vs. delete Do-Not-Contacts (differential handling)** | **Partially false.** In practice BOTH snooze rows AND DNC rows are deleted from the leads sheet. Only snooze rows are copied to the snooze sheet first. DNC rows are deleted with **no backup copy.** See §5. |

The workflow's *real* behavior: a daily janitor that walks every campaign folder, reads its leads sheet, finds rows whose `Status` marks them not-interested, copies the snoozed ones into a per-campaign "snoozes" sheet, then deletes all matched rows from the leads sheet. That's it.

---

## 1. Purpose & flow (node-by-node)

Two entry points converge on `Config — Sweep Settings`, then the campaign loop runs.

```
Daily 08:15 (schedule) ─┐
Webhook (wf8-...)      ─┴─▶ Config — Sweep Settings
   ▶ Drive — Find Root Folder ("Evertrust Campaigns")
   ▶ Drive — List Campaign Folders (children of root)
   ▶ Loop — Campaigns (splitInBatches)
        ├─[done]──▶ Build Summary ──▶ WhatsApp — Sweep Summary
        └─[loop]──▶ Drive — List Campaign Files (files in this campaign folder)
              ▶ Resolve Sheets  (pick leads file + snooze file by name match)
              ▶ Has Leads Sheet?  (IF)
                  ├─[false]──▶ Record Skip ──▶ (back to Loop)
                  └─[true]───▶ Has Snooze Sheet?  (IF)
                        ├─[false → provision]──▶ Create Snooze Sheet ──▶ Move Snooze to Folder ──▶ Finalize Snooze Id
                        └─[true]───────────────────────────────────────────────────────────────▶ Finalize Snooze Id
              ▶ Read Leads (Google Sheets, Sheet1)
              ▶ Route Leads (classify each row: snooze / delete / ignore)
              ▶ Build Snooze Rows (snooze rows only)
              ▶ Copy to Snooze Sheet (append; onError: continue)
              ▶ Collect Delete List (row numbers of ALL routed rows)
              ▶ Delete Swept Rows (Google Sheets delete by startIndex; onError: continue)
              ▶ Record Result (push per-campaign tally to staticData)
              ▶ (back to Loop — Campaigns)

On Workflow Error (errorTrigger) ──▶ WhatsApp — Error Alert
```

### IF / branch detail
- **Has Leads Sheet?** (`n8n-nodes-base.if` v2.3, boolean equals): `{{ $json.hasLeads }} == true`.
  - TRUE (output 0) → `Has Snooze Sheet?`
  - FALSE (output 1) → `Record Skip` (records `status: 'skipped-no-leads'`, returns to loop).
- **Has Snooze Sheet?** (boolean equals): `{{ $json.hasSnooze }} == true`.
  - TRUE (output 0) → `Finalize Snooze Id` directly (snooze sheet already exists).
  - FALSE (output 1) → `Create Snooze Sheet` → `Move Snooze to Folder` → `Finalize Snooze Id` (provision once).
- No Switch nodes. No `branch:"true"/"false"` ambiguity issues to port — outputs are wired explicitly above.

### The loop
`Loop — Campaigns` is a `splitInBatches` v3 with **default batch options** (no batchSize set → effectively one item per iteration / n8n default). Output 0 = "done" (all batches processed) → summary. Output 1 = "loop" (per-item body). Both `Record Result` and `Record Skip` wire back to the loop node to advance. Port as a simple `for campaign in campaigns:` loop.

---

## 2. Trigger(s)

1. **`Daily 08:15`** — `scheduleTrigger` v1.3. Fires daily at **08:15** (`triggerAtHour: 8, triggerAtMinute: 15`). Server-local TZ. This is the production cadence.
2. **`Webhook`** — `n8n-nodes-base.webhook` v2.1, path **`wf8-sleeper-grenade`**, default method (GET/POST), webhookId `e1d05664-...`. Manual/on-demand kick. Wires into the same `Config — Sweep Settings`. (Workflow is inactive, so neither trigger is currently live.)

`triggerCount: 2` confirms both. Port: a cron job (08:15 daily) plus an optional manual/HTTP entry point.

---

## 3. Lead discovery — how it finds leads to act on

**Folder walk (mirrors "Glock discovery"):**
1. `Config — Sweep Settings` sets: `rootFolderName="Evertrust Campaigns"`, `phoneNumberId="1030239273516528"`, `managerPhone="84333634500"`, `runId={{ $now.toFormat("yyyy-LL-dd-HHmm") }}`.
2. `Drive — Find Root Folder` — Google Drive `fileFolder` search, `queryString = rootFolderName`, limit 1, folders only → the root folder id.
3. `Drive — List Campaign Folders` — list all sub-folders of root (`returnAll`, folders only). Each child = one campaign.
4. Loop each campaign → `Drive — List Campaign Files` lists files in that campaign folder.
5. **`Resolve Sheets`** (Code) picks two files **by filename substring (case-insensitive):**
   - **leads file** = first file whose name contains `"lead"` AND is not exactly `"config.json"`.
   - **snooze file** = first file whose name contains `"snooze"`.
   - Emits: `campaignName, campaignFolderId, runId, leadsFileId, snoozeFileId, hasLeads (=!!leads), hasSnooze (=!!snooze), fileNames[]`.

**Status-string matching (the actual "discovery" of which rows to act on) — `Route Leads` Code node.**
For each leads row (row index `i`, `rowNumber = i + 2`, i.e. 1-based + header):
```js
const raw  = (j['Status'] || '').toString().trim();
const norm = raw.toLowerCase();
const isDnc    = norm === 'not interested - do not contact' || norm === 'not interested at all';
const isSnooze = norm.indexOf('not interested - snoozed') === 0 || norm === 'not interested temp';
if (isDnc)        out.push({ _action: 'delete', rowNumber, _row: j });
else if (isSnooze) out.push({ _action: 'snooze', rowNumber, _row: j });
// rows matching neither are ignored
out.sort((a,b) => b.rowNumber - a.rowNumber); // descending — delete bottom-up
```

### Snooze-date parsing & "due" logic — **NONE**
- The status it expects is `Not Interested - Snoozed<YYYY-MM-DD>` (Glock writes the date appended, no space). The match is `norm.indexOf('not interested - snoozed') === 0` — a **prefix test**. The embedded date is **never extracted, never parsed, never compared to today.** There is no `today >= date` check anywhere.
- Consequence to preserve/flag in the port: **every snoozed lead is swept on the very next run, regardless of its snooze date.** If the intended product behavior is "only re-engage when the snooze is due," that logic is **missing and must be added in the port** (extract the trailing date, compare `today >= date`, skip if not yet due).

### "Dual-vocab routing"
The classifier accepts **two vocabularies** for each category — the canonical Glock strings plus legacy/alias strings:
- **Do-Not-Contact / delete vocab:** `"Not Interested - Do Not Contact"` **OR** `"Not Interested At All"`.
- **Snooze vocab:** `"Not Interested - Snoozed<date>"` (prefix) **OR** `"Not Interested Temp"`.
Matching is `.trim().toLowerCase()`, so it is case-insensitive and whitespace-tolerant. "Dual-vocab" = this two-string-per-bucket tolerance, nothing more.

---

## 4. Re-engagement — **NOT IMPLEMENTED**

There is no re-engagement email, no LLM, no model, no credential, no prompt, no auto-send, no approval gate in this workflow. The name "SLEEPER GRENADE" and the brief imply re-engaging dormant ("sleeper") leads, but the actual graph only sweeps/quarantines rows. 

**For the port:** if re-engagement is desired, it is net-new work — there is nothing here to port. Document explicitly: model = none, credential = none, prompt = none, send mechanism = none. WhatsApp here is summary/error only (§8), never an approve/deny gate.

---

## 5. Do-Not-Contact handling & "copy-before-delete"

**What the description claims:** "copies snoozes then deletes Do-Not-Contacts" + "copy-before-delete" safety.

**What the graph actually does:**
- `Build Snooze Rows` — filters `Route Leads` output to `_action === 'snooze'` only, emits each as `{ json: r._row }` (the original row object).
- `Copy to Snooze Sheet` — Google Sheets **append** to the snooze sheet's `Sheet1`, `mappingMode: autoMapInputData`, `handlingExtraData: insertInNewColumn`, `onError: continueRegularOutput`. **Only snooze rows are copied.**
- `Collect Delete List` — `$('Route Leads').all()` → `{ rowNumber }` for **ALL** routed rows (both snooze AND delete actions).
- `Delete Swept Rows` — Google Sheets **delete** on the leads sheet `Sheet1`, `startIndex = {{ $json.rowNumber }}`, `onError: continueRegularOutput`.

**Therefore:**
- **Copied to backup (snooze sheet):** snooze-status rows only.
- **Deleted from leads sheet:** snooze rows **and** DNC rows — i.e., everything classified.
- **Copy-before-delete safety applies ONLY to snooze rows.** DNC / "Not Interested At All" rows are **deleted with no backup copy anywhere.** This is a real data-loss gap vs. the stated "copy-before-delete" guarantee — flag it for the port (DNC rows should arguably be archived to a do-not-contact sheet before deletion, but currently are not).
- Deletion happens **after** the snooze copy (sequential wiring), and rows were sorted **descending by rowNumber** in `Route Leads` so bottom-up deletes don't shift indices. `Delete Swept Rows` deletes one row per item via `startIndex`; preserve the descending order in the port.

---

## 6. Per-campaign snooze sheet provisioning

Triggered only when `Has Snooze Sheet? == false` (no file containing "snooze" in the campaign folder). Provisioned **once** per campaign, before any row processing:
- **`Create Snooze Sheet`** — Google Sheets, `resource: spreadsheet`, **title = `snoozes — {{ $json.campaignName }}`** (literal "snoozes — " prefix + campaign name). No explicit columns/headers defined at creation (empty new spreadsheet; columns get created lazily by the later append's `autoMapInputData` + `insertInNewColumn`). So **columns = whatever the leads-row keys are** (dynamic, mirrors the leads sheet schema).
- **`Move Snooze to Folder`** — Google Drive `move`, `fileId = {{ $json.spreadsheetId }}`, into `folderId = $('Resolve Sheets').first().json.campaignFolderId` (out of My Drive root into the campaign folder).
- **`Finalize Snooze Id`** — Code: resolves the effective snooze file id = `cfg.snoozeFileId || inp.id || inp.spreadsheetId` and forwards `campaignName, runId, leadsFileId, snoozeFileId`. This is the join point where the "existing snooze sheet" branch and the "just-created snooze sheet" branch reconverge.

The data sheet name written/read inside both leads and snooze spreadsheets is hardcoded **`Sheet1`** everywhere.

---

## 7. State READ — the Glock contract (exact strings consumed)

Reads the `Status` column of each leads-sheet row. Recognized values (after `.trim().toLowerCase()`):

| Bucket | Exact strings recognized | Match type |
|---|---|---|
| Delete (Do-Not-Contact) | `Not Interested - Do Not Contact` | exact (lowercased) |
| Delete (Do-Not-Contact) | `Not Interested At All` | exact (lowercased) |
| Snooze | `Not Interested - Snoozed<YYYY-MM-DD>` | **prefix** `not interested - snoozed` |
| Snooze | `Not Interested Temp` | exact (lowercased) |

Any other `Status` (e.g. blank, "Interested", "Contacted") → ignored, row untouched. Matching is by `Status` column value only; leads are matched to spreadsheet rows by position (`rowNumber = arrayIndex + 2`).

---

## 8. State WRITTEN

- **Leads sheet:** **row deletions** for every snooze-or-DNC row (`Delete Swept Rows`, by `startIndex`, descending). No status rewrite — rows are removed, not relabeled.
- **Snooze sheet (per campaign):** **appended rows** = full copies of each snoozed lead row (`Copy to Snooze Sheet`). Sheet auto-created + moved into the campaign folder on first need.
- **No status string is ever written back** to leads (no "re-engaged", no "contacted" update). The workflow never edits cell values, only appends/deletes rows.
- **WhatsApp (write/notify):**
  - `WhatsApp — Sweep Summary` — `executeOnce: true`, sent after the loop completes. Body: `Not-Interested Sweep — {campaigns} campaigns, {snoozed} snoozed, {deleted} deleted, {skipped} skipped.\n{detail}`. To `managerPhone` via `phoneNumberId` from Config.
  - `WhatsApp — Error Alert` — fired by `On Workflow Error`. Body: `Not-Interested Sweep ERROR in "{workflow.name}" (exec {execution.id}): {error.message}`. Phone/`phoneNumberId` **hardcoded** here (`1030239273516528` / `84333634500`).
- **Workflow staticData (`global`):** `Record Result` / `Record Skip` push per-campaign tallies into `sd.sweepResults[]`, keyed/reset by `sd.sweepRunId === runId`. Each entry: `{campaign, status: 'applied'|'skipped-no-leads', snoozed, deleted, [fileNames]}`. `Build Summary` reads this back to compose the WhatsApp summary. (This is the only cross-node aggregation channel — port as an in-memory list.)

---

## 9. Credentials, config, error handling

**Credentials (n8n credential refs — port to your own auth):**
- Google Drive OAuth2 — `googleDriveOAuth2Api` id `7ntqqDsIDCgae66w`. (find root, list folders, list files, move sheet)
- Google Sheets OAuth2 — `googleSheetsOAuth2Api` id `nVxTVzA6qeIhESvH`. (read leads, create snooze sheet, append, delete)
- WhatsApp Business — `whatsAppApi` id `hfg64imhwFA01Qcb` ("WhatsApp account"). (summary + error)

**Config consumed (`Config — Sweep Settings`):**
- `rootFolderName = "Evertrust Campaigns"` (Drive root to walk)
- `phoneNumberId = "1030239273516528"` (WhatsApp sender)
- `managerPhone  = "84333634500"` (recipient)
- `runId = $now.toFormat("yyyy-LL-dd-HHmm")` (dedup key for staticData aggregation)

**Error handling / guards:**
- `On Workflow Error` (errorTrigger) → WhatsApp alert. Catches any unhandled node failure.
- `Copy to Snooze Sheet` and `Delete Swept Rows` both `onError: continueRegularOutput` — a failed append or delete will not abort the campaign; the loop continues. **Risk to flag:** if the snooze copy fails silently but the delete still runs, snooze rows are lost (delete is not gated on copy success). Port should gate deletion on successful backup.
- `Has Leads Sheet?` guards against campaigns with no leads file (→ skip).
- `Has Snooze Sheet?` guards snooze-sheet provisioning (create once).
- No retry/backoff config, no dedup of already-swept rows beyond the status no longer matching after deletion.

---

## 10. n8n artifacts NOT worth porting

- `splitInBatches` loop mechanics + the two wire-backs (`Record Result`/`Record Skip` → loop) → plain Python `for` loop.
- `$getWorkflowStaticData('global')` + `sweepRunId`/`sweepResults` → in-memory list/dict.
- `Finalize Snooze Id` reconvergence Code node → a simple variable assignment after the create-or-find branch.
- `Resolve Sheets` filename heuristics → keep the logic (pick leads/snooze files by name substring) but it's plain Python.
- n8n `__rl` resource-locator wrappers, `webhookId`s, node positions, `versionId`, `pinData`, `staticData` payload → all n8n-internal, ignore.
- WhatsApp nodes → replace with whatever notification channel the port uses.

---

## Porting checklist (decisions the port must make)

1. **Implement (or deliberately omit) the missing due-date gate** — currently snoozes are swept immediately; the embedded `<YYYY-MM-DD>` is ignored.
2. **Decide DNC backup** — currently DNC rows are deleted with no copy. Add a do-not-contact archive if data retention matters.
3. **Gate delete on successful copy** — current `onError: continue` can drop snooze rows.
4. **Re-engagement is net-new** — no LLM/email exists to port.
