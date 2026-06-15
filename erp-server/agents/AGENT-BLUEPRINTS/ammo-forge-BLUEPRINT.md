# AMMO FORGE — Python Port Blueprint

Source: n8n workflow `WfBtXiyyFq8Ktr9P` ("EVERTRUST - AMMO FORGE"), project REACH ARSENAL.
Purpose (from workflow description): *per valid campaign folder it fetches config, researches macro
world-event demand drivers via OpenAI web search, uploads a news-info doc, then runs the template-forge gate.*

This is the **producer** of the `news-info` doc that REACH BAZOOKA reads to pick its aggressive
`COLD-AGG` variant. In the Python port, Ammo Forge will WRITE the `news_intel` table
(`campaign_id`, `body`, `is_bad_news`). The bad-news contract is section 5 — that is the load-bearing part.

---

## 1. Purpose & flow (node-by-node, every branch)

Three trigger paths fan into a single `SplitInBatches` loop ("Folder Loop", batchSize=1, sequential),
which drives one IF tree per campaign folder.

**Trigger fan-in → loop entry:**
- **A. Webhook** `POST /webhook/wf4-ammo-forge` → `Parse Webhook Body` → `Webhook: has folder?` (IF).
  - has folder (true) → `Count Folders` → `Folder Loop`.
  - no folder (false) → `List All Campaign Folders` (full scan).
- **B. Drive Trigger** `On New Folder (Drive Poll)` (**DISABLED**) → `Inspect Drive Item` → `Count Folders` → `Folder Loop`.
- **C. Manual** `Manual Scan All Folders` → `List All Campaign Folders` → `Inspect Drive Item` → `Count Folders` → `Folder Loop`.

**Per-folder pipeline (Folder Loop output 1 = "loop" branch → `Valid Payload?`):**
1. `Valid Payload?` (IF `$json.isValid === true`).
   - false → `Code — Build Invalid Payload Msg` → `WA — Invalid Payload Alert` (WhatsApp) → back to `Folder Loop`.
   - true → `Search config.json in Folder`.
2. `Search config.json in Folder` (Drive query for `config.json`/`config` in folder).
3. `Fetch config.json (HTTP)` (Drive `?alt=media` download as text).
4. `Parse Config (News)` (parse config, derive niche/city/country/project/lang).
5. `Research Niche News` (LangChain OpenAI, model `hermes`, **web search tool**) — demand-driver news research.
6. `Build News Doc` (classify items, compute `isBadNews`, render the news-info text). **← bad-news contract.**
7. `Upload News-Info Doc` (Drive `createFromText`, name `news-info`, convert to Google Doc, into campaign folder).
8. `Search Template in Folder` (Drive query for existing `template`/`templates`(.doc/.docx)).
9. `Decide: Should Forge?` (Code: `shouldForge = !hasTemplate`).
10. `Should Forge?` (IF `$json.shouldForge === true`).
    - false → `Code — Log Skip Existing` → back to `Folder Loop` (idempotent skip; template already exists).
    - true → **template-forge gate** (see §7): `Explode Blocks` → `Generate Doc Content` →
      `Parse LLM Responses` → `Merge To Single Doc` → `Upload Template Doc` → back to `Folder Loop`.

**Loop completion:** `Folder Loop` output 0 ("done" branch) → `Final Counter Log` (logs total processed).

**Error path:** `On Workflow Error` (errorTrigger) → `Config Error Globals` (Set) →
`Code — Format Forge Error` → `WA — Forge Error Alert` (WhatsApp to manager).

NOTE: the news-research → news-doc → template-forge are all in series inside ONE per-folder pass.
The news doc is always written; the template doc is only written when no template exists yet.

---

## 2. Trigger(s) / cadence

- **A. Webhook** — `n8n-nodes-base.webhook` v2.1, `POST /webhook/wf4-ammo-forge`, responds `received`.
  URL-only auth (the old `X-Forge-Secret`/`$env.WF4_FORGE_SECRET` check was **removed** — see code comment;
  it crashed on n8n Cloud because `$env` is blocked in Code nodes). No secret enforced now.
- **B. Drive poll** — `On New Folder (Drive Poll)`, `googleDriveTrigger`, `everyMinute`, event `folderCreated`,
  watching folder `1Keop0NUWo3dX7LsaqTwhJcZlAFGP7wId` ("Evertrust Campaigns"). **`disabled: true`** — not active.
