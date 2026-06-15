# EVERTRUST – RAG AGENT — Migration Blueprint

> Source: n8n workflow `Ehl6IeZviaycfkSo` ("EVERTRUST - RAG AGENT") on `evertrustgmbh.app.n8n.cloud`.
> Project: **REACH ARSENAL**. Active. Created 2026-05-28, last updated 2026-06-12.
> This document is a faithful, verbatim-where-it-matters spec for re-implementing the workflow as local Python.

---

## ⚠️ Important naming caveat

Despite the name **"RAG AGENT"**, this workflow is **NOT a true RAG system**. There is:
- **No vector store** (no Qdrant, Pinecone, pgvector, etc.).
- **No embeddings model.**
- **No chunking, no top-k retrieval, no similarity search.**

"Retrieval" = downloading **one flat knowledge `.txt` file from Google Drive**, stripping HTML, truncating to 150k chars, and **stuffing the entire thing into the LLM system prompt** as context. It is "stuff-the-whole-doc-in-context" grounding, not retrieval-augmented generation. The migration can keep this approach (single knowledge blob → prompt) or upgrade to real RAG — flagged in the Python architecture section.

---

## Purpose

End-to-end: **Hourly (currently webhook-triggered), scan EverTrust campaign folders on Google Drive → read each campaign's `leads` sheet → find leads with `Status = Unsure` → fetch their Gmail thread → an LLM (hermes via LiteLLM) identifies the lead's hesitation and drafts a confident reply as "Hanna Nguyen" → save a Gmail draft (never auto-send) → log the analysis into an `Unsure_Analysis` sheet in that campaign's Drive folder (creating it if missing).**

The agent's job is to **re-engage "Unsure" leads**: detect what they're hesitant about, categorize it, and produce a ready-to-review email draft grounded only in the EVERTRUST knowledge document.

---

## Trigger & Inputs

Two triggers feed into `Campaign Config`:

1. **`ERP Scan Webhook`** (`n8n-nodes-base.webhook`, v2.1) — **ACTIVE / primary.**
   - Method: `POST`, path: `erp-rag-scan`, webhookId `18bb8b6b-9e6d-40b8-8314-720a0c8b915a`.
   - No input shape is consumed — body is ignored; the webhook just kicks off the scan. (Note: a `pinData` blob exists for a non-existent "Email Received" node — stale, **ignore**.)
2. **`Every Hour`** (`n8n-nodes-base.scheduleTrigger`, v1.3) — **DISABLED.** Interval: every 1 hour. This is the intended production trigger ("Hourly:" per the workflow description) but is currently turned off in favor of the webhook.

**Migration takeaway:** Python entrypoint should be a scheduled job (cron, hourly) with an optional manual/HTTP trigger. No meaningful request payload.

---

## Node-by-node flow (execution order)

