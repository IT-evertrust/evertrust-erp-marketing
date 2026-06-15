# ContractMaker v2 (Multi-Meeting) — Port Blueprint

n8n workflow: `EVERTRUST — ContractMaker v2 (Multi-Meeting)` (id `ojHoD5ef3lG15YSi`, active).
Purpose: ingest Read.ai post-meeting data, log every meeting to a Google Sheet, ping a CRM
sync workflow, detect when a cooperation contract was *agreed to be signed*, then resolve the
right campaign template+folder from Drive `config.json` files and generate a filled contract PDF.

This document describes ONLY `nodes` + `connections`. `staticData` is intentionally ignored.

---

## 1. Purpose & flow (node-by-node)

There are TWO entry points feeding a single linear pipeline. They converge at **Signal Extractor**.

### Entry A — Production (Read.ai)
1. **Read.ai Webhook** (`n8n-nodes-base.webhook`, v2.1) — `POST /webhook/readai-contract-v2`.
   webhookId `ef48a495-66cd-4d69-9565-637642e1157d`. No auth configured.
2. **Adapt Meeting Text** (Code) — flattens the Read.ai JSON body into a single `text` string
   plus `title`, `sourceDoc`, `meetingId`. (See §2 for exact fields consumed.)
3. → **Signal Extractor**.

### Entry B — Manual test
1. **Run Manually** (manualTrigger).
2. **Sample Meetings** (Code) — emits a hardcoded fake meeting (Baltic Boxes Sp. z o.o., Poland,
   Container niche, "AGREED TO SIGN"). Fields: `sourceDoc`, `title`, `text`.
3. → **Signal Extractor**.

### Shared pipeline
4. **Signal Extractor** (`@n8n/langchain.informationExtractor` v1.2, `retryOnFail:true`) — LLM
   classifies the meeting (company/country/niche + signing-now boolean). Model: **Signal Model**.
5. **Build Log Row** (Code, runOnceForEachItem) — assembles one flat log row. Computes `companyKey`
   (normalized company name), `signNow` ("YES" or ""), `meetingId`, `meetingDate`, truncates
   transcript to 45k chars, sets `processed:''`.
6. **Append Log** (Google Sheets, append, autoMapInputData) — appends the row to the meeting-log
   sheet (§3). Fan-out: its single output connects to TWO nodes.
   - 6a. **Ping CRM Sync** (HTTP POST, `onError:continueRegularOutput`) — fire-and-forget CRM call (§4).
   - 6b. **Gate: Signing** (Filter v2.2) — passes item ONLY if `signNow === "YES"`.
7. **Read Company Log** (Google Sheets, read with filter `companyKey == {{ $json.companyKey }}`) —
   pulls back ALL rows for that company (multi-meeting history).
8. **Check & Aggregate** (Code, runOnceForAllItems) — idempotency + aggregation:
   - returns `[]` (halts) if no rows, OR if any row already has `processed == "YES"`.
   - concatenates all transcripts into `aggregateText` (cap 120k chars) with `=== date | title ===`
     headers; resolves `niche`/`country` (prefers rows where signNow is YES/TRUE).
9. **Deal Extractor** (`informationExtractor` v1.2, `retryOnFail:true`) — LLM extracts the partner's
   legal identity from the aggregated transcripts. Model: **Deal Model**. (§5/§7.)
10. **Search Configs** (HTTP, Drive v3, `retryOnFail:true`) — lists all Drive files named `config.json`.
11. **Explode Configs** (Code) — maps each found file → `{configId, folderId(=parents[0])}`.
12. **Download Config** (HTTP, Drive `?alt=media`, `retryOnFail`, `onError:continueRegularOutput`) —
    downloads each config.json body.
13. **Match Campaign** (Code) — matches meeting niche+country against config niche+country → chosen
    `campaignFolderId` (§6).
14. **Build Fields** (Code, runOnceForEachItem) — builds the full template-merge field set, applies
    grounding guard against fabricated values, picks language (DE/EN), template name (§7).
15. **Resolve Template** (HTTP, Drive search by name + mimeType=google-apps.document, `retryOnFail`,
    `onError:continueRegularOutput`) — finds the Google Doc template.