- **C. Manual** — `Manual Scan All Folders` (manualTrigger); scans every child folder of Evertrust Campaigns.

`triggerCount: 1` and workflow `active: true`. **For the Python port the effective cadence is event/manual:**
the webhook (called by an upstream campaign-creator) and the manual full-scan are the live entrypoints; the
1-minute Drive poll exists but is disabled. There is no cron/schedule trigger. A Python port should expose:
(a) a single-folder/single-campaign entrypoint, and (b) a "scan all campaigns" batch entrypoint.

---

## 3. Campaign iteration & per-campaign config

**Campaign root folder:** `1Keop0NUWo3dX7LsaqTwhJcZlAFGP7wId` ("Evertrust Campaigns" in My Drive).
A "campaign" = a child folder of that root. Valid folders are found via:
- `List All Campaign Folders`: Drive query
  `'1Keop0NUWo3dX7LsaqTwhJcZlAFGP7wId' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
  fields `id,name,mimeType`, returnAll.
- `Inspect Drive Item` maps each folder → `{campaignFolderId:id, project:name, niche:'', city:'', source:'drive', isValid:!!id}`.

**Per-campaign config file:** searched in the campaign folder with
`'<folderId>' in parents and (name = 'config.json' or name = 'config') and trashed = false`,
then downloaded via HTTP `https://www.googleapis.com/drive/v3/files/<id>?alt=media` (responseFormat text)
and `JSON.parse`d.

**config.json fields read** (across `Parse Config (News)` and `Explode Blocks`):
- `niche` (required-ish; fallbacks: webhook `niche`, then `'CONTAINER'` in forge).
- `city` (fallback webhook `city`, then `'Berlin'` in forge).
- `country` (drives language: `de`/`germany`/`deutschland` → German else English).
- `project` (fallback webhook `project`/`name`, then `'Unknown Campaign'`).
- `target`, `gmailLabel` (only used in `Explode Blocks` for the `hasConfigKeys` presence check; not otherwise consumed here).

`Explode Blocks` treats config as "missing" (`configMissing=true`) and falls back to trigger/defaults
if none of `[niche,country,city,project,target,gmailLabel]` are present.

Webhook body fields parsed (`Parse Webhook Body`): `campaignFolderId` (or `folderId`), `niche`, `city`,
`project` (or `name`), plus generated `runId = 'wf4-wh-'+<UTC timestamp 14 digits>`. Drive/scan runIds:
`wf4-drv-<ts>` (suffixed `-i` when multiple).

---

## 4. Demand-driver news research (the OpenAI "web search" step)

Node: **`Research Niche News`**, type `@n8n/n8n-nodes-langchain.openAi` v2.3.
- **Model:** `hermes` (`modelId.value = "hermes"`, cachedResultName "HERMES").
- **Credential:** `openAiApi` id `2YgDmy9NuLHvOgzJ` named **"LiteLLM Gateway (mac-mini)"**.
- **IMPORTANT:** despite the description saying "OpenAI web search", this is **NOT real OpenAI** — it routes
  through the **local LiteLLM gateway on the mac-mini**, model `hermes` (local hermes3). The node has
  `builtInTools.webSearch.searchContextSize = "high"` and `options.maxToolCalls = 5`, i.e. it *requests* the
  OpenAI Responses-API web-search tool — but whether the LiteLLM/hermes backend actually performs web search
  is gateway-dependent and unreliable. **In the Python port: treat the "web search" as best-effort / likely
  non-functional through LiteLLM; the code defends against empty results.**
- Output is expected as **raw JSON** (`{news:[...], hooks:[...], confidence:N}`); `Build News Doc` parses it
  defensively (handles Responses-API `output[].content[].text`, fenced code blocks, brace-slicing).

### SYSTEM prompt (VERBATIM)
```
You are a market-intelligence researcher for Evertrust GmbH (a German company that recruits EU suppliers into GERMAN public tenders). Use web search to find RECENT, real, citable BAD NEWS — conflicts, geopolitical tensions, breaches, cyberattacks, disasters, accidents, failures, sabotage, regulatory crackdowns, shortages, or crises, ANYWHERE in the world — that create PRESSURE or URGENCY which increases GERMAN public-sector demand or procurement (federal, state, KRITIS) for a given niche. The event may occur in any country; what matters is that it drives GERMAN demand. Make the causal chain explicit and END it in Germany: bad event → pressure on German buyers → more German tender demand for the niche. Do NOT return tender listings or positive PR. Label each item's sentiment and severity. Return raw JSON only — no prose, no code fences.
```