| # | Node | Type | What it does |
|---|------|------|--------------|
| 0a | **ERP Scan Webhook** | webhook v2.1 | POST `/erp-rag-scan`. Active entrypoint. |
| 0b | **Every Hour** | scheduleTrigger v1.3 | Hourly. **Disabled.** |
| 1 | **Campaign Config** | set v3.4 | Hardcodes config vars (see below). |
| 2 | **List Campaign Folders** | googleDrive v3 | Lists all **folders** inside the `EverTrust Campaigns` parent folder. One item per campaign. |
| 3 | **Find Leads Sheet** | googleDrive v3 | For each campaign folder, search files named `leads`, type = Google Sheets, `returnAll`. |
| 4 | **Pick Leads Sheet** | code v2 | Pick exactly one leads sheet: exact name `leads` first, else first name starting with `leads`, else none. |
| 5 | **Read Leads (Unsure)** | googleSheets v4.7 | Read sheet (gid `0` / Sheet1), `UNFORMATTED_VALUE` for values, `FORMATTED_STRING` for dates. |
| 6 | **Extract Unsure Leads** | code v2 | Filter `Status == "unsure"`, extract+validate email, dedupe, route to Hanna/Trung inbox. (full logic below) |
| 7 | **Cap Per Run** | limit v1 | `maxItems: 10` — at most 10 leads processed per execution. |
| 8 | **Hanna or Trung?** | if v2.2 | Branch on `sentFrom contains "hanna"`. TRUE → Hanna Gmail path; FALSE → info@ (Trung) Gmail path. |
| 9a | **Search Gmail Threads (Hanna)** | gmail v2.2 | **DISABLED.** Thread search `from:{leadEmail}`, limit 1, Hanna creds. |
| 10a | **Get Thread (Hanna)** | gmail v2.2 | **DISABLED.** Get full thread by id, Hanna creds. |
| 9b | **Search Gmail Threads** | gmail v2.2 | Thread search `from:{leadEmail}`, limit 1, `readStatus: both`. info@ creds. |
| 10b | **Get Thread** | gmail v2.2 | Get full thread by id (`returnOnlyMessages: false`). info@ creds. |
| 11 | **Build Thread Context** | code v2 | Decode/format Gmail thread into a labeled transcript; compute dedupKey; drop threads with no lead message. (full logic below) |
| 12 | **Skip Seen Messages** | removeDuplicates v2 | **DISABLED.** Would dedupe on `dedupKey` across executions (history 10000, node scope). |
| — | **Download Knowledge File** | googleDrive v3 | `executeOnce`. Downloads `Evertrust_Knowledge_Base.txt` (fileId `1N5X6ScNkW6hAf9rtn6tSeQne6OIKP2j4`) to binary `data`. |
| — | **Extract Knowledge Text** | extractFromFile v1.1 | `executeOnce`. Binary → text into `rawText`. |
| — | **HTML to Text** | code v2 | `executeOnce`. Strip HTML if present, normalize whitespace, cap 150000 chars → `knowledgeText`. (logic below) |
| 13 | **Attach Knowledge** | merge v3.2 | `combine` / `combineAll`. Input 0 = thread-context items, Input 1 = knowledge text. Cross-joins knowledge onto every lead. |
| 14 | **Build Hermes Prompt** | code v2 | Build `systemPrompt` + `userPrompt` per lead. (**verbatim prompt below**) |
| 15 | **DeepSeek (LiteLLM Gateway)** | `@n8n/n8n-nodes-langchain.openAi` v1.7 | Calls model `hermes` via LiteLLM. `jsonOutput: true`, `temperature: 0.2`. system+user messages. |
| 16 | **Parse Hermes Reply** | code v2 | Parse model JSON (strip code fences, slice `{...}`) into `{ output: {...} }`. (logic below) |
| 17 | **Build Study Row** | set v3.4 | Map model output + lead context into named fields (Client Email, Company, Section, Area, Draft Subject, Drafted Reply, campaignFolderId, scannedFrom). |
| 18 | **Route Draft by Inbox** | if v2.2 | Branch on `scannedFrom contains "hanna"`. TRUE → Save Draft (Hanna); FALSE → Save Draft (Do Not Send / info@). |
| 19a | **Save Draft (Hanna)** | gmail v2.2 | Create Gmail **draft** (not send) in Hanna's inbox. To `Client Email`, subject/body from model. |
| 19b | **Save Draft (Do Not Send)** | gmail v2.2 | Create Gmail **draft** in info@ inbox. To `Client Email`. |
| 20 | **Find Unsure Analysis Sheet** | googleDrive v3 | In the campaign folder, search file named `Unsure_Analysis` (Sheets), limit 1. `alwaysOutputData`. |
| 21 | **Analysis Sheet Exists?** | if v2.2 | `id` notEmpty (loose). TRUE → reuse; FALSE → create. |
| 22a | **Resolve Existing Sheet** | code v2 | Build append row referencing existing sheet id. |
| 22b | **Create Analysis Spreadsheet** | googleSheets v4.7 | Create spreadsheet titled `Unsure_Analysis` with `Sheet1`. |
| 23b | **Move to Campaign Folder** | googleDrive v3 | Move the new spreadsheet from My Drive into the campaign folder. |
| 24b | **Resolve New Sheet** | code v2 | Build append row referencing the newly created sheet id. |
| 25 | **Append to Unsure Analysis** | googleSheets v4.7 | `append`, autoMapInputData. Writes columns: `Client Email`, `Unsure Section`, `Category Of Unsure` (+ `_sheetId` used as documentId). |

**Note on order:** the LLM draft is created and the Gmail draft is saved BEFORE the analysis sheet is written. So a failure in the sheet-logging stage still leaves a saved draft.