16. **Pick Template** (Code) — selects the matching doc id (falls back to first result).
17. **Copy Template** (Google Drive copy, `retryOnFail`) — copies template Doc into `campaignFolderId`,
    named `{{ fileBase }}`.
18. **Fill** (Google Docs update, `retryOnFail`, `onError:continueRegularOutput`) — 20 `replaceAll`
    placeholder substitutions in the copied Doc (§7).
19. **Export PDF** (Google Drive download, `retryOnFail`) — exports the copied Doc as PDF
    (`docsToFormat: application/pdf`), filename `{{ fileBase }}.pdf`, binary prop `data`.
20. **Save PDF** (Google Drive upload, `retryOnFail`) — uploads the PDF binary into `campaignFolderId`.
21. **Build Marker** (Code) — builds a synthetic log row with `processed:"YES"`, `meetingId:"GENERATED"`,
    `title:"(contract generated)"`.
22. **Mark Processed** (Google Sheets append) — writes the marker row → future runs short-circuit at
    step 8 (idempotency).

---

## 2. Triggers + Read.ai inbound payload

- **Webhook path:** `POST https://evertrustgmbh.app.n8n.cloud/webhook/readai-contract-v2`.
- **No schedule** — purely event-driven (plus the manual test trigger).
- **Payload shape consumed** (read in `Adapt Meeting Text` from `$json.body`):
  - `body.title` — meeting title (string).
  - `body.summary` — meeting summary (string).
  - `body.chapter_summaries` — array of `{ title, description }`.
  - `body.transcript.speaker_blocks` — array of `{ speaker: { name }, words: string }`.
  - `body.session_id` — Read.ai meeting id (→ `meetingId`).
- Adapter output `text` is a single markdown blob:
  `Meeting title: …` + `# Summary …` + `# Chapters\n- title: description` + `# Transcript\n Name: words`.
- NOTE: `Build Log Row` also tries to read `$('Read.ai Webhook').item.json.body` for `session_id`/`title`
  directly (wrapped in try/catch), so on the manual path those fall back to `Sample Meetings` values.

---

## 3. Meeting logging (Google Sheet "CM Meeting Log")

- **Spreadsheet ID:** `1IHtYVDvogVe0pth3hsHhpGHxcSknThRTX8C4vXEcO9A`, **tab `Sheet1`**.
- Written via `Append Log` (and `Mark Processed`); read via `Read Company Log`.
- **Columns** (autoMapInputData = JSON keys from Build Log Row / Build Marker):
  `companyKey, companyName, country, niche, meetingId, meetingDate, title, transcript,
   signNow, meetingOutcome, cooperationTerm, processed`.
- `companyKey` = normalized company name (lowercased, accents stripped, legal-form tokens
  `sp. z o.o.`/`gmbh` removed, non-alphanumerics stripped); falls back to normalized title.
- `signNow` = `"YES"` or `""`. `processed` = `""` on log rows, `"YES"` on the generated-contract marker.

---

## 4. CRM ping

- **Node:** `Ping CRM Sync` — HTTP `POST https://evertrustgmbh.app.n8n.cloud/webhook/crm-customer`.
- **Payload:** NONE explicitly configured (no body params set). n8n HTTP Request with no body sends an
  empty POST — so the CRM workflow effectively just receives a trigger ping, not meeting data.
  (If the port must carry data, this is where to add the log-row JSON as the body.)
- `onError: continueRegularOutput` — failures are swallowed; it never blocks the pipeline.
- Runs for EVERY meeting (it is on the Append Log fan-out, before the signing gate).

---

## 5. Signing detection (LLM over transcript)

Detection is an LLM classification in **Signal Extractor**, NOT a keyword match. The boolean
`contractSigningMentioned` is mapped by `Build Log Row` to `signNow="YES"`, and the **Gate: Signing**
Filter (`signNow == "YES"`) is the hard gate that allows contract generation.