### USER prompt (VERBATIM — n8n expression, `{{ }}` are interpolated fields)
```
OUTPUT LANGUAGE: Write EVERY output value — each item's headline, summary and whyItMatters, and every entry in "hooks" — in {{ $json.lang }}. German ONLY when the supplier country is Germany; otherwise English. Keep the JSON keys in English and translate only the values. Do NOT emit raw "A -> B -> C" arrow chains in the hooks — write each hook as one natural sentence in {{ $json.lang }}.

Find recent BAD NEWS (last ~90 days) — conflicts, tensions, breaches, attacks, disasters, failures, or crises — that put pressure on buyers and increase demand or government procurement for this niche. The worse and more urgent, the stronger the hook.
Niche: {{ $json.niche }}
Region context: {{ $json.city }}, {{ $json.country }}
Pattern (illustrative — use REAL searched events): "AI-assisted breach of nine Mexican government agencies exposed 100M+ records → public-sector buyers pressured to close cybersecurity gaps → accelerated cybersecurity procurement." i.e. [bad event] → [pressure] → [more demand for {{ $json.niche }}].
Prioritise threats/incidents/tensions relevant to {{ $json.country }}. Avoid positive/PR news and tender listings.
severity = how negative/threatening/urgent the event is (0 = trivial, 1 = severe crisis). Only include genuinely negative events; OMIT anything that isn't bad news.
Find recent BAD NEWS (last ~90 days) — conflicts, tensions, breaches, attacks, disasters, failures, sabotage, or crises, ANYWHERE in the world — that increase pressure on GERMAN public-sector buyers (federal, state, KRITIS) to procure or accelerate spending in this niche. We recruit EU suppliers to qualify for GERMAN public tenders, so the demand we care about is GERMAN — the supplier's own country is only context.

Niche: {{ $json.niche }}
Supplier country (context only): {{ $json.country }}
Tender / demand market: Germany (federal, state, KRITIS)

The causal chain MUST END in Germany:
"AI-assisted breach of nine Mexican government agencies exposed 100M+ records → GERMAN public-sector buyers pressured to close the same gaps → accelerated GERMAN cybersecurity procurement."
i.e. [bad event, anywhere] → [why it pressures GERMAN buyers] → [more GERMAN tender demand for {{ $json.niche }}].

Prefer events German authorities, German media, or EU bodies are reacting to, or that directly threaten Germany. Do NOT anchor on the supplier's country unless the event genuinely drives GERMAN demand. Avoid positive/PR news and tender listings.
Label each item's sentiment ("bad" = threat/negative pressure, "good" = positive, "neutral" otherwise) and severity (0-1, how negative/urgent).
Return RAW JSON only: {"news":[{"headline":"","summary":"the event","whyItMatters":"why it drives GERMAN demand for {{ $json.niche }}","sentiment":"bad|good|neutral","category":"conflict|breach|cyberattack|disaster|accident|failure|regulation|shortage|tension|other","severity":0.0,"source":"","url":"https://...","date":"YYYY-MM-DD"}],"hooks":["urgent hook tying the threat to GERMAN procurement"],"confidence":0.0}
Only real searched items with a URL. Nothing credible -> {"news":[],"hooks":[],"confidence":0}.Only real searched items with a URL. Nothing credible -> {"news":[],"hooks":[],"confidence":0}.
```
(Note: the prompt is internally duplicated/redundant — two "Find recent BAD NEWS" blocks and a doubled final
sentence. Reproduce faithfully or de-dupe in the port; behavior should be equivalent.)

Interpolated fields: `lang` = `'German'` if country ∈ {de, german*, deutschland*} else `'English'`;
`niche`, `city`, `country` from config/meta.

Expected JSON schema returned per item:
`{headline, summary, whyItMatters, sentiment(bad|good|neutral), category, severity(0-1), source, url, date}`,
plus top-level `hooks: string[]` and `confidence: number`.

---

## 5. Bad-news determination — THE BAZOOKA CONTRACT (critical)