---

## Campaign Config (hardcoded vars — node `Campaign Config`)

| Var | Value |
|-----|-------|
| `campaignsFolderName` | `EverTrust Campaigns` |
| `campaignsFolderId` | `1Keop0NUWo3dX7LsaqTwhJcZlAFGP7wId` (Google Drive folder) |
| `senderName` | `Trung Cang` |
| `senderEmail` | `info@evertrust-germany.de` |
| `hermesBaseUrl` | `https://CHANGE-ME.your-tailnet.ts.net` (**unused placeholder** — actual LLM call uses the LiteLLM credential, not this) |
| `hermesModel` | `hermes3` (**unused** — actual node uses model id `hermes`) |

The hermes base URL / model vars here are dead config; the real call goes through the `openAi` node's `LiteLLM Gateway (mac-mini)` credential with model `hermes`.

---

## Verbatim LLM prompts (node `Build Hermes Prompt`)

The Code node builds these two strings per lead. `${...}` are JS template interpolations.

### System prompt (VERBATIM)

```
You are working on a lead marked "Unsure" in the sales pipeline. You have the full email thread between EVERTRUST GmbH and this lead.

Your two tasks:
1. IDENTIFY the "unsure section" — scan the entire thread and find the specific text where the lead expresses hesitation, raises an unanswered question, or signals uncertainty. This may appear anywhere in the thread. Extract the relevant sentence(s) verbatim or as a close paraphrase.
2. DRAFT a confident reply that directly addresses that specific concern, on behalf of Hanna Nguyen at EVERTRUST GmbH.

Work ONLY from the knowledge document at the end for factual claims. Never use outside knowledge. Do not invent facts. The subject field is for the reply — do not prefix with "Re:".

=== CORE RULE: BE HANNA — DECISIVE, NEVER APOLOGETIC ===

BANNED phrases: "At the moment, I do not have..." / "I do not have confirmed information..." / "I want to be transparent here..." / "I'm sorry, but..." / "Based on the materials I have..." / "The brochure does not specify..." / "I cannot confirm from our current materials..."

**MODE A — DIRECT ANSWER.** Use when the knowledge document contains material that meaningfully answers the question. 1–2 short paragraphs (max 3 sentences each).

**MODE B — BRIEF STALL.** Use when the document does NOT contain the information.

English: "Thank you for getting back to us. We have carefully gone through your point and are currently checking with our operations team to provide you with a complete answer as soon as possible.\n\nWe will follow up with you very shortly."

German: "Vielen Dank für Ihre Rückmeldung. Wir haben Ihren Punkt sorgfältig durchgegangen und stimmen uns derzeit mit unserem Team ab, um Ihnen schnellstmöglich eine vollständige Antwort zu geben.\n\nWir melden uns in Kürze bei Ihnen."

If part is answerable: MODE A on that part, end with "We will follow up on the remaining details shortly."

=== LANGUAGE ===
Language of the IDENTIFIED UNSURE SECTION determines both body and salutation language.

=== SALUTATION ===
English: "Dear <FirstName>," or "Dear <Company Name>,"
German: "Sehr geehrte Damen und Herren von <Company Name>," (default)
NEVER "Hello,". NEVER invent a recipient name.

=== TONE ===
Max 3 sentences/paragraph. "We" for company actions. No filler, no emojis. Do NOT repeat info already in the thread.

=== MEETING-REQUEST PATTERN ===
"Thank you for your interest. To take this further, please choose one of the following 30-minute slots:\n\n1) <Weekday>, <DD MMM YYYY> at <HH:MM> Berlin\n2) <Weekday>, <DD MMM YYYY> at <HH:MM> Berlin\n\nReply with just the number (1 or 2) and we'll send a calendar invite with a Google Meet link."

=== REFERENCE-REQUEST PATTERN ===
"I would love to share these with you; however, we have signed NDAs with all of our clients which prevents us from sharing direct references." Add max 4 awarded-project bullets if in knowledge doc.

=== CLOSERS ===
English: Kind regards,\nHanna Nguyen\nEVERTRUST GmbH
German: Mit freundlichen Grüßen,\nHanna Nguyen\nEVERTRUST GmbH

=== OUTPUT FIELDS ===
1. subject (max ~70 chars, same language, no "Re:").
2. unsureSection: verbatim/close-paraphrase of the key hesitation text. Same language as original.
3. unsureSignal: brief English description (one phrase).
4. unsureArea: exactly one of "Finance", "Operation", "Organization", "Legality", "Reference - Past Projects/Wins".
5. areaExplanation: 5–12 words why this category applies.
6. draftReply: full email reply, same language as unsure section. Use real line breaks for paragraphs.
7. citations: array of verbatim quotes from knowledge doc. Empty array for MODE B.

=== CRITICAL OUTPUT FORMAT ===
Return ONLY a single valid JSON object with exactly these keys: subject, unsureSection, unsureSignal, unsureArea, areaExplanation, draftReply, citations. Output nothing else — no markdown, no code fences, no commentary. "citations" MUST be an array of strings (use [] if none).

Knowledge document:
${knowledgeText}
```