- **Node type:** `@n8n/n8n-nodes-langchain.informationExtractor` v1.2.
- **Model:** `gpt-5-mini` (Signal Model, OpenAI, credential `OpenAI account 2` id `ueRt2skL94DirL6P`,
  timeout 120000ms).
- **Input text:** `{{ $json.text }}` (the adapted meeting blob).
- **Schema (jsonSchemaExample):**
  `{ "companyName": "Baltic Boxes", "country": "Poland", "niche": "Container",
     "contractSigningMentioned": true, "signingReason": "...", "meetingOutcome": "...",
     "cooperationTerm": "" }`
- **System prompt (VERBATIM):**

```
You read a post-meeting note between EVERTRUST (a German public-tender bidding/advisory firm) and a PARTNER company. Extract:
- companyName = the partner company common/short name as spoken; empty if not named.
- country = "Poland" for a Polish partner (Sp. z o.o. / .pl), "Germany" for a German partner (GmbH / .de); infer only from explicit cues, else empty.
- niche = the cooperation sector/niche as ONE short word, chosen from: Container, LED, IT, PV, Cleaning, Painting, BESS. Infer from the meeting topic/products/title; empty if unclear.
- contractSigningMentioned = true ONLY if the note clearly indicates BOTH sides have agreed to sign / are signing / will sign the EVERTRUST cooperation contract NOW. If it is just interest, a pitch, "will review", "will consult", or negotiating, it is false.
- signingReason = brief reason/quote.
- meetingOutcome = ONE short sentence (max ~20 words) summarizing what happened or the next step in THIS meeting (e.g. "Pricing discussed, partner will review internally", "Agreed to sign next week").
- cooperationTerm = the agreed cooperation DURATION/term ONLY if explicitly stated (e.g. "3-6 month trial", "12 months", "trial then annual"); empty if not stated.
Never invent. Output only what the text supports.
```

- **Mapping logic (Build Log Row):**
  `signNow = (d.contractSigningMentioned === true || String(d.contractSigningMentioned).toLowerCase() === 'true') ? 'YES' : ''`.

---

## 6. Campaign resolution (config.json niche+country → folder)

Done in **Match Campaign** (Code). It does NOT pick a template directly — it picks the campaign
**folder id**; the template name is derived later in Build Fields from niche+language.

- Inputs: meeting `niche`/`country` (from `Check & Aggregate`, lowercased), the list of config
  candidates from `Explode Configs` (folderId per config), and each config body from `Download Config`.
- Each config is parsed (string, `.data` string, or object) into `{ folderId, niche, country }`.
  `folderId` comes from the config file's Drive `parents[0]` (the folder containing config.json).
- `nicheMatch(a,b)` = case-insensitive equality OR substring either direction (both non-empty).
- **Matching precedence:**
  1. country exact match AND niche match → choose.
  2. else country exact match only → choose.
  3. else niche match only → choose.
  4. else STUB fallback folder `1tB2BLuQcWhYqStsR9vZlVshAB_OQKa_M`.
- Output: `{ campaignFolderId, niche, country, companyKey, companyName, meetingCount }`.
  Defaults if blank: niche `'DEFAULT'`, country `'Poland'`.

---

## 7. Contract generation (Google Doc template → PDF)

### Field building (Build Fields, runOnceForEachItem)
- **Grounding guard (anti-fabrication):** `aggregateText` is normalized into `HAY`
  (lowercase, accents/diacritics folded, ł→l, ø→o, ß→ss). `grounded(val)` returns the value ONLY if
  its folded form is a substring of HAY, OR any of its ≥4-char tokens appear in HAY; else `''`.
  Applied to partnerLegalName, partnerStreet, partnerPostalCity, partnerSignatory, partnerSignatoryRole.
- **Language:** `LANG = 'DE'` if country contains "german"/"deutsch", else `'EN'`.
- **Template name:** `Template_<niche>_<LANG>` (e.g. `Template_Container_EN`).
- **Placeholder fallbacks** when not grounded: DE/EN guillemet placeholders, e.g.
  `«Firmenname»`/`«Company name»`, `clientSignatoryTitle` defaults `Geschäftsführer`/`Managing Director`.