Computed in `Build News Doc` (`n8n-nodes-base.code`). Two greppable signals Bazooka uses are BOTH emitted:
`/isBadNews:\s*true/i` (the header flag) and `/[BAD NEWS/` (per-item label `[BAD NEWS ...]`).

**Classification of each news item:**
- A hardcoded `BAD` category set: `conflict, war, tension, breach, cyberattack, attack, hack, sabotage,
  disaster, accident, failure, outage, crisis, shortage, sanction, ban, fine, recall`.
- `classify(n)`: take `n.sentiment` lowercased; if not one of bad/good/neutral, derive:
  `sent = (BAD.has(category) || severity >= 0.5) ? 'bad' : 'neutral'`. `_bad = sent === 'bad'`.
- `allNews` = items with a headline/title, classified, capped at 10. `badNews` = the bad ones, sorted by severity desc.

**The `isBadNews` boolean (header flag):**
```
hasBad     = badNews.length > 0
topSev     = hasBad ? badNews[0]._sev : 0
confidence = allNews.length ? (typeof parsed.confidence === 'number' ? parsed.confidence : 0.6) : 0
isBadNews  = hasBad && topSev >= 0.6 && confidence >= 0.4
requiresEscalation = !hasBad
```
So **`isBadNews` is true only when there is at least one bad item AND top severity ≥ 0.6 AND confidence ≥ 0.4.**

**Per-item flag** via `flagOf(n)`: `'GOOD NEWS'` if sentiment good, `'BAD NEWS'` if bad, else `'NEUTRAL'`.

### EXACT news-info doc FORMAT (verbatim render template)
The doc body is `L.join('\n')` where L is built as:
```
NEWS INTEL — <project>
Niche: <niche> | Location: <city, country>
Generated: <YYYY-MM-DD> | runId: <runId> | isBadNews: <true|false> | topSeverity: <topSev> | confidence: <confidence> | items: <N> (bad: <badCount>)
<blank line>
```
Then, if no items: `⚠ NO NEWS FOUND for this niche/region.`
Else, for each item i (0-based), in order:
```
<i+1>) [<FLAG>[ · <category>][ · sev <severity>]] <headline>
   <summary>                         (only if non-empty)
   -> Why it matters for <niche>: <whyItMatters>   (only if non-empty)
   <source> — <date>                 (only if present)
   <url>                             (only if present)
<blank line>
```
where `<FLAG>` ∈ `GOOD NEWS | BAD NEWS | NEUTRAL`. Example bad line: `1) [BAD NEWS · cyberattack · sev 0.8] <headline>`.
Then if there are hooks:
```
SUGGESTED OUTREACH HOOKS (from BAD news)
• <hook1>
• <hook2>
<blank line>
```
And if there are items but none bad:
```
NOTE: no BAD-news hook → professional template only, no aggressive variant.
```

**Contract summary for the Python port (`news_intel` table):**
- `body` ← the full joined text above (must keep the literal `isBadNews: true` token on line 3 AND the
  `[BAD NEWS ...]` per-item labels — Bazooka greps both `/isBadNews:\s*true/i` and `/[BAD NEWS/`).
- `is_bad_news` ← the boolean `hasBad && topSev >= 0.6 && confidence >= 0.4`.
- `campaign_id` ← `campaignFolderId` (the Drive folder id in n8n; map to your campaign id in the port).

`Build News Doc` also emits structured fields used downstream by the template forge:
`newsDocName:'news-info'`, `newsDocContent`, `newsItemCount`, `badCount`, `newsConfidence`, `severity`,
`isBadNews`, `newsTop`(top bad item object), `newsHooks`, `newsItems`, `requiresEscalation`, plus campaign meta.

---

## 6. News doc output + template-forge gate

- **`Upload News-Info Doc`** — `googleDrive` v3, `createFromText`, content `={{ $json.newsDocContent }}`,
  **name `news-info`** (literal, from `newsDocName`), `driveId` My Drive, `folderId = campaignFolderId`,
  `options.convertToGoogleDocument = true` (so it lands as a **Google Doc** in the campaign folder).
  Filename pattern: always exactly `news-info` (no timestamp/suffix; repeated runs create duplicates).