### User prompt (VERBATIM template)

```
Lead context:
Company: ${companyName}
Country: ${country}
Lead email: ${leadEmail}

Full email thread (oldest first):
${formattedThread}
```

---

## Code-node algorithms

### `Pick Leads Sheet`
```js
const items = $input.all();
const exact = items.find(i => (i.json.name || '').toLowerCase() === 'leads');
if (exact) return [exact];
const prefix = items.find(i => (i.json.name || '').toLowerCase().startsWith('leads'));
if (prefix) return [prefix];
return [];
```
Pick the sheet whose name is exactly `leads` (case-insensitive); else the first starting with `leads`; else nothing.

### `Extract Unsure Leads`
- Reads `campaignFolderId` and `campaignName` from `List Campaign Folders` item.
- For each lead row:
  - `status = (Status|status).trim().toLowerCase()`; **skip unless `status === 'unsure'`**.
  - Extract email from `Email|email` with regex `/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/`; lowercase. Skip if none.
  - **Dedupe by email** within the run (`Set`).
  - `companyName` from `Company Name|companyName`; `country` from `Country|country`.
  - **Inbox routing:** read `Send From` (many case variants incl. `Sent From`), lowercase. If it **contains `"hanna"`** → `sentFrom = "hanna@evertrust-germany.de"`, else default `sentFrom = "info@evertrust-germany.de"`.
- Emits `{ leadEmail, companyName, country, campaignFolderId, campaignName, sentFrom }`.