- `signCity` derived from postal-city (strips leading postal code + comma tail).
- `signDate` = `DD.MM.YYYY` (today).
- `fileBase` = (DE) `Vertragsvereinbarung_<name>_EVERTRUST` / (EN) `Contract_Agreement_<name>_EN`
  (slashes in name → `-`).
- **HARDCODED commercial terms** (NOT extracted from the meeting — fixed boilerplate in the Code node):
  `tenderCount:'10', upfrontFee:'EUR 5,000.00', marketEntryFee:'EUR 2,000.00', projectFee:'EUR 3,000.00',
   commissionRate:'3.5%', furtherPackageFee:'EUR 3,000.00', testphaseFee:'500,00 €',
   packageFee:'2.990,00 €', freeTenders:'5', threshold1:'999.000 EUR', commissionRate1:'3,5 %',
   threshold2:'1.000.000 EUR', commissionRate2:'2,5 %'`.

### Deal Extractor LLM (partner identity)
- **Type:** informationExtractor v1.2; **Model:** `gpt-5-mini` (Deal Model, same OpenAI cred, 120s).
- **Input:** `{{ $json.aggregateText }}`.
- **Schema:** `{ companyName, partnerLegalName, partnerStreet, partnerPostalCity, partnerSignatory,
  partnerSignatoryRole, commissionDetail, setupFee }`.
- **System prompt (VERBATIM):**

```
You extract the PARTNER company legal identity from these aggregated EVERTRUST sales-meeting transcripts to prepare a cooperation contract. ABSOLUTE RULE — NO FABRICATION: output a value ONLY if it is literally stated in the text; otherwise an empty string. partnerLegalName = the full registered name including the legal form (Sp. z o.o., GmbH, S.A.) only if that form was literally spoken. partnerStreet, partnerPostalCity = the registered address only if stated. partnerSignatory + partnerSignatoryRole = the person who will sign and their role, only if explicitly named. commissionDetail + setupFee = the agreed figures verbatim if stated. An empty string is the correct, safe answer whenever a fact was not spoken — never guess a plausible company name, address, or person.
```

### Doc → PDF mechanics
- **Template resolution:** Resolve Template searches Drive for `name = '{{templateName}}' and
  mimeType = 'application/vnd.google-apps.document'`. Pick Template selects the exact-name match
  (fallback first result). If none, `templateDocId` is `''` (Copy will fail/skip).
- **Copy:** `Copy Template` copies the template Doc into `campaignFolderId`, naming it `fileBase`.
- **Fill:** Google Docs `update` runs 20 `replaceAll` ops (matchCase) on the copy, mapping placeholders →
  Build Fields values. Placeholders:
  `{{CLIENT_NAME}}, {{CLIENT_STREET}}, {{CLIENT_POSTAL_CITY}}, {{CLIENT_SIGNATORY_TITLE}},
   {{CLIENT_SIGNATORY}}, {{SIGN_CITY}}, {{SIGN_DATE}}, {{TENDER_COUNT}}, {{UPFRONT_FEE}},
   {{MARKET_ENTRY_FEE}}, {{PROJECT_FEE}}, {{COMMISSION_RATE}}, {{FURTHER_PACKAGE_FEE}},
   {{TESTPHASE_FEE}}, {{PACKAGE_FEE}}, {{FREE_TENDERS}}, {{THRESHOLD_1}}, {{COMMISSION_RATE_1}},
   {{THRESHOLD_2}}, {{COMMISSION_RATE_2}}`.
- **Export:** Export PDF downloads the copied Doc converting to `application/pdf`, filename
  `{{fileBase}}.pdf`, binary prop `data`.
- **Store:** Save PDF uploads that binary into `campaignFolderId` (same campaign folder as the Doc copy),
  on My Drive. So BOTH the filled Doc copy and the PDF land in the resolved campaign folder.

---

## 8. State READ / WRITTEN