- **Template-forge gate** — after upload: `Search Template in Folder` looks for an existing template doc
  (`template`/`templates`/`template.doc(x)`/`templates.doc(x)`), then `Decide: Should Forge?` sets
  `shouldForge = !hasTemplate`, and `Should Forge?` (IF) routes:
  - template exists → skip (log) — idempotent, no LLM cost.
  - no template → run the forge chain (§7).

---

## 7. Template forge (what the gate produces)

Produces a single Google Doc named **`template`** in the campaign folder, containing the
`[COLD]` / `[FOLLOWUP]` / `[FINALPUSH]` email sequence (the doc Bazooka later reads to send).

**`Explode Blocks`** (Code) — re-reads config.json, derives niche/country/language, then for each of
`['COLD','FOLLOWUP','FINALPUSH']`:
- starts from a **hand-crafted English master template** (subjects/bodies hardcoded in the node — Hanna Nguyen /
  EVERTRUST GmbH signature), with placeholders resolved: `{{Type}}`→niche, `{{IndustryFocus}}` and
  `{{TenderFocus}}` from per-niche maps (LED, PV/BESS/TRAFO, CONTAINER, CLEANING SERVICE, CHARGING PORT,
  DGUV V3 INSPECTION, WÄRMEPUMPE), and `{{Company}}`→`{{Company Name}}` (left as a placeholder for Bazooka per-lead).
- emits a per-block item with `systemContent` + `userContent` for the LLM.

The LLM's job is **polish-only (English) or translate-to-formal-German (Sie-form)** — NOT rewrite.

#### EN system prompt (VERBATIM)
```
You are an outreach copywriter for Evertrust GmbH, a German company. Below is a hand-crafted outreach template with campaign-specific context already filled in. Your job: polish minor prose issues ONLY. Do NOT rewrite, restructure, change the tone, or remove sentences. KEEP the {{Company Name}} placeholder EXACTLY as written (it will be replaced per-lead later by another workflow). Preserve the exact casing of the niche term wherever it appears (acronyms like LED stay uppercase, common nouns like container stay lowercase). Respond with raw JSON only, no prose, no code fences. JSON shape: { "finalSubject": "...", "finalBody": "...", "confidence": <0.0-1.0>, "reasoning": "one short sentence" }
```
#### DE system prompt (VERBATIM)
```
You are an outreach copywriter for Evertrust GmbH, a German company. Below is a hand-crafted ENGLISH outreach template with campaign-specific context already filled in. Your job: TRANSLATE it into professional German business-email language using the formal Sie-form. Preserve the meaning, structure, and paragraph breaks exactly — do NOT add, remove, reorder, or shorten sentences. KEEP the {{Company Name}} placeholder EXACTLY as written in English (it will be replaced per-lead later by another workflow). Keep product and standard acronyms unchanged (LED, PV, BESS, TRAFO, DGUV V3); the word Wärmepumpe stays German. Translate generic nouns naturally with correct German noun capitalisation. Keep the signature lines Hanna Nguyen and EVERTRUST GmbH unchanged. Respond with raw JSON only, no prose, no code fences. JSON shape: { "finalSubject": "...", "finalBody": "...", "confidence": <0.0-1.0>, "reasoning": "one short sentence" }
```
User content per block = `Stage: <TAG>` + target-language line + niche/city/project/focus lines +
the resolved subject and body + EN/DE instruction list (numbered, verbatim in node).

**`Generate Doc Content`** — `@n8n/n8n-nodes-langchain.openAi` v2.3, model **`deepseek`** (cachedResultName
"DEEPSEEK"), **same LiteLLM Gateway (mac-mini) credential** id `2YgDmy9NuLHvOgzJ`, `temperature 0.2`,
`textFormat type: json_object`. No web search tools here.

**`Parse LLM Responses`** — parses each LLM JSON (`finalSubject`/`finalBody`/`confidence`/`reasoning`);
falls back to the master subject/body if parse fails.

**`Merge To Single Doc`** — concatenates blocks into one doc, format per block:
```
[<TAG>]
Subject: <finalSubject>
Body:
<finalBody>
```
joined by blank lines, in order COLD, FOLLOWUP, FINALPUSH. `docName='template'`.

**`Upload Template Doc`** — Drive `createFromText`, name `template`, convertToGoogleDocument, into campaign folder.