### `Build Thread Context`
- Helpers: `decodeBase64Url` (base64url → utf-8 via `Buffer`); `extractBody(payload)` — prefers `body.data`, else first `text/plain` part, else recurse into `multipart/*`.
- For each thread item (matched back to lead via `$('Extract Unsure Leads').itemMatching(i)`):
  - Pull `leadEmail` (lowercased), `companyName`, `country`, `campaignFolderId`, `scannedFrom` (= lead's `sentFrom`, default info@).
  - Sort messages ascending by `internalDate`, take **last 20** (`slice(-20)`).
  - For each message: label `[LEAD]` if `From` includes `leadEmail`, else `[EVERTRUST]`. Body = decoded body or snippet, trimmed, **capped 2000 chars**. Track `hasLeadMessage`; capture `clientReplyEmail` from the lead's `From` (same email regex).
  - Build `formattedThread` = blocks of `--- [LABEL] | Date ---\nFrom:...\nSubject:...\n\nbody`.
  - **Skip thread if no lead message** (`!hasLeadMessage → continue`).
  - `dedupKey = leadEmail|threadId|lastMessageId`.
- Emits `{ leadEmail, companyName, country, campaignFolderId, threadId, formattedThread, dedupKey, clientReplyEmail, scannedFrom }`.

### `HTML to Text`
- Takes `rawText`. If it looks like HTML (`/<[a-z][\s\S]*?>/i`): strip `<style>`/`<script>` blocks, strip all tags, decode `&nbsp; &amp; &lt; &gt; &quot;`.
- Collapse spaces/tabs, collapse 3+ newlines to 2, trim. **Cap at 150000 chars** (`CAP`). Emits `{...j, knowledgeText }`.

### `Parse Hermes Reply`
- Pull content from `message.content` / `content` / whole item.
- If string: strip leading ```` ```json ```` / trailing ```` ``` ````, slice from first `{` to last `}`, `JSON.parse` (throws with raw on failure).
- Coerce to `output` object with string fields `subject, unsureSection, unsureSignal, unsureArea, areaExplanation, draftReply` and `citations` array (defaults `[]`). Emits `{ output }`.

### `Resolve Existing Sheet` / `Resolve New Sheet`
Build the append row `{ _sheetId, 'Client Email', 'Unsure Section', 'Category Of Unsure' }` from `Build Study Row`. The only difference is sheet-id source: existing uses `$json.id` (from Drive search); new uses `$('Create Analysis Spreadsheet').item.json.spreadsheetId`.

---

## "Vector store" / knowledge config

**There is no vector store, no embeddings, no top-k, no similarity, no chunking.** Grounding is:

- **Source:** single Google Drive file `Evertrust_Knowledge_Base.txt`, fileId `1N5X6ScNkW6hAf9rtn6tSeQne6OIKP2j4`.
- **Processing:** download → extract text → HTML-strip + whitespace-normalize → **truncate to 150,000 chars**.
- **Injection:** the entire blob is appended verbatim to the LLM **system prompt** under `Knowledge document:`.
- **Model:** `hermes` (LiteLLM gateway), `temperature: 0.2`, `jsonOutput: true`. No explicit maxTokens/timeout set on the node.

So "RAG" here = full-document context stuffing. → For the Python port this maps cleanly to a `knowledge_docs` Postgres table (one row or a few rows of text), loaded and concatenated into the prompt. Real RAG (pgvector + embeddings + top-k) is an optional upgrade, not a faithful port.

---

## Data read & write (with Drive→Postgres migration flags)

### Reads
| Source | What | Migration flag |
|--------|------|----------------|
| Google Drive folder `EverTrust Campaigns` (`1Keop0NUWo3dX7LsaqTwhJcZlAFGP7wId`) | List of campaign subfolders | **→ must become Postgres `campaigns` table.** Each campaign = a row, not a folder. |
| Google Drive: `leads` Google Sheet inside each campaign folder | Lead rows (Status, Email, Company Name, Country, Send From) | **→ must become Postgres `leads` table** (filtered `status='unsure'`). |
| Google Drive file `Evertrust_Knowledge_Base.txt` (`1N5X...P2j4`) | Knowledge blob for grounding | **→ must become Postgres `knowledge_docs` table** (or local file). |
| Gmail (info@ via `Gmail OAuth2 API`; Hanna via `Gmail account: Hanna`) | Lead email threads (`from:{leadEmail}`, last 20 msgs) | Stays an email/IMAP/Gmail-API read. Not Drive. Could be persisted to a `threads`/`messages` table. |

### Writes
| Target | What | Migration flag |
|--------|------|----------------|
| Gmail **draft** (Hanna or info@ inbox) | Drafted reply to the lead (never auto-sent) | Stays Gmail (draft creation). |
| Google Drive: `Unsure_Analysis` Google Sheet per campaign folder (create if missing, then move into folder) | Appends `Client Email`, `Unsure Section`, `Category Of Unsure` | **→ must become Postgres `unsure_analysis` table.** No per-campaign sheet creation; just INSERT rows keyed by campaign + client email. |

### Likely Supabase/Postgres table mapping
- `campaigns` ← Drive campaign folders.
- `leads` ← `leads` sheet rows (status, email, company, country, send_from).
- `knowledge_docs` ← `Evertrust_Knowledge_Base.txt`.
- `unsure_analysis` ← the `Unsure_Analysis` sheet output (`client_email`, `unsure_section`, `category_of_unsure`; plus suggested: `campaign_id`, `unsure_signal`, `area_explanation`, `subject`, `draft_reply`, `scanned_from`, `created_at`).
- `personas` / `meeting_analyses` — **not used** by this workflow.

---

## Credentials referenced

| Credential name | Type | Used by | Migration note |
|-----------------|------|---------|----------------|
| `Google Drive OAuth2 API` (id `7ntqqDsIDCgae66w`) | googleDriveOAuth2Api | List folders, find sheets, download knowledge, find/move analysis sheet | **Drops out** once Drive → Postgres. |
| `Google Sheets OAuth2 API` (id `nVxTVzA6qeIhESvH`) | googleSheetsOAuth2Api | Read leads, create/append analysis sheet | **Drops out** → Postgres client. |
| `Gmail OAuth2 API` (id `hfmgCbneMAlU81I5`) | gmailOAuth2 | info@/Trung path: search, get thread, save draft | Keep (Gmail API). |
| `Gmail account: Hanna` (id `iBJ8BCOqhFb5kDUg`) | gmailOAuth2 | Hanna path (search/get thread **disabled**; save draft active) | Keep (Gmail API). |
| `LiteLLM Gateway (mac-mini)` (id `2YgDmy9NuLHvOgzJ`) | openAiApi | LLM call (model `hermes`) | Keep — OpenAI-compatible client → LiteLLM base URL. |

No secrets are hardcoded in nodes (creds are referenced by id).

---

## IF/Switch routing logic

1. **`Hanna or Trung?`** (IF, after Cap Per Run): condition `sentFrom contains "hanna"` (case-sensitive, strict).
   - **TRUE** → `Search Gmail Threads (Hanna)` → `Get Thread (Hanna)` → `Build Thread Context`. **Both Hanna search/get nodes are DISABLED**, so in practice the TRUE branch is currently broken/dead — Hanna leads would not get a thread fetched. Only the FALSE (info@) branch reliably produces thread context today.
   - **FALSE** → `Search Gmail Threads` → `Get Thread` → `Build Thread Context`.
2. **`Route Draft by Inbox`** (IF, after Build Study Row): condition `scannedFrom contains "hanna"`.
   - **TRUE** → `Save Draft (Hanna)` (Hanna's inbox).
   - **FALSE** → `Save Draft (Do Not Send)` (info@ inbox).
3. **`Analysis Sheet Exists?`** (IF, after Find Unsure Analysis Sheet): condition `id notEmpty` (loose).
   - **TRUE** → `Resolve Existing Sheet` → append.
   - **FALSE** → `Create Analysis Spreadsheet` → `Move to Campaign Folder` → `Resolve New Sheet` → append.

---

## Known model / runtime config

- **LLM:** model id `hermes` via `LiteLLM Gateway (mac-mini)` (OpenAI-compatible). `temperature: 0.2`, `jsonOutput: true`. No explicit maxTokens or timeout configured.
- Node label says "DeepSeek" but model id is `hermes` and config vars say `hermes3` — **naming is inconsistent**; the effective model is whatever LiteLLM routes `hermes` to.
- **Per-run cap:** 10 leads (`Cap Per Run`).
- **Thread cap:** last 20 messages; each body truncated to 2000 chars.
- **Knowledge cap:** 150,000 chars.

---

## Known issues & gotchas (landmines for the Python port)

1. **Not actually RAG.** No retrieval; full-doc context stuffing. Don't build a vector DB expecting to mirror existing behavior — mirror the "load knowledge_docs → concat into prompt" flow first.
2. **Hanna thread-fetch branch is DISABLED.** `Search Gmail Threads (Hanna)` and `Get Thread (Hanna)` are off. Hanna-routed leads currently can't get a real thread → likely produce empty/degraded context. The draft-save Hanna node IS enabled. The Python port should either fully support Hanna's mailbox or consolidate to one mailbox.
3. **`Skip Seen Messages` (cross-run dedupe) is DISABLED.** Without it, the same unsure lead can be re-processed every run → duplicate drafts + duplicate analysis rows. The Python port **must implement idempotency** (dedupKey = `leadEmail|threadId|lastMessageId`, persisted).
4. **Schedule trigger DISABLED; webhook active.** "Hourly" is the intent but it currently runs on demand via webhook. Python port should schedule hourly.
5. **Dead config vars:** `hermesBaseUrl` (`CHANGE-ME...`) and `hermesModel` (`hermes3`) are unused. Real model is `hermes` via the LiteLLM credential. Don't propagate the placeholders.
6. **Drafts only, never send.** The workflow deliberately creates Gmail **drafts** for human review. Preserve this — do not auto-send.
7. **`Send From` routing is brittle:** any value containing `hanna` → Hanna; everything else (incl. blank) → info@. Many header-case variants are tried. Normalize on a real `send_from` column in Postgres.
8. **Email regex** (reused in two nodes): `/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/`.
9. **`combineAll` merge** cross-joins the single knowledge blob onto every lead. Trivial in Python (just pass the same string).
10. **Bilingual output (EN/DE)** is driven by the language of the detected unsure section. The model decides language; keep prompt verbatim.
11. **Model output must be strict JSON** with keys `subject, unsureSection, unsureSignal, unsureArea, areaExplanation, draftReply, citations`. The parser tolerates code fences and surrounding prose by slicing `{...}` — replicate that leniency.
12. **`unsureArea` is a closed enum:** `Finance`, `Operation`, `Organization`, `Legality`, `Reference - Past Projects/Wins`. Validate against this set.
13. Stale `pinData` for a non-existent "Email Received" node — ignore entirely (not part of logic).

---

## Suggested Python architecture (mirror the other agents: domain / clients / db / pipeline)

```
rag_agent/                      # (a.k.a. "unsure-lead responder")
├── domain/
│   ├── models.py               # Lead, ThreadMessage, ThreadContext, UnsureAnalysis,
│   │                           #   ModelOutput(subject, unsureSection, unsureSignal,
│   │                           #   unsureArea[enum], areaExplanation, draftReply, citations)
│   ├── enums.py                # UnsureArea = {Finance, Operation, Organization,
│   │                           #   Legality, Reference - Past Projects/Wins}; Inbox = {HANNA, INFO}
│   └── prompts.py              # SYSTEM_PROMPT_TEMPLATE + USER_PROMPT_TEMPLATE (verbatim, with knowledge/thread slots)
├── clients/
│   ├── litellm_client.py       # OpenAI-compatible client → LiteLLM (model="hermes", temp=0.2,
│   │                           #   json mode). Wraps Parse-Hermes-Reply JSON leniency.
│   ├── gmail_client.py         # search_threads(from:lead), get_thread, create_draft(inbox, to, subject, body).
│   │                           #   Two mailboxes: info@ and Hanna. Build labeled transcript (last 20 msgs, body cap 2000).
│   └── (no drive/sheets clients — replaced by db layer)
├── db/
│   ├── repo.py                 # Postgres/Supabase repo:
│   │                           #   - list_campaigns()
│   │                           #   - get_unsure_leads(campaign_id)        ← leads table, status='unsure', dedupe by email
│   │                           #   - load_knowledge_doc()                 ← knowledge_docs (concat, cap 150k)
│   │                           #   - insert_unsure_analysis(row)          ← unsure_analysis table
│   │                           #   - seen_dedupkey(key)/mark_seen(key)    ← idempotency (replaces removeDuplicates)
│   └── schema.sql              # campaigns, leads, knowledge_docs, unsure_analysis
├── pipeline/
│   ├── extract.py              # Extract Unsure Leads logic (filter, email regex, dedupe, inbox routing).
│   ├── thread_context.py       # Build Thread Context logic (sort, last-20, label, body cap, dedupKey, drop no-lead).
│   ├── grounding.py            # load + HTML-strip + 150k cap of knowledge doc (HTML to Text logic).
│   ├── llm.py                  # build prompts → call litellm → parse → ModelOutput.
│   └── run.py                  # orchestrator: for each campaign → unsure leads (cap 10) →
│                               #   per lead: fetch thread → skip if seen → ground → LLM →
│                               #   create draft (route by inbox) → insert unsure_analysis → mark_seen.
├── config.py                   # campaigns source, mailboxes, LiteLLM base/key, model="hermes",
│                               #   per-run cap=10, thread msg cap=20, body cap=2000, knowledge cap=150000.
└── entrypoint.py               # hourly schedule (cron) + optional manual trigger.
```

**Port priorities:**
1. Replace all Drive/Sheets I/O with the Postgres repo (`campaigns`, `leads`, `knowledge_docs`, `unsure_analysis`).
2. Keep Gmail draft creation (two mailboxes) and the verbatim prompt.
3. **Add the idempotency layer that's disabled in n8n** (dedupKey persistence) — critical to avoid duplicate drafts.
4. Keep "draft only, never send" as a hard invariant.
5. Treat real RAG (pgvector + embeddings) as a later optional upgrade, not part of the faithful port.
```
