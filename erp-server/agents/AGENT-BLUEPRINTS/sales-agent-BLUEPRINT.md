# Sales Agent — Faithful Blueprint (for Python port)

**Source:** n8n workflow `ACTIVATE - SALES AGENT`, id `sgQ2Nqa8MZgn0wdp`, instance `evertrustgmbh.app.n8n.cloud`, project `REACH ARSENAL`.
**Status when captured:** inactive, versionCounter 188, updated 2026-06-12.
**n8n self-description:** "Analyzes sales meeting transcripts with Hormozi-framed scoring across 4 technique dimensions (rapport building, discovery quality, pain discovery, value communication), generates Google Docs reports, and appends rows to a tracking sheet."

This document is the canonical spec to re-implement the agent as local Python. It records VERBATIM the prompts, rubric, and Code-node logic. Anything touching Google Drive / Docs / Sheets is flagged **→ POSTGRES** for the migration.

---

## 1. Purpose

Given a sales-meeting transcript (primarily from a Read.ai webhook), the agent:
1. Normalizes the transcript into a speaker-labelled, timestamped text block.
2. Validates it (length, speaker turns, salesperson-speech share) and flags low-engagement calls.
3. Loads a **persona doc** (default "Alex Hormozi") to use as the LLM system-message preamble.
4. Runs a single LLM "Sales Coach" pass that scores the call against a hardcoded **Hormozi 4-dimension technique rubric** plus performance/client sub-scores, returning ONE strict JSON object.
5. Parses that JSON defensively in a Code node (NOT via the structured output parser — hermes can't drive it reliably).
6. Renders an HTML **report** (→ Google Doc) and a flat **tracking row** (→ Google Sheet "Meeting Analyses").

There are also two read-only "ERP" service webhooks (list personas, list past meetings) that the EVERTRUST app calls.

---

## 2. Triggers & Inputs

The workflow has **5 triggers** (`triggerCount: 5`). Only the first two feed the scoring pipeline; the rest are utility/legacy.

### 2a. `Read.ai Webhook` (PRIMARY) — `n8n-nodes-base.webhook` v2.1
- Path: `meeting-analysis` (GET-style default; **no responseMode set on this one** — note the duplicate path issue in §11).
- Expected payload shape (`$json.body`):
  ```
  body.transcript.speaker_blocks[]  -> { speaker: { name }, words: string, start_time: ms }
  body.summary                      -> string (optional)
  body.chapter_summaries[]          -> { title, description } (optional)
  body.topics[]                     -> { text } | string (optional)
  body.title | meeting_title | platform_meeting_id | session_id  (optional, for doc name)
  ```
- Flow: `Read.ai Webhook → Adapt Transcript → Prep Transcript Doc → Create Transcript Doc → Tag Transcript Ref → Validate Transcript`.

### 2b. `ERP Analyze Webhook` (PRIMARY, app-driven) — webhook v2.1
- httpMethod `POST`, path `meeting-analysis`, **responseMode `responseNode`**, `onError: continueRegularOutput`.
- Payload (`$json.body`): `{ transcript: { speaker_blocks: [...] }, persona?: string, transcript_doc_id?, needs_doc_fetch?: boolean }`.
- Flow: `ERP Analyze Webhook → Prep ERP Input → ERP Needs Doc Fetch? (IF) → (true) Fetch ERP Transcript Doc → Set ERP chatInput → Validate Transcript | (false) → Validate Transcript`.

### 2c. `On Transcript Submit` — `@n8n/n8n-nodes-langchain.manualChatTrigger` v1.1
- Manual chat test trigger. Reads `$json.chatInput`, `active_persona_name`, `source`. Goes straight to `Validate Transcript`. Used for manual testing only.

### 2d. `ERP Personas Webhook` — webhook v2.1 (read-only service)
- Path `erp-sales-personas`, responseNode. Lists persona docs in the AI Personas Drive folder. **→ POSTGRES (`personas` table).**

### 2e. `ERP Meetings Webhook` — webhook v2.1 (read-only service)
- Path `erp-sales-meetings`, responseNode. Lists past meeting report docs + joins the tracking sheet. **→ POSTGRES (`meeting_analyses` table).**

---

## 3. Node-by-node flow (execution order)

### Scoring pipeline (Read.ai branch)
1. **Read.ai Webhook** — entry.
2. **Adapt Transcript** (Code) — builds `chatInput` text from speaker_blocks + optional Read.ai context. See §6.2.
3. **Prep Transcript Doc** (Code) — builds a multipart/related body to create a Google Doc of the raw transcript. **→ POSTGRES/local file.** See §6.3.
4. **Create Transcript Doc** (HTTP POST to Drive multipart upload) — **→ POSTGRES.** Creates Google Doc; returns `id,name,webViewLink`.
5. **Tag Transcript Ref** (Code) — passes `chatInput` through + attaches `transcript_doc_id`, `transcript_doc_url`. See §6.4.
6. **Validate Transcript** (Code) — the central gate. See §6.1.

### Scoring pipeline (ERP branch)
1. **ERP Analyze Webhook** — entry.
2. **Prep ERP Input** (Code) — flattens speaker_blocks to `"Name: words\n"`, sets `active_persona_name` (default "Alex Hormozi"), `source: "readai"`. See §6.5.
3. **ERP Needs Doc Fetch?** (IF v2.3) — condition `{{ $json.needs_doc_fetch }} is true`. TRUE → fetch doc; FALSE → straight to Validate. See §7.
4. **Fetch ERP Transcript Doc** (HTTP) — Drive export `files/{transcript_doc_id}/export?mimeType=text/plain`, responseFormat text. **→ POSTGRES.**
5. **Set ERP chatInput** (Code) — `chatInput = docText`, `source: "erp"`. See §6.6.

### Shared scoring path (both branches converge at Validate Transcript)
1. **Validate Transcript** (Code) → **Has Valid Transcript?** (IF v2.3, `{{ $json.valid }} is true`).
   - FALSE → **Stub Response** (Set: `output = { error: reason, detail }`) → **Respond Read.ai**.
   - TRUE → **Set Active Persona**.
2. **Set Active Persona** (Set v3.4) — `active_persona_name = {{ $json.active_persona_name || 'Alex Hormozi' }}`.
3. **List Personas** (HTTP) — Drive list of docs in personas folder `1rgInIstdCJ8iPhJQspLWQKRBPsVFbFbx`, `fields=files(id,name)`, pageSize 50. **→ POSTGRES.**
4. **Resolve Persona ID** (Code) — exact → substring → fallback-first match. See §5 / §6.7.
5. **Fetch Persona Text** (HTTP) — Drive export of matched persona doc as text/plain. **→ POSTGRES.**
6. **Sales Coach Agent** (`@n8n/n8n-nodes-langchain.agent` v3.1) — LLM analysis. `hasOutputParser: false`, `maxIterations: 3`. System message = persona text + rubric + strict JSON schema (see §4). User text = `{{ $('Validate Transcript').first().json.agentInput }}`. LLM = **local deep seek** (hermes).
7. **Parse Analysis JSON** (Code) — fence-strip + brace-slice + JSON.parse + required-keys check. See §6.8.
8. **Route ERP vs Doc** (IF v2.3) — `{{ $('Validate Transcript').item.json.source }} == "erp"`, strict. **NOTE the output wiring**: output 0 (TRUE/erp) is **empty** (dead end); output 1 (FALSE) → Render Doc Inputs. So the doc/sheet write path runs only for the non-erp (Read.ai/manual) source. See §7.
9. **Render Doc Inputs** (Code) — builds report HTML (multipart for Drive) + `sheetRow` object. See §6.9. **→ POSTGRES.**
10. **Create Meeting Doc** (HTTP) — creates the report Google Doc. **→ POSTGRES.**
11. **Merge Doc Link** (Code) — assembles ordered sheet row + injects `Doc Link`. See §6.10.
12. **Append Row to Sheet** (`n8n-nodes-base.googleSheets` v4.7, append, autoMapInputData) — appends to "Meeting Analyses" sheet. **→ POSTGRES (`meeting_analyses`).**
13. **Respond Read.ai** (respondToWebhook, allIncomingItems).

### Read-only service webhooks
- **ERP Personas Webhook → List Personas (ERP) (HTTP Drive list) → Format Personas (Code) → Respond Personas (JSON).** Returns `{ folderUrl, personas:[{id,name}] }` sorted by name. **→ POSTGRES.**
- **ERP Meetings Webhook → List Meeting Docs (HTTP Drive list, folder `1YnIWmpBFI5...`, orderBy modifiedTime desc) → Read Meeting Analyses (Sheets read) → Format Meetings (Code) → Respond Meetings (JSON).** Joins Drive docs to sheet rows by doc-id. **→ POSTGRES.** See §6.11.

### Disconnected (legacy / for future qwen)
- **Sales Analysis Schema** (`outputParserStructured` v1.3, autoFix) + **local deep seek1** (hermes lmChatOpenAi). These are wired to each other (`local deep seek1 → Sales Analysis Schema` ai_languageModel) but the parser is **NOT** attached to the agent (agent has `hasOutputParser: false`). Left in place to reattach when qwen is hosted. Do not port yet.

---

## 4. VERBATIM: Sales Coach Agent system message & rubric

The Agent node `Sales Coach Agent` system message is an n8n expression concatenating: `$json.data` (the fetched persona text) + the guide + the strict output format. Reproduced verbatim below (the `{{ }}` resolves `$json.data` to the persona doc body).

**System message (after `<persona text>` from `$json.data`):**

```
<persona text from $json.data>

---

## SALES TECHNIQUE ANALYSIS GUIDE

For the sales_technique_analysis section score each dimension 1-10 (10 = Hormozi would clip this for content; 1 = he would cringe). Ground all recommendations in the Hormozi framework.

rapport_building: warmth, mirroring, client name, shared context, human connection established BEFORE pitching.
discovery_quality: open-ended questions, listening before pitching, diagnose before prescribe, question-to-statement ratio.
pain_discovery: cost of inaction, Name the Pain better than the client can, Discover Before Pitching, Do Not Quote Price Until Cost of Status Quo is clear.
value_communication: Specificity Beats Generality (numbers/timelines/outcomes), Show Work Do Not Tell, offer tied directly to the client stated problems.

For EACH dimension output: score (1-10), quotes (array of 1-3 verbatim quotes with timestamps, empty string if no timestamp), improvement_recommendation (ONE specific Hormozi-grounded action for the next call).

## OUTPUT FORMAT (STRICT)
Return ONLY one JSON object. No prose before or after, no markdown code fences, no comments. Use double quotes for every key and string. All scores are numbers. quotes arrays hold 1-3 verbatim transcript quotes with [mm:ss] timestamps. The object must have EXACTLY this structure (example values shown):
{"overall_summary":"x","client_company":"x","ae_name":"x","client_contact":"x","sales_technique_analysis":{"rapport_building":{"score":7,"quotes":[{"text":"x","timestamp":"00:30"}],"improvement_recommendation":"x"},"discovery_quality":{"score":6,"quotes":[{"text":"x","timestamp":"03:15"}],"improvement_recommendation":"x"},"pain_discovery":{"score":5,"quotes":[{"text":"x","timestamp":"07:22"}],"improvement_recommendation":"x"},"value_communication":{"score":8,"quotes":[{"text":"x","timestamp":"12:45"}],"improvement_recommendation":"x"} },"strengths":[{"moment":"x","timestamp":"05:42","why_effective":"x","methodology":{"source":"Hormozi","pattern":"Risk Reversal"} }],"weaknesses":[{"area":"x","timestamp":"12:08","observation":"x","evidence_quote":"x","suggestion":"x","methodology":{"source":"Hormozi","pattern":"Name the Objection"} }],"performance_score":{"overall":{"score":65,"rationale":"x"},"understanding_client_needs":{"score":60,"rationale":"x"},"communication":{"score":75,"rationale":"x"},"technical_explanation":{"score":70,"rationale":"x"},"aggressiveness":{"score":40,"rationale":"x"} },"client_analysis":{"overall":{"score":55,"rationale":"x"},"buying_intent":{"score":50,"rationale":"x"},"interest":{"score":65,"rationale":"x"},"communication":{"score":70,"rationale":"x"} } }
```

**User message (agent `text`):** `{{ $('Validate Transcript').first().json.agentInput }}` — i.e. the validated transcript, optionally prefixed with the low-engagement context line (see §6.1).

**Output JSON contract (required top-level keys checked by parser):** `overall_summary`, `sales_technique_analysis`, `performance_score`, `client_analysis`. Other keys present in schema: `client_company`, `ae_name`, `client_contact`, `strengths[]`, `weaknesses[]`.
- `sales_technique_analysis.{rapport_building,discovery_quality,pain_discovery,value_communication}` each: `{score:1-10, quotes:[{text,timestamp}], improvement_recommendation}`.
- `performance_score.{overall,understanding_client_needs,communication,technical_explanation,aggressiveness}` each `{score:0-100, rationale}`.
- `client_analysis.{overall,buying_intent,interest,communication}` each `{score:0-100, rationale}`.
- `strengths[]`: `{moment, timestamp, why_effective, methodology:{source,pattern}}`.
- `weaknesses[]`: `{area, timestamp, observation, evidence_quote, suggestion, methodology:{source,pattern}}`.

> **KNOWN ISSUE:** The 4-dimension rubric and the `methodology.source:"Hormozi"` examples are **hardcoded to Hormozi regardless of which persona is loaded.** The persona doc only contributes the system-message preamble; the rubric is always Hormozi.

---

## 5. Persona resolution

- **Default:** "Alex Hormozi" (set in `Prep ERP Input`, `Set Active Persona`, and `Resolve Persona ID` fallbacks).
- **Source folder (Drive):** `1rgInIstdCJ8iPhJQspLWQKRBPsVFbFbx` ("AI Personas"), Google Docs only, not trashed. **→ POSTGRES `personas` table.**
- **Resolution algorithm** (`Resolve Persona ID`): normalize = lowercase+trim.
  1. **exact** name match → use it (`match_type: "exact"`).
  2. else **substring** match (`norm(file.name).indexOf(target) !== -1`) → first hit (`match_type: "substring"`).
  3. else if any files exist → **first file** (`match_type: "fallback_first"`).  ← **KNOWN ISSUE: silent fallback to first doc; a typo'd persona name silently scores under the wrong persona.**
  4. else `throw "No persona docs found in AI Personas folder."`
- Output: `{persona_id, persona_name, requested_persona, match_type, export_url}`.
- **Fetch Persona Text** then exports the matched doc to plain text; that text becomes `$json.data` injected at the top of the Agent system message.

---

## 6. Code-node algorithms (full logic)

### 6.1 `Validate Transcript`
Reads `$json.chatInput`, `active_persona_name`, `source`.
- If no/`non-string` text → `{valid:false, reason:"empty_input"}`.
- Trim; word count = split on `/\s+/`, filtered non-empty.
- **Speaker turn parsing:** line regex `^(?:\[\d{2}:\d{2}\]\s*)?([A-Za-z][^:]{0,60}):\s` — optional `[mm:ss]` prefix, then a speaker name (starts alpha, up to 60 non-colon chars), colon, space. Accumulates words per turn; rolls up per-speaker `{turns, words}`.
- Gates (each returns `valid:false`):
  - `wordCount < 100` → `reason:"transcript_too_short"`.
  - `turns.length < 4` → `reason:"too_few_speaker_turns"`.
  - primaryShare (first speaker's word share) `< 0.05` → `reason:"no_salesperson_speech"`.
- **Flags:** if `otherShare < 0.05` push `"low_client_engagement"`.
- **agentInput:** = trimmed transcript; if `low_client_engagement`, prepend verbatim:
  `[CONTEXT: minimal client engagement <5%. buying_intent and interest MUST be below 20.]\n\n`
- Returns `{valid:true, transcript, agentInput, flags, active_persona_name, source, stats:{wordCount,turns,distinctSpeakers,primaryShare,otherShare}}`.

### 6.2 `Adapt Transcript`
Reads `$("Read.ai Webhook").first().json.body`.
- If no `body.transcript.speaker_blocks` array → `{chatInput:"", _readai_error:"missing_transcript"}`.
- Builds optional **context block** (only if summary/chapter_summaries/topics present):
  - Header `========== READ.AI CONTEXT (supporting, not primary) ==========`
  - `# Meeting Summary`, `# Chapter Summaries` (numbered `title` + indented `description`), `# Topics` (`- text`).
  - Then `========== TRANSCRIPT (primary) ==========`.
- **Transcript build:** `segmentStartMs = blocks[0].start_time || 0`. For each block: name = `speaker.name || "Unknown"`, words string, `offsetSec = max(0, floor((start_time - segmentStartMs)/1000))`, format `[mm:ss] Name: words` (mm/ss zero-padded to 2). Joined by `\n`.
- Returns `{chatInput: contextBlock + transcriptText}`.

### 6.3 `Prep Transcript Doc`
- title = `body.title || meeting_title || platform_meeting_id || session_id || "Untitled Meeting"`.
- folderId `1YnIWmpBFI5nT8wrcJrJFmQuVdXQqpryh` (meeting-docs folder). **→ POSTGRES.**
- docName = `title + " Transcript"`; today = `$today` `yyyy-MM-dd`.
- HTML-escapes each line of chatInput into `<p>...</p>`, wraps in `<h1>docName</h1>`, Date line, `<hr>`, body.
- Builds Drive **multipart/related** body, boundary `n8nTranscriptBoundary88`, metadata mimeType `application/vnd.google-apps.document`. Returns `{chatInput, multipartBody, contentType, docName, meetingTitle}`.

### 6.4 `Tag Transcript Ref`
- `chatInput = $("Adapt Transcript").first().json.chatInput`; `docId = $input.first().json.id`; `docUrl = https://docs.google.com/document/d/<id>/edit`. Returns `{chatInput, transcript_doc_id, transcript_doc_url}`.

### 6.5 `Prep ERP Input`
- `body = $input.first().json.body || {}`; flattens `body.transcript.speaker_blocks` to `"<name>: <words>\n"` (no timestamps here).
- Returns `{chatInput: text.trim(), active_persona_name: String(body.persona || "Alex Hormozi"), source: "readai"}`.
  - (Note: `source` is set to `"readai"` here even though this is the ERP webhook; only reset to `"erp"` in `Set ERP chatInput` when a doc fetch happens. See §7 routing implications.)

### 6.6 `Set ERP chatInput`
- `docText = String($input.first().json.data || "")`; persona from `$("Prep ERP Input").first().json.active_persona_name || "Alex Hormozi"`. Returns `{chatInput: docText, active_persona_name, source: "erp"}`.

### 6.7 `Resolve Persona ID` — see §5.

### 6.8 `Parse Analysis JSON` (the critical defensive parser)
```
let text = $input.first().json.output;
if (text && typeof text === "object") return [{ json:{ output:text } }];  // already parsed
text = String(text || "");
let cleaned = text.trim();
// strip markdown fence: /```(?:json)?\s*([\s\S]*?)```/ -> use group 1
const fence = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
if (fence) cleaned = fence[1].trim();
// slice to outermost braces
const start = cleaned.indexOf("{");
const end   = cleaned.lastIndexOf("}");
if (start === -1 || end === -1 || end <= start) throw "Agent returned no JSON object...";
cleaned = cleaned.slice(start, end + 1);
let parsed = JSON.parse(cleaned);   // throws "Agent JSON failed to parse: ..." on error
if (parsed && parsed.output && typeof parsed.output === "object") parsed = parsed.output;  // unwrap {output:{...}}
// required-keys check:
const required = ["overall_summary","sales_technique_analysis","performance_score","client_analysis"];
const missing = required.filter(k => !(k in parsed));
if (missing.length) throw "Agent JSON missing required keys: ...";
return [{ json:{ output: parsed } }];
```
Port this verbatim: fence-strip → outermost-brace slice → JSON.parse → unwrap `output` → required-keys gate. On any failure it throws (no silent recovery). **For the Python port, throwing should route to an `unsure_analysis` table instead of crashing.**

### 6.9 `Render Doc Inputs` (report HTML + sheet row)
Inputs: `agentOutput = $input.first().json.output`; `transcriptData = $("Validate Transcript").first().json`; `personaName = $("Resolve Persona ID").first().json.persona_name || "Hormozi"`.
- Re-derives speakers from transcript via regex `^(?:\[\d{2}:\d{2}\]\s*)?([A-Z][a-zA-Z0-9_\-\s]{0,30}):` (first two distinct) → `firstSpeaker`, `secondSpeaker`.
- `aeName = agentOutput.ae_name || firstSpeaker`; `clientContact = agentOutput.client_contact || secondSpeaker`; `clientCompany = agentOutput.client_company || "Unknown"`.
- `generatedAt = $now.toISO()`, `meetingDate = $today yyyy-MM-dd`.
- Builds **strengths/weaknesses HTML** (numbered, with pattern/source fallback to personaName, quote, timestamp, why/observation/suggestion) AND plain-text versions (`strengthsText`, `weaknessesText`) for the sheet.
- Builds **technique HTML** over dims `[rapport_building, discovery_quality, pain_discovery, value_communication]` with score/10, evidence quotes list, recommendation.
- Builds the full report HTML: `Sales Coach Report — <persona> Lens`, Basic Overview (Persona/AE/Client Contact/Client Company/Word Count/Flags), Executive Summary, Sales Technique Analysis, Performance (overall + 4 sub /100), Client Analysis (overall + 3 sub /100), What Worked, What to Improve, footer `Run: <workflow.id> / <execution.id> · <generatedAt>`.
- docName = `<clientCompany> - <meetingDate> - Sales Coach Report (<persona>)`; folderId `1YnIWmpBFI5...`; multipart boundary `n8nDocBoundary42`. **→ POSTGRES (store report text/bytea).**
- Returns `{multipartBody, contentType, docName, sheetRow:{...}}`. **`sheetRow` keys** (this is the canonical column set the app cares about):
  `Client Name, AE Name, Meeting Date, Summary, Strengths, Weaknesses, Performance Score, Understanding Client Needs, Communication, Technical Explanation, Aggressiveness, Client Score, Client Buying Intent, Client Interest, Client Communication, Persona, Generated At`.

### 6.10 `Merge Doc Link`
- `row = $("Render Doc Inputs").first().json.sheetRow`; `docId = $input.first().json.id`.
- Re-orders into final column order and injects `"Doc Link": https://docs.google.com/document/d/<docId>/edit`. Returns the ordered object (one row).

### 6.11 `Format Meetings` (read service)
- `files = $("List Meeting Docs").first().json.files`; `rows = $("Read Meeting Analyses").all()`.
- `docIdOf(url)` regex `/\/d\/([^\/]+)/` extracts doc id from sheet `Doc Link` to build `rowByDoc` map.
- Filters out files whose name starts with `_Template`. For each meeting doc, joins sheet row by doc id, coerces scores via `num()` (rounds, null if non-finite). Returns `{meetings:[{docId,docName,docUrl,modifiedTime,clientCompany,aeName,meetingDate,summary,strengthsText,weaknessesText,persona,generatedAt,performance:{...},client:{...}}]}`. **→ POSTGRES query over `meeting_analyses`.**

### 6.12 `Format Personas` (read service)
- Maps Drive files to `{id,name}`, sorts by name (`localeCompare`), returns `{folderUrl, personas}`. **→ POSTGRES query over `personas`.**

---

## 7. Routing (IF nodes)

- **ERP Needs Doc Fetch?** (`ERP Needs Doc Fetch?`): `{{ $json.needs_doc_fetch }} is true`. TRUE (output 0) → `Fetch ERP Transcript Doc`; FALSE (output 1) → `Validate Transcript`.
- **Has Valid Transcript?**: `{{ $json.valid }} is true`. TRUE (output 0) → `Set Active Persona` (continue); FALSE (output 1) → `Stub Response` → `Respond Read.ai` (returns `{error, detail}`).
- **Route ERP vs Doc**: `{{ $('Validate Transcript').item.json.source }} == "erp"` (strict string equals). **Output 0 (TRUE = erp) is wired to NOTHING (dead end). Output 1 (FALSE) → `Render Doc Inputs` → Create Doc → Sheet append.**
  - **Implication:** the Google Doc + Sheet write happens only when `source != "erp"`. The ERP-doc-fetch branch (which sets `source:"erp"`) returns the agent JSON to the caller (via the Respond node path through the empty output? — actually output 0 is empty, so an erp-doc-fetch run terminates with no response node). The Read.ai/manual path (`source` ends up `"readai"`/null) writes the doc+sheet then responds. **For the Python port, treat `source` as the branch selector: `erp` = return JSON only; otherwise = persist report + analyses row + return.** Verify intended ERP-doc behavior with the user; the dead-end output 0 looks like a wiring bug.

---

## 8. Data reads & writes (Drive/Docs/Sheets → Postgres flags)

| n8n resource | ID / path | Operation | Migration target |
|---|---|---|---|
| AI Personas folder | Drive folder `1rgInIstdCJ8iPhJQspLWQKRBPsVFbFbx` | list + export text | **`personas` table** (name, body text) |
| Meeting docs folder | Drive folder `1YnIWmpBFI5nT8wrcJrJFmQuVdXQqpryh` | create transcript doc, create report doc, list | **local file or Postgres** (transcript text); report → **`meeting_analyses.report` (text/bytea)** |
| Meeting Analyses sheet | Sheet `1PUAPc6r8FdxXjQ_ZWWoEGXRBdrEbGpZf-jY9sEwu2_o`, tab `Sheet1` | append + read | **`meeting_analyses` table** |
| LLM | LiteLLM gateway (OpenAI-compatible) | chat completion | unchanged (LiteLLM, model `hermes`, qwen planned) |

No Postgres/ERP write target exists in the current n8n workflow — all persistence is Drive/Sheets today. The "ERP" naming refers only to the EVERTRUST app calling these webhooks.

---

## 9. Credentials

| Credential name | Type | n8n id | Used by | Migration |
|---|---|---|---|---|
| Google Drive OAuth2 API | `googleDriveOAuth2Api` | `7ntqqDsIDCgae66w` | all Drive HTTP nodes | drop (→ Postgres) |
| Google Sheets OAuth2 API | `googleSheetsOAuth2Api` | `nVxTVzA6qeIhESvH` | Append Row, Read Meeting Analyses | drop (→ Postgres) |
| LiteLLM Gateway (mac-mini) | `openAiApi` | `2YgDmy9NuLHvOgzJ` | local deep seek, local deep seek1 | keep (LiteLLM base URL + key) |

### LLM config (`local deep seek`, the active model)
- Node type `@n8n/n8n-nodes-langchain.lmChatOpenAi` v1.3, model `hermes` (cachedResultName "HERMES").
- `temperature: 0.2`, `maxTokens: 8000`, `timeout: 180000` ms (180s), `maxRetries: 2`, `responsesApiEnabled: false` (standard chat-completions).
- `local deep seek1` (disconnected, for structured parser): same but `temperature: 0.1`. Reserve for qwen.

---

## 10. Workflow settings
- `executionOrder: v1`, `availableInMCP: true`, `binaryMode: separate`. `aiBuilderAssisted: true`.

---

## 11. Known issues & gotchas (port these forward)

1. **Rubric is hardcoded to Hormozi** regardless of loaded persona — persona only seeds the system-message preamble; the 4-dimension rubric + `methodology.source:"Hormozi"` are always Hormozi. If multi-persona rubrics are desired, the rubric must move into the persona record.
2. **`Resolve Persona ID` silently falls back to the first doc** when no exact/substring match — a typo silently scores under the wrong persona. Port should fail loudly or log `match_type` and surface `fallback_first`.
3. **Tracking sheet has duplicate / mismatched columns.** The Sheets node schema lists BOTH `Performance Score (overall)` and `Performance Score`, both ` Client Score (overall)` (leading space) and `Client Score`, includes `Client Buying Intent` but the schema array is missing a clean 1:1 mapping; `Render Doc Inputs`/`Merge Doc Link` emit `Performance Score`, `Client Score`, `Client Buying Intent` (no "(overall)" suffix, no leading space). autoMapInputData + `handlingExtraData: insertInNewColumn` means mismatched headers spawn new columns. **The Postgres `meeting_analyses` schema should use the clean column set from `Merge Doc Link` (§6.10 + Doc Link) and ignore the sheet's legacy duplicates.**
4. **`Sales Analysis Schema` + `local deep seek1` are DISCONNECTED** from the agent (agent `hasOutputParser:false`); JSON is parsed by the `Parse Analysis JSON` Code node because hermes can't reliably drive the structured-output parser. Reattach the structured parser only when qwen is hosted.
5. **Two webhooks share path `meeting-analysis`** (`Read.ai Webhook` and `ERP Analyze Webhook`) — collision risk; the ERP one is POST + responseNode, the Read.ai one is default. Verify which actually fires in prod.
6. **`Route ERP vs Doc` TRUE output (erp) is a dead end** — an ERP-doc-fetch run produces no response node and never writes. Likely a wiring bug; confirm intended behavior.
7. **Parser throws hard** on bad LLM output. In Python, catch and route to `unsure_analysis` rather than failing the request.
8. **Webhook data lives at `$json.body`** — preserve that in the Python request models.
9. `Prep ERP Input` sets `source:"readai"` even on the ERP webhook; only `Set ERP chatInput` (doc-fetch branch) sets `"erp"`. So a no-doc-fetch ERP call flows through the doc+sheet write path (source != "erp"). Verify this is intended.

---

## 12. Suggested Python architecture (match the other agents: domain / clients / db / pipeline)

```
sales_agent/
  domain/
    models.py          # ReadAiWebhook, SpeakerBlock, ValidationResult, AnalysisResult (pydantic);
                       #   the strict LLM JSON schema (§4) as a pydantic model with the 4 technique dims,
                       #   performance_score (5 sub), client_analysis (4 sub), strengths[], weaknesses[].
    rubric.py          # VERBATIM Hormozi guide + STRICT output-format string (§4). Keep persona-agnostic
                       #   for now; leave a hook to source rubric from persona record later (issue #1).
    transcript.py      # validate_transcript() (§6.1), adapt_readai() (§6.2), flatten_erp() (§6.5),
                       #   speaker-turn regexes verbatim, low-engagement flag + context-prefix line.
  clients/
    llm.py             # OpenAI-compatible client -> LiteLLM gateway base_url; model "hermes" (qwen swap),
                       #   temperature 0.2, max_tokens 8000, timeout 180s, max_retries 2.
    parse.py           # parse_analysis_json() VERBATIM port of §6.8 (fence regex, brace slice,
                       #   json.loads, unwrap output, required-keys gate) -> raises -> caller routes to unsure.
  db/
    repo.py            # personas (get_by_name w/ exact->substring->NO silent fallback, surface match_type),
                       #   meeting_analyses (insert row = clean §6.10 column set + report text/bytea),
                       #   unsure_analysis (insert on parse failure), list_meetings (Format Meetings join, §6.11),
                       #   list_personas (§6.12). Supabase Postgres.
    schema notes       # personas(name, body), meeting_analyses(client_name, ae_name, meeting_date, summary,
                       #   strengths, weaknesses, performance_score, understanding_client_needs, communication,
                       #   technical_explanation, aggressiveness, client_score, client_buying_intent,
                       #   client_interest, client_communication, persona, report (text/bytea),
                       #   generated_at, run/execution ids). knowledge_docs reserved.
  pipeline/
    score.py           # orchestrate: adapt -> validate -> (gate) -> resolve persona -> build system msg
                       #   (persona body + rubric) -> LLM -> parse -> render report -> persist meeting_analyses.
    render.py          # report HTML/markdown builder (§6.9) -> store as report text; build the analyses row.
    routing.py         # source == "erp" => return JSON only; else persist + return (§7). Resolve the
                       #   dead-end/erp ambiguity with the user before finalizing.
  api/
    app.py             # FastAPI: POST /meeting-analysis (Read.ai + ERP shapes via $body),
                       #   GET /erp-sales-personas (list personas), GET /erp-sales-meetings (list meetings).
```

Port order recommendation: `transcript.py` + `parse.py` (deterministic, fully specified) → `llm.py` → `repo.py` (Supabase) → `render.py` → `routing.py`/`api`. The two read-only service webhooks (personas, meetings) are pure DB queries and are the easiest first slice.