### Aggressive variant — present but DISABLED (important for the port)
`Explode Blocks` contains logic for a `COLD-AGG` aggressive block (the full `AGG_SYSTEM` prompt opening with
the bad-news hook, gated on `newsConfidence >= 0.6` and a `newsTop`). **It is COMMENTED OUT** (the `for (const
aggTag of ['COLD-AGG'])` loop is inside `/* ... */`). `Merge To Single Doc` checks for `COLD-AGG` but it is
never produced. **So Ammo Forge currently produces only the 3 professional blocks; it does NOT generate the
aggressive email.** Bazooka is the component that, at send time, reads `isBadNews` from the news-info doc and
chooses/produces the aggressive `COLD-AGG` variant. In the Python port: Ammo Forge writes the news intel +
the professional template; Bazooka owns the aggressive-variant decision. (The dead AGG prompt is preserved in
the node source if you ever want to move generation into Forge.)

---

## 8. State READ / WRITTEN

**READ (Google Drive):**
- Campaign root folder `1Keop0NUWo3dX7LsaqTwhJcZlAFGP7wId` (list child folders).
- Per campaign: `config.json` (search + HTTP download).
- Per campaign: existing `template`/`templates`(.doc/.docx) (existence check for the gate).

**WRITTEN (Google Drive, into the campaign folder, as Google Docs):**
- `news-info` (always) — the news intel doc. **← maps to `news_intel` table in the port.**
- `template` (only when none exists) — the COLD/FOLLOWUP/FINALPUSH email sequence.

No Sheets, no Data Tables, no DB in this workflow. (`staticData` holds only the Drive-trigger
`lastTimeChecked` — ignored per instructions.)

---

## 9. Credentials, config consumed, error handling

**Credentials:**
- Google Drive OAuth2 — id `7ntqqDsIDCgae66w` ("Google Drive OAuth2 API") — Drive search/download/upload + trigger.
- OpenAI(-compatible) — id `2YgDmy9NuLHvOgzJ` ("**LiteLLM Gateway (mac-mini)**") — used by BOTH LLM nodes
  (news research `hermes`, template forge `deepseek`). Not real OpenAI.
- WhatsApp — id `hfg64imhwFA01Qcb` ("WhatsApp account") — alerting.

**Hardcoded config:** campaign root folder id; manager WhatsApp `84333634500`; senderPhoneNumberId
`1030239273516528`; per-niche IndustryFocus/TenderFocus/body-display maps; the 3 master email templates.

**Error handling:**
- `retryOnFail` on Drive searches, config HTTP fetch, both LLM nodes, template upload; `alwaysOutputData`
  on the folder/template/config searches.
- `Valid Payload?` false → WhatsApp "rejected payload" alert (reason: missing campaignFolderId; note the
  auth-failed branch text exists but auth was removed).
- Global `On Workflow Error` errorTrigger → formats node/message/executionId → WhatsApp "Forge error" alert.
- Defensive JSON parsing everywhere (config, LLM responses). Empty/no-news → doc still written with
  `isBadNews: false` and a `⚠ NO NEWS FOUND` line.

---

## 10. n8n artifacts NOT worth porting

- `SplitInBatches` "Folder Loop" + `Count Folders` / `Final Counter Log` — just sequential iteration +
  logging; replace with a plain Python `for folder in campaigns:` loop.
- Three-trigger fan-in (webhook / drive-poll(disabled) / manual) — collapse to: one "process one campaign"
  function + one "scan all" batch runner.
- `Webhook: has folder?` / `Valid Payload?` / the webhook auth comments — trivial input validation.
- WhatsApp alert nodes (`WA — Invalid Payload Alert`, `WA — Forge Error Alert`, `Config Error Globals`,
  the two "Code — Build/Format ... Msg") — operational alerting; port as logging/optional notification.
- Sticky note(s) — documentation only.
- `Inspect Drive Item` / `Parse Webhook Body` field-normalization shims — fold into your input layer.
- The `?alt=media` HTTP download dance — replace with a direct Drive `files().get_media` (or your storage read).
- The Responses-API/code-fence-tolerant JSON extraction in `Build News Doc`/`Parse LLM Responses` — keep a
  lighter version only if your model still wraps JSON; with a clean API you can `json.loads` directly.
- The commented-out `COLD-AGG` block in `Explode Blocks` — dead code; do not port unless intentionally
  moving aggressive-variant generation into Forge.