| Resource | id / location | R/W | Notes |
|---|---|---|---|
| Meeting-log Sheet (`Sheet1`) | `1IHtYVDvogVe0pth3hsHhpGHxcSknThRTX8C4vXEcO9A` | R + W | append per meeting; read by companyKey; append marker. 12 columns (§3). |
| Drive `config.json` files | searched globally by name | R | folder = parents[0] = campaign folder. |
| Campaign folder | resolved or STUB `1tB2BLuQcWhYqStsR9vZlVshAB_OQKa_M` | W | receives filled Doc copy + PDF. |
| Google Doc templates | `Template_<niche>_<LANG>` (google-apps.document) | R | copied, not modified. |
| Filled Doc copy | named `fileBase`, in campaign folder | W | created by Copy, edited by Fill. |
| Contract PDF | `fileBase.pdf`, in campaign folder | W | created by Export+Save. |
| **Status field** | `processed` column | R/W | `"YES"` marker = idempotency lock per company. |
| Calendar | — | — | NONE. No calendar node anywhere. |

Idempotency: a company is processed once; `Check & Aggregate` halts if any of its rows is `processed=YES`.

---

## 9. Credentials, config, retry/error handling

**Credentials:**
- OpenAI: `OpenAI account 2` (id `ueRt2skL94DirL6P`) — both LLMs, model `gpt-5-mini`.
- Google Sheets OAuth2: id `nVxTVzA6qeIhESvH` — Append Log, Read Company Log, Mark Processed.
- Google Drive OAuth2: id `7ntqqDsIDCgae66w` — Search/Download Config, Resolve Template, Copy, Export, Save.
- Google Docs OAuth2: id `J0DOqlTNGgQXvrem` — Fill.
- CRM webhook: no auth.

**Config consumed externally:** Drive `config.json` files (each `{niche, country}`, folder = its parent).

**Retry / error handling:**
- `retryOnFail: true` on: Signal Extractor, Deal Extractor, Search Configs, Download Config,
  Resolve Template, Copy Template, Fill, Export PDF, Save PDF.
- `onError: continueRegularOutput` on: Ping CRM Sync, Download Config, Resolve Template, Fill
  (these never halt the run on failure).
- Settings: `executionOrder: v1`, `binaryMode: separate`.
- No dedicated error-handler/error-trigger node; no Slack/email alerting.

---

## 10. n8n artifacts NOT worth porting

- **Run Manually + Sample Meetings** — test-only harness with a hardcoded fake meeting. Skip; replace
  with a unit-test fixture in the port.
- **`$('NodeName').item / .first()` cross-node lookups** — n8n's runtime data-graph access (Build Log Row,
  Build Fields, Pick Template, Build Marker, Match Campaign all reach back to upstream nodes). In a Python
  port these become normal local variables / function args; the try/catch guards are n8n-isolation
  artifacts, not real logic.
- **Explode/Download/Match config fan-out** — n8n item-stream mechanics. In Python this is just:
  list config.json files → read each → match → pick folder. No need to mirror the item-array dance.
- **`availableInMCP: true`, `aiBuilderAssisted` meta, versionId/versionCounter, webhookId** — instance
  metadata, irrelevant to a port.
- **autoMapInputData / `__rl` resource-locator wrappers / `=`-prefixed expression strings** — n8n
  serialization syntax; port to plain field maps and string interpolation.
- **binaryMode/binary `data` prop plumbing** — in Python the PDF is just bytes; the Export→Save split
  (download then re-upload) can collapse into one Drive export-to-folder call.

---

## Known issues / risks for the port

- **CRM ping sends an empty POST body** — no meeting data is transmitted (§4). Likely a bug if the CRM
  expects a payload.
- **Hardcoded commercial terms** (commission, fees, thresholds in §7) override anything the meeting says;
  `Deal Extractor`'s `commissionDetail`/`setupFee` are extracted but NEVER used in the merge fields.
- **Webhook has no auth** — anyone hitting `/webhook/readai-contract-v2` can trigger contract generation.
- **`signNow` aggregation quirk:** Check & Aggregate re-derives niche/country preferring signNow rows, but
  the gate already required signNow=YES on the *current* meeting only.
- **Template/config dependence on naming:** if `Template_<niche>_<LANG>` Doc or matching config.json is
  missing, it silently falls back to STUB folder / first template — wrong contract possible.
